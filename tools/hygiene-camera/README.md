# LezzetPOS Hijyen Kamerası

Mutfaktaki kameradan görüntü alır, **kendi eğittiğimiz** YOLOv8 modeliyle personelin **bonesi** ve
**önlüğü** olup olmadığını kontrol eder. Model bu bilgisayarda çalışır: kamera görüntüsü hiçbir
tespit servisine gönderilmez, internet bağlantısı yalnızca LezzetPOS sunucusu için gerekir. İhlal görürse fotoğrafıyla birlikte LezzetPOS'a bildirir;
LezzetPOS da yalnızca o restoranın **mutfak ekranına** alarm sesi ve fotoğraflı uyarı gönderir.

```
[Kamera] → hygiene_camera.py ──(bonesiz/önlüksüz)──→ LezzetPOS /AiVision/ReportHygieneViolation ──SignalR──→ Mutfak ekranı 🚨
         yerel model (models/hijyen.pt)                 ihlal + fotoğraf kaydedilir
```

## Nasıl karar veriyor?

- Kamera görüntüsü her `check_interval_seconds` saniyede bir (varsayılan 1 sn) modele verilir.
- Modelin bulduğu sınıflardan `violation_classes` listesinde olanlar **ihlal** sayılır
  (`bonesiz`, `onluksuz`). Büyük/küçük harf, `_`, `-` ve boşluk farkı önemsizdir.
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

`requirements.txt` ultralytics'i (PyTorch) kurar. Ekran kartı olmayan bilgisayarda daha küçük CPU sürümü için
önce `.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu` çalıştır.

`config.json` git'e girmez (kamera hesabının şifresini içerir).

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

## 4. Modelle çalıştırma

Model dosyası `models/hijyen.pt` olarak repoda gelir (YOLOv8s, 22 MB). Başka bir modeli denemek için
`model.path` alanını değiştir.

```powershell
.venv\Scripts\python.exe hygiene_camera.py
```

Model, açık lisanslı 6 veri setinin birleştirilmesiyle bizim tarafımızdan eğitildi; nasıl yeniden
eğitileceği `training/README.md` içinde. Sınıflar: `bone`, `bonesiz`, `onluk`, `onluksuz`.

**Ölçümler** (Kasım 2026, `best.pt`, 60 tur):

| Sınıf | Test mAP@0.5 | Kesinlik | Duyarlılık |
|---|---|---|---|
| bone | 0,975 | 0,964 | 0,940 |
| bonesiz | 0,973 | 0,972 | 0,953 |
| onluk | 0,967 | 0,943 | 0,935 |
| onluksuz | 0,927 | 0,915 | 0,858 |
| **Genel** | **0,960** | 0,949 | 0,922 |

Test bölümü, eğitimde hiç kullanılmayan 764 görüntüdür. Dizüstü işlemcide (i5-1135G7) bir kare yaklaşık 0,15 sn sürer.

**Bilinen zayıflık:** Veri setleri çoğunlukla mutfak tavan kamerası ve aşçı kıyafeti içeriyor. Ev ortamında,
dizüstü kamerasıyla yakından çekilmiş 19 fotoğrafta (kişi bonesiz ve önlüksüz, siyah atletli) model
önlüksüzlüğü yalnızca 2/19, bonesizliği 5/19 yakaladı; siyah atleti önlük sandı. Daha önce kullanılan
Roboflow modeli `chef-dataset/1` aynı fotoğraflarda 18/19 ve 17/19 bulmuştu. Kendi kamera açından
önlüklü/önlüksüz, boneli/bonesiz görüntüler eklenip ek eğitim yapılması planlanıyor.

## Ayarlar (`config.json`)

| Alan | Açıklama |
|---|---|
| `server_url` | LezzetPOS adresi |
| `verify_ssl` | Geliştirmede `false`, gerçek sunucuda `true` |
| `username`, `password` | Kameranın **Mutfak** rolündeki LezzetPOS hesabı |
| `camera_index` | Kamera numarası; birden fazla kamera varsa 0, 1, 2… dene |
| `model.path` | Model dosyası (bu klasöre göre); varsayılan `models/hijyen.pt` |
| `model.confidence` | En düşük güven yüzdesi (0–100); yanlış alarm çoksa yükselt |
| `model.overlap` | Çakışan kutuları birleştirme eşiği (0–100) |
| `model.class_confidence` | Sınıf bazında güven eşiği; ör. `{"onluksuz": 40}`. Önlüksüzlük daha düşük güvenle bulunduğu için ayrı, düşük eşik verilir |
| `violation_classes` | İhlal sayılan model sınıfları → mutfak ekranında görünecek metin |
| `check_interval_seconds` | Modelin kaç saniyede bir çalışacağı (işlemci yükünü etkiler) |
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
- **"Model dosyası bulunamadı":** `models/hijyen.pt` yoksa eğitilen `best.pt`'yi bu ada kopyala.
- **Eski `config.json` uyarısı:** `roboflow` bölümü artık kullanılmıyor; `config.example.json`'daki `model` bölümünü kopyala.
- **Mutfak ekranında uyarı çıkmıyor:** Mutfak ekranındaki kullanıcı ile kamera hesabı **aynı restorana**
  ait olmalı. Mutfak ekranını yenile (F5) ve konsolda "SignalR Bağlantısı Başarılı" yazısını kontrol et.
