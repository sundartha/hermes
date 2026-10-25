import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { block, isInside, readInput, realPath, repositoryRoot, startDirectory } from "./lib.mjs";

const UMLEITUNG = /^(?:&>>?|<<<|<<-|<<|<>|<&|>>|>&|>\||[<>])/;
const UND_ODER = /^(?:&>|&&|\|\||\|&|[&|])/;
const PROZESS_ERSETZUNG = /^[<>]\(/;
const MASKIERUNG = /^\\[\s\S]?/;
const LESEND = new Set(["<", "<&", "<<<", "<<", "<<-"]);
const HEREDOC = new Set(["<<", "<<-"]);
const DUPLIKAT = new Set([">&", "<&"]);
const DESKRIPTOR = /^(?:\d+|-)$/;
const FD_WORT = /^(?:\d+|\{\w+\})$/;
const MUSTER = new Set(["*", "?", "[", "{"]);
const BEDINGT_VORHER = new Set(["&&", "||", "|"]);
const BEDINGT_NACHHER = new Set(["|", "&"]);
const ERSETZUNG_GESPERRT =
  "Ersetzung in Bash ist für Test- und Bau-Agent gesperrt; ohne Ersetzung schreiben: Temp-Datei als fester Pfad unter /tmp statt $TMPDIR, " +
  "$ in Mustern in einfache Anführungszeichen, Pfade und Dateien wörtlich statt aus Variable oder Schleife (mehrere Dateien in einem Aufruf), Exit-Code nur mit $?";
const EXIT_CODE = "$?";
const SCHRITTE = new Map([
  ["\\", (zerleger) => zerleger.maskierung()],
  ["'", (zerleger) => zerleger.einfach()],
  ['"', (zerleger) => zerleger.doppelt()],
  ["$", (zerleger) => zerleger.dollar()],
  ["`", (zerleger) => zerleger.backtick()],
  ["#", (zerleger) => zerleger.kommentar()],
  [" ", (zerleger) => zerleger.leer()],
  ["\t", (zerleger) => zerleger.leer()],
  ["\n", (zerleger) => zerleger.zeilenEnde()],
  [";", (zerleger) => zerleger.trenner(1, ";")],
  ["&", (zerleger) => zerleger.undOder()],
  ["|", (zerleger) => zerleger.undOder()],
  ["(", (zerleger) => zerleger.klammerAuf()],
  [")", (zerleger) => zerleger.klammerZu()],
  ["<", (zerleger) => zerleger.pfeil()],
  [">", (zerleger) => zerleger.pfeil()],
]);

function neuesWort() {
  return { text: "", dyn: false, dynAb: -1, glob: false, zitiert: false };
}

class Zerleger {
  constructor(text) {
    Object.assign(this, { text, i: 0, befehle: [], woerter: [], umleitungen: [], wort: null, wartet: null });
    Object.assign(this, { heredocs: [], tiefe: 0, klammer: 0, vorher: "", fehler: null });
    this.lies(null);
    this.befehlEnde("\n");
  }

  get rest() {
    return this.text.slice(this.i);
  }

  aktuell() {
    this.wort ??= neuesWort();
    return this.wort;
  }

  anhaengen(zeichen) {
    this.aktuell().text += zeichen;
  }

  melde(fehler) {
    this.fehler ??= fehler;
  }

  dynamisch() {
    const offen = this.aktuell();
    if (offen.dynAb === -1) offen.dynAb = offen.text.length;
    offen.dyn = true;
  }

  wortEnde() {
    const fertig = this.wort;
    this.wort = null;
    if (fertig === null) return;
    if (this.wartet === null) {
      this.woerter.push(fertig);
      return;
    }
    this.wartet.ziel = fertig;
    if (HEREDOC.has(this.wartet.op)) this.heredocMerken(fertig);
    this.wartet = null;
  }

  heredocMerken(marke) {
    if (marke.dyn) this.melde("Heredoc-Endmarke mit $");
    this.heredocs.push({ ende: marke.text, zitiert: marke.zitiert, tabs: this.wartet.op === "<<-" });
  }

  befehlEnde(trenner) {
    this.wortEnde();
    if (this.wartet !== null) this.melde(`Umleitung ${this.wartet.op} ohne Ziel`);
    if (this.woerter.length > 0 || this.umleitungen.length > 0) {
      const imBlock = this.tiefe > 0 || this.klammer > 0;
      const bedingt = imBlock || BEDINGT_VORHER.has(this.vorher) || BEDINGT_NACHHER.has(trenner);
      this.befehle.push({ woerter: this.woerter, umleitungen: this.umleitungen, bedingt });
    }
    Object.assign(this, { woerter: [], umleitungen: [], vorher: trenner });
  }

  unterBefehl(ende) {
    const { woerter, umleitungen, wort, wartet, klammer, vorher, tiefe } = this;
    Object.assign(this, { woerter: [], umleitungen: [], wort: null, wartet: null, klammer: 0, vorher: "", tiefe: tiefe + 1 });
    this.lies(ende);
    this.befehlEnde(ende);
    Object.assign(this, { woerter, umleitungen, wort, wartet, klammer, vorher, tiefe });
  }

  dollar() {
    if (!this.text.startsWith(EXIT_CODE, this.i)) return this.melde(ERSETZUNG_GESPERRT);
    this.dynamisch();
    this.i += EXIT_CODE.length;
  }

  backtick() {
    this.melde(ERSETZUNG_GESPERRT);
  }

  maskierung() {
    const [treffer] = MASKIERUNG.exec(this.rest);
    this.i += treffer.length;
    if (treffer.length === 1 || treffer.endsWith("\n")) return;
    this.aktuell().zitiert = true;
    this.anhaengen(treffer.slice(1));
  }

  einfach() {
    const ende = this.text.indexOf("'", this.i + 1);
    if (ende === -1) return this.melde("Anführungszeichen ohne Ende");
    this.aktuell().zitiert = true;
    this.anhaengen(this.text.slice(this.i + 1, ende));
    this.i = ende + 1;
  }

  doppeltZeichen() {
    const zeichen = this.text[this.i];
    if (zeichen === "$") return this.dollar();
    if (zeichen === "`") return this.backtick();
    const [treffer] = MASKIERUNG.exec(this.rest) ?? [zeichen];
    const maskiert = treffer.length > 1 && '$`"\\\n'.includes(treffer.slice(1));
    const wert = maskiert ? treffer.slice(1) : zeichen;
    if (wert !== "\n") this.anhaengen(wert);
    this.i += maskiert ? treffer.length : zeichen.length;
  }

  doppelt() {
    this.aktuell().zitiert = true;
    this.i += 1;
    while (this.i < this.text.length && this.text[this.i] !== '"' && this.fehler === null) this.doppeltZeichen();
    if (this.text[this.i] !== '"') this.melde("Anführungszeichen ohne Ende");
    this.i += 1;
  }

  heredocKoerper({ ende, zitiert, tabs }) {
    const start = this.i;
    for (let anfang = start; anfang < this.text.length; ) {
      const schluss = this.text.indexOf("\n", anfang) === -1 ? this.text.length : this.text.indexOf("\n", anfang);
      const zeile = this.text.slice(anfang, schluss);
      if ((tabs ? zeile.replace(/^\t+/, "") : zeile) === ende) return this.koerper({ start, ende: anfang, weiter: schluss + 1, zitiert });
      anfang = schluss + 1;
    }
    this.koerper({ start, ende: this.text.length, weiter: this.text.length, zitiert });
  }

  koerper({ start, ende, weiter, zitiert }) {
    this.i = start;
    while (!zitiert && this.i < ende && this.fehler === null) {
      if ("$`".includes(this.text[this.i]) && !this.text.startsWith(EXIT_CODE, this.i)) this.melde(ERSETZUNG_GESPERRT);
      this.i += this.text[this.i] === "\\" ? MASKIERUNG.exec(this.rest)[0].length : 1;
    }
    this.i = weiter;
  }

  zeilenEnde() {
    this.trenner(1, "\n");
    for (const heredoc of this.heredocs.splice(0)) this.heredocKoerper(heredoc);
  }

  trenner(laenge, art) {
    this.befehlEnde(art);
    this.i += laenge;
  }

  undOder() {
    const [op] = UND_ODER.exec(this.rest);
    if (op === "&>") return this.pfeil();
    this.trenner(op.length, op === "|&" ? "|" : op);
  }

  klammerAuf() {
    if (this.text[this.i + 1] === "(" && this.woerter.length === 0 && this.wort === null) return this.melde("Arithmetik-Befehl (( ))");
    this.trenner(1, "(");
    this.klammer += 1;
  }

  klammerZu() {
    this.trenner(1, ")");
    this.klammer = Math.max(0, this.klammer - 1);
  }

  pfeil() {
    const ersetzung = PROZESS_ERSETZUNG.exec(this.rest);
    if (ersetzung !== null) {
      this.dynamisch();
      this.i += ersetzung[0].length;
      return this.unterBefehl(")");
    }
    if (this.wort !== null && FD_WORT.test(this.wort.text) && !this.wort.zitiert && !this.wort.dyn) this.wort = null;
    this.wortEnde();
    const [op] = UMLEITUNG.exec(this.rest);
    if (this.wartet !== null) this.melde(`Umleitung ${this.wartet.op} ohne Ziel`);
    this.wartet = { op, ziel: null };
    this.umleitungen.push(this.wartet);
    this.i += op.length;
  }

  kommentar() {
    if (this.wort !== null) return this.zeichen("#");
    const ende = this.text.indexOf("\n", this.i);
    this.i = ende === -1 ? this.text.length : ende;
  }

  leer() {
    this.wortEnde();
    this.i += 1;
  }

  zeichen(zeichen) {
    const amAnfang = this.wort === null || (this.wort.text === "" && !this.wort.dyn);
    if (MUSTER.has(zeichen) || (zeichen === "~" && amAnfang)) {
      if (amAnfang) this.aktuell().dynAb = 0;
      this.aktuell().glob = true;
    }
    this.anhaengen(zeichen);
    this.i += 1;
  }

  lies(ende) {
    while (this.i < this.text.length && this.fehler === null) {
      const zeichen = this.text[this.i];
      if (zeichen === ende && (ende !== ")" || this.klammer === 0)) {
        this.i += 1;
        return;
      }
      const schritt = SCHRITTE.get(zeichen);
      if (schritt) schritt(this);
      else this.zeichen(zeichen);
    }
    if (ende !== null) this.melde(`${ende} ohne Ende`);
  }
}

const FREI = ["grep", "egrep", "fgrep", "head", "tail", "cat", "wc", "cut", "tr", "ls", "echo", "diff", "cmp"];
const FREI_SHELL = ["pwd", "date", "sleep", "true", "false", "du", "ps", ":", "exit"];
const SCHLUESSELWORT = new Set(["!", "{", "}", "then", "do", "else", "elif", "if", "while", "until", "time", "fi", "done"]);
const ZUWEISUNG = /^([A-Za-z_]\w*)\+?=/;
const NAME = /^[A-Za-z_]\w*$/;
const EIGENER_NAME = /^(?:[A-Z]|(?!npm_)[a-z_][a-z0-9_]*)$/;
const GIT_LESEND = new Set(["status", "diff", "log", "show", "grep", "ls-files", "rev-parse", "blame", "merge-base", "cat-file"]);
const GIT_SCHREIBOPTION = /^(?:--ou|--ext|--op|-O)/;
const GIT_GREP_KURZ = new Set("nilcwvEFhH");
const NPM_STILL = new Set(["--silent", "-s"]);
const NPM_LS = /^(?:--all|-a|--json|--depth=\d+|[@\w][@\w./-]*)$/;
const MUSTER_AUSSERHALB = /[[{]|(?:^|\/)\./;
const FIND_SCHREIBEND = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);
const DAUER = /^\d+(?:\.\d+)?[smhd]?$/;
const OHNE_DATEI = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);
const TEMP_ORDNER = ["/tmp", "/private/tmp"];
const SED_ADRESSE = String.raw`(?:\d+|\$|/(?:\\.|[^\\/])*/)`;
const SED_ERSETZUNG = String.raw`s([^\\\n])(?:\\.|(?!\1)[^\\])*\1(?:\\.|(?!\1)[^\\])*\1[gpiImM0-9]*`;
const SED_BEFEHL = new RegExp(String.raw`^(?:${SED_ADRESSE}(?:,${SED_ADRESSE})?)?!?(?:[pdq=]|${SED_ERSETZUNG})\s*(?:[;\n]\s*|$)`);
const BELIEBIG = () => true;
const ZAHL = (arg) => /^\d+$/.test(arg.text);
const NAME_WERT = (arg) => !arg.dyn && /^[a-z][a-z-]*$/.test(arg.text);
const SED_SKRIPT = (arg) => !arg.dyn && sedSkriptOk(arg.text.trim());
const EINFACHER_NAME = (arg) => !arg.dyn && NAME.test(arg.text);
const EIGENE_BINDUNG = (arg) => !arg.dyn && EIGENER_NAME.test(arg.text);
const FESTER_WERT = (arg) => !offeneOption(arg) && !arg.text.startsWith("-");

function sedSkriptOk(skript) {
  for (let rest = skript; rest !== ""; ) {
    const treffer = SED_BEFEHL.exec(rest);
    if (treffer === null) return false;
    rest = rest.slice(treffer[0].length);
  }
  return true;
}

function regeln({ kurz = "", kurzWert = [], lang = [], langWert = [], stopp = false }) {
  const werte = { kurzWert: new Map(kurzWert), langWert: new Map(langWert) };
  return { kurz: new Set(kurz), lang: new Set(lang), stopp, ...werte };
}

const SORT = regeln({ kurz: "bdfghinrsuVMcCz", kurzWert: [["k", BELIEBIG], ["t", BELIEBIG]], lang: ["--unique", "--reverse"] });
const UNIQ = regeln({ kurz: "cdui", kurzWert: [["f", ZAHL], ["s", ZAHL], ["w", ZAHL]], lang: ["--count", "--unique"] });
const SED = regeln({ kurz: "nErsuz", kurzWert: [["e", SED_SKRIPT]], lang: ["--quiet", "--silent"], langWert: [["--expression", SED_SKRIPT]] });
const ESLINT = regeln({
  kurz: "hv",
  kurzWert: [["f", NAME_WERT]],
  lang: ["--no-config-lookup", "--no-cache", "--stdin", "--pass-on-unpruned-suppressions", "--help", "--quiet", "--version", "--no-warn-ignored", "--no-color"],
  langWert: [["--format", NAME_WERT], ["--suppressions-location", BELIEBIG], ["--stdin-filename", BELIEBIG], ["--max-warnings", ZAHL]],
});
const PRETTIER = regeln({ kurz: "cl", lang: ["--check", "--list-different", "--no-color"], langWert: [["--stdin-filepath", BELIEBIG]] });
const JSCPD = regeln({ lang: ["--silent", "--version", "--help"], langWert: [["--min-tokens", ZAHL], ["--min-lines", ZAHL], ["--reporters", (arg) => arg.text === "console"]] });
const XARGS = regeln({ kurz: "0rt", kurzWert: [["n", ZAHL], ["L", ZAHL], ["P", ZAHL]], stopp: true });
const TIMEOUT = regeln({ kurz: "v", kurzWert: [["k", BELIEBIG], ["s", BELIEBIG]], lang: ["--foreground", "--preserve-status"], stopp: true });
const ENV = regeln({ kurzWert: [["u", (arg) => !arg.dyn && /^\w+$/.test(arg.text)]], stopp: true });
const READ = regeln({ kurz: "rs", kurzWert: [["a", EIGENE_BINDUNG], ["d", BELIEBIG], ["n", ZAHL], ["N", ZAHL], ["p", BELIEBIG], ["t", ZAHL], ["u", ZAHL]] });
const PRINTF = regeln({ kurzWert: [["v", EIGENE_BINDUNG]], stopp: true });
const WAIT = regeln({ kurz: "nf" });
const BASIS_VERGLEICH = regeln({ lang: ["--je-ordner"], langWert: [["--basis", FESTER_WERT]] });
const NPX = new Map([["eslint", ESLINT], ["prettier", PRETTIER], ["jscpd", JSCPD]]);
const NODE_SKRIPTE = new Map([["tools/basis-vergleich.mjs", BASIS_VERGLEICH], ["tools/lint-neue-funktionen.mjs", null], [".claude/hooks/lint-datei.mjs", null]]);

function kannOptionSein(arg) {
  if (!arg.dyn && arg.text === "-") return false;
  return arg.dynAb === 0 || arg.text.startsWith("-");
}

function offeneOption(arg) {
  return arg.dyn || arg.glob;
}

class Optionen {
  constructor(args, spec) {
    Object.assign(this, { args, spec, i: 0, operanden: [], genutzt: new Set(), ende: false, fund: null });
    for (; this.i < args.length && this.fund === null; this.i += 1) this.fund = this.argumentFund() ?? null;
  }

  naechstes() {
    this.i += 1;
    return this.args[this.i];
  }

  wertFund(pruefer, name, wert) {
    if (wert === undefined) return `Option ${name} ohne Wert`;
    if (wert.dyn) return `Option ${name} mit Wert aus einer Ersetzung`;
    this.genutzt.add(name);
    return pruefer(wert) ? null : `Option ${name} ${wert.text}`;
  }

  langFund(arg) {
    const [name] = arg.text.split("=");
    const mitWert = arg.text.includes("=");
    if (!mitWert && this.spec.lang.has(name)) return null;
    const pruefer = this.spec.langWert.get(name);
    if (!pruefer) return `Option ${name}`;
    return this.wertFund(pruefer, name, mitWert ? { ...arg, text: arg.text.slice(name.length + 1) } : this.naechstes());
  }

  kurzFund(arg) {
    for (const [stelle, buchstabe] of [...arg.text].entries()) {
      if (stelle === 0 || this.spec.kurz.has(buchstabe)) continue;
      const pruefer = this.spec.kurzWert.get(buchstabe);
      if (!pruefer) return `Option -${buchstabe}`;
      const rest = arg.text.slice(stelle + 1);
      return this.wertFund(pruefer, buchstabe, rest ? { ...arg, text: rest } : this.naechstes());
    }
    return null;
  }

  operand(arg) {
    this.operanden.push(arg);
    this.ende ||= this.spec.stopp;
    return null;
  }

  argumentFund() {
    const arg = this.args[this.i];
    if (this.ende || !kannOptionSein(arg)) return this.operand(arg);
    if (offeneOption(arg)) return `Option ${arg.text || "…"} aus einer Ersetzung oder einem Muster`;
    if (arg.text !== "--") return arg.text.startsWith("--") ? this.langFund(arg) : this.kurzFund(arg);
    this.ende = true;
    return null;
  }
}

function mitRegeln(spec, weiter = () => null) {
  return (args, kontext) => {
    const gelesen = new Optionen(args, spec);
    return gelesen.fund ?? weiter(gelesen, kontext);
  };
}

function istOrdner(pfad) {
  return statSync(pfad, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function ordnerZiele(arg, kontext) {
  const fest = !arg.dyn && !arg.glob && !arg.text.startsWith("-");
  if (!fest) return `Ordner ${arg.text || "aus einer Variablen"} ohne festes Ziel`;
  const ziele = [...kontext.orte].map((ort) => realPath(resolve(ort, arg.text)));
  const fremd = ziele.find((ziel) => !istOrdner(ziel) || !isInside(ziel, kontext.wurzel));
  return fremd === undefined ? ziele : `Ordner ${fremd} liegt nicht im Repo`;
}

function cd(args, kontext) {
  const ziele = args.length === 1 ? ordnerZiele(args[0], kontext) : "cd ohne genau ein Ziel";
  if (typeof ziele === "string") return ziele;
  if (!kontext.bedingt) kontext.orte.clear();
  for (const ziel of ziele) kontext.orte.add(ziel);
  return null;
}

function gitOptionFund(args) {
  const fund = args.find((arg) => kannOptionSein(arg) && (offeneOption(arg) || GIT_SCHREIBOPTION.test(arg.text)));
  return fund ? `git-Option ${fund.text || "aus einer Variablen"}` : null;
}

function gitGlobal(args, kontext) {
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].text.startsWith("-")) return { stelle: i };
    const fest = !offeneOption(args[i]);
    if (fest && args[i].text === "--no-pager") continue;
    if (!fest || args[i].text !== "-C" || !args[i + 1]) return { fund: `git ${args[i].text}` };
    i += 1;
    const ziele = ordnerZiele(args[i], kontext);
    if (typeof ziele === "string") return { fund: ziele };
  }
  return { stelle: args.length };
}

