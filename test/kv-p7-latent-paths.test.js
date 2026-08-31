// KV-P7: latente Kosten-Pfade verriegeln. Zwei Boot-Guards (Play-TTS ohne gedeckte Kosten,
// Realtime ohne Mid-Call-Budget-Pruefung) + Massnahme 3 (Telnyx-Relay-Verbrauch im
// ElevenLabs-Kontingent-Zaehler sichtbar machen, statt eines neuen Preis-Parameters -
// Begruendung: tasks/kv-p7-tts-klaerung.md, TEIL 1 der Phase).
//
// IDs beginnen mit "KV-P7-" - kein i18n-Katalog-Praefix (DID|E2E|FMT|GAP|LANG|LAW|MCP|
// ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer), landet also im
// npm-test-Regressionslauf, nicht im test:gates-Katalog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { latentCostPathFindings, LATENT_COST_PATH_FINDING } from "../src/boot-guard.js";
import { REALTIME_MID_CALL_BUDGET_CHECK } from "../src/bridge.js";
import { ttsQuotaCoverageBannerLine } from "../src/boot.js";
import {
  makeDefaultState,
  usageFor,
  recordRelayTtsCharacters,
  recordTtsCharacters,
  platformTtsUsageView,
  PLATFORM_TTS_COST_CENTER_ID,
} from "../src/store/state-ops.js";
import { startServer, ROOT } from "./helpers.js";

// Konfig-Fixture des ElevenLabs-Kontingents (Muster tts-quota-counter.test.js): flach, weil
// bumpPlatformTtsQuota/recordRelayTtsCharacters cfg.ttsCharacterQuota direkt lesen (der
// Aufrufer reicht bereits config.billing herein, nicht die gesamte Config).
const CFG = { ttsCharacterQuota: 1000, ttsCharacterQuotaWarnPercent: 75, ttsQuotaCycleAnchorDay: 3 };
const NOW_ISO = "2026-08-15T10:00:00.000Z";

// ---- Guard 1: Play-TTS ohne gedeckte Kosten (PLAY_TTS_UNPRICED) -------------------------

test("KV-P7-1: ELEVENLABS_PLAY_TTS_ENABLED=true -> genau ein Befund PLAY_TTS_UNPRICED mit Handlung", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: true,
    realtimeEngineSelected: false,
    realtimeMidCallBudgetCheck: false,
    realtimeCarrierHasCollector: true,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, LATENT_COST_PATH_FINDING.PLAY_TTS_UNPRICED);
  assert.equal(findings[0].fatal, false, "WARN, kein Boot-Refusal");
  assert.match(findings[0].message, /ELEVENLABS_PLAY_TTS_ENABLED/);
  assert.match(findings[0].message, /Handlung:/, "P8: die Meldung nennt eine Handlung, nicht nur den Fehler");
});

test("KV-P7-2 (Gegenbeispiel): ELEVENLABS_PLAY_TTS_ENABLED=false, Budget-Engine -> kein Befund, Boot laeuft normal", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: false,
    realtimeMidCallBudgetCheck: false,
    realtimeCarrierHasCollector: true,
  });
  assert.deepEqual(findings, []);
});

// ---- Guard 2: Realtime ohne Mid-Call-Budget-Pruefung (REALTIME_NO_MIDCALL_BUDGET) --------

test("KV-P7-3: VOICE_ENGINE=realtime ohne Mid-Call-Budget-Pruefung -> genau ein Befund REALTIME_NO_MIDCALL_BUDGET", () => {
  // Der REALE Stand aus src/bridge.js (heute false) - anders als KV-P7-4 (hypothetisches
  // Gegenbeispiel mit hartem true) belegt dieser Test den TATSAECHLICHEN Boot-Zustand UND
  // reagiert auf dieselbe Mutation wie KV-P7-6 (M3: REALTIME_MID_CALL_BUDGET_CHECK=true).
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: true,
    realtimeMidCallBudgetCheck: REALTIME_MID_CALL_BUDGET_CHECK,
    realtimeCarrierHasCollector: true,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, LATENT_COST_PATH_FINDING.REALTIME_NO_MIDCALL_BUDGET);
  assert.equal(findings[0].fatal, false, "WARN, kein Boot-Refusal");
  assert.match(findings[0].message, /VOICE_ENGINE=realtime/);
  assert.match(findings[0].message, /Handlung:/, "P8: die Meldung nennt eine Handlung, nicht nur den Fehler");
});

test("KV-P7-4 (Gegenbeispiel, die Sache): realtimeMidCallBudgetCheck=true -> kein Befund, obwohl VOICE_ENGINE=realtime", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: true,
    realtimeMidCallBudgetCheck: true,
    realtimeCarrierHasCollector: true,
  });
  assert.deepEqual(findings, [], "der Guard prueft die SACHE, nicht nur das Flag VOICE_ENGINE=realtime allein");
});

test("KV-P7-5 (Gegenbeispiel, das Flag): Budget-Engine mit realtimeMidCallBudgetCheck=false -> kein Befund", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: false,
    realtimeMidCallBudgetCheck: false,
    realtimeCarrierHasCollector: true,
  });
  assert.deepEqual(findings, []);
});

