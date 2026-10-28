using System;
using System.Globalization;
using System.Web.Mvc;

namespace RestaurantApp.Web.Helpers
{
    // Sunucu tr-TR kültürüyle çalışır: ondalık ayırıcı virgül, nokta ise binlik ayırıcıdır.
    // Sayfa JS'leri tutarları her zaman "125.5" biçiminde gönderdiği için varsayılan bağlayıcı bunları
    // ya okuyamaz ya da yanlış okur. Bu bağlayıcı form/query değerlerini kültürden bağımsız (nokta) okur.
    // JSON gövdesinden gelen sayılar zaten sayı tipinde geldiği için doğrudan dönüştürülür.
    // Global.asax'ta decimal ve decimal? için kaydedilir.
    public class InvariantDecimalModelBinder : IModelBinder
    {
        public object BindModel(ControllerContext controllerContext, ModelBindingContext bindingContext)
        {
            var valueResult = bindingContext.ValueProvider.GetValue(bindingContext.ModelName);
            if (valueResult == null)
            {
                return null;
            }

            bindingContext.ModelState.SetModelValue(bindingContext.ModelName, valueResult);

            object raw = valueResult.RawValue;
            if (raw is string[] array)
            {
                raw = array.Length > 0 ? array[0] : null;
            }

            if (raw == null || (raw is string s && string.IsNullOrWhiteSpace(s)))
            {
                if (Nullable.GetUnderlyingType(bindingContext.ModelType) == null)
                {
                    bindingContext.ModelState.AddModelError(bindingContext.ModelName, "Sayı değeri gerekli.");
                }
                return null;
            }

            if (raw is string text)
            {
                decimal parsed;
                if (decimal.TryParse(text.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out parsed))
                {
                    return parsed;
                }

                bindingContext.ModelState.AddModelError(bindingContext.ModelName, $"Geçersiz sayı: {text}");
                return null;
            }

            // JSON'dan gelen int/double/decimal değerler
            try
            {
                return Convert.ToDecimal(raw, CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                bindingContext.ModelState.AddModelError(bindingContext.ModelName, "Geçersiz sayı.");
                return null;
            }
        }
    }
}
