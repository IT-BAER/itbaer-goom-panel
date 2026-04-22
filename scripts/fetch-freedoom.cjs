#!/usr/bin/env node
 
// Cross-platform launcher: dispatches to the PowerShell script on Windows
// and the bash script elsewhere. Kept free of dependencies so `npm install`
// isn't needed to run it.
"use strict";

const { spawnSync } = require("node:child_process");
const { platform } = require("node:os");
const path = require("node:path");

const here = __dirname;
const isWin = platform() === "win32";

const cmd = isWin ? "powershell" : "bash";
const args = isWin
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "fetch-freedoom.ps1")]
  : [path.join(here, "fetch-freedoom.sh")];

const result = spawnSync(cmd, args, { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
