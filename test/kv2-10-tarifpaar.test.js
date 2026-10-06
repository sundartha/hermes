import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TARIFPAAR_FEHLGRUND,
  TARIFPAAR_FINDING,
  alertbareTarifpaarBefunde,
  tarifpaarDecktStichproben,
  tarifpaarReport,
  tarifpaarZeile,
  vollkostenStichprobenJeRoute,
} from "../src/billing/cost-calibration.js";
import { KOSTENART } from "../src/billing/kostenarten.js";
import { COST_TRUING_SOURCE, PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";
import { EL_STICHPROBE, STICHPROBEN_ENDE_MS, eigenCentQuelleJeAnruf, elVollkostenState } from "./fixtures/kostenv2-vollkosten-stichprobe.js";
import { makeCostTruing, SWEEP_TRIGGER } from "../src/billing/cost-truing.js";
import { makeStubStore, fakeConfig, fakeSpies } from "./cost-truing-harness.js";
import { startServer, seedState, BASE_ENV } from "./helpers.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KURS_MICRO = 920_000;
const ROUTE_EL = "el_convai_sip";

const STICHPROBEN_GROESSE = EL_STICHPROBE.length;
const VORSCHLAG_GRUNDBETRAG_CENTS = 20;
const VORSCHLAG_MINUTENSATZ_CENTS = 18;
const GEGENPROBE_GRUNDBETRAG_CENTS = 17;
const GEGENPROBE_MINUTENSATZ_CENTS = 15;
const LIVE_MINUTENSATZ_CENTS = 20;
const ZU_NIEDRIGER_MINUTENSATZ_CENTS = 10;
const INBOUND_MINUTENSATZ_CENTS = 6;
const DEFAULT_MINDESTPROBEN = 20;
const HTTP_OK = 200;

function fixtureBilling({ minSamples = STICHPROBEN_GROESSE, domesticCents = LIVE_MINUTENSATZ_CENTS, grundbetragJeRoute = {} } = {}) {
  return {
    providerToBucketRateMicro: KURS_MICRO,
    costCalibrationMinSamples: minSamples,
    voiceTariffDomesticCents: domesticCents,
    voiceTariffInboundCents: INBOUND_MINUTENSATZ_CENTS,
    voiceTariffGrundbetragCentsJeRoute: grundbetragJeRoute,
  };
}

test("KV2-10 (a1): Fixture mit Eigen-Cent -> vorschlag 20ct + 18ct/min, Gegenprobe deckt unabhaengig", () => {
  const state = elVollkostenState();
  const eigen = eigenCentQuelleJeAnruf();
  const el = tarifpaarReport({ state, eigenCentJeAnruf: eigen, billing: fixtureBilling() }).find((eintrag) => eintrag.route === ROUTE_EL);
  assert.equal(el.proben, STICHPROBEN_GROESSE, "alle 8 Anrufe sind Stichproben");
  assert.deepEqual(el.vorschlag, { grundbetragCents: VORSCHLAG_GRUNDBETRAG_CENTS, minutensatzCents: VORSCHLAG_MINUTENSATZ_CENTS });
  const { jeRoute } = vollkostenStichprobenJeRoute({ state, eigenCentJeAnruf: eigen, rateMicro: KURS_MICRO });
  const stichproben = jeRoute.get(ROUTE_EL);
  assert.equal(
    tarifpaarDecktStichproben({ grundbetragCents: VORSCHLAG_GRUNDBETRAG_CENTS, minutensatzCents: VORSCHLAG_MINUTENSATZ_CENTS }, stichproben),
    true,
  );
  assert.equal(tarifpaarDecktStichproben({ grundbetragCents: VORSCHLAG_GRUNDBETRAG_CENTS, minutensatzCents: 0 }, stichproben), true);
});

test("KV2-10 (a2): Gegenprobe R9-2 - OHNE Eigen-Cent ergibt dieselbe Fixture ein strikt NIEDRIGERES Paar", () => {
  const ohneEigen = new Map(EL_STICHPROBE.map((zeile) => [zeile.callId, 0]));
  const [el] = tarifpaarReport({ state: elVollkostenState(), eigenCentJeAnruf: ohneEigen, billing: fixtureBilling() })
    .filter((eintrag) => eintrag.route === ROUTE_EL);
  assert.deepEqual(el.vorschlag, { grundbetragCents: GEGENPROBE_GRUNDBETRAG_CENTS, minutensatzCents: GEGENPROBE_MINUTENSATZ_CENTS });
  assert.ok(
    el.vorschlag.grundbetragCents < VORSCHLAG_GRUNDBETRAG_CENTS && el.vorschlag.minutensatzCents < VORSCHLAG_MINUTENSATZ_CENTS,
    "strikt niedriger - die Unterschaetzung, die R9-2 benennt",
  );
});

test("KV2-10 (a3): eine Stichprobe NUR aus Belegwerten wird NICHT akzeptiert (keine Quelle -> eigen_achsen)", () => {
  const report = tarifpaarReport({ state: elVollkostenState(), eigenCentJeAnruf: null, billing: fixtureBilling() });
  const [el] = report.filter((eintrag) => eintrag.route === ROUTE_EL);
  assert.equal(el.proben, 0);
  assert.equal(el.fehlgrund, `eigen_achsen(${STICHPROBEN_GROESSE})`);
  assert.equal(el.code, TARIFPAAR_FINDING.ZU_WENIG_PROBEN);
  assert.deepEqual(alertbareTarifpaarBefunde(report), [], "zu_wenig_proben ist nie Kanal-Laerm");
});

test("KV2-10 (a4): konfiguriertes Paar (0,20) -> im_band; (0,10) -> tarifpaar_unterschaetzt", () => {
  const state = elVollkostenState();
  const eigen = eigenCentQuelleJeAnruf();
  const gedeckt = tarifpaarReport({ state, eigenCentJeAnruf: eigen, billing: fixtureBilling({ domesticCents: LIVE_MINUTENSATZ_CENTS }) })
    .find((eintrag) => eintrag.route === ROUTE_EL);
  assert.equal(gedeckt.code, null);
  assert.match(tarifpaarZeile(gedeckt), /proben=8 vorschlag=20ct\+18ct\/min konfiguriert=0ct\+20ct\/min befund=im_band/);

  const zuNiedrig = tarifpaarReport({ state, eigenCentJeAnruf: eigen, billing: fixtureBilling({ domesticCents: ZU_NIEDRIGER_MINUTENSATZ_CENTS }) });
  const el = zuNiedrig.find((eintrag) => eintrag.route === ROUTE_EL);
  assert.equal(el.code, TARIFPAAR_FINDING.UNTERSCHAETZT);
  assert.equal(alertbareTarifpaarBefunde(zuNiedrig).length, 1);
});

function fehlgrundZaehler(verbiege, grund) {
  const state = elVollkostenState();
  verbiege(state);
  const { jeRoute, ausgeschlossen } = vollkostenStichprobenJeRoute({ state, eigenCentJeAnruf: eigenCentQuelleJeAnruf(), rateMicro: KURS_MICRO });
  assert.equal(ausgeschlossen.get(grund), 1, `genau ein Ausschlussgrund ${grund}`);
  assert.equal(jeRoute.get(ROUTE_EL).length, STICHPROBEN_GROESSE - 1, "die anderen 7 bleiben Stichproben");
}

test("KV2-10 (b1): costTruedSource=kostenbuch_teilbeleg -> fehlgrund herkunft", () => {
  fehlgrundZaehler((state) => {
    Object.assign(state.calls[0], { costTruedSource: COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG });
  }, TARIFPAAR_FEHLGRUND.HERKUNFT);
});

test("KV2-10 (b2): EL-Belegzeile fehlt (nur telnyx_sip belegt) -> fehlgrund beleg_unvollstaendig", () => {
  fehlgrundZaehler((state) => {
    const [erster] = state.calls;
    const ohneElZeile = state.callCostEvidence.filter(
      (zeile) => !(zeile.callId === erster.id && zeile.traeger === KOSTENART.ELEVENLABS_CONVAI),
    );
    Object.assign(state, { callCostEvidence: ohneElZeile });
  }, TARIFPAAR_FEHLGRUND.BELEG_UNVOLLSTAENDIG);
});

test("KV2-10 (b3): endedAt ohne answeredAt -> fehlgrund minuten", () => {
  fehlgrundZaehler((state) => {
    Object.assign(state.calls[0], { answeredAt: null });
  }, TARIFPAAR_FEHLGRUND.MINUTEN);
});

test("KV2-10 (b4): Belegsumme an Number.MAX_SAFE_INTEGER -> fehlgrund ueberlauf (nie still 0)", () => {
  fehlgrundZaehler((state) => {
    const [erster] = state.calls;
    const zeile = state.callCostEvidence.find((eintrag) => eintrag.callId === erster.id && eintrag.traeger === KOSTENART.TELNYX_SIP);
    Object.assign(zeile, { betragMikroCents: Number.MAX_SAFE_INTEGER });
  }, TARIFPAAR_FEHLGRUND.UEBERLAUF);
});

test("KV2-10 (b5): Default-Mindeststichprobe 20 -> tarifpaar_zu_wenig_proben mit vorschlag=null (keine Paar-Aussage)", () => {
  const [el] = tarifpaarReport({ state: elVollkostenState(), eigenCentJeAnruf: eigenCentQuelleJeAnruf(), billing: fixtureBilling({ minSamples: DEFAULT_MINDESTPROBEN }) })
    .filter((eintrag) => eintrag.route === ROUTE_EL);
  assert.equal(el.proben, STICHPROBEN_GROESSE);
  assert.equal(el.code, TARIFPAAR_FINDING.ZU_WENIG_PROBEN);
  assert.equal(el.vorschlag, null);
  assert.match(tarifpaarZeile(el), /proben=8 fehlgrund=keine befund=tarifpaar_zu_wenig_proben/);
});

test("KV2-10 (pii): der Report traegt keine Rufnummer, nur Routen-/Profilnamen und Cent-Betraege", () => {
  const report = tarifpaarReport({ state: elVollkostenState(), eigenCentJeAnruf: eigenCentQuelleJeAnruf(), billing: fixtureBilling() });
  const json = JSON.stringify(report) + report.map(tarifpaarZeile).join(" | ");
  assert.ok(!json.includes("+4930111222333"), "keine Rufnummer aus dem Fixture-State");
  assert.ok(!json.includes("call_mt"), "keine Call-ID");
});

function boundAlertSender() {
  return [{
    id: "pnu_kv2_10", e164: "+15005550006", purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, provider: "telnyx",
    tenantId: null, providerNumberId: null, boundAt: "2026-08-01T00:00:00Z", releasedAt: null, note: null,
  }];
}

function kanalConfig(domesticCents) {
  return fakeConfig({
    costTruingMinCoveragePercent: 80,
    platformAlertSmsTo: "+12025550143",
    platformAlertMailTo: "ops@example.test",
    brevoApiKey: "k",
    costCalibrationMinSamples: STICHPROBEN_GROESSE,
    providerToBucketRateMicro: KURS_MICRO,
    voiceTariffDomesticCents: domesticCents,
    voiceTariffGrundbetragCentsJeRoute: {},
  });
}

async function sweepMitTarifpaar(domesticCents) {
  const nowMs = STICHPROBEN_ENDE_MS;
  const state = elVollkostenState();
  state.platformNumberUse = boundAlertSender();
  const store = makeStubStore(state);
  const { mailCalls, smsCalls, mailer, messaging } = fakeSpies();
  const auditCalls = [];
  const logLines = [];
  const originalLog = console.log;
  console.log = (...args) => logLines.push(args.join(" "));
  try {
    const { runCostTruingSweep } = makeCostTruing({
      store,
      config: kanalConfig(domesticCents),
      voiceControl: () => { throw new Error("kein Provider noetig"); },
      audit: (action, req, detail) => auditCalls.push({ action, detail }),
      messaging,
      mailer,
      eigenCentJeAnruf: eigenCentQuelleJeAnruf(),
      now: () => nowMs,
    });
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    console.log = originalLog;
  }
  return { mailCalls, smsCalls, auditCalls, tarifpaarLog: logLines.find((zeile) => zeile.startsWith("[cost-truing] tarifpaar ")) ?? "" };
}

test("KV2-10 (d1): Unterschaetzung (Minutensatz 10) -> GENAU EINE Mail und EINE SMS mit dem konkreten Paar", async () => {
  const { mailCalls, smsCalls, auditCalls, tarifpaarLog } = await sweepMitTarifpaar(ZU_NIEDRIGER_MINUTENSATZ_CENTS);
  assert.equal(mailCalls.length, 1, "genau eine Mail");
  assert.equal(smsCalls.length, 1, "genau eine SMS");
  assert.match(JSON.stringify(mailCalls[0]) + JSON.stringify(smsCalls[0]), /vorschlag=20ct\+18ct\/min/);
  assert.match(JSON.stringify(mailCalls[0]), /grund=tarifpaar_unterschaetzt/);
  assert.ok(
    auditCalls.some((entry) => entry.detail.includes("grund=tarifpaar_unterschaetzt")),
    `audit-Detail nennt den Befund-Code: ${JSON.stringify(auditCalls)}`,
  );
  assert.match(tarifpaarLog, /route=el_convai_sip proben=8 .* befund=tarifpaar_unterschaetzt/);
});

test("KV2-10 (d2): gedeckter Tarif (Minutensatz 20) -> KEINE Mail, KEINE SMS, nur die tarifpaar-Logzeile", async () => {
  const { mailCalls, smsCalls, auditCalls, tarifpaarLog } = await sweepMitTarifpaar(LIVE_MINUTENSATZ_CENTS);
  assert.equal(mailCalls.length, 0, "gedeckter Tarif = kein Kanal-Laerm");
  assert.equal(smsCalls.length, 0);
  assert.ok(!auditCalls.some((entry) => entry.detail.includes("tarifpaar")), "kein tarifpaar-Befund im Audit");
  assert.match(tarifpaarLog, /route=el_convai_sip proben=8 .* befund=im_band/);
});

test("KV2-10 (e): der Boot meldet das Tarifpaar - [boot] Tarifpaar: im Spawn-stdout, /healthz 200", async () => {
  const srv = await startServer({ seed: seedState({ calls: [] }) });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
    assert.match(srv.stdout, /\[boot\] Tarifpaar: /);
    assert.match(srv.stdout, /befund=tarifpaar_zu_wenig_proben/, "ohne Eigen-Achsen-Quelle ist der Zustand sichtbar-wartend, nie scheinbar-messend");
  } finally {
    await srv.stop();
  }
});

