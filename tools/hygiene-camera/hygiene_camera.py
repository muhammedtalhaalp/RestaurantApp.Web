"""LezzetPOS hijyen kamerası.

Mutfak kamerasından görüntü alır, Roboflow nesne tespit modeline sorar ve bonesiz / önlüksüz
personel görürse ihlal fotoğrafıyla birlikte LezzetPOS'a bildirir. LezzetPOS da uyarıyı
yalnızca bu restoranın mutfak ekranına gönderir.

Kullanım:
    python hygiene_camera.py              # normal mod (Roboflow modeli gerekir)
    python hygiene_camera.py --demo       # model olmadan: B / O tuşları sahte ihlal gönderir
    python hygiene_camera.py --test-once  # giriş yapıp tek bir test ihlali gönderir ve çıkar
    python hygiene_camera.py --verbose --confidence 25   # modelin gördüğü her şeyi düşük eşikle yazdırır

Ayarlar config.json dosyasından okunur (bkz. config.example.json ve README.md).
"""

import argparse
import base64
import json
import sys
import time
from collections import deque
from pathlib import Path

import cv2
import requests
import urllib3

CONFIG_PATH = Path(__file__).with_name("config.json")
WINDOW_TITLE = "LezzetPOS Hijyen Kamerasi (cikis: Q)"

# Gönderilen ihlal fotoğrafının en büyük genişliği (sunucu en fazla 2 MB kabul eder)
SNAPSHOT_MAX_WIDTH = 960
# Roboflow'a gönderilen karenin en büyük genişliği (model genelde 640 px ile eğitilir)
INFERENCE_MAX_WIDTH = 640

DEMO_KEYS = {
    ord("b"): "Bone takılmamış",
    ord("o"): "Önlük giyilmemiş",
}


def normalize_class_name(name):
    """'No Hairnet', 'no_hairnet' ve 'no-hairnet' aynı sınıf sayılsın."""
    return name.strip().lower().replace("_", "-").replace(" ", "-")


def load_config(path):
    if not path.exists():
        sys.exit(f"Ayar dosyası bulunamadı: {path}\n"
                 f"config.example.json dosyasını config.json adıyla kopyalayıp doldurun.")
    with path.open(encoding="utf-8") as f:
        config = json.load(f)
    config["violation_classes"] = {
        normalize_class_name(k): v for k, v in config.get("violation_classes", {}).items()
    }
    return config


def resize_to_width(frame, max_width):
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame, 1.0
    scale = max_width / width
    return cv2.resize(frame, (max_width, int(height * scale))), scale


def encode_jpeg(frame, quality=80):
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("Kamera karesi JPEG'e çevrilemedi.")
    return buffer.tobytes()


class LezzetPosClient:
    """LezzetPOS sunucusuna giriş yapar ve ihlal bildirir. Token süresi dolarsa yeniden giriş yapar."""

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

    def report_violation(self, violation_type, jpeg_bytes=None):
        if self.token is None:
            self.login()

        for attempt in range(2):
            files = {"image": ("ihlal.jpg", jpeg_bytes, "image/jpeg")} if jpeg_bytes else None
            response = self.session.post(
                f"{self.base_url}/AiVision/ReportHygieneViolation",
                headers={"Authorization": f"Bearer {self.token}"},
                data={"violationType": violation_type},
                files=files,
                timeout=15,
                allow_redirects=False,
            )

            # 403 = rol yetkisiz; 401 = token geçersiz/süresi dolmuş. (Eski sunucu sürümleri bunun yerine
            # Login / AccessDenied sayfasına 302 yönlendirmesi döner; o durum da aynı şekilde ele alınır.)
            location = response.headers.get("Location", "")
            if response.status_code == 403 or (response.status_code in (301, 302) and "AccessDenied" in location):
                raise RuntimeError("Bu hesabın ihlal bildirme yetkisi yok. Kamera için 'Mutfak' rolünde bir hesap kullanın.")
            if response.status_code in (401, 301, 302):
                if attempt == 0:
                    print("Oturum süresi dolmuş, yeniden giriş yapılıyor...")
                    self.login()
                    continue
                raise RuntimeError("Yeniden giriş yapıldı ama sunucu isteği yine reddetti.")

            response.raise_for_status()
            result = response.json()
            if not result.get("success"):
                raise RuntimeError(f"İhlal kaydedilemedi: {result.get('message')}")
            return result

        return None


