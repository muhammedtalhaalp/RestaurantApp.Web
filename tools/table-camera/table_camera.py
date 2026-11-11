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
DRAG_MIN_PIXELS = 12   # kalibrasyonda bundan kısa fare hareketi sürükleme değil tıklama sayılır
CALIBRATE_TITLE = "LezzetPOS Masa Kalibrasyonu"
PLAN_TITLE = "LezzetPOS Kroki"

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

    def get_plan(self):
        return self._request("GET", "/TableCamera/GetPlan")["data"]

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


class FrameSource:
    """Görüntü kaynağı: kamera numarası (0, 1…), ağ akışı (telefonda IP kamera uygulaması, tavan
    kamerasının RTSP adresi) ya da video dosyası. Video dosyası gerçek zaman hızında oynatılır ve
    bitince başa sarar; böylece kayıtlı bir tavan kamerası videosu canlı kamera gibi kullanılabilir."""

    def __init__(self, source):
        if isinstance(source, str) and source.strip().isdigit():
            source = int(source)
        self.source = source
        self.is_file = isinstance(source, str) and Path(source).is_file()
        self.is_stream = isinstance(source, str) and not self.is_file
        if isinstance(source, str) and not self.is_file and "://" not in source:
            sys.exit(f"Görüntü kaynağı bulunamadı: {source}\nKamera numarası (0), video dosyası ya da http:// / rtsp:// adresi verin.")
        self._open()

    def _open(self):
        if isinstance(self.source, int) and sys.platform == "win32":
            self.capture = cv2.VideoCapture(self.source, cv2.CAP_DSHOW)
        else:
            self.capture = cv2.VideoCapture(self.source)
        if not self.capture.isOpened():
            sys.exit(f"Görüntü kaynağı açılamadı: {self.source}. Kamera başka bir programda açık ya da adres yanlış olabilir.")
        if self.is_file:
            self.fps = self.capture.get(cv2.CAP_PROP_FPS) or 25.0
            self.frame_count = int(self.capture.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
            self.position = 0
            self.started = time.time()

    def read(self):
        if self.is_file:
            return self._read_file()
        ok, frame = self.capture.read()
        if (not ok or frame is None) and self.is_stream:
            # Ağ akışı kopmuş olabilir: bir kez yeniden bağlan
            self.capture.release()
            time.sleep(1)
            self._open()
            ok, frame = self.capture.read()
        if not ok or frame is None:
            raise RuntimeError("Görüntü kaynağından kare alınamadı.")
        return frame

    def _read_file(self):
        # Geçen süreye karşılık gelen kareye kadar ilerle (grab kareyi çözmeden atlar)
        target = int((time.time() - self.started) * self.fps)
        if self.frame_count and target >= self.frame_count:
            self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
            self.position = 0
            self.started = time.time()
            target = 0
        while self.position < target:
            if not self.capture.grab():
                break
            self.position += 1
        ok, frame = self.capture.read()
        self.position += 1
        if not ok or frame is None:
            self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
            self.position = 0
            self.started = time.time()
            ok, frame = self.capture.read()
            if not ok or frame is None:
                raise RuntimeError(f"Video dosyası okunamadı: {self.source}")
        return frame

    def release(self):
        self.capture.release()


def source_of(config):
    """Ayarlardaki görüntü kaynağı: camera_source (dosya / adres / numara), yoksa camera_index."""
    return config.get("camera_source", config.get("camera_index", 0))


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


# ---------------- Kroki ile otomatik eşleme (homografi) ----------------
# Kroki, zeminin kuşbakışı çizimidir. Kamera görüntüsünde zemin üzerindeki 4 nokta ile krokideki
# karşılıkları eşlenince iki düzlem arasındaki dönüşüm (homografi) bulunur; krokideki her masanın
# görüntüdeki yeri bu dönüşümle hesaplanır. Masa alanı, sandalyelerin oturulan kısmını da kapsasın
# diye krokideki masadan seat_margin kadar büyütülür.

def plan_sections(plan):
    names = []
    for item in plan["tables"] + plan["elements"]:
        if not any(n.lower() == item["section"].lower() for n in names):
            names.append(item["section"])
    return names


def table_footprint(table, margin):
    """Krokideki masanın (sandalye payıyla büyütülmüş) dört köşesi, kroki koordinatlarında."""
    x0, y0 = table["posX"] - margin, table["posY"] - margin
    x1, y1 = table["posX"] + table["width"] + margin, table["posY"] + table["height"] + margin
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def well_spread(points, min_ratio=0.02):
    """Herhangi üç nokta neredeyse aynı doğru üzerindeyse False (dönüşüm anlamsız olur)."""
    pts = np.array(points, dtype=np.float64)
    span = max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1]), 1e-9)
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            for k in range(j + 1, len(pts)):
                a, b, c = pts[i], pts[j], pts[k]
                twice_area = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
                if twice_area < min_ratio * span * span:
                    return False
    return True


