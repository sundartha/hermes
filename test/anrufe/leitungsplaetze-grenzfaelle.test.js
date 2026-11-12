import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { leitungsplatzAblehnung } from "../../src/telephony/outbound-gates.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const AUFTRAG = "Tisch fuer zwei reservieren (Grenzfall)";
const ANRUFE_PRO_KUNDE = 2;
const TELNYX_AUSGEHEND_GRENZE = 90;
const KUNDEN = TELNYX_AUSGEHEND_GRENZE / ANRUFE_PRO_KUNDE;

const kundeVon = (index) => `t_lg_${index}`;
const zielVon = (nummer) => `+1202555${String(5000 + nummer).padStart(4, "0")}`;

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
      id: `num_lg_${index}`,
      e164: `+1202555${String(2000 + index).padStart(4, "0")}`,
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_lg_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

async function rufeAn(srv, index, ziel) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: ziel, objective: AUFTRAG }),
  });
  return { status: res.status };
}

test("Ende: ein vom Anbieter als canceled gemeldeter Telnyx-Anruf bleibt bis zum Ablauf belegt", async () => {
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true" }, seed: seedKunden(KUNDEN + 1) });
  try {
    for (let nummer = 1; nummer <= TELNYX_AUSGEHEND_GRENZE; nummer += 1) {
      const antwort = await rufeAn(srv, Math.floor((nummer - 1) / ANRUFE_PRO_KUNDE), zielVon(nummer));
      assert.equal(antwort.status, HTTP_OK);
    }
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= TELNYX_AUSGEHEND_GRENZE);
    const ende = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${stand.calls[0].id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallStatus: "canceled" }).toString(),
    });
    assert.equal(ende.status, HTTP_OK);
    await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
    assert.equal((await rufeAn(srv, KUNDEN, zielVon(900))).status, HTTP_UNAVAILABLE);
  } finally {
    await srv.stop();
  }
});

test("Ablehnung ausgelastet: der Audit-Eintrag nennt Ziel, Grund, Kunde und Anfrager", () => {
  const store = { tenantLanguage: () => "en" };
  const ctx = { tenantId: "t_x", requestedBy: "owner", to: "+12025550100" };
  const ablehnung = leitungsplatzAblehnung({ store, ctx });
  assert.equal(ablehnung.audit.grund, "ausgelastet");
  assert.equal(ablehnung.audit.detail, "to=+12025550100 grund=ausgelastet tenant=t_x requestedBy=owner");
});
