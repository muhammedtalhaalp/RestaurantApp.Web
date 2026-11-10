# LezzetPOS Masa Doluluk Kamerası

Salonu gören bir kamerayla masaların **Boş / Dolu / Toplanacak** durumunu bulur ve LezzetPOS'a bildirir.
Kasadaki **Masa Seçimi → Kroki** ekranında her masanın üstünde kameranın gördüğü durum çıkar. Kamera
sistemle çelişirse masa yanıp söner ve krokinin üstünde uyarı listelenir:

| Kamera | Sistem (sipariş) | Uyarı |
|---|---|---|
| Dolu | Boş | Müşteri oturdu, sipariş açılmadı |
| Boş / Toplanacak | Dolu (hesap açık) | Masa boş görünüyor, hesap hâlâ açık |
| Toplanacak | Boş | Masa toplanacak |

Kamera **hiçbir şeyi otomatik kapatmaz**; siparişlere ve masa durumuna dokunmaz, yalnızca uyarır.

```
 Kamera ──► YOLO (insan, bardak, tabak...) ──► masa alanı ile eşleştir ──► durum birkaç sn sabit mi?
                                                                                 │ evet
 Kasa krokisi ◄── GetPublishedPlan (cameraStatus) ◄── /TableCamera/ReportStatus ◄┘
```

## Nasıl karar verir?

- Hazır **YOLOv8n** modeli (COCO veri setiyle eğitilmiş, 80 sınıf) kullanılır; ilk çalıştırmada otomatik
  indirilir (~6 MB). İnternet olmadan da çalışır; görüntü bilgisayardan çıkmaz.
- Her masanın alanı kamera görüntüsünde bir kez işaretlenir (kalibrasyon).
- Bir karede alanla yeterince kesişen **insan** varsa → `Dolu`; insan yok ama alanın içinde **bardak,
  kase, şişe, çatal, yemek** vb. varsa → `Toplanacak`; ikisi de yoksa → `Bos`.
- Yanlış alarmı önlemek için durum `hold_seconds` boyunca hiç değişmeden görülmelidir
  (varsayılan Dolu 3 sn, Boş/Toplanacak 8 sn). Önünden geçen garson masayı dolu yapmaz.
- Değişen durum hemen, değişmeyenler `heartbeat_seconds`'ta bir (30 sn) gönderilir. Sunucu 2 dakikadır
  haber alamadığı masanın kamera bilgisini yok sayar (kamera kapalı demektir).

**Gizlilik (KVKK):** Görüntü kaydedilmez ve sunucuya gönderilmez; yalnızca `masa no + durum` gider.

## Kurulum

```
cd tools\table-camera
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy config.example.json config.json
```

`config.json` içinde `server_url`, `username`, `password` doldurulur. Hesap **Admin, Kasiyer, Garson
veya Mutfak** rolünde olmalıdır (hijyen kamerasının hesabı da kullanılabilir). Bu dosya gitignore'dadır.

Sunucuda `Database/011_TableCameraStatus.sql` çalıştırılmış olmalıdır.

## Görüntü kaynağı: kamera nereye konmalı?

Gerçek kurulumda kamera salonun **tavana yakın bir köşesine**, alanın tamamını yukarıdan eğik
açıyla görecek şekilde konur. Kaynak `config.json` içindeki `camera_source` ile ya da her
komutta `--source` ile verilir:

| Kaynak | Örnek | Ne zaman |
|---|---|---|
| Kamera numarası | `0` | Bilgisayara takılı kamera (dizüstü kamerası 0) |
| Ağ akışı | `http://192.168.1.20:8080/video`, `rtsp://…` | Tavandaki IP kamera ya da telefonda bir IP kamera uygulaması |
| Video dosyası | `salon.mp4` | Kayıtlı tavan kamerası videosu; gerçek zaman hızında oynar, bitince başa sarar |

