// GP-P6 (PLAN-GELDPFAD.md, "Preis-Waechter Katalog gegen Stripe"): zwei Sicherungen mit
// getrennter Schwere - (a) ein Katalog-Slug OHNE Stripe-Price-Id bricht bei aktivem
// Geldpfad den Boot ab (netzfrei, Config gegen Config), (b) ein Katalog-Betrag, der nicht
// zum Stripe-Price passt, erzeugt einen entprellten Betreiber-Befund.
//
// Rein und offline: Fake-Store, injiziertes lesePreis, makeStripeStub fuer die
// Adapter-Fixtur. Kein Netz, kein Anbieter-Call; nur die beiden Boot-Faelle spawnen den
// Server (und der spricht dabei ebenfalls mit niemandem).
//
// Testnamen tragen bewusst KEINEN Katalog-Praefix (i18nCatalogPattern kennt GAP, nicht GP;
// abnahmePattern verlangt ABNAHME-) - alle Faelle bleiben im Regressionslauf (Lehre
// catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makePriceDriftWatch, runPriceDriftSweep, priceDriftBucket } from "../src/billing/price-drift-watch.js";
import { unpricedPlanSlugs } from "../src/boot-guard.js";
import { CATALOG_SLUGS, PLAN_CATALOG } from "../src/plans.js";
import { NOT_PLACED } from "../src/telephony/failure-reason.js";
import { startServer, startServerExpectExit, makeStripeStub } from "./helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const STARTER_PRICE = "price_starter";
const BUSINESS_PRICE = "price_business";
const ALERT_SENDER = "+15005550006";
const ALERT_SMS_TO = "+15005550007";
const ALERT_MAIL_TO = "ops@example.invalid";
const MINDESTFRIST_MS = 86_400_000;
const ENTPRELLUNG_MS = 21_600_000;
const STUNDE_MS = 3_600_000;
// Fester Startzeitpunkt statt Date.now(): zwei Laeufe im selben Millisekunden-Tick sind
// von einem echten zweiten Lauf nicht unterscheidbar (der Marker traegt dieselbe Zeit).
const T0 = Date.parse("2026-09-11T00:00:00.000Z");
const HTTP_OK = 200;

// Die gesunden Anbieter-Antworten: exakt das, was der Katalog anzeigt.
const GESUNDE_PREISE = Object.freeze({
  [STARTER_PRICE]: { unitAmountCents: 499, currency: "eur" },
  [BUSINESS_PRICE]: { unitAmountCents: 999, currency: "eur" },
});

function fakeConfig(overrides = {}) {
  return withConfigNamespaces({
    paymentEnabled: true,
    priceDriftMinIntervalMs: MINDESTFRIST_MS,
    priceDriftUnknownEscalateAfter: 3,
    stripeStarterPriceId: STARTER_PRICE,
    stripeBusinessPriceId: BUSINESS_PRICE,
    platformAlertMailTo: ALERT_MAIL_TO,
    platformAlertSmsTo: ALERT_SMS_TO,
    // Produktions-Defaults der geteilten Entprellung (6 h / 15 min) - damit "zweiter Lauf
    // knapp nach der Mindestfrist" deterministisch entprellt wird (Muster W-6).
    outageAlertDebounceMs: ENTPRELLUNG_MS,
    outageAlertRetryMs: 900_000,
    ...overrides,
  });
}

function fakeStore(alerts = []) {
  const state = {
    outageAlerts: [...alerts],
    calls: [],
    platformNumberUse: [
      { e164: ALERT_SENDER, provider: "telnyx", purpose: "alert_sms_sender", releasedAt: null },
    ],
  };
  return {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => fn(),
  };
}

// Baut Waechter + Protokoll in EINEM Schritt (G5: sonst stuende dieses Buendel in jedem
// Fall erneut). preise: priceId -> Messung; alternativ eine Funktion fuer Fehlerfaelle.
function baueWaechter({ preise = GESUNDE_PREISE, config: cfg = fakeConfig(), store = fakeStore() } = {}) {
  const protokoll = { audit: [], mails: 0, sms: 0, abrufe: [] };
  const lesePreis = async (priceId) => {
    protokoll.abrufe.push(priceId);
    if (typeof preise === "function") return preise(priceId);
    return preise[priceId];
  };
  const deps = {
    store,
    config: cfg,
    audit: (aktion) => protokoll.audit.push(aktion),
    messaging: () => ({
      sendSms: async () => {
        protokoll.sms += 1;
      },
    }),
    mailer: {
      sendMail: async () => {
        protokoll.mails += 1;
      },
    },
    lesePreis,
  };
  // watch: der Weg, den boot.js geht (Fabrik, eigene Uhr). lauf(nowMs): derselbe Kern mit
  // gestellter Uhr - fuer jeden Fall, der ZWEI Laeufe zu verschiedenen Zeiten braucht.
  return {
    watch: makePriceDriftWatch(deps),
    lauf: (nowMs) => runPriceDriftSweep({ ...deps, anlass: "test", nowMs }),
    protokoll,
    store,
    config: cfg,
  };
}

