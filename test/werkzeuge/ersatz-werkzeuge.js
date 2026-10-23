import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const AUSFUEHRBAR = 0o755;
const GRUEN = "#!/bin/sh\nexit 0\n";
const ERSATZ = {
  semgrep: '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("1.0.0");\nelse process.exitCode = 2;\n',
  pg_isready: GRUEN,
};
const ERSATZ_POSTGRES = "postgres://ersatz@localhost:5432/ersatz";

export function mitErsatzWerkzeugen(werkzeug) {
  const ordner = join(werkzeug, "ersatz-bin");
  mkdirSync(ordner, { recursive: true });
  for (const [name, inhalt] of Object.entries(ERSATZ)) writeFileSync(join(ordner, name), inhalt, { mode: AUSFUEHRBAR });
  return { PATH: `${ordner}${delimiter}${process.env.PATH}`, HERMES_TEST_POSTGRES_URL: ERSATZ_POSTGRES };
}
