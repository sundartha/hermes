import process, { env } from "node:process";

export const SCHALTER = "HERMES_LOKAL_SCHWER";
export const EXIT_GESPERRT = 3;
const MELDUNG = " läuft nur auf GitHub Actions (Pflicht-Checks des PR bzw. workflow_dispatch). Lokal: npm run pruefen oder npm test -- <datei>.";

const EHRLICHKEIT = "Die Sperre beruht auf Absprache: GITHUB_ACTIONS=true kann jeder Prozess setzen, es ist keine Sicherung, und es lokal zu setzen ist ein Regelbruch.";

export function schwerErlaubt() {
  if (env.GITHUB_ACTIONS === "true") return true;
  return env[SCHALTER] === "ja" && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

export function nimmSperreAuchFuerKindprozesse(anlass) {
  if (schwerErlaubt()) return;
  console.error(`${anlass}${MELDUNG}\n${EHRLICHKEIT}`);
  process.exit(EXIT_GESPERRT);
}
