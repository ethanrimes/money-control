# MoneyControl — iOS (Flutter)

Native iPhone client for the MoneyControl personal-finance dashboard. Talks
directly to Supabase Postgres via `supabase_flutter`; Row-Level Security in
the database isolates tenants. Server-side aggregations from the web app are
replicated in Dart so the app reads raw rows and computes net-cash, spend
series, and historical averages locally.

## Local dev

```bash
cd apps/mobile
flutter create --platforms=ios --project-name moneycontrol --org com.ethankallett --no-pub .
cp .env.example .env             # then fill in for non-default Supabase URL
flutter pub get
cd ios && pod install && cd ..
flutter run -d "iPhone 15"        # any installed simulator
```

`flutter create` is idempotent — it only writes files we haven't committed,
so our customized `ios/Runner/Info.plist`, `ios/Podfile`, and the Dart code
in `lib/` survive.

## CI

`.github/workflows/ios.yml` builds a signed Release IPA on every push to
`main` (artifact retained 14 days). TestFlight upload is gated behind
`workflow_dispatch` → `upload_testflight: true`. Required GitHub secrets
and variables are documented in `apps/mobile/.env.example`.

Build timings per run land in `docs/ios-ci-timings.md`.
