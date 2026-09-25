// Thema B (Auftrag 2026-08-19): der Recherche-Webhook des ElevenLabs-Laufwerks
// (Werkzeug look_up, POST /webhooks/elevenlabs/lookup, src/routes/webhooks-elevenlabs.js).
//
// BAUART = Rueckfrage-Webhook (Auflage B1), und so sind auch die Faelle geschnitten
// (Vorbild test/elevenlabs-consult-webhook-guards.test.js): Spawn ueber die ECHTE
// HTTP-Route, ein Gate, das nur in der Funktion sitzt, aber nicht in der Route haengt,
// wuerde sonst gruen messen.
//
//   L1  403  Token fehlt/falsch/leer (fail-closed) - keine Wirkung, nichts im Log
//   L2  404  Kennung erfunden / Anruf beendet (kein Existenz-Leck)
//   L3  404  nicht berechtigt: Tenant ohne allowLookup (Auflage B1/B4) - seit SEC-P4
//            mit dem EINHEITLICHEN Ablehnungsgrund kein_laufender_anruf; der praezise
//            Grund kanal_nicht_freigegeben steht nur noch im Log
//   L4  402  pro-Tenant-Kostendecke gerissen (Absolute Regel 1)
//   L5  400  Nutzlast ohne query
//   L6  200  declined: Deckel LOOKUP_MAX_PER_CALL erreicht (Auflage B3 - ROTPROBE:
//            die naechste Anfrage nach dem Deckel wird abgelehnt, der Anruf laeuft
//            weiter, der Suchdienst wird NICHT gerufen)
//   L7  200  declined: Egress-Filter verwirft die Query (Rufnummer des Angerufenen) -
//            ohne Gebuehr, ohne Protokoll-Eintrag, ohne Suchdienst-Aufruf
//   L8  200  ok: Fakten kommen als Antwort, Protokoll (B5) + Gebuehr (B6) am Datensatz
//   L9  200  no_results: Suchdienst zu langsam (Timeout) - der Agent bekommt einen
//            Weiterred-Text statt zu haengen (Auflage B2)
//
// Die EXA-ANTWORTFORM des Fakes folgt der in src/research/adapters/exa-search.js
// dokumentierten Anbieter-Doku ({results:[{title,url,highlights[]}]}); eine echte
// Aufzeichnung einer Exa-Antwort liegt im Repo nicht vor - die Form ist insofern der
// Doku entnommen, nicht am Draht gemessen (ehrlich benannt, Auftrags-Qualitaetsregel 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-lookup-token-testgeheim";

const OWN_CALL_ID = "call_el_lookup_eigen";
const OWN_CONVERSATION_ID = "conv_el_lookup_eigen_1";
const ENDED_CALL_ID = "call_el_lookup_beendet";
const ENDED_CONVERSATION_ID = "conv_el_lookup_beendet_1";
const FOREIGN_TENANT_ID = "tenant_fremd";
const INBOUND_CALL_ID = "call_el_lookup_inbound";
const INBOUND_CONVERSATION_ID = "conv_el_lookup_inbound_1";
const FOREIGN_CALL_ID = "call_el_lookup_fremd";
const FOREIGN_CONVERSATION_ID = "conv_el_lookup_fremd_1";
const INVENTED_CONVERSATION_ID = "conv_el_lookup_erfunden";

const QUERY = "opening hours Grove Street Auto Repair Portland";
const FACT_TITLE = "Grove Street Auto Repair";
const FACT_TEXT = "Open Monday to Friday, 8am to 6pm";
// Muss ueber EL_LOOKUP_TIMEOUT_MS (6000 ms, webhooks-elevenlabs.js) liegen - nur so
// misst L9 wirklich den Timeout-Ast und nicht eine langsame, aber rechtzeitige Antwort.
const EXA_DELAY_BEYOND_TIMEOUT_MS = 6500;
// Der Deckel aus research/registry.js - als Literal, weil dieser Test die WIRKUNG am
// Draht misst und nicht die Konstante gegen sich selbst pruefen soll.
const DECKEL_VERBRAUCHT = 2;
const ANTWORT_VORSCHAU_ZEICHEN = 120;

