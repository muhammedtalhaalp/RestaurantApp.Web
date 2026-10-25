using Microsoft.AspNet.SignalR;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Hubs;
using System;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    
    [AllowAnonymous]
    public class AiVisionController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        [HttpPost]
        public JsonResult ReportHygieneViolation(string violationType)
        {
            try
            {
                var violation = new HygieneViolations
                {
                    ViolationType = violationType,
                    DetectedAt = DateTime.Now,
                    IsResolved = false
                };

                db.HygieneViolations.Add(violation);
                db.SaveChanges();

                // SignalR ile Mutfak ekranına anlık uyarı gönderiyoruz
                var hubContext = GlobalHost.ConnectionManager.GetHubContext<OrderHub>();
                hubContext.Clients.All.receiveHygieneAlert(violationType, DateTime.Now.ToString("HH:mm:ss"));

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