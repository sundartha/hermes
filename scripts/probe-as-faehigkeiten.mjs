#!/usr/bin/env node
// E1 (PLAN-OPENAI.md Etappe 1, S5-A4 + F1-F4): Sonde fuer die Faehigkeiten des
// Authorization Servers (WorkOS AuthKit) und drei Live-Werte unseres eigenen
// Gateways. Reines Feststellungswerkzeug, KEIN Gate: es haengt an keinem
// package.json-Script, keinem CI-Lauf und keinem Boot-Pfad.
//
// SICHERHEITSZUSAGEN: kein Token, kein Cookie, kein Secret - weder als
// Argument, aus der Umgebung noch in der Ausgabe. Alle drei abgefragten
// Dokumente (Protected-Resource-Metadata, AS-Metadata an zwei Well-known-
// Pfaden) sind oeffentliche Discovery-Dokumente. Der Schritt "POST /mcp ohne
// Token" (F3) ist ein Lesevorgang: die mcpAuth-Middleware antwortet 401 VOR
// jedem Tool-Handler, es wird kein Koerper gesendet und der Antwortkoerper
// wird NIE gelesen (weder .json() noch .text()) - ausgewertet werden nur
// Statuszeile und der WWW-Authenticate-Header. Die Sonde schreibt nichts
// (kein "node:fs"), authentifiziert sich nirgends und importiert NICHT
// src/config.js - der Zielhost kommt ausschliesslich als Pflichtargument.
//
// Aufruf:  node scripts/probe-as-faehigkeiten.mjs <basis-url>
// Exit:    0 = alle PFLICHT-Zeilen PASS
//          1 = mindestens eine PFLICHT-Zeile nicht PASS (Discovery-404 eingeschlossen)
//          2 = Aufruffehler - VOR der ersten Netzanfrage (kein/falsches Argument)
//
// Abgrenzung zu scripts/check-setup.js (Nachbesserung 18 aus S5): beide lesen
// dieselben zwei Well-known-Pfade, aber check-setup fragt die LOKALE Config
// und den LOKAL laufenden Gateway ab und bricht beim ersten Treffer ab; diese
// Sonde bekommt den Host als Argument, leitet den Issuer aus der LIVE-PRM-
// Antwort ab, liest BEIDE AS-Metadata-Pfade und bewertet acht benannte Felder.
// Keine dritte Kopie derselben Logik entsteht dadurch, nur ein Ueberlapp bei
// der Pfadliste (Konstante, keine Logik) - s. docs/RUNBOOK-AS-METADATA.md.
//
// Jeder Lauf erzeugt einen auth_failed-Audit-Eintrag am Gateway (der 401 auf
// POST /mcp ohne Token) - das ist erwartet, keine Alarmkette haengt daran.
import { fileURLToPath } from "node:url";

// ---- Konstanten (G25/G35: alle Zahlen und Bewertungswoerter benannt) -----------

const PRM_PFAD = "/.well-known/oauth-protected-resource";
const MCP_PFAD = "/mcp";
const AS_PFADE = ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"];
const ABRUF_TIMEOUT_MS = 10000;
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_UNAUTHORIZED = 401;
const STATUS_LABEL_BREITE = 7;
const ARGV_ZIEL_OFFSET = 2; // argv[0]=node, argv[1]=Skriptpfad - das Ziel steht ab Index 2

const EXIT_OK = 0;
const EXIT_PFLICHT_VERLETZT = 1;
const EXIT_AUFRUFFEHLER = 2;

const PASS = "PASS";
const FAIL = "FAIL";
const UNKNOWN = "UNKNOWN";
const PFLICHT = "PFLICHT";
const BEFUND = "BEFUND";

const VORHERSAGE_JA = "JA";
const VORHERSAGE_NEIN = "NEIN";
const VORHERSAGE_UNBEKANNT = "UNBEKANNT";

