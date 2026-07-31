using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    public class AdminController : Controller
    {
        // Yönetici Ekranı (Menü ekleme / çıkarabilme ve Personel Yönetimi)
        public ActionResult Dashboard()
        {
            return View();
        }
    }
}