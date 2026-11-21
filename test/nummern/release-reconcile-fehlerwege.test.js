import assert from "node:assert/strict";
import { test, mock } from "node:test";
import express from "express";

import { makePgTestStore } from "../pg-helpers.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

const TENANT = "t_freigabe_fehler";
const ALT_ID = `num_${TENANT}`;
const ALT_ANBIETER_ID = `pnum_alt_${TENANT}`;
const ALT_E164 = "+4915799990010";
const NEU_E164 = "+12025550300";
const GROSSE_DECKE = 50;
const NOT_FOUND = 404;
const SUSPENDIERT_SEIT = new Date("2026-01-01").toISOString();
const GRACE_TAGE = 14;
const TAG_MS = 24 * 60 * 60 * 1000;
const NUMMER_AKTIV = "active";

const konfiguration = () =>
  withConfigNamespaces({ provisioningEnabled: true, maxNumbers: GROSSE_DECKE, maxNumbersPerTenant: 1, paymentEnabled: true });

function attrappe(beiFreigabe) {
  return {
    async searchNumbers() {
      return [{ e164: NEU_E164 }];
    },
    async orderNumber({ e164 }) {
      return { e164, providerNumberId: "pnum_neu" };
    },
    releaseNumber: beiFreigabe,
  };
}

const registrierer = () => ({
  ensureRegistration: async ({ numberId }) => ({ phoneNumberId: `phnum_${numberId}`, angelegt: true }),
  removeRegistration: async () => {},
});

const auditSenke = () => {
  const eintraege = [];
  return {
    eintraege,
    async record(eintrag) {
      eintraege.push(eintrag);
    },
  };
};

const logSenke = () => {
  const warns = [];
  const logs = [];
  return {
    warns,
    logs,
    logger: { log: (text) => logs.push(text), warn: (text) => warns.push(text), error() {} },
  };
};

async function mandantMitAlterNummer() {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: TENANT, status: "active" });
  state.numbers.push({
    id: ALT_ID,
    tenantId: TENANT,
    e164: ALT_E164,
    provider: "telnyx",
    status: NUMMER_AKTIV,
    providerNumberId: ALT_ANBIETER_ID,
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  return { store, state };
}

async function tausche({ store }, beiFreigabe) {
  const audit = auditSenke();
  const protokoll = logSenke();
  const [eintrag] = await runNummerntausch({
    store,
    config: konfiguration(),
    numberProvisioning: () => attrappe(beiFreigabe),
    sipRegistrar: registrierer(),
    inboundTrunkSchreiber: null,
    audit,
    logger: protokoll.logger,
  });
  return { ergebnis: eintrag.ergebnis, audit, protokoll };
}

const alteNummer = (state) => state.numbers.find((nummer) => nummer.id === ALT_ID);

test("Provider wirft einen String: freigabe_fehlgeschlagen, Audit provider_error, der Log nennt den String", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit, protokoll } = await tausche(welt, async () => {
    throw "netzwerk-weg";
  });
  assert.equal(ergebnis, "freigabe_fehlgeschlagen");
  assert.deepEqual(audit.eintraege.map((e) => e.detail), [`number=${ALT_ID} grund=provider_error`]);
  assert.ok(protokoll.warns.some((w) => w.includes(`number=${ALT_ID}`) && w.includes("netzwerk-weg")));
  assert.equal(alteNummer(welt.state).status, NUMMER_AKTIV);
});

test("Provider wirft null: freigabe_fehlgeschlagen ohne Absturz, Audit provider_error", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit } = await tausche(welt, async () => {
    throw null;
  });
  assert.equal(ergebnis, "freigabe_fehlgeschlagen");
  assert.deepEqual(audit.eintraege.map((e) => e.detail), [`number=${ALT_ID} grund=provider_error`]);
  assert.equal(alteNummer(welt.state).status, NUMMER_AKTIV);
});

test("Provider wirft ein Error mit Status 500: freigabe_fehlgeschlagen, der Log nennt die Meldung", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, protokoll } = await tausche(welt, async () => {
    throw Object.assign(new Error("HTTP 500 kaputt"), { providerStatus: 500 });
  });
  assert.equal(ergebnis, "freigabe_fehlgeschlagen");
  assert.ok(protokoll.warns.some((w) => w.includes(`number=${ALT_ID}`) && w.includes("HTTP 500 kaputt")));
});

test("Provider wirft ein Nicht-Error-Objekt mit providerStatus 404: bereits weg, die Freigabe wird ausgefuehrt", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit, protokoll } = await tausche(welt, async () => {
    throw { providerStatus: NOT_FOUND };
  });
  assert.equal(ergebnis, "getauscht");
  assert.equal(alteNummer(welt.state).status, "released");
  assert.ok(protokoll.warns.some((w) => w.includes("bereits weg") && w.includes(`number=${ALT_ID}`)));
  assert.deepEqual(audit.eintraege.map((e) => e.action), ["did_released"]);
});

test("Provider wirft ein Nicht-Error-Objekt mit anderem providerStatus: freigabe_fehlgeschlagen", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit } = await tausche(welt, async () => {
    throw { providerStatus: 503 };
  });
  assert.equal(ergebnis, "freigabe_fehlgeschlagen");
  assert.deepEqual(audit.eintraege.map((e) => e.detail), [`number=${ALT_ID} grund=provider_error`]);
});

