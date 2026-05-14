# iOS CI build timings

GitHub Actions workflow: `.github/workflows/ios.yml`. Runner: `macos-latest`.
Each row is one successful run. Phase timings are wall-clock seconds from
the workflow start (`t0`); add the `total` column for total run time.

## Run history

| # | Date (UTC) | flutter-setup | scaffold | pre-pod | pods-done | ipa-built | total | Notes |
|---|------------|---------------|----------|---------|-----------|-----------|-------|-------|
|   | TBD        | —             | —        | —       | —         | —         | —     | first attempt — appended after green run |

## How to update

After each green run on `main`:

1. Open the run in GitHub Actions UI (`gh run view <RUN_ID>` or click the
   build in the PR/commit page).
2. Find the `::notice title=Phase timing::` lines in the step summary.
3. Append a new row to the table above with the captured timings.
4. Commit with `chore: log iOS CI timings for run <RUN_ID>`.

## Why we care

- macOS minutes on GitHub-hosted runners cost 10× Linux minutes; an extra
  5 minutes per build per push to `main` adds up fast.
- A spike in `pods-done` minus `pre-pod` usually means CocoaPods is
  re-resolving everything because the lockfile cache missed. Solution:
  add a cache key for `apps/mobile/ios/Pods` keyed on `Podfile.lock`.
- A spike in `ipa-built` minus `pods-done` usually means a clean-build
  fired (e.g. when `Generated.xcconfig` changed). Worth checking the
  flutter-action cache config.

## Reference baselines (macos-latest, May 2026)

These numbers are *rough* expectations for a from-cold build with no caches
beyond what subosito/flutter-action provides for the Flutter SDK itself:

- `flutter-setup`: 30–90s
- `scaffold`: 10–25s
- `pub get`: 15–45s (folded into `pre-pod`)
- `pod install --repo-update`: 90–300s (first run is worst — `--repo-update`
  fetches the master Specs repo)
- `flutter build ipa --release`: 240–420s
- **Total**: 7–12 minutes typical

Compare any future run against these and investigate outliers.
