import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { loadavg } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { cwd, env, pid } from "node:process";

export const ZEITLOG = "zeitlog";
export const LOGORDNER = "log";
const PRAEFIX = "Mutationslog: ";
const ENDUNG = ".jsonl";
const OPTION = "zeitlogLauf";
const REPORTER = "Reporter";
const OPTIONEN = "options";
const GEPLANT = "Run";
const NICHT_GELAUFEN = "Ignored";
const GETOETET = "Killed";
const ZEITUEBERSCHREITUNG = "Timeout";
export const ERSTER_LAUF = "erster Lauf";
const EINZELN_IM_ERSTEN_LAUF = new Set(["Survived", "NoCoverage", ZEITUEBERSCHREITUNG]);
const SANDBOXPFAD = /^.*\/sandbox-[^/]+\//;
const DATEINAME_OHNE = /:/g;
const FORTSCHRITT_ABSTAND_MS = 30_000;
const MS_JE_SEKUNDE = 1000;
const MS_JE_MINUTE = 60_000;
const SEKUNDEN_BIS = 120_000;
const LANGSAMSTE = 5;
const PROZENT = 100;
const PS_SPALTEN = "pid=,ppid=,etime=,pcpu=,args=";
const PS_ZEILE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/;
const PS_UMGEBUNG = { LC_ALL: "C" };
const PS_FRIST_MS = 5000;
const ARGUMENTE_ZEICHEN = 120;
const MESSBARE_PROZESSE = /^(node|stryker|tap)$/;
const SEKUNDEN_JE_MINUTE = 60;
const SEKUNDEN_JE_STUNDE = 3600;
const SEKUNDEN_JE_TAG = 86_400;
const SEKUNDEN_JE_STUFE = [1, SEKUNDEN_JE_MINUTE, SEKUNDEN_JE_STUNDE];
export const PHASEN = { sperre: "Sperre", testauswahl: "Testauswahl", sandbox: "Sandbox", erstlauf: "Erstlauf", mutanten: "Mutantenläufe", loeschprobe: "Löschprobe" };

const log = { datei: null, begonnen: false, beginn: Date.now(), letzteZeile: Date.now(), phasen: leerePhasen(), laeufe: new Map(), aktuell: null, fertig: leeresTeilergebnis() };

function leeresTeilergebnis() {
  return { laeufe: 0, mutanten: 0, getoetet: 0, dateien: 0 };
}

function leerePhasen() {
  return Object.fromEntries(Object.keys(PHASEN).map((phase) => [phase, 0]));
}

export function komma(wert) {
  return wert.toFixed(1).replace(".", ",");
}

export function dauer(ms) {
  return ms < SEKUNDEN_BIS ? `${komma(ms / MS_JE_SEKUNDE)} s` : `${komma(ms / MS_JE_MINUTE)} min`;
}

export function anteil(ms, gesamt) {
  return `${gesamt > 0 ? Math.round((ms * PROZENT) / gesamt) : 0} %`;
}

function melde(text) {
  console.error(`${PRAEFIX}${text}`);
}

function alterInSekunden(etime) {
  const [tage, uhr] = etime.includes("-") ? etime.split("-") : [0, etime];
  const teile = String(uhr).split(":").reverse().map(Number);
  return teile.reduce((summe, wert, stelle) => summe + wert * SEKUNDEN_JE_STUFE[stelle], Number(tage) * SEKUNDEN_JE_TAG);
}

function prozess(zeile) {
  const treffer = PS_ZEILE.exec(zeile);
  if (treffer === null) return [];
  const [, pidText, ppid, etime, cpu, aufruf, argumente] = treffer;
  const befehl = basename(aufruf);
  if (!MESSBARE_PROZESSE.test(befehl)) return [];
  return [{ pid: Number(pidText), ppid: Number(ppid), alter_s: alterInSekunden(etime), cpu: Number(cpu), befehl, argumente: argumente.slice(0, ARGUMENTE_ZEICHEN) }];
}

function prozessliste() {
  try {
    return execFileSync("ps", ["-axo", PS_SPALTEN], { encoding: "utf8", env: { ...env, ...PS_UMGEBUNG }, timeout: PS_FRIST_MS, stdio: ["ignore", "pipe", "ignore"] }).split("\n").flatMap(prozess);
  } catch {
    return null;
  }
}

