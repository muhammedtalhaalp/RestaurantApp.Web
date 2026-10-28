/// Türkçe para biçimi: 1234.5 -> "1.234,50 ₺"
String formatMoney(num value) {
  final negative = value < 0;
  final parts = value.abs().toStringAsFixed(2).split('.');
  final digits = parts[0];

  final grouped = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) grouped.write('.');
    grouped.write(digits[i]);
  }
  return '${negative ? '-' : ''}$grouped,${parts[1]} ₺';
}

/// Geçen süre: 45 -> "45 dk", 135 -> "2 sa 15 dk", 3000 -> "2 gün"
String formatMinutes(int? minutes) {
  if (minutes == null) return '';
  if (minutes >= 1440) return '${minutes ~/ 1440} gün';
  if (minutes >= 60) return '${minutes ~/ 60} sa ${minutes % 60} dk';
  return '$minutes dk';
}

/// Ad soyadın baş harfleri: "Ahmet Yılmaz" -> "AY"
String initials(String fullName) {
  final words = fullName.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return '?';
  final first = String.fromCharCode(words.first.runes.first);
  final last = words.length > 1 ? String.fromCharCode(words.last.runes.first) : '';
  return (first + last).toUpperCase();
}
