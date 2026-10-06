import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { HERMES_RENDER_SERVICE_ID, initWebhookUrl } from "../src/elevenlabs/init-webhook-ziel.js";
import { RENDER_API_BASE, schreibeRenderEnvVar } from "../src/render-api.js";
import { ELEVENLABS_VOICE_ID_BY_PROFILE } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";
import { makeAusgabeWaechter } from "../scripts/iel-geheimnisse-ausgabe.mjs";
import { stimmenUrteil } from "../scripts/iel-geheimnisse-belege.mjs";
import { ERSTE_ZEILE_MAX_ZEICHEN, ersterAgentEintragUnterbrochen, variablenBeleg } from "../scripts/iel-geheimnisse-conversation.mjs";
import { schreibeDienstEnv } from "../scripts/iel-geheimnisse-render.mjs";
import {
  GEHEIMNIS_ZUFALLS_BYTES,
  SIP_USER_ZUFALLS_BYTES,
  WORKSPACE_SECRET_NAME,
  trunkKoerper,
  webhookSecretKonflikt,
} from "../scripts/iel-geheimnisse-setzen.mjs";
import { leseArgumente, runCli } from "../scripts/iel-geheimnisse.mjs";
import { ROOT } from "./helpers.js";
import { SPION_MARKE } from "./_import-spion-store.mjs";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVER_ERROR = 500;
const HTTP_ERFOLG_BIS = 300;
const HTTP_FEHLER_AB = 400;
const METHODE_GET = "GET";
const EL_BASIS = "http://el.test";
const RENDER_SCHLUESSEL_TEST = "render-test-schluessel";
const RENDER_DIENST = `${RENDER_API_BASE}/services/${HERMES_RENDER_SERVICE_ID}`;
const ENV_VARS = "/env-vars/";
const TTS_MUSTER = /\/v1\/text-to-speech\/([^/]+)\/stream/;
const PHONE_NUMBERS = "/v1/convai/phone-numbers";
const SECRETS = "/v1/convai/secrets";
const CONVERSATIONS = "/v1/convai/conversations";
const SPAWN_TIMEOUT_MS = 15000;
const MIN_PRAEFIX = 8;
const HEX = "hex";
const FUELL_BYTE_USER = 0xa1;
const FUELL_BYTE_PASSWORT = 0xb2;
const FUELL_BYTE_TOKEN = 0xc3;
const FUELL_BYTES = Object.freeze([FUELL_BYTE_USER, FUELL_BYTE_PASSWORT, FUELL_BYTE_TOKEN]);
const ZU_KURZ_TEILER = 4;
const INIT_PROBEN = 2;
const DID = "+4930123456788";
const TUNNEL = "https://x.trycloudflare.com";
const ONRENDER = "https://vodafone-agent.onrender.com";
const AGENT_STIMME = "agentStimme0001";
const MODELL = "eleven_v3_conversational";
const LESE_TOKEN = "gelesenes-init-token-0123456789abcdef";
const LESE_PASSWORT = "gelesenes-sip-passwort-0123456789abcdef";
const TENANT_ID = "tenant-geheim-4711";
const INIT_HEADER = "x-hermes-init-token";
const WEBHOOK_SCHLUESSEL = "conversation_initiation_client_data_webhook";
const TENANT_TOKEN = "TTOKEN-QWERTZ-9876543210-hmac-wert";
const BINDUNG = "BINDUNG-ASDFGH-1234567890-bindung";
const SEIT = "2026-09-15T10:00:00.000Z";
const K_GRENZE = 5;
const MS_JE_S = 1000;

const ERWARTET = Object.freeze({
  sipUser: Buffer.alloc(SIP_USER_ZUFALLS_BYTES, FUELL_BYTES[0]).toString(HEX),
  sipPassword: Buffer.alloc(GEHEIMNIS_ZUFALLS_BYTES, FUELL_BYTES[1]).toString(HEX),
  initWebhookToken: Buffer.alloc(GEHEIMNIS_ZUFALLS_BYTES, FUELL_BYTES[2]).toString(HEX),
});
const ERWARTETE_WERTE = Object.values(ERWARTET);

const AGENT_ID = "agent_test";
const OUTBOUND_TRUNK = Object.freeze({ address: "sip.telnyx.com", username: "out-user" });
const REG_DID = Object.freeze({
  phone_number_id: "phnum_did",
  phone_number: DID,
  label: "hermes-n1",
  assigned_agent: { agent_id: AGENT_ID },
  outbound_trunk: OUTBOUND_TRUNK,
});
const REG_OFFEN = Object.freeze({
  phone_number_id: "phnum_offen",
  phone_number: "+15550100177",
  inbound_trunk: { has_auth_credentials: false, allowed_numbers: [] },
});
const REG_FREMD_MIT_ZUGANG = Object.freeze({
  phone_number_id: "phnum_fremd",
  phone_number: "+4930999999999",
  inbound_trunk: { has_auth_credentials: true },
});

function renderEnvGruen() {
  return {
    ELEVENLABS_INBOUND_SIP_USER: "gelesener-user",
    ELEVENLABS_INBOUND_SIP_PASSWORD: LESE_PASSWORT,
    ELEVENLABS_INIT_WEBHOOK_TOKEN: LESE_TOKEN,
    OWNER_SELF_CALL_TENANT_IDS: TENANT_ID,
    ELEVENLABS_VOICE_ID: AGENT_STIMME,
    ELEVENLABS_MODEL: MODELL,
    PUBLIC_URL: "https://app.sundartha.com",
  };
}

function conversationDetail({ agentZeile = "Guten Tag, hier ist Hermes.", phoneNumberId = REG_DID.phone_number_id, agentUnterbrochen } = {}) {
  return {
    conversation_id: "conv_neu",
    status: "done",
    metadata: { call_duration_secs: 42, phone_call: { direction: "inbound", phone_number_id: phoneNumberId } },
    conversation_initiation_client_data: {
      dynamic_variables: { tenant_token: TENANT_TOKEN, sip_hermes_call_binding: BINDUNG, inbound_situation: "", tenant_name: "x" },
    },
    transcript: [
      { role: "user", message: "hallo" },
      { role: "agent", message: agentZeile, interrupted: agentUnterbrochen },
    ],
  };
}

function szenario(felder = {}) {
  return {
    renderEnv: renderEnvGruen(),
    renderEnvStatus: {},
    renderPutStatus: {},
    renderServiceStatus: HTTP_OK,
    serviceUrl: ONRENDER,
    domains: [{ customDomain: { name: "app.sundartha.com", verificationStatus: "verified" } }],
    registrierungen: [REG_DID],
    spaeteRegistrierung: null,
    patchStatus: HTTP_OK,
    secrets: [],
    secretNextCursor: null,
    secretStatus: HTTP_OK,
    settings: { [WEBHOOK_SCHLUESSEL]: null },
    initStatus: { ohneToken: HTTP_FORBIDDEN, mitToken: HTTP_NOT_FOUND },
    ttsStatus: {},
    agent: { conversation_config: { tts: { voice_id: AGENT_STIMME, model_id: MODELL } } },
    conversationListe: {
      conversations: [
        { conversation_id: "conv_alt", direction: "inbound", start_time_unix_secs: 100 },
        { conversation_id: "conv_neu", direction: "inbound", start_time_unix_secs: 200 },
        { conversation_id: "conv_out", direction: "outbound", start_time_unix_secs: 300 },
      ],
      has_more: false,
    },
    conversation: conversationDetail(),
    ...felder,
  };
}

function antwort({ status, koerper, aufruf }) {
  const inhalt = status >= HTTP_FEHLER_AB ? aufruf.koerper : koerper;
  const text = typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt ?? null);
  return {
    ok: status >= HTTP_OK && status < HTTP_ERFOLG_BIS,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
    headers: { get: () => "audio/mpeg" },
    body: audioStrom(),
  };
}

function audioStrom() {
  let gelesen = false;
  return {
    getReader: () => ({
      read: async () => {
        if (gelesen) return { done: true, value: undefined };
        gelesen = true;
        return { done: false, value: Buffer.from("mp3-paket") };
      },
    }),
  };
}

