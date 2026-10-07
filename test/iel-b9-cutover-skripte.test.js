import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { livePfadeVon, wertAnPfad } from "../scripts/lib/elevenlabs-besitz.mjs";
import {
  HERMES_GATEWAY_ORIGINS,
  HERMES_RENDER_SERVICE_ID,
  INIT_WEBHOOK_ORIGIN,
  ZIEL_GRUND,
  ZIEL_URTEIL,
  initWebhookUrl,
  renderDienstZiel,
  zielUrteil,
} from "../src/elevenlabs/init-webhook-ziel.js";
import { inboundElAllowlistProbeLine, e164Endung } from "../src/elevenlabs/inbound-path-decision.js";
import {
  REGISTRIERUNG_KLASSE,
  inventarSchnappschuss,
  registrierungenMitNummer,
  registrierungsKlasse,
} from "../src/elevenlabs/nummern-registrierung.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";
import { BASE_ENV, ROOT } from "./helpers.js";
import { SPION_MARKE } from "./_import-spion-store.mjs";
import {
  LIVE_MIT_DATENSCHUTZ,
  METHODE_GET,
  TEST_SCHLUESSEL,
  laufeMitRouter,
  schreibendeAufrufe,
} from "./helpers/elevenlabs-push-attrappe.mjs";

const RENDER_TEST_SCHLUESSEL = "test-render-schluessel";
process.env.ELEVENLABS_API_KEY = TEST_SCHLUESSEL;
process.env.RENDER_API_KEY = RENDER_TEST_SCHLUESSEL;
const { runCli } = await import("../scripts/push-elevenlabs.mjs");
const { ladeVorlage } = await import("../scripts/lib/elevenlabs-agent-lesen.mjs");
const { trunkInventar, registrierungLoeschen } = await import("../scripts/el-nummern-registrierung.mjs");

const VORLAGE = ladeVorlage();
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const SPAWN_TIMEOUT_MS = 15000;
const RENDER_API = "https://api.render.com/v1/services/";
const RENDER_HOST_PRAEFIX = "https://api.render.com/";
const SETTINGS_PFAD = "/v1/convai/settings";
const AGENTEN_PFAD = "/v1/convai/agents/";
const METHODE_PATCH = "PATCH";
const METHODE_DELETE = "DELETE";
const SECRET_ID = "sec_b9_test";
const INIT_HEADER = "x-hermes-init-token";
const WEBHOOK_SCHLUESSEL = "conversation_initiation_client_data_webhook";
const ONRENDER = "https://vodafone-agent.onrender.com";
const TUNNEL = "https://x.trycloudflare.com";
const SUNDARTHA_HOST = "app.sundartha.com";
const DOMAINS_LIMIT = 100;
const AUFRUFE_BIS_ENV_GET = 2;
const MIN_WERKZEUG_URLS = 2;
const HARNESS_ERGEBNIS_MARKE = "IEL-B9-ERGEBNIS";
const SCHALTER_FELD = "init_webhook_schalter";
const FREIGABEN_FELD = "conversation_config_override_erlaubnisse";
const [SCHALTER_PFAD] = livePfadeVon(VORLAGE, SCHALTER_FELD);
const [KARTE_PFAD] = livePfadeVon(VORLAGE, FREIGABEN_FELD);
const SETZ_ARGUMENTE = ["--workspace-init-webhook", `--secret-id=${SECRET_ID}`];

function blattPfade(wert, praefix = "") {
  if (wert === null || typeof wert !== "object" || Array.isArray(wert)) return [praefix];
  return Object.entries(wert).flatMap(([name, kind]) => blattPfade(kind, praefix ? `${praefix}.${name}` : name));
}

function stringWerteAnSchluessel(wert, schluessel) {
  if (wert === null || typeof wert !== "object") return [];
  return Object.entries(wert).flatMap(([name, kind]) => [
    ...(name === schluessel && typeof kind === "string" ? [kind] : []),
    ...stringWerteAnSchluessel(kind, schluessel),
  ]);
}

function assertKeinVerbotenerKoerper(aufrufe) {
  for (const { koerper } of aufrufe.filter((aufruf) => typeof aufruf.koerper === "string")) {
    assert.ok(!koerper.includes('"credentials"'), "ein Koerper traegt credentials");
    assert.ok(!koerper.includes('"allowed_numbers":[]'), "ein Koerper leert allowed_numbers");
    assert.deepEqual(stringWerteAnSchluessel(JSON.parse(koerper), INIT_HEADER), [], "Init-Header als String");
  }
}

function antwort(koerper, status = HTTP_OK) {
  return { status, koerper };
}

function domainEintrag(name, verificationStatus = "verified") {
  return { customDomain: { name, verificationStatus }, cursor: `c-${name}` };
}

const DIENST_GRUEN = Object.freeze({
  serviceStatus: HTTP_OK,
  serviceUrl: ONRENDER,
  envStatus: HTTP_OK,
  publicUrl: "https://app.sundartha.com",
  domainsStatus: HTTP_OK,
  domains: [domainEintrag(SUNDARTHA_HOST)],
});

function renderAntwort(adresse, dienst) {
  if (adresse.includes("/env-vars/")) return antwort({ key: "PUBLIC_URL", value: dienst.publicUrl }, dienst.envStatus);
  if (adresse.includes("/custom-domains")) return antwort(dienst.domains, dienst.domainsStatus);
  return antwort({ serviceDetails: { url: dienst.serviceUrl } }, dienst.serviceStatus);
}

function settingsRouter({ dienst = DIENST_GRUEN, vorher, nachher = vorher }) {
  let geschrieben = false;
  return (aufruf) => {
    if (aufruf.adresse.startsWith(RENDER_API)) return renderAntwort(aufruf.adresse, dienst);
    if (aufruf.methode === METHODE_PATCH) geschrieben = true;
    return antwort(geschrieben ? nachher : vorher);
  };
}

