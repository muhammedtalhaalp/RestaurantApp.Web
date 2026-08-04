using System;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Web;
using System.Web.Mvc;
using Microsoft.IdentityModel.Tokens;
using RestaurantApp.Web.Helpers;

namespace RestaurantApp.Web.Filters
{
    public class JwtAuthorizeAttribute : AuthorizeAttribute
    {
        // Gizli anahtarımız (JwtHelper ile BİREBİR AYNI olmalı)
        private const string SecretKey = "RestaurantAppSecretKeyForJwtAuthenticationCustomKey123!";

        public override void OnAuthorization(AuthorizationContext filterContext)
        {
            // 1. Önce Session'dan, yoksa Request Header'dan Token'ı al
            var token = filterContext.HttpContext.Session["JWToken"] as string;

            if (string.IsNullOrEmpty(token))
            {
                var authHeader = filterContext.HttpContext.Request.Headers["Authorization"];
                if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer "))
                {
                    token = authHeader.Substring(7);
                }
            }

            if (string.IsNullOrEmpty(token))
            {
                // Token yoksa doğrudan Login sayfasına yönlendir
                filterContext.Result = new RedirectToRouteResult(
                    new System.Web.Routing.RouteValueDictionary
                    {
                { "controller", "Auth" },
                { "action", "Login" }
                    });
                return;
            }

            try
            {
                // 2. Token'ın imzasını ve süresini doğrula
                var tokenHandler = new JwtSecurityTokenHandler();
                var key = Encoding.ASCII.GetBytes(SecretKey);

                var validationParameters = new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(key),
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ClockSkew = TimeSpan.Zero
                };

                // Token'ı çözüyoruz (Validate)
                ClaimsPrincipal principal = tokenHandler.ValidateToken(token, validationParameters, out SecurityToken validatedToken);

                // 3. Rol Kontrolü (Attribute üzerinde Roles = "Yonetici" gibi belirtilmişse)
                if (!string.IsNullOrEmpty(Roles))
                {
                    var allowedRoles = Roles.Split(',').Select(r => r.Trim()).ToList();
                    var userRole = principal.FindFirst(ClaimTypes.Role)?.Value;

                    if (userRole == null || !allowedRoles.Contains(userRole))
                    {
                        // Yetkisi yoksa doğrudan Yetkisiz Erişim (AccessDenied) sayfasına yönlendir
                        filterContext.Result = new RedirectToRouteResult(
                            new System.Web.Routing.RouteValueDictionary
                            {
            { "controller", "Error" },
            { "action", "AccessDenied" }
                            });
                        return;
                    }
                }

                // Her şey yolundaysa kullanıcıyı sisteme tanıt
                filterContext.HttpContext.User = principal;
            }
            catch (Exception)
            {
                // Token geçersiz veya süresi dolmuşsa Session'ı temizle ve Login'e at
                filterContext.HttpContext.Session.Clear();
                filterContext.Result = new RedirectToRouteResult(
                    new System.Web.Routing.RouteValueDictionary
                    {
                        { "controller", "Auth" },
                        { "action", "Login" }
                    });
            }
        }
    }
}