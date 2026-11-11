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
- **Zamansal doğrulama:** Yeni durum, kendi doğrulama süresi (`hold_seconds`; varsayılan Dolu 3 sn,
  Boş/Toplanacak 8 sn) boyunca sürerse kesinleşir. Önünden geçen garson masayı dolu yapmaz.
- **Gözlem boşluğu toleransı** (`gap_tolerance_seconds`, varsayılan 2 sn): Bekleyen durum bu süreden
  kısa bir kesintiyle (tek kaçırılmış tespit, bir anlık geçiş) sıfırlanmaz.
- **Kamera kesilirse** (`stale_after_seconds`, 5 sn kare gelmezse) yeni karar üretilmez, son durum
  korunur ve sunucuya gönderim durur; görüntü gelince doğrulama baştan başlar.
- **Karar kaydı:** Kesinleşen her durum değişikliği, kesinti ve geri geliş zaman damgasıyla
  `logs/kararlar-YYYY-AA-GG.csv` dosyasına yazılır (yalnız masa, durum, zaman; görüntü yok).
  Değerlendirmede personelin tuttuğu olay kayıtlarıyla karşılaştırılır.
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
- **H — krokiyle otomatik eşleme (önerilen, tavan kamerası için):** Kamera görüntüsünde zemin
  üzerinde 4 noktaya tıkla (salonun köşeleri ya da zemine bantla konan işaretler). Açılan kroki
  penceresinde **aynı 4 noktaya aynı sırayla** tıkla. Program iki düzlem arasındaki dönüşümü
  (homografi) hesaplar ve krokideki o alanın **bütün masalarını görüntüye kendisi yerleştirir**;
  alanlar `seat_margin` kadar (varsayılan 35 kroki birimi) sandalye payıyla büyütülür.
  Görüntüde görünmeyen masalar atlanır. Yanlış duran olursa **X** ile silip elle çizebilirsin.
  Noktalar birbirinden uzak seçilmeli; üçü aynı doğru üzerindeyse program uyarır.
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

## 3. Video üzerinde değerlendirme (referans ve zamansal yöntem)

`evaluate_video.py`, kayıtlı bir salon videosunu gerçek zaman beklemeden baştan sona işler ve
**aynı ham gözlemleri** iki yönteme verir. Böylece fark yalnızca karar adımından gelir:

| Yöntem | Karar |
|---|---|
| `referans` | Tek karedeki kişi–masa kutu kesişimi; her kare kendi kararını verir |
| `zamansal` | Aynı ham durumlar + duruma özgü doğrulama süreleri + gözlem boşluğu toleransı |

Kişi takibi, ayak konumuyla atama ve oturma bilgisi eklendikçe yeni yöntemler aynı karşılaştırmaya eklenecek.

```
.venv/Scripts/python evaluate_video.py salon.mp4 --labels salon_etiket.csv
```

