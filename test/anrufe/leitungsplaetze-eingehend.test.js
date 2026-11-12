import assert from "node:assert/strict";
import test from "node:test";

import { makeLeitungsplaetze } from "../../src/store.js";
import { normalizeIncomingTexml, seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const HTTP_UNAVAILABLE = 503;
const AUFTRAG = "Tisch fuer zwei reservieren (Eingehend)";
const TELNYX_WEG = Object.freeze({ FAKE_ORIGINATE: "true" });
const JE_KUNDE = 2;
const AUSGEHEND_GRENZE = 90;
const RESERVE = 10;
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

async function startePlaetze(srv, anzahl, ersterKunde = 0) {
  for (let nummer = 0; nummer < anzahl; nummer += 1) {
    const antwort = await rufeAn(srv, ersterKunde + Math.floor(nummer / JE_KUNDE), nummer + 1);
    assert.equal(antwort.status, HTTP_OK, `ausgehender Anruf ${nummer + 1} muss angenommen werden`);
  }
}

async function nimmEingehendeAn(srv, anzahl, kunde) {
  for (let nummer = 0; nummer < anzahl; nummer += 1)
    assert.equal((await nimmAn(srv, kunde)).status, HTTP_OK, `eingehender Anruf ${nummer + 1} muss angenommen werden`);
}

async function meldeEnde(srv, callId) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallStatus: "completed" }).toString(),
  });
  assert.equal(antwort.status, HTTP_OK);
}

async function mitServer(lauf) {
  const srv = await startServer({ env: TELNYX_WEG, seed: seedKunden(KUNDEN) });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

test("Eingehend 1: bei 90 laufenden ausgehenden Anrufen antwortet /voice/incoming wie bei freier Leitung und der Anruf ist sichtbar", async () => {
  await mitServer(async (srv) => {
    const frei = await nimmAn(srv, KUNDEN - 1);
    await startePlaetze(srv, AUSGEHEND_GRENZE);
    const voll = await nimmAn(srv, KUNDEN - 1);
    assert.equal(voll.status, HTTP_OK);
    assert.equal(voll.xml, frei.xml);
    const stand = await waitForStoreState(srv, (s) => s.calls.filter((call) => call.direction === "inbound").length >= 2);
    assert.equal(stand.calls.filter((call) => call.direction === "inbound").length, 2);
  });
});

test("Eingehend 2: bei 90 ausgehenden und 10 eingehenden Anrufen wird der naechste eingehende angenommen, der naechste ausgehende abgelehnt", async () => {
  await mitServer(async (srv) => {
    await startePlaetze(srv, AUSGEHEND_GRENZE);
    await nimmEingehendeAn(srv, RESERVE, KUNDEN - 1);
    const weiterer = await nimmAn(srv, KUNDEN - 1);
    assert.equal(weiterer.status, HTTP_OK);
    const stand = await waitForStoreState(srv, (s) => s.calls.filter((call) => call.direction === "inbound").length >= RESERVE + 1);
    assert.equal(stand.calls.filter((call) => call.direction === "inbound").length, RESERVE + 1);
    const abgelehnt = await rufeAn(srv, KUNDEN - 1, 900);
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.equal(abgelehnt.body.reason, "ausgelastet");
  });
});

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

test("Eingehend 4: 89 ausgehende und 11 eingehende Anrufe fuellen die 100 Kanaele, mit dem Ende eines eingehenden ist wieder ein ausgehender frei", async () => {
  await mitServer(async (srv) => {
    await startePlaetze(srv, AUSGEHEND_GRENZE - 1);
    await nimmEingehendeAn(srv, RESERVE + 1, KUNDEN - 1);
    const abgelehnt = await rufeAn(srv, KUNDEN - 1, 900);
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.equal(abgelehnt.body.reason, "ausgelastet");
    const stand = await waitForStoreState(srv, (s) => s.calls.filter((call) => call.direction === "inbound").length >= RESERVE + 1);
    const eingehend = stand.calls.find((call) => call.direction === "inbound");
    await meldeEnde(srv, eingehend.id);
    await waitForStoreState(srv, (s) => Boolean(s.calls.find((call) => call.id === eingehend.id).billedAt));
    assert.equal((await rufeAn(srv, KUNDEN - 1, 901)).status, HTTP_OK);
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