function agentRouter({ vorher, nachher = vorher }) {
  let geschrieben = false;
  return (aufruf) => {
    if (aufruf.methode === METHODE_PATCH) geschrieben = true;
    return antwort(geschrieben ? nachher : vorher);
  };
}

function renderAufrufe(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.adresse.startsWith(RENDER_HOST_PRAEFIX));
}

function nichtRenderAufrufe(aufrufe) {
  return aufrufe.filter((aufruf) => !aufruf.adresse.startsWith(RENDER_HOST_PRAEFIX));
}

function patches(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.methode === METHODE_PATCH);
}

function pushMit(argumente, antworte) {
  return laufeMitRouter({ runCli, argumente, antworte });
}

function mitAusgabe(lauf) {
  const zeilen = [];
  const echtesLog = console.log;
  const echtesError = console.error;
  console.log = (zeile) => zeilen.push(zeile);
  console.error = (zeile) => zeilen.push(zeile);
  return lauf().then(
    (code) => {
      console.log = echtesLog;
      console.error = echtesError;
      return { code, ausgabe: zeilen.join("\n") };
    },
    (fehler) => {
      console.log = echtesLog;
      console.error = echtesError;
      throw fehler;
    },
  );
}

function sammleProzess(child) {
  let ausgabe = "";
  child.stdout.on("data", (chunk) => (ausgabe += chunk.toString()));
  child.stderr.on("data", (chunk) => (ausgabe += chunk.toString()));
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

function starteKind({ nodeArgs, env }) {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return sammleProzess(child);
}

function dienst(felder) {
  return { lesbar: true, publicUrlEnv: null, serviceUrl: ONRENDER, dienstHosts: ["vodafone-agent.onrender.com", SUNDARTHA_HOST], ...felder };
}

function renderFake(szenario) {
  const aufrufe = [];
  const fetchImpl = async (adresse, optionen = {}) => {
    aufrufe.push({ adresse: String(adresse), methode: optionen.method, kopf: optionen.headers });
    const { status, koerper } = renderAntwort(String(adresse), szenario);
    return { status, ok: status === HTTP_OK, json: async () => koerper };
  };
  return { aufrufe, fetchImpl };
}

const INIT_ADRESSE_AUSGEBEN =
  "import(\"./src/elevenlabs/init-webhook-ziel.js\").then((modul) => process.stdout.write(modul.initWebhookUrl()));";

describe("IEL-B9 A: Ziel-Urteil", () => {
  it("IEL-B9-1: zielUrteil - GRUEN nur bei erlaubtem https-Origin und zugeordneter Init-Domain", () => {
    const faelle = [
      [dienst({ publicUrlEnv: ONRENDER }), ZIEL_URTEIL.GRUEN, null],
      [dienst({ publicUrlEnv: null, serviceUrl: ONRENDER }), ZIEL_URTEIL.GRUEN, null],
      [dienst({ publicUrlEnv: "", serviceUrl: ONRENDER }), ZIEL_URTEIL.GRUEN, null],
      [dienst({ publicUrlEnv: TUNNEL }), ZIEL_URTEIL.ROT, ZIEL_GRUND.ORIGIN_NICHT_ERLAUBT],
      [dienst({ publicUrlEnv: "http://app.sundartha.com" }), ZIEL_URTEIL.ROT, ZIEL_GRUND.ORIGIN_NICHT_HTTPS],
      [dienst({ publicUrlEnv: null, serviceUrl: null }), ZIEL_URTEIL.ROT, ZIEL_GRUND.ORIGIN_LEER],
      [dienst({ publicUrlEnv: "keine adresse" }), ZIEL_URTEIL.ROT, ZIEL_GRUND.ORIGIN_UNGUELTIG],
      [dienst({ dienstHosts: ["vodafone-agent.onrender.com"] }), ZIEL_URTEIL.ROT, ZIEL_GRUND.HOST_NICHT_ZUGEORDNET],
      [{ lesbar: false, grund: ZIEL_GRUND.RENDER_STATUS, status: HTTP_SERVER_ERROR }, ZIEL_URTEIL.ROT, ZIEL_GRUND.RENDER_STATUS],
    ];
    for (const [eingabe, urteil, grund] of faelle) {
      const ergebnis = zielUrteil(eingabe);
      assert.equal(ergebnis.urteil, urteil, JSON.stringify(eingabe));
      assert.equal(ergebnis.grund, grund, JSON.stringify(eingabe));
    }
  });

  it("IEL-B9-1b: eine UNVERIFIZIERTE Custom-Domain ordnet den Init-Host nicht zu", async () => {
    const { fetchImpl } = renderFake({ ...DIENST_GRUEN, domains: [domainEintrag(SUNDARTHA_HOST, "unverified")] });
    const gelesen = await renderDienstZiel({ fetchImpl, apiKey: RENDER_TEST_SCHLUESSEL, serviceId: HERMES_RENDER_SERVICE_ID });
    assert.equal(zielUrteil(gelesen).grund, ZIEL_GRUND.HOST_NICHT_ZUGEORDNET);
  });

  it("IEL-B9-2: renderDienstZiel - nur GET mit Bearer, Abbruch beim ersten Nicht-OK, Schluessel nie im Ergebnis", async () => {
    const ohneSchluessel = renderFake(DIENST_GRUEN);
    const ohne = await renderDienstZiel({ fetchImpl: ohneSchluessel.fetchImpl, apiKey: "", serviceId: HERMES_RENDER_SERVICE_ID });
    assert.deepEqual(ohne, { lesbar: false, grund: ZIEL_GRUND.API_KEY_FEHLT });
    assert.equal(ohneSchluessel.aufrufe.length, 0);

    const lies = async (szenario) => {
      const fake = renderFake(szenario);
      const ergebnis = await renderDienstZiel({ fetchImpl: fake.fetchImpl, apiKey: RENDER_TEST_SCHLUESSEL, serviceId: HERMES_RENDER_SERVICE_ID });
      return { ergebnis, aufrufe: fake.aufrufe };
    };
    const service404 = await lies({ ...DIENST_GRUEN, serviceStatus: HTTP_NOT_FOUND });
    assert.equal(service404.aufrufe.length, 1);
    assert.deepEqual(service404.ergebnis, { lesbar: false, grund: ZIEL_GRUND.RENDER_STATUS, status: HTTP_NOT_FOUND });

    const env404 = await lies({ ...DIENST_GRUEN, envStatus: HTTP_NOT_FOUND });
    assert.equal(env404.ergebnis.lesbar, true);
    assert.equal(env404.ergebnis.publicUrlEnv, null);

    const env500 = await lies({ ...DIENST_GRUEN, envStatus: HTTP_SERVER_ERROR });
    assert.equal(env500.ergebnis.lesbar, false);
    assert.equal(env500.aufrufe.length, AUFRUFE_BIS_ENV_GET, "nach dem Nicht-OK kein weiterer fetch");

    const volleSeite = Array.from({ length: DOMAINS_LIMIT }, (_leer, i) => domainEintrag(`d${i}.example`));
    const voll = await lies({ ...DIENST_GRUEN, domains: volleSeite });
    assert.equal(voll.ergebnis.grund, ZIEL_GRUND.DOMAINS_UNVOLLSTAENDIG);

    const gruen = await lies(DIENST_GRUEN);
    assert.deepEqual(gruen.ergebnis.dienstHosts, ["vodafone-agent.onrender.com", SUNDARTHA_HOST]);
    for (const aufruf of gruen.aufrufe) {
      assert.equal(aufruf.methode, METHODE_GET);
      assert.ok(aufruf.adresse.startsWith(`${RENDER_API}${HERMES_RENDER_SERVICE_ID}`), aufruf.adresse);
      assert.equal(aufruf.kopf.Authorization, `Bearer ${RENDER_TEST_SCHLUESSEL}`);
    }
    for (const { ergebnis } of [service404, env404, env500, voll, gruen]) {
      assert.ok(!JSON.stringify(ergebnis).includes(RENDER_TEST_SCHLUESSEL));
    }
  });

  it("IEL-B9-2b: ein fetch-Wurf ist 'nicht erreichbar', kein Absturz", async () => {
    const fetchImpl = async () => {
      throw new Error("netz weg");
    };
    const ergebnis = await renderDienstZiel({ fetchImpl, apiKey: RENDER_TEST_SCHLUESSEL, serviceId: HERMES_RENDER_SERVICE_ID });
    assert.deepEqual(ergebnis, { lesbar: false, grund: ZIEL_GRUND.RENDER_NICHT_ERREICHBAR });
  });

  it("IEL-B9-3: initWebhookUrl ist die Repo-Konstante, und die Werkzeug-URLs der Vorlage teilen ihren Origin", () => {
    assert.equal(initWebhookUrl(), "https://app.sundartha.com/webhooks/elevenlabs/init");
    assert.ok(HERMES_GATEWAY_ORIGINS.includes(INIT_WEBHOOK_ORIGIN));
    const urls = [...JSON.stringify(VORLAGE.tools).matchAll(/"url":"([^"]+)"/g)].map((treffer) => treffer[1]);
    assert.ok(urls.length >= MIN_WERKZEUG_URLS, `Positiv-Kontrolle: zu wenige URLs gefunden (${urls.length})`);
    const inProduktion = (url) => url.replace("{{system__env_hermes_host}}", new URL(INIT_WEBHOOK_ORIGIN).host);
    for (const url of urls) assert.equal(new URL(inProduktion(url)).origin, INIT_WEBHOOK_ORIGIN, url);
  });
});

const SETTINGS_OHNE_WEBHOOK = Object.freeze({ [WEBHOOK_SCHLUESSEL]: null, can_use_mcp_servers: false });

function settingsMitWebhook(webhook) {
  return { ...SETTINGS_OHNE_WEBHOOK, [WEBHOOK_SCHLUESSEL]: webhook };
}

const WEBHOOK_KORREKT = Object.freeze({
  url: "https://app.sundartha.com/webhooks/elevenlabs/init",
  request_headers: { [INIT_HEADER]: { secret_id: SECRET_ID } },
});

async function laufeHarness({ publicUrlProzess, renderPublicUrl, renderApiKey = RENDER_TEST_SCHLUESSEL }) {
  const { ausgabe } = await starteKind({
    nodeArgs: ["test/_iel-b9-push-harness.mjs", ...SETZ_ARGUMENTE],
    env: {
      ELEVENLABS_API_KEY: TEST_SCHLUESSEL,
      RENDER_API_KEY: renderApiKey,
      PUBLIC_URL: publicUrlProzess,
      IEL_B9_RENDER_SZENARIO: JSON.stringify({
        publicUrlStatus: HTTP_OK,
        publicUrl: renderPublicUrl,
        serviceUrl: ONRENDER,
        domains: [domainEintrag(SUNDARTHA_HOST)],
        settings: SETTINGS_OHNE_WEBHOOK,
      }),
    },
  });
  const zeile = ausgabe.split("\n").find((kandidat) => kandidat.startsWith(HARNESS_ERGEBNIS_MARKE));
  assert.ok(zeile, `keine Ergebniszeile:\n${ausgabe}`);
  return { ...JSON.parse(zeile.slice(HARNESS_ERGEBNIS_MARKE.length + 1)), ausgabe };
}

describe("IEL-B9 B: --workspace-init-webhook", () => {
  it("IEL-B9-4: Ziel-Urteil ROT -> Exit 1, nur GET an Render, 0 Aufrufe an ElevenLabs", async () => {
    const rotFaelle = [
      { ...DIENST_GRUEN, publicUrl: TUNNEL },
      { ...DIENST_GRUEN, publicUrl: "http://app.sundartha.com" },
      { ...DIENST_GRUEN, envStatus: HTTP_NOT_FOUND, serviceUrl: "https://fremd.onrender.com" },
      { ...DIENST_GRUEN, envStatus: HTTP_SERVER_ERROR },
      { ...DIENST_GRUEN, domains: [domainEintrag("anders.sundartha.com")] },
    ];
    for (const szenario of rotFaelle) {
      const lauf = await pushMit([...SETZ_ARGUMENTE, "--ausfuehren"], settingsRouter({ dienst: szenario, vorher: SETTINGS_OHNE_WEBHOOK }));
      assert.equal(lauf.code, 1, lauf.ausgabe);
      assert.ok(lauf.aufrufe.length > 0);
      assert.deepEqual(nichtRenderAufrufe(lauf.aufrufe), [], "ElevenLabs wurde gerufen");
      assert.deepEqual(schreibendeAufrufe(lauf.aufrufe), []);
      assert.match(lauf.ausgabe, /ZIEL-URTEIL ROT/);
      assert.ok(!lauf.ausgabe.includes(RENDER_TEST_SCHLUESSEL));
    }
  });

  it("IEL-B9-5: ohne RENDER_API_KEY -> Exit 1, kein einziger fetch (Kindprozess)", async () => {
    const lauf = await laufeHarness({ publicUrlProzess: "", renderPublicUrl: "https://app.sundartha.com", renderApiKey: "" });
    assert.equal(lauf.code, 1, lauf.ausgabe);
    assert.equal(lauf.aufrufe.length, 0);
    assert.match(lauf.ausgabe, new RegExp(ZIEL_GRUND.API_KEY_FEHLT));
  });

  it("IEL-B9-6: GRUEN-Trockenlauf liest die Settings, schreibt nichts und nennt Ziel und secret_id", async () => {
    const lauf = await pushMit(SETZ_ARGUMENTE, settingsRouter({ vorher: SETTINGS_OHNE_WEBHOOK }));
    assert.equal(lauf.code, 0, lauf.ausgabe);
    assert.deepEqual(schreibendeAufrufe(lauf.aufrufe), []);
    assert.ok(nichtRenderAufrufe(lauf.aufrufe).some((aufruf) => aufruf.adresse.endsWith(SETTINGS_PFAD)));
    assert.ok(lauf.ausgabe.includes(SECRET_ID));
    assert.ok(lauf.ausgabe.includes(initWebhookUrl()));
    assert.match(lauf.ausgabe, /TROCKENLAUF/);
  });

  it("IEL-B9-7: GRUEN mit --ausfuehren - genau der Secret-Verweis-Koerper, zurueckgelesen, Exit 0", async () => {
    const lauf = await pushMit(
      [...SETZ_ARGUMENTE, "--ausfuehren"],
      settingsRouter({ vorher: SETTINGS_OHNE_WEBHOOK, nachher: settingsMitWebhook(WEBHOOK_KORREKT) }),
    );
    assert.equal(lauf.code, 0, lauf.ausgabe);
    const [patch, ...weitere] = patches(lauf.aufrufe);
    assert.equal(weitere.length, 0);
    assert.ok(patch.adresse.endsWith(SETTINGS_PFAD));
    assert.deepEqual(JSON.parse(patch.koerper), {
      [WEBHOOK_SCHLUESSEL]: { url: initWebhookUrl(), request_headers: { [INIT_HEADER]: { secret_id: SECRET_ID } } },
    });
    const nachDemPatch = lauf.aufrufe.slice(lauf.aufrufe.indexOf(patch) + 1);
    assert.ok(nachDemPatch.some((aufruf) => aufruf.methode === METHODE_GET && aufruf.adresse.endsWith(SETTINGS_PFAD)));
    assertKeinVerbotenerKoerper(lauf.aufrufe);
  });
});

describe("IEL-B9 B2: --workspace-init-webhook Lesebeleg, Entfernen, Argumente", () => {
  it("IEL-B9-8: Lesebeleg ROT - Klartext-Header, fremde Adresse, veraenderte Nachbar-Settings", async () => {
    const klartext = "klartext-geheim-b9";
    const faelle = [
      [settingsMitWebhook({ ...WEBHOOK_KORREKT, request_headers: { [INIT_HEADER]: klartext } }), /HEADER IST STRING/],
      [settingsMitWebhook({ ...WEBHOOK_KORREKT, url: "https://anders.example/init" }), /ADRESSE WEICHT AB/],
      [{ ...settingsMitWebhook(WEBHOOK_KORREKT), can_use_mcp_servers: true }, /GEGENPROBE ROT - Workspace-Settings veraendert: can_use_mcp_servers/],
    ];
    for (const [nachher, befund] of faelle) {
      const lauf = await pushMit([...SETZ_ARGUMENTE, "--ausfuehren"], settingsRouter({ vorher: SETTINGS_OHNE_WEBHOOK, nachher }));
      assert.equal(lauf.code, 1, lauf.ausgabe);
      assert.match(lauf.ausgabe, befund);
      assert.ok(!lauf.ausgabe.includes(klartext), "der Klartext-Wert steht in der Ausgabe");
      assertKeinVerbotenerKoerper(lauf.aufrufe);
    }
  });

  it("IEL-B9-9: --entfernen --ausfuehren - null-Koerper ohne Ziel-Urteil; noch gesetzt ist ROT", async () => {
    const entfernen = ["--workspace-init-webhook", "--entfernen", "--ausfuehren"];
    const lauf = await pushMit(entfernen, settingsRouter({ vorher: settingsMitWebhook(WEBHOOK_KORREKT), nachher: SETTINGS_OHNE_WEBHOOK }));
    assert.equal(lauf.code, 0, lauf.ausgabe);
    assert.deepEqual(renderAufrufe(lauf.aufrufe), [], "Render wurde gerufen");
    const [patch] = patches(lauf.aufrufe);
    assert.deepEqual(JSON.parse(patch.koerper), { [WEBHOOK_SCHLUESSEL]: null });
    assertKeinVerbotenerKoerper(lauf.aufrufe);

    const nochDa = await pushMit(entfernen, settingsRouter({ vorher: settingsMitWebhook(WEBHOOK_KORREKT) }));
    assert.equal(nochDa.code, 1, nochDa.ausgabe);
    assert.match(nochDa.ausgabe, /INIT-WEBHOOK NOCH GESETZT/);
  });

  it("IEL-B9-10: Argumentfehler brechen ab, bevor irgendetwas gerufen wird", async () => {
    const faelle = [
      ["--workspace-init-webhook"],
      ["--workspace-init-webhook", "--secret-id="],
      [`--secret-id=${SECRET_ID}`],
      [...SETZ_ARGUMENTE, "--felder=prompt"],
      [...SETZ_ARGUMENTE, "--entfernen"],
      [...SETZ_ARGUMENTE, "agent_frei"],
    ];
    for (const argumente of faelle) {
      const lauf = await pushMit(argumente, settingsRouter({ vorher: SETTINGS_OHNE_WEBHOOK }));
      assert.equal(lauf.code, 1, `${argumente.join(" ")}\n${lauf.ausgabe}`);
      assert.equal(lauf.aufrufe.length, 0, argumente.join(" "));
    }
  });

  it("IEL-B9-11: das Ziel haengt nicht an der PUBLIC_URL des aufrufenden Prozesses (Kindprozess)", async () => {
    const tunnelLokal = await laufeHarness({ publicUrlProzess: TUNNEL, renderPublicUrl: "https://app.sundartha.com" });
    assert.equal(tunnelLokal.code, 0);

    const fremdAmDienst = await laufeHarness({ publicUrlProzess: "https://app.sundartha.com", renderPublicUrl: TUNNEL });
    assert.equal(fremdAmDienst.code, 1);
    assert.deepEqual(schreibendeAufrufe(fremdAmDienst.aufrufe), []);
    assert.deepEqual(nichtRenderAufrufe(fremdAmDienst.aufrufe), []);
  });
});

const KARTE_SOLL = wertAnPfad(VORLAGE, livePfadeVon(VORLAGE, FREIGABEN_FELD)[0]).wert;
const NUR_SCHALTER = [`--felder=${SCHALTER_FELD}`];

function liveAgent({ schalter = false, karte = KARTE_SOLL } = {}) {
  const agent = structuredClone(LIVE_MIT_DATENSCHUTZ);
  agent.platform_settings.overrides = { enable_conversation_initiation_client_data_from_webhook: schalter };
  if (karte !== null) agent.platform_settings.overrides.conversation_config_override = structuredClone(karte);
  return agent;
}

function karteMit(pfad, wert) {
  const karte = structuredClone(KARTE_SOLL);
  const segmente = pfad.split(".");
  const blatt = segmente.pop();
  segmente.reduce((knoten, segment) => knoten[segment], karte)[blatt] = wert;
  return karte;
}

describe("IEL-B9 C: Freigaben-Wache (Riegel 8)", () => {
  it("IEL-B9-12: Trockenlauf meldet jedes Blatt der Freigaben-Karte und schreibt nichts", async () => {
    const lauf = await pushMit(NUR_SCHALTER, agentRouter({ vorher: liveAgent() }));
    assert.equal(lauf.code, 0, lauf.ausgabe);
    assert.deepEqual(schreibendeAufrufe(lauf.aufrufe), []);
    assert.match(lauf.ausgabe, /FREIGABE agent\.prompt\.prompt=false/);
    for (const pfad of blattPfade(KARTE_SOLL)) assert.ok(lauf.ausgabe.includes(`FREIGABE ${pfad}=`), pfad);
  });

  it("IEL-B9-13: eine schon offene agent.prompt-Freigabe -> ROT ohne PATCH, auch mit --ausfuehren", async () => {
    for (const pfad of ["agent.prompt.prompt", "agent.prompt.tool_ids"]) {
      for (const argumente of [NUR_SCHALTER, [...NUR_SCHALTER, "--ausfuehren"]]) {
        const lauf = await pushMit(argumente, agentRouter({ vorher: liveAgent({ karte: karteMit(pfad, true) }) }));
        assert.equal(lauf.code, 1, lauf.ausgabe);
        assert.deepEqual(patches(lauf.aufrufe), []);
        assert.ok(lauf.ausgabe.includes(`FREIGABE SCHON OFFEN - ${pfad} = true`), lauf.ausgabe);
      }
    }
  });

  it("IEL-B9-14: --ausfuehren schreibt genau den Schalter, und die Karte bleibt gleich -> Exit 0", async () => {
    const lauf = await pushMit(
      [...NUR_SCHALTER, "--ausfuehren"],
      agentRouter({ vorher: liveAgent(), nachher: liveAgent({ schalter: true }) }),
    );
    assert.equal(lauf.code, 0, lauf.ausgabe);
    const [patch, ...weitere] = patches(lauf.aufrufe);
    assert.equal(weitere.length, 0);
    assert.ok(patch.adresse.includes(AGENTEN_PFAD));
    const koerper = JSON.parse(patch.koerper);
    assert.deepEqual(koerper, { platform_settings: { overrides: { enable_conversation_initiation_client_data_from_webhook: true } } });
    assert.deepEqual(blattPfade(koerper).filter((pfad) => pfad.startsWith("platform_settings.overrides.")), [SCHALTER_PFAD]);
    assertKeinVerbotenerKoerper(lauf.aufrufe);
  });

  it("IEL-B9-15: Karte nach dem PATCH veraendert -> ROT mit Rueckweg", async () => {
    const veraendert = [karteMit("agent.prompt.prompt", true), karteMit("agent.prompt.tool_ids", true), karteMit("tts.voice_id", false)];
    for (const karte of veraendert) {
      const lauf = await pushMit(
        [...NUR_SCHALTER, "--ausfuehren"],
        agentRouter({ vorher: liveAgent(), nachher: liveAgent({ schalter: true, karte }) }),
      );
      assert.equal(lauf.code, 1, lauf.ausgabe);
      assert.equal(patches(lauf.aufrufe).length, 1);
      assert.ok(lauf.ausgabe.includes(`--felder=${FREIGABEN_FELD} --ausfuehren`), lauf.ausgabe);
      assert.ok(lauf.ausgabe.includes(KARTE_PFAD));
    }
  });

  it("IEL-B9-16: Schalter und Karte im selben Koerper -> MEHR ALS DER SCHALTER, kein PATCH", async () => {
    const lauf = await pushMit(
      [`--felder=${SCHALTER_FELD},${FREIGABEN_FELD}`, "--ausfuehren"],
      agentRouter({ vorher: liveAgent({ karte: karteMit("tts.voice_id", false) }) }),
    );
    assert.equal(lauf.code, 1, lauf.ausgabe);
    assert.deepEqual(patches(lauf.aufrufe), []);
    assert.match(lauf.ausgabe, /MEHR ALS DER SCHALTER/);
  });

  it("IEL-B9-17: ohne ausdrueckliche Nennung bzw. ohne lesbare Karte -> ROT, kein PATCH", async () => {
    const ohneFelder = await pushMit(["--ausfuehren"], agentRouter({ vorher: liveAgent() }));
    assert.equal(ohneFelder.code, 1, ohneFelder.ausgabe);
    assert.deepEqual(patches(ohneFelder.aufrufe), []);
    assert.match(ohneFelder.ausgabe, /SCHALTER NUR AUSDRUECKLICH/);

    const ohneKarte = await pushMit([...NUR_SCHALTER, "--ausfuehren"], agentRouter({ vorher: liveAgent({ karte: null }) }));
    assert.equal(ohneKarte.code, 1, ohneKarte.ausgabe);
    assert.deepEqual(patches(ohneKarte.aufrufe), []);
    assert.match(ohneKarte.ausgabe, /FREIGABEN-KARTE NICHT LESBAR/);
  });

  it("IEL-B9-18: die Vorlage besitzt den Schalter als 'wert' ohne Ausnahme, SOLL true", () => {
    const eintrag = VORLAGE._besitz.felder.find((kandidat) => kandidat.feld === SCHALTER_FELD);
    assert.ok(eintrag);
    assert.equal(eintrag.art, "wert");
    assert.deepEqual(eintrag.vorlage, eintrag.live);
    assert.equal(eintrag.ausgenommen, undefined);
    assert.equal(wertAnPfad(VORLAGE, eintrag.vorlage[0]).wert, true);
    assert.deepEqual(livePfadeVon(VORLAGE, SCHALTER_FELD), ["platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook"]);
    assert.deepEqual(livePfadeVon(VORLAGE, "gibt_es_nicht"), []);
  });
});

const EL_KONTO = Object.freeze({ apiKey: "el-test-schluessel", apiBase: "http://el.test" });
const SIP_USER = "geheimer-sip-user-b9";
const VOLLE_NUMMER = "+4930123456789";
const OUTBOUND = Object.freeze({ address: "sip.telnyx.com", username: SIP_USER });

function registrierung(id, inboundTrunk) {
  const eintrag = { phone_number_id: id, label: `label-${id}`, phone_number: VOLLE_NUMMER, outbound_trunk: OUTBOUND };
  return inboundTrunk === undefined ? eintrag : { ...eintrag, inbound_trunk: inboundTrunk };
}

const OFFEN = registrierung("phnum_offen", { has_auth_credentials: false, username: SIP_USER, allowed_numbers: [VOLLE_NUMMER] });
const MIT_ZUGANG = registrierung("phnum_zugang", { has_auth_credentials: true, username: SIP_USER, allowed_numbers: [] });
const OHNE_INBOUND = registrierung("phnum_ohne");

function elFake({ bestand, nachDelete = bestand, listeStatus = HTTP_OK, einzelStatus = HTTP_OK, deleteStatus = HTTP_OK }) {
  const aufrufe = [];
  let aktuell = bestand;
  const fetchImpl = async (adresse, optionen = {}) => {
    const methode = optionen.method || METHODE_GET;
    const pfad = String(adresse).slice(EL_KONTO.apiBase.length);
    aufrufe.push({ pfad, methode });
    if (methode === METHODE_DELETE) {
      aktuell = nachDelete;
      return { ok: deleteStatus === HTTP_OK, status: deleteStatus, json: async () => ({}) };
    }
    if (pfad === "/v1/convai/phone-numbers") {
      const liste = aktuell.map(({ phone_number_id, phone_number }) => ({ phone_number_id, phone_number }));
      return { ok: listeStatus === HTTP_OK, status: listeStatus, json: async () => liste };
    }
    const treffer = aktuell.find((eintrag) => pfad.endsWith(`/${eintrag.phone_number_id}`));
    const status = treffer ? einzelStatus : HTTP_NOT_FOUND;
    return { ok: status === HTTP_OK, status, json: async () => structuredClone(treffer ?? {}) };
  };
  return { aufrufe, fetchImpl };
}

function deletes(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.methode === METHODE_DELETE);
}

