import { env } from "node:process";

const NODE_WERKZEUGE = "NODE_(OPTIONS|V8_COVERAGE|EXTRA_CA_CERTS|USE_SYSTEM_CA)";
const PRUEFWERKZEUGE = "__STRYKER_\\w*|STRYKER_\\w*|TESTKOSTEN_\\w*|NETZ_BEOBACHTER_\\w*";
const BETRIEBSSYSTEM = "PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_\\w*|TZ|CI";
const WERKZEUG_UND_LAUFZEIT = new RegExp(`^(${NODE_WERKZEUGE}|${PRUEFWERKZEUGE}|${BETRIEBSSYSTEM})$`);

function verketteNodeOptions(umgebung, zusatz) {
  if (typeof zusatz.NODE_OPTIONS !== "string" || !env.NODE_OPTIONS) return umgebung;
  return { ...umgebung, NODE_OPTIONS: `${env.NODE_OPTIONS} ${zusatz.NODE_OPTIONS}` };
}

export function kindUmgebung(zusatz = {}) {
  const geerbt = Object.entries(env).filter(([name]) => WERKZEUG_UND_LAUFZEIT.test(name));
  const umgebung = verketteNodeOptions({ ...Object.fromEntries(geerbt), ...zusatz }, zusatz);
  return Object.fromEntries(Object.entries(umgebung).filter(([, wert]) => wert !== undefined));
}
