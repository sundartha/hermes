import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, outputLines, probeDirectory, runIn } from "./probe-repo.js";

const PRUEFER = join(REPO_ROOT, "tools/anbieter-datenschutz-pruefen.mjs");
const DATENSCHUTZ_DATEI = "apps/web/src/data/legal/privacy.de.json";
const SPRACHMODELL_ORDNER = "src/llm/adapters";
const SUCH_ORDNER = "src/research/adapters";
const ERGEBNIS_OHNE_LUECKE = 0;
const ERGEBNIS_MIT_LUECKE = 1;
const ERGEBNIS_UNGUELTIGER_AUFRUF = 2;
const ADAPTER_INHALT = "export const adapter = {};\n";

function datenschutzMit(...anbieter) {
  const sections = [{ heading: "Empfaenger", text: `Wir nutzen ${anbieter.join(" und ")}.` }];
  return JSON.stringify({ note: "Stand heute", sections });
}

function miniWurzel(context, { adapter, anbieterImText }) {
  const dateien = { [DATENSCHUTZ_DATEI]: datenschutzMit(...anbieterImText) };
  for (const pfad of adapter) dateien[pfad] = ADAPTER_INHALT;
  dateien[`${SUCH_ORDNER}/notiz.md`] = "kein Adapter\n";
  return probeDirectory(context, dateien);
}

function pruefe(argumente) {
  return runIn(REPO_ROOT, process.execPath, [PRUEFER, ...argumente]);
}

test("das echte Repo nennt jeden gebauten Anbieter-Adapter in der Datenschutzerklaerung", () => {
  const ergebnis = pruefe([]);
  assert.equal(ergebnis.status, ERGEBNIS_OHNE_LUECKE, ergebnis.stdout + ergebnis.stderr);
});

function einzigeMeldung(context, aufbau) {
  const ergebnis = pruefe(["--wurzel", miniWurzel(context, aufbau)]);
  assert.equal(ergebnis.status, ERGEBNIS_MIT_LUECKE, ergebnis.stderr);
  const zeilen = outputLines(ergebnis.stdout);
  assert.equal(zeilen.length, 1, ergebnis.stdout);
  return zeilen[0];
}

test("ein Adapter, dessen Anbieter in der Datenschutzerklaerung fehlt, wird mit Pfad und Anbieter gemeldet", (context) => {
  const meldung = einzigeMeldung(context, {
    adapter: [`${SPRACHMODELL_ORDNER}/anthropic.js`, `${SPRACHMODELL_ORDNER}/deepseek.js`],
    anbieterImText: ["Anthropic"],
  });
  assert.ok(meldung.startsWith(`${SPRACHMODELL_ORDNER}/deepseek.js:1 `), meldung);
  assert.ok(meldung.includes("DeepSeek"), meldung);
});

test("ein Adapter ohne Eintrag in der Anzeigenamen-Karte wird gemeldet", (context) => {
  const meldung = einzigeMeldung(context, {
    adapter: [`${SPRACHMODELL_ORDNER}/anthropic.js`, `${SUCH_ORDNER}/neuer-anbieter.js`],
    anbieterImText: ["Anthropic"],
  });
  assert.ok(meldung.startsWith(`${SUCH_ORDNER}/neuer-anbieter.js:1 `), meldung);
});

test("eine Mini-Wurzel, deren Datenschutzerklaerung alle Anbieter nennt, besteht ohne Meldung", (context) => {
  const wurzel = miniWurzel(context, {
    adapter: [`${SPRACHMODELL_ORDNER}/anthropic.js`, `${SUCH_ORDNER}/exa-search.js`],
    anbieterImText: ["Anthropic", "Exa"],
  });
  const ergebnis = pruefe(["--wurzel", wurzel]);
  assert.equal(ergebnis.status, ERGEBNIS_OHNE_LUECKE, ergebnis.stdout + ergebnis.stderr);
  assert.equal(ergebnis.stdout, "");
});

test("eine unbekannte Option oder eine fehlende Wurzel ist ein ungueltiger Aufruf", (context) => {
  const ordner = probeDirectory(context, {});
  assert.equal(pruefe(["--pfad", "x"]).status, ERGEBNIS_UNGUELTIGER_AUFRUF);
  assert.equal(pruefe(["--wurzel", join(ordner, "fehlt")]).status, ERGEBNIS_UNGUELTIGER_AUFRUF);
});
