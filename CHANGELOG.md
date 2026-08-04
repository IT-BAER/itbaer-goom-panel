# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-04

First catalog release.

### Fixed

- The top of the frame was cut off: the engine renders 4:3 (`aspect_ratio_correct`
  defaults on, 320x240), while the backbuffer was built from 320x200. Render
  height is now 240 and `aspect_ratio_correct` is pinned to 1.
- Unpainted black bars around the game: with no `-width`/`-height` the engine
  used its 800x600 default times the device pixel ratio, ignoring the canvas.
  The engine now owns the backbuffer and is told the panel's size.
- The canvas ignored the panel width when fitting: it is now contain-fit on
  both axes.
- Panel config keys (`novert`, `aspect_ratio_correct` and six others) were
  written to a config file the engine never reads; they are now passed via
  `-extraconfig`.

### Added

- HUD mute button, toggled at runtime by disconnecting the SDL2 audio graph
  node. A context suspend does not hold: Emscripten auto-resumes it on the
  next keypress. Separate from the `Mute on load` boot option.
- Jest unit tests for the canvas fit, engine window args, and mute.

### Security

- Cleared every high and critical advisory the Grafana plugin validator reports
  against the lockfile: `npm audit fix`, plus `overrides` pinning `immutable`
  to `^5.1.9` and `js-cookie` to `^3.0.8` (both reached only through
  `@grafana/ui` and `@grafana/data`, neither is bundled).

### Changed

- `vendor/doom-wasm` points at `IT-BAER/doom-wasm` branch `gp-doom`, which
  carries the patched Emscripten flags. The pinned commit only ever existed
  locally before, so every clone with `submodules: recursive` failed.

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

[Unreleased]: https://github.com/IT-BAER/itbaer-goom-panel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/IT-BAER/itbaer-goom-panel/releases/tag/v1.0.0
