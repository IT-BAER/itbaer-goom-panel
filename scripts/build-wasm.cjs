#!/usr/bin/env node
/* eslint-disable */
"use strict";

const { spawnSync } = require("node:child_process");
const { platform } = require("node:os");
const path = require("node:path");

const here = __dirname;
const isWin = platform() === "win32";
const extraArgs = process.argv.slice(2);

const cmd = isWin ? "powershell" : "bash";
const args = isWin
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "build-wasm.ps1"), ...extraArgs]
  : [path.join(here, "build-wasm.sh"), ...extraArgs];

const result = spawnSync(cmd, args, { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
