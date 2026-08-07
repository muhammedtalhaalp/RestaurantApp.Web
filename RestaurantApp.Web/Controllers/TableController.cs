using System;
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

        #region MASA KONTROLÜ VE HESAP KAPATMA İŞLEMLERİ

        [HttpGet]
        public ActionResult TableControl()
        {
            return View("~/Views/Order/TableControl.cshtml");
        }

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
                        // DÜZELTME: Kapatılmamış (Status != Tamamlandı ve Status != İptal) tüm siparişleri toplar.
                        var totalAmount = db.AppOrders
                            .Where(o => o.TableId == t.TableId && o.Status != "Tamamlandı" && o.Status != "İptal")
                            .Sum(o => (decimal?)o.TotalAmount) ?? 0;

                        return new
                        {
                            tableId = t.TableId,
                            tableName = t.TableNumber,
                            section = t.Section ?? "Salon",
                            status = t.Status,
                            totalAmount = totalAmount
                        };
                    }).ToList();

                return Json(new { success = true, data = occupiedTables }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Dolu masalar yüklenirken hata oluştu: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // Müşteri hesabı ödediğinde masayı boşaltan ve adisyonları kapatan endpoint
        [HttpPost]
        public JsonResult CloseTableAndPay(int tableId)
        {
            try
            {
                var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId);
                if (table == null)
                    return Json(new { success = false, message = "Masa bulunamadı." });

                // Garson masadaki tüm siparişleri teslim almadan (Servis Edildi yapmadan) masa kapatılamaz!
                bool hasUnservedOrders = db.AppOrders.Any(o => o.TableId == tableId && (o.Status == "Hazırlanıyor" || o.Status == "Hazır"));
                if (hasUnservedOrders)
                {
                    return Json(new { success = false, message = "Bu masada henüz servisi tamamlanmamış (hazırlanan veya hazır) ürünler var! Önce siparişleri masaya teslim almalısınız." });
                }

                // Masaya ait açık tüm siparişlerin durumunu "Tamamlandı" (Hesap Ödendi) yapıyoruz
                var activeOrders = db.AppOrders.Where(o => o.TableId == tableId && o.Status != "Tamamlandı" && o.Status != "İptal").ToList();
                foreach (var order in activeOrders)
                {
                    order.Status = "Tamamlandı";
                }

                table.Status = "Bos";
                db.SaveChanges();

                return Json(new { success = true, message = "Hesap kapatıldı ve masa boşaltıldı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Masa kapatılırken hata: " + ex.Message });
            }
        }

        #endregion

        [HttpPost]
        public ActionResult Create(string tableNumber)
        {
            if (!string.IsNullOrEmpty(tableNumber))
            {
                AppTables table = new AppTables
                {
                    TableNumber = tableNumber,
                    Status = "Bos",
                    IsActive = true
                };

                db.AppTables.Add(table);
                db.SaveChanges();
            }

            return RedirectToAction("Index");
        }

        [HttpPost]
        public ActionResult UpdateStatus(int id, string status)
        {
            var table = db.AppTables.Find(id);
            if (table != null && !string.IsNullOrEmpty(status))
            {
                table.Status = status;
                db.SaveChanges();
            }

            return RedirectToAction("Index");
        }

        [HttpPost]
        public ActionResult Delete(int id)
        {
            var table = db.AppTables.Find(id);
            if (table != null)
            {
                table.IsActive = false;
                db.SaveChanges();
            }

            return RedirectToAction("Index");
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