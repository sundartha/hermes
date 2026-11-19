import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFSTART_AUSGANG, ANRUFSTART_GRUND_ABSCHALTEN, ANRUFSTART_SPERRE, makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import * as speicher from "../../src/store.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";
import { mitHermesAufPostgres, neueAnrufe, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const MANDANT = "t_anrufstart_abschalten";
const ZIEL = "+4915112340044";
const ABSENDER = "+4930555000404";
const FEST_MS = Date.parse("2026-11-18T10:00:00.000Z");
const HTTP_OK = 200;
const JOB_SQL = "SELECT state FROM pgboss.job WHERE name = 'anrufstart'";
const EL_PLAETZE = 4;
const WAHL_PFAD = "/v2/calls";
const SERVER_FRIST_MS = "6000";
const PLATZ_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + interval '1 hour')`;
const ANRUF_SQL = "SELECT id, status, failure_reason FROM call";
const PLATZ_ANZAHL_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE call_id = $1";
const RESERVE_SQL = "SELECT count(*)::int AS anzahl FROM budget_reservierung WHERE call_id = $1";
const KOSTEN_SQL = "SELECT coalesce(sum(cost_eur), 0)::float8 AS eur FROM usage";
const BUDGET_UMGEBUNG = { MAX_BUDGET_EUR: "10", VOICE_TARIFF_DOMESTIC_CENTS: "20", ALLOWED_COUNTRY_CODES: "*" };

async function neuerAufbau({ abschaltend, eingefroren = false, markerVorMs = null }) {
  const { store: db, runner } = await makePgTestStore();
  await legeMandantAn(db, MANDANT);
  const call = db.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: MANDANT });
  await db.persistCall(call.id);
  const marker = speicher.makePostgresAnrufstartMarker(runner);
  if (markerVorMs !== null)
    await marker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: new Date(FEST_MS - markerVorMs).toISOString() });
  const spur = [];
  const auftrag = makeAnrufstartAuftrag({
    store: { leseCall: (id) => db.leseCall(id), load: () => db.load(), anderesAnrufMitKonversation: (id, konv) => db.anderesAnrufMitKonversation(id, konv), anrufstartMarker: marker },
    starte: async () => {
      spur.push("starte");
    },
    anbieterGespraeche: {
      liste: async () => {
        spur.push("abgleich");
        return { conversations: [], has_more: false };
      },
      hole: async () => null,
    },
    haltAnrufStartFest: () => {},
    beendeStartUnklar: async () => {},
    sperren: { eingefroren: () => eingefroren, pausiert: () => false, abgebrochen: () => false, abschaltend: () => abschaltend },
    beendeOhneWahl: async (callId, grund) => {
      spur.push(`ohne-wahl:${grund}`);
    },
    armeTimer: () => {},
    mandantenToken: () => "token-abschalten",
    jetztMs: () => FEST_MS,
  });
  return { auftrag: () => auftrag({ payload: { callId: call.id } }), spur };
}

const FAELLE = [
  { name: "laeuft nichts zu, wird gewaehlt", abschaltend: false, ausgang: ANRUFSTART_AUSGANG.GESTARTET, spur: ["starte"] },
  {
    name: "waehrend des Abschaltens wird nicht gewaehlt und der Anruf endet ohne Wahl",
    abschaltend: true,
    ausgang: ANRUFSTART_AUSGANG.ABGESPERRT,
    spur: [`ohne-wahl:${ANRUFSTART_GRUND_ABSCHALTEN}`],
  },
  {
    name: "OUTBOUND_FROZEN geht dem Abschalten vor",
    abschaltend: true,
    eingefroren: true,
    ausgang: ANRUFSTART_AUSGANG.ABGESPERRT,
    spur: [`ohne-wahl:${ANRUFSTART_SPERRE.EINGEFROREN}`],
  },
  {
    name: "ein schon gesetzter Marker wird beim Abschalten nur abgeglichen, nie neu gestartet",
    abschaltend: true,
    markerVorMs: 0,
    ausgang: ANRUFSTART_AUSGANG.OFFEN,
    spur: ["abgleich"],
  },
];

for (const fall of FAELLE)
  test(`K5b-4c Anrufstart beim Abschalten: ${fall.name}`, async () => {
    const aufbau = await neuerAufbau(fall);
    assert.equal(await aufbau.auftrag(), fall.ausgang);
    assert.deepEqual(aufbau.spur, fall.spur);
  });

test("K5b-4c: SIGTERM bei wartendem Anruf, der Anruf endet vor dem Ende des Abschaltens ohne Wahl, Platz und Reserve sind frei, keine Kosten", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const attrappe = await starteAttrappe(async () => {}, null);
  t.after(() => attrappe.close());
  const vorspann = vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "abschalten" });
  const env = { ...vorspann, ...BUDGET_UMGEBUNG, SHUTDOWN_DRAIN_TIMEOUT_MS: SERVER_FRIST_MS, QUEUE_BACKEND: "pgboss" };
  await mitHermesAufPostgres(t, { env }, async ({ srv, sql }) => {
    for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    assert.equal((await sql(RESERVE_SQL, [callId])).rows[0].anzahl, 1);
    await zeilenBis(
      async () => (await sql(JOB_SQL)).rows,
      (zeilen) => zeilen[0]?.state === "active",
    );
    const beendet = new Promise((fertig) => srv.child.once("exit", fertig));
    srv.child.kill("SIGTERM");
    await beendet;
    const [anruf] = (await sql(ANRUF_SQL)).rows;
    assert.equal(anruf.id, callId);
    assert.equal(anruf.status, "failed");
    assert.equal(anruf.failure_reason, "not-placed:abschalten");
    assert.equal(attrappe.pfade.filter((pfad) => pfad === WAHL_PFAD).length, 0);
    await zeilenBis(
      async () => (await sql(PLATZ_ANZAHL_SQL, [callId])).rows[0].anzahl,
      (anzahl) => anzahl === 0,
    );
    assert.equal((await sql(RESERVE_SQL, [callId])).rows[0].anzahl, 0);
    assert.equal((await sql(KOSTEN_SQL)).rows[0].eur, 0);
  });
});
