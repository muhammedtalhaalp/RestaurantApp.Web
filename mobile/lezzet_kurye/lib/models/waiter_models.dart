// Garson ekranlarının modelleri. Sunucu karşılıkları:
// Order/GetTables, Category/GetCategories, Order/GetProducts, Admin/GetActiveOrderByTableId,
// Admin/GetPendingDeliveryOrders, Admin/GetOrderDetails.

double _toDouble(Object? value) => value == null ? 0 : (value as num).toDouble();

class TableInfo {
  TableInfo({
    required this.tableId,
    required this.name,
    required this.section,
    required this.isOccupied,
    required this.remainingAmount,
    required this.isPriority,
  });

  factory TableInfo.fromJson(Map<String, dynamic> json) => TableInfo(
        tableId: (json['tableId'] as num).toInt(),
        name: json['tableName'] as String? ?? '',
        section: json['section'] as String? ?? 'Salon',
        isOccupied: json['status'] == 'Dolu',
        remainingAmount: _toDouble(json['currentAmount']),
        isPriority: json['isPriority'] == true,
      );

  final int tableId;
  final String name;
  final String section;
  final bool isOccupied;

  /// Masanın ödenmemiş kalan tutarı (AppOrders.TotalAmount toplamı).
  final double remainingAmount;
  final bool isPriority;
}

class MenuCategory {
  MenuCategory({required this.categoryId, required this.name});

  factory MenuCategory.fromJson(Map<String, dynamic> json) =>
      MenuCategory(categoryId: (json['CategoryId'] as num).toInt(), name: json['CategoryName'] as String? ?? '');

  final int categoryId;
  final String name;
}

class MenuProduct {
  MenuProduct({
    required this.productId,
    required this.name,
    required this.price,
    required this.categoryId,
    required this.imageUrl,
    required this.isAvailable,
  });

  factory MenuProduct.fromJson(Map<String, dynamic> json) => MenuProduct(
        productId: (json['ProductId'] as num).toInt(),
        name: json['ProductName'] as String? ?? '',
        price: _toDouble(json['Price']),
        categoryId: (json['CategoryId'] as num?)?.toInt(),
        imageUrl: json['ImageUrl'] as String?,
        isAvailable: json['IsAvailable'] != false,
      );

  final int productId;
  final String name;
  final double price;
  final int? categoryId;
  final String? imageUrl;

  /// Mutfak "tükendi" dediyse false; sipariş edilemez.
  final bool isAvailable;
}

/// Bir ürünün mutfak durumu. Sunucuda AppOrderDetails.ReturnReason alanında tutulur.
enum ItemStatus {
  preparing('Hazırlanıyor'),
  ready('Hazır'),
  served('Servis Edildi');

  const ItemStatus(this.label);
  final String label;

  static ItemStatus parse(String? value) => switch (value) {
        'Hazır' => ItemStatus.ready,
        'Servis Edildi' => ItemStatus.served,
        _ => ItemStatus.preparing,
      };
}

class TableOrderItem {
  TableOrderItem({
    required this.orderId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.status,
  });

  factory TableOrderItem.fromJson(Map<String, dynamic> json) => TableOrderItem(
        orderId: (json['orderId'] as num).toInt(),
        name: json['productName'] as String? ?? 'Ürün',
        quantity: (json['quantity'] as num? ?? 0).toInt(),
        unitPrice: _toDouble(json['unitPrice']),
        status: ItemStatus.parse(json['returnReason'] as String?),
      );

  final int orderId;
  final String name;
  final int quantity;
  final double unitPrice;
  final ItemStatus status;

  double get total => quantity * unitPrice;
}

class TableOrder {
  TableOrder({required this.items, required this.remainingTotal});

  static final empty = TableOrder(items: const [], remainingTotal: 0);

  final List<TableOrderItem> items;
  final double remainingTotal;

  /// Hazır ürünü olan siparişler: "Servis Ettim" bunlara uygulanır.
  Set<int> get ordersWithReadyItems =>
      items.where((i) => i.status == ItemStatus.ready).map((i) => i.orderId).toSet();
}

/// "Hazır Siparişler" listesindeki bir masa siparişi.
class PendingOrder {
  PendingOrder({
    required this.orderId,
    required this.tableName,
    required this.hasReadyItems,
    required this.orderTime,
  });

  factory PendingOrder.fromJson(Map<String, dynamic> json) => PendingOrder(
        orderId: (json['orderId'] as num).toInt(),
        tableName: json['tableName'] as String? ?? '',
        hasReadyItems: json['status'] == 'Hazır',
        orderTime: json['orderDate'] as String? ?? '',
      );

  final int orderId;
  final String tableName;
  final bool hasReadyItems;
  final String orderTime;
}

class OrderDetailItem {
  OrderDetailItem({required this.name, required this.quantity, required this.status});

  factory OrderDetailItem.fromJson(Map<String, dynamic> json) => OrderDetailItem(
        name: json['productName'] as String? ?? 'Ürün',
        quantity: (json['quantity'] as num? ?? 0).toInt(),
        status: ItemStatus.parse(json['itemStatus'] as String?),
      );

  final String name;
  final int quantity;
  final ItemStatus status;
}

/// Sepetteki bir satır (henüz mutfağa gönderilmemiş).
class CartLine {
  CartLine(this.product, this.quantity);

  final MenuProduct product;
  int quantity;

  double get total => product.price * quantity;
}
