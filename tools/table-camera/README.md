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
- **Kişi takibi ve ayak konumu** (`person_assignment: "takip"`): Kutu kesişimi yerine her kişi
  kareler boyunca bir iz kimliğiyle (ByteTrack) takip edilir. Kişi bir masaya yalnızca **ayak
  noktası** (kutunun alt kenarının ortası) masa bölgesindeyse, orada en az `dwell_seconds` (2 sn)
  kalmışsa ve bu sürede boyunun `still_ratio` (0,35) katından fazla yer değiştirmemişse atanır.
  Böylece yürüyerek geçen garson, art arda geçen kişiler ve kutusu yan masaya taşan oturan kişi
  masayı dolu yapmaz.
- **Oturma bilgisi** (`person_assignment: "poz"`): Takibe ek olarak hazır **YOLOv8n-pose** modeli
  (ilk çalıştırmada iner, ~6 MB) her kişinin eklemlerini bulur. Diz açısı (kalça–diz–bilek) küçükse
  ya da uyluk yataya yakınsa (kalça–diz dikey mesafesi / gövde boyu küçük) kişi **oturuyor**, bacak
  düzse **ayakta** sayılır. Masada kalma süresindeki güvenilir gözlemlerin çoğu ayaktaysa kişi
  masaya atanmaz (masayı kuran ya da silen garson). Diz/kalça masa veya sandalye tarafından
  örtülmüşse duruş **belirsiz** olur ve tek başına karar vermez; ayak konumu kuralı geçerlidir.
  Kalça konumu zemin konumu olarak kullanılmaz.
- Varsayılan hâlâ `kesisim`dir; hangisinin kullanılacağı salon videosundaki karşılaştırmayla seçilecektir.
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
  Görüntüde görünmeyen masalar atlanır. Noktalar birbirinden uzak seçilmeli; üçü aynı doğru
  üzerindeyse program uyarır.
