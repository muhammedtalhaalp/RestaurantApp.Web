using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers; // CacheHelper kullanımı için
using System;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin")] // Görev 2.2: Sadece Yönetici rolündekiler erişebilir
    public class AdminController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // 1. Ana Sayfa (Şimdilik boş beyaz sayfa)
        public ActionResult Index()
        {
            return View();
        }

        // 2. Dashboard View (Kontrol Paneli)
        public ActionResult Dashboard()
        {
            return View();
        }

        // 3. Personel Yönetimi View
        public ActionResult StaffManagement()
        {
            return View();
        }

        #region PERSONEL İŞLEMLERİ

        // Personel Listesini Getirir
        [HttpGet]
        public JsonResult GetStaffList()
        {
            try
            {
                // Mutfak Şefi ve Garson/Kasiyer rollerindeki kullanıcıları getirir
                var staffList = db.AppUsers
                    .Where(u => u.Role == "Mutfak Şefi" || u.Role == "Garson/Kasiyer" || u.Role == "Garson" || u.Role == "Kasiyer" || u.Role == "Mutfak")
                    .Select(u => new
                    {
                        id = u.UserId,
                        fullName = u.FullName,
                        email = u.Email,
                        role = u.Role
                    }).ToList();

                return Json(new { success = true, data = staffList }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Personeller yüklenirken hata oluştu: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        public JsonResult AddStaff(string FullName, string Email, string Role, string Password)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(FullName) || string.IsNullOrWhiteSpace(Email) || string.IsNullOrWhiteSpace(Role) || string.IsNullOrWhiteSpace(Password))
                {
                    return Json(new { success = false, message = "Lütfen tüm alanları eksiksiz doldurun." });
                }

                // Aynı e-posta var mı kontrolü
                bool isExist = db.AppUsers.Any(u => u.Email == Email);
                if (isExist)
                {
                    return Json(new { success = false, message = "Bu e-posta adresiyle zaten kayıtlı bir personel bulunmaktadır." });
                }

                // Admin kullanıcısını alıyoruz
                var adminUser = db.AppUsers.FirstOrDefault(u => u.Role == "Admin");

                // CompanyId veritabanında doğrudan 'int' olduğu için '.HasValue' kullanılmaz
                int currentCompanyId = adminUser != null ? adminUser.CompanyId : 1;
                string currentCompanyName = adminUser != null ? adminUser.CompanyName : "MTA";

                // Yeni Personel Oluşturma
                var newStaff = new AppUsers
                {
                    FullName = FullName,
                    Username = Email,
                    Email = Email,
                    PasswordHash = Password,
                    Role = Role,
                    IsActive = true,
                    CreatedDate = DateTime.Now,
                    CompanyId = currentCompanyId,
                    CompanyName = currentCompanyName
                };

                db.AppUsers.Add(newStaff);
                db.SaveChanges();

                return Json(new { success = true, message = "Personel başarıyla kaydedildi." });
            }
            catch (System.Data.Entity.Validation.DbEntityValidationException dbEx)
            {
                var errorMessages = dbEx.EntityValidationErrors
                        .SelectMany(x => x.ValidationErrors)
                        .Select(x => x.PropertyName + ": " + x.ErrorMessage);

                string fullErrorMessage = string.Join(" | ", errorMessages);
                return Json(new { success = false, message = "Doğrulama Hatası: " + fullErrorMessage });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Personel eklenirken hata oluştu: " + ex.Message });
            }
        }

        // Personel Silme
        [HttpPost]
        public JsonResult DeleteStaff(int id)
        {
            try
            {
                var staff = db.AppUsers.FirstOrDefault(u => u.UserId == id);
                if (staff == null)
                {
                    return Json(new { success = false, message = "Silinmek istenen personel bulunamadı." });
                }

                db.AppUsers.Remove(staff);
                db.SaveChanges();

                return Json(new { success = true, message = "Personel başarıyla silindi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Personel silinirken hata oluştu: " + ex.Message });
            }
        }

        #endregion

        #region KATEGORİ İŞLEMLERİ

        // Şirkete ait kategorileri getirir
        [HttpGet]
        public JsonResult GetCategories(int companyId)
        {
            var categories = db.AppCategories
                .Where(c => c.CompanyId == companyId)
                .Select(c => new
                {
                    c.CategoryId,
                    c.CategoryName
                }).ToList();

            return Json(new { success = true, data = categories }, JsonRequestBehavior.AllowGet);
        }

        // Yeni Kategori Ekleme
        [HttpPost]
        public JsonResult AddCategory(string categoryName, int companyId)
        {
            if (string.IsNullOrWhiteSpace(categoryName))
            {
                return Json(new { success = false, message = "Kategori adı boş olamaz." });
            }

            var category = new AppCategories
            {
                CategoryName = categoryName,
                CompanyId = companyId
            };

            db.AppCategories.Add(category);
            db.SaveChanges();

            return Json(new { success = true, message = "Kategori başarıyla eklendi.", categoryId = category.CategoryId });
        }

        #endregion

        #region MENÜ / ÜRÜN İŞLEMLERİ (CACHE DESTEKLİ)

        // Görev 2.3: Şirkete ait ürünleri önce Önbellekten (Cache) yoksa DB'den getirir
        [HttpGet]
        public JsonResult GetProducts(int companyId)
        {
            string cacheKey = $"Company_Products_{companyId}";

            var products = CacheHelper.GetOrAdd(cacheKey, () =>
            {
                return db.AppProducts
                    .Where(p => p.CompanyId == companyId)
                    .Select(p => new
                    {
                        p.ProductId,
                        p.ProductName,
                        p.Price,
                        p.CategoryId,
                        CategoryName = p.AppCategories != null ? p.AppCategories.CategoryName : "Kategorisiz",
                        p.Description,
                        p.ImageUrl,
                        p.IsAvailable
                    }).ToList();
            });

            return Json(new { success = true, data = products }, JsonRequestBehavior.AllowGet);
        }

        // Menüye Yeni Ürün Ekleme (Doğrudan AppProducts nesnesi alıyor)
        [HttpPost]
        public JsonResult AddProduct(AppProducts product)
        {
            if (string.IsNullOrWhiteSpace(product.ProductName))
            {
                return Json(new { success = false, message = "Ürün adı boş geçilemez." });
            }

            if (product.CompanyId == 0)
            {
                return Json(new { success = false, message = "Şirket bilgisi eksik!" });
            }

            // Varsayılan resim kontrolü
            if (string.IsNullOrWhiteSpace(product.ImageUrl))
            {
                product.ImageUrl = "/Content/images/default-food.png";
            }

            db.AppProducts.Add(product);
            db.SaveChanges();

            // Görev 2.3: Veri eklendiği için eski önbelleği temizliyoruz
            CacheHelper.Remove($"Company_Products_{product.CompanyId}");

            return Json(new { success = true, message = "Ürün menüye başarıyla eklendi." });
        }

        // Ürün Güncelleme (Doğrudan AppProducts nesnesi alıyor)
        [HttpPost]
        public JsonResult UpdateProduct(AppProducts updatedProduct)
        {
            var product = db.AppProducts.FirstOrDefault(p => p.ProductId == updatedProduct.ProductId);
            if (product == null)
            {
                return Json(new { success = false, message = "Ürün bulunamadı." });
            }

            product.ProductName = updatedProduct.ProductName;
            product.Price = updatedProduct.Price;
            product.CategoryId = updatedProduct.CategoryId;
            product.Description = updatedProduct.Description;

            if (!string.IsNullOrEmpty(updatedProduct.ImageUrl))
            {
                product.ImageUrl = updatedProduct.ImageUrl;
            }

            product.IsAvailable = updatedProduct.IsAvailable;

            db.SaveChanges();

            // Görev 2.3: Veri güncellendiği için önbelleği temizliyoruz
            if (product.CompanyId.HasValue)
            {
                CacheHelper.Remove($"Company_Products_{product.CompanyId.Value}");
            }

            return Json(new { success = true, message = "Ürün bilgileri güncellendi." });
        }

        // Menüden Ürün Çıkarma / Silme
        [HttpPost]
        public JsonResult DeleteProduct(int productId)
        {
            var product = db.AppProducts.FirstOrDefault(p => p.ProductId == productId);
            if (product == null)
            {
                return Json(new { success = false, message = "Silinmek istenen ürün bulunamadı." });
            }

            int? companyId = product.CompanyId;

            db.AppProducts.Remove(product);
            db.SaveChanges();

            // Görev 2.3: Ürün silindiği için önbelleği temizliyoruz
            if (companyId.HasValue)
            {
                CacheHelper.Remove($"Company_Products_{companyId.Value}");
            }

            return Json(new { success = true, message = "Ürün menüden başarıyla çıkarıldı." });
        }

        // Ürünün Stok / Aktiflik Durumunu Değiştirme (Tek tıkla Var/Yok yapma)
        [HttpPost]
        public JsonResult ToggleProductStatus(int productId)
        {
            var product = db.AppProducts.FirstOrDefault(p => p.ProductId == productId);
            if (product == null)
            {
                return Json(new { success = false, message = "Ürün bulunamadı." });
            }

            product.IsAvailable = !product.IsAvailable;
            db.SaveChanges();

            // Görev 2.3: Stok durumu değiştiği için önbelleği temizliyoruz
            if (product.CompanyId.HasValue)
            {
                CacheHelper.Remove($"Company_Products_{product.CompanyId.Value}");
            }

            return Json(new { success = true, isAvailable = product.IsAvailable, message = "Ürün durumu güncellendi." });
        }

        #endregion

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