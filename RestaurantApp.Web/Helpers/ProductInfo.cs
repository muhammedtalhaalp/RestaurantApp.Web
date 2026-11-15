using System.Collections.Generic;
using System.Configuration;

namespace RestaurantApp.Web.Helpers
{
    // Tanıtım sayfası (Home/Index) ve "deneme süresi doldu" sayfası (Subscription/Expired) için ortak içerik:
    // paketler (fiyatsız; fiyat için iletişim) ve Web.config'teki iletişim bilgileri.
    public static class ProductInfo
    {
        public class Plan
        {
            public string Key { get; set; }
            public string Name { get; set; }
            public string Tagline { get; set; }
            public string Icon { get; set; }
            public bool Highlighted { get; set; }
            public string Badge { get; set; }
            public string[] Features { get; set; }
        }

        public static readonly IReadOnlyList<Plan> Plans = new[]
        {
            new Plan
            {
                Key = "salon", Name = "Salon", Icon = "fa-utensils",
                Tagline = "Masa servisi yapan restoran ve kafeler için",
                Features = new[]
                {
                    "Hızlı POS, adisyon ve parçalı ödeme",
                    "Masa yönetimi ve salon krokisi",
                    "Mutfak ekranı ve anlık sipariş bildirimi",
                    "QR menü",
                    "Ciro raporları ve personel rolleri"
                }
            },
            new Plan
            {
                Key = "salon-paket", Name = "Salon + Paket", Icon = "fa-motorcycle", Highlighted = true, Badge = "En kapsamlı",
                Tagline = "Paket servis de yapan işletmeler için",
                Features = new[]
                {
                    "Salon paketindeki her şey",
                    "Paket servis panosu (Telefon, Gel-Al, platformlar)",
                    "Kurye ataması ve gün sonu kurye kasası",
                    "Kurye ve garson mobil uygulaması, anlık bildirim",
                    "Platform komisyonu ve kanal bazında net ciro"
                }
            },
            new Plan
            {
                Key = "akilli", Name = "Akıllı Restoran", Icon = "fa-wand-magic-sparkles", Badge = "Pilot",
                Tagline = "Yapay zekâ modülleriyle (pilot kullanım)",
                Features = new[]
                {
                    "Salon + Paket paketindeki her şey",
                    "Kamerayla masa doluluk takibi (boş / dolu / toplanacak)",
                    "Mutfakta bone ve önlük kontrolü",
                    "Görüntü işletmede işlenir, sunucuya gönderilmez",
                    "Kurulum ve kamera yerleşimi desteği"
                }
            }
        };

        public static string ContactEmail => Setting("ContactEmail");
        public static string ContactPhone => Setting("ContactPhone");
        public static string ContactWhatsApp => Setting("ContactWhatsApp");
        public static bool HasContact => ContactEmail != null || ContactPhone != null || ContactWhatsApp != null;

        private static string Setting(string key)
        {
            var value = ConfigurationManager.AppSettings[key];
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
    }
}
