using Microsoft.AspNet.SignalR;
using Microsoft.AspNet.SignalR.Hubs;

namespace RestaurantApp.Web.Hubs
{
    [HubName("orderHub")]
    public class OrderHub : Hub
    {
        // Garson sipariş verdiğinde Mutfak ekranına anlık haber verir
        public void SendNewOrderCreatedNotification()
        {
            Clients.All.onNewOrderCreated();
        }

        // Mutfak şefi "Hazır" butonuna bastığında çağıracağı metot
        public void SendOrderReadyNotification(int orderId, string tableName, string orderType, string address)
        {
            Clients.All.onOrderReady(orderId, tableName, orderType, address);
        }

        // Garson bildirimi onayladığında durum güncellemesi fırlatır
        public void SendOrderDeliveredNotification(int orderId)
        {
            Clients.All.onOrderDelivered(orderId);
        }
    }
}