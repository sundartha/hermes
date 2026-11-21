import crypto from "node:crypto";
import { z } from "zod";
import { config } from "../../../config.ts";
import { publicKeyOrNull } from "./schluessel.ts";
import { MS_PER_SECOND } from "../../../utils/timer.ts";

const SIGNATUR_KONFIG = z.object({ telephony: z.object({ telnyxPublicKey: z.string().catch("") }) });

const REPLAY_WINDOW_S = 300;

const SIG_HEADER = "telnyx-signature-ed25519";
export const TS_HEADER = "telnyx-timestamp";

export function verifyInboundSignature({ headers, rawBody }: { headers: Record<string, string | undefined>; rawBody: Buffer | undefined }): boolean {
  const key = publicKeyOrNull(SIGNATUR_KONFIG.parse(config).telephony.telnyxPublicKey);
  if (!key) return false;
  const sig = headers[SIG_HEADER];
  const ts = headers[TS_HEADER];
  if (!sig || !ts || !rawBody) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / MS_PER_SECOND - tsNum) > REPLAY_WINDOW_S) return false;
  try {
    const signed = Buffer.concat([Buffer.from(`${ts}|`), rawBody]);
    return crypto.verify(null, signed, key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}