function git(args, kontext) {
  const { fund, stelle } = gitGlobal(args, kontext);
  if (fund) return fund;
  const [unter, ...rest] = args.slice(stelle);
  if (!unter || unter.dyn) return "git ohne lesenden Unterbefehl";
  if (unter.text === "stash") return gitStash(rest);
  if (!GIT_LESEND.has(unter.text)) return `git ${unter.text} ist kein lesender Unterbefehl`;
  return gitOptionFund(rest) ?? (unter.text === "grep" ? gitGrepFund(rest) : null);
}

function gitStash([aktion, ...rest]) {
  return aktion?.text === "list" && !aktion.dyn ? gitOptionFund(rest) : "git stash schreibt";
}

function gitGrepFund(args) {
  const fremd = (arg) => /^-[^-]/.test(arg.text) && [...arg.text.slice(1)].some((buchstabe) => !GIT_GREP_KURZ.has(buchstabe));
  const fund = args.find((arg) => kannOptionSein(arg) && fremd(arg));
  return fund ? `git grep ${fund.text}` : null;
}

function relativOhneAufstieg(arg) {
  return !arg.dyn && !isAbsolute(arg.text) && !arg.text.split("/").includes("..") && !(arg.glob && MUSTER_AUSSERHALB.test(arg.text));
}

