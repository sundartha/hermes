import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

import { CHECKED_ROOTS, DECLARATION_FILE, TYPESCRIPT_FILE } from "../ts-dateien.mjs";

const OFF = 0;
const LEVELS = { off: 0, warn: 1, error: 2 };
const EXTENSION = "@typescript-eslint/";
function normalized(setting) {
  const [level = OFF, ...options] = [setting ?? []].flat();
  return { level: typeof level === "number" ? level : LEVELS[level], options };
}

const COMPILER_SETTINGS = Object.entries(tseslint.configs.eslintRecommended.rules);
const CHECKED_BY_COMPILER = new Set(
  COMPILER_SETTINGS.filter(([, setting]) => normalized(setting).level === OFF).map(
    ([name]) => name,
  ),
);
const EXTENSION_RULES = new Set(Object.keys(tseslint.plugin.rules));

async function rulesFor(eslint, path) {
  const config = await eslint.calculateConfigForFile(path);
  return new Map(
    Object.entries(config?.rules ?? {}).map(([name, setting]) => [name, normalized(setting)]),
  );
}

function keeps(rules, name, { level, options }) {
  const kept = rules.get(name) ?? normalized(undefined);
  return kept.level >= level && isDeepStrictEqual(kept.options, options);
}

function isKept({ after, neu }, name, setting) {
  if (keeps(after, name, setting)) return true;
  if (compilerChecks(neu) && CHECKED_BY_COMPILER.has(name)) return true;
  return EXTENSION_RULES.has(name) && keeps(after, `${EXTENSION}${name}`, setting);
}

export function ruleSource(state) {
  return new ESLint({ cwd: resolve(state.root) });
}

function compilerChecks(path) {
  const checked = CHECKED_ROOTS.some((root) => path.startsWith(root));
  return checked && TYPESCRIPT_FILE.test(path) && !DECLARATION_FILE.test(path);
}

function renamed(value, renames) {
  if (typeof value === "string") return renames.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => renamed(item, renames));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, renamed(item, renames)]),
  );
}

export async function lostRules({ before, after, pairs }, { alt, neu }) {
  const renames = new Map(pairs.map((pair) => [pair.alt, pair.neu]));
  const [old, current] = await Promise.all([
    rulesFor(before.data, join(resolve(before.root), alt)),
    rulesFor(after.data, join(resolve(after.root), neu)),
  ]);
  return [...old]
    .map(([name, setting]) => [name, { ...setting, options: renamed(setting.options, renames) }])
    .filter(
      ([name, setting]) => setting.level > OFF && !isKept({ after: current, neu }, name, setting),
    )
    .map(([name]) => `Regel ${name}`);
}
