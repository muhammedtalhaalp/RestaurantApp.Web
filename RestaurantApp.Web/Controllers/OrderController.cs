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
                        var activeOrder = db.AppOrders
                            .Where(o => o.TableId == t.TableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                            .OrderBy(o => o.CreatedDate)
                            .FirstOrDefault();

                        decimal activeTotal = activeOrder != null ? activeOrder.TotalAmount : 0;

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
                order.DeliveredDate = DateTime.Now; // TESLİMAT SAATİ KAYDEDİLİYOR
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

                AppOrders mainOrder = null;

                if (model.OrderType == "Masa" && model.TableId.HasValue)
                {
                    mainOrder = db.AppOrders.FirstOrDefault(o => o.TableId == model.TableId.Value && o.Status != "Tamamlandı" && o.Status != "İptal");
                }

                if (mainOrder != null)
                {
                    // Var olan masaya yeni sipariş eklenirken Genel Sipariş Notu varsa güncellenir
                    if (!string.IsNullOrWhiteSpace(model.OrderNote))
                    {
                        mainOrder.OrderNote = model.OrderNote.Trim();
                    }

                    var existingDetails = db.AppOrderDetails.Where(d => d.OrderId == mainOrder.OrderId).ToList();

                    foreach (var item in model.Items)
                    {
                        var existingItem = existingDetails.FirstOrDefault(d => d.ProductId == item.ProductId && !d.IsReturned);

                        if (existingItem != null)
                        {
                            existingItem.Quantity += item.Quantity;
                        }
                        else
                        {
                            var newDetail = new AppOrderDetails
                            {
                                OrderId = mainOrder.OrderId,
                                ProductId = item.ProductId,
                                Quantity = item.Quantity,
                                UnitPrice = item.UnitPrice,
                                IsReturned = false,
                                ReturnReason = null
                            };
                            db.AppOrderDetails.Add(newDetail);
                        }
                    }

                    db.SaveChanges();

                    var allUpdatedDetails = db.AppOrderDetails.Where(d => d.OrderId == mainOrder.OrderId && !d.IsReturned).ToList();
                    mainOrder.TotalAmount = allUpdatedDetails.Sum(x => x.Quantity * x.UnitPrice);
                    mainOrder.CreatedDate = DateTime.Now;
                }
                else
                {
                    // İlk defa oluşturulan yeni sipariş
                    mainOrder = new AppOrders
                    {
                        UserId = currentUserId,
                        OrderType = model.OrderType,
                        TableId = model.OrderType == "Masa" ? model.TableId : (int?)null,
                        DeliveryAddress = model.OrderType == "PaketServis" ? model.DeliveryAddress : null,
                        Latitude = model.OrderType == "PaketServis" ? model.Latitude : (decimal?)null,
                        Longitude = model.OrderType == "PaketServis" ? model.Longitude : (decimal?)null,
                        TotalAmount = model.TotalAmount,
                        OrderNote = !string.IsNullOrWhiteSpace(model.OrderNote) ? model.OrderNote.Trim() : null, // GENEL SİPARİŞ NOTU
                        Status = "Hazırlanıyor",
                        CreatedDate = DateTime.Now
                    };

                    db.AppOrders.Add(mainOrder);

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
                            OrderId = mainOrder.OrderId,
                            ProductId = item.ProductId,
                            Quantity = item.Quantity,
                            UnitPrice = item.UnitPrice,
                            IsReturned = false,
                            ReturnReason = null
                        };
                        db.AppOrderDetails.Add(detail);
                    }
                }

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

                detail.IsReturned = true;
                detail.ReturnReason = reason.Trim();

                var activeDetails = db.AppOrderDetails.Where(d => d.OrderId == order.OrderId && !d.IsReturned && d.OrderDetailId != orderDetailId).ToList();

                if (activeDetails.Any())
                {
                    order.TotalAmount = activeDetails.Sum(d => d.Quantity * d.UnitPrice);
                }
                else
                {
                    order.TotalAmount = 0;
                }

                db.SaveChanges();

                return Json(new
                {
                    success = true,
                    message = "Ürün başarıyla iade edildi.",
                    newTotalAmount = order.TotalAmount
                });
            }
            catch (System.Data.Entity.Validation.DbEntityValidationException dbEx)
            {
                var errorMessages = dbEx.EntityValidationErrors
                    .SelectMany(x => x.ValidationErrors)
                    .Select(x => x.PropertyName + ": " + x.ErrorMessage);

                string fullErrorMessage = string.Join(" | ", errorMessages);
                return Json(new { success = false, message = "Veritabanı Doğrulama Hatası: " + fullErrorMessage });
            }
            catch (Exception ex)
            {
                string innerMsg = ex.InnerException != null ? (ex.InnerException.InnerException != null ? ex.InnerException.InnerException.Message : ex.InnerException.Message) : ex.Message;
                return Json(new { success = false, message = "İade işlemi sırasında hata: " + innerMsg });
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
        public string OrderNote { get; set; } // GENEL SİPARİŞ NOTU ALANI
        public List<OrderItemViewModel> Items { get; set; }
    }

    public class OrderItemViewModel
    {
        public int ProductId { get; set; }
        public int Quantity { get; set; }
        public decimal UnitPrice { get; set; }
    }
}