function echtImRepo(pfad, kontext) {
  const ziele = [...kontext.orte].map((ort) => realPath(resolve(ort, pfad)));
  return ziele.every((ziel) => isInside(ziel, kontext.wurzel) && !tempDatei(ziel, kontext.wurzel));
}

function testPfadFund(arg, kontext) {
  if (kannOptionSein(arg)) return `Option ${arg.text || "aus einer Variablen"}`;
  return relativOhneAufstieg(arg) && echtImRepo(arg.text, kontext) ? null : `Pfad ${arg.text || "aus einer Variablen"}`;
}

function npmTest(args, kontext) {
  const ende = args.findIndex((arg) => !arg.dyn && arg.text === "--");
  const vorher = ende === -1 ? args : args.slice(0, ende);
  if (vorher.some((arg) => arg.dyn || !NPM_STILL.has(arg.text))) return "npm test mit Option vor --";
  const fund = ende === -1 ? null : args.slice(ende + 1).map((arg) => testPfadFund(arg, kontext)).find(Boolean);
  return fund ? `npm test mit ${fund} nach --` : null;
}

function npmRun(args) {
  return args.length === 1 && !args[0].dyn && args[0].text === "lint" ? null : "npm run nur als npm run lint";
}

function npmLs(args) {
  return args.every((arg) => !arg.dyn && NPM_LS.test(arg.text)) ? null : "npm ls mit unbekannter Option";
}

