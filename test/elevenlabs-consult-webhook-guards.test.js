// Angriffs-Tests fuer den ElevenLabs-Rueckfrage-Webhook (Werkzeug `get_consult`),
// Route POST /webhooks/elevenlabs/consult.
//
// ABSICHTLICH ROT: der Endpunkt existiert noch nicht - Express antwortet heute 404 statt
// der hier erwarteten Codes. Diese Datei schreibt den Sicherheits-Vertrag VOR dem Bau
// fest, damit der Endpunkt nicht "erstmal offen" entstehen kann. Der Bau-Agent baut
// gegen genau diese Faelle.
//
// WARUM EIN GETEILTES GEHEIMNIS UND KEINE SIGNATUR: ElevenLabs signiert Werkzeug-Webhooks
// NICHT (belegt ueber lesende API-Abfrage + Doku, s. elevenlabs/agent_configs/
// outbound-agent.template.json) - es gibt nur frei konfigurierbare Request-Header. Der
// Endpunkt ist von aussen erreichbar UND er kann mitten in einen laufenden, kostenden
// Anruf hineinwirken. Die einzige Sicherung ist deshalb der Token im Header
// `x-hermes-tool-token`, timing-sicher (safeEqual) gegen ELEVENLABS_TOOL_TOKEN geprueft,
// BEVOR irgendetwas anderes geschieht.
//
// DER VERTRAG, den diese Datei festnagelt:
//   Route     POST /webhooks/elevenlabs/consult (JSON)
//   Nutzlast  { conversation_id: <opake ElevenLabs-Kennung>, question: <Text> }
//             FLACHE Form des Anbieters, gemessen am Datensatz (tool_details.body) eines
//             echten Anrufs vom 18.08.2026 (call_msyexvu3q5r9,
//             conv_3701m0a0fxnzen79mjd8qfcp6k00) - beide Felder auf oberster Ebene, KEIN
//             "parameters"-Umschlag. Die Nutzlast-Form selbst samt ihrer Ablehnung bei
//             fehlender/unbrauchbarer question ist in
//             test/elevenlabs-consult-webhook-envelope.test.js gepinnt; hier reicht fuer
//             die Angriffs-/Geld-Faelle irgendeine ANGENOMMENE Nutzlast.
//   Bindung   conversation_id -> Call ueber call.elevenlabsConversationId (Muster des
//             bestehenden Provider-Handles call.telnyxConversationId). NUR ein Call mit
//             status "active" ist bindbar.
//   Wirkung   im Gutfall entsteht ein Consult am gebundenen Call (call.consults, der
//             BESTEHENDE AL-P13-Kanal) - ausdruecklich KEIN zweiter Rueckfrage-Kanal
//             neben dem, den await_call_event/answer_consult bereits bedienen.
//   S1  403   Header fehlt/falsch ODER ELEVENLABS_TOOL_TOKEN leer (fail-closed)
//   S2  404   Kennung erfunden oder nicht (mehr) an einem laufenden Anruf - 404 statt
//             403 nach Bestandsmuster (kein Existenz-Leck, s. routes/api-calls.js:299)
//   S3  402   Budget-Achse gerissen (blockingBudgetAxis, src/budget-gate.js) - 402 nach
//             Bestandsmuster der Geld-Denials (telephony/outbound-gates.js:754)
//   S4  ---   keine Protokollzeile traegt Rufnummer, Gespraechsinhalt oder die Rueckfrage
//
// WARUM S2 KEIN 403 IST UND WARUM ES KEINEN "ANFRAGENDEN MANDANTEN" GIBT: der Webhook
// traegt keine Identitaet ausser dem Plattform-Token - der Mandant kann NUR aus dem
// gebundenen Anruf kommen. "Richtiger Mandant" heisst deshalb hier: die Rueckfrage landet
// ausschliesslich an dem Anruf, dem die Kennung gehoert, und nie an irgendeinem anderen
// laufenden Anruf. Genau das pruefen S2 (c) und der Gutfall gegen einen zweiten,
// fremden Tenant mit eigenem laufenden Anruf.
//
// Spawn-basiert ueber die ECHTE HTTP-Route (Muster test/security.test.js), nicht per
// Funktionsaufruf: ein Gate, das nur in der Funktion sitzt, aber nicht in der Route
// haengt, wuerde sonst gruen messen.
//
// ELEVENLABS_TOOL_TOKEN steht NICHT in BASE_ENV (test/helpers.js), obwohl die Lehre
// test-base-env-drift genau das verlangt: das Aufraeum-Gate im pre-commit-Hook lehnt
// helpers.js ab, solange die Datei Eintraege in eslint-suppressions.json traegt (33
// Bestands-Verstoesse), und dieser Umbau gehoert nicht in einen Test-Commit. Ersatz-
// deckung hier: JEDER startServer-Aufruf dieser Datei setzt den Token explizit - dotenv
// fuellt nur UNgesetzte Variablen, eine lokale .env kann diese Tests damit nicht faerben.
// OFFEN fuer den Bau-Schritt: die BASE_ENV-Zeile nachziehen, sobald helpers.js aufgeraeumt
// ist - sonst leakt ein echtes Geheimnis in jeden anderen Spawn-Test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Statuscodes benannt statt nackt (Repo-Regel: keine Magic Numbers). Die drei
// Ablehnungscodes SIND der Vertrag dieser Datei, deshalb stehen sie hier oben.
const HTTP_FORBIDDEN = 403; // S1: Token fehlt/falsch/nicht konfiguriert
const HTTP_NOT_FOUND = 404; // S2: Kennung erfunden oder nicht an einem laufenden Anruf
const HTTP_PAYMENT_REQUIRED = 402; // S3: Geld-Achse gerissen

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
// Obergrenze fuer eine Ablehnung. Sie muss deutlich UNTER CONSULT_OPEN_MS (1500 ms, s.
// SHORT_CONSULT_ENV) liegen: eine durchgelassene Rueckfrage antwortet erst nach Ablauf der
// Haltefrist - genau die 47 s Stille des Defekts vom 06.09.2026 im Kleinen. Ein
// Localhost-Umlauf liegt bei ~10 ms, die Marge ist also zwei Groessenordnungen.
const MAX_ABLEHNUNG_MS = 1000;