def find_homography(plan_points, image_points):
    for points in (plan_points, image_points):
        if not well_spread(points):
            raise ValueError("Dört noktanın üçü aynı doğru üzerinde ya da birbirine çok yakın; salonun birbirinden uzak köşelerini seçin.")
    matrix, _ = cv2.findHomography(np.array(plan_points, dtype=np.float64), np.array(image_points, dtype=np.float64))
    if matrix is None or abs(np.linalg.det(matrix)) < 1e-12:
        raise ValueError("Noktalardan dönüşüm hesaplanamadı; dört noktanın üçü aynı doğru üzerinde olmamalı.")
    return matrix


def project(matrix, points):
    """Kroki noktalarını görüntüye taşır. Kameranın arkasına düşen nokta varsa None döner."""
    pts = np.hstack([np.array(points, dtype=np.float64), np.ones((len(points), 1))]) @ matrix.T
    if np.any(pts[:, 2] <= 1e-9):
        return None
    return pts[:, :2] / pts[:, 2:3]


def polygon_area(points):
    return abs(cv2.contourArea(np.array(points, dtype=np.float32)))


def clip_to_frame(points, width, height):
    """Görüntü dışına taşan kısmı kırpar; görüntüde kalan çokgen ve görünen oranı döner."""
    frame = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    area = polygon_area(points)
    if area < 1:
        return None, 0.0
    inside, clipped = cv2.intersectConvexConvex(np.array(points, dtype=np.float32), frame)
    if clipped is None or inside < 1:
        return None, 0.0
    return clipped.reshape(-1, 2), inside / area


def polygon_iou(a, b):
    """İki dışbükey çokgenin kesişim / birleşim oranı (otomatik eşlemenin doğruluğunu ölçmek için)."""
    a, b = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    inter, _ = cv2.intersectConvexConvex(a, b)
    union = polygon_area(a) + polygon_area(b) - inter
    return inter / union if union > 0 else 0.0


def auto_regions(plan, section, matrix, width, height, margin, min_visible=0.3):
    """Bir alandaki krokide çizili masaları görüntüye yerleştirir; görüntüde yeterince görünmeyenleri atlar."""
    regions, skipped = {}, []
    for table in plan["tables"]:
        if table["section"].lower() != section.lower():
            continue
        projected = project(matrix, table_footprint(table, margin))
        polygon, visible = (None, 0.0) if projected is None else clip_to_frame(projected, width, height)
        if polygon is None or visible < min_visible:
            skipped.append(table["tableNumber"])
            continue
        regions[table["tableId"]] = {
            "tableId": table["tableId"],
            "name": table["tableNumber"],
            "polygon": [[round(float(x) / width, 4), round(float(y) / height, 4)] for x, y in polygon],
        }
    return regions, skipped


ELEMENT_COLORS = {"zemin": (235, 232, 228), "duvar": (70, 60, 75), "kolon": (90, 80, 95), "mutfak": (180, 210, 245),
                  "kasa": (225, 190, 225), "kapi": (150, 190, 220), "merdiven": (200, 200, 205), "wc": (240, 225, 180)}


