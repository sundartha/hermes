import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import process, { cwd, env, pid } from "node:process";
import { createInterface } from "node:readline";

import { neuerTempOrdner } from "../temp-ordner.mjs";

export const SPERRDATEI_VARIABLE = "SCHWERLAUF_SPERRDATEI";
export const HALTER_VARIABLE = "SCHWERLAUF_HALTER";
const STANDARD_ORDNER = "/tmp";
const FREI = "frei";
const WARTET = "wartet";
const BELEGT = "belegt";
const EXIT_ROT = 1;
const HALTERDATEI_OHNE_SYMLINK = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
const NUR_EIGENTUEMER = 0o600;
const MS_PRO_SEKUNDE = 1000;
const MS_PRO_MINUTE = 60_000;
const MELDEABSTAND_MINUTEN = 5;
const WARTEN_IST_RICHTIG =
  "Sie verhindert, dass schwere Läufe sich gegenseitig ausbremsen und unter Last falsch rot werden. Warten ist richtig: den Halter nicht beenden, die Sperre nicht umlenken.";
const PERL = "/usr/bin/perl";
const PS = "/bin/ps";
const ZOMBIE = "Z";
const HALTEN = [
  "use Fcntl qw(:flock); $| = 1; my $eltern = getppid();",
  'open(my $f, ">>", $ARGV[0]) or die "Sperrdatei $ARGV[0]: $!\\n";',
  'unless (flock($f, LOCK_EX | LOCK_NB)) { print "wartet\\n"; until (flock($f, LOCK_EX | LOCK_NB)) { exit 3 if getppid() != $eltern; sleep 1; } }',
  'print "frei\\n";',
  "1 while sysread(STDIN, my $rest, 4096);",
].join("\n");
const NACHSEHEN = [
  "use Fcntl qw(:flock); $| = 1;",
  'open(my $f, ">>", $ARGV[0]) or die "Sperrdatei $ARGV[0]: $!\\n";',
  'print flock($f, LOCK_SH | LOCK_NB) ? "frei\\n" : "belegt\\n";',
].join("\n");

export function sperrdatei() {
  return env[SPERRDATEI_VARIABLE] || join(STANDARD_ORDNER, `hermes-schwerlauf-${userInfo().uid}.lock`);
}

function halterdatei(datei) {
  return `${datei}.json`;
}

function eingetragenerHalter(datei) {
  try {
    return JSON.parse(readFileSync(halterdatei(datei), "utf8"));
  } catch {
    return null;
  }
}

function lebt(prozess) {
  try {
    process.kill(prozess, 0);
    return true;
  } catch {
    return false;
  }
}

function halterZeile(datei) {
  const halter = eingetragenerHalter(datei);
  if (halter === null || !lebt(halter.pid)) return "Halter nicht eingetragen";
  return `PID ${halter.pid}, ${halter.anlass}, in ${halter.ort}, seit ${halter.seit}`;
}

function innerhalbDesHalters(datei) {
  const schluessel = env[HALTER_VARIABLE];
  const halter = eingetragenerHalter(datei);
  return Boolean(schluessel) && halter?.schluessel === schluessel && lebt(halter.pid);
}

function perl(skript, datei) {
  return spawn(PERL, ["-e", skript, datei], { stdio: ["pipe", "pipe", "inherit"] });
}

function warteMeldung(datei, seit) {
  const minuten = Math.floor((Date.now() - seit) / MS_PRO_MINUTE);
  return `Schwerer Lauf wartet seit ${minuten} min auf die Sperre ${datei}: gehalten von ${halterZeile(datei)}. ${WARTEN_IST_RICHTIG}`;
}

function nichtErhalten(grund) {
  return new Error(`Sperre für schwere Läufe nicht erhalten: ${grund}`);
}

function aufruferVon(eltern) {
  return () => process.ppid !== eltern;
}

