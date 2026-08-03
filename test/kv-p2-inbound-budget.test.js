// KV-P2 (tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md): die vier Pflicht-Abnahmen der Phase - ein
// beendeter Inbound-Call erreicht die Gate-Achse mit dem kalibrierten Inbound-Satz, beide
// Achsen-Anker landen an der Call-Zeile, ein nie beantworteter Call bucht nichts, und die
// Buchung ist ueber einen Prozess-Neustart hinweg genau-einmal.
//
// Seam wie test/ks-p2-live-carrier-spend.test.js: die Tarif-Env wird VOR dem ersten
// config.js-Import gesetzt (metering.js importiert config.js statisch), danach werden die
// config-lesenden Module dynamisch importiert. state-ops.js importiert config.js NICHT und
// bleibt oben statisch importiert.
//
// INBOUND_CENTS bewusst != DOMESTIC_CENTS (20) und != DEFAULT_CENTS (30, hier ungenutzt,
// aber als Kontrast benannt): ein Rueckfall auf einen der beiden Outbound-Saetze waere an
// der ZAHL sichtbar, nicht nur am Vorzeichen.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, seedState, seedCall, waitForLog, DOMESTIC_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  makeDefaultState,
  createCall,
  getCall,
  usageOf,
  addVoiceUsageCostCents,
  recordCallEstimatedCostCents,
  stampBudgetPeriod,
} from "../src/store/state-ops.js";

const INBOUND_CENTS = 7;
const DOMESTIC_CENTS = 20;
const DEFAULT_CENTS = 30;
// Uhr der Spend-Monat-Achse (Bucket-Brigade-Fallstrick, s.u.) - PFLICHT, nicht kosmetisch.
const NOW_ISO = "2026-07-30T12:00:00.000Z";
const NOW_SPEND_MONTH_KEY = "2026-07";
const PERIOD_START_ISO = "2026-07-01T00:00:00.000Z";

const TENANT = "tenant_kv_p2";
const OWN_DID = "+15005550006";
const CALLER = "+4915112345678";

let makeMetering;

before(async () => {
  process.env.VOICE_TARIFF_INBOUND_CENTS = String(INBOUND_CENTS);
  process.env.VOICE_TARIFF_DOMESTIC_CENTS = String(DOMESTIC_CENTS);
  process.env.VOICE_TARIFF_DEFAULT_CENTS = String(DEFAULT_CENTS);
  ({ makeMetering } = await import("../src/billing/metering.js"));
});

// Fassaden-Fake ueber einen ECHTEN state-ops-State (Muster test/kv-p1-cost-ledger-map.test.js
// realMeteringStore): reicht durch, faengt nichts. addVoiceUsageCostCents bekommt NOW_ISO
// durchgereicht - GENAU wie json.js/pg.js es in Produktion mit new Date().toISOString() tun.
//
// FALLSTRICK (gehoert hierher, nicht als Fussnote): addVoiceUsageCostCents(s, tenantId, cents)
// OHNE nowIso laesst bookCents nach usage.costCents schreiben, aber spendMonthCostCents
// UNBERUEHRT (authoritativeSpendMonthKey(null, null) === null -> early return). Ohne NOW_ISO
// waere Abnahme (1) unten eine leere 0 === 0-Behauptung.
function realMeteringStore(s) {
  return {
    addVoiceUsageCostCents: (tenantId, costCents) => addVoiceUsageCostCents(s, tenantId, costCents, NOW_ISO),
    recordCallEstimatedCostCents: (callId, input) => recordCallEstimatedCostCents(s, callId, input),
  };
}

function makeInboundCall(s, { tenantId = TENANT, answeredAt, endedAt } = {}) {
  const call = createCall(s, {
    direction: "inbound",
    from: CALLER,
    to: OWN_DID,
    tenantId,
  });
  call.answeredAt = answeredAt ?? null;
  call.endedAt = endedAt ?? null;
  return call;
}

