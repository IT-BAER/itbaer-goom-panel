#!/usr/bin/env node
/* eslint-disable */
// Post-build hook: copy static assets the scaffolder's copyFilePatterns does NOT
// (wasm glue + wasm binary + bundled Freedoom WAD). Mirrors the source tree so
// runtime fetch paths are predictable:
//   /public/plugins/itbaer-goom-panel/wasm/doom.js
//   /public/plugins/itbaer-goom-panel/wasm/doom.wasm
//   /public/plugins/itbaer-goom-panel/public/wads/freedoom1.wad
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

if (!fs.existsSync(dist)) {
  // First `dev` watch run before any emit — dist not yet created. No-op.
  return;
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

copyDir(path.join(root, "src", "wasm"),            path.join(dist, "wasm"));
copyDir(path.join(root, "src", "public", "wads"),  path.join(dist, "public", "wads"));

console.log("[copy-assets] ok: wasm/ + public/wads/ copied to dist/");
