import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer, waitForStoreState, withFetch } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { captureToolHandlers } from "../gemeinsam/werkzeug-registrierung.js";
import * as speicher from "../../src/store.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const AUFTRAG = "Tisch fuer zwei reservieren (Leitungsplatz)";
const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_lp",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_lp",
  ELEVENLABS_API_KEY: "el-lp-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});
const TELNYX_WEG = Object.freeze({ FAKE_ORIGINATE: "true" });

const kundeVon = (index) => `t_lp_${index}`;
const absenderVon = (index) => `+1202555${String(2000 + index).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(5000 + nummer).padStart(4, "0")}`;

const BUDGET_CENTS = 100000;
const BUDGET_FUER_EINEN_ANRUF_CENTS = 60;
const KNAPPER_KUNDE = 3;
const TARIF_ENV = Object.freeze({ VOICE_TARIFF_DEFAULT_CENTS: "30", VOICE_TARIFF_DOMESTIC_CENTS: "30" });

function seedKunden(anzahl, { mitBudget = false, sprache = "en" } = {}) {
  const indizes = Array.from({ length: anzahl }, (_, index) => index);
  const stand = seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: index === KNAPPER_KUNDE ? sprache : "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_lp_${index}`,
      e164: absenderVon(index),
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_lp_${index}`,
      language: index === KNAPPER_KUNDE ? sprache : "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
  if (!mitBudget) return stand;
  return {
    ...stand,
    usage: { ...stand.usage, ...Object.fromEntries(indizes.map((index) => [kundeVon(index), { costCents: 0 }])) },
    tenantBudgets: indizes.map((index) => ({
      tenantId: kundeVon(index),
      budgetCents: index === KNAPPER_KUNDE ? BUDGET_FUER_EINEN_ANRUF_CENTS : BUDGET_CENTS,
      hardCapCents: index === KNAPPER_KUNDE ? BUDGET_FUER_EINEN_ANRUF_CENTS : BUDGET_CENTS,
    })),
  };
}

async function rufeAn(srv, index, ziel) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: ziel, objective: AUFTRAG }),
  });
  return { status: res.status, body: await res.json() };
}

async function mitElWeg(anzahlKunden, lauf, { mitBudget = false, sprache = "en" } = {}) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ...(mitBudget ? TARIF_ENV : {}), ELEVENLABS_API_BASE: anbieter.url },
    seed: seedKunden(anzahlKunden, { mitBudget, sprache }),
  });
  try {
    return await lauf({ srv, anbieter });
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

async function startePlaetze(srv, belegung) {
  let nummer = 0;
  for (const [index, anzahl] of belegung.entries())
    for (let k = 0; k < anzahl; k++) {
      const antwort = await rufeAn(srv, index, zielVon((nummer += 1)));
      assert.equal(antwort.status, HTTP_OK, `Anruf ${nummer} von Kunde ${index} muss angenommen werden`);
    }
  return nummer;
}

const ANRUFE_PRO_KUNDE = 2;
const TELNYX_AUSGEHEND_GRENZE = 90;
const kundenFuerTelnyxGrenze = TELNYX_AUSGEHEND_GRENZE / ANRUFE_PRO_KUNDE;

test("S3: 90 laufende ausgehende Telnyx-Anrufe fuellen die Leitung, der 91. Kunde bekommt 503 ausgelastet in seiner Sprache", async () => {
  const srv = await startServer({ env: TELNYX_WEG, seed: seedKunden(kundenFuerTelnyxGrenze + 1) });
  try {
    await startePlaetze(srv, Array(kundenFuerTelnyxGrenze).fill(ANRUFE_PRO_KUNDE));
    const abgelehnt = await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(900));
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.equal(abgelehnt.body.reason, "ausgelastet");
    assert.equal(abgelehnt.body.error, "Hermes is at capacity right now. Please try again in a few minutes.");
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= TELNYX_AUSGEHEND_GRENZE);
    assert.equal(stand.calls.length, TELNYX_AUSGEHEND_GRENZE, "genau 90 Starts, der 91. wurde nie gewaehlt");
    assert.equal(stand.calls.filter((call) => call.twilioSid?.startsWith("fake_")).length, TELNYX_AUSGEHEND_GRENZE);
  } finally {
    await srv.stop();
  }
});

test("S1: vier laufende ElevenLabs-Anrufe fuellen die Plaetze, der fuenfte Start erreicht ElevenLabs nie", async () => {
  await mitElWeg(4, async ({ srv, anbieter }) => {
    await startePlaetze(srv, [2, 1, 1]);
    const abgelehnt = await rufeAn(srv, 3, zielVon(900));
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.equal(abgelehnt.body.reason, "ausgelastet");
    assert.equal(anbieter.starts().length, 4, "ElevenLabs sieht 4 Starts, nicht 5");
  });
});

test("S9: die Ablehnung hinterlaesst keinen Anrufdatensatz und gibt die Budget-Reserve zurueck", async () => {
  await mitElWeg(
    4,
    async ({ srv }) => {
      await startePlaetze(srv, [2, 1, 1]);
      for (const versuch of [900, 901]) {
        const abgelehnt = await rufeAn(srv, KNAPPER_KUNDE, zielVon(versuch));
        assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
        assert.equal(abgelehnt.body.reason, "ausgelastet", "die Reserve ist zurueck: kein Budget-Grund beim zweiten Versuch");
      }
      const stand = await waitForStoreState(srv, (s) => s.calls.length >= 4);
      assert.equal(stand.calls.length, 4);
      assert.equal(
        stand.calls.some((call) => call.tenantId === kundeVon(KNAPPER_KUNDE)),
        false,
      );
    },
    { mitBudget: true },
  );
});

const HTTP_TEXT = {
  de: "Hermes ist gerade ausgelastet. Bitte in wenigen Minuten erneut versuchen.",
  fr: "Hermes est actuellement à pleine capacité. Veuillez réessayer dans quelques minutes.",
};

for (const [sprache, erwartet] of Object.entries(HTTP_TEXT))
  test(`S6: die HTTP-Ablehnung ausgelastet kommt in der Sprache des Kunden (${sprache})`, async () => {
    await mitElWeg(
      4,
      async ({ srv }) => {
        await startePlaetze(srv, [2, 1, 1]);
        const abgelehnt = await rufeAn(srv, KNAPPER_KUNDE, zielVon(900));
        assert.equal(abgelehnt.body.error, erwartet);
      },
      { sprache },
    );
  });

test("B4: ein erneuter Start desselben Ziels bei voller Plattform meldet weiter den laufenden Anruf", async () => {
  await mitElWeg(4, async ({ srv, anbieter }) => {
    await startePlaetze(srv, [2, 1, 1]);
    const wieder = await rufeAn(srv, 1, zielVon(3));
    assert.equal(wieder.status, HTTP_OK);
    assert.equal(wieder.body.deduplicated, true);
    assert.equal(anbieter.starts().length, 4);
  });
});

test("S10: ein beendeter Telnyx-Anruf gibt seinen Platz sofort frei", async () => {
  const srv = await startServer({ env: TELNYX_WEG, seed: seedKunden(kundenFuerTelnyxGrenze + 1) });
  try {
    await startePlaetze(srv, Array(kundenFuerTelnyxGrenze).fill(ANRUFE_PRO_KUNDE));
    assert.equal((await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(900))).status, HTTP_UNAVAILABLE);
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= TELNYX_AUSGEHEND_GRENZE);
    const ende = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${stand.calls[0].id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallStatus: "completed" }).toString(),
    });
    assert.equal(ende.status, HTTP_OK);
    await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
    assert.equal((await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(901))).status, HTTP_OK);
    assert.equal((await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(902))).status, HTTP_UNAVAILABLE);
  } finally {
    await srv.stop();
  }
});

test("S22: ein gemeldetes Ende eines ElevenLabs-Anrufs gibt den Platz nicht frei, er endet erst mit dem Ablauf", async () => {
  await mitElWeg(4, async ({ srv }) => {
    await startePlaetze(srv, [2, 1, 1]);
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= 4);
    await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${stand.calls[0].id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallStatus: "completed" }).toString(),
    });
    await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
    assert.equal((await rufeAn(srv, 3, zielVon(900))).status, HTTP_UNAVAILABLE);
  });
});

async function meldeAnbieterStatus(srv, callId, status) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallStatus: status }).toString(),
  });
  assert.equal(antwort.status, HTTP_OK);
}

for (const status of ["failed", "no-answer", "busy"])
  test(`Ende: ein vom Anbieter als ${status} gemeldeter Telnyx-Anruf gibt seinen Platz sofort frei`, async () => {
    const srv = await startServer({ env: TELNYX_WEG, seed: seedKunden(kundenFuerTelnyxGrenze + 1) });
    try {
      await startePlaetze(srv, Array(kundenFuerTelnyxGrenze).fill(ANRUFE_PRO_KUNDE));
      assert.equal((await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(900))).status, HTTP_UNAVAILABLE);
      const stand = await waitForStoreState(srv, (s) => s.calls.length >= TELNYX_AUSGEHEND_GRENZE);
      await meldeAnbieterStatus(srv, stand.calls[0].id, status);
      await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
      assert.equal((await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(901))).status, HTTP_OK);
      assert.equal((await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(902))).status, HTTP_UNAVAILABLE);
    } finally {
      await srv.stop();
    }
  });

test("Ende: ein mit cancel_call beendeter Telnyx-Anruf mit Anbieterkennung bleibt bis zum Ablauf belegt", async () => {
  const srv = await startServer({ env: TELNYX_WEG, seed: seedKunden(kundenFuerTelnyxGrenze + 1) });
  try {
    await startePlaetze(srv, Array(kundenFuerTelnyxGrenze).fill(ANRUFE_PRO_KUNDE));
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= TELNYX_AUSGEHEND_GRENZE);
    const erster = stand.calls[0];
    const abbruch = await abrufMitFrist(`${srv.localUrl}/api/calls/${erster.id}/cancel`, {
      method: "POST",
      headers: { "X-Internal-Tenant": erster.tenantId },
    });
    assert.equal(abbruch.status, HTTP_OK);
    await waitForStoreState(srv, (s) => s.calls[0].status === "cancelled" && Boolean(s.calls[0].billedAt));
    assert.equal((await rufeAn(srv, kundenFuerTelnyxGrenze, zielVon(900))).status, HTTP_UNAVAILABLE);
  } finally {
    await srv.stop();
  }
});

test("Ende: ein ElevenLabs-Anruf mit gestarteter Sitzung bleibt auch nach einem gemeldeten failed belegt", async () => {
  await mitElWeg(4, async ({ srv }) => {
    await startePlaetze(srv, [2, 1, 1]);
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= 4);
    await meldeAnbieterStatus(srv, stand.calls[0].id, "failed");
    await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
    assert.equal((await rufeAn(srv, 3, zielVon(900))).status, HTTP_UNAVAILABLE);
  });
});

test("Ende: scheitert der ElevenLabs-Start, bevor eine Sitzung entstand, ist der Platz sofort wieder frei", async () => {
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: "http://127.0.0.1:1" },
    seed: seedKunden(6),
  });
  try {
    for (let index = 0; index < 6; index += 1) {
      const antwort = await rufeAn(srv, index, zielVon(index));
      assert.notEqual(antwort.status, HTTP_UNAVAILABLE, `Versuch ${index} darf nicht an belegten Plaetzen scheitern`);
    }
  } finally {
    await srv.stop();
  }
});

const SEKUNDE_MS = 1000;
const TELNYX_KANAELE = 100;
const TELNYX_RESERVE = 10;
const EL_PLAETZE = 6;
const EL_RESERVE = 2;
const PUFFER_S = 120;
const EL_ABLAUF_S = 600;
const START_MS = 1_000_000;

function plaetzeMitUhr() {
  const uhr = { jetztMs: START_MS };
  const plaetze = speicher.makeLeitungsplaetze({ jetztMs: () => uhr.jetztMs });
  return { plaetze, uhr };
}

const belege = (plaetze, nummern, { weg, maxDauerS = 300 }) =>
  Promise.all(
    nummern.map((nummer) => plaetze.belegenAusgehend({ callId: `call_${weg}_${nummer}`, tenantId: "t", weg, maxDauerS })),
  );

const spanne = (anzahl) => Array.from({ length: anzahl }, (_, index) => index);

test("Entscheidung: Telnyx-Ausgang bleibt um die Reserve unter den Kanaelen, beide Seiten der Grenze", async () => {
  const { plaetze } = plaetzeMitUhr();
  const grenze = TELNYX_KANAELE - TELNYX_RESERVE;
  const bis = await belege(plaetze, spanne(grenze), { weg: "telnyx" });
  assert.deepEqual(new Set(bis.map((r) => r.entscheidung)), new Set(["frei"]));
  const darueber = await plaetze.belegenAusgehend({ callId: "call_zu_viel", tenantId: "t", weg: "telnyx", maxDauerS: 300 });
  assert.equal(darueber.entscheidung, "anbieter_voll");
});

test("Entscheidung: ElevenLabs-Ausgang bleibt um die Reserve unter den Plaetzen und braucht zusaetzlich einen Telnyx-Kanal", async () => {
  const { plaetze } = plaetzeMitUhr();
  const grenze = EL_PLAETZE - EL_RESERVE;
  const bis = await belege(plaetze, spanne(grenze), { weg: "elevenlabs" });
  assert.deepEqual(new Set(bis.map((r) => r.entscheidung)), new Set(["frei"]));
  assert.equal((await belege(plaetze, [99], { weg: "elevenlabs" }))[0].entscheidung, "anbieter_voll");

  const { plaetze: telnyxVoll } = plaetzeMitUhr();
  await belege(telnyxVoll, spanne(TELNYX_KANAELE - TELNYX_RESERVE), { weg: "telnyx" });
  assert.equal((await belege(telnyxVoll, [1], { weg: "elevenlabs" }))[0].entscheidung, "anbieter_voll");
});

test("Entscheidung: ein abgelehnter Versuch belegt nichts, Freigeben macht den Platz wieder frei und ist idempotent", async () => {
  const { plaetze } = plaetzeMitUhr();
  await belege(plaetze, spanne(EL_PLAETZE - EL_RESERVE), { weg: "elevenlabs" });
  await belege(plaetze, [99], { weg: "elevenlabs" });
  plaetze.freigeben("call_elevenlabs_0");
  plaetze.freigeben("call_elevenlabs_0");
  assert.equal((await belege(plaetze, [50], { weg: "elevenlabs" }))[0].entscheidung, "frei");
  assert.equal((await belege(plaetze, [51], { weg: "elevenlabs" }))[0].entscheidung, "anbieter_voll");
});

test("Entscheidung: Telnyx-Platz laeuft nach Hoechstdauer plus Puffer ab, nicht vorher", async () => {
  const { plaetze, uhr } = plaetzeMitUhr();
  const maxDauerS = 300;
  await belege(plaetze, spanne(TELNYX_KANAELE - TELNYX_RESERVE), { weg: "telnyx", maxDauerS });
  uhr.jetztMs = START_MS + (maxDauerS + PUFFER_S) * SEKUNDE_MS - 1;
  assert.equal((await belege(plaetze, [1000], { weg: "telnyx" }))[0].entscheidung, "anbieter_voll");
  uhr.jetztMs = START_MS + (maxDauerS + PUFFER_S) * SEKUNDE_MS;
  assert.equal((await belege(plaetze, [1001], { weg: "telnyx" }))[0].entscheidung, "frei");
});

test("Entscheidung: ElevenLabs-Platz laeuft immer nach 600 s plus Puffer ab, auch bei kurzer Hoechstdauer", async () => {
  const { plaetze, uhr } = plaetzeMitUhr();
  await belege(plaetze, spanne(EL_PLAETZE - EL_RESERVE), { weg: "elevenlabs", maxDauerS: 60 });
  uhr.jetztMs = START_MS + (EL_ABLAUF_S + PUFFER_S) * SEKUNDE_MS - 1;
  assert.equal((await belege(plaetze, [1000], { weg: "elevenlabs" }))[0].entscheidung, "anbieter_voll");
  uhr.jetztMs = START_MS + (EL_ABLAUF_S + PUFFER_S) * SEKUNDE_MS;
  assert.equal((await belege(plaetze, [1001], { weg: "elevenlabs" }))[0].entscheidung, "frei");
});

const GATEWAY_ABLEHNUNG = {
  de: "Hermes ist gerade ausgelastet. Es wurde kein Anruf gestartet. Bitte in wenigen Minuten erneut versuchen.",
  en: "Hermes is at capacity right now. No call was placed. Please try again in a few minutes.",
  fr: "Hermes est actuellement à pleine capacité. Aucun appel n'a été passé. Veuillez réessayer dans quelques minutes.",
};

for (const [sprache, erwartet] of Object.entries(GATEWAY_ABLEHNUNG))
  test(`S6: place_call meldet ausgelastet auf ${sprache} mit dem Text des Kunden`, async () => {
    const aufruf = captureToolHandlers({ scopedTenant: "t_lp", language: sprache, consultAllowed: true }).get("place_call");
    const stub = async () => new Response(JSON.stringify({ reason: "ausgelastet" }), { status: HTTP_UNAVAILABLE });
    const ergebnis = await withFetch(stub, () => aufruf({ to: zielVon(1), objective: AUFTRAG }));
    assert.equal(ergebnis.isError, true);
    assert.equal(ergebnis.content.map((teil) => teil.text).join("\n"), erwartet);
  });
