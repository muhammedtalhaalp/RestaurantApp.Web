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
import csv
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
        return self._boxes(result)[0]

    def detect_tracked(self, frame, tracker="bytetrack.yaml"):
        """Aynı tespit + kareler arası geçici iz kimlikleri (ByteTrack). Kareler sırayla verilmelidir.
        (tespitler, iz kimlikleri) döner; kimliği henüz kesinleşmemiş kutunun kimliği None'dır."""
        result = self.model.track(frame, conf=self.confidence, persist=True, tracker=tracker, verbose=False)[0]
        return self._boxes(result)

    def _boxes(self, result):
        detections, ids = [], []
        for box in result.boxes:
            name = self.names[int(box.cls[0])]
            if name == "person" or name == "dining table" or name in self.item_classes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
                detections.append((name, float(box.conf[0]), (x1, y1, x2, y2)))
                ids.append(int(box.id[0]) if box.id is not None else None)
        return detections, ids


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

    def contains_point(self, point):
        return cv2.pointPolygonTest(self._points, (float(point[0]), float(point[1])), False) >= 0

    def distance_to_center(self, point):
        cx, cy = self._points.mean(axis=0)
        return ((point[0] - cx) ** 2 + (point[1] - cy) ** 2) ** 0.5


def has_items(region, detections):
    return any(name not in ("person", "dining table") and region.contains_center(box) for name, _, box in detections)


def classify(region, detections, person_overlap):
    """Referans yöntem, tek karedeki ham durum: kişi kutusu masa alanıyla kesişiyorsa Dolu."""
    if any(name == "person" and region.overlap(box) >= person_overlap for name, _, box in detections):
        return STATUS_OCCUPIED
    if has_items(region, detections):
        return STATUS_CLEARING
    return STATUS_EMPTY


def classify_assigned(region, assigned, detections):
    """Takip yöntemi: masaya atanmış (ayağı masa bölgesinde, orada duran) bir kişi varsa Dolu."""
    if assigned.get(region.table_id):
        return STATUS_OCCUPIED
    if has_items(region, detections):
        return STATUS_CLEARING
    return STATUS_EMPTY


# ---------------- Kişi takibi ve ayak konumuyla masa ataması ----------------
# Referans yöntemde kişi kutusu masa alanına değdiği anda masa Dolu sayılır; yanından geçen garson
# ya da arkadaki masada oturan kişi de değebilir. Bu yöntemde her kişi kareler boyunca bir iz
# kimliğiyle takip edilir ve masaya yalnızca şu koşullarla atanır (TÜBİTAK önerisi 2.2):
#   - ayak noktası (kişi kutusunun alt kenarının ortası, zemine değdiği yer) masa bölgesinin içinde,
#   - en az dwell_seconds boyunca aynı masada kalmış,
#   - bu süre içinde yer değiştirmesi, kişinin boyuna oranla still_ratio'dan küçük (yürümüyor).
# Ayak birden fazla masa bölgesine düşerse merkezi en yakın masa seçilir.
# "poz" yönteminde ayrıca oturma bilgisi kullanılır (aşağıda): masa başında ayakta duran kişi atanmaz.

DEFAULT_TRACKING = {"tracker": "bytetrack.yaml", "dwell_seconds": 2.0, "still_ratio": 0.35, "forget_seconds": 5.0}


def tracking_settings(config):
    settings = dict(DEFAULT_TRACKING)
    settings.update(config.get("tracking", {}))
    return settings


def foot_point(box):
    x1, _, x2, y2 = box
    return ((x1 + x2) / 2.0, float(y2))