class RoboflowDetector:
    """Roboflow barındırılan (hosted) nesne tespit API'sine kare gönderir."""

    def __init__(self, api_url, api_key, model_id, confidence=50, overlap=30):
        if not api_key or not model_id:
            sys.exit("Roboflow 'api_key' ve 'model_id' ayarları boş. Model olmadan denemek için --demo kullanın.")
        self.url = f"{api_url.rstrip('/')}/{model_id.strip('/')}"
        self.params = {"api_key": api_key, "confidence": confidence, "overlap": overlap}

    def detect(self, frame):
        """Kare üzerindeki tespitleri, karenin orijinal piksel ölçeğinde döndürür."""
        small, scale = resize_to_width(frame, INFERENCE_MAX_WIDTH)
        body = base64.b64encode(encode_jpeg(small, quality=85))
        response = requests.post(
            self.url,
            params=self.params,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        response.raise_for_status()

        predictions = []
        for p in response.json().get("predictions", []):
            predictions.append({
                "class": p["class"],
                "confidence": p["confidence"],
                "x": p["x"] / scale, "y": p["y"] / scale,
                "width": p["width"] / scale, "height": p["height"] / scale,
            })
        return predictions


class ViolationTracker:
    """Tek karelik yanlış tespitlerle alarm çalmasın diye ihlali birkaç kontrol boyunca izler.

    Bir ihlal türü son `window` kontrolün en az `required` tanesinde görüldüyse ve o tür için
    son bildirimin üzerinden `cooldown` saniye geçtiyse bildirim tetiklenir. Tetiklendiğinde, aynı
    penceredeki kontrollerin en az `include_min` tanesinde görülen diğer ihlaller de (bekleme
    süresinde değillerse) aynı bildirime eklenir. Böylece model önlüğü her karede yakalayamasa da
    "bonesiz ve önlüksüz" bir kişi tek uyarı olarak gider.
    """

    def __init__(self, window, required, cooldown_seconds, include_min=1):
        self.window = window
        self.required = required
        self.include_min = include_min
        self.cooldown = cooldown_seconds
        self.history = deque(maxlen=window)
        self.last_reported = {}

    def update(self, detected_types, now=None):
        now = time.time() if now is None else now
        self.history.append(set(detected_types))

        def cooled_down(violation_type):
            return now - self.last_reported.get(violation_type, float("-inf")) >= self.cooldown

        def seen_count(violation_type):
            return sum(1 for checks in self.history if violation_type in checks)

        current = set(detected_types)
        any_ready = any(cooled_down(t) and seen_count(t) >= self.required for t in current)
        if not any_ready:
            return []

        seen_in_window = set().union(*self.history)
        to_report = sorted(t for t in seen_in_window if cooled_down(t) and seen_count(t) >= self.include_min)
        for violation_type in to_report:
            self.last_reported[violation_type] = now
        return to_report


class ConfidenceFilter:
    """Sınıf bazında en düşük güven eşiği. Modelin bazı sınıfları (ör. önlük) daha düşük güvenle
    bulunur; o sınıflara ayrı eşik verilir, verilmeyenler varsayılan eşiği kullanır (0-100)."""

    def __init__(self, default_percent, per_class_percent=None):
        self.default = default_percent
        self.per_class = {normalize_class_name(k): v for k, v in (per_class_percent or {}).items()}

    def threshold(self, class_name):
        return self.per_class.get(normalize_class_name(class_name), self.default)

    def lowest(self):
        """Roboflow'a gönderilecek eşik: hiçbir sınıfın tespiti API tarafında elenmesin."""
        return min([self.default, *self.per_class.values()])

    def accepts(self, prediction):
        return prediction["confidence"] * 100 >= self.threshold(prediction["class"])


def draw_predictions(frame, predictions, violation_classes):
    for p in predictions:
        is_violation = normalize_class_name(p["class"]) in violation_classes
        color = (0, 0, 255) if is_violation else (0, 200, 0)
        x1, y1 = int(p["x"] - p["width"] / 2), int(p["y"] - p["height"] / 2)
        x2, y2 = int(p["x"] + p["width"] / 2), int(p["y"] + p["height"] / 2)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        label = f"{p['class']} {p['confidence']:.0%}"
        cv2.putText(frame, label, (x1, max(y1 - 8, 16)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)


def draw_status(frame, text, color=(255, 255, 255)):
    # OpenCV yazı tipi Türkçe karakterleri çizemez; durum satırları ASCII tutulur
    cv2.putText(frame, text, (10, frame.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
    cv2.putText(frame, text, (10, frame.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 1)


def send_violation(client, violation_type, frame):
    snapshot, _ = resize_to_width(frame, SNAPSHOT_MAX_WIDTH)
    try:
        client.report_violation(violation_type, encode_jpeg(snapshot))
        print(f"[{time.strftime('%H:%M:%S')}] İhlal bildirildi: {violation_type}")
        return True
    except Exception as ex:
        print(f"[{time.strftime('%H:%M:%S')}] İhlal bildirilemedi ({violation_type}): {ex}")
        return False


def open_camera(index):
    # Windows'ta DirectShow arka ucu kameranın daha hızlı açılmasını sağlar
    camera = cv2.VideoCapture(index, cv2.CAP_DSHOW) if sys.platform == "win32" else cv2.VideoCapture(index)
    if not camera.isOpened():
        sys.exit(f"Kamera açılamadı (index: {index}). config.json içindeki 'camera_index' değerini deneyin (0, 1, ...).")
    return camera


def read_frame(camera):
    ok, frame = camera.read()
    if not ok:
        raise RuntimeError("Kameradan görüntü okunamadı.")
    return frame


def run_test_once(config, client):
    camera = open_camera(config.get("camera_index", 0))
    try:
        frame = read_frame(camera)
    finally:
        camera.release()
    client.login()
    if send_violation(client, "TEST - Kamera bağlantı denemesi", frame):
        print("Test başarılı: mutfak ekranında uyarı görünmelidir.")
    else:
        sys.exit(1)


def run_loop(config, client, demo, verbose=False):
    detector = None
    if not demo:
        rf = config["roboflow"]
        confidence = ConfidenceFilter(rf.get("confidence", 50), rf.get("class_confidence"))
        detector = RoboflowDetector(rf.get("api_url", "https://detect.roboflow.com"), rf.get("api_key"),
                                    rf.get("model_id"), confidence.lowest(), rf.get("overlap", 30))
        class_info = ", ".join(f"{k} %{v}" for k, v in confidence.per_class.items())
        print(f"Model: {rf.get('model_id')} | güven eşiği: %{confidence.default}"
              + (f" (sınıf bazında: {class_info})" if class_info else ""))

    violation_classes = config["violation_classes"]
    window = config.get("detection_window", 5)
    tracker = ViolationTracker(window,
                               config.get("detections_required", 3),
                               config.get("cooldown_seconds", 60),
                               config.get("detections_to_include", 1))
    interval = config.get("check_interval_seconds", 1.0)
    # Bildirim fotoğrafı için penceredeki karelerden en çok ihlal içereni seçilir
    recent_snapshots = deque(maxlen=window)

    client.login()
    camera = open_camera(config.get("camera_index", 0))
    print("Kamera açıldı." + (" DEMO modu: B = bonesiz, O = önlüksüz ihlali gönderir." if demo else ""))

    predictions, last_check, status = [], 0.0, "Basliyor..."
    try:
        while True:
            frame = read_frame(camera)
            now = time.time()

            if detector and now - last_check >= interval:
                last_check = now
                try:
                    raw_predictions = detector.detect(frame)
                    predictions = [p for p in raw_predictions if confidence.accepts(p)]
                    if verbose:
                        seen = ", ".join(
                            f"{p['class']} %{p['confidence'] * 100:.0f}" + ("" if confidence.accepts(p) else " (eşik altı)")
                            for p in raw_predictions) or "hiçbir şey"
                        print(f"[{time.strftime('%H:%M:%S')}] Model gördü: {seen}")
                    detected_types = {violation_classes[normalize_class_name(p["class"])]
                                      for p in predictions
                                      if normalize_class_name(p["class"]) in violation_classes}
                    annotated = frame.copy()
                    draw_predictions(annotated, predictions, violation_classes)
                    recent_snapshots.append((len(detected_types), annotated))

                    to_report = tracker.update(detected_types, now)
                    if to_report:
                        # Penceredeki ihlaller tek bildirim ve tek kayıt olarak gider
                        best_snapshot = max(reversed(recent_snapshots), key=lambda s: s[0])[1]
                        send_violation(client, ", ".join(to_report), best_snapshot)
                    status = f"{len(predictions)} tespit, {len(detected_types)} ihlal turu"
                except requests.RequestException as ex:
                    status = "Roboflow baglanti hatasi"
                    print(f"Roboflow isteği başarısız: {ex}")

            display = frame.copy()
            draw_predictions(display, predictions, violation_classes)
            draw_status(display, "DEMO: B=bonesiz O=onluksuz" if demo else status)
            cv2.imshow(WINDOW_TITLE, display)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if demo and key in DEMO_KEYS:
                send_violation(client, DEMO_KEYS[key], frame)
    finally:
        camera.release()
        cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description="LezzetPOS hijyen kamerası")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH, help="Ayar dosyası (varsayılan: config.json)")
    parser.add_argument("--demo", action="store_true", help="Roboflow olmadan çalış; B / O tuşları sahte ihlal gönderir")
    parser.add_argument("--test-once", action="store_true", help="Giriş yapıp tek bir test ihlali gönder ve çık")
    parser.add_argument("--verbose", action="store_true", help="Modelin her kontrolde gördüğü tüm sınıfları ve güvenlerini yaz")
    parser.add_argument("--confidence", type=int, help="config.json'daki güven eşiğini (0-100) bu çalıştırma için geçersiz kıl")
    args = parser.parse_args()

    config = load_config(args.config)
    if args.confidence is not None:
        config["roboflow"]["confidence"] = args.confidence
    verify_ssl = config.get("verify_ssl", True)
    if not verify_ssl:
        # IIS Express'in geliştirme sertifikası kendinden imzalıdır
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    client = LezzetPosClient(config["server_url"], config["username"], config["password"], verify_ssl)

    if args.test_once:
        run_test_once(config, client)
    else:
        run_loop(config, client, args.demo, args.verbose)


if __name__ == "__main__":
    main()