test("Store-Mutation wirft einen Nicht-Error-Wert: Audit store_mutation_nach_delete, der Log nennt den Wert", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit, protokoll } = await tausche(welt, async () => {
    welt.store.save = () => {
      throw "platte-voll";
    };
  });
  assert.equal(ergebnis, "freigabe_fehlgeschlagen");
  assert.deepEqual(audit.eintraege.map((e) => e.detail), [`number=${ALT_ID} grund=store_mutation_nach_delete`]);
  assert.ok(protokoll.warns.some((w) => w.includes("NACH provider-delete") && w.includes("platte-voll")));
});

test("Store-Mutation wirft ein Error: der Log nennt dessen Meldung", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, protokoll } = await tausche(welt, async () => {
    welt.store.save = () => {
      throw new Error("sperre-verloren");
    };
  });
  assert.equal(ergebnis, "freigabe_fehlgeschlagen");
  assert.ok(protokoll.warns.some((w) => w.includes("NACH provider-delete") && w.includes("sperre-verloren")));
});

test("Nummer verschwindet zwischen Provider-Delete und Store-Mutation: getauscht ohne Warnung", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit, protokoll } = await tausche(welt, async () => {
    welt.state.numbers.splice(welt.state.numbers.findIndex((nummer) => nummer.id === ALT_ID), 1);
  });
  assert.equal(ergebnis, "getauscht");
  assert.deepEqual(audit.eintraege.map((e) => e.action), ["did_released"]);
  assert.deepEqual(protokoll.warns, []);
});

test("Nummer ist zwischen Provider-Delete und Store-Mutation nicht mehr aktiv: Status bleibt, getauscht", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit } = await tausche(welt, async () => {
    alteNummer(welt.state).status = "suspended";
  });
  assert.equal(ergebnis, "getauscht");
  assert.equal(alteNummer(welt.state).status, "suspended");
  assert.deepEqual(audit.eintraege.map((e) => e.action), ["did_released"]);
});

test("Erfolgreiche Freigabe: Audit-detail nennt Nummer-ID und Provider-ID, der Log Nummer und Mandant", async () => {
  const welt = await mandantMitAlterNummer();
  const { ergebnis, audit, protokoll } = await tausche(welt, async () => {});
  assert.equal(ergebnis, "getauscht");
  assert.equal(audit.eintraege[0].detail, `number=${ALT_ID} provider=${ALT_ANBIETER_ID}`);
  assert.ok(protokoll.logs.some((l) => l.includes(`number=${ALT_ID}`) && l.includes(`tenant=${TENANT}`)));
});

async function sweepWarnungen(graceMs, nummern) {
  const { store, runner } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({
    id: TENANT,
    status: "suspended",
    suspendedAt: SUSPENDIERT_SEIT,
  });
  state.numbers.push(...nummern);
  const plaene = [];
  const warnungen = [];
  const stumm = [
    mock.method(console, "log", () => {}),
    mock.method(console, "error", () => {}),
    mock.method(console, "warn", (...args) => warnungen.push(args.join(" "))),
  ];
  try {
    const konfig = webLoginBasisKonfiguration("https://api.workos.test");
    const { zeitplaeneAnmelden } = await wireWebLogin({
      app: express(),
      config: { ...konfig, provisioning: { releaseGraceMs: graceMs } },
      store,
      audit: () => {},
      provision: async () => ({}),
      zeitplan: { plane: async (name, intervallMs, lauf) => plaene.push({ name, lauf }) },
      createPortalRunner: () => runner,
      stripeWebhookPath: "/webhooks/stripe",
      appPath: "/app",
    });
    await zeitplaeneAnmelden();
    warnungen.length = 0;
    await plaene.find((p) => p.name === "did-release").lauf.lauf();
  } finally {
    for (const m of stumm) m.mock.restore();
  }
  return warnungen;
}

const nummer = (id, over = {}) => ({
  id,
  tenantId: TENANT,
  e164: `+49157999900${id.slice(-2)}`,
  provider: "telnyx",
  status: NUMMER_AKTIV,
  providerNumberId: `ext_${id}`,
  country: "DE",
  language: "de",
  paymentIntentId: null,
  ...over,
});

test("HOLD-Log des Sweeps nennt Nummer-ID und Grund", async () => {
  const warnungen = await sweepWarnungen(GRACE_TAGE * TAG_MS, [nummer("n_21", { provider: "altanbieter" })]);
  assert.equal(warnungen.length, 1);
  assert.ok(warnungen[0].includes("HOLD number=n_21 grund="));
  assert.ok(warnungen[0].includes("non_telnyx"));
});

test("OBSERVE-ONLY-Log (graceMs 0) nennt Anzahl und Nummer-IDs der Kandidaten", async () => {
  const warnungen = await sweepWarnungen(0, [nummer("n_31"), nummer("n_32")]);
  assert.equal(warnungen.length, 1);
  assert.ok(warnungen[0].includes("OBSERVE-ONLY"));
  assert.ok(warnungen[0].includes("2 Kandidat(en)"));
  assert.ok(warnungen[0].includes("n_31,n_32"));
});
