import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Lock to portrait + landscape (no upside-down on iPhone — iOS convention).
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    anonKey: AppConfig.supabaseAnonKey,
    authOptions: const FlutterAuthClientOptions(
      // PKCE is the more secure flow for native; supabase_flutter defaults to
      // pkce already but we set it explicitly for clarity.
      authFlowType: AuthFlowType.pkce,
      // Session persists in flutter_secure_storage (Keychain on iOS) so the
      // user stays signed in across launches without a network round-trip.
      autoRefreshToken: true,
    ),
  );

  runApp(const MoneyControlApp());
}
