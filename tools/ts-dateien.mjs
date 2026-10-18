import { git } from "./pruefungen-messen.mjs";

export const CHECKED_ROOTS = ["src/", "test/", "tools/", "scripts/"];
export const TYPESCRIPT_FILE = /\.(?:[cm]?ts|tsx)$/i;
export const DECLARATION_FILE = /\.d\.(?:[^/]*\.)?[cm]?ts$/i;
const PEEL_TO_COMMIT = "^{commit}";

export function isCommit(revision) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${revision}${PEEL_TO_COMMIT}`]);
    return true;
  } catch {
    return false;
  }
}
