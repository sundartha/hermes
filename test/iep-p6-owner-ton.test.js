import { test } from "node:test";
import assert from "node:assert/strict";

import { inboundOwnerGreetingBannerLine } from "../src/boot.js";
import { callerIsOwnerGranted } from "../src/callee-is-owner.js";
import { systemPrompt } from "../src/claude.js";
import { buildInitiationResponse } from "../src/elevenlabs/inbound-initiation.js";
import { hasInboundNotice } from "../src/i18n/inbound-notice.js";
import { EROEFFNUNG_DEFEKT, EROEFFNUNG_VARIANTE, inboundEroeffnungDefekte } from "../src/i18n/inbound-opening.js";
import { LOCALES } from "../src/i18n/locales.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, normNum } from "../src/store/defaults.js";
import {
  postTelnyxIncoming,
  seedCall,
  seedWithTelnyxNumber,
  startServer,
  storeOpsFacade,
  waitForStoreState,
} from "./helpers.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const FREMDER_TENANT = "t_fremd";
const EIGENE_NUMMER = "+491737252163";
const FREMDE_NUMMER = "+491729999001";
const OWNER_NAME = "Jonas Beispiel";
const OWNER_VORNAME = "Jonas";
const SPRACHEN = Object.freeze(["de", "en", "fr"]);
const DE = LOCALES.de;
const EIGENE_NUMMER_ALS_ZAHL = 491737252163;
const KEIN_STRING = 42;
const HTTP_OK = 200;
const NOW_TOKEN = "<HEUTE>";
const freezeNow = (prompt) => prompt.replace(/Heute ist [^\n]+\./, `Heute ist ${NOW_TOKEN}.`);

const granted = (over = {}) =>
  callerIsOwnerGranted({
    from: EIGENE_NUMMER,
    ownNumber: EIGENE_NUMMER,
    tenantId: TENANT,
    enabled: true,
    allowedTenantIds: [TENANT],
    ...over,
  });

test("IEP-P6-01: Schalter an, Tenant gepinnt, exakter Treffer -> true (strikt Boolean)", () => {
  assert.strictEqual(granted(), true);
});

test("IEP-P6-02: jeder Beinahe-Treffer der Nummer -> false", () => {
  const daneben = [
    "+491737252164",
    "00491737252163",
    "491737252163",
    "01737252163",
    `${EIGENE_NUMMER} `,
    FREMDE_NUMMER,
    "unbekannt",
    "anonymous",
    "",
  ];
  for (const from of daneben) assert.strictEqual(granted({ from }), false, JSON.stringify(from));
});

test("IEP-P6-03: from/ownNumber fehlend oder kein String -> false", () => {
  for (const from of [null, undefined, EIGENE_NUMMER_ALS_ZAHL, {}]) assert.strictEqual(granted({ from }), false);
  for (const ownNumber of [null, undefined, "", EIGENE_NUMMER_ALS_ZAHL])
    assert.strictEqual(granted({ ownNumber }), false);
});

test("IEP-P6-04: bereits normalisierte Eingabe - Leerzeichen/Bindestriche treffen ueber normNum", () => {
  assert.strictEqual(granted({ from: normNum("+49 173 725-2163") }), true);
  assert.strictEqual(granted({ from: "+49 173 725-2163" }), false);
});

test("IEP-P6-05: Schalter aus/fehlend/als String -> false (kein Truthiness-Vergleich)", () => {
  for (const enabled of [false, undefined, null, "true", 1]) assert.strictEqual(granted({ enabled }), false);
});

test("IEP-P6-06: Allowlist leer heisst NIEMAND, nie JEDER", () => {
  for (const allowedTenantIds of [[], undefined, null, "owner", [FREMDER_TENANT]])
    assert.strictEqual(granted({ allowedTenantIds }), false, JSON.stringify(allowedTenantIds));
  assert.strictEqual(granted({ tenantId: FREMDER_TENANT }), false);
  assert.strictEqual(granted({ tenantId: undefined }), false);
});

const inboundInput = (over = {}) => ({
  direction: "inbound",
  from: EIGENE_NUMMER,
  to: "+4930111222333",
  tenantId: TENANT,
  ...over,
});

test("IEP-P6-10: die Erkennung schaltet die Diagnose-Aufbewahrung NICHT frei", () => {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, inboundInput({ callerIsOwner: true }));
  assert.strictEqual(call.callerIsOwner, true);
  assert.strictEqual(call.diagnostic, false);
});

