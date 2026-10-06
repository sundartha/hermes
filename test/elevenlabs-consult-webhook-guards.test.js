import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYMENT_REQUIRED = 402;

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

const OWN_CALL_ID = "call_el_eigen";
const OWN_CONVERSATION_ID = "conv_el_eigen_1";
const ENDED_CALL_ID = "call_el_beendet";
const ENDED_CONVERSATION_ID = "conv_el_beendet_1";
const FOREIGN_TENANT_ID = "tenant_fremd";
const FOREIGN_CALL_ID = "call_el_fremd";
const FOREIGN_CONVERSATION_ID = "conv_el_fremd_1";
const INVENTED_CONVERSATION_ID = "conv_el_frei_erfunden";
const OWNER_CALL_ID = "call_el_owner";
const OWNER_CONVERSATION_ID = "conv_el_owner_1";

const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const MAX_ABLEHNUNG_MS = 1000;

const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
});

const SHORT_CONSULT_ENV = Object.freeze({
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: "1500",
  EL_CONSULT_DELIVERY_MS: "400",
  EL_CONSULT_ACK_MS: "400",
  EL_CONSULT_ANSWER_MS: "1500",
});

const post = (srv, body, headers = {}) =>
  fetch(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const withToken = (srv, body, token = TOOL_TOKEN) =>
  post(srv, body, { [TOOL_TOKEN_HEADER]: token });

const callOf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);
const consultCount = (call) => (Array.isArray(call.consults) ? call.consults.length : 0);

const activeCall = (overrides) => seedCall({ status: "active", maxDurationS: 300, ...overrides });

function seedOwnAndForeign(extra = {}) {
  return {
    ...seedState({
      calls: [
        activeCall({ id: OWN_CALL_ID, elevenlabsConversationId: OWN_CONVERSATION_ID }),
        activeCall({
          id: FOREIGN_CALL_ID,
          tenantId: FOREIGN_TENANT_ID,
          elevenlabsConversationId: FOREIGN_CONVERSATION_ID,
        }),
      ],
    }),
    ...extra,
  };
}

async function logBarrier(srv) {
  const res = await fetch(`${srv.localUrl}/voice/status`, { method: "POST" });
  assert.equal(
    res.status,
    HTTP_FORBIDDEN,
    "Log-Schranke: /voice/status ohne Signatur muss 403 sein",
  );
  await waitForLog(srv, /\[voice-signature\][^\n]*provider=unknown/);
}

test("EL-CONSULT S1: fehlender/gefaelschter Tool-Token -> 403, nichts aus der Nutzlast im Protokoll, keine Zustandsaenderung", async (ctx) => {
  const srv = await startServer({
    env: {
      ...CONSULT_ON_ENV,
      ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      ...SHORT_CONSULT_ENV,
    },
    seed: seedOwnAndForeign(),
  });
  try {
    const body = { conversation_id: OWN_CONVERSATION_ID, question: QUESTION };

    const angriffe = {
      "kein Header": undefined,
      "leerer Header": "",
      "falscher Token": "voellig-anderer-token",
      "Token als Praefix": TOOL_TOKEN.slice(0, TOOL_TOKEN.length - 1),
      "Token mit Anhang": `${TOOL_TOKEN}x`,
      "Token in Grossbuchstaben": TOOL_TOKEN.toUpperCase(),
    };
    for (const [name, token] of Object.entries(angriffe)) {
      await ctx.test(`${name} -> 403`, async () => {
        const res =
          token === undefined ? post(srv, body) : post(srv, body, { [TOOL_TOKEN_HEADER]: token });
        assert.equal((await res).status, HTTP_FORBIDDEN);
      });
    }

    await ctx.test("kein Consult entstanden (keine Wirkung, keine Zustandsaenderung)", () => {
      assert.equal(consultCount(callOf(srv, OWN_CALL_ID)), 0);
      assert.equal(consultCount(callOf(srv, FOREIGN_CALL_ID)), 0);
    });

    await ctx.test("keine Protokollzeile traegt die Rueckfrage", async () => {
      await logBarrier(srv);
      assert.ok(!srv.stdout.includes(QUESTION), `Rueckfrage im Log:\n${srv.stdout}`);
    });
  } finally {
    await srv.stop();
  }

  const offen = await startServer({
    env: { ...CONSULT_ON_ENV, ELEVENLABS_TOOL_TOKEN: "", ...SHORT_CONSULT_ENV },
    seed: seedOwnAndForeign(),
  });
  try {
    await ctx.test("ELEVENLABS_TOOL_TOKEN leer -> jeder Aufruf 403 (nie offen)", async () => {
      const mitToken = await withToken(offen, {
        conversation_id: OWN_CONVERSATION_ID,
        question: QUESTION,
      });
      assert.equal(mitToken.status, HTTP_FORBIDDEN);
      const ohneToken = await post(offen, {
        conversation_id: OWN_CONVERSATION_ID,
        question: QUESTION,
      });
      assert.equal(ohneToken.status, HTTP_FORBIDDEN);
      assert.equal(consultCount(callOf(offen, OWN_CALL_ID)), 0);
    });
  } finally {
    await offen.stop();
  }
});

