// `/Courier/GetMyOrders` cevabının modelleri (sunucu: CourierController.GetMyOrders).

double? _toDouble(Object? value) => value == null ? null : (value as num).toDouble();

/// Siparişin teslimattaki aşaması. Sunucu `stage` alanında gönderir.
enum DeliveryStage {
  kitchen, // mutfakta hazırlanıyor
  ready, // hazır, restorandan alınacak
  onTheWay; // yolda

  static DeliveryStage parse(String? value) => switch (value) {
        'ready' => DeliveryStage.ready,
        'onTheWay' => DeliveryStage.onTheWay,
        _ => DeliveryStage.kitchen,
      };
}

class OrderItem {
  OrderItem({required this.name, required this.quantity});

  factory OrderItem.fromJson(Map<String, dynamic> json) =>
      OrderItem(name: json['name'] as String? ?? 'Ürün', quantity: (json['quantity'] as num? ?? 0).toInt());

  final String name;
  final int quantity;
}

class CourierOrder {
  CourierOrder({
    required this.orderId,
    required this.stage,
    required this.channel,
    required this.externalOrderNo,
    required this.customerName,
    required this.customerPhone,
    required this.address,
    required this.latitude,
    required this.longitude,
    required this.note,
    required this.isPriority,
    required this.paymentPlan,
    required this.paymentPlanLabel,
    required this.changeFor,
    required this.orderValue,
    required this.dueAmount,
    required this.minutesSinceCreated,
    required this.minutesOnTheWay,
    required this.itemCount,
    required this.items,
  });

  factory CourierOrder.fromJson(Map<String, dynamic> json) => CourierOrder(
        orderId: (json['orderId'] as num).toInt(),
        stage: DeliveryStage.parse(json['stage'] as String?),
        channel: json['channel'] as String?,
        externalOrderNo: json['externalOrderNo'] as String?,
        customerName: json['customerName'] as String?,
        customerPhone: json['customerPhone'] as String?,
        address: json['address'] as String?,
        latitude: _toDouble(json['latitude']),
        longitude: _toDouble(json['longitude']),
        note: json['note'] as String?,
        isPriority: json['isPriority'] == true,
        paymentPlan: json['paymentPlan'] as String?,
        paymentPlanLabel: json['paymentPlanLabel'] as String? ?? '',
        changeFor: _toDouble(json['changeFor']),
        orderValue: _toDouble(json['orderValue']) ?? 0,
        dueAmount: _toDouble(json['dueAmount']) ?? 0,
        minutesSinceCreated: (json['minutesSinceCreated'] as num? ?? 0).toInt(),
        minutesOnTheWay: (json['minutesOnTheWay'] as num?)?.toInt(),
        itemCount: (json['itemCount'] as num? ?? 0).toInt(),
        items: (json['items'] as List? ?? const [])
            .map((e) => OrderItem.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final int orderId;
  final DeliveryStage stage;
  final String? channel;
  final String? externalOrderNo;
  final String? customerName;
  final String? customerPhone;
  final String? address;
  final double? latitude;
  final double? longitude;
  final String? note;
  final bool isPriority;
  final String? paymentPlan;
  final String paymentPlanLabel;

  /// Müşterinin vereceği para (para üstü hesabı için), yoksa null.
  final double? changeFor;
  final double orderValue;

  /// Kapıda tahsil edilecek tutar. Online ödenmiş siparişte 0.
  final double dueAmount;
  final int minutesSinceCreated;
  final int? minutesOnTheWay;
  final int itemCount;
  final List<OrderItem> items;

  bool get hasPaymentToCollect => dueAmount > 0;
}

class DeliveredOrder {
  DeliveredOrder({
    required this.orderId,
    required this.channel,
    required this.customerName,
    required this.paymentType,
    required this.orderValue,
    required this.completedTime,
  });

  factory DeliveredOrder.fromJson(Map<String, dynamic> json) => DeliveredOrder(
        orderId: (json['orderId'] as num).toInt(),
        channel: json['channel'] as String?,
        customerName: json['customerName'] as String?,
        paymentType: json['paymentType'] as String?,
        orderValue: _toDouble(json['orderValue']) ?? 0,
        completedTime: json['completedTime'] as String? ?? '',
      );

  final int orderId;
  final String? channel;
  final String? customerName;
  final String? paymentType;
  final double orderValue;
  final String completedTime;
}

class CourierDashboard {
  CourierDashboard({
    required this.active,
    required this.recent,
    required this.deliveredTodayCount,
    required this.cashOnHand,
    required this.cardToday,
  });

  factory CourierDashboard.fromJson(Map<String, dynamic> json) {
    final summary = json['summary'] as Map<String, dynamic>? ?? const {};
    return CourierDashboard(
      active: (json['active'] as List? ?? const [])
          .map((e) => CourierOrder.fromJson(e as Map<String, dynamic>))
          .toList(),
      recent: (json['recent'] as List? ?? const [])
          .map((e) => DeliveredOrder.fromJson(e as Map<String, dynamic>))
          .toList(),
      deliveredTodayCount: (summary['deliveredTodayCount'] as num? ?? 0).toInt(),
      cashOnHand: _toDouble(summary['cashOnHand']) ?? 0,
      cardToday: _toDouble(summary['cardToday']) ?? 0,
    );
  }

  final List<CourierOrder> active;
  final List<DeliveredOrder> recent;
  final int deliveredTodayCount;

  /// Teslim edilip restorana henüz verilmemiş nakit (kurye kasası).
  final double cashOnHand;
  final double cardToday;
}
