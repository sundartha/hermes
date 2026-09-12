// IE4 (PLAN-INBOUND-PARITAET.md): die Ersatzantwort des Wiederholungs-Riegels wird
// PFADGERECHT - Budget-Bein unveraendert Folge-Gather, uebergebenes Bein ein leeres,
// aber gueltiges Dokument (repeatDeliveryXml in src/routes/voice.js). Praefix "IE4-" ist
// KEINE Katalog-ID (weder i18nCatalogPattern noch abnahmePattern matchen) - die Faelle
// landen im normalen npm-test-Regressionslauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, makeTelnyxSigner, nowSeconds, BASE_ENV } from "./helpers.js";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { TURN_LOOP_BY_COST_PROFILE, legRunsOurTurnLoop } from "../src/telephony/leg-turn-loop.js";

const HTTP_OK = 200;
// EIN Gather- und EIN Redirect-Vorkommen tragen die Turn-Marke (G25: benannt statt 2).
const GATHER_UND_REDIRECT_VORKOMMEN = 2;
const ANRUF_DATENSAETZE_ERWARTET = 1;

// EIN signierter Umschlag: derselbe Body-String, derselbe Zeitstempel, dieselbe Signatur -
// beliebig oft zustellbar. Genau das tut ein Anbieter-Retry (Muster sec-p1-webhook-
// idempotenz.test.js).
function sealedEnvelope(signer, fields) {
  const body = new URLSearchParams(fields).toString();
  const ts = String(nowSeconds());
  return {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(ts, body),
      "telnyx-timestamp": ts,
    },
  };
}

function deliver(srv, url, envelope) {
  return fetch(`${srv.localUrl}${url}`, {
    method: "POST",
    headers: envelope.headers,
    body: envelope.body,
  });
}

// EIN /voice/incoming je Anruf-Datensatz - der Datensatz existiert schon (seedCall), also
// greift der store-basierte Idempotenz-Zweig direkt (Muster SEC-P1-9).
function deliverIncoming(srv, signer, callSid) {
  const envelope = sealedEnvelope(signer, {
    CallSid: callSid,
    From: "+4915112345678",
    To: "+15005550006",
  });
  return deliver(srv, "/voice/incoming", envelope);
}

async function pruefeBudgetBein(srv, signer) {
  const res = await deliverIncoming(srv, signer, "CAie4budget");
  const xml = await res.text();
  assert.equal(res.status, HTTP_OK);
  assert.match(res.headers.get("content-type"), /^text\/xml/);

  const tokens = [...xml.matchAll(/turnToken=([0-9a-f]{16})/g)].map((match) => match[1]);
  assert.equal(
    tokens.length,
    GATHER_UND_REDIRECT_VORKOMMEN,
    "genau ein Gather- und ein Redirect-Vorkommen",
  );
  assert.equal(new Set(tokens).size, 1, "beide Vorkommen tragen dieselbe Marke");

  const normalized = xml.replace(/turnToken=[0-9a-f]{16}/g, "turnToken=<token>");
  const expected =
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" ` +
    `model="deepgram/nova-3" speechTimeout="${BASE_ENV.STT_SPEECH_TIMEOUT_SEC}" ` +
    `action="${BASE_ENV.PUBLIC_URL}/voice/turn?callId=call_ie4_budget&amp;turnToken=<token>" ` +
    `method="POST"/>` +
    `<Redirect method="POST">${BASE_ENV.PUBLIC_URL}/voice/turn?callId=call_ie4_budget&amp;turnToken=<token></Redirect>` +
    `</Response>`;
  assert.equal(normalized, expected);
}

