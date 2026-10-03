import { stderr, stdout } from "node:process";

const PLATZHALTER = /\{(\w+)\}/g;
const ZEILENUMBRUCH = /[\r\n]/;
const TRENNER = /[\s\-/().]/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TELEFON = /\+\d{8}/;
const VERBINDUNG = /postgres(?:ql)?:\/\//i;
const TABELLEN_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const FEHLERCODE = /^[A-Z0-9_]{2,40}$/;
const MASKE_PROZENT = /%/g;
const MASKE_CR = /\r/g;
const MASKE_LF = /\n/g;

const SCHRITTE = [
  "einstellungen",
  "produktion",
  "rueckblick",
  "wiederherstellen",
  "kopie",
  "bereit",
  "adresse",
  "zugang",
  "verbindungsdaten",
  "tunnel",
  "verbindung",
  "schema",
  "pruefungen",
  "hermes",
  "loeschen",
  "liste",
  "aufraeumen",
  "signal",
];
const RENDER_STATUS = [
  "creating",
  "available",
  "unavailable",
  "config_restart",
  "suspended",
  "maintenance_scheduled",
  "maintenance_in_progress",
  "recovery_failed",
  "recovery_in_progress",
  "unknown",
  "updating_instance",
  "AVAILABLE",
  "BACKUP_NOT_READY",
  "NOT_AVAILABLE",
];
const EINSTELLUNGEN = [
  "RENDER_API_KEY",
  "RENDER_POSTGRES_ID",
  "RENDER_WIEDERHERSTELLUNG_UMGEBUNG",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_SHA",
  "RENDER_API_URL",
  "WIEDERHERSTELLUNG_IP_URL",
  "WIEDERHERSTELLUNG_TAKT_MS",
];
const ERLAUBTE_WOERTER = new Set([...SCHRITTE, ...RENDER_STATUS, ...EINSTELLUNGEN]);
const tabellenAusDemCode = new Set();

const KATALOG = new Map([
  ["aufruf", "Aufruf: node tools/wiederherstellung.mjs pruefen|aufraeumen"],
  ["einstellung_ungueltig", "Einstellung fehlt oder ist ungültig: {name}"],
  ["abbruch", "Abbruch im Schritt {schritt}"],
  ["abbruch_http", "Abbruch im Schritt {schritt}: HTTP {status}"],
  ["abbruch_code", "Abbruch im Schritt {schritt}: {code}"],
  [
    "produktion_im_kopien_environment",
    "Die Produktions-Datenbank liegt im Environment der Kopien oder in keinem; nichts wird wiederhergestellt oder gelöscht",
  ],
  ["rueckblick_status", "Wiederherstellung auf einen Zeitpunkt ist nicht verfügbar: {status}"],
  ["rueckblick_zu_kurz", "Rückblick reicht noch nicht: es fehlen {minuten} Minuten"],
  ["rueckblick_unbekannt", "Rückblick reicht noch nicht: Beginn des Rückblicks unbekannt"],
  ["zeitpunkt", "Wiederherstellungszeitpunkt: {minuten} Minuten vor dem Start"],
  ["ausgeloest", "Wiederherstellung ausgelöst"],
  ["kopie_gesucht", "Kopie über die Liste gesucht, eigene gefunden: {gefunden}"],
  ["kopie_status", "Kopie: Status {status}"],
  ["bereit", "Kopie bereit nach {minuten} Minuten"],
  ["wiederherstellung_gescheitert", "Wiederherstellung gescheitert"],
  ["zugang", "Zugriffsliste der Kopie steht genau auf der Runner-Adresse: {ok}"],
  ["verbindung", "Verbindung über den Tunnel mit TLS steht: {ok}"],
  ["p1", "P1 Wiederherstellungszeitpunkt eingehalten: {ok}"],
  ["p1_abstand", "P1 Abstand jüngster Eintrag zum Zeitpunkt: {minuten} Minuten"],
  ["p1_leer", "P1 Abstand jüngster Eintrag zum Zeitpunkt: kein Eintrag mit Zeit"],
  ["p2", "P2 Kerndaten vorhanden (Mandanten und Konten): {ok}"],
  ["p3", "P3 Tabellen des Codes lesbar: {lesbar} von {gesamt}"],
  ["p3_tabelle", "P3 nicht lesbar: {tabelle}"],
  ["p4", "P4 Schema vor dem Start: {fehlend} fehlende, {unbekannt} unbekannte Spalten"],
  ["p4_unbekannt", "P4 Schema vor dem Start: nicht lesbar"],
  ["h1", "H1 /healthz antwortet 200, auch nach der Ruhezeit: {ok}"],
  [
    "h2",
    "H2 Netzprotokoll: Beobachter aktiv {aktiv}, {extern} Versuche nach außen, {env} Leseversuche einer .env",
  ],
  ["h3", "H3 Hermes endet nach SIGTERM mit Exit-Code 0: {ok}"],
  ["p5", "P5 Schema nach dem Start: {fehlend} fehlende, {unbekannt} unbekannte Spalten"],
  ["p5_unbekannt", "P5 Schema nach dem Start: nicht lesbar"],
  ["p6", "P6 Mandanten und Konten nach dem Start nicht weniger: {ok}"],
  ["loeschen_verweigert", "Löschen verweigert: keine eigene Kopie"],
  ["loeschen_gescheitert", "Löschen gescheitert: HTTP {status}"],
  ["geloescht", "Kopie gelöscht und Löschung bestätigt: {ok}"],
  [
    "aufgeraeumt",
    "Aufräumen: {geloescht} eigene Kopien gelöscht, {fremd} fremde nicht angefasst, {fehler} Fehler",
  ],
  ["signal", "Signal empfangen: die Kopie wird gelöscht, danach Exit 1"],
  ["ausgabe_verweigert", "Ausgabe verweigert: ein Wert ist für das Log nicht erlaubt"],
  ["ergebnis", "Ergebnis: {ok}"],
]);
const FEHLER_SCHLUESSEL = new Set([
  "abbruch",
  "abbruch_http",
  "abbruch_code",
  "ausgabe_verweigert",
  "einstellung_ungueltig",
]);

