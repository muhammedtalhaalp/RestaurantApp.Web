using System.Linq;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;// Rol ve yetki kontrolü için

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin")] // Sadece Yönetici erişebilir
    public class ProductController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // 1. Ürünleri Önbellekten Listele
        public ActionResult Index()
        {
            // Veri önce Cache'e bakılır, yoksa DB'den çekilip 30 dakika Cache'e atılır
            var products = CacheHelper.GetOrAdd("AllProducts", () =>
            {
                return db.AppProducts.Where(p => p.IsActive).ToList();
            });

            return View(products);
        }

        // 2. Yeni Ürün Ekle (POST)
        [HttpPost]
        public ActionResult Create(int categoryId, string productName, decimal price, string imageUrl)
        {
            if (!string.IsNullOrEmpty(productName) && price > 0)
            {
                AppProducts product = new AppProducts
                {
                    CategoryId = categoryId,
                    ProductName = productName,
                    Price = price,
                    ImageUrl = imageUrl,
                    IsActive = true
                };

                db.AppProducts.Add(product);
                db.SaveChanges();

                // Ürün listesi değiştiği için önbelleği temizliyoruz
                CacheHelper.Remove("AllProducts");
            }

            return RedirectToAction("Index");
        }

        // 3. Ürün Sil / Pasife Al (POST)
        [HttpPost]
        public ActionResult Delete(int id)
        {
            var product = db.AppProducts.Find(id);
            if (product != null)
            {
                product.IsActive = false;
                db.SaveChanges();

                // Ürün listesi değiştiği için önbelleği temizliyoruz
                CacheHelper.Remove("AllProducts");
            }

            return RedirectToAction("Index");
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