// Berechtigt ist der Owner-Tenant (OWNER_PROFILE traegt allowLookup); der fremde Tenant
// faellt auf DEFAULT_PROFILE (fail-closed false) - genau die Auflage B4.
const LOOKUP_ON_ENV = Object.freeze({
  LOOKUP_ENABLED: "true",
  EXA_API_KEY: "exa-test-key",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  MULTI_TENANT: "true",
});

const post = (srv, body, headers = {}) =>
  fetch(`${srv.localUrl}${LOOKUP_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const withToken = (srv, body, token = TOOL_TOKEN) =>
  post(srv, body, { [TOOL_TOKEN_HEADER]: token });

const callOf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);
const lookupLogOf = (call) => (Array.isArray(call.lookupLog) ? call.lookupLog : []);
const usageCostOf = (srv, tenantId) => {
  const bucket = srv.readStore().usage?.[tenantId];
  return bucket?.costCents ?? 0;
};

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
        seedCall({
          id: ENDED_CALL_ID,
          status: "completed",
          elevenlabsConversationId: ENDED_CONVERSATION_ID,
        }),
        // Review-Befund B2: der Richtungs-Riegel ist "der Sicherheitskern" der Torkette
        // und braucht einen eigenen Fall - seedCall defaultet auf outbound, ohne diesen
        // Datensatz misst KEIN Fall die Richtung.
        activeCall({
          id: INBOUND_CALL_ID,
          direction: "inbound",
          elevenlabsConversationId: INBOUND_CONVERSATION_ID,
        }),
      ],
    }),
    ...extra,
  };
}

// Fake-Exa: zaehlt Aufrufe, antwortet in der dokumentierten Form; per Modus verzoegert
// (L9-Timeout). Attrappen-Lehre b1-messwerkzeug-attrappe: ohne eigenen Suchdienst-Fake
// liesse sich "der Suchdienst wurde NICHT gerufen" gar nicht messen.
async function startExaFake() {
  const requests = [];
  const mode = { delayMs: 0 };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ url: req.url, body: JSON.parse(raw || "{}") });
      const antwort = () => {
        res.writeHead(HTTP_OK, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ results: [{ title: FACT_TITLE, url: "https://x.invalid", highlights: [FACT_TEXT] }] }),
        );
      };
      if (mode.delayMs > 0) setTimeout(antwort, mode.delayMs);
      else antwort();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    delay: (ms) => {
      mode.delayMs = ms;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withLookupServer({ env = {}, seed = seedOwnAndForeign() } = {}, run) {
  const exa = await startExaFake();
  const srv = await startServer({ env: { ...LOOKUP_ON_ENV, EXA_API_BASE: exa.url, ...env }, seed });
  try {
    return await run({ srv, exa });
  } finally {
    await srv.stop();
    await exa.close();
  }
}

// Log-Schranke (Muster elevenlabs-consult-webhook-guards.test.js): stdout ist eine
// geordnete Pipe - ist die 403-Zeile der Signatur-Middleware da, ist alles davor auch da.
async function logBarrier(srv) {
  const res = await fetch(`${srv.localUrl}/voice/status`, { method: "POST" });
  assert.equal(res.status, HTTP_FORBIDDEN, "Log-Schranke: /voice/status ohne Signatur = 403");
  await waitForLog(srv, /\[voice-signature\][^\n]*provider=unknown/);
}

test("EL-LOOKUP L1: fehlender/gefaelschter Token -> 403, kein Suchdienst-Aufruf, nichts aus der Nutzlast im Protokoll", async (ctx) => {
  await withLookupServer({}, async ({ srv, exa }) => {
    const body = { conversation_id: OWN_CONVERSATION_ID, query: QUERY };
    const angriffe = {
      "kein Header": undefined,
      "leerer Header": "",
      "falscher Token": "voellig-anderer-token",
      "Token als Praefix": TOOL_TOKEN.slice(0, TOOL_TOKEN.length - 1),
      "Token mit Anhang": `${TOOL_TOKEN}x`,
    };
    for (const [name, token] of Object.entries(angriffe)) {
      await ctx.test(`${name} -> 403`, async () => {
        const res = token === undefined ? post(srv, body) : withToken(srv, body, token);
        assert.equal((await res).status, HTTP_FORBIDDEN);
      });
    }
    await ctx.test("leerer ELEVENLABS_TOOL_TOKEN am Server lehnt JEDEN Aufruf ab (Empty-Secret-Trap)", async () => {
      // eigener Server mit leerem Secret - safeEqual("","") waere true, der Handler
      // muss davor abbiegen.
      const leer = await startServer({
        env: { ...LOOKUP_ON_ENV, ELEVENLABS_TOOL_TOKEN: "", EXA_API_BASE: exa.url },
        seed: seedOwnAndForeign(),
      });
      try {
        const res = await fetch(`${leer.localUrl}${LOOKUP_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: "" },
          body: JSON.stringify(body),
        });
        assert.equal(res.status, HTTP_FORBIDDEN);
      } finally {
        await leer.stop();
      }
    });
    await ctx.test("keine Wirkung: kein Protokoll-Eintrag, kein Suchdienst-Aufruf, keine Gebuehr", async () => {
      assert.equal(lookupLogOf(callOf(srv, OWN_CALL_ID)).length, 0);
      assert.equal(exa.requests.length, 0);
      assert.equal(usageCostOf(srv, BOOTSTRAP_TENANT_ID), 0);
    });
    await ctx.test("keine Protokollzeile traegt die Query (Regel 4)", async () => {
      await logBarrier(srv);
      assert.ok(!srv.stdout.includes(QUERY), `Query im Log:\n${srv.stdout}`);
    });
  });
});

