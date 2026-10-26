using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
    public class AdminController : TenantController
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // Personel Yönetimi ekranından eklenip silinebilen roller
        private static readonly string[] StaffRoles = { "Mutfak Şefi", "Mutfak", "Garson/Kasiyer", "Garson", "Kasiyer" };

        private bool IsOwnCategory(int categoryId)
        {
            int companyId = CurrentCompanyId;
            return db.AppCategories.Any(c => c.CategoryId == categoryId && c.CompanyId == companyId);
        }

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
        public ActionResult FinancialReports()
        {
            return View();
        }

        [JwtAuthorize(Roles = "Admin")]
        public ActionResult StaffManagement()
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
                int companyId = CurrentCompanyId;
                var allowedRoles = StaffRoles;

                var staffList = db.AppUsers
                    .Where(u => u.CompanyId == companyId && allowedRoles.Contains(u.Role))
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

                if (!StaffRoles.Contains(Role))
                {
                    return Json(new { success = false, message = "Geçersiz personel rolü." });
                }

                bool isExist = db.AppUsers.Any(u => u.Email == Email || u.Username == Email);
                if (isExist)
                {
                    return Json(new { success = false, message = "Bu e-posta adresiyle zaten kayıtlı bir personel bulunmaktadır." });
                }

                string generatedPassword = PasswordHasher.GenerateNumericCode(6);

                // Personel, ekleyen Admin'in şirketine bağlanır
                int currentCompanyId = CurrentCompanyId;
                var company = db.Companies.FirstOrDefault(c => c.Id == currentCompanyId);
                string currentCompanyName = company != null ? company.Name : null;

                var newStaff = new AppUsers
                {
                    FullName = FullName,
                    Username = Email,
                    Email = Email,
                    PasswordHash = PasswordHasher.Hash(generatedPassword),
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
                // Sadece kendi şirketindeki personel silinebilir (Admin hesapları bu ekrandan silinemez)
                var staff = db.AppUsers.FirstOrDefault(u => u.UserId == id && u.CompanyId == CurrentCompanyId && StaffRoles.Contains(u.Role));
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

        #region MUTFAK RAPORU İŞLEMLERİ

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult GetFinancialData(string period)
        {
            try
            {
                int companyId = CurrentCompanyId;
                DateTime now = DateTime.Now;
                DateTime startOfToday = now.Date;
                DateTime endOfToday = now.Date.AddDays(1).AddTicks(-1);

                // Ciro = sipariş değeri (tahsil edilen + kalan borç). TotalAmount tek başına kalan borçtur.
                // Grafiklerin kapsadığı en geniş aralıktaki siparişler bir kez çekilip bellekte gruplanır.
                DateTime rangeStart = new DateTime(now.Year, now.Month, 1).AddMonths(-5);
                if (now.Date.AddDays(-6) < rangeStart) rangeStart = now.Date.AddDays(-6);

                var rangeOrders = db.AppOrders
                    .Where(o => o.CompanyId == companyId && o.CreatedDate >= rangeStart && o.CreatedDate <= endOfToday && o.Status != "İptal")
                    .ToList();

                Func<DateTime, DateTime, decimal> revenueBetween = (from, to) =>
                    rangeOrders.Where(o => o.CreatedDate >= from && o.CreatedDate <= to).Sum(o => OrderAmounts.Value(o));

                var todayOrders = rangeOrders
                    .Where(o => o.CreatedDate >= startOfToday && o.CreatedDate <= endOfToday)
                    .ToList();

                decimal todayRevenue = todayOrders.Sum(o => OrderAmounts.Value(o));
                int todayOrderCount = todayOrders.Count;
                decimal avgOrderAmount = todayOrderCount > 0 ? (todayRevenue / todayOrderCount) : 0;

                var topProductToday = db.AppOrderDetails
                    .Where(d => d.AppOrders.CompanyId == companyId && d.AppOrders.CreatedDate >= startOfToday && d.AppOrders.CreatedDate <= endOfToday && d.AppOrders.Status != "İptal")
                    .GroupBy(d => d.AppProducts.ProductName)
                    .Select(g => new { ProductName = g.Key, TotalQty = g.Sum(x => x.Quantity) })
                    .OrderByDescending(x => x.TotalQty)
                    .FirstOrDefault();

                string topSellingProductName = topProductToday != null ? topProductToday.ProductName : "Henüz Yok";

                List<string> revenueLabels = new List<string>();
                List<decimal> revenueValues = new List<decimal>();

                if (period == "weekly")
                {
                    for (int i = 6; i >= 0; i--)
                    {
                        DateTime day = now.Date.AddDays(-i);
                        DateTime dayStart = day;
                        DateTime dayEnd = day.AddDays(1).AddTicks(-1);

                        decimal dayRev = revenueBetween(dayStart, dayEnd);

                        revenueLabels.Add(day.ToString("dd MMM ddd"));
                        revenueValues.Add(dayRev);
                    }
                }
                else if (period == "monthly")
                {
                    for (int i = 5; i >= 0; i--)
                    {
                        DateTime mStart = new DateTime(now.Year, now.Month, 1).AddMonths(-i);
                        DateTime mEnd = mStart.AddMonths(1).AddTicks(-1);

                        decimal monthRev = revenueBetween(mStart, mEnd);

                        revenueLabels.Add(mStart.ToString("MMM yyyy"));
                        revenueValues.Add(monthRev);
                    }
                }
                else
                {
                    for (int hour = 8; hour <= 23; hour += 2)
                    {
                        DateTime hStart = startOfToday.AddHours(hour);
                        DateTime hEnd = startOfToday.AddHours(hour + 2).AddTicks(-1);

                        decimal hRev = revenueBetween(hStart, hEnd);

                        revenueLabels.Add($"{hour:D2}:00-{(hour + 2):D2}:00");
                        revenueValues.Add(hRev);
                    }
                }

                DateTime thirtyDaysAgo = now.AddDays(-30);
                var top5Products = db.AppOrderDetails
                    .Where(d => d.AppOrders.CompanyId == companyId && d.AppOrders.CreatedDate >= thirtyDaysAgo && d.AppOrders.Status != "İptal")
                    .GroupBy(d => d.AppProducts.ProductName)
                    .Select(g => new
                    {
                        ProductName = g.Key ?? "Bilinmeyen Ürün",
                        TotalQuantity = g.Sum(x => x.Quantity)
                    })
                    .OrderByDescending(x => x.TotalQuantity)
                    .Take(5)
                    .ToList();

                List<string> hourlyLabels = new List<string>();
                List<int> hourlyOrderCounts = new List<int>();

                for (int h = 10; h <= 22; h += 2)
                {
                    DateTime hStart = startOfToday.AddHours(h);
                    DateTime hEnd = startOfToday.AddHours(h + 2).AddTicks(-1);

                    int count = db.AppOrders
                        .Count(o => o.CompanyId == companyId && o.CreatedDate >= hStart && o.CreatedDate <= hEnd && o.Status != "İptal");

                    hourlyLabels.Add($"{h:D2}:00");
                    hourlyOrderCounts.Add(count);
                }

                var result = new
                {
                    todayRevenue = todayRevenue,
                    todayOrderCount = todayOrderCount,
                    avgOrderAmount = avgOrderAmount,
                    topSellingProduct = topSellingProductName,
                    revenueChart = new { labels = revenueLabels, data = revenueValues },
                    topProductsChart = new { labels = top5Products.Select(x => x.ProductName).ToList(), data = top5Products.Select(x => x.TotalQuantity).ToList() },
                    hourlyChart = new { labels = hourlyLabels, data = hourlyOrderCounts }
                };

                return Json(new { success = true, data = result }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Finansal veriler hesaplanırken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

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

                int companyId = CurrentCompanyId;
                DateTime startOfDay = targetDate.Date;
                DateTime endOfDay = targetDate.Date.AddDays(1).AddTicks(-1);

                var queryOrders = db.AppOrders
                    .Where(o => o.CompanyId == companyId && o.CreatedDate >= startOfDay && o.CreatedDate <= endOfDay)
                    .OrderByDescending(o => o.CreatedDate)
                    .ToList();

                var reportData = queryOrders.Select(o =>
                {
                    // 1. İLK SİPARİŞ ZAMANI (Doğrudan bu müşterinin/adisyonun kendi açılış saati)
                    string firstOrderTime = o.CreatedDate.ToString("HH:mm");

                    // 2. TESLİMAT ZAMANI (DeliveredDate)
                    string lastDeliveryTime = o.DeliveredDate.HasValue
                        ? o.DeliveredDate.Value.ToString("HH:mm")
                        : "--:--";

                    // 3. MASA BOŞALMA ZAMANI (CompletedDate)
                    string tableClosedTime = o.CompletedDate.HasValue
                        ? o.CompletedDate.Value.ToString("HH:mm")
                        : "--:--";

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
                        totalAmount = OrderAmounts.Value(o),
                        orderNote = o.OrderNote,
                        items = o.AppOrderDetails.Select(d => new
                        {
                            productId = d.ProductId,
                            productName = d.AppProducts != null ? d.AppProducts.ProductName : "Bilinmeyen Ürün",
                            quantity = d.Quantity,
                            unitPrice = d.UnitPrice,
                            totalLinePrice = d.Quantity * d.UnitPrice,
                            isReturned = d.IsReturned,
                            returnReason = d.ReturnReason
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

        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult CloseTableOrder(int tableId)
        {
            try
            {
                var activeOrders = db.AppOrders
                    .Where(o => o.TableId == tableId && o.CompanyId == CurrentCompanyId && o.Status != "Tamamlandı" && o.Status != "İptal")
                    .ToList();

                if (!activeOrders.Any())
                {
                    return Json(new { success = false, message = "Kapatılacak aktif sipariş bulunamadı." });
                }

                decimal remainingTotal = activeOrders.Sum(o => o.TotalAmount);
                if (remainingTotal > 0)
                {
                    return Json(new { success = false, message = $"Masanın {remainingTotal:N2} ₺ ödenmemiş hesabı var. Önce ödemeyi alınız." });
                }

                DateTime now = DateTime.Now;

                foreach (var order in activeOrders)
                {
                    order.Status = "Tamamlandı";
                    order.CompletedDate = now; // MASA BOŞALMA SAATİ KAYDEDİLİYOR
                }

                var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId && t.CompanyId == CurrentCompanyId);
                if (table != null)
                {
                    table.Status = "Bos";
                }

                db.SaveChanges();

                return Json(new { success = true, message = "Hesap kapatıldı ve masa boşaltıldı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Masa kapatılırken hata: " + ex.Message });
            }
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public ActionResult TableManagement()
        {
            var tables = db.AppTables.Where(t => t.IsActive && t.CompanyId == CurrentCompanyId).ToList();
            return View(tables);
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public ActionResult FloorPlanManagement()
        {
            var tables = db.AppTables.Where(t => t.IsActive && t.CompanyId == CurrentCompanyId).ToList();
            return View(tables);
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetTables()
        {
            try
            {
                int companyId = CurrentCompanyId;

                var tables = db.AppTables
                    .Where(t => t.IsActive && t.CompanyId == companyId)
                    .ToList()
                    .Select(t =>
                    {
                        var activeOrders = db.AppOrders
                            .Where(o => o.TableId == t.TableId && o.CompanyId == companyId && o.Status != "Tamamlandı" && o.Status != "İptal")
                            .OrderBy(o => o.CreatedDate)
                            .ToList();

                        // TotalAmount kalan borçtur
                        decimal currentTotal = activeOrders.Sum(o => o.TotalAmount);

                        // Kısmi ödeme "ödendi" sayılmaz: kalan borç sıfırlandıysa ödenmiştir
                        bool isPaid = activeOrders.Any() && currentTotal <= 0;

                        string firstOrderTime = "--:--";
                        string lastDeliveryTime = "--:--";
                        int idleMinutes = 0;

                        if (activeOrders.Any())
                        {
                            var firstOrder = activeOrders.First();
                            firstOrderTime = firstOrder.CreatedDate.ToString("HH:mm");

                            var lastDelivered = activeOrders.Where(o => o.DeliveredDate.HasValue).Max(o => o.DeliveredDate);
                            if (lastDelivered.HasValue)
                            {
                                lastDeliveryTime = lastDelivered.Value.ToString("HH:mm");
                            }

                            // Boşta kalma süresi masaya en son ürün eklendiği andan itibaren hesaplanır
                            DateTime lastActivity = activeOrders
                                .SelectMany(o => o.AppOrderDetails)
                                .Select(d => (DateTime?)d.CreatedDate)
                                .Max() ?? activeOrders.Last().CreatedDate;

                            idleMinutes = (int)(DateTime.Now - lastActivity).TotalMinutes;
                            if (idleMinutes < 0) idleMinutes = 0;
                        }

                        return new
                        {
                            tableId = t.TableId,
                            tableNumber = t.TableNumber,
                            status = t.Status ?? "Bos",
                            currentAmount = currentTotal,
                            isPaid = isPaid, // EKLENEN KRİTİK ALAN: Frontend'in "ÖDEME ALINDI / DOLU" rozetini çizmesini sağlar
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

                var existingTable = db.AppTables.FirstOrDefault(t => t.TableNumber == tableNumber && t.CompanyId == CurrentCompanyId && t.IsActive);
                if (existingTable != null)
                {
                    return Json(new { success = false, message = "Bu masa numarası zaten kayıtlı!" });
                }

                var newTable = new AppTables
                {
                    CompanyId = CurrentCompanyId,
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
                    table = db.AppTables.FirstOrDefault(t => t.TableId == tableId.Value && t.CompanyId == CurrentCompanyId);
                    if (table == null)
                    {
                        return Json(new { success = false, message = "Masa bulunamadı." });
                    }
                }
                else
                {
                    table = new AppTables
                    {
                        CompanyId = CurrentCompanyId,
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
                var table = db.AppTables.FirstOrDefault(t => t.TableId == id && t.CompanyId == CurrentCompanyId);
                if (table == null)
                {
                    return Json(new { success = false, message = "Masa bulunamadı." });
                }

                bool hasOpenOrders = db.AppOrders.Any(o => o.TableId == id && o.Status != "Tamamlandı" && o.Status != "İptal");
                if (hasOpenOrders)
                {
                    return Json(new { success = false, message = "Bu masada açık sipariş var. Önce hesabı kapatıp masayı boşaltınız." });
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
                int companyId = CurrentCompanyId;
                string requestScheme = Request.Url.Scheme;
                string requestHost = Request.Url.Authority;

                string targetMenuUrl = "";

                // Menü sayfası restoranı masadan (tableId) veya masasız QR'da doğrudan companyId'den bulur
                if (tableId.HasValue && tableId.Value > 0)
                {
                    bool isOwnTable = db.AppTables.Any(t => t.TableId == tableId.Value && t.CompanyId == companyId);
                    if (!isOwnTable)
                    {
                        return Json(new { success = false, message = "Masa bulunamadı." }, JsonRequestBehavior.AllowGet);
                    }
                    targetMenuUrl = $"{requestScheme}://{requestHost}/Menu/Index?tableId={tableId.Value}";
                }
                else
                {
                    targetMenuUrl = $"{requestScheme}://{requestHost}/Menu/Index?companyId={companyId}";
                }

                string qrImageUrl = $"https://quickchart.io/qr?text={Url.Encode(targetMenuUrl)}&size=300&margin=1";

                var company = db.Companies.FirstOrDefault(c => c.Id == companyId);
                string companyName = company != null && !string.IsNullOrEmpty(company.Name) ? company.Name : "Restoran";

                return Json(new { success = true, qrImageUrl = qrImageUrl, targetUrl = targetMenuUrl, companyName = companyName }, JsonRequestBehavior.AllowGet);
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
        public JsonResult GetCategories()
        {
            int companyId = CurrentCompanyId;
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
        public JsonResult AddCategory(string categoryName)
        {
            if (string.IsNullOrWhiteSpace(categoryName))
            {
                return Json(new { success = false, message = "Kategori adı boş olamaz." });
            }

            var category = new AppCategories
            {
                CategoryName = categoryName,
                CompanyId = CurrentCompanyId,
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
                // Masada hazır ürünü bulunan veya mutfakta hazırlanmakta olan aktif siparişleri listele
                int companyId = CurrentCompanyId;
                var pendingOrders = db.AppOrders
                    .Where(o => o.CompanyId == companyId && o.Status != "Tamamlandı" && o.Status != "İptal" &&
                                o.AppOrderDetails.Any(d => !d.IsReturned && d.ReturnReason != "Servis Edildi"))
                    .OrderByDescending(o => o.CreatedDate)
                    .ToList()
                    .Select(o =>
                    {
                        bool hasReadyItems = o.AppOrderDetails.Any(d => !d.IsReturned && d.ReturnReason == "Hazır");

                        return new
                        {
                            orderId = o.OrderId,
                            orderType = o.OrderType,
                            status = hasReadyItems ? "Hazır" : "Hazırlanıyor",
                            tableName = o.OrderType == "Masa" && o.AppTables != null ? o.AppTables.TableNumber : "Paket Servis",
                            deliveryAddress = o.DeliveryAddress,
                            orderDate = o.CreatedDate.ToString("HH:mm"),
                            totalAmount = o.TotalAmount
                        };
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
                var order = db.AppOrders.FirstOrDefault(o => o.OrderId == orderId && o.CompanyId == CurrentCompanyId);
                if (order == null)
                {
                    return Json(new { success = false, message = "Sipariş bulunamadı." }, JsonRequestBehavior.AllowGet);
                }

                // Garson sipariş detayında masaya ait tüm aktif ürünleri ve durumlarını göster
                var items = order.AppOrderDetails
                    .Where(d => !d.IsReturned)
                    .Select(d => new
                    {
                        orderDetailId = d.OrderDetailId,
                        productName = d.AppProducts != null ? d.AppProducts.ProductName : "Bilinmeyen Ürün",
                        quantity = d.Quantity,
                        unitPrice = d.UnitPrice,
                        totalPrice = d.Quantity * d.UnitPrice,
                        itemStatus = d.ReturnReason == "Hazır" ? "Hazır" : (d.ReturnReason == "Servis Edildi" ? "Servis Edildi" : "Hazırlanıyor")
                    }).ToList();

                bool hasReadyItems = items.Any(x => x.itemStatus == "Hazır");

                var orderData = new
                {
                    orderId = order.OrderId,
                    orderType = order.OrderType,
                    status = hasReadyItems ? "Hazır" : (items.All(x => x.itemStatus == "Servis Edildi") ? "Servis Edildi" : "Hazırlanıyor"),
                    tableName = order.OrderType == "Masa" && order.AppTables != null ? order.AppTables.TableNumber : "Paket Servis",
                    orderTime = order.CreatedDate.ToString("HH:mm"),
                    totalAmount = items.Sum(x => x.totalPrice),
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
                var order = db.AppOrders.FirstOrDefault(o => o.OrderId == orderId && o.CompanyId == CurrentCompanyId);
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

                var order = db.AppOrders.FirstOrDefault(o => o.OrderId == detail.OrderId && o.CompanyId == CurrentCompanyId);
                if (order == null)
                {
                    return Json(new { success = false, message = "Bağlı sipariş bulunamadı." });
                }

                // Durum ürün bazında kontrol edilir (ReturnReason == null => mutfakta hazırlanıyor)
                if (detail.IsReturned || detail.ReturnReason != null)
                {
                    return Json(new { success = false, message = "Yalnızca 'Hazırlanıyor' aşamasındaki ürünleri azaltabilir veya silebilirsiniz." });
                }

                if (detail.Quantity - 1 < detail.PaidQuantity)
                {
                    return Json(new { success = false, message = "Ödemesi alınmış ürün adedi azaltılamaz." });
                }

                // TotalAmount kalan borçtur: yeniden hesaplanmaz, silinen ürün tutarı kadar düşülür
                if (detail.UnitPrice > order.TotalAmount)
                {
                    return Json(new { success = false, message = "Bu ürünün tutarı masanın kalan borcundan fazla. Ödeme alınmış hesapta ürün silinemez." });
                }

                order.TotalAmount -= detail.UnitPrice;

                if (detail.Quantity > 1)
                {
                    detail.Quantity -= 1;
                }
                else
                {
                    db.AppOrderDetails.Remove(detail);
                }

                db.SaveChanges();

                bool hasActiveItems = db.AppOrderDetails.Any(d => d.OrderId == order.OrderId && !d.IsReturned);

                if (hasActiveItems)
                {
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
                            var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId && t.CompanyId == CurrentCompanyId);
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
        public JsonResult GetProducts()
        {
            int companyId = CurrentCompanyId;
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
                .Where(p => p.ProductId == productId && p.CompanyId == CurrentCompanyId)
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

                // Şirket istemciden gelen değerle değil, oturumdaki şirketle belirlenir
                product.CompanyId = CurrentCompanyId;

                if (!IsOwnCategory(product.CategoryId))
                {
                    return Json(new { success = false, message = "Geçersiz kategori seçimi." });
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
                var product = db.AppProducts.FirstOrDefault(p => p.ProductId == updatedProduct.ProductId && p.CompanyId == CurrentCompanyId);
                if (product == null)
                {
                    return Json(new { success = false, message = "Ürün bulunamadı." });
                }

                if (!IsOwnCategory(updatedProduct.CategoryId))
                {
                    return Json(new { success = false, message = "Geçersiz kategori seçimi." });
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
                var product = db.AppProducts.FirstOrDefault(p => p.ProductId == productId && p.CompanyId == CurrentCompanyId);
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
            var product = db.AppProducts.FirstOrDefault(p => p.ProductId == productId && p.CompanyId == CurrentCompanyId);
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

        #region DOLU MASA ADİSYON ÇEKME METODU

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetActiveOrderByTableId(int tableId)
        {
            try
            {
                var activeOrders = db.AppOrders
                    .Where(o => o.TableId == tableId && o.CompanyId == CurrentCompanyId && o.Status != "Tamamlandı" && o.Status != "İptal")
                    .ToList();

                if (!activeOrders.Any())
                {
                    return Json(new { success = false, message = "Aktif sipariş bulunamadı." }, JsonRequestBehavior.AllowGet);
                }

                var allItems = activeOrders
                    .SelectMany(o => o.AppOrderDetails.Where(d => !d.IsReturned))
                    .Select(d => new
                    {
                        orderDetailId = d.OrderDetailId,
                        productId = d.ProductId,
                        productName = d.AppProducts != null ? d.AppProducts.ProductName : "Ürün",
                        quantity = d.Quantity,
                        paidQuantity = d.PaidQuantity,
                        unitPrice = d.UnitPrice,
                        isReturned = d.IsReturned,
                        returnReason = d.ReturnReason
                    }).ToList();

                // Masadaki siparişlerin gerçek kalan toplam borcu
                decimal remainingTotal = activeOrders.Sum(o => (decimal?)o.TotalAmount) ?? 0;

                return Json(new { success = true, data = allItems, remainingTotal = remainingTotal }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Sipariş detayları çekilemedi: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
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