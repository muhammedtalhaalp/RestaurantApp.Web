"""LezzetPOS masa doluluk kamerası.

Kamera görüntüsünde her masanın alanı bir kez işaretlenir (--calibrate). Program sonra her karede
YOLO (COCO ile eğitilmiş hazır model) ile insanları ve masadaki tabak/bardak gibi nesneleri bulur:

    alanda insan var                  -> Dolu
    insan yok, tabak/bardak kalmış    -> Toplanacak
    ikisi de yok                      -> Bos

Durum, belirli bir süre aynı kaldığında kesinleşir ve LezzetPOS'a (/TableCamera/ReportStatus)
bildirilir. Kasadaki krokide masanın üstünde görünür; sistemle çelişirse uyarı verir.
Görüntü hiçbir yere gönderilmez ve kaydedilmez; sunucuya yalnızca masa durumu gider.
"""

import argparse
import json
import sys
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np
import requests

CONFIG_PATH = Path(__file__).with_name("config.json")
WINDOW_TITLE = "LezzetPOS Masa Kamerasi (cikis: Q)"
CALIBRATE_TITLE = "LezzetPOS Masa Kalibrasyonu"

STATUS_EMPTY = "Bos"
STATUS_OCCUPIED = "Dolu"
STATUS_CLEARING = "Toplanacak"

# OpenCV renkleri BGR sırasındadır
STATUS_COLORS = {
    STATUS_EMPTY: (100, 180, 50),
    STATUS_OCCUPIED: (70, 70, 215),
    STATUS_CLEARING: (20, 150, 230),
    None: (160, 160, 160),
}
STATUS_LABELS = {STATUS_EMPTY: "BOS", STATUS_OCCUPIED: "DOLU", STATUS_CLEARING: "TOPLANACAK", None: "..."}


