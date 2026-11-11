"""Masa kararlarının kayıtlı video üzerinde çevrim dışı değerlendirilmesi (TÜBİTAK 2209-A, M1).

Aynı videodan çıkarılan aynı ham gözlemler iki yönteme verilir:

    referans  : tek karedeki kişi–masa kutu kesişimi; her kare kendi kararını verir
    zamansal  : aynı ham durumlar + duruma özgü doğrulama süreleri + gözlem boşluğu toleransı

Böylece yöntemler arasındaki fark yalnızca karar adımından gelir; görüntü koşulları aynıdır.
Kişi takibi ve oturma bilgisi eklendiğinde yeni yöntemler METHODS listesine eklenir.

Çıktılar (görüntü kaydedilmez, yalnızca durum ve zaman):
    ham.csv               örnekleme anı başına masa ham durumu ve kare işlem süresi
    kararlar_<yontem>.csv kesinleşen durum değişiklikleri (video saniyesiyle)
    sonuc.md / sonuc.json etiket dosyası verildiyse ölçütler

Kullanım:
    python evaluate_video.py salon.mp4 --labels salon_etiket.csv
    python evaluate_video.py --from-raw degerlendirme/salon/ham.csv --labels salon_etiket.csv --hold Dolu=3,Bos=8,Toplanacak=8 --gap 2
"""

import argparse
import bisect
import csv
import json
import statistics
import sys
import time
from pathlib import Path

from table_camera import (CONFIG_PATH, STATUS_CLEARING, STATUS_EMPTY, STATUS_OCCUPIED, DecisionLog,
                          StatusTracker, build_regions, evaluate, hold_from, load_config, make_detector,
                          reference_tracker)

STATES = [STATUS_EMPTY, STATUS_OCCUPIED, STATUS_CLEARING]
HERE = Path(__file__).resolve().parent


# ---------------- Ham gözlemler ----------------

def extract_raw(video_path, config, interval):
    """Videoyu (gerçek zaman beklemeden) baştan sona işler; her `interval` saniyede bir ham durum üretir.

    Dönüş: (zamanlar, {masa_id: [ham durum, ...]}, kare süreleri, masa adları)
    Kare süresi; karenin çözülmesi, tespit ve masa sınıflandırmasını kapsar.
    """
    import cv2

    regions = build_regions(config)
    detector = make_detector(config)
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        sys.exit(f"Video açılamadı: {video_path}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    # Modelin ilk çağrısı (ısınma) birkaç saniye sürer; süre ölçümünü bozmasın diye önce bir kez çalıştırılır
    ok, first = capture.read()
    if ok:
        detector.detect(first)
    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)

    times, raw, durations = [], {r.table_id: [] for r in regions}, []
    index, next_sample = 0, 0.0
    print(f"Video: {video_path} ({fps:.1f} fps, {total / fps:.0f} sn). {len(regions)} masa, her {interval} sn'de bir örnek.")
    while True:
        t = index / fps
        if t + 1e-9 < next_sample:
            if not capture.grab():
                break
            index += 1
            continue
        started = time.perf_counter()
        ok, frame = capture.read()
        if not ok or frame is None:
            break
        _, states = evaluate(frame, regions, detector, config)
        durations.append(time.perf_counter() - started)
        times.append(round(t, 3))
        for tid, state in states.items():
            raw[tid].append(state)
        index += 1
        next_sample += interval
        if len(times) % 100 == 0:
            print(f"  {t:.0f} sn işlendi")
    capture.release()
    return times, raw, durations, {r.table_id: r.name for r in regions}


def save_raw(path, times, raw, durations, names):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["video_sn", "masa_id", "masa", "ham_durum", "kare_suresi_sn"])
        for i, t in enumerate(times):
            for tid in raw:
                writer.writerow([t, tid, names[tid], raw[tid][i], f"{durations[i]:.4f}" if durations else ""])


