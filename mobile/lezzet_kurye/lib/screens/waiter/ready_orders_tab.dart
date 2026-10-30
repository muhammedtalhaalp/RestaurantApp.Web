import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../models/waiter_models.dart';
import '../../services/waiter_service.dart';
import 'waiter_widgets.dart';

/// Mutfaktaki ve servise hazır masa siparişleri. Web karşılığı: "Sipariş Takip" (waiterOrderTracking.js).
class ReadyOrdersTab extends StatelessWidget {
  const ReadyOrdersTab({super.key, required this.orders, required this.error, required this.onRefresh});

  final List<PendingOrder>? orders;
  final String? error;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final list = orders;
    if (list == null) {
      return error == null
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16),
              child: EmptyCard(
                icon: Icons.cloud_off,
                title: error!,
                action: OutlinedButton(onPressed: onRefresh, child: const Text('Tekrar Dene')),
              ),
            );
    }

    // Hazır ürünü olanlar üstte
    final sorted = [...list]..sort((a, b) => (b.hasReadyItems ? 1 : 0) - (a.hasReadyItems ? 1 : 0));

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (sorted.isEmpty)
            const EmptyCard(
              icon: Icons.room_service_outlined,
              title: 'Bekleyen masa siparişi yok.',
              subtitle: 'Mutfak bir ürünü hazır yapınca burada görünür ve bildirim gelir.',
            )
          else
            for (final order in sorted) ...[
              _OrderTile(order: order, onChanged: onRefresh),
              const SizedBox(height: 10),
            ],
        ],
      ),
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order, required this.onChanged});

  final PendingOrder order;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) {
    final color = order.hasReadyItems ? AppColors.ready : AppColors.kitchen;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: order.hasReadyItems ? AppColors.ready : AppColors.border, width: order.hasReadyItems ? 1.6 : 1),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.12),
          child: Icon(order.hasReadyItems ? Icons.room_service : Icons.soup_kitchen, color: color),
        ),
        title: Text(order.tableName, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('#${order.orderId} · ${order.orderTime}'),
        trailing: ItemStatusChip(status: order.hasReadyItems ? ItemStatus.ready : ItemStatus.preparing),
        onTap: () async {
          final served = await showModalBottomSheet<bool>(
            context: context,
            isScrollControlled: true,
            showDragHandle: true,
            backgroundColor: Colors.white,
            shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
            builder: (_) => _OrderSheet(order: order),
          );
          if (served == true) await onChanged();
        },
      ),
    );
  }
}

class _OrderSheet extends StatefulWidget {
  const _OrderSheet({required this.order});

  final PendingOrder order;

  @override
  State<_OrderSheet> createState() => _OrderSheetState();
}

class _OrderSheetState extends State<_OrderSheet> {
  final _service = WaiterService();
  List<OrderDetailItem>? _items;
  String? _error;
  bool _serving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await _service.fetchOrderItems(widget.order.orderId);
      if (mounted) setState(() => _items = items);
    } on UnauthorizedException catch (e) {
      if (mounted) goToLogin(context, e.message);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _serve() async {
    setState(() => _serving = true);
    try {
      final message = await _service.markServed(widget.order.orderId);
      if (!mounted) return;
      showMessage(context, message, success: true);
      Navigator.of(context).pop(true);
    } on UnauthorizedException catch (e) {
      if (mounted) goToLogin(context, e.message);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _serving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final readyCount =
        items?.where((i) => i.status == ItemStatus.ready).fold<int>(0, (s, i) => s + i.quantity) ?? 0;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.order.tableName, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
            Text('#${widget.order.orderId} · ${widget.order.orderTime}', style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 14),
            if (items == null)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!)),
              )
            else ...[
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.5),
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final item in items)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(children: [
                          Expanded(
                            child: Text('${item.quantity}× ${item.name}',
                                style: const TextStyle(fontWeight: FontWeight.w600)),
                          ),
                          ItemStatusChip(status: item.status),
                        ]),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: readyCount == 0 || _serving ? null : _serve,
                style: FilledButton.styleFrom(backgroundColor: AppColors.ready),
                icon: _serving
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.room_service),
                label: Text(readyCount == 0 ? 'Mutfakta hazırlanıyor' : 'Hazır $readyCount ürünü servis ettim'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
