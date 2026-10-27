-- Paket servis: kanal, müşteri, ödeme planı ve teslimat takibi alanları (AppOrders)
--   OrderChannel        : Telefon / GelAl / Yemeksepeti / Getir / Trendyol / Diger  (Helpers/DeliveryOptions)
--   CustomerName/Phone  : müşteri bilgisi
--   ExternalOrderNo     : platformun sipariş numarası (ör. Yemeksepeti sipariş no)
--   DeliveryPaymentPlan : Online (platformda/peşin ödendi) / KapidaNakit / KapidaKart
--   OnlineAmount        : platformun tahsil ettiği tutar (kasaya girmez, nakit/kart kolonlarından ayrı)
--   ChangeFor           : kapıda nakitte müşterinin vereceği para (para üstü hesabı için)
--   OutForDeliveryDate  : kuryenin yola çıktığı an
--   CancelReason        : iptal sebebi
-- Tekrar çalıştırılabilir: kolonlar zaten varsa atlanır.

USE RestaurantAppDB;
GO

IF COL_LENGTH('dbo.AppOrders', 'OrderChannel') IS NULL
BEGIN
    ALTER TABLE dbo.AppOrders ADD
        OrderChannel        nvarchar(30)   NULL,
        CustomerName        nvarchar(100)  NULL,
        CustomerPhone       nvarchar(30)   NULL,
        ExternalOrderNo     nvarchar(50)   NULL,
        DeliveryPaymentPlan nvarchar(20)   NULL,
        OnlineAmount        decimal(18, 2) NULL,
        ChangeFor           decimal(18, 2) NULL,
        OutForDeliveryDate  datetime       NULL,
        CancelReason        nvarchar(250)  NULL;

    -- Eski paket siparişleri telefonla alınmış, kapıda nakit ödenecek siparişler olarak kabul edilir
    EXEC('UPDATE dbo.AppOrders
          SET OrderChannel = N''Telefon'', DeliveryPaymentPlan = N''KapidaNakit''
          WHERE OrderType = N''PaketServis''');
END
GO
