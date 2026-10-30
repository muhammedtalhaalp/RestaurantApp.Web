import 'package:flutter/widgets.dart';

import '../core/session.dart';
import 'deliveries_screen.dart';
import 'waiter/waiter_home_screen.dart';

/// Girişten sonra açılan ana ekran: garson masaları, kurye teslimatları görür.
Widget homeForRole() {
  return AppSession.instance.isWaiter ? const WaiterHomeScreen() : const DeliveriesScreen();
}
