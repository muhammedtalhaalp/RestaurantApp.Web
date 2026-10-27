# LezzetPOS Hijyen Kamerası

Mutfaktaki kameradan görüntü alır, bir Roboflow nesne tespit modeliyle personelin **bonesi** ve
**önlüğü** olup olmadığını kontrol eder. İhlal görürse fotoğrafıyla birlikte LezzetPOS'a bildirir;
LezzetPOS da yalnızca o restoranın **mutfak ekranına** alarm sesi ve fotoğraflı uyarı gönderir.

```
[Kamera] → hygiene_camera.py ──(bonesiz/önlüksüz)──→ LezzetPOS /AiVision/ReportHygieneViolation ──SignalR──→ Mutfak ekranı 🚨
            Roboflow modeli                            ihlal + fotoğraf kaydedilir
```

## Nasıl karar veriyor?

- Kamera görüntüsü her `check_interval_seconds` saniyede bir (varsayılan 1 sn) modele gönderilir.
- Modelin bulduğu sınıflardan `violation_classes` listesinde olanlar **ihlal** sayılır
  (ör. `bonesiz`, `no-hairnet`). Büyük/küçük harf, `_`, `-` ve boşluk farkı önemsizdir.
- Her sınıfın kendi güven eşiği olabilir (`class_confidence`); eşiğin altındaki tespitler sayılmaz.
- Tek karelik yanlış tespitlerde alarm çalmasın diye: bir ihlal, son `detection_window` (5)
  kontrolün en az `detections_required` (3) tanesinde görülürse bildirim tetiklenir.
- Bildirim tetiklenince, **aynı 5 kontrolde görülen diğer ihlaller de eklenir**. Model önlüğü her
  karede yakalayamasa bile bonesiz ve önlüksüz kişi için tek uyarı gider:
  "Bone takılmamış, Önlük giyilmemiş". Fotoğraf olarak bu 5 kareden en çok ihlal içereni seçilir.
- Aynı ihlal türü bildirildikten sonra `cooldown_seconds` (60) saniye boyunca tekrar bildirilmez.
- Canlı pencerede ihlal kutuları **kırmızı**, diğer tespitler **yeşil** çizilir. Gönderilen
  fotoğrafta da bu kutular görünür.

## 1. Kurulum (bir kez)