test("EL-LOOKUP L2: erfundene Kennung und beendeter Anruf -> 404, kein Suchdienst-Aufruf", async (ctx) => {
  await withLookupServer({}, async ({ srv, exa }) => {
    for (const [name, kennung] of [
      ["erfundene Kennung", INVENTED_CONVERSATION_ID],
      ["beendeter Anruf", ENDED_CONVERSATION_ID],
    ]) {
      await ctx.test(`${name} -> 404 kein_laufender_anruf`, async () => {
        const res = await withToken(srv, { conversation_id: kennung, query: QUERY });
        assert.equal(res.status, HTTP_NOT_FOUND);
        assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
      });
    }
    assert.equal(exa.requests.length, 0);
  });
});

test("EL-LOOKUP L3: Tenant ohne allowLookup -> 404 mit einheitlichem Ablehnungsgrund (B1/B4, SEC-P4), Suchdienst NIE gerufen", async (ctx) => {
  await withLookupServer({}, async ({ srv, exa }) => {
    const res = await withToken(srv, { conversation_id: FOREIGN_CONVERSATION_ID, query: QUERY });
    assert.equal(res.status, HTTP_NOT_FOUND);
    // SEC-P4: der Grund ist nach aussen derselbe wie bei einer erfundenen Kennung -
    // ein abweichender Grund verriete, dass dieser fremde Anruf existiert. Unterschieden
    // wird nur noch im Log.
    assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
    assert.equal(exa.requests.length, 0);

    await ctx.test("Positiv-Kontrolle: derselbe Request am BERECHTIGTEN Anruf laeuft durch", async () => {
      const ok = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, query: QUERY });
      assert.equal(ok.status, HTTP_OK);
      assert.equal(exa.requests.length, 1);
    });
  });
});

test("EL-LOOKUP L3c (B2-ROTPROBE, Sicherheitskern): INBOUND-Anruf -> 404 (einheitlicher Grund seit SEC-P4), die Rede eines fremden Anrufers erreicht NIE den Suchdienst", async () => {
  await withLookupServer({}, async ({ srv, exa }) => {
    const res = await withToken(srv, { conversation_id: INBOUND_CONVERSATION_ID, query: QUERY });
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "kein_laufender_anruf" });
    assert.equal(exa.requests.length, 0);
    // Positiv-Kontrolle: derselbe Owner-Tenant, gleicher Server - nur die Richtung
    // unterscheidet die Faelle. Ohne sie bestuende auch ein Gate, das immer ablehnt.
    const ok = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, query: QUERY });
    assert.equal(ok.status, HTTP_OK);
  });
});

