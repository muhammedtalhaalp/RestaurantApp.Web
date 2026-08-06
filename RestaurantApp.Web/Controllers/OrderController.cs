using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
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

        public ActionResult POS()
        {
            return View();
        }

        // YENİ: Garson Sipariş Takip Sayfası ActionResult
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
                    .Select(t => new
                    {
                        tableId = t.TableId,
                        tableName = t.TableNumber, // "Masa Masa-1" çiftlemesini önlemek için doğrudan veritabanı verisi aktarılıyor
                        tableNumber = t.TableNumber,
                        status = t.Status ?? "Bos",
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

        // 2. POS Ekranı İçin Ürün Getirme Endpoint'i
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

        // 3. Mutfak Şefinin Siparişi "Hazır" İşaretlemesi
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
        public JsonResult MarkOrderAsReady(int orderId)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(x => x.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Sipariş bulunamadı." });

                order.Status = "Hazır";
                db.SaveChanges();

                return Json(new
                {
                    success = true,
                    message = "Sipariş hazır olarak işaretlendi.",
                    orderId = order.OrderId,
                    tableName = order.TableId.HasValue && order.AppTables != null ? order.AppTables.TableNumber : "Paket Servis",
                    orderType = order.OrderType,
                    address = order.DeliveryAddress
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Bir hata oluştu: " + ex.Message });
            }
        }

        // 4. Garsonun Bildirimi/Siparişi Onaylayıp "Tamamlandı" İşaretlemesi
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson/Kasiyer, Garson, Kasiyer")]
        public JsonResult ApproveOrderDelivery(int orderId)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(x => x.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Sipariş bulunamadı." });

                order.Status = "Tamamlandı";
                db.SaveChanges();

                return Json(new { success = true, message = "Sipariş teslimatı onaylandı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        // 5. Yeni Sipariş Oluşturma
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

                return Json(new { success = true, message = "Sipariş başarıyla oluşturuldu.", orderId = newOrder.OrderId });
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