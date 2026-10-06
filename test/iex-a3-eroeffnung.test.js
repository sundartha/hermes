import { test } from "node:test";
import assert from "node:assert/strict";

import { msSeitAnnahme } from "../src/elevenlabs/inbound-rueckfall.js";
import { INBOUND_NOTICES, hasInboundNotice } from "../src/i18n/inbound-notice.js";
import { EROEFFNUNG_DEFEKT, EROEFFNUNG_VARIANTE, inboundEroeffnungDefekte } from "../src/i18n/inbound-opening.js";
import { LOCALES } from "../src/i18n/locales.js";

const OWNER_NAME = "Jonas Beispiel";
const SPRACHEN = Object.freeze(["de", "en", "fr"]);

const EROEFFNUNG_MIT_NAME = Object.freeze({
  de: "Hallo, hier ist der KI-Assistent von Jonas Beispiel. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?",
  en: "Hello, this is Jonas Beispiel's AI assistant. This call is transcribed and summarised. How can I help?",
  fr: "Bonjour, ici l'assistant IA de Jonas Beispiel. Cet appel est transcrit et résumé. Comment puis-je aider ?",
});

const EROEFFNUNG_OHNE_NAME = Object.freeze({
  de: "Hallo, hier ist ein KI-Assistent. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?",
  en: "Hello, this is an AI assistant. This call is transcribed and summarised. How can I help?",
  fr: "Bonjour, ici un assistant IA. Cet appel est transcrit et résumé. Comment puis-je aider ?",
});

const NAME_MIT_RAND = `  ${OWNER_NAME}  `;
const OHNE_NAMEN = Object.freeze(["", "   ", null, undefined]);
const NAMEN_ALLER_FORMEN = Object.freeze([OWNER_NAME, "", "  "]);
const NICHT_STRINGS = Object.freeze([null, undefined, Number.NaN, Object.freeze({})]);
const LEERZEICHEN = " ";

test("IEX-A3-1: Wortlaut (Owner-Entscheidung 9) byte-genau je Sprache, mit und ohne Namen", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    assert.equal(bundle.inboundEroeffnung(OWNER_NAME), EROEFFNUNG_MIT_NAME[sprache], sprache);
    assert.equal(bundle.inboundEroeffnung(NAME_MIT_RAND), EROEFFNUNG_MIT_NAME[sprache], `${sprache} Rand`);
    for (const ohne of OHNE_NAMEN)
      assert.equal(bundle.inboundEroeffnung(ohne), EROEFFNUNG_OHNE_NAME[sprache], `${sprache} ${JSON.stringify(ohne)}`);
  }
});

test("IEX-A3-2: Zusammensetzung - Grusssatz, Eroeffnungs-Hinweis woertlich, Frage; inboundNotice unberuehrt", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    assert.equal(bundle.inboundNotice, INBOUND_NOTICES[sprache], sprache);
    for (const name of [OWNER_NAME, ""]) {
      const fall = `${sprache} ${JSON.stringify(name)}`;
      const text = bundle.inboundEroeffnung(name);
      const kopf = `${bundle.inboundGrussSatz(name)} ${bundle.inboundHinweisSatz}`;
      assert.ok(text.startsWith(kopf), fall);
      const frage = text.slice(kopf.length);
      assert.ok(frage.startsWith(LEERZEICHEN), fall);
      assert.ok(frage.trim().endsWith("?"), fall);
      assert.equal(hasInboundNotice(text), true, fall);
    }
  }
});

const DE = LOCALES.de;
const defekteFuer = ({ text, bundle = DE, ownerName = OWNER_NAME }) =>
  inboundEroeffnungDefekte({ text, bundle, ownerName, variante: EROEFFNUNG_VARIANTE.FREMD });

test("IEX-A3-3: Riegel-Tabelle - echte Eroeffnung sicher, (a) bis (d) je genau ihr Defekt, Nicht-String fail-closed", () => {
  for (const sprache of SPRACHEN)
    for (const ownerName of NAMEN_ALLER_FORMEN) {
      const bundle = LOCALES[sprache];
      assert.deepEqual(defekteFuer({ text: bundle.inboundEroeffnung(ownerName), bundle, ownerName }), [], `${sprache} ${JSON.stringify(ownerName)}`);
    }

  assert.deepEqual(defekteFuer({ text: DE.inboundEroeffnung("Anna"), ownerName: "Jonas" }), [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT]);

  const umformuliert = DE.inboundEroeffnung(OWNER_NAME).replace("zusammengefasst", "gespeichert");
  assert.deepEqual(defekteFuer({ text: umformuliert }), [EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT]);

  const ohneTranskription = { ...DE, inboundHinweisSatz: "Hier spricht eine KI." };
  const textOhneTranskription = `${ohneTranskription.inboundGrussSatz(OWNER_NAME)} ${ohneTranskription.inboundHinweisSatz} Wie kann ich helfen?`;
  assert.deepEqual(defekteFuer({ text: textOhneTranskription, bundle: ohneTranskription }), [EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN]);

  const platzhalterName = "Jonas {{x}}";
  assert.deepEqual(defekteFuer({ text: DE.inboundEroeffnung(platzhalterName), ownerName: platzhalterName }), [EROEFFNUNG_DEFEKT.PLATZHALTER]);

  for (const text of NICHT_STRINGS)
    assert.deepEqual(
      defekteFuer({ text }),
      [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT, EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT, EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN],
      String(text),
    );
});

const JETZT_MS = Date.parse("2026-09-15T10:00:00.000Z");
const ANNAHME_VOR_MS = 1500;

test("IEX-A3-4: msSeitAnnahme - Differenz zu answeredAt, null ohne Anruf, ohne oder mit unlesbarem answeredAt", () => {
  const angenommen = { answeredAt: new Date(JETZT_MS - ANNAHME_VOR_MS).toISOString() };
  assert.equal(msSeitAnnahme(angenommen, JETZT_MS), ANNAHME_VOR_MS);
  assert.equal(msSeitAnnahme({}, JETZT_MS), null);
  assert.equal(msSeitAnnahme({ answeredAt: "kein-datum" }, JETZT_MS), null);
  assert.equal(msSeitAnnahme(null, JETZT_MS), null);
});