Telefonu kamera olarak kullanmak için telefona bir "IP kamera" uygulaması kurulur, telefon ile
bilgisayar aynı Wi-Fi'a (ya da telefonun hotspot'una) bağlanır ve uygulamanın verdiği adres
`--source` olarak yazılır. Telefon yüksek bir rafa konursa gerçek tavan kamerası açısı elde edilir.

## 1. Kalibrasyon (bir kez)

```
.venv\Scripts\python table_camera.py --calibrate
.venv\Scripts\python table_camera.py --calibrate --source salon.mp4
```

- **Boşluk** görüntüyü dondurur / çözer. Kalibrasyonu donmuş görüntüde yapmak kolaydır; video
  dosyasıyla kalibrasyon zaten donmuş başlar.
- **Sürükle**: masa alanını dikdörtgen olarak çiz. Eğik açıda dikdörtgene uymayan masalar için
  köşelere **sol tıkla**, **sağ tık** (ya da Enter) ile alanı kapat. Alanı masanın kendisi +
  sandalyelerin oturulan kısmı olacak şekilde çiz.
- Pencerede restoranın masa listesi çıkar; bu alanın hangi masa olduğunu numarasını yazıp
  Enter'a basarak seç (Esc: vazgeç).
- **F**: tüm görüntü tek masa (kamera yalnızca bir masayı görüyorsa, ör. dizüstüyle deneme).
- **A**: görüntüdeki masaları model bulsun, sırayla eşleştir. **Z**: son köşeyi geri al.
  **X**: son masa alanını sil. **S**: kaydet ve çık. **Q**: kaydetmeden çık.
- Alanlar oransal kaydedilir; kamera çözünürlüğü değişse de geçerli kalır. Kamera yerinden
  oynarsa kalibrasyonu yenile.

## 2. Çalıştırma

```
.venv\Scripts\python table_camera.py
.venv\Scripts\python table_camera.py --source salon.mp4
```

Pencerede masalar renklenir (yeşil boş, kırmızı dolu, turuncu toplanacak); bulunan insanlar ve
nesneler kutu içinde gösterilir. **Q** ile çıkılır. Pencere istemezsen `--no-window`.

Kamera açmadan bir fotoğrafta denemek için (sunucuya bir şey göndermez):

```
.venv\Scripts\python table_camera.py --image ornek.jpg
```

## Ayarlar (`config.json`)

| Anahtar | Açıklama |
|---|---|
| `camera_source` | Görüntü kaynağı: kamera numarası, `http://`/`rtsp://` adresi ya da video dosyası (yukarıya bak). Eski `camera_index` de okunur |
| `model` | `yolov8n.pt` hızlı; daha isabetli ama yavaş: `yolov8s.pt` |
| `confidence` | Tespit eşiği (0–1). Yanlış tespit çoksa artır |
| `person_overlap` | İnsan kutusunun masa alanıyla kesişme oranı; bu oranın altındaki insan o masada sayılmaz |
| `item_classes` | "Toplanacak" sayılan COCO nesneleri |
| `hold_seconds` | Bir durumun kesinleşmesi için kaç saniye sabit kalması gerektiği |
| `heartbeat_seconds` | Değişmeyen durumların yeniden gönderilme aralığı |

## Sınırlar ve sonraki adımlar

- COCO modeli genel amaçlıdır; tavandan bakan güvenlik kamerası açısında, kalabalık ve loş
  ortamda yanılabilir. Gerçek restoran görüntüleriyle **kendi veri setini** toplayıp modeli
  ince ayarlamak (fine-tuning) projenin bir sonraki adımıdır.
- Uzaktaki masalarda bardak/çatal gibi küçük nesneler kaçabilir; bu durumda masa `Bos` görünür.
- Bir kamera birden fazla masayı izleyebilir; birden fazla kamera için programı ayrı `--config`
  dosyalarıyla birden çok kez çalıştır.