test("IEP-P6-11: Geldpfad-Gegenprobe - das gespeicherte call.from bleibt ROH", () => {
  const roh = "+49 173 725-2163";
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, inboundInput({ from: roh }));
  assert.strictEqual(call.from, roh);
  assert.ok(DE.postCall.subjectInbound(call.from).includes(roh));
});

test("IEP-P6-12: Boot-Banner - aus keine Zeile, an genau eine ohne Tenant-ID", () => {
  assert.equal(
    inboundOwnerGreetingBannerLine({ inboundOwnerGreetingEnabled: false, inboundOwnerGreetingTenantIds: [TENANT] }),
    "",
    "aus -> Banner byte-identisch zum Bestand",
  );
  const zeile = inboundOwnerGreetingBannerLine({
    inboundOwnerGreetingEnabled: true,
    inboundOwnerGreetingTenantIds: [TENANT, FREMDER_TENANT],
  });
  assert.match(zeile, /AKTIV/);
  assert.match(zeile, /2 Tenants/);
  assert.ok(!zeile.includes(TENANT), "Regel 4/PII: nie eine Tenant-ID im Log");
  assert.ok(!zeile.includes(FREMDER_TENANT));
});

const EROEFFNUNG_FREMD = Object.freeze({
  de: "Hallo, hier ist der KI-Assistent von Jonas Beispiel. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?",
  en: "Hello, this is Jonas Beispiel's AI assistant. This call is transcribed and summarised. How can I help?",
  fr: "Bonjour, ici l'assistant IA de Jonas Beispiel. Cet appel est transcrit et résumé. Comment puis-je aider ?",
});

const EROEFFNUNG_OWNER = Object.freeze({
  de: "Hallo Jonas, hier ist dein KI-Assistent. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?",
  en: "Hi Jonas, it's your AI assistant. This call is transcribed and summarised. How can I help?",
  fr: "Bonjour Jonas, c'est ton assistant IA. Cet appel est transcrit et résumé. Comment puis-je aider ?",
});

test("IEP-P6-20: Wortlaut byte-genau je Sprache, Fremd und Owner, auch mit Rand-Leerzeichen", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    assert.equal(bundle.inboundEroeffnung(OWNER_NAME), EROEFFNUNG_FREMD[sprache], sprache);
    assert.equal(bundle.inboundEroeffnung(`  ${OWNER_NAME}  `), EROEFFNUNG_FREMD[sprache], sprache);
    assert.equal(bundle.inboundEroeffnungOwner(OWNER_VORNAME), EROEFFNUNG_OWNER[sprache], sprache);
    assert.equal(bundle.inboundEroeffnungOwner(`  ${OWNER_VORNAME}  `), EROEFFNUNG_OWNER[sprache], sprache);
  }
});

test("IEP-P6-21: Owner und Fremd unterscheiden sich in GENAU dem Kopfsatz", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    const fremd = bundle.inboundEroeffnung(OWNER_NAME);
    const owner = bundle.inboundEroeffnungOwner(OWNER_VORNAME);
    const rest = ` ${bundle.inboundHinweisSatz}`;
    assert.ok(fremd.startsWith(bundle.inboundGrussSatz(OWNER_NAME)), sprache);
    assert.ok(owner.startsWith(bundle.inboundGrussSatzOwner(OWNER_VORNAME)), sprache);
    assert.equal(fremd.slice(fremd.indexOf(rest)), owner.slice(owner.indexOf(rest)), sprache);
    assert.equal(hasInboundNotice(fremd), true, sprache);
    assert.equal(hasInboundNotice(owner), true, sprache);
  }
});

test("IEP-P6-22: ohne Vornamen entsteht KEINE Owner-Eroeffnung (fail-closed)", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    for (const ohne of ["", "   ", null, undefined, KEIN_STRING, {}]) {
      assert.equal(bundle.inboundEroeffnungOwner(ohne), "", `${sprache} ${JSON.stringify(ohne)}`);
      assert.equal(bundle.inboundGrussSatzOwner(ohne), "", `${sprache} ${JSON.stringify(ohne)}`);
    }
  }
});

