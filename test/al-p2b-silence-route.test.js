// AL-P2b (WEGWERF, nie nach master): die Wegwerf-Route "/voice/spike-silence" (nimmt ab
// und schweigt). Gepinnt wird NICHT nur das TeXML, sondern vor allem die MOUNT-POSITION:
// die Route liegt HINTER der /voice-Signatur-Middleware und HINTER der bestehenden
// /voice-Basic-Auth-Exemption. Wird sie im Router-Stapel vorgezogen, antwortet sie
// unsigniert und oeffentlich - genau das faengt AL-P2b-3 (Muster
// test/voice-signature-403-log.test.js).
//
// Testnamen beginnen mit "AL-P2b-" - "AL-" ist NICHT im i18nCatalogPattern, die Tests
// landen also korrekt im Regressionslauf (npm test), nicht im Gates-Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "./helpers.js";

const SPIKE_PATH = "/voice/spike-silence";
const SPIKE_CALLEE = "+15550000001"; // Wegwerf-Zielnummer fuer diesen Test
const FOREIGN_CALLEE = "+15550000009"; // jede andere Zielnummer -> 404
const BOGUS_TELNYX_SIG = "bogus-telnyx-ed25519-signature";
// MAX_CALL_DURATION_S steht in helpers.BASE_ENV auf 180 -> die Stille dauert exakt so
// lange, wie ein Anruf ueberhaupt dauern darf (kein zweiter Knopf, G35).
const SILENCE_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="180"/><Hangup/></Response>';

const postTo = (srv, to, headers = {}) =>
  fetch(`${srv.localUrl}${SPIKE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ To: to }).toString(),
  });

test("AL-P2b-1: ohne TELNYX_SSE_SPIKE_CALLEE ist die Route inaktiv (404)", async () => {
  const srv = await startServer({ env: { TELNYX_SSE_SPIKE_CALLEE: "" } });
  try {
    const res = await postTo(srv, SPIKE_CALLEE);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "");
  } finally {
    await srv.stop();
  }
});

test("AL-P2b-2: gesetzte Wegwerf-Nummer -> abnehmen und schweigen", async () => {
  const srv = await startServer({ env: { TELNYX_SSE_SPIKE_CALLEE: SPIKE_CALLEE } });
  try {
    const res = await postTo(srv, SPIKE_CALLEE);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/xml/);
    assert.equal(await res.text(), SILENCE_XML);
  } finally {
    await srv.stop();
  }
});

test("AL-P2b-3: die Route liegt HINTER der /voice-Signaturpruefung (keine neue Auth-Ausnahme)", async () => {
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_SSE_SPIKE_CALLEE: SPIKE_CALLEE },
  });
  try {
    const res = await postTo(srv, SPIKE_CALLEE, {
      "telnyx-signature-ed25519": BOGUS_TELNYX_SIG,
      "telnyx-timestamp": "1720700000",
    });
    assert.equal(res.status, 403, "ungueltige Signatur muss VOR dem Handler 403en");
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/spike-silence/);
    assert.ok(
      !srv.stdout.includes("[spike-silence]"),
      `der Handler darf bei 403 gar nicht laufen:\n${srv.stdout}`,
    );
  } finally {
    await srv.stop();
  }
});

test("AL-P2b-4: keine Basic-Auth vor der Route (Telnyx sendet keine Credentials)", async () => {
  const srv = await startServer({
    env: { DASHBOARD_PASSWORD: "geheim", TELNYX_SSE_SPIKE_CALLEE: SPIKE_CALLEE },
  });
  try {
    const res = await postTo(srv, SPIKE_CALLEE);
    assert.equal(res.status, 200, "die /voice-Exemption muss greifen, sonst 401");
    assert.equal(await res.text(), SILENCE_XML);
  } finally {
    await srv.stop();
  }
});

// Die Zeile traegt bewusst To + Sollnummer (Spec AL-P2b: die Rufnummern duerfen im
// Klartext stehen, es sind unsere eigenen Wegwerf-DIDs) - ohne sie endete ein
// fehlgeleiteter Testanruf stumm und unerklaerlich. Genau EINE Zeile, kein Log-Sturm.
test("AL-P2b-5: fremdes To -> 404 + genau eine Diagnosezeile", async () => {
  const srv = await startServer({ env: { TELNYX_SSE_SPIKE_CALLEE: SPIKE_CALLEE } });
  try {
    const res = await postTo(srv, FOREIGN_CALLEE);
    assert.equal(res.status, 404);
    const lines = srv.stdout.split("\n").filter((l) => l.includes("[spike-silence]"));
    assert.equal(lines.length, 1, `genau eine Diagnosezeile erwartet:\n${srv.stdout}`);
    assert.match(lines[0], /to=\+15550000009/);
    assert.match(lines[0], /erwartet=\+15550000001/);
  } finally {
    await srv.stop();
  }
});
