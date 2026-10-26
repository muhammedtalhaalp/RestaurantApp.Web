-- AppOrderDetails: ürün bazlı ödeme takibi ve ürün ekleme zamanı
--   PaidQuantity : satırın kaç adedinin ödendiği (ürün bazlı ödemede satır artık silinmiyor)
--   CreatedDate  : ürünün siparişe eklendiği zaman (mutfak bekleme süresi bundan hesaplanır)
-- Tekrar çalıştırılabilir: kolonlar zaten varsa atlanır.

USE RestaurantAppDB;
GO

IF COL_LENGTH('dbo.AppOrderDetails', 'PaidQuantity') IS NULL
BEGIN
    ALTER TABLE dbo.AppOrderDetails
        ADD PaidQuantity int NOT NULL
            CONSTRAINT DF_AppOrderDetails_PaidQuantity DEFAULT (0);
END
GO

IF COL_LENGTH('dbo.AppOrderDetails', 'CreatedDate') IS NULL
BEGIN
    ALTER TABLE dbo.AppOrderDetails
        ADD CreatedDate datetime NOT NULL
            CONSTRAINT DF_AppOrderDetails_CreatedDate DEFAULT (GETDATE());

    -- Mevcut satırlar için en iyi tahmin: bağlı siparişin oluşturulma zamanı
    EXEC('UPDATE d SET d.CreatedDate = o.CreatedDate
          FROM dbo.AppOrderDetails d
          INNER JOIN dbo.AppOrders o ON o.OrderId = d.OrderId');
END
GO
