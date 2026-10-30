import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../widgets/gradient_button.dart';
import 'home_for_role.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.message});

  /// Giriş ekranına dönülme sebebi (ör. oturum süresi doldu).
  final String? message;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _session = AppSession.instance;

  bool _obscure = true;
  bool _loading = false;
  late String? _error = widget.message;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      await _session.login(_email.text, _password.text);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => homeForRole()));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _editServerAddress() async {
    final controller = TextEditingController(text: _session.api.baseUrl);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sunucu Adresi'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'LezzetPOS sunucusunun adresi. Telefon USB ile bilgisayara bağlıysa varsayılan adres kullanılır.',
              style: TextStyle(fontSize: 13, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            TextField(controller: controller, keyboardType: TextInputType.url, autocorrect: false),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, AppSession.defaultBaseUrl),
            child: const Text('Varsayılan'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(90, 44)),
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Kaydet'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (result != null && result.trim().isNotEmpty) {
      await _session.setBaseUrl(result);
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: _GlowBackground()),
          SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: Center(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
                      child: _FadeSlideIn(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 420),
                          child: Column(
                            children: [
                              const _Logo(),
                              const SizedBox(height: 20),
                              const Text(
                                'LezzetPOS',
                                style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -0.5),
                              ),
                              const SizedBox(height: 4),
                              const Text(
                                'Personel Uygulaması',
                                style: TextStyle(color: AppColors.muted, fontSize: 15, letterSpacing: 0.4),
                              ),
                              const SizedBox(height: 32),
                              _glassCard(),
                              const SizedBox(height: 22),
                              const _RoleHints(),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                TextButton.icon(
                  onPressed: _editServerAddress,
                  style: TextButton.styleFrom(foregroundColor: AppColors.subtle),
                  icon: const Icon(Icons.dns_outlined, size: 16),
                  label: Text('Sunucu: ${_session.api.baseUrl}', style: const TextStyle(fontSize: 12)),
                ),
                const SizedBox(height: 4),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Cam efektli giriş kartı: arka plandaki ışığı bulanık gösterir.
  Widget _glassCard() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(28),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: const EdgeInsets.fromLTRB(22, 26, 22, 22),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: Colors.white.withValues(alpha: 0.10)),
          ),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Hoş geldiniz', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                const Text('Devam etmek için hesabınızla giriş yapın.', style: TextStyle(color: AppColors.muted)),
                const SizedBox(height: 22),
                AnimatedSize(
                  duration: const Duration(milliseconds: 200),
                  child: _error == null
                      ? const SizedBox(width: double.infinity)
                      : Padding(padding: const EdgeInsets.only(bottom: 16), child: _errorBox(_error!)),
                ),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'E-posta', prefixIcon: Icon(Icons.alternate_email)),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'E-posta adresinizi girin.' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _password,
                  obscureText: _obscure,
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _login(),
                  decoration: InputDecoration(
                    labelText: 'Şifre',
                    prefixIcon: const Icon(Icons.lock_outline_rounded),
                    suffixIcon: IconButton(
                      tooltip: _obscure ? 'Şifreyi göster' : 'Şifreyi gizle',
                      icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: (v) => (v == null || v.isEmpty) ? 'Şifrenizi girin.' : null,
                ),
                const SizedBox(height: 24),
                GradientButton(
                  onPressed: _loading ? null : _login,
                  loading: _loading,
                  label: 'Giriş Yap',
                  icon: Icons.arrow_forward_rounded,
                  trailingIcon: true,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _errorBox(String message) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.tint(AppColors.danger, 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.tint(AppColors.danger, 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline_rounded, color: AppColors.danger, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: const TextStyle(color: AppColors.text, height: 1.35))),
        ],
      ),
    );
  }
}

/// Logo: marka geçişli daire ve etrafında parlayan halka.
class _Logo extends StatelessWidget {
  const _Logo();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 96,
      height: 96,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const SweepGradient(colors: [AppColors.accent, AppColors.brandBright, AppColors.accent]),
        boxShadow: [BoxShadow(color: AppColors.tint(AppColors.brandBright, 0.6), blurRadius: 40, spreadRadius: 2)],
      ),
      child: Container(
        decoration: const BoxDecoration(shape: BoxShape.circle, gradient: AppColors.brandGradient),
        child: const Icon(Icons.restaurant_menu_rounded, color: Colors.white, size: 42),
      ),
    );
  }
}

/// Uygulamayı kimlerin kullandığını gösteren küçük rozetler.
class _RoleHints extends StatelessWidget {
  const _RoleHints();

  @override
  Widget build(BuildContext context) {
    Widget hint(IconData icon, String text) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.04),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 15, color: AppColors.accent),
            const SizedBox(width: 6),
            Text(text, style: const TextStyle(color: AppColors.muted, fontSize: 13, fontWeight: FontWeight.w600)),
          ]),
        );

    return Wrap(
      alignment: WrapAlignment.center,
      spacing: 8,
      runSpacing: 8,
      children: [hint(Icons.room_service_outlined, 'Garson'), hint(Icons.two_wheeler, 'Kurye')],
    );
  }
}

/// Arka plan: koyu zemin üzerinde iki yumuşak mor ışık.
class _GlowBackground extends StatelessWidget {
  const _GlowBackground();

  @override
  Widget build(BuildContext context) {
    Widget glow(Color color, double size) => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
          ),
        );

    return ColoredBox(
      color: AppColors.background,
      child: Stack(children: [
        Positioned(top: -140, left: -120, child: glow(const Color(0xAA7B2D7E), 420)),
        Positioned(bottom: -160, right: -140, child: glow(const Color(0x664A154B), 460)),
      ]),
    );
  }
}

/// Açılışta içeriğin hafifçe yukarı kayarak belirmesi.
class _FadeSlideIn extends StatelessWidget {
  const _FadeSlideIn({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 550),
      curve: Curves.easeOutCubic,
      builder: (_, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(offset: Offset(0, 24 * (1 - t)), child: child),
      ),
      child: child,
    );
  }
}
