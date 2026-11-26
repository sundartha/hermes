import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";
import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { fakeProvisioner, seedState, startServer } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.ts";
import { BOOTSTRAP_TENANT_ID as BOOTSTRAP_MANDANT } from "../../src/begriffe/mandant.ts";

const BOOTSTRAP_NUMMER = "+15005550006";
const ANDERE_NUMMER = "+15005550007";
const SMS_ZIEL = "+15005550009";
const HTTP_OK = 200;
const EINMAL = 1;
const KEINE = 0;
const SCHRANKE_PFAD = "/schranke";
const MS_JE_SEKUNDE = 1_000;
const HALT_ZWECK = "bootstrap_number_hold";
const HALT_NOTIZ = "abgeleitet aus der aktiven Bootstrap-Nummer (Halt gegen Freigabe)";
const ABO = "sub_bootstrap_halt";

function offeneHalte(zustand) {
  return zustand.platformNumberUse.filter((zeile) => zeile.purpose === HALT_ZWECK && zeile.releasedAt === null);
}

function bootstrapSeed(e164) {
  return seedState({
    tenants: [
      {
        id: BOOTSTRAP_MANDANT,
        status: "active",
        firstName: "Betreiber",
        ownerName: "Betreiber Halt",
        stripeSubscriptionId: ABO,
        stripeCancelAtPeriodEnd: true,
      },
    ],
    numbers: [
      {
        id: "num_halt",
        e164,
        tenantId: BOOTSTRAP_MANDANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: "ext_halt",
        providerAgentPhoneNumberId: "phnum_halt",
      },
    ],
  });
}

function aboEnde() {
  const koerper = JSON.stringify({
    id: "evt_bootstrap_halt",
    type: "customer.subscription.deleted",
    created: Math.floor(Date.now() / MS_JE_SEKUNDE),
    data: { object: { id: ABO, metadata: { tenant_ref: BOOTSTRAP_MANDANT } } },
  });
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const mac = createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: koerper,
  };
}

test("K1: Start mit leerem Speicher meldet die Heilung genau einmal an Better Stack, nicht per SMS", async (t) => {
  const vorfaelle = await starteBetterStackAttrappe();
  const sms = await starteAnbieterServer(({ req, vermerke, res }) => {
    vermerke({ pfad: req.url });
    res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}");
  });
  t.after(() => Promise.all([vorfaelle.close(), sms.close()]));
  const srv = await startServer({
    ownerNumber: null,
    env: {
      BOOTSTRAP_E164: BOOTSTRAP_NUMMER,
      BOOTSTRAP_PROVIDER: "telnyx",
      BETTERSTACK_ALERT_URL: vorfaelle.url,
      TELNYX_API_KEY: "test",
      TELNYX_API_BASE: sms.url,
      PLATFORM_ALERT_SMS_TO: SMS_ZIEL,
    },
  });
  try {
    const meldungen = await vorfaelle.aufMeldungen(EINMAL);
    await Promise.all([vorfaelle.schranke(), abrufMitFrist(`${sms.url}${SCHRANKE_PFAD}`)]);
    assert.equal(meldungen.length, EINMAL);
    assert.equal(meldungen[0].methode, "POST");
    assert.equal(meldungen[0].status, "alert");
    assert.match(meldungen[0].id, /^bootstrap-heal:/);
    assert.deepEqual(sms.anfragen.filter((eintrag) => eintrag.pfad !== SCHRANKE_PFAD), []);
  } finally {
    await srv.stop();
  }
});

