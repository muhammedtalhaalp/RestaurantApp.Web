-- Ücretsiz deneme süresi: kayıt olan işletme 14 gün dener (AuthController.ApiRegister).
-- TrialEndsAt NULL = süre sınırı yok (abonelik açık / eski işletmeler). Dolu ve geçmişse
-- giriş yapan kullanıcı "Deneme süreniz doldu" sayfasına yönlendirilir; veriler silinmez.
-- Süre uzatmak / aboneliği açmak için:  UPDATE dbo.Companies SET TrialEndsAt = NULL WHERE Id = <id>;
--                     (ya da yeni bir tarih)  UPDATE dbo.Companies SET TrialEndsAt = '2026-12-31' WHERE Id = <id>;
-- Tekrar çalıştırılabilir. sqlcmd ile -I parametresiyle çalıştırın.

SET QUOTED_IDENTIFIER ON;
GO

USE RestaurantAppDB;
GO

IF COL_LENGTH(N'dbo.Companies', N'TrialEndsAt') IS NULL
    ALTER TABLE dbo.Companies ADD TrialEndsAt DATETIME NULL;
GO
