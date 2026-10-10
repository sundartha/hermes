import { appendFileSync } from "node:fs";
import { stdout } from "node:process";

export const COMMIT_MUSTER = /^[0-9a-f]{40}$/;
export const TEIL_MUSTER = /^[A-Za-z][\w.:/-]{0,79}$/;
export const DEPLOY_ID = /^dep-[a-z0-9]{1,60}$/;
const CHECK_MUSTER = /^[\p{L}\p{N}][\p{L}\p{N} .:_()/-]{0,99}$/u;
const AUSGABE_NAME = /^[a-z]{1,20}(?:_[a-z]{1,20})?$/;
const PLATZHALTER = /\{(\w+)\}/g;
const TRENNER = /[\s\-/().]/g;
const VERBOTENE_ZEILEN = [/[\r\n]/, /[^\s@]+@[^\s@]+\.[^\s@]+/, /:\/\//, /bearer/i];
const TELEFON = /\+\d{8}/;
const MASKE_ERSETZUNGEN = [
  [/%/g, "%25"],
  [/\r/g, "%0D"],
  [/\n/g, "%0A"],
];
const MASKE_PRAEFIX = "::add-mask::";
const HOECHSTE_ZAHL = 1_000_000;

const STATUS_WOERTER = new Set([
  "created",
  "queued",
  "build_in_progress",
  "update_in_progress",
  "live",
  "deactivated",
  "build_failed",
  "update_failed",
  "canceled",
  "pre_deploy_in_progress",
  "pre_deploy_failed",
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
  "ahead",
  "behind",
  "identical",
  "diverged",
  "offen",
  "unbekannt",
]);
const SCHRITTE = new Set([
  "einstellungen",
  "staging",
  "vergleich",
  "ereignis",
  "staging_lauf",
  "pr",
  "pflicht_checks",
  "check_runs",
  "produktion",
  "master",
  "issue_suche",
  "issue_schreiben",
  "anrufe",
  "deploy_liste",
  "ausloesen",
  "deploy_suche",
  "deploy_status",
  "healthz",
  "rollback",
  "anrufpause",
]);
const EINSTELLUNGEN = new Set([
  "GITHUB_TOKEN",
  "GITHUB_REPOSITORY",
  "GITHUB_API_URL",
  "GITHUB_SERVER_URL",
  "GITHUB_RUN_ID",
  "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH",
  "GITHUB_ACTOR",
  "GITHUB_TRIGGERING_ACTOR",
  "GITHUB_REF",
  "GITHUB_OUTPUT",
  "GITHUB_WORKSPACE",
  "STAGING_URL",
  "PRODUKTION_URL",
  "ABSICHTLICH_ROT",
  "RENDER_API_KEY",
  "RENDER_API_URL",
  "RENDER_SERVICE_ID",
  "HERMES_DEPLOY_TOKEN",
  "GITHUB_ACTIONS",
]);
const AUSLIEFERN = new Set(["commit", "checksPass", "off"]);
const EREIGNISSE = new Set(["workflow_run", "workflow_dispatch"]);

const KATALOG = new Map([
  [
    "aufruf",
    "Aufruf: node tools/deploy-weg.mjs staging --commit <sha> | entscheiden | hoertest --commit <sha> --teile <namen> | deploy --commit <sha> --produktion <sha> --frisch-geweckt ja|nein | zurueckrollen --ziel vorher|<sha> | anrufpause --an ja|nein",
  ],
  ["einstellung_ungueltig", "Einstellung fehlt oder ist ungültig: {name}"],
  ["ausgabe_verweigert", "Ausgabe verweigert: ein Wert ist für das Log nicht erlaubt"],
  ["unerwartet", "Abbruch: unerwarteter Fehler im Werkzeug"],
  ["abbruch", "Abbruch im Schritt {schritt}"],
  ["abbruch_http", "Abbruch im Schritt {schritt}: HTTP {http}"],
  ["schutzgrenze", "Schutzgrenze im Schritt {schritt} erreicht nach {minuten} Minuten"],
  ["ergebnis", "Ergebnis: {ok}"],
  ["staging_gemeldet", "Staging meldet Commit {commit}"],
  ["staging_ohne_commit", "Staging meldet noch keinen gültigen Commit"],
  ["staging_erreicht", "Staging fährt den erwarteten Commit {commit}"],
  ["staging_ueberholt", "Rot: Staging ist überholt und fährt schon den neueren Commit {commit}"],
  ["probe_auth", "Negativproben ohne Zugangsdaten gegen Staging: Exit {exit}"],
  ["mcp_ohne_anmeldung", "POST /mcp tools/list ohne Anmeldung: HTTP {http}, erwartet 401"],
  ["absichtlich_rot", "Absichtlich rot: dieser Probe-Lauf scheitert wie bestellt"],
  ["ereignis", "Ereignis: {ereignis}"],
  ["kandidat", "Kandidat: {commit}"],
  ["produktion", "Produktion fährt: {commit}"],
  ["frisch_geweckt", "Produktion hat geschlafen und ist frisch geweckt"],
  [
    "rot_aufwachen_zeitgrenze",
    "Rot: Produktion ist im Schritt {schritt} nach {minuten} Minuten nicht aufgewacht",
  ],
  ["rot_ereignis", "Rot: unbekanntes oder unvollständiges Ereignis"],
  ["rot_staging_nicht_gruen", "Rot: der Staging-Lauf ist nicht grün ({status})"],
  ["rot_staging_kein_push", "Rot: der Staging-Lauf kam nicht von einem Push auf master"],
  ["rot_fremdes_repo", "Rot: der Lauf gehört nicht zu diesem Repository"],
  ["rot_hand_nutzer", "Rot: Hand-Start durch einen Nutzer ohne Freigaberecht"],
  ["rot_hand_ref", "Rot: Hand-Start nicht auf master"],
  ["rot_hand_commit", "Rot: Hand-Start ohne gültigen 40-stelligen Commit"],
  ["rot_hand_kein_staging", "Rot: kein grüner Push-Lauf von staging für genau diesen Commit"],
  ["rot_kein_pr", "Rot: der Commit ist nicht der Merge-Commit eines gemergten PR auf master"],
  ["rot_keine_pflicht_checks", "Rot: die Regeln für master nennen keine Pflicht-Checks"],
  ["rot_check_fehlt", "Rot: Pflicht-Check {check} fehlt auf dem PR-Kopf"],
  ["rot_check_app", "Rot: Pflicht-Check {check} stammt nicht von GitHub Actions"],
  ["rot_check_nicht_gruen", "Rot: Pflicht-Check {check} ist nicht success ({status})"],
  ["rot_produktion_unbekannt", "Rot: der Produktions-Commit aus /healthz ist unbekannt"],
  ["rot_nicht_neuer", "Rot: der Commit ist nicht neuer als Produktion ({status})"],
  ["rot_nicht_auf_master", "Rot: der Commit liegt nicht auf master ({status})"],
  ["rot_github", "Rot: die GitHub-API antwortet im Schritt {schritt} mit HTTP {http}"],
  ["identisch", "Nichts zu tun: Produktion fährt bereits diesen Commit"],
  ["gespraech", "Gespräch geändert: {ok}"],
  ["gespraech_teil", "Geänderter Teil des Gesprächsabdrucks: {teil}"],
  ["gespraech_fehler", "Gesprächsabgleich gescheitert; das zählt als geändertes Gespräch"],
  ["hoertest_bestaetigt", "Hand-Start durch eine freigebende Person: Hörtest gilt als bestätigt"],
  ["entscheidung", "Entscheidung: deploy {deploy}, hoertest {hoertest}"],
  ["issue_ersetzt", "Hörtest-Issue #{nummer}: Text ersetzt"],
  ["issue_angelegt", "Hörtest-Issue #{nummer} angelegt"],
  ["anrufe", "Laufende Anrufe in Produktion: {anzahl}"],
  [
    "ruhefenster",
    "Produktion war frisch geweckt: Deploy erst nach {minuten} Minuten ohne laufende Anrufe",
  ],
  ["produktion_veraendert", "Rot: Produktion fährt nicht mehr den Commit aus der Entscheidung"],
  ["deploy_ausgeloest", "Deploy angefordert: HTTP {http}"],
  ["deploy_status", "Deploy-Status: {status}"],
  ["anruf_beim_umschalten", "Rot: beim Umschalten läuft ein Anruf; der Deploy wird abgebrochen"],
  [
    "umschalten_ungemessen",
    "Rot: beim Umschalten war Produktion frisch geweckt oder nicht wach; die Anrufzahl gilt als nicht gemessen, der Deploy wird abgebrochen",
  ],
  ["abgebrochen", "Deploy abgebrochen: HTTP {http}"],
  ["deploy_gescheitert", "Rot: der Deploy endet mit {status}"],
  ["live", "Produktion fährt jetzt {commit}"],
  ["ausliefern_vorher", "Automatisches Ausliefern bei Render vor dem Rollback: {ausliefern}"],
  ["ausliefern_nachher", "Automatisches Ausliefern bei Render nach dem Rollback: {ausliefern}"],
  ["ausliefern_unlesbar", "Automatisches Ausliefern bei Render nicht lesbar: HTTP {http}"],
  [
    "ausliefern_zurueckgesetzt",
    "Automatisches Ausliefern auf {ausliefern} zurückgesetzt: HTTP {http}",
  ],
  ["ausliefern_wie_vorher", "Automatisches Ausliefern wie vor dem Rollback: {ok}"],
  ["rot_kein_live", "Rot: Render meldet keinen laufenden Deploy"],
  ["rot_kein_ziel", "Rot: Render kennt keinen passenden früheren Deploy für den Rollback"],
  ["rollback_ziel", "Rollback-Ziel: der frühere Deploy von Commit {commit}"],
  [
    "umgebung_geaendert",
    "Warnung: seit dem Ziel-Deploy liefen {anzahl} Deploys wegen geänderter Umgebungsvariablen; der Rollback nimmt die alten Werte",
  ],
  ["umgebung_nicht_pruefbar", "Warnung: geänderte Umgebungsvariablen nicht prüfbar (HTTP {http})"],
  [
    "umgebung_save_only",
    "Hinweis: Änderungen an Umgebungsvariablen mit „Save only“ sind nicht erkennbar; der Rollback nimmt die Werte des Ziel-Deploys",
  ],
  ["rollback_ausgeloest", "Rollback angefordert: HTTP {http}"],
  [
    "rollback_abgelehnt",
    "Render lehnt den Rollback ab (HTTP {http}). Render erlaubt auf Free nur Rollbacks auf die zwei letzten früheren Deploys; jetzt die Anrufpause oder das Render-Dashboard nutzen.",
  ],
  ["rollback_laeuft_trotzdem", "Rollback läuft trotzdem: Deploy {id}"],
  ["rollback_nicht_gefunden", "Kein Rollback-Deploy gefunden (Deploy-Liste: HTTP {http})"],
  [
    "live_zuerst_abschalten",
    "Vom Mac: zuerst den Workflow live abschalten: gh workflow disable live.yml --repo sundartha/hermes",
  ],
  [
    "live_wieder_einschalten",
    "Workflow live bleibt abgeschaltet. Erst wieder einschalten, wenn die Korrektur auf master gemergt ist: gh workflow enable live.yml --repo sundartha/hermes (oder in GitHub unter Actions → live → Enable workflow).",
  ],
  [
    "ziel_ohne_anrufpause",
    "Warnung: Der Ziel-Stand kennt die Anrufpause nicht: eine eingeschaltete Pause wirkt jetzt nicht mehr, nur OUTBOUND_FROZEN mit Neustart sperrt; beim nächsten Deploy ab V6 gilt der gespeicherte Wert wieder.",
  ],
  ["probe_auth_produktion", "Negativproben ohne Zugangsdaten gegen Produktion: Exit {exit}"],
  [
    "rot_probe_auth_fehlt",
    "Rot: die Negativproben des Ziel-Commits lassen sich nicht aus Git holen",
  ],
  ["probeanruf", "Jetzt Probeanruf an eine Nummer von Sundartha; er muss gelingen."],
  ["anrufpause_angefordert", "Anrufpause angefordert: HTTP {http}"],
  ["anrufpause_stand", "Anrufpause in Produktion: {an}"],
  ["rot_anrufpause_abweichend", "Rot: Produktion meldet die Anrufpause nicht wie verlangt"],
  ["anrufe_weiter", "Laufende Anrufe: {anzahl}, sie laufen weiter"],
  ["anrufe_nicht_lesbar", "Warnung: laufende Anrufe nicht lesbar (HTTP {http})"],
  ["anrufpause_probe", "Jetzt ein Versuch über place_call; er muss mit „pausiert“ scheitern."],
]);

function ganzeZahl(wert) {
  return Number.isInteger(wert) && Math.abs(wert) < HOECHSTE_ZAHL;
}

function istText(muster) {
  return (wert) => typeof wert === "string" && muster.test(wert);
}

function ausMenge(menge) {
  return (wert) => menge.has(wert);
}

function istWahrheit(wert) {
  return typeof wert === "boolean";
}

const PRUEFER = new Map([
  ["commit", istText(COMMIT_MUSTER)],
  ["teil", istText(TEIL_MUSTER)],
  ["id", istText(DEPLOY_ID)],
  ["check", istText(CHECK_MUSTER)],
  ["status", ausMenge(STATUS_WOERTER)],
  ["schritt", ausMenge(SCHRITTE)],
  ["name", ausMenge(EINSTELLUNGEN)],
  ["ereignis", ausMenge(EREIGNISSE)],
  ["ausliefern", ausMenge(AUSLIEFERN)],
  ["http", ganzeZahl],
  ["exit", ganzeZahl],
  ["anzahl", ganzeZahl],
  ["minuten", ganzeZahl],
  ["nummer", ganzeZahl],
  ["ok", istWahrheit],
  ["deploy", istWahrheit],
  ["hoertest", istWahrheit],
  ["an", istWahrheit],
]);

export class AusgabeVerweigert extends Error {
  constructor() {
    super("Ausgabe verweigert");
    this.name = "AusgabeVerweigert";
  }
}

export class Abbruch extends Error {
  constructor(schritt, http = null) {
    super("Abbruch");
    this.name = "Abbruch";
    this.schritt = schritt;
    this.http = http;
  }
}

export function statusWort(wert) {
  if (wert === null || wert === undefined) return "offen";
  return STATUS_WOERTER.has(wert) ? wert : "unbekannt";
}

function wertText(name, wert) {
  const pruefer = PRUEFER.get(name);
  if (pruefer === undefined || !pruefer(wert)) throw new AusgabeVerweigert();
  if (typeof wert === "boolean") return wert ? "ja" : "nein";
  return String(wert);
}

function zeileErlaubt(text) {
  const verdichtet = text.replace(TRENNER, "");
  return !VERBOTENE_ZEILEN.some((muster) => muster.test(text)) && !TELEFON.test(verdichtet);
}

export function zeileBauen(schluessel, werte = {}) {
  const vorlage = KATALOG.get(schluessel);
  if (vorlage === undefined) throw new AusgabeVerweigert();
  const text = vorlage.replace(PLATZHALTER, (_treffer, name) => {
    if (!Object.hasOwn(werte, name)) throw new AusgabeVerweigert();
    return wertText(name, werte[name]);
  });
  if (!zeileErlaubt(text)) throw new AusgabeVerweigert();
  return text;
}

function maskenText(wert) {
  return MASKE_ERSETZUNGEN.reduce((text, [muster, ersatz]) => text.replace(muster, ersatz), wert);
}

function standardSchreiben(zeile) {
  stdout.write(zeile + "\n");
}

export function ausgabeAnlegen(schreiben = standardSchreiben) {
  return Object.freeze({
    melde(schluessel, werte) {
      schreiben(zeileBauen(schluessel, werte));
    },
    maskiere(geheimnisse) {
      const echte = geheimnisse.filter((wert) => typeof wert === "string" && wert !== "");
      for (const wert of echte) schreiben(MASKE_PRAEFIX + maskenText(wert));
    },
  });
}

function ausgabeWert(wert) {
  const text = typeof wert === "boolean" ? (wert ? "ja" : "nein") : String(wert);
  if (!zeileErlaubt(text)) throw new AusgabeVerweigert();
  return text;
}

export function ausgabenSchreiben(datei, werte) {
  const zeilen = Object.entries(werte).map(([name, wert]) => {
    if (!AUSGABE_NAME.test(name)) throw new AusgabeVerweigert();
    return name + "=" + ausgabeWert(wert);
  });
  appendFileSync(datei, zeilen.join("\n") + "\n");
}
