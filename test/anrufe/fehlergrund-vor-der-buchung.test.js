import assert from "node:assert/strict";
import { test } from "node:test";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { starteAufzeichnendeAttrappe } from "../helpers/aufzeichnende-attrappe.js";
import {
  CONVERSATION_FAILED_UNVERIFIED_ORIGINATION,
  ERROR_ENVELOPES,
} from "../fixtures/elevenlabs-conversations.js";

const HTTP_OK = 200;
const WARTEZEIT_MS = 8000;
const SCHNELLER_ABRUF_MS = "100";
const LANGE_HOECHSTDAUER_S = 3600;
const GRUNDLOSER_BESTANDSTEXT = /\(Status: failed\)$/;

const anrufIm = (stand, id) => stand.calls.find((anruf) => anruf.id === id);
const benachrichtigungIm = (stand, id) =>
  (stand.notifications ?? []).find((eintrag) => eintrag.callId === id);

async function beendeterAnrufMitBenachrichtigung(srv, id) {
  const stand = await waitForStoreState(srv, (st) => benachrichtigungIm(st, id), WARTEZEIT_MS);
  return { anruf: anrufIm(stand, id), benachrichtigung: benachrichtigungIm(stand, id) };
}

function grundStandSchonInDerBenachrichtigung({ anruf, benachrichtigung }, erwarteterGrund) {
  assert.equal(anruf.status, "failed");
  assert.equal(anruf.failureReason, erwarteterGrund);
  assert.ok(
    !GRUNDLOSER_BESTANDSTEXT.test(benachrichtigung.body),
    `die Benachrichtigung entstand ohne den Grund: ${benachrichtigung.body}`,
  );
}

const aktiverElAnruf = (id) => {
  const jetzt = new Date().toISOString();
  return seedCall({
    id,
    provider: "telnyx",
    status: "active",
    answeredAt: jetzt,
    startedAt: jetzt,
    maxDurationS: LANGE_HOECHSTDAUER_S,
    elevenlabsConversationId: CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.conversation_id,
  });
};

async function mitElevenLabsAttrappe(antwort, id, ablauf) {
  const attrappe = await starteAufzeichnendeAttrappe(antwort);
  const srv = await startServer({
    env: {
      ELEVENLABS_API_BASE: attrappe.url,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: SCHNELLER_ABRUF_MS,
    },
    seed: seedState({ calls: [aktiverElAnruf(id)] }),
  });
  try {
    await ablauf(srv);
  } finally {
    await srv.stop();
    await attrappe.schliesse();
  }
}

test("/voice/status mit failed: der Grund steht am Anruf, bevor Ende und Buchung die Benachrichtigung bauen", async () => {
  const srv = await startServer({
    seed: seedState({ calls: [seedCall({ id: "status_failed", provider: "telnyx" })] }),
  });
  try {
    const antwort = await fetch(`${srv.localUrl}/voice/status?callId=status_failed`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "failed", SipHangupCause: "603" }),
    });
    assert.equal(antwort.status, HTTP_OK);
    grundStandSchonInDerBenachrichtigung(
      await beendeterAnrufMitBenachrichtigung(srv, "status_failed"),
      "unreachable:invite-603",
    );
  } finally {
    await srv.stop();
  }
});

test("ElevenLabs-Ergebnis mit Anbieterfehler: der Grund steht am Anruf, bevor Ende und Buchung die Benachrichtigung bauen", async () => {
  const antwort = () => ({ status: HTTP_OK, koerper: CONVERSATION_FAILED_UNVERIFIED_ORIGINATION });
  await mitElevenLabsAttrappe(antwort, "el_anbieterfehler", async (srv) => {
    grundStandSchonInDerBenachrichtigung(
      await beendeterAnrufMitBenachrichtigung(srv, "el_anbieterfehler"),
      "not-placed:invite-403-D51",
    );
  });
});

test("ElevenLabs-Abruf dauerhaft ohne Ergebnis: der Grund steht am Anruf, bevor Ende und Buchung die Benachrichtigung bauen", async () => {
  const antwort = () => ({
    status: ERROR_ENVELOPES.notFound.httpStatus,
    koerper: ERROR_ENVELOPES.notFound.body,
  });
  await mitElevenLabsAttrappe(antwort, "el_ohne_ergebnis", async (srv) => {
    grundStandSchonInDerBenachrichtigung(
      await beendeterAnrufMitBenachrichtigung(srv, "el_ohne_ergebnis"),
      "result-unknown:poll-provider-404",
    );
  });
});