test("EL-CONSULT S2: fremde bzw. erfundene conversation_id -> 404, kein Zugriff auf einen fremden Anruf", async (ctx) => {
  const srv = await startServer({
    env: { ...CONSULT_ON_ENV, ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN, ...SHORT_CONSULT_ENV },
    seed: {
      ...seedState({
        calls: [
          activeCall({ id: OWN_CALL_ID, elevenlabsConversationId: OWN_CONVERSATION_ID }),
          activeCall({
            id: FOREIGN_CALL_ID,
            tenantId: FOREIGN_TENANT_ID,
            elevenlabsConversationId: FOREIGN_CONVERSATION_ID,
          }),
          seedCall({
            id: ENDED_CALL_ID,
            elevenlabsConversationId: ENDED_CONVERSATION_ID,
            status: "completed",
            endedAt: new Date().toISOString(),
          }),
        ],
      }),
    },
  });
  try {
    await ctx.test("frei erfundene Kennung -> 404 (kein Existenz-Leck)", async () => {
      const res = await withToken(srv, {
        conversation_id: INVENTED_CONVERSATION_ID,
        question: QUESTION,
      });
      assert.equal(res.status, HTTP_NOT_FOUND);
    });

    await ctx.test("fehlende Kennung -> 404", async () => {
      assert.equal((await withToken(srv, { question: QUESTION })).status, HTTP_NOT_FOUND);
    });

    await ctx.test(
      "Kennung eines BEENDETEN Anrufs -> 404 (nur laufende Anrufe sind bindbar)",
      async () => {
        const res = await withToken(srv, {
          conversation_id: ENDED_CONVERSATION_ID,
          question: QUESTION,
        });
        assert.equal(res.status, HTTP_NOT_FOUND);
        assert.equal(consultCount(callOf(srv, ENDED_CALL_ID)), 0);
      },
    );

    await ctx.test("kein anderer laufender Anruf hat eine Rueckfrage erhalten", () => {
      assert.equal(consultCount(callOf(srv, OWN_CALL_ID)), 0, "eigener Anruf unberuehrt");
      assert.equal(consultCount(callOf(srv, FOREIGN_CALL_ID)), 0, "fremder Anruf unberuehrt");
      assert.equal(
        callOf(srv, FOREIGN_CALL_ID).tenantId,
        FOREIGN_TENANT_ID,
        "Mandant unveraendert",
      );
    });

    await ctx.test("Gegenprobe: dieselbe Route nimmt die EIGENE Kennung an", async () => {
      const res = await withToken(srv, {
        conversation_id: OWN_CONVERSATION_ID,
        question: QUESTION,
      });
      assert.ok(res.ok, `2xx erwartet, war ${res.status} - dann misst der 404 oben nichts`);
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT S3: gerissene Budget-Achse -> 402, die Rueckfrage wird nicht weitergereicht", async (ctx) => {
  const srv = await startServer({
    env: { ...CONSULT_ON_ENV, ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN, ...SHORT_CONSULT_ENV },
    seed: seedOwnAndForeign({
      tenantBudgets: [{ tenantId: BOOTSTRAP_TENANT_ID, budgetCents: 0, hardCapCents: 0 }],
    }),
  });
  try {
    const res = await withToken(srv, {
      conversation_id: OWN_CONVERSATION_ID,
      question: QUESTION,
    });

    await ctx.test("Geld-Denial nach Bestandsmuster -> 402", () => {
      assert.equal(res.status, HTTP_PAYMENT_REQUIRED);
    });

    await ctx.test("die Rueckfrage ist nicht weitergereicht worden", () => {
      assert.equal(consultCount(callOf(srv, OWN_CALL_ID)), 0);
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT S4: Nutzlast mit Rufnummer + Gespraechsinhalt taucht in KEINER Protokollzeile auf", async () => {
  const PII_NUMMER = "+4915199887766";
  const PII_INHALT = "Frau Sommer sagt, die Rechnung 4711 sei seit Mai offen";
  const PII_FRAGE = `Soll ich ${PII_NUMMER} zurueckrufen? ${PII_INHALT}`;

  const srv = await startServer({
    env: {
      ...CONSULT_ON_ENV,
      ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      ...SHORT_CONSULT_ENV,
    },
    seed: seedOwnAndForeign(),
  });
  try {
    const angenommen = await withToken(srv, {
      conversation_id: OWN_CONVERSATION_ID,
      question: PII_FRAGE,
      caller_number: PII_NUMMER,
    });
    assert.ok(
      angenommen.ok,
      `2xx erwartet, war ${angenommen.status} - Nutzlast erreichte keinen Handler`,
    );
    await post(srv, {
      conversation_id: OWN_CONVERSATION_ID,
      question: PII_FRAGE,
      caller_number: PII_NUMMER,
    });

    await logBarrier(srv);
    for (const [name, marker] of Object.entries({
      Rufnummer: PII_NUMMER,
      Gespraechsinhalt: PII_INHALT,
      Rueckfrage: PII_FRAGE,
    })) {
      assert.ok(!srv.stdout.includes(marker), `${name} steht im Protokoll:\n${srv.stdout}`);
    }
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT Gutfall: gueltiger Token + laufender eigener Anruf + freies Budget -> angenommen, Rueckfrage nur am eigenen Anruf", async (ctx) => {
  const srv = await startServer({
    env: {
      ...CONSULT_ON_ENV,
      ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
      ...SHORT_CONSULT_ENV,
    },
    seed: seedOwnAndForeign(),
  });
  try {
    const res = await withToken(srv, {
      conversation_id: OWN_CONVERSATION_ID,
      question: QUESTION,
    });

    await ctx.test("kein Gate hat gesperrt (2xx)", async () => {
      assert.ok(
        res.ok,
        `angenommen (2xx) erwartet, war ${res.status}: ${await res.clone().text()}`,
      );
    });

    await ctx.test("die Rueckfrage haengt am eigenen Anruf - und nur dort", () => {
      assert.equal(consultCount(callOf(srv, OWN_CALL_ID)), 1, "Consult am gebundenen Anruf");
      assert.equal(consultCount(callOf(srv, FOREIGN_CALL_ID)), 0, "fremder Anruf unberuehrt");
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT S5: Rueckfrage auf einem OWNER-Anruf -> 404 mit einheitlichem Ablehnungsgrund (SEC-P4), ohne Halt und ohne Datensatz", async (ctx) => {
  const srv = await startServer({
    env: { ...CONSULT_ON_ENV, ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN, ...SHORT_CONSULT_ENV },
    seed: seedState({
      calls: [
        activeCall({ id: OWN_CALL_ID, elevenlabsConversationId: OWN_CONVERSATION_ID }),
        activeCall({
          id: OWNER_CALL_ID,
          elevenlabsConversationId: OWNER_CONVERSATION_ID,
          calleeIsOwner: true,
        }),
      ],
    }),
  });
  try {
    const start = Date.now();
    const res = await withToken(srv, {
      conversation_id: OWNER_CONVERSATION_ID,
      question: QUESTION,
    });
    const dauer = Date.now() - start;

    await ctx.test("404 mit dem einheitlichen Ablehnungsgrund", async () => {
      assert.equal(res.status, HTTP_NOT_FOUND);
      assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
    });

    await ctx.test("kein Halt: die Antwort kommt lange vor CONSULT_OPEN_MS", () => {
      assert.ok(
        dauer < MAX_ABLEHNUNG_MS,
        `Ablehnung dauerte ${dauer} ms - die Leitung wurde gehalten`,
      );
    });

    await ctx.test("kein Consult-Datensatz am Owner-Anruf", () => {
      assert.equal(consultCount(callOf(srv, OWNER_CALL_ID)), 0);
    });

    await ctx.test("Gegenprobe: derselbe Aufruf auf einem NICHT-Owner-Anruf bleibt unveraendert", async () => {
      const ok = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, question: QUESTION });
      assert.ok(ok.ok, `2xx erwartet, war ${ok.status} - dann misst der 404 oben nichts`);
      assert.equal(consultCount(callOf(srv, OWN_CALL_ID)), 1);
      await waitForLog(srv, new RegExp(`\\[consult-raised\\] gestellt call=${OWN_CALL_ID}`));
    });

    await ctx.test("keine [consult-raised]-Zeile fuer den Owner-Anruf", () => {
      assert.ok(
        !srv.stdout.includes(`gestellt call=${OWNER_CALL_ID}`),
        `der Owner-Anruf hat eine Rueckfrage gestellt:\n${srv.stdout}`,
      );
    });
  } finally {
    await srv.stop();
  }
});
