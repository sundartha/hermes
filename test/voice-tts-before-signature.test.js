import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// INV-4 (Pre-Mortem 5): GET /voice/tts/:token MUSS im Voice-Router VOR router.use("/voice", sig)
// registriert sein - sonst wird PII-Audio signaturpflichtig (Telnyx signiert kein GET -> 403 ->
// tote Audio). Spawn-Tests laufen mit SKIP_TWILIO_SIGNATURE_CHECK=true -> struktureller Freeze.
const VOICE_JS = fileURLToPath(new URL("../src/routes/voice.js", import.meta.url));
test("voice.js: GET /voice/tts/:token wird VOR der /voice-Signatur-MW registriert (INV-4)", () => {
  const src = readFileSync(VOICE_JS, "utf8");
  const ttsIdx = src.indexOf('router.get("/voice/tts/:token"');
  const sigIdx = src.indexOf('router.use("/voice"');
  assert.notEqual(ttsIdx, -1, "TTS-Route nicht gefunden - Struktur-Drift");
  assert.notEqual(sigIdx, -1, "/voice-Signatur-MW nicht gefunden - Struktur-Drift");
  assert.ok(ttsIdx < sigIdx, "GET /voice/tts MUSS vor router.use('/voice', sig) stehen (INV-4)");
});
