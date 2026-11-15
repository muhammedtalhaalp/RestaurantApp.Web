using System;
using System.Linq;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;

namespace RestaurantApp.Web.Controllers
{
    // Ücretsiz deneme süresi dolan işletmenin kullanıcıları buraya yönlendirilir (JwtAuthorizeAttribute).
    // Veriler silinmez; süre uzatılınca (Database/012'deki UPDATE) kullanıcı kaldığı yerden devam eder.
    [JwtAuthorize]
    [AllowExpiredTrial]
    public class SubscriptionController : TenantController
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Expired()
        {
            DateTime? endsAt = TrialStatus.EndsAt(CurrentCompanyId);
            if (!endsAt.HasValue || DateTime.Now < endsAt.Value)
            {
                // Süre dolmamışsa (ya da uzatıldıysa) bu sayfada işi yok
                return Redirect(RoleHome.For(Session["UserRole"] as string));
            }

            ViewBag.CompanyName = db.Companies.Where(c => c.Id == CurrentCompanyId).Select(c => c.Name).FirstOrDefault();
            ViewBag.EndedAt = endsAt.Value;
            ViewBag.IsAdmin = (Session["UserRole"] as string) == "Admin";
            ViewBag.FullName = Session["FullName"] as string;
            return View();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}
