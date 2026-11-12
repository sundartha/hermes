import assert from "node:assert/strict";
import test from "node:test";

import { anthropicAttrappe, seedState, startServer, waitForStoreState, withFetch } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { captureToolHandlers } from "../gemeinsam/werkzeug-registrierung.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const HTTP_UNAVAILABLE = 503;
const AUFTRAG = "Tisch fuer zwei reservieren (Kunde)";
const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_lk",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_lk",
  ELEVENLABS_API_KEY: "el-lk-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});
const TELNYX_WEG = Object.freeze({ FAKE_ORIGINATE: "true" });
const TARIF_ENV = Object.freeze({ VOICE_TARIFF_DEFAULT_CENTS: "30", VOICE_TARIFF_DOMESTIC_CENTS: "30" });
const BUDGET_FUER_DREI_ANRUFE_CENTS = 180;

const kundeVon = (index) => `t_lk_${index}`;
const absenderVon = (index) => `+1202555${String(2000 + index).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(5000 + nummer).padStart(4, "0")}`;

function seedKunden(anzahl, { sprache = "en", mitBudget = false } = {}) {
  const indizes = Array.from({ length: anzahl }, (_, index) => index);
  const stand = seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: sprache,
    })),
    numbers: indizes.map((index) => ({
      id: `num_lk_${index}`,
      e164: absenderVon(index),
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_lk_${index}`,
      language: sprache,
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
  if (!mitBudget) return stand;
  return {
    ...stand,
    usage: { ...stand.usage, ...Object.fromEntries(indizes.map((index) => [kundeVon(index), { costCents: 0 }])) },
    tenantBudgets: indizes.map((index) => ({
      tenantId: kundeVon(index),
      budgetCents: BUDGET_FUER_DREI_ANRUFE_CENTS,
      hardCapCents: BUDGET_FUER_DREI_ANRUFE_CENTS,
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

async function mitTelnyxWeg(lauf, optionen = {}) {
  const srv = await startServer({
    env: { ...TELNYX_WEG, ...(optionen.mitBudget ? TARIF_ENV : {}) },
    seed: seedKunden(2, optionen),
  });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

async function mitElWeg(anzahlKunden, lauf) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url },
    seed: seedKunden(anzahlKunden),
  });
  try {
    return await lauf({ srv, anbieter });
  } finally {
    await srv.stop();
    await anbieter.schliessen();
  }
}

async function startePlaetze(srv, index, anzahl) {
  for (let nummer = 1; nummer <= anzahl; nummer += 1)
    assert.equal((await rufeAn(srv, index, zielVon(nummer))).status, HTTP_OK);
}

test("S7: ein Kunde mit zwei laufenden ausgehenden Anrufen bekommt beim dritten 429 gleichzeitig_limit, ein anderer Kunde nicht", async () => {
  await mitTelnyxWeg(async (srv) => {
    await startePlaetze(srv, 0, 2);
    const abgelehnt = await rufeAn(srv, 0, zielVon(3));
    assert.equal(abgelehnt.status, HTTP_TOO_MANY);
    assert.equal(abgelehnt.body.reason, "gleichzeitig_limit");
    assert.equal(
      abgelehnt.body.error,
      "This Hermes account already has as many calls running at once as allowed. Please wait until a running call ends.",
    );
    assert.equal((await rufeAn(srv, 1, zielVon(4))).status, HTTP_OK);
  });
});

test("S7: ein erneuter Start desselben Ziels beim vollen Kunden meldet weiter den laufenden Anruf", async () => {
  await mitTelnyxWeg(async (srv) => {
    await startePlaetze(srv, 0, 2);
    const wieder = await rufeAn(srv, 0, zielVon(2));
    assert.equal(wieder.status, HTTP_OK);
    assert.equal(wieder.body.deduplicated, true);
  });
});

const HTTP_TEXT = {
  de: "Fuer dieses Hermes-Konto laufen bereits so viele Anrufe gleichzeitig wie erlaubt. Bitte warten, bis ein laufender Anruf endet.",
  fr: "Ce compte Hermes a déjà atteint le nombre d'appels simultanés autorisé. Veuillez attendre la fin d'un appel en cours.",
};

for (const [sprache, erwartet] of Object.entries(HTTP_TEXT))
  test(`S8: die HTTP-Ablehnung gleichzeitig_limit kommt in der Sprache des Kunden (${sprache})`, async () => {
    const srv = await startServer({ env: TELNYX_WEG, seed: seedKunden(1, { sprache }) });
    try {
      await startePlaetze(srv, 0, 2);
      const abgelehnt = await rufeAn(srv, 0, zielVon(3));
      assert.equal(abgelehnt.status, HTTP_TOO_MANY);
      assert.equal(abgelehnt.body.error, erwartet);
    } finally {
      await srv.stop();
    }
  });

const GATEWAY_ABLEHNUNG = {
  de: "Fuer dieses Hermes-Konto laufen bereits so viele Anrufe gleichzeitig wie erlaubt. Es wurde kein Anruf gestartet. Bitte warten, bis ein laufender Anruf endet.",
  en: "This Hermes account already has as many calls running at once as allowed. No call was placed. Please wait until a running call ends.",
  fr: "Ce compte Hermes a déjà atteint le nombre d'appels simultanés autorisé. Aucun appel n'a été passé. Veuillez attendre la fin d'un appel en cours.",
};

for (const [sprache, erwartet] of Object.entries(GATEWAY_ABLEHNUNG))
  test(`S8: place_call meldet gleichzeitig_limit auf ${sprache} mit dem Text des Kunden`, async () => {
    const aufruf = captureToolHandlers({ scopedTenant: "t_lk", language: sprache, consultAllowed: true }).get("place_call");
    const stub = async () => new Response(JSON.stringify({ reason: "gleichzeitig_limit" }), { status: HTTP_TOO_MANY });
    const ergebnis = await withFetch(stub, () => aufruf({ to: zielVon(1), objective: AUFTRAG }));
    assert.equal(ergebnis.isError, true);
    assert.equal(ergebnis.content.map((teil) => teil.text).join("\n"), erwartet);
  });

test("S9: die Ablehnung gleichzeitig_limit hinterlaesst keinen Anrufdatensatz und gibt die Budget-Reserve zurueck", async () => {
  await mitTelnyxWeg(
    async (srv) => {
      await startePlaetze(srv, 0, 2);
      for (const versuch of [3, 4]) {
        const abgelehnt = await rufeAn(srv, 0, zielVon(versuch));
        assert.equal(abgelehnt.status, HTTP_TOO_MANY);
        assert.equal(abgelehnt.body.reason, "gleichzeitig_limit", "die Reserve ist zurueck: kein Budget-Grund beim zweiten Versuch");
      }
      const stand = await waitForStoreState(srv, (s) => s.calls.length >= 2);
      assert.equal(stand.calls.length, 2);
    },
    { mitBudget: true },
  );
});

test("S10: nach einem gemeldeten Ende gibt der Kunde einen Platz frei, danach nimmt genau ein weiterer Start Platz", async () => {
  await mitTelnyxWeg(async (srv) => {
    await startePlaetze(srv, 0, 2);
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= 2);
    const ende = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${stand.calls[0].id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallStatus: "completed" }).toString(),
    });
    assert.equal(ende.status, HTTP_OK);
    await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
    assert.equal((await rufeAn(srv, 0, zielVon(3))).status, HTTP_OK);
    const zweiter = await rufeAn(srv, 0, zielVon(4));
    assert.equal(zweiter.status, HTTP_TOO_MANY);
    assert.equal(zweiter.body.reason, "gleichzeitig_limit");
  });
});

test("Vorpruefung: eine Ablehnung wegen Kunden-Hoechstzahl kostet keinen Sprachmodellaufruf", async () => {
  await mitElWeg(2, async ({ srv, anbieter }) => {
    const vorher = anthropicAttrappe.anfragen();
    await startePlaetze(srv, 0, 2);
    const fuerZweiAnrufe = anthropicAttrappe.anfragen() - vorher;
    assert.ok(fuerZweiAnrufe > 0, "angenommene Anrufe fragen das Sprachmodell");
    const abgelehnt = await rufeAn(srv, 0, zielVon(3));
    assert.equal(abgelehnt.status, HTTP_TOO_MANY);
    assert.equal(anthropicAttrappe.anfragen() - vorher, fuerZweiAnrufe);
    assert.equal(anbieter.starts().length, 2);
  });
});

test("Vorpruefung: eine Ablehnung ausgelastet kostet keinen Sprachmodellaufruf", async () => {
  await mitElWeg(4, async ({ srv }) => {
    const vorher = anthropicAttrappe.anfragen();
    await startePlaetze(srv, 0, 2);
    await startePlaetze(srv, 1, 1);
    await startePlaetze(srv, 2, 1);
    const fuerVierAnrufe = anthropicAttrappe.anfragen() - vorher;
    const abgelehnt = await rufeAn(srv, 3, zielVon(900));
    assert.equal(abgelehnt.status, HTTP_UNAVAILABLE);
    assert.equal(anthropicAttrappe.anfragen() - vorher, fuerVierAnrufe);
  });
});
