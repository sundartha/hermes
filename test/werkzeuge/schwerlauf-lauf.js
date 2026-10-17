import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, isolatedEnvironment, probeDirectory } from "./probe-repo.js";

export const SCHWERLAUF = join(REPO_ROOT, "tools/schwerlauf.mjs");
const SPERRE = pathToFileURL(join(REPO_ROOT, "tools/schwerlauf/sperre.mjs")).href;
export const WARTET = /^Schwerer Lauf wartet seit \d+ min auf die Sperre /;
export const FRIST = { timeout: 30_000 };
export const EIN_PLATZ_FREI = /^Platz 1: frei\nAllein: frei\nWartet: niemand$/m;

export function umgebung(context, plaetze = 1) {
  const env = {
    ...isolatedEnvironment(),
    SCHWERLAUF_SPERRDATEI: join(probeDirectory(context, {}), "sperre"),
    SCHWERLAUF_PLAETZE: String(plaetze),
  };
  delete env.SCHWERLAUF_HALTER;
  return env;
}

export function starte(args, { env, cwd = REPO_ROOT, stdin = "ignore", programm = process.execPath }) {
  const kind = spawn(programm, args, { cwd, env, stdio: [stdin, "pipe", "pipe"] });
  const lauf = { kind, stdout: "", stderr: "", ende: once(kind, "exit") };
  kind.stdout.setEncoding("utf8").on("data", (teil) => (lauf.stdout += teil));
  kind.stderr.setEncoding("utf8").on("data", (teil) => (lauf.stderr += teil));
  return lauf;
}

export async function stand(env) {
  const lauf = starte([SCHWERLAUF, "--stand"], { env });
  await lauf.ende;
  assert.equal(lauf.kind.exitCode, 0, lauf.stderr);
  return lauf.stdout;
}

export function zeile(strom, muster) {
  return new Promise((gefunden) => {
    createInterface({ input: strom }).on("line", (text) => {
      if (muster.test(text)) gefunden(text);
    });
  });
}

export async function wartet(lauf) {
  const geendet = lauf.ende.then(([code]) => {
    throw new Error(`Lauf endete mit Exit ${code}, ohne auf die Sperre zu warten: ${lauf.stderr}`);
  });
  await Promise.race([zeile(lauf.kind.stderr, WARTET), geendet]);
}

export async function halter(context, env) {
  const skript = `import { nimmSperreAuchFuerKindprozesse } from ${JSON.stringify(SPERRE)};
await nimmSperreAuchFuerKindprozesse("Halter im Test");
console.log("gehalten");
setInterval(() => {}, 1000);`;
  const lauf = starte(["--input-type=module", "-e", skript], { env });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await zeile(lauf.kind.stdout, /^gehalten$/);
  return lauf;
}

function arbeit(name) {
  return `const beginn = Date.now(); console.log("begonnen"); process.stdin.resume().on("end", () => console.log(JSON.stringify({ name: ${JSON.stringify(name)}, beginn, ende: Date.now() })));`;
}

export function starteArbeit(context, name, { env, optionen = [] }) {
  const lauf = starte([SCHWERLAUF, ...optionen, "--", process.execPath, "-e", arbeit(name)], { env, stdin: "pipe" });
  lauf.begonnen = zeile(lauf.kind.stdout, /^begonnen$/).then(() => "begonnen");
  lauf.wartend = zeile(lauf.kind.stderr, WARTET).then(() => "wartet");
  context.after(() => {
    lauf.kind.stdin.destroy();
    lauf.kind.kill("SIGKILL");
  });
  return lauf;
}

export function zeitenVon(lauf) {
  const zeilen = lauf.stdout.trim().split("\n");
  return JSON.parse(zeilen.at(-1));
}

export async function naechsterLaufNachTodVon(gestorben, env) {
  gestorben.kind.kill("SIGKILL");
  await gestorben.ende;
  const naechster = starte([SCHWERLAUF, "--", process.execPath, "-e", "console.log('lief')"], { env });
  await naechster.ende;
  return naechster;
}