const ERLAUBTE_SCHEMATA = ["http:", "https:"];
const KENNUNG = "hermes-probe-as-faehigkeiten";
const USAGE = "Aufruf: node scripts/probe-as-faehigkeiten.mjs <basis-url>";
const FELD_FEHLT = "(fehlt)";
const NICHT_GEMESSEN = "nicht gemessen (AS-Metadata nicht erreichbar)";
const PRM_FEHLT_BEFUND = "PRM fehlt -> F1/F2 nicht feststellbar, A3 NICHT deployen";

// ---- reine Helfer (kein IO, offline testbar) -----------------------------------

export function ohneEndSchraegstrich(wert) {
  return typeof wert === "string" ? wert.replace(/\/$/, "") : wert;
}

function istErfolg(status) {
  return typeof status === "number" && status >= HTTP_OK_MIN && status <= HTTP_OK_MAX;
}

function listeAlsText(feld) {
  return Array.isArray(feld) && feld.length > 0 ? feld.join(", ") : FELD_FEHLT;
}

function gleicheOrigin(eineUrl, andereUrl) {
  try {
    return new URL(eineUrl).origin === new URL(andereUrl).origin;
  } catch {
    return false;
  }
}

function statusZeile({ status, gewicht, name, detail }) {
  return { status, gewicht, name, detail };
}

function infoZeile(name, detail) {
  return { name, detail };
}

export function bewerteVorhanden(wert) {
  return typeof wert === "string" && wert.length > 0 ? PASS : FAIL;
}

// CIMD (T-10): fehlt das Feld, ist die Faehigkeit nicht beworben - das ist ein
// FAIL (Ist-Zustand "aus"), kein UNKNOWN. Nur echtes true zaehlt.
export function bewerteWahr(wert) {
  return wert === true ? PASS : FAIL;
}

// T-11 (RFC 9207): SHOULD-Feld laut WorkOS-Doku unbelegt. Fehlt es -> UNKNOWN
// (kann nicht beurteilt werden), explizites false -> FAIL.
export function bewerteWahrOderUnbekannt(wert) {
  if (wert === undefined) return UNKNOWN;
  return wert === true ? PASS : FAIL;
}

export function liesZiel(argumente) {
  if (argumente.length !== 1) return null;
  const [kandidat] = argumente;
  let ziel;
  try {
    ziel = new URL(kandidat);
  } catch {
    return null;
  }
  if (!ERLAUBTE_SCHEMATA.includes(ziel.protocol)) return null;
  return ohneEndSchraegstrich(kandidat);
}

// A3-Vorhersage (S5 V5/PM-2): beantwortet, ob die kanonische Audience-Falle
// (Etappe 8, A3) greifen wuerde. Kann NICHT zwischen "OAUTH_AUDIENCE leer" und
// "OAUTH_AUDIENCE kanonisch gesetzt" unterscheiden - beide ergeben NEIN.
export function a3Vorhersage({ resource, publicUrl }) {
  if (!publicUrl) {
    return { status: VORHERSAGE_UNBEKANNT, aussage: "Modus nicht oauth: publicUrl nicht von aussen lesbar" };
  }
  const erwartet = `${publicUrl}${MCP_PFAD}`;
  if (resource === erwartet) {
    return { status: VORHERSAGE_NEIN, aussage: `Footgun feuert NEIN (resource == publicUrl${MCP_PFAD})` };
  }
  return {
    status: VORHERSAGE_JA,
    aussage: "Footgun feuert JA -- A3 NICHT deployen, erst Audience angleichen (PM-3)",
  };
}

// ---- Acht-Zeilen-Tabelle (deklarativ, EIN Renderpfad - G5) ---------------------

