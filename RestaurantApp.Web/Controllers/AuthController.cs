using System;
using System.Linq;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Helpers;
using RestaurantApp.Web.Models;

namespace RestaurantApp.Web.Controllers
{
    public class AuthController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        public ActionResult Login()
        {
            return View();
        }

        public ActionResult Register()
        {
            return View();
        }

        [HttpPost]
        public JsonResult ApiRegister(RegisterViewModel model)
        {
            if (!ModelState.IsValid)
            {
                return Json(new { success = false, message = "Lütfen tüm alanları doldurun." });
            }

            // 1. E-posta kontrolü
            var existingUser = db.AppUsers.FirstOrDefault(u => u.Username == model.Email || u.Email == model.Email);
            if (existingUser != null)
            {
                return Json(new { success = false, message = "Bu e-posta adresi zaten kullanımda!" });
            }

            // 2. Önce Şirketi Oluşturup Kaydediyoruz
            var newCompany = new Companies
            {
                Name = model.CompanyName,
                CreatedDate = DateTime.Now
            };

            db.Companies.Add(newCompany);
            db.SaveChanges(); // Bu satırdan sonra newCompany.Id otomatik oluşur

            // 3. Kullanıcıyı Oluşan newCompany.Id ile Bağlıyoruz
            var adminUser = new AppUsers
            {
                CompanyId = newCompany.Id,
                CompanyName = model.CompanyName,
                FullName = model.FullName,
                Username = model.Email,
                Email = model.Email,
                PasswordHash = model.Password,
                Role = "Admin",
                IsActive = true,
                CreatedDate = DateTime.Now
            };

            db.AppUsers.Add(adminUser);
            db.SaveChanges();

            return Json(new { success = true, message = "Kayıt başarılı! Giriş sayfasına yönlendiriliyorsunuz." });
        }

        [HttpPost]
        public JsonResult ApiLogin(LoginViewModel model)
        {
            if (!ModelState.IsValid)
            {
                return Json(new { success = false, message = "Lütfen bilgilerinizi eksiksiz girin." });
            }

            var user = db.AppUsers.FirstOrDefault(u =>
                (u.Username == model.Username || u.Email == model.Username) &&
                u.PasswordHash == model.Password &&
                u.IsActive == true);

            if (user == null)
            {
                return Json(new { success = false, message = "E-posta veya şifre hatalı!" });
            }

            string token = JwtHelper.GenerateToken(user.UserId, user.Username, user.Role);

            // Oturum ve Profil İşlemleri İçin Session Kayıtları
            Session["JWToken"] = token;
            Session["UserId"] = user.UserId;
            Session["UserRole"] = user.Role;
            Session["FullName"] = user.FullName;

            string redirectUrl = "/Order/POS";

            if (user.Role == "Admin")
            {
                // YENİ HALİ: Artık direkt Dashboard yerine Ana Sayfa (Index) açılıyor
                redirectUrl = "/Admin/Index";
            }
            else if (user.Role == "Mutfak" || user.Role == "Mutfak Şefi")
            {
                redirectUrl = "/Kitchen/Index";
            }
            else if (user.Role == "Garson" || user.Role == "Kasiyer" || user.Role == "Garson/Kasiyer")
            {
                redirectUrl = "/Order/POS";
            }

            return Json(new
            {
                success = true,
                token = token,
                username = user.Username,
                fullName = user.FullName,
                role = user.Role,
                redirectUrl = redirectUrl
            });
        }

        #region ORTAK PROFİL AYARLARI (TÜM ROLLER İÇİN)

        [HttpGet]
        public ActionResult ProfileSettings()
        {
            return View();
        }

