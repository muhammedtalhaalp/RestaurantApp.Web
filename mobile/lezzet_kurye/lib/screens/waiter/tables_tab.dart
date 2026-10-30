import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/waiter_models.dart';
import 'waiter_widgets.dart';

/// Masa planı: bölüme (Salon, Bahçe...) göre süzülen masa kartları. Web karşılığı: POS'taki masa seçimi.
class TablesTab extends StatefulWidget {
  const TablesTab({
    super.key,
    required this.tables,
    required this.error,
    required this.onRefresh,
    required this.onOpenTable,
  });

  final List<TableInfo>? tables;
  final String? error;
  final Future<void> Function() onRefresh;
  final void Function(TableInfo table) onOpenTable;

  @override
  State<TablesTab> createState() => _TablesTabState();
}

class _TablesTabState extends State<TablesTab> {
  static const _all = 'Hepsi';
  String _section = _all;

  @override
  Widget build(BuildContext context) {
    final tables = widget.tables;
    if (tables == null) {
      return widget.error == null
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16),
              child: EmptyCard(
                icon: Icons.cloud_off,
                title: widget.error!,
                action: OutlinedButton(onPressed: widget.onRefresh, child: const Text('Tekrar Dene')),
              ),
            );
    }

    final sections = [_all, ...{for (final t in tables) t.section}];
    if (!sections.contains(_section)) _section = _all;
    final visible = _section == _all ? tables : tables.where((t) => t.section == _section).toList();
    final occupied = tables.where((t) => t.isOccupied).length;

    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(children: [
            Expanded(child: _countTile('Dolu', occupied, AppColors.accent, Icons.people)),
            const SizedBox(width: 8),
            Expanded(child: _countTile('Boş', tables.length - occupied, AppColors.ready, Icons.event_seat)),
          ]),
          const SizedBox(height: 14),
          SizedBox(
            height: 38,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final section in sections)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(section),
                      selected: _section == section,
                      onSelected: (_) => setState(() => _section = section),
                      selectedColor: AppColors.brandBright,
                      labelStyle: TextStyle(
                        color: _section == section ? Colors.white : AppColors.text,
                        fontWeight: FontWeight.w600,
                      ),
                      showCheckmark: false,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (visible.isEmpty)
            const EmptyCard(icon: Icons.table_restaurant, title: 'Bu bölümde masa bulunmuyor.')
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 180,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.05,
              ),
              itemCount: visible.length,
              itemBuilder: (_, i) => _TableCard(table: visible[i], onTap: () => widget.onOpenTable(visible[i])),
            ),
        ],
      ),
    );
  }

  Widget _countTile(String label, int count, Color color, IconData icon) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 10),
          Text('$count', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(color: AppColors.muted)),
        ]),
      ),
    );
  }
}

class _TableCard extends StatelessWidget {
  const _TableCard({required this.table, required this.onTap});

  final TableInfo table;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final occupied = table.isOccupied;
    final color = occupied ? AppColors.accent : AppColors.ready;

    return Material(
      color: occupied ? AppColors.tint(AppColors.accent, 0.10) : AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: occupied ? AppColors.accent.withValues(alpha: 0.35) : AppColors.border, width: 1.4),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(
                  child: Text(table.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.text)),
                ),
                if (table.isPriority) const Icon(Icons.local_fire_department, color: AppColors.danger, size: 18),
              ]),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: Text(occupied ? 'Dolu' : 'Boş',
                    style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12)),
              ),
              const Spacer(),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: occupied
                        ? FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(formatMoney(table.remainingAmount),
                                style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.accent)),
                          )
                        : Text(table.section, style: const TextStyle(color: AppColors.muted, fontSize: 12)),
                  ),
                  Icon(occupied ? Icons.people : Icons.event_seat, color: color.withValues(alpha: 0.5), size: 22),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
