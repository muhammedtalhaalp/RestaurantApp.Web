import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../core/api_client.dart';
import '../core/session.dart';

/// Firebase bildirimleri.
///
/// - Sunucu (Helpers/PushNotifier) bildirimleri "deliveries" kanalına gönderir: kurye atandı, sipariş hazır,
///   teslimat başka kuryeye verildi, iptal edildi.
/// - Uygulama kapalı / arka plandayken bildirimi Android kendisi gösterir. Uygulama açıkken Android göstermez;
///   o durumda bildirim burada yerel olarak gösterilir ve [messages] akışıyla ekrana haber verilir.
/// - Telefonun bildirim kimliği girişte sunucuya kaydedilir, çıkışta silinir.
///
/// Kimlik, FCM'in yeni yöntemiyle alınan Firebase Installation ID'dir (FID): `register()` çağrılır, FID
/// [FirebaseMessaging.onRegistered] ile gelir. Klasik `getToken()` yeni Firebase projelerinde
/// "FCM Registration failed" hatası veriyor. Sunucu (PushNotifier) da mesajı `fid` alanıyla hedefler.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  static const _channel = AndroidNotificationChannel(
    'deliveries',
    'Teslimatlar',
    description: 'Yeni atanan, hazır olan ve iptal edilen teslimatlar',
    importance: Importance.high,
  );

  final _local = FlutterLocalNotificationsPlugin();
  final _events = StreamController<RemoteMessage>.broadcast();
  bool _ready = false;

  /// Bu telefonun son bilinen FID'si (çıkışta sunucudan silmek için).
  String? _fid;

  /// Uygulama açıkken gelen ya da dokunularak açılan bildirimler (liste yenilensin diye).
  Stream<RemoteMessage> get messages => _events.stream;

  /// Bildirimler başlatılamazsa (ör. Firebase ayarı yok) uygulama bildirimsiz çalışmaya devam eder.
  Future<void> init() async {
    try {
      await Firebase.initializeApp();
      await _local.initialize(
        settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
      );
      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);

      FirebaseMessaging.onMessage.listen(_showWhileOpen);
      FirebaseMessaging.onMessageOpenedApp.listen(_events.add);

      // FID her kayıtta / yenilendiğinde gelir; giriş yapılmışsa sunucuya iletilir
      FirebaseMessaging.instance.onRegistered.listen((fid) {
        _fid = fid;
        _sendFid(fid);
      });
      _ready = true;
    } catch (e) {
      debugPrint('Bildirimler başlatılamadı: $e');
    }
  }

  /// Bildirim izni ister (Android 13+) ve telefonu giriş yapan kullanıcı adına sunucuya kaydeder.
  Future<void> registerDevice() async {
    if (!_ready) return;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;

      // Kayıt tamamlanınca FID onRegistered ile gelir (init içinde dinleniyor)
      await FirebaseMessaging.instance.register();
      if (_fid != null) await _sendFid(_fid!);
    } catch (e) {
      debugPrint('Bildirim kaydı yapılamadı: $e');
    }
  }

  /// Çıkışta çağrılır: sunucudaki kayıt silinir ve telefon FCM'den çıkarılır, böylece bu telefona
  /// sunucuya ulaşılamasa bile artık bildirim gitmez.
  Future<void> unregisterDevice() async {
    if (!_ready) return;
    try {
      if (_fid != null && AppSession.instance.isLoggedIn) {
        await AppSession.instance.api.post('/Device/UnregisterToken', {'token': _fid!});
      }
    } catch (e) {
      debugPrint('Bildirim kaydı silinemedi: $e');
    }
    try {
      _fid = null;
      await FirebaseMessaging.instance.unregister();
    } catch (e) {
      debugPrint('Bildirim kimliği silinemedi: $e');
    }
  }

  Future<void> _sendFid(String fid) async {
    if (!AppSession.instance.isLoggedIn) return;
    try {
      await AppSession.instance.api.post('/Device/RegisterToken', {
        'token': fid,
        'platform': 'android',
        'appName': ApiClient.clientAppName,
      });
    } on ApiException catch (e) {
      debugPrint('Bildirim kimliği kaydedilemedi: ${e.message}');
    }
  }

  void _showWhileOpen(RemoteMessage message) {
    final notification = message.notification;
    if (notification != null) {
      _local.show(
        id: DateTime.now().millisecondsSinceEpoch.remainder(1 << 30),
        title: notification.title,
        body: notification.body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id,
            _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high,
            priority: Priority.high,
            icon: '@mipmap/ic_launcher',
          ),
        ),
      );
    }
    _events.add(message);
  }
}
