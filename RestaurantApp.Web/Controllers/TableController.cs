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
                        var activeOrders = GetActiveOrders(t.TableId);

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

        // Masadaki açık siparişler, en eskiden yeniye
        private List<AppOrders> GetActiveOrders(int tableId)
        {
            return db.AppOrders
                .Where(o => o.TableId == tableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                .OrderBy(o => o.CreatedDate)
                .ToList();
        }

        // Ödemeyi açık siparişlere en eskiden başlayarak dağıtır ve her siparişin kalan borcundan (TotalAmount) düşer.
        // Kalan borcu aşan kısım kaydedilmez. Gerçekten tahsil edilen toplamı döner.
        private static decimal ApplyPayment(List<AppOrders> orders, decimal cash, decimal credit, decimal meal, string paymentType)
        {
            decimal applied = 0;

            foreach (var order in orders)
            {
                decimal room = order.TotalAmount;
                if (room <= 0) continue;

                decimal cashPart = Math.Min(cash, room); cash -= cashPart; room -= cashPart;
                decimal creditPart = Math.Min(credit, room); credit -= creditPart; room -= creditPart;
                decimal mealPart = Math.Min(meal, room); meal -= mealPart;

                decimal orderPaid = cashPart + creditPart + mealPart;
                if (orderPaid <= 0) continue;

                order.CashAmount = (order.CashAmount ?? 0) + cashPart;
                order.CreditCardAmount = (order.CreditCardAmount ?? 0) + creditPart;
                order.MealCardAmount = (order.MealCardAmount ?? 0) + mealPart;
                order.TotalAmount -= orderPaid;
                order.PaymentType = paymentType;

                applied += orderPaid;
            }

            return applied;
        }

        // 1. ÜRÜN BAZLI PARÇALI ÖDEME (ÖDENEN ADETLER PaidQuantity'YE YAZILIR, SATIRLAR SİLİNMEZ)
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult PayByItems(int tableId, List<PaidItemModel> paidItems, decimal? cashAmount, decimal? creditCardAmount, decimal? mealCardAmount, string paymentType)
        {
            try
            {
                if (paidItems == null || !paidItems.Any(p => p.Quantity > 0))
                {
                    return Json(new { success = false, message = "Lütfen ödenecek en az bir ürün seçiniz." });
                }

                decimal totalCash = cashAmount ?? 0;
                decimal totalCredit = creditCardAmount ?? 0;
                decimal totalMeal = mealCardAmount ?? 0;

                if (totalCash < 0 || totalCredit < 0 || totalMeal < 0)
                {
                    return Json(new { success = false, message = "Ödeme tutarları negatif olamaz." });
                }

                var activeOrders = GetActiveOrders(tableId);
                if (!activeOrders.Any())
                {
                    return Json(new { success = false, message = "Aktif sipariş bulunamadı." });
                }

                var orderIds = activeOrders.Select(o => o.OrderId).ToList();
                decimal remainingBefore = activeOrders.Sum(o => o.TotalAmount);
                decimal selectedItemsValue = 0;

                foreach (var pItem in paidItems.Where(p => p.Quantity > 0))
                {
                    var detail = db.AppOrderDetails.FirstOrDefault(d => d.OrderDetailId == pItem.OrderDetailId && orderIds.Contains(d.OrderId));
                    if (detail == null || detail.IsReturned)
                    {
                        return Json(new { success = false, message = "Seçilen ürünlerden biri bu masada bulunamadı veya iade edilmiş." });
                    }

                    int unpaidQuantity = detail.Quantity - detail.PaidQuantity;
                    if (pItem.Quantity > unpaidQuantity)
                    {
                        return Json(new { success = false, message = "Seçilen ürünlerden birinin ödemesi zaten alınmış. Lütfen adisyonu yenileyin." });
                    }

                    detail.PaidQuantity += pItem.Quantity;
                    selectedItemsValue += pItem.Quantity * detail.UnitPrice;
                }

                // Ödeme, seçilen ürünlerin tutarını (kalan borçla sınırlı) karşılamalı
                decimal requiredPayment = Math.Min(selectedItemsValue, remainingBefore);
                if (totalCash + totalCredit + totalMeal < requiredPayment - 0.01m)
                {
                    return Json(new { success = false, message = $"Girilen ödeme ({totalCash + totalCredit + totalMeal:N2} ₺), seçilen ürünlerin tutarını ({requiredPayment:N2} ₺) karşılamıyor." });
                }

                string finalPayType = !string.IsNullOrWhiteSpace(paymentType) ? paymentType : "Parçalı Ödeme";
                ApplyPayment(activeOrders, totalCash, totalCredit, totalMeal, finalPayType);

                db.SaveChanges();

                decimal remainingTotal = activeOrders.Sum(o => o.TotalAmount);

                return Json(new
                {
                    success = true,
                    message = "Seçilen ürünlerin ödemesi alındı.",
                    remainingAmount = remainingTotal,
                    isFullyPaid = remainingTotal <= 0
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ödeme işlenirken hata: " + ex.Message });
            }
        }

        // 2. SERBEST TUTAR BAZLI PARÇALI ÖDEME
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult PayByAmount(int tableId, decimal paidAmount, decimal? cashAmount, decimal? creditCardAmount, decimal? mealCardAmount, string paymentType)
        {
            try
            {
                decimal totalCash = cashAmount ?? 0;
                decimal totalCredit = creditCardAmount ?? 0;
                decimal totalMeal = mealCardAmount ?? 0;

                if (totalCash < 0 || totalCredit < 0 || totalMeal < 0 || totalCash + totalCredit + totalMeal <= 0)
                {
                    return Json(new { success = false, message = "Lütfen geçerli bir ödeme tutarı giriniz." });
                }

                var activeOrders = GetActiveOrders(tableId);
                if (!activeOrders.Any())
                {
                    return Json(new { success = false, message = "Aktif sipariş bulunamadı." });
                }

                string finalPayType = !string.IsNullOrWhiteSpace(paymentType) ? paymentType : "Parçalı Ödeme";
                decimal applied = ApplyPayment(activeOrders, totalCash, totalCredit, totalMeal, finalPayType);

                if (applied <= 0)
                {
                    return Json(new { success = false, message = "Bu masanın ödenecek borcu bulunmuyor." });
                }

                db.SaveChanges();

                decimal remainingTotal = activeOrders.Sum(o => o.TotalAmount);

                return Json(new
                {
                    success = true,
                    message = $"{applied:N2} ₺ tutarındaki ödeme alındı.",
                    remainingAmount = remainingTotal,
                    isFullyPaid = remainingTotal <= 0
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Ödeme işlenirken hata: " + ex.Message });
            }
        }

        // 3. MASAYI BOŞALTMA İŞLEMİ
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Garson, Kasiyer, Garson/Kasiyer")]
        public JsonResult VacateTable(int tableId)
        {
            try
            {
                var activeOrders = GetActiveOrders(tableId);

                decimal remainingTotal = activeOrders.Sum(o => o.TotalAmount);
                if (remainingTotal > 0)
                {
                    return Json(new { success = false, message = $"Masanın {remainingTotal:N2} ₺ ödenmemiş hesabı var. Önce ödemeyi alınız." });
                }

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

                var sourceOrders = GetActiveOrders(sourceTableId);
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

                var sourceOrders = GetActiveOrders(sourceTableId);
                var targetOrders = GetActiveOrders(targetTableId);

                if (!sourceOrders.Any() || !targetOrders.Any()) return Json(new { success = false, message = "Birleştirilecek aktif siparişler bulunamadı." });

                // KISMİ ÖDEME KONTROLÜ: Herhangi bir masada önceden ödeme yapılmışsa birleştirmeyi engelle
                bool isPartiallyPaid = sourceOrders.Concat(targetOrders).Any(o =>
                    (o.CashAmount ?? 0) > 0 || (o.CreditCardAmount ?? 0) > 0 || (o.MealCardAmount ?? 0) > 0);

                if (isPartiallyPaid)
                {
                    return Json(new
                    {
                        success = false,
                        message = "Daha önce adisyon miktarının bir kısmı ödendiği için bu masa birleştirilemez! Lütfen önce açık hesabı kapatınız."
                    });
                }

                var targetOrder = targetOrders.First();

                // Kaynak masadaki tüm açık siparişlerin ürünleri ve kalan borcu hedef siparişe aktarılır
                foreach (var sourceOrder in sourceOrders)
                {
                    var sourceDetails = db.AppOrderDetails.Where(d => d.OrderId == sourceOrder.OrderId).ToList();
                    foreach (var detail in sourceDetails) detail.OrderId = targetOrder.OrderId;

                    targetOrder.TotalAmount += sourceOrder.TotalAmount;
                    if (sourceOrder.IsPriority) targetOrder.IsPriority = true;

                    sourceOrder.Status = "İptal";
                    sourceOrder.TotalAmount = 0;
                }

                var sourceTable = db.AppTables.FirstOrDefault(t => t.TableId == sourceTableId);
                if (sourceTable != null) sourceTable.Status = "Bos";

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
