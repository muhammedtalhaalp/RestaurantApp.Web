using Microsoft.Owin;
using Owin;

[assembly: OwinStartup(typeof(RestaurantApp.Web.Startup))]

namespace RestaurantApp.Web
{
    public class Startup
    {
        public void Configuration(IAppBuilder app)
        {
            // SignalR canlı bildirim hatlarını başlatır
            app.MapSignalR();
        }
    }
}