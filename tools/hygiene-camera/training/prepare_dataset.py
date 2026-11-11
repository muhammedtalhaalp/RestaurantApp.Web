"""Hijyen modeli için açık veri setlerini indirir ve tek bir YOLO veri setinde birleştirir.

Roboflow yalnızca açık lisanslı veri setlerini İNDİRMEK için kullanılır; eğitilen model bilgisayarda
çalışır ve tespit sırasında hiçbir servise bağlanılmaz. Kaynaklar ve lisanslar dataset/KAYNAKLAR.md
dosyasına yazılır (CC BY 4.0 atıf ister).

Sınıflar birleştirilir: 0 bone, 1 bonesiz, 2 onluk, 3 onluksuz. Diğer sınıflar (eldiven, maske,
hamam böceği…) atılır. Her veri setinden en fazla belirli sayıda görüntü alınır ki küçük setler
büyüklerin içinde kaybolmasın ve eğitim bilgisayarda makul sürede bitsin.

Kullanım:  python prepare_dataset.py
İndirilmiş zip'ler dataset-cache/ içinde varsa anahtar gerekmez. Yoksa Roboflow hesabının API anahtarı
ROBOFLOW_API_KEY ortam değişkeninden okunur (kamera programının config.json'unda tutulmaz).
"""
import json
import os
import random
import shutil
import sys
import zipfile
from pathlib import Path

import requests
import yaml

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "dataset"
CACHE = HERE.parent / "dataset-cache"          # indirilen zip'ler (yeniden indirmemek için)
CLASSES = ["bone", "bonesiz", "onluk", "onluksuz"]

# (çalışma alanı/proje, sürüm, kaynak sınıf adı → hedef sınıf, lisans, açıklama)
SOURCES = [
    ("kitchen-hygiene-efuu5/kitchenhygiene", 3,
     {"hairnet": "bone", "no_hairnet": "bonesiz", "apron": "onluk", "no_apron": "onluksuz"},
     "CC BY 4.0", "Mutfak güvenlik kamerası açısı (yukarıdan)"),
    ("jeans-workspace-6mdhi/kitchen-ppe", 2,
     {"hairnet": "bone", "no_hairnet": "bonesiz", "apron": "onluk", "no_apron": "onluksuz"},
     "CC BY 4.0", "Mutfak personeli, karışık açılar"),
    ("ztar-rcuht/chef-dataset", 2,
     {"chef_hat": "bone", "without_cap": "bonesiz", "apron": "onluk", "without_apron": "onluksuz"},
     "CC BY 4.0", "Yakın çekim aşçı görüntüleri"),
    ("agts/hairnet", 15, {"hairnet": "bone", "no_hairnet": "bonesiz"}, "CC BY 4.0", "Bone / bonesiz"),
    ("agts1/apron-6o9vl", 5, {"apron": "onluk", "noapron": "onluksuz"}, "CC BY 4.0", "Önlük / önlüksüz"),
    ("bns218/aporn-mef1v", 1, {"apron": "onluk", "no_apron": "onluksuz"}, "Public Domain", "Önlük / önlüksüz"),
]

MAX_PER_SOURCE = {"train": 1200, "valid": 200, "test": 200}
SPLITS = {"train": "train", "valid": "val", "test": "test"}
random.seed(42)


def api_key():
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key:
        sys.exit("Veri seti indirmek için ROBOFLOW_API_KEY ortam değişkenini ayarlayın "
                 "(dataset-cache/ içinde zip'ler varsa gerekmez).")
    return key


