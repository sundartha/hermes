import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFSTART_JOB } from "../../src/begriffe/anrufe.js";
import { makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import { createQueue } from "../../src/queue/registry.ts";
import * as speicher from "../../src/store.js";
import { START_UNKLAR_REASON, failureReasonBase, meldetAlsNichtGestartet } from "../../src/telephony/failure-reason.ts";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const MANDANT = "t_anrufstart_kunde";
const ZIEL = "+4915112340011";
const ABSENDER = "+4930555000401";
const MS_JE_SEKUNDE = 1000;
const FEST_MS = Date.parse("2026-11-17T10:00:00.500Z");
const FRIST_MS = 120 * MS_JE_SEKUNDE;
const ZEHN_MINUTEN_MS = 600 * MS_JE_SEKUNDE;
const VORLAUF_S = 60;

const tokenFuer = (mandant) => (mandant === MANDANT ? "token-kunde" : `token-${mandant}`);
const gespraech = (callee, tenant_token = tokenFuer(MANDANT)) => ({
  conversation_initiation_client_data: { dynamic_variables: { callee, tenant_token } },
});

async function neuerAufbau({ markerVorMs = null, fremdGebunden = null, gestartet = null, anbieter = {}, starteVerhalten, mandantenToken } = {}) {
  const { store: db, runner } = await makePgTestStore();
  await legeMandantAn(db, MANDANT);
  const call = db.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: MANDANT });
  await db.persistCall(call.id);
  const marker = speicher.makePostgresAnrufstartMarker(runner);
  if (markerVorMs !== null)
    await marker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: new Date(FEST_MS - markerVorMs).toISOString() });
  const aufrufe = { starts: [], markerBeimStart: [], listen: [], holen: [], festgehalten: [], beendet: [] };
  const store = {
    leseCall: async (id) => {
      const gelesen = await db.leseCall(id);
      return gelesen && gestartet ? { ...gelesen, elevenlabsConversationId: gestartet } : gelesen;
    },
    load: () => ({
      calls: [...db.load().calls, ...(fremdGebunden ? [{ id: "call-anderer", elevenlabsConversationId: fremdGebunden }] : [])],
    }),
    anderesAnrufMitKonversation: async (id, konv) =>
      konv === fremdGebunden || (await db.anderesAnrufMitKonversation(id, konv)),
    anrufstartMarker: marker,
  };
  const abhaengigkeiten = {
    store,
    starte: async (angelegt) => {
      aufrufe.starts.push(angelegt);
      aufrufe.markerBeimStart.push(await marker.lies(call.id));
      await starteVerhalten?.();
    },
    anbieterGespraeche: {
      liste: async (abfrage) => {
        aufrufe.listen.push(abfrage);
        return { conversations: (anbieter.liste ?? []).map((id) => ({ conversation_id: id })), has_more: anbieter.hatMehr ?? false };
      },
      hole: async (id) => {
        aufrufe.holen.push(id);
        return anbieter.details?.[id] ?? {};
      },
    },
    haltAnrufStartFest: (angelegt, id) => aufrufe.festgehalten.push([angelegt.id, id]),
    beendeStartUnklar: async (id) => {
      aufrufe.beendet.push(id);
    },
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    beendeOhneWahl: async () => {},
    armeTimer: () => {},
    mandantenToken: mandantenToken ?? tokenFuer,
    jetztMs: () => FEST_MS,
  };
  return { call, marker, aufrufe, abhaengigkeiten, auftrag: makeAnrufstartAuftrag(abhaengigkeiten) };
}

async function arbeiteAb(auftrag, payload) {
  const queue = createQueue();
  const id = queue.enqueue({ kind: ANRUFSTART_JOB, payload, idempotencyKey: `anrufstart-${payload?.callId}` });
  const verarbeitet = await queue.drain(auftrag, ANRUFSTART_JOB);
  return { verarbeitet, status: queue.jobStatus(id) };
}

