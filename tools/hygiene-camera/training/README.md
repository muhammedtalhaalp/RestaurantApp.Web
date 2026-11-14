# Hijyen modelini kendimiz eğitmek

Amaç: Bone ve önlük tespitini Roboflow'un sunucusundaki hazır modelle değil, **kendi eğittiğimiz ve
restoranın bilgisayarında internetsiz çalışan** bir modelle yapmak.

1. **Veri seti** — `python prepare_dataset.py`
   Açık lisanslı altı veri setini (CC BY 4.0 / kamu malı) indirir, sınıfları `bone`, `bonesiz`,
   `onluk`, `onluksuz` olarak birleştirir ve `../dataset/` altına YOLO biçiminde yazar. Kaynaklar ve
   sınıf dağılımı `../dataset/KAYNAKLAR.md` içindedir. Roboflow yalnızca bu indirme için kullanılır:
   anahtar `ROBOFLOW_API_KEY` ortam değişkeninden okunur; `../dataset-cache/` içinde zip'ler varsa gerekmez.
2. **Eğitim** — dizüstü işlemcisinde tam eğitim günler sürdüğü için Google Colab'ın ücretsiz
   ekran kartı kullanılır: `../dataset` klasörü `hijyen-dataset.zip` olarak Drive'a yüklenir,
   `train_colab.ipynb` açılıp "Tümünü çalıştır" denir (YOLOv8s, 640 px, en fazla 60 tur). Çıkan
   `hijyen-model.zip` içinde model (`hijyen/weights/best.pt`), eğitim grafikleri ve hiç görülmemiş
   test bölümündeki sınıf bazında ölçümler vardır.
3. **Kullanım** — `best.pt`, `../models/hijyen.pt` olarak kopyalanır; `hygiene_camera.py` bu dosyayı
   yükler. Ölçümler ve bilinen zayıflıklar `../README.md` 4. bölümde.

## Kendi kameramızla ek veri (ek eğitim)

Açık veri setleri çoğunlukla tavan kamerası ve aşçı kıyafeti içerdiği için yakın çekim webcam'de
ve gündelik kıyafette model zayıf (siyah atleti önlük sanıyor). Kendi kamera açımızdan hem uyumlu
hem ihlalli kareler eklenir. Bütün komutlar `training\` klasöründe, hijyen kamerasının `.venv`'iyle:

1. **Kayıt** — `..\.venv\Scripts\python record_frames.py --not "koyu tişört"`
   Kamera açılır. **Boşluk** kaydı başlatır/duraklatır, **O** önlük var/yok, **B** bone var/yok.
   Kayıt sürerken saniyede bir kare, o anki durumla birlikte `..\kendi-veri\<tarih-saat>\` altına
   yazılır. Her durumda 1–2 dakika kaydet; bu sırada dön, uzaklaş, yaklaş, kolunu kaldır. Önlüğü
   takarken kaydı duraklat. Kıyafet, ışık ya da yer değişince **yeni oturum** aç (`--not` ile yaz).
2. **Kutuları onaylama** — `..\.venv\Scripts\python label_frames.py ..\kendi-veri\<oturum>`
   Poz modeli (YOLOv8n-pose) her kişide baş ve gövde kutusunu önerir; sınıf kayıttaki durumdan
   gelir (bone/bonesiz, onluk/onluksuz). **Enter** onaylar; kutu yanlışsa **1** (baş) ya da
   **2** (gövde) basıp sürükleyerek yeniden çiz; **X / C** baş / gövde kutusunu siler; **D** kareyi
   kullanmaz; **← / Z** geri. Kaldığı yerden devam eder.
3. **Veri setine ekleme** — `..\.venv\Scripts\python add_own_data.py --list`, sonra ör.
   `add_own_data.py --val <oturum> --test <oturum1> <oturum2>`
   Bölme **oturum bazındadır** (aynı oturumun benzer kareleri hem eğitimde hem testte olmasın).
   Test oturumları eğitimde hiç kullanılmaz; ek eğitimin etkisi yalnız onlarla ölçülür. Komut
   tekrar çalıştırılabilir: önceki `kendi_*` kareleri silinip yeniden eklenir.
4. **Eğitim** — yukarıdaki 2. adımdaki gibi `dataset\` yeniden zip'lenip Colab'da eğitilir.
   Yeni model, eski modelle **aynı test oturumlarında** karşılaştırılır.

**Önerilen kayıt planı** (bone yoksa bone sınıfı açık veriden gelir; bone bulununca ek oturum):
önlüklü + koyu üst, önlüklü + açık üst, önlüksüz + koyu üst (siyah atlet dahil), önlüksüz + açık
üst; mümkünse iki farklı gün/ışıkta. Her türden bir oturum teste ayrılır. README'deki 19 fotoğraf
yalnızca testtir, eğitime eklenmez.

**Gizlilik:** `kendi-veri\` kişi görüntüsü içerir; gitignore'dadır ve bu bilgisayarda kalır.
Colab'da eğitim için zip Drive'a yüklenir; bu, kayıttaki kişilerin onayıyla yapılmalıdır.
Görüntüler yapay zekâ sohbet araçlarına yüklenmez.