const NPM = new Map([["test", npmTest], ["run", npmRun], ["ls", npmLs]]);

function npm(args, kontext) {
  const start = args.findIndex((arg) => arg.dyn || !NPM_STILL.has(arg.text));
  const [unter, ...rest] = start === -1 ? [] : args.slice(start);
  const regel = unter && !unter.dyn ? NPM.get(unter.text) : undefined;
  return regel ? regel(rest, kontext) : `npm ${unter?.text ?? ""} steht nicht auf der Erlaubtliste`;
}

function npx([werkzeug, ...args]) {
  const spec = werkzeug && !werkzeug.dyn ? NPX.get(werkzeug.text) : undefined;
  return spec ? new Optionen(args, spec).fund : `npx ${werkzeug?.text ?? ""} steht nicht auf der Erlaubtliste`;
}

function node([skript, ...args], kontext) {
  if (!skript || skript.dyn) return "node ohne erlaubtes Prüfskript";
  if (["--version", "-v"].includes(skript.text) && args.length === 0) return null;
  if (["--check", "-c"].includes(skript.text)) return args.some((arg) => kannOptionSein(arg)) ? "node --check nur mit Dateien" : null;
  const erlaubt = new Map([...NODE_SKRIPTE].map(([pfad, spec]) => [resolve(kontext.wurzel, pfad), spec]));
  const ziele = [...kontext.orte].map((ort) => realPath(resolve(ort, skript.text)));
  if (!ziele.every((ziel) => erlaubt.has(ziel))) return `node ${skript.text} ist kein erlaubtes Prüfskript`;
  const specs = ziele.map((ziel) => erlaubt.get(ziel)).filter(Boolean);
  return specs.map((spec) => new Optionen(args, spec).fund).find(Boolean) ?? null;
}