// Lese-Helfer (G36): kein vierfach verkettetes store.load().outageAlerts.find(...).
function offeneMarker(store) {
  const alerts = store.load().outageAlerts;
  return alerts.filter((alert) => alert.closedAt === null).map((alert) => alert.code);
}

const preisAudit = (protokoll) => protokoll.audit.filter((aktion) => aktion.startsWith("price_drift"));

// ---------------------------------------------------------------------------------------
// P6-0: Positiv-Kontrolle - ein Waechter, der alles meldet, besteht jeden Negativ-Test
// ---------------------------------------------------------------------------------------
test("GP-P6: P6-0 gesunde Preise -> KEIN Befund, KEIN Marker, aber die Umfangszeile existiert", async () => {
  const zeilen = [];
  const originalLog = console.log;
  console.log = (...args) => zeilen.push(args.join(" "));
  try {
    const { watch, protokoll, store } = baueWaechter();
    await watch.runBootProbe();
    assert.deepEqual(preisAudit(protokoll), [], "ein gesunder Lauf darf keine price_drift*-Zeile erzeugen");
    assert.deepEqual(offeneMarker(store), ["price-drift:lauf"], "nur der Zeitanker bleibt offen");
    assert.equal(protokoll.mails, 0);
    assert.equal(protokoll.sms, 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(
    zeilen.some((zeile) => zeile.includes("[price-drift] anlass=boot") && zeile.includes("abweichungen=0")),
    `die Umfangszeile fehlt - ein Waechter, der nichts findet, muss von einem, der nichts sucht, unterscheidbar sein: ${zeilen.join("|")}`,
  );
});

// ---------------------------------------------------------------------------------------
// Abnahme 1: eine echte Abweichung wird gemeldet
// ---------------------------------------------------------------------------------------
test("GP-P6: P6-1 Stripe bucht 599 statt der angezeigten 499 -> genau EIN Marker, EINE Audit-Zeile, EINE Mail, EINE SMS", async () => {
  const { watch, protokoll, store } = baueWaechter({
    preise: { ...GESUNDE_PREISE, [STARTER_PRICE]: { unitAmountCents: 599, currency: "eur" } },
  });
  await watch.runPriceDriftSweep();
  assert.deepEqual(preisAudit(protokoll), ["price_drift"]);
  assert.deepEqual(offeneMarker(store).sort(), ["price-drift:lauf", priceDriftBucket("starter")].sort());
  assert.equal(protokoll.mails, 1, "eine Preisabweichung meldet VOLL (Mail ist der primaere Kanal)");
  assert.equal(protokoll.sms, 1);
});

// ---------------------------------------------------------------------------------------
// Abnahme 2: Entprellung und Single-Flight
// ---------------------------------------------------------------------------------------
test("GP-P6: P6-2 unveraenderte Abweichung im naechsten Lauf INNERHALB der Entprellung -> KEIN zweiter Versand, Marker bleibt frisch", async () => {
  const { lauf, protokoll, store } = baueWaechter({
    // Mindestfrist bewusst KUERZER als die Entprellung (Muster W-6): nur so misst dieser
    // Fall den Lauf INNERHALB des Entprell-Fensters. Der Produktions-Takt ist laenger als
    // die Entprellung - ein UNGELOESTER Drift meldet sich dort taeglich erneut, und das
    // ist gewollt (Pre-Mortem 2).
    config: fakeConfig({ priceDriftMinIntervalMs: STUNDE_MS }),
    preise: { ...GESUNDE_PREISE, [STARTER_PRICE]: { unitAmountCents: 599, currency: "eur" } },
  });
  await lauf(T0);
  await lauf(T0 + STUNDE_MS);
  assert.deepEqual(preisAudit(protokoll), ["price_drift", "price_drift_entprellt"]);
  assert.equal(protokoll.mails, 1, "die Entprellung des geteilten Meldewegs verhindert den zweiten Versand");
  assert.equal(protokoll.sms, 1);
  const marker = store.load().outageAlerts.find((alert) => alert.code === priceDriftBucket("starter"));
  assert.notEqual(marker.lastSeenAt, marker.firstSeenAt, "der entprellte Lauf muss den Marker trotzdem frisch halten");
});

test("GP-P6: P6-2b zweiter Lauf INNERHALB der Mindestfrist -> lesePreis wird gar nicht erst gerufen (Single-Flight)", async () => {
  const { watch, protokoll } = baueWaechter();
  await watch.runPriceDriftSweep();
  const nachErstemLauf = protokoll.abrufe.length;
  await watch.runPriceDriftSweep();
  assert.equal(protokoll.abrufe.length, nachErstemLauf, "der zweite Lauf darf den Anbieter nicht erneut befragen");
});

// ---------------------------------------------------------------------------------------
// Abnahme 3: Unwissenheit wird gezaehlt, GENAU EINMAL eskaliert und wieder zurueckgesetzt
// ---------------------------------------------------------------------------------------
const werfendesLesen = () => {
  throw new Error("Stripe retrievePriceAmount fehlgeschlagen (HTTP 401)");
};

test("GP-P6: P6-3 werfendes lesePreis -> kein Wurf nach aussen; Laeufe 1+2 nur Notiz, Lauf 3 GENAU EINE Meldung, Laeufe 4+5 nichts", async () => {
  const { lauf, protokoll, store } = baueWaechter({ preise: werfendesLesen });
  const LAEUFE = 5;
  for (let nummer = 0; nummer < LAEUFE; nummer += 1) await lauf(T0 + nummer * MINDESTFRIST_MS);
  assert.deepEqual(preisAudit(protokoll), [
    "price_drift_unknown",
    "price_drift_unknown",
    "price_drift_unknown_escalated",
  ]);
  assert.equal(protokoll.mails, 1, "die Unwissenheit meldet GENAU EINMAL, nicht bei jedem Lauf");
  assert.equal(protokoll.sms, 1);
  assert.deepEqual(offeneMarker(store).filter((code) => code.startsWith("price-drift:unbekannt:")), [
    "price-drift:unbekannt:1",
    "price-drift:unbekannt:2",
    "price-drift:unbekannt:3",
  ]);
});

test("GP-P6: P6-3b ein erfolgreicher Lauf zwischen zwei unbekannten setzt den Zaehler zurueck", async () => {
  let kaputt = true;
  const { lauf, store, protokoll } = baueWaechter({
    preise: (priceId) => {
      if (kaputt) werfendesLesen();
      return GESUNDE_PREISE[priceId];
    },
  });
  await lauf(T0);
  kaputt = false;
  await lauf(T0 + MINDESTFRIST_MS);
  assert.deepEqual(
    offeneMarker(store).filter((code) => code.startsWith("price-drift:unbekannt:")),
    [],
    "ein Lauf mit vollstaendigem Urteil schliesst alle Unwissenheits-Slots",
  );
  kaputt = true;
  await lauf(T0 + MINDESTFRIST_MS + MINDESTFRIST_MS);
  assert.deepEqual(preisAudit(protokoll).slice(-1), ["price_drift_unknown"], "der Zaehler beginnt wieder bei Slot 1");
});

test("GP-P6: P6-3c ein unbekannter Lauf schliesst einen offenen Preis-Befund NICHT (keine falsche Entwarnung)", async () => {
  let kaputt = false;
  const { lauf, store } = baueWaechter({
    preise: (priceId) => {
      if (kaputt) werfendesLesen();
      if (priceId === STARTER_PRICE) return { unitAmountCents: 599, currency: "eur" };
      return GESUNDE_PREISE[priceId];
    },
  });
  await lauf(T0);
  assert.ok(offeneMarker(store).includes(priceDriftBucket("starter")));
  kaputt = true;
  await lauf(T0 + MINDESTFRIST_MS);
  assert.ok(
    offeneMarker(store).includes(priceDriftBucket("starter")),
    "ein Lauf ohne Urteil darf einen bestehenden Befund nicht stillschweigend schliessen",
  );
});

// ---------------------------------------------------------------------------------------
// Abnahme 4/5: der Boot-Guard (a)
// ---------------------------------------------------------------------------------------
const PAY_BOOT_ENV = Object.freeze({
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: "http://127.0.0.1:9",
  NUMBER_SETUP_FEE_CENTS: "500",
});

test("GP-P6: P6-4 Katalog-Slug ohne Price-Id bei PAYMENT_ENABLED=true -> Boot-Refusal VOR app.listen", async () => {
  const { code, output } = await startServerExpectExit({
    env: { ...PAY_BOOT_ENV, STRIPE_STARTER_PRICE_ID: "price_a", STRIPE_BUSINESS_PRICE_ID: "" },
  });
  assert.equal(code, 1, `erwartet exit(1), Ausgabe:\n${output}`);
  assert.match(output, /Katalog-Tarif\(e\) ohne Stripe-Price-Id: business/);
  assert.doesNotMatch(
    output,
    /Hermes Gateway laeuft auf/,
    "das Gate muss VOR app.listen greifen - ein gestarteter Listener waere bereits erreichbar",
  );
});

test("GP-P6: P6-5 ohne aktiven Geldpfad sind leere Price-Ids folgenlos - der Dienst startet", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
  } finally {
    await srv.stop();
  }
});

