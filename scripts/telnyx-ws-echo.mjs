#!/usr/bin/env node
// WS-Echo-Harness fuer das OFFENE P7-Gate: verifiziert gegen die Telnyx-Live-
// Media-API das exakte Payload-Format (rohe u-law base64 vs. RTP-gewrappt) +
// clear/mark/stop/dtmf end-to-end. Ohne Telnyx-Live-Zugang im Worktree NICHT
// lauffaehig -> smokePass=false + Grund. KEIN Teil von npm test (kein Netz in
// der Suite). Code-Merge ist NICHT hieran blockiert; die PRODUKTIVE Telnyx-
// Realtime-Aktivierung IST blockiert, bis dieses Gate gruen ist.
import { config } from "../src/config.js";

// Zu pruefende Punkte, sobald Telnyx-Live-Zugang besteht (echter WS-Loop):
// - start-Frame: stream_id + <Parameter> (call_id/stream_token) wie ANGENOMMEN?
// - media-Frame: rohe u-law base64 (wie Twilio) ODER RTP-gewrappt?
// - buildMediaFrame/clearPlayback OHNE stream_id wird akzeptiert?
// - clear/mark/stop/dtmf end-to-end (Max-Dauer/Barge-in greifen)?
const CHECKLIST = Object.freeze([
  "start: stream_id + <Parameter> (call_id/stream_token)",
  "media: rohe u-law base64 vs. RTP-gewrappt",
  "outbound media/clear OHNE stream_id akzeptiert",
  "clear/mark/stop/dtmf end-to-end",
]);

// Voraussetzungen fuer den Live-Loop. Fehlt etwas -> smokePass=false (kein Zugang).
// KEINE Secrets loggen: nur ob gesetzt, nie den Wert.
const REQUIRED = Object.freeze([
  ["TELNYX_NUMBER", config.telnyxNumber],
  ["TELNYX_CONNECTION_ID", config.telnyxConnectionId],
  ["OPENAI_API_KEY", config.openaiApiKey],
  ["PUBLIC_URL", config.publicUrl],
]);

function report(smokePass, reason) {
  console.log(`smokePass=${smokePass}`);
  console.log(`Grund: ${reason}`);
  if (!smokePass) {
    console.log("Offene Pruefpunkte (mit Telnyx-Live-Zugang auszufuehren):");
    for (const item of CHECKLIST) console.log(`  - ${item}`);
  }
  process.exit(smokePass ? 0 : 1);
}

const missing = REQUIRED.filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  report(false, `kein Telnyx-Live-Zugang im Worktree (fehlt: ${missing.join(", ")})`);
}

// Voraussetzungen gesetzt, aber der echte WS-Loop ist hier (noch) nicht
// implementiert - das Gate bleibt bewusst manuell/live. Ohne echten Loop kein
// gruener Beleg -> smokePass=false (nie faelschlich gruen melden).
report(false, "WS-Echo-Loop nur mit Telnyx-Live-Zugang ausfuehrbar (manuelles Gate, nicht automatisiert)");
