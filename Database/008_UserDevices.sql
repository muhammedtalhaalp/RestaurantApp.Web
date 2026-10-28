-- Mobil uygulamaların (Flutter) Firebase bildirim kimlikleri (FCM token).
-- Bir kullanıcının birden çok telefonu olabilir; bir telefon (token) aynı anda yalnızca bir kullanıcıya aittir:
-- aynı telefonda başka hesapla giriş yapılırsa kayıt yeni kullanıcıya geçer.
-- Tekrar çalıştırılabilir. sqlcmd ile -I parametresiyle çalıştırın.

SET QUOTED_IDENTIFIER ON;
GO

USE RestaurantAppDB;
GO

IF OBJECT_ID(N'dbo.UserDevices', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserDevices
    (
        Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserDevices PRIMARY KEY,
        UserId      INT            NOT NULL,
        Token       NVARCHAR(400)  NOT NULL,
        Platform    NVARCHAR(20)   NOT NULL,
        AppName     NVARCHAR(40)   NULL,
        UpdatedDate DATETIME       NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.FK_UserDevices_AppUsers', N'F') IS NULL
    ALTER TABLE dbo.UserDevices
        ADD CONSTRAINT FK_UserDevices_AppUsers FOREIGN KEY (UserId) REFERENCES dbo.AppUsers (UserId) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_UserDevices_Token' AND object_id = OBJECT_ID(N'dbo.UserDevices'))
    CREATE UNIQUE INDEX UX_UserDevices_Token ON dbo.UserDevices (Token);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserDevices_UserId' AND object_id = OBJECT_ID(N'dbo.UserDevices'))
    CREATE INDEX IX_UserDevices_UserId ON dbo.UserDevices (UserId);
GO
