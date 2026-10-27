using Microsoft.AspNet.SignalR;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Hubs;
using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    // Mutfak kamerasındaki hijyen tespit programı (tools/hygiene-camera) bu uca bildirim gönderir.
    // Program önce bir Mutfak hesabıyla /Auth/ApiLogin üzerinden giriş yapmalı ve aldığı token'ı
    // "Authorization: Bearer <token>" başlığıyla göndermelidir. İhlal, token'daki restorana kaydedilir.
    [JwtAuthorize(Roles = "Admin, Mutfak Şefi, Mutfak")]
    public class AiVisionController : TenantController
    {
        private const int MaxViolationTypeLength = 100;
        private const int MaxImageBytes = 2 * 1024 * 1024;

        // Çalışan fotoğrafları web'den doğrudan erişilemeyen App_Data altında, restoran bazında tutulur
        private const string ImageRootVirtualPath = "~/App_Data/hygiene";

        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // image: ihlal anındaki kamera karesi (JPEG/PNG, isteğe bağlı, en fazla 2 MB)
        [HttpPost]
        public JsonResult ReportHygieneViolation(string violationType, HttpPostedFileBase image)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(violationType))
                {
                    return Json(new { success = false, message = "İhlal türü boş olamaz." });
                }

                violationType = violationType.Trim();
                if (violationType.Length > MaxViolationTypeLength)
                {
                    violationType = violationType.Substring(0, MaxViolationTypeLength);
                }

                int companyId = CurrentCompanyId;

                string imageFileName = null;
                if (image != null && image.ContentLength > 0)
                {
                    string imageError;
                    imageFileName = SaveViolationImage(image, companyId, out imageError);
                    if (imageFileName == null)
                    {
                        return Json(new { success = false, message = imageError });
                    }
                }

                var violation = new HygieneViolations
                {
                    CompanyId = companyId,
                    ViolationType = violationType,
                    DetectedAt = DateTime.Now,
                    IsResolved = false,
                    ImageFileName = imageFileName
                };

                db.HygieneViolations.Add(violation);
                db.SaveChanges();

                string imageUrl = imageFileName != null ? Url.Action("GetViolationImage", "AiVision", new { id = violation.Id }) : null;

                // SignalR ile sadece bu restoranın mutfak ekranına anlık uyarı gönderiyoruz
                var hubContext = GlobalHost.ConnectionManager.GetHubContext<OrderHub>();
                hubContext.Clients.Group(OrderHub.CompanyGroup(companyId))
                    .receiveHygieneAlert(violationType, violation.DetectedAt.Value.ToString("HH:mm:ss"), imageUrl);

                return Json(new { success = true, message = "İhlal sisteme başarıyla kaydedildi.", violationId = violation.Id });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata oluştu: " + ex.Message });
            }
        }

        // Mutfak ekranındaki "Hijyen İhlalleri" listesi. range: "today" (varsayılan) veya "week" (son 7 gün)
        [HttpGet]
        public JsonResult GetViolations(string range)
        {
            try
            {
                int companyId = CurrentCompanyId;
                DateTime today = DateTime.Today;
                DateTime since = range == "week" ? today.AddDays(-6) : today;

                var violations = db.HygieneViolations
                    .Where(v => v.CompanyId == companyId && v.DetectedAt >= since)
                    .OrderByDescending(v => v.DetectedAt)
                    .Take(200)
                    .ToList()
                    .Select(v => new
                    {
                        id = v.Id,
                        violationType = v.ViolationType,
                        detectedDate = v.DetectedAt.HasValue ? v.DetectedAt.Value.ToString("dd.MM.yyyy") : "",
                        detectedTime = v.DetectedAt.HasValue ? v.DetectedAt.Value.ToString("HH:mm:ss") : "",
                        isResolved = v.IsResolved == true,
                        imageUrl = string.IsNullOrEmpty(v.ImageFileName) ? null : Url.Action("GetViolationImage", "AiVision", new { id = v.Id })
                    })
                    .ToList();

                int unresolvedTodayCount = db.HygieneViolations
                    .Count(v => v.CompanyId == companyId && v.DetectedAt >= today && v.IsResolved != true);

                return Json(new { success = true, data = violations, unresolvedTodayCount = unresolvedTodayCount }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "İhlaller yüklenirken hata: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        public JsonResult MarkViolationResolved(int id)
        {
            try
            {
                int companyId = CurrentCompanyId;
                var violation = db.HygieneViolations.FirstOrDefault(v => v.Id == id && v.CompanyId == companyId);
                if (violation == null)
                {
                    return Json(new { success = false, message = "İhlal kaydı bulunamadı." });
                }

                violation.IsResolved = true;
                db.SaveChanges();

                return Json(new { success = true, message = "İhlal çözüldü olarak işaretlendi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata: " + ex.Message });
            }
        }

        // Seçilen ihlal kayıtlarını ve fotoğraflarını siler. Sıradan mutfak personeli (ve kamera hesabı)
        // kendi ihlal kayıtlarını silemesin diye yalnızca Admin ve Mutfak Şefi yetkilidir.
        [HttpPost]
        [JwtAuthorize(Roles = "Admin, Mutfak Şefi")]
        public JsonResult DeleteViolations(List<int> ids)
        {
            try
            {
                if (ids == null || !ids.Any())
                {
                    return Json(new { success = false, message = "Silinecek ihlal seçilmedi." });
                }

                int companyId = CurrentCompanyId;
                var violations = db.HygieneViolations
                    .Where(v => ids.Contains(v.Id) && v.CompanyId == companyId)
                    .ToList();

                string folder = GetCompanyImageFolder(companyId);
                foreach (var violation in violations)
                {
                    if (!string.IsNullOrEmpty(violation.ImageFileName))
                    {
                        string imagePath = Path.Combine(folder, violation.ImageFileName);
                        if (System.IO.File.Exists(imagePath))
                        {
                            System.IO.File.Delete(imagePath);
                        }
                    }
                    db.HygieneViolations.Remove(violation);
                }

                db.SaveChanges();

                return Json(new { success = true, deletedCount = violations.Count, message = $"{violations.Count} ihlal kaydı silindi." });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Silme sırasında hata: " + ex.Message });
            }
        }

        // İhlal fotoğrafını yalnızca aynı restoranın yetkili kullanıcılarına gösterir
        [HttpGet]
        public ActionResult GetViolationImage(int id)
        {
            int companyId = CurrentCompanyId;
            var violation = db.HygieneViolations.FirstOrDefault(v => v.Id == id && v.CompanyId == companyId);
            if (violation == null || string.IsNullOrEmpty(violation.ImageFileName))
            {
                return HttpNotFound();
            }

            string fullPath = Path.Combine(GetCompanyImageFolder(companyId), violation.ImageFileName);
            if (!System.IO.File.Exists(fullPath))
            {
                return HttpNotFound();
            }

            string contentType = violation.ImageFileName.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg";
            return File(fullPath, contentType);
        }

        private string GetCompanyImageFolder(int companyId)
        {
            return Path.Combine(Server.MapPath(ImageRootVirtualPath), companyId.ToString());
        }

        // Dosyayı içeriğine (JPEG/PNG imzası) bakarak doğrular, rastgele adla kaydeder; hata varsa null döner
        private string SaveViolationImage(HttpPostedFileBase image, int companyId, out string error)
        {
            error = null;

            if (image.ContentLength > MaxImageBytes)
            {
                error = "İhlal fotoğrafı en fazla 2 MB olabilir.";
                return null;
            }

            byte[] header = new byte[4];
            image.InputStream.Read(header, 0, header.Length);
            image.InputStream.Position = 0;

            string extension;
            if (header[0] == 0xFF && header[1] == 0xD8)
            {
                extension = ".jpg";
            }
            else if (header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47)
            {
                extension = ".png";
            }
            else
            {
                error = "İhlal fotoğrafı JPEG veya PNG olmalıdır.";
                return null;
            }

            string folder = GetCompanyImageFolder(companyId);
            Directory.CreateDirectory(folder);

            string fileName = Guid.NewGuid().ToString("N") + extension;
            image.SaveAs(Path.Combine(folder, fileName));
            return fileName;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}
