using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    // Tanıtım sayfası (site açılışı). Herkese açıktır; giriş yapmış kullanıcıya "Uygulamaya git" gösterilir.
    [AllowAnonymous]
    public class HomeController : Controller
    {
        public ActionResult Index()
        {
            var role = Session["UserRole"] as string;
            ViewBag.AppUrl = !string.IsNullOrEmpty(role) && Session["JWToken"] != null ? Helpers.RoleHome.For(role) : null;
            return View();
        }
    }
}
