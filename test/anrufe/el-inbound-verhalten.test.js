import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { BASE_ENV, seedCall, seedState, startServer, waitForLog, TELNYX_TEST_SIGNATURE_HEADERS } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { INBOUND_FROM, INBOUND_TO, TRAEGER_SID, elInboundInitSpawnEnv, isoVor } from "../_iel-inbound-harness.js";

const HTTP_OK = 200;
const AGENT_ID = "agent_3395_r6";
const RUECKFALL_LOG = "[el-rueckfall] ";
const WARTET_ID = "call_r6_wartet";
const SPAET_ID = "call_r6_spaet";
const JUNG_ID = "call_r6_jung";
const AUSGEHEND_WARTET_ID = "call_r6_aus_wartet";
const AUSGEHEND_ALT_ID = "call_r6_aus_alt";
const AUSGEHEND_JUNG_ID = "call_r6_aus_jung";
const ALT_S = 10;
const JUNG_S = 1;
const ABGELAUFEN_S = 40;
const BINDUNGS_GRENZE_MS = 5000;
const FRIST_WARTE_MS = 15000;
const ANGENOMMEN = "in-progress";
const ANBIETER_SCHLUESSEL = "KEYtest-r6";
const HTTP_FEHLER = 500;

let laufnummer = 0;
const eindeutig = () => `r6-${(laufnummer += 1)}`;

const eingehend = (id, extra = {}) =>
  seedCall({
    id,
    direction: "inbound",
    provider: "telnyx",
    from: INBOUND_FROM,
    to: INBOUND_TO,
    twilioSid: TRAEGER_SID,
    startedAt: isoVor(2),
    answeredAt: isoVor(2),
    maxDurationS: 600,
    costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
    ...extra,
  });

const ausgehend = (id, extra = {}) =>
  seedCall({
    id,
    direction: "outbound",
    provider: "telnyx",
    twilioSid: TRAEGER_SID,
    startedAt: isoVor(2),
    answeredAt: isoVor(2),
    maxDurationS: 600,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    ...extra,
  });

const gebunden = (sekundenHer) => ({ elevenlabsConversationId: "conv_r6", elBoundAt: isoVor(sekundenHer) });

