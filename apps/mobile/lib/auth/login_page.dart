import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config.dart';
import '../theme.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _busy = false;
  _Mode _mode = _Mode.signIn;
  String? _error;
  String? _info;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  void _switchMode(_Mode target) {
    setState(() {
      _mode = target;
      _error = null;
      _info = null;
    });
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      final supa = Supabase.instance.client;
      switch (_mode) {
        case _Mode.signIn:
          await supa.auth.signInWithPassword(
            email: _emailCtrl.text.trim(),
            password: _passwordCtrl.text,
          );
          break;
        case _Mode.signUp:
          final res = await supa.auth.signUp(
            email: _emailCtrl.text.trim(),
            password: _passwordCtrl.text,
            emailRedirectTo: AppConfig.authRedirectUrl,
          );
          if (res.session == null) {
            setState(() => _info =
                'Check your email to confirm, then sign in. The confirmation link returns you to the app.');
          }
          break;
        case _Mode.forgotPassword:
          await supa.auth.resetPasswordForEmail(
            _emailCtrl.text.trim(),
            redirectTo: AppConfig.authRedirectUrl,
          );
          setState(() => _info =
              'Check your email for a password reset link. Tap it on this device to return to the app and set a new password.');
          break;
      }
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final isForgot = _mode == _Mode.forgotPassword;
    final isSignUp = _mode == _Mode.signUp;
    final heading = switch (_mode) {
      _Mode.signIn => 'Welcome back',
      _Mode.signUp => 'Create account',
      _Mode.forgotPassword => 'Reset password',
    };
    final subtitle = switch (_mode) {
      _Mode.signIn => 'Sign in to MoneyControl with your email and password.',
      _Mode.signUp =>
        'MoneyControl is private. Sign up to keep your data scoped to you.',
      _Mode.forgotPassword =>
        "Enter your email and we'll send you a link to set a new password.",
    };
    final submitLabel = switch (_mode) {
      _Mode.signIn => 'Sign in',
      _Mode.signUp => 'Sign up',
      _Mode.forgotPassword => 'Send reset link',
    };
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: context.accentColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Icon(Icons.savings_outlined,
                        color: context.accentColor, size: 30),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    heading,
                    style: theme.textTheme.displaySmall,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    subtitle,
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _emailCtrl,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    autofillHints: const [AutofillHints.email],
                    enableSuggestions: false,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      prefixIcon: Icon(Icons.mail_outline),
                    ),
                  ),
                  if (!isForgot) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _passwordCtrl,
                      obscureText: true,
                      autofillHints: isSignUp
                          ? const [AutofillHints.newPassword]
                          : const [AutofillHints.password],
                      decoration: const InputDecoration(
                        labelText: 'Password',
                        prefixIcon: Icon(Icons.lock_outline),
                      ),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ],
                  if (_info != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _info!,
                      style: const TextStyle(color: AppPalette.positive),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: _busy
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2.5, color: Colors.white))
                        : Text(submitLabel),
                  ),
                  const SizedBox(height: 14),
                  if (_mode == _Mode.signIn)
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => _switchMode(_Mode.forgotPassword),
                      child: const Text('Forgot password?'),
                    ),
                  if (isForgot)
                    TextButton(
                      onPressed: _busy ? null : () => _switchMode(_Mode.signIn),
                      child: const Text('Back to sign in'),
                    )
                  else
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => _switchMode(
                              isSignUp ? _Mode.signIn : _Mode.signUp),
                      child: Text(isSignUp
                          ? 'Have an account? Sign in'
                          : 'Need an account? Sign up'),
                    ),
                  const SizedBox(height: 8),
                  Text(
                    'Your data is scoped to your account via Postgres Row-Level Security. No one but you can read or write your rows.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isDark
                          ? AppPalette.darkMuted
                          : AppPalette.lightMuted,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

enum _Mode { signIn, signUp, forgotPassword }