test("IEP-P6-23: der GREETING-Pflichtsatz (inboundNotice) ist unberuehrt - eigener Baustein", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    assert.notEqual(bundle.inboundHinweisSatz, bundle.inboundNotice, sprache);
    assert.ok(!bundle.inboundEroeffnung(OWNER_NAME).includes(bundle.inboundNotice), sprache);
  }
  assert.ok(!EROEFFNUNG_FREMD.de.includes("Hinweis:"));
  assert.ok(!EROEFFNUNG_FREMD.de.includes("Sie sprechen mit einer KI"));
  assert.ok(!EROEFFNUNG_OWNER.de.includes("Hinweis:"));
});

const defekte = (text, over = {}) =>
  inboundEroeffnungDefekte({ text, bundle: DE, ownerName: OWNER_NAME, firstName: OWNER_VORNAME, ...over });

test("IEP-P6-30: Riegel gruen fuer BEIDE Sollformen, alle drei Sprachen, mit und ohne Namen", () => {
  for (const sprache of SPRACHEN) {
    const bundle = LOCALES[sprache];
    for (const ownerName of [OWNER_NAME, ""]) {
      assert.deepEqual(
        inboundEroeffnungDefekte({
          text: bundle.inboundEroeffnung(ownerName),
          bundle,
          ownerName,
          variante: EROEFFNUNG_VARIANTE.FREMD,
        }),
        [],
        `${sprache} fremd ${JSON.stringify(ownerName)}`,
      );
    }
    assert.deepEqual(
      inboundEroeffnungDefekte({
        text: bundle.inboundEroeffnungOwner(OWNER_VORNAME),
        bundle,
        firstName: OWNER_VORNAME,
        variante: EROEFFNUNG_VARIANTE.OWNER,
      }),
      [],
      `${sprache} owner`,
    );
  }
});

test("IEP-P6-31: Riegel ROT - jeder fehlende Pflicht-Baustein der Owner-Fassung", () => {
  const owner = { variante: EROEFFNUNG_VARIANTE.OWNER };
  const kopf = DE.inboundGrussSatzOwner(OWNER_VORNAME);

  assert.deepEqual(defekte(`${kopf} Wie kann ich helfen?`, owner), [
    EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT,
    EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN,
  ]);
  assert.deepEqual(defekte(`Hallo Jonas. ${DE.inboundHinweisSatz} Wie kann ich helfen?`, owner), [
    EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT,
    EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN,
  ]);
  assert.deepEqual(defekte(`${DE.inboundEroeffnungOwner(OWNER_VORNAME)} {{x}}`, owner), [
    EROEFFNUNG_DEFEKT.PLATZHALTER,
  ]);
});

test("IEP-P6-32: Riegel ROT - Variante und Text passen nicht zueinander", () => {
  assert.deepEqual(defekte(DE.inboundEroeffnung(OWNER_NAME), { variante: EROEFFNUNG_VARIANTE.OWNER }), [
    EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT,
  ]);
  assert.deepEqual(defekte(DE.inboundEroeffnungOwner(OWNER_VORNAME), { variante: EROEFFNUNG_VARIANTE.FREMD }), [
    EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT,
  ]);
});

test("IEP-P6-33: Riegel ROT - unbekannte Variante und leerer Sollkopf sind selbst Defekte", () => {
  for (const variante of [undefined, null, "owner ", "OWNER", "fremd ", 1])
    assert.ok(
      defekte(DE.inboundEroeffnungOwner(OWNER_VORNAME), { variante }).includes(EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT),
      JSON.stringify(variante),
    );
  assert.ok(
    defekte(`Hallo , hier ist dein KI-Assistent. ${DE.inboundHinweisSatz} Wie kann ich helfen?`, {
      variante: EROEFFNUNG_VARIANTE.OWNER,
      firstName: "",
    }).includes(EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT),
  );
});

