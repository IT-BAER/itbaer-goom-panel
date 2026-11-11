#!/usr/bin/env node
 
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

// Windows PowerShell 5.1 started from a PowerShell 7 session inherits PS7's PSModulePath,
// loads the wrong Microsoft.PowerShell.Utility and loses Get-FileHash. Let it rebuild its own.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !isWin || k.toLowerCase() !== "psmodulepath")
);
const result = spawnSync(cmd, args, { stdio: "inherit", env });
process.exit(result.status === null ? 1 : result.status);
