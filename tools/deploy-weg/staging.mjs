import { spawn } from "node:child_process";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import { fremderSigner } from "../../scripts/last/webhooks.mjs";
import { COMMIT_MUSTER, fremdeZeilenMelden } from "./ausgabe.mjs";
import { githubZugang, hermesZugang } from "./netz.mjs";
import { abwarten, ECHTE_UHR, STAGING_PIN_TAKTE, STAGING_TAKTE, wiederholenBisFrist } from "./takt.mjs";

const PROBE_AUTH = fileURLToPath(new URL("../../scripts/probe-auth.sh", import.meta.url));
const HTTP_OK = 200;
const HTTP_NICHT_ANGEMELDET = 401;
const HTTP_VERBOTEN = 403;
const KENNUNG_LAENGE = 12;
const HEALTHZ_LESUNGEN = 12;
const MS_JE_SEKUNDE = 1000;
const SIGNATUR_KOPF = "telnyx-signature-ed25519";
const ZEIT_KOPF = "telnyx-timestamp";
const EXIT_OK = 0;
const EXIT_NICHT_GESTARTET = 127;
const PIN_VERLETZT = "Ziel-Pin verletzt";
const ERREICHT = "erreicht";
const UEBERHOLT = "ueberholt";

export function skriptStarten(pfad, argumente, ausgabe) {
  return new Promise((fertig) => {
    const kind = spawn("bash", [pfad, ...argumente], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: env.PATH ?? "" },
    });
    const standard = [];
    const fehler = [];
    kind.stdout.on("data", (stueck) => standard.push(stueck));
    kind.stderr.on("data", (stueck) => fehler.push(stueck));
    kind.on("error", () => fertig(EXIT_NICHT_GESTARTET));
    kind.on("close", (code) => {
      const exit = code ?? EXIT_NICHT_GESTARTET;
      if (exit !== EXIT_OK && ausgabe !== undefined) fremdeZeilenMelden(ausgabe, Buffer.concat([...standard, ...fehler]).toString());
      fertig(exit);
    });
  });
}