test("EL-LOOKUP L3b: globaler Master-Schalter aus -> 404, auch fuer den Owner (fail-closed)", async () => {
  await withLookupServer({ env: { LOOKUP_ENABLED: "false" } }, async ({ srv, exa }) => {
    const res = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, query: QUERY });
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.equal(exa.requests.length, 0);
  });
});

test("EL-LOOKUP L4: gerissene Kostendecke -> 402, Suchdienst NIE gerufen (Absolute Regel 1)", async () => {
  const seed = seedOwnAndForeign();
  seed.usage = { [BOOTSTRAP_TENANT_ID]: { inputTokens: 0, outputTokens: 0, costEur: 99, calls: 1 } };
  await withLookupServer({ seed }, async ({ srv, exa }) => {
    const res = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, query: QUERY });
    assert.equal(res.status, HTTP_PAYMENT_REQUIRED);
    assert.equal(exa.requests.length, 0);
  });
});

test("EL-LOOKUP L5: Nutzlast ohne brauchbare query -> 400 keine_anfrage", async (ctx) => {
  await withLookupServer({}, async ({ srv, exa }) => {
    for (const [name, body] of [
      ["query fehlt", { conversation_id: OWN_CONVERSATION_ID }],
      ["query leer", { conversation_id: OWN_CONVERSATION_ID, query: "   " }],
      ["query kein String", { conversation_id: OWN_CONVERSATION_ID, query: 42 }],
    ]) {
      await ctx.test(`${name} -> 400`, async () => {
        const res = await withToken(srv, body);
        assert.equal(res.status, HTTP_BAD_REQUEST);
        assert.deepEqual(await res.json(), { error: "keine_anfrage" });
      });
    }
    assert.equal(exa.requests.length, 0);
  });
});

test("EL-LOOKUP L6 (B3-ROTPROBE): Deckel erreicht -> declined mit sprechbarem Text, Anruf laeuft weiter, Suchdienst NICHT gerufen", async (ctx) => {
  const seed = seedOwnAndForeign();
  const eigener = seed.calls.find((call) => call.id === OWN_CALL_ID);
  eigener.lookupLog = [
    { seq: 0, query: "a", askedAt: "2026-08-19T00:00:00Z", ok: true, factCount: 1, dauerMs: 500 },
    { seq: 1, query: "b", askedAt: "2026-08-19T00:00:10Z", ok: true, factCount: 1, dauerMs: 500 },
  ];
  await withLookupServer({ seed }, async ({ srv, exa }) => {
    const res = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, query: QUERY });
    assert.equal(res.status, HTTP_OK, "der Deckel ist KEIN Werkzeug-Fehler - der Agent redet weiter");
    const antwort = await res.json();
    assert.equal(antwort.status, "declined");
    assert.ok(antwort.answer.length > 0, "sprechbarer Ablehnungstext");
    await ctx.test("kein Suchdienst-Aufruf, kein dritter Protokoll-Eintrag, Anruf weiter aktiv", () => {
      assert.equal(exa.requests.length, 0);
      const call = callOf(srv, OWN_CALL_ID);
      assert.equal(lookupLogOf(call).length, DECKEL_VERBRAUCHT);
      assert.equal(call.status, "active");
    });
  });
});

test("EL-LOOKUP L7: Egress-Filter verwirft eine Query mit der Rufnummer des Angerufenen - declined, ohne Gebuehr, ohne Eintrag", async () => {
  await withLookupServer({}, async ({ srv, exa }) => {
    const call = callOf(srv, OWN_CALL_ID);
    const res = await withToken(srv, {
      conversation_id: OWN_CONVERSATION_ID,
      query: `call back number ${call.to}`,
    });
    assert.equal(res.status, HTTP_OK);
    assert.equal((await res.json()).status, "declined");
    assert.equal(exa.requests.length, 0, "die Query hat den Server NIE verlassen");
    assert.equal(lookupLogOf(callOf(srv, OWN_CALL_ID)).length, 0);
    assert.equal(usageCostOf(srv, BOOTSTRAP_TENANT_ID), 0, "keine Gebuehr fuer eine verworfene Suche");
  });
});

