import { git } from "./git.mjs";
import { MASTER } from "./worktrees.mjs";

export function phasenbasis(root) {
  try {
    return git(["merge-base", "HEAD", MASTER], { cwd: root }).trim();
  } catch {
    return null;
  }
}
