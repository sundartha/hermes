import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import process, { cwd, env, pid } from "node:process";
import { createInterface } from "node:readline";

import { neuerTempOrdner } from "../temp-ordner.mjs";

export const SPERRDATEI_VARIABLE = "SCHWERLAUF_SPERRDATEI";
export const PLAETZE_VARIABLE = "SCHWERLAUF_PLAETZE";
export const HALTER_VARIABLE = "SCHWERLAUF_HALTER";
const VORRANG_VARIABLE = "SCHWERLAUF_VORRANG";
const VORRANG_PUSH = "push";
export const STANDARD_PLAETZE = 2;
const ANZAHL = /^[1-9]\d*$/;
const STANDARD_ORDNER = "/tmp";
const FREI = /^frei (\d+)$/;
const WARTET = "wartet";
const BELEGT = "belegt";
const ALLEIN = 0;
const ART_ALLEIN = "allein";
const ART_PLATZ = "platz";
const WARTENDE = ".wartet-";
const RANG_VORRANG = "0";
const RANG_GEWOEHNLICH = "1";
const KOMMT = ".kommt-";
const REIHT = /^reiht (.+)$/;
const JSON_ENDUNG = ".json";
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
  "use Fcntl qw(:flock); use Time::HiRes (); $| = 1; my $eltern = getppid(); my ($art, $ordner, $vorne, $rang, $kommt, @pfade) = @ARGV;",
  'my @f = map { open(my $h, ">>", $_) or die "Sperrdatei $_: $!\\n"; $h } @pfade;',
  'open(my $eigen, "<", "$ordner/$kommt") or die "Wartenden-Eintrag $kommt: $!\\n"; flock($eigen, LOCK_EX) or die "Wartenden-Eintrag $kommt: $!\\n";',
  'my $ich = sprintf("%s%s-%015d-%d.json", $vorne, $rang, Time::HiRes::time() * 1000, $$); rename("$ordner/$kommt", "$ordner/$ich") or die "Wartenden-Eintrag $ich: $!\\n"; print "reiht $ich\\n";',
  "my ($tor, $haupt, @plaetze) = @f; my $gemeldet = 0; my $platz = 0;",
  'sub warte { print "wartet\\n" unless $gemeldet++; exit 3 if getppid() != $eltern; select(undef, undef, undef, 0.25); }',
  'sub tot { open(my $h, "<", "$ordner/$_[0]") or return 1; return flock($h, LOCK_SH | LOCK_NB); }',
  'sub vorMir { opendir(my $d, $ordner) or die "Sperrordner $ordner: $!\\n"; return grep { index($_, $vorne) == 0 && $_ lt $ich && !tot($_) } readdir($d); }',
  "sub lass { flock($_, LOCK_UN) for @_; return 0; }",
  "sub freierPlatz { for my $i (0 .. $#plaetze) { return $i + 1 if flock($plaetze[$i], LOCK_EX | LOCK_NB); } return 0; }",
  "sub allein { return 0 unless flock($haupt, LOCK_EX | LOCK_NB); close($_) for @plaetze; return 1; }",
  "sub platz { return 0 unless flock($haupt, LOCK_SH | LOCK_NB); ($platz = freierPlatz()) or return lass($haupt); close($plaetze[$_ - 1]) for grep { $_ != $platz } 1 .. @plaetze; close($tor); return 1; }",
  'sub belege { return 0 if vorMir() || !flock($tor, LOCK_EX | LOCK_NB); return 1 if ($art eq "allein" ? allein() : platz()); return lass($tor); }',
  "warte() until belege(); close($eigen);",
  'print "frei $platz\\n";',
  "1 while sysread(STDIN, my $rest, 4096);",
].join("\n");
const NACHSEHEN = [
  "use Fcntl qw(:flock); $| = 1;",
  'for my $pfad (@ARGV) { open(my $f, ">>", $pfad) or die "Sperrdatei $pfad: $!\\n"; print flock($f, LOCK_SH | LOCK_NB) ? "frei\\n" : "belegt\\n"; }',
].join("\n");

export function sperrdatei() {
  return env[SPERRDATEI_VARIABLE] || join(STANDARD_ORDNER, `hermes-schwerlauf-${userInfo().uid}.lock`);
}

function nichtErhalten(grund) {
  return new Error(`Sperre für schwere Läufe nicht erhalten: ${grund}`);
}

export function plaetze() {
  const wert = env[PLAETZE_VARIABLE];
  if (wert === undefined || wert === "") return STANDARD_PLAETZE;
  if (!ANZAHL.test(wert)) throw nichtErhalten(`${PLAETZE_VARIABLE}=${wert} ist keine Zahl von Plätzen`);
  return Number(wert);
}

function platzdatei(datei, platz) {
  return platz === ALLEIN ? datei : `${datei}.platz-${platz}`;
}

function halterdatei(datei, platz) {
  return `${platzdatei(datei, platz)}${JSON_ENDUNG}`;
}

function nummern(anzahl) {
  return Array.from({ length: anzahl }, (_leer, index) => index + 1);
}

