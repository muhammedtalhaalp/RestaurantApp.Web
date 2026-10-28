import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../core/theme.dart';
import 'login_screen.dart';

/// Profil: ad / e-posta güncelleme, e-posta kodu ile şifre değiştirme ve çıkış.
/// Web karşılığı: Views/Auth/ProfileSettings.cshtml (aynı sunucu uç noktaları).
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  static const _minPasswordLength = 6;

  final _session = AppSession.instance;
  final _infoForm = GlobalKey<FormState>();
  final _passwordForm = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _newPassword = TextEditingController();
  final _repeatPassword = TextEditingController();

  UserProfile? _profile;
  String? _loadError;
  bool _savingInfo = false;
  bool _sendingCode = false;
  bool _codeSent = false;
  bool _savingPassword = false;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    for (final c in [_name, _email, _code, _newPassword, _repeatPassword]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadProfile() async {
    setState(() => _loadError = null);
    try {
      final profile = await _session.fetchProfile();
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _name.text = profile.fullName;
        _email.text = profile.email;
      });
    } on UnauthorizedException catch (e) {
      _goToLogin(e.message);
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    }
  }

  Future<void> _saveInfo() async {
    if (!_infoForm.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _savingInfo = true);
    try {
      final message = await _session.updateProfile(_name.text, _email.text);
      _showMessage(message, success: true);
      await _loadProfile();
    } on UnauthorizedException catch (e) {
      _goToLogin(e.message);
    } on ApiException catch (e) {
      _showMessage(e.message);
    } finally {
      if (mounted) setState(() => _savingInfo = false);
    }
  }

  Future<void> _sendCode() async {
    setState(() => _sendingCode = true);
    try {
      final message = await _session.sendPasswordCode();
      setState(() => _codeSent = true);
      _showMessage(message, success: true);
    } on UnauthorizedException catch (e) {
      _goToLogin(e.message);
    } on ApiException catch (e) {
      _showMessage(e.message);
    } finally {
      if (mounted) setState(() => _sendingCode = false);
    }
  }

  Future<void> _savePassword() async {
    if (!_passwordForm.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _savingPassword = true);
    try {
      final message = await _session.changePassword(_code.text, _newPassword.text);
      _code.clear();
      _newPassword.clear();
      _repeatPassword.clear();
      setState(() => _codeSent = false);
      _showMessage(message, success: true);
    } on UnauthorizedException catch (e) {
      _goToLogin(e.message);
    } on ApiException catch (e) {
      _showMessage(e.message);
    } finally {
      if (mounted) setState(() => _savingPassword = false);
    }
  }

  Future<void> _confirmLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Çıkış Yap'),
        content: const Text('Oturumunuz kapatılacak. Emin misiniz?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger, minimumSize: const Size(100, 42)),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Çıkış Yap'),
          ),
        ],
      ),
    );
    if (confirmed == true) _goToLogin(null);
  }

  Future<void> _goToLogin(String? message) async {
    await _session.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => LoginScreen(message: message)),
      (_) => false,
    );
  }

  void _showMessage(String message, {bool success = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: success ? AppColors.ready : AppColors.danger),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profil Ayarları', style: TextStyle(fontWeight: FontWeight.w700))),
      body: _profile == null
          ? Center(
              child: _loadError == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text(_loadError!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        OutlinedButton(onPressed: _loadProfile, child: const Text('Tekrar Dene')),
                      ]),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _profileHeader(_profile!),
                const SizedBox(height: 16),
                _infoCard(),
                const SizedBox(height: 16),
                _passwordCard(),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _confirmLogout,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: const BorderSide(color: Color(0xFFFECACA)),
                    backgroundColor: Colors.white,
                  ),
                  icon: const Icon(Icons.logout),
                  label: const Text('Güvenli Çıkış'),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }

  Widget _profileHeader(UserProfile profile) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              radius: 28,
              backgroundColor: AppColors.brand,
              child: Text(initials(profile.fullName),
                  style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(profile.fullName, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  Text(profile.email, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                  const SizedBox(height: 6),
                  Wrap(spacing: 6, runSpacing: 4, children: [
                    _chip(Icons.two_wheeler, profile.role),
                    if (profile.companyName?.isNotEmpty == true) _chip(Icons.storefront, profile.companyName!),
                  ]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(IconData icon, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 13, color: AppColors.brand),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(fontSize: 12, color: AppColors.brand, fontWeight: FontWeight.w600)),
      ]),
    );
  }

  Widget _sectionCard({required IconData icon, required String title, String? subtitle, required Widget child}) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Icon(icon, color: AppColors.brand, size: 20),
              const SizedBox(width: 8),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            ]),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(subtitle, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
            ],
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }

  Widget _infoCard() {
    return _sectionCard(
      icon: Icons.person_outline,
      title: 'Kişisel Bilgiler',
      child: Form(
        key: _infoForm,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Ad Soyad', prefixIcon: Icon(Icons.badge_outlined)),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Ad soyad zorunludur.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'E-posta',
                prefixIcon: Icon(Icons.mail_outline),
                helperText: 'Giriş yaparken bu e-postayı kullanırsınız.',
              ),
              validator: (v) {
                final value = v?.trim() ?? '';
                if (value.isEmpty) return 'E-posta zorunludur.';
                if (!value.contains('@') || !value.contains('.')) return 'Geçerli bir e-posta girin.';
                return null;
              },
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _savingInfo ? null : _saveInfo,
              child: _savingInfo
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                  : const Text('Bilgileri Kaydet'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _passwordCard() {
    return _sectionCard(
      icon: Icons.lock_outline,
      title: 'Şifre Değiştir',
      subtitle: 'Güvenliğiniz için e-postanıza 4 haneli bir doğrulama kodu gönderilir.',
      child: !_codeSent
          ? OutlinedButton.icon(
              onPressed: _sendingCode ? null : _sendCode,
              icon: _sendingCode
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.forward_to_inbox),
              label: const Text('E-postama Kod Gönder'),
            )
          : Form(
              key: _passwordForm,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _code,
                    keyboardType: TextInputType.number,
                    maxLength: 4,
                    decoration: const InputDecoration(
                        labelText: 'Doğrulama Kodu', prefixIcon: Icon(Icons.pin_outlined), counterText: ''),
                    validator: (v) => (v == null || v.trim().length != 4) ? 'E-postanıza gelen 4 haneli kodu girin.' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _newPassword,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Yeni Şifre', prefixIcon: Icon(Icons.lock_reset)),
                    validator: (v) => (v == null || v.length < _minPasswordLength)
                        ? 'Şifre en az $_minPasswordLength karakter olmalıdır.'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _repeatPassword,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Yeni Şifre (Tekrar)', prefixIcon: Icon(Icons.lock_reset)),
                    validator: (v) => v != _newPassword.text ? 'Şifreler aynı değil.' : null,
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _savingPassword ? null : _savePassword,
                    child: _savingPassword
                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                        : const Text('Şifreyi Güncelle'),
                  ),
                  TextButton(
                    onPressed: _sendingCode ? null : _sendCode,
                    child: const Text('Kod gelmedi mi? Tekrar gönder'),
                  ),
                ],
              ),
            ),
    );
  }
}