test("Anrufstart-Auftrag: Gutfall startet genau einmal, der Marker steht VOR dem Anbieteraufruf", async () => {
  const { call, marker, aufrufe, auftrag } = await neuerAufbau();
  assert.deepEqual(await arbeiteAb(auftrag, { callId: call.id }), { verarbeitet: 1, status: "done" });
  assert.equal(aufrufe.starts.length, 1);
  assert.deepEqual(aufrufe.markerBeimStart, [new Date(FEST_MS).toISOString()]);
  assert.equal(await marker.lies(call.id), new Date(FEST_MS).toISOString());
  assert.equal(aufrufe.listen.length, 0);
});

test("Anrufstart-Auftrag: Ziel, Absender und Mandant kommen aus dem gespeicherten Anruf, nicht aus dem Auftrag", async () => {
  const { call, aufrufe, auftrag } = await neuerAufbau();
  const fremd = { callId: call.id, to: "+4915199999999", from: "+4930000000", tenantId: "tenant-fremd" };
  await arbeiteAb(auftrag, fremd);
  assert.equal(aufrufe.starts.length, 1);
  const [gestartet] = aufrufe.starts;
  assert.equal(gestartet.id, call.id);
  assert.equal(gestartet.to, ZIEL);
  assert.equal(gestartet.from, ABSENDER);
  assert.equal(gestartet.tenantId, MANDANT);
});

test("Anrufstart-Auftrag: unbekannte, fehlende oder falsch typisierte callId startet nie", async () => {
  const { aufrufe, auftrag, marker } = await neuerAufbau();
  for (const payload of [{ callId: "gibt-es-nicht" }, {}, { callId: "" }, { callId: 7 }, undefined]) {
    assert.equal((await arbeiteAb(auftrag, payload)).status, "failed");
  }
  assert.equal(await auftrag(null).catch(() => "abgelehnt"), "abgelehnt");
  assert.equal(aufrufe.starts.length, 0);
  assert.equal(await marker.lies("gibt-es-nicht"), null);
});

test("Anrufstart-Auftrag: Zeitablauf beim Start, danach nie ein zweiter Start, auch nicht nach Neustart des Workers", async () => {
  const aufbau = await neuerAufbau({
    starteVerhalten: async () => {
      throw new Error("Zeitablauf");
    },
  });
  const erster = await arbeiteAb(aufbau.auftrag, { callId: aufbau.call.id });
  assert.equal(erster.status, "failed");
  assert.equal(aufbau.aufrufe.starts.length, 1);
  assert.ok(await aufbau.marker.lies(aufbau.call.id));
  const neuerWorker = makeAnrufstartAuftrag(aufbau.abhaengigkeiten);
  assert.equal(await neuerWorker({ payload: { callId: aufbau.call.id } }), "offen");
  assert.equal(await aufbau.auftrag({ payload: { callId: aufbau.call.id } }), "offen");
  assert.equal(aufbau.aufrufe.starts.length, 1);
  assert.deepEqual(aufbau.aufrufe.beendet, []);
});

test("Anrufstart-Auftrag: Marker nicht dauerhaft geschrieben, dann wird nicht gewaehlt", async () => {
  const aufbau = await neuerAufbau();
  aufbau.abhaengigkeiten.store.anrufstartMarker = {
    ...aufbau.marker,
    setze: async () => {
      throw new Error("Speicher nicht erreichbar");
    },
  };
  const ergebnis = await arbeiteAb(makeAnrufstartAuftrag(aufbau.abhaengigkeiten), { callId: aufbau.call.id });
  assert.equal(ergebnis.status, "failed");
  assert.equal(aufbau.aufrufe.starts.length, 0);
});

test("Anrufstart-Auftrag: zwei gleichzeitige Auftraege fuer denselben Anruf starten nur einmal", async () => {
  const { call, aufrufe, auftrag } = await neuerAufbau();
  const lauf = () => auftrag({ payload: { callId: call.id } }).then(() => "ok", () => "fehler");
  const ausgaenge = await Promise.all([lauf(), lauf()]);
  assert.equal(aufrufe.starts.length, 1);
  assert.equal(ausgaenge.filter((a) => a === "ok").length, 1);
});

