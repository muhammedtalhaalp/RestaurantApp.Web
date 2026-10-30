import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../services/push_service.dart';
import 'api_client.dart';

/// Giriş yapan kullanıcının profil bilgileri (`/Auth/GetUserProfile`).
class UserProfile {
  UserProfile({required this.fullName, required this.email, required this.role, this.companyName});

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        fullName: json['fullName'] as String? ?? '',
        email: json['email'] as String? ?? '',
        role: json['role'] as String? ?? '',
        companyName: json['companyName'] as String?,
      );

  final String fullName;
  final String email;
  final String role;
  final String? companyName;
}

/// Uygulama genelindeki oturum: sunucu adresi, token ve giriş yapan personel (kurye ya da garson).
/// Token ve sunucu adresi telefonun şifreli deposunda saklanır.
class AppSession {
  AppSession._();
  static final AppSession instance = AppSession._();

  static const courierRole = 'Kurye';
  static const waiterRole = 'Garson';

  /// Mobil uygulamayı kullanabilen roller; giriş sonrası açılan ekran role göre seçilir (bkz. main.dart).
  static const mobileRoles = {courierRole, waiterRole};

  /// Geliştirme: telefon USB ile bağlıyken `adb reverse tcp:50693 tcp:50693` komutu, telefondaki
  /// localhost:50693'ü bilgisayardaki IIS Express'e (Visual Studio) yönlendirir.
  static const defaultBaseUrl = 'http://localhost:50693';

  static const _tokenKey = 'jwt_token';
  static const _nameKey = 'full_name';
  static const _roleKey = 'role';
  static const _baseUrlKey = 'base_url';

  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  final ApiClient api = ApiClient(baseUrl: defaultBaseUrl);

  String fullName = '';
  String? role;

  bool get isLoggedIn => api.token != null && role != null;
  bool get isWaiter => role == waiterRole;

  Future<void> init() async {
    api.baseUrl = await _storage.read(key: _baseUrlKey) ?? defaultBaseUrl;
    api.token = await _storage.read(key: _tokenKey);
    fullName = await _storage.read(key: _nameKey) ?? '';
    role = await _storage.read(key: _roleKey);
    // Eski sürümde (yalnızca kurye) rol saklanmıyordu: kayıtlı oturum kurye oturumudur
    if (api.token != null && role == null) {
      role = courierRole;
      await _storage.write(key: _roleKey, value: role);
    }
  }

  Future<void> setBaseUrl(String url) async {
    api.baseUrl = url.trim();
    await _storage.write(key: _baseUrlKey, value: api.baseUrl);
  }

  Future<void> login(String email, String password) async {
    api.clearSession();
    final res = await api.post('/Auth/ApiLogin', {'Username': email.trim(), 'Password': password});

    if (!mobileRoles.contains(res['role'])) {
      api.clearSession();
      throw ApiException('Bu uygulama garson ve kurye hesapları içindir. Diğer roller web panelini kullanır.');
    }

    api.token = res['token'] as String;
    fullName = res['fullName'] as String? ?? '';
    role = res['role'] as String;
    await _storage.write(key: _tokenKey, value: api.token);
    await _storage.write(key: _nameKey, value: fullName);
    await _storage.write(key: _roleKey, value: role);
  }

  Future<void> logout() async {
    // Token hâlâ geçerliyken sunucudaki bildirim kaydı silinsin
    await PushService.instance.unregisterDevice();
    api.clearSession();
    fullName = '';
    role = null;
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _nameKey);
    await _storage.delete(key: _roleKey);
  }

  Future<UserProfile> fetchProfile() async {
    final res = await api.get('/Auth/GetUserProfile');
    final profile = UserProfile.fromJson(res['data'] as Map<String, dynamic>);
    await _rememberName(profile.fullName);
    return profile;
  }

  Future<String> updateProfile(String fullName, String email) async {
    final res = await api.post('/Auth/UpdateUserProfile', {'FullName': fullName.trim(), 'Email': email.trim()});
    await _rememberName(res['fullName'] as String? ?? fullName.trim());
    return res['message'] as String? ?? 'Profil güncellendi.';
  }

  /// Şifre değişikliği üç adımdır: kod e-postaya gider, kod doğrulanır, yeni şifre kaydedilir.
  Future<String> sendPasswordCode() async {
    final res = await api.post('/Auth/SendPasswordResetCode');
    return res['message'] as String? ?? 'Doğrulama kodu gönderildi.';
  }

  Future<String> changePassword(String code, String newPassword) async {
    await api.post('/Auth/VerifyOtpCode', {'code': code.trim()});
    final res = await api.post('/Auth/ConfirmNewPassword', {'newPassword': newPassword});
    return res['message'] as String? ?? 'Şifreniz güncellendi.';
  }

  Future<void> _rememberName(String name) async {
    fullName = name;
    await _storage.write(key: _nameKey, value: name);
  }
}
