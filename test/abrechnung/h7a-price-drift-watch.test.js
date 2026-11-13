import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beurteilePreis,
  priceDriftBucket,
  PREIS_URTEIL,
  runPriceDriftSweep,
} from "../../src/billing/price-drift-watch.ts";

const PLAN = { slug: "starter", amountCents: 499, currency: "eur" };
const UNLESBAR = "slug=starter anbieter=unlesbar";

const FAELLE = [
  ["gleicher Preis", { unitAmountCents: 499, currency: "eur" }, PREIS_URTEIL.OK, "slug=starter katalog=499eur anbieter=499eur"],
  ["Währung in Großbuchstaben", { unitAmountCents: 499, currency: "EUR" }, PREIS_URTEIL.OK, "slug=starter katalog=499eur anbieter=499EUR"],
  ["anderer Betrag", { unitAmountCents: 599, currency: "eur" }, PREIS_URTEIL.ABWEICHUNG, "slug=starter katalog=499eur anbieter=599eur"],
  ["andere Währung", { unitAmountCents: 499, currency: "usd" }, PREIS_URTEIL.ABWEICHUNG, "slug=starter katalog=499eur anbieter=499usd"],
  ["keine Messung", null, PREIS_URTEIL.UNBEKANNT, UNLESBAR],
  ["Betrag keine ganze Zahl", { unitAmountCents: 4.5, currency: "eur" }, PREIS_URTEIL.UNBEKANNT, UNLESBAR],
  ["Währung keine Zeichenkette", { unitAmountCents: 499, currency: 1 }, PREIS_URTEIL.UNBEKANNT, UNLESBAR],
];

for (const [name, messung, urteil, detail] of FAELLE) {
  test(`h7a Preisurteil: ${name}`, () => {
    assert.deepEqual(beurteilePreis(PLAN, messung), { urteil, detail });
  });
}

test("h7a Preisbefund-Bucket trägt den Tarif-Slug", () => {
  assert.equal(priceDriftBucket("business"), "price-drift:business");
});

test("h7a Abruffehler eines Tarifs wird mit Fehlertext geloggt, auch ohne Error-Objekt", async () => {
  const zeilen = [];
  const original = console.warn;
  console.warn = (zeile) => zeilen.push(zeile);
  const state = { outageAlerts: [], calls: [], platformNumberUse: [] };
  const store = { load: () => state, save: () => {}, withStoreLock: (fn) => fn() };
  const config = {
    billing: {
      paymentEnabled: true,
      priceDriftMinIntervalMs: 1000,
      priceDriftUnknownEscalateAfter: 0,
      stripeStarterPriceId: "price_a",
      stripeBusinessPriceId: "price_b",
    },
  };
  let aufruf = 0;
  const lesePreis = async () => {
    aufruf += 1;
    if (aufruf === 1) throw new Error("Stripe nicht erreichbar");
    throw "kaputt";
  };
  try {
    await runPriceDriftSweep({ store, config, audit: () => {}, messaging: null, mailer: null, lesePreis, anlass: "test", nowMs: 1_000_000 });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(zeilen, [
    "[price-drift] Abruf fehlgeschlagen slug=starter: Stripe nicht erreichbar",
    "[price-drift] Abruf fehlgeschlagen slug=business: kaputt",
  ]);
});
