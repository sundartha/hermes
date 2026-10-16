#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";
import { parseArgs } from "node:util";

import { lokal } from "./auftrag/pruefer-befehle.mjs";

const AUFRUF =
  "Aufruf: node <master-checkout>/tools/pruefer-lokal.mjs --basis <ref> --issue <nummer> --aus <ordner> --ablage <ordner>";
const EXIT_AUFRUF = 2;
const ERSTES_ARGUMENT = 2;
const ISSUE_NUMMER = /^[1-9]\d*$/;
const PFLICHT = ["basis", "issue", "aus", "ablage"];

function optionen() {
  try {
    const { values } = parseArgs({
      args: argv.slice(ERSTES_ARGUMENT),
      options: {
        basis: { type: "string" },
        issue: { type: "string" },
        aus: { type: "string" },
        ablage: { type: "string" },
      },
      strict: true,
    });
    return PFLICHT.every((name) => values[name]) && ISSUE_NUMMER.test(values.issue) ? values : null;
  } catch {
    return null;
  }
}

function repoWurzel() {
  const lauf = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return lauf.status === 0 ? lauf.stdout.trim() : null;
}

const werte = optionen();
if (werte === null) {
  console.error(AUFRUF);
  exit(EXIT_AUFRUF);
}
const wurzel = repoWurzel();
if (wurzel === null) {
  console.error("pruefer-lokal: kein Git-Worktree.");
  exit(EXIT_AUFRUF);
}
try {
  exit(await lokal(werte, wurzel));
} catch (fehler) {
  console.error(`pruefer-lokal: ${fehler.message}`);
  exit(EXIT_AUFRUF);
}
