using System.Linq;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;// Rol ve yetki kontrolü için

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin")] // Sadece Yönetici erişebilir
    public class CategoryController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // 1. Kategorileri Önbellekten Listele
        public ActionResult Index()
        {
            // Veri önce Cache'e bakılır, yoksa DB'den çekilip 30 dakika Cache'e atılır
            var categories = CacheHelper.GetOrAdd("AllCategories", () =>
            {
                return db.AppCategories.Where(c => c.IsActive).ToList();
            });

            return View(categories);
        }

        // 2. Yeni Kategori Ekle (POST)
        [HttpPost]
        public ActionResult Create(string categoryName)
        {
            if (!string.IsNullOrEmpty(categoryName))
            {
                AppCategories category = new AppCategories
                {
                    CategoryName = categoryName,
                    IsActive = true
                };

                db.AppCategories.Add(category);
                db.SaveChanges();

                // Veri değiştiği için Önbelleği temizliyoruz
                CacheHelper.Remove("AllCategories");
            }

            return RedirectToAction("Index");
        }

        // 3. Kategori Sil / Pasife Al (POST)
        [HttpPost]
        public ActionResult Delete(int id)
        {
            var category = db.AppCategories.Find(id);
            if (category != null)
            {
                // Veritabanından tamamen silmek yerine IsActive = false yapıyoruz (Soft Delete)
                category.IsActive = false;
                db.SaveChanges();

                // Veri değiştiği için Önbelleği temizliyoruz
                CacheHelper.Remove("AllCategories");
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