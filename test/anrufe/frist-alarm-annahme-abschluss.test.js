import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { OWNER_TEST_FIRST_NAME, nowSeconds, seedCall, seedState, startServer, waitForLog, waitUntil } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { serverUhrUmgebung, stelleServerUhrVor } from "../helpers/server-uhr.mjs";
import { OTLP_MESSWERTE_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { calleeVon, elVon, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const WARTE_FRIST_MS = 20_000;
const ANNAHME_FRIST_MS = 5_000;
const LANGE_FRIST_MS = 60_000;
const UEBER_DER_HOECHSTDAUER_FRIST_MS = 3_600_000;
const ALLE_DREI = 3;
const KENNZAHL = "hermes.call.deadline_missed";
const ENDE = "hermes.call.ended";
const SONDEN_URL = pathToFileURL(createRequire(import.meta.url).resolve("@opentelemetry/sdk-metrics")).href;
const WERFENDER_ZAEHLER = [
  `const { MeterProvider } = await import(${JSON.stringify(SONDEN_URL)});`,
  "const echt = MeterProvider.prototype.getMeter;",
  "MeterProvider.prototype.getMeter = function (...args) {",
  "  const meter = echt.apply(this, args);",
  "  const zaehler = meter.createCounter.bind(meter);",
  "  meter.createCounter = (...a) => Object.assign(zaehler(...a), { add: () => { throw new Error('zaehler kaputt'); } });",
  "  return meter;",
  "};",
].join("\n");

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);
const punkteVon = (export_, name) => metrikenVon(export_).filter((m) => m.name === name).flatMap((m) => m.sum.dataPoints);
const zahl = (punkt) => Number(punkt.asInt ?? punkt.asDouble);
function fristVon(punkt) {
  const attribut = punkt.attributes.find((a) => a.key === "frist");
  return attribut.value.stringValue;
}
const versaeumt = (export_) => Object.fromEntries(punkteVon(export_, KENNZAHL).map((p) => [fristVon(p), zahl(p)]));
const beendet = (export_) => punkteVon(export_, ENDE).reduce((summe, p) => summe + zahl(p), 0);

async function exportMit(empfaenger, pruefung) {
  await waitUntil(() => empfaenger.exporte.some(pruefung), { timeoutMs: WARTE_FRIST_MS });
  return empfaenger.exporte.findLast(pruefung);
}

async function mitDienst({ fristMs, vorElAntwort, umgebung = {} }, lauf) {
  const attrappe = await starteAttrappe(vorElAntwort);
  const empfaenger = await startEmpfaenger();
  const signer = makeTelnyxSigner();
  const env = {
    ...vorspannUmgebung({ attrappe, signer, publicUrl: "https://agent.test", kennung: "6182-alarm" }),
    EL_BRIDGE_START_DEADLINE_MS: String(fristMs),
    FRISTEN_TAKT_MS: "100",
    METRIKEN_OTLP_URL: empfaenger.url,
    METRIKEN_OTLP_TOKEN: OTLP_MESSWERTE_TOKEN,
    METRIKEN_INTERVALL_MS: "50",
    ...umgebung,
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  let srv;
  try {
    srv = await startServer({ env, seed });
    await lauf({ srv, attrappe, empfaenger, signer });
  } finally {
    await srv?.stop();
    await empfaenger.stop();
    await attrappe.close();
  }
}

let anrufNr = 0;
let ereignisNr = 0;

function anrufIn(dienst, callId) {
  const { calls } = dienst.srv.readStore();
  return calls.find((eintrag) => eintrag.id === callId);
}

const wartet = (bedingung) => waitUntil(bedingung, { timeoutMs: WARTE_FRIST_MS });

async function ruf(dienst, zusatz = {}) {
  const antwort = await abrufMitFrist(`${dienst.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: neueAnrufNummer((anrufNr += 1)), objective: "Termin am Donnerstag vereinbaren", ...zusatz }),
  });
  const { callId } = await antwort.json();
  assert.ok(callId);
  await wartet(() => anrufIn(dienst, callId)?.status === "active");
  return callId;
}

async function sende(dienst, callId, { typ, bein = calleeVon(callId) }) {
  const id = `evt-6182-alarm-${(ereignisNr += 1)}`;
  const roh = JSON.stringify({ data: { id, event_type: typ, payload: { call_control_id: bein, status: "completed" } } });
  const zeit = String(nowSeconds());
  const antwort = await abrufMitFrist(`${dienst.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": dienst.signer.sign(zeit, roh) },
    body: roh,
  });
  assert.equal(antwort.status, HTTP_OK);
}

async function hebeAb(dienst, callId) {
  await sende(dienst, callId, { typ: "call.answered" });
  await wartet(() => anrufIn(dienst, callId).elCallControlId === elVon(callId));
}

async function verbinde(dienst, callId) {
  await sende(dienst, callId, { typ: "call.answered", bein: elVon(callId) });
  await sende(dienst, callId, { typ: "call.playback.ended" });
  await wartet(() => anrufIn(dienst, callId).bridgedAt);
}

async function legeAuf(dienst, callId, bein = calleeVon(callId)) {
  await sende(dienst, callId, { typ: "call.hangup", bein });
  await wartet(() => anrufIn(dienst, callId).status !== "active");
}

async function erwarteVersaeumt(dienst, beendete, erwartet) {
  const stand = await exportMit(dienst.empfaenger, (e) => beendet(e) === beendete);
  assert.deepEqual(versaeumt(stand), erwartet);
}

async function rufOhneAnnahme(dienst) {
  const callId = await ruf(dienst);
  await hebeAb(dienst, callId);
  await legeAuf(dienst, callId, elVon(callId));
  return callId;
}

test("frist-alarm-annahme-abschluss: nur der Anruf ohne el_angenommen bis zur Frist zaehlt, der fristgerecht angenommene nicht", async () => {
  await mitDienst({ fristMs: ANNAHME_FRIST_MS }, async (dienst) => {
    const start = await exportMit(dienst.empfaenger, (e) => metrikenVon(e).length > 0);
    assert.deepEqual(versaeumt(start), { el_angenommen: 0, abschluss: 0 });
    const puenktlich = await ruf(dienst);
    await hebeAb(dienst, puenktlich);
    await verbinde(dienst, puenktlich);
    const ausgeblieben = await ruf(dienst);
    await hebeAb(dienst, ausgeblieben);
    await sende(dienst, ausgeblieben, { typ: "call.playback.ended" });
    await wartet(() => anrufIn(dienst, ausgeblieben).failureReason === "el_frist");
    await legeAuf(dienst, puenktlich);
    await legeAuf(dienst, ausgeblieben);
    await erwarteVersaeumt(dienst, 2, { el_angenommen: 1, abschluss: 0 });
  });
});

test("frist-alarm-annahme-abschluss: legt das EL-Bein vor der Annahme auf, zaehlt das, nach der Annahme nicht", async () => {
  await mitDienst({ fristMs: LANGE_FRIST_MS }, async (dienst) => {
    await rufOhneAnnahme(dienst);
    await erwarteVersaeumt(dienst, 1, { el_angenommen: 1, abschluss: 0 });
    const angenommen = await ruf(dienst);
    await hebeAb(dienst, angenommen);
    await sende(dienst, angenommen, { typ: "call.answered", bein: elVon(angenommen) });
    await wartet(() => new RegExp(`el_angenommen ms_seit_abheben=\\d+ call=${angenommen}`).test(dienst.srv.stdout));
    await legeAuf(dienst, angenommen, elVon(angenommen));
    await erwarteVersaeumt(dienst, 2, { el_angenommen: 1, abschluss: 0 });
  });
});

test("frist-alarm-annahme-abschluss: scheitert die Wahl des EL-Beins, zaehlt das als fehlende Annahme", async () => {
  const bleibtOhneAntwort = () => new Promise(() => {});
  await mitDienst({ fristMs: LANGE_FRIST_MS, vorElAntwort: bleibtOhneAntwort }, async (dienst) => {
    const callId = await ruf(dienst);
    await sende(dienst, callId, { typ: "call.answered" });
    await sende(dienst, callId, { typ: "call.playback.ended" });
    await wartet(() => anrufIn(dienst, callId).elFallbackAt);
    await legeAuf(dienst, callId);
    await erwarteVersaeumt(dienst, 1, { el_angenommen: 1, abschluss: 0 });
  });
});

test("frist-alarm-annahme-abschluss: nur der angenommene Anruf ohne Abschluss bis zur Hoechstdauer zaehlt", async () => {
  await mitDienst({ fristMs: UEBER_DER_HOECHSTDAUER_FRIST_MS, umgebung: serverUhrUmgebung() }, async (dienst) => {
    const rechtzeitig = await ruf(dienst);
    await hebeAb(dienst, rechtzeitig);
    await verbinde(dienst, rechtzeitig);
    await legeAuf(dienst, rechtzeitig);
    const nieAngenommen = await ruf(dienst);
    const ohneAbschluss = await ruf(dienst);
    await hebeAb(dienst, ohneAbschluss);
    await verbinde(dienst, ohneAbschluss);
    stelleServerUhrVor(dienst.srv);
    await erwarteVersaeumt(dienst, ALLE_DREI, { el_angenommen: 0, abschluss: 1 });
    assert.equal(anrufIn(dienst, nieAngenommen).failureReason, "max-duration-cap");
    assert.equal(anrufIn(dienst, ohneAbschluss).failureReason, "max-duration-cap");
  });
});

test("frist-alarm-annahme-abschluss: ohne Messwerte endet ein Anruf ohne Annahme ohne Messfehler", async () => {
  await mitDienst({ fristMs: LANGE_FRIST_MS, umgebung: { METRIKEN_OTLP_URL: "" } }, async (dienst) => {
    const callId = await rufOhneAnnahme(dienst);
    assert.equal(anrufIn(dienst, callId).status, "failed");
    assert.ok(!dienst.srv.stdout.includes("[betriebsmessung]"), dienst.srv.stdout);
  });
});

test("frist-alarm-annahme-abschluss: wirft die Messung, nennt das Log den Messpunkt der Frist", async () => {
  const umgebung = { NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(WERFENDER_ZAEHLER)}` };
  await mitDienst({ fristMs: LANGE_FRIST_MS, umgebung }, async (dienst) => {
    await waitForLog(dienst.srv, /\[betriebsmessung\] anruf_frist_versaeumt fehlgeschlagen: zaehler kaputt/, WARTE_FRIST_MS);
    const antwort = await abrufMitFrist(`${dienst.srv.localUrl}/healthz`);
    assert.equal(antwort.status, HTTP_OK);
  });
});
