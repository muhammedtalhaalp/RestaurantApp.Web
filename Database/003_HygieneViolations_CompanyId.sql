-- Çoklu restoran: hijyen ihlalleri bir şirkete (Companies) bağlanır.
-- Mevcut kayıtlar Admin'i olan ilk şirkete atanır (bu betik yazıldığında tüm veri şirket 1'e aitti).
-- Tekrar çalıştırılabilir: kolon zaten varsa atlanır.

USE RestaurantAppDB;
GO

IF COL_LENGTH('dbo.HygieneViolations', 'CompanyId') IS NULL
BEGIN
    ALTER TABLE dbo.HygieneViolations ADD CompanyId int NULL;

    EXEC('UPDATE dbo.HygieneViolations
          SET CompanyId = (SELECT MIN(u.CompanyId) FROM dbo.AppUsers u WHERE u.Role = N''Admin'')');

    EXEC('ALTER TABLE dbo.HygieneViolations ALTER COLUMN CompanyId int NOT NULL');
    EXEC('ALTER TABLE dbo.HygieneViolations ADD CONSTRAINT FK_HygieneViolations_Companies
          FOREIGN KEY (CompanyId) REFERENCES dbo.Companies (Id)');
    EXEC('CREATE INDEX IX_HygieneViolations_CompanyId ON dbo.HygieneViolations (CompanyId)');
END
GO
