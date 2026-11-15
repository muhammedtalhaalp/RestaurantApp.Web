using System;
using System.Linq;
using System.Runtime.Caching;
using System.Security.Claims;
using System.Web;
using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // Ücretsiz deneme süresi (Companies.TrialEndsAt, Database/012).
    // NULL = süre sınırı yok (abonelik açık ya da eski işletme). Geçmiş bir tarih = deneme bitti:
    // JwtAuthorizeAttribute kullanıcıyı /Subscription/Expired sayfasına yönlendirir, veriler silinmez.
    // Her istekte veritabanına gitmemek için bitiş tarihi 1 dakika önbellekte tutulur;
    // SQL ile süre uzatıldığında en geç 1 dakika içinde geçerli olur.
    public static class TrialStatus
    {
        public const int TrialDays = 14;
        private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(1);

        // Önbellekte null saklanamadığı için tarih bir sarmalayıcıyla tutulur
        private sealed class Entry { public DateTime? EndsAt; }

        private static string Key(int companyId) => "TrialEndsAt_" + companyId;

        public static DateTime? EndsAt(int companyId)
        {
            var cached = MemoryCache.Default.Get(Key(companyId)) as Entry;
            if (cached != null) return cached.EndsAt;

            DateTime? endsAt;
            using (var db = new RestaurantAppDBEntities())
            {
                endsAt = db.Companies.Where(c => c.Id == companyId).Select(c => c.TrialEndsAt).FirstOrDefault();
            }
            MemoryCache.Default.Set(Key(companyId), new Entry { EndsAt = endsAt }, DateTimeOffset.Now.Add(CacheFor));
            return endsAt;
        }

        public static bool IsExpired(int companyId, DateTime now)
        {
            var endsAt = EndsAt(companyId);
            return endsAt.HasValue && now >= endsAt.Value;
        }

        // Kalan gün (yukarı yuvarlanır; bugün bitiyorsa 1). Süre sınırı yoksa null, bittiyse 0.
        public static int? DaysLeft(int companyId, DateTime now)
        {
            var endsAt = EndsAt(companyId);
            if (!endsAt.HasValue) return null;
            var left = endsAt.Value - now;
            return left <= TimeSpan.Zero ? 0 : (int)Math.Ceiling(left.TotalDays);
        }

        public static void Forget(int companyId) => MemoryCache.Default.Remove(Key(companyId));

        // Oturumdaki kullanıcının şirketi (JwtAuthorize'ın doğruladığı token'daki CompanyId); yoksa null
        public static int? CurrentCompanyId(HttpContextBase context)
        {
            var principal = context?.User as ClaimsPrincipal;
            int id;
            return principal != null && int.TryParse(principal.FindFirst(JwtHelper.CompanyIdClaim)?.Value, out id) ? id : (int?)null;
        }
    }

    // Rol → giriş sonrası ana ekran (giriş ve ana sayfa yönlendirmesi ortak kullanır)
    public static class RoleHome
    {
        public static string For(string role)
        {
            if (role == "Admin") return "/Admin/Index";
            if (role == "Mutfak" || role == "Mutfak Şefi") return "/Kitchen/Index";
            if (role == "Garson" || role == "Kasiyer") return "/Order/Index";
            if (role == DeliveryOptions.CourierRole) return "/Courier/Index";
            return "/Order/POS";
        }
    }
}
