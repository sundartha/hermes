import { cwd } from "node:process";

import { Abbruch } from "./ausgabe.mjs";

const GITHUB_API_STANDARD = "https://api.github.com";
const GITHUB_SERVER_STANDARD = "https://github.com";
const RENDER_API_STANDARD = "https://api.render.com/v1";
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/[\w./-]*)?$/;
const DIENST_ADRESSE = /^https:\/\/[a-z0-9.-]{1,200}(?::\d{1,5})?\/?$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/;
const PFAD = /^\S.{0,1023}$/;
const SCHLUSS_STRICH = /\/+$/;

function muster(ausdruck) {
  return (wert) => ausdruck.test(wert);
}

function standardOderLoopback(standard) {
  return (wert) => wert === standard || LOOPBACK.test(wert);
}

function dienstAdresse(wert) {
  return DIENST_ADRESSE.test(wert) || LOOPBACK.test(wert);
}

const REGELN = new Map([
  ["GITHUB_TOKEN", muster(/^\S{1,1024}$/)],
  ["GITHUB_REPOSITORY", muster(/^[\w.-]{1,100}\/[\w.-]{1,100}$/)],
  ["GITHUB_API_URL", standardOderLoopback(GITHUB_API_STANDARD)],
  ["GITHUB_SERVER_URL", standardOderLoopback(GITHUB_SERVER_STANDARD)],
  ["GITHUB_RUN_ID", muster(/^\d{1,20}$/)],
  ["GITHUB_EVENT_NAME", muster(/^[a-z_]{1,40}$/)],
  ["GITHUB_EVENT_PATH", muster(PFAD)],
  ["GITHUB_ACTOR", muster(LOGIN)],
  ["GITHUB_TRIGGERING_ACTOR", muster(LOGIN)],
  ["GITHUB_REF", muster(/^refs\/[\w./-]{1,200}$/)],
  ["GITHUB_OUTPUT", muster(PFAD)],
  ["GITHUB_WORKSPACE", muster(PFAD)],
  ["STAGING_URL", dienstAdresse],
  ["PRODUKTION_URL", dienstAdresse],
  ["ABSICHTLICH_ROT", muster(/^(?:true|false)$/)],
  ["RENDER_API_KEY", muster(/^\S{1,512}$/)],
  ["RENDER_API_URL", standardOderLoopback(RENDER_API_STANDARD)],
  ["RENDER_SERVICE_ID", muster(/^srv-[a-z0-9]{1,60}$/)],
  ["HERMES_DEPLOY_TOKEN", muster(/^\S{32,512}$/)],
  ["GITHUB_ACTIONS", muster(/^(?:true|false)$/)],
]);

const GITHUB_PFLICHT = ["GITHUB_TOKEN", "GITHUB_REPOSITORY"];
const GEHEIM = ["GITHUB_TOKEN", "RENDER_API_KEY", "HERMES_DEPLOY_TOKEN"];
const NOTFALL_AKTEURE = ["GITHUB_ACTIONS", "GITHUB_ACTOR", "GITHUB_TRIGGERING_ACTOR"];

