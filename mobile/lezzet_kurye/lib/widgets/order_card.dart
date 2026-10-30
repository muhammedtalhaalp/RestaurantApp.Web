import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/courier_models.dart';
import 'channel_badge.dart';
import 'gradient_button.dart';

/// Tek bir teslimatın kartı. Web karşılığı: courier.js renderOrderCard.
class OrderCard extends StatefulWidget {
  const OrderCard({
    super.key,
    required this.order,
    required this.isNew,
    required this.isBusy,
    required this.onOutForDelivery,
    required this.onComplete,
  });

  final CourierOrder order;
  final bool isNew;

  /// Bu kart için sunucuya istek gidiyorsa ana düğme beklemede gösterilir.
  final bool isBusy;
  final VoidCallback onOutForDelivery;
  final VoidCallback onComplete;

  @override
  State<OrderCard> createState() => _OrderCardState();
}

class _OrderCardState extends State<OrderCard> {
  bool _showItems = false;

  CourierOrder get order => widget.order;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: widget.isNew
            ? const BorderSide(color: AppColors.accent, width: 2)
            : const BorderSide(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _StageBanner(order: order),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _header(),
                const SizedBox(height: 10),
                Text(order.customerName ?? 'Müşteri', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                if (order.customerPhone?.isNotEmpty == true)
                  Text(order.customerPhone!, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                const SizedBox(height: 10),
                _addressBox(),
                const SizedBox(height: 10),
                _contactButtons(context),
                if (order.note?.isNotEmpty == true) ...[const SizedBox(height: 10), _noteBox()],
                _itemsSection(),
                const SizedBox(height: 12),
                _PaymentBox(order: order),
                const SizedBox(height: 12),
                _mainAction(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _header() {
    return Row(
      children: [
        if (order.isPriority) const Icon(Icons.local_fire_department, color: AppColors.danger, size: 20),
        Text('#${order.orderId}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17, color: AppColors.text)),
        const Spacer(),
        Flexible(child: ChannelBadge(channel: order.channel, externalOrderNo: order.externalOrderNo)),
      ],
    );
  }

  Widget _addressBox() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: AppColors.surfaceHigh, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.location_on, color: AppColors.danger, size: 18),
          const SizedBox(width: 6),
          Expanded(child: Text(order.address ?? 'Adres yok', style: const TextStyle(fontSize: 14, color: AppColors.text))),
        ],
      ),
    );
  }

  Widget _contactButtons(BuildContext context) {
    final phoneDigits = (order.customerPhone ?? '').replaceAll(RegExp(r'[^\d+]'), '');
    final destination = order.latitude != null && order.longitude != null
        ? '${order.latitude},${order.longitude}'
        : (order.address?.isNotEmpty == true ? order.address : null);

    return Row(
      children: [
        Expanded(
          child: _ContactButton(
            icon: Icons.phone,
            label: phoneDigits.isEmpty ? 'Telefon yok' : 'Ara',
            color: AppColors.ready,
            background: const Color(0x1F2FD67B),
            onTap: phoneDigits.isEmpty ? null : () => _open(context, Uri(scheme: 'tel', path: phoneDigits)),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ContactButton(
            icon: Icons.directions,
            label: destination == null ? 'Konum yok' : 'Yol Tarifi',
            color: AppColors.onTheWay,
            background: const Color(0x1F4C9BFF),
            onTap: destination == null
                ? null
                : () => _open(
                      context,
                      Uri.https('www.google.com', '/maps/dir/', {'api': '1', 'destination': destination}),
                    ),
          ),
        ),
      ],
    );
  }

  Future<void> _open(BuildContext context, Uri uri) async {
    final messenger = ScaffoldMessenger.of(context);
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened) {
      messenger.showSnackBar(const SnackBar(content: Text('Bu işlem için uygun bir uygulama bulunamadı.')));
    }
  }

