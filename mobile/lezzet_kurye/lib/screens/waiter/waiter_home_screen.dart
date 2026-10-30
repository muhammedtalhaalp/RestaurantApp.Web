import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../models/waiter_models.dart';
import '../../services/push_service.dart';
import '../../services/waiter_service.dart';
import '../profile_screen.dart';
import 'ready_orders_tab.dart';
import 'table_detail_screen.dart';
import 'tables_tab.dart';
import 'waiter_widgets.dart';

/// Garsonun ana ekranı: Masalar ve Hazır Siparişler sekmeleri. Web karşılığı: POS masa seçimi ve "Sipariş Takip".
class WaiterHomeScreen extends StatefulWidget {
  const WaiterHomeScreen({super.key});

  @override
  State<WaiterHomeScreen> createState() => _WaiterHomeScreenState();
}

class _WaiterHomeScreenState extends State<WaiterHomeScreen> with WidgetsBindingObserver {
  // Değişiklikler (mutfak "hazır") bildirimle anında gelir; masalar başka garsonlar yüzünden de değiştiği için
  // liste ayrıca belirli aralıklarla yenilenir
  static const _refreshInterval = Duration(seconds: 30);

  final _service = WaiterService();
  final _session = AppSession.instance;

  int _tab = 0;
  List<TableInfo>? _tables;
  List<PendingOrder>? _pending;
  String? _error;
  Timer? _timer;
  StreamSubscription<Object>? _pushSubscription;

  int get _readyCount => _pending?.where((o) => o.hasReadyItems).length ?? 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _timer = Timer.periodic(_refreshInterval, (_) => _load());
    _pushSubscription = PushService.instance.messages.listen((_) {
      HapticFeedback.heavyImpact();
      _load();
    });
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
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_service.fetchTables(), _service.fetchPendingOrders()]);
      if (!mounted) return;
      setState(() {
        _tables = results[0] as List<TableInfo>;
        _pending = results[1] as List<PendingOrder>;
        _error = null;
      });
    } on UnauthorizedException catch (e) {
      if (mounted) goToLogin(context, e.message);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _openTable(TableInfo table) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TableDetailScreen(table: table)));
    _load();
  }

  Future<void> _openProfile() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen()));
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_tab == 0 ? 'Masalar' : 'Hazır Siparişler',
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
            if (_session.fullName.isNotEmpty)
              Text(_session.fullName, style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.8))),
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
                backgroundColor: Colors.white,
                child: Text(initials(_session.fullName),
                    style: const TextStyle(color: AppColors.brand, fontWeight: FontWeight.w700, fontSize: 13)),
              ),
            ),
          ),
        ],
      ),
      body: IndexedStack(
        index: _tab,
        children: [
          TablesTab(tables: _tables, error: _error, onRefresh: _load, onOpenTable: _openTable),
          ReadyOrdersTab(orders: _pending, error: _error, onRefresh: _load),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        indicatorColor: AppColors.brandSoft,
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.table_restaurant_outlined),
            selectedIcon: Icon(Icons.table_restaurant, color: AppColors.brand),
            label: 'Masalar',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: _readyCount > 0,
              label: Text('$_readyCount'),
              backgroundColor: AppColors.ready,
              child: const Icon(Icons.room_service_outlined),
            ),
            selectedIcon: Badge(
              isLabelVisible: _readyCount > 0,
              label: Text('$_readyCount'),
              backgroundColor: AppColors.ready,
              child: const Icon(Icons.room_service, color: AppColors.brand),
            ),
            label: 'Hazır Siparişler',
          ),
        ],
      ),
    );
  }
}
