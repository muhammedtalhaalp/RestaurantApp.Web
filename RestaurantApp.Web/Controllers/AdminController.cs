using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using System;
using System.IO;
using System.Linq;
using System.Web;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin")]
    public class AdminController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Index()
        {
            return View();
        }

        public ActionResult Dashboard()
        {
            return View();
        }

        public ActionResult StaffManagement()
        {
            return View();
        }

        public ActionResult MenuManagement()
        {
            return View();
        }

        #region PERSONEL İŞLEMLERİ

        [HttpGet]
        public JsonResult GetStaffList()
        {
            try
            {
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
        public JsonResult AddStaff(string FullName, string Email, string Role)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(FullName) || string.IsNullOrWhiteSpace(Email) || string.IsNullOrWhiteSpace(Role))
                {
                    return Json(new { success = false, message = "Lütfen tüm alanları eksiksiz doldurun." });
                }

                bool isExist = db.AppUsers.Any(u => u.Email == Email || u.Username == Email);
                if (isExist)
                {
                    return Json(new { success = false, message = "Bu e-posta adresiyle zaten kayıtlı bir personel bulunmaktadır." });
                }

                // Otomatik 6 Haneli Rastgele Şifre Üret (100000 - 999999)
                Random random = new Random();
                string generatedPassword = random.Next(100000, 999999).ToString();

                var adminUser = db.AppUsers.FirstOrDefault(u => u.Role == "Admin");
                int currentCompanyId = adminUser != null ? adminUser.CompanyId : 1;
                string currentCompanyName = adminUser != null ? adminUser.CompanyName : "MTA";

                var newStaff = new AppUsers
                {
                    FullName = FullName,
                    Username = Email,
                    Email = Email,
                    PasswordHash = generatedPassword, // Otomatik üretilen şifre kaydedildi
                    Role = Role,
                    IsActive = true,
                    CreatedDate = DateTime.Now,
                    CompanyId = currentCompanyId,
                    CompanyName = currentCompanyName
                };

                db.AppUsers.Add(newStaff);
                db.SaveChanges();

                // Personelin e-posta adresine hoş geldin mesajı ve üretilen şifre gönderiliyor
                bool mailSent = EmailHelper.SendWelcomeEmail(Email, FullName, generatedPassword, Role);

                if (mailSent)
                {
                    return Json(new { success = true, message = "Personel eklendi ve 6 haneli giriş şifresi e-posta adresine gönderildi." });
                }
                else
                {
                    return Json(new { success = true, message = "Personel kaydedildi fakat e-posta gönderilirken bir sorun oluştu. Geçici Şifre: " + generatedPassword });
                }
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

        // 1. Masa Yönetimi Ekranı
        [HttpGet]
        public ActionResult TableManagement()
        {
            var tables = db.AppTables.Where(t => t.IsActive).ToList();
            return View(tables);
        }

        // 2. Yeni Masa Ekle
        [HttpPost]
        public JsonResult AddTable(string tableNumber)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(tableNumber))
                {
                    return Json(new { success = false, message = "Masa numarası/adı boş olamaz." });
                }

                var existingTable = db.AppTables.FirstOrDefault(t => t.TableNumber == tableNumber && t.IsActive);
                if (existingTable != null)
                {
                    return Json(new { success = false, message = "Bu masa numarası zaten kayıtlı!" });
                }

                var newTable = new AppTables
                {
                    TableNumber = tableNumber,
                    Status = "Bos",
                    IsActive = true
                };

                db.AppTables.Add(newTable);
                db.SaveChanges();

                return Json(new { success = true, message = "Masa başarıyla eklendi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        // 3. Masa Sil / Pasife Al
        [HttpPost]
        public JsonResult DeleteTable(int id)
        {
            try
            {
                var table = db.AppTables.Find(id);
                if (table == null)
                {
                    return Json(new { success = false, message = "Masa bulunamadı." });
                }

                table.IsActive = false;
                db.SaveChanges();

                return Json(new { success = true, message = "Masa silindi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        #region KATEGORİ İŞLEMLERİ

        [HttpGet]
        public JsonResult GetCategories(int companyId)
        {
            var categories = db.AppCategories
                .Where(c => c.CompanyId == companyId && c.IsActive)
                .Select(c => new
                {
                    c.CategoryId,
                    c.CategoryName
                }).ToList();

            return Json(new { success = true, data = categories }, JsonRequestBehavior.AllowGet);
        }

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
                CompanyId = companyId,
                IsActive = true
            };

            db.AppCategories.Add(category);
            db.SaveChanges();

            CacheHelper.Remove("AllCategories");

            return Json(new { success = true, message = "Kategori başarıyla eklendi.", categoryId = category.CategoryId });
        }

        #endregion

        #region MENÜ / ÜRÜN İŞLEMLERİ (CACHE DESTEKLİ)

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

        [HttpGet]
        public JsonResult GetProductById(int productId)
        {
            var product = db.AppProducts
                .Where(p => p.ProductId == productId)
                .Select(p => new
                {
                    p.ProductId,
                    p.ProductName,
                    p.Price,
                    p.CategoryId,
                    p.Description,
                    p.ImageUrl,
                    p.IsAvailable,
                    p.CompanyId
                }).FirstOrDefault();

            if (product == null)
            {
                return Json(new { success = false, message = "Ürün bulunamadı." }, JsonRequestBehavior.AllowGet);
            }

            return Json(new { success = true, data = product }, JsonRequestBehavior.AllowGet);
        }

        [HttpPost]
        public JsonResult AddProduct(AppProducts product)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(product.ProductName))
                {
                    return Json(new { success = false, message = "Ürün adı boş geçilemez." });
                }

                if (product.CompanyId == 0)
                {
                    var admin = db.AppUsers.FirstOrDefault(u => u.Role == "Admin");
                    product.CompanyId = admin != null ? admin.CompanyId : 1;
                }

                if (string.IsNullOrWhiteSpace(product.ImageUrl))
                {
                    product.ImageUrl = "/Content/images/default-food.png";
                }

                product.IsAvailable = true;

                db.AppProducts.Add(product);
                db.SaveChanges();

                CacheHelper.Remove($"Company_Products_{product.CompanyId}");

                return Json(new { success = true, message = "Ürün menüye başarıyla eklendi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ürün eklenirken hata: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult UpdateProduct(AppProducts updatedProduct)
        {
            try
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

                if (product.CompanyId.HasValue)
                {
                    CacheHelper.Remove($"Company_Products_{product.CompanyId.Value}");
                }

                return Json(new { success = true, message = "Ürün bilgileri başarıyla güncellendi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Güncelleme hatası: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult DeleteProduct(int productId)
        {
            try
            {
                var product = db.AppProducts.FirstOrDefault(p => p.ProductId == productId);
                if (product == null)
                {
                    return Json(new { success = false, message = "Silinmek istenen ürün bulunamadı." });
                }

                int? companyId = product.CompanyId;

                db.AppProducts.Remove(product);
                db.SaveChanges();

                if (companyId.HasValue)
                {
                    CacheHelper.Remove($"Company_Products_{companyId.Value}");
                }

                return Json(new { success = true, message = "Ürün menüden başarıyla silindi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ürün silinirken hata oluştu: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult UploadProductImage(HttpPostedFileBase imageFile)
        {
            try
            {
                if (imageFile != null && imageFile.ContentLength > 0)
                {
                    string fileName = Guid.NewGuid().ToString() + Path.GetExtension(imageFile.FileName);
                    string folderPath = Server.MapPath("~/Content/images/products/");

                    if (!Directory.Exists(folderPath))
                    {
                        Directory.CreateDirectory(folderPath);
                    }

                    string fullPath = Path.Combine(folderPath, fileName);
                    imageFile.SaveAs(fullPath);

                    string dbImageUrl = "/Content/images/products/" + fileName;
                    return Json(new { success = true, imageUrl = dbImageUrl });
                }

                return Json(new { success = false, message = "Lütfen geçerli bir resim dosyası seçin." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Resim yükleme hatası: " + ex.Message });
            }
        }

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