// ---- KV-P2-1: 2 Minuten Inbound -> spendMonthCostCents + costCents um 2 x Inbound-Satz ----
//
// MUTATIONSPROBEN (manuell waehrend der Abnahme, NICHT Teil dieses Testcodes):
//   (a) `if (call.direction !== "outbound") return;` in reconcileVoiceBudget wieder
//       einsetzen -> dieser Test wird ROT (0 statt 14).
//   (b) den Inbound-Zweig in callTariffCentsPerMin auf
//       tariffCentsPerMin(call.to, call.to) zuruecksetzen -> ROT (60 statt 14, OWN_DID ist
//       eine US-DID ohne Inlandssatz -> DEFAULT_CENTS).
test("KV-P2-1: ein beendeter Inbound-Call mit 2 Minuten erhoeht spendMonthCostCents und costCents um 2 x Inbound-Satz", () => {
  const s = makeDefaultState();
  const call = makeInboundCall(s, {
    answeredAt: "2026-07-30T11:58:00.000Z",
    endedAt: "2026-07-30T12:00:00.000Z", // 2 Minuten
  });
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(s) });

  reconcileVoiceBudget(call);

  const bucket = usageOf(s, TENANT);
  assert.equal(bucket.spendMonthCostCents, 2 * INBOUND_CENTS);
  assert.equal(bucket.costCents, 2 * INBOUND_CENTS, "Lebenszeit-Achse zieht mit");
  assert.notEqual(
    2 * INBOUND_CENTS,
    2 * DEFAULT_CENTS,
    "Fixture-Anspruch: der alte Pfad haette 2 x 30 = 60 gebucht",
  );
});

// ---- KV-P2-2: estimated_cost_cents + BEIDE Achsen-Anker stehen an der Inbound-Zeile ----
//
// MUTATIONSPROBE: die Bucket-Brigade umdrehen (Anker VOR store.addVoiceUsageCostCents lesen)
// -> spendMonthKey ist null statt "2026-07". Ohne diese drei Felder kann KV-P3 spaeter nicht
// korrigieren.
test("KV-P2-2: estimated_cost_cents und beide Achsen-Anker sind an der Inbound-call-Zeile gesetzt", () => {
  const s = makeDefaultState();
  const call = makeInboundCall(s, {
    answeredAt: "2026-07-30T11:59:00.000Z",
    endedAt: "2026-07-30T12:00:00.000Z", // 1 Minute
  });
  stampBudgetPeriod(s, TENANT, PERIOD_START_ISO);
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(s) });

  reconcileVoiceBudget(call);

  const row = getCall(s, call.id);
  assert.equal(row.estimatedCostCents, 1 * INBOUND_CENTS);
  assert.equal(row.estimatedCostSpendMonthKey, NOW_SPEND_MONTH_KEY, "= chargeAnchorsOfUsage NACH der Buchung");
  assert.equal(row.estimatedCostPeriodKey, PERIOD_START_ISO);
});

// ---- KV-P2-3: nie beantwortet -> 0, PLUS der Grenzfall (unbrauchbares answeredAt) ----
test("KV-P2-3: ein nie beantworteter Inbound-Call bucht nichts", () => {
  const s = makeDefaultState();
  const call = makeInboundCall(s, { answeredAt: null, endedAt: "2026-07-30T12:00:00.000Z" });
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(s) });

  reconcileVoiceBudget(call);

  assert.equal(usageOf(s, TENANT).costCents, 0);
  assert.equal(
    getCall(s, call.id).estimatedCostCents,
    null,
    "kein Null-Estimate - KV-P3 haette sonst einen Bezugspunkt ohne Buchung",
  );
});

// T5-Grenzfall (Teil desselben Konzepts: "bucht nichts", nicht ein zweites): ein
// UNBRAUCHBARES answeredAt normalisiert ueber voiceMinutesOf auf 0 Minuten - kein NaN im
// Bucket, keine Buchung.
test("KV-P2-3 (T5-Grenzfall): unbrauchbares answeredAt normalisiert auf 0 Minuten, keine Buchung, kein NaN", () => {
  const s = makeDefaultState();
  const call = makeInboundCall(s, { answeredAt: "kaputt", endedAt: "2026-07-30T12:00:00.000Z" });
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(s) });

  reconcileVoiceBudget(call);

  assert.equal(usageOf(s, TENANT).costCents, 0);
  assert.notEqual(usageOf(s, TENANT).costCents, NaN);
});