function renderRoute({ aufruf, zustand, welt }) {
  const rest = aufruf.adresse.slice(RENDER_DIENST.length);
  if (rest.startsWith(ENV_VARS)) {
    const schluessel = decodeURIComponent(rest.slice(ENV_VARS.length));
    if (aufruf.methode === "PUT") {
      const status = welt.renderPutStatus[schluessel] ?? HTTP_OK;
      if (status === HTTP_OK) zustand.env.set(schluessel, JSON.parse(aufruf.koerper).value);
      return { status, koerper: { key: schluessel, value: zustand.env.get(schluessel) } };
    }
    const status = welt.renderEnvStatus[schluessel] ?? (zustand.env.has(schluessel) ? HTTP_OK : HTTP_NOT_FOUND);
    return { status, koerper: { key: schluessel, value: zustand.env.get(schluessel) } };
  }
  if (rest.startsWith("/custom-domains")) return { status: HTTP_OK, koerper: welt.domains };
  return { status: welt.renderServiceStatus, koerper: { serviceDetails: { url: welt.serviceUrl } } };
}

function registrierungsRoute({ aufruf, zustand, welt }) {
  const pfad = aufruf.adresse.slice(EL_BASIS.length);
  if (pfad === PHONE_NUMBERS) {
    return { status: HTTP_OK, koerper: zustand.registrierungen.map(({ phone_number, phone_number_id }) => ({ phone_number, phone_number_id })) };
  }
  const id = decodeURIComponent(pfad.slice(PHONE_NUMBERS.length + 1));
  const registrierung = zustand.registrierungen.find((eintrag) => eintrag.phone_number_id === id);
  if (!registrierung) return { status: HTTP_NOT_FOUND, koerper: {} };
  if (aufruf.methode !== "PATCH") return { status: HTTP_OK, koerper: registrierung };
  if (welt.patchStatus !== HTTP_OK) return { status: welt.patchStatus, koerper: {} };
  const konfig = JSON.parse(aufruf.koerper).inbound_trunk_config;
  registrierung.inbound_trunk = {
    has_auth_credentials: true,
    username: konfig.credentials.username,
    allowed_numbers: konfig.allowed_numbers,
    media_encryption: "allowed",
  };
  if (welt.spaeteRegistrierung) zustand.registrierungen.push(structuredClone(welt.spaeteRegistrierung));
  return { status: HTTP_OK, koerper: registrierung };
}

function secretRoute({ aufruf, zustand, welt }) {
  if (aufruf.methode === METHODE_GET) return { status: HTTP_OK, koerper: { secrets: zustand.secrets, next_cursor: welt.secretNextCursor } };
  if (welt.secretStatus !== HTTP_OK) return { status: welt.secretStatus, koerper: {} };
  const { name } = JSON.parse(aufruf.koerper);
  if (aufruf.methode === "PATCH") {
    const id = decodeURIComponent(aufruf.adresse.split(`${SECRETS}/`)[1]);
    return { status: HTTP_OK, koerper: { type: "stored", secret_id: id, name } };
  }
  const neu = { type: "stored", secret_id: "sec_neu", name };
  zustand.secrets.push(neu);
  return { status: HTTP_OK, koerper: neu };
}

function elRoute({ aufruf, zustand, welt }) {
  const pfad = aufruf.adresse.slice(EL_BASIS.length);
  const tts = TTS_MUSTER.exec(pfad);
  if (tts) return { status: welt.ttsStatus[decodeURIComponent(tts[1])] ?? HTTP_OK, koerper: {} };
  if (pfad.startsWith(PHONE_NUMBERS)) return registrierungsRoute({ aufruf, zustand, welt });
  if (pfad.startsWith(SECRETS)) return secretRoute({ aufruf, zustand, welt });
  if (pfad === "/v1/convai/settings") return { status: HTTP_OK, koerper: welt.settings };
  if (pfad.startsWith("/v1/convai/agents/")) return { status: HTTP_OK, koerper: welt.agent };
  if (pfad.startsWith(`${CONVERSATIONS}?`)) return { status: HTTP_OK, koerper: welt.conversationListe };
  if (pfad.startsWith(`${CONVERSATIONS}/`)) return { status: HTTP_OK, koerper: welt.conversation };
  return { status: HTTP_NOT_FOUND, koerper: {} };
}

function route(aufruf, zustand, welt) {
  if (aufruf.adresse.startsWith(RENDER_DIENST)) return renderRoute({ aufruf, zustand, welt });
  if (aufruf.adresse === initWebhookUrl()) {
    const status = aufruf.kopf[INIT_HEADER] ? welt.initStatus.mitToken : welt.initStatus.ohneToken;
    return { status, koerper: {} };
  }
  if (aufruf.adresse.startsWith(EL_BASIS)) return elRoute({ aufruf, zustand, welt });
  return { status: HTTP_NOT_FOUND, koerper: {} };
}

function baueWelt(welt) {
  const zustand = {
    env: new Map(Object.entries(welt.renderEnv)),
    registrierungen: structuredClone(welt.registrierungen),
    secrets: structuredClone(welt.secrets),
  };
  const aufrufe = [];
  const fetchImpl = async (adresse, optionen = {}) => {
    const aufruf = {
      adresse: String(adresse),
      methode: optionen.method ?? METHODE_GET,
      koerper: optionen.body ?? null,
      kopf: optionen.headers ?? {},
      redirect: optionen.redirect,
    };
    aufrufe.push(aufruf);
    return antwort({ ...route(aufruf, zustand, welt), aufruf });
  };
  return { fetchImpl, aufrufe, zustand };
}

function folgeZufall() {
  let aufruf = 0;
  return (laenge) => Buffer.alloc(laenge, FUELL_BYTES[aufruf++ % FUELL_BYTES.length]);
}

async function laufe(argv, szenarioFelder = {}, abhFelder = {}) {
  const welt = baueWelt(szenario(szenarioFelder));
  const zeilen = [];
  const kanal = { write: (text) => zeilen.push(text) };
  const abh = {
    fetchImpl: welt.fetchImpl,
    zufall: folgeZufall(),
    stdout: kanal,
    stderr: kanal,
    renderApiKey: RENDER_SCHLUESSEL_TEST,
    elKonto: { apiKey: "el-test", apiBase: EL_BASIS, agentId: AGENT_ID },
    ttsAusgabeformat: "mp3_44100_128",
    ...abhFelder,
  };
  const code = await runCli({ argv, abh });
  return { code, ausgabe: zeilen.join(""), aufrufe: welt.aufrufe, zustand: welt.zustand };
}

function schreibendeAufrufe(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.methode !== METHODE_GET);
}

function konfigSchreibAufrufe(aufrufe) {
  return schreibendeAufrufe(aufrufe).filter(
    (aufruf) => aufruf.adresse !== initWebhookUrl() && !TTS_MUSTER.test(aufruf.adresse),
  );
}

function aufrufeAn(aufrufe, praefix) {
  return aufrufe.filter((aufruf) => aufruf.adresse.startsWith(praefix));
}

function assertEnthaeltKeinen(text, werte) {
  for (const wert of werte) {
    assert.ok(!text.includes(wert.slice(0, MIN_PRAEFIX)), `Ausgabe enthaelt einen Wert-Praefix\n${text}`);
  }
}

function zielZeile(ausgabe, ziel) {
  return ausgabe.split("\n").find((zeile) => zeile.includes(`ZIEL ${ziel} `)) ?? "";
}

const ARG_SETZEN = Object.freeze(["setzen", `--nummer=${DID}`]);
const ARG_SETZEN_AUSFUEHREN = Object.freeze([...ARG_SETZEN, "--ausfuehren"]);
const ARG_REG = `--registrierung=${REG_DID.phone_number_id}`;
const RENDER_ZIELE = Object.freeze([
  "Render ELEVENLABS_INBOUND_SIP_USER",
  "Render ELEVENLABS_INBOUND_SIP_PASSWORD",
  "Render ELEVENLABS_INIT_WEBHOOK_TOKEN",
]);
const SECRET_ZIEL = `Workspace-Secret ${WORKSPACE_SECRET_NAME} (anlegen)`;
const REG_ZIEL = `Registrierung ${REG_DID.phone_number_id}`;

