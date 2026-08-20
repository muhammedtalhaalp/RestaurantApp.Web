using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
    public class KitchenController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Index()
        {
            return View();
        }

        public ActionResult Performance()
        {
            return View();
        }

        public ActionResult Recipes()
        {
            return View();
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
        public JsonResult GetActiveOrders()
        {
            try
            {
                var activeOrders = db.AppOrders
                    .Where(o => o.Status != "Tamamlandı" && o.Status != "İptal" &&
                                o.AppOrderDetails.Any(d => !d.IsReturned && d.ReturnReason != "Hazır" && d.ReturnReason != "Servis Edildi"))
                    .OrderByDescending(o => o.IsPriority)
                    .ThenBy(o => o.CreatedDate)
                    .ToList()
                    .Select(o =>
                    {
                        var kitchenItems = o.AppOrderDetails
                            .Where(d => !d.IsReturned && d.ReturnReason != "Hazır" && d.ReturnReason != "Servis Edildi")
                            .Select(d => new
                            {
                                orderDetailId = d.OrderDetailId,
                                productName = d.AppProducts != null ? d.AppProducts.ProductName : "Ürün",
                                quantity = d.Quantity
                            }).ToList();

                        return new
                        {
                            orderId = o.OrderId,
                            orderType = o.OrderType,
                            isPriority = o.IsPriority,
                            tableName = o.OrderType == "Masa" && o.AppTables != null ? o.AppTables.TableNumber : "Paket Servis",
                            deliveryAddress = o.DeliveryAddress,
                            orderDate = o.CreatedDate.ToString("HH:mm"),
                            orderFullDate = o.CreatedDate.ToString("yyyy-MM-ddTHH:mm:ss"),
                            orderNote = o.OrderNote,
                            items = kitchenItems
                        };
                    })
                    .Where(o => o.items.Any())
                    .ToList();

                return Json(new { success = true, data = activeOrders }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        public JsonResult MarkItemsAsReady(int orderId, List<int> orderDetailIds)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(x => x.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Sipariş bulunamadı." });

                if (orderDetailIds == null || !orderDetailIds.Any())
                    return Json(new { success = false, message = "Lütfen hazır olan en az bir ürün seçiniz." });

                var targetDetails = db.AppOrderDetails
                    .Where(d => d.OrderId == orderId && orderDetailIds.Contains(d.OrderDetailId) && !d.IsReturned)
                    .ToList();

                List<string> readyProductNames = new List<string>();
                List<int> processedIds = new List<int>();

                foreach (var detail in targetDetails)
                {
                    detail.ReturnReason = "Hazır";
                    processedIds.Add(detail.OrderDetailId);
                    string pName = detail.AppProducts != null ? detail.AppProducts.ProductName : "Ürün";
                    readyProductNames.Add($"{detail.Quantity}x {pName}");
                }

                var allActiveDetails = db.AppOrderDetails.Where(d => d.OrderId == orderId && !d.IsReturned).ToList();
                bool isAllOrderReady = allActiveDetails.All(d => d.ReturnReason == "Hazır" || d.ReturnReason == "Servis Edildi");

                if (isAllOrderReady)
                {
                    order.Status = "Hazır";
                }

                db.SaveChanges();

                return Json(new
                {
                    success = true,
                    message = "Seçilen ürünler garsona iletildi.",
                    orderId = order.OrderId,
                    tableName = order.TableId.HasValue && order.AppTables != null ? order.AppTables.TableNumber : "Paket Servis",
                    orderType = order.OrderType,
                    address = order.DeliveryAddress,
                    readyItemsSummary = string.Join(", ", readyProductNames),
                    readyDetailIds = processedIds,
                    isAllOrderReady = isAllOrderReady
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult MarkOrderAsReady(int orderId)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(x => x.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Sipariş bulunamadı." });

                var details = db.AppOrderDetails.Where(d => d.OrderId == orderId && !d.IsReturned && d.ReturnReason != "Servis Edildi").ToList();
                List<string> readyProductNames = new List<string>();
                List<int> detailIds = new List<int>();

                foreach (var detail in details)
                {
                    detail.ReturnReason = "Hazır";
                    detailIds.Add(detail.OrderDetailId);
                    string pName = detail.AppProducts != null ? detail.AppProducts.ProductName : "Ürün";
                    readyProductNames.Add($"{detail.Quantity}x {pName}");
                }

                order.Status = "Hazır";
                db.SaveChanges();

                return Json(new
                {
                    success = true,
                    message = "Tüm sipariş hazırlandı.",
                    orderId = order.OrderId,
                    tableName = order.TableId.HasValue && order.AppTables != null ? order.AppTables.TableNumber : "Paket Servis",
                    orderType = order.OrderType,
                    address = order.DeliveryAddress,
                    readyItemsSummary = string.Join(", ", readyProductNames),
                    readyDetailIds = detailIds,
                    isAllOrderReady = true
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
        public JsonResult GetKitchenPerformanceData(string filter = "today")
        {
            try
            {
                DateTime startDate = DateTime.Today;
                DateTime endDate = DateTime.Now;

                if (filter == "week") startDate = DateTime.Today.AddDays(-7);
                else if (filter == "month") startDate = DateTime.Today.AddMonths(-1);

                var completedOrders = db.AppOrders
                    .Where(o => o.CreatedDate >= startDate && o.CreatedDate <= endDate &&
                                (o.Status == "Hazır" || o.Status == "Servis Edildi" || o.Status == "Tamamlandı") &&
                                o.DeliveredDate.HasValue)
                    .ToList();

                int totalOrders = completedOrders.Count;
                int totalPortions = 0;
                double totalDurationMinutes = 0;
                int delayedOrdersCount = 0;

                var hourlyDurations = new Dictionary<int, List<double>>();
                for (int i = 8; i <= 23; i++) hourlyDurations[i] = new List<double>();

                foreach (var o in completedOrders)
                {
                    var duration = (o.DeliveredDate.Value - o.CreatedDate).TotalMinutes;
                    if (duration < 0) duration = 1;
                    if (duration > 120) duration = 120;

                    totalDurationMinutes += duration;
                    if (duration > 15) delayedOrdersCount++;

                    int hour = o.CreatedDate.Hour;
                    if (hourlyDurations.ContainsKey(hour)) hourlyDurations[hour].Add(duration);

                    totalPortions += o.AppOrderDetails.Where(d => !d.IsReturned).Sum(d => d.Quantity);
                }

                double avgPrepTime = totalOrders > 0 ? Math.Round(totalDurationMinutes / totalOrders, 1) : 0;
                double onTimeRate = totalOrders > 0 ? Math.Round(((double)(totalOrders - delayedOrdersCount) / totalOrders) * 100, 1) : 100;

                var chartLabels = new List<string>();
                var chartAvgTimes = new List<double>();
                foreach (var kvp in hourlyDurations)
                {
                    chartLabels.Add($"{kvp.Key:D2}:00");
                    double hourAvg = kvp.Value.Any() ? Math.Round(kvp.Value.Average(), 1) : 0;
                    chartAvgTimes.Add(hourAvg);
                }

                var topProducts = db.AppOrderDetails
                    .Where(d => d.AppOrders.CreatedDate >= startDate && !d.IsReturned)
                    .GroupBy(d => d.AppProducts.ProductName)
                    .Select(g => new
                    {
                        productName = g.Key ?? "Ürün",
                        totalCount = g.Sum(x => x.Quantity),
                        totalAmount = g.Sum(x => x.Quantity * x.UnitPrice)
                    })
                    .OrderByDescending(x => x.totalCount)
                    .Take(8)
                    .ToList();

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        totalOrders = totalOrders,
                        totalPortions = totalPortions,
                        avgPrepTimeMinutes = avgPrepTime,
                        delayedOrdersCount = delayedOrdersCount,
                        onTimeSuccessRate = onTimeRate,
                        chartLabels = chartLabels,
                        chartAvgTimes = chartAvgTimes,
                        topProducts = topProducts
                    }
                }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // ==========================================
        // DİJİTAL ŞEF REÇETELERİ API
        // ==========================================
        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
        public JsonResult GetRecipesData(int? categoryId)
        {
            try
            {
                var query = db.AppProducts.Where(p => p.IsActive);

                if (categoryId.HasValue && categoryId.Value > 0)
                {
                    query = query.Where(p => p.CategoryId == categoryId.Value);
                }

                var recipes = query.Select(p => new
                {
                    productId = p.ProductId,
                    productName = p.ProductName,
                    categoryName = p.AppCategories != null ? p.AppCategories.CategoryName : "Genel",
                    categoryId = p.CategoryId,
                    price = p.Price,
                    imageUrl = p.ImageUrl,
                    description = p.Description,
                    isAvailable = p.IsAvailable
                }).ToList();

                var categories = db.AppCategories
                    .Where(c => c.IsActive)
                    .Select(c => new
                    {
                        categoryId = c.CategoryId,
                        categoryName = c.CategoryName
                    }).ToList();

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        recipes = recipes,
                        categories = categories
                    }
                }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Reçeteler yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // ŞEFİN REÇETEYİ KAYDETMESİ VEYA GÜNCELLEMESİ
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
        public JsonResult SaveRecipe(RecipeSaveModel model)
        {
            try
            {
                if (model == null || model.ProductId <= 0)
                    return Json(new { success = false, message = "Geçersiz ürün bilgisi." });

                var product = db.AppProducts.FirstOrDefault(p => p.ProductId == model.ProductId);
                if (product == null)
                    return Json(new { success = false, message = "Ürün bulunamadı." });

                // Ürün açıklamasına şefin girdiği JSON formatındaki reçeteyi saklıyoruz
                string serializedRecipe = Newtonsoft.Json.JsonConvert.SerializeObject(new
                {
                    hasRecipe = true,
                    cookTime = model.CookTime,
                    station = model.Station,
                    ingredients = model.Ingredients,
                    instructions = model.Instructions,
                    chefTip = model.ChefTip
                });

                product.Description = serializedRecipe;
                db.SaveChanges();

                return Json(new { success = true, message = "Reçete başarıyla kaydedildi!" });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Reçete kaydedilirken hata: " + ex.Message });
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }

    public class RecipeSaveModel
    {
        public int ProductId { get; set; }
        public string CookTime { get; set; }
        public string Station { get; set; }
        public string Ingredients { get; set; }
        public string Instructions { get; set; }
        public string ChefTip { get; set; }
    }
}