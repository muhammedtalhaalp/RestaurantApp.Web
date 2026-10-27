using System.Collections.Generic;
using System.Linq;
using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // Paket servis siparişlerinin kanal ve ödeme planı tanımları. AppOrders.OrderChannel ve
    // AppOrders.DeliveryPaymentPlan bu anahtarları saklar; ekranlar etiketleri buradan alır.
    public static class DeliveryOptions
    {
        public const string StatusOutForDelivery = "Yolda";

        public const string ChannelPhone = "Telefon";
        public const string ChannelPickup = "GelAl";

        public const string PlanOnline = "Online";
        public const string PlanCashOnDelivery = "KapidaNakit";
        public const string PlanCardOnDelivery = "KapidaKart";

        // Anahtar -> ekranda görünen ad. Platform kanalları siparişi kendi sitesinde tahsil eder.
        public static readonly IReadOnlyDictionary<string, string> Channels = new Dictionary<string, string>
        {
            { ChannelPhone, "Telefon" },
            { ChannelPickup, "Gel-Al" },
            { "Yemeksepeti", "Yemeksepeti" },
            { "Getir", "Getir" },
            { "Trendyol", "Trendyol Yemek" },
            { "Diger", "Diğer" }
        };

        public static readonly IReadOnlyDictionary<string, string> PaymentPlans = new Dictionary<string, string>
        {
            { PlanOnline, "Ödendi (Online)" },
            { PlanCashOnDelivery, "Kapıda Nakit" },
            { PlanCardOnDelivery, "Kapıda Kart" }
        };

        private static readonly HashSet<string> PlatformChannels = new HashSet<string> { "Yemeksepeti", "Getir", "Trendyol" };

        public static bool IsValidChannel(string channel)
        {
            return channel != null && Channels.ContainsKey(channel);
        }

        public static bool IsValidPlan(string plan)
        {
            return plan != null && PaymentPlans.ContainsKey(plan);
        }

        public static bool IsPlatform(string channel)
        {
            return channel != null && PlatformChannels.Contains(channel);
        }

        public static string ChannelLabel(string channel)
        {
            string label;
            return channel != null && Channels.TryGetValue(channel, out label) ? label : "Paket Servis";
        }

        public static string PlanLabel(string plan, string channel)
        {
            string label;
            if (plan == null || !PaymentPlans.TryGetValue(plan, out label)) return "";
            // Gel-Al'da ödeme kapıda değil gişede alınır
            return channel == ChannelPickup && plan != PlanOnline ? label.Replace("Kapıda", "Gişede") : label;
        }

        // Paket siparişin mutfak durumu: iade edilmemiş tüm ürünler hazır (veya teslim edilmiş) mi?
        public static bool IsKitchenReady(AppOrders order)
        {
            var activeItems = order.AppOrderDetails.Where(d => !d.IsReturned).ToList();
            return activeItems.Any() && activeItems.All(d => d.ReturnReason == "Hazır" || d.ReturnReason == "Servis Edildi");
        }
    }
}