def load_config(path):
    if not path.exists():
        sys.exit(f"Ayar dosyası bulunamadı: {path}\nconfig.example.json dosyasını config.json olarak kopyalayıp doldurun.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_config(path, config):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


class LezzetPosClient:
    """LezzetPOS sunucusuna giriş yapar, masa listesini alır ve masa durumlarını bildirir."""

    def __init__(self, base_url, username, password, verify_ssl=True):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.verify = verify_ssl
        self.token = None

    def login(self):
        response = self.session.post(
            f"{self.base_url}/Auth/ApiLogin",
            data={"Username": self.username, "Password": self.password},
            timeout=15,
        )
        response.raise_for_status()
        result = response.json()
        if not result.get("success"):
            raise RuntimeError(f"LezzetPOS girişi başarısız: {result.get('message')}")
        self.token = result["token"]
        print(f"LezzetPOS'a giriş yapıldı ({result.get('fullName')}, rol: {result.get('role')}).")

    def _request(self, method, path, **kwargs):
        if self.token is None:
            self.login()
        for attempt in range(2):
            response = self.session.request(
                method,
                f"{self.base_url}{path}",
                headers={"Authorization": f"Bearer {self.token}", "X-Client-App": "lezzet-masa-kamerasi"},
                timeout=15,
                allow_redirects=False,
                **kwargs,
            )
            if response.status_code == 403:
                raise RuntimeError("Bu hesabın masa kamerası yetkisi yok (Admin, Kasiyer, Garson veya Mutfak rolü gerekir).")
            if response.status_code == 401 and attempt == 0:
                print("Oturum süresi dolmuş, yeniden giriş yapılıyor...")
                self.login()
                continue
            response.raise_for_status()
            result = response.json()
            if not result.get("success"):
                raise RuntimeError(result.get("message") or "Sunucu isteği reddetti.")
            return result
        raise RuntimeError("Yeniden giriş yapıldı ama sunucu isteği yine reddetti.")

    def get_tables(self):
        return self._request("GET", "/TableCamera/GetTables")["data"]

    def report(self, statuses):
        body = {"tables": [{"TableId": table_id, "Status": status} for table_id, status in statuses.items()]}
        return self._request("POST", "/TableCamera/ReportStatus", json=body)


class Detector:
    """YOLO ile insanları ve masadaki nesneleri bulur. Model ilk çalıştırmada otomatik indirilir."""

    def __init__(self, model_name, confidence, item_classes):
        from ultralytics import YOLO  # yavaş yüklenir; yalnızca gerektiğinde

        self.model = YOLO(model_name)
        self.confidence = confidence
        self.names = self.model.names
        self.item_classes = set(item_classes)

    def detect(self, frame):
        """[(class_name, confidence, (x1, y1, x2, y2)), ...]"""
        result = self.model.predict(frame, conf=self.confidence, verbose=False)[0]
        detections = []
        for box in result.boxes:
            name = self.names[int(box.cls[0])]
            if name == "person" or name == "dining table" or name in self.item_classes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
                detections.append((name, float(box.conf[0]), (x1, y1, x2, y2)))
        return detections


def polygon_pixels(polygon, width, height):
    """Oransal (0-1) köşe listesini piksel koordinatına çevirir."""
    return np.array([[int(x * width), int(y * height)] for x, y in polygon], dtype=np.int32)


class TableRegion:
    def __init__(self, table_id, name, polygon):
        self.table_id = table_id
        self.name = name
        self.polygon = polygon  # oransal köşeler
        self._mask = None
        self._mask_size = None
        self._points = None

    def prepare(self, width, height):
        if self._mask_size == (width, height):
            return
        self._points = polygon_pixels(self.polygon, width, height)
        self._mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(self._mask, [self._points], 1)
        self._mask_size = (width, height)

    @property
    def points(self):
        return self._points

    def overlap(self, box):
        """Kutu ile masa alanının kesişimi / (kutu ile alandan küçük olanın alanı)."""
        x1, y1, x2, y2 = box
        h, w = self._mask.shape
        x1, x2 = max(0, x1), min(w, x2)
        y1, y2 = max(0, y1), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            return 0.0
        inside = int(self._mask[y1:y2, x1:x2].sum())
        smaller = min((x2 - x1) * (y2 - y1), int(self._mask.sum())) or 1
        return inside / smaller

    def contains_center(self, box):
        x1, y1, x2, y2 = box
        center = (float((x1 + x2) / 2), float((y1 + y2) / 2))
        return cv2.pointPolygonTest(self._points, center, False) >= 0


def classify(region, detections, person_overlap):
    """Tek karedeki ham durum: Dolu / Toplanacak / Bos."""
    if any(name == "person" and region.overlap(box) >= person_overlap for name, _, box in detections):
        return STATUS_OCCUPIED
    if any(name not in ("person", "dining table") and region.contains_center(box) for name, _, box in detections):
        return STATUS_CLEARING
    return STATUS_EMPTY


class StatusTracker:
    """Ham durum hold_seconds[durum] boyunca hiç değişmeden görülürse kesinleşir.

    Böylece önünden geçen garson masayı "Dolu", lavaboya kalkan müşteri masayı "Bos" yapmaz.
    """

    def __init__(self, hold_seconds):
        self.hold = hold_seconds
        self.keep = max(hold_seconds.values()) + 1
        self.history = deque()
        self.confirmed = None

    def update(self, raw, now):
        self.history.append((now, raw))
        while self.history and now - self.history[0][0] > self.keep:
            self.history.popleft()
        if raw == self.confirmed:
            return False
        need = self.hold.get(raw, 5)
        if now - self.history[0][0] < need:
            return False
        if all(status == raw for t, status in self.history if now - t <= need):
            self.confirmed = raw
            return True
        return False


def open_camera(index):
    camera = cv2.VideoCapture(index, cv2.CAP_DSHOW) if sys.platform == "win32" else cv2.VideoCapture(index)
    if not camera.isOpened():
        sys.exit(f"Kamera açılamadı (camera_index={index}). Başka bir program kamerayı kullanıyor olabilir.")
    return camera


def read_frame(camera):
    ok, frame = camera.read()
    if not ok or frame is None:
        raise RuntimeError("Kameradan görüntü alınamadı.")
    return frame


def draw_text(frame, text, origin, color=(255, 255, 255), scale=0.55):
    x, y = origin
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    cv2.rectangle(frame, (x - 3, y - th - 5), (x + tw + 3, y + 4), (30, 20, 35), -1)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def ascii_name(text):
    """OpenCV Türkçe karakter yazamaz; ekranda gösterim için sadeleştirir."""
    table = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    return str(text).translate(table)


def draw_regions(frame, regions, statuses=None):
    overlay = frame.copy()
    for region in regions:
        status = statuses.get(region.table_id) if statuses else None
        cv2.fillPoly(overlay, [region.points], STATUS_COLORS[status])
    cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)
    for region in regions:
        status = statuses.get(region.table_id) if statuses else None
        cv2.polylines(frame, [region.points], True, STATUS_COLORS[status], 2)
        x, y = region.points.min(axis=0)
        label = ascii_name(region.name) + (f": {STATUS_LABELS[status]}" if statuses is not None else "")
        draw_text(frame, label, (int(x) + 4, int(y) + 18))


