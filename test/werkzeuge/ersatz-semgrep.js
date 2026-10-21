import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const AUSFUEHRBAR = 0o755;
const ERSATZ_SEMGREP = '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("1.0.0");\nelse process.exitCode = 2;\n';

export function mitErsatzSemgrep(werkzeug) {
  const ordner = join(werkzeug, "semgrep-bin");
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, "semgrep"), ERSATZ_SEMGREP, { mode: AUSFUEHRBAR });
  return { PATH: `${ordner}${delimiter}${process.env.PATH}` };
}
