-- Hijyen ihlali anındaki kamera karesinin dosya adı.
-- Dosyalar web'den doğrudan erişilemeyen App_Data\hygiene\<CompanyId>\ klasöründe tutulur,
-- yalnızca AiVisionController.GetViolationImage üzerinden (yetki ve şirket kontrolüyle) gösterilir.
-- Tekrar çalıştırılabilir: kolon zaten varsa atlanır.

USE RestaurantAppDB;
GO

IF COL_LENGTH('dbo.HygieneViolations', 'ImageFileName') IS NULL
BEGIN
    ALTER TABLE dbo.HygieneViolations ADD ImageFileName nvarchar(100) NULL;
END
GO
