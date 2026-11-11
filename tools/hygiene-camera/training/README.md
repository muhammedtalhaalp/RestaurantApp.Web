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

Sonraki adım: kendi mutfak/kamera açımızda hem ihlalli hem uyumlu (boneli, önlüklü) fotoğraflar
eklemek; yanlış alarm oranı ancak böyle ölçülebilir.
