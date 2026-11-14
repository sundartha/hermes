import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import { makePgTestStore } from "../pg-helpers.js";

const JETZT_MS = Date.parse("2026-11-14T12:00:00.000Z");

function marker(code, felder = {}) {
  return {
    id: `otg_${code}`, code, firstSeenAt: "2026-11-14T08:00:00.000Z", lastSeenAt: "2026-11-14T08:00:00.000Z",
    lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null, ...felder,
  };
}

const { store: echterSpeicher } = await makePgTestStore();

function speicherMit(markerListe, protokoll = []) {
  const zustand = echterSpeicher.load();
  zustand.outageAlerts = markerListe;
  echterSpeicher.save = () => protokoll.push("save");
  return echterSpeicher;
}

function festhalten(speicher) {
  let freigeben;
  const gehalten = new Promise((aufloesen) => {
    freigeben = aufloesen;
  });
  const sperre = speicher.withStoreLock(() => gehalten);
  return { freigeben, sperre };
}

async function mikroaufgaben() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const schliessZeiten = (liste) => liste.map(({ closedAt }) => closedAt);

const iso = (ms) => new Date(ms).toISOString();

test("abgleich: die drei Kandidatenlisten liefern je ihre Mandanten als Promise und lesen load erst beim Aufruf", async () => {
  const zustand = {
    tenants: [
      { id: "t_stripe", status: "active", stripeSubscriptionId: "sub_1" },
      { id: "t_alt", status: "suspended", stripeSubscriptionId: "sub_2", suspendedAt: "2026-11-01T00:00:00.000Z" },
      { id: "t_karte", status: "active", stripePaymentMethodId: "pm_1" },
      { id: "t_karte_mit_typ", status: "active", stripePaymentMethodId: "pm_2", stripePaymentMethodType: "card" },
      { id: "t_leer", status: "active" },
    ],
  };
  const speicher = {};
  const { abgleich } = speicherBereiche(speicher);
  speicher.load = () => zustand;
  const stripe = abgleich.stripeKandidaten();
  assert.ok(stripe instanceof Promise);
  assert.deepEqual((await stripe).map(({ id }) => id), ["t_stripe"]);
  assert.deepEqual((await abgleich.veralteteAboKandidaten()).map(({ id }) => id), ["t_alt"]);
  assert.deepEqual((await abgleich.zahlartTypKandidaten()).map(({ id }) => id), ["t_karte"]);
  speicher.load = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(abgleich.stripeKandidaten(), /kaputt/);
});

test("ausfall: offeneMarkerSchliessen schliesst nur offene Marker, die das Urteil trifft, und zaehlt sie", async () => {
  const protokoll = [];
  const speicher = speicherMit(
    [marker("treffer:offen"), marker("andere:offen"), marker("treffer:zu", { closedAt: "2026-11-14T09:00:00.000Z" })],
    protokoll,
  );
  const gefragt = [];
  const antwort = speicherBereiche(speicher).ausfall.offeneMarkerSchliessen({
    istZuSchliessen: (code) => {
      gefragt.push(code);
      return code.startsWith("treffer:");
    },
    nowMs: JETZT_MS,
  });
  assert.ok(antwort instanceof Promise);
  assert.equal(await antwort, 1);
  assert.deepEqual(schliessZeiten(speicher.load().outageAlerts), [iso(JETZT_MS), null, "2026-11-14T09:00:00.000Z"]);
  assert.deepEqual(gefragt, ["treffer:offen", "andere:offen"]);
  assert.deepEqual(protokoll, ["save"]);
});

test("ausfall: offeneMarkerSchliessen ohne Treffer liefert 0, laesst alles offen und speichert trotzdem", async () => {
  const protokoll = [];
  const speicher = speicherMit([marker("a"), marker("b")], protokoll);
  const anzahl = await speicherBereiche(speicher).ausfall.offeneMarkerSchliessen({
    istZuSchliessen: () => false,
    nowMs: JETZT_MS,
  });
  assert.equal(anzahl, 0);
  assert.deepEqual(schliessZeiten(speicher.load().outageAlerts), [null, null]);
  assert.deepEqual(protokoll, ["save"]);
});

test("ausfall: offeneMarkerSchliessen wartet auf die Speicher-Sperre, bevor es liest, schliesst und speichert", async () => {
  const protokoll = [];
  const speicher = speicherMit([marker("treffer")], protokoll);
  const { freigeben, sperre } = festhalten(speicher);
  let antwort;
  try {
    antwort = speicherBereiche(speicher).ausfall.offeneMarkerSchliessen({
      istZuSchliessen: () => true,
      nowMs: JETZT_MS,
    });
    await mikroaufgaben();
    assert.deepEqual(schliessZeiten(speicher.load().outageAlerts), [null]);
    assert.deepEqual(protokoll, []);
  } finally {
    freigeben();
    await sperre;
  }
  assert.equal(await antwort, 1);
  assert.deepEqual(schliessZeiten(speicher.load().outageAlerts), [iso(JETZT_MS)]);
  assert.deepEqual(protokoll, ["save"]);
});

test("ausfall: offeneMarkerSchliessen wirft den Fehler des Speichers weiter und speichert dann nicht", async () => {
  const protokoll = [];
  const speicher = { ...speicherMit([], protokoll) };
  speicher.load = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(
    speicherBereiche(speicher).ausfall.offeneMarkerSchliessen({ istZuSchliessen: () => true, nowMs: JETZT_MS }),
    /kaputt/,
  );
  assert.deepEqual(protokoll, []);
});
