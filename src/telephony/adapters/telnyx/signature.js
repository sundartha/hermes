// Telnyx-Adapter: Inbound-Signaturpruefung (Ed25519). Telnyx signiert Webhooks
// nach der Standard-Webhooks-Spezifikation: telnyx-signature-ed25519 ist die
// base64-Ed25519-Signatur ueber `${telnyx-timestamp}|${rawBody}`, telnyx-timestamp
// ist der Unix-Sekunden-Stempel (Replay-Schutz). FAIL-CLOSED: fehlende Config/
// Header/abgelaufen/manipuliert -> false (wirft nie) - seit C-P3 der EINZIGE
// Inbound-Verifizierer.
// Kein neues Paket: node:crypto kann Ed25519 ueber crypto.verify(null, ...).
import crypto from "node:crypto";
import { config } from "../../../config.js";

// Telnyx-Empfehlung ~5 min Toleranz (Standard-Webhooks-Default 300s). Benannte
// Konstante statt Magic Number (G25).
const REPLAY_WINDOW_S = 300;
const MS_PER_S = 1000;

// SPKI-DER-Prefix fuer einen rohen 32-Byte-Ed25519-Public-Key. Damit laesst sich
// der von Telnyx ausgelieferte base64-raw-32-Byte-Key zu einem KeyObject machen,
// ohne ihn als PEM vorliegen zu haben.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_RAW_KEY_LEN = 32;

const SIG_HEADER = "telnyx-signature-ed25519";
const TS_HEADER = "telnyx-timestamp";

// Liest den Telnyx-Public-Key aus config und macht ihn zu einem KeyObject. PEM
// (enthaelt "BEGIN") wird direkt geladen; sonst als base64-raw-32-Byte ueber den
// SPKI-Prefix rekonstruiert. Jeder Fehler -> null (fail-closed). Reine Funktion,
// pro Verify aus config gelesen (Webhook selten) - kein Lazy-Singleton (P15).
function publicKeyOrNull() {
  const raw = config.telephony.telnyxPublicKey;
  if (!raw) return null;
  try {
    if (raw.includes("BEGIN")) return crypto.createPublicKey(raw);
    const rawKey = Buffer.from(raw, "base64");
    if (rawKey.length !== ED25519_RAW_KEY_LEN) return null;
    const spki = Buffer.concat([SPKI_ED25519_PREFIX, rawKey]);
    return crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

/** @type {import("../../ports.js").InboundSignatureVerifier["verifyInboundSignature"]} */
export function verifyInboundSignature({ headers, rawBody }) {
  const key = publicKeyOrNull();
  if (!key) return false;
  const sig = headers[SIG_HEADER];
  const ts = headers[TS_HEADER];
  if (!sig || !ts || !rawBody) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  // Abgelaufen/Replay -> false (Toleranzfenster in beide Richtungen).
  if (Math.abs(Date.now() / MS_PER_S - tsNum) > REPLAY_WINDOW_S) return false;
  try {
    // Als Buffer concaten (rawBody ist ein Buffer, P2) - vermeidet Encoding-Risiken
    // gegenueber String-Konkatenation.
    const signed = Buffer.concat([Buffer.from(`${ts}|`), rawBody]);
    return crypto.verify(null, signed, key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}
