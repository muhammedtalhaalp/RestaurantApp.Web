import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/waiter_models.dart';
import '../../services/push_service.dart';
import '../../services/waiter_service.dart';
import 'menu_screen.dart';
import 'waiter_widgets.dart';

/// Masanın açık siparişi: ürünler ve mutfak durumları, hazırları servis etme, yeni sipariş ekleme.
class TableDetailScreen extends StatefulWidget {
  const TableDetailScreen({super.key, required this.table});

  final TableInfo table;

  @override
  State<TableDetailScreen> createState() => _TableDetailScreenState();
}

class _TableDetailScreenState extends State<TableDetailScreen> {
  final _service = WaiterService();

  TableOrder? _order;
  String? _error;
  bool _serving = false;
  StreamSubscription<Object>? _pushSubscription;

  @override
  void initState() {
    super.initState();
    _load();
    // Mutfak bu masanın ürününü hazır yaparsa ekran hemen güncellensin
    _pushSubscription = PushService.instance.messages.listen((_) => _load());
  }

  @override
  void dispose() {
    _pushSubscription?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final order = await _service.fetchTableOrder(widget.table.tableId);
      if (!mounted) return;
      setState(() {
        _order = order;
        _error = null;
      });
    } on UnauthorizedException catch (e) {
      if (mounted) goToLogin(context, e.message);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _addOrder() async {
    final sent = await Navigator.of(context)
        .push<String>(MaterialPageRoute(builder: (_) => MenuScreen(table: widget.table)));
    if (sent != null && mounted) {
      showMessage(context, sent, success: true);
      _load();
    }
  }

  Future<void> _serveReady() async {
    final orderIds = _order?.ordersWithReadyItems ?? {};
    if (orderIds.isEmpty) return;
    setState(() => _serving = true);
    try {
      for (final id in orderIds) {
        await _service.markServed(id);
      }
      if (mounted) showMessage(context, 'Hazır ürünler servis edildi olarak işaretlendi.', success: true);
      await _load();
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
    final order = _order;
    final readyCount = order?.items.where((i) => i.status == ItemStatus.ready).fold<int>(0, (s, i) => s + i.quantity) ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.table.name, style: const TextStyle(fontWeight: FontWeight.w700)),
          Text(widget.table.section, style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.8))),
        ]),
        actions: [IconButton(tooltip: 'Yenile', onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: order == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(16),
                      child: EmptyCard(
                        icon: Icons.cloud_off,
                        title: _error!,
                        action: OutlinedButton(onPressed: _load, child: const Text('Tekrar Dene')),
                      ),
                    ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                children: [
                  if (order.items.isEmpty)
                    const EmptyCard(
                      icon: Icons.event_seat,
                      title: 'Bu masada açık sipariş yok.',
                      subtitle: 'Aşağıdaki "Sipariş Al" ile ilk siparişi oluşturun.',
                    )
                  else ...[
                    _summaryCard(order),
                    if (readyCount > 0) ...[
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed: _serving ? null : _serveReady,
                        style: FilledButton.styleFrom(backgroundColor: AppColors.ready),
                        icon: _serving
                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.room_service),
                        label: Text('Hazır $readyCount ürünü servis ettim'),
                      ),
                    ],
                    const SizedBox(height: 16),
                    const Text('Masadaki Ürünler', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: 8),
                    Card(
                      child: Column(children: [
                        for (var i = 0; i < order.items.length; i++) ...[
                          if (i > 0) const Divider(height: 1, color: AppColors.border),
                          _itemTile(order.items[i]),
                        ],
                      ]),
                    ),
                  ],
                ],
              ),
            ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      floatingActionButton: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: _addOrder,
            icon: const Icon(Icons.add_shopping_cart),
            label: Text(order != null && order.items.isNotEmpty ? 'Sipariş Ekle' : 'Sipariş Al'),
          ),
        ),
      ),
    );
  }

  Widget _summaryCard(TableOrder order) {
    final count = order.items.fold<int>(0, (s, i) => s + i.quantity);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Kalan Tutar', style: TextStyle(color: AppColors.muted, fontSize: 13)),
              Text(formatMoney(order.remainingTotal),
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.brand)),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('$count ürün', style: const TextStyle(fontWeight: FontWeight.w600)),
            const Text('Ödeme kasada alınır', style: TextStyle(color: AppColors.muted, fontSize: 12)),
          ]),
        ]),
      ),
    );
  }

  Widget _itemTile(TableOrderItem item) {
    return ListTile(
      title: Text('${item.quantity}× ${item.name}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Align(alignment: Alignment.centerLeft, child: ItemStatusChip(status: item.status)),
      ),
      trailing: Text(formatMoney(item.total), style: const TextStyle(fontWeight: FontWeight.w600)),
    );
  }
}