class PersonAssigner:
    """use_pose=True: masada kalma süresindeki güvenilir duruş gözlemlerinin en az standing_share kadarı
    "ayakta" ise kişi masaya atanmaz (masayı kuran / silen garson). Duruşu belirsiz (eklemleri masa
    tarafından örtülmüş) kişide poz karar vermez; ayak konumu ve masada kalma kuralı geçerlidir."""

    def __init__(self, dwell_seconds=2.0, still_ratio=0.35, forget_seconds=5.0, use_pose=False, standing_share=0.6, **_):
        self.dwell = dwell_seconds
        self.still_ratio = still_ratio
        self.forget = forget_seconds
        self.use_pose = use_pose
        self.standing_share = standing_share
        self.tracks = {}     # iz kimliği -> {table, since, history: deque[(t, x, y, boy, duruş)], last, assigned, posture}

    def _posture_of(self, history):
        """Penceredeki güvenilir duruş gözlemlerinin çoğunluğu (en az 2 gözlem); yoksa None."""
        known = [p[4] for p in history if p[4]]
        if len(known) < 2:
            return None
        standing = sum(1 for p in known if p == POSTURE_STANDING)
        return POSTURE_STANDING if standing / len(known) >= self.standing_share else POSTURE_SITTING

    def _table_of(self, point, regions):
        inside = [r for r in regions if r.contains_point(point)]
        return min(inside, key=lambda r: r.distance_to_center(point)).table_id if inside else None

    def _is_still(self, history):
        """Son dwell_seconds içinde ayak noktasının kapsadığı alanın köşegeni / kişinin boyu.
        Boya oranlamak uzaktaki (küçük görünen) ve yakındaki kişiyi aynı ölçüde değerlendirir."""
        xs = [p[1] for p in history]
        ys = [p[2] for p in history]
        heights = sorted(p[3] for p in history)
        height = max(heights[len(heights) // 2], 1.0)
        extent = ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2) ** 0.5
        return extent / height <= self.still_ratio

    def update(self, now, persons, regions, postures=None):
        """persons: [(iz kimliği, kutu)]; postures: {iz kimliği: "oturuyor"|"ayakta"|None} (poz yöntemi).
        {masa_id: [atanan iz kimlikleri]} döner."""
        assigned = {}
        postures = postures or {}
        for track_id, box in persons:
            point = foot_point(box)
            table = self._table_of(point, regions)
            track = self.tracks.get(track_id)
            if track is None or track["table"] != table:
                track = self.tracks[track_id] = {"table": table, "since": now, "history": deque()}
            track["last"] = now
            history = track["history"]
            history.append((now, point[0], point[1], float(box[3] - box[1]), postures.get(track_id)))
            while history and now - history[0][0] > self.dwell:
                history.popleft()
            track["posture"] = self._posture_of(history) if self.use_pose else None
            track["assigned"] = (table is not None and now - track["since"] >= self.dwell and self._is_still(history)
                                 and track["posture"] != POSTURE_STANDING)
            if track["assigned"]:
                assigned.setdefault(table, []).append(track_id)
        for track_id in [k for k, t in self.tracks.items() if now - t["last"] > self.forget]:
            del self.tracks[track_id]
        return assigned


def make_assigner(config, use_pose=False):
    return PersonAssigner(use_pose=use_pose, standing_share=pose_settings(config)["standing_share"], **tracking_settings(config))


# ---------------- Oturma bilgisi (poz) ----------------
# Hazır YOLOv8n-pose modeli her kişide 17 eklem noktası (COCO) bulur. Oturma iki ölçüyle anlaşılır:
#   - diz açısı (kalça–diz–ayak bileği): oturan kişide diz bükülüdür (küçük açı), ayaktakinde düzdür;
#   - uyluk oranı: kalça ile diz arasındaki dikey mesafe / gövde boyu (omuz ortası–kalça ortası).
#     Oturan kişide uyluk yataya yakındır, oran küçüktür.
# Eklem güveni keypoint_confidence'ın altındaysa o eklem kullanılmaz. Gerekli eklemler görünmüyorsa
# (masa / sandalye örtüyorsa) duruş None (belirsiz) olur ve tek başına karar oluşturmaz.
# Kalça konumu zemin konumu olarak kullanılmaz; zemin konumu her zaman ayak noktasıdır.
# Eşikler başlangıç değerleridir; tavan açısındaki doğrulama videosunda ayarlanacaktır.

POSTURE_SITTING = "oturuyor"
POSTURE_STANDING = "ayakta"
DEFAULT_POSE = {"model": "yolov8n-pose.pt", "keypoint_confidence": 0.5, "match_iou": 0.5, "standing_share": 0.6,
                "sit_knee_angle": 125, "stand_knee_angle": 155, "sit_thigh_ratio": 0.45, "stand_thigh_ratio": 0.7}
KP_SHOULDERS, KP_HIPS, KP_KNEES, KP_ANKLES = (5, 6), (11, 12), (13, 14), (15, 16)


def pose_settings(config):
    settings = dict(DEFAULT_POSE)
    settings.update(config.get("pose", {}))
    return settings


def _angle(a, b, c):
    """b noktasındaki açı (derece)."""
    v1, v2 = (a[0] - b[0], a[1] - b[1]), (c[0] - b[0], c[1] - b[1])
    n1, n2 = (v1[0] ** 2 + v1[1] ** 2) ** 0.5, (v2[0] ** 2 + v2[1] ** 2) ** 0.5
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return float(np.degrees(np.arccos(cos)))


def posture_measures(keypoints, min_conf):
    """keypoints: 17 x (x, y, güven). (en küçük diz açısı ya da None, uyluk oranı ya da None)."""
    seen = lambda i: keypoints[i][2] >= min_conf
    angles = []
    for hip, knee, ankle in zip(KP_HIPS, KP_KNEES, KP_ANKLES):
        if seen(hip) and seen(knee) and seen(ankle):
            angle = _angle(keypoints[hip], keypoints[knee], keypoints[ankle])
            if angle is not None:
                angles.append(angle)
    ratio = None
    if all(seen(i) for i in KP_SHOULDERS + KP_HIPS):
        shoulder_y = (keypoints[5][1] + keypoints[6][1]) / 2
        hip_y = (keypoints[11][1] + keypoints[12][1]) / 2
        torso = abs(hip_y - shoulder_y)
        thighs = [abs(keypoints[k][1] - keypoints[h][1]) for h, k in zip(KP_HIPS, KP_KNEES) if seen(h) and seen(k)]
        if torso > 1 and thighs:
            ratio = (sum(thighs) / len(thighs)) / torso
    return (min(angles) if angles else None), ratio


def posture_from_keypoints(keypoints, settings):
    """"oturuyor", "ayakta" ya da None (eklemler yetersiz / ölçüler kararsız)."""
    angle, ratio = posture_measures(keypoints, settings["keypoint_confidence"])
    if (angle is not None and angle < settings["sit_knee_angle"]) or (ratio is not None and ratio < settings["sit_thigh_ratio"]):
        return POSTURE_SITTING
    if angle is not None and angle > settings["stand_knee_angle"] and (ratio is None or ratio > settings["stand_thigh_ratio"]):
        return POSTURE_STANDING
    if angle is None and ratio is not None and ratio > settings["stand_thigh_ratio"] + 0.1:
        return POSTURE_STANDING     # ayak bileği görünmüyor: yalnız uyluk oranıyla, daha temkinli eşik
    return None


def box_iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


class PoseEstimator:
    """Poz modelini çalıştırır, bulduğu kişileri takipteki kişi kutularıyla (IoU) eşleştirir."""

    def __init__(self, config, confidence):
        from ultralytics import YOLO

        self.settings = pose_settings(config)
        self.model = YOLO(self.settings["model"])
        self.confidence = confidence

    def postures(self, frame, persons):
        """persons: [(iz kimliği, kutu)]. {iz kimliği: (duruş, eklemler)} döner; eşleşmeyen kişi yer almaz."""
        if not persons:
            return {}
        result = self.model.predict(frame, conf=self.confidence, verbose=False)[0]
        if result.keypoints is None or len(result.boxes) == 0:
            return {}
        boxes = result.boxes.xyxy.tolist()
        keypoints = result.keypoints.data.tolist()
        pairs = sorted(((box_iou(box, pb), tid, j) for tid, box in persons for j, pb in enumerate(boxes)), reverse=True)
        out, used = {}, set()
        for iou, tid, j in pairs:
            if iou < self.settings["match_iou"]:
                break
            if tid in out or j in used:
                continue
            used.add(j)
            out[tid] = (posture_from_keypoints(keypoints[j], self.settings), keypoints[j])
        return out


DEFAULT_HOLD = {STATUS_OCCUPIED: 3, STATUS_EMPTY: 8, STATUS_CLEARING: 8}


def hold_from(config):
    hold = dict(DEFAULT_HOLD)
    hold.update(config.get("hold_seconds", {}))
    return hold


class StatusTracker:
    """Zamansal doğrulama: ham durum, kendi doğrulama süresi (hold[durum]) boyunca sürerse kesinleşir.

    - gap_tolerance: aday durum, bu süreden kısa bir başka ham durumla kesilirse (tek kaçırılmış
      tespit, masanın önünden geçen garson) aday sıfırlanmaz. Kesinti daha uzun sürerse yeni durum,
      başladığı andan itibaren aday olur.
    - stale_after: bu süreden uzun gözlem gelmezse (kamera kesildi) aday silinir. Kesinleşmiş durum
      korunur; görüntü gelmeden yeni karar üretilmez.

    Bütün süreler 0 verilirse her kare kendi kararını verir: tek kare referans yöntemi.
    """

    def __init__(self, hold_seconds, gap_tolerance=0.0, stale_after=None):
        self.hold = hold_seconds
        self.gap = gap_tolerance
        self.stale_after = stale_after
        self.confirmed = None
        self.candidate = None      # kesinleşmeyi bekleyen durum
        self.since = None          # adayın başladığı an
        self.last_seen = None      # adayın en son görüldüğü an
        self.run_state = None      # en son ham durum ve kesintisiz başladığı an
        self.run_since = None
        self.last_update = None

    def update(self, raw, now):
        """Yeni ham gözlem. Kesinleşen durum değiştiyse True döner."""
        if self.last_update is not None and self.stale_after is not None and now - self.last_update > self.stale_after:
            self.candidate = None
            self.run_state = None
        self.last_update = now
        if raw != self.run_state:
            self.run_state, self.run_since = raw, now

        if raw == self.candidate:
            self.last_seen = now
        elif self.candidate is not None and now - self.last_seen <= self.gap:
            return False                                   # kısa kesinti: aday korunur
        elif raw == self.confirmed:
            self.candidate = None
            return False
        else:
            self.candidate, self.since, self.last_seen = raw, self.run_since, now

        if now - self.since >= self.hold.get(self.candidate, DEFAULT_HOLD[STATUS_EMPTY]):
            self.confirmed, self.candidate = self.candidate, None
            return True
        return False


def reference_tracker():
    """Referans yöntem: zamansal doğrulama yok, her karenin ham durumu doğrudan karardır."""
    return StatusTracker({STATUS_OCCUPIED: 0, STATUS_EMPTY: 0, STATUS_CLEARING: 0}, 0.0)


class DecisionLog:
    """Kesinleşen durum değişikliklerini zaman damgasıyla CSV'ye yazar (görüntü yazılmaz).

    Satırlar: zaman, video_sn (yalnız video değerlendirmesinde), yontem, masa_id, masa, onceki, yeni, olay.
    olay = "karar" (durum değişti), "kesinti" (görüntü alınamıyor), "devam" (görüntü geri geldi).
    """

    FIELDS = ["zaman", "video_sn", "yontem", "masa_id", "masa", "onceki", "yeni", "olay"]

    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        new_file = not self.path.exists() or self.path.stat().st_size == 0
        self.file = open(self.path, "a", encoding="utf-8-sig" if new_file else "utf-8", newline="")
        self.writer = csv.DictWriter(self.file, fieldnames=self.FIELDS)
        if new_file:
            self.writer.writeheader()

    def write(self, method, olay, table_id="", name="", before="", after="", video_seconds=None, when=None):
        self.writer.writerow({
            "zaman": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(when or time.time())),
            "video_sn": "" if video_seconds is None else f"{video_seconds:.2f}",
            "yontem": method, "masa_id": table_id, "masa": name,
            "onceki": before or "", "yeni": after or "", "olay": olay,
        })
        self.file.flush()

    def close(self):
        self.file.close()


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
        try:
            self._open()
        except RuntimeError as exc:
            sys.exit(f"{exc} Kamera başka bir programda açık ya da adres yanlış olabilir.")

    def _open(self):
        if isinstance(self.source, int) and sys.platform == "win32":
            self.capture = cv2.VideoCapture(self.source, cv2.CAP_DSHOW)
        else:
            self.capture = cv2.VideoCapture(self.source)
        if not self.capture.isOpened():
            raise RuntimeError(f"Görüntü kaynağı açılamadı: {self.source}.")
        if self.is_file:
            self.fps = self.capture.get(cv2.CAP_PROP_FPS) or 25.0
            self.frame_count = int(self.capture.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
            self.position = 0
            self.started = time.time()

    def read(self):
        if self.is_file:
            return self._read_file()
        ok, frame = self.capture.read()
        if not ok or frame is None:
            # Ağ akışı kopmuş ya da kamera çıkarılmış olabilir: bir kez yeniden bağlan
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


def polygon_iou(a, b, width, height):
    """İki oransal (0-1) çokgenin kesişim / birleşim oranı. Otomatik başlangıç bölgesi ile elle
    düzeltilmiş bölgenin örtüşmesini ölçer. Piksel maskesiyle hesaplanır; düzeltilmiş bölge
    dışbükey olmasa da doğru sonuç verir."""
    mask_a = np.zeros((height, width), dtype=np.uint8)
    mask_b = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask_a, [polygon_pixels(a, width, height)], 1)
    cv2.fillPoly(mask_b, [polygon_pixels(b, width, height)], 1)
    union = int(np.count_nonzero(mask_a | mask_b))
    return int(np.count_nonzero(mask_a & mask_b)) / union if union else 0.0


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
        polygon = [[round(float(x) / width, 4), round(float(y) / height, 4)] for x, y in polygon]
        regions[table["tableId"]] = {
            "tableId": table["tableId"],
            "name": table["tableNumber"],
            "polygon": polygon,
            "method": "kroki",
            "auto_polygon": [list(p) for p in polygon],   # IoU için otomatik başlangıç bölgesi saklanır
            "reviewed": False,
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
    """H tuşu: kamerada 4 zemin noktası + krokide aynı 4 nokta → alandaki tüm masalar otomatik yerleşir.
    Yerleştirilen masaların kimlikleri ve alan adı döner (vazgeçilirse ([], None))."""
    plan = client.get_plan()
    sections = plan_sections(plan)
    if not plan["tables"] or not sections:
        print("Krokide masa yok. Önce Kroki Yönetimi'nde krokiyi çizin.")
        return [], None
    index = 0 if len(sections) == 1 else choose_from_list(frame, "Kamera hangi alani goruyor?", [ascii_name(s) for s in sections])
    if index is None:
        return [], None
    section = sections[index]
    print(f"\n{section}: kamera görüntüsünde zemin üzerinde 4 nokta seçin (salon köşeleri ya da zemine konan işaretler),"
          " sonra açılan kroki penceresinde AYNI 4 noktayı AYNI sırayla seçin.")

    image_points = pick_points(CALIBRATE_TITLE, frame, 4, "Kamerada zeminde 4 nokta")
    if not image_points:
        return [], None
    plan_image, scale = render_plan(plan, section)
    plan_clicks = pick_points(PLAN_TITLE, plan_image, 4, "Krokide ayni 4 nokta, ayni sirayla")
    cv2.destroyWindow(PLAN_TITLE)
    if not plan_clicks:
        return [], None
    plan_points = [(x / scale, y / scale) for x, y in plan_clicks]

    try:
        matrix = find_homography(plan_points, image_points)
    except ValueError as exc:
        print(exc)
        return [], None
    height, width = frame.shape[:2]
    added, skipped = auto_regions(plan, section, matrix, width, height, config.get("seat_margin", 35))
    regions.update(added)
    config["homography"] = {
        "section": section,
        "image_points": [[round(x / width, 4), round(y / height, 4)] for x, y in image_points],
        "plan_points": [[round(x, 1), round(y, 1)] for x, y in plan_points],
    }
    for region in added.values():
        region["section"] = section
    hidden = f" Görüntüde görünmeyen: {', '.join(skipped)}." if skipped else ""
    if not added:
        print(f"{section}: hiçbir masa görüntüye düşmedi.{hidden} Noktaları salonun zemininde ve birbirinden uzak seçin"
              " (salon köşeleri ya da zemine konan işaretler); H ile tekrar deneyin.")
        return [], section
    print(f"✓ {section}: {len(added)} masa otomatik yerleştirildi.{hidden} Şimdi her masa tek tek gözden geçirilecek.")
    return list(added), section


# ---------------- Bölgeleri gözden geçirme ----------------
# Zemin dönüşümü masa yüzeyini ve sandalyeleri tam doğru yerleştiremez (masa üstü farklı bir düzlemdedir).
# Bu yüzden otomatik gelen her bölge kurulumda tek tek denetlenir, gerekirse köşeleri düzeltilir.
# Otomatik bölge ile son bölgenin örtüşmesi (IoU) ve geçen süre kaydedilir.

HANDLE_RADIUS = 10   # köşeyi yakalamak için fare bu kadar piksel yakın olmalı


def review_regions(frame, regions, ids, timing):
    """`ids` sırasıyla masaları gösterir. Köşe sürükle: köşeyi taşı, alanın içini sürükle: tüm alanı taşı.
    Enter/N: onayla ve sonraki, B: önceki, R: otomatik hâline dön, D: bu masayı sil, Esc: incelemeyi bırak."""
    ids = [i for i in ids if i in regions]
    if not ids:
        print("Gözden geçirilecek otomatik bölge yok.")
        return
    height, width = frame.shape[:2]
    state = {"drag": None, "last": None}
    started = time.monotonic()
    index = next((n for n, i in enumerate(ids) if not regions[i].get("reviewed")), 0)

    def current_px():
        return [[x * width, y * height] for x, y in regions[ids[index]]["polygon"]]

    def store(points_px):
        regions[ids[index]]["polygon"] = [[round(min(max(x, 0), width - 1) / width, 4),
                                           round(min(max(y, 0), height - 1) / height, 4)] for x, y in points_px]

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            pts = current_px()
            near = min(range(len(pts)), key=lambda k: (pts[k][0] - x) ** 2 + (pts[k][1] - y) ** 2)
            if (pts[near][0] - x) ** 2 + (pts[near][1] - y) ** 2 <= HANDLE_RADIUS ** 2:
                state["drag"] = ("corner", near)
            elif cv2.pointPolygonTest(np.array(pts, dtype=np.float32), (float(x), float(y)), False) >= 0:
                state["drag"] = ("move", None)
            state["last"] = (x, y)
        elif event == cv2.EVENT_MOUSEMOVE and state["drag"]:
            pts, (lx, ly) = current_px(), state["last"]
            if state["drag"][0] == "corner":
                pts[state["drag"][1]] = [x, y]
            else:
                pts = [[px + x - lx, py + y - ly] for px, py in pts]
            store(pts)
            state["last"] = (x, y)
        elif event == cv2.EVENT_LBUTTONUP:
            state["drag"] = None

    cv2.setMouseCallback(CALIBRATE_TITLE, on_mouse)
    try:
        while True:
            if not ids:
                print("Gözden geçirilecek masa kalmadı.")
                return
            index = min(index, len(ids) - 1)
            region = regions[ids[index]]
            view = frame.copy()
            for other_id in ids:
                if other_id != ids[index]:
                    other = regions[other_id]
                    color = (100, 180, 50) if other.get("reviewed") else (160, 160, 160)
                    cv2.polylines(view, [polygon_pixels(other["polygon"], width, height)], True, color, 1)
            if region.get("auto_polygon"):
                cv2.polylines(view, [polygon_pixels(region["auto_polygon"], width, height)], True, (230, 200, 60), 1)
            pts = polygon_pixels(region["polygon"], width, height)
            cv2.polylines(view, [pts], True, (255, 0, 255), 2)
            for p in pts:
                cv2.circle(view, tuple(int(v) for v in p), 6, (255, 0, 255), -1)
            iou = polygon_iou(region["auto_polygon"], region["polygon"], width, height) if region.get("auto_polygon") else None
            done = sum(1 for i in ids if regions[i].get("reviewed"))
            draw_text(view, f"Gozden gecirme {index + 1}/{len(ids)} (onayli {done}) | {ascii_name(region['name'])}"
                            + (f" | IoU {iou:.2f}" if iou is not None else ""), (10, 24))
            draw_text(view, "Kose/ic surukle: duzelt  Enter/N: onayla  B: onceki  R: otomatik hale don  D: sil  Esc: birak", (10, 48), scale=0.5)
            cv2.imshow(CALIBRATE_TITLE, view)

            key = cv2.waitKey(30) & 0xFF
            if key in (13, ord("n")):
                region["reviewed"] = True
                region["iou"] = round(iou, 3) if iou is not None else None
                print(f"✓ {region['name']} onaylandı" + (f" (IoU {iou:.2f})" if iou is not None else "") + ".")
                if all(regions[i].get("reviewed") for i in ids):
                    print("Bütün otomatik bölgeler gözden geçirildi.")
                    return
                index = (index + 1) % len(ids)
            elif key == ord("b"):
                index = (index - 1) % len(ids)
            elif key == ord("r") and region.get("auto_polygon"):
                region["polygon"] = [list(p) for p in region["auto_polygon"]]
                region["reviewed"] = False
            elif key == ord("d"):
                timing["removed"].append({"tableId": region["tableId"], "name": region["name"], "section": region.get("section", "")})
                print(f"{region['name']} silindi (bu kamerada görünmüyor/kullanılmayacak).")
                del regions[ids[index]]
                ids.pop(index)
                if ids and all(regions[i].get("reviewed") for i in ids):
                    print("Bütün otomatik bölgeler gözden geçirildi.")
                    return
            elif key == 27:
                left = sum(1 for i in ids if not regions[i].get("reviewed"))
                print(f"İnceleme bırakıldı; {left} masa gözden geçirilmedi. G ile kaldığınız yerden devam edebilirsiniz.")
                return
    finally:
        timing["review_seconds"] += time.monotonic() - started


def calibration_log_path(config):
    folder = Path(config.get("decision_log_dir", "logs"))
    if not folder.is_absolute():
        folder = Path(__file__).parent / folder
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "kalibrasyon.csv"


def write_calibration_log(config, regions, timing, source):
    """Kurulum kaydı: masa başına bir satır (yöntem, gözden geçirildi mi, IoU) ve oturumun süreleri.
    Görüntü kaydedilmez; yalnızca bölge ölçüleri ve süreler yazılır."""
    path = calibration_log_path(config)
    new_file = not path.exists()
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    total = time.monotonic() - timing["opened"]
    common = [now, str(source), f"{total:.0f}", f"{timing['plan_seconds']:.0f}", f"{timing['review_seconds']:.0f}"]
    with open(path, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        if new_file:
            writer.writerow(["zaman", "kaynak", "toplam_kurulum_sn", "kroki_esleme_sn", "gozden_gecirme_sn",
                             "alan", "masa_id", "masa", "yontem", "gozden_gecirildi", "iou_otomatik_son"])
        for region in regions.values():
            iou = region.get("iou")
            writer.writerow(common + [region.get("section", ""), region["tableId"], region["name"], region.get("method", "elle"),
                                      "evet" if region.get("reviewed", True) else "hayir", "" if iou is None else f"{iou:.3f}"])
        for removed in timing["removed"]:
            writer.writerow(common + [removed["section"], removed["tableId"], removed["name"], "kroki", "silindi", ""])
    return path, total


def calibration_summary(regions, timing, total):
    ious = [r["iou"] for r in regions.values() if r.get("iou") is not None]
    lines = [f"Kurulum süresi: toplam {total:.0f} sn (kroki eşleme {timing['plan_seconds']:.0f} sn, "
             f"gözden geçirme {timing['review_seconds']:.0f} sn)"]
    if ious:
        ious.sort()
        median = ious[len(ious) // 2] if len(ious) % 2 else (ious[len(ious) // 2 - 1] + ious[len(ious) // 2]) / 2
        lines.append(f"Otomatik bölge ile son bölge örtüşmesi (IoU), {len(ious)} masa: ortalama {sum(ious) / len(ious):.2f}, "
                     f"ortanca {median:.2f}, en düşük {ious[0]:.2f}")
    if timing["removed"]:
        lines.append(f"Görüntüde kullanılmayıp silinen otomatik bölge: {len(timing['removed'])}")
    return lines


def run_calibration(config, client):
    server_tables = client.get_tables()
    if not server_tables:
        sys.exit("Restoranda aktif masa yok. Önce Masa Yönetimi'nden masa ekleyin.")

    regions = {t["tableId"]: t for t in config.get("tables", [])}
    camera = FrameSource(source_of(config))
    detector = None
    points = []
    # Kurulum süresi (TÜBİTAK önerisi 2.2): pencere açılışından kayda kadar; kroki eşleme ve gözden geçirme ayrıca
    timing = {"opened": time.monotonic(), "plan_seconds": 0.0, "review_seconds": 0.0, "removed": []}
    save_warned = False
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
        "  H : krokiyle otomatik eşle: kamerada zeminde 4 nokta, krokide aynı 4 nokta → alandaki tüm masalar yerleşir,\n"
        "      ardından her masa tek tek gözden geçirilir (köşe sürükle: düzelt, Enter: onayla, D: sil)\n"
        "  G : otomatik gelen bölgeleri gözden geçirmeye devam et\n"
        "  A : görüntüdeki masaları otomatik bul ve sırayla eşleştir\n"
        "  Z : son köşeyi geri al     X : son eklenen masa alanını sil\n"
        "  S : kaydet ve çık          Q : kaydetmeden çık\n"
    )

    def assign(frame, polygon_px, width, height, method="elle"):
        preview = frame.copy()
        cv2.polylines(preview, [np.array(polygon_px, dtype=np.int32)], True, (255, 0, 255), 3)
        table = choose_table(preview, server_tables, set(regions))
        if table is None:
            return
        polygon = [[round(x / width, 4), round(y / height, 4)] for x, y in polygon_px]
        region = {"tableId": table["tableId"], "name": table["tableNumber"], "polygon": polygon,
                  "section": table.get("section") or "", "method": method}
        if method == "model":   # modelin bulduğu kutu da otomatik başlangıçtır; gözden geçirilir
            region.update({"auto_polygon": [list(p) for p in polygon], "reviewed": False})
        regions[table["tableId"]] = region
        print(f"✓ {table['tableNumber']} işaretlendi.")

    def unreviewed_ids():
        return [i for i, r in regions.items() if r.get("auto_polygon") and not r.get("reviewed")]

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
            pending = len(unreviewed_ids())
            draw_text(view, f"[{mode}] Masa: {len(regions)}" + (f" (incelenmedi: {pending})" if pending else "")
                            + " | Bosluk: dondur  Surukle: alan  H: kroki  G: gozden gecir  F: tum goruntu  S: kaydet", (10, 24))
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
                assign(frame, [(0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)], width, height, "tum_goruntu")
                points = []
            if key == ord("h"):
                plan_started = time.monotonic()
                added, _ = calibrate_with_plan(client, config, regions, frame)
                timing["plan_seconds"] += time.monotonic() - plan_started
                if added:
                    review_regions(frame, regions, added, timing)
                cv2.setMouseCallback(CALIBRATE_TITLE, on_mouse)   # nokta seçimi ve inceleme fareyi devralmıştı
                points = []
            if key == ord("g"):
                review_regions(frame, regions, [i for i, r in regions.items() if r.get("auto_polygon")], timing)
                cv2.setMouseCallback(CALIBRATE_TITLE, on_mouse)
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
                    assign(frame, [(x1, y1), (x2, y1), (x2, y2), (x1, y2)], width, height, "model")
            if key == ord("s"):
                pending = unreviewed_ids()
                if pending and not save_warned:
                    names = ", ".join(regions[i]["name"] for i in pending)
                    print(f"⚠ {len(pending)} otomatik bölge gözden geçirilmedi ({names}). G ile gözden geçirin "
                          "ya da yine de kaydetmek için S'ye tekrar basın.")
                    save_warned = True
                    continue
                config["tables"] = list(regions.values())
                save_config(CONFIG_PATH, config)
                log_path, total = write_calibration_log(config, regions, timing, source_of(config))
                print(f"{len(regions)} masa alanı kaydedildi: {CONFIG_PATH}")
                for line in calibration_summary(regions, timing, total):
                    print("  " + line)
                print(f"  Kurulum kaydı: {log_path}")
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


def evaluate_tracked(frame, regions, detector, assigners, now, config, pose=None):
    """Takipli tespit; aynı tespitlerden birden çok yöntemin ham durumunu üretir.

    assigners: {"takip": PersonAssigner, "poz": PersonAssigner(use_pose=True)} (biri ya da ikisi).
    pose: PoseEstimator; "poz" atayıcısı varsa gereklidir.
    Dönüş: (tespitler, iz kimlikleri, {"kesisim"|"takip"|"poz": {masa_id: ham}}, {iz: (duruş, eklemler)})."""
    height, width = frame.shape[:2]
    for region in regions:
        region.prepare(width, height)
    detections, ids = detector.detect_tracked(frame, tracking_settings(config)["tracker"])
    persons = [(tid, box) for (name, _, box), tid in zip(detections, ids) if name == "person" and tid is not None]
    postures = pose.postures(frame, persons) if pose is not None and "poz" in assigners else {}
    raws = {"kesisim": {r.table_id: classify(r, detections, config.get("person_overlap", 0.2)) for r in regions}}
    for name, assigner in assigners.items():
        assigned = assigner.update(now, persons, regions, {tid: p[0] for tid, p in postures.items()} if assigner.use_pose else None)
        raws[name] = {r.table_id: classify_assigned(r, assigned, detections) for r in regions}
    return detections, ids, raws, postures


POSTURE_MARKS = {POSTURE_SITTING: "O", POSTURE_STANDING: "A"}


def draw_tracks(frame, detections, ids, assigner):
    """Ayak noktaları: yeşil = masaya atanmış, gri = atanmamış (yürüyor / yeni geldi / ayakta).
    Poz yönteminde kimliğin yanında duruş: O = oturuyor, A = ayakta, ? = belirsiz."""
    for (name, _, box), tid in zip(detections, ids):
        if name != "person" or tid is None:
            continue
        x, y = (int(v) for v in foot_point(box))
        track = assigner.tracks.get(tid, {})
        color = (60, 200, 60) if track.get("assigned") else (170, 170, 170)
        label = f"#{tid}" + (f" {POSTURE_MARKS.get(track.get('posture'), '?')}" if assigner.use_pose else "")
        cv2.circle(frame, (x, y), 6, color, -1)
        cv2.putText(frame, label, (x + 8, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)


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


def decision_log_path(config):
    """Günlük karar kaydı dosyası; decision_log_dir boş verilirse kayıt tutulmaz."""
    folder = config.get("decision_log_dir", "logs")
    if not folder:
        return None
    folder = Path(folder)
    if not folder.is_absolute():
        folder = CONFIG_PATH.parent / folder
    return folder / f"kararlar-{time.strftime('%Y-%m-%d')}.csv"


def run_loop(config, client, show_window=True):
    regions = build_regions(config)
    names = {region.table_id: region.name for region in regions}
    print("Model yükleniyor...")
    detector = make_detector(config)
    camera = FrameSource(source_of(config))
    gap = config.get("gap_tolerance_seconds", 2)
    stale_after = config.get("stale_after_seconds", 5)
    trackers = {region.table_id: StatusTracker(hold_from(config), gap, stale_after) for region in regions}
    interval = config.get("check_interval_seconds", 0.5)
    heartbeat = config.get("heartbeat_seconds", 30)
    log_path = decision_log_path(config)
    log = DecisionLog(log_path) if log_path else None
    # person_assignment: "kesisim" (kutu–masa kesişimi), "takip" (kişi takibi + ayak konumu)
    # ya da "poz" (takip + oturma bilgisi)
    assignment = config.get("person_assignment", "kesisim")
    if assignment not in ("kesisim", "takip", "poz"):
        sys.exit(f"person_assignment 'kesisim', 'takip' ya da 'poz' olmalı ('{assignment}').")
    use_tracking = assignment != "kesisim"
    assigner = make_assigner(config, use_pose=assignment == "poz") if use_tracking else None
    pose = PoseEstimator(config, config.get("confidence", 0.35)) if assignment == "poz" else None
    method = f"{assignment}_zamansal" if use_tracking else "zamansal"
    method_text = {"kesisim": "kutu–masa kesişimi", "takip": "kişi takibi + ayak konumu", "poz": "takip + ayak konumu + oturma bilgisi"}
    last_sent = 0.0
    last_error = ""
    last_frame_at = time.time()
    outage = False      # görüntü alınamıyor: yeni karar üretilmez, sunucuya da gönderilmez

    print(f"{len(regions)} masa izleniyor ({method_text[assignment]})."
          + (f" Kararlar: {log_path}" if log else "")
          + " Çıkmak için pencerede Q'ya basın (ya da Ctrl+C).")
    try:
        while True:
            started = time.time()
            try:
                frame = camera.read()
            except RuntimeError as exc:
                if not outage and started - last_frame_at > stale_after:
                    outage = True
                    print(f"{time.strftime('%H:%M:%S')}  Görüntü alınamıyor ({exc}); son durumlar korunuyor, yeni karar üretilmiyor.")
                    if log:
                        log.write(method, "kesinti")
                if show_window:
                    blank = np.zeros((360, 640, 3), dtype=np.uint8)
                    draw_text(blank, "Goruntu yok - son durumlar guncel degil", (10, 30), (80, 80, 255))
                    cv2.imshow(WINDOW_TITLE, blank)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
                time.sleep(1)
                continue
            last_frame_at = started
            if outage:
                outage = False
                print(f"{time.strftime('%H:%M:%S')}  Görüntü geri geldi.")
                if log:
                    log.write(method, "devam")

            if use_tracking:
                detections, ids, raws, _ = evaluate_tracked(frame, regions, detector, {assignment: assigner}, started, config, pose)
                raw = raws[assignment]
            else:
                detections, raw = evaluate(frame, regions, detector, config)

            changed = []
            for tid, tracker in trackers.items():
                before = tracker.confirmed
                if tracker.update(raw[tid], started):
                    changed.append(tid)
                    print(f"{time.strftime('%H:%M:%S')}  {names[tid]}: {tracker.confirmed}")
                    if log:
                        log.write(method, "karar", tid, names[tid], before, tracker.confirmed, when=started)
            confirmed = {tid: t.confirmed for tid, t in trackers.items() if t.confirmed}

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
                if use_tracking:
                    draw_tracks(view, detections, ids, assigner)
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
        if log:
            log.close()


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