const FAEHIGKEITEN = [
  {
    name: "issuer-Gleichheit (A-06/T-7)",
    gewicht: PFLICHT,
    pruefe: (doc, issuer) => ({
      status: ohneEndSchraegstrich(doc.issuer) === ohneEndSchraegstrich(issuer) ? PASS : FAIL,
      detail: `Dokument-issuer: ${doc.issuer ?? FELD_FEHLT}`,
    }),
  },
  {
    name: "jwks_uri auf Issuer-Origin (A1-Vorbedingung)",
    gewicht: BEFUND,
    pruefe: (doc, issuer) => ({
      status: gleicheOrigin(doc.jwks_uri, issuer) ? PASS : FAIL,
      detail: `jwks_uri: ${doc.jwks_uri ?? FELD_FEHLT}`,
    }),
  },
  {
    name: "PKCE S256 beworben (T-8)",
    gewicht: PFLICHT,
    pruefe: (doc) => ({
      status: (doc.code_challenge_methods_supported || []).includes("S256") ? PASS : FAIL,
      detail: `code_challenge_methods_supported: ${listeAlsText(doc.code_challenge_methods_supported)}`,
    }),
  },
  {
    name: "DCR: registration_endpoint (T-10)",
    gewicht: BEFUND,
    pruefe: (doc) => ({
      status: bewerteVorhanden(doc.registration_endpoint),
      detail: `registration_endpoint: ${doc.registration_endpoint ?? FELD_FEHLT}`,
    }),
  },
  {
    name: "CIMD beworben (T-10)",
    gewicht: BEFUND,
    pruefe: (doc) => ({
      status: bewerteWahr(doc.client_id_metadata_document_supported),
      detail: `client_id_metadata_document_supported: ${String(doc.client_id_metadata_document_supported ?? FELD_FEHLT)}`,
    }),
  },
  {
    name: "Token-Auth 'none' moeglich (T-10)",
    gewicht: BEFUND,
    pruefe: (doc) => ({
      status: (doc.token_endpoint_auth_methods_supported || []).includes("none") ? PASS : FAIL,
      detail: `token_endpoint_auth_methods_supported: ${listeAlsText(doc.token_endpoint_auth_methods_supported)}`,
    }),
  },
  {
    name: "RFC 9207 iss-Parameter (T-11)",
    gewicht: BEFUND,
    pruefe: (doc) => ({
      status: bewerteWahrOderUnbekannt(doc.authorization_response_iss_parameter_supported),
      detail: `authorization_response_iss_parameter_supported: ${String(doc.authorization_response_iss_parameter_supported ?? FELD_FEHLT)}`,
    }),
  },
  {
    name: "userinfo_endpoint (T-16)",
    gewicht: BEFUND,
    pruefe: (doc) => ({
      status: bewerteVorhanden(doc.userinfo_endpoint),
      detail: `userinfo_endpoint: ${doc.userinfo_endpoint ?? FELD_FEHLT}`,
    }),
  },
];
const FAEHIGKEITEN_ANZAHL = FAEHIGKEITEN.length;

// doc === null (AS-Metadata nicht erreichbar) -> alle acht Zeilen UNKNOWN mit
// benanntem Grund; das faellt nie wie ein bestandener Lauf aus.
export async function bewerteFaehigkeiten(doc, issuer) {
  return FAEHIGKEITEN.map((eintrag, index) => {
    const nummer = index + 1;
    const name = `${nummer}/${FAEHIGKEITEN_ANZAHL} ${eintrag.name}`;
    if (doc === null) {
      return statusZeile({ status: UNKNOWN, gewicht: eintrag.gewicht, name, detail: NICHT_GEMESSEN });
    }
    const ergebnis = eintrag.pruefe(doc, issuer);
    return statusZeile({ status: ergebnis.status, gewicht: eintrag.gewicht, name, detail: ergebnis.detail });
  });
}

// ---- IO-Teil --------------------------------------------------------------------

