// P2b (PLAN-CONVERSATION-QUALITY-V2): Diagnose-Retention + das geschlossene
// `allowSummaries`-Leck. Vier Bloecke:
//   A - diagnosticRetentionGranted (Scope-Pruefung, offline/rein)
//   B - finishCall ueber makeCallFinish (der wichtigste Test: P2b-10 MUSS vor dem
//       Fix in call-finish.js rot sein - der Purge lief vorher NACH dem Frueh-Return)
//   C - purgeExpiredDiagnosticTranscripts (reiner Sweep-Durchgang)
//   D - pruneOldData-Komposition + json-Persistenz-Durchstich
// Kein Netz, kein Spawn (D-32 nutzt tempDataDir + einen In-Process-Import wie
// retention.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
  diagnosticRetentionGranted,
  keepsTranscriptForDiagnosis,
} from "../src/diagnostic-retention.js";
import {
  purgeExpiredDiagnosticTranscripts,
  pruneOldData,
} from "../src/store/state-ops.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { tempDataDir, seedState, seedCall } from "./helpers.js";

const OWN = "+491737252163";
const FOREIGN = "+491729999001";
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
const AT = "2026-01-01T00:00:00Z";

// LAW-15 (i18n-Launch-Testkatalog, Buchhaltung - kein eigener Test, G5): die Haelfte
// "fail-closed bei 0" ist hier bereits gepinnt (P2b-05: kein Flag wird gewaehrt;
// P2b-12: der Purge laeuft trotzdem; P2b-24: jedes beendete Diagnose-Transkript faellt;
// P2b-31: retentionDays=0 schaltet die Diagnose-Frist nicht mit ab) plus
// test/retention.test.js "RETENTION_DAYS=0 schaltet die Retention ab". Die andere
// Haelfte (Defaults 30/7 gegen .env.example) traegt
// test/env-docs-spend-cap-coherence.test.js.
// ---- Block A: diagnosticRetentionGranted (Scope-Pruefung, offline) ----

test("P2b-01: eigenes Ziel + Frist scharf + requested=true -> gewaehrt", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: true,
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    true,
  );
});

test("P2b-02: fremdes Ziel -> verweigert (Scope-Beweis)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: true,
      to: FOREIGN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    false,
  );
});

test("P2b-03: Tenant ohne privateNumber (ownNumber=null) -> verweigert", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: true,
      to: OWN,
      ownNumber: null,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    false,
  );
});

test("P2b-04: requested als String 'true' -> gewaehrt (GQ-P11: die Strenge sitzt jetzt auf der Ablehnungsseite)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: "true",
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    true,
  );
});

test("P2b-05: DIAGNOSTIC_RETENTION_DAYS=0 -> Feature aus, kein Flag wird gewaehrt", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: true,
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 0 },
    }),
    false,
  );
});

test("P2b-06: requested=undefined -> gewaehrt (GQ-P11: kein Modell-Opt-in mehr noetig)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: undefined,
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    true,
  );
});

// GQ-P11: die Umkehrung. Opt-in wurde Opt-out - der Server gewaehrt von sich aus, ein
// ausdruecklicher Widerspruch (false/"false") verweigert.

test("GQ-P11-1: das Feld fehlt ganz im Objekt -> gewaehrt (der Kern der Phase)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    true,
  );
});

test("GQ-P11-2: requested=false -> verweigert (die Ablehnung wirkt)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: false,
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    false,
  );
});

test("GQ-P11-3: requested='false' (urlencoded) -> verweigert (die umgekehrte Falle)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: "false",
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    false,
  );
});

test("GQ-P11-4: requested=null -> gewaehrt (null ist kein Widerspruch)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      requested: null,
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    true,
  );
});

test("GQ-P11-5: fremdes Ziel OHNE requested -> verweigert (das Ziel-Gate traegt jetzt allein)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      to: FOREIGN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 7 },
    }),
    false,
  );
});

test("GQ-P11-6: Frist 0 OHNE requested -> verweigert (Feature-Aus schlaegt den Default-Grant)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      to: OWN,
      ownNumber: OWN,
      privacy: { diagnosticRetentionDays: 0 },
    }),
    false,
  );
});

