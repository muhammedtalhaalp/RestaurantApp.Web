using Microsoft.AspNet.SignalR;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using RestaurantApp.Web.Hubs;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    // Paket servis takip ekranı. Akış:
    //   Mutfakta (Hazırlanıyor) -> Hazır (mutfak tüm ürünleri hazırladı) -> Yolda -> Tamamlandı
    //   Gel-Al siparişlerinde "Yolda" aşaması yoktur, Hazır'dan doğrudan teslim edilir.
    //   Kapıda ödemeli siparişlerde tahsilat "Teslim Edildi" adımında alınır; online ödenmişlerde borç zaten sıfırdır.
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
    public class DeliveryController : TenantController
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Index()
        {
            return View();
        }

        private IQueryable<AppOrders> CompanyDeliveryOrders()
        {
            int companyId = CurrentCompanyId;
            return db.AppOrders.Where(o => o.CompanyId == companyId && o.OrderType == "PaketServis");
        }

        private static bool IsOpen(AppOrders order)
        {
            return order.Status != "Tamamlandı" && order.Status != "İptal";
        }

        private static string Stage(AppOrders order)
        {
            if (order.Status == DeliveryOptions.StatusOutForDelivery) return "onTheWay";
            return DeliveryOptions.IsKitchenReady(order) ? "ready" : "kitchen";
        }

        [HttpGet]
        public JsonResult GetBoard()
        {
            try
            {
                DateTime now = DateTime.Now;
                DateTime today = DateTime.Today;

                var activeOrders = CompanyDeliveryOrders()
                    .Where(o => o.Status != "Tamamlandı" && o.Status != "İptal")
                    .OrderByDescending(o => o.IsPriority)
                    .ThenBy(o => o.CreatedDate)
                    .ToList();

                var active = activeOrders.Select(o =>
                {
                    var items = o.AppOrderDetails.Where(d => !d.IsReturned).ToList();
                    return new
                    {
                        orderId = o.OrderId,
                        stage = Stage(o),
                        channel = o.OrderChannel,
                        channelLabel = DeliveryOptions.ChannelLabel(o.OrderChannel),
                        isPickup = o.OrderChannel == DeliveryOptions.ChannelPickup,
                        isPlatform = DeliveryOptions.IsPlatform(o.OrderChannel),
                        externalOrderNo = o.ExternalOrderNo,
                        customerName = o.CustomerName,
                        customerPhone = o.CustomerPhone,
                        address = o.DeliveryAddress,
                        latitude = o.Latitude,
                        longitude = o.Longitude,
                        note = o.OrderNote,
                        isPriority = o.IsPriority,
                        paymentPlan = o.DeliveryPaymentPlan,
                        paymentPlanLabel = DeliveryOptions.PlanLabel(o.DeliveryPaymentPlan, o.OrderChannel),
                        changeFor = o.ChangeFor,
                        orderValue = OrderAmounts.Value(o),
                        dueAmount = o.TotalAmount,
                        createdTime = o.CreatedDate.ToString("HH:mm"),
                        createdDate = o.CreatedDate.ToString("dd.MM.yyyy"),
                        minutesSinceCreated = (int)Math.Max(0, (now - o.CreatedDate).TotalMinutes),
                        outForDeliveryTime = o.OutForDeliveryDate.HasValue ? o.OutForDeliveryDate.Value.ToString("HH:mm") : null,
                        minutesOnTheWay = o.OutForDeliveryDate.HasValue ? (int)Math.Max(0, (now - o.OutForDeliveryDate.Value).TotalMinutes) : (int?)null,
                        readyItemCount = items.Count(d => d.ReturnReason == "Hazır" || d.ReturnReason == "Servis Edildi"),
                        itemCount = items.Count,
                        items = items.Select(d => new
                        {
                            name = d.AppProducts != null ? d.AppProducts.ProductName : "Ürün",
                            quantity = d.Quantity,
                            isReady = d.ReturnReason == "Hazır" || d.ReturnReason == "Servis Edildi"
                        }).ToList()
                    };
                }).ToList();

                // Günün özeti: bugün açılan paket siparişleri (iptaller ciroya dahil edilmez)
                var todayOrders = CompanyDeliveryOrders().Where(o => o.CreatedDate >= today).ToList();
                var todayValid = todayOrders.Where(o => o.Status != "İptal").ToList();

                var byChannel = todayValid
                    .GroupBy(o => o.OrderChannel ?? DeliveryOptions.ChannelPhone)
                    .Select(g => new
                    {
                        channel = g.Key,
                        label = DeliveryOptions.ChannelLabel(g.Key),
                        count = g.Count(),
                        amount = g.Sum(o => OrderAmounts.Value(o))
                    })
                    .OrderByDescending(x => x.amount)
                    .ToList();

                var recent = CompanyDeliveryOrders()
                    .Where(o => (o.Status == "Tamamlandı" || o.Status == "İptal") && o.CompletedDate >= today)
                    .OrderByDescending(o => o.CompletedDate)
                    .Take(30)
                    .ToList()
                    .Select(o => new
                    {
                        orderId = o.OrderId,
                        channel = o.OrderChannel,
                        channelLabel = DeliveryOptions.ChannelLabel(o.OrderChannel),
                        externalOrderNo = o.ExternalOrderNo,
                        customerName = o.CustomerName,
                        isCancelled = o.Status == "İptal",
                        cancelReason = o.CancelReason,
                        paymentType = o.PaymentType,
                        orderValue = OrderAmounts.Value(o),
                        completedTime = o.CompletedDate.HasValue ? o.CompletedDate.Value.ToString("HH:mm") : ""
                    })
                    .ToList();

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        active = active,
                        recent = recent,
                        summary = new
                        {
                            activeCount = active.Count,
                            onTheWayCount = active.Count(a => a.stage == "onTheWay"),
                            deliveredTodayCount = todayOrders.Count(o => o.Status == "Tamamlandı"),
                            cancelledTodayCount = todayOrders.Count(o => o.Status == "İptal"),
                            revenueToday = todayValid.Sum(o => OrderAmounts.Value(o)),
                            onlineToday = todayValid.Sum(o => o.OnlineAmount ?? 0),
                            cashToday = todayValid.Sum(o => o.CashAmount ?? 0),
                            cardToday = todayValid.Sum(o => o.CreditCardAmount ?? 0),
                            byChannel = byChannel
                        }
                    }
                }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Paket siparişleri yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // Kurye yola çıktı: mutfağın tüm ürünleri hazırlamış olması gerekir
        [HttpPost]
        public JsonResult MarkOutForDelivery(int orderId)
        {
            try
            {
                var order = CompanyDeliveryOrders().FirstOrDefault(o => o.OrderId == orderId);
                if (order == null || !IsOpen(order))
                    return Json(new { success = false, message = "Açık paket siparişi bulunamadı." });

                if (order.OrderChannel == DeliveryOptions.ChannelPickup)
                    return Json(new { success = false, message = "Gel-Al siparişleri yola çıkmaz; hazır olunca doğrudan teslim edilir." });

                if (order.Status == DeliveryOptions.StatusOutForDelivery)
                    return Json(new { success = false, message = "Sipariş zaten yolda." });

                if (!DeliveryOptions.IsKitchenReady(order))
                    return Json(new { success = false, message = "Mutfak bu siparişi henüz hazırlamadı." });

                MarkItemsServed(order);
                order.Status = DeliveryOptions.StatusOutForDelivery;
                order.OutForDeliveryDate = DateTime.Now;
                db.SaveChanges();

                NotifyDeliveryChanged();
                return Json(new { success = true, message = $"#{order.OrderId} siparişi yola çıktı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        // Teslim edildi: kapıda ödemeliyse tahsilat aynı adımda alınır, sipariş kapanır.
        // paymentMethod: "Nakit" veya "Kart" (yalnızca ödenmemiş tutar varsa gerekir)
        [HttpPost]
        public JsonResult CompleteDelivery(int orderId, string paymentMethod)
        {
            try
            {
                var order = CompanyDeliveryOrders().FirstOrDefault(o => o.OrderId == orderId);
                if (order == null || !IsOpen(order))
                    return Json(new { success = false, message = "Açık paket siparişi bulunamadı." });

                bool isPickup = order.OrderChannel == DeliveryOptions.ChannelPickup;
                if (!isPickup && order.Status != DeliveryOptions.StatusOutForDelivery)
                    return Json(new { success = false, message = "Önce siparişi 'Yola Çıktı' olarak işaretleyin." });

                if (isPickup && !DeliveryOptions.IsKitchenReady(order))
                    return Json(new { success = false, message = "Mutfak bu siparişi henüz hazırlamadı." });

                decimal due = order.TotalAmount;
                if (due > 0)
                {
                    if (paymentMethod == "Nakit")
                    {
                        order.CashAmount = (order.CashAmount ?? 0) + due;
                    }
                    else if (paymentMethod == "Kart")
                    {
                        order.CreditCardAmount = (order.CreditCardAmount ?? 0) + due;
                    }
                    else
                    {
                        return Json(new { success = false, message = "Lütfen tahsilat şeklini (Nakit / Kart) seçiniz." });
                    }

                    order.TotalAmount = 0;
                    order.PaymentType = (isPickup ? "Gişede " : "Kapıda ") + paymentMethod;
                }

                DateTime now = DateTime.Now;
                MarkItemsServed(order);
                order.DeliveredDate = now;
                order.CompletedDate = now;
                order.Status = "Tamamlandı";
                db.SaveChanges();

                NotifyDeliveryChanged();
                string collected = due > 0 ? $" {due:N2} ₺ {paymentMethod.ToLower()} tahsil edildi." : "";
                return Json(new { success = true, message = $"#{order.OrderId} teslim edildi.{collected}" });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult CancelOrder(int orderId, string reason)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(reason))
                    return Json(new { success = false, message = "Lütfen iptal sebebini yazınız." });

                var order = CompanyDeliveryOrders().FirstOrDefault(o => o.OrderId == orderId);
                if (order == null || !IsOpen(order))
                    return Json(new { success = false, message = "Açık paket siparişi bulunamadı." });

                reason = reason.Trim();
                order.Status = "İptal";
                order.CancelReason = reason.Length > 250 ? reason.Substring(0, 250) : reason;
                order.CompletedDate = DateTime.Now;
                db.SaveChanges();

                NotifyDeliveryChanged();
                return Json(new { success = true, message = $"#{order.OrderId} siparişi iptal edildi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        // Teslim edilen ürünler mutfak / garson listelerinden düşsün diye "Servis Edildi" yapılır
        private static void MarkItemsServed(AppOrders order)
        {
            foreach (var item in order.AppOrderDetails.Where(d => !d.IsReturned))
            {
                item.ReturnReason = "Servis Edildi";
            }
        }

        // Diğer paket ekranlarını ve (iptal edilen siparişi kaldırması için) mutfağı yeniler
        private void NotifyDeliveryChanged()
        {
            try
            {
                var group = GlobalHost.ConnectionManager.GetHubContext<OrderHub>().Clients.Group(OrderHub.CompanyGroup(CurrentCompanyId));
                group.onDeliveryUpdated();
                group.onOrderDelivered(0);
            }
            catch (Exception signalrEx)
            {
                System.Diagnostics.Debug.WriteLine("SignalR bildirim hatası: " + signalrEx.Message);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}