// ---------------------------------------------------------------------------------------
// P6-6: Rollback-Hebel und Trennung der Marker-Raeume
// ---------------------------------------------------------------------------------------
test("GP-P6: P6-6 Mindestfrist 0 bzw. Payment aus -> lesePreis wird NIE gerufen (Rollback-Hebel)", async () => {
  const aus = baueWaechter({ config: fakeConfig({ priceDriftMinIntervalMs: 0 }) });
  await aus.watch.runPriceDriftSweep();
  assert.deepEqual(aus.protokoll.abrufe, []);

  const ohneGeldpfad = baueWaechter({ config: fakeConfig({ paymentEnabled: false }) });
  await ohneGeldpfad.watch.runBootProbe();
  assert.deepEqual(ohneGeldpfad.protokoll.abrufe, []);
});

test("GP-P6: P6-6 die Marker des Preis-Waechters liegen in einem eigenen Raum (weder Telefonie-Drift noch Fehlergrund-Eimer greifen sie)", () => {
  const codes = [priceDriftBucket("starter"), "price-drift:lauf", "price-drift:unbekannt:1"];
  for (const code of codes) {
    assert.equal(code.startsWith("drift:"), false, `${code} wuerde vom Telefonie-Drift-Waechter mitgeschlossen`);
    assert.equal(code.startsWith(NOT_PLACED), false, `${code} wuerde als Fehlergrund-Eimer gelesen`);
  }
});