// ---- KV-P2-5: Ein-Quellen-Riegel (strukturell, Muster KV-P1-10) --------------------------
//
// Fangt eine zweite Inbound-Tarif-Quelle ab, bevor sie entsteht (G5/G27): die Landkarte
// deklariert EINE Preisquelle je Kosten-Art - ein zweites Vorkommen macht die Deklaration
// zur Luege, ohne dass ein Verhaltenstest rot wird.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git"]);

test("KV-P2-5: billing.voiceTariffInboundCents wird an genau EINER Stelle in src/ gelesen, in src/billing/metering.js", () => {
  function alleSrcDateien(relDir) {
    const treffer = [];
    const stack = [path.join(REPO_ROOT, relDir)];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && entry.name.endsWith(".js")) treffer.push(full);
      }
    }
    return treffer;
  }

  // Matcht JEDE Lesestelle "<irgendein Bezeichner>.billing.voiceTariffInboundCents"
  // (config/defaultConfig/cfg/...) - nicht nur den literalen Bezeichner "config", der in
  // metering.js bewusst als "defaultConfig" importiert ist (Idiom aus outbound-gates.js,
  // s. dortiges tariffCentsPerMin). Die Deklarationszeile in config.js ("voiceTariffInbound
  // Cents: numEnv(...)" bzw. der Namensraum-String in CONFIG_NAMESPACES.billing) traegt
  // kein ".billing." davor und faellt damit NICHT unter dieses Muster - nur eine zweite
  // LESESTELLE waere ein Treffer.
  const CALL_SITE_PATTERN = /\bbilling\.voiceTariffInboundCents\b/g;
  const EXPECTED_CALL_SITE = "src/billing/metering.js";

  const vorkommenJeDatei = alleSrcDateien("src")
    .map((datei) => ({
      datei: path.relative(REPO_ROOT, datei),
      anzahl: [...fs.readFileSync(datei, "utf8").matchAll(CALL_SITE_PATTERN)].length,
    }))
    .filter((eintrag) => eintrag.anzahl > 0);

  const gesamtVorkommen = vorkommenJeDatei.reduce((summe, eintrag) => summe + eintrag.anzahl, 0);
  const fundstellen = vorkommenJeDatei.map((eintrag) => `${eintrag.datei}:${eintrag.anzahl}`).join(", ") || "keine";

  assert.equal(
    gesamtVorkommen,
    1,
    `eine zweite Inbound-Tarif-Quelle waere G5-Bruch - gefunden: ${gesamtVorkommen} Vorkommen [${fundstellen}]`,
  );
  assert.deepEqual(
    vorkommenJeDatei.map((eintrag) => eintrag.datei),
    [EXPECTED_CALL_SITE],
    `das einzige Vorkommen muss in ${EXPECTED_CALL_SITE} liegen - gefunden: [${fundstellen}]`,
  );
});

// ---- KV-P2-4: GENAU EINE Buchung je Call, auch ueber einen Neustart hinweg ---------------
// Spawn-Test im Muster test/finishcall-billing-once.test.js, mit INBOUND-Seed. Der
// persistierte billedAt-Marker (state-ops.markBilled, call-finish.js) deckt Inbound
// IDENTISCH ab - keine Zeile Aenderung dort war noetig (Pre-Mortem TOD 2).
//
// MUTATIONSPROBE: `if (!call.billedAt)` in finishCall entfernen -> Schritt 3 (nach dem
// Neustart) liefert 2x statt x -> ROT.
const CALL_ID = "kv_p2_bill_once";
const BILLED_MINUTES = 5;
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const SPAWN_TARIFF_ENV = { VOICE_TARIFF_INBOUND_CENTS: String(INBOUND_CENTS) };

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

async function completeCall(srv, callId) {
  const res = await postStatus(srv, callId, { CallStatus: "completed" });
  assert.equal(res.status, 200);
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
}

const ownerCostCents = (srv) => srv.readStore().usage[BOOTSTRAP_TENANT_ID].costCents;

