using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Hubs;
using Microsoft.AspNet.SignalR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer, Mutfak Şefi, Mutfak")]
    public class OrderController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Index()
        {
            return View();
        }

        public ActionResult POS()
        {
            return View();
        }

        public ActionResult WaiterOrderTracking()
        {
            return View();
        }

        [HttpGet]
        [AllowAnonymous]
        public JsonResult GetTables()
        {
            try
            {
                var tables = db.AppTables
                    .Where(t => t.IsActive)
                    .ToList()
                    .Select(t =>
                    {
                        var activeTotal = db.AppOrders
                            .Where(o => o.TableId == t.TableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                            .Sum(o => (decimal?)o.TotalAmount) ?? 0;

                        return new
                        {
                            tableId = t.TableId,
                            tableName = t.TableNumber,
                            tableNumber = t.TableNumber,
                            status = t.Status ?? "Bos",
                            currentAmount = activeTotal,
                            section = t.Section ?? "Salon",
                            shape = t.Shape ?? "Square",
                            posX = t.PosX ?? 50,
                            posY = t.PosY ?? 50,
                            width = t.Width ?? 75,
                            height = t.Height ?? 75
                        };
                    }).ToList();

                return Json(new { success = true, data = tables }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpGet]
        [AllowAnonymous]
        public JsonResult GetProducts(int? companyId)
        {
            try
            {
                int targetCompanyId = companyId.HasValue && companyId.Value > 0 ? companyId.Value : 1;

                var products = db.AppProducts
                    .Where(p => p.CompanyId == targetCompanyId && p.IsActive)
                    .Select(p => new
                    {
                        p.ProductId,
                        p.ProductName,
                        p.Price,
                        p.CategoryId,
                        CategoryName = p.AppCategories != null ? p.AppCategories.CategoryName : "Kategorisiz",
                        IsCategoryActive = p.AppCategories == null || p.AppCategories.IsActive,
                        p.Description,
                        p.ImageUrl,
                        p.IsAvailable
                    }).ToList();

                return Json(new { success = true, data = products }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ürünler yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson/Kasiyer, Garson, Kasiyer")]
        public JsonResult ApproveOrderDelivery(int orderId)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(x => x.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Sipariş bulunamadı." });

                order.Status = "Servis Edildi";
                db.SaveChanges();

                return Json(new { success = true, message = "Sipariş teslimatı onaylandı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult CreateOrder(CreateOrderViewModel model)
        {
            try
            {
                if (model == null || model.Items == null || !model.Items.Any())
                {
                    return Json(new { success = false, message = "Sepette ürün bulunmamaktadır." });
                }

                int currentUserId = Session["UserId"] != null ? Convert.ToInt32(Session["UserId"]) : 1;

                var newOrder = new AppOrders
                {
                    UserId = currentUserId,
                    OrderType = model.OrderType,
                    TableId = model.OrderType == "Masa" ? model.TableId : (int?)null,
                    DeliveryAddress = model.OrderType == "PaketServis" ? model.DeliveryAddress : null,
                    Latitude = model.OrderType == "PaketServis" ? model.Latitude : (decimal?)null,
                    Longitude = model.OrderType == "PaketServis" ? model.Longitude : (decimal?)null,
                    TotalAmount = model.TotalAmount,
                    Status = "Hazırlanıyor",
                    CreatedDate = DateTime.Now
                };

                db.AppOrders.Add(newOrder);

                if (model.OrderType == "Masa" && model.TableId.HasValue)
                {
                    var selectedTable = db.AppTables.Find(model.TableId.Value);
                    if (selectedTable != null)
                    {
                        selectedTable.Status = "Dolu";
                    }
                }

                db.SaveChanges();

                foreach (var item in model.Items)
                {
                    var detail = new AppOrderDetails
                    {
                        OrderId = newOrder.OrderId,
                        ProductId = item.ProductId,
                        Quantity = item.Quantity,
                        UnitPrice = item.UnitPrice
                    };
                    db.AppOrderDetails.Add(detail);
                }

                db.SaveChanges();

                // SignalR İLE MUTFAK EKRANINA BİLDİRİM FIRLATILIYOR (Mutfakta Ses Çalacak)
                try
                {
                    var hubContext = GlobalHost.ConnectionManager.GetHubContext<OrderHub>();
                    hubContext.Clients.All.onNewOrderCreated();
                }
                catch (Exception signalrEx)
                {
                    // SignalR bildirim hatası sipariş kaydını engellemesin
                    System.Diagnostics.Debug.WriteLine("SignalR bildirim hatası: " + signalrEx.Message);
                }

                return Json(new { success = true, message = "Sipariş mutfağa iletildi.", orderId = newOrder.OrderId });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Sipariş oluşturulurken hata: " + ex.Message });
            }
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

    public class CreateOrderViewModel
    {
        public string OrderType { get; set; }
        public int? TableId { get; set; }
        public string DeliveryAddress { get; set; }
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
        public decimal TotalAmount { get; set; }
        public List<OrderItemViewModel> Items { get; set; }
    }

    public class OrderItemViewModel
    {
        public int ProductId { get; set; }
        public int Quantity { get; set; }
        public decimal UnitPrice { get; set; }
    }
}