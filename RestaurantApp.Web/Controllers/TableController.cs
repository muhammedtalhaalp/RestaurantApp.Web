using System.Data.Entity;
using System.Linq;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters; 

namespace RestaurantApp.Web.Controllers
{
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer")]
    public class TableController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // 1. Masaları Listele
        public ActionResult Index()
        {
            var tables = db.AppTables.Where(t => t.IsActive).ToList();
            return View(tables);
        }

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