function sed(gelesen) {
  if (gelesen.genutzt.has("e") || gelesen.genutzt.has("--expression")) return null;
  const [skript] = gelesen.operanden;
  return skript && SED_SKRIPT(skript) ? null : `sed-Skript ${skript?.text ?? ""} gibt nicht nur aus`;
}

function uniq({ operanden }) {
  const ausgabe = operanden.length > 1 || operanden.some(offeneOption);
  return ausgabe ? "uniq mit möglicher Ausgabedatei" : null;
}

function read({ operanden }) {
  const fremd = operanden.find((arg) => !EIGENE_BINDUNG(arg));
  return fremd ? `read in ${fremd.text || "einen Namen aus einer Variablen"}` : null;
}

function vNameOk(vorher, name) {
  if (name === undefined || EINFACHER_NAME(name)) return true;
  return offeneOption(vorher) && !offeneOption(name) && !name.text.includes("[");
}

function testAufruf(args) {
  const stelle = args.findIndex((arg, i) => (offeneOption(arg) ? kannOptionSein(arg) : arg.text === "-v") && !vNameOk(arg, args[i + 1]));
  return stelle === -1 ? null : `test -v ${args[stelle + 1].text || "mit einem Namen aus einer Variablen"}`;
}

function find(args) {
  const fund = args.find((arg) => kannOptionSein(arg) && (offeneOption(arg) || FIND_SCHREIBEND.has(arg.text)));
  return fund ? `find ${fund.text || "mit Variable"}` : null;
}

