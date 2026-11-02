import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { zuPruefendeCommits } from "../../tools/auftrag/pruefer-auswahl.mjs";
import { LIMIT_GRUND, pruefeCommit } from "../../tools/auftrag/pruefer-lauf.mjs";
import { TokenReihe, nimmTokenReihe } from "../../tools/auftrag/token-reihe.mjs";
import { starteAgent } from "../../tools/ziele/agent.mjs";
import { probeDirectory } from "./probe-repo.js";
import { ohneGitVariablen, probeRepo } from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const ERSATZ = fileURLToPath(new URL("pruefer/ersatz-pruefer.mjs", import.meta.url));
const AUFNAHMEN = fileURLToPath(new URL("pruefer/aufzeichnungen/", import.meta.url));
const AUSFUEHRBAR = 0o755;
const FRIST_ERSATZ_AGENT_SEKUNDEN = 60;
const ANZAHL_KONTEN = 3;
const ERSTER_LAUF_AUF_KONTO_EINS = ANZAHL_KONTEN;
const NACHRICHT = "Setze die Zahl\n\nWarum: Auftrag a1.\n\nAuftrag: probe/a1\n";
const T1 = "sk-ant-oat01-schein-eins-81c2";
const T2 = "sk-ant-oat01-schein-zwei-9b4d";
const T3 = "sk-ant-oat01-schein-drei-5e70";
const ALT = "sk-ant-oat01-schein-alt-3a96";
const NAMEN = [
  "CLAUDE_CODE_OAUTH_TOKEN_1",
  "CLAUDE_CODE_OAUTH_TOKEN_2",
  "CLAUDE_CODE_OAUTH_TOKEN_3",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GITHUB_RUN_NUMBER",
];

function ersatzJeToken(context, imLimit) {
  const ordner = probeDirectory(context, {});
  const benutzt = join(ordner, "benutzt.txt");
  const programm = join(ordner, "claude.mjs");
  const einstellung = (name) => ({
    aufzeichnung: join(AUFNAHMEN, `${name}.json`),
    protokoll: join(ordner, "protokoll.json"),
    liestDiffs: false,
  });
  writeFileSync(
    programm,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync } from "node:fs";',
      `import { spiele } from ${JSON.stringify(ERSATZ)};`,
      "const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;",
      `appendFileSync(${JSON.stringify(benutzt)}, token + "\\n");`,
      `const imLimit = ${JSON.stringify(imLimit)}.includes(token);`,
      `spiele(imLimit ? ${JSON.stringify(einstellung("limit-fuenf-stunden"))} : ${JSON.stringify(einstellung("gueltig"))});`,
      "",
    ].join("\n"),
  );
  chmodSync(programm, AUSFUEHRBAR);
  const verwendet = () => readFileSync(benutzt, "utf8").split("\n").filter(Boolean);
  return { programm, verwendet };
}

function einCommit(context) {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, NACHRICHT);
  const [commit] = zuPruefendeCommits({
    basis,
    head: repo.git(["rev-parse", "HEAD"]),
    branch: "fix/zahl",
    root: repo.ordner,
  }).commits;
  return { repo, basis, commit: { ...commit, letzter: false } };
}

async function pruefeMitReihe(context, { tokens, start = 0, imLimit }) {
  const { repo, basis, commit } = einCommit(context);
  const ersatz = ersatzJeToken(context, imLimit);
  const reihe = new TokenReihe(tokens, start);
  const ausgaben = [];
  context.mock.method(console, "log", (...teile) => ausgaben.push(teile.join(" ")));
  const ergebnis = await pruefeCommit(commit, {
    root: repo.ordner,
    basis,
    reihe,
    programm: ersatz.programm,
    auftragstext: "",
    ciLauf: "",
  });
  return { ergebnis, verwendet: ersatz.verwendet(), ausgaben };
}

function mitUmgebung(werte, lies) {
  const vorher = NAMEN.map((name) => [name, env[name]]);
  NAMEN.forEach((name) => delete env[name]);
  Object.assign(env, werte);
  try {
    return lies();
  } finally {
    vorher.forEach(([name, alt]) => (alt === undefined ? delete env[name] : (env[name] = alt)));
  }
}

test("die Startposition der Reihe rotiert mit der Lauf-Nummer, damit sich die Last auf die Konten verteilt", () => {
  const tokens = { CLAUDE_CODE_OAUTH_TOKEN_1: T1, CLAUDE_CODE_OAUTH_TOKEN_2: T2, CLAUDE_CODE_OAUTH_TOKEN_3: T3 };
  const laufNummern = [0, 1, 2].map((versatz) => String(ERSTER_LAUF_AUF_KONTO_EINS + versatz));
  const reihenfolge = laufNummern.map((nummer) =>
    mitUmgebung({ ...tokens, GITHUB_RUN_NUMBER: nummer }, () => {
      const reihe = nimmTokenReihe();
      return [reihe.tokens[reihe.stelle], reihe.tokens.length];
    }),
  );
  assert.deepEqual(reihenfolge, [[T1, ANZAHL_KONTEN], [T2, ANZAHL_KONTEN], [T3, ANZAHL_KONTEN]]);
});

test("ohne Limit läuft der Prüfer nur mit dem Token an der Startposition", async (context) => {
  const { ergebnis, verwendet } = await pruefeMitReihe(context, { tokens: [T1, T2, T3], start: 1, imLimit: [] });
  assert.equal(ergebnis.zustand, "geprueft");
  assert.deepEqual(verwendet, [T2]);
});

