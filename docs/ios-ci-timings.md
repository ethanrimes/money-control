# iOS CI build timings

GitHub Actions workflow: `.github/workflows/ios.yml`. Runner: `macos-latest`
(Apple Silicon, M-series). Per-step timings are wall-clock seconds, captured
via the GitHub Actions REST API on each green run.

To pull the data yourself:

```bash
gh api repos/ethanrimes/money-control/actions/runs/<RUN_ID>/jobs \
  --jq '.jobs[0].steps[] | {name, started_at, completed_at}'
```

## Run history

### Run #25848728859 — 2026-05-14, first green build

Commit: `c8f841c` — *iOS: fix CategoryNode field access + drop flutter_test scaffold*

| Phase | Duration | Notes |
|---|---|---|
| Set up job | 2s | runner provisioning |
| Checkout | 2s | shallow clone |
| Setup Flutter (3.27.4) | **1m08s** | cache miss — first run installs SDK from scratch (~1.5 GB) |
| Flutter / Xcode versions | 3s | diagnostic step |
| Materialize iOS scaffold | 6s | `flutter create --platforms=ios --no-pub .` |
| flutter pub get | 6s | resolves supabase_flutter + fl_chart + provider + intl + … |
| flutter analyze | 14s | catches every Dart error pre-build |
| Install signing cert + profile | <1s | base64-decode + keychain import |
| Patch xcconfig + ExportOptions | <1s | sed + PlistBuddy |
| Patch project.pbxproj | 1s | inject DEVELOPMENT_TEAM |
| pod install | 6s | mostly cached; `--repo-update` skipped because we never asked for it |
| **Build signed IPA** | **1m50s** | flutter build ipa --release |
| Upload IPA artifact | 3s | actions/upload-artifact |
| Cleanup signing material | <1s | delete temp keychain |
| Post Setup Flutter | 35s | cache save — pays off next run |
| Post Checkout / Complete job | 2s | runner shutdown |
| **Total** | **4m24s** | from queue to finish |

The two phases that dominate wall-clock are the Flutter SDK install
(1m08s) and `flutter build ipa --release` (1m50s) — together they're 67% of
total time. Both benefit from caching:
- `subosito/flutter-action@v2 cache: true` should bring **Setup Flutter** down
  to ~5-10s on subsequent runs.
- iOS build outputs aren't cached today; that's the obvious next lever.

## Iteration history (mostly red, kept for the timing pattern)

| Run | Duration | Outcome | Root cause |
|---|---|---|---|
| 25847756637 | 0s | ❌ | `environment: production` (case-sensitive — should be `Production`) |
| 25847837391 | 0s | ❌ | same |
| 25847922717 | 0s | ❌ | residual; probe workflow used to bisect |
| 25847980705 | 1m13s | ❌ | `security cms` parse of `.mobileprovision` — vague error |
| 25848076199 | 1m22s | ❌ | same, better diagnostics added |
| 25848208528 | 1m39s | ❌ | xcconfig used `#` comments → Xcode "unsupported preprocessor directive" |
| 25848305908 | 3m11s | ❌ | gitignored `data/` swept up `apps/mobile/lib/data/` |
| 25848464621 | 2m43s | ❌ | `DropdownButtonFormField(initialValue:)` not valid pre-Flutter 3.33 |
| 25848611976 | 1m48s | ❌ | `CategoryNode.id/name` did not exist (use `.category.id/name`) |
| 25848728859 | **4m24s** | ✅ | first green |

## How to update going forward

After each green run on `main`:

1. Pull the step durations: `gh api repos/ethanrimes/money-control/actions/runs/<id>/jobs --jq '.jobs[0].steps[]'`
2. Add a new section to **Run history** above.
3. Commit with `docs: log iOS CI timings for run <id>`.

## Why we care

- The Flutter SDK install dominates cold runs. If `Setup Flutter` consistently
  exceeds ~30s on repeat builds, the action cache key has likely drifted —
  inspect the cache hit log line.
- A spike in `Build signed IPA` minus `pod install` is the canonical signal
  that Xcode is clean-rebuilding (e.g. `Generated.xcconfig` changed because
  `flutter create` regenerated it). Stable runs should stay flat.
- Public GitHub repos get unlimited macos-latest minutes today, but Apple
  Silicon arm64 runners are still a constrained pool — long queue waits
  before "Set up job" are normal.

## Reference baselines (macos-latest arm64, May 2026)

These numbers come from the first-green run above. Use them as the floor
for "is something wrong" decisions:

- `Setup Flutter` (cold): 60–90s. With cache hit: 5–15s.
- `flutter pub get`: 5–15s.
- `flutter analyze`: 10–20s.
- `pod install` (no `--repo-update`): 5–15s. With `--repo-update`: 90–300s.
- `flutter build ipa --release`: 90–240s.
- **Total cold-build**: ~4–6 minutes.
- **Total warm-build (Flutter cache hit, no Podfile changes)**: ~2–4 minutes.
