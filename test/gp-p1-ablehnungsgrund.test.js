// GP-P1 (PLAN-GELDPFAD.md, "Ablehnungsgrund des Holds: Diagnose UND Steuerung").
//
// Der Grund einer Stripe-Ablehnung wird EINMAL erhoben (src/billing/decline.js) und
// ZWEIMAL geliefert: als getyptes Feld err.providerDecline (Steuerung, GP-P4 liest es)
// und als Enum-Anhang an err.message (Menschendiagnose). Der Vorfall vom 11.09.2026: der
// 402-Koerper von createSubscription trug Name/E-Mail/Anschrift des Kunden und landete
// darueber in console.error (self-service-routes.js). Diese Phase behebt beides.
//
// Rein und offline (Muster test/pay-19-sca-authentication-required.test.js, makeStripeStub
// aus test/helpers.js; Abschnitt 1 Fall 8 zusaetzlich test/provisioning-enqueue-order.test.js
// fuer den In-Process-Orchestrator). Kein Spawn, kein Netz, kein Anbieter-Call.
//
// Testnamen tragen bewusst KEINEN Katalog-Praefix (i18nCatalogPattern kennt GAP, nicht GP;
// abnahmePattern verlangt ABNAHME-) - alle Faelle bleiben im Regressionslauf (Lehre
// catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { PaymentAuthenticationRequiredError } from "../src/billing/errors.js";
import { makeStripeStub } from "./helpers.js";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { makeProvisioningOrchestrator } from "../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../src/worker/provisioning.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantStripe,
  requestNumber,
  findNumber,
  recordProvisioningJob,
  markProvisioningJob,
} from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const withStripeStub = makeStripeStub(config, "sk_test_gpp1");

// ---------------------------------------------------------------------------------------
// Abschnitt 1: Verhalten (Abnahme 1-3)
// ---------------------------------------------------------------------------------------

const DECLINE_HTTP_STATUS = 402;
// Der Koerper aus dem Abnahmekriterium (PLAN-GELDPFAD.md, GP-P1).
const DECLINE_BODY = {
  error: {
    code: "card_declined",
    decline_code: "insufficient_funds",
    type: "card_error",
    message: "Your card was declined.",
  },
};
// Derselbe Koerper MIT Kundendaten, genau dort, wo Stripe sie am 11.09.2026 mitschickte.
const KUNDENMAIL = "kunde@example.invalid";
const DECLINE_BODY_MIT_PII = {
  error: {
    ...DECLINE_BODY.error,
    payment_method: {
      id: "pm_gpp1",
      type: "link",
      billing_details: {
        email: KUNDENMAIL,
        name: "Max Mustermann",
        address: { line1: "Musterstrasse 1", city: "Muenster" },
      },
    },
  },
};

