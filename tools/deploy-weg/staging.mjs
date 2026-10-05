import { spawn } from "node:child_process";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import { COMMIT_MUSTER } from "./ausgabe.mjs";
import { githubZugang, hermesZugang } from "./netz.mjs";
import { abwarten, ECHTE_UHR, STAGING_TAKTE } from "./takt.mjs";

const PROBE_AUTH = fileURLToPath(new URL("../../scripts/probe-auth.sh", import.meta.url));
const HTTP_OK = 200;
const HTTP_NICHT_ANGEMELDET = 401;
const EXIT_OK = 0;
const EXIT_NICHT_GESTARTET = 127;
const ERREICHT = "erreicht";
const UEBERHOLT = "ueberholt";

export function probeAuthStarten({ url, commit }) {
  return new Promise((fertig) => {
    const kind = spawn("bash", [PROBE_AUTH, url, commit], {
      stdio: "ignore",
      env: { PATH: env.PATH ?? "" },
    });
    kind.on("error", () => fertig(EXIT_NICHT_GESTARTET));
    kind.on("close", (code) => fertig(code ?? EXIT_NICHT_GESTARTET));
  });
}

function gemeldetMelden(ausgabe, gemeldet) {
  if (COMMIT_MUSTER.test(gemeldet ?? "")) ausgabe.melde("staging_gemeldet", { commit: gemeldet });
  else ausgabe.melde("staging_ohne_commit");
}

function stagingBeobachter({ hermes, github, commit, ausgabe }) {
  const aelter = new Set();
  let bisher;
  return async () => {
    const gemeldet = await hermes.commit();
    if (gemeldet !== bisher) gemeldetMelden(ausgabe, gemeldet);
    bisher = gemeldet;
    if (gemeldet === commit) return ERREICHT;
    if (!COMMIT_MUSTER.test(gemeldet ?? "") || aelter.has(gemeldet)) return undefined;
    const { status, daten } = await github.lesen("/compare/" + commit + "..." + gemeldet);
    if (status !== HTTP_OK) return undefined;
    if (daten?.status === "ahead") {
      ausgabe.melde("staging_ueberholt", { commit: gemeldet });
      return UEBERHOLT;
    }
    aelter.add(gemeldet);
    return undefined;
  };
}

async function stagingAbwarten({ einstellungen, commit, ausgabe, uhr, takte }) {
  const hermes = hermesZugang(einstellungen.stagingUrl);
  const github = githubZugang(einstellungen);
  const beobachter = stagingBeobachter({ hermes, github, commit, ausgabe });
  const ergebnis = await abwarten({ uhr, ...takte }, beobachter);
  if (ergebnis.schutzgrenze) {
    ausgabe.melde("schutzgrenze", { schritt: "staging", minuten: ergebnis.minuten });
    return false;
  }
  if (ergebnis.wert === UEBERHOLT) return false;
  ausgabe.melde("staging_erreicht", { commit });
  return true;
}

export async function staging({
  einstellungen,
  commit,
  ausgabe,
  uhr = ECHTE_UHR,
  takte = STAGING_TAKTE,
  probeAuth = probeAuthStarten,
}) {
  if (!(await stagingAbwarten({ einstellungen, commit, ausgabe, uhr, takte }))) return false;
  const exit = await probeAuth({ url: einstellungen.stagingUrl, commit });
  ausgabe.melde("probe_auth", { exit });
  const http = await hermesZugang(einstellungen.stagingUrl).mcpOhneAnmeldung();
  ausgabe.melde("mcp_ohne_anmeldung", { http });
  if (einstellungen.absichtlichRot) {
    ausgabe.melde("absichtlich_rot");
    return false;
  }
  return exit === EXIT_OK && http === HTTP_NICHT_ANGEMELDET;
}
