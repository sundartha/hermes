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

function pruefeAdapterMitEndung(context, endung) {
  const ohneKarte = einzigeMeldung(context, {
    adapter: [`${SPRACHMODELL_ORDNER}/anthropic.js`, `${SUCH_ORDNER}/neuer-anbieter${endung}`],
    anbieterImText: ["Anthropic"],
  });
  assert.ok(ohneKarte.startsWith(`${SUCH_ORDNER}/neuer-anbieter${endung}:1 `), ohneKarte);
  const ohneNennung = einzigeMeldung(context, {
    adapter: [`${SPRACHMODELL_ORDNER}/deepseek${endung}`, `${SUCH_ORDNER}/exa-search.js`],
    anbieterImText: ["Exa"],
  });
  assert.ok(ohneNennung.startsWith(`${SPRACHMODELL_ORDNER}/deepseek${endung}:1 `), ohneNennung);
  assert.ok(ohneNennung.includes("DeepSeek"), ohneNennung);
}

test("ein Adapter mit Endung .ts wird wie .js gegen Karte und Datenschutzerklaerung geprueft", (context) => {
  pruefeAdapterMitEndung(context, ".ts");
});

test("ein Adapter mit Endung .mts wird wie .js gegen Karte und Datenschutzerklaerung geprueft", (context) => {
  pruefeAdapterMitEndung(context, ".mts");
});

test("ein Adapter mit Endung .cts wird wie .js gegen Karte und Datenschutzerklaerung geprueft", (context) => {
  pruefeAdapterMitEndung(context, ".cts");
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

test("ein Anzeigename, der nur als Teil eines laengeren Wortes vorkommt, zaehlt nicht als genannt", (context) => {
  for (const wort of ["Exakte Angaben", "Examen", "Exabyte", "Exa2", "Exaäquator", "NetExa", "CaféExa", "Exa\u0308quator", "Cafe\u0301Exa"]) {
    const meldung = einzigeMeldung(context, {
      adapter: [`${SPRACHMODELL_ORDNER}/anthropic.js`, `${SUCH_ORDNER}/exa-search.js`],
      anbieterImText: ["Anthropic", wort],
    });
    assert.ok(meldung.startsWith(`${SUCH_ORDNER}/exa-search.js:1 `), `${wort}: ${meldung}`);
    assert.ok(meldung.includes("Exa"), `${wort}: ${meldung}`);
  }
});

test("ein Anzeigename als eigenes Wort zaehlt als genannt, auch neben Satzzeichen", (context) => {
  for (const wort of ["Exa", "(Exa)", "Exa-Suche", "„Exa“", "Exa,", "Exakte Angaben und Exa"]) {
    const wurzel = miniWurzel(context, {
      adapter: [`${SPRACHMODELL_ORDNER}/anthropic.js`, `${SUCH_ORDNER}/exa-search.js`],
      anbieterImText: ["Anthropic", wort],
    });
    const ergebnis = pruefe(["--wurzel", wurzel]);
    assert.equal(ergebnis.status, ERGEBNIS_OHNE_LUECKE, `${wort}: ${ergebnis.stdout}${ergebnis.stderr}`);
  }
});
