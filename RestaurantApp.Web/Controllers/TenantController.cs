using System;
using System.Security.Claims;
using System.Web.Mvc;
using RestaurantApp.Web.Helpers;

namespace RestaurantApp.Web.Controllers
{
    // Giriş yapmış kullanıcının şirketine (restoranına) ait verilerle çalışan controller'ların temeli.
    // Tüm sorgular CurrentCompanyId ile sınırlanmalı; şirket asla istemciden gelen parametreden alınmaz.
    public abstract class TenantController : Controller
    {
        // JwtAuthorize'ın doğruladığı token'daki şirket. JwtAuthorize olmayan action'larda kullanılamaz.
        protected int CurrentCompanyId
        {
            get
            {
                var principal = User as ClaimsPrincipal;
                int companyId;
                if (principal == null || !int.TryParse(principal.FindFirst(JwtHelper.CompanyIdClaim)?.Value, out companyId))
                {
                    throw new InvalidOperationException("Oturumda şirket bilgisi bulunamadı. Bu action JwtAuthorize ile korunmalı.");
                }
                return companyId;
            }
        }

        // Token'daki kullanıcı kimliği (Session'a bağlı değildir; Bearer token ile gelen isteklerde de çalışır)
        protected int CurrentUserId
        {
            get
            {
                var principal = User as ClaimsPrincipal;
                int userId;
                if (principal == null || !int.TryParse(principal.FindFirst(ClaimTypes.NameIdentifier)?.Value, out userId))
                {
                    throw new InvalidOperationException("Oturumda kullanıcı bilgisi bulunamadı. Bu action JwtAuthorize ile korunmalı.");
                }
                return userId;
            }
        }
    }
}
