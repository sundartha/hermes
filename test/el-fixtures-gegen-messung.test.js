import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { maskNumber } from "../src/util.js";
import {
  CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES,
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_DONE_WITH_DATA_COLLECTION,
  CONVERSATION_FAILED_INVALID_DESTINATION,
  CONVERSATION_IN_PROGRESS,
  HERKUNFT,
} from "./fixtures/elevenlabs-conversations.js";

const MESSUNG_SPIKE1_URL = new URL("../tasks/spike1-messung.jsonl", import.meta.url);
const MESSUNG_SPIKE2_URL = new URL("../tasks/spike2-messung.jsonl", import.meta.url);

const AUSGEDACHT = "ausgedacht";

function messsaetze(url) {
  return readFileSync(url, "utf8")
    .split("\n")
    .filter((zeile) => zeile.trim())
    .map((zeile) => JSON.parse(zeile));
}

const SPIKE1 = messsaetze(MESSUNG_SPIKE1_URL);
const SPIKE2 = messsaetze(MESSUNG_SPIKE2_URL);

const TESTANRUF_1 = SPIKE2.find((satz) => satz.art === "testanruf" && satz.nr === 1);
const NUMMERNWAHL = SPIKE2.find((satz) => satz.art === "nummernwahl");
const IN_PROGRESS_MESSUNG = SPIKE1.find((satz) => satz.art === "in-progress-felder");

function wertAn(objekt, pfad) {
  return pfad.split(".").reduce((knoten, schluessel) => knoten?.[schluessel], objekt);
}

function blattPfade(wert, prefix = []) {
  const istObjekt = wert !== null && typeof wert === "object" && !Array.isArray(wert);
  if (!istObjekt) return prefix.length ? [prefix.join(".")] : [];
  return Object.entries(wert).flatMap(([schluessel, kind]) => blattPfade(kind, [...prefix, schluessel]));
}

const CLOSE_1008_NAME = "CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES";

const AUS_DER_AUFZEICHNUNG = Object.freeze([
  Object.freeze({ fixturePfad: "conversation_id", messfeld: "conversation_id" }),
  Object.freeze({ fixturePfad: "metadata.call_duration_secs", messfeld: "gespraechsdauer_s" }),
  Object.freeze({ fixturePfad: "metadata.termination_reason", messfeld: "termination_reason" }),
]);

const OHNE_AUFZEICHNUNG = Object.freeze(["status", "analysis"]);

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
  for (const feld of OHNE_AUFZEICHNUNG) {
    assert.equal(
      TESTANRUF_1[feld],
      undefined,
      `die Aufzeichnung traegt '${feld}' inzwischen doch - dann ist die Fixture-Annahme durch den echten Wert zu ersetzen`,
    );
    assert.equal(
      HERKUNFT[CLOSE_1008_NAME][feld],
      AUSGEDACHT,
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

const IN_PROGRESS_BELEGE = Object.freeze([
  Object.freeze({ pfad: "status", wert: "in-progress", muster: /status bleibt 'in-progress'/ }),
  Object.freeze({
    pfad: "metadata.call_duration_secs",
    wert: 0,
    muster: /metadata\.call_duration_secs bleibt 0/,
  }),
  Object.freeze({ pfad: "transcript", wert: [], muster: /transcript bleibt leer/ }),
]);

test("Fixture-Abgleich: die drei Felder des IN-PROGRESS-Fundes stehen so in tasks/spike1-messung.jsonl", () => {
  assert.ok(IN_PROGRESS_MESSUNG, "Aufzeichnung ohne Satz 'in-progress-felder' - die Quelle dieses Fundes fehlt");
  assert.equal(IN_PROGRESS_MESSUNG.gemessen, true, "der Satz beansprucht selbst nicht, gemessen zu sein");
  assert.equal(
    CONVERSATION_IN_PROGRESS.conversation_id,
    IN_PROGRESS_MESSUNG.conversation,
    "die Fixture traegt eine andere Kennung als die Messung, aus der sie stammt",
  );
  assert.deepEqual(
    IN_PROGRESS_MESSUNG.geaendert_waehrend_in_progress,
    [],
    "die Messung belegt nicht mehr, dass sich waehrend in-progress KEIN Feld aendert - dann traegt die Fixture keine Herkunft mehr",
  );
  for (const { pfad, wert, muster } of IN_PROGRESS_BELEGE) {
    assert.match(
      IN_PROGRESS_MESSUNG.befund,
      muster,
      `die Messung belegt '${pfad}' nicht mehr - die Aufzeichnung ist das Original, also ist die FIXTURE falsch`,
    );
    assert.deepEqual(wertAn(CONVERSATION_IN_PROGRESS, pfad), wert, `Fixture ${pfad} weicht von der Messung ab`);
  }
});

test("Fixture-Abgleich: was die IN-PROGRESS-Messung nicht hergibt (analysis), ist als ausgedacht gekennzeichnet", () => {
  assert.equal(
    HERKUNFT.CONVERSATION_IN_PROGRESS.analysis,
    AUSGEDACHT,
    "analysis ist fuer diese Kennung nicht gemessen, aber im Fixture-Modul nicht als ausgedacht gekennzeichnet",
  );
});

test("Fixture-Abgleich: der vollstaendig erfundene data_collection-Fund ist als erfunden erkennbar", () => {
  assert.equal(
    HERKUNFT.CONVERSATION_DONE_WITH_DATA_COLLECTION,
    AUSGEDACHT,
    "die Kennzeichnung im Fixture-Modul ist verschwunden - der Fund saehe damit wie eine gemessene Antwort aus",
  );
  assert.match(
    CONVERSATION_DONE_WITH_DATA_COLLECTION.conversation_id,
    /ausgedacht/,
    "auch die Kennung selbst muss den Fund als erfunden ausweisen - sie reist durch Logs und Attrappen, wo kein Kommentar mitfaehrt",
  );
});
