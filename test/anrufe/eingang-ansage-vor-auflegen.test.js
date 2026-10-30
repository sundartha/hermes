import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { FAKE_REST_CHUNK } from "../helpers/fake-tts-stream.mjs";
import { playTtsEnv, startSyntheseOrigin } from "../gemeinsam/play-tts-server.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_PEER_NUMBER,
  TELNYX_TEST_SIGNATURE_HEADERS,
  TELNYX_TEST_TENANT_NUMBER,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../../src/turn-budget.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const KURZE_GESAMTFRIST_MS = 1000;
const LANGE_GESAMTFRIST_MS = 30000;
const ANTWORT_RESERVE_MS = 3000;
const ANTWORT_OBERGRENZE_MS = KURZE_GESAMTFRIST_MS + ANTWORT_RESERVE_MS;
const TESTFRIST_LANG_MS = 25000;
const SPRACHMODELL_VERZOEGERUNG_MS = 2000;
const HTTP_BAD_REQUEST = 400;

const SYNTHESE_ENDE = Object.freeze({ HAENGT: "haengt", REISST_AB: "reisst_ab", VOLLSTAENDIG: "vollstaendig" });

const EL_ALLOWLIST_ENV = Object.freeze({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ELEVENLABS_INBOUND_SCOPE: "allowlist",
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});
const EL_REGISTRIERT_ENV = Object.freeze({ ...EL_ALLOWLIST_ENV, ELEVENLABS_INBOUND_SCOPE: "registrierte_dids" });

function beendeSynthese(ende) {
  return (res, req) => {
    if (ende === SYNTHESE_ENDE.VOLLSTAENDIG) res.end(Buffer.from(FAKE_REST_CHUNK));
    if (ende === SYNTHESE_ENDE.REISST_AB) setImmediate(() => req.socket.destroy());
  };
}

async function mitSynthese({ ende, env, gesamtfristMs = KURZE_GESAMTFRIST_MS }, lauf) {
  const origin = await startSyntheseOrigin(beendeSynthese(ende));
  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: { ...env, ...playTtsEnv(origin.url), ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS: String(gesamtfristMs) },
  });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
    await origin.close();
  }
}

async function startLangsamesSprachmodell(verzoegerungMs) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      AbortSignal.timeout(verzoegerungMs).addEventListener("abort", () => {
        res.writeHead(HTTP_BAD_REQUEST, { "content-type": "application/json" });
        res.end("{}");
      });
    });
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((fertig) => server.close(fertig)) };
}

function pruefeSayDannHangup(texml) {
  assert.ok(!texml.includes("<Play>"), `kein Play bei unvollstaendiger Synthese: ${texml}`);
  assert.match(texml, /<Say [^>]*>[^<]*technischer Fehler[^<]*<\/Say><Hangup\/><\/Response>$/);
}

async function incomingAntwort(srv, callSid, wartezeitMs) {
  const res = await abrufMitFrist(
    `${srv.localUrl}/voice/incoming`,
    {
      method: "POST",
      headers: TELNYX_TEST_SIGNATURE_HEADERS,
      body: new URLSearchParams({ From: TELNYX_TEST_PEER_NUMBER, To: TELNYX_TEST_TENANT_NUMBER, CallSid: callSid }),
    },
    { wartezeitMs },
  );
  assert.equal(res.status, HTTP_OK);
  return res.text();
}

test("Abweisung ohne Beleg: haengende oder abreissende Synthese -> Say und Hangup statt abgebrochenem Play", async () => {
  for (const ende of [SYNTHESE_ENDE.HAENGT, SYNTHESE_ENDE.REISST_AB]) {
    await mitSynthese({ ende, env: EL_REGISTRIERT_ENV }, async (srv) => {
      const beginn = Date.now();
      const texml = await incomingAntwort(srv, `CAvorauflegen${ende}`);
      assert.ok(Date.now() - beginn < ANTWORT_OBERGRENZE_MS, `${ende}: die Antwort kommt vor der Webhook-Frist`);
      pruefeSayDannHangup(texml);
    });
  }
});

