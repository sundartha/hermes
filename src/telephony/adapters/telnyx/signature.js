import crypto from "node:crypto";
import { config } from "../../../config.js";

const REPLAY_WINDOW_S = 300;
const MS_PER_S = 1000;

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_RAW_KEY_LEN = 32;

const SIG_HEADER = "telnyx-signature-ed25519";
export const TS_HEADER = "telnyx-timestamp";

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

export function verifyInboundSignature({ headers, rawBody }) {
  const key = publicKeyOrNull();
  if (!key) return false;
  const sig = headers[SIG_HEADER];
  const ts = headers[TS_HEADER];
  if (!sig || !ts || !rawBody) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / MS_PER_S - tsNum) > REPLAY_WINDOW_S) return false;
  try {
    const signed = Buffer.concat([Buffer.from(`${ts}|`), rawBody]);
    return crypto.verify(null, signed, key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}