// Feature-Schnittmenge fuer den Consult-Kanal (src/consult/gate.js: consultEnabled UND
// assistantContextEnabled UND das Per-Tenant-Recht allowConsult - Owner-Profil traegt es).
// BEWUSST in ALLEN Faellen an, auch in den Angriffsfaellen: ein Gate, das nur misst,
// solange die Faehigkeit ohnehin aus ist, misst nichts.
const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
});

// Kurze Consult-Fristen fuer jeden Fall, der eine ANGENOMMENE Rueckfrage misst: haelt der
// Endpunkt die Antwort offen (blockierendes Werkzeug, s. response_timeout_secs in der
// Agenten-Vorlage), loest der Test in unter zwei Sekunden auf, statt an CONSULT_OPEN_MS
// (47 s) zu haengen. Der gemessene Sachverhalt haengt an keiner der beiden Zahlen.
// Sie haengt seit der Mutationsprobe auch an den Faellen, die NUR Ablehnungen messen (S1/S3):
// reisst dort die gemessene Sicherung, laeuft jeder durchgereichte Angriffs-Request in die
// volle Haltefrist - S1 brauchte unter Mutation 283 s statt 0,4 s. Ein Testkatalog, der im
// Fehlerfall in eine Zeitgrenze laeuft statt rot zu werden, meldet den Defekt nicht, er
// verdeckt ihn. Die Erwartungen der Faelle bleiben davon unberuehrt.
const SHORT_CONSULT_ENV = Object.freeze({ CONSULT_WAIT_MS: "200", CONSULT_OPEN_MS: "1500" });

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

// Ein laufender eigener Anruf mit ElevenLabs-Kennung. maxDurationS grosszuegig, damit der
// Boot-Re-Arm (rearmActiveCallTimers) das Leg nicht als Zombie terminalisiert, bevor der
// Request ankommt - Muster test/ks-p2-live-carrier-spend.test.js.
const activeCall = (overrides) => seedCall({ status: "active", maxDurationS: 300, ...overrides });

// Eigener laufender Anruf + fremder Tenant mit EIGENEM laufenden Anruf. Der zweite Anruf
// ist der Detektor gegen eine Implementierung, die bei unbekannter Kennung auf
// "irgendeinen laufenden Anruf" zurueckfaellt.
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

