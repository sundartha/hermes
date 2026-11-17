import assert from "node:assert/strict";

const SCHALTER = ["ELEVENLABS_OUTBOUND_ENABLED", "ELEVENLABS_OUTBOUND_UEBER_TELNYX", "ELEVENLABS_OUTBOUND_VORSPANN"];
const SIGNATUR = ["SKIP_TWILIO_SIGNATURE_CHECK", "TELNYX_PUBLIC_KEY", "PUBLIC_URL"];
const EIGENE_WEGE = ["ELEVENLABS_API_BASE", "TELNYX_API_BASE", "FAKE_ORIGINATE_ELEVENLABS"];
const KENNUNG = "fahrzeug";
const AUDIO_TYP = "audio/mpeg";

export function vorspannDiAttrappe() {
  const gewaehlt = [];
  return {
    erzeugeVorspann: async () => ({ text: "Vorspann-Attrappe", audio: { bytes: Buffer.alloc(1, 1), contentType: AUDIO_TYP } }),
    vorspannAblauf: {
      pruefe: async () => ({ grund: null }),
      waehle: async ({ call }) => {
        gewaehlt.push(call.id);
        return { callControlId: `cc_callee_${call.id}` };
      },
      behandle: async () => {},
      gesagterText: () => undefined,
    },
    beschaffeAbsender: async () => ({}),
    gewaehlt,
  };
}

export function vorspannSeedNummer({
  tenantId,
  nummer,
  id = `num_${tenantId}`,
  registrierung = `phnum_${tenantId}`,
  anbieter = "telnyx",
}) {
  return {
    id,
    e164: nummer,
    tenantId,
    provider: anbieter,
    status: "active",
    providerNumberId: null,
    providerAgentPhoneNumberId: registrierung,
  };
}

const schaltetVorspannEin = (env) => env.ELEVENLABS_OUTBOUND_VORSPANN === "true";
const hatEigenenWeg = (env) => EIGENE_WEGE.some((schluessel) => schluessel in env);

export async function vorspannFuerStart(env) {
  if (!schaltetVorspannEin(env) || hatEigenenWeg(env)) return { env, close: async () => {} };
  const { starteAttrappe, vorspannUmgebung, makeTelnyxSigner } = await import("../anrufe/el-bein-attrappe.js");
  const attrappe = await starteAttrappe();
  const vollstaendig = vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "", kennung: KENNUNG });
  const ausgenommen = new Set([...SCHALTER, ...SIGNATUR]);
  const ergaenzung = Object.fromEntries(Object.entries(vollstaendig).filter(([schluessel]) => !ausgenommen.has(schluessel)));
  return { env: { ...ergaenzung, ...env }, attrappe, close: () => attrappe.close() };
}

const INIT_PFAD = "/webhooks/elevenlabs/init";
const INIT_TOKEN_KOPF = "x-hermes-init-token";
const HTTP_OK = 200;
let ereignisZaehler = 0;

const ANNAHME_WARTEZEIT_MS = 60_000;