test("GQ-P11-7: ownNumber='' (leer) -> verweigert (Boolean-Guard, kein '' === '' -Treffer)", () => {
  assert.equal(
    diagnosticRetentionGranted({
      to: "",
      ownNumber: "",
      privacy: { diagnosticRetentionDays: 7 },
    }),
    false,
  );
});

// ---- Block B: finishCall (makeCallFinish) - der wichtigste Test ----

// Minimale Stubs: nur was call-finish.js tatsaechlich aufruft. purged[] zeichnet jeden
// purgeTranscript-Aufruf auf (Muster Plan §3.1 Block B).
function makeFakeStore(call) {
  const purged = [];
  return {
    purged,
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: () => {},
    purgeTranscript: (id) => purged.push(id),
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: () => {
      call.billedAt = new Date().toISOString();
    },
  };
}

function makeHarness({ call, summarizeCall, diagnosticRetentionDays = 7 }) {
  const config = {
    billing: { paymentEnabled: false, smsCostCents: 0 },
    privacy: { diagnosticRetentionDays },
  };
  const store = makeFakeStore(call);
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall,
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
  });
  return { callFinish, store };
}

test("P2b-10 (rot vor Fix): allowSummaries=false (summarizeCall->null) OHNE diagnostic -> Transkript wird trotzdem gepurgt", async () => {
  const call = seedCall({ status: "completed", transcript: [{ role: "caller", text: "Geheim", at: AT }] });
  const { callFinish, store } = makeHarness({ call, summarizeCall: async () => null });
  await callFinish.finishCall(call);
  assert.deepEqual(store.purged, [call.id]);
});

test("P2b-11: allowSummaries=false + diagnostic=true -> Purge unterbleibt", async () => {
  const call = seedCall({
    status: "completed",
    diagnostic: true,
    transcript: [{ role: "caller", text: "Geheim", at: AT }],
  });
  const { callFinish, store } = makeHarness({ call, summarizeCall: async () => null });
  await callFinish.finishCall(call);
  assert.deepEqual(store.purged, []);
});

test("P2b-12: diagnostic=true, aber DIAGNOSTIC_RETENTION_DAYS=0 -> Purge laeuft trotzdem (fail-closed)", async () => {
  const call = seedCall({
    status: "completed",
    diagnostic: true,
    transcript: [{ role: "caller", text: "Geheim", at: AT }],
  });
  const { callFinish, store } = makeHarness({
    call,
    summarizeCall: async () => null,
    diagnosticRetentionDays: 0,
  });
  await callFinish.finishCall(call);
  assert.deepEqual(store.purged, [call.id]);
});

test("P2b-13 (Bestandspin): erfolgreiche Summary + diagnostic=false -> Purge wie bisher", async () => {
  const call = seedCall({ status: "completed", transcript: [{ role: "caller", text: "Geheim", at: AT }] });
  const { callFinish, store } = makeHarness({
    call,
    summarizeCall: async () => ({ summary: "Zusammenfassung", actionItems: [] }),
  });
  await callFinish.finishCall(call);
  assert.deepEqual(store.purged, [call.id]);
});

test("P2b-14 (Bestandspin): summarizeCall wirft -> Purge unterbleibt (Exception-Pfad unveraendert)", async () => {
  const call = seedCall({ status: "completed", transcript: [{ role: "caller", text: "Geheim", at: AT }] });
  const { callFinish, store } = makeHarness({
    call,
    summarizeCall: async () => {
      throw new Error("llm down");
    },
  });
  await callFinish.finishCall(call);
  assert.deepEqual(store.purged, []);
});

// ---- Block C: purgeExpiredDiagnosticTranscripts (reiner Sweep-Durchgang) ----

test("P2b-20: alter beendeter Diagnose-Call -> Transkript geleert, Record bleibt", () => {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_diag_old",
        status: "completed",
        diagnostic: true,
        endedAt: daysAgo(10),
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
  });
  const purged = purgeExpiredDiagnosticTranscripts(s, 7);
  assert.equal(purged, 1);
  const call = s.calls.find((c) => c.id === "call_diag_old");
  assert.deepEqual(call.transcript, []);
  assert.ok(call, "Record existiert weiter (Abnahmekriterium 2)");
});

