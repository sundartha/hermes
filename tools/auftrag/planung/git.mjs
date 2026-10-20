import { spawnSync } from "node:child_process";
import { devNull } from "node:os";
import { resolve } from "node:path";
import { env } from "node:process";

const GIT_VARIABLE = /^GIT_/;
const OHNE_GIT_KONFIGURATION = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull };
const OHNE_FSMONITOR = ["-c", "core.fsmonitor=false"];
const OHNE_HOOKS = ["-c", `core.hooksPath=${devNull}`];
const GIT_GRUEN = 0;

export function gitUmgebung(zusatz = {}) {
  const ohneGit = Object.entries(env).filter(([name]) => !GIT_VARIABLE.test(name));
  return { ...Object.fromEntries(ohneGit), ...OHNE_GIT_KONFIGURATION, ...zusatz };
}

function gitMitSperren(sperren) {
  return (root, args, { zusatz = {}, erlaubt = [GIT_GRUEN], eingabe } = {}) => {
    const lauf = spawnSync("git", [...sperren, ...args], { cwd: root, encoding: "utf8", env: gitUmgebung(zusatz), input: eingabe, maxBuffer: Infinity });
    if (lauf.error) throw new Error(`git ${args.join(" ")} ließ sich nicht ausführen: ${lauf.error.message}`);
    if (!erlaubt.includes(lauf.status)) throw new Error(`git ${args.join(" ")} ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr}`);
    return lauf;
  };
}

export const gitLauf = gitMitSperren([...OHNE_FSMONITOR, ...OHNE_HOOKS]);

const gitOhneHookSperre = gitMitSperren(OHNE_FSMONITOR);

export function gitPfadeAbfragen(root, namen) {
  const argumente = ["rev-parse", ...namen.flatMap((name) => ["--git-path", name])];
  const pfade = gitOhneHookSperre(root, argumente).stdout.trim().split("\n");
  return Object.fromEntries(namen.map((name, stelle) => [name, resolve(root, pfade[stelle])]));
}