export async function initInhaltFuer(srv, { callId, agentId = `agent_${KENNUNG}`, signal = AbortSignal.timeout(ANNAHME_WARTEZEIT_MS) }) {
  const { EL_INBOUND_ACCESS_BOOT_ENV } = await import("../helpers.js");
  const { calleeVon } = await import("../anrufe/el-bein-attrappe.js");
  const { initBindungsKoerper } = await import("../_iel-inbound-harness.js");
  const { abrufMitFrist } = await import("./antwortfrist.mjs");
  const anruf = () => srv.readStore().calls.find((eintrag) => eintrag.id === callId);
  const ereignis = { data: { id: `evt-fahrzeug-${(ereignisZaehler += 1)}`, event_type: "call.answered", payload: { call_control_id: calleeVon(callId) } } };
  const angenommen = await abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ereignis),
  });
  assert.equal(angenommen.status, HTTP_OK);
  while (!anruf()?.answeredAt) {
    signal.throwIfAborted();
    assert.ok(!anruf() || anruf().status === "active", `Anruf ${callId} wurde vor dem Abheben beendet (${anruf()?.failureReason})`);
    await new Promise(setImmediate);
  }
  const { streamToken, from } = anruf();
  const koerper = { ...initBindungsKoerper({ bindung: streamToken, agentId, conversationId: `conv_${callId}` }), called_number: from };
  const antwort = await abrufMitFrist(`${srv.localUrl}${INIT_PFAD}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_KOPF]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN },
    body: JSON.stringify(koerper),
  });
  const text = await antwort.text();
  assert.equal(antwort.status, HTTP_OK, text);
  return JSON.parse(text);
}

export const vorspannMandantenUmgebung = (tenantIds) => ({
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: tenantIds.join(","),
});

const SIP_LAENGE = 32;

export const vorspannKonfig = (tenantIds, ausgehend = {}) => ({
  elevenLabsOutbound: { ...ausgehend, ueberTelnyx: true, vorspann: true },
  elevenLabsInbound: {
    scope: "allowlist",
    tenantIds,
    sipUser: "fahrzeug-sip",
    sipPassword: "p".repeat(SIP_LAENGE),
    initWebhookToken: "t".repeat(SIP_LAENGE),
  },
  telnyxCallControlAppId: "cc-app-fahrzeug",
});

export async function beinLegtAuf(srv, callId, { vomElBein = false } = {}) {
  const { calleeVon, elVon } = await import("../anrufe/el-bein-attrappe.js");
  const { abrufMitFrist } = await import("./antwortfrist.mjs");
  const ereignis = { data: { id: `evt-aufgelegt-${(ereignisZaehler += 1)}`, event_type: "call.hangup", payload: { call_control_id: (vomElBein ? elVon : calleeVon)(callId) } } };
  const antwort = await abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ereignis),
  });
  assert.equal(antwort.status, HTTP_OK);
}

const TTS_PFAD = "/v1/text-to-speech/";
const AUDIO_BYTES = 200_000;
const ABGELEHNT_KOERPER = JSON.stringify({ errors: [{ code: "10000", title: "abgelehnt" }] });

export async function starteAblehnendeAttrappe(status, kennung, tenantIds) {
  const { makeTelnyxSigner, vorspannUmgebung } = await import("../anrufe/el-bein-attrappe.js");
  const { starteAttrappe } = await import("../anrufe/attrappen-server.js");
  const attrappe = await starteAttrappe((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      const istTts = anfrage.url.startsWith(TTS_PFAD);
      antwort.writeHead(istTts ? HTTP_OK : status, { "content-type": istTts ? AUDIO_TYP : "application/json" });
      antwort.end(istTts ? Buffer.alloc(AUDIO_BYTES, 1) : ABGELEHNT_KOERPER);
    });
  });
  const env = {
    ...vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung }),
    ...vorspannMandantenUmgebung(tenantIds),
  };
  return { env, close: attrappe.close };
}

async function starteVorspannAnbieter(behandeln, kennung, tenantIds) {
  const { makeTelnyxSigner, vorspannUmgebung } = await import("../anrufe/el-bein-attrappe.js");
  const { starteAttrappe } = await import("../anrufe/attrappen-server.js");
  const attrappe = await starteAttrappe(behandeln);
  const env = {
    ...vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung }),
    ...vorspannMandantenUmgebung(tenantIds),
  };
  return { env, close: attrappe.close };
}

export const starteAbbrechendeAttrappe = (kennung, tenantIds) =>
  starteVorspannAnbieter((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      if (!anfrage.url.startsWith(TTS_PFAD)) return antwort.destroy();
      antwort.writeHead(HTTP_OK, { "content-type": AUDIO_TYP });
      antwort.end(Buffer.alloc(AUDIO_BYTES, 1));
    });
  }, kennung, tenantIds);

export async function starteErfolgreicheAttrappe(kennung, tenantIds) {
  const { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } = await import("../anrufe/el-bein-attrappe.js");
  const attrappe = await starteAttrappe();
  const env = {
    ...vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung }),
    ...vorspannMandantenUmgebung(tenantIds),
  };
  return { env, attrappe, close: attrappe.close };
}

export async function starteSchaltbarenAnbieter(behandeln, kennung, tenantIds) {
  const { makeTelnyxSigner, vorspannUmgebung } = await import("../anrufe/el-bein-attrappe.js");
  const { starteAttrappe } = await import("../anrufe/attrappen-server.js");
  const attrappe = await starteAttrappe(behandeln);
  const vollstaendig = vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "", kennung });
  const ausgenommen = new Set(SIGNATUR);
  const ohneSignatur = Object.fromEntries(Object.entries(vollstaendig).filter(([schluessel]) => !ausgenommen.has(schluessel)));
  return { env: { ...ohneSignatur, ...vorspannMandantenUmgebung(tenantIds) }, close: attrappe.close };
}