  Widget _noteBox() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0x1FF5A524),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0x59F5A524)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.sticky_note_2_outlined, size: 16, color: AppColors.kitchen),
          const SizedBox(width: 6),
          Expanded(child: Text(order.note!, style: const TextStyle(fontSize: 13, color: AppColors.kitchen))),
        ],
      ),
    );
  }

  Widget _itemsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton.icon(
          onPressed: () => setState(() => _showItems = !_showItems),
          style: TextButton.styleFrom(padding: EdgeInsets.zero, foregroundColor: AppColors.muted),
          icon: Icon(_showItems ? Icons.expand_less : Icons.expand_more, size: 20),
          label: Text('${order.itemCount} ürün', style: const TextStyle(fontWeight: FontWeight.w600)),
        ),
        if (_showItems)
          ...order.items.map(
            (item) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Text('${item.quantity}× ${item.name}', style: const TextStyle(fontSize: 14)),
            ),
          ),
      ],
    );
  }

  Widget _mainAction() {
    return switch (order.stage) {
      DeliveryStage.kitchen => const GradientButton(
          onPressed: null,
          icon: Icons.hourglass_top,
          label: 'Mutfağın hazırlamasını bekleyin',
        ),
      DeliveryStage.ready => GradientButton(
          onPressed: widget.onOutForDelivery,
          loading: widget.isBusy,
          colors: const [Color(0xFF6AB0FF), Color(0xFF2563EB)],
          icon: Icons.two_wheeler,
          label: 'Siparişi Aldım, Yola Çıktım',
        ),
      DeliveryStage.onTheWay => GradientButton(
          onPressed: widget.onComplete,
          loading: widget.isBusy,
          colors: const [Color(0xFF34E089), Color(0xFF13A456)],
          icon: Icons.check_circle,
          label: 'Teslim Ettim',
        ),
    };
  }
}

class _StageBanner extends StatelessWidget {
  const _StageBanner({required this.order});

  final CourierOrder order;

  @override
  Widget build(BuildContext context) {
    final (color, icon, text) = switch (order.stage) {
      DeliveryStage.kitchen => (AppColors.kitchen, Icons.soup_kitchen, 'Mutfakta hazırlanıyor'),
      DeliveryStage.ready => (AppColors.ready, Icons.shopping_bag, 'Hazır · Restorandan alın'),
      DeliveryStage.onTheWay => (AppColors.onTheWay, Icons.route, 'Yolda'),
    };
    final elapsed = order.stage == DeliveryStage.onTheWay
        ? formatMinutes(order.minutesOnTheWay)
        : formatMinutes(order.minutesSinceCreated);

    return Container(
      color: color,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: DefaultTextStyle(
        style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
        child: Row(
          children: [
            Icon(icon, color: Colors.white, size: 17),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
            const Icon(Icons.schedule, color: Colors.white, size: 15),
            const SizedBox(width: 4),
            Text(elapsed),
          ],
        ),
      ),
    );
  }
}

class _ContactButton extends StatelessWidget {
  const _ContactButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.background,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final Color background;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return OutlinedButton.icon(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        backgroundColor: enabled ? background : AppColors.surfaceHigh,
        side: BorderSide(color: enabled ? color.withValues(alpha: 0.3) : AppColors.border),
      ),
      icon: Icon(icon, size: 18),
      label: Text(label),
    );
  }
}

class _PaymentBox extends StatelessWidget {
  const _PaymentBox({required this.order});

  final CourierOrder order;

  @override
  Widget build(BuildContext context) {
    if (!order.hasPaymentToCollect) {
      return _box(
        background: const Color(0x1F2FD67B),
        border: const Color(0x592FD67B),
        color: AppColors.ready,
        children: [
          const Row(children: [
            Icon(Icons.check_circle, size: 17, color: AppColors.ready),
            SizedBox(width: 6),
            Text('Ödendi · Tahsilat yok', style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.ready)),
          ]),
          const SizedBox(height: 2),
          Text('${order.paymentPlanLabel} · ${formatMoney(order.orderValue)}',
              style: const TextStyle(fontSize: 13, color: AppColors.ready)),
        ],
      );
    }

    const color = AppColors.kitchen;
    final changeFor = order.changeFor;
    return _box(
      background: const Color(0x1FF5A524),
      border: const Color(0x59F5A524),
      color: color,
      children: [
        Row(children: [
          Icon(order.paymentPlan == 'KapidaKart' ? Icons.credit_card : Icons.payments, size: 17, color: color),
          const SizedBox(width: 6),
          Expanded(
            child: Text('Tahsil edilecek · ${order.paymentPlanLabel}',
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: color)),
          ),
        ]),
        Text(formatMoney(order.dueAmount),
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: color, height: 1.2)),
        if (changeFor != null)
          Text(
            'Müşteri ${formatMoney(changeFor)} verecek → para üstü ${formatMoney(changeFor - order.dueAmount)}',
            style: const TextStyle(fontSize: 13, color: color),
          ),
      ],
    );
  }

  Widget _box({required Color background, required Color border, required Color color, required List<Widget> children}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
    );
  }
}
