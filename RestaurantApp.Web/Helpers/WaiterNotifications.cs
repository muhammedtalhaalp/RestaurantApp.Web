using System.Collections.Generic;
using System.Linq;
using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // Garsonların telefonuna giden bildirimler. Web'deki "hazır siparişler" zili gibi, mutfak bir masa siparişinin
    // ürünlerini hazır yapınca restorandaki bütün aktif garsonlara gider.
    public static class WaiterNotifications
    {
        public const string WaiterRole = "Garson";

        public static void ItemsReady(RestaurantAppDBEntities db, AppOrders order, IList<string> readyItems)
        {
            if (order.OrderType != "Masa" || readyItems == null || !readyItems.Any()) return;

            string table = order.AppTables != null ? order.AppTables.TableNumber : "Masa";
            string body = string.Join(", ", readyItems);
            if (body.Length > 140) body = body.Substring(0, 140) + "…";

            var data = new Dictionary<string, string>
            {
                { "type", "itemsReady" },
                { "orderId", order.OrderId.ToString() },
                { "tableId", order.TableId?.ToString() ?? "" }
            };

            var waiterIds = db.AppUsers
                .Where(u => u.CompanyId == order.CompanyId && u.Role == WaiterRole && u.IsActive)
                .Select(u => u.UserId)
                .ToList();

            foreach (int waiterId in waiterIds)
            {
                PushNotifier.NotifyUser(waiterId, $"{table}: sipariş hazır", body, data, PushNotifier.TableChannelId);
            }
        }
    }
}