test("K2: Kuendigung des Bootstrap-Mandanten loest bei vorhandener Haltezeile kein Provider-DELETE fuer die Bootstrap-Nummer aus", async () => {
  const { store } = await makePgTestStore();
  const zustand = store.load();
  zustand.tenants.push({ id: BOOTSTRAP_MANDANT, status: "active", firstName: "Betreiber", ownerName: "Betreiber Halt" });
  zustand.numbers.push({
    id: "num_halt",
    e164: BOOTSTRAP_NUMMER,
    tenantId: BOOTSTRAP_MANDANT,
    provider: "telnyx",
    status: "active",
    providerNumberId: "ext_halt",
  });
  zustand.numberAssignments.push({
    id: "a_halt",
    numberId: "num_halt",
    tenantId: BOOTSTRAP_MANDANT,
    assignedAt: "x",
    releasedAt: null,
  });
  zustand.platformNumberUse.push({
    id: "pnu_halt",
    e164: BOOTSTRAP_NUMMER,
    purpose: HALT_ZWECK,
    provider: "telnyx",
    tenantId: null,
    note: HALT_NOTIZ,
    boundAt: "x",
    releasedAt: null,
  });
  store.setTenantSubscription(BOOTSTRAP_MANDANT, { subscriptionId: ABO, cancelAtPeriodEnd: true });
  const provisioner = fakeProvisioner();
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS }),
    store,
    audit: () => {},
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    billing: {},
    provision: async () => {},
    numberProvisioner: provisioner,
    workos: null,
    auditStore: { record: () => Promise.resolve() },
  });
  const anfrage = aboEnde();
  const antwort = { statusCode: null, status(code) { this.statusCode = code; return this; }, json() { return this; } };
  await handler({ rawBody: Buffer.from(anfrage.body), headers: anfrage.headers }, antwort);
  const nachher = store.load();
  const mandant = nachher.tenants.find((eintrag) => eintrag.id === BOOTSTRAP_MANDANT);
  const nummer = nachher.numbers.find((eintrag) => eintrag.id === "num_halt");
  assert.equal(mandant.numberReleasePending, true);
  assert.deepEqual(provisioner.log, []);
  assert.equal(nummer.status, "active");
});

function haltelinien(srv) {
  return offeneHalte(srv.readStore());
}

test("K3: der Start legt genau eine offene Haltezeile ohne Mandanten an, ein zweiter Start keine zweite", async () => {
  const erster = await startServer({ seed: bootstrapSeed(BOOTSTRAP_NUMMER), ownerNumber: null });
  const dataDir = erster.dataDir;
  try {
    const halte = haltelinien(erster);
    assert.equal(halte.length, EINMAL);
    assert.equal(halte[0].e164, BOOTSTRAP_NUMMER);
    assert.equal(halte[0].tenantId, null);
    assert.equal(halte[0].provider, "telnyx");
    assert.equal(halte[0].note, HALT_NOTIZ);
  } finally {
    await erster.stop();
  }
  const zweiter = await startServer({ dataDir, ownerNumber: null });
  try {
    assert.equal(haltelinien(zweiter).length, EINMAL);
  } finally {
    await zweiter.stop();
  }
});

test("K3: wechselt die Bootstrap-Nummer, ist die alte Haltezeile geschlossen und die neue offen", async () => {
  const erster = await startServer({ seed: bootstrapSeed(BOOTSTRAP_NUMMER), ownerNumber: null });
  const dataDir = erster.dataDir;
  await erster.stop();
  const datei = path.join(dataDir, "store.json");
  const zustand = JSON.parse(fs.readFileSync(datei, "utf8"));
  zustand.numbers.find((eintrag) => eintrag.id === "num_halt").e164 = ANDERE_NUMMER;
  fs.writeFileSync(datei, JSON.stringify(zustand));
  const zweiter = await startServer({ dataDir, ownerNumber: null });
  try {
    const nachher = zweiter.readStore();
    const alt = nachher.platformNumberUse.find((zeile) => zeile.purpose === HALT_ZWECK && zeile.e164 === BOOTSTRAP_NUMMER);
    assert.notEqual(alt.releasedAt, null);
    const halte = offeneHalte(nachher);
    assert.equal(halte.length, EINMAL);
    assert.equal(halte[0].e164, ANDERE_NUMMER);
  } finally {
    await zweiter.stop();
  }
});