function timeout({ operanden: [dauer, ...aufruf] }, kontext) {
  if (!dauer || dauer.dyn || !DAUER.test(dauer.text)) return "timeout ohne feste Dauer";
  return aufruf.length > 0 ? programmFund(aufruf, kontext) : null;
}

function xargs({ operanden: [programm] }) {
  return !programm || (!programm.dyn && FREI.includes(programm.text)) ? null : `xargs ${programm.text} liest nicht nur`;
}

function envAufruf({ operanden }, kontext) {
  return operanden.length === 0 || ZUWEISUNG.test(operanden[0].text) ? "env nur mit -u vor einem Befehl" : programmFund(operanden, kontext);
}

const PROGRAMME = new Map([
  ...[...FREI, ...FREI_SHELL].map((name) => [name, () => null]),
  ["cd", cd], ["git", git], ["npm", npm], ["npx", npx], ["node", node], ["find", find],
  ["sort", mitRegeln(SORT)], ["uniq", mitRegeln(UNIQ, uniq)], ["read", mitRegeln(READ, read)], ["printf", mitRegeln(PRINTF)], ["wait", mitRegeln(WAIT)],
  ["test", testAufruf], ["[", testAufruf],
  ["sed", mitRegeln(SED, sed)], ["xargs", mitRegeln(XARGS, xargs)], ["timeout", mitRegeln(TIMEOUT, timeout)], ["env", mitRegeln(ENV, envAufruf)],
]);

