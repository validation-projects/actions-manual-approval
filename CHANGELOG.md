## [3.0.0](https://github.com/validation-projects/actions-manual-approval/compare/v2.0.0...v3.0.0) (2026-11-06)

### ⚠ BREAKING CHANGES

* inputs app-id e app-private-key removidos; gere o token com actions/create-github-app-token e passe em app-token.

Co-Authored-By: Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>

### Features

* drop @octokit/auth-app, add job summaries and annotated logs ([1b9dffe](https://github.com/validation-projects/actions-manual-approval/commit/1b9dffe55b2d522e7feed7630ebca122f0b65f2a))

## [2.0.0](https://github.com/validation-projects/actions-manual-approval/compare/v1.0.0...v2.0.0) (2026-11-03)

### ⚠ BREAKING CHANGES

* the action now runs on node24 and requires GitHub Actions runner v2.327.1 or later. Self-hosted runners on older versions must be updated before moving to v2; @v1 keeps running on node20.

Co-Authored-By: Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>

### Features

* run action on Node.js 24 ([a5de586](https://github.com/validation-projects/actions-manual-approval/commit/a5de586bd983908a166eb30f52d5a64527c1f2f6))

## 1.0.0 (2026-11-03)

### ⚠ BREAKING CHANGES

* publish first stable major version (v1)
* first stable release; the action is now consumed through the floating major tag `v1` (or an exact `v1.x.y` tag) instead of `main`.

Co-Authored-By: Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>

* Merge pull request [#3](https://github.com/validation-projects/actions-manual-approval/issues/3) from validation-projects/devin/1793672884-first-major-release ([fae4208](https://github.com/validation-projects/actions-manual-approval/commit/fae4208c4e31285b4840efced7e33653a3dfc149))

### Features

* publish first stable major version (v1) ([d3ee584](https://github.com/validation-projects/actions-manual-approval/commit/d3ee58488b953e94688e90c0897f5b35c0f0cb70))