function notiereProzesse(zeitpunkt, { datei, anlass }) {
  if (log.datei === null || !log.begonnen) return;
  const prozesse = prozessliste();
  if (prozesse === null) return;
  schreibe("prozesse", { zeitpunkt, datei, anlass, last: loadavg(), prozesse });
}

function schreibe(art, daten) {
  if (log.datei === null || !log.begonnen) return;
  const jetzt = Date.now();
  const eintrag = { art, zeit: new Date(jetzt).toISOString(), ms_seit_start: jetzt - log.beginn, ...daten };
  try {
    appendFileSync(log.datei, `${JSON.stringify(eintrag)}\n`);
  } catch (fehler) {
    log.datei = null;
    melde(`kein Log mehr, das Ergebnis bleibt davon unberührt: ${fehler.message}`);
  }
}

export function beginneLog(logordner, kopf) {
  log.beginn = Date.now();
  log.letzteZeile = log.beginn;
  log.begonnen = true;
  let datei;
  try {
    const ordner = logordner();
    mkdirSync(ordner, { recursive: true });
    datei = join(ordner, `${new Date(log.beginn).toISOString().replace(DATEINAME_OHNE, "-")}-${pid}${ENDUNG}`);
    log.datei = datei;
  } catch (fehler) {
    melde(`kein Log, das Ergebnis bleibt davon unberührt: ${fehler.message}`);
    return;
  }
  schreibe("start", { ...kopf, pid });
  melde(`Log in ${relative(cwd(), datei)} (Betriebsart ${kopf.betriebsart}${kopf.basis ? `, Basis ${kopf.basis}` : ""})`);
}

function notierePhase(phase, ms, daten = {}) {
  log.phasen[phase] += ms;
  schreibe(phase, { ms, ...daten });
}

export function notiereSperre(ms) {
  notierePhase("sperre", ms);
  melde(`Sperre nach ${dauer(ms)} Warten erhalten`);
}

export function notiereTestauswahl(ms, { seite, dateien, testdateien }) {
  notierePhase("testauswahl", ms, { seite, dateien, testdateien });
  melde(`Testauswahl (Seite ${seite}): ${dateien} Dateien, ${testdateien} Testdateien in ${dauer(ms)}`);
}

export function notiereVorschau(umfang) {
  schreibe("vorschau", umfang);
}

export function notiereLoeschprobe(ms, { datei }) {
  notierePhase("loeschprobe", ms, { datei });
  melde(`Löschprobe ${datei} in ${dauer(ms)}`);
}

function ort(datei) {
  const { aktuell } = log;
  return aktuell?.datei === datei ? `Datei ${aktuell.nummer}/${aktuell.von} ${datei}` : `Datei ${datei}`;
}

export function dateiBeginnt(datei, { nummer, von, seite }) {
  log.aktuell = { datei, nummer, von, seite, beginn: Date.now(), laeufe: 0, ms_sandbox: 0, ms_erstlauf: 0, ms_mutanten: 0 };
}

export function dateiEndet(ergebnisse, ueberlebt) {
  const { beginn, ...aktuell } = log.aktuell;
  const ms = Date.now() - beginn;
  const ueberlebend = ergebnisse.filter(ueberlebt).length;
  schreibe("datei", { ...aktuell, ms, ergebnisse: ergebnisse.length, ueberlebt: ueberlebend });
  log.fertig.dateien += 1;
  melde(`${ort(aktuell.datei)} fertig in ${dauer(ms)}: ${aktuell.laeufe} Stryker-Läufe, ${ergebnisse.length} Ergebnisse, ${ueberlebend} überlebt`);
  log.aktuell = null;
}

export function fortschrittFaellig({ letzte, jetzt }) {
  return jetzt - letzte >= FORTSCHRITT_ABSTAND_MS;
}

export function hochrechnung({ getestet, geplant, ms }) {
  if (getestet === 0 || ms <= 0) return { jeMinute: 0, restMs: null };
  return { jeMinute: (getestet * MS_JE_MINUTE) / ms, restMs: ((geplant - getestet) * ms) / getestet };
}

