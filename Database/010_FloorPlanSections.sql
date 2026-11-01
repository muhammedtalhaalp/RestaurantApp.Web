-- Kroki alanları (katlar / bölümler) ve yayın durumu.
-- Admin krokiyi taslak olarak çizer (masalar AppTables'ta, öğeler FloorPlanElements'ta anında kaydedilir).
-- "Yayınla" denince o alanın o anki çizimi PublishedJson'a kopyalanır; masa seçim ekranları yalnızca bu
-- yayınlanmış kopyayı kullanır. Yayından sonraki düzenlemeler tekrar yayınlanana kadar kasaya yansımaz.
-- Tekrar çalıştırılabilir. sqlcmd ile -I parametresiyle çalıştırın.

SET QUOTED_IDENTIFIER ON;
GO

USE RestaurantAppDB;
GO

IF OBJECT_ID(N'dbo.FloorPlanSections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FloorPlanSections
    (
        Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FloorPlanSections PRIMARY KEY,
        CompanyId     INT            NOT NULL,
        Section       NVARCHAR(50)   NOT NULL,
        SortOrder     INT            NOT NULL CONSTRAINT DF_FloorPlanSections_SortOrder DEFAULT (0),
        IsPublished   BIT            NOT NULL CONSTRAINT DF_FloorPlanSections_IsPublished DEFAULT (0),
        PublishedJson NVARCHAR(MAX)  NULL,
        PublishedDate DATETIME       NULL,
        UpdatedDate   DATETIME       NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.FK_FloorPlanSections_Companies', N'F') IS NULL
    ALTER TABLE dbo.FloorPlanSections
        ADD CONSTRAINT FK_FloorPlanSections_Companies FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_FloorPlanSections_Company_Section' AND object_id = OBJECT_ID(N'dbo.FloorPlanSections'))
    CREATE UNIQUE INDEX UX_FloorPlanSections_Company_Section ON dbo.FloorPlanSections (CompanyId, Section);
GO