describe("IEL-B10 setzen: Verteilen, Ausgabe, Trockenlauf", () => {
  it("IEL-B10-1a/b/c: Fehlschlag an Render, Secret und Registrierung - kein Wert in der Ausgabe, Tabelle korrekt", async () => {
    const faelle = [
      { felder: { renderPutStatus: { ELEVENLABS_INBOUND_SIP_PASSWORD: HTTP_SERVER_ERROR } }, gesetzt: [true, false, false, false, false] },
      { felder: { secretStatus: HTTP_SERVER_ERROR }, gesetzt: [true, true, true, false, false] },
      { felder: { patchStatus: HTTP_SERVER_ERROR }, gesetzt: [true, true, true, true, false] },
    ];
    for (const { felder, gesetzt } of faelle) {
      const { code, ausgabe } = await laufe(ARG_SETZEN_AUSFUEHREN, felder);
      assert.equal(code, 1, ausgabe);
      assertEnthaeltKeinen(ausgabe, ERWARTETE_WERTE);
      [...RENDER_ZIELE, SECRET_ZIEL, REG_ZIEL].forEach((ziel, index) => {
        assert.match(zielZeile(ausgabe, ziel), new RegExp(`gesetzt: ${gesetzt[index] ? "ja" : "nein"}`), `${ziel}\n${ausgabe}`);
      });
    }
  });

  it("IEL-B10-2: Erfolgslauf - Reihenfolge Render -> Secret -> Registrierung, gleiche Werte, Weissmuster-Ausgabe", async () => {
    const { code, ausgabe, aufrufe } = await laufe(ARG_SETZEN_AUSFUEHREN);    assert.equal(code, 0, ausgabe);
    const schreibend = schreibendeAufrufe(aufrufe);
    assert.deepEqual(
      schreibend.map((aufruf) => [aufruf.methode, aufruf.adresse.replace(RENDER_API_BASE, "R").replace(EL_BASIS, "E")]),
      [
        ["PUT", `R/services/${HERMES_RENDER_SERVICE_ID}/env-vars/ELEVENLABS_INBOUND_SIP_USER`],
        ["PUT", `R/services/${HERMES_RENDER_SERVICE_ID}/env-vars/ELEVENLABS_INBOUND_SIP_PASSWORD`],
        ["PUT", `R/services/${HERMES_RENDER_SERVICE_ID}/env-vars/ELEVENLABS_INIT_WEBHOOK_TOKEN`],
        ["POST", `E${SECRETS}`],
        ["PATCH", `E${PHONE_NUMBERS}/${REG_DID.phone_number_id}`],
      ],
    );
    const [user, passwort, token, secret, patch] = schreibend.map((aufruf) => JSON.parse(aufruf.koerper));
    assert.equal(user.value, ERWARTET.sipUser);
    assert.equal(passwort.value, ERWARTET.sipPassword);
    assert.equal(token.value, ERWARTET.initWebhookToken);
    assert.notEqual(passwort.value, token.value, "Fixture unterscheidet Passwort und Token nicht");
    assert.deepEqual(secret, { type: "new", name: WORKSPACE_SECRET_NAME, value: token.value });
    assert.deepEqual(patch, trunkKoerper({ geheimnisse: ERWARTET, nummer: DID }));
    assert.equal(patch.inbound_trunk_config.credentials.password, passwort.value);
    assert.equal(patch.inbound_trunk_config.credentials.username, user.value);

    const zeilen = ausgabe.trim().split("\n");
    for (const zeile of zeilen) {
      assert.match(zeile, /^\[iel-geheimnisse\] [A-Za-z0-9 _\-:=.,()|[\]…/"]+$/, zeile);
      assert.doesNotMatch(zeile, /[0-9a-f]{16,}/i, zeile);
    }
    assert.match(ausgabe, /secret_id sec_neu/);
    assert.match(ausgabe, /media_encryption=allowed/);
    const letzteListe = aufrufe.findLastIndex((aufruf) => aufruf.adresse === `${EL_BASIS}${PHONE_NUMBERS}`);
    assert.deepEqual(schreibendeAufrufe(aufrufe.slice(letzteListe)), [], "nach dem abschliessenden Inventar folgt ein Schreibaufruf");
  });

  it("IEL-B10-3: Zufallsquelle zu kurz -> ROT ohne Wert, 0 schreibende Aufrufe", async () => {
    const zuKurz = (laenge) => Buffer.alloc(Math.floor(laenge / ZU_KURZ_TEILER), FUELL_BYTE_USER);
    const { code, ausgabe, aufrufe } = await laufe(ARG_SETZEN_AUSFUEHREN, {}, { zufall: zuKurz });
    assert.equal(code, 1, ausgabe);
    assert.match(ausgabe, /ELEVENLABS_INBOUND_SIP_PASSWORD erzeugt: zu kurz/);
    assert.match(ausgabe, /ELEVENLABS_INIT_WEBHOOK_TOKEN erzeugt: zu kurz/);
    assert.deepEqual(schreibendeAufrufe(aufrufe), []);
    assert.ok(!ausgabe.includes(Buffer.alloc(MIN_PRAEFIX, FUELL_BYTE_USER).toString(HEX)));
  });

  it("IEL-B10-4: Trockenlauf ist Default - 0 schreibende und 0 Render-Aufrufe", async () => {
    const { code, ausgabe, aufrufe } = await laufe(ARG_SETZEN);
    assert.equal(code, 0, ausgabe);
    assert.match(ausgabe, /TROCKENLAUF/);
    assert.deepEqual(schreibendeAufrufe(aufrufe), []);
    assert.deepEqual(aufrufeAn(aufrufe, RENDER_API_BASE), []);
    assert.match(ausgabe, /REIHENFOLGE 1: Render ELEVENLABS_INBOUND_SIP_USER/);
  });
});

describe("IEL-B10 setzen: Vorab-Riegel, Inventar und Secret", () => {
  it("IEL-B10-6: Vorab-Riegel - fehlender Render-Schluessel, Nummer ohne Registrierung, fremde Zugangsdaten", async () => {
    const ohneSchluessel = await laufe(ARG_SETZEN_AUSFUEHREN, {}, { renderApiKey: "" });
    assert.equal(ohneSchluessel.code, 1);
    assert.match(ohneSchluessel.ausgabe, /RENDER_API_KEY fehlt/);
    assert.equal(ohneSchluessel.aufrufe.length, 0);

    const ohneRegistrierung = await laufe(["setzen", "--nummer=+4930000000001", "--ausfuehren"]);
    assert.equal(ohneRegistrierung.code, 1);
    assert.deepEqual(schreibendeAufrufe(ohneRegistrierung.aufrufe), []);

    const fremd = await laufe(ARG_SETZEN_AUSFUEHREN, { registrierungen: [REG_DID, REG_FREMD_MIT_ZUGANG] });
    assert.equal(fremd.code, 1);
    assert.match(fremd.ausgabe, /phnum_fremd .*halbe Rotation/);
    assert.deepEqual(schreibendeAufrufe(fremd.aufrufe), []);
  });

  it("IEL-B10-6a: offene Fremd-Registrierung beim ersten GET -> nur GETs, ROT", async () => {
    const { code, ausgabe, aufrufe } = await laufe(ARG_SETZEN_AUSFUEHREN, { registrierungen: [REG_DID, REG_OFFEN] });
    assert.equal(code, 1, ausgabe);
    assert.match(ausgabe, /INVENTAR ROT - Registrierung phnum_offen/);
    assert.ok(aufrufe.every((aufruf) => aufruf.methode === METHODE_GET));
  });

  it("IEL-B10-6b: offene Registrierung erst beim abschliessenden Inventar -> ROT, Ziele gesetzt, danach nichts geschrieben", async () => {
    const { code, ausgabe, aufrufe } = await laufe(ARG_SETZEN_AUSFUEHREN, { spaeteRegistrierung: REG_OFFEN });
    assert.equal(code, 1, ausgabe);
    for (const ziel of [...RENDER_ZIELE, SECRET_ZIEL, REG_ZIEL]) assert.match(zielZeile(ausgabe, ziel), /gesetzt: ja/);
    assert.match(ausgabe, /BELEG Inventar \(abschliessend\): ROT/);
    const letzteListe = aufrufe.findLastIndex((aufruf) => aufruf.adresse === `${EL_BASIS}${PHONE_NUMBERS}`);
    assert.deepEqual(schreibendeAufrufe(aufrufe.slice(letzteListe)), []);
  });

  it("IEL-B10-7: bestehendes Secret wird aktualisiert; fremder Locator oder String-Header am Webhook -> ROT", async () => {
    const vorhanden = [{ type: "stored", secret_id: "sec_alt", name: WORKSPACE_SECRET_NAME }];
    const aktualisiert = await laufe(ARG_SETZEN_AUSFUEHREN, { secrets: vorhanden });
    assert.equal(aktualisiert.code, 0, aktualisiert.ausgabe);
    const secretSchreiben = schreibendeAufrufe(aktualisiert.aufrufe).filter((aufruf) => aufruf.adresse.includes(SECRETS));
    assert.deepEqual(secretSchreiben.map((aufruf) => [aufruf.methode, aufruf.adresse]), [["PATCH", `${EL_BASIS}${SECRETS}/sec_alt`]]);
    assert.equal(JSON.parse(secretSchreiben[0].koerper).type, "update");
    assert.match(aktualisiert.ausgabe, /secret_id sec_alt/);

    const klartext = "klartext-header-wert-geheim";
    const faelle = [{ secret_id: "sec_fremd" }, klartext];
    for (const kopf of faelle) {
      const settings = { [WEBHOOK_SCHLUESSEL]: { url: initWebhookUrl(), request_headers: { [INIT_HEADER]: kopf } } };
      const { code, ausgabe } = await laufe(ARG_SETZEN_AUSFUEHREN, { settings });
      assert.equal(code, 1, ausgabe);
      assert.ok(!ausgabe.includes(klartext));
    }
    assert.deepEqual(webhookSecretKonflikt({ settings: {}, secretId: "sec_neu" }), []);
    const eigener = { [WEBHOOK_SCHLUESSEL]: { request_headers: { [INIT_HEADER]: { secret_id: "sec_neu" } } } };
    assert.deepEqual(webhookSecretKonflikt({ settings: eigener, secretId: "sec_neu" }), []);
  });
});

describe("IEL-B10 Render-Listen-Endpunkt", () => {
  it("IEL-B10-5: kein Unterbefehl adressiert .../env-vars ohne Schluessel; leerer bzw. fremder Schluessel wirft vor fetch", async () => {
    const laeufe = [
      [ARG_SETZEN_AUSFUEHREN],
      [["beleg-init"]],
      [["allowlist-uebernehmen", "--ausfuehren"]],
      [["schalter", "--an", "--ausfuehren"]],
      [["schalter", "--aus", "--ausfuehren"]],
      [["stimmen-beleg"]],
      [["scope", "--registrierte-dids", "--ausfuehren"]],
      [["scope", "--allowlist", "--ausfuehren"]],
      [["setzen", ARG_REG, "--ausfuehren"]],
    ];
    for (const [argv] of laeufe) {
      const { code, ausgabe, aufrufe } = await laufe(argv);
      assert.equal(code, 0, `${argv.join(" ")}\n${ausgabe}`);
      assert.ok(aufrufe.every((aufruf) => !/\/env-vars\/?$/.test(aufruf.adresse)), argv.join(" "));
    }
    const aufrufe = [];
    const fetchImpl = async (adresse) => aufrufe.push(adresse);
    await assert.rejects(schreibeRenderEnvVar({ fetchImpl, apiKey: "k", serviceId: HERMES_RENDER_SERVICE_ID, schluessel: "", wert: "x" }));
    await assert.rejects(schreibeDienstEnv({ fetchImpl, renderApiKey: "k" }, { schluessel: "PUBLIC_URL", wert: "x" }));
    assert.equal(aufrufe.length, 0);
  });
});

describe("IEL-B10 beleg-init", () => {
  it("IEL-B10-8: GRUEN nur bei 403/404; Token nie in der Ausgabe; beide POSTs an die Konstante", async () => {
    const faelle = [
      [{ ohneToken: HTTP_FORBIDDEN, mitToken: HTTP_NOT_FOUND }, 0],
      [{ ohneToken: HTTP_NOT_FOUND, mitToken: HTTP_NOT_FOUND }, 1],
      [{ ohneToken: HTTP_FORBIDDEN, mitToken: HTTP_FORBIDDEN }, 1],
    ];
    for (const [initStatus, erwartet] of faelle) {
      const { code, ausgabe, aufrufe } = await laufe(["beleg-init"], { initStatus });
      assert.equal(code, erwartet, ausgabe);
      assert.ok(!ausgabe.includes(LESE_TOKEN));
      const proben = schreibendeAufrufe(aufrufe);
      assert.deepEqual(proben.map((aufruf) => aufruf.adresse), [initWebhookUrl(), initWebhookUrl()]);
      assert.equal(proben[0].kopf[INIT_HEADER], undefined);
      assert.equal(proben[1].kopf[INIT_HEADER], LESE_TOKEN);
      assert.ok(proben.every((aufruf) => aufruf.redirect === "manual"));
    }
  });

  it("IEL-B10-8z: ROTES Ziel-Urteil -> nur Render-GETs, kein Token-GET, 0 Aufrufe an den Ziel-Host; PUBLIC_URL des Prozesses wirkt nicht", async () => {
    const ohnePublicUrl = renderEnvGruen();
    delete ohnePublicUrl.PUBLIC_URL;
    const rot = [
      { renderEnv: { ...renderEnvGruen(), PUBLIC_URL: TUNNEL } },
      { renderEnv: { ...renderEnvGruen(), PUBLIC_URL: "http://app.sundartha.com" } },
      { renderEnv: ohnePublicUrl, serviceUrl: "https://fremd.onrender.com" },
      { renderEnvStatus: { PUBLIC_URL: HTTP_SERVER_ERROR } },
      { domains: [] },
    ];
    const vorher = process.env.PUBLIC_URL;
    try {
      for (const prozessUrl of [TUNNEL, "https://app.sundartha.com"]) {
        process.env.PUBLIC_URL = prozessUrl;
        for (const felder of rot) {
          const { code, ausgabe, aufrufe } = await laufe(["beleg-init"], felder);
          assert.equal(code, 1, ausgabe);
          assert.ok(aufrufe.every((aufruf) => aufruf.methode === METHODE_GET && aufruf.adresse.startsWith(RENDER_API_BASE)), JSON.stringify(felder));
          assert.ok(!aufrufe.some((aufruf) => aufruf.adresse.includes("ELEVENLABS_INIT_WEBHOOK_TOKEN")));
          assert.ok(!aufrufe.some((aufruf) => aufruf.adresse.includes("app.sundartha.com")));
        }
        const gruen = await laufe(["beleg-init"]);
        assert.equal(gruen.code, 0, gruen.ausgabe);
        assert.equal(aufrufeAn(gruen.aufrufe, initWebhookUrl()).length, INIT_PROBEN);
      }
    } finally {
      if (vorher === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = vorher;
    }
  });
});

describe("IEL-B10 allowlist-uebernehmen und schalter", () => {
  it("IEL-B10-9: allowlist - nur genau ein Eintrag wird uebernommen, nie eine Tenant-ID in der Ausgabe", async () => {
    const ohneOwner = renderEnvGruen();
    delete ohneOwner.OWNER_SELF_CALL_TENANT_IDS;
    const rot = [
      { renderEnv: { ...renderEnvGruen(), OWNER_SELF_CALL_TENANT_IDS: "" } },
      { renderEnv: { ...renderEnvGruen(), OWNER_SELF_CALL_TENANT_IDS: `${TENANT_ID},tenant-zwei` } },
      { renderEnv: ohneOwner },
    ];
    for (const felder of rot) {
      const { code, ausgabe, aufrufe } = await laufe(["allowlist-uebernehmen", "--ausfuehren"], felder);
      assert.equal(code, 1, ausgabe);
      assert.deepEqual(schreibendeAufrufe(aufrufe), []);
    }
    const trocken = await laufe(["allowlist-uebernehmen"]);
    assert.equal(trocken.code, 0, trocken.ausgabe);
    assert.deepEqual(schreibendeAufrufe(trocken.aufrufe), []);

    const { code, ausgabe, aufrufe } = await laufe(["allowlist-uebernehmen", "--ausfuehren"]);
    assert.equal(code, 0, ausgabe);
    const schreibend = schreibendeAufrufe(aufrufe);
    assert.deepEqual(schreibend.map((aufruf) => aufruf.adresse), [`${RENDER_DIENST}/env-vars/ELEVENLABS_INBOUND_TENANT_IDS`]);
    assert.equal(JSON.parse(schreibend[0].koerper).value, TENANT_ID);
    assert.ok(!ausgabe.includes(TENANT_ID));
    assert.match(ausgabe, /gleich OWNER_SELF_CALL_TENANT_IDS: ja/);
  });

  it("IEL-B10-10: schalter --an schreibt nur, wenn alle Vorbedingungen GRUEN sind; --aus immer", async () => {
    const [ersteProfilStimme] = Object.values(ELEVENLABS_VOICE_ID_BY_PROFILE);
    const rot = {
      inventar: { registrierungen: [REG_DID, REG_OFFEN] },
      belegInit: { initStatus: { ohneToken: HTTP_NOT_FOUND, mitToken: HTTP_NOT_FOUND } },
      zielUrteil: { renderEnv: { ...renderEnvGruen(), PUBLIC_URL: TUNNEL } },
      profilStimme: { ttsStatus: { [ersteProfilStimme]: HTTP_UNAUTHORIZED } },
      defaultRegel: { renderEnv: { ...renderEnvGruen(), ELEVENLABS_VOICE_ID: "andereStimme" } },
      tokenKurz: { renderEnv: { ...renderEnvGruen(), ELEVENLABS_INIT_WEBHOOK_TOKEN: "kurz" } },
      passwortKurz: { renderEnv: { ...renderEnvGruen(), ELEVENLABS_INBOUND_SIP_PASSWORD: "kurz" } },
    };
    for (const [fall, felder] of Object.entries(rot)) {
      const { code, ausgabe, aufrufe } = await laufe(["schalter", "--an", "--ausfuehren"], felder);
      assert.equal(code, 1, `${fall}\n${ausgabe}`);
      assert.deepEqual(konfigSchreibAufrufe(aufrufe), [], fall);
    }
    const gruen = await laufe(["schalter", "--an", "--ausfuehren"]);
    assert.equal(gruen.code, 0, gruen.ausgabe);
    const [schalter, ...mehr] = konfigSchreibAufrufe(gruen.aufrufe);
    assert.deepEqual(mehr, []);
    assert.equal(schalter.adresse, `${RENDER_DIENST}/env-vars/ELEVENLABS_INBOUND_ENABLED`);
    assert.deepEqual(JSON.parse(schalter.koerper), { value: "true" });
    assert.ok(!gruen.ausgabe.includes(LESE_TOKEN) && !gruen.ausgabe.includes(LESE_PASSWORT));

    const allesRot = { ...rot.inventar, ...rot.zielUrteil, ...rot.profilStimme };
    const aus = await laufe(["schalter", "--aus", "--ausfuehren"], allesRot);
    assert.equal(aus.code, 0, aus.ausgabe);
    assert.deepEqual(konfigSchreibAufrufe(aus.aufrufe).map((aufruf) => JSON.parse(aufruf.koerper)), [{ value: "false" }]);
  });
});

const DID_ZWEI = "+4930123450002";
const REG_ZWEI_MIT_ZUGANG = Object.freeze({
  phone_number_id: "phnum_zwei",
  phone_number: DID_ZWEI,
  assigned_agent: { agent_id: AGENT_ID },
  outbound_trunk: OUTBOUND_TRUNK,
  inbound_trunk: { has_auth_credentials: true, username: "alter-user", allowed_numbers: [DID_ZWEI] },
});
const REIHENFOLGE_SCHRITTE_EINE_REGISTRIERUNG = 5;
const SCOPE_ENV = "ELEVENLABS_INBOUND_SCOPE";
const ARG_SCOPE_DIDS_AUSFUEHREN = Object.freeze(["scope", "--registrierte-dids", "--ausfuehren"]);
const FREMDER_AGENT = Object.freeze({ agent_id: "agent_fremd" });

function ohneFeld(objekt, feld) {
  return Object.fromEntries(Object.entries(objekt).filter(([schluessel]) => schluessel !== feld));
}

function registrierungsPatches(aufrufe) {
  return schreibendeAufrufe(aufrufe).filter((aufruf) => aufruf.adresse.startsWith(`${EL_BASIS}${PHONE_NUMBERS}/`));
}

function zeilenMit(ausgabe, muster) {
  return ausgabe.split("\n").filter((zeile) => muster.test(zeile));
}

describe("IEX-A11 setzen per Registrierung", () => {
  it("IEX-A11-1: --registrierung als Ziel - PATCH mit der Nummer aus dem Inventar, Ausgabe nur Kennung und Endung", async () => {
    const { code, ausgabe, aufrufe } = await laufe(["setzen", ARG_REG, "--ausfuehren"]);
    assert.equal(code, 0, ausgabe);
    assert.deepEqual(
      schreibendeAufrufe(aufrufe).map((aufruf) => [aufruf.methode, aufruf.adresse.replace(RENDER_API_BASE, "R").replace(EL_BASIS, "E")]),
      [
        ["PUT", `R/services/${HERMES_RENDER_SERVICE_ID}/env-vars/ELEVENLABS_INBOUND_SIP_USER`],
        ["PUT", `R/services/${HERMES_RENDER_SERVICE_ID}/env-vars/ELEVENLABS_INBOUND_SIP_PASSWORD`],
        ["PUT", `R/services/${HERMES_RENDER_SERVICE_ID}/env-vars/ELEVENLABS_INIT_WEBHOOK_TOKEN`],
        ["POST", `E${SECRETS}`],
        ["PATCH", `E${PHONE_NUMBERS}/${REG_DID.phone_number_id}`],
      ],
    );
    const [patch] = registrierungsPatches(aufrufe);
    assert.deepEqual(JSON.parse(patch.koerper), trunkKoerper({ geheimnisse: ERWARTET, nummer: DID }));
    assert.ok(!ausgabe.includes(DID), ausgabe);
    assert.match(ausgabe, /BELEG Registrierung phnum_did \(…6788\): has_auth_credentials ja/);
    assertEnthaeltKeinen(ausgabe, ERWARTETE_WERTE);
  });

  it("IEX-A11-2: kein Schreibziel (fremder Agent, ohne Agent, ohne outbound_trunk, unbekannt) -> 0 schreibende Aufrufe", async () => {
    const argv = ["setzen", ARG_REG, "--ausfuehren"];
    const faelle = [
      { argv, felder: { registrierungen: [{ ...REG_DID, assigned_agent: FREMDER_AGENT }] }, befund: /kein Schreibziel \(fremde_registrierung\)/ },
      { argv, felder: { registrierungen: [ohneFeld(REG_DID, "assigned_agent")] }, befund: /kein Schreibziel \(fremde_registrierung\)/ },
      { argv, felder: { registrierungen: [ohneFeld(REG_DID, "outbound_trunk")] }, befund: /kein Schreibziel \(ohne_outbound_trunk\)/ },
      { argv: ["setzen", "--registrierung=phnum_unbekannt", "--ausfuehren"], felder: {}, befund: /--registrierung #1: nicht im Inventar/ },
    ];
    for (const fall of faelle) {
      const { code, ausgabe, aufrufe } = await laufe(fall.argv, fall.felder);
      assert.equal(code, 1, ausgabe);
      assert.match(ausgabe, fall.befund);
      assert.match(ausgabe, /SETZEN ROT - Vorab-Riegel/);
      assert.deepEqual(schreibendeAufrufe(aufrufe), [], ausgabe);
      assert.ok(!ausgabe.includes("phnum_unbekannt"), ausgabe);
    }
  });

  it("IEX-A11-3: dieselbe Registrierung ueber --nummer und --registrierung zaehlt einmal", async () => {
    const { code, ausgabe, aufrufe } = await laufe(["setzen", `--nummer=${DID}`, ARG_REG, "--ausfuehren"]);
    assert.equal(code, 0, ausgabe);
    assert.equal(registrierungsPatches(aufrufe).length, 1);
    assert.equal(zeilenMit(ausgabe, /REIHENFOLGE \d+:/).length, REIHENFOLGE_SCHRITTE_EINE_REGISTRIERUNG);
    assert.equal(zeilenMit(ausgabe, /BELEG Registrierung /).length, 1);
  });

  it("IEX-A11-4: halbe Rotation wird ueber die Kennung geprueft; beide Kennungen -> beide gepatcht", async () => {
    const felder = { registrierungen: [REG_DID, REG_ZWEI_MIT_ZUGANG] };
    const halb = await laufe(["setzen", ARG_REG, "--ausfuehren"], felder);
    assert.equal(halb.code, 1, halb.ausgabe);
    assert.match(halb.ausgabe, /phnum_zwei .*halbe Rotation/);
    assert.deepEqual(schreibendeAufrufe(halb.aufrufe), []);

    const beide = await laufe(["setzen", ARG_REG, "--registrierung=phnum_zwei", "--ausfuehren"], felder);
    assert.equal(beide.code, 0, beide.ausgabe);
    const patches = registrierungsPatches(beide.aufrufe);
    assert.deepEqual(
      patches.map((aufruf) => aufruf.adresse),
      [`${EL_BASIS}${PHONE_NUMBERS}/phnum_did`, `${EL_BASIS}${PHONE_NUMBERS}/phnum_zwei`],
    );
    const erlaubt = patches.map((aufruf) => JSON.parse(aufruf.koerper).inbound_trunk_config.allowed_numbers);
    assert.deepEqual(erlaubt, [[DID], [DID_ZWEI]]);
  });

  it("IEX-A11-5: der Schreibziel-Riegel gilt auch fuer --nummer; ohne ELEVENLABS_AGENT_ID kein Aufruf", async () => {
    const fremd = await laufe(ARG_SETZEN_AUSFUEHREN, { registrierungen: [{ ...REG_DID, assigned_agent: FREMDER_AGENT }] });
    assert.equal(fremd.code, 1, fremd.ausgabe);
    assert.match(fremd.ausgabe, /kein Schreibziel \(fremde_registrierung\)/);
    assert.deepEqual(schreibendeAufrufe(fremd.aufrufe), []);

    const ohneAgent = await laufe(ARG_SETZEN_AUSFUEHREN, {}, { elKonto: { apiKey: "el-test", apiBase: EL_BASIS, agentId: "" } });
    assert.equal(ohneAgent.code, 1, ohneAgent.ausgabe);
    assert.match(ohneAgent.ausgabe, /ELEVENLABS_AGENT_ID fehlt/);
    assert.equal(ohneAgent.aufrufe.length, 0);
  });
});

describe("IEX-A11 scope und Argumente", () => {
  it("IEX-A11-6: scope --registrierte-dids schreibt nur nach GRUENEM Inventar und beleg-init", async () => {
    const rot = {
      inventar: { registrierungen: [REG_DID, REG_OFFEN] },
      belegInit: { initStatus: { ohneToken: HTTP_NOT_FOUND, mitToken: HTTP_NOT_FOUND } },
      zielUrteil: { renderEnv: { ...renderEnvGruen(), PUBLIC_URL: TUNNEL } },
    };
    for (const [fall, felder] of Object.entries(rot)) {
      const { code, ausgabe, aufrufe } = await laufe(ARG_SCOPE_DIDS_AUSFUEHREN, felder);
      assert.equal(code, 1, `${fall}\n${ausgabe}`);
      assert.deepEqual(konfigSchreibAufrufe(aufrufe), [], fall);
      assert.match(ausgabe, /SCOPE ROT - ELEVENLABS_INBOUND_SCOPE unveraendert/, fall);
    }

    const trocken = await laufe(["scope", "--registrierte-dids"]);
    assert.equal(trocken.code, 0, trocken.ausgabe);
    assert.deepEqual(konfigSchreibAufrufe(trocken.aufrufe), []);
    assert.match(trocken.ausgabe, /TROCKENLAUF - wuerde ELEVENLABS_INBOUND_SCOPE=registrierte_dids setzen/);

    const gruen = await laufe(ARG_SCOPE_DIDS_AUSFUEHREN);
    assert.equal(gruen.code, 0, gruen.ausgabe);
    const [put, ...mehr] = konfigSchreibAufrufe(gruen.aufrufe);
    assert.deepEqual(mehr, []);
    assert.equal(put.adresse, `${RENDER_DIENST}/env-vars/${SCOPE_ENV}`);
    assert.deepEqual(JSON.parse(put.koerper), { value: "registrierte_dids" });
    assert.equal(gruen.zustand.env.get(SCOPE_ENV), "registrierte_dids");
    assert.ok(!gruen.ausgabe.includes(LESE_TOKEN), gruen.ausgabe);
  });

  it("IEX-A11-7: scope --allowlist schreibt bedingungslos und braucht nur RENDER_API_KEY", async () => {
    const allesRot = {
      registrierungen: [REG_DID, REG_OFFEN],
      renderEnv: { ...renderEnvGruen(), PUBLIC_URL: TUNNEL },
      initStatus: { ohneToken: HTTP_NOT_FOUND, mitToken: HTTP_NOT_FOUND },
    };
    const ohneElKonto = { elKonto: { apiKey: "", apiBase: EL_BASIS, agentId: "" } };
    const { code, ausgabe, aufrufe } = await laufe(["scope", "--allowlist", "--ausfuehren"], allesRot, ohneElKonto);
    assert.equal(code, 0, ausgabe);
    assert.deepEqual(
      konfigSchreibAufrufe(aufrufe).map((aufruf) => [aufruf.adresse, JSON.parse(aufruf.koerper)]),
      [[`${RENDER_DIENST}/env-vars/${SCOPE_ENV}`, { value: "allowlist" }]],
    );
    assert.deepEqual(aufrufeAn(aufrufe, EL_BASIS), []);
    assert.deepEqual(aufrufeAn(aufrufe, initWebhookUrl()), []);

    const trocken = await laufe(["scope", "--allowlist"], allesRot, ohneElKonto);
    assert.equal(trocken.code, 0, trocken.ausgabe);
    assert.deepEqual(schreibendeAufrufe(trocken.aufrufe), []);
  });

  it("IEX-A11-8: kaputte scope-/setzen-Argumente und fehlender EL-Schluessel brechen vor jedem fetch ab", async () => {
    const faelle = [
      ["scope"],
      ["scope", "--registrierte-dids", "--allowlist"],
      ["scope", "--registrierte-dids", `--nummer=${DID}`],
      ["setzen", ARG_REG, ARG_REG],
      ["schalter", "--an", "--registrierte-dids"],
    ];
    for (const argv of faelle) {
      const { code, aufrufe } = await laufe(argv);
      assert.equal(code, 1, argv.join(" "));
      assert.equal(aufrufe.length, 0, argv.join(" "));
      assert.ok(leseArgumente(argv).fehler, argv.join(" "));
    }
    const ohneElKey = await laufe(["scope", "--registrierte-dids"], {}, { elKonto: { apiKey: "", apiBase: EL_BASIS, agentId: AGENT_ID } });
    assert.equal(ohneElKey.code, 1, ohneElKey.ausgabe);
    assert.match(ohneElKey.ausgabe, /ELEVENLABS_API_KEY fehlt/);
    assert.equal(ohneElKey.aufrufe.length, 0);
    assert.deepEqual(leseArgumente(["setzen", ARG_REG, "--registrierung=phnum_zwei"]).registrierungsKennungen, ["phnum_did", "phnum_zwei"]);
  });
});

describe("IEL-B10 stimmen-beleg", () => {
  it("IEL-B10-11: E19-Tabelle, Modell-Hinweis, fehlendes model_id und unlesbarer Dienst", async () => {
    const alle200 = [{ voiceId: "a", status: HTTP_OK }, { voiceId: "b", status: HTTP_OK }];
    const einer401 = [{ voiceId: "a", status: HTTP_OK }, { voiceId: "b", status: HTTP_UNAUTHORIZED }];
    const tabelle = [
      [{ profilProben: alle200, telnyxVoice: "t", telnyxProbe: HTTP_OK, agentVoice: "x", playVoice: "y" }, true],
      [{ profilProben: einer401, telnyxVoice: "t", telnyxProbe: HTTP_OK, agentVoice: "x", playVoice: "x" }, false],
      [{ profilProben: alle200, telnyxVoice: "t", telnyxProbe: HTTP_UNAUTHORIZED, agentVoice: "x", playVoice: "x" }, false],
      [{ profilProben: alle200, telnyxVoice: "", telnyxProbe: null, agentVoice: "x", playVoice: "x" }, true],
      [{ profilProben: alle200, telnyxVoice: "", telnyxProbe: null, agentVoice: "x", playVoice: "y" }, false],
      [{ profilProben: alle200, telnyxVoice: "", telnyxProbe: null, agentVoice: "", playVoice: "" }, false],
    ];
    for (const [eingabe, gruen] of tabelle) assert.equal(stimmenUrteil(eingabe).gruen, gruen, JSON.stringify(eingabe));

    const modellAnders = await laufe(["stimmen-beleg"], { renderEnv: { ...renderEnvGruen(), ELEVENLABS_MODEL: "eleven_flash_v2_5" } });
    assert.equal(modellAnders.code, 0, modellAnders.ausgabe);
    assert.match(modellAnders.ausgabe, /HINWEIS Modell.*gleich nein/);

    const mitTelnyx = await laufe(["stimmen-beleg"], { renderEnv: { ...renderEnvGruen(), TELNYX_ELEVENLABS_VOICE_ID: "telnyxStimme" } });
    assert.equal(mitTelnyx.code, 0, mitTelnyx.ausgabe);
    assert.equal(aufrufeAn(mitTelnyx.aufrufe, EL_BASIS).filter((aufruf) => aufruf.adresse.includes("/telnyxStimme/stream")).length, 1);

    const ohneModell = await laufe(["stimmen-beleg"], { agent: { conversation_config: { tts: { voice_id: AGENT_STIMME } } } });
    assert.equal(ohneModell.code, 1, ohneModell.ausgabe);

    const dienstUnlesbar = await laufe(["stimmen-beleg"], { renderServiceStatus: HTTP_NOT_FOUND });
    assert.equal(dienstUnlesbar.code, 1, dienstUnlesbar.ausgabe);
  });
});

describe("IEL-B10 Ausgabe-Waechter", () => {
  it("IEL-B10-12: eine Zeile mit verbotenem Wert wird verworfen; leerer Wert blockiert nichts; runCli wird ROT", async () => {
    const zeilen = [];
    const kanal = { write: (text) => zeilen.push(text) };
    const waechter = makeAusgabeWaechter({ stdout: kanal, stderr: kanal });
    waechter.verbiete("");
    waechter.info("harmlos");
    assert.equal(waechter.verworfen(), false);
    const verboten = "verbotener-wert-xyz";
    waechter.verbiete(verboten);
    waechter.info(`x ${verboten} y`);
    assert.equal(waechter.verworfen(), true);
    assert.ok(!zeilen.join("").includes(verboten));
    assert.match(zeilen.join(""), /harmlos/);

    const token = "ohne Token HTTP 403 (erwartet 403), mit Token";
    const { code, ausgabe } = await laufe(["beleg-init"], { renderEnv: { ...renderEnvGruen(), ELEVENLABS_INIT_WEBHOOK_TOKEN: token } });
    assert.equal(code, 1, ausgabe);
    assert.match(ausgabe, /ZEILE VERWORFEN/);
    assert.ok(!ausgabe.includes(token));
  });
});

const ARG_CONVERSATION = Object.freeze(["conversation-beleg", "--richtung=inbound", `--seit=${SEIT}`]);

describe("IEL-B10 conversation-beleg", () => {
  it("IEL-B10-13: nur abgeleitete Felder, geheime Variablen verboten, neueste Conversation der Richtung", async () => {
    const { code, ausgabe, aufrufe } = await laufe(ARG_CONVERSATION);
    assert.equal(code, 0, ausgabe);
    assert.ok(!ausgabe.includes(TENANT_TOKEN) && !ausgabe.includes(BINDUNG));
    assert.match(ausgabe, new RegExp(`Variable tenant_token: vorhanden: ja, leer: nein, Laenge ${TENANT_TOKEN.length}`));
    assert.match(ausgabe, /inbound_situation == "": ja/);
    assert.match(ausgabe, /uebrige dynamic_variables \(nur Namen\): tenant_name/);
    assert.match(ausgabe, /conversation_id conv_neu/);
    assert.equal(aufrufeAn(aufrufe, `${EL_BASIS}${CONVERSATIONS}/conv_neu`).length, 1);
    const liste = new URL(aufrufeAn(aufrufe, `${EL_BASIS}${CONVERSATIONS}?`)[0].adresse);
    assert.equal(liste.searchParams.get("call_start_after_unix"), String(Math.floor(Date.parse(SEIT) / MS_JE_S)));

    const eingebettet = await laufe(ARG_CONVERSATION, { conversation: conversationDetail({ agentZeile: `Ihr Token ${TENANT_TOKEN}` }) });
    assert.equal(eingebettet.code, 1, eingebettet.ausgabe);
    assert.ok(!eingebettet.ausgabe.includes(TENANT_TOKEN));

    const nurOutbound = { conversations: [{ conversation_id: "conv_out", direction: "outbound", start_time_unix_secs: 1 }], has_more: false };
    assert.equal((await laufe(ARG_CONVERSATION, { conversationListe: nurOutbound })).code, 1);
    assert.equal((await laufe(ARG_CONVERSATION, { conversationListe: { ...szenario().conversationListe, has_more: true } })).code, 1);

    const mitNummer = await laufe([...ARG_CONVERSATION, `--nummer=${DID}`]);
    assert.match(mitNummer.ausgabe, /phone_number_id == Registrierung: ja/);
    const fremdeNummer = await laufe([...ARG_CONVERSATION, `--nummer=${DID}`], { conversation: conversationDetail({ phoneNumberId: "phnum_x" }) });
    assert.match(fremdeNummer.ausgabe, /phone_number_id == Registrierung: nein/);

    assert.deepEqual(variablenBeleg({ tenant_token: "abc" }).variablen[1], { name: "inbound_situation", vorhanden: false, leer: true, laenge: 0 });
  });

  it("IEL-B10-13a: Token an der Kuerzungsgrenze wird UNGEKUERZT geprueft; Kontrollfall wird gekuerzt", async () => {
    const zeile = `${"x".repeat(ERSTE_ZEILE_MAX_ZEICHEN - K_GRENZE)}${TENANT_TOKEN} rest`;
    const grenze = await laufe(ARG_CONVERSATION, { conversation: conversationDetail({ agentZeile: zeile }) });
    assert.equal(grenze.code, 1, grenze.ausgabe);
    assert.ok(!grenze.ausgabe.includes(TENANT_TOKEN.slice(0, K_GRENZE)), grenze.ausgabe);

    const kontrolle = `${"y".repeat(ERSTE_ZEILE_MAX_ZEICHEN)}ueberhang`;
    const gekuerzt = await laufe(ARG_CONVERSATION, { conversation: conversationDetail({ agentZeile: kontrolle }) });
    assert.equal(gekuerzt.code, 0, gekuerzt.ausgabe);
    assert.ok(gekuerzt.ausgabe.includes(`erste Agent-Zeile: ${kontrolle.slice(0, ERSTE_ZEILE_MAX_ZEICHEN)}\n`));
    assert.ok(!gekuerzt.ausgabe.includes("ueberhang"));
  });

  it("IEX-A6-1: conversation-beleg meldet erste Agent-Zeile unterbrochen ja/nein/fehlt", async () => {
    const faelle = [
      { conversation: conversationDetail({ agentUnterbrochen: true }), erwartet: "ja" },
      { conversation: conversationDetail({ agentUnterbrochen: false }), erwartet: "nein" },
      { conversation: conversationDetail(), erwartet: "fehlt" },
      { conversation: { ...conversationDetail(), transcript: [] }, erwartet: "fehlt" },
    ];
    for (const { conversation, erwartet } of faelle) {
      const { code, ausgabe } = await laufe(ARG_CONVERSATION, { conversation });
      assert.equal(code, 0, ausgabe);
      assert.ok(ausgabe.includes(`erste Agent-Zeile unterbrochen: ${erwartet}\n`), ausgabe);
    }
  });

  it("IEX-A6-2: Unterbrechung kommt aus dem ERSTEN Agent-Eintrag; alles Nicht-Boolesche ist fehlt, nie nein", () => {
    const agent = (felder) => ({ role: "agent", message: "x", ...felder });
    const tabelle = [
      { transcript: undefined, erwartet: "fehlt" },
      { transcript: [{ role: "user", message: "hallo", interrupted: true }], erwartet: "fehlt" },
      { transcript: [{ role: "user", interrupted: true }, agent({ interrupted: false })], erwartet: "nein" },
      { transcript: [agent({ interrupted: false }), agent({ interrupted: true })], erwartet: "nein" },
      { transcript: [agent({ message: null, interrupted: true }), agent({ interrupted: false })], erwartet: "ja" },
      { transcript: [agent({ interrupted: "true" })], erwartet: "fehlt" },
      { transcript: [agent({ interrupted: null })], erwartet: "fehlt" },
      { transcript: [agent({ interrupted: 0 })], erwartet: "fehlt" },
    ];
    for (const { transcript, erwartet } of tabelle) {
      assert.equal(ersterAgentEintragUnterbrochen(transcript), erwartet, JSON.stringify(transcript));
    }
  });
});

describe("IEL-B10 Argumente", () => {
  it("IEL-B10-16: kaputte Argumente brechen vor jedem fetch ab", async () => {
    const faelle = [
      ["loeschen"],
      ["schalter", "--an", "--aus"],
      ["schalter"],
      ["setzen", `--nummer=${DID}`, `--nummer=${DID}`],
      ["setzen"],
      ["conversation-beleg", "--richtung=inbound", "--seit=kaputt"],
      ["conversation-beleg", "--richtung=seitwaerts", `--seit=${SEIT}`],
      ["beleg-init", "--ausfuehren"],
    ];
    for (const argv of faelle) {
      const { code, aufrufe } = await laufe(argv);
      assert.equal(code, 1, argv.join(" "));
      assert.equal(aufrufe.length, 0, argv.join(" "));
      assert.ok(leseArgumente(argv).fehler, argv.join(" "));
    }
    assert.deepEqual(leseArgumente(["setzen", `--nummer=${DID}`, "--nummer=+4930123456789"]).nummern, [DID, "+4930123456789"]);
  });
});

function sammleKind({ nodeArgs, env }) {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ausgabe = "";
  child.stdout.on("data", (teil) => (ausgabe += teil));
  child.stderr.on("data", (teil) => (ausgabe += teil));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Kindprozess nicht rechtzeitig beendet:\n${ausgabe}`));
    }, SPAWN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, ausgabe });
    });
  });
}

const STUB_NUMMER = "+490000000000";
const STUB_AGENT = "agent_stub";

function stubAntwort(url) {
  const registrierung = {
    phone_number_id: "phnum_stub",
    phone_number: STUB_NUMMER,
    assigned_agent: { agent_id: STUB_AGENT },
    outbound_trunk: { address: "sip.telnyx.com" },
  };
  if (url === PHONE_NUMBERS) return { status: HTTP_OK, koerper: [registrierung] };
  if (url === `${PHONE_NUMBERS}/phnum_stub`) return { status: HTTP_OK, koerper: registrierung };
  if (url.startsWith(`${SECRETS}?`)) return { status: HTTP_OK, koerper: { secrets: [] } };
  return { status: HTTP_NOT_FOUND, koerper: {} };
}

async function mitStub(lauf) {
  const treffer = [];
  const server = http.createServer((req, res) => {
    treffer.push({ url: req.url, methode: req.method });
    const { status, koerper } = stubAntwort(req.url);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(koerper));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await lauf({ basis: `http://127.0.0.1:${server.address().port}`, treffer });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function geheimnisDateien() {
  return fs
    .readdirSync(path.join(ROOT, "scripts"))
    .filter((name) => /^iel-geheimnisse.*\.mjs$/.test(name))
    .map((name) => ({ name, text: fs.readFileSync(path.join(ROOT, "scripts", name), "utf8") }));
}

describe("IEL-B10 ohne Store und Quelltext-Pins", () => {
  it("IEL-B10-14: setzen-Trockenlauf als Kindprozess laedt den Store nie (Import-Spion mit Positiv-Kontrolle)", async () => {
    const spion = ["--import", pathToFileURL(path.join(ROOT, "test/_import-spion-store.mjs")).href];
    await mitStub(async ({ basis, treffer }) => {
      const { code, ausgabe } = await sammleKind({
        nodeArgs: [...spion, "scripts/iel-geheimnisse.mjs", "setzen", `--nummer=${STUB_NUMMER}`],
        env: {
          STORE_BACKEND: "pg",
          DATABASE_URL: "postgres://127.0.0.1:1/unerreichbar",
          ELEVENLABS_API_KEY: "stub",
          ELEVENLABS_API_BASE: basis,
          ELEVENLABS_AGENT_ID: STUB_AGENT,
          RENDER_API_KEY: "dummy",
        },
      });
      assert.equal(code, 0, ausgabe);
      assert.match(ausgabe, /TROCKENLAUF/);
      assert.ok(!ausgabe.includes(SPION_MARKE), ausgabe);
      assert.ok(!/store/i.test(ausgabe), ausgabe);
      assert.ok(treffer.length > 0 && treffer.every((eintrag) => eintrag.methode === METHODE_GET), JSON.stringify(treffer));
    });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iel-b10-spion-"));
    const kontrolle = await sammleKind({
      nodeArgs: [...spion, "--input-type=module", "-e", 'await import("./src/store.js")'],
      env: { DATA_DIR: dataDir },
    });
    assert.ok(kontrolle.ausgabe.includes(SPION_MARKE), `Positiv-Kontrolle: der Spion sieht nichts\n${kontrolle.ausgabe}`);
  });

  it("IEL-B10-15: Quelltext-Pins ueber alle scripts/iel-geheimnisse*.mjs mit Positiv-Kontrollen", () => {
    const dateien = geheimnisDateien();
    const publicUrlZugriff = /config(\.server)?\.publicUrl|process\.env\.PUBLIC_URL/;
    for (const { name, text } of dateien) {
      assert.ok(!text.includes("process.env.ELEVENLABS_INBOUND_SIP_PASSWORD"), name);
      assert.ok(!text.includes("config.voice.elevenLabsInbound"), name);
      assert.doesNotMatch(text, publicUrlZugriff, name);
      assert.ok(!text.includes("src/store"), name);
    }
    assert.match("const x = config.server.publicUrl;", publicUrlZugriff, "Positiv-Kontrolle des Musters");
    assert.ok(dateien.some(({ text }) => text.includes("HERMES_RENDER_SERVICE_ID")), "Positiv-Kontrolle Service-ID");
    const einstieg = dateien.find(({ name }) => name === "iel-geheimnisse.mjs");
    const importe = [...einstieg.text.matchAll(/from "\.\/(iel-geheimnisse-[a-z]+\.mjs)"/g)].map((treffer) => treffer[1]);
    assert.ok(importe.length > 0, "Positiv-Kontrolle: keine Hilfsmodul-Importe gefunden");
    for (const modul of importe) assert.ok(dateien.some(({ name }) => name === modul), modul);
  });
});