async function mitServer(calls, lauf, env = {}) {
  const srv = await startServer({ env: { ...elInboundInitSpawnEnv(AGENT_ID), ...env }, seed: seedState({ settings: { allowSummaries: false }, calls }) });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

async function mitTraegerAnbieter(status, lauf) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let koerper = "";
    req.on("data", (teil) => (koerper += teil));
    req.on("end", () => {
      anfragen.push({ pfad: req.url, formular: new URLSearchParams(koerper) });
      res.writeHead(status, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    TELNYX_API_BASE: `http://127.0.0.1:${server.address().port}`,
    TELNYX_API_KEY: ANBIETER_SCHLUESSEL,
    TELNYX_ACCOUNT_SID: "acct_r6",
  };
  try {
    return await lauf({ anfragen, env });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const rueckfallZiel = (callId) => `${BASE_ENV.PUBLIC_URL}/voice/el-rueckfall?callId=${callId}&quelle=frist`;

const post = (srv, pfad, felder = {}) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams({ Marke: eindeutig(), ...felder }),
  });

const rueckfall = async (srv, callId, quelle) => {
  const suffix = quelle === undefined ? "" : `&quelle=${quelle}`;
  const res = await post(srv, `/voice/el-rueckfall?callId=${callId}${suffix}`);
  assert.equal(res.status, HTTP_OK);
  return res.text();
};

const zeilenMit = (srv, marke) => srv.stdout.split("\n").filter((zeile) => zeile.includes(marke));

const rueckfallEintraege = (srv) =>
  zeilenMit(srv, `${RUECKFALL_LOG}{`).map((zeile) => JSON.parse(zeile.slice(RUECKFALL_LOG.length)));

const gespeichert = (srv, id) => srv.readStore().calls.find((call) => call.id === id);

test("3395-R6-1: Rueckfall-Log nennt nur bekannte Quellen, sonst unbekannt", async () => {
  await mitServer([eingehend(WARTET_ID)], async (srv) => {
    for (const quelle of ["dial_ende", "frist", "frist%20x", "DIAL_ENDE", undefined]) await rueckfall(srv, WARTET_ID, quelle);
    assert.deepEqual(
      rueckfallEintraege(srv).map((eintrag) => eintrag.quelle),
      ["dial_ende", "frist", "unbekannt", "unbekannt", "unbekannt"],
    );
  });
});

test("3395-R6-2: eingehender Rueckfall - wartender Anruf bekommt den Fehlersatz und den Marker, danach nur noch Auflegen", async () => {
  await mitServer([eingehend(WARTET_ID)], async (srv) => {
    const erst = await rueckfall(srv, WARTET_ID, "frist");
    assert.match(erst, /Hier ist der KI-Assistent von Jonas Beispiel\. Es ist ein technischer Fehler aufgetreten/);
    assert.match(erst, /<Hangup\/>/);
    const call = gespeichert(srv, WARTET_ID);
    assert.equal(call.failureReason, "el_uebergabe_gescheitert");
    assert.match(call.elFallbackAt, /^\d{4}-\d\d-\d\dT/);
    const zweit = await rueckfall(srv, WARTET_ID, "dial_ende");
    assert.doesNotMatch(zweit, /<Say/);
    assert.match(zweit, /<Hangup\/>/);
    assert.deepEqual(
      rueckfallEintraege(srv).map((eintrag) => eintrag.entscheidung),
      ["fehlersatz", "auflegen"],
    );
    assert.equal(gespeichert(srv, WARTET_ID).elFallbackAt, call.elFallbackAt);
  });
});

test("3395-R6-3: eingehend gebunden - ab der Mindestdauer Auflegen, davor Fehlersatz; das Log nennt das Bindungsalter", async () => {
  const calls = [eingehend(SPAET_ID, gebunden(ALT_S)), eingehend(JUNG_ID, gebunden(JUNG_S))];
  await mitServer(calls, async (srv) => {
    const spaet = await rueckfall(srv, SPAET_ID, "dial_ende");
    assert.doesNotMatch(spaet, /<Say/);
    const jung = await rueckfall(srv, JUNG_ID, "dial_ende");
    assert.match(jung, /<Say/);
    const [eintragSpaet, eintragJung] = rueckfallEintraege(srv);
    assert.equal(eintragSpaet.entscheidung, "auflegen");
    assert.ok(eintragSpaet.ms_seit_bindung >= ALT_S * 1000 && eintragSpaet.ms_seit_bindung < ALT_S * 1000 + FRIST_WARTE_MS);
    assert.equal(eintragJung.entscheidung, "fehlersatz");
    assert.ok(eintragJung.ms_seit_bindung >= JUNG_S * 1000 && eintragJung.ms_seit_bindung < BINDUNGS_GRENZE_MS);
    assert.equal(gespeichert(srv, SPAET_ID).status, "active");
    assert.equal(gespeichert(srv, SPAET_ID).failureReason ?? null, null);
  });
});

test("3395-R6-4: ausgehende Bruecke - ungebunden oder jung bindet nicht durch, der Anruf wird als gescheitert beendet; alt gebunden bleibt", async () => {
  const calls = [
    ausgehend(AUSGEHEND_WARTET_ID),
    ausgehend(AUSGEHEND_JUNG_ID, gebunden(JUNG_S)),
    ausgehend(AUSGEHEND_ALT_ID, gebunden(ALT_S)),
  ];
  await mitServer(calls, async (srv) => {
    for (const id of [AUSGEHEND_WARTET_ID, AUSGEHEND_JUNG_ID, AUSGEHEND_ALT_ID]) {
      const xml = await rueckfall(srv, id, "dial_ende");
      assert.doesNotMatch(xml, /<Say/, id);
      assert.match(xml, /<Hangup\/>/, id);
    }
    assert.deepEqual(
      rueckfallEintraege(srv).map((eintrag) => eintrag.entscheidung),
      ["auflegen_gescheitert", "auflegen_gescheitert", "auflegen"],
    );
    for (const id of [AUSGEHEND_WARTET_ID, AUSGEHEND_JUNG_ID]) {
      assert.equal(gespeichert(srv, id).status, "failed", id);
      assert.equal(gespeichert(srv, id).failureReason, "el_uebergabe_gescheitert", id);
    }
    assert.equal(gespeichert(srv, AUSGEHEND_ALT_ID).status, "active");
  });
});

test("3395-R6-5: abgelaufene aeussere Frist (Neustart) leitet den Traeger genau einmal auf den Rueckfall mit quelle=frist um", async () => {
  const calls = [eingehend(WARTET_ID, { startedAt: isoVor(ABGELAUFEN_S), answeredAt: isoVor(ABGELAUFEN_S) })];
  await mitTraegerAnbieter(HTTP_OK, async ({ anfragen, env }) => {
    await mitServer(calls, async (srv) => {
      await waitForLog(srv, new RegExp(`\\[el-inbound\\] umgeleitet call=${WARTET_ID}\\n`), FRIST_WARTE_MS);
      assert.deepEqual(zeilenMit(srv, "[el-inbound]").slice(0, 3), [
        "[el-inbound] Fristen re-armiert: 1 Anrufe",
        `[el-inbound] frist_abgelaufen call=${WARTET_ID} frist=aussen`,
        `[el-inbound] umgeleitet call=${WARTET_ID}`,
      ]);
      assert.equal(anfragen.length, 1);
      assert.ok(anfragen[0].pfad.includes(TRAEGER_SID), anfragen[0].pfad);
      assert.equal(anfragen[0].formular.get("Url"), rueckfallZiel(WARTET_ID));
    }, env);
  });
});

test("3395-R6-6: scheitert die Umleitung, wird das Traeger-Bein aufgelegt; scheitert auch das, steht beides im Log", async () => {
  const calls = [eingehend(WARTET_ID, { startedAt: isoVor(ABGELAUFEN_S), answeredAt: isoVor(ABGELAUFEN_S) })];
  await mitTraegerAnbieter(HTTP_FEHLER, async ({ anfragen, env }) => {
    await mitServer(calls, async (srv) => {
      await waitForLog(srv, new RegExp(`\\[el-inbound\\] auflegen_fehlgeschlagen call=${WARTET_ID}: `), FRIST_WARTE_MS);
      const zeilen = zeilenMit(srv, "[el-inbound]");
      assert.equal(zeilen.filter((zeile) => zeile.includes("umgeleitet")).length, 0);
      assert.match(zeilen.find((zeile) => zeile.includes("umleitung_fehlgeschlagen")), new RegExp(`^\\[el-inbound\\] umleitung_fehlgeschlagen call=${WARTET_ID}: .+`));
      assert.ok(anfragen.length >= 2, "Umleitung und Auflegen gingen an den Anbieter");
    }, env);
  });
});

test("3395-R6-7: angenommenes SIP-Bein armiert die innere Frist, nur fuer wartende Anrufe und nur bei angenommen", async () => {
  const calls = [eingehend(WARTET_ID), eingehend(SPAET_ID), eingehend(JUNG_ID, gebunden(JUNG_S))];
  await mitTraegerAnbieter(HTTP_OK, async ({ anfragen, env }) => {
    await mitServer(calls, async (srv) => {
      await post(srv, `/voice/el-bein?callId=${SPAET_ID}`, { CallStatus: "ringing" });
      await post(srv, `/voice/el-bein?callId=${JUNG_ID}`, { CallStatus: ANGENOMMEN });
      await post(srv, `/voice/el-bein?callId=call_unbekannt`, { CallStatus: ANGENOMMEN });
      await post(srv, `/voice/el-bein?callId=${WARTET_ID}`, { CallStatus: ANGENOMMEN });
      await waitForLog(srv, new RegExp(`\\[el-inbound\\] umgeleitet call=${WARTET_ID}\\n`), FRIST_WARTE_MS);
      assert.deepEqual(
        zeilenMit(srv, "[el-inbound] frist_abgelaufen"),
        [`[el-inbound] frist_abgelaufen call=${WARTET_ID} frist=innen`],
      );
      assert.equal(anfragen.length, 1);
      assert.equal(anfragen[0].formular.get("Url"), rueckfallZiel(WARTET_ID));
    }, env);
  });
});
