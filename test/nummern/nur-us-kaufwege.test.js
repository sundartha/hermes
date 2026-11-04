import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_PRICE_BOOT_ENV, startServer, waitForStoreState } from "../helpers.js";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";

const ERWARTETER_FEHLER =
  "Kaufland des Hintergrundkaufs, seines Redrive und der Suchtabelle folgt Konfiguration oder Kundenland statt der Länderliste";

const PLATTFORMLAND = "DE";
const KUNDE_DE = Object.freeze({ tenantId: "t_kunde_de", country: "DE", defaultLanguage: "de" });
const KUNDEN = Object.freeze([
  KUNDE_DE,
  { tenantId: "t_kunde_fr", country: "FR", defaultLanguage: "fr" },
  { tenantId: "t_kunde_ca", country: "CA", defaultLanguage: "en" },
  { tenantId: "t_kunde_ohne_land" },
]);
const NUR_US = Object.freeze(["US", "US", "US", "US"]);
const STUNDE_MS = 3_600_000;
const KAUF_FRIST_MS = 15_000;
const EINRICHTUNG_CENTS = 100;
const VERBINDUNG = "conn_nur_us";
const WEBHOOK_SECRET = "whsec_nur_us_kaufwege";

function suchparameter(pfad) {
  return new URL(pfad, "http://attrappe").searchParams;
}

function antworteJson(res, daten) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(daten));
}

async function telnyxAttrappe() {
  const suchlaender = [];
  const bestellungen = [];
  const attrappe = await starteAnbieterServer(({ req, body, res }) => {
    if (req.url.startsWith("/v2/available_phone_numbers")) {
      suchlaender.push(suchparameter(req.url).get("filter[country_code]"));
      const angebot = `+1202555${String(suchlaender.length).padStart(4, "0")}`;
      return antworteJson(res, { data: [{ phone_number: angebot }] });
    }
    if (req.url === "/v2/number_orders") {
      const bestellung = JSON.parse(body);
      const [{ phone_number: bestellt }] = bestellung.phone_numbers;
      bestellungen.push({ e164: bestellt, verbindung: bestellung.connection_id ?? null });
      return antworteJson(res, {
        data: { phone_numbers: [{ id: `ord_${bestellt}`, phone_number: bestellt }] },
      });
    }
    if (req.url.startsWith("/v2/phone_numbers?")) {
      const gesucht = suchparameter(req.url).get("filter[phone_number]");
      return antworteJson(res, { data: [{ id: `num_${gesucht}`, phone_number: gesucht }] });
    }
    return antworteJson(res, { data: {} });
  });
  return {
    close: attrappe.close,
    url: attrappe.url,
    gesuchteLaender: () => [...suchlaender],
    bestellungen: () => [...bestellungen],
  };
}

async function stripeAttrappe() {
  const gehalten = [];
  const attrappe = await starteAnbieterServer(({ req, body, res }) => {
    if (req.url === "/v1/payment_intents" && req.method === "POST") {
      gehalten.push(Number(new URLSearchParams(body).get("amount")));
      return antworteJson(res, { id: `pi_${gehalten.length}`, status: "requires_capture" });
    }
    if (req.url.endsWith("/capture")) return antworteJson(res, { status: "succeeded" });
    return antworteJson(res, {});
  });
  return { close: attrappe.close, url: attrappe.url, gehalteneBetraege: () => [...gehalten] };
}

function mandantMitKarte({ tenantId, country, defaultLanguage }) {
  return {
    id: tenantId,
    status: "active",
    kycLevel: "id_verified",
    firstName: "Kim",
    ownerName: "Kim Kunde",
    stripeCustomerId: `cus_${tenantId}`,
    stripePaymentMethodId: `pm_${tenantId}`,
    stripePaymentMethodType: "card",
    ...(country ? { country, defaultLanguage } : {}),
  };
}

function haengenderKauf(kunde, landDerNummer) {
  const numberId = `num_${kunde.tenantId}`;
  return {
    tenant: mandantMitKarte(kunde),
    number: {
      id: numberId,
      tenantId: kunde.tenantId,
      status: "requested",
      e164: null,
      provider: "telnyx",
      country: landDerNummer,
      language: kunde.defaultLanguage ?? null,
      providerNumberId: null,
    },
    job: {
      id: `job_${numberId}`,
      numberId,
      tenantId: kunde.tenantId,
      kind: "provision_number",
      status: "queued",
      idempotencyKey: `provision_${numberId}`,
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    },
  };
}

function seedHaengenderKaeufe(kunden, landDerNummer) {
  const kaeufe = kunden.map((kunde) => haengenderKauf(kunde, landDerNummer(kunde)));
  return {
    tenants: kaeufe.map((kauf) => kauf.tenant),
    numbers: kaeufe.map((kauf) => kauf.number),
    provisioningJobs: kaeufe.map((kauf) => kauf.job),
  };
}

const nummerVon = (state, kunde) =>
  (state.numbers || []).find((nummer) => nummer.tenantId === kunde.tenantId);

