using RestaurantApp.Web.Data;
using RestaurantApp.Web.Helpers;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;

namespace RestaurantApp.Web.Controllers
{
    [AllowAnonymous] // Herkesin üyeliksiz erişebileceği public controller
    public class MenuController : Controller
    {
        private const string DefaultImage = "/Content/images/default-food.png";
        private const int PopularCount = 6;
        private const int PopularDays = 30;

        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // GET: /Menu veya /Menu/Index
        [HttpGet]
        public ActionResult Index(int? tableId)
        {
            ViewBag.TableId = tableId;
            return View();
        }

        // QR menünün bütün verisi tek istekte: restoran, masa, kategoriler, ürünler ve en çok tercih edilenler.
        // Müşteri giriş yapmadığı için restoran, QR koddaki masadan (tableId) veya masasız QR'daki companyId'den bulunur.
        // Açıklamalar yalnızca okunabilir metin olarak gider: reçeteli üründe Description reçete JSON'u tutar ve
        // mutfağın iç bilgisidir (malzemeler, talimat, şef notu), müşteriye gösterilmez.
        [HttpGet]
        public JsonResult GetMenuData(int? tableId, int? companyId)
        {
            try
            {
                string tableName = null;
                if (tableId.HasValue)
                {
                    var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId.Value && t.IsActive);
                    companyId = table?.CompanyId;
                    tableName = table?.TableNumber;
                }

                if (!companyId.HasValue)
                {
                    return Json(new { success = false, message = "Menü bulunamadı. Lütfen QR kodu tekrar okutun." }, JsonRequestBehavior.AllowGet);
                }

                int cid = companyId.Value;
                string restaurantName = db.Companies.Where(c => c.Id == cid).Select(c => c.Name).FirstOrDefault() ?? "Menü";

                var categories = db.AppCategories
                    .Where(c => c.CompanyId == cid && c.IsActive)
                    .OrderBy(c => c.CategoryId)
                    .Select(c => new { categoryId = c.CategoryId, categoryName = c.CategoryName })
                    .ToList();
                var categoryIds = categories.Select(c => c.categoryId).ToList();

                var products = db.AppProducts
                    .Where(p => p.CompanyId == cid && p.IsActive && categoryIds.Contains(p.CategoryId))
                    .OrderBy(p => p.ProductName)
                    .ToList()
                    .Select(p => new
                    {
                        productId = p.ProductId,
                        categoryId = p.CategoryId,
                        productName = p.ProductName,
                        price = p.Price,
                        description = ProductDescription.Text(p.Description),
                        imageUrl = string.IsNullOrEmpty(p.ImageUrl) ? DefaultImage : p.ImageUrl,
                        isAvailable = p.IsAvailable
                    })
                    .ToList();

                return Json(new
                {
                    success = true,
                    data = new
                    {
                        restaurantName = restaurantName,
                        tableName = tableName,
                        categories = categories,
                        products = products,
                        popularProductIds = PopularProductIds(cid, products.Where(p => p.isAvailable).Select(p => p.productId).ToList())
                    }
                }, JsonRequestBehavior.AllowGet);
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "Menü verileri çekilemedi: " + ex.Message }, JsonRequestBehavior.AllowGet);
            }
        }

        // Son 30 günde en çok sipariş edilen (iade edilmemiş) ürünler; satış yoksa menüye en son eklenenler
        private List<int> PopularProductIds(int companyId, List<int> availableIds)
        {
            DateTime since = DateTime.Now.AddDays(-PopularDays);

            var bestSellers = db.AppOrderDetails
                .Where(d => !d.IsReturned && d.AppOrders.CompanyId == companyId && d.AppOrders.Status != "İptal" && d.CreatedDate >= since
                            && availableIds.Contains(d.ProductId))
                .GroupBy(d => d.ProductId)
                .Select(g => new { productId = g.Key, quantity = g.Sum(d => d.Quantity) })
                .OrderByDescending(x => x.quantity)
                .Take(PopularCount)
                .Select(x => x.productId)
                .ToList();

            if (bestSellers.Count >= PopularCount) return bestSellers;

            var newest = availableIds.Except(bestSellers).OrderByDescending(id => id).Take(PopularCount - bestSellers.Count);
            return bestSellers.Concat(newest).ToList();
        }

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
