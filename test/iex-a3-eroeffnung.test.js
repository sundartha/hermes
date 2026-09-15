// ---- IEX-A3: Ein-Satz-Eroeffnung mit Riegel (rein, offline) ----------------------------------
// Die Eroeffnung des EL-Agenten bei einem eingehenden Anruf ist EIN fester Satz: Namenssatz mit
// KI-Kennzeichnung + unveraenderter Inbound-Hinweis + Frage (O1/O4). Der Riegel
// (i18n/inbound-opening.js) prueft die Bausteine, die der Anrufer hoeren MUSS (E3).
//
// Die Literale stehen hier im Test und werden NICHT aus dem Bundle abgeleitet - sonst bestuende
// ein veraenderter Wortlaut seinen eigenen Test.
// Namen beginnen mit "IEX-A3-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";

import { msSeitAnnahme } from "../src/elevenlabs/inbound-rueckfall.js";
import { INBOUND_NOTICES, hasInboundNotice } from "../src/i18n/inbound-notice.js";
import { EROEFFNUNG_DEFEKT, inboundEroeffnungDefekte } from "../src/i18n/inbound-opening.js";
import { LOCALES } from "../src/i18n/locales.js";

const OWNER_NAME = "Jonas Beispiel";
const SPRACHEN = Object.freeze(["de", "en", "fr"]);

const EROEFFNUNG_MIT_NAME = Object.freeze({
  de: "Hier ist der KI-Assistent von Jonas Beispiel. Hinweis: Sie sprechen mit einer KI, das Gespräch wird transkribiert und zusammengefasst. Wie kann ich Ihnen weiterhelfen?",
  en: "This is Jonas Beispiel's AI assistant. Please note: you are speaking to an AI, and this call is transcribed and summarised. How can I help you?",
  fr: "Ici l'assistant IA de Jonas Beispiel. Information : vous parlez à une IA, cet appel est transcrit et résumé. Comment puis-je vous aider ?",
});

const EROEFFNUNG_OHNE_NAME = Object.freeze({
  de: "Hier ist ein KI-Assistent. Hinweis: Sie sprechen mit einer KI, das Gespräch wird transkribiert und zusammengefasst. Wie kann ich Ihnen weiterhelfen?",
  en: "This is an AI assistant. Please note: you are speaking to an AI, and this call is transcribed and summarised. How can I help you?",
  fr: "Ici un assistant IA. Information : vous parlez à une IA, cet appel est transcrit et résumé. Comment puis-je vous aider ?",
});

const NAME_MIT_RAND = `  ${OWNER_NAME}  `;
const OHNE_NAMEN = Object.freeze(["", "   ", null, undefined]);
const NAMEN_ALLER_FORMEN = Object.freeze([OWNER_NAME, "", "  "]);
const NICHT_STRINGS = Object.freeze([null, undefined, Number.NaN, Object.freeze({})]);
const LEERZEICHEN = " ";

// ---- IEX-A3-1/2: Wortlaut und Zusammensetzung ------------------------------------------------

test("IEX-A3-1: Wortlaut O1/O4 byte-genau je Sprache, mit und ohne Namen", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    assert.equal(bundle.inboundEroeffnung(OWNER_NAME), EROEFFNUNG_MIT_NAME[sprache], sprache);
    assert.equal(bundle.inboundEroeffnung(NAME_MIT_RAND), EROEFFNUNG_MIT_NAME[sprache], `${sprache} Rand`);
    for (const ohne of OHNE_NAMEN)
      assert.equal(bundle.inboundEroeffnung(ohne), EROEFFNUNG_OHNE_NAME[sprache], `${sprache} ${JSON.stringify(ohne)}`);
  }
});

