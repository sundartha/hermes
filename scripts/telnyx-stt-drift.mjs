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
const FLUX_MODEL = "deepgram/flux";
const NOVA3_MODEL = "deepgram/nova-3";
const ASSEMBLYAI_STREAMING_MODEL = "assemblyai/universal-streaming";
const SONIOX_MODEL = "soniox/stt-rt-v4";

// Kopplung Modell <-> gueltige Einstellungen. QUELLE IST DIE OPENAPI-SPEZIFIKATION
// (team-telnyx/openapi, spec3.json, Schema `TranscriptionSettingsConfig`, abgerufen
// 2026-08-07), NICHT die Doku-Seite: nur die Spec sagt feldgenau "Available only for ...".
// BEWUSST hier und NICHT in src/: kein Produktionscode sendet je eines dieser Felder -
// eine Tabelle ohne Aufrufer waere Vorratshaltung (P15). Hier hat sie einen Aufrufer.
//
// NICHT in dieser Tabelle: `smart_format` und `numerals`. Die Spec nennt fuer sie KEINE
// Modell-Einschraenkung. Die Aussage "gilt fuer Deepgram ausser flux" stammt von der
// Doku-SEITE und ist dort eine Aussage ueber das PORTAL ("the Portal exposes these
// settings and enables both by default when you select the model"), also ueber die
// Bedienoberflaeche - nicht ueber die API. Sie hier als inert zu melden waere eine
// unbelegte Behauptung; lieber keine Meldung als eine falsche.
const SETTING_SCOPE = Object.freeze({
  eot_threshold: [FLUX_MODEL],
  eager_eot_threshold: [FLUX_MODEL],
  eot_timeout_ms: [FLUX_MODEL],
  keyterm: [FLUX_MODEL, NOVA3_MODEL],
  end_of_turn_confidence_threshold: [ASSEMBLYAI_STREAMING_MODEL],
  min_turn_silence: [ASSEMBLYAI_STREAMING_MODEL],
  max_turn_silence: [ASSEMBLYAI_STREAMING_MODEL],
  interim_results: [SONIOX_MODEL],
  enable_endpoint_detection: [SONIOX_MODEL],
  max_endpoint_delay_ms: [SONIOX_MODEL],
});

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

  // Die Einstellungen liegen EINE Ebene tiefer, unter transcription.settings - nicht flach
  // auf transcription (dort stehen nur model/language/api_key_ref/region/settings). Diese
  // Verschachtelung war schon einmal falsch angenommen; die Schleife fand dann NIE etwas
  // und die Probe schwieg bei Exit 0. Fixture-Beleg: das Feld-Layout im Test stammt aus
  // einem echten GET, nicht aus dieser Datei.
  const settings = transcription.settings;
  if (!settings || typeof settings !== "object") return [];

  const findings = [];
  for (const [key, value] of Object.entries(settings)) {
    // Ein nicht gesetztes Feld ist keine Fehlkonfiguration - Telnyx liefert alle Schluessel
    // mit null aus. Gemeldet wird nur, was jemand bewusst gesetzt hat.
    if (value === null || value === undefined) continue;
    const models = SETTING_SCOPE[key];
    if (!models || models.includes(actualModel)) continue;
    findings.push({
      fatal: false,
      message: `'${key}'=${JSON.stringify(value)} ist fuer Modell '${actualModel}' inert (gilt laut Spec nur fuer: ${models.join(", ")})`,
    });
  }
  return findings;
}

async function main() {
  const { assistantId } = config.telnyx.telnyxAssistant;
  const { telnyxApiKey } = config.telephony;
  if (!assistantId || !telnyxApiKey) {
    console.error(
      "[telnyx-stt-drift] TELNYX_ASSISTANT_ID oder TELNYX_API_KEY fehlt - Probe uebersprungen.",
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
  // IMMER eine Zeile ausgeben, auch bei null Befunden: eine stille Probe ist von einer
  // Probe, die gar nicht gelaufen ist, nicht zu unterscheiden - genau so blieb der
  // Verschachtelungsfehler oben unbemerkt (Exit 0 ohne jede Ausgabe).
  console.log(
    `[telnyx-stt-drift] geprueft: transcription.model='${data.transcription?.model}' ` +
      `gegen Profil '${config.voice.sttProfile}' -> ${findings.length} Befund(e)`,
  );
  for (const f of findings) console.log(`[telnyx-stt-drift] ${f.fatal ? "FATAL" : "info"}: ${f.message}`);
  process.exit(findings.some((f) => f.fatal) ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
