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

                var queryOrders = db.AppOrders
                    .Where(o => o.CreatedDate >= startOfDay && o.CreatedDate <= endOfDay)
                    .OrderByDescending(o => o.CreatedDate)
                    .ToList();

                var reportData = queryOrders.Select(o =>
                {
                    string firstOrderTime = o.CreatedDate.ToString("HH:mm");
                    string lastDeliveryTime = (o.Status == "Servis Edildi" || o.Status == "Teslim Edildi")
                        ? o.CreatedDate.ToString("HH:mm")
                        : "--:--";

                    string tableClosedTime = o.Status == "Tamamlandı" ? o.CreatedDate.ToString("HH:mm") : "--:--";

                    if (o.TableId.HasValue)
                    {
                        var tableFirstOrder = db.AppOrders
                            .Where(x => x.TableId == o.TableId && x.CreatedDate >= startOfDay && x.CreatedDate <= endOfDay)
                            .OrderBy(x => x.CreatedDate)
                            .FirstOrDefault();

                        if (tableFirstOrder != null)
                        {
                            firstOrderTime = tableFirstOrder.CreatedDate.ToString("HH:mm");
                        }

                        var tableLastCompletedOrder = db.AppOrders
                            .Where(x => x.TableId == o.TableId && x.CreatedDate >= startOfDay && x.CreatedDate <= endOfDay && x.Status == "Tamamlandı")
                            .OrderByDescending(x => x.CreatedDate)
                            .FirstOrDefault();

                        if (tableLastCompletedOrder != null)
                        {
                            tableClosedTime = tableLastCompletedOrder.CreatedDate.ToString("HH:mm");
                        }
                    }

                    return new
                    {
                        orderId = o.OrderId,
                        orderType = o.OrderType,
                        orderTime = o.CreatedDate.ToString("HH:mm"),
                        firstOrderTime = firstOrderTime,
                        lastDeliveryTime = lastDeliveryTime,
                        tableClosedTime = tableClosedTime,
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
                    };
                }).ToList();

                return Json(new { success = true, data = reportData }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Rapor çekilirken hata oluştu: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

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
                    .ToList()
                    .Select(t =>
                    {
                        var activeOrders = db.AppOrders
                            .Where(o => o.TableId == t.TableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                            .OrderBy(o => o.CreatedDate)
                            .ToList();

                        decimal currentTotal = activeOrders.Sum(o => (decimal?)o.TotalAmount) ?? 0;

                        string firstOrderTime = "--:--";
                        string lastDeliveryTime = "--:--";
                        int idleMinutes = 0;

                        if (activeOrders.Any())
                        {
                            var firstOrder = activeOrders.First();
                            firstOrderTime = firstOrder.CreatedDate.ToString("HH:mm");

                            var deliveredOrders = activeOrders.Where(o => o.Status == "Teslim Edildi" || o.Status == "Servis Edildi").ToList();
                            if (deliveredOrders.Any())
                            {
                                lastDeliveryTime = deliveredOrders.Last().CreatedDate.ToString("HH:mm");
                            }

                            var lastOrder = activeOrders.Last();
                            idleMinutes = (int)(DateTime.Now - lastOrder.CreatedDate).TotalMinutes;
                            if (idleMinutes < 0) idleMinutes = 0;
                        }

                        return new
                        {
                            tableId = t.TableId,
                            tableNumber = t.TableNumber,
                            status = t.Status ?? "Bos",
                            currentAmount = currentTotal,
                            section = t.Section ?? "Salon",
                            shape = t.Shape ?? "Square",
                            posX = t.PosX ?? 50,
                            posY = t.PosY ?? 50,
                            width = t.Width ?? 75,
                            height = t.Height ?? 75,
                            firstOrderTime = firstOrderTime,
                            lastDeliveryTime = lastDeliveryTime,
                            idleMinutes = idleMinutes
                        };
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
                if (!string.IsNullOrWhiteSpace(section))
                {
                    table.Section = section;
                }
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

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult GenerateQrCodeUrl(int? tableId)
        {
            try
            {
                string requestScheme = Request.Url.Scheme;
                string requestHost = Request.Url.Authority;

                string targetMenuUrl = "";

                if (tableId.HasValue && tableId.Value > 0)
                {
                    targetMenuUrl = $"{requestScheme}://{requestHost}/Menu/Index?tableId={tableId.Value}";
                }
                else
                {
                    targetMenuUrl = $"{requestScheme}://{requestHost}/Menu/Index";
                }

                string qrImageUrl = $"https://quickchart.io/qr?text={Url.Encode(targetMenuUrl)}&size=300&margin=1";

                return Json(new { success = true, qrImageUrl = qrImageUrl, targetUrl = targetMenuUrl }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "QR Kod oluşturulurken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        #endregion

        #region KATEGORİ İŞLEMLERİ

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetCategories(int companyId)
        {
            var categories = db.AppCategories
                .Where(c => c.CompanyId == companyId)
                .Select(c => new
                {
                    c.CategoryId,
                    c.CategoryName,
                    c.IsActive
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

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetPendingDeliveryOrders()
        {
            try
            {
                var pendingOrders = db.AppOrders
                    .Where(o => o.Status == "Hazırlanıyor" || o.Status == "Hazır")
                    .OrderByDescending(o => o.CreatedDate)
                    .ToList()
                    .Select(o => new
                    {
                        orderId = o.OrderId,
                        orderType = o.OrderType,
                        status = o.Status,
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

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetOrderDetails(int orderId)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(o => o.OrderId == orderId);
                if (order == null)
                {
                    return Json(new { success = false, message = "Sipariş bulunamadı." }, JsonRequestBehavior.AllowGet);
                }

                var items = order.AppOrderDetails.Select(d => new
                {
                    orderDetailId = d.OrderDetailId,
                    productName = d.AppProducts != null ? d.AppProducts.ProductName : "Bilinmeyen Ürün",
                    quantity = d.Quantity,
                    unitPrice = d.UnitPrice,
                    totalPrice = d.Quantity * d.UnitPrice
                }).ToList();

                var orderData = new
                {
                    orderId = order.OrderId,
                    orderType = order.OrderType,
                    status = order.Status,
                    tableName = order.OrderType == "Masa" && order.AppTables != null ? order.AppTables.TableNumber : "Paket Servis",
                    orderTime = order.CreatedDate.ToString("HH:mm"),
                    totalAmount = order.TotalAmount,
                    items = items
                };

                return Json(new { success = true, data = orderData }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Sipariş detayı çekilemedi: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult DeliverOrder(int orderId)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(o => o.OrderId == orderId);
                if (order == null)
                {
                    return Json(new { success = false, message = "Sipariş bulunamadı." });
                }

                order.Status = "Servis Edildi";
                db.SaveChanges();

                return Json(new { success = true, message = "Sipariş başarıyla teslim edildi olarak güncellendi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Sipariş teslim edilirken hata: " + ex.Message });
            }
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult DeleteOrderItem(int orderDetailId)
        {
            try
            {
                var detail = db.AppOrderDetails.FirstOrDefault(d => d.OrderDetailId == orderDetailId);
                if (detail == null)
                {
                    return Json(new { success = false, message = "Silinmek istenen ürün kalemi bulunamadı." });
                }

                var order = db.AppOrders.FirstOrDefault(o => o.OrderId == detail.OrderId);
                if (order == null)
                {
                    return Json(new { success = false, message = "Bağlı sipariş bulunamadı." });
                }

                if (order.Status != "Hazırlanıyor")
                {
                    return Json(new { success = false, message = "Yalnızca 'Hazırlanıyor' aşamasındaki ürünleri azaltabilir veya silebilirsiniz." });
                }

                if (detail.Quantity > 1)
                {
                    detail.Quantity -= 1;
                }
                else
                {
                    db.AppOrderDetails.Remove(detail);
                }

                db.SaveChanges();

                var remainingDetails = db.AppOrderDetails.Where(d => d.OrderId == order.OrderId).ToList();

                if (remainingDetails.Any())
                {
                    order.TotalAmount = remainingDetails.Sum(d => d.Quantity * d.UnitPrice);
                    db.SaveChanges();
                    return Json(new { success = true, isOrderCancelled = false, newTotalAmount = order.TotalAmount, message = "Ürün adedi 1 eksiltildi." });
                }
                else
                {
                    order.Status = "İptal";
                    order.TotalAmount = 0;

                    if (order.TableId.HasValue)
                    {
                        int tableId = order.TableId.Value;
                        bool hasOtherActiveOrders = db.AppOrders.Any(o => o.TableId == tableId && o.OrderId != order.OrderId && o.Status != "Tamamlandı" && o.Status != "İptal");
                        if (!hasOtherActiveOrders)
                        {
                            var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId);
                            if (table != null)
                            {
                                table.Status = "Bos";
                            }
                        }
                    }

                    db.SaveChanges();
                    return Json(new { success = true, isOrderCancelled = true, newTotalAmount = 0, message = "Tüm ürünler silindiği için sipariş iptal edildi." });
                }
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "İşlem yapılırken hata: " + ex.Message });
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