test("IEX-A3-2: Zusammensetzung - Namenssatz, unveraenderter Hinweis, Frage wie greetingVariants[1]; ein Namenssatz fuer Eroeffnung und Fehlersatz", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    assert.equal(bundle.inboundNotice, INBOUND_NOTICES[sprache], sprache);
    for (const name of [OWNER_NAME, ""]) {
      const fall = `${sprache} ${JSON.stringify(name)}`;
      const text = bundle.inboundEroeffnung(name);
      const kopf = `${bundle.inboundNameSatz(name)} ${bundle.inboundNotice}`;
      assert.ok(text.startsWith(kopf), fall);
      const frage = text.slice(kopf.length);
      assert.ok(frage.startsWith(LEERZEICHEN), fall);
      assert.ok(bundle.greetingVariants[1].endsWith(frage), fall);
      assert.equal(hasInboundNotice(text), true, fall);
      assert.ok(bundle.inboundFehlersatz(name).startsWith(bundle.inboundNameSatz(name)), fall);
    }
  }
});

// ---- IEX-A3-3: Riegel ----------------------------------------------------------------------

const DE = LOCALES.de;
const defekteFuer = ({ text, bundle = DE, ownerName = OWNER_NAME }) => inboundEroeffnungDefekte({ text, bundle, ownerName });

test("IEX-A3-3: Riegel-Tabelle - echte Eroeffnung sicher, (a) bis (d) je genau ihr Defekt, Nicht-String fail-closed", () => {
  for (const sprache of SPRACHEN)
    for (const ownerName of NAMEN_ALLER_FORMEN) {
      const bundle = LOCALES[sprache];
      assert.deepEqual(defekteFuer({ text: bundle.inboundEroeffnung(ownerName), bundle, ownerName }), [], `${sprache} ${JSON.stringify(ownerName)}`);
    }

  // (a) anderer Name im Text als am Tenant.
  assert.deepEqual(defekteFuer({ text: DE.inboundEroeffnung("Anna"), ownerName: "Jonas" }), [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT]);

  // (b) Wortlaut veraendert, die Merkmale (KI + Transkription) bleiben erfuellt.
  const umformuliert = DE.inboundEroeffnung(OWNER_NAME).replace("zusammengefasst", "gespeichert");
  assert.deepEqual(defekteFuer({ text: umformuliert }), [EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT]);

  // (c) ein Hinweis ohne Transkriptions-Merkmal, woertlich im Text.
  const ohneTranskription = { ...DE, inboundNotice: "Hinweis: Sie sprechen mit einer KI." };
  const textOhneTranskription = `${ohneTranskription.inboundNameSatz(OWNER_NAME)} ${ohneTranskription.inboundNotice} Wie kann ich Ihnen weiterhelfen?`;
  assert.deepEqual(defekteFuer({ text: textOhneTranskription, bundle: ohneTranskription }), [EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN]);

  // (d) Platzhalter-Syntax des Anbieters im Namen.
  const platzhalterName = "Jonas {{x}}";
  assert.deepEqual(defekteFuer({ text: DE.inboundEroeffnung(platzhalterName), ownerName: platzhalterName }), [EROEFFNUNG_DEFEKT.PLATZHALTER]);

  for (const text of NICHT_STRINGS)
    assert.deepEqual(
      defekteFuer({ text }),
      [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT, EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT, EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN],
      String(text),
    );
});

// ---- IEX-A3-4: Kalibrierzeile ----------------------------------------------------------------

const JETZT_MS = Date.parse("2026-09-15T10:00:00.000Z");
const ANNAHME_VOR_MS = 1500;

test("IEX-A3-4: msSeitAnnahme - Differenz zu answeredAt, null ohne Anruf, ohne oder mit unlesbarem answeredAt", () => {
  const angenommen = { answeredAt: new Date(JETZT_MS - ANNAHME_VOR_MS).toISOString() };
  assert.equal(msSeitAnnahme(angenommen, JETZT_MS), ANNAHME_VOR_MS);
  assert.equal(msSeitAnnahme({}, JETZT_MS), null);
  assert.equal(msSeitAnnahme({ answeredAt: "kein-datum" }, JETZT_MS), null);
  assert.equal(msSeitAnnahme(null, JETZT_MS), null);
});