test("Anrufstart-Auftrag: schon gestarteter Anruf wird weder neu gestartet noch abgeglichen", async () => {
  const { call, aufrufe, auftrag } = await neuerAufbau({ markerVorMs: ZEHN_MINUTEN_MS, gestartet: "conv_alt" });
  assert.equal(await auftrag({ payload: { callId: call.id } }), "gestartet");
  assert.equal(aufrufe.starts.length, 0);
  assert.equal(aufrufe.listen.length, 0);
  assert.deepEqual(aufrufe.festgehalten, []);
});

test("Anrufstart-Auftrag: Marker ohne conversation_id, Anbieter kennt das Gespraech, es wird dessen ID festgehalten", async () => {
  const aufbau = await neuerAufbau({
    markerVorMs: ZEHN_MINUTEN_MS,
    fremdGebunden: "conv_belegt",
    anbieter: {
      liste: ["conv_fremdziel", "conv_gefunden", "conv_belegt"],
      details: {
        conv_fremdziel: gespraech("+491700000000"),
        conv_gefunden: gespraech(ZIEL),
        conv_belegt: gespraech(ZIEL),
      },
    },
  });
  assert.equal(await aufbau.auftrag({ payload: { callId: aufbau.call.id } }), "abgeglichen");
  assert.deepEqual(aufbau.aufrufe.festgehalten, [[aufbau.call.id, "conv_gefunden"]]);
  assert.equal(aufbau.aufrufe.starts.length, 0);
  assert.deepEqual(aufbau.aufrufe.beendet, []);
  assert.deepEqual(aufbau.aufrufe.holen.toSorted(), ["conv_fremdziel", "conv_gefunden"]);
  const markerS = Math.floor((FEST_MS - ZEHN_MINUTEN_MS) / MS_JE_SEKUNDE) - VORLAUF_S;
  assert.deepEqual(aufbau.aufrufe.listen, [{ call_start_after_unix: String(markerS), page_size: "50" }]);
});

async function gleicheAb(anbieter, markerVorMs = ZEHN_MINUTEN_MS) {
  const aufbau = await neuerAufbau({ markerVorMs, anbieter });
  const ausgang = await aufbau.auftrag({ payload: { callId: aufbau.call.id } });
  return { ausgang, ...aufbau };
}

function pruefeStartUnklar({ ausgang, call, aufrufe }) {
  assert.equal(ausgang, "unklar");
  assert.deepEqual(aufrufe.beendet, [call.id]);
  assert.equal(aufrufe.starts.length, 0);
  assert.deepEqual(aufrufe.festgehalten, []);
}

test("Anrufstart-Auftrag: Anbieter kennt nach der Abgleichsfrist kein Gespraech, der Anruf endet als Start unklar", async () => {
  pruefeStartUnklar(await gleicheAb({ liste: [] }));
});

test("Anrufstart-Auftrag: Start unklar ist kein Nicht-Gewaehlt, es wird nicht 'keine Kosten' gemeldet", () => {
  assert.equal(START_UNKLAR_REASON, "result-unknown:start-unclear");
  assert.equal(failureReasonBase(START_UNKLAR_REASON), "result-unknown");
  assert.equal(meldetAlsNichtGestartet(START_UNKLAR_REASON), false);
});

test("Anrufstart-Auftrag: zwei passende Gespraeche sind ein Zweifel, es wird nicht gewaehlt und beendet", async () => {
  pruefeStartUnklar(
    await gleicheAb({ liste: ["conv_a", "conv_b"], details: { conv_a: gespraech(ZIEL), conv_b: gespraech(ZIEL) } }),
  );
});

test("Anrufstart-Auftrag: unvollstaendige Gespraechsliste ist ein Zweifel, auch bei einem Treffer", async () => {
  pruefeStartUnklar(await gleicheAb({ liste: ["conv_a"], hatMehr: true, details: { conv_a: gespraech(ZIEL) } }));
});

test("Anrufstart-Auftrag: Gespraech ohne Treffer innerhalb der Abgleichsfrist bleibt offen, der Anruf lebt weiter", async () => {
  const lauf = await gleicheAb({ liste: [] }, 60 * MS_JE_SEKUNDE);
  assert.equal(lauf.ausgang, "offen");
  assert.deepEqual(lauf.aufrufe.beendet, []);
  assert.equal(lauf.aufrufe.starts.length, 0);
});