def render_plan(plan, section, max_width=1100, max_height=680):
    """Krokinin bir alanını OpenCV penceresinde göstermek için çizer. (görüntü, ölçek) döner."""
    canvas_w, canvas_h = plan["canvas"]["width"], plan["canvas"]["height"]
    scale = min(max_width / canvas_w, max_height / canvas_h)
    image = np.full((int(canvas_h * scale), int(canvas_w * scale), 3), (215, 210, 205), dtype=np.uint8)
    elements = [e for e in plan["elements"] if e["section"].lower() == section.lower()]
    elements.sort(key=lambda e: 0 if e["type"] == "zemin" else 1)   # zemin en altta
    for e in elements:
        center = ((e["posX"] + e["width"] / 2) * scale, (e["posY"] + e["height"] / 2) * scale)
        box = cv2.boxPoints((center, (e["width"] * scale, e["height"] * scale), e.get("rotation") or 0)).astype(np.int32)
        cv2.fillPoly(image, [box], ELEMENT_COLORS.get(e["type"], (210, 200, 190)))
        cv2.polylines(image, [box], True, (120, 110, 125), 1)
        if e["type"] != "zemin":
            cv2.putText(image, ascii_name(e.get("label") or e["type"]), (box[:, 0].min() + 3, box[:, 1].min() + 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (60, 50, 65), 1, cv2.LINE_AA)
    for t in plan["tables"]:
        if t["section"].lower() != section.lower():
            continue
        p0 = (int(t["posX"] * scale), int(t["posY"] * scale))
        p1 = (int((t["posX"] + t["width"]) * scale), int((t["posY"] + t["height"]) * scale))
        if t.get("shape") == "Circle":
            cv2.ellipse(image, ((p0[0] + p1[0]) // 2, (p0[1] + p1[1]) // 2), ((p1[0] - p0[0]) // 2, (p1[1] - p0[1]) // 2), 0, 0, 360, (120, 200, 140), -1)
        else:
            cv2.rectangle(image, p0, p1, (120, 200, 140), -1)
        cv2.putText(image, ascii_name(t["tableNumber"]), (p0[0] + 3, (p0[1] + p1[1]) // 2 + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (20, 60, 30), 1, cv2.LINE_AA)
    return image, scale


def pick_points(window, image, count, prompt, done_points=None):
    """Pencerede sırayla `count` nokta tıklatır. Z: geri al, Esc: vazgeç (None). Noktalar piksel cinsinden."""
    points, clicks = [], []
    cv2.namedWindow(window)
    cv2.setMouseCallback(window, lambda event, x, y, flags, param: clicks.append((x, y)) if event == cv2.EVENT_LBUTTONDOWN else None)
    while True:
        if clicks:
            points.append(clicks.pop(0))
        view = image.copy()
        for i, p in enumerate(done_points or []):
            cv2.circle(view, (int(p[0]), int(p[1])), 5, (150, 150, 150), -1)
        for i, p in enumerate(points, start=1):
            cv2.circle(view, p, 6, (255, 0, 255), -1)
            cv2.putText(view, str(i), (p[0] + 8, p[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 255), 2, cv2.LINE_AA)
        if len(points) > 1:
            cv2.polylines(view, [np.array(points, dtype=np.int32)], len(points) == count, (255, 0, 255), 1)
        draw_text(view, f"{prompt} ({len(points)}/{count})  Z: geri al  Esc: vazgec", (10, 24))
        cv2.imshow(window, view)
        key = cv2.waitKey(30) & 0xFF
        if key == 27:
            return None
        if key == ord("z") and points:
            points.pop()
        if len(points) >= count:
            cv2.imshow(window, view)
            cv2.waitKey(400)
            return points[:count]


def choose_from_list(frame, title, labels):
    """Listeyi pencerenin üstünde gösterir; numara yazılıp Enter'a basılır (Esc: vazgeç). Seçilen sıra (0'dan) döner."""
    typed = ""
    while True:
        view = frame.copy()
        overlay = view.copy()
        rows = len(labels) + 3
        cv2.rectangle(overlay, (10, 40), (420, 40 + rows * 24 + 10), (30, 20, 35), -1)
        cv2.addWeighted(overlay, 0.85, view, 0.15, 0, view)
        y = 64
        cv2.putText(view, title, (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        for i, label in enumerate(labels, start=1):
            y += 24
            cv2.putText(view, f"{i:>2}) {label}", (24, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 200, 230), 1, cv2.LINE_AA)
        y += 30
        cv2.putText(view, f"No: {typed}_    (Esc: vazgec)", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (120, 230, 255), 2, cv2.LINE_AA)
        cv2.imshow(CALIBRATE_TITLE, view)

        key = cv2.waitKey(50) & 0xFF
        if key == 27:
            return None
        if key == 8:
            typed = typed[:-1]
        elif ord("0") <= key <= ord("9") and len(typed) < 3:
            typed += chr(key)
        elif key == 13 and typed:
            if 1 <= int(typed) <= len(labels):
                return int(typed) - 1
            typed = ""


# ---------------- Kalibrasyon ----------------

def choose_table(frame, server_tables, used_ids):
    labels = [f"{ascii_name(t['tableNumber'])}  [{ascii_name(t.get('section') or 'Salon')}]" + ("  (isaretli)" if t["tableId"] in used_ids else "")
              for t in server_tables]
    index = choose_from_list(frame, "Bu alan hangi masa? Numara yazip Enter", labels)
    return None if index is None else server_tables[index]


def calibrate_with_plan(client, config, regions, frame):
    """H tuşu: kamerada 4 zemin noktası + krokide aynı 4 nokta → alandaki tüm masalar otomatik yerleşir."""
    plan = client.get_plan()
    sections = plan_sections(plan)
    if not plan["tables"] or not sections:
        print("Krokide masa yok. Önce Kroki Yönetimi'nde krokiyi çizin.")
        return
    index = 0 if len(sections) == 1 else choose_from_list(frame, "Kamera hangi alani goruyor?", [ascii_name(s) for s in sections])
    if index is None:
        return
    section = sections[index]
    print(f"\n{section}: kamera görüntüsünde zemin üzerinde 4 nokta seçin (salon köşeleri ya da zemine konan işaretler),"
          " sonra açılan kroki penceresinde AYNI 4 noktayı AYNI sırayla seçin.")

    image_points = pick_points(CALIBRATE_TITLE, frame, 4, "Kamerada zeminde 4 nokta")
    if not image_points:
        return
    plan_image, scale = render_plan(plan, section)
    plan_clicks = pick_points(PLAN_TITLE, plan_image, 4, "Krokide ayni 4 nokta, ayni sirayla")
    cv2.destroyWindow(PLAN_TITLE)
    if not plan_clicks:
        return
    plan_points = [(x / scale, y / scale) for x, y in plan_clicks]

    try:
        matrix = find_homography(plan_points, image_points)
    except ValueError as exc:
        print(exc)
        return
    height, width = frame.shape[:2]
    added, skipped = auto_regions(plan, section, matrix, width, height, config.get("seat_margin", 35))
    regions.update(added)
    config["homography"] = {
        "section": section,
        "image_points": [[round(x / width, 4), round(y / height, 4)] for x, y in image_points],
        "plan_points": [[round(x, 1), round(y, 1)] for x, y in plan_points],
    }
    print(f"✓ {section}: {len(added)} masa otomatik yerleştirildi." + (f" Görüntüde görünmeyen: {', '.join(skipped)}" if skipped else "")
          + " Yanlış duranı X ile silip elle çizebilirsiniz; S ile kaydedin.")


def run_calibration(config, client):
    server_tables = client.get_tables()
    if not server_tables:
        sys.exit("Restoranda aktif masa yok. Önce Masa Yönetimi'nden masa ekleyin.")

    regions = {t["tableId"]: t for t in config.get("tables", [])}
    camera = FrameSource(source_of(config))
    detector = None
    points = []
    # Kayıtlı videoda görüntü akıp gider; bu yüzden video dosyasıyla kalibrasyon donmuş başlar
    state = {"click": None, "drag_start": None, "drag_now": None, "frozen": None}
    frozen_at_start = camera.is_file

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            state["drag_start"], state["drag_now"] = (x, y), (x, y)
        elif event == cv2.EVENT_MOUSEMOVE and state["drag_start"]:
            state["drag_now"] = (x, y)
        elif event == cv2.EVENT_LBUTTONUP and state["drag_start"]:
            (x0, y0), state["drag_start"], state["drag_now"] = state["drag_start"], None, None
            if abs(x - x0) > DRAG_MIN_PIXELS and abs(y - y0) > DRAG_MIN_PIXELS:
                state["click"] = ("rect", x0, y0, x, y)    # sürükleme: dikdörtgen alan
            else:
                state["click"] = ("add", x, y)            # tıklama: köşe ekle
        elif event == cv2.EVENT_RBUTTONDOWN:
            state["click"] = ("close", x, y)

    cv2.namedWindow(CALIBRATE_TITLE)
    cv2.setMouseCallback(CALIBRATE_TITLE, on_mouse)
    print(
        "\nKALİBRASYON\n"
        "  Boşluk : görüntüyü dondur / devam ettir (kalibrasyonu donmuş görüntüde yapmak kolaydır)\n"
        "  Sürükle : masa alanını dikdörtgen olarak çiz, açılan listeden masa numarasını yazıp Enter'a bas\n"
        "  Sol tık : eğik açıdaki masalar için köşe ekle; Sağ tık / Enter ile alanı kapat (en az 3 köşe)\n"
        "  F : tüm görüntü tek masa (kamera yalnızca bir masayı görüyorsa)\n"
        "  H : krokiyle otomatik eşle: kamerada zeminde 4 nokta, krokide aynı 4 nokta → alandaki tüm masalar yerleşir\n"
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
            if state["frozen"] is None or frozen_at_start:
                frame = camera.read()
                if frozen_at_start:
                    state["frozen"], frozen_at_start = frame, False
            else:
                frame = state["frozen"]
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
            if state["drag_start"]:
                cv2.rectangle(view, state["drag_start"], state["drag_now"], (255, 0, 255), 2)
            mode = "DONMUS" if state["frozen"] is not None else "CANLI"
            draw_text(view, f"[{mode}] Masa: {len(regions)} | Bosluk: dondur  Surukle: alan  H: kroki  F: tum goruntu  S: kaydet", (10, 24))
            cv2.imshow(CALIBRATE_TITLE, view)

            key = cv2.waitKey(30) & 0xFF
            click, state["click"] = state["click"], None
            if key == ord(" "):
                state["frozen"] = None if state["frozen"] is not None else frame
            if click and click[0] == "add":
                points.append((click[1], click[2]))
            if click and click[0] == "rect":
                _, x0, y0, x1, y1 = click
                x0, x1 = sorted((max(0, x0), min(width - 1, x1)))
                y0, y1 = sorted((max(0, y0), min(height - 1, y1)))
                assign(frame, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], width, height)
                points = []
            if key == ord("f"):
                assign(frame, [(0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)], width, height)
                points = []
            if key == ord("h"):
                calibrate_with_plan(client, config, regions, frame)
                cv2.setMouseCallback(CALIBRATE_TITLE, on_mouse)   # nokta seçimi fareyi devralmıştı
                points = []
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
    camera = FrameSource(source_of(config))
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
            frame = camera.read()
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
    parser.add_argument("--source", help="görüntü kaynağı: kamera numarası, video dosyası ya da http:// / rtsp:// adresi (ayardaki camera_source yerine)")
    parser.add_argument("--no-window", action="store_true", help="görüntü penceresi açma")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="ayar dosyası")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    if args.source:
        config["camera_source"] = args.source
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
