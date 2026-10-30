using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RestaurantApp.Web.Helpers
{
    // AppProducts.Description iki biçimde olabilir: düz açıklama metni ya da reçete JSON'u
    // {hasRecipe, productDesc, cookTime, station, ingredients, instructions, chefTip} (bkz. KitchenController.SaveRecipe).
    // Ekranlarda yalnızca okunabilir açıklama (productDesc) gösterilir; açıklama değiştirilirken reçete korunur.
    public static class ProductDescription
    {
        // Saklanan değer reçete JSON'uysa nesnesini döner, değilse null
        private static JObject TryParseRecipe(string stored)
        {
            if (string.IsNullOrWhiteSpace(stored)) return null;
            string trimmed = stored.Trim();
            if (!trimmed.StartsWith("{") || !trimmed.EndsWith("}")) return null;

            try
            {
                return JObject.Parse(trimmed);
            }
            catch (JsonException)
            {
                return null;
            }
        }

        public static bool HasRecipe(string stored)
        {
            return TryParseRecipe(stored)?.Value<bool?>("hasRecipe") == true;
        }

        // Kullanıcıya gösterilecek açıklama metni
        public static string Text(string stored)
        {
            var recipe = TryParseRecipe(stored);
            if (recipe == null) return stored?.Trim() ?? "";
            return recipe.Value<string>("productDesc") ?? "";
        }

        // Açıklamayı değiştirir: reçete varsa yalnızca productDesc güncellenir, diğer reçete alanları korunur
        public static string WithText(string stored, string newText)
        {
            newText = string.IsNullOrWhiteSpace(newText) ? "" : newText.Trim();

            var recipe = TryParseRecipe(stored);
            if (recipe == null) return newText.Length == 0 ? null : newText;

            recipe["productDesc"] = newText;
            return recipe.ToString(Formatting.None);
        }
    }
}
