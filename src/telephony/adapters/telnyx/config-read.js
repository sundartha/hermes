import { assertTelnyxOk } from "./errors.js";
import { telnyxAuthHeaders as authHeaders, telnyxUrl as url, telnyxJson } from "./http.js";

const NUMBERS_PATH = "/v2/phone_numbers";

async function getJson(path, op) {
  const res = await fetch(url(path), { headers: authHeaders() });
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