const BEFEHLE = new Map([
  [
    "staging",
    {
      pflicht: ["STAGING_URL", ...GITHUB_PFLICHT],
      freiwillig: ["GITHUB_API_URL", "ABSICHTLICH_ROT"],
    },
  ],
  [
    "entscheiden",
    {
      pflicht: [...GITHUB_PFLICHT, "PRODUKTION_URL", "GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH"],
      freiwillig: [
        "GITHUB_API_URL",
        "GITHUB_ACTOR",
        "GITHUB_TRIGGERING_ACTOR",
        "GITHUB_REF",
        "GITHUB_OUTPUT",
        "GITHUB_WORKSPACE",
      ],
    },
  ],
  [
    "hoertest",
    {
      pflicht: [...GITHUB_PFLICHT, "GITHUB_RUN_ID"],
      freiwillig: ["GITHUB_API_URL", "GITHUB_SERVER_URL"],
    },
  ],
  [
    "deploy",
    {
      pflicht: ["RENDER_API_KEY", "HERMES_DEPLOY_TOKEN", "RENDER_SERVICE_ID", "PRODUKTION_URL"],
      freiwillig: ["RENDER_API_URL"],
    },
  ],
  [
    "zurueckrollen",
    {
      pflicht: ["RENDER_API_KEY", "RENDER_SERVICE_ID", "PRODUKTION_URL"],
      freiwillig: ["RENDER_API_URL", "GITHUB_WORKSPACE", ...NOTFALL_AKTEURE],
    },
  ],
  [
    "anrufpause",
    {
      pflicht: ["HERMES_DEPLOY_TOKEN", "PRODUKTION_URL"],
      freiwillig: NOTFALL_AKTEURE,
    },
  ],
]);

function gueltig(name, wert) {
  return typeof wert === "string" && REGELN.get(name)(wert);
}

function ungueltigeNamen({ pflicht, freiwillig }, umgebung) {
  const fehlend = pflicht.filter((name) => !gueltig(name, umgebung[name]));
  const falsch = freiwillig.filter(
    (name) => Boolean(umgebung[name]) && !gueltig(name, umgebung[name]),
  );
  return [...fehlend, ...falsch];
}

function adresse(wert, standard) {
  return (wert || standard).replace(SCHLUSS_STRICH, "");
}

function werteBauen(umgebung) {
  return {
    githubUrl: adresse(umgebung.GITHUB_API_URL, GITHUB_API_STANDARD),
    githubToken: umgebung.GITHUB_TOKEN,
    repository: umgebung.GITHUB_REPOSITORY,
    serverUrl: adresse(umgebung.GITHUB_SERVER_URL, GITHUB_SERVER_STANDARD),
    runId: umgebung.GITHUB_RUN_ID,
    ereignisName: umgebung.GITHUB_EVENT_NAME,
    ereignisPfad: umgebung.GITHUB_EVENT_PATH,
    akteure: [umgebung.GITHUB_ACTOR, umgebung.GITHUB_TRIGGERING_ACTOR].filter(Boolean),
    inActions: umgebung.GITHUB_ACTIONS === "true",
    ref: umgebung.GITHUB_REF || null,
    ausgabeDatei: umgebung.GITHUB_OUTPUT || null,
    repoDir: umgebung.GITHUB_WORKSPACE || cwd(),
    stagingUrl: umgebung.STAGING_URL && adresse(umgebung.STAGING_URL),
    produktionUrl: umgebung.PRODUKTION_URL && adresse(umgebung.PRODUKTION_URL),
    absichtlichRot: umgebung.ABSICHTLICH_ROT === "true",
    renderUrl: adresse(umgebung.RENDER_API_URL, RENDER_API_STANDARD),
    renderSchluessel: umgebung.RENDER_API_KEY,
    serviceId: umgebung.RENDER_SERVICE_ID,
    deployToken: umgebung.HERMES_DEPLOY_TOKEN,
  };
}

function maskenWirken(regeln, umgebung) {
  return umgebung.GITHUB_ACTIONS === "true" || !regeln.freiwillig.includes("GITHUB_ACTIONS");
}

export function einstellungenLesen(befehl, umgebung, ausgabe) {
  const regeln = BEFEHLE.get(befehl);
  const falsch = ungueltigeNamen(regeln, umgebung);
  for (const name of falsch) ausgabe.melde("einstellung_ungueltig", { name });
  if (falsch.length > 0) throw new Abbruch("einstellungen");
  const eigene = [...regeln.pflicht, ...regeln.freiwillig];
  const geheimnisse = GEHEIM.filter((name) => eigene.includes(name)).map((name) => umgebung[name]);
  if (maskenWirken(regeln, umgebung)) ausgabe.maskiere(geheimnisse);
  return Object.freeze(werteBauen(umgebung));
}
