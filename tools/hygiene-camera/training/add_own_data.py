"""Onaylanmış kendi karelerimizi (kendi-veri/) eğitim veri setine (dataset/) ekler.

Aynı oturumdaki kareler birbirine çok benzer; bu yüzden bölme **oturum bazında** yapılır: bir
oturumun bütün kareleri ya eğitime, ya doğrulamaya, ya teste gider. Test oturumları eğitimde ve
eşik seçiminde hiç kullanılmaz; ek eğitimin işe yarayıp yaramadığı yalnızca onlarla ölçülür.
README'deki 19 fotoğraf da yalnızca test içindir; buraya eklenmez.

Önceden eklenmiş kendi kareleri (adı "kendi_" ile başlayanlar) her çalıştırmada silinip yeniden
eklenir, yani komut tekrar tekrar güvenle çalıştırılabilir. Açık veri setinin kareleri değişmez.

Kullanım:
    python add_own_data.py --list
    python add_own_data.py --val 20261114-190500 --test 20261115-101500 20261115-103000
Ardından dataset/ klasörü yeniden hijyen-dataset.zip yapılıp train_colab.ipynb ile eğitilir.
"""

import argparse
import csv
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
OWN_DATA = HERE.parent / "kendi-veri"
DATASET = HERE.parent / "dataset"
CLASSES = ["bone", "bonesiz", "onluk", "onluksuz"]
PREFIX = "kendi_"


def sessions(root):
    out = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and (p / "kareler.csv").exists()):
        status_path = folder / "etiket_durumu.csv"
        status = {}
        if status_path.exists():
            with open(status_path, encoding="utf-8-sig", newline="") as f:
                status = {row["dosya"]: row["durum"] for row in csv.DictReader(f)}
        with open(folder / "kareler.csv", encoding="utf-8-sig", newline="") as f:
            frames = [row["dosya"] for row in csv.DictReader(f)]
        meta = json.loads((folder / "oturum.json").read_text(encoding="utf-8")) if (folder / "oturum.json").exists() else {}
        accepted = [n for n in frames if status.get(n) == "kabul" and (folder / "labels" / (Path(n).stem + ".txt")).exists()]
        classes = Counter()
        for n in accepted:
            for line in (folder / "labels" / (Path(n).stem + ".txt")).read_text(encoding="utf-8").split("\n"):
                if line.strip():
                    classes[CLASSES[int(line.split()[0])]] += 1
        out.append({"name": folder.name, "folder": folder, "frames": len(frames), "accepted": accepted,
                    "pending": sum(1 for n in frames if n not in status), "note": meta.get("not", ""), "classes": classes})
    return out


def main():
    parser = argparse.ArgumentParser(description="Onaylanmış kendi karelerimizi hijyen veri setine ekler (oturum bazında bölme).")
    parser.add_argument("--list", action="store_true", help="oturumları ve sınıf sayılarını listele, bir şey kopyalama")
    parser.add_argument("--val", nargs="*", default=[], help="doğrulamaya gidecek oturumlar")
    parser.add_argument("--test", nargs="*", default=[], help="teste gidecek oturumlar (eğitimde hiç kullanılmaz)")
    parser.add_argument("--own", default=str(OWN_DATA), help="kendi kareler klasörü")
    parser.add_argument("--dataset", default=str(DATASET), help="YOLO veri seti klasörü")
    args = parser.parse_args()

    own, dataset = Path(args.own), Path(args.dataset)
    if not own.exists():
        sys.exit(f"Kendi kare klasörü yok: {own}. Önce record_frames.py ile kayıt yapın.")
    found = sessions(own)
    names = {s["name"] for s in found}
    for name in args.val + args.test:
        if name not in names:
            sys.exit(f"Oturum bulunamadı: {name}. Oturumlar için --list.")
    if set(args.val) & set(args.test):
        sys.exit("Bir oturum hem doğrulamada hem testte olamaz.")

    print(f"{'oturum':17s} {'bölüm':6s} {'onaylı':>6s} {'bekleyen':>8s}  sınıflar / not")
    split_of = {}
    for s in found:
        split = "test" if s["name"] in args.test else "val" if s["name"] in args.val else "train"
        split_of[s["name"]] = split
        classes = ", ".join(f"{c} {s['classes'][c]}" for c in CLASSES if s["classes"][c])
        print(f"{s['name']:17s} {split:6s} {len(s['accepted']):6d} {s['pending']:8d}  {classes or '-'}"
              + (f"  ({s['note']})" if s["note"] else ""))
    if args.list:
        return
    if not (dataset / "data.yaml").exists():
        sys.exit(f"Veri seti bulunamadı: {dataset}. Önce prepare_dataset.py çalıştırılmalı.")
    if not args.test:
        print("\nUyarı: test oturumu seçilmedi. Ek eğitimin etkisini ölçmek için en az bir oturumu --test ile ayırın.")

    removed = 0
    for part in ("images", "labels"):
        for split in ("train", "val", "test"):
            for old in (dataset / part / split).glob(PREFIX + "*"):
                old.unlink()
                removed += 1

    totals = Counter()
    for s in found:
        split = split_of[s["name"]]
        for name in s["accepted"]:
            stem = f"{PREFIX}{s['name']}_{Path(name).stem}"
            shutil.copy2(s["folder"] / "images" / name, dataset / "images" / split / (stem + Path(name).suffix))
            shutil.copy2(s["folder"] / "labels" / (Path(name).stem + ".txt"), dataset / "labels" / split / (stem + ".txt"))
            totals[split] += 1

    note = dataset / "KENDI_VERI.md"
    note.write_text(
        "# Kendi kamera karelerimiz\n\n"
        "record_frames.py ile kaydedilip label_frames.py ile onaylanan kareler (dosya adı `kendi_` ile başlar).\n"
        "Bölme oturum bazındadır; test oturumları eğitimde kullanılmaz.\n\n"
        + "\n".join(f"- {s['name']} → {split_of[s['name']]}: {len(s['accepted'])} kare"
                    + (f" ({s['note']})" if s["note"] else "") for s in found) + "\n",
        encoding="utf-8")
    print(f"\nÖnceki kendi kareleri silindi ({removed // 2} kare). Eklenen: eğitim {totals['train']}, "
          f"doğrulama {totals['val']}, test {totals['test']}.")
    print("Sonraki adım: dataset/ klasörünü hijyen-dataset.zip yapıp Drive'a yükleyin ve train_colab.ipynb'yi çalıştırın.")


if __name__ == "__main__":
    main()