export function probeAuthStarten({ url, commit, ausgabe }) {
  return skriptStarten(PROBE_AUTH, [url, commit], ausgabe);
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

async function webhookProbe({ hermes, ziel, signer, ausgabe, uhr, commit }) {
  const formular = new URLSearchParams({
    CallSid: "CAprobe" + commit.slice(0, KENNUNG_LAENGE),
    CallStatus: "ringing",
  }).toString();
  const zeit = String(Math.floor(uhr.jetzt() / MS_JE_SEKUNDE));
  const kopf = webhookKopf(signer, zeit, formular);
  const http = await hermes.webhook({ pfad: ziel.pfad, formular, kopf });
  ausgabe.melde("probe_webhook_fremd", { teil: ziel.teil, http });
  return { teil: ziel.teil, http };
}

export async function fremdeWebhooksProbieren({ hermes, commit, ausgabe, uhr }) {
  const signer = fremderSigner();
  const ergebnisse = [];
  for (const ziel of webhookZiele(commit)) {
    ergebnisse.push(await webhookProbe({ hermes, ziel, ausgabe, uhr, commit, signer }));
  }
  return ergebnisse;
}

async function webhooksProbieren(kontext) {
  const ergebnisse = await fremdeWebhooksProbieren(kontext);
  return ergebnisse.every(({ http }) => http === HTTP_VERBOTEN);
}

async function abgewieseneJeInstanz(hermes) {
  const staende = new Map();
  for (let lesung = 0; lesung < HEALTHZ_LESUNGEN; lesung++) {
    const { instanz, abgewiesen } = await hermes.abgewieseneWebhooks();
    staende.set(instanz, abgewiesen);
  }
  return staende;
}

function zuwachsGleicherInstanzen(vorher, nachher) {
  let summe = 0;
  for (const [instanz, bisher] of vorher) {
    if (nachher.has(instanz)) summe += nachher.get(instanz) - bisher;
  }
  return summe;
}

export function fruehwarnungOk({ stand, basis, eigene, ausgabe }) {
  const zuviel = stand.webhooksAbgewiesen - basis - eigene;
  const rot = zuviel > 0 || stand.anrufeUeberHoechstdauer >= 1;
  if (rot) ausgabe.melde("fruehwarnung", { abgewiesen: zuviel, anrufe: stand.anrufeUeberHoechstdauer });
  return !rot;
}

export function absichtlichRotMelden({ einstellungen, ausgabe }) {
  if (!einstellungen.absichtlichRot) return false;
  ausgabe.melde("absichtlich_rot");
  return true;
}

function pinBeobachter(ausgabe) {
  const beobachter = {
    verletzt: false,
    ausgabe: Object.freeze({
      ...ausgabe,
      melde(schluessel, werte) {
        if (schluessel === "probe_auth_zeile" && werte.zeile.includes(PIN_VERLETZT)) beobachter.verletzt = true;
        ausgabe.melde(schluessel, werte);
      },
    }),
  };
  return beobachter;
}

function pinWartetMelden({ ausgabe, commit, gemeldet, letzter }) {
  if (!letzter) ausgabe.melde("pin_wartet", { commit });
  else if (COMMIT_MUSTER.test(gemeldet ?? "")) ausgabe.melde("pin_fristende", { commit, gemeldet });
  else ausgabe.melde("pin_fristende_ohne_stand", { commit });
}

function authProbieren({ probeAuth, url, commit, ausgabe, uhr, pinTakte }) {
  return wiederholenBisFrist({ uhr, ...pinTakte }, async ({ letzter }) => {
    const beobachter = pinBeobachter(ausgabe);
    const exit = await probeAuth({ url, commit, ausgabe: beobachter.ausgabe });
    if (beobachter.verletzt) pinWartetMelden({ ausgabe, commit, letzter });
    return { fertig: !beobachter.verletzt, exit };
  });
}

function stagingStandLesen({ hermes, einstellungen, commit, ausgabe, uhr, pinTakte }) {
  return wiederholenBisFrist({ uhr, ...pinTakte }, async ({ letzter }) => {
    const stand = await hermes.betriebsstatus(einstellungen.statusToken);
    const wartet = stand.gesund && stand.commit !== commit;
    if (wartet) pinWartetMelden({ ausgabe, commit, gemeldet: stand.commit, letzter });
    return { fertig: !wartet, stand };
  });
}

async function standProbieren({ hermes, einstellungen, commit, ausgabe, basis, uhr, pinTakte }) {
  const nachher = await abgewieseneJeInstanz(hermes);
  const { stand } = await stagingStandLesen({ hermes, einstellungen, commit, ausgabe, uhr, pinTakte });
  const { status, gesund, commit: gemeldet, telnyxSchluessel } = stand;
  const ok = gesund && gemeldet === commit;
  ausgabe.melde("probe_stand", { http: status, ok });
  ausgabe.melde("telnyx_schluessel", { http: status, ok: telnyxSchluessel });
  const eigene = webhookZiele(commit).length;
  const gezaehlt = { ...stand, webhooksAbgewiesen: zuwachsGleicherInstanzen(basis, nachher) };
  return fruehwarnungOk({ stand: gezaehlt, basis: 0, eigene, ausgabe }) && ok && telnyxSchluessel;
}

export async function staging({
  einstellungen,
  commit,
  ausgabe,
  uhr = ECHTE_UHR,
  takte = STAGING_TAKTE,
  pinTakte = STAGING_PIN_TAKTE,
  probeAuth = probeAuthStarten,
}) {
  if (!(await stagingAbwarten({ einstellungen, commit, ausgabe, uhr, takte }))) return false;
  const { exit } = await authProbieren({ probeAuth, url: einstellungen.stagingUrl, commit, ausgabe, uhr, pinTakte });
  ausgabe.melde("probe_auth", { exit });
  const http = await hermesZugang(einstellungen.stagingUrl).mcpOhneAnmeldung();
  ausgabe.melde("mcp_ohne_anmeldung", { http });
  const hermes = hermesZugang(einstellungen.stagingUrl);
  const basis = await abgewieseneJeInstanz(hermes);
  const webhooks = await webhooksProbieren({ hermes, commit, ausgabe, uhr });
  const stand = await standProbieren({ hermes, einstellungen, commit, ausgabe, basis, uhr, pinTakte });
  if (absichtlichRotMelden({ einstellungen, ausgabe })) return false;
  return exit === EXIT_OK && http === HTTP_NICHT_ANGEMELDET && webhooks && stand;
}
