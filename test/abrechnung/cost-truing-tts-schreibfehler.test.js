import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";
import { fristSignal } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const TELNYX_BASIS = "https://telnyx.kv2.invalid";
const ENDED_MINUTES_AGO = 200;
const KAUFENDE_ANKER = ["v3:TtsSchreibfehlerAnkerA00000000000000000000000000", "v3:TtsSchreibfehlerAnkerB00000000000000000000000000"];
const SITZUNGEN = ["sess-tts-fehler-a-0001", "sess-tts-fehler-b-0002"];
const ZEICHEN = [238, 17];
const LEG_ID = "0bad0bad-0bad-11f1-0bad-0bad0bad0bad1";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@kv2.invalid", anrufstartAbgelehnt: true });
const { makeDueOutboundCall, isoMinutesAgo } = await import("../cost-truing-harness.js");
const store = await import("../../src/store.js");

function belegseite(recordType, um) {
  const gemeinsam = { currency: "USD", telnyx_leg_id: LEG_ID, started_at: um, finished_at: um };
  if (recordType === "sip-trunking")
    return SITZUNGEN.flatMap((sitzung, i) => [
      { ...gemeinsam, record_type: "sip-trunking", cost: "0.0", billed_sec: 0, telnyx_session_id: sitzung },
      { ...gemeinsam, record_type: "sip-trunking", cost: "0.0401", billed_sec: 60, telnyx_session_id: sitzung, call_control_id: KAUFENDE_ANKER[i] },
    ]);
  if (recordType === "call-control")
    return SITZUNGEN.flatMap((sitzung) => [
      { ...gemeinsam, record_type: "call-control", cost: "0.0", billed_sec: 0, telnyx_session_id: sitzung },
      { ...gemeinsam, record_type: "call-control", cost: "0.002", billed_sec: 60, telnyx_session_id: sitzung },
    ]);
  if (recordType === "text-to-speech")
    return SITZUNGEN.map((sitzung, i) => ({
      record_type: "text-to-speech", currency: "USD", cost: "1.0E-4", provider: "elevenlabs",
      call_session_id: sitzung, call_leg_id: LEG_ID, number_of_characters: ZEICHEN[i],
    }));
  return [];
}

function telnyxBelegeAnbieten(um) {
  const weiter = globalThis.fetch;
  globalThis.fetch = async (url, optionen) => {
    const ziel = new URL(String(url));
    if (ziel.origin !== TELNYX_BASIS) return weiter(url, { ...optionen, signal: fristSignal() });
    const recordType = ziel.searchParams.get("filter[record_type]");
    return new Response(JSON.stringify({ data: belegseite(recordType, um) }), { status: HTTP_OK });
  };
}

test("(3374) Scheitert das Buchen der TTS-Zeichen, bleiben die Anrufe abgeglichen und der Lauf geht weiter", async () => {
  const hermes = laufendesHermes();
  const { sessionCookie: sitzung } = await hermes.anmelden();
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)", ["kv2-betreiber"]);

  const state = store.load();
  const uhr = await hermes.db.query("SELECT floor(extract(epoch FROM now()) * 1000) AS ms");
  const nowMs = Number(uhr.rows[0].ms);
  const anrufe = KAUFENDE_ANKER.map((anker) => makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20, legRef: { callControlId: anker } }));
  store.save();
  await store.drainFlushes();
  await hermes.db.query("CREATE FUNCTION tts_schreibfehler_3374() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'db weg 3374'; END $$ LANGUAGE plpgsql");
  await hermes.db.query("CREATE TRIGGER tts_schreibfehler_3374 BEFORE INSERT OR UPDATE ON platform_tts_usage FOR EACH ROW EXECUTE FUNCTION tts_schreibfehler_3374()");
  telnyxBelegeAnbieten(isoMinutesAgo(nowMs, ENDED_MINUTES_AGO));

  const zeilen = [];
  const warnOrig = console.warn;
  console.warn = (...a) => zeilen.push(a.map(String).join(" "));
  let sweep;
  try {
    sweep = await hermes.anfrage("/api/billing/cost-truing/sweep", { method: "POST", headers: { cookie: sitzung } });
  } finally {
    console.warn = warnOrig;
  }
  assert.equal(sweep.status, HTTP_OK);
  const ergebnis = await sweep.json();
  assert.equal(ergebnis.candidates, 2);
  assert.equal(ergebnis.measured, 2, JSON.stringify(ergebnis));
  assert.equal(ergebnis.failed, 0);
  const alleAnrufe = store.load().calls;
  for (const anruf of anrufe) {
    const gespeichert = alleAnrufe.find((eintrag) => eintrag.id === anruf.id);
    const quelle = gespeichert.costTruedSource;
    assert.equal(quelle, "kostenbuch_vollbeleg", `Anruf ${anruf.id} bleibt abgeglichen`);
    assert.ok(zeilen.some((z) => z.startsWith(`[cost-truing] TTS-Zeichen nicht gebucht call=${anruf.id}: `) && z.includes("db weg 3374")));
  }
});
