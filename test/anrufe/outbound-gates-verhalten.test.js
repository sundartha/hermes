import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, mcpPost, toolCall, readToolResult } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const MIN_MS = 60_000;
const STUNDE_MS = 3_600_000;
const TAG_MS = 86_400_000;
const E164_FEHLER = "'to' must be E.164, e.g. +4917212345678";
const ZIEL = "+4915112345678";
const AT_ZIEL = "+436601234567";
const SPEND_MONAT_ENDE = /Aktueller Spend-Monat endet am \d{4}-\d{2}-\d{2}\.$/;

const TEXTE = {
  kyc: "Verifikation unzureichend (KYC) fuer Outbound-Anrufe. Bitte Identitaet bestaetigen.",
  abo: "Abo inaktiv (Tenant gesperrt). Outbound-Anrufe sind gesperrt.",
  halt: "Outbound gesperrt: Zahlungsproblem. Bitte Zahlungsmittel/Betreiber pruefen.",
  stunde: "Stundenlimit fuer Outbound-Anrufe erreicht. Bitte spaeter erneut.",
  ziel: "Wiederhol-Limit fuer dieses Ziel erreicht. Bitte spaeter erneut.",
};

const TARIFE = { VOICE_TARIFF_DOMESTIC_CENTS: "20", VOICE_TARIFF_DEFAULT_CENTS: "30" };
const ZAHLUNG_ENV = {
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: "http://127.0.0.1:9",
  NUMBER_SETUP_FEE_CENTS: "500",
  STRIPE_STARTER_PRICE_ID: "price_test_starter",
  STRIPE_BUSINESS_PRICE_ID: "price_test_business",
};

const BASIS_ENV = {
  MULTI_TENANT: "true",
  FAKE_ORIGINATE: "true",
  ALLOWED_COUNTRY_CODES: "*",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  PRECALL_BRIEFING_ENABLED: "false",
  ASSISTANT_CONTEXT_ENABLED: "false",
};

const mandant = (name, extra = {}) => ({
  id: `t-${name}`,
  status: "active",
  idpSubject: `sub-${name}`,
  ownerName: `Inhaber ${name}`,
  kycLevel: "card",
  defaultLanguage: "de",
  ...extra,
});

const nummer = (name, e164) => ({
  id: `num-${name}`,
  e164,
  tenantId: `t-${name}`,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
});

function aufbau(zeilen, { calls = [], budgets = [], profile = {} } = {}) {
  const tenants = [{ id: BOOTSTRAP_TENANT_ID, status: "active" }];
  const numbers = [];
  const profiles = {};
  for (const { name, nr = "+4930111222333", ...rest } of zeilen) {
    tenants.push(mandant(name, rest.tenant));
    if (nr) numbers.push(nummer(name, nr));
    profiles[`t-${name}`] = { maxCallsPerHour: null, ...profile[name] };
  }
  const seed = seedState({ tenants, numbers, profiles, calls });
  return { ...seed, tenantBudgets: budgets };
}

async function mitServer({ env = {}, seed }, lauf) {
  const srv = await startServer({ env: { ...BASIS_ENV, ...env }, seed });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

async function rufe(srv, name, koerper = {}) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(name === null ? {} : { "X-Internal-Identity": `sub-${name}` }),
    },
    body: JSON.stringify({ to: ZIEL, objective: "Termin", ...koerper }),
  });
  return { status: res.status, body: await res.json() };
}

const anrufeVon = (srv, name) => srv.readStore().calls.filter((call) => call.tenantId === `t-${name}`);

function abgelehnt(antwort, [status, grund], text) {
  assert.equal(antwort.status, status, JSON.stringify(antwort.body));
  assert.equal(antwort.body.reason, grund);
  if (text instanceof RegExp) assert.match(antwort.body.error, text);
  else assert.equal(antwort.body.error, text);
}