function fremdSeed() {
  return seedState({
    tenants: [{ id: "t_fremd", status: "active", firstName: "Fremd", ownerName: "Fremd Halt" }],
    numbers: [
      {
        id: "num_fremd",
        e164: ANDERE_NUMMER,
        tenantId: "t_fremd",
        provider: "telnyx",
        status: "active",
        providerNumberId: "ext_fremd",
        providerAgentPhoneNumberId: "phnum_fremd",
      },
    ],
  });
}

test("K3: ohne aktive Bootstrap-Nummer entsteht beim Start keine Haltezeile, weder offen noch geschlossen", async () => {
  const srv = await startServer({ seed: fremdSeed(), ownerNumber: null });
  try {
    const zeilen = srv.readStore().platformNumberUse.filter((zeile) => zeile.purpose === HALT_ZWECK);
    assert.deepEqual(zeilen, []);
  } finally {
    await srv.stop();
  }
});

const ALERT_ZWECK = "alert_sms_sender";
const GRUND_PLATTFORM = /number=num_halt grund=platform_number_in_use/;

function offeneZeilen(zustand, zweck) {
  return zustand.platformNumberUse.filter((zeile) => zeile.purpose === zweck && zeile.releasedAt === null);
}

async function kuendigeMitStartzeilen(gestartet) {
  const { store } = await makePgTestStore();
  const zustand = store.load();
  for (const feld of ["tenants", "numbers", "platformNumberUse"]) {
    zustand[feld].push(...structuredClone(gestartet[feld]));
  }
  zustand.numberAssignments.push({
    id: "a_halt",
    numberId: "num_halt",
    tenantId: BOOTSTRAP_MANDANT,
    assignedAt: "x",
    releasedAt: null,
  });
  zustand.platformNumberUse.find((zeile) => zeile.purpose === ALERT_ZWECK).releasedAt = "geschlossen";
  store.setTenantSubscription(BOOTSTRAP_MANDANT, { subscriptionId: ABO, cancelAtPeriodEnd: true });
  const vorher = offeneZeilen(store.load(), ALERT_ZWECK).length;
  const provisioner = fakeProvisioner();
  const eintraege = [];
  const handler = makeStripeWebhookRoute({
    numberProvisioner: provisioner,
    auditStore: { record: (eintrag) => { eintraege.push(eintrag); return Promise.resolve(); } },
    store,
    workos: null,
    billing: {},
    provision: async () => {},
    sessions: { invalidateByTenant: async () => {} },
    accounts: { setStatus: async () => {} },
    audit: () => {},
    config: withConfigNamespaces({ stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS, paymentEnabled: true }),
  });
  const anfrage = aboEnde();
  const antwort = { status: () => antwort, json: () => antwort };
  await handler({ headers: anfrage.headers, rawBody: Buffer.from(anfrage.body) }, antwort);
  return { nachher: store.load(), provisioner, eintraege, alertOffenVorher: vorher };
}

test("K2: nach dem Start haelt allein die abgeleitete Haltezeile die Bootstrap-Nummer bei der Kuendigung, Grund platform_number_in_use", async () => {
  const srv = await startServer({ seed: bootstrapSeed(BOOTSTRAP_NUMMER), ownerNumber: null });
  let gestartet;
  try {
    gestartet = srv.readStore();
  } finally {
    await srv.stop();
  }
  assert.equal(offeneHalte(gestartet).length, EINMAL);
  assert.equal(offeneZeilen(gestartet, ALERT_ZWECK).length, EINMAL);
  const { nachher, provisioner, eintraege, alertOffenVorher } = await kuendigeMitStartzeilen(gestartet);
  assert.equal(alertOffenVorher, KEINE);
  const mandant = nachher.tenants.find((eintrag) => eintrag.id === BOOTSTRAP_MANDANT);
  const nummer = nachher.numbers.find((eintrag) => eintrag.id === "num_halt");
  assert.deepEqual(provisioner.log, []);
  assert.equal(nummer.status, "active");
  assert.equal(mandant.numberReleasePending, true);
  assert.equal(eintraege.filter((eintrag) => GRUND_PLATTFORM.test(eintrag.detail)).length, EINMAL);
});