def load_raw(path):
    times, raw, durations, names = [], {}, [], {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            t, tid = float(row["video_sn"]), int(row["masa_id"])
            if not times or times[-1] != t:
                times.append(t)
                if row.get("kare_suresi_sn"):
                    durations.append(float(row["kare_suresi_sn"]))
            raw.setdefault(tid, []).append(row["ham_durum"])
            names[tid] = row["masa"]
    return times, raw, durations, names


# ---------------- Yöntemlerin yeniden oynatılması ----------------

def replay(times, raw, tracker_factory):
    """Ham durumları yöntemin karar adımından geçirir. {masa_id: [kesin durum veya None, ...]}"""
    decided = {}
    for tid, states in raw.items():
        tracker = tracker_factory()
        out = []
        for t, state in zip(times, states):
            tracker.update(state, t)
            out.append(tracker.confirmed)
        decided[tid] = out
    return decided


def write_decisions(path, method, times, decided, names):
    if path.exists():
        path.unlink()
    log = DecisionLog(path)
    for tid, states in decided.items():
        before = None
        for t, state in zip(times, states):
            if state != before:
                log.write(method, "karar", tid, names.get(tid, ""), before, state, video_seconds=t)
                before = state
    log.close()


# ---------------- Etiketler ----------------

def parse_time(text):
    """'75', '75.5', '1:15' ya da '0:01:15' → saniye."""
    parts = [float(p) for p in str(text).strip().split(":")]
    seconds = 0.0
    for p in parts:
        seconds = seconds * 60 + p
    return seconds


def load_labels(path, names):
    """Etiket CSV'si: masa,tur,baslangic,bitis,durum

    tur = durum : [baslangic, bitis) aralığında masanın gerçek durumu (Bos / Dolu / Toplanacak)
    tur = gecis : masaya oturmadan geçiş olayı (yanlış doluluk ölçümü için; durum boş bırakılır)
    masa, kalibrasyondaki masa numarası (adı) ya da masa_id olabilir.
    """
    by_name = {str(name).strip().lower(): tid for tid, name in names.items()}
    segments, passes = {}, {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for line, row in enumerate(csv.DictReader(f), start=2):
            key = (row.get("masa") or "").strip()
            tid = by_name.get(key.lower())
            if tid is None and key.isdigit() and int(key) in names:
                tid = int(key)
            if tid is None:
                sys.exit(f"Etiket satır {line}: '{key}' masası kalibrasyonda yok.")
            kind = (row.get("tur") or "durum").strip().lower()
            start, end = parse_time(row["baslangic"]), parse_time(row["bitis"])
            if end <= start:
                sys.exit(f"Etiket satır {line}: bitiş başlangıçtan sonra olmalı.")
            if kind == "gecis":
                passes.setdefault(tid, []).append((start, end))
            elif kind == "durum":
                state = (row.get("durum") or "").strip()
                if state not in STATES:
                    sys.exit(f"Etiket satır {line}: durum {', '.join(STATES)} olmalı ('{state}').")
                segments.setdefault(tid, []).append((start, end, state))
            else:
                sys.exit(f"Etiket satır {line}: tur 'durum' ya da 'gecis' olmalı.")
    for tid in segments:
        segments[tid].sort()
        for (s1, e1, _), (s2, _, _) in zip(segments[tid], segments[tid][1:]):
            if s2 < e1:
                sys.exit(f"Etiket: {names[tid]} masasında çakışan durum aralıkları var ({s1}-{e1} ve {s2}).")
    return segments, passes


# ---------------- Ölçütler ----------------

def percentile(values, q):
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def summary(values):
    if not values:
        return {"n": 0}
    return {"n": len(values), "ortalama": statistics.mean(values), "medyan": statistics.median(values),
            "p95": percentile(values, 0.95)}


def label_at(segments, t):
    for start, end, state in segments:
        if start <= t < end:
            return state, start
    return None, None


def measure(times, decided, segments, passes, tolerance):
    """Bir yöntemin ölçütleri.

    - Sınıf bazında kesinlik/duyarlılık/F1 ve macro-F1: etiketli her örnekleme anında karar ile
      gerçek durum karşılaştırılır. Bir durum aralığının ilk `tolerance` saniyesi (eşleşme toleransı)
      dışarıda bırakılır; gecikme ayrıca ölçülür. Henüz kararı olmayan an yanlış sayılır.
    - Yanlış boşaltma: gerçek Dolu aralıklarından, toleranstan sonra Bos/Toplanacak kararı görülenlerin oranı.
    - Yanlış doluluk: geçiş olaylarından, olay süresince ya da bitişten sonraki `tolerance` saniyede
      (gerçek durum Dolu değilken) Dolu kararı görülenlerin oranı.
    - Geçiş gecikmesi: gerçek durum değişiminden kararın yeni duruma ulaşmasına kadar geçen süre,
      geçiş türüne göre ayrı. Sonraki değişime kadar ulaşılmazsa "kaçırılan" sayılır.
    """
    confusion = {g: {p: 0 for p in STATES + [None]} for g in STATES}
    false_clear, occupied_events = 0, 0
    false_occ, pass_events = 0, 0
    delays, missed = {}, {}

    for tid, segs in segments.items():
        states = decided.get(tid)
        if states is None:
            continue
        for t, state in zip(times, states):
            truth, start = label_at(segs, t)
            if truth is None or t - start < tolerance:
                continue
            confusion[truth][state] += 1

        for start, end, truth in segs:
            if truth != STATUS_OCCUPIED:
                continue
            occupied_events += 1
            if any(start + tolerance <= t < end and s in (STATUS_EMPTY, STATUS_CLEARING) for t, s in zip(times, states)):
                false_clear += 1

        for (s1, e1, a), (s2, e2, b) in zip(segs, segs[1:]):
            if a == b or abs(s2 - e1) > 1.0:
                continue                         # aynı durum ya da arada etiketsiz boşluk var
            kind = f"{a}->{b}"
            reached = next((t for t, s in zip(times, states) if s2 <= t < e2 and s == b), None)
            if reached is None:
                missed[kind] = missed.get(kind, 0) + 1
            else:
                delays.setdefault(kind, []).append(reached - s2)

    for tid, events in passes.items():
        states = decided.get(tid)
        if states is None:
            continue
        segs = segments.get(tid, [])
        for start, end in events:
            pass_events += 1
            if any(start <= t < end + tolerance and s == STATUS_OCCUPIED and label_at(segs, t)[0] != STATUS_OCCUPIED
                   for t, s in zip(times, states)):
                false_occ += 1

    per_class = {}
    for c in STATES:
        tp = confusion[c][c]
        fp = sum(confusion[g][c] for g in STATES if g != c)
        fn = sum(v for p, v in confusion[c].items() if p != c)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[c] = {"kesinlik": precision, "duyarlilik": recall, "f1": f1, "ornek": tp + fn}
    present = [c for c in STATES if per_class[c]["ornek"] > 0]
    all_delays = [d for values in delays.values() for d in values]
    return {
        "sinif": per_class,
        "macro_f1": statistics.mean(per_class[c]["f1"] for c in present) if present else None,
        "karisiklik": {g: {str(p): v for p, v in row.items()} for g, row in confusion.items()},
        "yanlis_bosaltma": {"olay": occupied_events, "hatali": false_clear,
                            "oran": false_clear / occupied_events if occupied_events else None},
        "yanlis_doluluk": {"olay": pass_events, "hatali": false_occ,
                           "oran": false_occ / pass_events if pass_events else None},
        "gecikme": {"tum": summary(all_delays), **{k: summary(v) for k, v in sorted(delays.items())}},
        "kacirilan_gecis": missed,
    }


# ---------------- Rapor ----------------

def fmt(value, percent=False, digits=2):
    if value is None:
        return "-"
    return f"%{value * 100:.1f}" if percent else f"{value:.{digits}f}"


def report_markdown(results, durations, settings):
    lines = ["# Masa kararları: yöntem karşılaştırması", ""]
    lines.append(f"- Video / ham kayıt: `{settings['kaynak']}`")
    lines.append(f"- Örnekleme aralığı: {settings['aralik']} sn, eşleşme toleransı: {settings['tolerans']} sn")
    lines.append(f"- Zamansal yöntem: doğrulama süreleri {settings['hold']}, gözlem boşluğu toleransı {settings['gap']} sn")
    if durations:
        lines.append(f"- Kare başına işlem süresi (çözme + tespit + sınıflandırma): ortalama {statistics.mean(durations):.3f} sn, "
                     f"95. yüzdelik {percentile(durations, 0.95):.3f} sn, en çok {max(durations):.3f} sn (hedef ≤ 1 sn)")
    lines += ["", "Ölçütler pilot/deneme kaydıyla sınırlıdır; yakın kareler bağımsız örnek değildir.", ""]

    names = list(results)
    lines.append("| Ölçüt | " + " | ".join(names) + " |")
    lines.append("|---|" + "---|" * len(names))
    row = lambda label, fn: lines.append(f"| {label} | " + " | ".join(fn(results[n]) for n in names) + " |")
    row("Macro-F1 (hedef ≥ 0,90)", lambda r: fmt(r["macro_f1"]))
    for c in STATES:
        row(f"F1 {c}", lambda r, c=c: f"{fmt(r['sinif'][c]['f1'])} (n={r['sinif'][c]['ornek']})" if r["sinif"][c]["ornek"] else "etiket yok")
    row("Yanlış boşaltma (hedef < %5)", lambda r: f"{fmt(r['yanlis_bosaltma']['oran'], True)} ({r['yanlis_bosaltma']['hatali']}/{r['yanlis_bosaltma']['olay']})")
    row("Yanlış doluluk (hedef < %5)", lambda r: f"{fmt(r['yanlis_doluluk']['oran'], True)} ({r['yanlis_doluluk']['hatali']}/{r['yanlis_doluluk']['olay']})")
    row("Gecikme ort. sn (hedef ≤ 60)", lambda r: fmt(r["gecikme"]["tum"].get("ortalama"), digits=1))
    row("Gecikme medyan sn", lambda r: fmt(r["gecikme"]["tum"].get("medyan"), digits=1))
    row("Gecikme 95. yüzdelik sn", lambda r: fmt(r["gecikme"]["tum"].get("p95"), digits=1))

    kinds = sorted({k for r in results.values() for k in r["gecikme"] if k != "tum"} |
                   {k for r in results.values() for k in r["kacirilan_gecis"]})
    if kinds:
        lines += ["", "## Geçiş türüne göre gecikme (sn)", "",
                  "Kalıcı ayrılış (Dolu→Toplanacak / Dolu→Bos) ile masanın temizlenmesi (Toplanacak→Bos) ayrı raporlanır.", "",
                  "| Geçiş | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
        for k in kinds:
            cells = []
            for n in names:
                s = results[n]["gecikme"].get(k, {"n": 0})
                miss = results[n]["kacirilan_gecis"].get(k, 0)
                text = f"ort {fmt(s.get('ortalama'), digits=1)}, medyan {fmt(s.get('medyan'), digits=1)}, n={s['n']}" if s["n"] else "-"
                cells.append(text + (f", kaçırılan {miss}" if miss else ""))
            lines.append(f"| {k} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def parse_hold(text, config):
    hold = hold_from(config)
    if text:
        for part in text.split(","):
            key, value = part.split("=")
            if key.strip() not in STATES:
                sys.exit(f"--hold: bilinmeyen durum '{key}'. Durumlar: {', '.join(STATES)}")
            hold[key.strip()] = float(value)
    return hold


def main():
    parser = argparse.ArgumentParser(description="Masa kararlarını kayıtlı video üzerinde değerlendirir (referans ve zamansal yöntem).")
    parser.add_argument("video", nargs="?", help="değerlendirilecek video dosyası")
    parser.add_argument("--from-raw", help="videoyu yeniden işlemeden önceki ham.csv'den çalış (süre denemeleri için)")
    parser.add_argument("--labels", help="gerçek durum etiketleri (CSV: masa,tur,baslangic,bitis,durum)")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="masa alanlarının bulunduğu ayar dosyası")
    parser.add_argument("--out", help="çıktı klasörü (varsayılan degerlendirme/<video adı>)")
    parser.add_argument("--interval", type=float, help="örnekleme aralığı sn (varsayılan check_interval_seconds)")
    parser.add_argument("--hold", help="zamansal yöntemin doğrulama süreleri, ör. Dolu=3,Bos=8,Toplanacak=8")
    parser.add_argument("--gap", type=float, help="gözlem boşluğu toleransı sn (varsayılan gap_tolerance_seconds)")
    parser.add_argument("--tolerance", type=float, default=5.0, help="eşleşme toleransı sn; testten önce sabitlenmeli (varsayılan 5)")
    args = parser.parse_args()
    if not args.video and not args.from_raw:
        parser.error("video dosyası ya da --from-raw verin.")

    config = load_config(Path(args.config))
    interval = args.interval or config.get("check_interval_seconds", 0.5)
    hold = parse_hold(args.hold, config)
    gap = args.gap if args.gap is not None else config.get("gap_tolerance_seconds", 2)

    source = args.from_raw or args.video
    if args.out:
        out = Path(args.out)
    elif args.from_raw:
        out = Path(args.from_raw).parent
    else:
        out = HERE / "degerlendirme" / Path(args.video).stem
    out.mkdir(parents=True, exist_ok=True)

    if args.from_raw:
        times, raw, durations, names = load_raw(args.from_raw)
    else:
        print("Model yükleniyor...")
        times, raw, durations, names = extract_raw(args.video, config, interval)
        save_raw(out / "ham.csv", times, raw, durations, names)
    if not times:
        sys.exit("Videodan hiç kare okunamadı.")

    methods = {
        "referans": reference_tracker,
        # Video kesintisiz olduğundan stale_after kullanılmaz
        "zamansal": lambda: StatusTracker(hold, gap),
    }
    decided = {}
    for name, factory in methods.items():
        decided[name] = replay(times, raw, factory)
        write_decisions(out / f"kararlar_{name}.csv", name, times, decided[name], names)
        changes = sum(sum(1 for a, b in zip(s, s[1:]) if a != b) for s in decided[name].values())
        print(f"{name}: {changes} durum değişikliği → {out / f'kararlar_{name}.csv'}")

    if durations:
        print(f"Kare başına işlem süresi: ortalama {statistics.mean(durations):.3f} sn, 95. yüzdelik {percentile(durations, 0.95):.3f} sn")

    if not args.labels:
        print("Etiket dosyası verilmedi; yalnızca kararlar yazıldı. Ölçüt için --labels verin.")
        return

    segments, passes = load_labels(args.labels, names)
    results = {name: measure(times, decided[name], segments, passes, args.tolerance) for name in methods}
    settings = {"kaynak": source, "aralik": interval, "tolerans": args.tolerance, "hold": hold, "gap": gap}
    report = report_markdown(results, durations, settings)
    (out / "sonuc.md").write_text(report, encoding="utf-8")
    with open(out / "sonuc.json", "w", encoding="utf-8") as f:
        json.dump({"ayarlar": settings, "sonuclar": results,
                   "kare_suresi": summary(durations)}, f, ensure_ascii=False, indent=2)
    print()
    print(report)
    print(f"Rapor: {out / 'sonuc.md'}")


if __name__ == "__main__":
    main()
