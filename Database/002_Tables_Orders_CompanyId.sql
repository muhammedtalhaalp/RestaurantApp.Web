-- Çoklu restoran: masalar ve siparişler bir şirkete (Companies) bağlanır.
--   AppOrders.CompanyId : siparişi açan kullanıcının şirketi
--   AppTables.CompanyId : masada sipariş açan kullanıcıların şirketi; hiç siparişi olmayan masa
--                         için Admin'i olan ilk şirket (bu betik yazıldığında tüm veri şirket 1'e aitti)
-- Tekrar çalıştırılabilir: kolonlar zaten varsa atlanır.

USE RestaurantAppDB;
GO

IF COL_LENGTH('dbo.AppOrders', 'CompanyId') IS NULL
BEGIN
    ALTER TABLE dbo.AppOrders ADD CompanyId int NULL;

    EXEC('UPDATE o SET o.CompanyId = u.CompanyId
          FROM dbo.AppOrders o
          INNER JOIN dbo.AppUsers u ON u.UserId = o.UserId');

    EXEC('ALTER TABLE dbo.AppOrders ALTER COLUMN CompanyId int NOT NULL');
    EXEC('ALTER TABLE dbo.AppOrders ADD CONSTRAINT FK_AppOrders_Companies
          FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)');
    EXEC('CREATE INDEX IX_AppOrders_CompanyId_CreatedDate ON dbo.AppOrders (CompanyId, CreatedDate)');
END
GO

IF COL_LENGTH('dbo.AppTables', 'CompanyId') IS NULL
BEGIN
    ALTER TABLE dbo.AppTables ADD CompanyId int NULL;

    EXEC('UPDATE t SET t.CompanyId = COALESCE(
              (SELECT TOP 1 o.CompanyId FROM dbo.AppOrders o WHERE o.TableId = t.TableId ORDER BY o.CreatedDate DESC),
              (SELECT MIN(u.CompanyId) FROM dbo.AppUsers u WHERE u.Role = N''Admin''))
          FROM dbo.AppTables t');

    EXEC('ALTER TABLE dbo.AppTables ALTER COLUMN CompanyId int NOT NULL');
    EXEC('ALTER TABLE dbo.AppTables ADD CONSTRAINT FK_AppTables_Companies
          FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)');
    EXEC('CREATE INDEX IX_AppTables_CompanyId ON dbo.AppTables (CompanyId)');
END
GO
