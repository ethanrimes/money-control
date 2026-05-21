import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/backend_api.dart';
import '../data/dashboard_store.dart';
import '../data/repos.dart';
import '../pages/shell.dart';
import 'login_page.dart';
import 'reset_password_page.dart';

/// Watches Supabase auth state. When a user signs in, builds the
/// [DashboardStore] (which holds repo references + cached data) and presents
/// the tab shell. When they sign out, drops the store and shows the login
/// page. Keeping the store inside the authenticated subtree guarantees we
/// never reuse a store across users.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  Session? _session;
  // True while the user is in a password-recovery flow (deep link opened from
  // the reset email). We block the dashboard until they pick a new password,
  // matching the web app's /auth/reset-password gate.
  bool _recovering = false;
  StreamSubscription<AuthState>? _authSub;

  @override
  void initState() {
    super.initState();
    final supa = Supabase.instance.client;
    _session = supa.auth.currentSession;
    _authSub = supa.auth.onAuthStateChange.listen((state) {
      if (!mounted) return;
      setState(() {
        _session = state.session;
        if (state.event == AuthChangeEvent.passwordRecovery) {
          _recovering = true;
        } else if (state.event == AuthChangeEvent.signedOut) {
          _recovering = false;
        }
      });
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = _session;
    if (session == null) {
      return const LoginPage();
    }
    if (_recovering) {
      return ResetPasswordPage(
        onDone: () => setState(() => _recovering = false),
      );
    }
    return _AuthenticatedScope(
      key: ValueKey(session.user.id),
      session: session,
    );
  }
}

class _AuthenticatedScope extends StatefulWidget {
  const _AuthenticatedScope({super.key, required this.session});

  final Session session;

  @override
  State<_AuthenticatedScope> createState() => _AuthenticatedScopeState();
}

class _AuthenticatedScopeState extends State<_AuthenticatedScope> {
  late final MoneyControlRepo _repo;
  late final BackendApi _api;
  late final DashboardStore _store;

  @override
  void initState() {
    super.initState();
    _repo = MoneyControlRepo(Supabase.instance.client);
    _api = BackendApi();
    _store = DashboardStore(_repo);
    // Initial load.
    WidgetsBinding.instance.addPostFrameCallback((_) => _store.refresh());
  }

  @override
  void dispose() {
    _store.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<MoneyControlRepo>.value(value: _repo),
        Provider<BackendApi>.value(value: _api),
        ChangeNotifierProvider<DashboardStore>.value(value: _store),
      ],
      child: const TabShell(),
    );
  }
}
