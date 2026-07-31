using System.Web.Mvc;
using RestaurantApp.Web.Filters;

namespace RestaurantApp.Web.Controllers
{
    public class OrderController : Controller
    {
        // Garson ve Kasiyerler erişebilir
        public ActionResult POS()
        {
            return View();
        }
    }
}