async function pruefeUebergebenesBein(srv, signer) {
  const res = await deliverIncoming(srv, signer, "CAie4uebergeben");
  const xml = await res.text();
  assert.equal(res.status, HTTP_OK, "kein Fehlerstatus fuer ein uebergebenes Bein");
  assert.match(res.headers.get("content-type"), /^text\/xml/);
  assert.equal(xml, `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  assert.doesNotMatch(xml, /<Gather|<Say|<Play|<Hangup/);

  const calls = srv.readStore().calls;
  assert.equal(
    calls.filter((call) => call.id === "call_ie4_uebergeben").length,
    ANRUF_DATENSAETZE_ERWARTET,
    "kein zweiter Anruf-Datensatz - wir fielen nicht durch den Handler",
  );
  assert.equal(calls.find((call) => call.id === "call_ie4_uebergeben").transcript.length, 0);
}

async function pruefeUnbelegtesProfil(srv, signer) {
  const res = await deliverIncoming(srv, signer, "CAie4unbelegt");
  const xml = await res.text();
  assert.equal(res.status, HTTP_OK);
  assert.match(xml, /<Gather/, "unbelegter Zustand -> unveraenderte Bestandsantwort, kein Wurf");
  assert.match(xml, /callId=call_ie4_unbelegt/);
}

test("IE4-1: Inventar - jedes bekannte Kostenprofil traegt eine ausdrueckliche Entscheidung", () => {
  assert.deepEqual(
    Object.keys(TURN_LOOP_BY_COST_PROFILE).sort(),
    Object.values(KOSTENPROFIL).sort(),
    "jedes bekannte Kostenprofil braucht eine ausdrueckliche Entscheidung - ein NEUES Profil ohne Eintrag faellt hier",
  );
  assert.equal(TURN_LOOP_BY_COST_PROFILE[KOSTENPROFIL.TELNYX_BUDGET], true);
  assert.equal(TURN_LOOP_BY_COST_PROFILE[KOSTENPROFIL.TELNYX_INBOUND_BUDGET], true);
  assert.equal(TURN_LOOP_BY_COST_PROFILE[KOSTENPROFIL.EL_CONVAI_SIP], false);
  assert.equal(TURN_LOOP_BY_COST_PROFILE[KOSTENPROFIL.TELNYX_ASSISTANT], false);
  assert.equal(TURN_LOOP_BY_COST_PROFILE[KOSTENPROFIL.TELNYX_INBOUND_REALTIME], false);
  assert.equal(TURN_LOOP_BY_COST_PROFILE[KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI], false);
});

test("IE4-2: legRunsOurTurnLoop - Raender liefern true und werfen nie (fail-safe = Bestandsantwort)", () => {
  // Positiv-Kontrolle zuerst, sonst sieht "liefert nicht false" wie eine Funktion aus,
  // die nichts liefert (T5).
  assert.equal(legRunsOurTurnLoop({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }), true);
  assert.equal(legRunsOurTurnLoop({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_REALTIME }), false);

  for (const call of [
    { costProfile: null },
    {},
    undefined,
    { costProfile: "unbekanntes_profil" },
    { costProfile: "constructor" },
  ]) {
    assert.doesNotThrow(() => legRunsOurTurnLoop(call));
    assert.equal(legRunsOurTurnLoop(call), true, `fail-safe fuer ${JSON.stringify(call)}`);
  }
});

test("IE4-3/4/5: Wiederholungs-Antwort auf /voice/incoming - pfadgerecht je Kostenprofil", async (ctx) => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
    seed: seedState({
      calls: [
        seedCall({
          id: "call_ie4_budget",
          twilioSid: "CAie4budget",
          provider: "telnyx",
          status: "active",
          language: "de",
          costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
        }),
        seedCall({
          id: "call_ie4_uebergeben",
          twilioSid: "CAie4uebergeben",
          provider: "telnyx",
          status: "active",
          language: "de",
          costProfile: KOSTENPROFIL.TELNYX_INBOUND_REALTIME,
        }),
        seedCall({
          id: "call_ie4_unbelegt",
          twilioSid: "CAie4unbelegt",
          provider: "telnyx",
          status: "active",
          language: "de",
        }),
      ],
    }),
  });
  try {
    await ctx.test("IE4-3: Budget-Bein - byte-identischer Folge-Gather, Attribut fuer Attribut", () =>
      pruefeBudgetBein(srv, signer),
    );
    await ctx.test("IE4-4: uebergebenes Bein - leeres, aber gueltiges Dokument, kein Fehlerstatus", () =>
      pruefeUebergebenesBein(srv, signer),
    );
    await ctx.test("IE4-5: unbelegtes Kostenprofil - fail-safe bleibt die Bestandsantwort", () =>
      pruefeUnbelegtesProfil(srv, signer),
    );
  } finally {
    await srv.stop();
  }
});