test("EL-LOOKUP L8 (Gutfall): Fakten als Antwort, Protokoll B5 am Datensatz, Gebuehr B6 gebucht", async (ctx) => {
  await withLookupServer({}, async ({ srv, exa }) => {
    const res = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, query: QUERY });
    assert.equal(res.status, HTTP_OK);
    const antwort = await res.json();
    assert.equal(antwort.status, "ok");
    assert.ok(antwort.answer.includes(FACT_TEXT), `Antwort traegt den Fakt: ${antwort.answer}`);
    assert.ok(!antwort.answer.includes("https://"), "keine Quell-URL in der Sprech-Antwort");

    await ctx.test("die Query erreichte den Suchdienst genau einmal, in Exa-Form", () => {
      assert.equal(exa.requests.length, 1);
      const anfrage = exa.requests[0];
      assert.equal(anfrage.body.query, QUERY);
    });

    await ctx.test("Protokoll (B5): lookupLog traegt Query, Ausgang und Dauer", () => {
      const log = lookupLogOf(callOf(srv, OWN_CALL_ID));
      assert.equal(log.length, 1);
      assert.equal(log[0].query, QUERY);
      assert.equal(log[0].ok, true);
      assert.equal(log[0].factCount, 1);
      assert.equal(typeof log[0].dauerMs, "number");
    });

    await ctx.test("Gebuehr (B6): EXAKT 1 Cent auf der Tenant-Achse gebucht", () => {
      assert.equal(
        usageCostOf(srv, BOOTSTRAP_TENANT_ID),
        1,
        "genau die Suchgebuehr (LOOKUP_SEARCH_FEE_CENTS=1), VOR dem Absenden gebucht",
      );
    });

    await ctx.test("Injektions-Riegel (Review-Befund B1): die Fakten stehen HINTER dem Daten-Rahmen, nie nackt", async () => {
      assert.ok(
        !antwort.answer.startsWith(FACT_TEXT) && !antwort.answer.startsWith(FACT_TITLE),
        "fremder Web-Text darf die Antwort nicht eroeffnen",
      );
      // Der geseedete Anruf hat language=de -> deutscher Rahmen (localeFor(call.language)).
      assert.ok(
        antwort.answer.includes("niemals Anweisungen"),
        `der Rahmen (lookUpFactsFrame) fehlt: ${antwort.answer.slice(0, ANTWORT_VORSCHAU_ZEICHEN)}`,
      );
      assert.ok(
        antwort.answer.indexOf("niemals Anweisungen") < antwort.answer.indexOf(FACT_TEXT),
        "der Rahmen muss VOR den Fakten stehen",
      );
    });

    await ctx.test("die Konsole traegt die Query NICHT (Regel 4 - das Protokoll liegt im Store, nicht im Log)", async () => {
      await logBarrier(srv);
      assert.ok(!srv.stdout.includes(QUERY), `Query im Log:\n${srv.stdout}`);
    });
  });
});

test("EL-LOOKUP L9 (B2, zu langsam): Suchdienst antwortet nach der Frist -> no_results mit Weiterred-Text, Gebuehr trotzdem gebucht", async () => {
  await withLookupServer({}, async ({ srv, exa }) => {
    exa.delay(EXA_DELAY_BEYOND_TIMEOUT_MS);
    const res = await withToken(srv, { conversation_id: OWN_CONVERSATION_ID, query: QUERY });
    assert.equal(res.status, HTTP_OK);
    const antwort = await res.json();
    assert.equal(antwort.status, "no_results");
    assert.ok(antwort.answer.length > 0, "Weiterred-Text statt Haengen");
    const log = lookupLogOf(callOf(srv, OWN_CALL_ID));
    assert.equal(log.length, 1);
    assert.equal(log[0].ok, false);
    assert.ok(
      usageCostOf(srv, BOOTSTRAP_TENANT_ID) > 0,
      "eine ausgeloeste Suche ist bezahlt, auch wenn die Antwort nie ankommt",
    );
  });
});