test("IEP-P6-34: Positiv-Kontrolle - Hinweis-Wortlaut und Hinweis-Merkmale sind unabhaengig", () => {
  const halb = { ...DE, inboundHinweisSatz: "Das Gespräch wird transkribiert." };
  const text = `${halb.inboundGrussSatz(OWNER_NAME)} ${halb.inboundHinweisSatz} Wie kann ich helfen?`;
  assert.deepEqual(
    inboundEroeffnungDefekte({ text, bundle: halb, ownerName: OWNER_NAME, variante: EROEFFNUNG_VARIANTE.FREMD }),
    [],
    "(b) besteht: der Satz steht woertlich so im Bundle",
  );
  const ohneMerkmal = { ...DE, inboundHinweisSatz: "Hier spricht eine Maschine." };
  const textOhne = `${ohneMerkmal.inboundGrussSatz(OWNER_NAME)} ${ohneMerkmal.inboundHinweisSatz} Wie kann ich helfen?`;
  assert.deepEqual(
    inboundEroeffnungDefekte({
      text: textOhne,
      bundle: ohneMerkmal,
      ownerName: OWNER_NAME,
      variante: EROEFFNUNG_VARIANTE.FREMD,
    }),
    [EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN],
    "(c) faellt allein - die zwei Pruefungen haengen nicht aneinander",
  );
});

const INIT_CONFIG = Object.freeze({ telnyx: { telnyxElevenLabs: { voiceId: "" } } });
const INIT_TO = "+4930111222333";

