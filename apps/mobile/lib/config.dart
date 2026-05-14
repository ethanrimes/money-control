// Build-time configuration. Values come from `--dart-define` (or the
// `--dart-define-from-file` shim that reads apps/mobile/.env locally), with
// safe defaults baked in for the production Supabase project.
//
// Why the anon key is hardcoded as default: it is a *publishable* key. The
// security boundary is RLS in supabase/migrations/0001_init.sql, not key
// secrecy. The web app already ships this same value to every browser via
// NEXT_PUBLIC_SUPABASE_ANON_KEY.

class AppConfig {
  AppConfig._();

  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://nkuuorwahqxugupiurub.supabase.co',
  );

  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'sb_publishable_NKTRoIlZmAKZ5BS0ge8FZA_F5_sccWD',
  );

  /// Deep-link scheme registered in `ios/Runner/Info.plist`. Used by Supabase
  /// Auth for email-confirmation + password-reset redirects.
  static const String deepLinkScheme = String.fromEnvironment(
    'APP_DEEP_LINK_SCHEME',
    defaultValue: 'moneycontrol',
  );

  /// Redirect URL we hand to Supabase Auth's signUp / resetPasswordForEmail.
  /// Add the *exact* string below to Supabase Dashboard → Authentication →
  /// URL Configuration → Redirect URLs.
  static String get authRedirectUrl => '$deepLinkScheme://login-callback';
}