// Der EINE Abrufmechanismus fuer alle drei Schritte (DIP: injizierbar ueber
// { abrufen }, damit Tests ohne Netz laufen - Muster scripts/anruf-unterbrechungen.mjs).
// lesenAlsJson:false (Schritt 2, POST /mcp): der Antwortkoerper wird NIE
// angefasst, weder .json() noch .text() wird aufgerufen.
async function holeDokument(url, { methode = "GET", lesenAlsJson = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABRUF_TIMEOUT_MS);
  try {
    const antwort = await fetch(url, {
      method: methode,
      redirect: "manual",
      headers: { "user-agent": KENNUNG },
      signal: controller.signal,
    });
    const header = (name) => antwort.headers.get(name);
    if (!lesenAlsJson || !istErfolg(antwort.status)) {
      return { status: antwort.status, doc: null, fehler: null, header };
    }
    try {
      const doc = await antwort.json();
      return { status: antwort.status, doc, fehler: null, header };
    } catch (parseErr) {
      return { status: antwort.status, doc: null, fehler: parseErr.message, header };
    }
  } catch (netzErr) {
    return { status: null, doc: null, fehler: netzErr.message, header: () => null };
  } finally {
    clearTimeout(timer);
  }
}

// PRM nicht erreichbar (Netzfehler oder Nicht-2xx) - dieselbe benannte
// FAIL-Zeile wie ein leeres authorization_servers (Nachbesserung 16).
function prmUnerreichbarZeile(antwort) {
  const statusText = antwort.status === null ? antwort.fehler : `HTTP ${antwort.status}`;
  return statusZeile({
    status: FAIL,
    gewicht: PFLICHT,
    name: "PRM erreichbar",
    detail: `${statusText} -- ${PRM_FEHLT_BEFUND}`,
  });
}

// PRM erreichbar (2xx) - Issuer kann trotzdem fehlen (leeres
// authorization_servers, heute erreichbarer Zustand, s. src/auth.js).
function prmZeileUndInfos(antwort) {
  const authorizationServers = antwort.doc?.authorization_servers ?? [];
  const issuer = authorizationServers[0] ?? null;
  const resource = antwort.doc?.resource ?? null;
  const zeile = statusZeile({
    status: issuer ? PASS : FAIL,
    gewicht: PFLICHT,
    name: "PRM erreichbar",
    detail: issuer ? `HTTP ${antwort.status}` : `HTTP ${antwort.status} -- ${PRM_FEHLT_BEFUND}`,
  });
  const infos = [
    infoZeile("resource (F2)", resource ?? FELD_FEHLT),
    infoZeile("authorization_servers[0] (F1)", issuer ?? FELD_FEHLT),
  ];
  return { zeile, issuer, resource, infos };
}

// F1/F2: GET <basis>/.well-known/oauth-protected-resource.
export async function messePrm(basis, { abrufen }) {
  const antwort = await abrufen(`${basis}${PRM_PFAD}`, { methode: "GET" });
  if (!istErfolg(antwort.status)) {
    return { zeile: prmUnerreichbarZeile(antwort), issuer: null, resource: null, infos: [] };
  }
  return prmZeileUndInfos(antwort);
}

function extrahierePublicUrl(herausforderung) {
  const treffer = herausforderung.match(/resource_metadata="([^"]+)"/);
  if (!treffer) return null;
  const rohUrl = treffer[1];
  return rohUrl.endsWith(PRM_PFAD) ? rohUrl.slice(0, -PRM_PFAD.length) : rohUrl;
}

// F3: POST <basis>/mcp ohne Token. 401 MIT WWW-Authenticate -> Modus oauth
// (PASS als Befund); 401 OHNE Challenge -> Modus token/legacy (kein Fehler
// der Sonde, ein Ist-Zustand). publicUrl kommt aus resource_metadata und
// speist die A3-Vorhersage.
export async function messeMcpModus(basis, { abrufen }) {
  const antwort = await abrufen(`${basis}${MCP_PFAD}`, { methode: "POST", lesenAlsJson: false });
  const herausforderung = antwort.status === HTTP_UNAUTHORIZED ? antwort.header("www-authenticate") : null;
  if (herausforderung) {
    const publicUrl = extrahierePublicUrl(herausforderung);
    return {
      zeile: statusZeile({ status: PASS, gewicht: BEFUND, name: "WWW-Authenticate vorhanden -> Modus oauth", detail: herausforderung }),
      publicUrl,
      modus: "oauth",
      infos: [infoZeile("publicUrl aus resource_metadata", publicUrl ?? FELD_FEHLT)],
    };
  }
  if (antwort.status === HTTP_UNAUTHORIZED) {
    return {
      zeile: statusZeile({ status: FAIL, gewicht: BEFUND, name: "WWW-Authenticate fehlt -> Modus token/legacy", detail: "401 ohne Challenge" }),
      publicUrl: null,
      modus: "token/legacy",
      infos: [],
    };
  }
  const statusText = antwort.status === null ? antwort.fehler : `HTTP ${antwort.status}`;
  return {
    zeile: statusZeile({ status: FAIL, gewicht: BEFUND, name: "POST /mcp ohne Token", detail: statusText }),
    publicUrl: null,
    modus: null,
    infos: [],
  };
}

