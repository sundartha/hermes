#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { argv, env, exit } from "node:process";
import { parseArgs } from "node:util";

import { githubZugang } from "./auftrag/pruefer-github.mjs";
import {
  EXIT,
  HOECHSTENS_SEKUNDEN,
  TAKT_SEKUNDEN,
  abwarten,
} from "./pruefer-abwarten/abwarten.mjs";

const AUFRUF =
  "Aufruf: node tools/pruefer-abwarten.mjs [--head <sha>] [--hoechstens <sekunden>] [--takt <sekunden>]\n" +
  "Wartet nach einem Push auf den Status „Prüfer“ am Kopf und gibt BLOCKER und SOLLTE aus.\n" +
  "Exit: 0 Prüfer grün ohne BLOCKER/SOLLTE, 1 Befunde, 2 Aufruf/Fehler, 3 Prüfer ausgeblieben (Zeit), 4 Prüfer nicht gelaufen, 5 kein offener PR.";
const ERSTES_ARGUMENT = 2;
const ZAHL = /^[1-9]\d*$/;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ABGESCHALTET = "aus";

function optionen() {
  try {
    const { values } = parseArgs({
      args: argv.slice(ERSTES_ARGUMENT),
      options: {
        head: { type: "string" },
        hoechstens: { type: "string" },
        takt: { type: "string" },
      },
      strict: true,
    });
    const zahlenGut = [values.hoechstens, values.takt].every(
      (wert) => wert === undefined || ZAHL.test(wert),
    );
    return zahlenGut && (values.head === undefined || SHA.test(values.head)) ? values : null;
  } catch {
    return null;
  }
}

function kopfImWorktree() {
  const lauf = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return lauf.status === 0 ? lauf.stdout.trim() : null;
}

function zugangstoken() {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return undefined;
  const lauf = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  return lauf.status === 0 ? lauf.stdout.trim() : undefined;
}

const werte = optionen();
if (werte === null) {
  console.error(AUFRUF);
  exit(EXIT.aufruf);
}
if (env.PRUEFER_ABWARTEN === ABGESCHALTET && env.NODE_TEST_CONTEXT) {
  console.log(
    "pruefer-abwarten: abgeschaltet (nur im Werkzeugtest); es wurde NICHT auf den Prüfer gewartet.",
  );
  exit(EXIT.ok);
}
const kopf = werte.head ?? kopfImWorktree();
if (!kopf) {
  console.error(
    "pruefer-abwarten: kein Kopf-Commit bekannt (--head angeben oder im Git-Worktree aufrufen).",
  );
  exit(EXIT.aufruf);
}
try {
  const token = zugangstoken();
  exit(
    await abwarten({
      github: githubZugang(token ? { token } : {}),
      kopf,
      hoechstens: Number(werte.hoechstens ?? HOECHSTENS_SEKUNDEN),
      takt: Number(werte.takt ?? TAKT_SEKUNDEN),
    }),
  );
} catch (fehler) {
  console.error(`pruefer-abwarten: ${fehler.message}`);
  exit(EXIT.aufruf);
}
