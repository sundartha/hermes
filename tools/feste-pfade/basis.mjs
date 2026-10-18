import { posix } from "node:path";

import { git } from "../pruefungen-messen.mjs";
import { arbeitsbaumAbbauen, basisArbeitsbaum } from "../testwirkung/geaendert.mjs";
import { umbenennungsPaare } from "../umbenennung.mjs";

const NUL = "\0";
const RENAMED = /^R\d*$/;
const FIELDS_PER_RENAME = 3;
const FIELDS_PER_CHANGE = 2;
const DELETED = "D";
const ADDED = "A";
const CODE_ENDING = /(?:\.d)?\.(?:[cm]?[jt]s|tsx)$/i;

function movedPairs(basis) {
  const fields = git(["diff", "-M", "--name-status", "--diff-filter=R", "-z", basis, "--"]).split(
    NUL,
  );
  const pairs = [];
  for (let index = 0; index + FIELDS_PER_RENAME <= fields.length; index += FIELDS_PER_RENAME) {
    const [status, alt, neu] = fields.slice(index, index + FIELDS_PER_RENAME);
    if (RENAMED.test(status)) pairs.push({ alt, neu });
  }
  return pairs;
}

function changedByStatus(basis) {
  const fields = git(["diff", "--no-renames", "--name-status", "-z", basis, "--"]).split(NUL);
  const byStatus = { [DELETED]: [], [ADDED]: [] };
  for (let index = 0; index + FIELDS_PER_CHANGE <= fields.length; index += FIELDS_PER_CHANGE) {
    const [status, path] = fields.slice(index, index + FIELDS_PER_CHANGE);
    byStatus[status]?.push(path);
  }
  return byStatus;
}

function stem(path) {
  return posix.basename(path).replace(CODE_ENDING, "");
}

function stemPairs(basis) {
  const { [DELETED]: deleted, [ADDED]: added } = changedByStatus(basis);
  const code = (path) => CODE_ENDING.test(path);
  return deleted
    .filter(code)
    .flatMap((alt) =>
      added.filter((neu) => code(neu) && stem(neu) === stem(alt)).map((neu) => ({ alt, neu })),
    );
}

export function renamePairs(basis) {
  const all = [
    ...umbenennungsPaare({ von: basis, bis: undefined }),
    ...movedPairs(basis),
    ...stemPairs(basis),
  ];
  const unique = new Map(all.map(({ alt, neu }) => [`${alt}${NUL}${neu}`, { alt, neu }]));
  return [...unique.values()].sort((left, right) => left.alt.localeCompare(right.alt));
}

export function trackedAt(basis) {
  return git(["ls-tree", "-r", "-z", "--name-only", basis]).split(NUL).filter(Boolean);
}

export async function withSnapshot(basis, use) {
  const directory = basisArbeitsbaum(basis);
  try {
    return await use(directory);
  } finally {
    arbeitsbaumAbbauen(directory);
  }
}
