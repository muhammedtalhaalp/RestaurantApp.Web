using System;
using System.Data.Entity.Infrastructure;
using System.Linq;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;

namespace RestaurantApp.Web.Controllers
{
    // Mobil uygulamaların Firebase bildirim kimliğini (FCM token) kaydeder. Uygulama girişten sonra ve token
    // yenilendiğinde RegisterToken'ı, çıkışta UnregisterToken'ı çağırır. Bildirimler Helpers/PushNotifier ile gider.
    [JwtAuthorize]
    public class DeviceController : TenantController
    {
        private const int MaxTokenLength = 400;
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        [HttpPost]
        public JsonResult RegisterToken(string token, string platform, string appName)
        {
            token = token?.Trim();
            if (string.IsNullOrEmpty(token) || token.Length > MaxTokenLength)
                return Json(new { success = false, message = "Geçersiz bildirim kimliği." });

            platform = platform == "ios" ? "ios" : "android";
            appName = string.IsNullOrWhiteSpace(appName) ? null : appName.Trim();
            if (appName != null && appName.Length > 40) appName = appName.Substring(0, 40);

            // Aynı telefonda başka hesapla giriş yapıldıysa kayıt yeni kullanıcıya geçer
            var device = db.UserDevices.FirstOrDefault(d => d.Token == token);
            if (device == null)
            {
                device = new UserDevices { Token = token };
                db.UserDevices.Add(device);
            }

            device.UserId = CurrentUserId;
            device.Platform = platform;
            device.AppName = appName;
            device.UpdatedDate = DateTime.Now;

            try
            {
                db.SaveChanges();
            }
            catch (DbUpdateException)
            {
                // Aynı token aynı anda iki kez kaydedilmeye çalışıldı; ilk kayıt yeterli
            }

            return Json(new { success = true });
        }

        [HttpPost]
        public JsonResult UnregisterToken(string token)
        {
            token = token?.Trim();
            int userId = CurrentUserId;
            db.UserDevices.RemoveRange(db.UserDevices.Where(d => d.Token == token && d.UserId == userId));
            db.SaveChanges();
            return Json(new { success = true });
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}
