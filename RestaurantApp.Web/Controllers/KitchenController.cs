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

        // Mutfak Şefi Ekranı
        public ActionResult Index()
        {
            return View();
        }

        // Mutfakta bekleyen ("Hazırlanıyor" statüsündeki) siparişleri getirir
        [HttpGet]
        public JsonResult GetActiveOrders()
        {
            try
            {
                var orders = db.AppOrders
                    .Where(o => o.Status == "Hazırlanıyor")
                    .OrderBy(o => o.CreatedDate)
                    .ToList() // Veriyi önce belleğe alıyoruz
                    .Select(o => new
                    {
                        orderId = o.OrderId,
                        orderType = o.OrderType,
                        tableName = o.OrderType == "Masa" && o.AppTables != null ? o.AppTables.TableNumber : "Paket Servis",
                        deliveryAddress = o.DeliveryAddress,
                        orderDate = o.CreatedDate.ToString("HH:mm"), // Non-nullable DateTime doğrudan formatlanır
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