test("KV2-10 (cfg1): VOICE_TARIFF_GRUNDBETRAG_CENTS in .env.example + render.yaml vorhanden (leer), config-Fallback {}", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  assert.match(envExample, /^VOICE_TARIFF_GRUNDBETRAG_CENTS=$/m, "Env in .env.example dokumentiert, leer = noch nicht gesetzt");
  assert.match(renderYaml, /key:\s*VOICE_TARIFF_GRUNDBETRAG_CENTS\s*\n\s*value:\s*""/);
});

test("KV2-10 (cfg2): VOICE_TARIFF_FULL_COST_FLOOR_CENTS-Fallback = 15 in config.js, .env.example und render.yaml", async () => {
  const BODEN_FALLBACK_CENTS = "15";
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

  assert.equal(envExample.match(/^VOICE_TARIFF_FULL_COST_FLOOR_CENTS=(.+)$/m)[1].trim(), BODEN_FALLBACK_CENTS);
  assert.equal(renderYaml.match(/key:\s*VOICE_TARIFF_FULL_COST_FLOOR_CENTS\s*\n\s*value:\s*"?([^"\n]+)"?/)[1].trim(), BODEN_FALLBACK_CENTS);
  const saved = process.env.VOICE_TARIFF_FULL_COST_FLOOR_CENTS;
  try {
    delete process.env.VOICE_TARIFF_FULL_COST_FLOOR_CENTS;
    const ohneBoden = await import("../src/config.js?kv2-10-cfg2");
    assert.equal(ohneBoden.config.billing.voiceTariffFullCostFloorCents, Number(BODEN_FALLBACK_CENTS));
  } finally {
    if (saved !== undefined) process.env.VOICE_TARIFF_FULL_COST_FLOOR_CENTS = saved;
  }
});