export class AusgabeVerweigert extends Error {
  constructor() {
    super("Ausgabe verweigert");
    this.name = "AusgabeVerweigert";
  }
}

export class Abbruch extends Error {
  constructor(schritt, { status = null, code = null } = {}) {
    super("Abbruch");
    this.name = "Abbruch";
    this.schritt = schritt;
    this.status = status;
    this.code = code;
  }
}

class Fehlercode {
  constructor(text) {
    this.text = text;
  }
}

export function fehlercode(fehler) {
  const kandidat = typeof fehler === "string" ? fehler : (fehler?.code ?? fehler?.cause?.code);
  if (typeof kandidat !== "string" || !FEHLERCODE.test(kandidat)) return null;
  return new Fehlercode(kandidat);
}

export function tabellenErlauben(namen) {
  for (const name of namen) if (TABELLEN_NAME.test(name)) tabellenAusDemCode.add(name);
}

function erlaubtesWort(wert) {
  return ERLAUBTE_WOERTER.has(wert) || tabellenAusDemCode.has(wert);
}

function ausgabeWert(wert) {
  if (typeof wert === "number" && Number.isFinite(wert)) return String(wert);
  if (typeof wert === "boolean") return wert ? "ja" : "nein";
  if (typeof wert === "string" && erlaubtesWort(wert)) return wert;
  if (wert instanceof Fehlercode) return wert.text;
  throw new AusgabeVerweigert();
}

export function zeileSchreiben(text, strom = stdout) {
  const verdichtet = text.replace(TRENNER, "");
  const verboten =
    ZEILENUMBRUCH.test(text) ||
    EMAIL.test(text) ||
    TELEFON.test(verdichtet) ||
    VERBINDUNG.test(text);
  if (verboten) throw new AusgabeVerweigert();
  strom.write(text + "\n");
}

export function melde(schluessel, werte = {}) {
  const vorlage = KATALOG.get(schluessel);
  if (vorlage === undefined) throw new AusgabeVerweigert();
  const text = vorlage.replace(PLATZHALTER, (_treffer, name) => {
    if (!Object.hasOwn(werte, name)) throw new AusgabeVerweigert();
    return ausgabeWert(werte[name]);
  });
  zeileSchreiben(text, FEHLER_SCHLUESSEL.has(schluessel) ? stderr : stdout);
}

function maskenText(wert) {
  return wert.replace(MASKE_PROZENT, "%25").replace(MASKE_CR, "%0D").replace(MASKE_LF, "%0A");
}

export function maskiere(werte) {
  for (const wert of werte) {
    if (typeof wert === "string" && wert !== "")
      stdout.write("::add-mask::" + maskenText(wert) + "\n");
  }
}

export function berichteVorher({ p1, p2, p3, p4 }) {
  melde("p1", { ok: p1.ok });
  if (p1.abstandMinuten === null) {
    if (p1.ok) melde("p1_leer");
  } else {
    melde("p1_abstand", { minuten: p1.abstandMinuten });
  }
  melde("p2", { ok: p2.ok });
  const alleLesbar = p3.gesamt > 0 && p3.nichtLesbar.length === 0;
  melde("p3", { lesbar: p3.lesbar, gesamt: p3.gesamt });
  for (const tabelle of p3.nichtLesbar) melde("p3_tabelle", { tabelle });
  if (p4 === null) melde("p4_unbekannt");
  else melde("p4", p4);
  return p1.ok && p2.ok && alleLesbar;
}

export function berichteHermes({ h1, h2, h3 }) {
  melde("h1", { ok: h1 });
  melde("h2", { aktiv: h2.aktiv, extern: h2.extern, env: h2.envDatei });
  melde("h3", { ok: h3 });
  return h1 && h2.aktiv && h2.extern === 0 && h2.envDatei === 0 && h3;
}

export function berichteNachher({ p5, p6 }) {
  if (p5.schema === null) melde("p5_unbekannt");
  else melde("p5", p5.schema);
  melde("p6", { ok: p6.ok });
  return p5.ok && p6.ok;
}
