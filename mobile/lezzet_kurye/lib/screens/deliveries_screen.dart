import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../models/courier_models.dart';
import '../services/courier_service.dart';
import '../services/push_service.dart';
import '../widgets/channel_badge.dart';
import '../widgets/complete_delivery_sheet.dart';
import '../widgets/order_card.dart';
import 'login_screen.dart';
import 'profile_screen.dart';

/// Ana ekran: kuryeye atanmış teslimatlar. Web karşılığı: Views/Courier/Index.cshtml.
class DeliveriesScreen extends StatefulWidget {
  const DeliveriesScreen({super.key});

  @override
  State<DeliveriesScreen> createState() => _DeliveriesScreenState();
}

class _DeliveriesScreenState extends State<DeliveriesScreen> with WidgetsBindingObserver {
  // Değişiklikler bildirimle anında gelir; bildirim kaçarsa diye liste ayrıca belirli aralıklarla yenilenir
  static const _refreshInterval = Duration(seconds: 45);

  final _service = CourierService();
  final _session = AppSession.instance;

  CourierDashboard? _data;
  String? _error;
  bool _loading = true;
  int? _busyOrderId;
  Set<int> _knownOrderIds = {};
  Set<int> _newOrderIds = {};
  Timer? _timer;
  StreamSubscription<Object>? _pushSubscription;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _timer = Timer.periodic(_refreshInterval, (_) => _load(silent: true));
    _pushSubscription = PushService.instance.messages.listen((_) => _load(silent: true));
    PushService.instance.registerDevice();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _pushSubscription?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Uygulamaya geri dönülünce (ör. haritadan) liste hemen güncellensin
    if (state == AppLifecycleState.resumed) _load(silent: true);
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final data = await _service.fetchDashboard();
      if (!mounted) return;

      final ids = data.active.map((o) => o.orderId).toSet();
      final firstLoad = _data == null;
      final added = firstLoad ? <int>{} : ids.difference(_knownOrderIds);
      if (added.isNotEmpty) _announceNewOrders(added);

      setState(() {
        _data = data;
        _error = null;
        _knownOrderIds = ids;
        _newOrderIds = {..._newOrderIds.intersection(ids), ...added};
      });
    } on UnauthorizedException catch (e) {
      _goToLogin(e.message);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted && !silent) setState(() => _loading = false);
    }
  }

  void _announceNewOrders(Set<int> orderIds) {
    HapticFeedback.heavyImpact();
    SystemSound.play(SystemSoundType.alert);
    final text = orderIds.length == 1
        ? 'Yeni teslimat atandı: #${orderIds.first}'
        : '${orderIds.length} yeni teslimat atandı';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), backgroundColor: AppColors.brandBright, duration: const Duration(seconds: 5)),
    );
  }

  Future<void> _goToLogin(String message) async {
    await _session.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => LoginScreen(message: message)),
      (_) => false,
    );
  }

  Future<void> _runAction(int orderId, Future<String> Function() action) async {
    setState(() => _busyOrderId = orderId);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final message = await action();
      messenger.showSnackBar(SnackBar(content: Text(message), backgroundColor: AppColors.ready));
      await _load(silent: true);
    } on UnauthorizedException catch (e) {
      _goToLogin(e.message);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message), backgroundColor: AppColors.danger));
      await _load(silent: true);
    } finally {
      if (mounted) setState(() => _busyOrderId = null);
    }
  }

  Future<void> _outForDelivery(CourierOrder order) {
    return _runAction(order.orderId, () => _service.markOutForDelivery(order.orderId));
  }

  Future<void> _complete(CourierOrder order) async {
    final result = await showCompleteDeliverySheet(context, order);
    if (result == null) return;
    await _runAction(order.orderId, () => _service.completeDelivery(order.orderId, result.paymentMethod));
  }

  Future<void> _openProfile() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen()));
    if (mounted) setState(() {}); // ad değişmiş olabilir
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        titleSpacing: 16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Teslimatlarım', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
            if (_session.fullName.isNotEmpty)
              Text(_session.fullName, style: TextStyle(fontSize: 13, color: AppColors.muted)),
          ],
        ),
        actions: [
          IconButton(tooltip: 'Yenile', onPressed: _load, icon: const Icon(Icons.refresh)),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: _openProfile,
              child: CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.brandBright,
                child: Text(
                  initials(_session.fullName),
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
            ),
          ),
        ],
      ),
      body: _body(),
    ),
    );
  }

  Widget _body() {
    final data = _data;
    if (data == null) {
      if (_loading) return const Center(child: CircularProgressIndicator());
      return _ErrorView(message: _error ?? 'Teslimatlar yüklenemedi.', serverUrl: _session.api.baseUrl, onRetry: _load);
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ...[_ConnectionWarning(message: _error!), const SizedBox(height: 12)],
          _SummaryRow(data: data),
          const SizedBox(height: 20),
          _SectionTitle(icon: Icons.route, title: 'Aktif Teslimatlar', count: data.active.length),
          const SizedBox(height: 10),
          if (data.active.isEmpty)
            const _EmptyActive()
          else
            for (final order in data.active) ...[
              OrderCard(
                key: ValueKey(order.orderId),
                order: order,
                isNew: _newOrderIds.contains(order.orderId),
                isBusy: _busyOrderId == order.orderId,
                onOutForDelivery: () => _outForDelivery(order),
                onComplete: () => _complete(order),
              ),
              const SizedBox(height: 12),
            ],
          const SizedBox(height: 12),
          const _SectionTitle(icon: Icons.history, title: 'Bugün Teslim Ettiklerim'),
          const SizedBox(height: 10),
          _RecentList(orders: data.recent),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.data});

  final CourierDashboard data;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _KpiTile(icon: Icons.inventory_2, color: AppColors.accent, label: 'Aktif', value: '${data.active.length}')),
        const SizedBox(width: 8),
        Expanded(
          child: _KpiTile(
              icon: Icons.check_circle, color: AppColors.ready, label: 'Bugün Teslim', value: '${data.deliveredTodayCount}'),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _KpiTile(
              icon: Icons.account_balance_wallet, color: const Color(0xFFF27A1A), label: 'Elimdeki Nakit', value: formatMoney(data.cashOnHand)),
        ),
      ],
    );
  }
}