function bisFrei(kind, datei, aufruferBeendet) {
  const seit = Date.now();
  let erinnerung;
  let erste;
  return new Promise((erhalten, abgelehnt) => {
    const nichtStarten = () => {
      kind.kill();
      ende(nichtErhalten("der Aufrufer ist beendet, der Lauf startet nicht mehr"));
    };
    const waisenwache = setInterval(() => {
      if (aufruferBeendet()) nichtStarten();
    }, MS_PRO_SEKUNDE);
    const ende = (fehler) => {
      clearInterval(waisenwache);
      clearTimeout(erste);
      clearInterval(erinnerung);
      if (fehler) abgelehnt(fehler);
      else erhalten({ gewartet: erinnerung !== undefined, ms: Date.now() - seit });
    };
    kind.on("error", (fehler) => ende(nichtErhalten(fehler.message)));
    kind.on("exit", (code) => ende(nichtErhalten(`perl endete mit Exit ${code}`)));
    createInterface({ input: kind.stdout }).on("line", (zeile) => {
      if (zeile === FREI) {
        if (aufruferBeendet()) nichtStarten();
        else ende();
      }
      if (zeile !== WARTET) return;
      const melden = () => console.error(warteMeldung(datei, seit));
      erste = setTimeout(melden, MS_PRO_SEKUNDE);
      erinnerung = setInterval(melden, MELDEABSTAND_MINUTEN * MS_PRO_MINUTE);
    });
  });
}

function haeltNoch(kind) {
  const zustand = spawnSync(PS, ["-o", "stat=", "-p", String(kind.pid)], { encoding: "utf8" }).stdout.trim();
  return zustand !== "" && !zustand.startsWith(ZOMBIE);
}

function trageHalterEin(datei, anlass) {
  const schluessel = randomUUID();
  const halter = { pid, anlass, ort: cwd(), seit: new Date().toISOString(), schluessel };
  writeFileSync(halterdatei(datei), JSON.stringify(halter), { flag: HALTERDATEI_OHNE_SYMLINK, mode: NUR_EIGENTUEMER });
  return schluessel;
}

function meldeSperrverlustBeimEnde(kind, anlass) {
  kind.removeAllListeners("exit");
  process.on("exit", () => {
    if (haeltNoch(kind)) return;
    console.error(`Sperre für schwere Läufe während des Laufs verloren (perl beendet), der Lauf zählt als rot: ${anlass}`);
    process.exitCode = EXIT_ROT;
  });
}

function loeseHalterVomEventLoop(kind) {
  kind.stdout.destroy();
  kind.stdin.unref();
  kind.unref();
}

export async function sperreNehmenUndHalterEintragen(datei, anlass, aufruferBeendet = aufruferVon(process.ppid)) {
  const kind = perl(HALTEN, datei);
  const { gewartet, ms } = await bisFrei(kind, datei, aufruferBeendet);
  let schluessel;
  try {
    schluessel = trageHalterEin(datei, anlass);
  } catch (fehler) {
    kind.kill();
    throw nichtErhalten(`Halter nicht eintragbar: ${fehler.message}`);
  }
  meldeSperrverlustBeimEnde(kind, anlass);
  loeseHalterVomEventLoop(kind);
  if (gewartet) console.error(`Schwerer Lauf: Sperre erhalten nach ${Math.round(ms / MS_PRO_SEKUNDE)} s (${anlass}).`);
  return schluessel;
}

function gibSchluesselAnKindprozesseWeiter(schluessel) {
  env[HALTER_VARIABLE] = schluessel;
}

export async function nimmSperreAuchFuerKindprozesse(anlass) {
  const datei = sperrdatei();
  if (innerhalbDesHalters(datei)) return;
  gibSchluesselAnKindprozesseWeiter(await sperreNehmenUndHalterEintragen(datei, anlass));
}

export async function nimmEigeneSperreFuerTests(umgebung) {
  const ordner = neuerTempOrdner("schwerlauf-testlauf-");
  const datei = join(ordner, "sperre");
  const schluessel = await sperreNehmenUndHalterEintragen(datei, "Testlauf");
  return { ...umgebung, [SPERRDATEI_VARIABLE]: datei, [HALTER_VARIABLE]: schluessel };
}

export function stand() {
  const datei = sperrdatei();
  const kind = perl(NACHSEHEN, datei);
  return new Promise((ergebnis, abgelehnt) => {
    kind.on("error", abgelehnt);
    kind.on("close", (code) => abgelehnt(new Error(`Stand nicht lesbar: perl endete mit Exit ${code}`)));
    createInterface({ input: kind.stdout }).on("line", (zeile) => {
      ergebnis(zeile === BELEGT ? `belegt: ${halterZeile(datei)}` : `frei (${datei})`);
    });
  });
}
