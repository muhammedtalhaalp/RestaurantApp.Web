using System;
using System.Runtime.Caching;

namespace RestaurantApp.Web.Helpers
{
    public static class CacheHelper
    {
        private static readonly ObjectCache Cache = MemoryCache.Default;

        // Önbellekten Veri Getir / Yoksa Ekle (GetOrAdd)
        public static T GetOrAdd<T>(string cacheKey, Func<T> getItemCallback, int durationInMinutes = 30) where T : class
        {
            if (Cache.Get(cacheKey) is T item)
            {
                return item;
            }

            item = getItemCallback();
            if (item != null)
            {
                CacheItemPolicy policy = new CacheItemPolicy
                {
                    AbsoluteExpiration = DateTimeOffset.Now.AddMinutes(durationInMinutes)
                };
                Cache.Set(cacheKey, item, policy);
            }

            return item;
        }

        // Belirli Bir Anahtara Ait Önbelleği Temizle
        public static void Remove(string cacheKey)
        {
            if (Cache.Contains(cacheKey))
            {
                Cache.Remove(cacheKey);
            }
        }
    }
}