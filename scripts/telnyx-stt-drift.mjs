#!/usr/bin/env node
// Drift-Probe fuer den VIERTEN Ort der STT-Wahl: das Telnyx-Assistant-Objekt.
// NUR LESEND (GET), patcht nie. Kein Repo-Test kann Remote-Zustand sehen, und der
// Provisionierer fasst `transcription` bewusst nicht an (PRESERVED_SAFETY_FIELDS) -
// dieser Ort hat sonst KEIN Netz. Exit != 0 bei Modell-Drift.
// NIE den API-Key loggen (Regel 4); der Snapshot landet im gitignorten
// <DATA_DIR>/evidence/telnyx-config/ (Bestandspraxis), nie auf stdout.
//
// GRENZE, ausdruecklich: ob der Pro-Call-transcription-Block die `settings` des
// Objekts ersetzt oder mit ihnen zusammengefuehrt wird, ist UNBELEGT. Diese Probe
// vergleicht den Objektzustand, sie beweist keine Laufzeitwirkung.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { assertTelnyxOk } from "../src/telephony/adapters/telnyx/errors.js";
import { sttAttrs } from "../src/telephony/adapters/telnyx/stt-model.js";

const AI_ASSISTANTS_PATH = "/v2/ai/assistants";
const EVIDENCE_SUBDIR = path.join("evidence", "telnyx-config");
const DEEPGRAM_VENDOR_PREFIX = "deepgram/";
const FLUX_MODEL = "deepgram/flux";
const NOVA3_MODEL = "deepgram/nova-3";
const ASSEMBLYAI_STREAMING_MODEL = "assemblyai/universal-streaming";

// Kopplung Modell <-> gueltige Einstellungen (Telnyx-Doku "transcription-settings",
// abgerufen 2026-08-07). BEWUSST hier und NICHT in src/: kein Produktionscode sendet je
// eines dieser Felder - eine Tabelle ohne Aufrufer waere Vorratshaltung (P15). Hier hat
// sie einen Aufrufer und ein Signal.
const SETTING_SCOPE = Object.freeze({
  eot_threshold: { models: [FLUX_MODEL] },
  eager_eot_threshold: { models: [FLUX_MODEL] },
  eot_timeout_ms: { models: [FLUX_MODEL] },
  smart_format: { vendorPrefix: DEEPGRAM_VENDOR_PREFIX, exceptModels: [FLUX_MODEL] },
  numerals: { vendorPrefix: DEEPGRAM_VENDOR_PREFIX, exceptModels: [FLUX_MODEL] },
  keyterm: { models: [FLUX_MODEL, NOVA3_MODEL] },
  end_of_turn_confidence_threshold: { models: [ASSEMBLYAI_STREAMING_MODEL] },
  min_turn_silence: { models: [ASSEMBLYAI_STREAMING_MODEL] },
  max_turn_silence: { models: [ASSEMBLYAI_STREAMING_MODEL] },
});

// Gilt diese Einstellung fuer das gegebene Modell? Zwei Scope-Formen: eine explizite
// models-Liste (flux-only-Felder), oder ein Vendor-Praefix minus Ausnahmen (Deepgram-weite
// Felder ausser flux). Reine Entscheidung, keine IO.
function settingApplies(scope, model) {
  if (scope.models) return scope.models.includes(model);
  if (scope.vendorPrefix) {
    const inVendor = model.startsWith(scope.vendorPrefix);
    const excepted = (scope.exceptModels || []).includes(model);
    return inVendor && !excepted;
  }
  return false;
}

// REINE Vergleichslogik (Eingabe: erwartetes Modell + das geholte transcription-Objekt,
// Ausgabe: Befundliste) - genau dieser Teil ist getestet, der HTTP-Aufruf nicht.
// fatal:true nur bei Modell-Drift; inerte Einstellungen sind ein Befund, kein Abbruch.
export function sttDriftFindings({ expectedModel, transcription }) {
  if (!transcription || typeof transcription !== "object") {
    return [
      {
        fatal: true,
        message:
          `Assistant-Objekt hat kein transcription-Feld -> Telnyx-Default (englisch-only). ` +
          `Erwartet: ${expectedModel}`,
      },
    ];
  }

  const actualModel = transcription.model;
  if (actualModel !== expectedModel) {
    return [
      {
        fatal: true,
        message: `transcription.model='${actualModel}' weicht vom konfigurierten Profil ab (erwartet '${expectedModel}')`,
      },
    ];
  }

  const findings = [];
  for (const key of Object.keys(transcription)) {
    const scope = SETTING_SCOPE[key];
    if (!scope) continue;
    if (settingApplies(scope, actualModel)) continue;
    findings.push({
      fatal: false,
      message: `'${key}' ist fuer Modell '${actualModel}' inert (gilt nur fuer: ${(scope.models || []).join(", ")})`,
    });
  }
  return findings;
}

async function main() {
  const { assistantId } = config.telnyx.telnyxAssistant;
  const { telnyxApiKey } = config.telephony;
  if (!assistantId || !telnyxApiKey) {
    console.error(
      "[telnyx-stt-drift] TELNYX_AI_ASSISTANT_ID oder TELNYX_API_KEY fehlt - Probe uebersprungen.",
    );
    process.exit(2);
  }

  const res = await fetch(`${config.telephony.telnyxApiBase}${AI_ASSISTANTS_PATH}/${assistantId}`, {
    headers: { Authorization: `Bearer ${telnyxApiKey}` },
  });
  await assertTelnyxOk(res, "getAssistant", { attachStatus: true });
  const body = await res.json();
  const data = body.data || body;

  const evidenceDir = path.join(config.server.dataDir, EVIDENCE_SUBDIR);
  await mkdir(evidenceDir, { recursive: true });
  const snapshotPath = path.join(evidenceDir, `assistant-${new Date().toISOString()}.json`);
  await writeFile(snapshotPath, JSON.stringify(data, null, 2));

  const findings = sttDriftFindings({
    expectedModel: sttAttrs(config.voice.sttProfile).model,
    transcription: data.transcription,
  });
  for (const f of findings) console.log(`[telnyx-stt-drift] ${f.fatal ? "FATAL" : "info"}: ${f.message}`);
  process.exit(findings.some((f) => f.fatal) ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