test("3395-R4: Mandanten-Sperren - KYC, Abo, Zahlungsstopp, Name, Nummer, unbekannte Identitaet", async () => {
  const jetzt = Date.now();
  const zeilen = [
    { name: "ok" },
    { name: "otp", tenant: { kycLevel: "otp" } },
    { name: "none", tenant: { kycLevel: "none" } },
    { name: "ohnekyc", tenant: { kycLevel: undefined } },
    { name: "gesperrt", tenant: { status: "suspended" } },
    { name: "halt", tenant: { billingHold: "payment_failed" } },
    { name: "haltvorbei", tenant: { billingHold: "payment_failed", billingHoldDueAt: new Date(jetzt - MIN_MS).toISOString() } },
    { name: "haltspaeter", tenant: { billingHold: "payment_failed", billingHoldDueAt: new Date(jetzt + STUNDE_MS).toISOString() } },
    { name: "ohnename", tenant: { ownerName: "" } },
    { name: "ohnenummer", nr: null },
  ];
  await mitServer({ seed: aufbau(zeilen) }, async (srv) => {
    abgelehnt(await rufe(srv, "otp"), [HTTP_FORBIDDEN, "kyc"], TEXTE.kyc);
    abgelehnt(await rufe(srv, "none"), [HTTP_FORBIDDEN, "kyc"], TEXTE.kyc);
    abgelehnt(await rufe(srv, "ohnekyc"), [HTTP_FORBIDDEN, "kyc"], TEXTE.kyc);
    abgelehnt(await rufe(srv, "gesperrt"), [HTTP_FORBIDDEN, "abo"], TEXTE.abo);
    abgelehnt(await rufe(srv, "halt"), [HTTP_FORBIDDEN, "billing_hold"], TEXTE.halt);
    abgelehnt(await rufe(srv, "haltvorbei"), [HTTP_FORBIDDEN, "billing_hold"], TEXTE.halt);
    abgelehnt(await rufe(srv, "ohnename"), [HTTP_FORBIDDEN, "keine_identitaet"], "Kein registrierter Auftraggeber-Name fuer diesen Tenant.",
    );
    abgelehnt(await rufe(srv, "ohnenummer"), [HTTP_FORBIDDEN, "keine_tenant_nummer"], "Kein aktive Absendernummer fuer diesen Tenant.",
    );
    abgelehnt(await rufe(srv, "unbekannt"), [HTTP_FORBIDDEN, "tenant_unbekannt"], "Kein Tenant fuer diese Identitaet.",
    );
    for (const name of ["otp", "none", "ohnekyc", "gesperrt", "halt", "haltvorbei", "ohnename", "ohnenummer"])
      assert.deepEqual(anrufeVon(srv, name), [], `${name}: kein Call-Datensatz`);

    for (const name of ["ok", "haltspaeter"]) {
      const antwort = await rufe(srv, name);
      assert.equal(antwort.status, HTTP_OK, `${name}: ${JSON.stringify(antwort.body)}`);
      assert.equal(anrufeVon(srv, name).length, 1);
    }
  });
});

