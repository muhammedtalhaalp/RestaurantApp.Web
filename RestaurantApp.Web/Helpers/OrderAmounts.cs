using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // AppOrders.TotalAmount siparişin toplamı DEĞİL, kalan (ödenmemiş) borçtur.
    // Ciro ve rapor hesaplarında sipariş değeri için bu yardımcıları kullanın.
    public static class OrderAmounts
    {
        public static decimal Paid(AppOrders order)
        {
            return (order.CashAmount ?? 0) + (order.CreditCardAmount ?? 0) + (order.MealCardAmount ?? 0);
        }

        // Siparişin toplam değeri = tahsil edilen + kalan borç
        public static decimal Value(AppOrders order)
        {
            return Paid(order) + order.TotalAmount;
        }
    }
}
