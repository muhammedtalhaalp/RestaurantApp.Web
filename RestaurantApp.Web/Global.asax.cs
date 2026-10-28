using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Web.Mvc;
using System.Web.Optimization;
using System.Web.Routing;

namespace RestaurantApp.Web
{
    public class MvcApplication : System.Web.HttpApplication
    {
        protected void Application_Start()
        {
            AreaRegistration.RegisterAllAreas();
            FilterConfig.RegisterGlobalFilters(GlobalFilters.Filters);
            RouteConfig.RegisterRoutes(RouteTable.Routes);
            BundleConfig.RegisterBundles(BundleTable.Bundles);

            // Tutarlar JS'ten "125.5" biçiminde gelir; tr-TR kültüründe yanlış okunmasın diye (bkz. InvariantDecimalModelBinder)
            ModelBinders.Binders.Add(typeof(decimal), new Helpers.InvariantDecimalModelBinder());
            ModelBinders.Binders.Add(typeof(decimal?), new Helpers.InvariantDecimalModelBinder());
        }
    }
}
