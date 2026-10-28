import 'package:flutter/material.dart';

/// Sipariş kanalları. Web tarafındaki karşılığı: Library/scripts/delivery-channels.js (ikisi aynı tutulmalı).
class ChannelInfo {
  const ChannelInfo(this.label, this.icon, this.color, [this.logo]);

  final String label;
  final IconData icon;
  final Color color;
  final String? logo;

  static const _channels = {
    'Telefon': ChannelInfo('Telefon', Icons.phone, Color(0xFF4A154B)),
    'GelAl': ChannelInfo('Gel-Al', Icons.shopping_bag, Color(0xFF475569)),
    'Yemeksepeti': ChannelInfo('Yemeksepeti', Icons.restaurant, Color(0xFFEA004B), 'assets/channels/yemeksepeti.png'),
    'Getir': ChannelInfo('Getir', Icons.two_wheeler, Color(0xFF5D3EBC), 'assets/channels/getir.png'),
    'Trendyol': ChannelInfo('Trendyol Yemek', Icons.storefront, Color(0xFFF27A1A), 'assets/channels/trendyol.png'),
    'Diger': ChannelInfo('Diğer', Icons.more_horiz, Color(0xFF0E7490)),
  };

  static ChannelInfo of(String? key) =>
      _channels[key] ?? const ChannelInfo('Paket Servis', Icons.two_wheeler, Color(0xFF4A154B));
}

class ChannelBadge extends StatelessWidget {
  const ChannelBadge({super.key, required this.channel, this.externalOrderNo});

  final String? channel;
  final String? externalOrderNo;

  @override
  Widget build(BuildContext context) {
    final info = ChannelInfo.of(channel);
    final icon = Icon(info.icon, size: 14, color: info.color);
    final hasExternalNo = externalOrderNo != null && externalOrderNo!.isNotEmpty;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Color.alphaBlend(info.color.withValues(alpha: 0.11), Colors.white),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Color.alphaBlend(info.color.withValues(alpha: 0.28), Colors.white)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (info.logo != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: Image.asset(info.logo!, width: 16, height: 16, errorBuilder: (_, _, _) => icon),
            )
          else
            icon,
          const SizedBox(width: 6),
          Text(
            hasExternalNo ? '${info.label} · $externalOrderNo' : info.label,
            style: TextStyle(color: info.color, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