Çıktılar `degerlendirme/<video adı>/` klasörüne yazılır (gitignore'da; görüntü içermez):

- `ham.csv`: her örnekleme anında masa başına ham durum ve kare işlem süresi
- `kararlar_referans.csv`, `kararlar_zamansal.csv`: kesinleşen durum değişiklikleri (video saniyesiyle)
- `sonuc.md`, `sonuc.json`: etiket verildiyse ölçütler

Doğrulama sürelerini ve toleransı **doğrulama videosunda** seçmek için video yeniden işlenmeden
farklı değerler denenebilir:

```
.venv/Scripts/python evaluate_video.py --from-raw degerlendirme/salon/ham.csv --labels salon_etiket.csv --hold Dolu=3,Bos=8,Toplanacak=8 --gap 2
```

Seçilen değerler `config.json`'a yazılır. Nihai test videosu bu ayarı seçerken kullanılmaz; yalnızca en sonda bir kez değerlendirilir.

### Etiket dosyası

Videoyu izleyerek her masanın gerçek durumu zaman aralıklarıyla yazılır (UTF-8 CSV). Süre saniye
(`75`) ya da dakika:saniye (`1:15`) olabilir; `masa`, kalibrasyondaki masa numarasıdır.

```
masa,tur,baslangic,bitis,durum
M1,durum,0:00,4:30,Dolu
M1,durum,4:30,6:10,Toplanacak
M1,durum,6:10,9:00,Bos
M1,gecis,7:05,7:08,
```

- `tur=durum`: o aralıkta masanın gerçek durumu (`Bos`, `Dolu`, `Toplanacak`). Etiketlenmeyen aralıklar ölçüme girmez.
- `tur=gecis`: masaya oturmadan önünden geçiş (yanlış doluluk ölçümü için).
- Müşteri **kısa süreli kalkarsa** (lavabo, telefon) masa `Dolu` olarak etiketlenmeye devam eder;
  bu arada verilen boş kararı yanlış boşaltma sayılır. Müşterinin **kalıcı ayrılışı**
  (Dolu→Toplanacak) ile masanın **temizlenmesi** (Toplanacak→Bos) ayrı geçişlerdir.

### Ölçütler

| Ölçüt | Tanım | Hedef |
|---|---|---|
| Sınıf F1, macro-F1 | Etiketli her örnekleme anında karar ile gerçek durum karşılaştırılır; durum değişiminden sonraki ilk `--tolerance` sn (varsayılan 5, testten önce sabitlenir) dışarıda bırakılır | ≥ 0,90 |
| Yanlış boşaltma | Gerçek Dolu aralıklarından, içinde Boş/Toplanacak kararı görülenlerin oranı | < %5 |
| Yanlış doluluk | Geçiş olaylarından Dolu kararı üretilenlerin oranı | < %5 |
| Geçiş gecikmesi | Gerçek değişimden kararın yeni duruma ulaşmasına kadar geçen süre; ortalama, medyan, 95. yüzdelik ve geçiş türüne göre | ort. ≤ 60 sn |
| Kare süresi | Karenin çözülmesi + tespit + sınıflandırma | ≤ 1 sn |

Sonuçlar yalnızca o kayıtlar için geçerlidir; ardışık kareler bağımsız örnek sayılmaz.

## Ayarlar (`config.json`)

| Anahtar | Açıklama |
|---|---|
| `camera_source` | Görüntü kaynağı: kamera numarası, `http://`/`rtsp://` adresi ya da video dosyası (yukarıya bak). Eski `camera_index` de okunur |
| `model` | `yolov8n.pt` hızlı; daha isabetli ama yavaş: `yolov8s.pt` |
| `confidence` | Tespit eşiği (0–1). Yanlış tespit çoksa artır |
| `seat_margin` | Krokiyle eşlemede masa alanının sandalye payı (kroki birimi; masa 75 birim civarındadır) |
| `person_overlap` | İnsan kutusunun masa alanıyla kesişme oranı; bu oranın altındaki insan o masada sayılmaz |
| `item_classes` | "Toplanacak" sayılan COCO nesneleri |
| `hold_seconds` | Duruma özgü doğrulama süresi: yeni durumun kesinleşmesi için kaç saniye sürmesi gerektiği |
| `gap_tolerance_seconds` | Gözlem boşluğu toleransı: bekleyen durumu sıfırlamayan en uzun kesinti |
| `stale_after_seconds` | Bu kadar saniye kare gelmezse kamera kesik sayılır; yeni karar üretilmez |
| `heartbeat_seconds` | Değişmeyen durumların yeniden gönderilme aralığı |
| `decision_log_dir` | Karar kaydı klasörü (varsayılan `logs`); boş bırakılırsa kayıt tutulmaz |

## Sınırlar ve sonraki adımlar

- COCO modeli genel amaçlıdır; tavandan bakan güvenlik kamerası açısında, kalabalık ve loş
  ortamda yanılabilir. Gerçek restoran görüntüleriyle **kendi veri setini** toplayıp modeli
  ince ayarlamak (fine-tuning) projenin bir sonraki adımıdır.
- Uzaktaki masalarda bardak/çatal gibi küçük nesneler kaçabilir; bu durumda masa `Bos` görünür.
- Bir kamera birden fazla masayı izleyebilir; birden fazla kamera için programı ayrı `--config`
  dosyalarıyla birden çok kez çalıştır.