// Positiv-Kontrolle fuer die Abwesenheits-Behauptungen (S1/S4): ein Lauf, dessen stdout
// leer bleibt, wuerde JEDEN "steht nicht im Protokoll"-Test bestehen. Der bewiesene
// 403-Logsatz der Signatur-Middleware (test/voice-signature-403-log.test.js) dient hier
// zugleich als Schranke: er wird NACH dem gemessenen Request abgesetzt, und stdout ist
// eine geordnete Pipe - ist die Schranke da, ist alles davor auch da. Verlangt
// SKIP_TWILIO_SIGNATURE_CHECK=false am Server.
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

    // Jeder Fall ist eine eigene Art, das Geheimnis NICHT zu kennen. Der Praefix- und der
    // Gross-/Kleinschreibungs-Fall stehen bewusst dabei: sie fallen bei einem naiven
    // startsWith/toLowerCase-Vergleich durch, den ein reiner "kein Header"-Test nie faengt.
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

  // Fail-closed ohne konfiguriertes Geheimnis: ein Endpunkt, der bei leerem
  // ELEVENLABS_TOOL_TOKEN durchreicht ("nichts zu pruefen"), waere fuer das ganze
  // Internet offen. Genau diese Zeile hat AUTH-P7 an anderer Stelle bereits entfernt.
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
          // Beendeter eigener Anruf: die Kennung EXISTIERT, der Anruf laeuft aber nicht
          // mehr. Nachtraeglich eine Rueckfrage hineinzureichen ist derselbe Angriff wie
          // eine erfundene Kennung.
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

    // Der eigentliche Mandanten-Beweis: keine der abgewiesenen Rueckfragen darf in
    // IRGENDEINEM anderen laufenden Anruf gelandet sein. Das verbietet den Rueckfall
    // "nimm halt den einen laufenden Anruf", der bei genau einem Anruf im Store
    // unentdeckt bliebe.
    await ctx.test("kein anderer laufender Anruf hat eine Rueckfrage erhalten", () => {
      assert.equal(consultCount(callOf(srv, OWN_CALL_ID)), 0, "eigener Anruf unberuehrt");
      assert.equal(consultCount(callOf(srv, FOREIGN_CALL_ID)), 0, "fremder Anruf unberuehrt");
      assert.equal(
        callOf(srv, FOREIGN_CALL_ID).tenantId,
        FOREIGN_TENANT_ID,
        "Mandant unveraendert",
      );
    });

    // EXISTENZ-KONTROLLE, zuletzt (sie legt selbst einen Consult an): eine nicht
    // vorhandene Route antwortet ebenfalls 404 - ohne diese Gegenprobe wuerden die drei
    // Faelle oben auch dann gruen messen, wenn es den Endpunkt gar nicht gibt. Sie ist
    // der Grund, aus dem S2 heute rot ist.
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
    // Decke 0 auf dem Tenant des Anrufs: blockingBudgetAxis vergleicht "gebucht + live >=
    // Decke" (state-ops.liveBudgetExceeded), 0 >= 0 sperrt also sofort - deterministisch,
    // ohne Tarif-/Zeit-Abhaengigkeit. Eine ausgeschoepfte Decke ist derselbe Zustand.
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
  // Marker, die es NUR in dieser Nutzlast gibt (nicht in Seed, Env oder Bestand) - so
  // misst der Test wirklich das Durchsickern der Nutzlast und nicht den Bestand.
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
    // Zwei Durchlaeufe: mit gueltigem Token (der Request laeuft TIEF in den Handler, das
    // ist der gefaehrlichere Pfad) und mit ungueltigem (Ablehnungs-Protokoll).
    const angenommen = await withToken(srv, {
      conversation_id: OWN_CONVERSATION_ID,
      question: PII_FRAGE,
      caller_number: PII_NUMMER,
    });
    // EXISTENZ-KONTROLLE: eine nicht vorhandene Route protokolliert naturgemaess nichts -
    // ohne diese Zeile waere die Abwesenheits-Behauptung unten gruen, ohne je einen
    // Handler gesehen zu haben. Sie ist der Grund, aus dem S4 heute rot ist.
    assert.ok(
      angenommen.ok,
      `2xx erwartet, war ${angenommen.status} - Nutzlast erreichte keinen Handler`,
    );
    await post(srv, {
      conversation_id: OWN_CONVERSATION_ID,
      question: PII_FRAGE,
      caller_number: PII_NUMMER,
    });

    await logBarrier(srv); // Positiv-Kontrolle + Schranke, s. Kommentar an logBarrier
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

// Ohne diesen Fall besteht ein Endpunkt, der ALLES ablehnt, jeden Angriffstest hier
// darueber. Er ist die eingebaute Gegenprobe: gleicher Server, gleiche Route, nur Token,
// Anruf und Budget sind in Ordnung.
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

test("EL-CONSULT S5: Rueckfrage auf einem OWNER-Anruf -> 404 kanal_nicht_freigegeben, ohne Halt und ohne Datensatz", async (ctx) => {
  const srv = await startServer({
    env: { ...CONSULT_ON_ENV, ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN, ...SHORT_CONSULT_ENV },
    seed: seedState({
      calls: [
        // Derselbe Tenant, dasselbe Profil, dieselbe Kette - EINZIGER Unterschied ist das
        // Ziel-Praedikat. Ohne diese Paarung belegt der 404 unten nur, dass irgendetwas
        // abgelehnt hat.
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

    await ctx.test("404 mit dem Bestands-Ablehnungsgrund", async () => {
      assert.equal(res.status, HTTP_NOT_FOUND);
      assert.deepEqual(await res.json(), { error: "kanal_nicht_freigegeben" });
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

    // GEGENPROBE UND ZUGLEICH LOG-SCHRANKE: derselbe Server, derselbe Token, dasselbe
    // Profil, nur ein NICHT-Owner-Anruf. Sie beweist (a) dass P1 nichts anderes gebrochen
    // hat und (b) - weil stdout eine geordnete Pipe ist - dass alles, was der
    // Owner-Request geschrieben haette, bereits geschrieben waere.
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