describe("IEL-B9 D: el-nummern-registrierung --trunk-inventar / --registrierung-loeschen", () => {
  it("IEL-B9-19: Inventar - ROT bei offenem Trunk, unbelegt ohne Inbound, nie Nutzername oder volle Nummer", async () => {
    const alle = elFake({ bestand: [OFFEN, MIT_ZUGANG, OHNE_INBOUND] });
    const rot = await mitAusgabe(() => trunkInventar({ el: EL_KONTO, fetchImpl: alle.fetchImpl }));
    assert.equal(rot.code, 1);
    assert.match(rot.ausgabe, /registrierung=phnum_offen .*-> ROT \(Inbound-Trunk ohne Zugangsdaten\)/);
    assert.match(rot.ausgabe, /registrierung=phnum_ohne .*Annahme 'lehnt INVITE ab' UNBELEGT/);
    assert.ok(!rot.ausgabe.includes(SIP_USER));
    assert.ok(!rot.ausgabe.includes(VOLLE_NUMMER));
    assert.ok(rot.ausgabe.includes(e164Endung(VOLLE_NUMMER)));
    assert.ok(alle.aufrufe.every((aufruf) => aufruf.methode === METHODE_GET));

    const ohneOffen = elFake({ bestand: [MIT_ZUGANG, OHNE_INBOUND] });
    const gruen = await mitAusgabe(() => trunkInventar({ el: EL_KONTO, fetchImpl: ohneOffen.fetchImpl }));
    assert.equal(gruen.code, 0);
    assert.match(gruen.ausgabe, /UNBELEGT/);
    assert.match(gruen.ausgabe, /INVENTAR GRUEN/);

    const leer = await mitAusgabe(() => trunkInventar({ el: EL_KONTO, fetchImpl: elFake({ bestand: [] }).fetchImpl }));
    assert.equal(leer.code, 0);

    for (const kaputt of [{ listeStatus: HTTP_SERVER_ERROR }, { einzelStatus: HTTP_SERVER_ERROR }]) {
      const fake = elFake({ bestand: [MIT_ZUGANG], ...kaputt });
      await assert.rejects(
        mitAusgabe(() => trunkInventar({ el: EL_KONTO, fetchImpl: fake.fetchImpl })),
        (fehler) => fehler.providerStatus === HTTP_SERVER_ERROR,
      );
    }
  });

  it("IEL-B9-20: Loeschen nur offen, Trockenlauf ohne --ja-wirklich, Erfolg nur per Lesebeleg", async () => {
    const loesche = (fake, felder) => mitAusgabe(() => registrierungLoeschen({ el: EL_KONTO, fetchImpl: fake.fetchImpl, ...felder }));

    const trocken = elFake({ bestand: [OFFEN] });
    const trockenLauf = await loesche(trocken, { id: OFFEN.phone_number_id, jaWirklich: false });
    assert.equal(trockenLauf.code, 0);
    assert.match(trockenLauf.ausgabe, /TROCKENLAUF/);
    assert.deepEqual(deletes(trocken.aufrufe), []);

    for (const geschuetzt of [MIT_ZUGANG, OHNE_INBOUND]) {
      const fake = elFake({ bestand: [geschuetzt] });
      const lauf = await loesche(fake, { id: geschuetzt.phone_number_id, jaWirklich: true });
      assert.equal(lauf.code, 1);
      assert.match(lauf.ausgabe, /VERWEIGERT/);
      assert.deepEqual(deletes(fake.aufrufe), []);
    }

    const faelle = [
      [{ bestand: [OFFEN], nachDelete: [], deleteStatus: HTTP_OK }, 0],
      [{ bestand: [OFFEN], nachDelete: [], deleteStatus: HTTP_SERVER_ERROR }, 0],
      [{ bestand: [OFFEN], nachDelete: [OFFEN], deleteStatus: HTTP_OK }, 1],
      [{ bestand: [OFFEN], nachDelete: [{ ...OFFEN, phone_number_id: "phnum_anderes" }], deleteStatus: HTTP_OK }, 1],
    ];
    for (const [szenario, erwartet] of faelle) {
      const fake = elFake(szenario);
      const lauf = await loesche(fake, { id: OFFEN.phone_number_id, jaWirklich: true });
      assert.equal(lauf.code, erwartet, `${JSON.stringify(szenario)}\n${lauf.ausgabe}`);
      assert.equal(deletes(fake.aufrufe).length, 1);
      assert.match(lauf.ausgabe, /LOESCH-BELEG/);
    }

    const unbekannt = elFake({ bestand: [] });
    const unbekanntLauf = await loesche(unbekannt, { id: "phnum_unbekannt", jaWirklich: true });
    assert.equal(unbekanntLauf.code, 1);
    assert.deepEqual(deletes(unbekannt.aufrufe), []);
  });

  it("IEL-B9-21: reine Helfer - Klasse fail-closed, exakter Nummernabgleich, PII-arme Projektion", () => {
    assert.equal(registrierungsKlasse({ inbound_trunk: {} }), REGISTRIERUNG_KLASSE.OFFEN);
    assert.equal(registrierungsKlasse(OFFEN), REGISTRIERUNG_KLASSE.OFFEN);
    assert.equal(registrierungsKlasse(MIT_ZUGANG), REGISTRIERUNG_KLASSE.MIT_ZUGANG);
    assert.equal(registrierungsKlasse(OHNE_INBOUND), REGISTRIERUNG_KLASSE.OHNE_INBOUND);

    assert.deepEqual(registrierungenMitNummer([OFFEN], VOLLE_NUMMER), [OFFEN]);
    assert.deepEqual(registrierungenMitNummer([OFFEN], VOLLE_NUMMER.slice(1)), []);

    const schnappschuss = inventarSchnappschuss(OFFEN);
    for (const verboten of ["username", "phone_number", "allowed_addresses"]) {
      assert.ok(!(verboten in schnappschuss), verboten);
    }
    assert.ok(!JSON.stringify(schnappschuss).includes(SIP_USER));
    assert.deepEqual(schnappschuss.allowedNumbersEndungen, ["…6789"]);

    assert.equal(e164Endung(VOLLE_NUMMER), "…6789");
    const sonde = inboundElAllowlistProbeLine({
      state: { numbers: [{ tenantId: "t1", status: NUMBER_STATUS.ACTIVE, e164: VOLLE_NUMMER }] },
      tenantIds: ["t1"],
    });
    assert.equal(sonde, "Inbound-EL-Allowlist: 1 Tenants, aktive DIDs …6789");
  });
});

