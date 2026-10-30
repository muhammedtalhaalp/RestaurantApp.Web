import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/courier_models.dart';
import 'gradient_button.dart';

/// "Teslim Ettim" onayı. Kapıda ödemeli siparişte tahsilat şekli (Nakit / Kart) seçilir.
class CompleteDeliveryResult {
  const CompleteDeliveryResult(this.paymentMethod);

  /// "Nakit", "Kart" ya da tahsilat yoksa null.
  final String? paymentMethod;
}

Future<CompleteDeliveryResult?> showCompleteDeliverySheet(BuildContext context, CourierOrder order) {
  return showModalBottomSheet<CompleteDeliveryResult>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _CompleteDeliverySheet(order: order),
  );
}

class _CompleteDeliverySheet extends StatefulWidget {
  const _CompleteDeliverySheet({required this.order});

  final CourierOrder order;

  @override
  State<_CompleteDeliverySheet> createState() => _CompleteDeliverySheetState();
}

class _CompleteDeliverySheetState extends State<_CompleteDeliverySheet> {
  late String _method = widget.order.paymentPlan == 'KapidaKart' ? 'Kart' : 'Nakit';

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    final collect = order.hasPaymentToCollect;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Teslimatı Tamamla', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text('#${order.orderId} · ${order.customerName ?? 'Müşteri'}', style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 18),
            if (collect) ...[
              const Text('Tahsil edilecek tutar', textAlign: TextAlign.center, style: TextStyle(color: AppColors.muted)),
              Text(formatMoney(order.dueAmount),
                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800)),
              if (order.changeFor != null)
                Container(
                  margin: const EdgeInsets.only(top: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: const Color(0x1FF5A524), borderRadius: BorderRadius.circular(10)),
                  child: Text(
                    'Para üstü: ${formatMoney(order.changeFor! - order.dueAmount)}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.kitchen),
                  ),
                ),
              const SizedBox(height: 18),
              const Text('Ödeme nasıl alındı?', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: _methodOption('Nakit', Icons.payments)),
                  const SizedBox(width: 10),
                  Expanded(child: _methodOption('Kart', Icons.credit_card)),
                ],
              ),
            ] else
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: const Color(0x1F2FD67B), borderRadius: BorderRadius.circular(12)),
                child: Text(
                  'Bu siparişin ödemesi alınmış (${order.paymentPlanLabel}). Müşteriden para almayın.',
                  style: const TextStyle(color: AppColors.ready, fontWeight: FontWeight.w600),
                ),
              ),
            const SizedBox(height: 20),
            GradientButton(
              colors: const [Color(0xFF34E089), Color(0xFF13A456)],
              onPressed: () => Navigator.pop(context, CompleteDeliveryResult(collect ? _method : null)),
              icon: Icons.check_circle,
              label: collect ? '$_method ile Tahsil Ettim, Teslim Et' : 'Teslim Ettim',
            ),
            const SizedBox(height: 6),
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Vazgeç')),
          ],
        ),
      ),
    );
  }

  Widget _methodOption(String method, IconData icon) {
    final selected = _method == method;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => setState(() => _method = method),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: selected ? AppColors.tint(AppColors.accent, 0.12) : AppColors.surfaceHigh,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: selected ? AppColors.accent : AppColors.border, width: 2),
        ),
        child: Column(
          children: [
            Icon(icon, size: 28, color: selected ? AppColors.accent : AppColors.subtle),
            const SizedBox(height: 6),
            Text(method,
                style: TextStyle(fontWeight: FontWeight.w600, color: selected ? AppColors.accent : AppColors.text)),
          ],
        ),
      ),
    );
  }
}
