import { assertTelnyxOk } from "./errors.js";
import { telnyxAuthHeaders as authHeaders, telnyxUrl as url, telnyxJson } from "./http.js";
import { anfrage } from "../../../utils/anfrage.js";

const NUMBERS_PATH = "/v2/phone_numbers";
const TELNYX_LESEFRIST_MS = 4000;

async function getJson(path, op) {
  const res = await anfrage(url(path), {
    headers: authHeaders(),
    fristMs: TELNYX_LESEFRIST_MS,
  });
  await assertTelnyxOk(res, op);
  return telnyxJson(res);
}

export const telnyxConfigRead = {
  async findPhoneNumber(e164) {
    const query = new URLSearchParams();
    query.set("filter[phone_number]", e164);
    const json = await getJson(`${NUMBERS_PATH}?${query}`, "findPhoneNumber");
    const treffer = (json.data || []).map((eintrag) => ({ e164: eintrag.phone_number, status: eintrag.status }));
    return { treffer };
  },
};
