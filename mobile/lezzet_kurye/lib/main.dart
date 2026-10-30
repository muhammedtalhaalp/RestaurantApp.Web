import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/session.dart';
import 'core/theme.dart';
import 'screens/home_for_role.dart';
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
      title: 'LezzetPOS Personel',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      locale: const Locale('tr', 'TR'),
      supportedLocales: const [Locale('tr', 'TR')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      // Kayıtlı oturum varsa role göre ana ekran açılır; token geçersizse sunucu 401 döner ve giriş ekranına dönülür
      home: AppSession.instance.isLoggedIn ? homeForRole() : const LoginScreen(),
    );
  }
}
