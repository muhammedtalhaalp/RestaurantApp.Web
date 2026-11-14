"""Salon videosu için olay etiketleme yardımcısı (değerlendirmenin "gerçek durum" dosyası).

Video oynatılırken bir masa seçilir ve masanın durumu değiştiği anda tuşa basılır. Program bu
değişim anlarından evaluate_video.py'nin beklediği etiket dosyasını yazar:

    masa,tur,baslangic,bitis,durum
    M1,durum,0:00.0,4:30.0,Dolu
    M1,gecis,7:05.0,7:08.0,

Tuşlar (pencerede):
    Boşluk        oynat / duraklat
    ← / →         2 sn geri / ileri        , / .   0,5 sn geri / ileri (duraklatılmışken ince ayar)
    ↑ / ↓         10 sn ileri / geri       + / -   oynatma hızı
    1-9  /  Tab   masa seç (numara) / sonraki masa
    B  D  T       seçili masa bu andan itibaren Boş / Dolu / Toplanacak
    E             seçili masa bu andan itibaren etiketsiz (belirsiz kısım; ölçüme girmez)
    G             masanın önünden geçiş: başlangıç, ikinci basışta bitiş
    Z             son işlemi geri al
    S             kaydet               Q / Esc   kaydet ve çık

Müşteri kısa süre kalkarsa (lavabo, telefon) masa Dolu kalır; kalıcı ayrılışta Toplanacak ya da
Boş girilir, masa temizlenince Boş. Kaydedilen dosya yeniden açılınca kaldığı yerden devam edilir.
Görüntü hiçbir yere gönderilmez ve kaydedilmez; yalnızca masa adı, durum ve saniye yazılır.

Kullanım:
    python label_events.py videolar/video1.mp4
    python label_events.py videolar/video1.mp4 --out videolar/video1_etiket.csv
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2

from table_camera import (CONFIG_PATH, STATUS_CLEARING, STATUS_EMPTY, STATUS_OCCUPIED, STATUS_COLORS,
                          ascii_name, build_regions, draw_text, load_config)

STATE_KEYS = {ord("b"): STATUS_EMPTY, ord("d"): STATUS_OCCUPIED, ord("t"): STATUS_CLEARING, ord("e"): None}
STATE_SHORT = {STATUS_EMPTY: "BOS", STATUS_OCCUPIED: "DOLU", STATUS_CLEARING: "TOPLANACAK", None: "etiketsiz"}
# OpenCV waitKeyEx ok tuşu kodları (Windows / Linux)
KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN = (2424832, 65361), (2555904, 65363), (2490368, 65362), (2621440, 65364)
WINDOW = "LezzetPOS Olay Etiketleme"
MAX_WIDTH = 1280


def fmt_time(seconds):
    minutes, rest = divmod(max(seconds, 0.0), 60)
    return f"{int(minutes)}:{rest:04.1f}"


def parse_time(text):
    seconds = 0.0
    for part in str(text).strip().split(":"):
        seconds = seconds * 60 + float(part)
    return seconds


class EventLabels:
    """Masa başına durum değişim anları ve geçiş olayları; etiket dosyasına çevrilir."""

    def __init__(self, table_ids):
        self.changes = {tid: {} for tid in table_ids}    # masa -> {saniye: durum (None = etiketsiz)}
        self.passes = {tid: [] for tid in table_ids}     # masa -> [[başlangıç, bitiş ya da None]]
        self.history = []                                # geri alma için işlemler

    def set_state(self, tid, t, state):
        t = round(t, 1)
        previous = self.changes[tid].get(t, "yok")
        self.changes[tid][t] = state
        self.history.append(("state", tid, t, previous))

    def toggle_pass(self, tid, t):
        t = round(t, 1)
        events = self.passes[tid]
        if events and events[-1][1] is None and t > events[-1][0]:
            events[-1][1] = t
            self.history.append(("pass_end", tid))
            return "bitti"
        events.append([t, None])
        self.history.append(("pass_start", tid))
        return "başladı"

    def undo(self):
        if not self.history:
            return None
        action = self.history.pop()
        if action[0] == "state":
            _, tid, t, previous = action
            if previous == "yok":
                del self.changes[tid][t]
            else:
                self.changes[tid][t] = previous
        elif action[0] == "pass_end":
            self.passes[action[1]][-1][1] = None
        else:
            self.passes[action[1]].pop()
        return action[0]

    def state_at(self, tid, t):
        times = [x for x in self.changes[tid] if x <= t + 1e-6]
        return self.changes[tid][max(times)] if times else None

    def open_pass(self, tid):
        events = self.passes[tid]
        return bool(events) and events[-1][1] is None

    def segments(self, tid, end):
        """[(başlangıç, bitiş, durum)]; etiketsiz kısımlar atlanır."""
        points = sorted(self.changes[tid].items())
        out = []
        for i, (t, state) in enumerate(points):
            stop = points[i + 1][0] if i + 1 < len(points) else end
            if state is not None and stop > t:
                out.append((t, stop, state))
        return out

    def save(self, path, names, end):
        rows = 0
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["masa", "tur", "baslangic", "bitis", "durum"])
            for tid, name in names.items():
                for start, stop, state in self.segments(tid, end):
                    writer.writerow([name, "durum", fmt_time(start), fmt_time(stop), state])
                    rows += 1
                for start, stop in self.passes[tid]:
                    if stop is not None:
                        writer.writerow([name, "gecis", fmt_time(start), fmt_time(stop), ""])
                        rows += 1
        return rows

    def load(self, path, by_name):
        """Önceki etiket dosyasını değişim anlarına çevirir (kaldığı yerden devam için)."""
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                tid = by_name.get((row.get("masa") or "").strip().lower())
                if tid is None:
                    continue
                start, stop = parse_time(row["baslangic"]), parse_time(row["bitis"])
                if (row.get("tur") or "durum").strip().lower() == "gecis":
                    self.passes[tid].append([start, stop])
                    continue
                self.changes[tid][round(start, 1)] = row["durum"].strip()
                # Bitişte etiketsiz başlar; hemen ardından yeni durum başlıyorsa o satır bunun üstüne yazar
                self.changes[tid].setdefault(round(stop, 1), None)
        self.history.clear()


def main():
    parser = argparse.ArgumentParser(description="Salon videosunda masa olaylarını etiketler (evaluate_video.py için).")
    parser.add_argument("video", help="etiketlenecek video")
    parser.add_argument("--out", help="etiket dosyası (varsayılan: videonun yanında <ad>_etiket.csv)")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="masa alanlarının bulunduğu ayar dosyası")
    args = parser.parse_args()

    video = Path(args.video)
    out = Path(args.out) if args.out else video.with_name(video.stem + "_etiket.csv")
    config = load_config(Path(args.config))
    regions = build_regions(config)
    names = {r.table_id: r.name for r in regions}
    labels = EventLabels(list(names))
    if out.exists():
        labels.load(out, {str(n).strip().lower(): tid for tid, n in names.items()})
        print(f"Önceki etiketler yüklendi: {out}")

    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        sys.exit(f"Video açılamadı: {video}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    duration = (capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / fps
    ok, frame = capture.read()
    if not ok:
        sys.exit("Videodan kare okunamadı.")
    height, width = frame.shape[:2]
    scale = min(1.0, MAX_WIDTH / width)
    for region in regions:
        region.prepare(width, height)

    print(__doc__.split("Tuşlar (pencerede):")[1].split("Müşteri kısa")[0])
    print(f"Video {fmt_time(duration)}, {len(regions)} masa. Etiket dosyası: {out}")

    selected, playing, speed, message = 0, False, 1.0, ""
    position = 0.0

    def seek(t):
        nonlocal frame, position
        t = min(max(t, 0.0), max(duration - 1.0 / fps, 0.0))
        capture.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, new = capture.read()
        if ok:
            frame, position = new, t

    try:
        while True:
            view = frame.copy()
            overlay = view.copy()
            for i, region in enumerate(regions):
                state = labels.state_at(region.table_id, position)
                color = STATUS_COLORS.get(state, STATUS_COLORS[None])
                cv2.fillPoly(overlay, [region.points], color)
            cv2.addWeighted(overlay, 0.25, view, 0.75, 0, view)
            for i, region in enumerate(regions):
                state = labels.state_at(region.table_id, position)
                thick = 4 if i == selected else 1
                cv2.polylines(view, [region.points], True, STATUS_COLORS.get(state, STATUS_COLORS[None]), thick)
                x, y = region.points.min(axis=0)
                text = f"{i + 1}) {ascii_name(region.name)}: {STATE_SHORT[state]}" + (" [GECIS]" if labels.open_pass(region.table_id) else "")
                draw_text(view, text, (int(x) + 4, int(y) + 20), (120, 230, 255) if i == selected else (255, 255, 255), 0.6)
            if scale < 1.0:
                view = cv2.resize(view, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            sel = regions[selected]
            draw_text(view, f"{fmt_time(position)} / {fmt_time(duration)}  {'OYNATILIYOR' if playing else 'DURAKLATILDI'} x{speed:g}"
                            f"  | Secili: {selected + 1}) {ascii_name(sel.name)}", (10, 26))
            draw_text(view, "Bosluk: oynat  <- -> : 2 sn  , . : 0.5 sn  1-9/Tab: masa  B D T E: durum  G: gecis  Z: geri al  S: kaydet  Q: cik",
                      (10, 52), scale=0.48)
            if message:
                draw_text(view, ascii_name(message), (10, view.shape[0] - 14), (120, 230, 255))
            cv2.imshow(WINDOW, view)

            delay = max(1, int(1000 / (fps * speed))) if playing else 30
            key = cv2.waitKeyEx(delay)
            if playing and key == -1:
                ok, new = capture.read()
                if ok:
                    frame = new
                    position = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                else:
                    playing = False
                continue
            if key == -1:
                continue
            low = key & 0xFF if key < 256 else None

            if low == ord(" "):
                playing = not playing
            elif key in KEY_RIGHT:
                seek(position + 2)
            elif key in KEY_LEFT:
                seek(position - 2)
            elif key in KEY_UP:
                seek(position + 10)
            elif key in KEY_DOWN:
                seek(position - 10)
            elif low == ord("."):
                seek(position + 0.5)
            elif low == ord(","):
                seek(position - 0.5)
            elif low in (ord("+"), ord("=")):
                speed = min(speed * 2, 8.0)
            elif low == ord("-"):
                speed = max(speed / 2, 0.25)
            elif low is not None and ord("1") <= low <= ord("9") and low - ord("1") < len(regions):
                selected = low - ord("1")
            elif low == 9:   # Tab
                selected = (selected + 1) % len(regions)
            elif low in STATE_KEYS:
                state = STATE_KEYS[low]
                labels.set_state(sel.table_id, position, state)
                message = f"{sel.name}: {fmt_time(position)} itibariyle {STATE_SHORT[state]}"
            elif low == ord("g"):
                message = f"{sel.name}: geçiş {labels.toggle_pass(sel.table_id, position)} ({fmt_time(position)})"
            elif low == ord("z"):
                message = "Geri alındı." if labels.undo() else "Geri alınacak işlem yok."
            elif low == ord("s"):
                message = f"Kaydedildi: {labels.save(out, names, duration)} satır"
            elif low in (ord("q"), 27):
                break
    finally:
        rows = labels.save(out, names, duration)
        capture.release()
        cv2.destroyAllWindows()
        open_passes = [names[t] for t in names if labels.open_pass(t)]
        print(f"{rows} etiket satırı kaydedildi: {out}")
        if open_passes:
            print(f"Uyarı: bitişi girilmemiş geçiş var ({', '.join(open_passes)}); bunlar dosyaya yazılmadı.")


if __name__ == "__main__":
    main()
