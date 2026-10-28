-- "Garson/Kasiyer" birleşik rolü kaldırıldı: bu roldeki personel "Kasiyer" olur.
-- Garsonlar ileride mobil garson uygulamasını "Garson" rolüyle kullanacak.
-- Tekrar çalıştırılabilir. sqlcmd ile -I parametresiyle çalıştırın (AppUsers'a bağlı filtreli indeks var).

SET QUOTED_IDENTIFIER ON;
GO

USE RestaurantAppDB;
GO

UPDATE dbo.AppUsers SET Role = N'Kasiyer' WHERE Role = N'Garson/Kasiyer';
GO