// ---------------------------------------------------------------------------------------
// P6-7: der rein lesende Adapter
// ---------------------------------------------------------------------------------------
const SECRET = "sk_test_gpp6";
const withStripeStub = makeStripeStub(config, SECRET);
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test("GP-P6: P6-7 retrievePriceAmount liest GET /v1/prices/<id> und gibt NUR Betrag und Waehrung heraus", async () => {
  let captured;
  const messung = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ id: "price_x", unit_amount: 499, currency: "eur", nickname: "Starter" });
    },
    () => stripeBilling.retrievePriceAmount("price_x"),
  );
  assert.ok(captured.url.endsWith("/v1/prices/price_x"), "rein lesender Pfad");
  assert.equal(captured.opts.method, "GET");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.deepEqual(messung, { unitAmountCents: 499, currency: "eur" });
});

test("GP-P6: P6-7 gestaffelter Price ohne unit_amount -> null (der Waechter urteilt unbekannt statt zu raten)", async () => {
  const messung = await withStripeStub(
    async () => okJson({ id: "price_x", billing_scheme: "tiered", currency: "eur" }),
    () => stripeBilling.retrievePriceAmount("price_x"),
  );
  assert.equal(messung.unitAmountCents, null);
});

test("GP-P6: P6-7 Nicht-2xx -> wirft mit Status, OHNE Schluessel in der Meldung", async () => {
  await withStripeStub(
    async () => ({ ok: false, status: 403, json: async () => ({}) }),
    async () => {
      await assert.rejects(
        () => stripeBilling.retrievePriceAmount("price_x"),
        (err) => {
          assert.match(err.message, /403/);
          assert.doesNotMatch(err.message, new RegExp(SECRET));
          return true;
        },
      );
    },
  );
});

// ---------------------------------------------------------------------------------------
// P6-8: das reine Praedikat des Boot-Guards
// ---------------------------------------------------------------------------------------
test("GP-P6: P6-8 unpricedPlanSlugs nennt genau die Slugs ohne Price-Id", () => {
  const alle = { starter: STARTER_PRICE, business: BUSINESS_PRICE };
  assert.deepEqual(unpricedPlanSlugs(CATALOG_SLUGS, (slug) => alle[slug]), []);
  assert.deepEqual(unpricedPlanSlugs(CATALOG_SLUGS, (slug) => (slug === "business" ? "" : alle[slug])), ["business"]);
  assert.deepEqual(unpricedPlanSlugs([], () => null), []);
});

test("GP-P6: P6-8 der Waechter prueft JEDEN Katalog-Tarif, nicht nur den ersten", async () => {
  const { watch, protokoll } = baueWaechter();
  await watch.runPriceDriftSweep();
  assert.equal(protokoll.abrufe.length, PLAN_CATALOG.length);
});
