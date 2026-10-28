using System.Collections.Generic;
using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // Kuryenin telefonuna giden bildirimlerin metinleri. "type" alanı mobil uygulamada hangi olay olduğunu söyler.
    public static class CourierNotifications
    {
        public static void Assigned(AppOrders order)
        {
            if (!order.CourierId.HasValue) return;

            string body = Join(order.CustomerName, order.DeliveryAddress);
            if (DeliveryOptions.IsKitchenReady(order))
                body = "Hazır, restorandan alabilirsiniz. " + body;

            PushNotifier.NotifyUser(order.CourierId.Value, $"Yeni teslimat: #{order.OrderId}", body, Data("assigned", order));
        }

        public static void Unassigned(AppOrders order, int previousCourierId)
        {
            PushNotifier.NotifyUser(previousCourierId, $"Teslimat sizden alındı: #{order.OrderId}",
                "Bu sipariş artık size atanmış değil.", Data("unassigned", order));
        }

        public static void Ready(AppOrders order)
        {
            if (!order.CourierId.HasValue) return;
            PushNotifier.NotifyUser(order.CourierId.Value, $"Sipariş hazır: #{order.OrderId}",
                "Restorandan alıp yola çıkabilirsiniz. " + Join(order.CustomerName, order.DeliveryAddress), Data("ready", order));
        }

        public static void Cancelled(AppOrders order)
        {
            if (!order.CourierId.HasValue) return;
            PushNotifier.NotifyUser(order.CourierId.Value, $"Teslimat iptal edildi: #{order.OrderId}",
                string.IsNullOrEmpty(order.CancelReason) ? "Sipariş iptal edildi." : "Sebep: " + order.CancelReason,
                Data("cancelled", order));
        }

        private static Dictionary<string, string> Data(string type, AppOrders order)
        {
            return new Dictionary<string, string> { { "type", type }, { "orderId", order.OrderId.ToString() } };
        }

        private static string Join(string customer, string address)
        {
            string text = string.IsNullOrWhiteSpace(customer) ? (address ?? "") : customer + (string.IsNullOrWhiteSpace(address) ? "" : " · " + address);
            return text.Length > 140 ? text.Substring(0, 140) + "…" : text;
        }
    }
}
