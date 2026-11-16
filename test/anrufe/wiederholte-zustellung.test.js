import assert from "node:assert/strict";
import { test } from "node:test";
import {
  startServer,
  seedState,
  seedCall,
  makeTelnyxSigner,
  nowSeconds,
} from "../helpers.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import {
  TURN_LOOP_BY_COST_PROFILE,
  legRunsOurTurnLoop,
} from "../../src/telephony/leg-turn-loop.ts";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const ANRUF_DATENSAETZE_ERWARTET = 1;

function deliverIncoming(srv, signer, callSid) {
  const zeitstempel = String(nowSeconds());
  const rumpf = new URLSearchParams({
    CallSid: callSid,
    From: "+4915112345678",
    To: "+15005550006",
  }).toString();
  return abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    body: rumpf,
    headers: {
      "telnyx-timestamp": zeitstempel,
      "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
}

async function pruefeBudgetBein(srv, signer) {
  const res = await deliverIncoming(srv, signer, "CAie4budget");
  const xml = await res.text();
  assert.equal(res.status, HTTP_OK);
  assert.match(res.headers.get("content-type"), /^text\/xml/);

  assert.equal(xml, `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  assert.doesNotMatch(xml, /<Gather|<Redirect|voice\/turn/);
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
  assert.equal(xml, `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  assert.doesNotMatch(xml, /<Gather|<Redirect|voice\/turn/);
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
  assert.equal(TURN_LOOP_BY_COST_PROFILE[KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI], false);
});

test("IE4-2: legRunsOurTurnLoop - Raender liefern true und werfen nie (fail-safe = Bestandsantwort)", () => {
  assert.equal(legRunsOurTurnLoop({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }), true);
  assert.equal(legRunsOurTurnLoop({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI }), false);

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
          costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
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
    await ctx.test(
      "IE4-3: Budget-Bein - leeres Dokument, kein Gather und kein Redirect",
      () => pruefeBudgetBein(srv, signer),
    );
    await ctx.test(
      "IE4-4: uebergebenes Bein - leeres, aber gueltiges Dokument, kein Fehlerstatus",
      () => pruefeUebergebenesBein(srv, signer),
    );
    await ctx.test("IE4-5: unbelegtes Kostenprofil - leeres Dokument, kein Wurf", () =>
      pruefeUnbelegtesProfil(srv, signer),
    );
  } finally {
    await srv.stop();
  }
});
