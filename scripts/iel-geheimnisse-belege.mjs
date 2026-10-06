import {
  HERMES_RENDER_SERVICE_ID,
  ZIEL_URTEIL,
  initWebhookUrl,
  renderDienstZiel,
  zielUrteil,
} from "../src/elevenlabs/init-webhook-ziel.js";
import { fetchAgent } from "../src/elevenlabs/convai.js";
import { INIT_WEBHOOK_TOKEN_MIN_LENGTH } from "../src/elevenlabs/inbound-path-decision.js";
import { INIT_TOKEN_HEADER } from "../src/routes/webhooks-elevenlabs-init.js";
import { ELEVENLABS_VOICE_ID_BY_PROFILE } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";
import { synthesizeSpeechStream } from "../src/tts/synth.js";
import { exitVon, jaNein, meldeNachUrteil, urteilText } from "./iel-geheimnisse-ausgabe.mjs";
import { HTTP, RENDER_SCHLUESSEL, dienstLesbar, leseDienstEnv } from "./iel-geheimnisse-render.mjs";

const BELEG_INIT_ERWARTET = Object.freeze({ OHNE_TOKEN: 403, MIT_TOKEN: 404 });
const BELEG_INIT_TIMEOUT_MS = 15000;
const BELEG_INIT_KOERPER = "{}";
const STIMMEN_PROBE_TEXT = "Test.";
const PROBE_ERSTES_PAKET_MS = 5000;
const PROBE_GESAMT_MS = 10000;
const KEIN_HTTP_STATUS = 0;
const HTTP_GRUND_MUSTER = /^http_(\d+)$/;
const STIMMEN_SCHLUESSEL = Object.freeze([
  RENDER_SCHLUESSEL.TELNYX_VOICE,
  RENDER_SCHLUESSEL.PLAY_VOICE,
  RENDER_SCHLUESSEL.MODEL,
]);
const OHNE_WERT = "-";

export async function laufeBelegInit({ abh }) {
  return exitVon((await belegInit(abh)).gruen);
}

export async function laufeStimmenBeleg({ abh }) {
  return exitVon((await stimmenBeleg(abh)).gruen);
}

export async function belegInit(abh) {
  const { waechter } = abh;
  const urteil = zielUrteil(
    await renderDienstZiel({ fetchImpl: abh.fetchImpl, apiKey: abh.renderApiKey, serviceId: HERMES_RENDER_SERVICE_ID }),
  );
  const zielGruen = urteil.urteil === ZIEL_URTEIL.GRUEN;
  meldeNachUrteil(waechter, {
    gruen: zielGruen,
    zeile: `ZIEL-URTEIL ${urteilText(zielGruen)} - wirksamer Origin ${urteil.wirksamerOrigin ?? OHNE_WERT}, Ziel ${initWebhookUrl()}, grund=${urteil.grund ?? OHNE_WERT}, status=${urteil.status ?? OHNE_WERT}`,
  });
  if (!zielGruen) {
    waechter.fehler("BELEG-INIT ROT - Ziel-Urteil ROT: kein Token gelesen, nichts gesendet.");
    return { gruen: false };
  }
  const token = await leseDienstEnv(abh, RENDER_SCHLUESSEL.INIT_TOKEN);
  waechter.verbiete(token.wert);
  const laenge = token.wert?.length ?? 0;
  if (token.status !== HTTP.OK || laenge < INIT_WEBHOOK_TOKEN_MIN_LENGTH) {
    waechter.fehler(
      `BELEG-INIT ROT - Render ${RENDER_SCHLUESSEL.INIT_TOKEN}: Status ${token.status}, Laenge ${laenge} (mindestens ${INIT_WEBHOOK_TOKEN_MIN_LENGTH}); nichts gesendet.`,
    );
    return { gruen: false };
  }
  const ohneToken = await sendeInitProbe({ abh, token: null });
  const mitToken = await sendeInitProbe({ abh, token: token.wert });
  const gruen = belegInitUrteil({ ohneToken, mitToken });
  meldeNachUrteil(waechter, {
    gruen,
    zeile: `BELEG-INIT ${urteilText(gruen)} - ohne Token HTTP ${ohneToken} (erwartet ${BELEG_INIT_ERWARTET.OHNE_TOKEN}), mit Token HTTP ${mitToken} (erwartet ${BELEG_INIT_ERWARTET.MIT_TOKEN})`,
  });
  return { gruen };
}

async function sendeInitProbe({ abh, token }) {
  const headers = { "content-type": "application/json", ...(token ? { [INIT_TOKEN_HEADER]: token } : {}) };
  try {
    const antwort = await abh.fetchImpl(initWebhookUrl(), {
      method: "POST",
      headers,
      body: BELEG_INIT_KOERPER,
      redirect: "manual",
      signal: AbortSignal.timeout(BELEG_INIT_TIMEOUT_MS),
    });
    return antwort.status;
  } catch {
    return KEIN_HTTP_STATUS;
  }
}

export function belegInitUrteil({ ohneToken, mitToken }) {
  return ohneToken === BELEG_INIT_ERWARTET.OHNE_TOKEN && mitToken === BELEG_INIT_ERWARTET.MIT_TOKEN;
}

