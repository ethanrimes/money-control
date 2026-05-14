import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/dashboard_store.dart';
import '../data/repos.dart';
import '../pages/shell.dart';
import 'login_page.dart';

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
  late final Stream<AuthState> _authStream;

  @override
  void initState() {
    super.initState();
    final supa = Supabase.instance.client;
    _session = supa.auth.currentSession;
    _authStream = supa.auth.onAuthStateChange;
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: _authStream,
      builder: (context, snapshot) {
        final session = snapshot.data?.session ?? _session;
        if (session == null) {
          return const LoginPage();
        }
        // Provide a fresh store per session.
        return _AuthenticatedScope(
          key: ValueKey(session.user.id),
          session: session,
        );
      },
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
  late final DashboardStore _store;

  @override
  void initState() {
    super.initState();
    _repo = MoneyControlRepo(Supabase.instance.client);
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
        ChangeNotifierProvider<DashboardStore>.value(value: _store),
      ],
      child: const TabShell(),
    );
  }
}