test("KV-P7-6 (die Konstante darf nicht luegen): REALTIME_MID_CALL_BUDGET_CHECK=false, UND src/bridge.js prueft (noch) keine Budget-Achse", () => {
  assert.equal(REALTIME_MID_CALL_BUDGET_CHECK, false);
  const bridgeSource = fs.readFileSync(path.join(ROOT, "src/bridge.js"), "utf8");
  // \( = ein tatsaechlicher AUFRUF, nicht nur die Erwaehnung des Namens (der eigene
  // Kommentar der Konstante NENNT blockingBudgetAxis bewusst zur Erklaerung, OHNE sie
  // aufzurufen - ein reiner Substring-Test wuerde an diesem Kommentar falsch-positiv rot).
  assert.doesNotMatch(
    bridgeSource,
    /blockingBudgetAxis\(/,
    "src/bridge.js darf blockingBudgetAxis noch nicht AUFRUFEN - sonst luegt REALTIME_MID_CALL_BUDGET_CHECK=false " +
      "und der Guard bliebe faelschlich stumm. Baut jemand die Pruefung, MUSS die Konstante auf true wechseln.",
  );
});

test("KV-P7-7 (Gegenbeleg Budget-Engine): src/claude.js prueft blockingBudgetAxis in roundStopReason vor JEDER Turn-Runde", () => {
  const claudeSource = fs.readFileSync(path.join(ROOT, "src/claude.js"), "utf8");
  const fnStart = claudeSource.indexOf("function roundStopReason");
  assert.ok(fnStart >= 0, "roundStopReason nicht gefunden - der Unterschied, den Guard 2 behauptet, waere nicht mehr belegt");
  const fnBody = claudeSource.slice(fnStart, fnStart + 400);
  assert.match(fnBody, /blockingBudgetAxis\(/);
});

// ---- Massnahme 3 (Abnahme 2, Ops-Ebene): Relay-Zeichen im Kontingent-Zaehler -------------

test("KV-P7-8: Relay-Zeichen kommen im Kontingent-Zaehler an (Massnahme 3)", () => {
  const state = makeDefaultState();
  const result = recordRelayTtsCharacters(state, { tenantId: "t_x", chars: 729, cfg: CFG, nowIso: NOW_ISO });
  assert.equal(result.changed, true);
  assert.equal(usageFor(state, "t_x").ttsCharacters, 729, "echter Tenant-Bucket");
  assert.equal(platformTtsUsageView(state, CFG, NOW_ISO).characters, 729, "Plattform-Zyklus-Zaehler");
});

test("KV-P7-9 (Abgrenzung): Relay-Verbrauch faelscht den reservierten Play-TTS-Kostentraeger nicht", () => {
  const state = makeDefaultState();
  recordRelayTtsCharacters(state, { tenantId: "t_x", chars: 729, cfg: CFG, nowIso: NOW_ISO });
  assert.equal(usageFor(state, PLATFORM_TTS_COST_CENTER_ID).ttsCharacters, 0);
});

test("KV-P7-10 (Regression): recordTtsCharacters bucht unveraendert global UND auf den Kostentraeger", () => {
  const state = makeDefaultState();
  const result = recordTtsCharacters(state, 238, CFG, NOW_ISO);
  assert.equal(result.changed, true);
  assert.equal(platformTtsUsageView(state, CFG, NOW_ISO).characters, 238);
  assert.equal(usageFor(state, PLATFORM_TTS_COST_CENTER_ID).ttsCharacters, 238, "Aufteilung ist verhaltensgleich zum Bestand");
});

test("KV-P7-11 (fail-closed): ungueltige Zeichenzahl bewegt keinen Zaehler", () => {
  for (const chars of [0, 1.5, -3]) {
    const state = makeDefaultState();
    const result = recordRelayTtsCharacters(state, { tenantId: "t_x", chars, cfg: CFG, nowIso: NOW_ISO });
    assert.deepEqual(result, { changed: false, warning: null }, `chars=${chars}`);
    assert.equal(usageFor(state, "t_x").ttsCharacters, 0, `chars=${chars}: Tenant-Bucket unveraendert`);
    assert.equal(platformTtsUsageView(state, CFG, NOW_ISO).characters, 0, `chars=${chars}: Plattform-Zaehler unveraendert`);
  }
});

// ---- Banner ------------------------------------------------------------------------------

test("KV-P7-14: ttsQuotaCoverageBannerLine nennt die Quote und den UNTERGRENZE-Vorbehalt", () => {
  const line = ttsQuotaCoverageBannerLine({ ttsCharacterQuota: 39981 });
  assert.match(line, /39981/);
  assert.match(line, /UNTERGRENZE/);
});

// ---- Abnahme 4 (Spawn): Standardkonfiguration bleibt still -------------------------------

test("KV-P7-15: Standardkonfiguration (alle Flags aus) -> kein neuer Befund, /healthz 200, Kontingent-Zeile im Banner", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    // Kein neuer Befund: die eindeutigen Formulierungen BEIDER Guard-Meldungen fehlen
    // komplett (BASE_ENV pinnt ELEVENLABS_PLAY_TTS_ENABLED=false und VOICE_ENGINE=budget).
    assert.doesNotMatch(srv.stdout, /die von diesem Pfad selbst synthetisierten Zeichen/);
    assert.doesNotMatch(srv.stdout, /Realtime-Bruecke prueft nach Gespraechsbeginn/);
    assert.match(
      srv.stdout,
      /ElevenLabs-Kontingent: TTS_CHARACTER_QUOTA=\d+ Zeichen\/Zyklus \| Relay-Verbrauch: nachtraeglich ueber den Ist-Abgleich gezaehlt \(UNTERGRENZE - nur belegte Anrufe\)/,
    );
  } finally {
    await srv.stop();
  }
});
