-- Paket servis Faz 2: kurye ataması, gün sonu kurye kasası ve platform komisyonu
--   AppOrders.CourierId           : siparişi götüren kurye (AppUsers, rol "Kurye")
--   AppOrders.CourierAssignedDate : kuryeye atanma zamanı
--   AppOrders.CourierSettledDate  : kuryenin bu siparişte topladığı nakdin kasaya teslim alındığı an (gün sonu hesap kapatma)
--   AppOrders.CommissionRate      : sipariş anındaki platform komisyon oranı (%). Oran sonradan değişse de geçmiş siparişler etkilenmez.
--   ChannelSettings               : restoran bazında kanal ayarları (şimdilik komisyon oranı)
-- Tekrar çalıştırılabilir: her adım kendi varlığını kontrol eder.
-- Filtreli indeks için QUOTED_IDENTIFIER açık olmalı (sqlcmd varsayılan olarak kapalı başlatır).

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE RestaurantAppDB;
GO

IF COL_LENGTH('dbo.AppOrders', 'CourierId') IS NULL
    ALTER TABLE dbo.AppOrders ADD CourierId int NULL;
IF COL_LENGTH('dbo.AppOrders', 'CourierAssignedDate') IS NULL
    ALTER TABLE dbo.AppOrders ADD CourierAssignedDate datetime NULL;
IF COL_LENGTH('dbo.AppOrders', 'CourierSettledDate') IS NULL
    ALTER TABLE dbo.AppOrders ADD CourierSettledDate datetime NULL;
IF COL_LENGTH('dbo.AppOrders', 'CommissionRate') IS NULL
    ALTER TABLE dbo.AppOrders ADD CommissionRate decimal(5, 2) NULL;
GO

IF OBJECT_ID('dbo.FK_AppOrders_Courier', 'F') IS NULL
    ALTER TABLE dbo.AppOrders ADD CONSTRAINT FK_AppOrders_Courier
        FOREIGN KEY (CourierId) REFERENCES dbo.AppUsers (UserId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AppOrders_CourierId' AND object_id = OBJECT_ID('dbo.AppOrders'))
    CREATE INDEX IX_AppOrders_CourierId ON dbo.AppOrders (CourierId) WHERE CourierId IS NOT NULL;
GO

IF OBJECT_ID('dbo.ChannelSettings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChannelSettings
    (
        Id             int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_ChannelSettings PRIMARY KEY,
        CompanyId      int           NOT NULL CONSTRAINT FK_ChannelSettings_Companies REFERENCES dbo.Companies (Id),
        Channel        nvarchar(30)  NOT NULL,
        CommissionRate decimal(5, 2) NOT NULL CONSTRAINT DF_ChannelSettings_CommissionRate DEFAULT (0),
        UpdatedDate    datetime      NOT NULL CONSTRAINT DF_ChannelSettings_UpdatedDate DEFAULT (GETDATE()),
        CONSTRAINT UQ_ChannelSettings_Company_Channel UNIQUE (CompanyId, Channel),
        CONSTRAINT CK_ChannelSettings_CommissionRate CHECK (CommissionRate >= 0 AND CommissionRate <= 100)
    );
END
GO