function declineResponse(body) {
  return async () => ({
    ok: false,
    status: DECLINE_HTTP_STATUS,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

const HOLD_ARGS = {
  tenantRef: "t_gpp1",
  amountCents: 300,
  currency: "eur",
  customerId: "cus_gpp1",
  paymentMethodId: "pm_gpp1",
  idempotencyKey: "gpp1-hold",
};

const SUBSCRIPTION_ARGS = {
  tenantRef: "t_gpp1",
  customerId: "cus_gpp1",
  priceId: "price_gpp1",
  paymentMethodId: "pm_gpp1",
  idempotencyKey: "gpp1-sub",
};

async function placeHoldRejection(body) {
  return withStripeStub(declineResponse(body), async () => {
    try {
      await stripeBilling.placeHold(HOLD_ARGS);
      throw new Error("KEIN FEHLER - der abgelehnte Hold lief als Erfolg durch");
    } catch (err) {
      return err;
    }
  });
}

test("GP-P1: placeHold-402 traegt den Ablehnungsgrund als getyptes Feld", async () => {
  const err = await placeHoldRejection(DECLINE_BODY);
  // Pinnt den Feldnamen WOERTLICH - er ist der Vertrag, den GP-P4 liest.
  assert.deepEqual(err.providerDecline, {
    code: "card_declined",
    declineCode: "insufficient_funds",
    type: "card_error",
  });
});

test("GP-P1: die Meldung traegt HTTP 402 UND decline_code=insufficient_funds", async () => {
  const err = await placeHoldRejection(DECLINE_BODY);
  assert.match(err.message, /HTTP 402/);
  assert.match(err.message, /decline_code=insufficient_funds/);
});

test("GP-P1 Positiv-Kontrolle: Kundendaten aus dem Fehlerkoerper stehen weder in .message noch am Feld", async () => {
  const err = await placeHoldRejection(DECLINE_BODY_MIT_PII);
  assert.doesNotMatch(err.message, /example\.invalid|Mustermann|Musterstrasse/);
  const feldAlsText = JSON.stringify(err.providerDecline);
  assert.doesNotMatch(feldAlsText, /example\.invalid|Mustermann|Musterstrasse/);
  assert.deepEqual(err.providerDecline, {
    code: "card_declined",
    declineCode: "insufficient_funds",
    type: "card_error",
  });
});

test("GP-P1: Freitext in error.code faellt auf null, statt in die Meldung zu wandern", async () => {
  const body = {
    error: { ...DECLINE_BODY.error, code: `Declined for ${KUNDENMAIL}` },
  };
  const err = await placeHoldRejection(body);
  assert.equal(err.providerDecline.code, null);
  assert.doesNotMatch(err.message, /example\.invalid/);
});

test("GP-P1: leerer/unparsbarer Fehlerkoerper -> Meldung byte-identisch zum Bestand", async () => {
  const err = await withStripeStub(
    async () => ({
      ok: false,
      status: DECLINE_HTTP_STATUS,
      json: async () => {
        throw new Error("kein JSON");
      },
      text: async () => "",
    }),
    async () => {
      try {
        await stripeBilling.placeHold(HOLD_ARGS);
        throw new Error("KEIN FEHLER");
      } catch (err2) {
        return err2;
      }
    },
  );
  assert.equal(err.message, "Stripe placeHold fehlgeschlagen: HTTP 402");
  assert.deepEqual(err.providerDecline, { code: null, declineCode: null, type: null });
});

test("GP-P1: der 3-D-Secure-Fall behaelt seinen Fehlertyp UND bekommt das Feld", async () => {
  const body = {
    error: {
      type: "card_error",
      code: "authentication_required",
      decline_code: "authentication_required",
      message: "Your card was declined. This transaction requires authentication.",
      payment_intent: { status: "requires_payment_method" },
    },
  };
  const err = await placeHoldRejection(body);
  assert.ok(err instanceof PaymentAuthenticationRequiredError);
  assert.equal(err.providerDecline.code, "authentication_required");
});

test("GP-P1 (Frage 6): createSubscription-402 protokolliert keine Kundendaten mehr", async () => {
  const err = await withStripeStub(declineResponse(DECLINE_BODY_MIT_PII), async () => {
    try {
      await stripeBilling.createSubscription(SUBSCRIPTION_ARGS);
      throw new Error("KEIN FEHLER");
    } catch (err2) {
      return err2;
    }
  });
  assert.match(err.message, /HTTP 402/);
  assert.match(err.message, /decline_code=insufficient_funds/);
  assert.doesNotMatch(err.message, /example\.invalid|Mustermann|Musterstrasse/);
  assert.doesNotMatch(err.message, /"billing_details"/);
});

// --- Fall 8 (Frage 8): der Enum-Anhang landet in job.lastError ---------------------------

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };

function meteringStub() {
  return { recordNumberMonthMeter() {}, recordDueNumberMonthMeters: () => ({}) };
}

// Fake-Store nach dem Muster test/provisioning-enqueue-order.test.js: load() liefert den
// geteilten State, save()/withStoreLock() sind No-op-Transaktionen (kein echter Rollback-
// Test hier - das deckt PA-2, nicht GP-P1).
function makeFakeStore(state) {
  return {
    load: () => state,
    save() {},
    async withStoreLock(fn) {
      return fn();
    },
  };
}

function fakeProvisioner() {
  return {
    async searchNumbers() {
      return [{ e164: "+4915799990000" }];
    },
    async orderNumber() {
      throw new Error("GP-P1: darf nie erreicht werden - der Hold muss vorher scheitern");
    },
  };
}

test("GP-P1 (Frage 8): der Enum-Anhang landet in job.lastError", async () => {
  const state = makeDefaultState();
  registerTenant(state, "t_gpp1_8");
  setTenantStripe(state, "t_gpp1_8", { customerId: "cus_gpp1_8", paymentMethodId: "pm_gpp1_8" });
  const number = requestNumber(state, { tenantId: "t_gpp1_8", country: "DE", ...CAPS }).number;

  const store = makeFakeStore(state);
  const queue = makeMemoryQueue();
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({
      paymentEnabled: true,
      numberSetupFeeCents: 92,
      paymentCurrency: "eur",
      provisioningEnabled: false,
    }),
    queue,
    billing: stripeBilling,
    metering: meteringStub(),
    numberProvisioning: () => fakeProvisioner(),
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });

  await withStripeStub(declineResponse(DECLINE_BODY_MIT_PII), async () => {
    const enqueued = await orchestrator.queueProvisioning(number.id, "t_gpp1_8");
    assert.equal(enqueued.ok, true, "Job-Spur persistiert");
    await orchestrator.runProvisioningDrainExclusive();
  });

  const job = state.provisioningJobs.find((j) => j.numberId === number.id);
  assert.equal(job.status, "failed");
  assert.match(job.lastError, /decline_code=insufficient_funds/);
  assert.doesNotMatch(job.lastError, /example\.invalid|Mustermann/);
});

