using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers; // CacheHelper için
using System;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin")] // Sadece Yönetici erişebilir
    public class CategoryController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // 1. Kategorileri Önbellekten / DB'den Listele
        [HttpGet]
        public JsonResult GetCategories()
        {
            try
            {
                var categories = CacheHelper.GetOrAdd("AllCategories", () =>
                {
                    return db.AppCategories
                        .Where(c => c.IsActive)
                        .Select(c => new
                        {
                            c.CategoryId,
                            c.CategoryName,
                            c.CompanyId,
                            ProductCount = c.AppProducts.Count()
                        }).ToList();
                });

                return Json(new { success = true, data = categories }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Kategoriler yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // 2. Yeni Kategori Ekle (AJAX)
        [HttpPost]
        public JsonResult Create(string categoryName, int? companyId)
        {
            if (string.IsNullOrWhiteSpace(categoryName))
            {
                return Json(new { success = false, message = "Kategori adı boş olamaz." });
            }

            int targetCompanyId = companyId.HasValue && companyId.Value > 0 ? companyId.Value : 1;

            AppCategories category = new AppCategories
            {
                CategoryName = categoryName,
                CompanyId = targetCompanyId,
                IsActive = true
            };

            db.AppCategories.Add(category);
            db.SaveChanges();

            // Cache Temizle
            CacheHelper.Remove("AllCategories");

            return Json(new { success = true, message = "Kategori başarıyla eklendi.", categoryId = category.CategoryId });
        }

        // 3. Kategori Güncelle (AJAX)
        [HttpPost]
        public JsonResult Update(int categoryId, string categoryName)
        {
            if (string.IsNullOrWhiteSpace(categoryName))
            {
                return Json(new { success = false, message = "Kategori adı boş olamaz." });
            }

            var category = db.AppCategories.FirstOrDefault(c => c.CategoryId == categoryId);
            if (category == null)
            {
                return Json(new { success = false, message = "Kategori bulunamadı." });
            }

            category.CategoryName = categoryName;
            db.SaveChanges();

            // Cache Temizle
            CacheHelper.Remove("AllCategories");

            return Json(new { success = true, message = "Kategori güncellendi." });
        }

        // 4. Kategori Sil / Pasife Al (AJAX)
        [HttpPost]
        public JsonResult Delete(int id)
        {
            var category = db.AppCategories.FirstOrDefault(c => c.CategoryId == id);
            if (category != null)
            {
                // Soft Delete: Pasife Çekiyoruz
                category.IsActive = false;
                db.SaveChanges();

                // Cache Temizle
                CacheHelper.Remove("AllCategories");

                return Json(new { success = true, message = "Kategori başarıyla silindi." });
            }

            return Json(new { success = false, message = "Kategori bulunamadı." });
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