function programmFund([programm, ...args], kontext) {
  if (programm.dyn || (programm.glob && programm.text !== "[")) return "Programmname aus einer Variablen oder einem Muster";
  const regel = PROGRAMME.get(programm.text);
  return regel ? regel(args, kontext) : `${programm.text} steht nicht auf der Erlaubtliste`;
}

function ohneSchluesselwort(woerter) {
  const start = woerter.findIndex((arg) => arg.zitiert || arg.dyn || !SCHLUESSELWORT.has(arg.text));
  return start === -1 ? woerter.length : start;
}

function zuweisungFund(woerter) {
  const zahl = woerter.findIndex((arg) => arg.dynAb === 0 || !ZUWEISUNG.test(arg.text));
  if (zahl > 0) return `Zuweisung vor ${woerter[zahl].text || "einem Befehl"}`;
  const namen = zahl === -1 ? woerter.map((arg) => ZUWEISUNG.exec(arg.text)[1]) : [];
  const fremd = namen.find((name) => !EIGENER_NAME.test(name));
  if (fremd) return `Zuweisung an ${fremd}`;
  const ersetzt = zahl === -1 ? woerter.find((arg) => arg.dyn || /[$`]/.test(arg.text.slice(ZUWEISUNG.exec(arg.text)[0].length))) : undefined;
  return ersetzt ? `Zuweisung mit $ oder \` an ${ZUWEISUNG.exec(ersetzt.text)[1]}` : null;
}

function istFor(woerter) {
  return woerter[0]?.text === "for" && !woerter[0].zitiert;
}

function forFund([, variable]) {
  return variable && EIGENE_BINDUNG(variable) ? null : `for-Schleife über ${variable?.text || "keinen eigenen Namen"}`;
}

function tempDatei(pfad, wurzel) {
  if (!isAbsolute(pfad)) return false;
  const echt = realPath(pfad);
  const ordner = [tmpdir(), ...TEMP_ORDNER].map(realPath);
  return ordner.some((temp) => isInside(echt, temp)) && !isInside(echt, wurzel);
}

function zielPfad(ziel) {
  return ziel.dyn || ziel.glob ? null : ziel.text;
}

function umleitungFund({ op, ziel }, wurzel) {
  if (LESEND.has(op) || (DUPLIKAT.has(op) && !ziel.dyn && DESKRIPTOR.test(ziel.text))) return null;
  const pfad = zielPfad(ziel);
  const erlaubt = pfad !== null && (OHNE_DATEI.has(pfad) || tempDatei(pfad, wurzel));
  return erlaubt ? null : `Umleitung ${op} ${ziel.text || "in ein Ziel aus einer Variablen"}`;
}

class Pruefung {
  constructor(input) {
    this.wurzel = realPath(repositoryRoot(startDirectory(input)));
    this.orte = new Set([realPath(startDirectory(input))]);
    this.unsicher = false;
  }

  aufrufFund({ woerter, bedingt }) {
    const start = ohneSchluesselwort(woerter);
    const rest = woerter.slice(start);
    if (start > 0 || istFor(rest)) this.unsicher = true;
    if (istFor(rest)) return forFund(rest);
    if (rest.length === 0) return null;
    const zuweisung = zuweisungFund(rest);
    if (zuweisung !== null || ZUWEISUNG.test(rest[0].text)) return zuweisung;
    return programmFund(rest, { wurzel: this.wurzel, orte: this.orte, bedingt: bedingt || this.unsicher });
  }

  fund(befehle) {
    for (const befehl of befehle) {
      const umleitung = befehl.umleitungen.map((eintrag) => umleitungFund(eintrag, this.wurzel)).find(Boolean);
      const fund = umleitung ?? this.aufrufFund(befehl);
      if (fund) return fund;
    }
    return null;
  }
}

function schreibweg(befehl, input) {
  const { befehle, fehler } = new Zerleger(befehl);
  return fehler ?? new Pruefung(input).fund(befehle);
}

function sperre(fund) {
  block("hooks/bash-schreibschutz", [`Bash führt hier nur gemessene Prüf- und Lesebefehle aus (gesperrt: ${fund}); ändere Dateien mit Edit oder Write.`]);
}

function main() {
  const input = readInput();
  const befehl = input?.tool_input?.command;
  if (typeof befehl !== "string") return sperre("Eingabe ohne Befehlstext");
  const fund = schreibweg(befehl, input);
  if (fund !== null) sperre(fund);
}

try {
  main();
} catch (fehler) {
  sperre(`Prüfung abgebrochen: ${fehler?.message ?? fehler}`);
}
