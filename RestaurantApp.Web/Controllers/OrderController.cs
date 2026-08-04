using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
    public class OrderController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult POS()
        {
            return View();
        }

        // 1. Şirkete Ait Aktif Masaları Getir
        [HttpGet]
        [AllowAnonymous] // AJAX çağrılarında yetki takılmasını önler
        public JsonResult GetTables()
        {
            try
            {
                var tables = db.AppTables
                    .Where(t => t.IsActive)
                    .Select(t => new
                    {
                        tableId = t.TableId,
                        tableName = "Masa " + t.TableNumber
                    }).ToList();

                return Json(new { success = true, data = tables }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // 2. Yeni Sipariş Oluşturma (Görev 3.4: Harita Konumu ve Adres ile Birlikte)
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
                db.SaveChanges();

                // Sipariş Detaylarını Ekle (TotalPrice kaldırıldı)
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