test("3395-R4: Stundenlimit - Profil, globales Limit und Fenstergrenze", async () => {
  const jetzt = Date.now();
  const vor = (ms) => new Date(jetzt - ms).toISOString();
  const alterAnruf = (name, ms) =>
    seedCall({ id: `alt_${name}`, tenantId: `t-${name}`, status: "ended", to: "+4915199990000", startedAt: vor(ms) });
  const zeilen = [
    { name: "keinprofil" },
    { name: "eins" },
    { name: "fuenf" },
    { name: "vorbei" },
    { name: "knapp" },
  ];
  const seed = aufbau(zeilen, {
    profile: { eins: { maxCallsPerHour: 1 }, fuenf: { maxCallsPerHour: 5 }, vorbei: { maxCallsPerHour: 1 }, knapp: { maxCallsPerHour: 1 } },
    calls: [alterAnruf("vorbei", STUNDE_MS + MIN_MS), alterAnruf("knapp", STUNDE_MS - MIN_MS)],
  });
  delete seed.profiles["t-keinprofil"];
  await mitServer({ seed, env: { MAX_CALLS_PER_HOUR: "2" } }, async (srv) => {
    abgelehnt(await rufe(srv, "keinprofil"), [HTTP_TOO_MANY, "stundenlimit"], TEXTE.stunde);
    assert.equal((await rufe(srv, "eins", { to: "+4915112340001" })).status, HTTP_OK);
    abgelehnt(await rufe(srv, "eins", { to: "+4915112340002" }), [HTTP_TOO_MANY, "stundenlimit"], TEXTE.stunde);

    assert.equal((await rufe(srv, "fuenf", { to: "+4915112340001" })).status, HTTP_OK);
    assert.equal((await rufe(srv, "fuenf", { to: "+4915112340002" })).status, HTTP_OK);
    abgelehnt(await rufe(srv, "fuenf", { to: "+4915112340003" }), [HTTP_TOO_MANY, "stundenlimit"], TEXTE.stunde);

    assert.equal((await rufe(srv, "vorbei")).status, HTTP_OK);
    abgelehnt(await rufe(srv, "knapp"), [HTTP_TOO_MANY, "stundenlimit"], TEXTE.stunde);
  });
});

test("3395-R4: Wiederhol-Limit je Ziel - Obergrenze und Fenstergrenze", async () => {
  const jetzt = Date.now();
  const frueher = (name, ms) =>
    seedCall({ id: `alt_${name}`, tenantId: `t-${name}`, status: "ended", to: ZIEL, startedAt: new Date(jetzt - ms).toISOString() });
  const zeilen = [{ name: "innen" }, { name: "aussen" }, { name: "andere" }];
  const seed = aufbau(zeilen, {
    calls: [frueher("innen", TAG_MS - STUNDE_MS), frueher("aussen", TAG_MS + STUNDE_MS), frueher("andere", MIN_MS)],
  });
  seed.calls[2].to = "+4915199990000";
  await mitServer({ seed, env: { PER_TARGET_CALL_CAP: "1" } }, async (srv) => {
    abgelehnt(await rufe(srv, "innen"), [HTTP_TOO_MANY, "ziel_limit"], TEXTE.ziel);
    assert.equal((await rufe(srv, "aussen")).status, HTTP_OK);
    assert.equal((await rufe(srv, "andere")).status, HTTP_OK);
    abgelehnt(await rufe(srv, "andere"), [HTTP_TOO_MANY, "ziel_limit"], TEXTE.ziel);
  });
});

test("3395-R4: Laenderfreigabe - Profil und globale Liste muessen beide passen", async () => {
  const zeilen = [{ name: "at" }, { name: "frei" }];
  const seed = aufbau(zeilen, { profile: { at: { allowedCountryCodes: ["+43"] } } });
  await mitServer({ seed, env: { ALLOWED_COUNTRY_CODES: "+43,+49" } }, async (srv) => {
    abgelehnt(await rufe(srv, "at"), [HTTP_FORBIDDEN, "land"], `Laendervorwahl von ${ZIEL} ist nicht erlaubt. Anruf verweigert.`,
    );
    assert.equal((await rufe(srv, "at", { to: AT_ZIEL })).status, HTTP_OK);
    assert.equal((await rufe(srv, "frei")).status, HTTP_OK);
    assert.equal((await rufe(srv, "frei", { to: AT_ZIEL })).status, HTTP_OK);
    abgelehnt(await rufe(srv, "frei", { to: "+33612345678" }), [HTTP_FORBIDDEN, "land"], "Laendervorwahl von +33612345678 ist nicht erlaubt. Anruf verweigert.",
    );
  });
});

