using System;
using System.Linq;
using System.Net;
using System.Security.Claims;
using System.Web;
using System.Web.Mvc;
using RestaurantApp.Web.Helpers;

namespace RestaurantApp.Web.Filters
{
    // Tarayıcı istekleri: token Session'dan okunur; yetkisizse Login veya AccessDenied sayfasına yönlendirilir.
    // API istemcileri (mobil uygulama, hijyen kamerası): Session yoktur, token "Authorization: Bearer" başlığıyla
    // gelir. Bunlara yönlendirme yerine 401 (giriş gerekli) / 403 (yetki yok) + JSON döner. Mobil uygulama ayrıca
    // her istekte "X-Client-App" başlığı gönderir; böylece token'ı olmadığında ve şifre değiştirme (OTP) için
    // oturum çerezini taşıdığında da JSON cevap alır.
    public class JwtAuthorizeAttribute : AuthorizeAttribute
    {
        public const string ClientAppHeader = "X-Client-App";

        public override void OnAuthorization(AuthorizationContext filterContext)
        {
            // [AllowAnonymous] işaretli action veya controller'da yetki kontrolü yapılmaz
            if (filterContext.ActionDescriptor.IsDefined(typeof(AllowAnonymousAttribute), true) ||
                filterContext.ActionDescriptor.ControllerDescriptor.IsDefined(typeof(AllowAnonymousAttribute), true))
            {
                return;
            }

            // Anahtar try dışında okunur: ayar eksikse sessizce Login'e atmak yerine açık hata versin
            JwtHelper.GetSigningKey();

            var request = filterContext.HttpContext.Request;

            // 1. Önce Session'dan, yoksa Authorization başlığından token'ı al
            var token = filterContext.HttpContext.Session["JWToken"] as string;
            bool isApiClient = !string.IsNullOrEmpty(request.Headers[ClientAppHeader]);

            if (string.IsNullOrEmpty(token))
            {
                var authHeader = request.Headers["Authorization"];
                if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer "))
                {
                    token = authHeader.Substring(7);
                    isApiClient = true;
                }
            }

            if (string.IsNullOrEmpty(token))
            {
                Deny(filterContext, isApiClient, HttpStatusCode.Unauthorized, "Oturum açmanız gerekiyor.");
                return;
            }

            ClaimsPrincipal principal;
            try
            {
                // 2. Token'ın imzasını, süresini ve şirket bilgisini doğrula
                principal = JwtHelper.ValidateToken(token);
            }
            catch (Exception)
            {
                // Token geçersiz veya süresi dolmuş: tarayıcıda Session temizlenir
                filterContext.HttpContext.Session.Clear();
                Deny(filterContext, isApiClient, HttpStatusCode.Unauthorized, "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.");
                return;
            }

            // 3. Rol kontrolü (Attribute üzerinde Roles = "Admin, Kasiyer" gibi belirtilmişse)
            if (!string.IsNullOrEmpty(Roles))
            {
                var allowedRoles = Roles.Split(',').Select(r => r.Trim()).ToList();
                var userRole = principal.FindFirst(ClaimTypes.Role)?.Value;

                if (userRole == null || !allowedRoles.Contains(userRole))
                {
                    Deny(filterContext, isApiClient, HttpStatusCode.Forbidden, "Bu işlem için yetkiniz yok.");
                    return;
                }
            }

            // Her şey yolundaysa kullanıcıyı sisteme tanıt
            filterContext.HttpContext.User = principal;
        }

        private static void Deny(AuthorizationContext filterContext, bool isApiClient, HttpStatusCode status, string message)
        {
            if (isApiClient)
            {
                var response = filterContext.HttpContext.Response;
                response.StatusCode = (int)status;
                response.TrySkipIisCustomErrors = true;
                filterContext.Result = new JsonResult
                {
                    Data = new { success = false, code = status == HttpStatusCode.Unauthorized ? "unauthorized" : "forbidden", message = message },
                    JsonRequestBehavior = JsonRequestBehavior.AllowGet
                };
                return;
            }

            string action = status == HttpStatusCode.Forbidden ? "AccessDenied" : "Login";
            string controller = status == HttpStatusCode.Forbidden ? "Error" : "Auth";
            filterContext.Result = new RedirectToRouteResult(
                new System.Web.Routing.RouteValueDictionary { { "controller", controller }, { "action", action } });
        }
    }
}