function fortschritt(lauf, jetzt) {
  const ms = jetzt - (lauf.erstlaufEnde ?? lauf.beginn);
  const { jeMinute, restMs } = hochrechnung({ getestet: lauf.getestet, geplant: lauf.geplant, ms });
  const rest = restMs === null ? "noch keine" : dauer(restMs);
  const rate = `${komma(jeMinute)} Mutanten/min gemessen, Hochrechnung Rest dieses Stryker-Laufs ${rest}`;
  melde(`Fortschritt ${ort(lauf.datei)}, ${lauf.anlass}: ${lauf.getestet}/${lauf.geplant} Mutanten in ${dauer(ms)}, ${rate}; Lauf insgesamt ${dauer(jetzt - log.beginn)}`);
}

function testdatei({ fileName, name }) {
  const pfad = (fileName ?? name).replace(SANDBOXPFAD, "");
  return isAbsolute(pfad) ? relative(realpathSync(cwd()), pfad) : pfad;
}

function aendere(kennung, aenderung) {
  const lauf = log.laeufe.get(kennung);
  log.laeufe.set(kennung, { ...lauf, ...aenderung(lauf) });
}

function langsamste(tests) {
  return [...tests]
    .sort((links, rechts) => rechts.timeSpentMs - links.timeSpentMs)
    .slice(0, LANGSAMSTE)
    .map((test) => ({ datei: testdatei(test), ms: Math.round(test.timeSpentMs) }));
}

function erstlaufFertig(kennung, { result, timing }) {
  aendere(kennung, () => ({ erstlaufEnde: Date.now(), erstlaufMs: timing.net + timing.overhead, tests: result.tests.length, langsamste: langsamste(result.tests) }));
}

function mutantGetestet(kennung, { status }) {
  if (status === NICHT_GELAUFEN) return;
  aendere(kennung, ({ getestet }) => ({ getestet: getestet + 1 }));
  const jetzt = Date.now();
  if (!fortschrittFaellig({ letzte: log.letzteZeile, jetzt })) return;
  log.letzteZeile = jetzt;
  fortschritt(log.laeufe.get(kennung), jetzt);
}

function zeitlogReporter(options) {
  const kennung = options[OPTION];
  if (!log.laeufe.has(kennung)) return {};
  return {
    onDryRunCompleted: (ereignis) => erstlaufFertig(kennung, ereignis),
    onMutationTestingPlanReady: ({ mutantPlans }) => aendere(kennung, () => ({ geplant: mutantPlans.filter(({ plan }) => plan === GEPLANT).length })),
    onMutantTested: (ergebnis) => mutantGetestet(kennung, ergebnis),
  };
}
zeitlogReporter.inject = [OPTIONEN];

function einzeln(anlass, { status }) {
  return anlass !== ERSTER_LAUF || EINZELN_IM_ERSTEN_LAUF.has(status);
}

function zaehle(ergebnisse) {
  const status = {};
  for (const eintrag of ergebnisse) status[eintrag.status] = (status[eintrag.status] ?? 0) + 1;
  return status;
}

function dauern(lauf, jetzt) {
  const erstlaufEnde = lauf.erstlaufEnde ?? jetzt;
  const ms_erstlauf = Math.min(lauf.erstlaufMs, erstlaufEnde - lauf.beginn);
  return { ms_sandbox: erstlaufEnde - lauf.beginn - ms_erstlauf, ms_erstlauf, ms_mutanten: jetzt - erstlaufEnde };
}

const ZEITFELDER = { sandbox: "ms_sandbox", erstlauf: "ms_erstlauf", mutanten: "ms_mutanten" };

function verbuche(datei, zeiten) {
  for (const [phase, feld] of Object.entries(ZEITFELDER)) log.phasen[phase] += zeiten[feld];
  const { aktuell } = log;
  if (aktuell?.datei !== datei) return;
  const summen = Object.fromEntries(Object.values(ZEITFELDER).map((feld) => [feld, aktuell[feld] + zeiten[feld]]));
  log.aktuell = { ...aktuell, ...summen, laeufe: aktuell.laeufe + 1 };
}

