import '../core/api_client.dart';
import '../core/session.dart';
import '../models/waiter_models.dart';

/// Garson uç noktaları. Web'deki POS ve "Sipariş Takip" ekranlarının kullandığı action'ların aynısıdır;
/// fiyat, stok ve masa kuralları sunucuda (OrderController.CreateOrder vb.) uygulanır.
class WaiterService {
  final _api = AppSession.instance.api;

  Future<List<TableInfo>> fetchTables() async {
    final res = await _api.get('/Order/GetTables');
    return (res['data'] as List).map((e) => TableInfo.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Masadaki açık siparişlerin ürünleri. Masa boşsa sunucu "Aktif sipariş bulunamadı" der; bu boş sipariştir.
  Future<TableOrder> fetchTableOrder(int tableId) async {
    try {
      final res = await _api.get('/Admin/GetActiveOrderByTableId?tableId=$tableId');
      return TableOrder(
        items: (res['data'] as List).map((e) => TableOrderItem.fromJson(e as Map<String, dynamic>)).toList(),
        remainingTotal: ((res['remainingTotal'] as num?) ?? 0).toDouble(),
      );
    } on UnauthorizedException {
      rethrow;
    } on ApiException catch (e) {
      if (e.message.startsWith('Aktif sipariş bulunamadı')) return TableOrder.empty;
      rethrow;
    }
  }

  /// Menü: yalnızca aktif kategoriler ve o kategorilerdeki aktif ürünler.
  Future<(List<MenuCategory>, List<MenuProduct>)> fetchMenu() async {
    final results = await Future.wait([_api.get('/Category/GetCategories'), _api.get('/Order/GetProducts')]);

    final categories = (results[0]['data'] as List)
        .cast<Map<String, dynamic>>()
        .where((c) => c['IsActive'] == true)
        .map(MenuCategory.fromJson)
        .toList();
    final products = (results[1]['data'] as List)
        .cast<Map<String, dynamic>>()
        .where((p) => p['IsCategoryActive'] != false)
        .map(MenuProduct.fromJson)
        .toList();
    return (categories, products);
  }

  /// Sepeti masanın açık siparişine ekler (yoksa yeni sipariş açılır) ve mutfağa gönderir.
  Future<String> sendOrder({
    required int tableId,
    required List<CartLine> lines,
    String? note,
    bool isPriority = false,
  }) async {
    final res = await _api.postJson('/Order/CreateOrder', {
      'OrderType': 'Masa',
      'TableId': tableId,
      'OrderNote': (note == null || note.trim().isEmpty) ? null : note.trim(),
      'IsPriority': isPriority,
      'Items': [
        for (final line in lines) {'ProductId': line.product.productId, 'Quantity': line.quantity},
      ],
    });
    return res['message'] as String? ?? 'Sipariş mutfağa iletildi.';
  }

  Future<List<PendingOrder>> fetchPendingOrders() async {
    final res = await _api.get('/Admin/GetPendingDeliveryOrders');
    return (res['data'] as List).map((e) => PendingOrder.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<OrderDetailItem>> fetchOrderItems(int orderId) async {
    final res = await _api.get('/Admin/GetOrderDetails?orderId=$orderId');
    final data = res['data'] as Map<String, dynamic>;
    return (data['items'] as List).map((e) => OrderDetailItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Siparişin hazır ürünlerini "Servis Edildi" yapar.
  Future<String> markServed(int orderId) async {
    final res = await _api.post('/Order/ApproveOrderDelivery', {'orderId': '$orderId'});
    return res['message'] as String? ?? 'Servis edildi.';
  }
}
