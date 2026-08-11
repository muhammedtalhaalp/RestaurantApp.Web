using RestaurantApp.Web.Data;
using System;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [AllowAnonymous] // Herkesin üyeliksiz erişebileceği public controller
    public class MenuController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // GET: /Menu veya /Menu/Index
        [HttpGet]
        public ActionResult Index(int? tableId)
        {
            ViewBag.TableId = tableId;
            return View();
        }

        // 1. QR Menü Ana Sayfa Verileri (Slider, Öne Çıkanlar, Kategoriler)
        [HttpGet]
        public JsonResult GetMenuData(int companyId = 1)
        {
            try
            {
                // Aktif Kategoriler
                var categories = db.AppCategories
                    .Where(c => c.CompanyId == companyId && c.IsActive)
                    .Select(c => new
                    {
                        categoryId = c.CategoryId,
                        categoryName = c.CategoryName,
                        // Kategorideki ilk ürünün görselini kategori görseli olarak kullanıyoruz
                        imageUrl = c.AppProducts.Where(p => p.IsActive && !string.IsNullOrEmpty(p.ImageUrl)).Select(p => p.ImageUrl).FirstOrDefault() ?? "/Content/images/default-food.png"
                    }).ToList();

                // En Çok Tercih Edilenler (Stokta olan aktif ilk 6 ürün)
                var popularProducts = db.AppProducts
                    .Where(p => p.CompanyId == companyId && p.IsActive && p.IsAvailable)
                    .OrderByDescending(p => p.ProductId)
                    .Take(6)
                    .Select(p => new
                    {
                        productId = p.ProductId,
                        productName = p.ProductName,
                        price = p.Price,
                        description = p.Description,
                        imageUrl = string.IsNullOrEmpty(p.ImageUrl) ? "/Content/images/default-food.png" : p.ImageUrl
                    }).ToList();

                // Üst Slider İçin Görseli Olan Popüler Ürünler
                var sliderImages = popularProducts
                    .Where(p => !string.IsNullOrEmpty(p.imageUrl) && p.imageUrl != "/Content/images/default-food.png")
                    .Take(4)
                    .ToList();

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        sliderImages = sliderImages,
                        popularProducts = popularProducts,
                        categories = categories
                    }
                }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Menü verileri çekilemedi: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // 2. Kategoriye Ait Ürünleri Getir (Kategoriye tıklandığında çalışır)
        [HttpGet]
        public JsonResult GetProductsByCategory(int categoryId)
        {
            try
            {
                var products = db.AppProducts
                    .Where(p => p.CategoryId == categoryId && p.IsActive)
                    .Select(p => new
                    {
                        productId = p.ProductId,
                        productName = p.ProductName,
                        price = p.Price,
                        description = p.Description,
                        imageUrl = string.IsNullOrEmpty(p.ImageUrl) ? "/Content/images/default-food.png" : p.ImageUrl,
                        isAvailable = p.IsAvailable
                    }).ToList();

                return Json(new { success = true, data = products }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ürünler çekilemedi: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                db.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}