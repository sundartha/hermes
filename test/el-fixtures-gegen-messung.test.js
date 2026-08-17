// ---- Die AUFZEICHNUNG ist die Quelle, das Fixture-Modul nur ihre Abschrift -------------
// Owner-Regel (17.08.2026, woertlich): "Keine erfundene Anbieter-Antwort, wo eine echte
// aufgezeichnet ist. Gibt es keine, schreib in den Test, dass das Verhalten ausgedacht
// ist."
//
// WARUM DIESE DATEI: test/fixtures/elevenlabs-conversations.js ist eine ABSCHRIFT echter
// Messungen. Eine Abschrift kann still von ihrer Quelle abweichen - ab dann bewachen alle
// Tests, die sie benutzen, nur noch unsere eigene Behauptung statt der Anbieter-Wahrheit.
// Genau dieser Fehlertyp hat beim Rueckfrage-Webhook zugeschlagen: ueber zwanzig gruene
// Tests, und in Produktion haette jeder Aufruf 404 geliefert.
//
// RICHTUNG DER WAHRHEIT: die Messdateien unter tasks/ werden NIE umgeschrieben. Weicht die
// Fixture von der Messung ab, ist die FIXTURE falsch, nicht die Messung.
//
// REICHWEITE, ehrlich benannt: genau EIN Fund des Moduls stammt aus einer Messdatei, die
// im Repo liegt (CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES <- tasks/spike2-messung.
// jsonl, testanruf nr.1). Die uebrigen Funde (ERROR_ENVELOPES, FAILED, DONE) sind am
// 15.08.2026 ECHT gemessen, ihre Rohantworten lagen aber nur im Scratchpad der
// Mess-Sitzung und NIE im Repo (s. Modulkopf des Fixture-Moduls) - fuer sie gibt es hier
// nichts zu vergleichen ausser der EINEN Angabe, die auch aufgezeichnet ist: die gewaehlte
// DID. tasks/spike1-messung.jsonl und tasks/spike1b-messung.jsonl tragen ueberhaupt keine
// Anbieter-Antwort, die dieses Modul abschreibt (sie messen Werkzeug-Wartezeiten und
// Agenten-Konfiguration) - sie kommen hier deshalb nicht vor.
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (package.json
// config.i18nCatalogPattern / config.abnahmePattern), sonst landen sie in der falschen
// Testbank (Lehre catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { maskNumber } from "../src/util.js";
import {
  CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES,
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_DONE_WITH_DATA_COLLECTION,
  CONVERSATION_FAILED_INVALID_DESTINATION,
} from "./fixtures/elevenlabs-conversations.js";

const MESSUNG_SPIKE2_URL = new URL("../tasks/spike2-messung.jsonl", import.meta.url);
const FIXTURE_QUELLE_URL = new URL("./fixtures/elevenlabs-conversations.js", import.meta.url);

// Kennzeichnung, mit der das Fixture-Modul eine NICHT gemessene Aussage ausweisen muss.
// Beide Schreibweisen des Bestands sind zugelassen ("AUSGEDACHT" und "NICHT gemessen" /
// "NICHT direkt gemessen") - der Test erzwingt die Kennzeichnung, nicht ihren Wortlaut.
const AUSGEDACHT_MARKER = /AUSGEDACHT|NICHT\s+(?:direkt\s+)?gemessen/i;

function messsaetze(url) {
  return readFileSync(url, "utf8")
    .split("\n")
    .filter((zeile) => zeile.trim())
    .map((zeile) => JSON.parse(zeile));
}

const SPIKE2 = messsaetze(MESSUNG_SPIKE2_URL);
const FIXTURE_QUELLTEXT = readFileSync(FIXTURE_QUELLE_URL, "utf8");

// Ueber die Sachmerkmale gesucht, NICHT ueber die Zeilennummer: eine neue Zeile in der
// Aufzeichnung darf diesen Test nicht verschieben.
const TESTANRUF_1 = SPIKE2.find((satz) => satz.art === "testanruf" && satz.nr === 1);
const NUMMERNWAHL = SPIKE2.find((satz) => satz.art === "nummernwahl");

// Punktgetrennter Lesepfad - haelt die Tabellen unten datengetrieben und die Zugriffe
// flach (G36).
function wertAn(objekt, pfad) {
  return pfad.split(".").reduce((knoten, schluessel) => knoten?.[schluessel], objekt);
}

// Alle BLATT-Pfade eines Fixture-Datensatzes, punktgetrennt. "Blatt" = alles, was kein
// einfaches Objekt ist; ein Array zaehlt selbst als Blatt (transcript:[] ist EINE Aussage,
// keine Sammlung von Aussagen).
function blattPfade(wert, prefix = []) {
  const istObjekt = wert !== null && typeof wert === "object" && !Array.isArray(wert);
  if (!istObjekt) return prefix.length ? [prefix.join(".")] : [];
  return Object.entries(wert).flatMap(([schluessel, kind]) => blattPfade(kind, [...prefix, schluessel]));
}

// Der Quelltext EINES Exports plus des Kommentarblocks unmittelbar darueber. Beides aus
// einer Funktion (G5): die Kennzeichnung "ausgedacht" steht im Bestand mal als
// Zeilenkommentar am Feld, mal im Block ueber dem Export - geprueft werden muss beides.
function exportQuelltext(name) {
  const zeilen = FIXTURE_QUELLTEXT.split("\n");
  const start = zeilen.findIndex((zeile) => zeile.startsWith(`export const ${name} =`));
  if (start < 0) return { kommentar: "", zeilen: [] };
  const kommentar = [];
  for (let i = start - 1; i >= 0 && zeilen[i].startsWith("//"); i -= 1) kommentar.unshift(zeilen[i]);
  const ende = zeilen.findIndex((zeile, index) => index > start && zeile.startsWith("});"));
  return { kommentar: kommentar.join("\n"), zeilen: zeilen.slice(start, ende + 1) };
}

const feldZeile = (quelltext, feld) =>
  quelltext.zeilen.find((zeile) => zeile.trim().startsWith(`${feld}:`));

const CLOSE_1008_NAME = "CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES";

// ---- Die Aussagen des CLOSE-1008-Fundes, die AUS DER AUFZEICHNUNG stammen -------------
// Fixture-Pfad -> wie derselbe Wert in tasks/spike2-messung.jsonl heisst.
const AUS_DER_AUFZEICHNUNG = Object.freeze([
  Object.freeze({ fixturePfad: "conversation_id", messfeld: "conversation_id" }),
  Object.freeze({ fixturePfad: "metadata.call_duration_secs", messfeld: "gespraechsdauer_s" }),
  Object.freeze({ fixturePfad: "metadata.termination_reason", messfeld: "termination_reason" }),
]);

// ---- Die Aussagen, fuer die die Aufzeichnung SCHWEIGT --------------------------------
// Der volle GET-Rumpf wurde fuer diesen Anruf nie mitgeschrieben, nur die Telnyx-/
// WebSocket-Ereignisfelder. Beide Angaben sind deshalb Annahmen und muessen als solche
// gekennzeichnet sein.
const OHNE_AUFZEICHNUNG = Object.freeze(["status", "analysis"]);

// Das leere Transkript ist die dritte Herkunftsart: nicht woertlich abgeschrieben, aber
// auch nicht erfunden - es folgt zwingend aus einem gemessenen Feld.
const ABGELEITET = Object.freeze(["transcript"]);

test("Fixture-Abgleich: die aufgezeichneten Felder des CLOSE-1008-Fundes stehen woertlich so in tasks/spike2-messung.jsonl", () => {
  assert.ok(TESTANRUF_1, "Aufzeichnung ohne testanruf nr.1 - die Quelle dieses Fundes fehlt");
  assert.equal(TESTANRUF_1.gemessen, true, "der Satz beansprucht selbst nicht, gemessen zu sein");

  for (const { fixturePfad, messfeld } of AUS_DER_AUFZEICHNUNG) {
    assert.deepEqual(
      wertAn(CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES, fixturePfad),
      TESTANRUF_1[messfeld],
      `Fixture ${fixturePfad} weicht von der Aufzeichnung (${messfeld}) ab - die Aufzeichnung ist das Original, also ist die FIXTURE falsch`,
    );
  }
});

test("Fixture-Abgleich: das leere Transkript des CLOSE-1008-Fundes deckt sich mit agent_redet:false der Aufzeichnung", () => {
  assert.equal(
    TESTANRUF_1.agent_redet,
    false,
    "die Aufzeichnung belegt nicht mehr, dass der Agent nie zu Wort kam - dann traegt das leere Transkript der Fixture keine Herkunft mehr",
  );
  assert.deepEqual(
    CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES.transcript,
    [],
    "agent_redet:false laesst nur ein leeres Transkript zu",
  );
});

test("Fixture-Abgleich: was die Aufzeichnung NICHT hergibt, traegt im Fixture-Modul die Kennzeichnung 'ausgedacht'", () => {
  const quelltext = exportQuelltext(CLOSE_1008_NAME);
  assert.ok(quelltext.zeilen.length, `Export ${CLOSE_1008_NAME} im Fixture-Modul nicht gefunden`);

  for (const feld of OHNE_AUFZEICHNUNG) {
    // Erst die Voraussetzung: die Kennzeichnung waere eine Luege, wenn die Aufzeichnung
    // den Wert doch traegt (dann muesste die Fixture ihn abschreiben statt annehmen).
    assert.equal(
      TESTANRUF_1[feld],
      undefined,
      `die Aufzeichnung traegt '${feld}' inzwischen doch - dann ist die Fixture-Annahme durch den echten Wert zu ersetzen`,
    );
    assert.match(
      feldZeile(quelltext, feld) ?? "",
      AUSGEDACHT_MARKER,
      `${CLOSE_1008_NAME}.${feld} ist nicht gemessen, aber im Fixture-Modul nicht als ausgedacht gekennzeichnet`,
    );
  }
});

test("Fixture-Abgleich: jedes Feld des CLOSE-1008-Fundes hat eine Herkunft - gemessen, abgeleitet oder ausdruecklich ausgedacht", () => {
  const belegt = new Set([
    ...AUS_DER_AUFZEICHNUNG.map((eintrag) => eintrag.fixturePfad),
    ...OHNE_AUFZEICHNUNG,
    ...ABGELEITET,
  ]);
  const ohneHerkunft = blattPfade(CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES).filter(
    (pfad) => !belegt.has(pfad),
  );
  assert.deepEqual(
    ohneHerkunft,
    [],
    "diese Felder sind ohne Herkunft in die Fixture gekommen - jedes gehoert entweder in die Abgleich-Tabelle oben oder als ausgedacht gekennzeichnet",
  );
});

test("Fixture-Abgleich: die agent_number der beiden 15.08.-Funde ist die maskierte DID aus tasks/spike2-messung.jsonl", () => {
  assert.ok(NUMMERNWAHL, "Aufzeichnung ohne Satz 'nummernwahl' - die gewaehlte DID fehlt");
  const maskierteDid = maskNumber(NUMMERNWAHL.gewaehlte_did);

  for (const fund of [CONVERSATION_FAILED_INVALID_DESTINATION, CONVERSATION_DONE_WITH_ANALYSIS]) {
    assert.equal(
      wertAn(fund, "metadata.phone_call.agent_number"),
      maskierteDid,
      `${fund.conversation_id}: die Fixture nennt einen anderen Absender als die Aufzeichnung (${NUMMERNWAHL.gewaehlte_did}, maskiert)`,
    );
  }
});

test("Fixture-Abgleich: der vollstaendig erfundene data_collection-Fund ist als erfunden erkennbar", () => {
  // Kein Gegenstueck in irgendeiner Messdatei (analysis.data_collection_results wurde nie
  // aufgezeichnet) - dieser Fund darf deshalb nie wie eine gemessene Antwort aussehen.
  assert.match(
    exportQuelltext("CONVERSATION_DONE_WITH_DATA_COLLECTION").kommentar,
    AUSGEDACHT_MARKER,
    "die Kennzeichnung ueber dem Export ist verschwunden - der Fund saehe damit wie eine gemessene Antwort aus",
  );
  assert.match(
    CONVERSATION_DONE_WITH_DATA_COLLECTION.conversation_id,
    /ausgedacht/,
    "auch die Kennung selbst muss den Fund als erfunden ausweisen - sie reist durch Logs und Attrappen, wo kein Kommentar mitfaehrt",
  );
});