function laufFertig(lauf, ergebnisse, fehler) {
  const jetzt = Date.now();
  const zeiten = dauern(lauf, jetzt);
  verbuche(lauf.datei, zeiten);
  const { datei, anlass, testdateien, tests, geplant, langsamste } = lauf;
  for (const { schluessel, lage, art, status, toeter } of ergebnisse.filter((eintrag) => einzeln(anlass, eintrag))) {
    schreibe("mutant", { anlass, schluessel, datei, lage, mutator: art, status, toeter: toeter.length > 0 ? toeter : null });
  }
  const status = zaehle(ergebnisse);
  const zahlen = { mutanten: ergebnisse.length, getoetet: status[GETOETET] ?? 0, ueberlebt: ergebnisse.filter(lauf.ueberlebt).length, zeitueberschreitung: status[ZEITUEBERSCHREITUNG] ?? 0 };
  log.fertig = { ...log.fertig, laeufe: log.fertig.laeufe + 1, mutanten: log.fertig.mutanten + zahlen.mutanten, getoetet: log.fertig.getoetet + zahlen.getoetet };
  schreibe("stryker", { datei, anlass, testdateien, tests, geplant, ms: jetzt - lauf.beginn, ...zeiten, ...zahlen, status, langsamste, ...(fehler ? { fehler: fehler.message } : {}) });
  const teile = `Sandbox ${dauer(zeiten.ms_sandbox)}, Erstlauf ${dauer(zeiten.ms_erstlauf)}, Mutanten ${dauer(zeiten.ms_mutanten)}`;
  const ausgang = fehler ? `abgebrochen: ${fehler.message}` : `${zahlen.getoetet} getötet, ${zahlen.ueberlebt} überlebt, ${zahlen.zeitueberschreitung} Zeitüberschreitung`;
  melde(`${ort(datei)}, ${anlass}: ${zahlen.mutanten} Mutanten gegen ${testdateien} Testdateien; ${teile}; ${ausgang}`);
}

export function strykerLauf({ datei, anlass, testdateien }, ueberlebt) {
  const kennung = randomUUID();
  notiereProzesse("vor", { datei, anlass });
  const lauf = { datei, anlass, testdateien, ueberlebt, beginn: Date.now(), erstlaufEnde: undefined, erstlaufMs: 0, tests: 0, geplant: 0, getestet: 0, langsamste: [] };
  log.laeufe.set(kennung, lauf);
  const fertig = (ergebnisse, fehler) => {
    const stand = log.laeufe.get(kennung);
    log.laeufe.delete(kennung);
    laufFertig(stand, ergebnisse, fehler);
    notiereProzesse("nach", stand);
  };
  return {
    optionen: { [OPTION]: kennung, reporters: [ZEITLOG] },
    fertig: (ergebnisse) => fertig(ergebnisse),
    abgebrochen: (fehler) => fertig([], fehler),
  };
}

export function notiereBudget(halt) {
  const laufend = [...log.laeufe.values()].map(({ datei, anlass, geplant, getestet }) => ({ datei, anlass, geplant, getestet }));
  schreibe("budget", { ...halt, fertig: log.fertig, laufend, aktuell: log.aktuell?.datei ?? null });
  const { laeufe, mutanten, getoetet, dateien } = log.fertig;
  const ort = log.datei === null ? "kein Zeit-Log" : `Zeit-Log ${relative(cwd(), log.datei)}`;
  return `Teilergebnis bis zum Halt: ${laeufe} Stryker-Läufe fertig mit ${mutanten} Mutanten, davon ${getoetet} getötet, ${dateien} Dateien ganz geprüft, ${laufend.length} Läufe abgebrochen; ${ort}`;
}

export function beendeLog(exit) {
  if (!log.begonnen) return;
  const ms = Date.now() - log.beginn;
  schreibe("ende", { ms, exit, phasen: log.phasen });
  log.begonnen = false;
  const anteile = Object.entries(PHASEN).map(([phase, name]) => `${name} ${anteil(log.phasen[phase], ms)}`);
  melde(`Ende nach ${dauer(ms)}, Exit ${exit}: ${anteile.join(", ")}`);
}

export const strykerPlugins = [{ kind: REPORTER, name: ZEITLOG, factory: zeitlogReporter }];
export const strykerValidationSchema = { type: "object", properties: { [OPTION]: { type: "string" } } };