function pfadName(pfad) {
  return pfad.split("/").pop();
}

// F4: beide Well-known-Pfade am Issuer abrufen (T-7: unser Discovery-Fallback
// passt auf beide, also muss die Sonde auch beide bewerten). Der erste
// erfolgreiche traegt das Dokument.
export async function messeAsMetadata(issuer, { abrufen }) {
  const antworten = [];
  for (const pfad of AS_PFADE) {
    const antwort = await abrufen(`${issuer}${pfad}`, { methode: "GET" });
    antworten.push({ pfad, antwort });
  }
  const erfolgreiche = antworten.find((eintrag) => istErfolg(eintrag.antwort.status));
  const quellenText = antworten.map((eintrag) => `${pfadName(eintrag.pfad)}: HTTP ${eintrag.antwort.status ?? "?"}`).join(" | ");
  const doc = erfolgreiche ? erfolgreiche.antwort.doc : null;
  const zeile = statusZeile({
    status: doc ? PASS : FAIL,
    gewicht: PFLICHT,
    name: "AS-Metadata erreichbar",
    detail: doc ? `Quelle: ${pfadName(erfolgreiche.pfad)} (HTTP ${erfolgreiche.antwort.status}) | ${quellenText}` : quellenText,
  });
  const issuerJeQuelle = antworten
    .map(({ pfad, antwort }) => `${pfadName(pfad)}=${antwort.doc?.issuer ?? FELD_FEHLT}`)
    .join(" | ");
  const infos = [infoZeile("issuer-Feld je Pfad", issuerJeQuelle), infoZeile("scopes_supported", listeAlsText(doc?.scopes_supported))];
  const faehigkeiten = await bewerteFaehigkeiten(doc, issuer);
  return { zeile, faehigkeiten, infos };
}

// Kein Issuer aus der PRM ableitbar (404 oder leeres Feld) -> F4 kann gar
// nicht erst messen; trotzdem acht UNKNOWN-Zeilen (Formatinvariante).
async function messeAsMetadataOderLeer(prm, { abrufen }) {
  if (!prm.issuer) {
    return {
      zeile: statusZeile({ status: FAIL, gewicht: PFLICHT, name: "AS-Metadata erreichbar", detail: "kein Issuer aus PRM ermittelbar" }),
      faehigkeiten: await bewerteFaehigkeiten(null, null),
      infos: [],
    };
  }
  return messeAsMetadata(prm.issuer, { abrufen });
}

export function exitCodeAus(zeilen) {
  const pflichtVerletzt = zeilen.some((zeile) => zeile.gewicht === PFLICHT && zeile.status !== PASS);
  return pflichtVerletzt ? EXIT_PFLICHT_VERLETZT : EXIT_OK;
}

export async function sondiere(argumente, { abrufen = holeDokument } = {}) {
  const basis = liesZiel(argumente);
  if (!basis) return { aufrufFehler: true, exitCode: EXIT_AUFRUFFEHLER };

  const prm = await messePrm(basis, { abrufen });
  const mcpModus = await messeMcpModus(basis, { abrufen });
  const asMeta = await messeAsMetadataOderLeer(prm, { abrufen });
  const vorhersage = a3Vorhersage({ resource: prm.resource, publicUrl: mcpModus.publicUrl });
  const alleZeilen = [prm.zeile, mcpModus.zeile, asMeta.zeile, ...asMeta.faehigkeiten];

  return {
    aufrufFehler: false,
    basis,
    datumUtc: new Date().toISOString(),
    prm,
    mcpModus,
    asMeta,
    vorhersage,
    alleZeilen,
    exitCode: exitCodeAus(alleZeilen),
  };
}

