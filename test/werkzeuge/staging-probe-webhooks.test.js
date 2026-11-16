import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { Abbruch, ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";
import { staging } from "../../tools/deploy-weg/staging.mjs";

const COMMIT = "c".repeat(40);
const STATUS_TOKEN = "s".repeat(40);
const SCHLUESSEL = crypto.generateKeyPairSync("ed25519");
const PEM = SCHLUESSEL.privateKey.export({ type: "pkcs8", format: "pem" });
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function signaturStimmt(anfrage, koerper) {
  const zeit = anfrage.headers["telnyx-timestamp"] ?? "";
  const signatur = anfrage.headers["telnyx-signature-ed25519"] ?? "";
  return crypto.verify(
    null,
    Buffer.from(`${zeit}|${koerper}`),
    SCHLUESSEL.publicKey,
    Buffer.from(signatur, "base64"),
  );
}

async function starten(optionen) {
  const anfragen = [];
  const antwort = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      const koerper = Buffer.concat(teile).toString();
      const url = new URL(anfrage.url, "http://127.0.0.1");
      const echt = signaturStimmt(anfrage, koerper);
      anfragen.push({
        methode: anfrage.method,
        pfad: url.pathname,
        callId: url.searchParams.get("callId"),
        koerper,
        echt,
        typ: anfrage.headers["content-type"],
        auth: anfrage.headers.authorization ?? null,
      });
      const [status, daten, kopf] = optionen.antwort(anfrage.method, url.pathname, echt);
      rueckgabe.writeHead(status, kopf ?? { "content-type": "application/json" });
      rueckgabe.end(typeof daten === "string" ? daten : JSON.stringify(daten));
    });
  });
  await new Promise((fertig) => antwort.listen(0, "127.0.0.1", fertig));
  server.push(antwort);
  return { adresse: `http://127.0.0.1:${antwort.address().port}`, anfragen };
}

function gesundeAntwort(abweichung = {}) {
  const status = { datenbank: true, flush: true, commit: COMMIT, telnyxSignaturSchluessel: "ok", ...abweichung.status };
  return (methode, pfad, echt) => {
    const wie = abweichung.webhook?.(pfad, echt);
    if (wie) return wie;
    if (pfad === "/healthz") return [200, { ok: true, commit: COMMIT }];
    if (pfad === "/intern/status") return [abweichung.statusCode ?? 200, status, { "content-type": "application/json", "x-hermes-anrufe": abweichung.anrufe ?? "echt" }];
    if (pfad === "/mcp") return [401, {}];
    if (pfad.startsWith("/voice/")) return echt ? [200, "<Response/>", { "content-type": "text/xml" }] : [403, {}];
    return [404, {}];
  };
}

async function laufen(abweichung = {}, { absichtlichRot = false } = {}) {
  const { adresse, anfragen } = await starten({ antwort: gesundeAntwort(abweichung) });
  const zeilen = [];
  const einstellungen = {
    stagingUrl: adresse,
    statusToken: STATUS_TOKEN,
    telnyxSchluessel: PEM,
    absichtlichRot,
  };
  const uhr = { jetzt: () => 1_700_000_123_000, warten: async () => undefined };
  const ergebnis = await staging({
    einstellungen,
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr,
    probeAuth: async () => 0,
  });
  return { ergebnis, zeilen, anfragen };
}

const voice = (anfragen) => anfragen.filter((a) => a.pfad.startsWith("/voice/"));

test("Alles in Ordnung: signierte Test-Webhooks, Status und Commit stimmen, Schritt grün", async () => {
  const { ergebnis, zeilen } = await laufen();
  assert.equal(ergebnis, true);
  assert.ok(zeilen.includes("Mit fremdem Schlüssel signierter Test-Webhook voice/outbound: HTTP 403, erwartet 403"));
  assert.ok(zeilen.includes("Mit fremdem Schlüssel signierter Test-Webhook voice/status: HTTP 403, erwartet 403"));
  assert.ok(zeilen.includes("Staging-Status: HTTP 200, Datenbank, Flush und Commit stimmen: ja"));
});