const alleAktiv = (kunden) => (state) =>
  kunden.every((kunde) => nummerVon(state, kunde)?.status === "active");

const ZAHLUNG_UMGEBUNG = (stripe) => ({
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_nur_us",
  STRIPE_API_BASE: stripe.url,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  NUMBER_SETUP_FEE_CENTS: String(EINRICHTUNG_CENTS),
  ...PLAN_PRICE_BOOT_ENV,
});

async function mitServer({ seed, umgebung = {} }, ablauf) {
  const telnyx = await telnyxAttrappe();
  try {
    const srv = await startServer({
      seed,
      env: {
        PROVISIONING_ENABLED: "true",
        PROVISIONING_COUNTRY: PLATTFORMLAND,
        PROVISIONING_REDRIVE_MAX_AGE_MS: String(STUNDE_MS),
        TELNYX_API_KEY: "KEYnurUs",
        TELNYX_CONNECTION_ID: VERBINDUNG,
        TELNYX_API_BASE: telnyx.url,
        MAX_NUMBERS: "20",
        ...umgebung,
      },
    });
    try {
      return await ablauf({ srv, telnyx });
    } finally {
      await srv.stop();
    }
  } finally {
    await telnyx.close();
  }
}

test("Hintergrundkauf: Drain und Redrive haengender Kaeufe mit altem Land DE, FR, CA und ohne Land suchen und bestellen bei Plattformland DE nur in US", async () => {
  const seed = seedHaengenderKaeufe(KUNDEN, (kunde) => kunde.country ?? null);
  const { telnyx, state } = await mitServer({ seed }, async ({ srv, telnyx: anbieter }) => ({
    telnyx: anbieter,
    state: await waitForStoreState(srv, alleAktiv(KUNDEN), KAUF_FRIST_MS),
  }));

  assert.deepEqual(telnyx.gesuchteLaender(), NUR_US, ERWARTETER_FEHLER);
  assert.deepEqual(
    telnyx.bestellungen().map((bestellung) => [bestellung.e164.slice(0, 2), bestellung.verbindung]),
    KUNDEN.map(() => ["+1", VERBINDUNG]),
  );
  assert.deepEqual(
    KUNDEN.map((kunde) => nummerVon(state, kunde).e164.slice(0, 2)),
    KUNDEN.map(() => "+1"),
  );
});

test("[NIE1] Kauf nach der Zahlung: die bezahlten US-Anfragen von Kunden aus DE, FR, CA und ohne Land halten den Einrichtungsbetrag, bleiben number.country US, und Telnyx sieht nur country_code US", async () => {
  const stripe = await stripeAttrappe();
  try {
    const seed = seedHaengenderKaeufe(KUNDEN, () => "US");
    const { telnyx, state } = await mitServer(
      { seed, umgebung: ZAHLUNG_UMGEBUNG(stripe) },
      async ({ srv, telnyx: anbieter }) => ({
        telnyx: anbieter,
        state: await waitForStoreState(srv, alleAktiv(KUNDEN), KAUF_FRIST_MS),
      }),
    );

    assert.deepEqual(telnyx.gesuchteLaender(), NUR_US);
    assert.deepEqual(
      KUNDEN.map((kunde) => nummerVon(state, kunde).country),
      NUR_US,
    );
    assert.deepEqual(
      stripe.gehalteneBetraege(),
      KUNDEN.map(() => EINRICHTUNG_CENTS),
    );
  } finally {
    await stripe.close();
  }
});

test("[NIE2] Hintergrundkauf mit Zahlung lehnt einen DE-Kunden mit altem Land DE nicht ab: Nummer in US gekauft und aktiv, tenant.country DE und number.language de", async () => {
  const stripe = await stripeAttrappe();
  try {
    const seed = seedHaengenderKaeufe([KUNDE_DE], () => "DE");
    const { telnyx, state } = await mitServer(
      { seed, umgebung: ZAHLUNG_UMGEBUNG(stripe) },
      async ({ srv, telnyx: anbieter }) => ({
        telnyx: anbieter,
        state: await waitForStoreState(srv, alleAktiv([KUNDE_DE]), KAUF_FRIST_MS),
      }),
    );

    const nummer = nummerVon(state, KUNDE_DE);
    const tenant = state.tenants.find((eintrag) => eintrag.id === KUNDE_DE.tenantId);
    assert.deepEqual(
      {
        nummerStatus: nummer.status,
        vorwahl: nummer.e164.slice(0, 2),
        gesuchteLaender: telnyx.gesuchteLaender(),
        gehalten: stripe.gehalteneBetraege(),
        tenantLand: tenant.country,
        tenantSprache: tenant.defaultLanguage,
        nummerSprache: nummer.language,
      },
      {
        nummerStatus: "active",
        vorwahl: "+1",
        gesuchteLaender: ["US"],
        gehalten: [EINRICHTUNG_CENTS],
        tenantLand: "DE",
        tenantSprache: "de",
        nummerSprache: "de",
      },
    );
  } finally {
    await stripe.close();
  }
});
