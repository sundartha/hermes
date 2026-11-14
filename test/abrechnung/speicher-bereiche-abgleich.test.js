import assert from "node:assert/strict";
import { test } from "node:test";

import { runPriceDriftSweep } from "../../src/billing/price-drift-watch.ts";
import { speicherBereiche } from "../../src/store.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";

const JETZT_MS = Date.parse("2026-11-14T12:00:00.000Z");
const FRIST_MS = 86_400_000;
const STARTER_PRICE = "price_starter";
const BUSINESS_PRICE = "price_business";
const GESUNDE_PREISE = {
  [STARTER_PRICE]: { unitAmountCents: 499, currency: "eur" },
  [BUSINESS_PRICE]: { unitAmountCents: 999, currency: "eur" },
};

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
  zustand.platformNumberUse = [
    { e164: "+15005550006", provider: "telnyx", purpose: "alert_sms_sender", releasedAt: null },
  ];
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
const offeneCodes = (liste) => liste.filter(({ closedAt }) => closedAt === null).map(({ code }) => code);

function konfiguration(ueberschreibungen = {}) {
  return withConfigNamespaces({
    paymentEnabled: true,
    priceDriftMinIntervalMs: FRIST_MS,
    priceDriftUnknownEscalateAfter: 3,
    stripeStarterPriceId: STARTER_PRICE,
    stripeBusinessPriceId: BUSINESS_PRICE,
    platformAlertMailTo: "ops@example.invalid",
    platformAlertSmsTo: "+15005550007",
    outageAlertDebounceMs: 21_600_000,
    outageAlertRetryMs: 900_000,
    ...ueberschreibungen,
  });
}

function lauf({ alerts, preise = GESUNDE_PREISE, ueberschreibungen = {} }) {
  const abrufe = [];
  const speicher = speicherMit(alerts);
  const deps = {
    store: speicher,
    config: konfiguration(ueberschreibungen),
    audit: () => {},
    messaging: () => ({ sendSms: async () => {} }),
    mailer: { sendMail: async () => {} },
    lesePreis: async (priceId) => {
      abrufe.push(priceId);
      if (typeof preise === "function") return preise(priceId);
      return preise[priceId];
    },
  };
  return {
    alerts: () => speicher.load().outageAlerts,
    abrufe,
    ausfuehren: () => runPriceDriftSweep({ ...deps, anlass: "test", nowMs: JETZT_MS }),
  };
}

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

test("Preis-Waechter: ein Lauf genau eine Mindestfrist nach dem letzten Marker laeuft, einer eine Millisekunde davor nicht", async () => {
  const genau = lauf({ alerts: [marker("price-drift:lauf", { lastSeenAt: iso(JETZT_MS - FRIST_MS) })] });
  await genau.ausfuehren();
  assert.deepEqual(genau.abrufe, [STARTER_PRICE, BUSINESS_PRICE]);
  assert.deepEqual(genau.alerts().map(({ lastSeenAt }) => lastSeenAt), [iso(JETZT_MS)]);

  const davor = lauf({ alerts: [marker("price-drift:lauf", { lastSeenAt: iso(JETZT_MS - FRIST_MS + 1) })] });
  await davor.ausfuehren();
  assert.deepEqual(davor.abrufe, []);
});

test("Preis-Waechter: ohne Marker oder ohne Zeitstempel im Marker laeuft der Lauf und legt den Marker an bzw. frischt ihn auf", async () => {
  const ohne = lauf({ alerts: [] });
  await ohne.ausfuehren();
  assert.equal(ohne.abrufe.length, 2);
  assert.deepEqual(offeneCodes(ohne.alerts()), ["price-drift:lauf"]);

  const ohneZeit = lauf({ alerts: [marker("price-drift:lauf", { lastSeenAt: null })] });
  await ohneZeit.ausfuehren();
  assert.equal(ohneZeit.abrufe.length, 2);
  assert.deepEqual(ohneZeit.alerts().map(({ lastSeenAt }) => lastSeenAt), [iso(JETZT_MS)]);
});

test("Preis-Waechter: ein behobener Befund schliesst genau seinen offenen Marker und keinen fremden", async () => {
  const durchlauf = lauf({
    alerts: [
      marker("price-drift:starter"),
      marker("price-drift:lauf", { lastSeenAt: iso(JETZT_MS - FRIST_MS) }),
      marker("fremd:offen"),
    ],
  });
  await durchlauf.ausfuehren();
  assert.deepEqual(offeneCodes(durchlauf.alerts()), ["price-drift:lauf", "fremd:offen"]);
  assert.deepEqual(schliessZeiten(durchlauf.alerts()), [iso(JETZT_MS), null, null]);
});

test("Preis-Waechter: die Nummer des Unwissenheits-Slots zaehlt nur offene Slots, keine geschlossenen und keine anderen Marker", async () => {
  const durchlauf = lauf({
    preise: () => {
      throw new Error("Stripe nicht erreichbar");
    },
    alerts: [
      marker("price-drift:unbekannt:1"),
      marker("price-drift:unbekannt:5", { closedAt: "2026-11-13T00:00:00.000Z" }),
      marker("price-drift:starter"),
    ],
  });
  await durchlauf.ausfuehren();
  const offen = offeneCodes(durchlauf.alerts());
  assert.ok(offen.includes("price-drift:unbekannt:2"));
  assert.ok(!offen.includes("price-drift:unbekannt:3"));
  assert.ok(offen.includes("price-drift:starter"));
});