test("3395-R4: Zielnummer - Gesperrte Bereiche vor Format, Laengengrenzen der E.164-Nummer", async () => {
  await mitServer({ seed: aufbau([{ name: "a" }]) }, async (srv) => {
    abgelehnt(await rufe(srv, "a", { to: "+4918012345678" }), [HTTP_FORBIDDEN, "denylist"], "Nummer +4918012345678 ist gesperrt (Notruf-/Premium-/Service-Nummer). Anruf verweigert.",
    );
    for (const zu of ["+431234", "+4312345678901234"]) {
      const antwort = await rufe(srv, "a", { to: zu });
      assert.equal(antwort.status, HTTP_BAD_REQUEST, zu);
      assert.deepEqual(antwort.body, { error: E164_FEHLER }, zu);
    }
    for (const zu of ["+431234567", "+431234567890123"]) {
      const antwort = await rufe(srv, "a", { to: zu });
      assert.equal(antwort.status, HTTP_OK, `${zu}: ${JSON.stringify(antwort.body)}`);
    }
    assert.equal(anrufeVon(srv, "a").length, 2);
  });
});

test("3395-R4: Herkunft - die Absendernummer muss im Zielland des Mandanten zugelassen sein", async () => {
  const zeilen = [
    { name: "heimisch", nr: "+4930111222333", tenant: { country: "DE" } },
    { name: "fremd", nr: "+436601234567", tenant: { country: "DE" } },
    { name: "auslandsziel", nr: "+436601234568", tenant: { country: "DE" } },
    { name: "plattform", nr: "+15005550006", tenant: { country: "DE" } },
    { name: "ohneland", nr: "+436601234569" },
  ];
  await mitServer({ seed: aufbau(zeilen) }, async (srv) => {
    assert.equal((await rufe(srv, "heimisch")).status, HTTP_OK);
    abgelehnt(await rufe(srv, "fremd"), [HTTP_FORBIDDEN, "herkunft"], "Outbound blocked: the active number of this tenant is not registered in the destination country.",
    );
    assert.deepEqual(anrufeVon(srv, "fremd"), []);
    assert.equal((await rufe(srv, "auslandsziel", { to: AT_ZIEL })).status, HTTP_OK);
    assert.equal((await rufe(srv, "plattform")).status, HTTP_OK);
    assert.equal((await rufe(srv, "ohneland")).status, HTTP_OK);
  });
});

test("3395-R4: Tarif, Reserve und Hoechstdauer - Inlandstarif nur bei gleicher Vorwahl, Dauer nie ueber der Notbremse", async () => {
  const faelle = [
    { name: "inland", nr: "+4930111222333", to: ZIEL, reserve: 40, dauer: 360 },
    { name: "ausland", nr: "+4930111222333", to: AT_ZIEL, reserve: 60, dauer: 240 },
    { name: "andereVorwahl", nr: "+4930111222333", to: "+33612345678", reserve: 60, dauer: 240 },
    { name: "franzoesisch", nr: "+33123456789", to: "+33612345678", reserve: 40, dauer: 360 },
    { name: "plattform", nr: "+15005550006", to: ZIEL, reserve: 60, dauer: 240 },
    { name: "plattformAusland", nr: "+15005550006", to: AT_ZIEL, reserve: 60, dauer: 240 },
    { name: "kurz", nr: "+4930111222333", to: ZIEL, reserve: 40, dauer: 100, max: 100 },
    { name: "text", nr: "+4930111222333", to: ZIEL, reserve: 40, dauer: 360, max: "abc" },
    { name: "null", nr: "+4930111222333", to: ZIEL, reserve: 40, dauer: 360, max: 0 },
    { name: "negativ", nr: "+4930111222333", to: ZIEL, reserve: 40, dauer: 360, max: -5 },
    { name: "zulang", nr: "+4930111222333", to: ZIEL, reserve: 40, dauer: 360, max: 99999 },
    { name: "gleich", nr: "+4930111222333", to: ZIEL, reserve: 40, dauer: 360, max: 360 },
  ];
  const budgets = faelle.map(({ name }) => ({ tenantId: `t-${name}`, budgetCents: 100, hardCapCents: 100 }));
  await mitServer({ seed: aufbau(faelle, { budgets }), env: { ...TARIFE, DEFAULT_TENANT_BUDGET_CENTS: "100" } }, async (srv) => {
    for (const { name, to, max } of faelle) {
      const antwort = await rufe(srv, name, { to, ...(max === undefined ? {} : { max_duration_s: max }) });
      assert.equal(antwort.status, HTTP_OK, `${name}: ${JSON.stringify(antwort.body)}`);
    }
    for (const { name, reserve, dauer } of faelle) {
      const [anruf] = anrufeVon(srv, name);
      assert.equal(anruf.reserveCents, reserve, `${name}: Reserve`);
      assert.equal(anruf.maxDurationS, dauer, `${name}: Hoechstdauer`);
    }
  });
});

