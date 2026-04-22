# itbaer-goom-panel — Plan (v2, post-research)

Grafana panel plugin. Runs classic id Tech 1 engine (via `cloudflare/doom-wasm`)
inside a dashboard panel. Free, open-source, Community tier. **Ships with
Freedoom** (BSD-licensed) so the panel plays instantly with zero user
interaction. Users can optionally load their own WADs (DOOM.WAD, DOOM2.WAD,
custom PWADs).

> Source of truth: [`../grafana-mp/CONVENTIONS.md`](../grafana-mp/CONVENTIONS.md)
> · [`../grafana-mp/GETTING-STARTED.md`](../grafana-mp/GETTING-STARTED.md)
> · [`../grafana-mp/RESEARCH.md`](../grafana-mp/RESEARCH.md) (§5 Copyright / IP)

---

## 0. IP / trademark research (verified April 2026)

| Asset                                | Status                                                                                             | Verdict                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "DOOM" / "Doom" word mark            | Registered trademark, id Software / ZeniMax Media / Microsoft                                      | **Cannot** use in plugin ID, display name, logo, category, or screenshots.                           |
| Doomguy, Cacodemon, Imp, BFG sprites | Copyright + trademark, ZeniMax                                                                     | **Cannot** embed, display, use as icons.                                                             |
| id Tech 1 engine source              | GPL-2.0-or-later (Carmack relicensed 1999-10-03)                                                   | OK to embed. Forces plugin license = GPL-2.0.                                                        |
| DOOM1.WAD (shareware IWAD, 1993)     | Copyright ZeniMax. 1993 shareware EULA permits unmodified non-commercial redistribution.           | **Skip.** Modern re-releases exist; ZeniMax has never formally blessed modern rehost; catalog risk.  |
| DOOM.WAD, DOOM2.WAD, TNT, Plutonia   | Copyright ZeniMax; sold today                                                                      | **Never bundle.** User-supplied only.                                                                |
| Freedoom 0.13.0 IWADs                | Modified BSD (3-clause-like); "Redistribution…with or without modification…permitted."             | **Bundle freely.** Attribution in `NOTICE`.                                                          |
| Nominative "DOOM" references in docs | Fair use if descriptive, not as source-identifier, with disclaimer                                 | OK in README: "compatible with user-supplied DOOM® WAD files"; include disclaimer paragraph.         |