export async function stimmenBeleg(abh) {
  const quellen = await leseStimmenQuellen(abh);
  if (quellen.fehler) {
    abh.waechter.fehler(`STIMMEN-BELEG ROT - ${quellen.fehler}`);
    return { gruen: false };
  }
  const profilProben = [];
  for (const voiceId of Object.values(ELEVENLABS_VOICE_ID_BY_PROFILE)) {
    profilProben.push({ voiceId, status: await probeSynthese({ abh, voiceId, model: quellen.agentModel }) });
  }
  const telnyxProbe = quellen.telnyxVoice
    ? await probeSynthese({ abh, voiceId: quellen.telnyxVoice, model: quellen.agentModel })
    : null;
  const urteil = stimmenUrteil({ profilProben, telnyxProbe, ...quellen });
  meldeStimmenBeleg({ waechter: abh.waechter, quellen, profilProben, telnyxProbe, urteil });
  return { gruen: urteil.gruen };
}

export function stimmenUrteil({ profilProben, telnyxVoice, telnyxProbe, agentVoice, playVoice }) {
  const profilGruen = profilProben.length > 0 && profilProben.every((probe) => probe.status === HTTP.OK);
  const defaultGruen = telnyxVoice ? telnyxProbe === HTTP.OK : Boolean(agentVoice) && agentVoice === playVoice;
  return { gruen: profilGruen && defaultGruen, profilGruen, defaultGruen };
}

async function leseStimmenQuellen(abh) {
  if (!(await dienstLesbar(abh))) return { fehler: "Render-Dienst nicht lesbar (Service-GET nicht 200)" };
  const render = await leseStimmenEnv(abh);
  if (render.fehler) return render;
  const agent = await fetchAgent({ fetchImpl: abh.fetchImpl, account: abh.elKonto, agentId: abh.elKonto.agentId });
  const tts = agent?.conversation_config?.tts ?? {};
  if (!tts.model_id) return { fehler: "Agent traegt kein tts.model_id" };
  return {
    telnyxVoice: render.werte[RENDER_SCHLUESSEL.TELNYX_VOICE],
    playVoice: render.werte[RENDER_SCHLUESSEL.PLAY_VOICE],
    renderModel: render.werte[RENDER_SCHLUESSEL.MODEL],
    agentVoice: tts.voice_id ?? "",
    agentModel: tts.model_id,
  };
}

async function leseStimmenEnv(abh) {
  const werte = {};
  for (const schluessel of STIMMEN_SCHLUESSEL) {
    const { status, wert } = await leseDienstEnv(abh, schluessel);
    if (status !== HTTP.OK && status !== HTTP.NICHT_GEFUNDEN) {
      return { fehler: `Render ${schluessel} nicht lesbar (Status ${status})` };
    }
    werte[schluessel] = (wert ?? "").trim();
  }
  return { werte };
}

async function probeSynthese({ abh, voiceId, model }) {
  const ergebnis = await synthesizeSpeechStream(STIMMEN_PROBE_TEXT, {
    fetchImpl: abh.fetchImpl,
    apiKey: abh.elKonto.apiKey,
    apiBase: abh.elKonto.apiBase,
    voiceId,
    model,
    outputFormat: abh.ttsAusgabeformat,
    firstChunkTimeoutMs: PROBE_ERSTES_PAKET_MS,
    totalTimeoutMs: PROBE_GESAMT_MS,
  });
  if (!ergebnis.ok) return statusAusGrund(ergebnis.reason);
  await ergebnis.audio;
  return HTTP.OK;
}

function statusAusGrund(grund) {
  const treffer = HTTP_GRUND_MUSTER.exec(grund ?? "");
  return treffer ? Number(treffer[1]) : KEIN_HTTP_STATUS;
}

function meldeStimmenBeleg({ waechter, quellen, profilProben, telnyxProbe, urteil }) {
  for (const probe of profilProben) {
    meldeNachUrteil(waechter, {
      gruen: probe.status === HTTP.OK,
      zeile: `STIMMEN (a) Profil-Stimme ${probe.voiceId}: Probe-Synthese Status ${probe.status}`,
    });
  }
  const zeileB = quellen.telnyxVoice
    ? `STIMMEN (b) ${RENDER_SCHLUESSEL.TELNYX_VOICE}=${quellen.telnyxVoice}: Probe-Synthese Status ${telnyxProbe}`
    : `STIMMEN (b) ${RENDER_SCHLUESSEL.TELNYX_VOICE} leer: Agent tts.voice_id=${quellen.agentVoice || OHNE_WERT}, ` +
      `${RENDER_SCHLUESSEL.PLAY_VOICE}=${quellen.playVoice || OHNE_WERT}, gleich ${jaNein(urteil.defaultGruen)}`;
  meldeNachUrteil(waechter, { gruen: urteil.defaultGruen, zeile: zeileB });
  waechter.info(
    `HINWEIS Modell (kein Blocker): Agent tts.model_id=${quellen.agentModel}, Render ${RENDER_SCHLUESSEL.MODEL}=${quellen.renderModel || OHNE_WERT}, ` +
      `gleich ${jaNein(quellen.agentModel === quellen.renderModel)}`,
  );
  meldeNachUrteil(waechter, { gruen: urteil.gruen, zeile: `STIMMEN-BELEG ${urteilText(urteil.gruen)}` });
}