test("Anrufstart-Auftrag: genau an der Abgleichsfrist (120 s) wird beendet, eine Millisekunde davor nicht", async () => {
  assert.equal((await gleicheAb({ liste: [] }, FRIST_MS - 1)).ausgang, "offen");
  assert.equal((await gleicheAb({ liste: [] }, FRIST_MS)).ausgang, "unklar");
});

test("Anrufstart-Auftrag: ein Treffer nach der Abgleichsfrist zaehlt noch als Fund", async () => {
  const lauf = await gleicheAb({ liste: ["conv_a"], details: { conv_a: gespraech(ZIEL) } }, 500 * MS_JE_SEKUNDE);
  assert.equal(lauf.ausgang, "abgeglichen");
  assert.deepEqual(lauf.aufrufe.festgehalten, [[lauf.call.id, "conv_a"]]);
});

test("Anrufstart-Auftrag: Gespraech eines anderen Mandanten an dieselbe Nummer wird nicht festgehalten", async () => {
  const lauf = await gleicheAb(
    { liste: ["conv_fremd"], details: { conv_fremd: gespraech(ZIEL, tokenFuer("t_anderer_kunde")) } },
    FRIST_MS - 1,
  );
  assert.equal(lauf.ausgang, "offen");
  assert.deepEqual(lauf.aufrufe.festgehalten, []);
  assert.deepEqual(lauf.aufrufe.beendet, []);
  assert.equal(lauf.aufrufe.starts.length, 0);
});

test("Anrufstart-Auftrag: Gespraech ohne Mandanten-Kennzeichen wird nicht festgehalten, nach der Frist endet der Anruf als Start unklar", async () => {
  pruefeStartUnklar(
    await gleicheAb({ liste: ["conv_ohne"], details: { conv_ohne: gespraech(ZIEL, null) } }, ZEHN_MINUTEN_MS),
  );
});

test("Anrufstart-Auftrag: ohne ableitbares Mandanten-Kennzeichen passt kein Gespraech, auch keines mit leerem Kennzeichen", async () => {
  const aufbau = await neuerAufbau({
    markerVorMs: ZEHN_MINUTEN_MS,
    mandantenToken: () => "",
    anbieter: { liste: ["conv_leer"], details: { conv_leer: gespraech(ZIEL, "") } },
  });
  assert.equal(await aufbau.auftrag({ payload: { callId: aufbau.call.id } }), "unklar");
  assert.deepEqual(aufbau.aufrufe.festgehalten, []);
});

function mitAnbieter(aufbau, { liste, hole }) {
  const anbieterGespraeche = {
    liste: async () => liste,
    hole: async (id) => {
      aufbau.aufrufe.holen.push(id);
      return hole(id);
    },
  };
  return makeAnrufstartAuftrag({ ...aufbau.abhaengigkeiten, anbieterGespraeche });
}

const ZWEIFELSFAELLE = [
  ["null", null],
  ["leeres Objekt", {}],
  ["ohne dynamic_variables", { conversation_initiation_client_data: {} }],
  ["Daten null", { conversation_initiation_client_data: null }],
];

for (const [name, antwort] of ZWEIFELSFAELLE) {
  for (const [vorMs, erwartet] of [[FRIST_MS - 1, "offen"], [FRIST_MS, "unklar"]]) {
    test(`Anrufstart-Auftrag: Anbieter liefert ${name} zum Gespraech, nichts wird festgehalten (${erwartet})`, async () => {
      const aufbau = await neuerAufbau({ markerVorMs: vorMs });
      const auftrag = mitAnbieter(aufbau, {
        liste: { conversations: [{ conversation_id: "conv_x" }], has_more: false },
        hole: () => antwort,
      });
      assert.equal(await auftrag({ payload: { callId: aufbau.call.id } }), erwartet);
      assert.deepEqual(aufbau.aufrufe.holen, ["conv_x"]);
      assert.deepEqual(aufbau.aufrufe.festgehalten, []);
      assert.deepEqual(aufbau.aufrufe.beendet, erwartet === "unklar" ? [aufbau.call.id] : []);
    });
  }
}

