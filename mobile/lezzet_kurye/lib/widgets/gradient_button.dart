import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Ana eylem düğmesi: marka geçişli, hafif parlayan. [onPressed] null ise pasif görünür.
/// [colors] verilirse (ör. "Teslim Ettim" yeşili) marka geçişi yerine o renkler kullanılır.
class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.onPressed,
    required this.label,
    this.icon,
    this.loading = false,
    this.trailingIcon = false,
    this.colors,
  });

  final VoidCallback? onPressed;
  final String label;
  final IconData? icon;
  final bool loading;
  final bool trailingIcon;
  final List<Color>? colors;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final gradientColors = colors ?? AppColors.brandGradient.colors;

    final iconWidget = icon == null ? null : Icon(icon, size: 20, color: enabled ? Colors.white : AppColors.subtle);
    final content = loading
        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
        : Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (iconWidget != null && !trailingIcon) ...[iconWidget, const SizedBox(width: 10)],
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                    color: enabled ? Colors.white : AppColors.subtle,
                  ),
                ),
              ),
              if (iconWidget != null && trailingIcon) ...[const SizedBox(width: 10), iconWidget],
            ],
          );

    return AnimatedOpacity(
      duration: const Duration(milliseconds: 150),
      opacity: enabled || loading ? 1 : 0.7,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: enabled || loading
              ? LinearGradient(colors: gradientColors, begin: Alignment.topLeft, end: Alignment.bottomRight)
              : null,
          color: enabled || loading ? null : AppColors.surfaceHigh,
          boxShadow: enabled
              ? [BoxShadow(color: gradientColors.first.withValues(alpha: 0.35), blurRadius: 18, offset: const Offset(0, 8))]
              : null,
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: loading ? null : onPressed,
            child: SizedBox(height: 54, child: Center(child: content)),
          ),
        ),
      ),
    );
  }
}
