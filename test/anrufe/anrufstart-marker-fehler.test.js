import assert from "node:assert/strict";
import { test } from "node:test";

import * as auftragsModul from "../../src/elevenlabs/anrufstart-auftrag.ts";
import { makeAnrufstartMarker } from "../../src/store.js";

const { ANRUFSTART_AUSGANG, ANRUFSTART_GRUND, makeAnrufstartAuftrag } = auftragsModul;

const ANGELEGT_MS = Date.parse("2026-11-18T10:00:00.000Z");
const CALL_ID = "call_marker_1";

function aufbau({ markerFehler = null } = {}) {
  const spur = [];
  const call = {
    id: CALL_ID,
    tenantId: "t_marker",
    to: "+4915112340077",
    status: "active",
    startedAt: new Date(ANGELEGT_MS).toISOString(),
  };
  const marker = makeAnrufstartMarker();
  const auftrag = makeAnrufstartAuftrag({
    store: {
      leseCall: async () => call,
      load: () => ({ calls: [call] }),
      anderesAnrufMitKonversation: async () => false,
      anrufstartMarker: markerFehler
        ? {
            setze: async () => {
              throw markerFehler;
            },
            lies: marker.lies,
          }
        : marker,
    },
    starte: async () => spur.push("starte"),
    anbieterGespraeche: { liste: async () => ({ conversations: [], has_more: false }), hole: async () => null },
    haltAnrufStartFest: () => spur.push("festgehalten"),
    beendeStartUnklar: async () => spur.push("unklar"),
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    beendeOhneWahl: async (callId, grund) => spur.push(`ohne-wahl:${callId}:${grund}`),
    armeTimer: () => spur.push("timer"),
    mandantenToken: () => "token",
    jetztMs: () => ANGELEGT_MS,
  });
  return { spur, auftrag };
}

test("Marker-Fehler: der benannte Grund ist marker-nicht-gesetzt", () => {
  assert.deepEqual(ANRUFSTART_GRUND, { MARKER_FEHLT: "marker-nicht-gesetzt" });
});

test("Marker-Fehler: scheitert das Setzen des Markers, endet der Anruf ohne Wahl und der Fehler bleibt sichtbar", async () => {
  const bau = aufbau({ markerFehler: new Error("Datenbank antwortet nicht") });
  await assert.rejects(bau.auftrag({ payload: { callId: CALL_ID } }), /Datenbank antwortet nicht/);
  assert.deepEqual(bau.spur, [`ohne-wahl:${CALL_ID}:${"marker-nicht-gesetzt"}`]);
});

test("Marker-Fehler: ohne Fehler wird der Marker gesetzt und genau einmal gewaehlt", async () => {
  const bau = aufbau();
  assert.equal(await bau.auftrag({ payload: { callId: CALL_ID } }), ANRUFSTART_AUSGANG.GESTARTET);
  assert.deepEqual(bau.spur, ["starte", "timer"]);
});

const HTTP_UNAVAILABLE = 503;
const ANBIETER_VOLL = "anbieter_voll";
const MANDANT = "t_marker";
const festerKontext = {
  name: "fester-kontext",
  run: (ctx) => {
    Object.assign(ctx, {
      requestedBy: "owner",
      tenantId: MANDANT,
      mandate: null,
      context: null,
      fromNumber: "+4930123456",
      outboundProvider: "telnyx",
      numberRecord: null,
      reserveCents: 0,
      maxDur: 60,
    });
    return null;
  },
};

test("Anrufstart ohne Orchestrator: bei voller Plattform antwortet POST /api/calls 503 und der Anruf endet ohne Wahl mit not-placed:warteschlange", async (t) => {
  const { jsonSpeicherImDatenordner } = await import("../gemeinsam/json-speicher-im-datenordner.js");
  const { appOhneAbhaengigkeiten } = await import("../gemeinsam/app-ohne-abhaengigkeiten.js");
  const { abrufMitFrist } = await import("../gemeinsam/antwortfrist.mjs");
  const { config, speicher } = await jsonSpeicherImDatenordner("anrufstart-ohne-orchestrator-");
  const gewaehlt = [];
  const gruende = [];
  const store = {
    ...speicher,
    recordFailureReason: (callId, grund) => gruende.push(grund),
    leitungsplaetze: { ...speicher.leitungsplaetze, pruefenAusgehend: async () => ANBIETER_VOLL },
  };
  const basis = await appOhneAbhaengigkeiten(t, {
    config,
    store,
    audit: () => {},
    provisioning: undefined,
    outboundGates: [festerKontext],
    callQuotaDenial: () => null,
    requestTenant: () => MANDANT,
    requireTenant: () => MANDANT,
    vorspannAblauf: { pruefe: async () => ({}), waehle: async (a) => gewaehlt.push(a) },
  });
  const antwort = await abrufMitFrist(`${basis}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "+4915112340077", objective: "Tisch fuer zwei reservieren" }),
  });
  assert.equal(antwort.status, HTTP_UNAVAILABLE);
  assert.deepEqual(gruende, ["not-placed:warteschlange"]);
  assert.deepEqual(gewaehlt, []);
});