for (const [name, liste] of [["null", null], ["leeres Objekt", {}]]) {
  for (const [vorMs, erwartet] of [[FRIST_MS - 1, "offen"], [FRIST_MS, "unklar"]]) {
    test(`Anrufstart-Auftrag: Gespraechsliste ${name}, es wird nichts geholt oder festgehalten (${erwartet})`, async () => {
      const aufbau = await neuerAufbau({ markerVorMs: vorMs });
      const auftrag = mitAnbieter(aufbau, { liste, hole: () => gespraech(ZIEL) });
      assert.equal(await auftrag({ payload: { callId: aufbau.call.id } }), erwartet);
      assert.deepEqual(aufbau.aufrufe.holen, []);
      assert.deepEqual(aufbau.aufrufe.festgehalten, []);
      assert.deepEqual(aufbau.aufrufe.beendet, erwartet === "unklar" ? [aufbau.call.id] : []);
    });
  }
}

test("Anrufstart-Auftrag: zwei passende Gespraeche innerhalb der Abgleichsfrist sind schon Start unklar", async () => {
  pruefeStartUnklar(
    await gleicheAb(
      { liste: ["conv_a", "conv_b"], details: { conv_a: gespraech(ZIEL), conv_b: gespraech(ZIEL) } },
      FRIST_MS - 1,
    ),
  );
});

test("Anrufstart-Auftrag: ein Treffer bei unvollstaendiger Liste innerhalb der Abgleichsfrist ist Start unklar", async () => {
  pruefeStartUnklar(
    await gleicheAb({ liste: ["conv_a"], hatMehr: true, details: { conv_a: gespraech(ZIEL) } }, FRIST_MS - 1),
  );
});

test("Anrufstart-Auftrag: ohne Auftrag oder mit unbekanntem Anruf lautet die Meldung 'Auftrag ohne bekannten Anruf'", async () => {
  const { auftrag } = await neuerAufbau();
  await assert.rejects(auftrag(null), /Auftrag ohne bekannten Anruf/);
  await assert.rejects(auftrag({ payload: { callId: "gibt-es-nicht" } }), /Auftrag ohne bekannten Anruf/);
});

test("Anrufstart-Auftrag: ist der Marker beim Setzen schon da, nennt die Ablehnung 'Start schon versucht' und den Anruf", async () => {
  const aufbau = await neuerAufbau({ markerVorMs: ZEHN_MINUTEN_MS });
  const store = { ...aufbau.abhaengigkeiten.store, anrufstartMarker: { ...aufbau.marker, lies: async () => null } };
  const auftrag = makeAnrufstartAuftrag({ ...aufbau.abhaengigkeiten, store });
  await assert.rejects(
    auftrag({ payload: { callId: aufbau.call.id } }),
    (fehler) => fehler.message.includes("Start schon versucht") && fehler.message.includes(aufbau.call.id),
  );
  assert.equal(aufbau.aufrufe.starts.length, 0);
});

test("Anrufstart-Auftrag: bekommt der eigene Anruf waehrend des Abgleichs seine Gespraechs-ID, gilt das Gespraech als frei und wird festgehalten", async () => {
  const aufbau = await neuerAufbau({ markerVorMs: FRIST_MS - MS_JE_SEKUNDE });
  let gebunden = false;
  const ausgangsStore = aufbau.abhaengigkeiten.store;
  const mitBindung = (eintrag) =>
    gebunden && eintrag.id === aufbau.call.id ? { ...eintrag, elevenlabsConversationId: "conv_a" } : eintrag;
  const store = { ...ausgangsStore, load: () => ({ calls: ausgangsStore.load().calls.map(mitBindung) }) };
  const anbieterGespraeche = {
    liste: async () => {
      gebunden = true;
      return { conversations: [{ conversation_id: "conv_a" }], has_more: false };
    },
    hole: async () => gespraech(ZIEL),
  };
  const auftrag = makeAnrufstartAuftrag({ ...aufbau.abhaengigkeiten, store, anbieterGespraeche });
  assert.equal(await auftrag({ payload: { callId: aufbau.call.id } }), "abgeglichen");
  assert.deepEqual(aufbau.aufrufe.festgehalten, [[aufbau.call.id, "conv_a"]]);
  assert.deepEqual(aufbau.aufrufe.beendet, []);
});