// ---- Ausgabe ----------------------------------------------------------------

function formatSpalte(text) {
  return text.padEnd(STATUS_LABEL_BREITE);
}

function formatiereZeile(zeile) {
  return `[${formatSpalte(zeile.status)}] [${formatSpalte(zeile.gewicht)}] ${zeile.name}    ${zeile.detail}`;
}

function formatiereInfo(info) {
  return `[${formatSpalte("INFO")}] ${info.name} = ${info.detail}`;
}

function zaehleErgebnis(alleZeilen) {
  const pflicht = alleZeilen.filter((zeile) => zeile.gewicht === PFLICHT);
  const befund = alleZeilen.filter((zeile) => zeile.gewicht === BEFUND);
  return {
    pflichtGesamt: pflicht.length,
    pflichtPass: pflicht.filter((zeile) => zeile.status === PASS).length,
    befundPass: befund.filter((zeile) => zeile.status === PASS).length,
    befundFail: befund.filter((zeile) => zeile.status === FAIL).length,
    befundUnknown: befund.filter((zeile) => zeile.status === UNKNOWN).length,
  };
}

function formatiereErgebnis(bericht) {
  const zaehlung = zaehleErgebnis(bericht.alleZeilen);
  return (
    `=== Ergebnis: PFLICHT ${zaehlung.pflichtPass}/${zaehlung.pflichtGesamt} PASS ` +
    `- Befunde ${zaehlung.befundPass} PASS, ${zaehlung.befundFail} FAIL, ${zaehlung.befundUnknown} UNKNOWN ` +
    `-> Exit ${bericht.exitCode}`
  );
}

function berichte(bericht) {
  const zeilen = [];
  zeilen.push(`=== Sonde AS-Faehigkeiten ===  Ziel: ${bericht.basis}   Datum (UTC): ${bericht.datumUtc}`);
  zeilen.push("--- Schritt 1: Protected Resource Metadata (F1/F2) ---");
  zeilen.push(formatiereZeile(bericht.prm.zeile));
  bericht.prm.infos.forEach((info) => zeilen.push(formatiereInfo(info)));
  zeilen.push("--- Schritt 2: POST /mcp ohne Token (F3) ---");
  zeilen.push(formatiereZeile(bericht.mcpModus.zeile));
  bericht.mcpModus.infos.forEach((info) => zeilen.push(formatiereInfo(info)));
  zeilen.push(formatiereInfo(infoZeile("A3-Vorhersage", `${bericht.vorhersage.status} - ${bericht.vorhersage.aussage}`)));
  zeilen.push("--- Schritt 3: AS-Metadata am Issuer (F4) ---");
  zeilen.push(formatiereZeile(bericht.asMeta.zeile));
  bericht.asMeta.infos.forEach((info) => zeilen.push(formatiereInfo(info)));
  bericht.asMeta.faehigkeiten.forEach((zeile) => zeilen.push(formatiereZeile(zeile)));
  zeilen.push(formatiereErgebnis(bericht));
  console.log(zeilen.join("\n"));
}

async function main() {
  const argumente = process.argv.slice(ARGV_ZIEL_OFFSET);
  const basis = liesZiel(argumente);
  if (!basis) {
    console.error(USAGE);
    process.exit(EXIT_AUFRUFFEHLER);
    return;
  }
  const bericht = await sondiere(argumente);
  berichte(bericht);
  process.exit(bericht.exitCode);
}

// Nur als Skript ausfuehren, NICHT beim Import (Muster scripts/anruf-unterbrechungen.mjs).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(EXIT_PFLICHT_VERLETZT);
  });
}
