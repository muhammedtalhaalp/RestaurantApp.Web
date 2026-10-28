using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using System;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer")]
    public class CategoryController : TenantController
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

       
        [HttpGet]
        public JsonResult GetCategories()
        {
            try
            {
                int targetCompanyId = CurrentCompanyId;

                var categories = db.AppCategories
                    .Where(c => c.CompanyId == targetCompanyId)
                    .Select(c => new
                    {
                        c.CategoryId,
                        c.CategoryName,
                        c.CompanyId,
                        c.IsActive,
                        productCount = c.AppProducts.Count(p => p.IsActive)
                    }).ToList();

                return Json(new { success = true, data = categories }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Kategoriler yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult ToggleCategoryStatus(int categoryId)
        {
            try
            {
                var category = db.AppCategories.FirstOrDefault(c => c.CategoryId == categoryId && c.CompanyId == CurrentCompanyId);
                if (category == null)
                {
                    return Json(new { success = false, message = "Kategori bulunamadı." });
                }

                category.IsActive = !category.IsActive;
                db.SaveChanges();

                CacheHelper.Remove("AllCategories");

                string statusMessage = category.IsActive ? "Kategori aktif edildi." : "Kategori donduruldu / pasife alındı.";
                return Json(new { success = true, isActive = category.IsActive, message = statusMessage });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult Create(string categoryName)
        {
            if (string.IsNullOrWhiteSpace(categoryName))
            {
                return Json(new { success = false, message = "Kategori adı boş olamaz." });
            }

            int targetCompanyId = CurrentCompanyId;

            AppCategories category = new AppCategories
            {
                CategoryName = categoryName,
                CompanyId = targetCompanyId,
                IsActive = true
            };

            db.AppCategories.Add(category);
            db.SaveChanges();

            CacheHelper.Remove("AllCategories");

            return Json(new { success = true, message = "Kategori başarıyla eklendi.", categoryId = category.CategoryId });
        }

       
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult Update(int categoryId, string categoryName)
        {
            if (string.IsNullOrWhiteSpace(categoryName))
            {
                return Json(new { success = false, message = "Kategori adı boş olamaz." });
            }

            var category = db.AppCategories.FirstOrDefault(c => c.CategoryId == categoryId && c.CompanyId == CurrentCompanyId);
            if (category == null)
            {
                return Json(new { success = false, message = "Kategori bulunamadı." });
            }

            category.CategoryName = categoryName;
            db.SaveChanges();

            CacheHelper.Remove("AllCategories");

            return Json(new { success = true, message = "Kategori güncellendi." });
        }

        
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult Delete(int id)
        {
            var category = db.AppCategories.FirstOrDefault(c => c.CategoryId == id && c.CompanyId == CurrentCompanyId);
            if (category != null)
            {
                db.AppCategories.Remove(category);
                db.SaveChanges();

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