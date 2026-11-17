import { readFileSync, writeFileSync } from "node:fs";

const werte = Object.fromEntries(
  process.argv.flatMap((argument, stelle) =>
    process.argv[stelle - 1] === "-e" ? [argument.split(/=(.*)/s).slice(0, 2)] : [],
  ),
);
writeFileSync(werte.LAST_ERGEBNIS, readFileSync(werte.LAST_KONFIG, "utf8"));
