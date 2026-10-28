import '../core/session.dart';
import '../models/courier_models.dart';

/// Kurye uç noktaları (sunucu: CourierController). Kurallar sunucuda (DeliveryWorkflow) uygulanır;
/// burada yalnızca istek gönderilir, sunucunun hata mesajı ApiException olarak gelir.
class CourierService {
  final _api = AppSession.instance.api;

  Future<CourierDashboard> fetchDashboard() async {
    final res = await _api.get('/Courier/GetMyOrders');
    return CourierDashboard.fromJson(res['data'] as Map<String, dynamic>);
  }

  Future<String> markOutForDelivery(int orderId) async {
    final res = await _api.post('/Courier/MarkOutForDelivery', {'orderId': '$orderId'});
    return res['message'] as String? ?? 'Yola çıktınız.';
  }

  /// [paymentMethod]: "Nakit" veya "Kart"; tahsilat yoksa null.
  Future<String> completeDelivery(int orderId, String? paymentMethod) async {
    final res = await _api.post('/Courier/CompleteDelivery', {
      'orderId': '$orderId',
      'paymentMethod': ?paymentMethod,
    });
    return res['message'] as String? ?? 'Teslimat tamamlandı.';
  }
}
