using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
    public class TableController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Index()
        {
            var tables = db.AppTables.Where(t => t.IsActive).ToList();
            return View(tables);
        }

        #region MASA KONTROLÜ, PARÇALI ÖDEME VE MASA BOŞALTMA İŞLEMLERİ

        [HttpGet]
        public ActionResult TableControl()
        {
            return View("~/Views/Order/TableControl.cshtml");
        }

        // DOLU MASALARI LİSTELEME
        [HttpGet]
        public JsonResult GetOccupiedTables()
        {
            try
            {
                var occupiedTables = db.AppTables
                    .Where(t => t.IsActive && t.Status == "Dolu")
                    .ToList()
                    .Select(t =>
                    {
                        var activeOrders = db.AppOrders
                            .Where(o => o.TableId == t.TableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                            .ToList();

                        decimal totalAmount = activeOrders.Sum(o => (decimal?)o.TotalAmount) ?? 0;

                        // Kalan tutar 0 veya daha az ise ödeme tamamlanmıştır
                        bool isPaid = activeOrders.Any() && totalAmount <= 0;

                        return new
                        {
                            tableId = t.TableId,
                            tableName = t.TableNumber,
                            section = t.Section ?? "Salon",
                            status = t.Status,
                            totalAmount = totalAmount > 0 ? totalAmount : 0,
                            isPaid = isPaid
                        };
                    }).ToList();

                return Json(new { success = true, data = occupiedTables }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Dolu masalar yüklenirken hata oluştu: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // 1. ÜRÜN BAZLI PARÇALI ÖDEME (ÖDENEN ÜRÜNLER ADİSYONDAN VE TUTARDAN EKSİLİR)
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult PayByItems(int tableId, List<PaidItemModel> paidItems, decimal? cashAmount, decimal? creditCardAmount, decimal? mealCardAmount, string paymentType)
        {
            try
            {
                if (paidItems == null || !paidItems.Any())
                {
                    return Json(new { success = false, message = "Lütfen ödenecek en az bir ürün seçiniz." });
                }

                var mainOrder = db.AppOrders
                    .Where(o => o.TableId == tableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                    .OrderBy(o => o.CreatedDate)
                    .FirstOrDefault();

                if (mainOrder == null)
                {
                    return Json(new { success = false, message = "Aktif sipariş bulunamadı." });
                }

                decimal totalCash = cashAmount ?? 0;
                decimal totalCredit = creditCardAmount ?? 0;
                decimal totalMeal = mealCardAmount ?? 0;

                mainOrder.CashAmount = (mainOrder.CashAmount ?? 0) + totalCash;
                mainOrder.CreditCardAmount = (mainOrder.CreditCardAmount ?? 0) + totalCredit;
                mainOrder.MealCardAmount = (mainOrder.MealCardAmount ?? 0) + totalMeal;
                mainOrder.PaymentType = !string.IsNullOrWhiteSpace(paymentType) ? paymentType : "Parçalı Ödeme";

                // Seçilen ürünleri sipariş detayından eksilt veya sil
                foreach (var pItem in paidItems)
                {
                    var detail = db.AppOrderDetails.FirstOrDefault(d => d.OrderDetailId == pItem.OrderDetailId && d.OrderId == mainOrder.OrderId);
                    if (detail != null && !detail.IsReturned)
                    {
                        if (detail.Quantity > pItem.Quantity)
                        {
                            detail.Quantity -= pItem.Quantity;
                        }
                        else
                        {
                            db.AppOrderDetails.Remove(detail);
                        }
                    }
                }

                db.SaveChanges();

                // Masada kalan aktif ürünlerin toplamını yeniden hesapla
                var remainingDetails = db.AppOrderDetails.Where(d => d.OrderId == mainOrder.OrderId && !d.IsReturned).ToList();
                mainOrder.TotalAmount = remainingDetails.Sum(d => d.Quantity * d.UnitPrice);

                db.SaveChanges();

                return Json(new
                {
                    success = true,
                    message = "Seçilen ürünlerin ödemesi alındı.",
                    remainingAmount = mainOrder.TotalAmount,
                    isFullyPaid = mainOrder.TotalAmount <= 0
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ödeme işlenirken hata: " + ex.Message });
            }
        }

        // SERBEST TUTAR BAZLI PARÇALI ÖDEME
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult PayByAmount(int tableId, decimal paidAmount, decimal? cashAmount, decimal? creditCardAmount, decimal? mealCardAmount, string paymentType)
        {
            try
            {
                if (paidAmount <= 0)
                {
                    return Json(new { success = false, message = "Lütfen geçerli bir ödeme tutarı giriniz." });
                }

                var activeOrders = db.AppOrders
                    .Where(o => o.TableId == tableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                    .OrderBy(o => o.CreatedDate)
                    .ToList();

                if (!activeOrders.Any())
                {
                    return Json(new { success = false, message = "Aktif sipariş bulunamadı." });
                }

                decimal totalCash = cashAmount ?? 0;
                decimal totalCredit = creditCardAmount ?? 0;
                decimal totalMeal = mealCardAmount ?? 0;
                string finalPayType = !string.IsNullOrWhiteSpace(paymentType) ? paymentType : "Parçalı Ödeme";

                var firstOrder = activeOrders.First();
                firstOrder.CashAmount = (firstOrder.CashAmount ?? 0) + totalCash;
                firstOrder.CreditCardAmount = (firstOrder.CreditCardAmount ?? 0) + totalCredit;
                firstOrder.MealCardAmount = (firstOrder.MealCardAmount ?? 0) + totalMeal;
                firstOrder.PaymentType = finalPayType;

                decimal amountToDeduct = paidAmount;
                foreach (var ord in activeOrders)
                {
                    if (ord.TotalAmount >= amountToDeduct)
                    {
                        ord.TotalAmount -= amountToDeduct;
                        amountToDeduct = 0;
                        break;
                    }
                    else
                    {
                        amountToDeduct -= ord.TotalAmount;
                        ord.TotalAmount = 0;
                    }
                }

                db.SaveChanges();

                decimal remainingTotal = activeOrders.Sum(o => o.TotalAmount);

                return Json(new
                {
                    success = true,
                    message = $"{paidAmount:N2} ₺ tutarındaki ödeme alındı.",
                    remainingAmount = remainingTotal,
                    isFullyPaid = remainingTotal <= 0
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ödeme işlenirken hata: " + ex.Message });
            }
        }

        // 3. MASAYI BOŞALTMA İŞLEMİ (MÜŞTERİ FİZİKEN MASADAN KALKTIĞINDA)
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult VacateTable(int tableId)
        {
            try
            {
                var activeOrders = db.AppOrders
                    .Where(o => o.TableId == tableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                    .ToList();

                DateTime now = DateTime.Now;

                foreach (var order in activeOrders)
                {
                    order.Status = "Tamamlandı";
                    order.CompletedDate = now;
                }

                var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId);
                if (table != null)
                {
                    table.Status = "Bos";
                }

                db.SaveChanges();

                return Json(new { success = true, message = "Masa boşaltıldı ve yeni müşteriler için hazır hale getirildi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Masa boşaltılırken hata oluştu: " + ex.Message });
            }
        }

        #endregion

        #region MASA TAŞIMA VE BİRLEŞTİRME

        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult TransferTable(int sourceTableId, int targetTableId)
        {
            try
            {
                if (sourceTableId == targetTableId) return Json(new { success = false, message = "Kaynak ve hedef masa aynı olamaz." });

                var sourceOrders = db.AppOrders.Where(o => o.TableId == sourceTableId && o.Status != "Tamamlandı" && o.Status != "İptal").ToList();
                if (!sourceOrders.Any()) return Json(new { success = false, message = "Taşınacak masada aktif sipariş bulunamadı." });

                var targetTable = db.AppTables.FirstOrDefault(t => t.TableId == targetTableId && t.IsActive);
                if (targetTable == null) return Json(new { success = false, message = "Hedef masa bulunamadı." });
                if (targetTable.Status == "Dolu") return Json(new { success = false, message = "Hedef masa dolu. Masa Birleştirme kullanınız." });

                foreach (var order in sourceOrders) order.TableId = targetTableId;

                var sourceTable = db.AppTables.FirstOrDefault(t => t.TableId == sourceTableId);
                if (sourceTable != null) sourceTable.Status = "Bos";
                targetTable.Status = "Dolu";

                db.SaveChanges();
                return Json(new { success = true, message = $"Siparişler {targetTable.TableNumber} masasına taşındı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult MergeTables(int sourceTableId, int targetTableId)
        {
            try
            {
                if (sourceTableId == targetTableId) return Json(new { success = false, message = "Aynı masayı kendisiyle birleştiremezsiniz." });

                var sourceOrder = db.AppOrders.Where(o => o.TableId == sourceTableId && o.Status != "Tamamlandı" && o.Status != "İptal").OrderBy(o => o.CreatedDate).FirstOrDefault();
                var targetOrder = db.AppOrders.Where(o => o.TableId == targetTableId && o.Status != "Tamamlandı" && o.Status != "İptal").OrderBy(o => o.CreatedDate).FirstOrDefault();

                if (sourceOrder == null || targetOrder == null) return Json(new { success = false, message = "Birleştirilecek aktif siparişler bulunamadı." });

                var sourceDetails = db.AppOrderDetails.Where(d => d.OrderId == sourceOrder.OrderId).ToList();
                foreach (var detail in sourceDetails) detail.OrderId = targetOrder.OrderId;

                sourceOrder.Status = "İptal";
                sourceOrder.TotalAmount = 0;

                var sourceTable = db.AppTables.FirstOrDefault(t => t.TableId == sourceTableId);
                if (sourceTable != null) sourceTable.Status = "Bos";

                db.SaveChanges();

                var allTargetDetails = db.AppOrderDetails.Where(d => d.OrderId == targetOrder.OrderId && !d.IsReturned).ToList();
                targetOrder.TotalAmount = allTargetDetails.Sum(x => x.Quantity * x.UnitPrice);
                db.SaveChanges();

                return Json(new { success = true, message = "Masalar başarıyla birleştirildi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        #endregion

        [HttpGet]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult GetEmptyTables()
        {
            try
            {
                var emptyTables = db.AppTables.Where(t => t.IsActive && t.Status == "Bos").Select(t => new { tableId = t.TableId, tableName = t.TableNumber }).ToList();
                return Json(new { success = true, data = emptyTables }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }

    public class PaidItemModel
    {
        public int OrderDetailId { get; set; }
        public int Quantity { get; set; }
    }
}