// ---------------------------------------------------------------------------------------
// Abschnitt 2: Struktur-Waechter (Abnahme 4)
// ---------------------------------------------------------------------------------------
// Muster test/sec-p6-waechter-wahlaufrufer.test.js: Datei + Symbol statt Zeilennummern (C2).
//
// KORREKTUR GEGENUEBER SEC-P6 (nicht dort angefasst, s. PLAN-GELDPFAD.md Abschnitt 7.1):
// dort werden Blockkommentare VOR Zeilenkommentaren gestrippt. Ein Zeilenkommentar, der
// "/*" enthaelt (im Bestand: src/elevenlabs/outbound.js, "src/telephony/adapters/*"),
// frisst damit den Code bis zum naechsten "*/" - hier faelschlich verschluckt. Deshalb
// zuerst Zeilenkommentare, dann Blockkommentare (Fall 12 pinnt das).

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUELLVERZEICHNIS = "src";

const ohneKommentare = (quelltext) =>
  quelltext.replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

function produktionsDateien(verzeichnis = QUELLVERZEICHNIS) {
  const dateien = [];
  for (const eintrag of fs.readdirSync(path.join(REPO_ROOT, verzeichnis), {
    withFileTypes: true,
  })) {
    const relativ = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) dateien.push(...produktionsDateien(relativ));
    else if (eintrag.name.endsWith(".js"))
      dateien.push({
        pfad: relativ,
        quelltext: fs.readFileSync(path.join(REPO_ROOT, relativ), "utf8"),
      });
  }
  return dateien;
}

