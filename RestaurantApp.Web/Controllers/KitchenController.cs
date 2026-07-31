using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    public class KitchenController : Controller
    {
        // Mutfak Şefi Ekranı
        public ActionResult Index()
        {
            return View();
        }
    }
}