        [HttpGet]
        public JsonResult GetUserProfile()
        {
            try
            {
                int currentUserId = Session["UserId"] != null ? Convert.ToInt32(Session["UserId"]) : 0;

                AppUsers user = null;
                if (currentUserId > 0)
                {
                    user = db.AppUsers.FirstOrDefault(u => u.UserId == currentUserId);
                }
                else
                {
                    user = db.AppUsers.FirstOrDefault(u => u.IsActive == true);
                }

                if (user == null)
                {
                    return Json(new { success = false, message = "Kullanıcı oturumu bulunamadı." }, JsonRequestBehavior.AllowGet);
                }

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        userId = user.UserId,
                        fullName = user.FullName,
                        companyName = user.CompanyName,
                        email = user.Email,
                        role = user.Role
                    }
                }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        [HttpPost]
        public JsonResult SendPasswordResetCode()
        {
            try
            {
                int currentUserId = Session["UserId"] != null ? Convert.ToInt32(Session["UserId"]) : 0;
                var user = db.AppUsers.FirstOrDefault(u => u.UserId == currentUserId || u.IsActive == true);

                if (user == null || string.IsNullOrEmpty(user.Email))
                {
                    return Json(new { success = false, message = "Kullanıcı e-postası bulunamadı." });
                }

                Random random = new Random();
                string code = random.Next(1000, 9999).ToString();

                Session["ResetCode"] = code;
                Session["ResetCodeUserEmail"] = user.Email;

                bool mailSent = EmailHelper.SendVerificationCode(user.Email, code);

                if (mailSent)
                {
                    return Json(new { success = true, message = $"4 haneli doğrulama kodu {user.Email} adresinize gönderildi." });
                }
                else
                {
                    return Json(new { success = false, message = "E-posta gönderilirken bir hata oluştu. Lütfen SMTP ayarlarını kontrol edin." });
                }
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message });
            }
        }

        [HttpPost]
        public JsonResult VerifyOtpCode(string code)
        {
            string sessionCode = Session["ResetCode"] as string;

            if (sessionCode != null && sessionCode == code.Trim())
            {
                Session["IsOtpVerified"] = true;
                return Json(new { success = true, message = "Kod doğrulandı." });
            }

            return Json(new { success = false, message = "Girdiğiniz 4 haneli kod hatalı!" });
        }

        [HttpPost]
        public JsonResult ConfirmNewPassword(string newPassword)
        {
            bool isVerified = Session["IsOtpVerified"] != null && (bool)Session["IsOtpVerified"];

            if (!isVerified)
            {
                return Json(new { success = false, message = "Güvenlik ihlali: Önce doğrulama kodunu onaylamalısınız." });
            }

            int currentUserId = Session["UserId"] != null ? Convert.ToInt32(Session["UserId"]) : 0;
            var user = db.AppUsers.FirstOrDefault(u => u.UserId == currentUserId || u.IsActive == true);

            if (user != null)
            {
                user.PasswordHash = newPassword;
                db.SaveChanges();

                Session["ResetCode"] = null;
                Session["IsOtpVerified"] = null;

                return Json(new { success = true, message = "Şifreniz güncellendi." });
            }

            return Json(new { success = false, message = "Kullanıcı bulunamadı." });
        }

        [HttpPost]
        public JsonResult UpdateUserProfile(string FullName, string Email, string VerificationCode, string NewPassword)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(FullName) || string.IsNullOrWhiteSpace(Email))
                {
                    return Json(new { success = false, message = "Ad Soyad ve E-Posta alanları zorunludur." });
                }

                int currentUserId = Session["UserId"] != null ? Convert.ToInt32(Session["UserId"]) : 0;
                var user = db.AppUsers.FirstOrDefault(u => u.UserId == currentUserId || u.IsActive == true);

                if (user == null)
                {
                    return Json(new { success = false, message = "Kullanıcı bulunamadı." });
                }

                if (!string.IsNullOrWhiteSpace(NewPassword))
                {
                    if (string.IsNullOrWhiteSpace(VerificationCode))
                    {
                        return Json(new { success = false, message = "Şifrenizi değiştirmek için lütfen e-postanıza gelen doğrulama kodunu girin." });
                    }

                    string sessionCode = Session["ResetCode"] as string;
                    if (sessionCode == null || sessionCode != VerificationCode.Trim())
                    {
                        return Json(new { success = false, message = "Girdiğiniz doğrulama kodu hatalı veya süresi dolmuş." });
                    }

                    user.PasswordHash = NewPassword;
                    Session["ResetCode"] = null;
                }

                user.FullName = FullName;
                user.Email = Email;
                user.Username = Email;

                db.SaveChanges();
                Session["FullName"] = user.FullName;

                return Json(new { success = true, message = "Profil bilgileriniz başarıyla güncellendi.", fullName = user.FullName });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Hata oluştu: " + ex.Message });
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
}