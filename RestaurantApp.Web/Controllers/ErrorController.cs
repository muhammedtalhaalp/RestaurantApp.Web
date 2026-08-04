using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    public class ErrorController : Controller
    {
        // /Error/AccessDenied
        [HttpGet]
        public ActionResult AccessDenied()
        {
            Response.StatusCode = 403;
            return View();
        }
    }
}