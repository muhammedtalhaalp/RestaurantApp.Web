"""Hijyen modelinin ek eğitimi için kendi kameramızdan kare toplar.

Açık veri setleri çoğunlukla mutfak tavan kamerası ve aşçı kıyafeti içeriyor; dizüstü kamerasıyla
yakından ve gündelik kıyafetle (ör. siyah atlet) model önlüğü yanlış buluyor. Bu araçla kendi
kamera açımızdan, önlüklü ve önlüksüz, boneli ve bonesiz, açık ve koyu kıyafetli kareler toplanır.

Her çalıştırma bir **oturumdur**: kendi-veri/<tarih-saat>/ klasörüne kareler ve her karenin
o anki durumu (bone var/yok, önlük var/yok) yazılır. Kutular label_frames.py ile çizilir.

Tuşlar (pencerede):
    Boşluk   kaydı başlat / duraklat (duraklatılmışken kare kaydedilmez)
    O        önlük var / yok           B   bone var / yok
    Q / Esc  çık

İpuçları: Her durumda (ör. önlüklü, önlüksüz) 1-2 dakika kaydet; bu sırada dön, uzaklaş, yaklaş,
kollarını kaldır, oturup kalk. Durum değiştirirken (önlüğü takarken) kaydı duraklat. Kıyafet,
ışık ya da yer değişince yeni oturum aç ve --not ile yaz (ör. --not "koyu tişört, akşam").

Görüntüler yalnızca bu bilgisayarda kalır (kendi-veri/ gitignore'dadır); hiçbir yere yüklenmez.

Kullanım:
    python record_frames.py --not "koyu tişört"
    python record_frames.py --camera 1 --every 0.5 --onluk var
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
OWN_DATA = HERE.parent / "kendi-veri"
WINDOW = "Hijyen Kare Kaydi"


def draw_text(frame, text, origin, color=(255, 255, 255), scale=0.6):
    x, y = origin
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    cv2.rectangle(frame, (x - 3, y - th - 5), (x + tw + 3, y + 5), (30, 20, 35), -1)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def open_source(source):
    if isinstance(source, str) and source.isdigit():
        source = int(source)
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        sys.exit(f"Kamera / kaynak açılamadı: {source}. Başka bir program kamerayı kullanıyor olabilir; --camera 1 dene.")
    return capture


def main():
    parser = argparse.ArgumentParser(description="Hijyen modeli için kendi kameramızdan kare kaydeder.")
    parser.add_argument("--camera", default="0", help="kamera numarası ya da video dosyası (varsayılan 0)")
    parser.add_argument("--every", type=float, default=1.0, help="kaç saniyede bir kare (varsayılan 1)")
    parser.add_argument("--not", dest="note", default="", help="oturum notu: kıyafet, ışık, yer (ör. 'koyu tişört, akşam')")
    parser.add_argument("--bone", choices=["var", "yok"], default="yok", help="başlangıçta bone (varsayılan yok)")
    parser.add_argument("--onluk", choices=["var", "yok"], default="yok", help="başlangıçta önlük (varsayılan yok)")
    parser.add_argument("--out", default=str(OWN_DATA), help="kök klasör (varsayılan kendi-veri/)")
    args = parser.parse_args()

    session = time.strftime("%Y%m%d-%H%M%S")
    folder = Path(args.out) / session
    (folder / "images").mkdir(parents=True, exist_ok=True)
    capture = open_source(args.camera)
    state = {"bone": args.bone == "var", "onluk": args.onluk == "var"}
    recording, last_saved, saved = False, 0.0, 0

    meta = {"oturum": session, "not": args.note, "kaynak": args.camera, "aralik_sn": args.every,
            "baslangic": time.strftime("%Y-%m-%d %H:%M:%S")}
    (folder / "oturum.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    index_file = open(folder / "kareler.csv", "w", encoding="utf-8-sig", newline="")
    writer = csv.writer(index_file)
    writer.writerow(["dosya", "bone", "onluk", "zaman"])
    print(__doc__.split("Tuşlar (pencerede):")[1].split("Görüntüler yalnızca")[0])
    print(f"Oturum klasörü: {folder}")

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                print("Kameradan görüntü alınamadı.")
                break
            now = time.time()
            if recording and now - last_saved >= args.every:
                name = f"{session}_{saved:05d}.jpg"
                cv2.imwrite(str(folder / "images" / name), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                writer.writerow([name, "var" if state["bone"] else "yok", "var" if state["onluk"] else "yok",
                                 time.strftime("%H:%M:%S")])
                index_file.flush()
                saved += 1
                last_saved = now

            view = frame.copy()
            status = "KAYIT" if recording else "DURAKLATILDI"
            color = (80, 80, 255) if recording else (200, 200, 200)
            draw_text(view, f"{status}  kare: {saved}", (10, 28), color)
            draw_text(view, f"Bone: {'VAR' if state['bone'] else 'YOK'} (B)   Onluk: {'VAR' if state['onluk'] else 'YOK'} (O)", (10, 58))
            draw_text(view, "Bosluk: kayit baslat/duraklat   Q: cik", (10, view.shape[0] - 14), scale=0.5)
            cv2.imshow(WINDOW, view)

            key = cv2.waitKey(1) & 0xFF
            if key == ord(" "):
                recording = not recording
                last_saved = 0.0
            elif key == ord("o"):
                state["onluk"] = not state["onluk"]
            elif key == ord("b"):
                state["bone"] = not state["bone"]
            elif key in (ord("q"), 27):
                break
    finally:
        index_file.close()
        capture.release()
        cv2.destroyAllWindows()
        print(f"{saved} kare kaydedildi: {folder}")
        if saved:
            print(f"Kutuları onaylamak için: python label_frames.py \"{folder}\"")


if __name__ == "__main__":
    main()
