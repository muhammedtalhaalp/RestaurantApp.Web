using Microsoft.AspNet.SignalR;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Hubs;
using System;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    // Mutfak kamerasındaki hijyen tespit programı bu uca bildirim gönderir.
    // Program önce bir Mutfak hesabıyla /Auth/ApiLogin üzerinden giriş yapmalı ve aldığı token'ı
    // "Authorization: Bearer <token>" başlığıyla göndermelidir. İhlal, token'daki restorana kaydedilir.
    [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
    public class AiVisionController : TenantController
    {
        private const int MaxViolationTypeLength = 100;

        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        [HttpPost]
        public JsonResult ReportHygieneViolation(string violationType)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(violationType))
                {
                    return Json(new { success = false, message = "İhlal türü boş olamaz." });
                }

                violationType = violationType.Trim();
                if (violationType.Length > MaxViolationTypeLength)
                {
                    violationType = violationType.Substring(0, MaxViolationTypeLength);
                }

                int companyId = CurrentCompanyId;

                var violation = new HygieneViolations
                {
                    CompanyId = companyId,
                    ViolationType = violationType,
                    DetectedAt = DateTime.Now,
                    IsResolved = false
                };

                db.HygieneViolations.Add(violation);
                db.SaveChanges();

                // SignalR ile sadece bu restoranın mutfak ekranına anlık uyarı gönderiyoruz
                var hubContext = GlobalHost.ConnectionManager.GetHubContext<OrderHub>();
                hubContext.Clients.Group(OrderHub.CompanyGroup(companyId)).receiveHygieneAlert(violationType, DateTime.Now.ToString("HH:mm:ss"));

                return Json(new { success = true, message = "İhlal sisteme başarıyla kaydedildi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata oluştu: " + ex.Message });
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}