test("KV2-10 (cfg3): unbekanntes Profil oder Muell-Cent in der Env-Karte reisst den Config-Build (fail-closed)", async () => {
  const saved = process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS;
  try {
    process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS = "unbekanntes_profil:23";
    const mitUnbekannt = await import("../src/config.js?kv2-10-cfg3a");
    assert.ok(
      mitUnbekannt.configFatalErrors().some((msg) => msg.includes("VOICE_TARIFF_GRUNDBETRAG_CENTS")),
      "unbekanntes Profil -> fatalConfigErrors -> Boot-Refusal",
    );

    process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS = "el_convai_sip:kein_zahl";
    const mitMuell = await import("../src/config.js?kv2-10-cfg3b");
    assert.ok(mitMuell.configFatalErrors().some((msg) => msg.includes("VOICE_TARIFF_GRUNDBETRAG_CENTS")), "Muell-Cent -> fatal");

    process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS = "el_convai_sip:23";
    const gueltig = await import("../src/config.js?kv2-10-cfg3c");
    assert.deepEqual(gueltig.config.billing.voiceTariffGrundbetragCentsJeRoute, { el_convai_sip: 23 });
  } finally {
    if (saved === undefined) delete process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS;
    else process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS = saved;
  }
});

test("KV2-10 (cfg4): BASE_ENV pinnt VOICE_TARIFF_GRUNDBETRAG_CENTS neutral leer (kein dotenv-Leak aus lokaler .env)", () => {
  assert.ok(
    "VOICE_TARIFF_GRUNDBETRAG_CENTS" in BASE_ENV,
    "der Schluessel existiert in BASE_ENV - nur dann klemmt dotenv die lokale .env aus",
  );
  assert.equal(BASE_ENV.VOICE_TARIFF_GRUNDBETRAG_CENTS, "", "leer = fail-closed Default {} (alle Routen 0)");
});
