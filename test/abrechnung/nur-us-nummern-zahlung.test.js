import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";
import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";

const WEBHOOK_PFAD = "/webhooks/stripe";
const KAUFLAND = "US";
const PLATTFORMLAND = "DE";
const MS_PER_S = 1000;
const NUMMERN_OBERGRENZE = 100;
const KUNDENLAENDER = [
  { land: "DE", sprache: "de" },
  { land: "FR", sprache: "fr" },
  { land: "CA", sprache: undefined },
  { land: undefined, sprache: undefined },
];
const SCHALTER_WERTE = ["", "US"];

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");

function zahlungsEreignis(tenantId) {
  return JSON.stringify({
    type: "customer.subscription.created",
    data: {
      object: { id: `sub_${tenantId}`, status: "active", metadata: { tenant_ref: tenantId, plan_slug: "starter" } },
    },
  });
}

async function zahlungSenden(hermes, tenantId) {
  const rumpf = zahlungsEreignis(tenantId);
  const zeit = Math.floor(Date.now() / MS_PER_S);
  const mac = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  return hermes.anfrage(WEBHOOK_PFAD, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: rumpf,
  });
}

async function kundeAnlegen(tenantId, land) {
  store.load().tenants.push({ id: tenantId, status: "suspended", firstName: "Kunde", ownerName: "Kunde Zahlung" });
  if (land) store.setTenantGeo(tenantId, { country: land });
  store.save();
  await store.drainFlushes();
}

function nummernVon(tenantId) {
  return store.load().numbers.filter((nummer) => nummer.tenantId === tenantId);
}

for (const { land, sprache } of KUNDENLAENDER) {
  for (const schalter of SCHALTER_WERTE) {
    test(`Zahlung: Kunde mit Land ${land ?? "(leer)"} und FORCE_NUMBER_COUNTRY "${schalter}" bekommt Nummer mit Land US, Sprache am Kundenland`, async () => {
      const hermes = laufendesHermes();
      Object.assign(config.billing, { paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS });
      Object.assign(config.provisioning, {
        provisioningEnabled: false,
        maxNumbers: NUMMERN_OBERGRENZE,
        maxNumbersPerTenant: NUMMERN_OBERGRENZE,
        provisioningCountry: PLATTFORMLAND,
        forceNumberCountry: schalter,
      });
      const tenantId = `t_zahlung_${land ?? "ohne"}_${schalter || "leer"}`;
      await kundeAnlegen(tenantId, land);

      const antwort = await zahlungSenden(hermes, tenantId);

      assert.equal(antwort.status, 200);
      const nummern = nummernVon(tenantId);
      assert.equal(nummern.length, 1, "genau ein Nummern-Datensatz");
      assert.equal(nummern[0].country, KAUFLAND);
      if (sprache) assert.equal(nummern[0].language, sprache);
    });
  }
}