test("Die Probe stellt nur Test-Webhooks für eine unbekannte Anruf-ID und ruft place_call nie auf", async () => {
  const { anfragen } = await laufen();
  const outbound = anfragen.filter((a) => a.pfad === "/voice/outbound");
  assert.equal(outbound.length, 1);
  for (const a of outbound) assert.equal(a.callId, "probe-nicht-vorhanden-cccccccccccc");
  assert.deepEqual(voice(anfragen).map((a) => a.echt), [false, false]);
  for (const a of voice(anfragen)) {
    assert.equal(a.methode, "POST");
    assert.equal(a.typ, "application/x-www-form-urlencoded");
    assert.equal(a.koerper, "CallSid=CAprobecccccccccccc&CallStatus=ringing");
  }
  const mcp = anfragen.filter((a) => a.pfad === "/mcp");
  assert.equal(mcp.length, 1);
  assert.ok(!mcp[0].koerper.includes("place_call"));
  assert.ok(!mcp[0].koerper.includes("tools/call"));
});

test("Der Betriebsstatus wird mit dem Status-Token gelesen", async () => {
  const { anfragen } = await laufen();
  const status = anfragen.filter((a) => a.pfad === "/intern/status");
  assert.equal(status.length, 1);
  assert.equal(status[0].auth, `Bearer ${STATUS_TOKEN}`);
});

test("Betriebsart echt oder gesperrt lässt die Probe nicht scheitern", async () => {
  for (const anrufe of ["echt", "gesperrt", "attrappe"]) {
    const { ergebnis } = await laufen({ anrufe });
    assert.equal(ergebnis, true, anrufe);
  }
});

const ROT = [
  ["fremde Signatur an outbound wird angenommen", { webhook: (pfad) => (pfad === "/voice/outbound" ? [200, "<Response/>", { "content-type": "text/xml" }] : null) }],
  ["fremde Signatur an status wird angenommen", { webhook: (pfad) => (pfad === "/voice/status" ? [200, {}] : null) }],
  ["Datenbank nicht ok", { status: { datenbank: false } }],
  ["Flush nicht ok", { status: { flush: false } }],
  ["Commit weicht ab", { status: { commit: "d".repeat(40) } }],
  ["Status antwortet 503", { statusCode: 503 }],
];

for (const [name, abweichung] of ROT) {
  test(`Rot: ${name}`, async () => {
    const { ergebnis } = await laufen(abweichung);
    assert.equal(ergebnis, false);
  });
}

test("Absichtlich rot bleibt rot, auch wenn alle Proben grün sind", async () => {
  const { ergebnis, zeilen } = await laufen({}, { absichtlichRot: true });
  assert.equal(ergebnis, false);
  assert.ok(zeilen.some((z) => z.startsWith("Absichtlich rot")));
});

function einstellungenMit(aenderung) {
  const umgebung = {
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    GITHUB_TOKEN: "g".repeat(20),
    GITHUB_REPOSITORY: "sundartha/hermes",
    STAGING_STATUS_TOKEN: STATUS_TOKEN,
    STAGING_TELNYX_PRIVATE_KEY: PEM,
    ...aenderung,
  };
  const zeilen = [];
  const maskiert = [];
  const ausgabe = { melde: (s, w) => zeilen.push([s, w]), maskiere: (w) => maskiert.push(...w) };
  return { umgebung, zeilen, maskiert, ausgabe };
}

test("Fehlt ein Staging-Geheimnis, hält der Schritt an und nennt den Namen", () => {
  for (const name of ["STAGING_STATUS_TOKEN", "STAGING_TELNYX_PRIVATE_KEY"]) {
    const { umgebung, zeilen, ausgabe } = einstellungenMit({ [name]: "" });
    assert.throws(() => einstellungenLesen("staging", umgebung, ausgabe), Abbruch);
    assert.deepEqual(zeilen, [["einstellung_ungueltig", { name }]]);
  }
});

test("Beide Geheimnisse werden für das Log maskiert und stehen in den Einstellungen", () => {
  const { umgebung, maskiert, ausgabe } = einstellungenMit({});
  const werte = einstellungenLesen("staging", umgebung, ausgabe);
  assert.equal(werte.statusToken, STATUS_TOKEN);
  assert.equal(werte.telnyxSchluessel, PEM);
  assert.ok(maskiert.includes(STATUS_TOKEN));
  assert.ok(maskiert.includes(PEM));
});

test("Ein zu kurzes Status-Token und ein Text ohne Schlüssel werden abgelehnt", () => {
  for (const [name, wert] of [["STAGING_STATUS_TOKEN", "kurz"], ["STAGING_TELNYX_PRIVATE_KEY", "kein schluessel"]]) {
    const { umgebung, ausgabe } = einstellungenMit({ [name]: wert });
    assert.throws(() => einstellungenLesen("staging", umgebung, ausgabe), Abbruch);
  }
});
