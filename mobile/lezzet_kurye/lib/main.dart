import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/session.dart';
import 'core/theme.dart';
import 'screens/deliveries_screen.dart';
import 'screens/login_screen.dart';
import 'services/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await PushService.instance.init();
  await AppSession.instance.init();
  runApp(const LezzetKuryeApp());
}

class LezzetKuryeApp extends StatelessWidget {
  const LezzetKuryeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LezzetPOS Kurye',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      locale: const Locale('tr', 'TR'),
      supportedLocales: const [Locale('tr', 'TR')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      // Kayıtlı token varsa doğrudan teslimatlar açılır; token geçersizse sunucu 401 döner ve giriş ekranına dönülür
      home: AppSession.instance.isLoggedIn ? const DeliveriesScreen() : const LoginScreen(),
    );
  }
}
