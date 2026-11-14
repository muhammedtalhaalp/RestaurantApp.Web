"""record_frames.py ile kaydedilen kareler için bone / önlük kutularını önerir ve onaylatır.

Kutular elle sıfırdan çizilmez: hazır YOLOv8n-pose modeli her kişide eklemleri bulur,
    baş kutusu   = yüz noktaları (burun, gözler, kulaklar) ve omuz genişliğinden, saçı da kapsayacak biçimde
    gövde kutusu = omuzlardan kalçanın / dizin altına (görünüyorsa), omuz genişliğinde
olarak önerilir. Sınıf, kayıttaki duruma göre verilir: bone var/yok → bone / bonesiz,
önlük var/yok → onluk / onluksuz. Kişi yalnızca kontrol edip onaylar.

Tuşlar (pencerede):
    Enter / N   kutular doğru: kaydet, sonraki kare
    1 + sürükle baş kutusunu yeniden çiz      2 + sürükle   gövde kutusunu yeniden çiz
    X           seçili kişinin baş kutusunu sil (baş görünmüyorsa)     C   gövde kutusunu sil
    Tab         birden çok kişi varsa sonraki kişiyi seç
    D           kareyi kullanma (bulanık, kişi yok, durum yanlış girilmiş)
    ← / Z       önceki kare         Q / Esc   çık (kaldığı yerden devam edilir)

Etiketler YOLO biçiminde <oturum>/labels/ altına yazılır (sınıflar: 0 bone, 1 bonesiz, 2 onluk,
3 onluksuz); karar durumu <oturum>/etiket_durumu.csv dosyasındadır. Görüntü hiçbir yere gönderilmez.

Kullanım:
    python label_frames.py ../kendi-veri/20261114-190500
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np

CLASSES = ["bone", "bonesiz", "onluk", "onluksuz"]
CLASS_COLORS = {0: (60, 200, 60), 1: (60, 60, 230), 2: (230, 160, 40), 3: (40, 140, 255)}
KEY_LEFT = (2424832, 65361)
WINDOW = "Hijyen Kutu Onaylama"
KP_CONF = 0.5
FACE, SHOULDERS, HIPS, KNEES = (0, 1, 2, 3, 4), (5, 6), (11, 12), (13, 14)
MAX_WIDTH = 1100


def draw_text(frame, text, origin, color=(255, 255, 255), scale=0.55):
    x, y = origin
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    cv2.rectangle(frame, (x - 3, y - th - 5), (x + tw + 3, y + 5), (30, 20, 35), -1)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def clamp_box(box, width, height):
    x0, y0, x1, y1 = box
    x0, x1 = sorted((min(max(x0, 0), width - 1), min(max(x1, 0), width - 1)))
    y0, y1 = sorted((min(max(y0, 0), height - 1), min(max(y1, 0), height - 1)))
    return (x0, y0, x1, y1) if x1 - x0 >= 6 and y1 - y0 >= 6 else None


def propose(person_box, keypoints, width, height):
    """(baş kutusu ya da None, gövde kutusu ya da None) — piksel (x0, y0, x1, y1)."""
    px0, py0, px1, py1 = person_box
    seen = lambda i: keypoints[i][2] >= KP_CONF
    pt = lambda i: keypoints[i][:2]
    shoulder_w = abs(pt(5)[0] - pt(6)[0]) if all(seen(i) for i in SHOULDERS) else (px1 - px0) * 0.6

    head = None
    face = [pt(i) for i in FACE if seen(i)]
    if face:
        xs, ys = [p[0] for p in face], [p[1] for p in face]
        side = max((max(xs) - min(xs)) * 1.9, shoulder_w * 0.55, 24)
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        # Bone saçı örter: kutu yüz noktalarının üstüne doğru uzatılır
        head = clamp_box((cx - side / 2, cy - side * 0.75, cx + side / 2, cy + side * 0.45), width, height)

    body = None
    if all(seen(i) for i in SHOULDERS):
        top = min(pt(5)[1], pt(6)[1])
        left, right = min(pt(5)[0], pt(6)[0]), max(pt(5)[0], pt(6)[0])
        pad = shoulder_w * 0.15
        knees = [pt(i)[1] for i in KNEES if seen(i)]
        hips = [pt(i)[1] for i in HIPS if seen(i)]
        if knees:
            bottom = max(knees)
        elif hips:
            bottom = max(hips) + (max(hips) - top) * 0.6     # önlük kalçanın altına iner
        else:
            bottom = py1                                     # yakın çekim: görüntünün / kişinin altına kadar
        body = clamp_box((max(left - pad, px0), top, min(right + pad, px1), min(bottom, py1)), width, height)
    return head, body


def load_status(path):
    if not path.exists():
        return {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {row["dosya"]: row["durum"] for row in csv.DictReader(f)}


def save_status(path, status):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["dosya", "durum"])
        for name in sorted(status):
            writer.writerow([name, status[name]])


def write_yolo(path, people, width, height):
    lines = []
    for person in people:
        for key in ("head", "body"):
            box, cls = person[key], person[key + "_class"]
            if box is None:
                continue
            x0, y0, x1, y1 = box
            lines.append(f"{cls} {(x0 + x1) / 2 / width:.6f} {(y0 + y1) / 2 / height:.6f} "
                         f"{(x1 - x0) / width:.6f} {(y1 - y0) / height:.6f}")
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def read_yolo(path, width, height):
    """Daha önce kaydedilmiş etiketleri kişi listesine geri çevirir (önceki kareye dönüldüğünde)."""
    heads, bodies = [], []
    for line in path.read_text(encoding="utf-8").split("\n"):
        if not line.strip():
            continue
        c, x, y, w, h = line.split()[:5]
        c, x, y, w, h = int(c), float(x) * width, float(y) * height, float(w) * width, float(h) * height
        box = (x - w / 2, y - h / 2, x + w / 2, y + h / 2)
        (heads if c in (0, 1) else bodies).append((box, c))
    count = max(len(heads), len(bodies))
    return [{"head": heads[i][0] if i < len(heads) else None, "head_class": heads[i][1] if i < len(heads) else 1,
             "body": bodies[i][0] if i < len(bodies) else None, "body_class": bodies[i][1] if i < len(bodies) else 3}
            for i in range(count)]


def main():
    parser = argparse.ArgumentParser(description="Kaydedilen karelerde bone/önlük kutularını önerir ve onaylatır.")
    parser.add_argument("session", help="record_frames.py oturum klasörü (kendi-veri/<tarih-saat>)")
    parser.add_argument("--pose-model", default="yolov8n-pose.pt", help="poz modeli (ilk kullanımda iner)")
    args = parser.parse_args()

    folder = Path(args.session)
    index_path = folder / "kareler.csv"
    if not index_path.exists():
        sys.exit(f"Oturum bulunamadı (kareler.csv yok): {folder}")
    with open(index_path, encoding="utf-8-sig", newline="") as f:
        frames = [row for row in csv.DictReader(f) if (folder / "images" / row["dosya"]).exists()]
    if not frames:
        sys.exit("Oturumda kare yok.")
    labels_dir = folder / "labels"
    labels_dir.mkdir(exist_ok=True)
    status_path = folder / "etiket_durumu.csv"
    status = load_status(status_path)

    from ultralytics import YOLO
    print("Poz modeli yükleniyor...")
    model = YOLO(args.pose_model)
    print(__doc__.split("Tuşlar (pencerede):")[1].split("Etiketler YOLO")[0])

    index = next((i for i, row in enumerate(frames) if row["dosya"] not in status), len(frames) - 1)
    mouse = {"mode": None, "start": None, "now": None, "done": None}
    scale_holder = {"s": 1.0}

    def on_mouse(event, x, y, flags, param):
        s = scale_holder["s"]
        if mouse["mode"] is None:
            return
        if event == cv2.EVENT_LBUTTONDOWN:
            mouse["start"], mouse["now"] = (x / s, y / s), (x / s, y / s)
        elif event == cv2.EVENT_MOUSEMOVE and mouse["start"]:
            mouse["now"] = (x / s, y / s)
        elif event == cv2.EVENT_LBUTTONUP and mouse["start"]:
            mouse["done"] = (*mouse["start"], x / s, y / s)
            mouse["start"] = mouse["now"] = None

    cv2.namedWindow(WINDOW)
    cv2.setMouseCallback(WINDOW, on_mouse)
    cache = {}

    def people_for(i, image):
        name = frames[i]["dosya"]
        if name in cache:
            return cache[name]
        height, width = image.shape[:2]
        label_path = labels_dir / (Path(name).stem + ".txt")
        if status.get(name) == "kabul" and label_path.exists():
            people = read_yolo(label_path, width, height)
        else:
            bone = frames[i]["bone"] == "var"
            onluk = frames[i]["onluk"] == "var"
            result = model.predict(image, conf=0.35, verbose=False)[0]
            people = []
            if result.keypoints is not None:
                for box, kps in zip(result.boxes.xyxy.tolist(), result.keypoints.data.tolist()):
                    head, body = propose(box, kps, width, height)
                    people.append({"head": head, "head_class": 0 if bone else 1,
                                   "body": body, "body_class": 2 if onluk else 3})
            people.sort(key=lambda p: -((p["body"] or p["head"] or (0, 0, 0, 0))[2] - (p["body"] or p["head"] or (0, 0, 0, 0))[0]))
        cache[name] = people
        return people

    selected = 0
    try:
        while True:
            row = frames[index]
            name = row["dosya"]
            image = cv2.imread(str(folder / "images" / name))
            height, width = image.shape[:2]
            people = people_for(index, image)
            selected = min(selected, max(len(people) - 1, 0))

            if mouse["done"] and people:
                x0, y0, x1, y1 = mouse["done"]
                key_name = "head" if mouse["mode"] == "head" else "body"
                people[selected][key_name] = clamp_box((x0, y0, x1, y1), width, height)
                mouse["mode"] = mouse["done"] = None
            elif mouse["done"]:
                mouse["mode"] = mouse["done"] = None

            view = image.copy()
            for i, person in enumerate(people):
                for key_name in ("head", "body"):
                    box = person[key_name]
                    if box is None:
                        continue
                    cls = person[key_name + "_class"]
                    x0, y0, x1, y1 = (int(v) for v in box)
                    cv2.rectangle(view, (x0, y0), (x1, y1), CLASS_COLORS[cls], 3 if i == selected else 1)
                    draw_text(view, CLASSES[cls], (x0 + 4, y0 + 22), CLASS_COLORS[cls])
            if mouse["start"] and mouse["now"]:
                p0 = tuple(int(v) for v in mouse["start"])
                p1 = tuple(int(v) for v in mouse["now"])
                cv2.rectangle(view, p0, p1, (255, 0, 255), 2)
            scale = min(1.0, MAX_WIDTH / width)
            scale_holder["s"] = scale
            if scale < 1.0:
                view = cv2.resize(view, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            done = sum(1 for r in frames if r["dosya"] in status)
            draw_text(view, f"{index + 1}/{len(frames)} (karar verilen {done})  durum: {status.get(name, '-')}  "
                            f"| kayit: bone {row['bone']}, onluk {row['onluk']}" + (" | KISI YOK" if not people else ""), (10, 26))
            hint = {"head": "Bas kutusunu surukleyerek ciz", "body": "Govde kutusunu surukleyerek ciz"}.get(mouse["mode"])
            draw_text(view, hint or "Enter: onayla  1/2+surukle: bas/govde ciz  X/C: bas/govde sil  Tab: kisi  D: kullanma  <-/Z: geri  Q: cik",
                      (10, view.shape[0] - 14), (120, 230, 255) if hint else (255, 255, 255), 0.5)
            cv2.imshow(WINDOW, view)

            key = cv2.waitKeyEx(30)
            if key == -1:
                continue
            low = key & 0xFF if 0 <= key < 256 else None
            if low in (13, ord("n")):
                if not people or all(p["head"] is None and p["body"] is None for p in people):
                    print(f"{name}: kutu yok; kullanılmayacaksa D'ye basın.")
                    continue
                write_yolo(labels_dir / (Path(name).stem + ".txt"), people, width, height)
                status[name] = "kabul"
                save_status(status_path, status)
                if index == len(frames) - 1:
                    print("Son kareye gelindi.")
                index, selected = min(index + 1, len(frames) - 1), 0
            elif low == ord("d"):
                status[name] = "red"
                (labels_dir / (Path(name).stem + ".txt")).unlink(missing_ok=True)
                save_status(status_path, status)
                index, selected = min(index + 1, len(frames) - 1), 0
            elif low == ord("1"):
                mouse["mode"] = "head"
            elif low == ord("2"):
                mouse["mode"] = "body"
            elif low == ord("x") and people:
                people[selected]["head"] = None
            elif low == ord("c") and people:
                people[selected]["body"] = None
            elif low == 9 and people:
                selected = (selected + 1) % len(people)
            elif key in KEY_LEFT or low == ord("z"):
                index, selected = max(index - 1, 0), 0
            elif low in (ord("q"), 27):
                break
    finally:
        save_status(status_path, status)
        cv2.destroyAllWindows()
        accepted = sum(1 for v in status.values() if v == "kabul")
        rejected = sum(1 for v in status.values() if v == "red")
        print(f"{len(frames)} karenin {accepted} tanesi onaylandı, {rejected} tanesi kullanılmayacak.")


if __name__ == "__main__":
    main()
