using Microsoft.AspNet.SignalR;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using RestaurantApp.Web.Hubs;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    // Paket servis takip ekranı. Akış:
    //   Mutfakta (Hazırlanıyor) -> Hazır (mutfak tüm ürünleri hazırladı) -> Yolda -> Tamamlandı
    //   Gel-Al siparişlerinde "Yolda" aşaması yoktur, Hazır'dan doğrudan teslim edilir.
    //   Kapıda ödemeli siparişlerde tahsilat "Teslim Edildi" adımında alınır; online ödenmişlerde borç zaten sıfırdır.
    //   Sipariş bir kuryeye atanabilir; kurye kendi ekranından (CourierController) aynı adımları yapar.
    //   Gün sonunda kuryenin topladığı nakit "Kurye Kasası"ndan teslim alınır (SettleCourier).
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
    public class DeliveryController : TenantController
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Index()
        {
            return View();
        }

        private bool IsAdmin
        {
            get { return (User as ClaimsPrincipal)?.FindFirst(ClaimTypes.Role)?.Value == "Admin"; }
        }

        private IQueryable<AppOrders> CompanyDeliveryOrders()
        {
            int companyId = CurrentCompanyId;
            return db.AppOrders.Where(o => o.CompanyId == companyId && o.OrderType == "PaketServis");
        }

        private IQueryable<AppUsers> CompanyCouriers()
        {
            int companyId = CurrentCompanyId;
            return db.AppUsers.Where(u => u.CompanyId == companyId && u.Role == DeliveryOptions.CourierRole && u.IsActive);
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

                var couriers = CompanyCouriers().OrderBy(u => u.FullName).ToList();
                var courierNames = couriers.ToDictionary(u => u.UserId, u => u.FullName);

                var activeOrders = CompanyDeliveryOrders()
                    .Where(o => o.Status != "Tamamlandı" && o.Status != "İptal")
                    .OrderByDescending(o => o.IsPriority)
                    .ThenBy(o => o.CreatedDate)
                    .ToList();

                var active = activeOrders.Select(o =>
                {
                    var items = o.AppOrderDetails.Where(d => !d.IsReturned).ToList();
                    string courierName = null;
                    if (o.CourierId.HasValue && !courierNames.TryGetValue(o.CourierId.Value, out courierName))
                        courierName = "Pasif kurye";

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
                        courierId = o.CourierId,
                        courierName = courierName,
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
                        amount = g.Sum(o => OrderAmounts.Value(o)),
                        commission = g.Sum(o => DeliveryOptions.CommissionAmount(o))
                    })
                    .OrderByDescending(x => x.amount)
                    .ToList();

                var recent = CompanyDeliveryOrders()
                    .Where(o => (o.Status == "Tamamlandı" || o.Status == "İptal") && o.CompletedDate >= today)
                    .OrderByDescending(o => o.CompletedDate)
                    .Take(30)
                    .ToList()
                    .Select(o =>
                    {
                        string courierName = null;
                        if (o.CourierId.HasValue) courierNames.TryGetValue(o.CourierId.Value, out courierName);
                        return new
                        {
                            orderId = o.OrderId,
                            channel = o.OrderChannel,
                            channelLabel = DeliveryOptions.ChannelLabel(o.OrderChannel),
                            externalOrderNo = o.ExternalOrderNo,
                            customerName = o.CustomerName,
                            courierName = courierName,
                            isCancelled = o.Status == "İptal",
                            cancelReason = o.CancelReason,
                            paymentType = o.PaymentType,
                            orderValue = OrderAmounts.Value(o),
                            completedTime = o.CompletedDate.HasValue ? o.CompletedDate.Value.ToString("HH:mm") : ""
                        };
                    })
                    .ToList();

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        active = active,
                        recent = recent,
                        couriers = couriers.Select(c => new
                        {
                            courierId = c.UserId,
                            name = c.FullName,
                            activeCount = activeOrders.Count(o => o.CourierId == c.UserId)
                        }).ToList(),
                        canManageCommission = IsAdmin,
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
                            commissionToday = todayValid.Sum(o => DeliveryOptions.CommissionAmount(o)),
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

        // courierId boş gelirse kurye ataması kaldırılır
        [HttpPost]
        public JsonResult AssignCourier(int orderId, int? courierId)
        {
            try
            {
                var order = CompanyDeliveryOrders().FirstOrDefault(o => o.OrderId == orderId);
                if (order == null || !DeliveryWorkflow.IsOpen(order))
                    return Json(new { success = false, message = "Açık paket siparişi bulunamadı." });

                if (order.OrderChannel == DeliveryOptions.ChannelPickup)
                    return Json(new { success = false, message = "Gel-Al siparişlerine kurye atanmaz." });

                string message;
                if (courierId.HasValue)
                {
                    var courier = CompanyCouriers().FirstOrDefault(u => u.UserId == courierId.Value);
                    if (courier == null)
                        return Json(new { success = false, message = "Kurye bulunamadı." });

                    order.CourierId = courier.UserId;
                    order.CourierAssignedDate = DateTime.Now;
                    message = $"#{order.OrderId} siparişi {courier.FullName} adlı kuryeye atandı.";
                }
                else
                {
                    order.CourierId = null;
                    order.CourierAssignedDate = null;
                    message = $"#{order.OrderId} siparişinin kurye ataması kaldırıldı.";
                }

                db.SaveChanges();
                NotifyDeliveryChanged();
                return Json(new { success = true, message = message });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        [HttpPost]
        public JsonResult MarkOutForDelivery(int orderId)
        {
            return RunWorkflow(orderId, order => DeliveryWorkflow.MarkOutForDelivery(order, DateTime.Now),
                order => $"#{order.OrderId} siparişi yola çıktı.");
        }

        // paymentMethod: "Nakit" veya "Kart" (yalnızca ödenmemiş tutar varsa gerekir)
        [HttpPost]
        public JsonResult CompleteDelivery(int orderId, string paymentMethod)
        {
            decimal due = 0;
            return RunWorkflow(orderId, order =>
            {
                due = order.TotalAmount;
                return DeliveryWorkflow.CompleteDelivery(order, paymentMethod, DateTime.Now);
            }, order => $"#{order.OrderId} teslim edildi." + (due > 0 ? $" {due:N2} ₺ {paymentMethod.ToLower()} tahsil edildi." : ""));
        }

        private JsonResult RunWorkflow(int orderId, Func<AppOrders, string> step, Func<AppOrders, string> successMessage)
        {
            try
            {
                var order = CompanyDeliveryOrders().FirstOrDefault(o => o.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Açık paket siparişi bulunamadı." });

                string error = step(order);
                if (error != null)
                    return Json(new { success = false, message = error });

                db.SaveChanges();
                NotifyDeliveryChanged();
                return Json(new { success = true, message = successMessage(order) });
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
                if (order == null || !DeliveryWorkflow.IsOpen(order))
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

        #region KURYE KASASI (GÜN SONU HESAP KAPATMA)

        // Kuryenin kasaya teslim etmediği siparişler: teslim edilmiş, kuryesi belli, hesabı kapatılmamış
        private IQueryable<AppOrders> UnsettledCourierOrders()
        {
            return CompanyDeliveryOrders().Where(o => o.Status == "Tamamlandı" && o.CourierId != null && o.CourierSettledDate == null);
        }

        [HttpGet]
        public JsonResult GetCourierCash()
        {
            try
            {
                DateTime today = DateTime.Today;
                var couriers = CompanyCouriers().OrderBy(u => u.FullName).ToList();
                var unsettled = UnsettledCourierOrders().ToList();
                var settledToday = CompanyDeliveryOrders().Where(o => o.CourierSettledDate >= today && o.CourierId != null).ToList();
                var deliveredToday = CompanyDeliveryOrders().Where(o => o.Status == "Tamamlandı" && o.CompletedDate >= today && o.CourierId != null).ToList();

                // Pasife alınmış ama elinde teslim edilmemiş nakit kalan kuryeler de listelenir
                var courierIds = couriers.Select(c => c.UserId).Union(unsettled.Select(o => o.CourierId.Value)).Distinct().ToList();
                var names = db.AppUsers.Where(u => courierIds.Contains(u.UserId)).ToDictionary(u => u.UserId, u => u.FullName);

                var rows = courierIds.Select(id =>
                {
                    var open = unsettled.Where(o => o.CourierId == id).ToList();
                    return new
                    {
                        courierId = id,
                        name = names.ContainsKey(id) ? names[id] : "Kurye",
                        deliveredTodayCount = deliveredToday.Count(o => o.CourierId == id),
                        unsettledOrderCount = open.Count,
                        unsettledCash = open.Sum(o => o.CashAmount ?? 0),
                        unsettledCard = open.Sum(o => o.CreditCardAmount ?? 0),
                        settledTodayCash = settledToday.Where(o => o.CourierId == id).Sum(o => o.CashAmount ?? 0)
                    };
                })
                .OrderByDescending(r => r.unsettledCash)
                .ThenBy(r => r.name)
                .ToList();

                return Json(new { success = true, data = rows }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Kurye kasası yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // expectedCash: ekranda gösterilen tutar. Bu arada yeni teslimat kapandıysa tutar değişir ve işlem reddedilir.
        [HttpPost]
        public JsonResult SettleCourier(int courierId, decimal expectedCash)
        {
            try
            {
                var orders = UnsettledCourierOrders().Where(o => o.CourierId == courierId).ToList();
                if (!orders.Any())
                    return Json(new { success = false, message = "Bu kuryenin kapatılacak hesabı yok." });

                decimal cash = orders.Sum(o => o.CashAmount ?? 0);
                if (cash != expectedCash)
                    return Json(new { success = false, message = $"Kuryenin nakit tutarı değişti ({cash:N2} ₺). Lütfen listeyi yenileyip tekrar deneyin." });

                DateTime now = DateTime.Now;
                foreach (var order in orders) order.CourierSettledDate = now;
                db.SaveChanges();

                return Json(new { success = true, message = $"{orders.Count} teslimatın hesabı kapatıldı. Kasaya {cash:N2} ₺ nakit teslim alındı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        #endregion

        #region PLATFORM KOMİSYON AYARLARI (ADMIN)

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult GetChannelSettings()
        {
            int companyId = CurrentCompanyId;
            var saved = db.ChannelSettings.Where(s => s.CompanyId == companyId).ToList();

            var data = DeliveryOptions.Platforms.Select(channel =>
            {
                var setting = saved.FirstOrDefault(s => s.Channel == channel);
                return new
                {
                    channel = channel,
                    label = DeliveryOptions.ChannelLabel(channel),
                    commissionRate = setting != null ? setting.CommissionRate : 0m
                };
            }).ToList();

            return Json(new { success = true, data = data }, JsonRequestBehavior.AllowGet);
        }

        public class ChannelRateModel
        {
            public string Channel { get; set; }
            public decimal CommissionRate { get; set; }
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult SaveChannelSettings(List<ChannelRateModel> rates)
        {
            try
            {
                if (rates == null || !rates.Any())
                    return Json(new { success = false, message = "Kaydedilecek oran yok." });

                foreach (var rate in rates)
                {
                    if (!DeliveryOptions.IsPlatform(rate.Channel))
                        return Json(new { success = false, message = "Geçersiz kanal." });
                    if (rate.CommissionRate < 0 || rate.CommissionRate > 100)
                        return Json(new { success = false, message = $"{DeliveryOptions.ChannelLabel(rate.Channel)} için oran 0 ile 100 arasında olmalı." });
                }

                int companyId = CurrentCompanyId;
                DateTime now = DateTime.Now;
                foreach (var rate in rates)
                {
                    var setting = db.ChannelSettings.FirstOrDefault(s => s.CompanyId == companyId && s.Channel == rate.Channel);
                    if (setting == null)
                    {
                        setting = new ChannelSettings { CompanyId = companyId, Channel = rate.Channel };
                        db.ChannelSettings.Add(setting);
                    }
                    setting.CommissionRate = Math.Round(rate.CommissionRate, 2);
                    setting.UpdatedDate = now;
                }

                db.SaveChanges();
                return Json(new { success = true, message = "Komisyon oranları kaydedildi. Yeni siparişlerde geçerli olacak." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        #endregion

        // Diğer paket ekranlarını, kurye ekranlarını ve (iptal edilen siparişi kaldırması için) mutfağı yeniler
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
