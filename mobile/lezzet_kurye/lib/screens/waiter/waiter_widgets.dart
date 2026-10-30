import 'package:flutter/material.dart';

import '../../core/session.dart';
import '../../core/theme.dart';
import '../../models/waiter_models.dart';
import '../login_screen.dart';

/// Oturum düştüğünde (401) giriş ekranına döner.
Future<void> goToLogin(BuildContext context, String? message) async {
  await AppSession.instance.logout();
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => LoginScreen(message: message)),
    (_) => false,
  );
}

void showMessage(BuildContext context, String message, {bool success = false}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: success ? AppColors.ready : AppColors.danger),
  );
}

/// Ürünün mutfak durumu rozeti (web'deki garson ekranıyla aynı renkler).
class ItemStatusChip extends StatelessWidget {
  const ItemStatusChip({super.key, required this.status});

  final ItemStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, icon) = switch (status) {
      ItemStatus.preparing => (AppColors.kitchen, Icons.soup_kitchen),
      ItemStatus.ready => (AppColors.ready, Icons.notifications_active),
      ItemStatus.served => (AppColors.muted, Icons.check),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 4),
        Text(status.label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
      ]),
    );
  }
}

/// Liste boşken ya da yüklenemediğinde gösterilen kart.
class EmptyCard extends StatelessWidget {
  const EmptyCard({super.key, required this.icon, required this.title, this.subtitle, this.action});

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
        child: Column(children: [
          Icon(icon, size: 40, color: AppColors.subtle),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.muted)),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(subtitle!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.subtle, fontSize: 13)),
          ],
          if (action != null) ...[const SizedBox(height: 14), action!],
        ]),
      ),
    );
  }
}
