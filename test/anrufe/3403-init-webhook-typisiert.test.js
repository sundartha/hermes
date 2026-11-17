import { test } from "node:test";
import assert from "node:assert/strict";

import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";

const lade = () => import("../../src/routes/webhooks-elevenlabs-init.ts");
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const LANGES_GEHEIMNIS = "g".repeat(40);

function antwort() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => Object.assign(res, { statusCode: code });
  res.json = (body) => Object.assign(res, { body });
  res.set = (name, wert) => Object.assign(res.headers, { [name]: wert });
  res.setHeader = res.set;
  return res;
}

const anfrage = (token) => ({ ip: "203.0.113.7", get: () => token });

test("3403 Init-Webhook: falsches Token wird mit 403 verweigert, richtiges geht weiter", async () => {
  const { initTokenSchranke } = await lade();
  const config = { voice: { elevenLabsInbound: { initWebhookToken: LANGES_GEHEIMNIS } } };
  const schranke = initTokenSchranke({
    config,
    zaehler: () => ({ allowed: true, retryAfterS: 0 }),
  });

  const abgelehnt = antwort();
  schranke(anfrage("falsch"), abgelehnt, () => assert.fail("darf nicht weitergehen"));
  assert.equal(abgelehnt.statusCode, HTTP_FORBIDDEN);
  assert.deepEqual(abgelehnt.body, { error: "verweigert" });

  let weiter = false;
  schranke(anfrage(LANGES_GEHEIMNIS), antwort(), () => {
    weiter = true;
  });
  assert.equal(weiter, true);
});

test("3403 Init-Webhook: zu viele Fehlversuche werden gedrosselt", async () => {
  const { initTokenSchranke } = await lade();
  const config = { voice: { elevenLabsInbound: { initWebhookToken: LANGES_GEHEIMNIS } } };
  const schranke = initTokenSchranke({
    config,
    zaehler: () => ({ allowed: false, retryAfterS: 7 }),
  });
  const res = antwort();
  schranke(anfrage("falsch"), res, () => assert.fail("darf nicht weitergehen"));
  assert.equal(res.statusCode, HTTP_TOO_MANY);
  assert.deepEqual(res.body, { error: "gedrosselt" });
});

test("3403 Init-Webhook: erkennt nur POST auf den Init-Pfad", async () => {
  const { istInitWebhookAnfrage, ELEVENLABS_INIT_PATH } = await lade();
  assert.equal(istInitWebhookAnfrage({ method: "POST", path: ELEVENLABS_INIT_PATH }), true);
  assert.equal(istInitWebhookAnfrage({ method: "GET", path: ELEVENLABS_INIT_PATH }), false);
  assert.equal(istInitWebhookAnfrage({ method: "POST", path: "/anders" }), false);
});

function handlerFuer(router, pfad) {
  const schicht = router.stack.find((s) => s.route?.path === pfad);
  const [eintrag] = schicht.route.stack;
  return eintrag.handle;
}

async function logZeileBeiWurf(geworfen) {
  const { makeElevenLabsInitWebhookRoutes, ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } = await lade();
  const config = {
    voice: { elevenLabsInbound: { initWebhookToken: LANGES_GEHEIMNIS }, elevenLabsOutbound: {} },
  };
  const store = {
    load: () => {
      throw geworfen;
    },
  };
  const router = makeElevenLabsInitWebhookRoutes({
    store,
    config,
    bridges: {},
    vorspannText: () => "",
  });
  const handle = handlerFuer(router, ELEVENLABS_INIT_PATH);
  const res = Object.assign(antwort(), { headersSent: false });
  const zeilen = [];
  const original = console.error;
  console.error = (zeile) => zeilen.push(zeile);
  try {
    handle(
      {
        get: (name) => (name === INIT_TOKEN_HEADER ? LANGES_GEHEIMNIS : undefined),
        body: { sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: "t".repeat(32) } },
      },
      res,
    );
  } finally {
    console.error = original;
  }
  return { zeilen, res };
}

test("3403 Init-Webhook: geworfener Fehler wird mit seiner Nachricht geloggt und mit 500 beantwortet", async () => {
  const { zeilen, res } = await logZeileBeiWurf(new Error("boom"));
  assert.deepEqual(zeilen, ["[el-init] fehler: boom"]);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "intern" });
});

test("3403 Init-Webhook: geworfenes Nicht-Fehlerobjekt wird als unbekannt geloggt", async () => {
  const ohne = await logZeileBeiWurf({ message: 42 });
  assert.deepEqual(ohne.zeilen, ["[el-init] fehler: unbekannt"]);
  const leer = await logZeileBeiWurf(null);
  assert.deepEqual(leer.zeilen, ["[el-init] fehler: unbekannt"]);
});
