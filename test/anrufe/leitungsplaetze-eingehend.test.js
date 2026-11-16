import assert from "node:assert/strict";
import test from "node:test";

import { makeLeitungsplaetze } from "../../src/store.js";
import { normalizeIncomingTexml, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const AUFTRAG = "Tisch fuer zwei reservieren (Eingehend)";
const TELNYX_WEG = Object.freeze({ FAKE_ORIGINATE: "true" });
const JE_KUNDE = 2;
const AUSGEHEND_GRENZE = 90;
const KUNDEN = AUSGEHEND_GRENZE / JE_KUNDE + 2;

const kundeVon = (index) => `t_le_${index}`;
const absenderVon = (index) => `+1202555${String(2000 + index).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(5000 + nummer).padStart(4, "0")}`;
const anruferVon = (nummer) => `+1202555${String(7000 + nummer).padStart(4, "0")}`;

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
      id: `num_le_${index}`,
      e164: absenderVon(index),
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_le_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

async function rufeAn(srv, index, nummer) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: zielVon(nummer), objective: AUFTRAG }),
  });
  return { status: res.status, body: await res.json() };
}

let eingehendZaehler = 0;
async function nimmAn(srv, index) {
  eingehendZaehler += 1;
  const res = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: `CAle${eingehendZaehler}`, From: anruferVon(eingehendZaehler), To: absenderVon(index) }),
  });
  return { status: res.status, xml: normalizeIncomingTexml(await res.text()) };
}

async function mitServer(lauf) {
  const srv = await startServer({ env: TELNYX_WEG, seed: seedKunden(KUNDEN) });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

test("Eingehend 3: eingehende Anrufe zaehlen nicht gegen die Hoechstzahl gleichzeitiger ausgehender Anrufe des Kunden", async () => {
  await mitServer(async (srv) => {
    await nimmAn(srv, 0);
    assert.equal((await rufeAn(srv, 0, 1)).status, HTTP_OK);
    assert.equal((await rufeAn(srv, 0, 2)).status, HTTP_OK);
    const dritter = await rufeAn(srv, 0, 3);
    assert.equal(dritter.status, HTTP_TOO_MANY);
    assert.equal(dritter.body.reason, "gleichzeitig_limit");
  });
});

const EL_PLAETZE = 6;
const TELNYX_KANAELE = 100;
const ANFRAGE_EL = Object.freeze({ tenantId: "t_le_tabelle", weg: "elevenlabs", hoechstzahlKunde: 2 });
const ANFRAGE_TELNYX = Object.freeze({ ...ANFRAGE_EL, weg: "telnyx" });
const belegeEingehend = async (plaetze, anzahl, weg) => {
  for (let nummer = 0; nummer < anzahl; nummer += 1)
    await plaetze.belegenEingehend({ callId: `call_${weg}_${nummer}`, tenantId: "t_fremd", weg, maxDauerS: 300 });
};

test("Eingehend 6: ein eingehender ElevenLabs-Anruf belegt einen ElevenLabs- und einen Telnyx-Platz, ein eingehender Telnyx-Anruf nur Telnyx", async () => {
  const elVoll = makeLeitungsplaetze();
  await belegeEingehend(elVoll, EL_PLAETZE, "elevenlabs");
  assert.equal(await elVoll.pruefenAusgehend(ANFRAGE_EL), "anbieter_voll");
  const nurTelnyx = makeLeitungsplaetze();
  await belegeEingehend(nurTelnyx, EL_PLAETZE, "telnyx");
  assert.equal(await nurTelnyx.pruefenAusgehend(ANFRAGE_EL), "frei");
  const telnyxVoll = makeLeitungsplaetze();
  await belegeEingehend(telnyxVoll, 1, "elevenlabs");
  await belegeEingehend(telnyxVoll, TELNYX_KANAELE - 1, "telnyx");
  assert.equal(await telnyxVoll.pruefenAusgehend(ANFRAGE_TELNYX), "anbieter_voll");
});

test("Eingehend 7: eingehende Anrufe zaehlen nicht gegen die Hoechstzahl des Kunden, bis der Anbieter voll ist", async () => {
  const plaetze = makeLeitungsplaetze();
  await plaetze.belegenEingehend({ callId: "call_ein", tenantId: ANFRAGE_TELNYX.tenantId, weg: "telnyx", maxDauerS: 300 });
  await plaetze.belegenEingehend({ callId: "call_ein_2", tenantId: ANFRAGE_TELNYX.tenantId, weg: "telnyx", maxDauerS: 300 });
  assert.equal(await plaetze.pruefenAusgehend({ ...ANFRAGE_TELNYX, hoechstzahlKunde: 1 }), "frei");
  await plaetze.belegenAusgehend({ ...ANFRAGE_TELNYX, callId: "call_aus", maxDauerS: 300 });
  assert.equal(await plaetze.pruefenAusgehend({ ...ANFRAGE_TELNYX, hoechstzahlKunde: 1 }), "kunde_voll");
  plaetze.freigeben("call_ein");
  plaetze.freigeben("call_ein_2");
  assert.equal(await plaetze.pruefenAusgehend({ ...ANFRAGE_TELNYX, hoechstzahlKunde: 2 }), "frei");
});
