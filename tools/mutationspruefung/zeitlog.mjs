import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { cwd, pid } from "node:process";

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
export const PHASEN = { sperre: "Sperre", testauswahl: "Testauswahl", sandbox: "Sandbox", erstlauf: "Erstlauf", mutanten: "Mutantenläufe", loeschprobe: "Löschprobe" };

const log = { datei: null, begonnen: false, beginn: Date.now(), letzteZeile: Date.now(), phasen: leerePhasen(), laeufe: new Map(), aktuell: null };

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

function schreibe(art, daten) {
  if (log.datei === null) return;
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
  schreibe("stryker", { datei, anlass, testdateien, tests, geplant, ms: jetzt - lauf.beginn, ...zeiten, ...zahlen, status, langsamste, ...(fehler ? { fehler: fehler.message } : {}) });
  const teile = `Sandbox ${dauer(zeiten.ms_sandbox)}, Erstlauf ${dauer(zeiten.ms_erstlauf)}, Mutanten ${dauer(zeiten.ms_mutanten)}`;
  const ausgang = fehler ? `abgebrochen: ${fehler.message}` : `${zahlen.getoetet} getötet, ${zahlen.ueberlebt} überlebt, ${zahlen.zeitueberschreitung} Zeitüberschreitung`;
  melde(`${ort(datei)}, ${anlass}: ${zahlen.mutanten} Mutanten gegen ${testdateien} Testdateien; ${teile}; ${ausgang}`);
}

export function strykerLauf({ datei, anlass, testdateien }, ueberlebt) {
  const kennung = randomUUID();
  const lauf = { datei, anlass, testdateien, ueberlebt, beginn: Date.now(), erstlaufEnde: undefined, erstlaufMs: 0, tests: 0, geplant: 0, getestet: 0, langsamste: [] };
  log.laeufe.set(kennung, lauf);
  const fertig = (ergebnisse, fehler) => {
    const stand = log.laeufe.get(kennung);
    log.laeufe.delete(kennung);
    laufFertig(stand, ergebnisse, fehler);
  };
  return {
    optionen: { [OPTION]: kennung, reporters: [ZEITLOG] },
    fertig: (ergebnisse) => fertig(ergebnisse),
    abgebrochen: (fehler) => fertig([], fehler),
  };
}

export function beendeLog(exit) {
  if (!log.begonnen) return;
  const ms = Date.now() - log.beginn;
  schreibe("ende", { ms, exit, phasen: log.phasen });
  const anteile = Object.entries(PHASEN).map(([phase, name]) => `${name} ${anteil(log.phasen[phase], ms)}`);
  melde(`Ende nach ${dauer(ms)}, Exit ${exit}: ${anteile.join(", ")}`);
}

export const strykerPlugins = [{ kind: REPORTER, name: ZEITLOG, factory: zeitlogReporter }];
export const strykerValidationSchema = { type: "object", properties: { [OPTION]: { type: "string" } } };
