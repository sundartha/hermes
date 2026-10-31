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
const GIT_GLOBAL_FREI = new Set(["--no-pager", "-p", "--no-optional-locks", "--version"]);
const GIT_GLOBAL_MIT_WERT = new Set(["-C", "-c", "--config-env"]);
const CONFIG_ENV = "--config-env=";
const PYTHON = /^python[\d.]*$/;
const SCHREIB_KURZ = /^-(?!-)[A-Za-z]*[wioOPCd]/;
const SCHREIB_LANG = [
  "fix", "write", "in-place", "output", "outfile", "out-file", "outdir", "out-dir", "output-dir", "output-document", "output-file", "autofix", "report-path",
  "directory", "directory-prefix", "dest", "destination", "target-directory", "extract-dir",
].map((name) => `--${name}`);
const TAR_ERZEUGT = ["--create", "--append", "--update", "--delete", "--concatenate"];
const TAR_ENTPACKT = ["--extract", "--get"];
const NUR_LESEN_ODER_STDOUT = ["--stdout", "--to-stdout", "--list", "--test"];
const PACKER = ["gzip", "gunzip", "bzip2", "bunzip2", "xz", "unxz", "lzma", "unlzma", "zstd", "unzstd", "compress", "uncompress"];
const SED_DATEI = /(?:^|[;\n{}])\s*(?:[\d$]+(?:,[\d$]+)?|\/[^/]*\/)?\s*!?\s*[wW]\s*\S|\bs(.).*?\1.*?\1[a-zA-Z0-9]*[wW]\s*\S/;
const PATCH_KOPF_MASKIERT = /^(?:diff --git|---|\+\+\+|rename (?:from|to)|copy (?:from|to)) .*["\\]/m;
const PATCH_EINGABE_OPTION = /^-[A-Za-z0-9]*i$/;
const PATCH_EINGABE_ANGEHAENGT = /^-i./;
const PATCH_OPTION_MIT_WERT = new Set(["-p", "-d", "-D", "-F", "-r", "-o", "-z", "-B", "-Y", "-V"]);
const AWK_SCHREIBT = />|\bsystem\s*\(|\|\s*["']?\w/;
const UNKLAR = "Ersetzung oder unklarer Aufbau, src/ kommt im Befehl vor oder das Arbeitsverzeichnis liegt in src/";
const MAX_TIEFE = 8;
const SCHRITT_MIT_WERT = 2;

const SCHLEIFE = new Set(["for", "select", "case", "function"]);
const LESEPROGRAMME = new Set([
  "grep", "egrep", "fgrep", "rg", "ag", "ack", "cat", "head", "tail", "less", "more", "wc", "cut", "tr", "ls", "echo", "printf",
  "diff", "cmp", "stat", "file", "du", "df", "tree", "jq", "ps", "pwd", "basename", "dirname", "realpath", "readlink", "date",
  "sleep", "true", "false", "test", "[", "read", "wait", "exit", "kill", "bat", "column", "paste", "comm", "join", "nl", "od",
  "hexdump", "strings", "shasum", "which", "type", "whoami", "hostname", "uname", ":", "md5", "md5sum", "sha1sum", "sha256sum",
  "cksum", "tac", "rev", "fold", "expand", "unexpand",
]);
const PRUEFER = new Set([
  "eslint", "prettier", "shellcheck", "semgrep", "jscpd", "knip", "tsc", "commitlint", "gitleaks", "actionlint", "markdownlint", "npm", "pnpm", "yarn",
]);
const PAKET_SCHREIBT = /(?:^|:)(?:fix|format)$/;
const TEXT_PROGRAMME = new Set(["gh", "curl", "paket-issue", "paket-pr", "paket-push", "paket-pruefer"]);
const ORDNER_KOPIEREN = new Set(["ditto"]);
const PAKET_MANAGER = new Set(["npm", "pnpm", "yarn"]);
const PAKET_AUSFUEHREN = new Set(["exec", "x", "dlx", "node", "explore", "create", "init", "innit"]);
const PAKET_SKRIPT = new Set(["run", "run-script", "rum", "urn"]);
const PAKET_VERWEIS = new Set(["link", "ln", "install", "i", "add", "install-test", "it"]);
const PAKET_KONFIG = new Set(["config", "c"]);
const PAKET_KONFIG_AENDERT = new Set(["set", "edit", "delete"]);
const GH_AENDERT = new Map([
  ["alias", new Set(["set", "import"])],
  ["extension", new Set(["install", "exec", "create", "upgrade"])],
  ["config", new Set(["set"])],
]);
const BEFEHL_OPTIONEN = new Map([
  ["rg", ["", ["--pre", "--hostname-bin"]]],
  ...zuordnen(["ag", "ack", "bat"], ["", ["--pager"]]),
  ...zuordnen(["tar", "gtar", "bsdtar"], ["I", ["--use-compress-program", "--to-command", "--checkpoint-action", "--rsh-command"]]),
  ["sort", ["", ["--compress-program"]]],
  ...zuordnen(["npm", "pnpm", "yarn", "npx"], ["", ["--node-options"]]),
  ["rsync", ["e", ["--rsh"]]],
  ["scp", ["o", []]],
  ["actionlint", ["sp", []]],
]);
const SKRIPT_OPTIONEN = new Map([
  ["eslint", ["c", ["--config", "--plugin", "--parser", "--rulesdir", "--resolve-plugins-relative-to"]]],
  ["prettier", ["", ["--config", "--plugin"]]],
  ...zuordnen(["knip", "markdownlint", "jscpd", "gitleaks"], ["c", ["--config"]]),
  ["semgrep", ["cf", ["--config"]]],
  ["commitlint", ["g", ["--config"]]],
  ["tsc", ["pb", ["--project", "--build"]]],
  ["shellcheck", ["", ["--rcfile"]]],
  ["curl", ["K", ["--config"]]],
  ...zuordnen(["node", "bun"], ["r", ["--require", "--import", "--loader", "--experimental-loader"]]),
  ["ruby", ["r", ["--require"]]],
  ...zuordnen(["npm", "pnpm", "yarn", "npx"], ["", ["--userconfig", "--globalconfig", "--script-shell"]]),
]);
const PLUS_PROGRAMME = new Set(["less", "more"]);
const UMGEBUNG_PFAD = /^(?:NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|PROMPT_COMMAND|CDPATH|IFS|PATH|LD_\w+|DYLD_\w+|PYTHON\w+|PERL5?\w*|RUBY\w+|RIPGREP_CONFIG_PATH|BAT_\w+|npm_config_\w+|NPM_CONFIG_\w+|YARN_\w+|PNPM_\w+)$/;
const UMGEBUNG_BEFEHL = /^(?:EDITOR|VISUAL|PAGER|MANPAGER|GH_PAGER|GH_EDITOR|GH_BROWSER|BROWSER|SHELL|LESSOPEN|LESSCLOSE)$/;
const UMGEBUNG_ZUWEISUNG = /^(\w+)=([\s\S]*)$/;
const SPEC_PRAEFIX = /^(?:file|link):(?:\/\/)?/i;
const KETTE = "Kette aus Schreibbefehlen";
const STUFE_KEINE = 0;
const STUFE_LEICHT = 1;
const STUFE_INHALT = 2;
const GERAET = /^\/dev\/(?:null|stdout|stderr|tty)$/;
const SHELL_EINGEBAUT = new Set(["export", "unset", "set", "shift", "local", "declare", "typeset", "return", "break", "continue", "popd"]);
const KETTE_FREI = new Set([...LESEPROGRAMME, ...PRUEFER, ...TEXT_PROGRAMME, ...SHELL_EINGEBAUT, "git", "cd", "pushd"]);
const HARMLOS_WERT = /^(?:cat|less|more|true|false|:)?$/;
const KETTE_LEICHT = new Set(["mkdir", "touch", "rm", "rmdir", "unlink", "chmod", "chown", "chgrp", "shred", "trash", "mktemp", "mkfifo", "find", "xargs"]);
const VERWEIS_OPTIONEN = ["--link", "--symbolic-link", "--link-dest"];
const AUFTRAG_LESEN = new Set(["karte", "suche", "dateien", "kette"]);
const OHNE_ZIEL_OPTION = new Set(["rsync", "scp", "ditto"]);
const GIT_QUELLEN = new Set(["upstream", "origin"]);
const GIT_REMOTE_AENDERT = new Set(["add", "rename", "set-url"]);
const GIT_OPTION_MIT_WERT = new Set(["--depth", "--jobs", "--strategy", "--branch"]);
const GIT_STEUER = /\/\.git(?:\/|$)/i;
const GIT_FERN = /^https?:\/\/|^[\w.-]+@[\w.-]+:/i;
const GIT_KONFIG_FREI = /^(?:user\.(?:name|email)|commit\.gpgsign|color\.[\w.-]+|pull\.rebase|init\.defaultbranch)$/i;
const GIT_PAGER_CAT = "core.pager=cat";
const GIT_UMGEBUNG = /^(GIT_\w+)=/;
const GIT_UMGEBUNG_FREI = new Set(["GIT_PAGER", "GIT_TERMINAL_PROMPT", "GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE"]);
const GIT_HOME = /^(?:HOME|XDG_CONFIG_HOME)=/;
const GIT_WORT = /\bgit\b/;
const GIT_AUSGABE_KURZ = new Map([["archive", "o"], ["format-patch", "o"], ["config", "f"]]);
const GIT_FREI = new Set([
  "add", "annotate", "archive", "blame", "branch", "cat-file", "check-attr", "check-ignore", "check-ref-format", "cherry", "cherry-pick", "clone", "column",
  "commit", "commit-graph", "config", "count-objects", "credential", "describe", "diff", "diff-files", "diff-index", "diff-tree",
  "difftool", "fast-export", "fetch", "fmt-merge-msg", "for-each-ref", "format-patch", "fsck", "gc", "get-tar-commit-id", "grep", 
  "help", "init", "interpret-trailers", "log", "ls-files", "ls-remote", "ls-tree", "maintenance", "mailinfo", "merge", "merge-base", 
  "name-rev", "notes", "pack-refs", "patch-id", "prune", "pull", "push", "range-diff", "rebase", "reflog", "remote", "repack", 
  "rerere", "rev-list", "rev-parse", "revert", "shortlog", "show", "show-branch", "show-index", "show-ref", "status", "switch", "symbolic-ref",
  "tag", "update-ref", "var", "verify-commit", "verify-pack", "verify-tag", "version", "whatchanged", "worktree", 
]);
const GIT_PFAD = new Set(["checkout", "restore", "rm", "mv", "clean"]);
const STASH_LESEND = new Set(["list", "show", "drop", "clear", "create", "store"]);
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
  ["npx", ["-p", "--package"]],
  ["bunx", []],
  ["pnpx", []],
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

const GIT_ZUSATZ = new Map([
  ...zuordnen(["fetch", "pull", "push"], (pruefung, rest) => pruefung.gitHolen(rest)),
  ...zuordnen(["clone", "init"], (pruefung, rest, unter) => pruefung.gitKlon(rest, unter)),
  ...zuordnen(["rebase", "difftool"], (pruefung, rest) => pruefung.gitAusfuehren(rest)),
  ["worktree", (pruefung, rest) => pruefung.oberhalb(rest)],
  ["config", (pruefung, rest) => pruefung.gitKonfig(rest)],
  ["remote", (pruefung, rest) => pruefung.gitRemote(rest)],
]);

const PROGRAMM_PRUEFUNGEN = new Map([
  ...zuordnen(["touch", "mkdir", "truncate", "tee", "ed", "ex", "vi", "vim", "nvim", "nano", "emacs", "sponge", "split", "csplit", "mktemp", "mkfifo", "rename"], (pruefung, args) => pruefung.alle(args)),
  ...zuordnen(["rm", "rmdir", "unlink", "chmod", "chown", "chgrp", "shred", "trash"], (pruefung, args) => pruefung.oberhalb(args)),
  ["mv", (pruefung, args, name) => pruefung.oberhalb(args) || pruefung.zielLetzter(args, name)],
  ...zuordnen([...PAKET_MANAGER], (pruefung, args, name) => pruefung.paketManager(args, name)),
  ["gh", (pruefung, args) => pruefung.gh(args)],
  ["file", (pruefung, args) => hatOption(args, "C", "--compile") && pruefung.oberhalb(args)],
  ["ln", (pruefung, args, name) => pruefung.verweis(args) || pruefung.zielLetzter(args, name)],
  ...zuordnen(["cp", "install", "rsync", "scp", "ditto"], (pruefung, args, name) => pruefung.kopieren(args, name)),
  ...zuordnen([...WRAPPER.keys()], (pruefung, args, name) => pruefung.wrapper(args, name)),
  ...zuordnen(["bash", "sh", "zsh", "dash", "ksh", "source", "."], (pruefung, args) => pruefung.shell(args)),
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
  ["patch", (pruefung, args) => pruefung.patch(args)],
  ...zuordnen(["tar", "gtar", "bsdtar"], (pruefung, args) => pruefung.tar(mitStrich(args))),
  ["unzip", (pruefung, args) => pruefung.unzip(args)],
  ["zip", (pruefung, args) => pruefung.zip(args)],
  ...zuordnen(PACKER, (pruefung, args) => pruefung.packer(args)),
  ["eval", (pruefung, args) => pruefung.eval(args)],
  ...zuordnen(["npx", "bunx", "pnpx"], (pruefung, args, name) => pruefung.npx(args, name)),
  ["tree", (pruefung, args) => hatOption(args, "o") && pruefung.alle(args)],
  ["xxd", (pruefung, args) => hatOption(args, "r") && pruefung.alle(args)],
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

function langPasst(text, name, genau) {
  const gleich = text.indexOf("=");
  const gegeben = (gleich === -1 ? text : text.slice(0, gleich)).toLowerCase();
  return gegeben === name || (!genau && gegeben.length > SCHRITT_MIT_WERT && name.startsWith(gegeben));
}

function optionSucher(genau) {
  return (args, kurz, ...lang) => args.some((wort) => {
    if (!istOption(wort)) return false;
    if (wort.text.startsWith("--")) return lang.some((name) => langPasst(wort.text, name, genau));
    return [...wort.text.slice(1)].some((buchstabe) => kurz.includes(buchstabe));
  });
}

const hatOption = optionSucher(false);
const hatGenau = optionSucher(true);

function schreibOption(text) {
  return SCHREIB_KURZ.test(text) || (text.startsWith("--") && SCHREIB_LANG.some((name) => langPasst(text, name, false)));
}

const KETTE_SCHREIBT = new Map([
  ["sed", (args) => hatOption(args, "i", "--in-place")],
  ["sort", (args) => hatOption(args, "o", "--output")],
  ["uniq", (args) => operanden(args).length > 1],
  ["tree", (args) => hatOption(args, "o")],
  ["xxd", (args) => hatOption(args, "r")],
  ...zuordnen(["awk", "gawk", "mawk", "nawk"], (args) => hatOption(args, "i")),
]);

function schreibtInDatei({ op, ziel }) {
  if (LESEND.has(op) || ziel === null) return false;
  return !(DUPLIKAT.has(op) && !ziel.dyn && DESKRIPTOR.test(ziel.text));
}

function schreibtDatei(umleitung) {
  return schreibtInDatei(umleitung) && (umleitung.ziel.dyn || !GERAET.test(umleitung.ziel.text));
}

function konfigErlaubt(eintrag, ausUmgebung) {
  if (!ausUmgebung && eintrag === GIT_PAGER_CAT) return true;
  return GIT_KONFIG_FREI.test(eintrag.split("=")[0]);
}

function patchEingabe(wort, folgend) {
  const { text } = wort;
  if (PATCH_EINGABE_OPTION.test(text) || text === "--input") return [folgend ?? DYN_WORT];
  if (text.startsWith("--input=")) return [{ ...wort, text: text.slice("--input=".length) }];
  return PATCH_EINGABE_ANGEHAENGT.test(text) ? [{ ...wort, text: text.slice(SCHRITT_MIT_WERT) }] : [];
}

function optionWerte(args, kurz, lang) {
  return args.flatMap((wort, nummer) => {
    if (wort.dyn || !wort.text.startsWith("-")) return [];
    const { text } = wort;
    if (text.startsWith("--")) {
      if (!lang.some((eintrag) => langPasst(text, eintrag, false))) return [];
      return text.includes("=") ? [{ ...wort, text: text.slice(text.indexOf("=") + 1) }] : [args[nummer + 1] ?? DYN_WORT];
    }
    const stelle = [...text.slice(1)].findIndex((buchstabe) => kurz.includes(buchstabe));
    if (stelle === -1) return [];
    const rest = text.slice(stelle + SCHRITT_MIT_WERT);
    return rest === "" ? [args[nummer + 1] ?? DYN_WORT] : [{ ...wort, text: rest }];
  });
}

function ohneOptionswerte(args, mitWert) {
  return args.filter((wort, nummer) => nummer === 0 || wort.dyn || !mitWert.has(args[nummer - 1].text));
}

function repoOperanden(args) {
  return operanden(ohneOptionswerte(args, GIT_OPTION_MIT_WERT));
}

function fernQuelle(wort) {
  return GIT_FERN.test(wort?.text ?? "");
}

function nurPruefung(args) {
  const optionen = args.filter(istOption);
  return optionen.every((wort) => wort.text === "--check" || wort.text === "-c");
}

function mitStrich(args) {
  const [kopf] = args;
  return kopf === undefined || kopf.dyn || kopf.text.startsWith("-") ? args : [{ ...kopf, text: `-${kopf.text}` }, ...args.slice(1)];
}

function pfadKandidaten(text) {
  const nachGleich = text.includes("=") ? [text.slice(text.indexOf("=") + 1)] : [];
  if (!text.startsWith("-")) return [text, ...nachGleich].filter((kandidat) => kandidat !== "");
  const angehaengt = KURZ_OPTION.test(text) && !text.startsWith("--") ? [text.slice(SCHRITT_MIT_WERT)] : [];
  return [...nachGleich, ...angehaengt].filter((kandidat) => kandidat !== "");
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

function zielOperanden(args, name) {
  const stelle = args.findIndex((wort) => istOption(wort) && (ZIEL_OPTION.test(wort.text) || wort.text.startsWith("--target-directory")));
  if (stelle === -1 || OHNE_ZIEL_OPTION.has(name)) return operanden(args).slice(-1);
  return args[stelle].text.includes("=") ? [args[stelle]] : args.slice(stelle + 1, stelle + SCHRITT_MIT_WERT);
}

function gitGlobalBekannt(option) {
  return GIT_GLOBAL_MIT_WERT.has(option) || GIT_GLOBAL_FREI.has(option) || option.startsWith(CONFIG_ENV);
}

function istKonfigOption(text) {
  return text === "-c" || text === "--config-env" || text.startsWith(CONFIG_ENV);
}

function konfigEintrag(wort, wert) {
  const { text } = wort;
  if (text === "-c") return wert;
  if (text === "--config-env") return wert && { ...wert, umgebung: true };
  return { ...wort, text: text.slice(CONFIG_ENV.length), umgebung: true };
}

function gitOptionen(args) {
  const orte = [];
  const konfig = [];
  let stelle = 0;
  while (stelle < args.length && istOption(args[stelle])) {
    const wort = args[stelle];
    if (!gitGlobalBekannt(wort.text)) return { fremd: true, orte, konfig, stelle };
    const wert = GIT_GLOBAL_MIT_WERT.has(wort.text) ? args[stelle + 1] : undefined;
    stelle += wert === undefined ? 1 : SCHRITT_MIT_WERT;
    if (wort.text === "-C" && wert !== undefined) orte.push(wert);
    else if (istKonfigOption(wort.text)) konfig.push(konfigEintrag(wort, wert));
  }
  return { fremd: false, orte, konfig: konfig.filter((eintrag) => eintrag !== undefined), stelle };
}

function heisstSrc(wort) {
  const name = basename(wort.text.replace(/\/+$/, "")).toLowerCase();
  return name === "src" || (wort.glob && matchesGlob("src", name));
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
    Object.assign(this, { roh, cwd, orte: new Set([cwd]), ortUnklar: false, vorbereitet: false, inWert: false, bedingt: false, umleitungen: [], tiefe: 0, treffer: new Map(), wissen: null });
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
    return this.unterSrc(ziel) || (oberhalb ? this.srcOberhalb(ziel) : GIT_STEUER.test(ziel));
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

  zielLetzter(args, name) {
    const ziele = zielOperanden(args, name);
    if (ziele.some((wort) => this.trifft(wort))) return true;
    return ziele.some((wort) => this.trifft(wort, true)) && this.kopiertOrdner(args, name);
  }

  kopieren(args, name) {
    const verweist = hatOption(args, "ls", ...VERWEIS_OPTIONEN) && this.verweis(args);
    return verweist || this.zielLetzter(args, name);
  }

  verweis(args) {
    const quellen = [...operanden(args), ...optionWerte(args, "", ["--link-dest"])].map((wort) => ({ ...wort, text: wort.text.replace(SPEC_PRAEFIX, "") }));
    return quellen.some(heisstSrc) || this.oberhalb(quellen);
  }

  skriptAusserhalb(skript) {
    if (skript.dyn) return true;
    const { checkout, wurzel } = this.repo;
    return this.skriptZiele(skript).some((ziel) => ![wurzel, checkout].some((ordner) => isInside(ziel, ordner)));
  }

  skriptZiele(skript) {
    return [...this.orte].map((ort) => realPath(resolve(ort, ohneTilde(skript.text))));
  }

  kopiertOrdner(args, name) {
    if (ORDNER_KOPIEREN.has(name) || hatOption(args, "rRad", "--recursive", "--archive", "--dirs")) return true;
    return operanden(args).some(heisstSrc);
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
    if (dateien.length === 0 || dateien[0].text === "-" || hatOption(args, "s")) return this.unsicher();
    return this.oberhalb(dateien.slice(1)) || this.skriptFremd(dateien[0]);
  }

  skriptFremd(skript) {
    return this.skriptAusserhalb(skript) && this.unsicher();
  }

  paketManager(args, name) {
    const stelle = args.findIndex((wort) => !wort.dyn && (PAKET_AUSFUEHREN.has(wort.text) || PAKET_SKRIPT.has(wort.text)));
    if (stelle !== -1 && this.paketAusfuehren(args, stelle)) return true;
    return this.paketAendert(args) || this.fremd(name, args);
  }

  paketAendert(args) {
    const woerter = operanden(args).map((wort) => wort.text);
    const konfig = woerter.findIndex((text) => text === "set" || PAKET_KONFIG.has(text));
    if (konfig !== -1 && (woerter[konfig] === "set" || PAKET_KONFIG_AENDERT.has(woerter[konfig + 1]))) return true;
    return woerter.some((text) => PAKET_VERWEIS.has(text)) && this.verweis(args);
  }

  paketAusfuehren(args, stelle) {
    const rest = args.slice(stelle + 1);
    const aufrufe = optionWerte(rest, "c", ["--call"]);
    if (aufrufe.length > 0) return aufrufe.some((wort) => this.befehlWert(wort));
    const innen = args[stelle].text === "node" ? args.slice(stelle) : nachWrapper("npx", rest);
    const skript = PAKET_SKRIPT.has(args[stelle].text);
    const bekannt = innen.length > 0 && PROGRAMM_PRUEFUNGEN.has(kanonisch(basename(innen[0].text)));
    return (!skript || bekannt) && innen.length > 0 && this.aufruf(innen) !== null;
  }

  gh(args) {
    const [gruppe, aktion] = operanden(args).map((wort) => wort.text);
    return GH_AENDERT.get(gruppe)?.has(aktion) === true || this.fremd("gh", args);
  }

  ausfuehrung(name, args) {
    return this.befehlOption(name, args) || this.skriptOption(name, args) || this.plusOperand(name, args);
  }

  befehlOption(name, args) {
    const [kurz, lang] = BEFEHL_OPTIONEN.get(name) ?? ["", []];
    const befehle = optionWerte(args, kurz, lang);
    return befehle.length > 0 && (this.unsicher() || befehle.some((wort) => this.befehlWert(wort)));
  }

  skriptOption(name, args) {
    const [kurz, lang] = SKRIPT_OPTIONEN.get(name) ?? ["", []];
    return optionWerte(args, kurz, lang).some((wort) => this.skriptFremd(wort));
  }

  plusOperand(name, args) {
    return PLUS_PROGRAMME.has(name) && this.unsicher() && operanden(args).some((wort) => wort.text.startsWith("+"));
  }

  interpreter(args, name) {
    const spec = INTERPRETER.get(name);
    const dateien = operanden(args);
    const ohneSkript = dateien.length === 0 || dateien[0].text === "-" || spec.wort.includes(dateien[0].text);
    if (name === "node" && hatOption(args, "c", "--check")) return !nurPruefung(args) && this.oberhalb(args);
    if (ohneSkript || hatOption(args, spec.kurz, ...spec.lang)) return this.unsicher();
    return !(name === "node" && this.auftragLesen(dateien)) && this.skriptLauf(args, dateien[0]);
  }

  skriptLauf(args, skript) {
    return this.oberhalb(args.filter((wort) => wort !== skript)) || this.skriptFremd(skript);
  }

  auftragLesen([skript, befehl]) {
    if (befehl === undefined || befehl.dyn || skript.dyn || !AUFTRAG_LESEN.has(befehl.text)) return false;
    const { checkout, wurzel } = this.repo;
    return this.skriptZiele(skript).some((ziel) => [wurzel, checkout].some((ordner) => ziel === join(ordner, "tools", "auftrag.mjs")));
  }

  npx(args, name) {
    const aufrufe = optionWerte(args, "c", ["--call"]);
    if (aufrufe.length === 0) return this.wrapper(args, name);
    return aufrufe.some((wort) => this.befehlWert(wort));
  }

  patchEnthaeltSrc(wort) {
    if (wort.dyn) return this.unsicher();
    return [...this.orte].some((ort) => {
      try {
        const inhalt = readFileSync(resolve(ort, wort.text), "utf8");
        return SRC_WORT.test(inhalt) || PATCH_KOPF_MASKIERT.test(inhalt);
      } catch {
        return true;
      }
    });
  }

  gitPatch(rest) {
    if (hatGenau(rest, "", ...GIT_NUR_LESEN) && !hatOption(rest, "", "--apply")) return false;
    if (this.alle(rest)) return true;
    return this.patchQuelle(operanden(rest));
  }

  imSrcOrt() {
    return this.ortUnklar || [...this.orte].some((ort) => this.unterSrc(ort));
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
    return !hatGenau(args, "ctl", ...NUR_LESEN_ODER_STDOUT) && this.alle(args);
  }

  patchQuelle(dateien) {
    if (this.imSrcOrt()) return true;
    const echte = dateien.filter((wort) => wort.dyn || wort.text !== "-");
    const vonStdin = dateien.length === 0 || echte.length < dateien.length;
    return echte.some((wort) => this.patchEnthaeltSrc(wort)) || (vonStdin && this.stdinPatch());
  }

  stdinPatch() {
    const eingabe = this.umleitungen.findLast(({ op }) => LESEND.has(op));
    if (eingabe === undefined || eingabe.op === "<&") return true;
    if (eingabe.op === "<" && eingabe.ziel !== null) return this.patchEnthaeltSrc(eingabe.ziel);
    return SRC_WORT.test(this.roh) || PATCH_KOPF_MASKIERT.test(this.roh);
  }

  patch(args) {
    if (this.alle(args)) return true;
    if (hatGenau(args, "", "--dry-run")) return false;
    const eingabe = args.flatMap((wort, nummer) => (wort.dyn ? [] : patchEingabe(wort, args[nummer + 1])));
    if (eingabe.length > 0) return this.patchQuelle(eingabe);
    const ohneWerte = ohneOptionswerte(args, PATCH_OPTION_MIT_WERT);
    const dateien = operanden(ohneWerte);
    return this.patchQuelle(dateien.length > 1 ? dateien.slice(1) : []);
  }

  gitPfade(unter, rest) {
    const nurIndex = (unter === "restore" && hatGenau(rest, "S", "--staged") && !hatOption(rest, "W", "--worktree"))
      || (unter === "rm" && hatGenau(rest, "", "--cached"))
      || (unter === "clean" && hatGenau(rest, "n", "--dry-run"));
    if (nurIndex) return false;
    return operanden(rest).some((wort) => this.trifft(wort, true));
  }

  gitStash(rest) {
    const [aktion] = operanden(rest);
    if (aktion !== undefined && STASH_LESEND.has(aktion.text)) return false;
    const ende = rest.findIndex((wort) => !wort.dyn && wort.text === "--");
    if (ende === -1) return true;
    const pfade = rest.slice(ende + 1);
    return pfade.length === 0 || this.oberhalb(pfade);
  }

  gitCheckoutIndex(rest) {
    const praefix = optionWerte(rest, "", ["--prefix"]);
    if (praefix.length > 0) return praefix.some((wort) => this.trifft(wort, true));
    return hatOption(rest, "a", "--all", "--stdin") || this.oberhalb(operanden(rest));
  }

  gitUnterbefehl(unter, rest) {
    if (GIT_PATCH.has(unter)) return this.gitPatch(rest);
    if (unter === "stash") return this.gitStash(rest);
    if (unter === "checkout-index") return this.gitCheckoutIndex(rest);
    if (unter === "reset") return hatOption(rest, "", "--hard", "--merge", "--keep");
    if (GIT_PFAD.has(unter)) return this.gitPfade(unter, rest);
    return !GIT_FREI.has(unter) || this.gitFrei(unter, rest);
  }

  gitFrei(unter, rest) {
    const zusatz = GIT_ZUSATZ.get(unter);
    return this.gitAusgabe(unter, rest) || (zusatz !== undefined && zusatz(this, rest, unter));
  }

  gitHolen(rest) {
    if (hatOption(rest, "", "--upload-pack", "--receive-pack", "--exec", "--repo")) return true;
    const quellen = repoOperanden(rest);
    return (hatOption(rest, "", "--multiple") ? quellen : quellen.slice(0, 1)).some((wort) => !GIT_QUELLEN.has(wort.text));
  }

  gitKlon(rest, unter) {
    if (this.oberhalb(rest) || hatOption(rest, "", "--template")) return true;
    return unter === "clone" && !fernQuelle(repoOperanden(rest)[0]);
  }

  gitKonfig(rest) {
    const woerter = operanden(rest);
    if (woerter.length < SCHRITT_MIT_WERT) return false;
    return !woerter.slice(0, -1).every((wort) => konfigErlaubt(wort.text, true));
  }

  gitRemote(rest) {
    const [aktion] = operanden(rest);
    return aktion !== undefined && GIT_REMOTE_AENDERT.has(aktion.text);
  }

  konfigGesperrt(wort) {
    return !konfigErlaubt(wort.text, wort.umgebung === true);
  }

  gitAusgabe(unter, rest) {
    return this.oberhalb(optionWerte(rest, GIT_AUSGABE_KURZ.get(unter) ?? "", ["--output", "--output-directory", "--file"]));
  }

  gitAusfuehren(rest) {
    return optionWerte(rest, "x", ["--exec", "--extcmd"]).some((wort) => this.befehlWert(wort));
  }

  befehlWert(wort) {
    return wort.dyn ? this.unsicher() : this.text(wort.text) !== null;
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
    const { fremd, orte, konfig, stelle } = gitOptionen(args);
    if (fremd || konfig.some((wort) => this.konfigGesperrt(wort))) return true;
    const unter = args[stelle];
    if (unter === undefined) return false;
    if (unter.dyn) return this.unsicher();
    return this.inOrten(orte, () => this.gitUnterbefehl(unter.text, args.slice(stelle + 1)));
  }

  unbekannt(args) {
    return args.some((wort) => !wort.dyn && schreibOption(wort.text)) && this.oberhalb(args);
  }

  fremd(name, args) {
    if (LESEPROGRAMME.has(name)) return false;
    if (PRUEFER.has(name)) return operanden(args).some((wort) => !wort.dyn && PAKET_SCHREIBT.test(wort.text)) || this.unbekannt(args);
    return this.oberhalb(args) || (!TEXT_PROGRAMME.has(name) && this.srcImBefehl(name, args));
  }

  srcImBefehl(name, args) {
    if (!this.inWert && !SHELL_EINGEBAUT.has(name)) return this.unsicher();
    return args.some((wort) => !wort.dyn && SRC_WORT.test(wort.text));
  }

  programmFund([kopf, ...args]) {
    if (kopf.dyn) return this.unsicher() ? "Programm aus einer Variablen" : null;
    const name = kanonisch(basename(kopf.text));
    const pruefe = PROGRAMM_PRUEFUNGEN.get(name);
    const schreibt = this.ausfuehrung(name, args) || (pruefe ? pruefe(this, args, name) : this.fremd(name, args));
    return schreibt ? name : null;
  }

  umgebungGit(woerter) {
    return woerter.some((wort) => this.umgebungWort(wort.text));
  }

  umgebungWort(text) {
    const [, name] = GIT_UMGEBUNG.exec(text) ?? [];
    if (name !== undefined) return !GIT_UMGEBUNG_FREI.has(name);
    return (GIT_HOME.test(text) && GIT_WORT.test(this.roh)) || this.codeUmgebung(text);
  }

  codeUmgebung(text) {
    const [, name, wert] = UMGEBUNG_ZUWEISUNG.exec(text) ?? [];
    if (name === undefined || !this.unsicher()) return false;
    if (UMGEBUNG_PFAD.test(name)) return true;
    return UMGEBUNG_BEFEHL.test(name) && !HARMLOS_WERT.test(wert.trim());
  }

  aufruf(woerter) {
    if (this.umgebungGit(woerter)) return "Umgebung";
    const rest = ohneVorspann(woerter);
    if (rest.length === 0) return null;
    const werte = woerter.slice(0, woerter.length - rest.length).filter((wort) => !wort.dyn && ZUWEISUNG.test(wort.text));
    if (werte.some((wort) => this.zuweisungFund(wort))) return "Zuweisung";
    return this.programmFund(rest);
  }

  zuweisungFund(wort) {
    const gerettet = { vorbereitet: this.vorbereitet, inWert: this.inWert };
    this.inWert = true;
    try {
      return this.befehlWert({ ...wort, text: wort.text.slice(wort.text.indexOf("=") + 1) });
    } finally {
      Object.assign(this, gerettet);
    }
  }

  umleitungSchreibt(umleitung) {
    return schreibtInDatei(umleitung) && this.trifft(umleitung.ziel);
  }

  befehlFund({ woerter, umleitungen, bedingt }) {
    this.bedingt = bedingt;
    this.umleitungen = umleitungen;
    const umleitung = umleitungen.find((eintrag) => this.umleitungSchreibt(eintrag));
    if (umleitung !== undefined) return `Umleitung ${umleitung.op} ${umleitung.ziel.text}`;
    return this.aufruf(woerter) ?? this.kette(woerter, umleitungen);
  }

  kette(woerter, umleitungen) {
    const stufe = Math.max(umleitungen.some(schreibtDatei) ? STUFE_INHALT : STUFE_KEINE, this.programmStufe(ohneVorspann(woerter)));
    const gesperrt = stufe > STUFE_KEINE && this.vorbereitet && this.unsicher();
    this.vorbereitet ||= stufe === STUFE_INHALT;
    return gesperrt ? KETTE : null;
  }

  programmStufe(rest) {
    if (rest.length === 0) return STUFE_KEINE;
    const [kopf, ...args] = rest;
    if (kopf.dyn) return STUFE_INHALT;
    const name = kanonisch(basename(kopf.text));
    if (WRAPPER.has(name)) return this.programmStufe(nachWrapper(name, args));
    if (this.lesend(name, args)) return STUFE_KEINE;
    return KETTE_LEICHT.has(name) ? STUFE_LEICHT : STUFE_INHALT;
  }

  lesend(name, args) {
    if (KETTE_SCHREIBT.has(name)) return !KETTE_SCHREIBT.get(name)(args);
    return KETTE_FREI.has(name) || (name === "node" && this.auftragLesen(operanden(args)));
  }

  text(text) {
    if (this.tiefe >= MAX_TIEFE) return this.unsicher() ? UNKLAR : null;
    const { befehle, fehler } = new Zerleger(text);
    if (fehler !== null) return this.unsicher() ? UNKLAR : null;
    const gerettet = { orte: this.orte, umleitungen: this.umleitungen, bedingt: this.bedingt };
    this.orte = new Set(gerettet.orte);
    this.tiefe += 1;
    try {
      return befehle.map((befehl) => this.befehlFund(befehl)).find(Boolean) ?? null;
    } finally {
      this.tiefe -= 1;
      Object.assign(this, gerettet);
    }
  }
}

export function bashSrcFund(input, command) {
  return new SrcPruefung(input, command).text(command);
}
