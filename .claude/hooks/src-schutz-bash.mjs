import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, matchesGlob, resolve } from "node:path";

import { isInside, realPath, repositoryRoot, startDirectory } from "./lib.mjs";
import { mainCheckout, productCodePath } from "./src-pfad.mjs";
import { DESKRIPTOR, DUPLIKAT, LESEND, SCHLUESSELWORT, Zerleger } from "./zerleger.mjs";

const SRC_WORT = /(?<![\w-])src(?![\w-])/i;
const SRC_SEGMENT = /(?:^|\/)src(?:\/|$)/i;
const ZUWEISUNG = /^[A-Za-z_]\w*\+?=/;
const GLOB_ZEICHEN = /[*?[{]/;
const TILDE = /^~(?=\/|$)/;
const KURZ_OPTION = /^-[A-Za-z]/;
const ZIEL_OPTION = /^-[A-Za-z]*t$/;
const GIT_ANDERES_REPO = /^--(?:git-dir|work-tree|exec-path|namespace)/;
const PYTHON = /^python[\d.]*$/;
const SCHREIB_OPTION = /^(?:--(?:fix|write|in-place|output|outfile|out-file|outdir|out-dir|output-dir|output-document|directory|directory-prefix|dest|destination|target-directory|extract-dir)(?:=.*)?|-(?!-)[A-Za-z]*[wioOPCd].*)$/;
const TAR_ERZEUGT = ["--create", "--append", "--update", "--delete", "--concatenate"];
const TAR_ENTPACKT = ["--extract", "--get"];
const NUR_LESEN_ODER_STDOUT = ["--stdout", "--to-stdout", "--list", "--test"];
const PACKER = ["gzip", "gunzip", "bzip2", "bunzip2", "xz", "unxz", "lzma", "unlzma", "zstd", "unzstd", "compress", "uncompress"];
const SED_DATEI = /(?:^|[;\n{}])\s*(?:[\d$]+(?:,[\d$]+)?|\/[^/]*\/)?\s*!?\s*[wW]\s*\S|\bs(.).*?\1.*?\1[a-zA-Z0-9]*[wW]\s*\S/;
const AWK_SCHREIBT = />|\bsystem\s*\(|\|\s*["']?\w/;
const UNKLAR = "Ersetzung oder unklarer Aufbau, src/ kommt im Befehl vor oder das Arbeitsverzeichnis liegt in src/";
const MAX_TIEFE = 8;
const SCHRITT_MIT_WERT = 2;

const SCHLEIFE = new Set(["for", "select", "case", "function"]);
const LESEPROGRAMME = new Set([
  "grep", "egrep", "fgrep", "rg", "ag", "ack", "cat", "head", "tail", "less", "more", "wc", "cut", "tr", "ls", "echo", "printf",
  "diff", "cmp", "stat", "file", "du", "df", "tree", "jq", "ps", "pwd", "basename", "dirname", "realpath", "readlink", "date",
  "sleep", "true", "false", "test", "[", "read", "wait", "exit", "kill", "bat", "column", "paste", "comm", "join", "nl", "od",
  "xxd", "hexdump", "strings", "shasum", "which", "type", "whoami", "hostname", "uname", ":",
]);
const GIT_PFAD = new Set(["checkout", "restore", "rm", "mv", "clean", "stash", "checkout-index"]);
const GIT_PATCH = new Set(["apply", "am"]);
const GIT_NUR_LESEN = ["--check", "--stat", "--numstat", "--summary", "--abort", "--continue", "--skip", "--quit", "--show-current-patch"];
const FIND_DATEI = new Set(["-fprint", "-fprint0", "-fprintf", "-fls"]);
const FIND_AUSFUEHREN = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const FIND_VORN = new Set(["-H", "-L", "-P"]);
const XARGS_MIT_WERT = new Set(["-n", "-L", "-P", "-I", "-d", "-E", "-s", "-J", "-a"]);
const WRAPPER = new Map([
  ["env", ["-u", "-C", "-S", "-P"]],
  ["timeout", ["-s", "-k"]],
  ["nice", ["-n"]],
  ["nohup", []],
  ["command", []],
  ["exec", ["-a"]],
  ["builtin", []],
  ["sudo", ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"]],
  ["stdbuf", ["-i", "-o", "-e"]],
  ["setsid", []],
  ["caffeinate", ["-t", "-w"]],
  ["ionice", ["-c", "-n", "-p"]],
]);

function interpreter(kurz, lang = [], wort = []) {
  return { kurz, lang, wort };
}

const INTERPRETER = new Map([
  ["node", interpreter("ep", ["--eval", "--print"])],
  ["bun", interpreter("ep", ["--eval", "--print"])],
  ["deno", interpreter("", ["--eval"], ["eval", "repl"])],
  ["python", interpreter("c")],
  ["ruby", interpreter("e")],
  ["perl", interpreter("eE")],
  ["php", interpreter("r")],
  ["lua", interpreter("e")],
  ["osascript", interpreter("e")],
  ["Rscript", interpreter("e")],
]);

function zuordnen(namen, pruefe) {
  return namen.map((name) => [name, pruefe]);
}

const PROGRAMM_PRUEFUNGEN = new Map([
  ...zuordnen(["touch", "mkdir", "truncate", "tee", "patch", "ed", "ex", "vi", "vim", "nvim", "nano", "emacs", "sponge", "split", "csplit", "mktemp", "mkfifo", "rename"], (pruefung, args) => pruefung.alle(args)),
  ...zuordnen(["rm", "rmdir", "unlink", "mv", "chmod", "chown", "chgrp", "shred", "trash"], (pruefung, args) => pruefung.oberhalb(args)),
  ...zuordnen(["cp", "install", "ln", "rsync", "scp", "ditto"], (pruefung, args) => pruefung.zielLetzter(args)),
  ...zuordnen([...WRAPPER.keys()], (pruefung, args, name) => pruefung.wrapper(args, name)),
  ...zuordnen(["bash", "sh", "zsh", "dash", "ksh"], (pruefung, args) => pruefung.shell(args)),
  ...zuordnen([...INTERPRETER.keys()], (pruefung, args, name) => pruefung.interpreter(args, name)),
  ...zuordnen(["awk", "gawk", "mawk", "nawk"], (pruefung, args) => pruefung.awk(args)),
  ...zuordnen(["cd", "pushd"], (pruefung, args) => pruefung.cd(args)),
  ["sed", (pruefung, args) => pruefung.sed(args)],
  ["sort", (pruefung, args) => pruefung.sort(args)],
  ["uniq", (pruefung, args) => pruefung.uniq(args)],
  ["dd", (pruefung, args) => pruefung.dd(args)],
  ["find", (pruefung, args) => pruefung.find(args)],
  ["xargs", (pruefung, args) => pruefung.xargs(args)],
  ["git", (pruefung, args) => pruefung.git(args)],
  ...zuordnen(["tar", "gtar", "bsdtar"], (pruefung, args) => pruefung.tar(mitStrich(args))),
  ["unzip", (pruefung, args) => pruefung.unzip(args)],
  ["zip", (pruefung, args) => pruefung.zip(args)],
  ...zuordnen(PACKER, (pruefung, args) => pruefung.packer(args)),
  ["eval", (pruefung, args) => pruefung.eval(args)],
]);

const DYN_WORT = { text: "", dyn: true, dynAb: 0, glob: false, zitiert: false };
const PUNKT = { text: ".", dyn: false, dynAb: -1, glob: false, zitiert: false };

function istOption(wort) {
  return !wort.dyn && wort.text.startsWith("-") && wort.text !== "-";
}

function operanden(args) {
  const ende = args.findIndex((wort) => !wort.dyn && wort.text === "--");
  const vorher = ende === -1 ? args : args.slice(0, ende);
  const nachher = ende === -1 ? [] : args.slice(ende + 1);
  return [...vorher.filter((wort) => !istOption(wort)), ...nachher];
}

function hatOption(args, kurz, ...lang) {
  return args.some((wort) => {
    if (!istOption(wort)) return false;
    if (wort.text.startsWith("--")) return lang.some((name) => wort.text === name || wort.text.startsWith(`${name}=`));
    return [...wort.text.slice(1)].some((buchstabe) => kurz.includes(buchstabe));
  });
}

function optionWerte(args, kurz, lang) {
  return args.flatMap((wort, nummer) => {
    if (wort.dyn || !wort.text.startsWith("-")) return [];
    const { text } = wort;
    if (text.startsWith("--")) {
      const name = lang.find((eintrag) => text === eintrag || text.startsWith(`${eintrag}=`));
      if (name === undefined) return [];
      return text === name ? [args[nummer + 1] ?? DYN_WORT] : [{ ...wort, text: text.slice(name.length + 1) }];
    }
    const stelle = [...text.slice(1)].findIndex((buchstabe) => kurz.includes(buchstabe));
    if (stelle === -1) return [];
    const rest = text.slice(stelle + SCHRITT_MIT_WERT);
    return rest === "" ? [args[nummer + 1] ?? DYN_WORT] : [{ ...wort, text: rest }];
  });
}

function mitStrich(args) {
  const [kopf] = args;
  return kopf === undefined || kopf.dyn || kopf.text.startsWith("-") ? args : [{ ...kopf, text: `-${kopf.text}` }, ...args.slice(1)];
}

function pfadKandidaten(text) {
  const nachGleich = text.includes("=") ? [text.slice(text.indexOf("=") + 1)] : [];
  if (!text.startsWith("-")) return [text, ...nachGleich];
  const angehaengt = KURZ_OPTION.test(text) && !text.startsWith("--") ? [text.slice(SCHRITT_MIT_WERT)] : [];
  return [...nachGleich, ...angehaengt];
}

function ohneTilde(text) {
  return text.replace(TILDE, homedir());
}

function istVorspann(wort) {
  return !wort.dyn && ((!wort.zitiert && SCHLUESSELWORT.has(wort.text)) || ZUWEISUNG.test(wort.text));
}

function ohneVorspann(woerter) {
  const start = woerter.findIndex((wort) => !istVorspann(wort));
  const rest = start === -1 ? [] : woerter.slice(start);
  return rest.length > 0 && !rest[0].zitiert && SCHLEIFE.has(rest[0].text) ? [] : rest;
}

function kanonisch(name) {
  if (PYTHON.test(name)) return "python";
  return name === "nodejs" ? "node" : name;
}

function nachWrapper(name, args) {
  const mitWert = WRAPPER.get(name);
  let stelle = 0;
  while (stelle < args.length && (istOption(args[stelle]) || (!args[stelle].dyn && ZUWEISUNG.test(args[stelle].text)))) {
    stelle += mitWert.includes(args[stelle].text) ? SCHRITT_MIT_WERT : 1;
  }
  const rest = args.slice(stelle);
  return name === "timeout" ? rest.slice(1) : rest;
}

function nachXargsOptionen(args) {
  let stelle = 0;
  while (stelle < args.length && istOption(args[stelle])) stelle += XARGS_MIT_WERT.has(args[stelle].text) ? SCHRITT_MIT_WERT : 1;
  return args.slice(stelle);
}

function zielOperanden(args) {
  const stelle = args.findIndex((wort) => istOption(wort) && (ZIEL_OPTION.test(wort.text) || wort.text.startsWith("--target-directory")));
  if (stelle === -1) return operanden(args).slice(-1);
  return args[stelle].text.includes("=") ? [args[stelle]] : args.slice(stelle + 1, stelle + SCHRITT_MIT_WERT);
}

function gitOptionen(args) {
  const orte = [];
  let stelle = 0;
  while (stelle < args.length && istOption(args[stelle])) {
    const option = args[stelle].text;
    if (GIT_ANDERES_REPO.test(option)) return { fremd: true, orte, stelle };
    stelle += option === "-C" || option === "-c" ? SCHRITT_MIT_WERT : 1;
    if (option === "-C" && args[stelle - 1] !== undefined) orte.push(args[stelle - 1]);
  }
  return { fremd: false, orte, stelle };
}

function istFindAusdruck(wort) {
  if (wort.dyn) return false;
  return (wort.text.startsWith("-") && !FIND_VORN.has(wort.text)) || wort.text === "!" || wort.text === "(";
}

function findAusfuehrungen(ausdruck) {
  return ausdruck.flatMap((wort, stelle) => {
    if (wort.dyn || !FIND_AUSFUEHREN.has(wort.text)) return [];
    const rest = ausdruck.slice(stelle + 1);
    const ende = rest.findIndex((teil) => !teil.dyn && (teil.text === ";" || teil.text === "+"));
    return [ende === -1 ? rest : rest.slice(0, ende)];
  });
}

class SrcPruefung {
  constructor(input, roh) {
    const cwd = realPath(startDirectory(input));
    Object.assign(this, { roh, cwd, orte: new Set([cwd]), ortUnklar: false, bedingt: false, tiefe: 0, treffer: new Map(), wissen: null });
  }

  get repo() {
    this.wissen ??= { checkout: realPath(mainCheckout(this.cwd)), wurzel: realPath(repositoryRoot(this.cwd)) };
    return this.wissen;
  }

  srcWort() {
    return { text: join(this.repo.wurzel, "src", "_"), dyn: false, dynAb: -1, glob: false, zitiert: true };
  }

  unterSrc(ziel) {
    if (!SRC_SEGMENT.test(ziel)) return false;
    if (!this.treffer.has(ziel)) {
      const { checkout } = this.repo;
      this.treffer.set(ziel, productCodePath(ziel, checkout) !== null || productCodePath(join(ziel, "_"), checkout) !== null);
    }
    return this.treffer.get(ziel);
  }

  srcOberhalb(ziel) {
    const { checkout, wurzel } = this.repo;
    const klein = ziel.toLowerCase();
    return [wurzel, checkout].some((ordner) => isInside(join(ordner, "src").toLowerCase(), klein));
  }

  unsicher() {
    return SRC_WORT.test(this.roh) || [...this.orte].some((ort) => this.unterSrc(ort));
  }

  pfadTrifft(text, ort, oberhalb) {
    const ziel = realPath(resolve(ort, ohneTilde(text)));
    return this.unterSrc(ziel) || (oberhalb && this.srcOberhalb(ziel));
  }

  globTrifft(text, ort, oberhalb) {
    const teile = text.split("/");
    const stelle = teile.findIndex((teil) => GLOB_ZEICHEN.test(teil));
    if (stelle === -1 || !matchesGlob("src", teile[stelle].toLowerCase())) return false;
    return this.pfadTrifft([...teile.slice(0, stelle), "src", ...teile.slice(stelle + 1)].join("/"), ort, oberhalb);
  }

  trifft(wort, oberhalb = false) {
    if (wort.dyn) return this.unsicher();
    const relativ = !isAbsolute(wort.text) && !wort.text.startsWith("~") && !istOption(wort);
    if (this.ortUnklar && relativ) return this.unsicher();
    const orte = [...this.orte];
    return pfadKandidaten(wort.text).some((kandidat) =>
      orte.some((ort) => this.pfadTrifft(kandidat, ort, oberhalb) || (wort.glob && this.globTrifft(kandidat, ort, oberhalb))),
    );
  }

  alle(args) {
    return args.some((wort) => this.trifft(wort));
  }

  oberhalb(args) {
    return args.some((wort) => this.trifft(wort, true));
  }

  zielLetzter(args) {
    return zielOperanden(args).some((wort) => this.trifft(wort));
  }

  sed(args) {
    if (hatOption(args, "i", "--in-place")) return this.alle(args);
    const skript = args.filter((wort) => !wort.dyn).map((wort) => wort.text).join("\n");
    return SED_DATEI.test(skript) && this.unsicher();
  }

  sort(args) {
    return hatOption(args, "o", "--output") && this.alle(args);
  }

  uniq(args) {
    const dateien = operanden(args);
    return dateien.length > 1 && this.trifft(dateien[1]);
  }

  dd(args) {
    return args.some((wort) => !wort.dyn && wort.text.startsWith("of=") && this.trifft(wort));
  }

  awk(args) {
    if (hatOption(args, "i")) return this.alle(args);
    const [skript] = operanden(args);
    return skript !== undefined && AWK_SCHREIBT.test(skript.text) && this.unsicher();
  }

  cd(args) {
    const [ziel] = operanden(args);
    const unklar = ziel !== undefined && (ziel.dyn || ziel.text === "-" || (ziel.glob && !ziel.text.startsWith("~")));
    if (unklar) {
      this.ortUnklar = true;
      return false;
    }
    const neu = ziel === undefined ? [homedir()] : [...this.orte].map((ort) => realPath(resolve(ort, ohneTilde(ziel.text))));
    this.orte = new Set(this.bedingt ? [...this.orte, ...neu] : neu);
    return false;
  }

  find(args) {
    const stelle = args.findIndex(istFindAusdruck);
    const ausdruck = stelle === -1 ? [] : args.slice(stelle);
    const dateien = ausdruck.some((wort, nummer) => !wort.dyn && FIND_DATEI.has(wort.text) && ausdruck[nummer + 1] !== undefined && this.trifft(ausdruck[nummer + 1]));
    if (dateien) return true;
    const wurzeln = (stelle === -1 ? args : args.slice(0, stelle)).filter((wort) => !istOption(wort));
    const trifft = (wurzeln.length === 0 ? [PUNKT] : wurzeln).some((wort) => this.trifft(wort, true));
    return trifft && this.findSchreibt(ausdruck);
  }

  findSchreibt(ausdruck) {
    if (ausdruck.some((wort) => !wort.dyn && wort.text === "-delete")) return true;
    return findAusfuehrungen(ausdruck).some((gruppe) => this.aufruf([...gruppe, this.srcWort()]) !== null);
  }

  xargs(args) {
    const innen = nachXargsOptionen(args);
    return innen.length > 0 && (this.aufruf(innen) !== null || this.aufruf([...innen, DYN_WORT]) !== null);
  }

  wrapper(args, name) {
    const innen = nachWrapper(name, args);
    return innen.length > 0 && this.aufruf(innen) !== null;
  }

  eval(args) {
    return args.some((wort) => wort.dyn) ? this.unsicher() : this.text(args.map((wort) => wort.text).join(" ")) !== null;
  }

  shell(args) {
    const dateien = operanden(args);
    if (hatOption(args, "c")) return dateien.length === 0 || dateien[0].dyn ? this.unsicher() : this.text(dateien[0].text) !== null;
    return (dateien.length === 0 || dateien[0].text === "-" || hatOption(args, "s")) && this.unsicher();
  }

  interpreter(args, name) {
    const spec = INTERPRETER.get(name);
    const dateien = operanden(args);
    const ohneSkript = dateien.length === 0 || dateien[0].text === "-" || spec.wort.includes(dateien[0].text);
    return (ohneSkript || hatOption(args, spec.kurz, ...spec.lang)) && this.unsicher();
  }

  patchEnthaeltSrc(wort) {
    if (wort.dyn) return this.unsicher();
    return [...this.orte].some((ort) => {
      try {
        return SRC_WORT.test(readFileSync(resolve(ort, wort.text), "utf8"));
      } catch {
        return true;
      }
    });
  }

  tar(args) {
    if (hatOption(args, "x", ...TAR_ENTPACKT)) {
      const ziele = optionWerte(args, "C", ["--directory"]);
      return this.oberhalb(ziele.length > 0 ? ziele : [PUNKT]);
    }
    return hatOption(args, "cruA", ...TAR_ERZEUGT) && optionWerte(args, "f", ["--file"]).some((wort) => this.trifft(wort));
  }

  unzip(args) {
    const ziele = optionWerte(args, "d", []);
    if (this.oberhalb(ziele)) return true;
    return ziele.length === 0 && !hatOption(args, "lvtpZc") && this.oberhalb([PUNKT]);
  }

  zip(args) {
    const archiv = [operanden(args)[0], ...optionWerte(args, "O", ["--output-file"])].filter((wort) => wort !== undefined);
    return archiv.some((wort) => this.trifft(wort));
  }

  packer(args) {
    return !hatOption(args, "ctl", ...NUR_LESEN_ODER_STDOUT) && this.alle(args);
  }

  gitPatch(rest) {
    if (hatOption(rest, "", ...GIT_NUR_LESEN) && !hatOption(rest, "", "--apply")) return false;
    if (this.alle(rest)) return true;
    const dateien = operanden(rest);
    return dateien.length === 0 ? this.unsicher() : dateien.some((wort) => this.patchEnthaeltSrc(wort));
  }

  gitPfade(unter, rest) {
    const nurIndex = (unter === "restore" && hatOption(rest, "S", "--staged") && !hatOption(rest, "W", "--worktree"))
      || (unter === "rm" && hatOption(rest, "", "--cached"))
      || (unter === "clean" && hatOption(rest, "n", "--dry-run"));
    if (nurIndex) return false;
    return (unter === "stash" ? operanden(rest).slice(1) : operanden(rest)).some((wort) => this.trifft(wort, true));
  }

  gitUnterbefehl(unter, rest) {
    if (GIT_PATCH.has(unter)) return this.gitPatch(rest);
    return GIT_PFAD.has(unter) && this.gitPfade(unter, rest);
  }

  inOrten(woerter, aufgabe) {
    const gerettet = this.orte;
    if (woerter.length > 0) this.orte = new Set(woerter.flatMap((wort) => [...gerettet].map((ort) => realPath(resolve(ort, ohneTilde(wort.text))))));
    try {
      return aufgabe();
    } finally {
      this.orte = gerettet;
    }
  }

  git(args) {
    const { fremd, orte, stelle } = gitOptionen(args);
    if (fremd) return this.unsicher();
    const unter = args[stelle];
    if (unter === undefined) return false;
    if (unter.dyn) return this.unsicher();
    return this.inOrten(orte, () => this.gitUnterbefehl(unter.text, args.slice(stelle + 1)));
  }

  unbekannt(args) {
    return args.some((wort) => !wort.dyn && SCHREIB_OPTION.test(wort.text)) && this.alle(args);
  }

  programmFund([kopf, ...args]) {
    if (kopf.dyn) return this.unsicher() ? "Programm aus einer Variablen" : null;
    const name = kanonisch(basename(kopf.text));
    const pruefe = PROGRAMM_PRUEFUNGEN.get(name);
    const schreibt = pruefe ? pruefe(this, args, name) :!LESEPROGRAMME.has(name) && this.unbekannt(args);
    return schreibt ? name : null;
  }

  aufruf(woerter) {
    const rest = ohneVorspann(woerter);
    return rest.length === 0 ? null : this.programmFund(rest);
  }

  umleitungSchreibt({ op, ziel }) {
    if (LESEND.has(op) || ziel === null) return false;
    if (DUPLIKAT.has(op) && !ziel.dyn && DESKRIPTOR.test(ziel.text)) return false;
    return this.trifft(ziel);
  }

  befehlFund({ woerter, umleitungen, bedingt }) {
    this.bedingt = bedingt;
    const umleitung = umleitungen.find((eintrag) => this.umleitungSchreibt(eintrag));
    if (umleitung !== undefined) return `Umleitung ${umleitung.op} ${umleitung.ziel.text}`;
    return this.aufruf(woerter);
  }

  text(text) {
    if (this.tiefe >= MAX_TIEFE) return this.unsicher() ? UNKLAR : null;
    const { befehle, fehler } = new Zerleger(text);
    if (fehler !== null) return this.unsicher() ? UNKLAR : null;
    const gerettet = this.orte;
    this.orte = new Set(gerettet);
    this.tiefe += 1;
    try {
      return befehle.map((befehl) => this.befehlFund(befehl)).find(Boolean) ?? null;
    } finally {
      this.tiefe -= 1;
      this.orte = gerettet;
    }
  }
}

export function bashSrcFund(input, command) {
  return new SrcPruefung(input, command).text(command);
}
