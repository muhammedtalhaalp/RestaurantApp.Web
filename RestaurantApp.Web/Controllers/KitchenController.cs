using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using System;
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

        
        [HttpGet]
        public JsonResult GetActiveOrders()
        {
            try
            {
                var orders = db.AppOrders
                    .Where(o => o.Status == "Hazırlanıyor")
                    .OrderBy(o => o.CreatedDate)
                    .ToList()
                    .Select(o => new
                    {
                        orderId = o.OrderId,
                        orderType = o.OrderType,
                        tableName = o.OrderType == "Masa" && o.AppTables != null ? o.AppTables.TableNumber : "Paket Servis",
                        deliveryAddress = o.DeliveryAddress,
                        orderDate = o.CreatedDate.ToString("HH:mm"),
                        items = o.AppOrderDetails.Select(d => new
                        {
                            productName = d.AppProducts != null ? d.AppProducts.ProductName : "Ürün",
                            quantity = d.Quantity,
                            unitPrice = d.UnitPrice
                        }).ToList()
                    }).ToList();

                return Json(new { success = true, data = orders }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Siparişler yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
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