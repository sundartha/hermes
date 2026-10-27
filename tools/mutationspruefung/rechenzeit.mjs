import { spawnSync } from "node:child_process";
import process, { pid } from "node:process";

import { BUDGET_MS, SCHAETZUNG_MS } from "./budget.mjs";
import { beendeLog, dauer, notiereBudget, notiereVorschau } from "./zeitlog.mjs";

const PRUEFUNG = { normal: "der normalen Mutation", testumbau: "der Testumbau-Mutation" };
const EXIT_ABBRUCH = 2;
const PROZESSLISTE = ["-A", "-o", "pid=,ppid="];
const PROZESSZEILE = /^\s*(\d+)\s+(\d+)\s*$/;
const LEEREN_HOECHSTENS_MS = 5000;
const uhr = { art: null, verbraucht: 0, gewartet: 0, seit: null, zeitgeber: null, angehalten: false };
const offen = new Set();
const sperrhalter = new Set();

function laufe() {
  uhr.seit = Date.now();
  uhr.zeitgeber = setTimeout(halte, Math.max(0, BUDGET_MS[uhr.art] - uhr.verbraucht));
  uhr.zeitgeber.unref();
}

export function starteBudget(art) {
  uhr.art = art;
  laufe();
}

export function budgetLaeuft() {
  return uhr.art !== null;
}

function rechenzeit() {
  return uhr.verbraucht + (uhr.seit === null ? 0 : Date.now() - uhr.seit);
}

export async function anDerSperre(nehmen) {
  if (!budgetLaeuft()) return nehmen();
  clearTimeout(uhr.zeitgeber);
  uhr.verbraucht = rechenzeit();
  uhr.seit = null;
  const beginn = Date.now();
  const vorher = new Set(nachkommen());
  try {
    return await nehmen();
  } finally {
    for (const halter of nachkommen().filter((kind) => !vorher.has(kind))) sperrhalter.add(halter);
    uhr.gewartet += Date.now() - beginn;
    laufe();
  }
}

export function beimHalt(aufraeumen) {
  offen.add(aufraeumen);
  return () => offen.delete(aufraeumen);
}

export function schaetzung({ aufrufe, mutanten }) {
  return aufrufe * SCHAETZUNG_MS.aufruf + mutanten * SCHAETZUNG_MS.mutant;
}

function budgetText() {
  return `Budget ${PRUEFUNG[uhr.art]} ${dauer(BUDGET_MS[uhr.art])} Rechenzeit`;
}

export function vorschau(umfang) {
  if (!budgetLaeuft()) return;
  const { seite, quelldateien, testdateien, testgruppen, aufrufe, mutanten, unzaehlbar } = umfang;
  const ms = schaetzung(umfang);
  const frei = BUDGET_MS[uhr.art] - rechenzeit();
  const rechnung = `${aufrufe} Stryker-Aufrufe × ${dauer(SCHAETZUNG_MS.aufruf)} + ${mutanten} Mutanten × ${dauer(SCHAETZUNG_MS.mutant)} = ${dauer(ms)}`;
  const unbekannt = unzaehlbar > 0 ? `, Mutanten in ${unzaehlbar} Quelldateien nicht zählbar, Schätzung mindestens` : "";
  console.log(`Vorschau ${seite}: ${quelldateien} Quelldateien, ${testdateien} Testdateien, ${testgruppen} Testgruppen, ${mutanten} Mutanten${unbekannt}; Schätzung ${rechnung}; ${budgetText()}, davon frei ${dauer(frei)}.`);
  notiereVorschau({ ...umfang, schaetzung_ms: ms, budget_ms: BUDGET_MS[uhr.art], frei_ms: frei });
  if (ms > frei) throw new Error(`Budget: Schätzung ${dauer(ms)} liegt über dem ${budgetText()} (frei ${dauer(frei)}); kein Start, kein Urteil.`);
}

function nachkommen() {
  const liste = spawnSync("ps", PROZESSLISTE, { encoding: "utf8" });
  if (liste.error !== undefined) console.error(`Prozessliste nicht lesbar (${liste.error?.message}); Kindprozesse bleiben unbeendet.`);
  const kinder = new Map();
  for (const zeile of (liste.stdout ?? "").split("\n")) {
    const treffer = PROZESSZEILE.exec(zeile);
    if (treffer) kinder.set(Number(treffer[2]), [...(kinder.get(Number(treffer[2])) ?? []), Number(treffer[1])]);
  }
  const gefunden = [pid];
  for (const eltern of gefunden) gefunden.push(...(kinder.get(eltern) ?? []).filter((kind) => !sperrhalter.has(kind)));
  return gefunden.slice(1);
}

function beendeNachkommen() {
  for (const kind of nachkommen()) {
    try {
      process.kill(kind, "SIGKILL");
    } catch {
      continue;
    }
  }
}

function raeumeAuf() {
  for (const aufraeumen of [...offen].reverse()) {
    try {
      aufraeumen();
    } catch (fehler) {
      console.error(`Aufräumen nach dem Halt: ${fehler.message}`);
    }
  }
}

function beendeNachLeeren() {
  const schreiben = [process.stdout, process.stderr].map((strom) => strom.write.bind(strom));
  for (const strom of [process.stdout, process.stderr]) strom.write = () => true;
  const ende = () => {
    beendeNachkommen();
    process.exit(EXIT_ABBRUCH);
  };
  setTimeout(ende, LEEREN_HOECHSTENS_MS);
  schreiben[0]("", () => schreiben[1]("", ende));
}

function halte() {
  if (uhr.angehalten) return;
  const ms = rechenzeit();
  if (ms < BUDGET_MS[uhr.art]) {
    uhr.verbraucht = ms;
    laufe();
    return;
  }
  uhr.angehalten = true;
  beendeNachkommen();
  raeumeAuf();
  const teilergebnis = notiereBudget({ pruefung: uhr.art, budget_ms: BUDGET_MS[uhr.art], rechenzeit_ms: ms, warten_ms: uhr.gewartet });
  const ursache = `${dauer(ms)} Rechenzeit bei ${dauer(BUDGET_MS[uhr.art])} Budget, dazu ${dauer(uhr.gewartet)} Warten an der Sperre`;
  console.error(`Abbruch: Budget ${PRUEFUNG[uhr.art]} erreicht: ${ursache}; ${teilergebnis}; kein Urteil.`);
  beendeLog(EXIT_ABBRUCH);
  beendeNachLeeren();
}