test("Abweisung ohne Beleg: vollstaendige Synthese -> Play mit Hangup", async () => {
  await mitSynthese({ ende: SYNTHESE_ENDE.VOLLSTAENDIG, env: EL_REGISTRIERT_ENV }, async (srv) => {
    const texml = await incomingAntwort(srv, "CAvorauflegenvoll");
    assert.match(texml, /<Play>https:\/\/[^<]+\/voice\/tts\/[A-Za-z0-9_-]+<\/Play><Hangup\/><\/Response>$/);
  });
});

test("Rueckfall nach gescheiterter Uebergabe: Synthese haengt -> Say und Hangup", async () => {
  await mitSynthese({ ende: SYNTHESE_ENDE.HAENGT, env: EL_ALLOWLIST_ENV }, async (srv) => {
    await incomingAntwort(srv, "CAvorauflegenrueckfall");
    const [{ id: callId }] = srv.readStore().calls;
    const res = await abrufMitFrist(`${srv.localUrl}/voice/el-rueckfall?callId=${callId}&quelle=dial_ende`, {
      method: "POST",
      body: new URLSearchParams({}),
    });
    assert.equal(res.status, HTTP_OK);
    pruefeSayDannHangup(await res.text());
  });
});

test(
  "Gesamtfrist laenger als die Webhook-Frist: die Antwort kommt vor der Webhook-Frist als Say und Hangup",
  { timeout: TESTFRIST_LANG_MS },
  async () => {
    await mitSynthese(
      { ende: SYNTHESE_ENDE.HAENGT, env: EL_REGISTRIERT_ENV, gesamtfristMs: LANGE_GESAMTFRIST_MS },
      async (srv) => {
        const beginn = Date.now();
        const texml = await incomingAntwort(srv, "CAvorauflegenlang", PROVIDER_WEBHOOK_HARDCUT_MS);
        assert.ok(Date.now() - beginn < PROVIDER_WEBHOOK_HARDCUT_MS, "die Antwort wartet nicht ueber die Webhook-Frist hinaus");
        pruefeSayDannHangup(texml);
      },
    );
  },
);

test(
  "Sprachmodell braucht vor dem Fehler 2 s: die Ansage vor dem Auflegen kommt trotzdem vor der Webhook-Frist, die Frist zaehlt ab dem Eingang",
  { timeout: TESTFRIST_LANG_MS },
  async () => {
    const sprachmodell = await startLangsamesSprachmodell(SPRACHMODELL_VERZOEGERUNG_MS);
    try {
      await mitSynthese(
        {
          ende: SYNTHESE_ENDE.HAENGT,
          env: { ANTHROPIC_BASE_URL: sprachmodell.url },
          gesamtfristMs: LANGE_GESAMTFRIST_MS,
        },
        async (srv) => {
          await incomingAntwort(srv, "CAeingangsfrist");
          const [{ id: callId }] = srv.readStore().calls;
          const beginn = Date.now();
          const res = await abrufMitFrist(
            `${srv.localUrl}/voice/turn?callId=${callId}`,
            { method: "POST", body: new URLSearchParams({ SpeechResult: "Hallo" }) },
            { wartezeitMs: PROVIDER_WEBHOOK_HARDCUT_MS },
          );
          assert.ok(Date.now() - beginn < PROVIDER_WEBHOOK_HARDCUT_MS, "die Antwort kommt vor der Webhook-Frist");
          assert.equal(res.status, HTTP_OK);
          const texml = await res.text();
          assert.ok(!texml.includes("<Play>"), `kein Play bei unvollstaendiger Synthese: ${texml}`);
          assert.match(texml, /<Say [^>]*>[^<]+<\/Say><Hangup\/><\/Response>$/);
        },
      );
    } finally {
      await sprachmodell.close();
    }
  },
);
