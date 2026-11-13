import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";
import { TELNYX_SU_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const TELNYX_PLAETZE = 90;
const ANRUFE_PRO_KUNDE = 2;
const KUNDEN = TELNYX_PLAETZE / ANRUFE_PRO_KUNDE + 1;
const GEHALTEN = TELNYX_PLAETZE;

const kundeVon = (index) => `t_ab_${index}`;
const zielVon = (nummer) => `+1202555${String(7000 + nummer).padStart(4, "0")}`;

function seedKunden(anzahl) {
  const indizes = Array.from({ length: anzahl }, (_, index) => index);
  return seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_ab_${index}`,
      e164: `+1202555${String(4000 + index).padStart(4, "0")}`,
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_ab_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

function starteAnbieter() {
  let starts = 0;
  const gehalten = [];
  const attrappe = starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      starts += 1;
      const antworten = () => {
        res.writeHead(HTTP_OK, { "content-type": "application/json" });
        res.end(JSON.stringify({ sid: `tnx_ab_${starts}` }));
      };
      if (starts === GEHALTEN) gehalten.push(antworten);
      else antworten();
    });
  });
  return attrappe.then((a) => ({ ...a, gibStartFrei: () => gehalten.forEach((f) => f()) }));
}

const anfrage = (srv, index, nummer) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: zielVon(nummer), objective: "Tisch reservieren (Abbruch)" }),
  });

test("Abbruch waehrend des Telnyx-Anrufstarts ohne Kennung: der Platz bleibt belegt, der naechste Anruf wird mit ausgelastet abgelehnt", async () => {
  const anbieter = await starteAnbieter();
  const srv = await startServer({
    env: { TELNYX_API_KEY: TELNYX_SU_SCHLUESSEL, TELNYX_CONNECTION_ID: "conn_ab", TELNYX_ACCOUNT_SID: "acct_ab", TELNYX_API_BASE: anbieter.url },
    seed: seedKunden(KUNDEN),
  });
  let haengend = Promise.resolve();
  try {
    for (let nummer = 1; nummer < GEHALTEN; nummer += 1)
      assert.equal((await anfrage(srv, Math.floor((nummer - 1) / ANRUFE_PRO_KUNDE), nummer)).status, HTTP_OK, `Anruf ${nummer}`);
    haengend = anfrage(srv, Math.floor((GEHALTEN - 1) / ANRUFE_PRO_KUNDE), GEHALTEN);
    const stand = await waitForStoreState(srv, (s) => s.calls.length === GEHALTEN);
    const ohneKennung = stand.calls.filter((call) => !call.twilioSid);
    assert.equal(ohneKennung.length, 1);
    const gehaltener = ohneKennung[0];
    const abbruch = await abrufMitFrist(`${srv.localUrl}/api/calls/${gehaltener.id}/cancel`, {
      method: "POST",
      headers: { "X-Internal-Tenant": gehaltener.tenantId },
    });
    assert.equal(abbruch.status, HTTP_OK);
    assert.equal((await abbruch.json()).status, "cancelled");
    const weiterer = await anfrage(srv, KUNDEN - 1, GEHALTEN + 1);
    assert.equal(weiterer.status, HTTP_UNAVAILABLE);
    assert.equal((await weiterer.json()).reason, "ausgelastet");
  } finally {
    anbieter.gibStartFrei();
    await haengend.catch(() => {});
    await srv.stop();
    await anbieter.close();
  }
});