test("meldet der Lauf das 5-Stunden-Limit, wiederholt der Prüfer sofort mit dem nächsten Token", async (context) => {
  const { ergebnis, verwendet } = await pruefeMitReihe(context, { tokens: [T1, T2, T3], start: 0, imLimit: [T1] });
  assert.equal(ergebnis.zustand, "geprueft");
  assert.deepEqual(verwendet, [T1, T2]);
});

test("die Reihe geht ringförmig weiter, wenn die Startposition nicht die erste ist", async (context) => {
  const { ergebnis, verwendet } = await pruefeMitReihe(context, { tokens: [T1, T2, T3], start: 2, imLimit: [T3, T1] });
  assert.equal(ergebnis.zustand, "geprueft");
  assert.deepEqual(verwendet, [T3, T1, T2]);
});

test("Nutzungslimit ist der Status erst, wenn alle vorhandenen Tokens im Limit sind", async (context) => {
  const alle = await pruefeMitReihe(context, { tokens: [T1, T2, T3], imLimit: [T1, T2, T3] });
  assert.deepEqual([alle.ergebnis.zustand, alle.ergebnis.grund], ["nicht_gelaufen", LIMIT_GRUND]);
  assert.deepEqual(alle.verwendet, [T1, T2, T3]);
  const zwei = await pruefeMitReihe(context, { tokens: [T1, T2], imLimit: [T1, T2, T3] });
  assert.deepEqual([zwei.ergebnis.zustand, zwei.ergebnis.grund], ["nicht_gelaufen", LIMIT_GRUND]);
  assert.deepEqual(zwei.verwendet, [T1, T2]);
});

test("ein Token ohne Wert wird übersprungen; fehlen alle, gilt das alte Secret", () => {
  const ohneZwei = mitUmgebung(
    { CLAUDE_CODE_OAUTH_TOKEN_1: T1, CLAUDE_CODE_OAUTH_TOKEN_2: "", CLAUDE_CODE_OAUTH_TOKEN_3: T3, CLAUDE_CODE_OAUTH_TOKEN: ALT },
    () => nimmTokenReihe().tokens,
  );
  assert.deepEqual(ohneZwei, [T1, T3]);
  const nurAlt = mitUmgebung({ CLAUDE_CODE_OAUTH_TOKEN_1: "", CLAUDE_CODE_OAUTH_TOKEN: ALT }, () => nimmTokenReihe().tokens);
  assert.deepEqual(nurAlt, [ALT]);
  const keines = mitUmgebung({}, () => nimmTokenReihe().leer);
  assert.equal(keines, true);
});

test("der Prüfer läuft mit dem alten Secret, solange die Reihe nicht angelegt ist", async (context) => {
  const reihe = mitUmgebung({ CLAUDE_CODE_OAUTH_TOKEN: ALT }, () => nimmTokenReihe());
  const { repo, basis, commit } = einCommit(context);
  const ersatz = ersatzJeToken(context, []);
  const ergebnis = await pruefeCommit(commit, { root: repo.ordner, basis, reihe, programm: ersatz.programm, auftragstext: "", ciLauf: "" });
  assert.equal(ergebnis.zustand, "geprueft");
  assert.deepEqual(ersatz.verwendet(), [ALT]);
});

test("nimmTokenReihe entfernt alle Tokens aus der Umgebung, damit kein Kindprozess sie erbt", () => {
  const uebrig = mitUmgebung({ CLAUDE_CODE_OAUTH_TOKEN_1: T1, CLAUDE_CODE_OAUTH_TOKEN_2: T2, CLAUDE_CODE_OAUTH_TOKEN: ALT }, () => {
    nimmTokenReihe();
    return NAMEN.filter((name) => env[name] !== undefined && name !== "GITHUB_RUN_NUMBER");
  });
  assert.deepEqual(uebrig, []);
});

test("kein Token steht in der Ausgabe des Laufs, auch nicht beim Wechsel", async (context) => {
  const { ausgaben } = await pruefeMitReihe(context, { tokens: [T1, T2, T3], imLimit: [T1, T2] });
  assert.ok(ausgaben.some((zeile) => zeile.includes("Nutzungslimit")));
  assert.deepEqual(
    ausgaben.filter((zeile) => [T1, T2, T3].some((token) => zeile.includes(token))),
    [],
  );
});

test("die Agenten der Ziele wechseln bei Limit ebenfalls das Token und melden Limit erst, wenn alle im Limit sind", async (context) => {
  const lauf = async (imLimit) => {
    const ersatz = ersatzJeToken(context, imLimit);
    const ordner = probeDirectory(context, {});
    context.mock.method(console, "log", () => undefined);
    const ergebnis = await starteAgent({
      root: ordner,
      befehl: [ersatz.programm],
      eingabe: "",
      sekunden: FRIST_ERSATZ_AGENT_SEKUNDEN,
      reihe: new TokenReihe([T1, T2]),
      pruefeAntwort: () => ({ ok: true }),
    });
    return { grund: ergebnis.grund, verwendet: ersatz.verwendet() };
  };
  assert.deepEqual(await lauf([T1]), { grund: "", verwendet: [T1, T2] });
  assert.deepEqual(await lauf([T1, T2]), { grund: LIMIT_GRUND, verwendet: [T1, T2] });
});
