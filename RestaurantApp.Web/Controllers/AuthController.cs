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
                CompanyId = newCompany.Id, // Foreign Key bağlantısı sağlandı
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
            db.SaveChanges(); // Artık Foreign Key hatası almayacaksın!

            return Json(new { success = true, message = "Kayıt başarılı! Giriş sayfasına yönlendiriliyorsunuz." });
        }

        [HttpPost]
        public JsonResult ApiLogin(LoginViewModel model)
        {
            if (!ModelState.IsValid)
            {
                return Json(new { success = false, message = "Lütfen bilgilerinizi eksiksiz girin." });
            }

            // DÜZELTME: Kullanıcı hem Email hem Username ile giriş yapabilir hale getirildi
            var user = db.AppUsers.FirstOrDefault(u =>
                (u.Username == model.Username || u.Email == model.Username) &&
                u.PasswordHash == model.Password &&
                u.IsActive == true);

            if (user == null)
            {
                return Json(new { success = false, message = "E-posta veya şifre hatalı!" });
            }

            string token = JwtHelper.GenerateToken(user.UserId, user.Username, user.Role);

            string redirectUrl = "/Order/POS";

            if (user.Role == "Admin")
            {
                redirectUrl = "/Admin/Dashboard";
            }
            else if (user.Role == "Mutfak")
            {
                redirectUrl = "/Kitchen/Index";
            }
            else if (user.Role == "Garson" || user.Role == "Kasiyer")
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
    }
}