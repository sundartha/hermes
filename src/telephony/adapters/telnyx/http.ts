import { z } from "zod";
import { config } from "../../../config.ts";

const TELNYX_KONFIG = z.object({
  telephony: z.object({
    telnyxApiKey: z.string().catch(""),
    telnyxApiBase: z.string(),
  }),
});

const telnyxKonfig = (): z.infer<typeof TELNYX_KONFIG>["telephony"] => TELNYX_KONFIG.parse(config).telephony;

export function telnyxAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  if (!telnyxKonfig().telnyxApiKey)
    throw new Error("Telnyx: TELNYX_API_KEY fehlt");
  return {
    Authorization: `Bearer ${telnyxKonfig().telnyxApiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export const telnyxUrl = (path: string): string => telnyxKonfig().telnyxApiBase + path;

const LANGE_ID = /("(?:id|connection_id|phone_number_id)"\s*:\s*)(\d{16,})/g;

export async function telnyxJson(res: { text: () => Promise<string> }): Promise<unknown> {
  const roh = await res.text();
  return roh ? JSON.parse(roh.replace(LANGE_ID, '$1"$2"')) : {};
}
