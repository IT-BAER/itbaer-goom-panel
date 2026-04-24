# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sound effects now work: patched `vendor/doom-wasm/configure.ac` Emscripten
  flags (`SAFE_HEAP=0`, `ALLOW_MEMORY_GROWTH=1`, `INITIAL_MEMORY=128MB`) to
  stop SDL2 audio callback OOB crashes.
- Panel option `Mute on load` now controls sound effects via `-nosound` at
  engine boot (applied on next page reload — engine is a per-page singleton).

### Changed

- Music is always disabled (`-nomusic`): SDL_mixer and OPL music paths both
  hang the WASM tab in this chocolate-doom build. Needs upstream C fix.
- Removed the "click to enable sound" HUD overlay; audio now resumes via the
  first normal user interaction with the canvas (SDL2 auto-resume on buffer
  push after the browser autoplay gesture).

### Added

- Initial scaffold via `@grafana/create-plugin@7.1.7` (panel type).
- Project IP/trademark research and canonical plan (`PLAN.md`).
- Licensed under **GPL-3.0-or-later** (required by embedded id Tech 1 engine,
  upstream GPL-2.0-or-later).
- `NOTICE` with full third-party attribution (chocolate-doom,
  cloudflare/doom-wasm, Freedoom) and trademark non-affiliation statement.
- Project README with trademark disclaimer and usage guide.
- Overlaid canonical `SECURITY.md` and `CONTRIBUTING.md` from `grafana-mp`.

[Unreleased]: https://github.com/IT-BAER/itbaer-goom-panel/compare/HEAD...HEAD
