import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../models/waiter_models.dart';
import '../../services/waiter_service.dart';
import 'waiter_widgets.dart';

/// Menüden sipariş alma: kategori / arama, sepet, not ve "acil". "Mutfağa Gönder" siparişi masanın açık
/// siparişine ekler ve mutfak ekranına düşürür. Başarılıysa sunucunun mesajıyla geri döner.
class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key, required this.table});

  final TableInfo table;

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  final _service = WaiterService();
  final _search = TextEditingController();
  final Map<int, CartLine> _cart = {};

  List<MenuCategory>? _categories;
  List<MenuProduct> _products = [];
  String? _error;
  int? _categoryId;

  int get _cartCount => _cart.values.fold(0, (s, l) => s + l.quantity);
  double get _cartTotal => _cart.values.fold(0, (s, l) => s + l.total);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final (categories, products) = await _service.fetchMenu();
      if (!mounted) return;
      setState(() {
        _categories = categories;
        _products = products;
      });
    } on UnauthorizedException catch (e) {
      if (mounted) goToLogin(context, e.message);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _changeQuantity(MenuProduct product, int delta) {
    setState(() {
      final line = _cart.putIfAbsent(product.productId, () => CartLine(product, 0));
      line.quantity += delta;
      if (line.quantity <= 0) _cart.remove(product.productId);
    });
  }

  List<MenuProduct> get _visibleProducts {
    final query = _search.text.trim().toLowerCase();
    return _products.where((p) {
      if (query.isNotEmpty) return p.name.toLowerCase().contains(query);
      return _categoryId == null || p.categoryId == _categoryId;
    }).toList();
  }

  Future<void> _openCart() async {
    final message = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => _CartSheet(
        table: widget.table,
        cart: _cart,
        service: _service,
        onChanged: () => setState(() {}),
      ),
    );
    if (message != null && mounted) Navigator.of(context).pop(message);
  }

  @override
  Widget build(BuildContext context) {
    final categories = _categories;

    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Sipariş Al', style: TextStyle(fontWeight: FontWeight.w700)),
          Text(widget.table.name, style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.8))),
        ]),
      ),
      body: categories == null
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
          : Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: TextField(
                  controller: _search,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: 'Ürün ara',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () => setState(() => _search.clear()),
                          ),
                  ),
                ),
              ),
              SizedBox(
                height: 44,
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  scrollDirection: Axis.horizontal,
                  children: [
                    _categoryChip(null, 'Tümü'),
                    for (final c in categories) _categoryChip(c.categoryId, c.name),
                  ],
                ),
              ),
              Expanded(child: _productList()),
            ]),
      bottomNavigationBar: _cartCount == 0
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: FilledButton(
                  onPressed: _openCart,
                  child: Row(children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(999)),
                      child: Text('$_cartCount'),
                    ),
                    const SizedBox(width: 12),
                    const Text('Sepeti Gör'),
                    const Spacer(),
                    Text(formatMoney(_cartTotal)),
                  ]),
                ),
              ),
            ),
    );
  }

  Widget _categoryChip(int? categoryId, String label) {
    final selected = _categoryId == categoryId && _search.text.isEmpty;
    return Padding(
      padding: const EdgeInsets.only(right: 8, top: 4, bottom: 4),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        selectedColor: AppColors.brand,
        labelStyle: TextStyle(color: selected ? Colors.white : AppColors.text, fontWeight: FontWeight.w600),
        onSelected: (_) => setState(() {
          _categoryId = categoryId;
          _search.clear();
        }),
      ),
    );
  }

  Widget _productList() {
    final products = _visibleProducts;
    if (products.isEmpty) {
      return ListView(padding: const EdgeInsets.all(16), children: const [
        EmptyCard(icon: Icons.search_off, title: 'Ürün bulunamadı.'),
      ]);
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      itemCount: products.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (_, i) {
        final product = products[i];
        return _ProductTile(
          product: product,
          quantity: _cart[product.productId]?.quantity ?? 0,
          onAdd: () => _changeQuantity(product, 1),
          onRemove: () => _changeQuantity(product, -1),
        );
      },
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.product, required this.quantity, required this.onAdd, required this.onRemove});

  final MenuProduct product;
  final int quantity;
  final VoidCallback onAdd;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final imageUrl = product.imageUrl;
    final placeholder = Container(
      color: AppColors.brandSoft,
      child: const Icon(Icons.restaurant, color: AppColors.brand),
    );

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: quantity > 0 ? AppColors.brand : AppColors.border, width: quantity > 0 ? 1.6 : 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 58,
              height: 58,
              child: imageUrl == null || imageUrl.isEmpty
                  ? placeholder
                  : Image.network(
                      '${AppSession.instance.api.baseUrl}$imageUrl',
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => placeholder,
                    ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(product.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
              const SizedBox(height: 2),
              product.isAvailable
                  ? Text(formatMoney(product.price),
                      style: const TextStyle(color: AppColors.brand, fontWeight: FontWeight.w700))
                  : const Text('Tükendi', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600)),
            ]),
          ),
          if (product.isAvailable)
            quantity == 0
                ? IconButton.filled(
                    onPressed: onAdd,
                    style: IconButton.styleFrom(backgroundColor: AppColors.brand),
                    icon: const Icon(Icons.add),
                  )
                : QuantityStepper(quantity: quantity, onAdd: onAdd, onRemove: onRemove),
        ]),
      ),
    );
  }
}