def draw_detections(frame, detections):
    for name, conf, (x1, y1, x2, y2) in detections:
        if name == "dining table":
            continue
        color = (215, 120, 70) if name == "person" else (40, 200, 230)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 1)
        cv2.putText(frame, f"{name} {conf:.0%}", (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)


def build_regions(config):
    regions = [TableRegion(t["tableId"], t.get("name") or f"Masa {t['tableId']}", t["polygon"]) for t in config.get("tables", [])]
    if not regions:
        sys.exit("Henüz masa alanı işaretlenmemiş. Önce: python table_camera.py --calibrate")
    return regions


def make_detector(config):
    return Detector(config.get("model", "yolov8n.pt"), config.get("confidence", 0.35), config.get("item_classes", []))


# ---------------- Kalibrasyon ----------------

def choose_table(frame, server_tables, used_ids):
    """Masa listesini kamera penceresinin üstünde gösterir; numara yazılıp Enter'a basılır (Esc: vazgeç)."""
    typed = ""
    while True:
        view = frame.copy()
        overlay = view.copy()
        rows = len(server_tables) + 3
        cv2.rectangle(overlay, (10, 40), (380, 40 + rows * 24 + 10), (30, 20, 35), -1)
        cv2.addWeighted(overlay, 0.85, view, 0.15, 0, view)
        y = 64
        cv2.putText(view, "Bu alan hangi masa? Numara yazip Enter", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        for i, t in enumerate(server_tables, start=1):
            y += 24
            mark = "  (isaretli)" if t["tableId"] in used_ids else ""
            text = f"{i:>2}) {ascii_name(t['tableNumber'])}  [{ascii_name(t.get('section') or 'Salon')}]{mark}"
            cv2.putText(view, text, (24, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 200, 230), 1, cv2.LINE_AA)
        y += 30
        cv2.putText(view, f"Masa no: {typed}_    (Esc: vazgec)", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (120, 230, 255), 2, cv2.LINE_AA)
        cv2.imshow(CALIBRATE_TITLE, view)

        key = cv2.waitKey(50) & 0xFF
        if key == 27:
            return None
        if key == 8:
            typed = typed[:-1]
        elif ord("0") <= key <= ord("9") and len(typed) < 3:
            typed += chr(key)
        elif key == 13 and typed:
            if 1 <= int(typed) <= len(server_tables):
                return server_tables[int(typed) - 1]
            typed = ""


def run_calibration(config, client):
    server_tables = client.get_tables()
    if not server_tables:
        sys.exit("Restoranda aktif masa yok. Önce Masa Yönetimi'nden masa ekleyin.")

    regions = {t["tableId"]: t for t in config.get("tables", [])}
    camera = open_camera(config.get("camera_index", 0))
    detector = None
    points = []
    state = {"click": None}

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            state["click"] = ("add", x, y)
        elif event == cv2.EVENT_RBUTTONDOWN:
            state["click"] = ("close", x, y)

    cv2.namedWindow(CALIBRATE_TITLE)
    cv2.setMouseCallback(CALIBRATE_TITLE, on_mouse)
    print(
        "\nKALİBRASYON\n"
        "  Sol tık : masa alanının köşesini ekle (masanın kendisi + sandalyelerin oturulan kısmı)\n"
        "  Sağ tık / Enter : alanı kapat, açılan listeden masa numarasını yazıp Enter'a bas (en az 3 köşe)\n"
        "  A : görüntüdeki masaları otomatik bul ve sırayla eşleştir\n"
        "  Z : son köşeyi geri al     X : son eklenen masa alanını sil\n"
        "  S : kaydet ve çık          Q : kaydetmeden çık\n"
    )

    def assign(frame, polygon_px, width, height):
        preview = frame.copy()
        cv2.polylines(preview, [np.array(polygon_px, dtype=np.int32)], True, (255, 0, 255), 3)
        table = choose_table(preview, server_tables, set(regions))
        if table is None:
            return
        regions[table["tableId"]] = {
            "tableId": table["tableId"],
            "name": table["tableNumber"],
            "polygon": [[round(x / width, 4), round(y / height, 4)] for x, y in polygon_px],
        }
        print(f"✓ {table['tableNumber']} işaretlendi.")

    try:
        while True:
            frame = read_frame(camera)
            height, width = frame.shape[:2]
            view = frame.copy()

            drawn = [TableRegion(t["tableId"], t["name"], t["polygon"]) for t in regions.values()]
            for region in drawn:
                region.prepare(width, height)
            draw_regions(view, drawn)
            if points:
                cv2.polylines(view, [np.array(points, dtype=np.int32)], False, (255, 0, 255), 2)
                for p in points:
                    cv2.circle(view, p, 4, (255, 0, 255), -1)
            draw_text(view, f"Isaretli masa: {len(regions)}  |  Sol tik: kose  Sag tik: bitir  A: otomatik  S: kaydet", (10, 24))
            cv2.imshow(CALIBRATE_TITLE, view)

            key = cv2.waitKey(30) & 0xFF
            click, state["click"] = state["click"], None
            if click and click[0] == "add":
                points.append((click[1], click[2]))
            if (click and click[0] == "close") or key == 13:
                if len(points) >= 3:
                    assign(frame, points, width, height)
                else:
                    print("Alanı kapatmak için en az 3 köşe gerekir.")
                points = []
            if key == ord("z") and points:
                points.pop()
            if key == ord("x") and regions:
                removed = regions.pop(list(regions)[-1])
                print(f"{removed['name']} alanı silindi.")
            if key == ord("a"):
                if detector is None:
                    print("Model yükleniyor...")
                    detector = make_detector(config)
                found = [box for name, _, box in detector.detect(frame) if name == "dining table"]
                print(f"{len(found)} masa bulundu.")
                for x1, y1, x2, y2 in found:
                    assign(frame, [(x1, y1), (x2, y1), (x2, y2), (x1, y2)], width, height)
            if key == ord("s"):
                config["tables"] = list(regions.values())
                save_config(CONFIG_PATH, config)
                print(f"{len(regions)} masa alanı kaydedildi: {CONFIG_PATH}")
                break
            if key == ord("q"):
                print("Kaydedilmeden çıkıldı.")
                break
    finally:
        camera.release()
        cv2.destroyAllWindows()


# ---------------- Çalışma ----------------

def evaluate(frame, regions, detector, config):
    height, width = frame.shape[:2]
    for region in regions:
        region.prepare(width, height)
    detections = detector.detect(frame)
    raw = {region.table_id: classify(region, detections, config.get("person_overlap", 0.2)) for region in regions}
    return detections, raw


def run_image(config, image_path):
    """Kamera açmadan tek bir fotoğrafta dener (test için). Sunucuya bir şey göndermez."""
    regions = build_regions(config)
    frame = cv2.imread(str(image_path))
    if frame is None:
        sys.exit(f"Fotoğraf okunamadı: {image_path}")
    detector = make_detector(config)
    detections, raw = evaluate(frame, regions, detector, config)
    found = ", ".join(f"{name} %{conf * 100:.0f}" for name, conf, _ in detections) or "yok"
    print(f"Bulunanlar: {found}")
    for region in regions:
        print(f"  {region.name}: {raw[region.table_id]}")
    return raw


def run_loop(config, client, show_window=True):
    regions = build_regions(config)
    print("Model yükleniyor...")
    detector = make_detector(config)
    camera = open_camera(config.get("camera_index", 0))
    hold = {STATUS_OCCUPIED: 3, STATUS_EMPTY: 8, STATUS_CLEARING: 8}
    hold.update(config.get("hold_seconds", {}))
    trackers = {region.table_id: StatusTracker(hold) for region in regions}
    interval = config.get("check_interval_seconds", 0.5)
    heartbeat = config.get("heartbeat_seconds", 30)
    last_sent = 0.0
    last_error = ""

    print(f"{len(regions)} masa izleniyor. Çıkmak için pencerede Q'ya basın (ya da Ctrl+C).")
    try:
        while True:
            started = time.time()
            frame = read_frame(camera)
            detections, raw = evaluate(frame, regions, detector, config)

            changed = [tid for tid, tracker in trackers.items() if tracker.update(raw[tid], started)]
            confirmed = {tid: t.confirmed for tid, t in trackers.items() if t.confirmed}
            for tid in changed:
                name = next(r.name for r in regions if r.table_id == tid)
                print(f"{time.strftime('%H:%M:%S')}  {name}: {trackers[tid].confirmed}")

            # Değişiklik hemen, değişmeyen durumlar canlılık için heartbeat aralığıyla gönderilir
            if confirmed and (changed or started - last_sent >= heartbeat):
                try:
                    client.report(confirmed)
                    last_sent = started
                    last_error = ""
                except Exception as exc:  # sunucu kapalıysa kamera çalışmaya devam eder
                    if str(exc) != last_error:
                        print(f"Sunucuya bildirilemedi: {exc}")
                    last_error = str(exc)

            if show_window:
                view = frame.copy()
                draw_regions(view, regions, {tid: t.confirmed for tid, t in trackers.items()})
                draw_detections(view, detections)
                status = "Sunucu baglantisi yok!" if last_error else "Goruntu kaydedilmez; sunucuya yalnizca masa durumu gider."
                draw_text(view, status, (10, view.shape[0] - 12), (80, 80, 255) if last_error else (255, 255, 255))
                cv2.imshow(WINDOW_TITLE, view)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            time.sleep(max(0.0, interval - (time.time() - started)))
    except KeyboardInterrupt:
        pass
    finally:
        camera.release()
        cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description="LezzetPOS masa doluluk kamerası")
    parser.add_argument("--calibrate", action="store_true", help="kamera görüntüsünde masa alanlarını işaretle")
    parser.add_argument("--image", help="kamera yerine bu fotoğrafta bir kez dene (sunucuya göndermez)")
    parser.add_argument("--no-window", action="store_true", help="görüntü penceresi açma")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="ayar dosyası")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    if args.image:
        run_image(config, args.image)
        return

    client = LezzetPosClient(config["server_url"], config["username"], config["password"], config.get("verify_ssl", True))
    if not config.get("verify_ssl", True):
        requests.packages.urllib3.disable_warnings()
    client.login()

    if args.calibrate:
        run_calibration(config, client)
    else:
        run_loop(config, client, show_window=not args.no_window)


if __name__ == "__main__":
    main()