- **Gözden geçirme (H'den sonra kendiliğinden açılır):** Zemin dönüşümü masa yüzeyini ve
  sandalyeleri tam doğru yerleştiremez (masa üstü zeminden farklı bir düzlemdedir). Bu yüzden
  otomatik gelen her masa sırayla gösterilir. Mor çizgi düzeltilecek bölge, ince sarı çizgi
  otomatik başlangıç bölgesidir.
  - **Köşeyi sürükle**: o köşeyi taşı. **Alanın içini sürükle**: tüm alanı kaydır.
  - **Enter / N**: onayla, sonrakine geç. **B**: önceki. **R**: otomatik hâline geri dön.
  - **D**: bu masayı sil (görüntüde aslında yok ya da bu kamerayla izlenmeyecek).
  - **Esc**: incelemeyi bırak; **G** ile kaldığın yerden devam edersin.
  - **A** ile modelin bulduğu masalar da aynı şekilde G ile gözden geçirilir.
  - Gözden geçirilmemiş bölge varken **S** önce uyarır; yine de kaydetmek için S'ye tekrar bas.
- **F**: tüm görüntü tek masa (kamera yalnızca bir masayı görüyorsa, ör. dizüstüyle deneme).
- **A**: görüntüdeki masaları model bulsun, sırayla eşleştir. **Z**: son köşeyi geri al.
  **X**: son masa alanını sil. **S**: kaydet ve çık. **Q**: kaydetmeden çık.
- Alanlar oransal kaydedilir; kamera çözünürlüğü değişse de geçerli kalır. Kamera yerinden
  oynarsa kalibrasyonu yenile.
- **Kurulum kaydı** (`logs/kalibrasyon.csv`, `;` ayraçlı): her kayıtta kalibrasyondaki her masa
  için bir satır yazılır: yöntem (`kroki`, `model`, `elle`, `tum_goruntu`), gözden geçirildi mi
  (`evet`/`hayir`/`silindi`), otomatik bölge ile son bölgenin örtüşmesi (`iou_otomatik_son`) ve
  oturumun süreleri (pencere açılışından kayda toplam, kroki eşleme, gözden geçirme; saniye).
  Kayıtta özet de yazdırılır (ortalama / ortanca / en düşük IoU). Görüntü kaydedilmez.
  Bunlar araştırma önerisindeki "otomatik başlangıç bölgesi ile elle düzeltilmiş bölgenin
  örtüşmesi ve kurulum süresi" ölçümleridir.

## 2. Çalıştırma

```
.venv\Scripts\python table_camera.py
.venv\Scripts\python table_camera.py --source salon.mp4
```

Pencerede masalar renklenir (yeşil boş, kırmızı dolu, turuncu toplanacak); bulunan insanlar ve
nesneler kutu içinde gösterilir. Takip ve poz yöntemlerinde her kişinin ayak noktası da `#iz`
kimliğiyle çizilir: yeşil = masaya atanmış, gri = atanmamış (yürüyor, yeni geldi ya da ayakta).
Poz yönteminde kimliğin yanında duruş yazar: `O` oturuyor, `A` ayakta, `?` belirsiz. **Q** ile çıkılır. Pencere istemezsen `--no-window`.

Kamera açmadan bir fotoğrafta denemek için (sunucuya bir şey göndermez):

```
.venv\Scripts\python table_camera.py --image ornek.jpg
```

## 3. Video üzerinde değerlendirme (yöntem karşılaştırması)

`evaluate_video.py`, kayıtlı bir salon videosunu gerçek zaman beklemeden baştan sona işler. Her
örnekleme anında **aynı tespitlerden** üç ham gözlem çıkarır (kutu kesişimi, takip + ayak konumu,
takip + ayak konumu + oturma bilgisi) ve bunları altı yönteme verir. Böylece her bileşenin
katkısı ayrı görünür:

| Yöntem | Kişi–masa ataması | Karar |
|---|---|---|
| `referans` | Kutu kesişimi | Her kare kendi kararını verir |
| `zamansal` | Kutu kesişimi | Duruma özgü doğrulama süreleri + gözlem boşluğu toleransı |
| `takip` | Takip + ayak konumu + masada kalma | Her kare kendi kararını verir |
| `takip_zamansal` | Takip + ayak konumu + masada kalma | Aynı zamansal doğrulama |
| `poz` | Takip + ayak konumu + masada kalma + oturma bilgisi | Her kare kendi kararını verir |
| `poz_zamansal` | Takip + ayak konumu + masada kalma + oturma bilgisi | Aynı zamansal doğrulama |

Poz modelini çalıştırmamak için `--no-pose` (yalnız ilk dört yöntem).

```
.venv/Scripts/python evaluate_video.py salon.mp4 --labels salon_etiket.csv
```

Çıktılar `degerlendirme/<video adı>/` klasörüne yazılır (gitignore'da; görüntü içermez):

- `ham.csv`: her örnekleme anında masa başına ham durum (`ham_durum` kesişim, `ham_takip` takip, `ham_poz` poz) ve kare işlem süresi
- `kararlar_<yontem>.csv`: kesinleşen durum değişiklikleri (video saniyesiyle)
- `sonuc.md`, `sonuc.json`: etiket verildiyse ölçütler

Doğrulama sürelerini ve toleransı **doğrulama videosunda** seçmek için video yeniden işlenmeden
farklı değerler denenebilir:

```
.venv/Scripts/python evaluate_video.py --from-raw degerlendirme/salon/ham.csv --labels salon_etiket.csv --hold Dolu=3,Bos=8,Toplanacak=8 --gap 2
```

`--from-raw` takip ve poz parametrelerini (`dwell_seconds`, `still_ratio`, `pose` eşikleri) değiştirmez; onları denemek
için video yeniden işlenir. Seçilen değerler `config.json`'a yazılır. Nihai test videosu bu ayarı seçerken kullanılmaz; yalnızca en sonda bir kez değerlendirilir.

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
| Kare süresi | Karenin çözülmesi + tespit + takip + poz + sınıflandırma | ≤ 1 sn |

Sonuçlar yalnızca o kayıtlar için geçerlidir; ardışık kareler bağımsız örnek sayılmaz.

## Ayarlar (`config.json`)

| Anahtar | Açıklama |
|---|---|
| `camera_source` | Görüntü kaynağı: kamera numarası, `http://`/`rtsp://` adresi ya da video dosyası (yukarıya bak). Eski `camera_index` de okunur |
| `model` | `yolov8n.pt` hızlı; daha isabetli ama yavaş: `yolov8s.pt` |
| `confidence` | Tespit eşiği (0–1). Yanlış tespit çoksa artır |
| `seat_margin` | Krokiyle eşlemede masa alanının sandalye payı (kroki birimi; masa 75 birim civarındadır) |
| `person_overlap` | İnsan kutusunun masa alanıyla kesişme oranı; bu oranın altındaki insan o masada sayılmaz (kesişim yöntemi) |
| `person_assignment` | Canlı çalışmada kişi–masa ataması: `kesisim` (varsayılan), `takip` ya da `poz` |
| `tracking` | Takip ayarları: `tracker` (`bytetrack.yaml`), `dwell_seconds` (masada en az kalma, sn), `still_ratio` (bu sürede boyuna oranla en çok yer değiştirme), `forget_seconds` (görünmeyen izin unutulma süresi) |
| `pose` | Poz ayarları: `model` (`yolov8n-pose.pt`), `keypoint_confidence` (eklem güveni alt sınırı), `sit_knee_angle` / `stand_knee_angle` (derece), `sit_thigh_ratio` / `stand_thigh_ratio` (uyluk dikeyi / gövde), `standing_share` (masada kalma süresinde "ayakta" gözlem payı), `match_iou` (poz kutusu ile takip kutusu eşleşmesi). Eşikler başlangıç değeridir; doğrulama videosunda ayarlanır |
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
- Ayak noktası kutunun alt kenarıdır. Ayaklar masa altında ya da görüntünün dışındaysa kutunun
  alt kenarı gerçek ayak konumu değildir; oturan kişide bu genellikle masa bölgesine düşer, ama
  tavan açısındaki gerçek videoda ölçülmelidir. Takip örnekleme aralığında (0,5 sn) yapılır;
  hızlı yürüyen kişinin kimliği değişebilir, bu da onun masaya atanmasını zorlaştırır (bilerek temkinli).
- Poz eşikleri yandan/önden çekilmiş görüntülerle sınanmıştır; tavandan dik bakışta diz açısı ve
  uyluk oranı kısalır. Oturan kişide dizler çoğu zaman masanın altında kalır, bu durumda duruş
  belirsizdir. Eşikler ve poz yönteminin katkısı salon videosunda ölçülmelidir.
- Bir kamera birden fazla masayı izleyebilir; birden fazla kamera için programı ayrı `--config`
  dosyalarıyla birden çok kez çalıştır.