// Reichweite, benannt statt behauptet: gefunden werden Bezeichner, die 'message'/'msg'
// enthalten, sowie String(err)/err.toString() - jeweils gefolgt von includes/match/
// indexOf/search/startsWith/endsWith, auch ueber eine parameterlose Kette wie
// .toLowerCase(). NICHT gefunden: ein einbuchstabiger Fehler-Bezeichner (e.toString())
// und jede Auswertung ueber eine Hilfsfunktion. Ein Waechter, der seine Luecke nicht
// nennt, verspricht mehr als er haelt.
const LESER = "(?:includes|match|indexOf|search|startsWith|endsWith)";
const MESSAGE_STEUERUNG = new RegExp(
  `\\b[\\w$]*(?:[Mm]essage|[Mm]sg)\\s*(?:\\.\\s*\\w+\\s*\\(\\s*\\))*\\s*\\.\\s*${LESER}\\s*\\(` +
    `|(?:String\\s*\\(\\s*[\\w$.]*[Ee]rr[\\w$]*\\s*\\)|[\\w$.]*[Ee]rr[\\w$]*\\s*\\.\\s*toString\\s*\\(\\s*\\))` +
    `\\s*(?:\\.\\s*\\w+\\s*\\(\\s*\\))*\\s*\\.\\s*${LESER}\\s*\\(`,
);
// Kein /g: ein zustandsbehaftetes RegExp liefert bei wiederholtem .test() abwechselnd
// true/false (lastIndex) - genau die stille Luecke, die ein Waechter nicht haben darf.

const ERWARTETE_STELLEN = Object.freeze([
  {
    pfad: "src/elevenlabs/outbound.js",
    grund: "zeile.message ist eine TRANSKRIPTZEILE, kein Fehlerobjekt (reportAudioTags meldet nur)",
  },
  {
    pfad: "src/llm/adapters/anthropic.js",
    grund:
      "isBillingError liest die LLM-Anbieter-Marke fuer 'Guthaben leer' - LLM-Seam, nicht der Geldpfad",
  },
]);

// EINE Sammelfunktion fuer Waechter und Positiv-Kontrolle (G5).
function sammleTreffer(dateien) {
  return dateien
    .filter(({ quelltext }) => MESSAGE_STEUERUNG.test(ohneKommentare(quelltext)))
    .map(({ pfad }) => pfad)
    .sort();
}

test("GP-P1 Waechter: keine Steuerung ueber .message ausser den benannten Ausnahmen", () => {
  const dateien = produktionsDateien();
  assert.ok(dateien.length > 0, "kein Quelltext eingelesen - der Waechter sucht nichts");
  assert.deepEqual(sammleTreffer(dateien), ERWARTETE_STELLEN.map((stelle) => stelle.pfad).sort());
});

test("GP-P1 Waechter Positiv-Kontrolle: ein synthetischer Zusatz macht rot", () => {
  const dateien = produktionsDateien();
  // Kein Schreibzugriff auf src/: die erfundene Datei existiert nur in dieser Liste.
  const mitZusatz = [
    ...dateien,
    {
      pfad: "src/synthetisch-gpp1.js",
      quelltext: 'if (err.message.includes("insufficient_funds")) { doSomething(); }',
    },
  ];
  assert.notDeepEqual(
    sammleTreffer(mitZusatz),
    ERWARTETE_STELLEN.map((stelle) => stelle.pfad).sort(),
  );
});

test("GP-P1 Waechter: eine Erwaehnung im Kommentar gilt nicht als Steuerung", () => {
  const quelltext = `
// so ruft man es NICHT: err.message.includes("insufficient_funds")
/* und auch hier nicht: err.message.match(/x/) */
export const nichts = 1;
`;
  assert.deepEqual(sammleTreffer([{ pfad: "src/nur-prosa-gpp1.js", quelltext }]), []);
});

test("GP-P1 Waechter: ein Zeilenkommentar mit /* verschluckt den Code dahinter nicht", () => {
  const quelltext = `
// siehe adapters/*
if (err.message.includes("x")) { doSomething(); }
`;
  assert.deepEqual(sammleTreffer([{ pfad: "src/gpp1-slash-star.js", quelltext }]), [
    "src/gpp1-slash-star.js",
  ]);
});
