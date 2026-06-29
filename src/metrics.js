// Strukturierte, PII-FREIE Mess-Instrumentierung (L0). EINE Stelle, die Latenz-/
// Loop-/STT-Gap-Signale als parsebare Log-Zeilen ausgibt. Traegt NIE params, Keys
// oder Transkript - nur Outcomes, Zaehler, Millisekunden, Tool-NAMEN. Hinter dem
// Master-Schalter config.metricsEnabled (Default aus = byte-identisch, auch stdout).
// DIP: enabled/log/now/maxTrackedCalls injizierbar -> Unit-Test ohne stdout-Scraping.
import { config } from "./config.js";

const LOG_PREFIX = "[metrics]";
// Obergrenze der prozessweiten Render-Zeit-Map (ein Eintrag je zuletzt aktivem Call).
// Verhindert unbegrenztes Wachstum bei Millionen-Calls; aeltester Eintrag faellt raus
// (LRU-by-recency ueber die Insertion-Order der Map). Reiner Speicher-Schutz, kein
// operativ getunter Wert -> Modul-Konstante statt config (kein neuer Tuning-Knopf).
const MAX_TRACKED_CALLS = 10000;

const defaultLog = (kind, payload) =>
  console.log(`${LOG_PREFIX} ${kind} ${JSON.stringify(payload)}`);

export function createMetrics({
  enabled = config.metricsEnabled,
  log = defaultLog,
  now = Date.now,
  maxTrackedCalls = MAX_TRACKED_CALLS,
} = {}) {
  // callId -> ms des letzten Folge-Gather-Renders. EPHEMER, nie persistiert.
  const lastRenderAt = new Map();

  // Metrik-Hook fuer den LLM-Seam (llm.js ruft .llmCall mit der fixierten Form).
  // Whitelist der vier Felder -> selbst wenn der Seam je mehr mitgaebe, leakt nichts.
  function llmCall({ outcome, attempts, latencyMs, breakerState }) {
    if (!enabled) return;
    log("llm", { outcome, attempts, latencyMs, breakerState });
  }

  // Roundtrips + vom Modell angeforderte Tool-NAMEN eines agentTurn (Budget-Engine).
  // callId/direction/Zaehler/Tool-Namen sind PII-frei (kein Transkript, keine Nummer).
  function logTurn({ callId, direction, roundtrips, tools }) {
    if (!enabled) return;
    log("turn", { callId, direction, roundtrips, tools });
  }

  // Render-Zeitpunkt des aktuellen Folge-Gathers merken (Nebeneffekt im Namen, N7).
  // Re-Set bewegt den Eintrag ans Map-Ende (recency); bei Ueberlauf faellt der
  // aelteste raus -> beschraenkter Speicher ohne Lifecycle-Kopplung.
  function recordTurnRendered(callId) {
    if (!enabled) return;
    if (lastRenderAt.has(callId)) lastRenderAt.delete(callId);
    else if (lastRenderAt.size >= maxTrackedCalls)
      lastRenderAt.delete(lastRenderAt.keys().next().value);
    lastRenderAt.set(callId, now());
  }

  // Luecke zwischen vorigem Folge-Gather-Render und JETZT (Ankunft des Folge-Turns)
  // ~ STT-Finalisierungs-Totzeit (A1-Hebel fuer L1). Erster Turn ohne Vorgaenger ->
  // kein Log (gapMs nicht ableitbar).
  function logTurnGap(callId) {
    if (!enabled) return;
    const prev = lastRenderAt.get(callId);
    if (prev === undefined) return;
    log("stt_gap", { callId, gapMs: now() - prev });
  }

  return { llmCall, logTurn, recordTurnRendered, logTurnGap };
}

// Prozessweiter Singleton (P15). Konsumenten: claude.js (llmCall via createLlmClient,
// logTurn) + server.js (recordTurnRendered/logTurnGap im /voice/turn).
export const metrics = createMetrics();
