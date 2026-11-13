using System;
using System.Linq;
using System.Security.Claims;
using System.Web.Mvc;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;
using RestaurantApp.Web.Models;

namespace RestaurantApp.Web.Controllers
{
    public class AuthController : Controller
    {
        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        private const int MinPasswordLength = 6;
        private const int OtpValidMinutes = 5;
        private const int OtpMaxFailedAttempts = 5;
        private const string OtpSessionKey = "PendingOtp";

        [Serializable]
        private class PendingOtp
        {
            public int UserId { get; set; }
            public string Code { get; set; }
            public DateTime ExpiresAt { get; set; }
            public int FailedAttempts { get; set; }
            public bool IsVerified { get; set; }
        }

        public ActionResult Login()
        {
            return View();
        }

        // Sunucu tarafındaki oturumu (Session'daki JWT dahil) sonlandırır; localStorage'ı layout'taki JS temizler
        public ActionResult Logout()
        {
            Session.Clear();
            Session.Abandon();
            return RedirectToAction("Login");
        }

        [HttpPost]
        public JsonResult ApiRegister(RegisterViewModel model)
        {
            if (!ModelState.IsValid)
            {
                return Json(new { success = false, message = "Lütfen tüm alanları doldurun." });
            }

            var existingUser = db.AppUsers.FirstOrDefault(u => u.Username == model.Email || u.Email == model.Email);
            if (existingUser != null)
            {
                return Json(new { success = false, message = "Bu e-posta adresi zaten kullanımda!" });
            }


            var newCompany = new Companies
            {
                Name = model.CompanyName,
                CreatedDate = DateTime.Now
            };

            db.Companies.Add(newCompany);
            db.SaveChanges();

            // 3. Kullanıcıyı Oluşan newCompany.Id ile Bağlıyoruz
            var adminUser = new AppUsers
            {
                CompanyId = newCompany.Id,
                CompanyName = model.CompanyName,
                FullName = model.FullName,
                Username = model.Email,
                Email = model.Email,
                PasswordHash = PasswordHasher.Hash(model.Password),
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
            if (!ModelState.IsValid || model == null || string.IsNullOrEmpty(model.Username) || string.IsNullOrEmpty(model.Password))
            {
                return Json(new { success = false, message = "Lütfen bilgilerinizi eksiksiz girin." });
            }

            var user = db.AppUsers.FirstOrDefault(u =>
                (u.Username == model.Username || u.Email == model.Username) &&
                u.IsActive == true);

            bool needsUpgrade;
            if (user == null || !PasswordHasher.Verify(model.Password, user.PasswordHash, out needsUpgrade))
            {
                return Json(new { success = false, message = "E-posta veya şifre hatalı!" });
            }

            // Düz metin saklanmış eski şifreyi ilk başarılı girişte hash'e çevir
            if (needsUpgrade)
            {
                user.PasswordHash = PasswordHasher.Hash(model.Password);
                db.SaveChanges();
            }

            string token = JwtHelper.GenerateToken(user.UserId, user.Username, user.Role, user.CompanyId);


            Session["JWToken"] = token;
            Session["UserId"] = user.UserId;
            Session["UserRole"] = user.Role;
            Session["FullName"] = user.FullName;

            string redirectUrl = "/Order/POS";

            if (user.Role == "Admin")
            {

                redirectUrl = "/Admin/Index";
            }
            else if (user.Role == "Mutfak" || user.Role == "Mutfak Şefi")
            {
                redirectUrl = "/Kitchen/Index";
            }
            else if (user.Role == "Garson" || user.Role == "Kasiyer")
            {
                redirectUrl = "/Order/Index";
            }
            else if (user.Role == DeliveryOptions.CourierRole)
            {
                redirectUrl = "/Courier/Index";
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

        #region ŞİFREMİ UNUTTUM (GİRİŞ SAYFASI, OTURUM AÇMADAN)

        // Oturum açmadan şifre sıfırlama: e-postaya 6 haneli kod gider, kod + yeni şifre tek adımda onaylanır.
        // Kod tahminini zorlaştırmak için: kod 6 hane, 5 hatalı denemede iptal, aynı hesaba en fazla
        // dakikada 1 ve saatte 5 kod (oturumdan bağımsız, sunucu belleğinde sayılır).
        private const string ResetOtpSessionKey = "PendingPasswordReset";
        private const int ResetCodeDigits = 6;
        private const int ResetMaxCodesPerHour = 5;
        private static readonly object ResetLock = new object();

        // Hesabın var olup olmadığını belli etmemek için kayıtlı olsun olmasın aynı cevap verilir
        private const string ResetGenericMessage = "Bu e-posta adresi kayıtlıysa 6 haneli doğrulama kodu gönderildi. Gelen kutunuzu ve gereksiz klasörünü kontrol edin.";

        private static bool TryReserveResetCode(int userId, out string error)
        {
            string key = "PasswordResetSends_" + userId;
            lock (ResetLock)
            {
                var cache = System.Runtime.Caching.MemoryCache.Default;
                var sends = ((cache.Get(key) as System.Collections.Generic.List<DateTime>) ?? new System.Collections.Generic.List<DateTime>())
                    .Where(t => DateTime.Now - t < TimeSpan.FromHours(1)).ToList();
                if (sends.Any(t => DateTime.Now - t < TimeSpan.FromMinutes(1)))
                {
                    error = "Yeni kod istemeden önce 1 dakika bekleyin.";
                    return false;
                }
                if (sends.Count >= ResetMaxCodesPerHour)
                {
                    error = "Bu hesap için çok fazla kod istendi. Lütfen bir saat sonra tekrar deneyin.";
                    return false;
                }
                sends.Add(DateTime.Now);
                cache.Set(key, sends, DateTimeOffset.Now.AddHours(1));
                error = null;
                return true;
            }
        }

        private AppUsers FindActiveUserByEmail(string email)
        {
            if (string.IsNullOrWhiteSpace(email)) return null;
            email = email.Trim();
            return db.AppUsers.FirstOrDefault(u => (u.Email == email || u.Username == email) && u.IsActive);
        }

        [HttpPost]
        [AllowAnonymous]
        public JsonResult ForgotPasswordSendCode(string email)
        {
            if (string.IsNullOrWhiteSpace(email))
            {
                return Json(new { success = false, message = "E-posta adresinizi yazın." });
            }

            var user = FindActiveUserByEmail(email);
            if (user == null || string.IsNullOrEmpty(user.Email))
            {
                Session[ResetOtpSessionKey] = null;
                return Json(new { success = true, message = ResetGenericMessage });
            }

            string limitError;
            if (!TryReserveResetCode(user.UserId, out limitError))
            {
                return Json(new { success = false, message = limitError });
            }

            string code = PasswordHasher.GenerateNumericCode(ResetCodeDigits);
            Session[ResetOtpSessionKey] = new PendingOtp
            {
                UserId = user.UserId,
                Code = code,
                ExpiresAt = DateTime.Now.AddMinutes(OtpValidMinutes)
            };

            if (!EmailHelper.SendVerificationCode(user.Email, code))
            {
                Session[ResetOtpSessionKey] = null;
                return Json(new { success = false, message = "E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin." });
            }
            return Json(new { success = true, message = ResetGenericMessage });
        }

        [HttpPost]
        [AllowAnonymous]
        public JsonResult ForgotPasswordReset(string email, string code, string newPassword)
        {
            var otp = Session[ResetOtpSessionKey] as PendingOtp;
            var user = FindActiveUserByEmail(email);

            if (otp == null || user == null || otp.UserId != user.UserId)
            {
                return Json(new { success = false, message = "Geçerli bir doğrulama kodu bulunamadı. Lütfen yeni kod isteyin." });
            }
            if (DateTime.Now > otp.ExpiresAt)
            {
                Session[ResetOtpSessionKey] = null;
                return Json(new { success = false, message = "Doğrulama kodunun süresi doldu. Lütfen yeni kod isteyin." });
            }
            if (string.IsNullOrWhiteSpace(code) || otp.Code != code.Trim())
            {
                otp.FailedAttempts++;
                if (otp.FailedAttempts >= OtpMaxFailedAttempts)
                {
                    Session[ResetOtpSessionKey] = null;
                    return Json(new { success = false, message = "Çok fazla hatalı deneme yapıldı. Lütfen yeni kod isteyin." });
                }
                return Json(new { success = false, message = $"Doğrulama kodu hatalı. Kalan deneme hakkı: {OtpMaxFailedAttempts - otp.FailedAttempts}" });
            }
            if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < MinPasswordLength)
            {
                // Kod doğru; şifre kuralına uymuyorsa kod iptal edilmez, kullanıcı yalnızca şifreyi düzeltir
                return Json(new { success = false, message = $"Yeni şifre en az {MinPasswordLength} karakter olmalıdır." });
            }

            user.PasswordHash = PasswordHasher.Hash(newPassword);
            db.SaveChanges();
            Session[ResetOtpSessionKey] = null;

            return Json(new { success = true, message = "Şifreniz değiştirildi. Yeni şifrenizle giriş yapabilirsiniz." });
        }

        #endregion

        #region ORTAK PROFİL AYARLARI (TÜM ROLLER İÇİN)

        // Kullanıcı yalnızca JwtAuthorize'ın doğruladığı token'daki kimlikten bulunur
        private AppUsers GetCurrentUser()
        {
            var principal = User as ClaimsPrincipal;
            string idClaim = principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

            int userId;
            if (!int.TryParse(idClaim, out userId)) return null;

            return db.AppUsers.FirstOrDefault(u => u.UserId == userId && u.IsActive);
        }

        // Kodu kontrol eder; yanlış denemeleri sayar, süre dolduysa veya deneme hakkı bittiyse kodu iptal eder
        private bool TryCheckOtp(int userId, string code, out string errorMessage)
        {
            var otp = Session[OtpSessionKey] as PendingOtp;

            if (otp == null || otp.UserId != userId)
            {
                errorMessage = "Geçerli bir doğrulama kodu bulunamadı. Lütfen yeni kod isteyin.";
                return false;
            }

            if (DateTime.Now > otp.ExpiresAt)
            {
                Session[OtpSessionKey] = null;
                errorMessage = "Doğrulama kodunun süresi doldu. Lütfen yeni kod isteyin.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(code) || otp.Code != code.Trim())
            {
                otp.FailedAttempts++;
                if (otp.FailedAttempts >= OtpMaxFailedAttempts)
                {
                    Session[OtpSessionKey] = null;
                    errorMessage = "Çok fazla hatalı deneme yapıldı. Lütfen yeni kod isteyin.";
                }
                else
                {
                    errorMessage = $"Girdiğiniz 4 haneli kod hatalı! Kalan deneme hakkı: {OtpMaxFailedAttempts - otp.FailedAttempts}";
                }
                return false;
            }

            errorMessage = null;
            return true;
        }

        [HttpGet]
        [JwtAuthorize]
        public ActionResult ProfileSettings()
        {
            return View();
        }

        [HttpGet]
        [JwtAuthorize]
        public JsonResult GetUserProfile()
        {
            try
            {
                var user = GetCurrentUser();

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
        [JwtAuthorize]
        public JsonResult SendPasswordResetCode()
        {
            try
            {
                var user = GetCurrentUser();

                if (user == null || string.IsNullOrEmpty(user.Email))
                {
                    return Json(new { success = false, message = "Kullanıcı e-postası bulunamadı." });
                }

                string code = PasswordHasher.GenerateNumericCode(4);

                Session[OtpSessionKey] = new PendingOtp
                {
                    UserId = user.UserId,
                    Code = code,
                    ExpiresAt = DateTime.Now.AddMinutes(OtpValidMinutes)
                };

                bool mailSent = EmailHelper.SendVerificationCode(user.Email, code);

                if (mailSent)
                {
                    return Json(new { success = true, message = $"4 haneli doğrulama kodu {user.Email} adresinize gönderildi." });
                }
                else
                {
                    Session[OtpSessionKey] = null;
                    return Json(new { success = false, message = "E-posta gönderilirken bir hata oluştu. Lütfen SMTP ayarlarını kontrol edin." });
                }
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message });
            }
        }

        [HttpPost]
        [JwtAuthorize]
        public JsonResult VerifyOtpCode(string code)
        {
            var user = GetCurrentUser();
            if (user == null)
            {
                return Json(new { success = false, message = "Kullanıcı bulunamadı." });
            }

            string errorMessage;
            if (!TryCheckOtp(user.UserId, code, out errorMessage))
            {
                return Json(new { success = false, message = errorMessage });
            }

            ((PendingOtp)Session[OtpSessionKey]).IsVerified = true;
            return Json(new { success = true, message = "Kod doğrulandı." });
        }

        [HttpPost]
        [JwtAuthorize]
        public JsonResult ConfirmNewPassword(string newPassword)
        {
            var user = GetCurrentUser();
            if (user == null)
            {
                return Json(new { success = false, message = "Kullanıcı bulunamadı." });
            }

            var otp = Session[OtpSessionKey] as PendingOtp;
            bool isVerified = otp != null && otp.IsVerified && otp.UserId == user.UserId && DateTime.Now <= otp.ExpiresAt;

            if (!isVerified)
            {
                return Json(new { success = false, message = "Güvenlik ihlali: Önce doğrulama kodunu onaylamalısınız." });
            }

            if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < MinPasswordLength)
            {
                return Json(new { success = false, message = $"Yeni şifre en az {MinPasswordLength} karakter olmalıdır." });
            }

            user.PasswordHash = PasswordHasher.Hash(newPassword);
            db.SaveChanges();

            Session[OtpSessionKey] = null;

            return Json(new { success = true, message = "Şifreniz güncellendi." });
        }

        [HttpPost]
        [JwtAuthorize]
        public JsonResult UpdateUserProfile(string FullName, string Email, string VerificationCode, string NewPassword)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(FullName) || string.IsNullOrWhiteSpace(Email))
                {
                    return Json(new { success = false, message = "Ad Soyad ve E-Posta alanları zorunludur." });
                }

                FullName = FullName.Trim();
                Email = Email.Trim();

                var user = GetCurrentUser();

                if (user == null)
                {
                    return Json(new { success = false, message = "Kullanıcı bulunamadı." });
                }

                bool emailTaken = db.AppUsers.Any(u => u.UserId != user.UserId && (u.Email == Email || u.Username == Email));
                if (emailTaken)
                {
                    return Json(new { success = false, message = "Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor." });
                }

                if (!string.IsNullOrWhiteSpace(NewPassword))
                {
                    if (string.IsNullOrWhiteSpace(VerificationCode))
                    {
                        return Json(new { success = false, message = "Şifrenizi değiştirmek için lütfen e-postanıza gelen doğrulama kodunu girin." });
                    }

                    if (NewPassword.Length < MinPasswordLength)
                    {
                        return Json(new { success = false, message = $"Yeni şifre en az {MinPasswordLength} karakter olmalıdır." });
                    }

                    string otpError;
                    if (!TryCheckOtp(user.UserId, VerificationCode, out otpError))
                    {
                        return Json(new { success = false, message = otpError });
                    }

                    user.PasswordHash = PasswordHasher.Hash(NewPassword);
                    Session[OtpSessionKey] = null;
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
