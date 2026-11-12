import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitUntil, makeTelnyxSigner, nowSeconds, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_VERBOTEN = 403;
const TAG_MS = 86_400_000;
const FRIST = { timeout: 60_000 };
const ZIEL = "+4915112345678";
const CODE = "not-placed:invite-403";
const KOPF = "Hermes Betriebsmeldung\n";
const ALARM = `${KOPF}klasse=${CODE} fehler=2 versuche=2 erfolge=0 tenants=1 fenster_min=1440 regel=alarm`;
const geoeffnet = [];
after(async () => {
  await Promise.all(geoeffnet.map((schliessen) => schliessen()));
});

async function starteMail() {
  const mails = [];
  const attrappe = await starteAttrappe((req, res) => {
    let koerper = "";
    req.on("data", (stueck) => (koerper += stueck));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/v3/smtp/email") mails.push(JSON.parse(koerper).textContent);
      res.writeHead(HTTP_CREATED, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  geoeffnet.push(attrappe.close);
  return { ...attrappe, mails };
}
const mailUmleitung = (mailUrl) =>
  [
    "const echtesFetch = globalThis.fetch;",
    `globalThis.fetch = (url, optionen) => echtesFetch(String(url).replace("https://api.brevo.com", ${JSON.stringify(mailUrl)}), optionen);`,
  ].join("\n");
const stand = () => {
  const s = seedState();
  const von = { from: DOMESTIC_TEST_NUMBER.e164, to: ZIEL, status: "active" };
  s.calls = [1, 2, 3].map((nr) => seedCall({ id: `call_sig_${nr}`, ...von }));
  return s;
};
const anruf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);
const marker = (srv) => srv.readStore().outageAlerts.find((alert) => alert.code === CODE);
const alarmMails = (mail) => mail.mails.filter((text) => text.includes(CODE));

function melde({ srv, signer }, id, { signatur, zeit = String(nowSeconds()) } = {}) {
  const body = new URLSearchParams({ CallStatus: "failed", SipHangupCause: "403" }).toString();
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (signatur !== "keine") {
    headers["telnyx-signature-ed25519"] = signatur ?? signer.sign(zeit, body);
    headers["telnyx-timestamp"] = zeit;
  }
  return abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, { method: "POST", headers, body });
}

test("Anrufende mit scharfer Signaturpruefung: abgewiesen ohne Wirkung, echt signiert Erstbefund still, genau eine Mail, outage_detected", FRIST, async () => {
  const signer = makeTelnyxSigner();
  const mail = await starteMail();
  const srv = await startServer({
    env: {
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
      OUTAGE_ALERT_MIN_FAILURES: "2",
      OUTAGE_ALERT_RETRY_MS: "0",
      OUTAGE_ALERT_WINDOW_MS: String(TAG_MS),
      INBOUND_OUTAGE_ALERT_WINDOW_MS: String(TAG_MS),
      OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0",
      PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0",
      PLATFORM_ALERT_MAIL_TO: "betreiber@waechter.invalid",
      BREVO_API_KEY: "waechter-mail-schluessel",
      MAIL_FROM: "hermes@waechter.invalid",
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(mailUmleitung(mail.url))}`,
    },
    seed: stand(),
  });
  try {
    const sitz = { srv, signer };
    const fremd = makeTelnyxSigner();
    const falsch = await melde(sitz, "call_sig_1", { signatur: fremd.sign(String(nowSeconds()), "x") });
    assert.equal(falsch.status, HTTP_VERBOTEN);
    const ohne = await melde(sitz, "call_sig_1", { signatur: "keine" });
    assert.equal(ohne.status, HTTP_VERBOTEN);
    assert.equal(marker(srv), undefined);
    assert.equal(anruf(srv, "call_sig_1").endedAt, null);

    assert.equal((await melde(sitz, "call_sig_1")).status, HTTP_OK);
    await waitUntil(() => marker(srv), { timeoutMs: 30_000 });
    assert.deepEqual(alarmMails(mail), [], "der Erstbefund meldet nichts");
    assert.equal((await melde(sitz, "call_sig_2")).status, HTTP_OK);
    await waitUntil(() => alarmMails(mail).length === 1, { timeoutMs: 30_000 });
    assert.equal((await melde(sitz, "call_sig_3")).status, HTTP_OK);
    await waitUntil(() => srv.stdout.includes("outage_detected"), { timeoutMs: 30_000 });
    await waitUntil(() => anruf(srv, "call_sig_3").endedAt, { timeoutMs: 30_000 });
    assert.deepEqual(alarmMails(mail), [ALARM]);
  } finally {
    await srv.stop();
  }
});
