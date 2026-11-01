-- Masa doluluk kamerası (tools/table-camera): kameranın gördüğü son durum.
-- CameraStatus: 'Bos' | 'Dolu' | 'Toplanacak' (kimse yok ama masada tabak/bardak kalmış).
-- CameraStatusDate: kameranın bu masa için son bildirim zamanı; eskiyse (kamera kapalı) durum yok sayılır.
-- Bu bilgi yalnızca uyarı amaçlıdır; siparişlere ve AppTables.Status'a dokunmaz.
-- Tekrar çalıştırılabilir. sqlcmd ile -I parametresiyle çalıştırın.

SET QUOTED_IDENTIFIER ON;
GO

USE RestaurantAppDB;
GO

IF COL_LENGTH(N'dbo.AppTables', N'CameraStatus') IS NULL
    ALTER TABLE dbo.AppTables ADD CameraStatus NVARCHAR(20) NULL;
GO

IF COL_LENGTH(N'dbo.AppTables', N'CameraStatusDate') IS NULL
    ALTER TABLE dbo.AppTables ADD CameraStatusDate DATETIME NULL;
GO
