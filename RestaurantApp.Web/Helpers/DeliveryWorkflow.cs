using System;
using System.Linq;
using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // Paket siparişin teslimat adımları. Kasiyer panosu (DeliveryController) ve kurye ekranı
    // (CourierController) aynı kuralları kullanır. Metotlar siparişi değiştirir ama kaydetmez;
    // hata varsa mesajı döner, başarılıysa null döner.
    public static class DeliveryWorkflow
    {
        public static bool IsOpen(AppOrders order)
        {
            return order.Status != "Tamamlandı" && order.Status != "İptal";
        }

        public static string MarkOutForDelivery(AppOrders order, DateTime now)
        {
            if (!IsOpen(order))
                return "Açık paket siparişi bulunamadı.";

            if (order.OrderChannel == DeliveryOptions.ChannelPickup)
                return "Gel-Al siparişleri yola çıkmaz; hazır olunca doğrudan teslim edilir.";

            if (order.Status == DeliveryOptions.StatusOutForDelivery)
                return "Sipariş zaten yolda.";

            if (!DeliveryOptions.IsKitchenReady(order))
                return "Mutfak bu siparişi henüz hazırlamadı.";

            MarkItemsServed(order);
            order.Status = DeliveryOptions.StatusOutForDelivery;
            order.OutForDeliveryDate = now;
            return null;
        }

        // Kapıda ödemeliyse tahsilat aynı adımda alınır; paymentMethod: "Nakit" veya "Kart"
        public static string CompleteDelivery(AppOrders order, string paymentMethod, DateTime now)
        {
            if (!IsOpen(order))
                return "Açık paket siparişi bulunamadı.";

            bool isPickup = order.OrderChannel == DeliveryOptions.ChannelPickup;
            if (!isPickup && order.Status != DeliveryOptions.StatusOutForDelivery)
                return "Önce siparişi 'Yola Çıktı' olarak işaretleyin.";

            if (isPickup && !DeliveryOptions.IsKitchenReady(order))
                return "Mutfak bu siparişi henüz hazırlamadı.";

            decimal due = order.TotalAmount;
            if (due > 0)
            {
                if (paymentMethod == "Nakit")
                    order.CashAmount = (order.CashAmount ?? 0) + due;
                else if (paymentMethod == "Kart")
                    order.CreditCardAmount = (order.CreditCardAmount ?? 0) + due;
                else
                    return "Lütfen tahsilat şeklini (Nakit / Kart) seçiniz.";

                order.TotalAmount = 0;
                order.PaymentType = (isPickup ? "Gişede " : "Kapıda ") + paymentMethod;
            }

            MarkItemsServed(order);
            order.DeliveredDate = now;
            order.CompletedDate = now;
            order.Status = "Tamamlandı";
            return null;
        }

        // Teslim edilen ürünler mutfak / garson listelerinden düşsün diye "Servis Edildi" yapılır
        private static void MarkItemsServed(AppOrders order)
        {
            foreach (var item in order.AppOrderDetails.Where(d => !d.IsReturned))
            {
                item.ReturnReason = "Servis Edildi";
            }
        }
    }
}
