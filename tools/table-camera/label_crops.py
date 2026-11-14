"""Masa kırpıntılarını tek tuşla etiketler ("Toplanacak" sınıflandırıcısının eğitim verisi).

crop_tables.py'nin çıkardığı kırpıntılar sırayla gösterilir:

    1   temiz            masa üstünde servis gereci yok (Boş masa)
    2   servis_gereci    tabak, bardak, çatal, artık vb. var (Toplanacak masa)
    0   atla             karar verilemiyor (kişi masayı örtüyor, görüntü bulanık...)
    ←  / Z   önceki kırpıntı (etiketi değiştirmek için)
    →        sonraki (etiketlemeden geç)
    Q / Esc  kaydet ve çık

Masada oturan kişi olsa bile masa üstü görünüyorsa üstündekine göre etiketlenir; masa üstü
görünmüyorsa 0. Etiketler klasördeki etiketler.csv'ye her tuşta yazılır; yeniden açınca ilk
etiketlenmemiş kırpıntıdan devam eder. Görüntüler hiçbir yere gönderilmez.

Kullanım:
    python label_crops.py kirpintilar/video1
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2

from table_camera import ascii_name, draw_text

LABELS = {ord("1"): "temiz", ord("2"): "servis_gereci", ord("0"): "atla"}
KEY_LEFT, KEY_RIGHT = (2424832, 65361), (2555904, 65363)
WINDOW = "LezzetPOS Kirpinti Etiketleme"
LABEL_FILE = "etiketler.csv"
DISPLAY_HEIGHT = 480


def load_labels(path):
    if not path.exists():
        return {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {row["dosya"]: row["etiket"] for row in csv.DictReader(f)}


def save_labels(path, labels):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["dosya", "etiket"])
        for name in sorted(labels):
            writer.writerow([name, labels[name]])
    tmp.replace(path)


def counts(labels):
    out = {"temiz": 0, "servis_gereci": 0, "atla": 0}
    for value in labels.values():
        out[value] = out.get(value, 0) + 1
    return out


def main():
    parser = argparse.ArgumentParser(description="Masa kırpıntılarını etiketler (1 temiz, 2 servis gereci, 0 atla).")
    parser.add_argument("folder", help="crop_tables.py çıktı klasörü (ör. kirpintilar/video1)")
    args = parser.parse_args()

    root = Path(args.folder)
    images = sorted(p.relative_to(root).as_posix() for p in root.rglob("*.jpg"))
    if not images:
        sys.exit(f"Kırpıntı bulunamadı: {root}")
    label_path = root / LABEL_FILE
    labels = load_labels(label_path)
    index = next((i for i, name in enumerate(images) if name not in labels), len(images) - 1)
    print(__doc__.split("Kullanım:")[0])
    print(f"{len(images)} kırpıntı, {len(labels)} tanesi etiketli. Etiketler: {label_path}")

    try:
        while True:
            name = images[index]
            image = cv2.imread(str(root / name))
            if image is None:
                index = min(index + 1, len(images) - 1)
                continue
            scale = DISPLAY_HEIGHT / image.shape[0]
            view = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
            if view.shape[1] < 640:      # metin sığsın diye sağa boşluk
                view = cv2.copyMakeBorder(view, 0, 0, 0, 640 - view.shape[1], cv2.BORDER_CONSTANT, value=(40, 30, 45))
            current = labels.get(name, "-")
            c = counts(labels)
            draw_text(view, f"{index + 1}/{len(images)}  {ascii_name(name)}", (10, 24), scale=0.5)
            draw_text(view, f"Etiket: {current}   (temiz {c['temiz']}, servis gereci {c['servis_gereci']}, atla {c['atla']})", (10, 50), scale=0.5)
            draw_text(view, "1: temiz  2: servis gereci  0: atla  <-/Z: onceki  ->: sonraki  Q: cik", (10, view.shape[0] - 14), scale=0.5)
            cv2.imshow(WINDOW, view)

            key = cv2.waitKeyEx(0)
            low = key & 0xFF if 0 <= key < 256 else None
            if low in LABELS:
                labels[name] = LABELS[low]
                save_labels(label_path, labels)
                if index == len(images) - 1:
                    print("Son kırpıntıya gelindi.")
                index = min(index + 1, len(images) - 1)
            elif key in KEY_LEFT or low == ord("z"):
                index = max(index - 1, 0)
            elif key in KEY_RIGHT:
                index = min(index + 1, len(images) - 1)
            elif low in (ord("q"), 27):
                break
    finally:
        save_labels(label_path, labels)
        cv2.destroyAllWindows()
        c = counts(labels)
        print(f"{len(labels)}/{len(images)} kırpıntı etiketli (temiz {c['temiz']}, servis gereci {c['servis_gereci']}, atla {c['atla']}).")


if __name__ == "__main__":
    main()