test("3395-R4: Tenant-Budget - Decke 0, Reserve knapp ueber dem Rest, genau passend, danach erschoepft", async () => {
  const nr = "+15005550006";
  const zeilen = [{ name: "null", nr }, { name: "knapp", nr }, { name: "genau", nr }];
  const decke = { null: 0, knapp: 59, genau: 60 };
  const budgets = Object.entries(decke).map(([name, cents]) => ({
    tenantId: `t-${name}`,
    budgetCents: cents,
    hardCapCents: cents,
  }));
  await mitServer({ seed: aufbau(zeilen, { budgets }), env: { ...TARIFE, DEFAULT_TENANT_BUDGET_CENTS: "5000" } }, async (srv) => {
    abgelehnt(await rufe(srv, "null"), [HTTP_PAYMENT_REQUIRED, "budget_tenant"], "Dein Budget-Limit ist erreicht: 0.00 von 0.00 EUR verbraucht.",
    );
    abgelehnt(await rufe(srv, "knapp"), [HTTP_PAYMENT_REQUIRED, "reserve_ueber_rest"], /^Dieser Anruf passt nicht mehr in dein Budget: es fehlen 0\.01 EUR\. /,
    );
    const knapp = await rufe(srv, "knapp");
    assert.match(knapp.body.error, SPEND_MONAT_ENDE);
    assert.equal((await rufe(srv, "genau")).status, HTTP_OK);
    const danach = await rufe(srv, "genau", { to: "+4915112340001" });
    abgelehnt(danach, [HTTP_PAYMENT_REQUIRED, "reserve_erschoepft"], /^Dein Budget ist erschoepft: es fehlen 0\.60 EUR\. /);
    assert.match(danach.body.error, SPEND_MONAT_ENDE);
    for (const name of ["null", "knapp"]) assert.deepEqual(anrufeVon(srv, name), []);
    assert.equal(anrufeVon(srv, "genau").length, 1);
  });
});

test("3395-R4: Plan-Minuten - ohne Tarif, ohne Periode oder mit entzogenem Guthaben gesperrt, Betreiber-Mandant ausgenommen", async () => {
  const periode = { stripePlanSlug: "starter", stripeCurrentPeriodStart: Math.floor(Date.now() / 1000) - 3600 };
  const zeilen = [
    { name: "ohneplan" },
    { name: "ohneperiode", tenant: { stripePlanSlug: "starter" } },
    { name: "entzogen", tenant: { ...periode, stripePeriodCreditRevoked: true } },
    { name: "gueltig", tenant: periode },
  ];
  const sperre =
    "Inkludierte Plan-Minuten aufgebraucht. Bitte Tarif anpassen oder neue Abrechnungsperiode abwarten.";
  await mitServer({ seed: aufbau(zeilen), env: ZAHLUNG_ENV }, async (srv) => {
    for (const name of ["ohneplan", "ohneperiode", "entzogen"]) {
      abgelehnt(await rufe(srv, name), [HTTP_PAYMENT_REQUIRED, "minutes"], sperre);
      assert.deepEqual(anrufeVon(srv, name), [], name);
    }
    assert.equal((await rufe(srv, "gueltig")).status, HTTP_OK);
    const betreiber = await rufe(srv, null);
    assert.equal(betreiber.status, HTTP_OK, JSON.stringify(betreiber.body));
  });
  await mitServer({ seed: aufbau([{ name: "ohneplan" }]) }, async (srv) => {
    assert.equal((await rufe(srv, "ohneplan")).status, HTTP_OK);
  });
});

