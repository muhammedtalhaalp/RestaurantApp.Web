"""Salon videosundan masa kırpıntıları çıkarır ("Toplanacak" sınıflandırıcısının eğitim verisi).

Kalibrasyondaki her masa bölgesinin çevreleyen dikdörtgeni, videonun her --every saniyesinde
kesilip kaydedilir:

    kirpintilar/<video adı>/<masa>/<video adı>_<masa>_<saniye>.jpg

Kırpıntılar kişi görüntüsü içerebilir: klasör gitignore'dadır, bilgisayardan çıkmaz, hiçbir yere
gönderilmez. Etiketleme label_crops.py ile yapılır. Hangi videonun eğitim, hangisinin test için
kullanılacağı baştan belirlenmelidir; test videosundan kırpıntı çıkarılmaz.

Kullanım:
    python crop_tables.py videolar/video1.mp4
    python crop_tables.py videolar/video1.mp4 --every 3 --margin 0.1
"""

import argparse
import csv
import re
import sys
from pathlib import Path

import cv2

from table_camera import CONFIG_PATH, ascii_name, build_regions, load_config

HERE = Path(__file__).resolve().parent


def safe_name(text):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", ascii_name(text)).strip("_") or "masa"


def crop_box(points, width, height, margin):
    """Bölgeyi çevreleyen dikdörtgen, her yönde boyutunun `margin` katı kadar genişletilmiş."""
    x0, y0 = points.min(axis=0)
    x1, y1 = points.max(axis=0)
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    return (int(max(0, x0 - mx)), int(max(0, y0 - my)), int(min(width, x1 + mx)), int(min(height, y1 + my)))


def extract(video, config, out_root, every, margin, max_side):
    regions = build_regions(config)
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        sys.exit(f"Video açılamadı: {video}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    stem = safe_name(Path(video).stem)
    out_dir = out_root / stem
    out_dir.mkdir(parents=True, exist_ok=True)

    index_path = out_dir / "kirpintilar.csv"
    saved, frame_no, next_t = 0, 0, 0.0
    with open(index_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["dosya", "video", "masa_id", "masa", "video_sn"])
        while True:
            t = frame_no / fps
            if t + 1e-9 < next_t:
                if not capture.grab():
                    break
                frame_no += 1
                continue
            ok, frame = capture.read()
            if not ok:
                break
            height, width = frame.shape[:2]
            for region in regions:
                region.prepare(width, height)
                x0, y0, x1, y1 = crop_box(region.points, width, height, margin)
                if x1 - x0 < 8 or y1 - y0 < 8:
                    continue
                crop = frame[y0:y1, x0:x1]
                side = max(crop.shape[:2])
                if side > max_side:
                    crop = cv2.resize(crop, None, fx=max_side / side, fy=max_side / side, interpolation=cv2.INTER_AREA)
                table_dir = out_dir / safe_name(region.name)
                table_dir.mkdir(exist_ok=True)
                name = f"{stem}_{safe_name(region.name)}_{t:07.1f}.jpg"
                cv2.imwrite(str(table_dir / name), crop, [cv2.IMWRITE_JPEG_QUALITY, 92])
                writer.writerow([f"{safe_name(region.name)}/{name}", stem, region.table_id, region.name, f"{t:.1f}"])
                saved += 1
            frame_no += 1
            next_t += every
    capture.release()
    return out_dir, saved, len(regions)


def main():
    parser = argparse.ArgumentParser(description="Videodan masa kırpıntıları çıkarır (Toplanacak sınıflandırıcısı için).")
    parser.add_argument("video", help="kırpıntı çıkarılacak video (test videosu kullanılmaz)")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="masa alanlarının bulunduğu ayar dosyası")
    parser.add_argument("--out", default=str(HERE / "kirpintilar"), help="çıktı kök klasörü")
    parser.add_argument("--every", type=float, default=5.0, help="kaç saniyede bir kırpıntı (varsayılan 5)")
    parser.add_argument("--margin", type=float, default=0.1, help="bölge çevresine eklenecek pay (oran, varsayılan 0.1)")
    parser.add_argument("--max-side", type=int, default=320, help="kırpıntının en uzun kenarı (piksel, varsayılan 320)")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    out_dir, saved, tables = extract(args.video, config, Path(args.out), args.every, args.margin, args.max_side)
    print(f"{tables} masa, {saved} kırpıntı kaydedildi: {out_dir}")
    print(f"Etiketlemek için: python label_crops.py \"{out_dir}\"")


if __name__ == "__main__":
    main()
