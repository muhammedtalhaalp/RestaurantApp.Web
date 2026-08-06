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
    // Garson rollerinin metoda erişebilmesi için sınıf düzeyindeki role izinler eklendi
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
    public class AdminController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        [JwtAuthorize(Roles = "Admin")]
        public ActionResult Index()
        {
            return View();
        }

        [JwtAuthorize(Roles = "Admin")]
        public ActionResult Dashboard()
        {
            return View();
        }

        [JwtAuthorize(Roles = "Admin")]
        public ActionResult StaffManagement()
        {
            return View();
        }

        [JwtAuthorize(Roles = "Admin")]
        public ActionResult MenuManagement()
        {
            return View();
        }

        [JwtAuthorize(Roles = "Admin")]
        public ActionResult OrderTracking()
        {
            return View();
        }

        #region PERSONEL İŞLEMLERİ

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult GetStaffList()
        {
            try
            {
                var allowedRoles = new[] { "Mutfak Şefi", "Mutfak", "Garson/Kasiyer", "Garson", "Kasiyer" };

                var staffList = db.AppUsers
                    .Where(u => allowedRoles.Contains(u.Role))
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
        [JwtAuthorize(Roles = "Admin")]
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
                    PasswordHash = generatedPassword,
                    Role = Role,
                    IsActive = true,
                    CreatedDate = DateTime.Now,
                    CompanyId = currentCompanyId,
                    CompanyName = currentCompanyName
                };

                db.AppUsers.Add(newStaff);
                db.SaveChanges();

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
        [JwtAuthorize(Roles = "Admin")]
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

        #region MUTFAK RAPORU İŞLEMLERİ

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public ActionResult KitchenReport()
        {
            return View();
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetKitchenReportByDate(string reportDate)
        {
            try
            {
                DateTime targetDate;
                if (!DateTime.TryParse(reportDate, out targetDate))
                {
                    targetDate = DateTime.Today;
                }

                DateTime startOfDay = targetDate.Date;
                DateTime endOfDay = targetDate.Date.AddDays(1).AddTicks(-1);

                // Seçilen gün içindeki tüm aktif/tamamlanmış/hazırlanmış siparişler ve ürün detayları çekilir
                var queryOrders = db.AppOrders
                    .Where(o => o.CreatedDate >= startOfDay && o.CreatedDate <= endOfDay)
                    .OrderByDescending(o => o.CreatedDate)
                    .ToList();

                var reportData = queryOrders.Select(o => new
                {
                    orderId = o.OrderId,
                    orderType = o.OrderType,
                    orderTime = o.CreatedDate.ToString("HH:mm"),
                    title = o.OrderType == "Masa" && o.AppTables != null ? o.AppTables.TableNumber : "Paket Servis",
                    deliveryAddress = o.DeliveryAddress,
                    totalAmount = o.TotalAmount,
                    items = o.AppOrderDetails.Select(d => new
                    {
                        productId = d.ProductId,
                        productName = d.AppProducts != null ? d.AppProducts.ProductName : "Bilinmeyen Ürün",
                        quantity = d.Quantity,
                        unitPrice = d.UnitPrice,
                        totalLinePrice = d.Quantity * d.UnitPrice
                    }).ToList()
                }).ToList();

                return Json(new { success = true, data = reportData }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Rapor çekilirken hata oluştu: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        #endregion

        #endregion

        #region MASA VE KROKİ İŞLEMLERİ

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public ActionResult TableManagement()
        {
            var tables = db.AppTables.Where(t => t.IsActive).ToList();
            return View(tables);
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public ActionResult FloorPlanManagement()
        {
            var tables = db.AppTables.Where(t => t.IsActive).ToList();
            return View(tables);
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetTables()
        {
            try
            {
                var tables = db.AppTables
                    .Where(t => t.IsActive)
                    .Select(t => new
                    {
                        tableId = t.TableId,
                        tableNumber = t.TableNumber,
                        status = t.Status,
                        section = t.Section ?? "Salon",
                        shape = t.Shape ?? "Square",
                        posX = t.PosX ?? 50,
                        posY = t.PosY ?? 50,
                        width = t.Width ?? 75,
                        height = t.Height ?? 75
                    }).ToList();

                return Json(new { success = true, data = tables }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult AddTable(string tableNumber, string section)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(tableNumber))
                {
                    return Json(new { success = false, message = "Masa adı/numarası boş olamaz." });
                }

                string targetSection = string.IsNullOrWhiteSpace(section) ? "Salon" : section.Trim();

                var existingTable = db.AppTables.FirstOrDefault(t => t.TableNumber == tableNumber && t.IsActive);
                if (existingTable != null)
                {
                    return Json(new { success = false, message = "Bu masa numarası zaten kayıtlı!" });
                }

                var newTable = new AppTables
                {
                    TableNumber = tableNumber,
                    Section = targetSection,
                    Status = "Bos",
                    IsActive = true,
                    Shape = "Square",
                    PosX = 50,
                    PosY = 50,
                    Width = 75,
                    Height = 75
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

        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult SaveTableLayout(int? tableId, string tableNumber, string section, string shape, int posX, int posY, int? width, int? height)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(tableNumber))
                {
                    return Json(new { success = false, message = "Masa adı boş olamaz." });
                }

                AppTables table;

                if (tableId.HasValue && tableId.Value > 0)
                {
                    table = db.AppTables.Find(tableId.Value);
                    if (table == null)
                    {
                        return Json(new { success = false, message = "Masa bulunamadı." });
                    }
                }
                else
                {
                    table = new AppTables
                    {
                        Status = "Bos",
                        IsActive = true
                    };
                    db.AppTables.Add(table);
                }

                table.TableNumber = tableNumber;
                table.Section = string.IsNullOrWhiteSpace(section) ? "Salon" : section;
                table.Shape = shape;
                table.PosX = posX;
                table.PosY = posY;
                table.Width = width ?? 75;
                table.Height = height ?? 75;

                db.SaveChanges();

                return Json(new { success = true, message = "Masa düzeni kaydedildi.", tableId = table.TableId });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
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

        #endregion

        #region KATEGORİ İŞLEMLERİ

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
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
        [JwtAuthorize(Roles = "Admin")]
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

        // Garson ve Admin için ortak sipariş çekme metodu
        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetPendingDeliveryOrders()
        {
            try
            {
                var pendingOrders = db.AppOrders
                    .Where(o => o.Status == "Hazır")
                    .OrderByDescending(o => o.CreatedDate)
                    .ToList()
                    .Select(o => new
                    {
                        orderId = o.OrderId,
                        orderType = o.OrderType,
                        tableName = o.OrderType == "Masa" && o.AppTables != null ? o.AppTables.TableNumber : "Paket Servis",
                        deliveryAddress = o.DeliveryAddress,
                        orderDate = o.CreatedDate.ToString("HH:mm"),
                        totalAmount = o.TotalAmount
                    }).ToList();

                return Json(new { success = true, data = pendingOrders }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Siparişler çekilirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        #endregion

        #region MENÜ / ÜRÜN İŞLEMLERİ (CACHE DESTEKLİ)

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetProducts(int companyId)
        {
            string cacheKey = $"Company_Products_{companyId}";

            var products = CacheHelper.GetOrAdd(cacheKey, () =>
            {
                return db.AppProducts
                    .Where(p => p.CompanyId == companyId && p.IsActive)
                    .Select(p => new
                    {
                        p.ProductId,
                        p.ProductName,
                        p.Price,
                        p.CategoryId,
                        CategoryName = p.AppCategories != null ? p.AppCategories.CategoryName : "Kategorisiz",
                        p.Description,
                        p.ImageUrl,
                        p.IsActive,
                        p.IsAvailable
                    }).ToList();
            });

            return Json(new { success = true, data = products }, JsonRequestBehavior.AllowGet);
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
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
        [JwtAuthorize(Roles = "Admin")]
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

                product.IsActive = true;
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
        [JwtAuthorize(Roles = "Admin")]
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
        [JwtAuthorize(Roles = "Admin")]
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
        [JwtAuthorize(Roles = "Admin")]
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
        [JwtAuthorize(Roles = "Admin")]
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