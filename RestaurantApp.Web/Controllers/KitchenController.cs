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

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
        public JsonResult GetActiveOrders()
        {
            try
            {
                // Sadece mutfakta henüz hazır olmayan (ReturnReason != "Hazır" ve ReturnReason != "Servis Edildi") ürünleri olan siparişleri listele
                var activeOrders = db.AppOrders
                    .Where(o => o.Status != "Tamamlandı" && o.Status != "İptal" &&
                                o.AppOrderDetails.Any(d => !d.IsReturned && d.ReturnReason != "Hazır" && d.ReturnReason != "Servis Edildi"))
                    .OrderBy(o => o.CreatedDate)
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
                            tableName = o.OrderType == "Masa" && o.AppTables != null ? o.AppTables.TableNumber : "Paket Servis",
                            deliveryAddress = o.DeliveryAddress,
                            orderDate = o.CreatedDate.ToString("HH:mm"),
                            orderFullDate = o.CreatedDate.ToString("yyyy-MM-ddTHH:mm:ss"),
                            orderNote = o.OrderNote,
                            items = kitchenItems
                        };
                    })
                    .Where(o => o.items.Any()) // Mutfakta kalemi kalmayan kartlar ana ekrandan tamamen kalkar
                    .ToList();

                return Json(new { success = true, data = activeOrders }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // SEÇİLEN ÜRÜNLERİ HAZIR YAPIP GARSONA GÖNDERME (MUTFAK LİSTESİNDEN ANINDA DÜŞER)
        [HttpPost]
        public JsonResult MarkItemsAsReady(int orderId, List<int> orderDetailIds)
        {
            try
            {
                var order = db.AppOrders.FirstOrDefault(x => x.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Sipariş bulunamadı." });

                if (orderDetailIds == null || !orderDetailIds.Any())
                {
                    return Json(new { success = false, message = "Lütfen hazır olan en az bir ürün seçiniz." });
                }

                var targetDetails = db.AppOrderDetails
                    .Where(d => d.OrderId == orderId && orderDetailIds.Contains(d.OrderDetailId) && !d.IsReturned)
                    .ToList();

                List<string> readyProductNames = new List<string>();
                List<int> processedIds = new List<int>();

                foreach (var detail in targetDetails)
                {
                    detail.ReturnReason = "Hazır"; // Ürün mutfaktan çıktı olarak işaretlendi
                    processedIds.Add(detail.OrderDetailId);
                    string pName = detail.AppProducts != null ? detail.AppProducts.ProductName : "Ürün";
                    readyProductNames.Add($"{detail.Quantity}x {pName}");
                }

                // Masadaki tüm ürünler hazırlandıysa siparişin ana statüsünü de "Hazır" yap
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

        // SİPARİŞTEKİ TÜM ÜRÜNLERİ TEK TIKLA HAZIRLAMA
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

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}