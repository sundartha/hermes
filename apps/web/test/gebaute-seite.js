import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK_PARENT = join(WEB_ROOT, "node_modules");

export function buildSite(prefix, buildDir) {
  const workDir = mkdtempSync(join(WORK_PARENT, prefix));
  const distDir = join(workDir, buildDir);
  execFileSync("npx", ["astro", "build", "--outDir", distDir], { cwd: WEB_ROOT, stdio: "pipe" });
  return { workDir, distDir };
}

export function removeBuild(workDir) {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
}
