import crypto from "node:crypto";
import { z } from "zod";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_RAW_KEY_LEN = 32;

const ROH_SCHLUESSEL = z.string();

function ed25519Schluessel(raw: string | undefined): crypto.KeyObject | null {
  if (!raw) return null;
  try {
    if (raw.includes("BEGIN")) {
      const schluessel = crypto.createPublicKey(raw);
      return schluessel.asymmetricKeyType === "ed25519" ? schluessel : null;
    }
    const rawKey = Buffer.from(raw, "base64");
    if (rawKey.length !== ED25519_RAW_KEY_LEN) return null;
    const spki = Buffer.concat([SPKI_ED25519_PREFIX, rawKey]);
    return crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

export function publicKeyOrNull(roh: unknown): crypto.KeyObject | null {
  return ed25519Schluessel(ROH_SCHLUESSEL.safeParse(roh).data);
}

export function telnyxSchluesselGueltig(roh: unknown): boolean {
  return publicKeyOrNull(roh) !== null;
}