Grafana plugin policy ([grafana.com/legal/plugins](https://grafana.com/legal/plugins/)):
> "Usage of 3rd party software or dependencies within the plugin must be
> licensed for the intended use…you must have rights to use any embedded logos
> or trademarks."

Plugin ID + display name use "Goom". Visual assets are Freedoom or original.
"DOOM" appears only in explanatory prose with ® and disclaimer.

Required README disclaimer:
> Goom is not affiliated with, authorized by, endorsed by, or in any way
> connected to id Software, Bethesda Softworks, ZeniMax Media, or Microsoft.
> DOOM® is a registered trademark of ZeniMax Media Inc. "Goom" plays
> user-supplied DOOM® WAD files via the open-source id Tech 1 engine code
> (GPL-2.0).

---

## 1. Identity

| Field            | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Plugin ID        | `itbaer-goom-panel`                                                |
| Type             | `panel`                                                            |
| Display name     | `Goom`                                                             |
| Org slug         | `itbaer`                                                           |
| GitHub repo      | `github.com/IT-BAER/itbaer-goom-panel` (public)                    |
| License          | **GPL-2.0-or-later** (id Tech 1 forces it)                         |
| Tier             | Community (free, Grafana-signed, no marketplace fee)               |
| Grafana min ver  | `>=10.4.0`                                                         |
| Workspace folder | `gp-doom/` (nested inside this workspace; deviation from §10)      |

---

## 2. Instant-play architecture

```
User adds Goom panel  ──►  Panel mounts
                             │
                             ▼
                 ┌──────────────────────────────┐
                 │ GoomPanel (React)            │
                 │  ├── Load doom.wasm (lazy)   │
                 │  ├── Load freedoom1.wad      │◄── bundled asset
                 │  │   (from plugin /public/)  │
                 │  ├── Mount WAD in MEMFS      │
                 │  └── Emscripten Module start │
                 │          │                   │
                 │          ▼                   │
                 │   Canvas renders game        │
                 │   Press any key → focus →    │
                 │   keyboard captured          │
                 └──────────────────────────────┘
```

Zero-click playtime target: **< 3 s** from panel mount to title screen
(cold load of ~2 MB wasm + ~20 MB Freedoom WAD).

---

## 3. Engine

- Source: `cloudflare/doom-wasm` (Emscripten fork of chocolate-doom, GPL-2.0).
- Vendoring: git submodule at `vendor/doom-wasm`.
- Build-time artifacts: `doom.js` + `doom.wasm` copied into `src/wasm/` via
  `scripts/build-wasm.*`. CI builds them; pre-built artifacts shipped in
  releases so `npm install && npm run dev` works without emsdk locally.
- Loader: dynamic `import()` of Emscripten glue; Module config:
  - `canvas`: panel `<canvas>` ref
  - `arguments`: `['-iwad', '/wad/active.wad']`
  - `preRun`: mount active WAD blob to `/wad/active.wad` via `FS.createDataFile`
  - `noExitRuntime`: `true`

---

## 4. WAD handling

Panel ships with **`freedoom1.wad`** (~20 MB, bundled in `src/public/wads/`).
Three WAD sources, tried in order on panel mount:

1. `options.wadSource === 'user'`  → load from IndexedDB by `options.wadSha`.
2. `options.wadSource === 'url'`   → fetch `options.wadUrl`, cache in IndexedDB.
3. **Default / fallback**           → bundled `freedoom1.wad`.

Fresh panel → instant Freedoom. Configure options → user's own DOOM/PWAD.

WAD management UI (collapsible, hidden behind "⚙" on HUD overlay):
- Current WAD: name, size, SHA1, source badge.
- Upload new WAD (file drag-drop → IndexedDB → sets current).
- Paste WAD URL (fetch → IndexedDB → sets current).
- Switch back to bundled Freedoom (one click).
- Delete cached WAD.

Panel options (saved in dashboard JSON):
- `wadSource`: `'freedoom'` | `'user'` | `'url'` (default `'freedoom'`).
- `wadSha`, `wadUrl`: conditional on `wadSource`.
- `controls`: `'vanilla'` | `'wasd'` (default `'wasd'`).
- `muteOnLoad`: bool (default `false`).
- `autoStart`: bool (default `true`).

---

## 5. UX

- **Auto-start**: on panel mount, WASM loads, game starts, title screen plays.
  No click needed. `autoStart` can be disabled.
- **Audio gating**: WebAudio blocked until user gesture. Game renders silent
  until first click; HUD hints "🔊 click to enable sound".
- **Focus-based keyboard capture**: canvas `tabIndex=0`; keyboard events only
  captured when canvas has focus. Dashboard shortcuts not stolen by unfocused panel.
- **ESC** releases focus (doesn't reach game); game menu rebound to Backspace.
- **Fullscreen** button → `requestFullscreen` on canvas.
- **Pause** on `document.hidden` tab change.
- **Mobile**: v1 = keyboard only; virtual controls phase 2.
- **Accessibility**: canvas has `role="img" aria-label="Classic FPS game"`;
  keyboard shortcut summary announced via aria-live region.

---

## 6. Repo layout

```
gp-doom/                            # aka itbaer-goom-panel (workspace root)
├── src/
│   ├── plugin.json
│   ├── module.ts
│   ├── components/
│   │   ├── GoomPanel.tsx
│   │   ├── GameCanvas.tsx
│   │   ├── WadManager.tsx
│   │   └── HUDOverlay.tsx
│   ├── wasm/                       # doom.js + doom.wasm (gitignored, built)
│   ├── public/
│   │   └── wads/
│   │       └── freedoom1.wad       # bundled (BSD), fetched at build time
│   ├── lib/
│   │   ├── wadStore.ts             # IndexedDB CRUD
│   │   ├── sha1.ts
│   │   └── keymap.ts
│   ├── img/
│   │   ├── logo.svg                # neutral retro, no id assets
│   │   └── screenshots/            # Freedoom captures only
│   ├── types.ts
│   └── styles.css
├── vendor/doom-wasm/               # git submodule, GPL-2.0
├── scripts/
│   ├── build-wasm.ps1
│   ├── build-wasm.sh
│   └── fetch-freedoom.ps1          # download freedoom1.wad on build
├── tests/
├── .github/workflows/              # ci.yml + release.yml
├── docker-compose.yaml
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE                         # GPL-2.0
├── NOTICE                          # attributions
├── README.md
├── PLAN.md                         # this file
└── package.json
```

---

## 7. Security / privacy (CONVENTIONS §6)

- No credentials, no `secureJsonData`.
- No outbound HTTP from plugin except user-initiated WAD URL fetch.
- CSP: document required `script-src 'wasm-unsafe-eval'` / `worker-src blob:`.
- Input sanitization on URL field (`new URL(input)`, reject non-http(s)).
- IndexedDB scoped per-origin; "Clear cached WADs" button.
- `npm audit --omit=dev` gate in CI.
- No analytics, telemetry, or install pings.

---

## 8. Publishing (GETTING-STARTED Steps 6–10)

1. Public repo `IT-BAER/itbaer-goom-panel`.
2. Grafana Cloud Access Policy token → repo secret `GRAFANA_ACCESS_POLICY_TOKEN`.
3. Tag `v0.1.0` → release workflow builds + packages.
4. Submit to catalog → Community tier.
5. Provisioning test env: reviewer opens Grafana, adds panel, sees Freedoom
   title screen instantly.
6. Re-sign with assigned Community level.

---

## 9. Risks & mitigations

| Risk                                                       | Mitigation                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ZeniMax trademark/copyright claim                          | No DOOM name/assets. Only Freedoom bundled. Nominative DOOM references + disclaimer.         |
| Grafana reviewer blocks on "game plugin" / trademarks      | Freedoom ships clean; framed as id Tech 1 WAD player.                                        |
| CSP blocks WASM on locked-down instances                   | Document required relaxations; graceful error panel.                                         |
| Audio autoplay policy blocks sound pre-gesture             | Game plays muted until user clicks.                                                          |
| Bundle size (20 MB WAD)                                    | Accept. Catalog requires self-contained ZIP.                                                 |
| IndexedDB quota for big PWADs                              | Quota probe before write.                                                                    |
| Keyboard capture steals dashboard shortcuts                | Focus-based capture only.                                                                    |
| "Goom" collides with libgoom visualizer (LGPL)             | Different category. No actual confusion.                                                     |

---

## 10. Phased tasks

### Phase 1 — Scaffold
- [ ] Run `@grafana/create-plugin@latest` (panel, `itbaer-goom-panel`, no backend).
- [ ] Overlay templates from `../grafana-mp/templates/`.
- [ ] Replace LICENSE → GPL-2.0.
- [ ] Add `NOTICE` with doom-wasm + chocolate-doom + Freedoom attributions.
- [ ] Initial commit.

### Phase 2 — Freedoom bundling
- [ ] `scripts/fetch-freedoom.*`: download freedoom-0.13.0.zip, verify SHA,
      extract `freedoom1.wad` → `src/public/wads/`.
- [ ] Download-on-build (not in git) keeps repo slim.
- [ ] `prepack` / `prebuild` hook runs fetch.

### Phase 3 — Engine bring-up
- [ ] `git submodule add https://github.com/cloudflare/doom-wasm vendor/doom-wasm`.
- [ ] `scripts/build-wasm.*`: emsdk → make → copy `doom.js` + `doom.wasm`.
- [ ] CI job builds wasm, uploads as release artifact.
- [ ] Smoke: load Freedoom, render title screen.

### Phase 4 — Panel UX
- [ ] `GameCanvas`: Module instantiation, resize observer.
- [ ] `WadManager`: IndexedDB CRUD, upload, URL fetch, switch-to-Freedoom.
- [ ] `HUDOverlay`: pause, reset, fullscreen, mute, ⚙.
- [ ] Panel options editor.
- [ ] Focus-based keyboard lifecycle.
- [ ] Audio-unlock gesture.

### Phase 5 — Quality gates (CONVENTIONS §7)
- [ ] Jest unit tests.
- [ ] Playwright E2E.
- [ ] Lint / typecheck / test / e2e.
- [ ] `plugin-validator` clean.
- [ ] README screenshots (Freedoom only).
- [ ] CHANGELOG entry.

### Phase 6 — Publish
- [ ] Tag `v0.1.0`.
- [ ] Submit to catalog.
- [ ] Iterate on review.
- [ ] Re-sign Community level.

---

## 11. Out of scope (v1)

- Multiplayer / network play.
- DeHackEd / DECORATE.
- Gamepad remap UI.
- Mobile virtual joystick.
- id Tech 4 / Doom 3.
- Heretic / Hexen / Strife.

---

## 12. Decisions locked (April 2026)

- Plugin ID: `itbaer-goom-panel`.
- Engine: `cloudflare/doom-wasm`.
- License: GPL-2.0-or-later.
- WAD UX: Freedoom bundled (instant play) + user upload + URL.
- Name "Goom": final.
- Repo path: `gp-doom/` (this workspace folder).
