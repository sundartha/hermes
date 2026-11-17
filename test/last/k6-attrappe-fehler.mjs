import { readFileSync, writeFileSync } from "node:fs";

const werte = Object.fromEntries(
  process.argv.flatMap((argument, stelle) =>
    process.argv[stelle - 1] === "-e" ? [argument.split(/=(.*)/s).slice(0, 2)] : [],
  ),
);
const konfiguration = JSON.parse(readFileSync(werte.LAST_KONFIG, "utf8"));
for (const zeile of konfiguration.stderrZeilen) process.stderr.write(`${zeile}\n`);
writeFileSync(werte.LAST_ERGEBNIS, JSON.stringify(konfiguration.ergebnis));
