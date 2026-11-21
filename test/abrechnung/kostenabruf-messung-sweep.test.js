import assert from "node:assert/strict";
import http from "node:http";
import { test, mock, after } from "node:test";

import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";
import { TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { zaehlerPunkte, mitTelemetrie } from "../gemeinsam/anbieter-messung-export.mjs";

const HTTP_OK = 200;
const TELNYX_BELEGE = "/v2/detail_records";
const BELEG_COST_USD = "0.05";
const GESCHAETZT_CENT = 20;
const BETREIBER_SUB = "kv2-betreiber";
const ALARM_POSTFACH = "postfach@kv2.invalid";

const belegAnfragen = [];
const belege = { aktuell: {} };

const telnyxStub = http.createServer((req, res) => {
  const url = new URL(req.url, "http://stub");
  const ist = url.pathname === TELNYX_BELEGE;
  if (ist) belegAnfragen.push(req.url);
  const typ = url.searchParams.get("filter[record_type]");
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: ist ? (belege.aktuell[typ] ?? []) : [] }));
});
await new Promise((bereit) => telnyxStub.listen(0, "127.0.0.1", bereit));
after(() => new Promise((fertig) => telnyxStub.close(fertig)));
process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyxStub.address().port}`;
process.env.TELNYX_API_KEY = TELNYX_MESSZEILE_SCHLUESSEL;
process.env.TELNYX_CONNECTION_ID = "conn_sweep";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: ALARM_POSTFACH });
const { makeDueOutboundCall } = await import("../cost-truing-harness.js");
const store = await import("../../src/store.js");
const { config } = await import("../../src/config.ts");
const { starteTelemetrie } = await import("../../src/utils/telemetrie.js");

function belegeFuer(call) {
  const zeit = call.answeredAt;
  const beleg = (typ, kosten) => ({
    record_type: typ,
    cost: kosten,
    currency: "USD",
    telnyx_session_id: "sess_sweep",
    call_control_id: call.callControlId,
    started_at: zeit,
    finished_at: call.endedAt,
    billed_sec: 60,
  });
  return {
    "sip-trunking": [beleg("sip-trunking", BELEG_COST_USD)],
    "call-control": [beleg("call-control", "0")],
  };
}

async function anrufAnlegen(hermes) {
  const state = store.load();
  const call = makeDueOutboundCall(state, { nowMs: Date.now(), estimatedCostCents: GESCHAETZT_CENT });
  store.save();
  await store.drainFlushes();
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)", [BETREIBER_SUB]);
  return call;
}

async function sweepLaufen(hermes, sitzung) {
  const stumm = mock.method(console, "log", () => {});
  try {
    const antwort = await hermes.anfrage("/api/billing/cost-truing/sweep", { method: "POST", headers: { cookie: sitzung } });
    assert.equal(antwort.status, HTTP_OK);
    return await antwort.json();
  } finally {
    stumm.mock.restore();
  }
}

const gebucht = (callId) => {
  const call = store.load().calls.find((c) => c.id === callId);
  return {
    actualCostMicroCents: call.actualCostMicroCents ?? null,
    costTruedSource: call.costTruedSource ?? null,
    abgeschlossen: Boolean(call.costTruedAt),
    nutzung: store.usageOf(call.tenantId),
  };
};

async function sweepAnEinemAnruf(hermes, sitzung, { mitMessung }) {
  const call = await anrufAnlegen(hermes);
  belege.aktuell = belegeFuer(call);
  const nutzungVorher = store.usageOf(call.tenantId);
  const vorher = JSON.stringify(nutzungVorher);
  const lauf = async (exporte) => {
    const ergebnis = await sweepLaufen(hermes, sitzung);
    return { ergebnis, exporte: exporte(), ...gebucht(call.id), nutzungGeaendert: JSON.stringify(store.usageOf(call.tenantId)) !== vorher };
  };
  if (!mitMessung) return lauf(() => []);
  return mitTelemetrie(starteTelemetrie, async ({ telemetrie, exporte }) => {
    const ergebnis = await lauf(() => exporte);
    await telemetrie.spuele();
    return { ...ergebnis, exporte };
  });
}

test("B5 ueber die Route: die gebuchten Ist-Kosten des Sweeps sind mit und ohne Messung gleich", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie: sitzung } = await hermes.anmelden();
  belegAnfragen.length = 0;
  const ohne = await sweepAnEinemAnruf(hermes, sitzung, { mitMessung: false });
  assert.ok(belegAnfragen.length > 0);
  const mit = await sweepAnEinemAnruf(hermes, sitzung, { mitMessung: true });
  assert.equal(ohne.costTruedSource, "kostenbuch_vollbeleg");
  assert.equal(ohne.actualCostMicroCents, 5_000_000);
  assert.equal(ohne.abgeschlossen, true);
  assert.equal(mit.costTruedSource, ohne.costTruedSource);
  assert.equal(mit.actualCostMicroCents, ohne.actualCostMicroCents);
  assert.equal(mit.abgeschlossen, true);
  assert.equal(mit.ergebnis.measured, ohne.ergebnis.measured);
  assert.equal(mit.ergebnis.failed, 0);
  assert.deepEqual(mit.nutzung.calls, ohne.nutzung.calls);
  assert.deepEqual(zaehlerPunkte(mit.exporte).filter((p) => p.anbieter === "telnyx"), []);
});

test("B8 ueber die Route: ohne Telnyx-Schluessel geht beim Sweep keine Anfrage raus, nichts wird gebucht, kein Zaehler telnyx/fehler", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie: sitzung } = await hermes.anmelden();
  const schluessel = config.telephony.telnyxApiKey;
  config.telephony.telnyxApiKey = "";
  belegAnfragen.length = 0;
  try {
    const lauf = await sweepAnEinemAnruf(hermes, sitzung, { mitMessung: true });
    assert.deepEqual(belegAnfragen, []);
    assert.equal(lauf.actualCostMicroCents, null);
    assert.notEqual(lauf.costTruedSource, "telnyx_detail_records");
    assert.equal(lauf.nutzungGeaendert, false);
    assert.deepEqual(zaehlerPunkte(lauf.exporte).filter((p) => p.anbieter === "telnyx" && p.ergebnis === "fehler"), []);
  } finally {
    config.telephony.telnyxApiKey = schluessel;
  }
});