def download(project, version, get_key):
    target = CACHE / f"{project.replace('/', '__')}-v{version}.zip"
    if target.exists() and target.stat().st_size > 0:
        return target
    key = get_key()          # anahtar yalnızca gerçekten indirilecekse istenir
    CACHE.mkdir(parents=True, exist_ok=True)
    url = f"https://api.roboflow.com/{project}/{version}/yolov8"
    for _ in range(30):                                  # dışa aktarma ilk istekte hazırlanıyor olabilir
        info = requests.get(url, params={"api_key": key}, timeout=60).json()
        link = (info.get("export") or {}).get("link")
        if link:
            break
        print(f"  {project}: dışa aktarma hazırlanıyor…")
        import time
        time.sleep(10)
    else:
        raise RuntimeError(f"{project} için indirme bağlantısı alınamadı.")
    with requests.get(link, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(target, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return target


def to_box(parts):
    """YOLO satırı: kutu (x y w h) ya da çokgen (x1 y1 x2 y2 …) → kutu."""
    nums = [float(v) for v in parts]
    if len(nums) == 4:
        return nums
    xs, ys = nums[0::2], nums[1::2]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return [(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0]


def merge(project, version, mapping, zip_path, counts):
    names = None
    with zipfile.ZipFile(zip_path) as z:
        data_yaml = next(n for n in z.namelist() if n.endswith("data.yaml"))
        names = yaml.safe_load(z.read(data_yaml))["names"]
        if isinstance(names, dict):
            names = [names[k] for k in sorted(names)]
        remap = {i: CLASSES.index(mapping[n]) for i, n in enumerate(names) if n in mapping}
        prefix = project.split("/")[1][:12]
        for src_split, dst_split in SPLITS.items():
            images = [n for n in z.namelist() if n.startswith(f"{src_split}/images/") and not n.endswith("/")]
            random.shuffle(images)
            taken = 0
            for img in images:
                if taken >= MAX_PER_SOURCE[src_split]:
                    break
                label = img.replace("/images/", "/labels/").rsplit(".", 1)[0] + ".txt"
                if label not in z.namelist():
                    continue
                lines = []
                for line in z.read(label).decode("utf-8", "ignore").splitlines():
                    parts = line.split()
                    if len(parts) < 5 or int(parts[0]) not in remap:
                        continue
                    box = to_box(parts[1:])
                    if box[2] <= 0 or box[3] <= 0:
                        continue
                    lines.append(f"{remap[int(parts[0])]} " + " ".join(f"{v:.6f}" for v in box))
                if not lines:
                    continue                              # bu görüntüde bizim sınıflarımız yok
                stem = f"{prefix}-{Path(img).stem}"[:120]
                ext = Path(img).suffix.lower()
                (OUT / "images" / dst_split / f"{stem}{ext}").write_bytes(z.read(img))
                (OUT / "labels" / dst_split / f"{stem}.txt").write_text("\n".join(lines), encoding="utf-8")
                for l in lines:
                    counts[dst_split][CLASSES[int(l.split()[0])]] += 1
                taken += 1
            print(f"  {project} {src_split}: {taken} görüntü")


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    for d in ("images", "labels"):
        for s in SPLITS.values():
            (OUT / d / s).mkdir(parents=True, exist_ok=True)
    counts = {s: {c: 0 for c in CLASSES} for s in SPLITS.values()}
    for project, version, mapping, license_name, note in SOURCES:
        print(f"{project} v{version} indiriliyor…")
        try:
            merge(project, version, mapping, download(project, version, api_key), counts)
        except Exception as exc:
            print(f"  ATLANDI: {exc}")

    (OUT / "data.yaml").write_text(
        f"path: {OUT.as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n"
        + "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES)), encoding="utf-8")

    rows = "\n".join(f"| [{p}](https://universe.roboflow.com/{p}) | v{v} | {lic} | {note} |" for p, v, _, lic, note in SOURCES)
    (OUT / "KAYNAKLAR.md").write_text(
        "# Hijyen veri seti kaynakları\n\nBu veri seti aşağıdaki açık veri setlerinin birleştirilmesiyle oluşturulmuştur. "
        "Sınıflar bone / bonesiz / onluk / onluksuz olarak eşlenmiş, diğer sınıflar çıkarılmıştır.\n\n"
        "| Veri seti | Sürüm | Lisans | Not |\n|---|---|---|---|\n" + rows + "\n\n## Sınıf dağılımı (kutu sayısı)\n\n"
        "| Bölüm | " + " | ".join(CLASSES) + " |\n|---|" + "---|" * len(CLASSES) + "\n"
        + "\n".join(f"| {s} | " + " | ".join(str(counts[s][c]) for c in CLASSES) + " |" for s in counts) + "\n",
        encoding="utf-8")
    print("\nSınıf dağılımı:", json.dumps(counts, ensure_ascii=False))


if __name__ == "__main__":
    main()