const STUB_REGISTRIERUNG = Object.freeze({
  phone_number_id: "phnum_test",
  label: "t",
  phone_number: "+15550100000",
  inbound_trunk: { has_auth_credentials: false, allowed_numbers: [] },
});

function stubAntwort(url, listeStatus) {
  if (url === "/v1/convai/phone-numbers/phnum_test") return { status: HTTP_OK, text: JSON.stringify(STUB_REGISTRIERUNG) };
  if (url === "/v1/convai/phone-numbers") return { status: listeStatus, text: "[]" };
  return { status: HTTP_NOT_FOUND, text: "{}" };
}

function starteStub({ listeStatus = HTTP_OK } = {}) {
  const treffer = [];
  const server = http.createServer((req, res) => {
    treffer.push({ url: req.url, methode: req.method });
    const { status, text } = stubAntwort(req.url, listeStatus);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, treffer })));
}

async function mitStub(optionen, lauf) {
  const { server, treffer } = await starteStub(optionen);
  try {
    return await lauf({ basis: `http://127.0.0.1:${server.address().port}`, treffer });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function nummernSkript({ basis, args, env = {}, preload = [] }) {
  return starteKind({
    nodeArgs: [...preload, "scripts/el-nummern-registrierung.mjs", ...args],
    env: { ELEVENLABS_API_KEY: "stub", ELEVENLABS_API_BASE: basis, ...env },
  });
}

describe("IEL-B9 D2: el-nummern-registrierung als Kindprozess und Quelltext-Pins", () => {
  it("IEL-B9-22: CLI - unbekannte/konfligierende/kaputte Argumente ohne Netz, Loesch-Trockenlauf ohne DELETE", async () => {
    await mitStub({}, async ({ basis, treffer }) => {
      for (const args of [["--inbound-trunk"], ["--trunk-inventar", "--anlegen"], ["--registrierung-loeschen"], ["--registrierung-loeschen", "--id=kaputt"]]) {
        const { code, ausgabe } = await nummernSkript({ basis, args });
        assert.equal(code, 1, `${args.join(" ")}\n${ausgabe}`);
      }
      assert.equal(treffer.length, 0, "es wurde ein Anbieter-Request gestellt");

      const { code, ausgabe } = await nummernSkript({ basis, args: ["--registrierung-loeschen", "--id=phnum_test"] });
      assert.equal(code, 0, ausgabe);
      assert.match(ausgabe, /TROCKENLAUF/);
      assert.ok(treffer.every((eintrag) => eintrag.methode !== METHODE_DELETE));
    });
    await mitStub({ listeStatus: HTTP_SERVER_ERROR }, async ({ basis }) => {
      const { code, ausgabe } = await nummernSkript({ basis, args: ["--trunk-inventar"] });
      assert.equal(code, 1, ausgabe);
      assert.ok(!ausgabe.includes("INVENTAR GRUEN"));
    });
  });

  it("IEL-B9-23: Inventar und Loeschen laden den Store nie (Import-Spion mit Positiv-Kontrolle)", async () => {
    const spion = ["--import", pathToFileURL(path.join(ROOT, "test/_import-spion-store.mjs")).href];
    const ohneDb = { STORE_BACKEND: "pg", DATABASE_URL: "postgres://127.0.0.1:1/unerreichbar" };
    await mitStub({}, async ({ basis }) => {
      for (const args of [["--trunk-inventar"], ["--registrierung-loeschen", "--id=phnum_test"]]) {
        const { code, ausgabe } = await nummernSkript({ basis, args, env: ohneDb, preload: spion });
        assert.equal(code, 0, `${args.join(" ")}\n${ausgabe}`);
        assert.ok(!ausgabe.includes(SPION_MARKE), `${args.join(" ")} hat den Store geladen`);
        assert.ok(!ausgabe.includes("Store nicht erreichbar"));
      }
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iel-b9-spion-"));
      const kontrolle = await nummernSkript({ basis, args: ["--pruefen"], env: { DATA_DIR: dataDir }, preload: spion });
      assert.ok(kontrolle.ausgabe.includes(SPION_MARKE), `Positiv-Kontrolle: der Spion sieht nichts\n${kontrolle.ausgabe}`);
    });
  });

  it("IEL-B9-24: die Init-Webhook-Adresse haengt nicht an PUBLIC_URL", () => {
    const adresseBei = (publicUrl) =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", INIT_ADRESSE_AUSGEBEN],
        { cwd: ROOT, env: { PATH: process.env.PATH, ...BASE_ENV, PUBLIC_URL: publicUrl, NODE_ENV: "test" }, encoding: "utf8" },
      );
    assert.equal(adresseBei("https://eins.example"), initWebhookUrl());
    assert.equal(adresseBei("https://zwei.example"), initWebhookUrl());
  });
});
