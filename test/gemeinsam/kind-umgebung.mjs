import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { konfigurationsNamen } from "../../tools/flaechen.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const KONFIG_NAMEN = konfigurationsNamen(WURZEL);
const TESTRUNNER_KONTEXT = "NODE_TEST_CONTEXT";
const NAME_EINES_GEHEIMNISSES = /TOKEN|SECRET|KEY|PASSWORD/i;

function gehoertNichtInsKind(name) {
  return KONFIG_NAMEN.has(name) || name === TESTRUNNER_KONTEXT || NAME_EINES_GEHEIMNISSES.test(name);
}

function verketteNodeOptions(umgebung, zusatz) {
  if (typeof zusatz.NODE_OPTIONS !== "string" || !env.NODE_OPTIONS) return umgebung;
  return { ...umgebung, NODE_OPTIONS: `${env.NODE_OPTIONS} ${zusatz.NODE_OPTIONS}` };
}

export function kindUmgebung(zusatz = {}) {
  const geerbt = Object.entries(env).filter(([name]) => !gehoertNichtInsKind(name));
  const umgebung = verketteNodeOptions({ ...Object.fromEntries(geerbt), ...zusatz }, zusatz);
  return Object.fromEntries(Object.entries(umgebung).filter(([, wert]) => wert !== undefined));
}
