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
                        var activeOrders = db.AppOrders
                            .Where(o => o.TableId == t.TableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                            .ToList();

                        decimal activeTotal = activeOrders.Sum(o => o.TotalAmount);
                        bool isPriority = activeOrders.Any(o => o.IsPriority);

                        return new
                        {
                            tableId = t.TableId,
                            tableName = t.TableNumber,
                            tableNumber = t.TableNumber,
                            status = t.Status ?? "Bos",
                            currentAmount = activeTotal,
                            isPriority = isPriority,
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

                var readyItems = db.AppOrderDetails
                    .Where(d => d.OrderId == orderId && !d.IsReturned && d.ReturnReason == "Hazır")
                    .ToList();

                foreach (var item in readyItems)
                {
                    item.ReturnReason = "Servis Edildi";
                }

                var allActiveDetails = db.AppOrderDetails.Where(d => d.OrderId == orderId && !d.IsReturned).ToList();
                bool allDelivered = allActiveDetails.All(d => d.ReturnReason == "Servis Edildi");

                if (allDelivered)
                {
                    order.Status = "Servis Edildi";
                }

                order.DeliveredDate = DateTime.Now;
                db.SaveChanges();

                return Json(new { success = true, message = "Sipariş teslimatı onaylandı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        // SİPARİŞİ ACİL / VIP YAPMA VEYA ACİLİYETİ KALDIRMA API METODU
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult ToggleOrderPriority(int orderId)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(x => x.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Sipariş bulunamadı." });

                order.IsPriority = !order.IsPriority;
                db.SaveChanges();

                // Mutfak ekranına acil sipariş güncellemesini anlık bildir
                try
                {
                    var hubContext = GlobalHost.ConnectionManager.GetHubContext<OrderHub>();
                    hubContext.Clients.All.onNewOrderCreated();
                }
                catch (Exception signalrEx)
                {
                    System.Diagnostics.Debug.WriteLine("SignalR bildirim hatası: " + signalrEx.Message);
                }

                string msg = order.IsPriority ? "Sipariş ACİL/VIP olarak işaretlendi ve mutfakta en üste alındı!" : "Siparişin acil durumu kaldırıldı.";

                return Json(new { success = true, isPriority = order.IsPriority, message = msg });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Öncelik değiştirilirken hata: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult CreateOrder(CreateOrderViewModel model)
        {
            try
            {
                var requestedItems = model?.Items?.Where(i => i.Quantity > 0).ToList();
                if (requestedItems == null || !requestedItems.Any())
                {
                    return Json(new { success = false, message = "Sepette ürün bulunmamaktadır." });
                }

                if (model.OrderType == "Masa" && !model.TableId.HasValue)
                {
                    return Json(new { success = false, message = "Lütfen bir masa seçiniz." });
                }

                // Fiyatlar istemciden değil veritabanından alınır
                var productIds = requestedItems.Select(i => i.ProductId).Distinct().ToList();
                var products = db.AppProducts
                    .Where(p => productIds.Contains(p.ProductId) && p.IsActive)
                    .ToDictionary(p => p.ProductId);

                foreach (var item in requestedItems)
                {
                    AppProducts product;
                    if (!products.TryGetValue(item.ProductId, out product))
                    {
                        return Json(new { success = false, message = "Sepetteki ürünlerden biri menüde bulunamadı. Lütfen sayfayı yenileyin." });
                    }
                    if (!product.IsAvailable)
                    {
                        return Json(new { success = false, message = $"\"{product.ProductName}\" tükendi, siparişe eklenemez." });
                    }
                }

                int currentUserId = Session["UserId"] != null ? Convert.ToInt32(Session["UserId"]) : 1;
                DateTime now = DateTime.Now;

                AppOrders mainOrder = null;

                if (model.OrderType == "Masa")
                {
                    mainOrder = db.AppOrders
                        .Where(o => o.TableId == model.TableId.Value && o.Status != "Tamamlandı" && o.Status != "İptal")
                        .OrderBy(o => o.CreatedDate)
                        .FirstOrDefault();
                }

                if (mainOrder == null)
                {
                    mainOrder = new AppOrders
                    {
                        UserId = currentUserId,
                        OrderType = model.OrderType,
                        TableId = model.OrderType == "Masa" ? model.TableId : (int?)null,
                        DeliveryAddress = model.OrderType == "PaketServis" ? model.DeliveryAddress : null,
                        Latitude = model.OrderType == "PaketServis" ? model.Latitude : (decimal?)null,
                        Longitude = model.OrderType == "PaketServis" ? model.Longitude : (decimal?)null,
                        TotalAmount = 0,
                        OrderNote = !string.IsNullOrWhiteSpace(model.OrderNote) ? model.OrderNote.Trim() : null,
                        Status = "Hazırlanıyor",
                        IsPriority = model.IsPriority,
                        CreatedDate = now
                    };

                    db.AppOrders.Add(mainOrder);

                    if (model.OrderType == "Masa")
                    {
                        var selectedTable = db.AppTables.Find(model.TableId.Value);
                        if (selectedTable != null)
                        {
                            selectedTable.Status = "Dolu";
                        }
                    }

                    db.SaveChanges();
                }
                else
                {
                    if (!string.IsNullOrWhiteSpace(model.OrderNote))
                    {
                        mainOrder.OrderNote = model.OrderNote.Trim();
                    }

                    if (model.IsPriority)
                    {
                        mainOrder.IsPriority = true;
                    }

                    // Yeni ürünler mutfağa gideceği için sipariş tekrar hazırlanıyor durumuna döner.
                    // CreatedDate değiştirilmez: ilk sipariş saati korunur, ürün bazlı zaman AppOrderDetails.CreatedDate'te tutulur.
                    mainOrder.Status = "Hazırlanıyor";
                }

                var orderDetails = db.AppOrderDetails.Where(d => d.OrderId == mainOrder.OrderId).ToList();
                decimal addedAmount = 0;

                foreach (var item in requestedItems)
                {
                    decimal unitPrice = products[item.ProductId].Price;

                    // Sadece henüz mutfakta hazırlanmakta olan aynı fiyatlı satıra adet eklenir.
                    // Hazır / servis edilmiş satıra eklenirse mutfak yeni adedi görmez.
                    var preparingItem = orderDetails.FirstOrDefault(d =>
                        d.ProductId == item.ProductId && !d.IsReturned && d.ReturnReason == null && d.UnitPrice == unitPrice);

                    if (preparingItem != null)
                    {
                        preparingItem.Quantity += item.Quantity;
                    }
                    else
                    {
                        var newDetail = new AppOrderDetails
                        {
                            OrderId = mainOrder.OrderId,
                            ProductId = item.ProductId,
                            Quantity = item.Quantity,
                            UnitPrice = unitPrice,
                            IsReturned = false,
                            ReturnReason = null,
                            PaidQuantity = 0,
                            CreatedDate = now
                        };
                        db.AppOrderDetails.Add(newDetail);
                        orderDetails.Add(newDetail);
                    }

                    addedAmount += item.Quantity * unitPrice;
                }

                // TotalAmount kalan borçtur: yeniden hesaplanmaz, eklenen tutar kadar artırılır (alınmış ödemeler korunur)
                mainOrder.TotalAmount += addedAmount;

                db.SaveChanges();

                try
                {
                    var hubContext = GlobalHost.ConnectionManager.GetHubContext<OrderHub>();
                    hubContext.Clients.All.onNewOrderCreated();
                }
                catch (Exception signalrEx)
                {
                    System.Diagnostics.Debug.WriteLine("SignalR bildirim hatası: " + signalrEx.Message);
                }

                return Json(new { success = true, message = "Sipariş güncellendi ve mutfağa iletildi.", orderId = mainOrder.OrderId });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Sipariş işlenirken hata: " + ex.Message });
            }
        }

        #region ÜRÜN İADE İŞLEMİ

        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult ReturnOrderItem(int orderDetailId, string reason)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(reason))
                {
                    return Json(new { success = false, message = "Lütfen bir iade sebebi belirtiniz." });
                }

                var detail = db.AppOrderDetails.FirstOrDefault(d => d.OrderDetailId == orderDetailId);
                if (detail == null)
                {
                    return Json(new { success = false, message = "Sipariş kalemi bulunamadı." });
                }

                if (detail.IsReturned)
                {
                    return Json(new { success = false, message = "Bu ürün zaten iade edilmiş." });
                }

                var order = db.AppOrders.FirstOrDefault(o => o.OrderId == detail.OrderId);
                if (order == null)
                {
                    return Json(new { success = false, message = "Bağlı sipariş bulunamadı." });
                }

                if (detail.PaidQuantity > 0)
                {
                    return Json(new { success = false, message = "Ödemesi alınmış bir ürün iade edilemez." });
                }

                decimal lineAmount = detail.Quantity * detail.UnitPrice;

                // TotalAmount kalan borçtur; iade tutarı kalan borçtan büyükse ödenmiş paradan iade gerekir
                if (lineAmount > order.TotalAmount)
                {
                    return Json(new { success = false, message = $"Bu ürünün tutarı ({lineAmount:N2} ₺) masanın kalan borcundan ({order.TotalAmount:N2} ₺) fazla. Ödeme alınmış hesapta bu iade yapılamaz." });
                }

                detail.IsReturned = true;
                detail.ReturnReason = reason.Trim();
                order.TotalAmount -= lineAmount;

                db.SaveChanges();

                return Json(new
                {
                    success = true,
                    message = "Ürün başarıyla iade edildi.",
                    newTotalAmount = order.TotalAmount
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "İade işlemi sırasında hata: " + ex.Message });
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

    public class CreateOrderViewModel
    {
        public string OrderType { get; set; }
        public int? TableId { get; set; }
        public string DeliveryAddress { get; set; }
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
        public decimal TotalAmount { get; set; }
        public string OrderNote { get; set; }
        public bool IsPriority { get; set; } // EKLENDİ
        public List<OrderItemViewModel> Items { get; set; }
    }

    public class OrderItemViewModel
    {
        public int ProductId { get; set; }
        public int Quantity { get; set; }
        public decimal UnitPrice { get; set; }
    }
}