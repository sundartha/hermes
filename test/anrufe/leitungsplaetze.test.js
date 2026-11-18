import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer, waitForStoreState, withFetch, EL_OUTBOUND_BOOT_ENV } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { captureToolHandlers } from "../gemeinsam/werkzeug-registrierung.js";
import * as speicher from "../../src/store.js";
import { beinLegtAuf, initInhaltFuer, vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { makeTelnyxSigner, vorspannUmgebung } from "./el-bein-attrappe.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;
const KEINE_WARTESCHLANGE = "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";
const WAHL_PFAD = "/v2/calls";
const TTS_PFAD = "/v1/text-to-speech/";
const AUFTRAG = "Tisch fuer zwei reservieren (Leitungsplatz)";
const EL_WEG = Object.freeze({
  ...EL_OUTBOUND_BOOT_ENV,
  ELEVENLABS_AGENT_ID: "agent_lp",
  ELEVENLABS_API_KEY: "el-lp-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

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
  const indizes = Array.from({ length: anzahlKunden }, (_, index) => kundeVon(index));
  const srv = await startServer({
    env: { ...EL_WEG, ...vorspannMandantenUmgebung(indizes), ...(mitBudget ? TARIF_ENV : {}) },
    seed: seedKunden(anzahlKunden, { mitBudget, sprache }),
  });
  const anbieter = { starts: () => srv.vorspannAttrappe.pfade.filter((pfad) => pfad === WAHL_PFAD) };
  try {
    return await lauf({ srv, anbieter });
  } finally {
    await srv.stop();
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


test("S1: vier laufende ElevenLabs-Anrufe fuellen die Plaetze, der fuenfte Start erreicht ElevenLabs nie", async () => {
  await mitElWeg(4, async ({ srv, anbieter }) => {
    await startePlaetze(srv, [2, 1, 1]);
    const wartend = await rufeAn(srv, 3, zielVon(900));
    assert.equal(wartend.status, HTTP_OK);
    assert.equal(wartend.body.status, "dialing");
    assert.equal(wartend.body.deduplicated, false);
    assert.equal(anbieter.starts().length, 4, "ElevenLabs sieht 4 Starts, nicht 5");
  });
});

test("S9: der wartende Anruf haelt Platz und Budget-Reserve, ohne zu waehlen", async () => {
  await mitElWeg(
    4,
    async ({ srv, anbieter }) => {
      await startePlaetze(srv, [2, 1, 1]);
      const wartend = await rufeAn(srv, KNAPPER_KUNDE, zielVon(900));
      assert.equal(wartend.status, HTTP_OK);
      assert.equal(wartend.body.status, "dialing");
      const zweiter = await rufeAn(srv, KNAPPER_KUNDE, zielVon(901));
      assert.equal(zweiter.status, HTTP_PAYMENT_REQUIRED);
      assert.equal(zweiter.body.reason, "reserve_erschoepft", "die Reserve haelt der wartende Anruf");
      const stand = await waitForStoreState(srv, (s) => s.calls.length >= 5);
      assert.deepEqual(
        stand.calls
          .filter((call) => call.tenantId === kundeVon(KNAPPER_KUNDE))
          .map((call) => [call.status, Boolean(call.callControlId), call.failureReason, call.reserveCents, call.reserveReleased]),
        [["active", false, null, BUDGET_FUER_EINEN_ANRUF_CENTS, false]],
      );
      assert.equal(anbieter.starts().length, 4);
    },
    { mitBudget: true },
  );
});

const HTTP_TEXT = {
  de: "Fuer dieses Hermes-Konto laufen bereits so viele Anrufe gleichzeitig wie erlaubt. Bitte warten, bis ein laufender Anruf endet.",
  fr: "Ce compte Hermes a déjà atteint le nombre d'appels simultanés autorisé. Veuillez attendre la fin d'un appel en cours.",
};

for (const [sprache, erwartet] of Object.entries(HTTP_TEXT))
  test(`S6: die HTTP-Ablehnung kommt in der Sprache des Kunden (${sprache})`, async () => {
    await mitElWeg(
      4,
      async ({ srv, anbieter }) => {
        await startePlaetze(srv, [0, 0, 0, 2]);
        const abgelehnt = await rufeAn(srv, KNAPPER_KUNDE, zielVon(900));
        assert.equal(abgelehnt.status, HTTP_TOO_MANY_REQUESTS);
        assert.equal(abgelehnt.body.error, erwartet);
        assert.equal(anbieter.starts().length, 2);
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

async function ersterAnrufNach4(srv) {
  const zustand = await waitForStoreState(srv, (s) => s.calls.length >= 4);
  return zustand.calls[0].id;
}

test("S22: ein vom Anbieter gemeldetes Ende des Angerufenen-Beins gibt den Platz eines ElevenLabs-Anrufs frei", async () => {
  await mitElWeg(4, async ({ srv, anbieter }) => {
    await startePlaetze(srv, [2, 1, 1]);
    const callId = await ersterAnrufNach4(srv);
    await initInhaltFuer(srv, { callId, agentId: EL_WEG.ELEVENLABS_AGENT_ID });
    await beinLegtAuf(srv, callId);
    await waitForStoreState(srv, (s) => Boolean(s.calls.find((call) => call.id === callId).billedAt));
    const startsVorher = anbieter.starts().length;
    const neu = await rufeAn(srv, 3, zielVon(900));
    assert.equal(neu.status, HTTP_OK);
    await waitForStoreState(srv, (s) => Boolean(s.calls.find((call) => call.id === neu.body.callId).callControlId));
    assert.equal(anbieter.starts().length, startsVorher + 1, "der frei gewordene Platz wird genutzt");
  });
});

test("Ende: ein ElevenLabs-Anruf mit gestarteter Sitzung bleibt auch nach einem gemeldeten failed belegt", async () => {
  await mitElWeg(4, async ({ srv, anbieter }) => {
    await startePlaetze(srv, [2, 1, 1]);
    const callId = await ersterAnrufNach4(srv);
    await initInhaltFuer(srv, { callId, agentId: EL_WEG.ELEVENLABS_AGENT_ID });
    await beinLegtAuf(srv, callId, { vomElBein: true });
    await waitForStoreState(srv, (s) => Boolean(s.calls.find((call) => call.id === callId).billedAt));
    const startsVorher = anbieter.starts().length;
    const wartend = await rufeAn(srv, 3, zielVon(900));
    assert.equal(wartend.status, HTTP_OK);
    assert.equal(wartend.body.status, "dialing");
    assert.equal(anbieter.starts().length, startsVorher, "der Platz ist belegt: es wird nicht gewaehlt");
    const stand = srv.readStore();
    assert.equal(stand.calls.find((call) => call.id === wartend.body.callId).callControlId, null);
  });
});

test("Ende: scheitert der ElevenLabs-Start, bevor eine Sitzung entstand, ist der Platz sofort wieder frei", async () => {
  const abgelehnt = await starteAttrappe((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      const sprachsynthese = anfrage.url.startsWith(TTS_PFAD);
      antwort.writeHead(sprachsynthese ? HTTP_OK : HTTP_BAD_REQUEST, { "content-type": sprachsynthese ? "audio/mpeg" : "application/json" });
      antwort.end(sprachsynthese ? Buffer.alloc(1, 1) : JSON.stringify({ detail: "abgelehnt" }));
    });
  });
  const vorspann = vorspannUmgebung({ attrappe: abgelehnt, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: "lp" });
  const srv = await startServer({
    env: {
      ...vorspann,
      ...vorspannMandantenUmgebung(Array.from({ length: 6 }, (_, index) => kundeVon(index))),
      ELEVENLABS_RESULT_POLL_MS: "60000",
    },
    seed: seedKunden(6),
  });
  try {
    for (let index = 0; index < 6; index += 1) {
      const antwort = await rufeAn(srv, index, zielVon(index));
      assert.notEqual(antwort.status, HTTP_UNAVAILABLE, `Versuch ${index} darf nicht an belegten Plaetzen scheitern`);
    }
  } finally {
    await srv.stop();
    await abgelehnt.close();
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