function initHarness() {
  const state = ops.makeDefaultState();
  state.tenants[0].ownerName = OWNER_NAME;
  state.numbers.push({
    id: "num_iep_p6",
    e164: INIT_TO,
    tenantId: TENANT,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  const store = {
    ...storeOpsFacade(state),
    numberRecordByE164: (e164) => ops.numberRecordByE164(state, e164),
    tenantTimezone: (id) => ops.tenantTimezone(state, id),
    tenantContext: (id) => ops.tenantContext(state, "", id),
  };
  const call = ops.createCall(state, inboundInput({ to: INIT_TO, language: "de" }));
  return { store, call };
}

const antwortFuer = (callerIsOwner) => {
  const { store, call } = initHarness();
  call.callerIsOwner = callerIsOwner;
  return buildInitiationResponse({ store, config: INIT_CONFIG, call });
};

const eroeffnungDer = (antwort) => antwort.conversation_config_override.agent.first_message;

test("IEP-P6-60: callerIsOwner=true -> Owner-Eroeffnung; false -> Fremd-Eroeffnung", () => {
  assert.equal(eroeffnungDer(antwortFuer(true)), EROEFFNUNG_OWNER.de);
  assert.equal(eroeffnungDer(antwortFuer(false)), EROEFFNUNG_FREMD.de);
});

test("IEP-P6-61: strikt === true - fehlendes Feld und Rohwerte heissen FREMD", () => {
  const { store, call } = initHarness();
  assert.ok(!("callerIsOwner" in call) || call.callerIsOwner === false, "Vorbedingung");
  for (const wert of [undefined, "true", 1, {}]) {
    call.callerIsOwner = wert;
    const antwort = buildInitiationResponse({ store, config: INIT_CONFIG, call });
    assert.equal(eroeffnungDer(antwort), EROEFFNUNG_FREMD.de, JSON.stringify(wert));
  }
});

test("IEP-P6-62: callerIsOwner=true, aber kein Vorname -> die freigegebene Fremd-Eroeffnung", () => {
  const { store, call } = initHarness();
  store.tenantContext = () => ({ ownerName: OWNER_NAME, firstName: "", settings: {} });
  call.callerIsOwner = true;
  const antwort = buildInitiationResponse({ store, config: INIT_CONFIG, call });
  assert.equal(eroeffnungDer(antwort), EROEFFNUNG_FREMD.de);
});

test("IEP-P6-63: Nur-Ton-Invariante - die Erkennung faerbt GENAU zwei Felder, keinen Datenkanal", () => {
  const owner = antwortFuer(true);
  const fremd = antwortFuer(false);

  assert.deepEqual(Object.keys(owner).sort(), Object.keys(fremd).sort());
  assert.deepEqual(Object.keys(owner.dynamic_variables).sort(), Object.keys(fremd.dynamic_variables).sort());

  const verschieden = Object.keys(owner.dynamic_variables).filter(
    (name) => owner.dynamic_variables[name] !== fremd.dynamic_variables[name],
  );
  assert.deepEqual(verschieden, ["inbound_situation"], "genau EINE dynamische Variable wechselt");
  assert.deepEqual(owner.conversation_config_override.agent.language, fremd.conversation_config_override.agent.language);
  assert.notEqual(eroeffnungDer(owner), eroeffnungDer(fremd));

  for (const antwort of [owner, fremd]) {
    assert.equal(antwort.dynamic_variables.tenant_token, "");
    assert.equal(antwort.dynamic_variables.consult_available, fremd.dynamic_variables.consult_available);
    assert.equal(antwort.dynamic_variables.lookup_available, fremd.dynamic_variables.lookup_available);
  }
});

test("IEP-P6-64: der Owner-Prompt-Baustein traegt den Pflicht-Rueckfall FERTIG und keine Rufnummer", () => {
  const block = LOCALES.en.prompt.inboundSituationOwner({
    owner: OWNER_NAME,
    fremdEroeffnung: EROEFFNUNG_FREMD.de,
  });
  assert.ok(block.includes(EROEFFNUNG_FREMD.de), "der fertige Fremd-Wortlaut steht im Block");
  assert.ok(block.includes(OWNER_NAME));
  assert.ok(!block.includes("{{"), "kein unaufgeloester Platzhalter");
  assert.ok(!/[0-9]/.test(block), "Datenminimierung: keine Ziffer, also auch keine Rufnummer");
});

test("IEP-P6-65: die Budget-Engine kennt das Feld nicht - ihr Systemprompt bleibt byte-identisch", () => {
  const felder = { direction: "inbound", from: EIGENE_NUMMER, to: INIT_TO, language: "de" };
  const ohne = freezeNow(systemPrompt(seedCall(felder)));
  const mit = freezeNow(systemPrompt(seedCall({ ...felder, callerIsOwner: true })));
  assert.equal(mit, ohne);
});

const SPAWN_ENV_AN = Object.freeze({
  INBOUND_OWNER_GREETING_ENABLED: "true",
  INBOUND_OWNER_GREETING_TENANT_IDS: TENANT,
});

function spawnSeed() {
  const seed = seedWithTelnyxNumber();
  seed.tenants[0].ownerName = OWNER_NAME;
  seed.tenants[0].firstName = OWNER_VORNAME;
  seed.tenants[0].privateNumber = EIGENE_NUMMER;
  return seed;
}

async function eingehenderAnruf(srv, { from, callSid }) {
  const res = await postTelnyxIncoming(srv, { from, callSid });
  assert.equal(res.status, HTTP_OK, `/voice/incoming -> ${res.status}`);
  const store = await waitForStoreState(srv, (zustand) =>
    zustand.calls.some((call) => call.twilioSid === callSid),
  );
  return store.calls.find((call) => call.twilioSid === callSid);
}

test("IEP-P6-70: Schalter an + Tenant gepinnt - nur die exakte eigene Nummer setzt callerIsOwner", async () => {
  const srv = await startServer({ env: SPAWN_ENV_AN, seed: spawnSeed() });
  try {
    const faelle = [
      ["CAowner1", EIGENE_NUMMER, true],
      ["CAowner2", "+49 173 725-2163", true],
      ["CAfremd1", "+491737252164", false],
      ["CAfremd2", "anonymous", false],
      ["CAfremd3", "", false],
    ];
    for (const [callSid, from, erwartet] of faelle) {
      const call = await eingehenderAnruf(srv, { from, callSid });
      assert.strictEqual(call.callerIsOwner, erwartet, `${callSid} from=${JSON.stringify(from)}`);
      assert.strictEqual(call.calleeIsOwner, false, "ein eingehender Anruf traegt den OUTBOUND-Waechter nie");
      assert.equal(call.from, from || "unbekannt", callSid);
    }
  } finally {
    await srv.stop();
  }
});

test("IEP-P6-71: Schalter aus bzw. Tenant nicht gepinnt -> callerIsOwner bleibt false", async () => {
  const faelle = [
    ["aus", { INBOUND_OWNER_GREETING_ENABLED: "false", INBOUND_OWNER_GREETING_TENANT_IDS: TENANT }],
    ["nicht gepinnt", { INBOUND_OWNER_GREETING_ENABLED: "true", INBOUND_OWNER_GREETING_TENANT_IDS: FREMDER_TENANT }],
    ["Liste leer", { INBOUND_OWNER_GREETING_ENABLED: "true", INBOUND_OWNER_GREETING_TENANT_IDS: "" }],
  ];
  for (const [name, env] of faelle) {
    const srv = await startServer({ env, seed: spawnSeed() });
    try {
      const call = await eingehenderAnruf(srv, { from: EIGENE_NUMMER, callSid: "CArueckweg" });
      assert.strictEqual(call.callerIsOwner, false, name);
    } finally {
      await srv.stop();
    }
  }
});