function sperrpfade(datei, anzahl) {
  return [`${datei}.tor`, datei, ...nummern(anzahl).map((platz) => platzdatei(datei, platz))];
}

function gelesen(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
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

function lebenderEintrag(pfad) {
  const eintrag = gelesen(pfad);
  return eintrag !== null && lebt(eintrag.pid) ? eintrag : null;
}

function beschreibe(eintrag) {
  return `PID ${eintrag.pid}, ${eintrag.anlass}, in ${eintrag.ort}, seit ${eintrag.seit}`;
}

function halterZeile(datei, platz) {
  const halter = lebenderEintrag(halterdatei(datei, platz));
  return halter === null ? "Halter nicht eingetragen" : beschreibe(halter);
}

function lebendeHalter(datei, anzahl) {
  return [ALLEIN, ...nummern(anzahl)].map((platz) => lebenderEintrag(halterdatei(datei, platz))).filter(Boolean);
}

function innerhalbDesHalters(datei, anzahl) {
  const schluessel = env[HALTER_VARIABLE];
  return Boolean(schluessel) && lebendeHalter(datei, anzahl).some((halter) => halter.schluessel === schluessel);
}

function perl(skript, pfade) {
  return spawn(PERL, ["-e", skript, ...pfade], { stdio: ["pipe", "pipe", "inherit"] });
}

function warteMeldung({ datei, plaetze: anzahl }, seit) {
  const minuten = Math.floor((Date.now() - seit) / MS_PRO_MINUTE);
  const halter = lebendeHalter(datei, anzahl).map(beschreibe);
  const gehalten = halter.length > 0 ? halter.join("; ") : "Halter nicht eingetragen";
  return `Schwerer Lauf wartet seit ${minuten} min auf die Sperre ${datei}: gehalten von ${gehalten}. ${WARTEN_IST_RICHTIG}`;
}

function aufruferVon(eltern) {
  return () => process.ppid !== eltern;
}

function eintrag(anlass, allein) {
  return { pid, anlass, ort: cwd(), seit: new Date().toISOString(), allein };
}

function schreibeEintrag(pfad, inhalt) {
  writeFileSync(pfad, JSON.stringify(inhalt), { flag: HALTERDATEI_OHNE_SYMLINK, mode: NUR_EIGENTUEMER });
}

function trageWartendenEin({ kommt, anlass, allein }, vorrang) {
  try {
    schreibeEintrag(kommt, { ...eintrag(anlass, allein), vorrang });
  } catch (fehler) {
    throw nichtErhalten(`Wartenden-Eintrag ${kommt} nicht schreibbar: ${fehler.message}`);
  }
}

function trageWartendenAus(pfade) {
  for (const pfad of pfade.filter(Boolean)) rmSync(pfad, { force: true });
}

function bisFrei(kind, sperre, aufruferBeendet) {
  const seit = Date.now();
  let wartend = null;
  let erinnerung;
  let erste;
  let gemeldet = false;
  return new Promise((erhalten, abgelehnt) => {
    const nichtStarten = () => {
      kind.kill();
      ende(nichtErhalten("der Aufrufer ist beendet, der Lauf startet nicht mehr"));
    };
    const waisenwache = setInterval(() => {
      if (aufruferBeendet()) nichtStarten();
    }, MS_PRO_SEKUNDE);
    const ende = (fehler, platz) => {
      clearInterval(waisenwache);
      clearTimeout(erste);
      clearInterval(erinnerung);
      trageWartendenAus([sperre.kommt, wartend]);
      if (fehler) abgelehnt(fehler);
      else erhalten({ platz, gewartet: gemeldet, ms: Date.now() - seit });
    };
    const melden = () => {
      gemeldet = true;
      console.error(warteMeldung(sperre, seit));
    };
    kind.on("error", (fehler) => ende(nichtErhalten(fehler.message)));
    kind.on("exit", (code) => ende(nichtErhalten(`perl endete mit Exit ${code}`)));
    createInterface({ input: kind.stdout }).on("line", (zeile) => {
      const gereiht = REIHT.exec(zeile);
      if (gereiht) wartend = join(dirname(sperre.datei), gereiht[1]);
      const frei = FREI.exec(zeile);
      if (frei && aufruferBeendet()) nichtStarten();
      else if (frei) ende(undefined, Number(frei[1]));
      if (zeile !== WARTET) return;
      erste = setTimeout(melden, MS_PRO_SEKUNDE);
      erinnerung = setInterval(melden, MELDEABSTAND_MINUTEN * MS_PRO_MINUTE);
    });
  });
}

function haeltNoch(kind) {
  const zustand = spawnSync(PS, ["-o", "stat=", "-p", String(kind.pid)], { encoding: "utf8" }).stdout.trim();
  return zustand !== "" && !zustand.startsWith(ZOMBIE);
}

function trageHalterEin({ datei, anlass, allein }, platz) {
  const schluessel = randomUUID();
  schreibeEintrag(halterdatei(datei, platz), { ...eintrag(anlass, allein), schluessel });
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

function erhaltenMeldung({ anlass }, platz, ms) {
  const wo = platz === ALLEIN ? "alle Plätze" : `Platz ${platz}`;
  return `Schwerer Lauf: Sperre erhalten nach ${Math.round(ms / MS_PRO_SEKUNDE)} s (${wo}, ${anlass}).`;
}

export async function sperreNehmenUndHalterEintragen(datei, anlass, optionen = {}) {
  const { aufruferBeendet = aufruferVon(process.ppid), allein = false, vorrang = false, plaetze: anzahl = plaetze() } = optionen;
  const sperre = { datei, anlass, allein, plaetze: anzahl, kommt: `${datei}${KOMMT}${pid}-${randomUUID()}${JSON_ENDUNG}` };
  trageWartendenEin(sperre, vorrang);
  const einreihen = [dirname(datei), `${basename(datei)}${WARTENDE}`, vorrang ? RANG_VORRANG : RANG_GEWOEHNLICH, basename(sperre.kommt)];
  const kind = perl(HALTEN, [allein ? ART_ALLEIN : ART_PLATZ, ...einreihen, ...sperrpfade(datei, anzahl)]);
  const { platz, gewartet, ms } = await bisFrei(kind, sperre, aufruferBeendet);
  let schluessel;
  try {
    schluessel = trageHalterEin(sperre, platz);
  } catch (fehler) {
    kind.kill();
    throw nichtErhalten(`Halter nicht eintragbar: ${fehler.message}`);
  }
  meldeSperrverlustBeimEnde(kind, anlass);
  loeseHalterVomEventLoop(kind);
  if (gewartet) console.error(erhaltenMeldung(sperre, platz, ms));
  return schluessel;
}

function gibSchluesselAnKindprozesseWeiter(schluessel) {
  env[HALTER_VARIABLE] = schluessel;
}

function entnimmVorrangDerUmgebung(vorrangFuerPush) {
  const vorrang = vorrangFuerPush && env[VORRANG_VARIABLE] === VORRANG_PUSH;
  delete env[VORRANG_VARIABLE];
  return vorrang;
}

export async function nimmSperreAuchFuerKindprozesse(anlass, { allein = false, vorrangFuerPush = false } = {}) {
  const vorrang = entnimmVorrangDerUmgebung(vorrangFuerPush);
  const datei = sperrdatei();
  const anzahl = plaetze();
  if (innerhalbDesHalters(datei, anzahl)) return;
  gibSchluesselAnKindprozesseWeiter(await sperreNehmenUndHalterEintragen(datei, anlass, { allein, vorrang, plaetze: anzahl }));
}

export async function nimmEigeneSperreFuerTests(umgebung) {
  const ordner = neuerTempOrdner("schwerlauf-testlauf-");
  const datei = join(ordner, "sperre");
  const schluessel = await sperreNehmenUndHalterEintragen(datei, "Testlauf");
  return { ...umgebung, [SPERRDATEI_VARIABLE]: datei, [HALTER_VARIABLE]: schluessel };
}

function wartende(datei) {
  const vorne = `${basename(datei)}${WARTENDE}`;
  const namen = readdirSync(dirname(datei)).filter((name) => name.startsWith(vorne) && name.endsWith(JSON_ENDUNG)).sort();
  return namen.map((name) => lebenderEintrag(join(dirname(datei), name))).filter(Boolean);
}

function standZeilen(datei, anzahl, zustaende) {
  const [haupt, ...belegung] = zustaende;
  const platzZeilen = belegung.map((zustand, index) =>
    zustand === BELEGT ? `Platz ${index + 1}: belegt von ${halterZeile(datei, index + 1)}` : `Platz ${index + 1}: frei`,
  );
  const allein = haupt === BELEGT ? `Allein: belegt von ${halterZeile(datei, ALLEIN)}` : "Allein: frei";
  const warten = wartende(datei).map((wartend) => `Wartet: ${beschreibe(wartend)}${wartend.allein ? ", allein" : ""}${wartend.vorrang ? ", Vorrang" : ""}`);
  return [`Sperre für schwere Läufe: ${datei}, ${anzahl === 1 ? "1 Platz" : `${anzahl} Plätze`}`, ...platzZeilen, allein, ...(warten.length > 0 ? warten : ["Wartet: niemand"])];
}

export function stand() {
  const datei = sperrdatei();
  const anzahl = plaetze();
  const kind = perl(NACHSEHEN, sperrpfade(datei, anzahl).slice(1));
  const zustaende = [];
  return new Promise((ergebnis, abgelehnt) => {
    kind.on("error", abgelehnt);
    createInterface({ input: kind.stdout }).on("line", (zeile) => zustaende.push(zeile));
    kind.on("close", (code) => {
      if (code === 0 && zustaende.length === anzahl + 1) ergebnis(standZeilen(datei, anzahl, zustaende).join("\n"));
      else abgelehnt(new Error(`Stand nicht lesbar: perl endete mit Exit ${code}`));
    });
  });
}
