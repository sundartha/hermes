import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBrevoMailer, verifyBrevoAccount } from "../../src/brevo-mail.js";
import { makeWorkosManagement } from "../../src/workos-management.js";
import { probeMailBoot } from "../../src/mail-boot-probe.js";
import { makeElSipRegistrar, makeInboundTrunkSchreiber } from "../../src/elevenlabs/nummern-registrierung.js";
import { makeDirectiveSynth } from "../../src/tts/directive-synth.js";
import { makeElConfigRead } from "../../src/telephony/outbound-config-soll.js";
import { REQUEST_TIMEOUT_MS } from "../../src/elevenlabs/convai.js";
import { EL_ABORT_PROVIDER_TIMEOUT_MS, makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import { terminateAndBillCall } from "../../src/telephony/call-termination.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { withFetch } from "../helpers.js";
import { mitKurzerFrist } from "./kurze-antwortfrist.mjs";

const EL = { apiKey: "el-key", apiBase: "https://el.test", agentId: "agent_1" };
const SYNTH_GESAMTFRIST_MS = 7777;

function antwort() {
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
}

async function ausgehend(aufruf) {
  const gesehen = [];
  const fristen = await mitKurzerFrist(() =>
    withFetch(
      async (url, init) => {
        gesehen.push({ url, hatSignal: init?.signal instanceof AbortSignal, fristMs: init?.fristMs });
        return antwort();
      },
      async () => {
        try {
          await aufruf();
        } catch (fehler) {
          assert.notEqual(fehler?.name, "TypeError");
        }
      },
    ),
  );
  return { gesehen, fristen };
}

function mailKonfiguration() {
  return withConfigNamespaces({ brevoApiKey: "k", mailFrom: "a@b.test" });
}

function workosKonfiguration() {
  return withConfigNamespaces({ workosApiBase: "https://workos.test", workosManagementApiKey: "w" });
}

async function pruefeNaht({ aufruf, fristen: erwartet }) {
  const { gesehen, fristen } = await ausgehend(aufruf);
  assert.equal(gesehen.length, erwartet.length);
  assert.deepEqual([...new Set(fristen)].sort(), [...new Set(erwartet)].sort());
  assert.ok(fristen.length >= erwartet.length);
  assert.ok(gesehen.every((eintrag) => eintrag.hatSignal && eintrag.fristMs === undefined));
}

const NAEHTE = [
  {
    name: "Brevo-Mail",
    aufruf: () => makeBrevoMailer(mailKonfiguration()).sendMail({ to: "x@y.test", subject: "s", text: "t" }),
    fristen: [10_000],
  },
  { name: "Brevo-Kontoprüfung", aufruf: () => verifyBrevoAccount(mailKonfiguration()), fristen: [5_000] },
  { name: "Mail-Startprobe", aufruf: () => probeMailBoot(mailKonfiguration(), { log() {}, logError() {} }), fristen: [5_000] },
  { name: "WorkOS Nutzer löschen", aufruf: () => makeWorkosManagement(workosKonfiguration()).deleteUser("u1"), fristen: [15_000] },
  { name: "WorkOS Nutzer prüfen", aufruf: () => makeWorkosManagement(workosKonfiguration()).userExists("u1"), fristen: [10_000] },
  {
    name: "ElevenLabs-Nummer löschen",
    aufruf: () => makeElSipRegistrar({ el: EL, sipUser: "u", sipPasswort: "p" }).removeRegistration("pn_1"),
    fristen: [REQUEST_TIMEOUT_MS],
  },
  {
    name: "ElevenLabs-Trunk schreiben",
    aufruf: () =>
      makeInboundTrunkSchreiber({ el: EL, zugang: { sipUser: "u", sipPassword: "p" } }).ensureInboundTrunk({
        id: "n1",
        e164: "+4930123456",
        providerAgentPhoneNumberId: "pn_1",
      }),
    fristen: [REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS],
  },
  {
    name: "Soll-Abruf der ElevenLabs-Nummer",
    aufruf: () => makeElConfigRead(withConfigNamespaces({ elevenLabsOutbound: EL })).fetchPhoneNumber("pn_1"),
    fristen: [REQUEST_TIMEOUT_MS],
  },
  {
    name: "Sprachsynthese",
    aufruf: () =>
      makeDirectiveSynth({
        config: withConfigNamespaces({
          elevenLabsPlayTts: {
            apiKey: "k",
            voiceId: "v",
            model: "m",
            apiBase: "https://el.test",
            outputFormat: "mp3_44100_128",
            synthTimeoutMs: 100,
            synthTotalTimeoutMs: SYNTH_GESAMTFRIST_MS,
          },
        }),
        ttsStore: {},
        store: { platformTtsUsageView: () => ({ characters: 0, quota: 1_000_000 }), recordTtsCharacters: () => null },
        onQuotaWarning: () => {},
      }).synthesizeVorspann("Hallo", "voice_1"),
    fristen: [SYNTH_GESAMTFRIST_MS],
  },
];

for (const naht of NAEHTE) {
  test(`${naht.name}: ohne eingereichtes fetch geht die Anfrage mit Frist hinaus`, () => pruefeNaht(naht));
}

test("ElevenLabs-Abbruch: je Anfrage genau eine Frist, das Signal kommt aus anfrage", async () => {
  const call = { id: "call_naht", elevenlabsConversationId: "conv_1", endedAt: "2026-08-15T10:00:00.000Z" };
  const store = new Proxy({ getCall: () => call }, { get: (ziel, name) => ziel[name] ?? (() => {}) });
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: EL }),
    terminateAndBillCall,
    billThunk: () => () => {},
    finishCall: () => {},
  });
  const gesehen = [];
  const fristen = await mitKurzerFrist(() =>
    withFetch(
      async (url, init) => {
        gesehen.push({ hatSignal: init?.signal instanceof AbortSignal, fristMs: init?.fristMs });
        return antwort();
      },
      () => el.endActiveCall(call.id),
    ),
  );
  assert.ok(gesehen.length >= 1);
  assert.deepEqual(fristen, gesehen.map(() => EL_ABORT_PROVIDER_TIMEOUT_MS));
  assert.ok(gesehen.every((eintrag) => eintrag.hatSignal && eintrag.fristMs === undefined));
});
