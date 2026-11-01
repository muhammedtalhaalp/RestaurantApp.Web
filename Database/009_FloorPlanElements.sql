-- Kroki öğeleri: mutfak, kasa, fırın, bar, kapı, duvar vb. (masalar AppTables'ta kalır).
-- Önceden bu öğelerin konumu yalnızca tarayıcının localStorage'ında tutuluyordu; artık her restoran
-- ve alan (Salon, Bahçe...) için sunucuda saklanır. Koordinatlar krokinin mantıksal tuvalindedir (1200 x 700).
-- Tekrar çalıştırılabilir. sqlcmd ile -I parametresiyle çalıştırın.

SET QUOTED_IDENTIFIER ON;
GO

USE RestaurantAppDB;
GO

IF OBJECT_ID(N'dbo.FloorPlanElements', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FloorPlanElements
    (
        Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FloorPlanElements PRIMARY KEY,
        CompanyId   INT            NOT NULL,
        Section     NVARCHAR(50)   NOT NULL,
        ElementType NVARCHAR(30)   NOT NULL,
        Label       NVARCHAR(60)   NULL,
        PosX        INT            NOT NULL,
        PosY        INT            NOT NULL,
        Width       INT            NOT NULL,
        Height      INT            NOT NULL,
        Rotation    INT            NOT NULL CONSTRAINT DF_FloorPlanElements_Rotation DEFAULT (0),
        CreatedDate DATETIME       NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.FK_FloorPlanElements_Companies', N'F') IS NULL
    ALTER TABLE dbo.FloorPlanElements
        ADD CONSTRAINT FK_FloorPlanElements_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_FloorPlanElements_Company_Section' AND object_id = OBJECT_ID(N'dbo.FloorPlanElements'))
    CREATE INDEX IX_FloorPlanElements_Company_Section ON dbo.FloorPlanElements (CompanyId, Section);
GO
