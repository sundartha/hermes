import { spawn } from "node:child_process";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import { fremderSigner } from "../../scripts/last/webhooks.mjs";
import { COMMIT_MUSTER } from "./ausgabe.mjs";
import { githubZugang, hermesZugang } from "./netz.mjs";
import { abwarten, ECHTE_UHR, STAGING_TAKTE } from "./takt.mjs";

const PROBE_AUTH = fileURLToPath(new URL("../../scripts/probe-auth.sh", import.meta.url));
const HTTP_OK = 200;
const HTTP_NICHT_ANGEMELDET = 401;
const HTTP_VERBOTEN = 403;
const KENNUNG_LAENGE = 12;
const MS_JE_SEKUNDE = 1000;
const SIGNATUR_KOPF = "telnyx-signature-ed25519";
const ZEIT_KOPF = "telnyx-timestamp";
const EXIT_OK = 0;
const EXIT_NICHT_GESTARTET = 127;
const ERREICHT = "erreicht";
const UEBERHOLT = "ueberholt";

export function skriptStarten(pfad, argumente) {
  return new Promise((fertig) => {
    const kind = spawn("bash", [pfad, ...argumente], {
      stdio: "ignore",
      env: { PATH: env.PATH ?? "" },
    });
    kind.on("error", () => fertig(EXIT_NICHT_GESTARTET));
    kind.on("close", (code) => fertig(code ?? EXIT_NICHT_GESTARTET));
  });
}

export function probeAuthStarten({ url, commit }) {
  return skriptStarten(PROBE_AUTH, [url, commit]);
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

function webhookZiele(commit) {
  const unbekannt = "probe-nicht-vorhanden-" + commit.slice(0, KENNUNG_LAENGE);
  return [
    { teil: "voice/outbound", pfad: "/voice/outbound?callId=" + unbekannt },
    { teil: "voice/status", pfad: "/voice/status" },
  ];
}

function webhookKopf(signer, zeit, formular) {
  return { [SIGNATUR_KOPF]: signer.sign(zeit, formular), [ZEIT_KOPF]: zeit };
}

async function webhookProbe({ hermes, ziel, signer, schluessel, erwartet, ausgabe, uhr, commit }) {
  const formular = new URLSearchParams({
    CallSid: "CAprobe" + commit.slice(0, KENNUNG_LAENGE),
    CallStatus: "ringing",
  }).toString();
  const zeit = String(Math.floor(uhr.jetzt() / MS_JE_SEKUNDE));
  const kopf = webhookKopf(signer, zeit, formular);
  const http = await hermes.webhook({ pfad: ziel.pfad, formular, kopf });
  ausgabe.melde(schluessel, { teil: ziel.teil, http });
  return http === erwartet;
}

async function webhooksProbieren({ hermes, commit, ausgabe, uhr }) {
  const signer = fremderSigner();
  const ergebnisse = [];
  for (const ziel of webhookZiele(commit)) {
    ergebnisse.push(
      await webhookProbe({
        hermes,
        ziel,
        ausgabe,
        uhr,
        commit,
        signer,
        schluessel: "probe_webhook_fremd",
        erwartet: HTTP_VERBOTEN,
      }),
    );
  }
  return ergebnisse.every(Boolean);
}

async function standProbieren({ hermes, einstellungen, commit, ausgabe }) {
  const { status, gesund, commit: gemeldet, telnyxSchluessel } = await hermes.betriebsstatus(einstellungen.statusToken);
  const ok = gesund && gemeldet === commit;
  ausgabe.melde("probe_stand", { http: status, ok });
  ausgabe.melde("telnyx_schluessel", { http: status, ok: telnyxSchluessel });
  return ok && telnyxSchluessel;
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
  const hermes = hermesZugang(einstellungen.stagingUrl);
  const webhooks = await webhooksProbieren({ hermes, commit, ausgabe, uhr });
  const stand = await standProbieren({ hermes, einstellungen, commit, ausgabe });
  if (einstellungen.absichtlichRot) {
    ausgabe.melde("absichtlich_rot");
    return false;
  }
  return exit === EXIT_OK && http === HTTP_NICHT_ANGEMELDET && webhooks && stand;
}
