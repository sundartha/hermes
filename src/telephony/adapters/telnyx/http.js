import { config } from "../../../config.js";

export function telnyxAuthHeaders(extra = {}) {
  if (!config.telephony.telnyxApiKey)
    throw new Error("Telnyx: TELNYX_API_KEY fehlt");
  return {
    Authorization: `Bearer ${config.telephony.telnyxApiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export const telnyxUrl = (path) => config.telephony.telnyxApiBase + path;

const LANGE_ID = /("(?:id|connection_id|phone_number_id)"\s*:\s*)(\d{16,})/g;

export async function telnyxJson(res) {
  const roh = await res.text();
  return roh ? JSON.parse(roh.replace(LANGE_ID, '$1"$2"')) : {};
}