test("P2b-21: frischer Diagnose-Call -> Transkript unangetastet", () => {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_diag_fresh",
        status: "completed",
        diagnostic: true,
        endedAt: daysAgo(1),
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
  });
  const purged = purgeExpiredDiagnosticTranscripts(s, 7);
  assert.equal(purged, 0);
  assert.deepEqual(s.calls[0].transcript, [{ role: "caller", text: "Geheim", at: AT }]);
});

test("P2b-22: alter Nicht-Diagnose-Call -> dieser Durchgang fasst ihn nicht an", () => {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_nondiag_old",
        status: "completed",
        endedAt: daysAgo(10),
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
  });
  const purged = purgeExpiredDiagnosticTranscripts(s, 7);
  assert.equal(purged, 0);
  assert.deepEqual(s.calls[0].transcript, [{ role: "caller", text: "Geheim", at: AT }]);
});

test("P2b-23: aktiver Diagnose-Call (endedAt=null) -> unangetastet", () => {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_diag_active",
        status: "active",
        diagnostic: true,
        endedAt: null,
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
  });
  const purged = purgeExpiredDiagnosticTranscripts(s, 7);
  assert.equal(purged, 0);
  assert.deepEqual(s.calls[0].transcript, [{ role: "caller", text: "Geheim", at: AT }]);
});

test("P2b-24: days=0 -> jedes beendete Diagnose-Transkript faellt (dokumentierte Asymmetrie)", () => {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_diag_just_ended",
        status: "completed",
        diagnostic: true,
        // Knapp in der Vergangenheit (nicht new Date() im selben Tick wie der cutoff
        // unten) - sonst waere endedAt>=cutoff eine Zeit-Ties-Falle statt eines
        // echten Vergleichs (F.I.R.S.T./R).
        endedAt: daysAgo(0.001),
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
  });
  const purged = purgeExpiredDiagnosticTranscripts(s, 0);
  assert.equal(purged, 1);
  assert.deepEqual(s.calls[0].transcript, []);
});

// ---- Block D: Komposition + Persistenz ----

test("P2b-30: pruneOldData komponiert beide Durchgaenge (diagnosticTranscripts=1, Record bleibt)", () => {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_diag_old",
        status: "completed",
        diagnostic: true,
        endedAt: daysAgo(10),
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
  });
  // AL-P11: evidenceRetentionDays explizit (kein Default in state-ops.pruneOldData).
  const removed = pruneOldData(s, { retentionDays: 30, diagnosticRetentionDays: 7, evidenceRetentionDays: 0 });
  assert.equal(removed.diagnosticTranscripts, 1);
  assert.ok(s.calls.some((c) => c.id === "call_diag_old"), "Call-Record bleibt (nur die lange Frist entfernt ihn)");
});

test("P2b-31: retentionDays=0 schaltet die Diagnose-Frist NICHT mit ab", () => {
  const s = seedState({
    calls: [
      seedCall({
        id: "call_diag_old",
        status: "completed",
        diagnostic: true,
        endedAt: daysAgo(10),
        transcript: [{ role: "caller", text: "Geheim", at: AT }],
      }),
    ],
  });
  // AL-P11: evidenceRetentionDays explizit (kein Default in state-ops.pruneOldData).
  const removed = pruneOldData(s, { retentionDays: 0, diagnosticRetentionDays: 7, evidenceRetentionDays: 0 });
  assert.equal(removed.diagnosticTranscripts, 1);
});

test("P2b-32: json-Store-Durchstich - pruneOldData(30,7) persistiert den Diagnose-Purge auf Platte", async () => {
  const dataDir = tempDataDir(
    seedState({
      calls: [
        seedCall({
          id: "call_diag_old",
          status: "completed",
          diagnostic: true,
          endedAt: daysAgo(10),
          transcript: [{ role: "caller", text: "geheimer diagnose text", at: AT }],
        }),
      ],
    }),
  );
  process.env.DATA_DIR = dataDir;
  const store = await import("../src/store.js");
  const removed = store.pruneOldData(30, 7);
  assert.equal(removed.diagnosticTranscripts, 1);

  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  assert.ok(!JSON.stringify(onDisk).includes("geheimer diagnose text"));
  assert.ok(onDisk.calls.some((c) => c.id === "call_diag_old"), "Call-Record bleibt auf Platte");
});