class QuantityStepper extends StatelessWidget {
  const QuantityStepper({super.key, required this.quantity, required this.onAdd, required this.onRemove});

  final int quantity;
  final VoidCallback onAdd;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton(
          visualDensity: VisualDensity.compact,
          onPressed: onRemove,
          icon: Icon(quantity == 1 ? Icons.delete_outline : Icons.remove, color: AppColors.brand),
        ),
        Text('$quantity', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        IconButton(
          visualDensity: VisualDensity.compact,
          onPressed: onAdd,
          icon: const Icon(Icons.add, color: AppColors.brand),
        ),
      ]),
    );
  }
}

/// Sepet: adetleri düzenleme, sipariş notu, "acil" ve mutfağa gönderme.
class _CartSheet extends StatefulWidget {
  const _CartSheet({required this.table, required this.cart, required this.service, required this.onChanged});

  final TableInfo table;
  final Map<int, CartLine> cart;
  final WaiterService service;
  final VoidCallback onChanged;

  @override
  State<_CartSheet> createState() => _CartSheetState();
}

class _CartSheetState extends State<_CartSheet> {
  final _note = TextEditingController();
  bool _priority = false;
  bool _sending = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _change(CartLine line, int delta) {
    setState(() {
      line.quantity += delta;
      if (line.quantity <= 0) widget.cart.remove(line.product.productId);
    });
    widget.onChanged();
    if (widget.cart.isEmpty) Navigator.of(context).pop();
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      final message = await widget.service.sendOrder(
        tableId: widget.table.tableId,
        lines: widget.cart.values.toList(),
        note: _note.text,
        isPriority: _priority,
      );
      if (mounted) Navigator.of(context).pop(message);
    } on UnauthorizedException catch (e) {
      if (mounted) goToLogin(context, e.message);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lines = widget.cart.values.toList();
    final total = lines.fold<double>(0, (s, l) => s + l.total);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.85),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            children: [
              Text('${widget.table.name} · Sepet', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              for (final line in lines)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(line.product.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(formatMoney(line.total), style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                      ]),
                    ),
                    QuantityStepper(
                      quantity: line.quantity,
                      onAdd: () => _change(line, 1),
                      onRemove: () => _change(line, -1),
                    ),
                  ]),
                ),
              const Divider(height: 24),
              TextField(
                controller: _note,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Mutfağa not (isteğe bağlı)',
                  hintText: 'Örn: Biri acısız olsun',
                  prefixIcon: Icon(Icons.sticky_note_2_outlined),
                ),
              ),
              const SizedBox(height: 4),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _priority,
                onChanged: (v) => setState(() => _priority = v),
                activeThumbColor: AppColors.danger,
                title: const Text('Acil sipariş', style: TextStyle(fontWeight: FontWeight.w600)),
                subtitle: const Text('Mutfak ekranında öne alınır'),
                secondary: const Icon(Icons.local_fire_department, color: AppColors.danger),
              ),
              const SizedBox(height: 8),
              Row(children: [
                const Text('Toplam', style: TextStyle(color: AppColors.muted)),
                const Spacer(),
                Text(formatMoney(total), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              ]),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: _sending ? null : _send,
                icon: _sending
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.soup_kitchen),
                label: const Text('Mutfağa Gönder'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
