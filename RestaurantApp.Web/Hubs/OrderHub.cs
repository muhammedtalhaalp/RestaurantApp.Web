using System;
using System.Threading.Tasks;
using Microsoft.AspNet.SignalR;
using Microsoft.AspNet.SignalR.Hubs;
using RestaurantApp.Web.Helpers;

namespace RestaurantApp.Web.Hubs
{
    // Her bağlantı, token'daki şirketin grubuna eklenir; bildirimler sadece aynı restorana gider.
    // İstemci bağlanmadan önce token'ı göndermelidir: $.connection.hub.qs = { access_token: ... }
    [HubName("orderHub")]
    public class OrderHub : Hub
    {
        public static string CompanyGroup(int companyId)
        {
            return "company-" + companyId;
        }

        public override async Task OnConnected()
        {
            await JoinCompanyGroup();
            await base.OnConnected();
        }

        public override async Task OnReconnected()
        {
            await JoinCompanyGroup();
            await base.OnReconnected();
        }

        private async Task JoinCompanyGroup()
        {
            int? companyId = GetCallerCompanyId();
            if (companyId.HasValue)
            {
                await Groups.Add(Context.ConnectionId, CompanyGroup(companyId.Value));
            }
        }

        // Geçerli token yoksa null döner; bu durumda bağlantı hiçbir gruba katılmaz ve bildirim gönderemez
        private int? GetCallerCompanyId()
        {
            string token = Context.QueryString["access_token"];
            if (string.IsNullOrEmpty(token)) return null;

            try
            {
                var principal = JwtHelper.ValidateToken(token);
                return int.Parse(principal.FindFirst(JwtHelper.CompanyIdClaim).Value);
            }
            catch (Exception)
            {
                return null;
            }
        }

        public void SendNewOrderCreatedNotification()
        {
            int? companyId = GetCallerCompanyId();
            if (!companyId.HasValue) return;

            Clients.Group(CompanyGroup(companyId.Value)).onNewOrderCreated();
        }

        public void SendOrderReadyNotification(int orderId, string tableName, string orderType, string address, string readyItemsSummary)
        {
            int? companyId = GetCallerCompanyId();
            if (!companyId.HasValue) return;

            Clients.Group(CompanyGroup(companyId.Value)).onOrderReady(orderId, tableName, orderType, address, readyItemsSummary);
        }

        public void SendOrderDeliveredNotification(int orderId)
        {
            int? companyId = GetCallerCompanyId();
            if (!companyId.HasValue) return;

            Clients.Group(CompanyGroup(companyId.Value)).onOrderDelivered(orderId);
        }
    }
}