test("KV-P2-4: genau EINE Buchung je Inbound-Call, auch ueber einen Prozess-Neustart hinweg", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        direction: "inbound",
        from: DOMESTIC_TEST_NUMBER.e164,
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
      }),
    ],
  });

  const srv1 = await startServer({ env: SPAWN_TARIFF_ENV, seed });
  const expectedCostCents = BILLED_MINUTES * INBOUND_CENTS;
  let dataDir;
  try {
    // 1) erster Callback -> genau eine Buchung.
    await completeCall(srv1, CALL_ID);
    assert.equal(ownerCostCents(srv1), expectedCostCents, "erste Buchung: Minuten x Inbound-Satz");

    // 2) zweiter Callback IM SELBEN Prozess -> unveraendert (In-Memory _finished).
    await completeCall(srv1, CALL_ID);
    assert.equal(ownerCostCents(srv1), expectedCostCents, "zweiter Callback im selben Prozess bucht nicht erneut");

    const persisted = srv1.readStore().calls.find((c) => c.id === CALL_ID);
    assert.equal(persisted.billedAt !== null && persisted.billedAt !== undefined, true, "billedAt ist persistiert");
    dataDir = srv1.dataDir;
  } finally {
    await srv1.stop();
  }

  // 3) Prozess-NEUSTART auf DERSELBEN Platte: frisches call._finished (Boot-Default), aber
  // der persistierte billedAt-Marker vom ersten Prozess bleibt bestehen.
  const srv2 = await startServer({ env: SPAWN_TARIFF_ENV, dataDir });
  try {
    await completeCall(srv2, CALL_ID);
    assert.equal(
      ownerCostCents(srv2),
      expectedCostCents,
      "dritter Callback nach Neustart bucht NICHT erneut (bleibt x, nicht 2x)",
    );
    const persisted = srv2.readStore().calls.find((c) => c.id === CALL_ID);
    assert.equal(persisted.billedAt !== null && persisted.billedAt !== undefined, true, "billedAt ueberlebt den Neustart");
  } finally {
    await srv2.stop();
  }
});

// ---- FAIL-RICHTUNG: unset/leer -> Code-Fallback 6, NIE 0 --------------------------------
// Kein Test oben pinnt den NACKTEN Code-Fallback - jeder setzt VOICE_TARIFF_INBOUND_CENTS
// explizit, um von einer lokalen .env unabhaengig zu sein (Lehre test-base-env-drift). Ohne
// diesen Test waere eine Regression, die den Fallback in src/config.js stillschweigend von
// 6 auf 0 aendert, durch KEINEN Test dieser Datei gefangen - "unset -> 6" waere Dokumentation,
// nicht Code-Garantie. numEnv() behandelt einen LEEREN String identisch zu "nicht gesetzt"
// (raw === "" -> fallback), deshalb ueberschreibt env:{VOICE_TARIFF_INBOUND_CENTS:""}
// deterministisch die BASE_ENV-Neutralisierung ("0") des Spawn-Helpers, ohne von der
// Shell-Umgebung des Testlaufs abzuhaengen.
//
// MUTATIONSPROBE: fallback in src/config.js (voiceTariffInboundCents) von 6 auf 0 aendern
// -> dieser Test wird ROT (0 statt 30).
const CODE_FALLBACK_INBOUND_CENTS = 6; // gehalten gegen src/config.js voiceTariffInboundCents.fallback
test("FAIL-RICHTUNG: VOICE_TARIFF_INBOUND_CENTS unset/leer bucht mit dem Code-Fallback 6, nie 0", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: "kv_p2_fallback",
        direction: "inbound",
        from: DOMESTIC_TEST_NUMBER.e164,
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
      }),
    ],
  });
  const srv = await startServer({ env: { VOICE_TARIFF_INBOUND_CENTS: "" }, seed });
  try {
    await completeCall(srv, "kv_p2_fallback");
    assert.equal(
      ownerCostCents(srv),
      BILLED_MINUTES * CODE_FALLBACK_INBOUND_CENTS,
      "unset/leer bucht den Code-Fallback (6), nie 0",
    );
    assert.notEqual(ownerCostCents(srv), 0, "kein stilles 0-Buchen bei fehlendem Wert");
  } finally {
    await srv.stop();
  }
});