test("3395-R4: Texte und Auftrag - Laengengrenzen und Typ werden vor dem Anruf geprueft", async () => {
  await mitServer({ seed: aufbau([{ name: "a" }]), env: { PER_TARGET_CALL_CAP: "100", MAX_CALLS_PER_HOUR: "100" } }, async (srv) => {
    const zuLang = [
      [{ objective: "x".repeat(501) }, "objective ist zu lang (max. 500 Zeichen)"],
      [{ briefing: "x".repeat(2001) }, "briefing ist zu lang (max. 2000 Zeichen)"],
      [{ constraints: "x".repeat(2001) }, "constraints ist zu lang (max. 2000 Zeichen)"],
      [{ briefing: 123 }, "briefing muss ein String sein"],
      [{ constraints: ["a"] }, "constraints muss ein String sein"],
    ];
    for (const [koerper, fehler] of zuLang) {
      const antwort = await rufe(srv, "a", koerper);
      assert.equal(antwort.status, HTTP_BAD_REQUEST, fehler);
      assert.deepEqual(antwort.body, { error: fehler });
    }
    assert.deepEqual(anrufeVon(srv, "a"), []);
    const grenze = { objective: "x".repeat(500), briefing: "y".repeat(2000), constraints: "z".repeat(2000) };
    assert.equal((await rufe(srv, "a", grenze)).status, HTTP_OK);
  });
});

const deutschSeed = () =>
  seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel", defaultLanguage: "de" }] });

test("3395-R4: place_call ueber MCP - Betreiber-Sperre und gesperrte Nummer nennen den Grund, kein Anruf entsteht", async () => {
  const env = { ...BASIS_ENV, MULTI_TENANT: "false", OUTBOUND_FROZEN: "true" };
  const frozen = await startServer({ env, seed: deutschSeed() });
  try {
    const ergebnis = await readToolResult(
      await mcpPost(`${frozen.localUrl}/mcp`, null, toolCall("place_call", { to: ZIEL, objective: "Termin" })),
    );
    assert.equal(ergebnis.isError, true);
    assert.equal(
      ergebnis.content[0].text,
      "Ausgehende Anrufe sind derzeit vom Hermes-Betreiber pausiert. Es wurde kein Anruf gestartet. Bitte spaeter erneut versuchen.",
    );
    assert.deepEqual(frozen.readStore().calls, []);
  } finally {
    await frozen.stop();
  }
  const offen = await startServer({ env: { ...BASIS_ENV, MULTI_TENANT: "false" }, seed: deutschSeed() });
  try {
    const mcp = async (to) =>
      readToolResult(await mcpPost(`${offen.localUrl}/mcp`, null, toolCall("place_call", { to, objective: "Termin" })));
    const gesperrt = await mcp("+4990012345678");
    assert.equal(gesperrt.isError, true);
    assert.equal(
      gesperrt.content[0].text,
      "Diese Nummer kann nicht angerufen werden (Notruf-, Mehrwert- oder Servicenummer). Es wurde kein Anruf gestartet.",
    );
    assert.deepEqual(offen.readStore().calls, []);
    const gestartet = await mcp(ZIEL);
    assert.notEqual(gestartet.isError, true, JSON.stringify(gestartet));
    assert.match(gestartet.structuredContent.call_id, /^call_/);
  } finally {
    await offen.stop();
  }
});
