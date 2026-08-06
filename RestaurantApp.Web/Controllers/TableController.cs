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

        // 1. Masaları Listele
        public ActionResult Index()
        {
            var tables = db.AppTables.Where(t => t.IsActive).ToList();
            return View(tables);
        }

        #region YENİ: MASA KONTROLÜ İŞLEMLERİ

        // 1.1 Garson Masa Kontrolü Görünüm Metodu (Açık dosya yolu ile hatayı çözer)
        [HttpGet]
        public ActionResult TableControl()
        {
            return View("~/Views/Order/TableControl.cshtml");
        }

        // 1.2 Sadece "Dolu" Masaları Getiren Endpoint (JS tarafı çağırır)
        [HttpGet]
        public JsonResult GetOccupiedTables()
        {
            try
            {
                var occupiedTables = db.AppTables
                    .Where(t => t.IsActive && t.Status == "Dolu")
                    .Select(t => new
                    {
                        tableId = t.TableId,
                        tableName = t.TableNumber,
                        section = t.Section ?? "Salon",
                        status = t.Status
                    }).ToList();

                return Json(new { success = true, data = occupiedTables }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Dolu masalar yüklenirken hata oluştu: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // 1.3 Müşteri Kalktığında Masayı Boşa Alan Endpoint
        [HttpPost]
        public JsonResult ClearTableStatus(int tableId)
        {
            try
            {
                var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId);
                if (table == null)
                    return Json(new { success = false, message = "Masa bulunamadı." });

                table.Status = "Bos";
                db.SaveChanges();

                return Json(new { success = true, message = "Masa başarıyla boşaltıldı." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Masa boşaltılırken hata: " + ex.Message });
            }
        }

        #endregion

        // 2. Yeni Masa Ekle (POST)
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

        // 3. Masa Durumu Güncelle (Bos, Dolu, Rezerve) (POST)
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

        // 4. Masa Sil / Pasife Al (POST)
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