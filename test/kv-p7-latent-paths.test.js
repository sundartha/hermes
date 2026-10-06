import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { latentCostPathFindings, LATENT_COST_PATH_FINDING } from "../src/boot-guard.js";
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

const CFG = { ttsCharacterQuota: 1000, ttsCharacterQuotaWarnPercent: 75, ttsQuotaCycleAnchorDay: 3 };
const NOW_ISO = "2026-08-15T10:00:00.000Z";

test("KV-P7-1: ELEVENLABS_PLAY_TTS_ENABLED=true -> genau ein Befund PLAY_TTS_UNPRICED mit Handlung", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: true,
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
  });
  assert.deepEqual(findings, []);
});

test("KV-P7-7 (Gegenbeleg Budget-Engine): src/claude.js prueft blockingBudgetAxis in roundStopReason vor JEDER Turn-Runde", () => {
  const claudeSource = fs.readFileSync(path.join(ROOT, "src/claude.js"), "utf8");
  const fnStart = claudeSource.indexOf("function roundStopReason");
  assert.ok(
    fnStart >= 0,
    "roundStopReason nicht gefunden - die Mid-Call-Pruefung der Budget-Engine waere nicht mehr belegt",
  );
  const fnBody = claudeSource.slice(fnStart, fnStart + 400);
  assert.match(fnBody, /blockingBudgetAxis\(/);
});

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

test("KV-P7-14: ttsQuotaCoverageBannerLine nennt die Quote und den UNTERGRENZE-Vorbehalt", () => {
  const line = ttsQuotaCoverageBannerLine({ ttsCharacterQuota: 39981 });
  assert.match(line, /39981/);
  assert.match(line, /UNTERGRENZE/);
});

test("KV-P7-15: Standardkonfiguration (alle Flags aus) -> kein neuer Befund, /healthz 200, Kontingent-Zeile im Banner", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /die von diesem Pfad selbst synthetisierten Zeichen/);
    assert.match(
      srv.stdout,
      /ElevenLabs-Kontingent: TTS_CHARACTER_QUOTA=\d+ Zeichen\/Zyklus \| Relay-Verbrauch: nachtraeglich ueber den Ist-Abgleich gezaehlt \(UNTERGRENZE - nur belegte Anrufe\)/,
    );
  } finally {
    await srv.stop();
  }
});
