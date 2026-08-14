using Microsoft.AspNet.SignalR;
using Microsoft.AspNet.SignalR.Hubs;

namespace RestaurantApp.Web.Hubs
{
    [HubName("orderHub")]
    public class OrderHub : Hub
    {
        public void SendNewOrderCreatedNotification()
        {
            Clients.All.onNewOrderCreated();
        }

        public void SendOrderReadyNotification(int orderId, string tableName, string orderType, string address, string readyItemsSummary)
        {
            Clients.All.onOrderReady(orderId, tableName, orderType, address, readyItemsSummary);
        }

        public void SendOrderDeliveredNotification(int orderId)
        {
            Clients.All.onOrderDelivered(orderId);
        }
    }
}