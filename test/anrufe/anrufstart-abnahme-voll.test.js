import assert from "node:assert/strict";
import { test } from "node:test";

import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const KUNDEN = 4;
const PLAETZE = 4;
const WAHL_PFAD = "/v2/calls";
const kundeVon = (index) => `t_voll_${index}`;
const absenderVon = (index) => `+1202555${String(3000 + index).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(6000 + nummer).padStart(4, "0")}`;

function seedKunden() {
  const indizes = Array.from({ length: KUNDEN }, (_, index) => index);
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
      id: `num_voll_${index}`,
      e164: absenderVon(index),
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_voll_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

async function rufeAn(srv, index, ziel) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: ziel, objective: "Tisch fuer zwei reservieren (Abnahme voll)" }),
  });
  return { status: res.status, body: await res.json() };
}

test("Anrufstart: bei voller Plattform antwortet der Anruf sofort mit 200 dialing und es wird nichts gewaehlt", async () => {
  const attrappe = await starteAttrappe();
  const kunden = Array.from({ length: KUNDEN }, (_, index) => kundeVon(index));
  const env = {
    ...vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "voll" }),
    ...vorspannMandantenUmgebung(kunden),
  };
  let srv = null;
  try {
    srv = await startServer({ env, seed: seedKunden() });
    for (let nummer = 0; nummer < PLAETZE; nummer += 1) {
      const antwort = await rufeAn(srv, nummer, zielVon(nummer));
      assert.equal(antwort.status, HTTP_OK, JSON.stringify([nummer, antwort.body]));
    }
    const wartend = await rufeAn(srv, KUNDEN - 1, zielVon(900));
    assert.equal(wartend.status, HTTP_OK);
    assert.equal(wartend.body.status, "dialing");
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= PLAETZE + 1);
    const gewaehlt = attrappe.pfade.filter((pfad) => pfad === WAHL_PFAD);
    assert.equal(gewaehlt.length, PLAETZE, "der wartende Anruf wird nicht gewaehlt");
    assert.equal(stand.calls.filter((call) => call.callControlId).length, PLAETZE);
  } finally {
    await srv?.stop();
    await attrappe.close();
  }
});