Python 3.10+ gerekir. Bu klasörde:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy config.example.json config.json
```

`config.json` git'e girmez (şifre ve API anahtarı içerir).

## 2. Kamera için LezzetPOS hesabı

Kamera programı LezzetPOS'a bir personel gibi giriş yapar. Uyarılar bu hesabın restoranına gider.

1. Admin olarak **Personel Yönetimi**'nden yeni bir personel ekle, rolü **Mutfak** olsun
   (ör. ad: "Mutfak Kamerası", e-posta: `kamera@restoraniniz.com`).
2. Geçici şifre bu e-postaya gelir. `config.json` içine yaz:

```json
"server_url": "https://localhost:44309",
"verify_ssl": false,
"username": "kamera@restoraniniz.com",
"password": "e-postayla-gelen-sifre",
```

`verify_ssl: false` sadece geliştirmede (IIS Express'in kendi imzalı sertifikası için) gerekir.
Gerçek sunucuda `true` yap.

## 3. Modelsiz deneme (önce bunu yap)

LezzetPOS çalışırken (Visual Studio'da F5) ve mutfak ekranı bir tarayıcıda açıkken:

```powershell
.venv\Scripts\python.exe hygiene_camera.py --test-once
```

Tek bir test ihlali gönderir; mutfak ekranında fotoğraflı uyarı çıkmalı.

Canlı pencereyle denemek için:

```powershell
.venv\Scripts\python.exe hygiene_camera.py --demo
```

Pencerede **B** = "Bone takılmamış", **O** = "Önlük giyilmemiş" ihlali gönderir, **Q** çıkar.

## 4. Hazır Roboflow modeliyle çalıştırma

1. [roboflow.com](https://roboflow.com)'da ücretsiz hesap aç. **Settings → API Keys**'ten
   **Private API Key**'i kopyala ve `roboflow.api_key` alanına yaz.
2. [Roboflow Universe](https://universe.roboflow.com)'da ara: `hairnet`, `apron`, `kitchen ppe`.
   Bir modelin sayfasında **Model** sekmesi olmalı (sadece "Dataset" olanlar eğitilmiş model içermez).
3. Model sayfasında görünen model kimliğini (`proje-adi/surum`, ör. `kitchenhygiene/2`) `roboflow.model_id`
   alanına yaz.
4. Modelin **sınıf isimlerine** bak. "Yok" anlamına gelen sınıfları (`no_hairnet`, `no-apron` gibi)
   `violation_classes` içine ekle; değer, mutfak ekranında görünecek Türkçe metindir.

Denenmiş hazır modeller. Ekim 2026'da, bonesiz ve önlüksüz bir kişinin dizüstü kamerasıyla
çekilmiş 19 fotoğrafında karşılaştırıldı:

| `model_id` | Universe projesi | Önlük yok bulunan | Bone yok bulunan | Not |
|---|---|---|---|---|
| `chef-dataset/1` | [ztar-rcuht/chef-dataset](https://universe.roboflow.com/ztar-rcuht/chef-dataset/model/1) | **18/19 (ort. %94)** | **17/19 (ort. %89)** | **Önerilen.** Sınıflar: `without_apron`, `without_cap` |
| `kitchenhygiene/2` | [kitchen-hygiene-efuu5/kitchenhygiene](https://universe.roboflow.com/kitchen-hygiene-efuu5/kitchenhygiene/model/2) | 0/19 | 13/19 (ort. %57) | Mutfak güvenlik kamerası açısında eğitilmiş; yakın çekimde önlüğü göremiyor |
| `kitchen-ppe/2` | [jeans-workspace-6mdhi/kitchen-ppe](https://universe.roboflow.com/jeans-workspace-6mdhi/kitchen-ppe) | 0/19 | 9/19 | 11/19 fotoğrafta yanlışlıkla "bone var" dedi |
| `hairnet/1` | [agts/hairnet](https://universe.roboflow.com/agts/hairnet) | — | (karşılaştırmaya girmedi) | Sadece bone |

Bu modellerin sınıfları `violation_classes` içinde zaten tanımlı. Karşılaştırmada kişi her fotoğrafta
önlüksüzdü; yani test modellerin ihlali **yakalayıp yakalamadığını** ölçtü, önlük takılıyken yanlış
alarm verip vermediğini ölçmedi. Kendi mutfağında, kendi kamera açında önlüklü/önlüksüz deneyerek
doğruluğunu kontrol et. `chef-dataset/1` küçük bir veri setiyle (385 fotoğraf) eğitildiği için
farklı ortamlarda yanılabilir; o durumda kendi modelini eğit (bkz. 5. bölüm).

Çalıştır:

```powershell
.venv\Scripts\python.exe hygiene_camera.py
```

## 5. Kendi modelini eğitme (Roboflow)

1. **Proje oluştur:** Roboflow → New Project → *Object Detection*. Ad: `mutfak-hijyen`.
2. **Sınıflar** (bu isimleri aynen kullanırsan `config.json`'da değişiklik gerekmez):
   - `boneli`, `bonesiz` → kişinin **başını** çevreleyen kutu
   - `onluklu`, `onluksuz` → kişinin **gövdesini** çevreleyen kutu

   "Yok" sınıflarını da etiketlemek önemli: model "bone yok"u ancak böyle öğrenir.
3. **Fotoğraflar:** Her sınıf için en az 100–150 örnek hedefle (toplam 300+ fotoğraf iyi bir başlangıç).
   - Mümkünse gerçek mutfak kamerasının açısından çek; programın kendisiyle de kare toplayabilirsin.
   - Farklı ışık, mesafe, kişi, saç rengi ve kıyafet rengi olsun.
   - Bone yerine şapka, önlük yerine benzer renkli tişört gibi **kafa karıştırıcı** örnekler ekle.
4. **Etiketleme:** Roboflow Annotate ile her kişide hem bone hem önlük kutusunu çiz.
5. **Veri seti sürümü:** Train/Valid/Test = 70/20/10. Önişleme: *Resize 640×640*.
   Augmentation: yatay çevirme, ±%15 parlaklık, hafif bulanıklık.
6. **Eğit:** *Train* → Roboflow'un önerdiği hızlı model (Roboflow 3.0 / YOLO). Eğitim bitince
   mAP değerine bak; düşükse daha çok ve daha çeşitli fotoğraf ekle.
7. Model kimliğini (`mutfak-hijyen/1`) `roboflow.model_id` alanına yaz ve programı çalıştır.

## Ayarlar (`config.json`)

| Alan | Açıklama |
|---|---|
| `server_url` | LezzetPOS adresi |
| `verify_ssl` | Geliştirmede `false`, gerçek sunucuda `true` |
| `username`, `password` | Kameranın **Mutfak** rolündeki LezzetPOS hesabı |
| `camera_index` | Kamera numarası; birden fazla kamera varsa 0, 1, 2… dene |
| `roboflow.api_url` | Roboflow barındırılan tespit API adresi |
| `roboflow.api_key` | Roboflow Private API Key |
| `roboflow.model_id` | `proje/surum` |
| `roboflow.confidence` | En düşük güven yüzdesi (0–100); yanlış alarm çoksa yükselt |
| `roboflow.overlap` | Çakışan kutuları birleştirme eşiği (0–100) |
| `roboflow.class_confidence` | Sınıf bazında güven eşiği; ör. `{"no-apron": 30}`. Model önlüğü daha düşük güvenle bulduğu için önlüğe ayrı, düşük eşik verilir |
| `violation_classes` | İhlal sayılan model sınıfları → mutfak ekranında görünecek metin |
| `check_interval_seconds` | Modelin kaç saniyede bir çağrılacağı (Roboflow kullanım kotasını etkiler) |
| `detection_window`, `detections_required` | Son N kontrolün en az M'inde görülürse bildirim tetiklenir |
| `detections_to_include` | Bildirim tetiklenince, aynı penceredeki kontrollerin en az bu kadarında görülen diğer ihlaller de aynı bildirime eklenir (varsayılan 1: "Bone takılmamış, Önlük giyilmemiş") |
| `cooldown_seconds` | Aynı ihlal türü için iki bildirim arasındaki en kısa süre |

## Sorun giderme

- **Model bir şeyi tespit etmiyor mu?** Modelin her saniye gördüğü her şeyi güven yüzdesiyle görmek için:
  `.venv\Scripts\python.exe hygiene_camera.py --verbose --confidence 25`
  Aranan sınıf düşük güvenle görünüyorsa `config.json`'da `confidence` değerini o seviyeye indir;
  hiç görünmüyorsa kamera açısını (kişinin belden yukarısı görünsün) veya ışığı değiştir.

- **"Kamera açılamadı":** Başka bir program (Zoom, Teams) kamerayı kullanıyor olabilir; `camera_index`'i değiştir.
- **"Bu hesabın ihlal bildirme yetkisi yok":** Hesabın rolü Mutfak, Mutfak Şefi veya Admin olmalı.
- **"Roboflow bağlantı hatası":** API anahtarı veya model kimliği yanlış olabilir; konsoldaki hata mesajına bak.
  Roboflow adresi değişirse `roboflow.api_url` alanını Roboflow belgelerindeki adresle güncelle.
- **Mutfak ekranında uyarı çıkmıyor:** Mutfak ekranındaki kullanıcı ile kamera hesabı **aynı restorana**
  ait olmalı. Mutfak ekranını yenile (F5) ve konsolda "SignalR Bağlantısı Başarılı" yazısını kontrol et.