class _KpiTile extends StatelessWidget {
  const _KpiTile({required this.icon, required this.color, required this.label, required this.value});

  final IconData icon;
  final Color color;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, color: color, size: 18),
            ),
            const SizedBox(height: 8),
            Text(label, style: const TextStyle(fontSize: 12, color: AppColors.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.text)),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.title, this.count});

  final IconData icon;
  final String title;
  final int? count;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: AppColors.accent, size: 20),
        const SizedBox(width: 8),
        Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.text)),
        if (count != null && count! > 0) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(color: AppColors.brandBright, borderRadius: BorderRadius.circular(999)),
            child: Text('$count', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
          ),
        ],
      ],
    );
  }
}

class _EmptyActive extends StatelessWidget {
  const _EmptyActive();

  @override
  Widget build(BuildContext context) {
    return const Card(
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 32, horizontal: 16),
        child: Column(
          children: [
            Icon(Icons.local_cafe_outlined, size: 40, color: AppColors.subtle),
            SizedBox(height: 10),
            Text('Şu an size atanmış teslimat yok.', style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.muted)),
            SizedBox(height: 2),
            Text('Yeni sipariş atanınca burada görünecek.', style: TextStyle(color: AppColors.subtle, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}

class _RecentList extends StatelessWidget {
  const _RecentList({required this.orders});

  final List<DeliveredOrder> orders;

  @override
  Widget build(BuildContext context) {
    if (orders.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(18),
          child: Text('Bugün henüz teslimat yok.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.muted)),
        ),
      );
    }

    return Card(
      child: Column(
        children: [
          for (var i = 0; i < orders.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.border),
            _recentTile(orders[i]),
          ],
        ],
      ),
    );
  }

  Widget _recentTile(DeliveredOrder order) {
    final channel = ChannelInfo.of(order.channel);
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: channel.color.withValues(alpha: 0.12),
        child: Icon(channel.icon, color: channel.color, size: 20),
      ),
      title: Text('#${order.orderId} · ${order.customerName ?? 'Müşteri'}',
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
      subtitle: Text('${order.completedTime} · ${order.paymentType ?? channel.label}', style: const TextStyle(fontSize: 12)),
      trailing: Text(formatMoney(order.orderValue), style: const TextStyle(fontWeight: FontWeight.w700)),
    );
  }
}

class _ConnectionWarning extends StatelessWidget {
  const _ConnectionWarning({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: const Color(0x1FF5A524), borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          const Icon(Icons.wifi_off, color: AppColors.kitchen, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: const TextStyle(color: AppColors.kitchen, fontSize: 13))),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.serverUrl, required this.onRetry});

  final String message;
  final String serverUrl;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 56, color: AppColors.subtle),
            const SizedBox(height: 14),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15)),
            const SizedBox(height: 6),
            Text('Sunucu: $serverUrl', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            const SizedBox(height: 18),
            SizedBox(
              width: 180,
              child: FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Tekrar Dene')),
            ),
          ],
        ),
      ),
    );
  }
}
