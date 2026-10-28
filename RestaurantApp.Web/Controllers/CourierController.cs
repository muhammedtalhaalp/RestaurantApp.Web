using Microsoft.AspNet.SignalR;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using RestaurantApp.Web.Hubs;
using System;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    // Kuryenin telefonundan kullandığı ekran. Kurye yalnızca kendisine atanmış paket siparişlerini görür ve
    // yalnızca onlar üzerinde "Yola Çıktım" / "Teslim Ettim" işlemlerini yapabilir (kurallar: DeliveryWorkflow).
    [JwtAuthorize(Roles = "Kurye")]
    public class CourierController : TenantController
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Index()
        {
            return View();
        }

        private IQueryable<AppOrders> MyOrders()
        {
            int companyId = CurrentCompanyId;
            int courierId = CurrentUserId;
            return db.AppOrders.Where(o => o.CompanyId == companyId && o.OrderType == "PaketServis" && o.CourierId == courierId);
        }

        [HttpGet]
        public JsonResult GetMyOrders()
        {
            try
            {
                DateTime now = DateTime.Now;
                DateTime today = DateTime.Today;

                var active = MyOrders()
                    .Where(o => o.Status != "Tamamlandı" && o.Status != "İptal")
                    .OrderByDescending(o => o.Status == DeliveryOptions.StatusOutForDelivery)
                    .ThenByDescending(o => o.IsPriority)
                    .ThenBy(o => o.CourierAssignedDate)
                    .ToList()
                    .Select(o =>
                    {
                        var items = o.AppOrderDetails.Where(d => !d.IsReturned).ToList();
                        return new
                        {
                            orderId = o.OrderId,
                            stage = o.Status == DeliveryOptions.StatusOutForDelivery ? "onTheWay"
                                  : (DeliveryOptions.IsKitchenReady(o) ? "ready" : "kitchen"),
                            channel = o.OrderChannel,
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
                            minutesSinceCreated = (int)Math.Max(0, (now - o.CreatedDate).TotalMinutes),
                            minutesOnTheWay = o.OutForDeliveryDate.HasValue ? (int)Math.Max(0, (now - o.OutForDeliveryDate.Value).TotalMinutes) : (int?)null,
                            itemCount = items.Sum(d => d.Quantity),
                            items = items.Select(d => new
                            {
                                name = d.AppProducts != null ? d.AppProducts.ProductName : "Ürün",
                                quantity = d.Quantity
                            }).ToList()
                        };
                    })
                    .ToList();

                var deliveredToday = MyOrders().Where(o => o.Status == "Tamamlandı" && o.CompletedDate >= today).ToList();
                var unsettled = MyOrders().Where(o => o.Status == "Tamamlandı" && o.CourierSettledDate == null).ToList();

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        active = active,
                        summary = new
                        {
                            deliveredTodayCount = deliveredToday.Count,
                            cashOnHand = unsettled.Sum(o => o.CashAmount ?? 0),
                            cardToday = deliveredToday.Sum(o => o.CreditCardAmount ?? 0)
                        },
                        recent = deliveredToday
                            .OrderByDescending(o => o.CompletedDate)
                            .Take(15)
                            .Select(o => new
                            {
                                orderId = o.OrderId,
                                channel = o.OrderChannel,
                                customerName = o.CustomerName,
                                paymentType = o.PaymentType,
                                orderValue = OrderAmounts.Value(o),
                                completedTime = o.CompletedDate.HasValue ? o.CompletedDate.Value.ToString("HH:mm") : ""
                            })
                            .ToList()
                    }
                }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Teslimatlar yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        public JsonResult MarkOutForDelivery(int orderId)
        {
            return RunWorkflow(orderId, order => DeliveryWorkflow.MarkOutForDelivery(order, DateTime.Now), "Yola çıktınız. İyi yolculuklar!");
        }

        [HttpPost]
        public JsonResult CompleteDelivery(int orderId, string paymentMethod)
        {
            return RunWorkflow(orderId, order => DeliveryWorkflow.CompleteDelivery(order, paymentMethod, DateTime.Now), "Teslimat tamamlandı.");
        }

        private JsonResult RunWorkflow(int orderId, Func<AppOrders, string> step, string successMessage)
        {
            try
            {
                var order = MyOrders().FirstOrDefault(o => o.OrderId == orderId);
                if (order == null)
                    return Json(new { success = false, message = "Bu sipariş size atanmamış." });

                string error = step(order);
                if (error != null)
                    return Json(new { success = false, message = error });

                db.SaveChanges();

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

                return Json(new { success = true, message = successMessage });
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
