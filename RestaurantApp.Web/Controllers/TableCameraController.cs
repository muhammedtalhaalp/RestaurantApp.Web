using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;
using Microsoft.AspNet.SignalR;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using RestaurantApp.Web.Hubs;

namespace RestaurantApp.Web.Controllers
{
    // Masa doluluk kamerası programı (tools/table-camera) bu uç noktaları çağırır, sayfa JS'i değil.
    // Kamera hesabı hijyen kamerasıyla aynı olabilir (Mutfak rolü).
    [JwtAuthorize(Roles = "Admin, Kasiyer, Garson, Mutfak")]
    public class TableCameraController : TenantController
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public class TableReport
        {
            public int TableId { get; set; }
            public string Status { get; set; }
        }

        // Kalibrasyonda kamera görüntüsündeki alanları masalarla eşleştirmek için
        [HttpGet]
        public JsonResult GetTables()
        {
            int companyId = CurrentCompanyId;
            var tables = db.AppTables
                .Where(t => t.CompanyId == companyId && t.IsActive)
                .OrderBy(t => t.Section).ThenBy(t => t.TableId)
                .Select(t => new { tableId = t.TableId, tableNumber = t.TableNumber, section = t.Section })
                .ToList();
            return Json(new { success = true, data = tables }, JsonRequestBehavior.AllowGet);
        }

        // Kamera, durumu değişen masaları hemen, değişmeyenleri belirli aralıkla (canlılık için) bildirir.
        // Başka restoranın masası ya da bilinmeyen durum sessizce atlanır; atlananlar yanıtta sayılır.
        [HttpPost]
        public JsonResult ReportStatus(List<TableReport> tables)
        {
            if (tables == null || tables.Count == 0)
            {
                return Json(new { success = false, message = "Masa durumu gönderilmedi." });
            }

            int companyId = CurrentCompanyId;
            var ids = tables.Select(r => r.TableId).Distinct().ToList();
            var own = db.AppTables.Where(t => t.CompanyId == companyId && t.IsActive && ids.Contains(t.TableId)).ToDictionary(t => t.TableId);

            var now = DateTime.Now;
            var changed = new List<object>();
            int skipped = 0;
            foreach (var report in tables)
            {
                if (!own.TryGetValue(report.TableId, out var table) || !TableCameraStatus.All.Contains(report.Status ?? ""))
                {
                    skipped++;
                    continue;
                }

                if (TableCameraStatus.Current(table, now) != report.Status)
                {
                    changed.Add(new { tableId = table.TableId, cameraStatus = report.Status });
                }
                table.CameraStatus = report.Status;
                table.CameraStatusDate = now;
            }
            db.SaveChanges();

            if (changed.Count > 0)
            {
                var hub = GlobalHost.ConnectionManager.GetHubContext<OrderHub>();
                hub.Clients.Group(OrderHub.CompanyGroup(companyId)).onTableCameraStatus(changed);
            }

            return Json(new { success = true, updated = tables.Count - skipped, changed = changed.Count, skipped = skipped });
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}
