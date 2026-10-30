import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Sunucunun reddettiği ya da ulaşılamayan istekler. [message] kullanıcıya gösterilebilir.
class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 401: token yok, geçersiz ya da süresi dolmuş. Uygulama giriş ekranına dönmeli.
class UnauthorizedException extends ApiException {
  UnauthorizedException(super.message);
}

/// LezzetPOS sunucusuyla (ASP.NET MVC) konuşan istemci.
///
/// - Token her istekte `Authorization: Bearer` başlığıyla gider.
/// - `X-Client-App` başlığı sayesinde sunucu yetkisiz isteklere sayfa yönlendirmesi yerine 401/403 JSON döner.
/// - POST gövdesi form olarak gönderilir (MVC action parametreleri form alanlarından okunur); iç içe veri
///   bekleyen action'lar (ör. CreateOrder'ın ürün listesi) için [postJson] kullanılır.
/// - Şifre değiştirme doğrulama kodu sunucu oturumunda (Session) tutulduğu için oturum çerezi saklanır.
class ApiClient {
  ApiClient({required this.baseUrl});

  static const clientAppName = 'lezzet-kurye';
  static const _timeout = Duration(seconds: 15);

  String baseUrl;
  String? token;
  String? _sessionCookie;
  final http.Client _http = http.Client();

  void clearSession() {
    token = null;
    _sessionCookie = null;
  }

  Future<Map<String, dynamic>> get(String path) {
    return _send(() => _http.get(_uri(path), headers: _headers()));
  }

  Future<Map<String, dynamic>> post(String path, [Map<String, String>? form]) {
    return _send(() => _http.post(_uri(path), headers: _headers(), body: form ?? const {}));
  }

  Future<Map<String, dynamic>> postJson(String path, Map<String, Object?> body) {
    return _send(() => _http.post(
          _uri(path),
          headers: {..._headers(), 'Content-Type': 'application/json; charset=utf-8'},
          body: jsonEncode(body),
        ));
  }

  Uri _uri(String path) {
    final base = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    return Uri.parse('$base$path');
  }

  Map<String, String> _headers() => {
        'Accept': 'application/json',
        'X-Client-App': clientAppName,
        if (token != null) 'Authorization': 'Bearer $token',
        'Cookie': ?_sessionCookie,
      };

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() request) async {
    http.Response response;
    try {
      response = await request().timeout(_timeout);
    } on TimeoutException {
      throw ApiException('Sunucu cevap vermedi. Bağlantınızı kontrol edip tekrar deneyin.');
    } on SocketException {
      throw ApiException('Sunucuya ulaşılamadı. İnternet bağlantınızı ve sunucu adresini kontrol edin.');
    } on http.ClientException {
      throw ApiException('Sunucuya ulaşılamadı. İnternet bağlantınızı ve sunucu adresini kontrol edin.');
    }

    final cookie = RegExp(r'ASP\.NET_SessionId=[^;]+').firstMatch(response.headers['set-cookie'] ?? '');
    if (cookie != null) _sessionCookie = cookie.group(0);

    final body = _decode(response);

    if (response.statusCode == 401) {
      throw UnauthorizedException(body?['message'] as String? ?? 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.');
    }
    if (response.statusCode == 403) {
      throw ApiException(body?['message'] as String? ?? 'Bu işlem için yetkiniz yok.');
    }
    if (response.statusCode != 200 || body == null) {
      throw ApiException('Sunucu hatası (${response.statusCode}). Lütfen biraz sonra tekrar deneyin.');
    }
    if (body['success'] == false) {
      throw ApiException(body['message'] as String? ?? 'İşlem yapılamadı.');
    }
    return body;
  }

  Map<String, dynamic>? _decode(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      return decoded is Map<String, dynamic> ? decoded : null;
    } on FormatException {
      return null;
    }
  }
}
