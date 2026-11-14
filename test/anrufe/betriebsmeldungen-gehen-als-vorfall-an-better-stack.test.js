import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mock, test } from "node:test";

import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { STRIPE_ALARM_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";

const FRIST = { timeout: 5000 };
const GEHEIMER_PFAD = "geheimer-eingang-q7x9";
const BETTERSTACK_FRIST_MS = 5000;
const MELDEZEILE_MAX_ZEICHEN = 1000;
const KUNDE = "cus_vorfall1";
const MELDEZEILE_VOR_MANDANT = "[Hermes] Zahlungsereignis: type=charge.dispute.created tenant=";
const ANLASS = "stripe-money-event";

async function melde({ adresse, mandant = "t_vorfall1" }) {
  const rumpf = JSON.stringify({ id: "evt_vorfall1", type: "charge.dispute.created", data: { object: { customer: KUNDE } } });
  const zeit = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", STRIPE_ALARM_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  const route = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: STRIPE_ALARM_GEHEIMNIS, betterstackAlertUrl: adresse }),
    store: {
      findTenantByCustomer: (kunde) => (kunde === KUNDE ? { id: mandant } : null),
      findTenantBySubscription: () => null,
    },
    audit: () => {},
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
  });
  const antwort = { status: () => antwort, json: () => antwort };
  await route({ rawBody: Buffer.from(rumpf), headers: { "stripe-signature": `t=${zeit},v1=${mac}` } }, antwort);
}

function kurzHashVon(text) {
  const pruefsumme = createHash("sha256").update(text).digest("hex");
  return pruefsumme.slice(0, 8);
}

async function mitAttrappe(t, optionen, ablauf) {
  const attrappe = await starteBetterStackAttrappe(optionen);
  t.after(async () => {
    mock.restoreAll();
    await attrappe.close();
  });
  const fehlerzeilen = [];
  mock.method(console, "error", (...teile) => fehlerzeilen.push(teile.join(" ")));
  return ablauf(attrappe, fehlerzeilen);
}

test("S3: eine Betriebsmeldung geht als genau ein alert-Vorfall per POST an den Eingang", FRIST, async (t) => {
  await mitAttrappe(t, {}, async (attrappe) => {
    await melde({ adresse: attrappe.url, mandant: "t_eins" });
    await attrappe.aufMeldungen(1);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 1);
    const [meldung] = attrappe.meldungen;
    assert.equal(meldung.methode, "POST");
    assert.equal(meldung.contentType, "application/json");
    assert.deepEqual(Object.keys(meldung.koerper).sort(), ["incident", "text"]);
    assert.deepEqual(Object.keys(meldung.koerper.incident).sort(), ["id", "status"]);
    assert.equal(meldung.status, "alert");
    assert.equal(meldung.text, `${MELDEZEILE_VOR_MANDANT}t_eins`);
  });
});

test("S16: zwei Meldezeilen im selben Lauf ergeben zwei verschiedene Vorfall-Schluessel mit Kurz-Hash", FRIST, async (t) => {
  await mitAttrappe(t, {}, async (attrappe) => {
    await melde({ adresse: attrappe.url, mandant: "t_eins" });
    await melde({ adresse: attrappe.url, mandant: "t_zwei" });
    await attrappe.aufMeldungen(2);
    const ids = attrappe.meldungen.map((meldung) => meldung.id);
    assert.equal(new Set(ids).size, 2);
    for (const meldung of attrappe.meldungen) {
      const kurzHash = kurzHashVon(meldung.text);
      assert.match(meldung.id, /^stripe-money-event:\d{4}-\d\d-\d\dT[\d:.]+Z:[0-9a-f]{8}$/);
      assert.ok(meldung.id.endsWith(`:${kurzHash}`));
    }
  });
});

test("die Meldezeile wird auf 1000 Zeichen gekuerzt, 1000 Zeichen bleiben ganz", FRIST, async (t) => {
  await mitAttrappe(t, {}, async (attrappe) => {
    const auffuellung = MELDEZEILE_MAX_ZEICHEN - MELDEZEILE_VOR_MANDANT.length;
    await melde({ adresse: attrappe.url, mandant: "a".repeat(auffuellung) });
    await melde({ adresse: attrappe.url, mandant: "b".repeat(auffuellung + 1) });
    await attrappe.aufMeldungen(2);
    const texte = attrappe.meldungen.map((meldung) => meldung.text).sort();
    assert.deepEqual(texte, [
      `${MELDEZEILE_VOR_MANDANT}${"a".repeat(auffuellung)}`,
      `${MELDEZEILE_VOR_MANDANT}${"b".repeat(auffuellung)}`,
    ]);
  });
});

test("Antwort 500: genau ein Versuch, keine Wiederholung, Logzeile nennt Status und Schluessel, nie die Adresse", FRIST, async (t) => {
  await mitAttrappe(t, { antwortStatus: 500 }, async (attrappe, fehlerzeilen) => {
    await melde({ adresse: attrappe.url });
    await attrappe.aufMeldungen(1);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 1);
    assert.equal(fehlerzeilen.length, 1);
    const schluessel = attrappe.meldungen[0].id;
    assert.equal(fehlerzeilen[0], `[${ANLASS}] Better-Stack-Meldung ${schluessel} nicht zugestellt: HTTP 500`);
    assert.ok(!fehlerzeilen[0].includes(GEHEIMER_PFAD));
  });
});

test("Antwort 2xx: keine Fehlerzeile", FRIST, async (t) => {
  await mitAttrappe(t, { antwortStatus: 204 }, async (attrappe, fehlerzeilen) => {
    await melde({ adresse: attrappe.url });
    await attrappe.aufMeldungen(1);
    await attrappe.schranke();
    assert.deepEqual(fehlerzeilen, []);
  });
});

test("leere Adresse: nichts gesendet, kein Wurf, keine Fehlerzeile", FRIST, async (t) => {
  await mitAttrappe(t, {}, async (_attrappe, fehlerzeilen) => {
    const sendeversuche = mock.method(globalThis, "fetch", async () => new Response(null));
    await melde({ adresse: "" });
    assert.equal(sendeversuche.mock.callCount(), 0);
    assert.deepEqual(fehlerzeilen, []);
  });
});

test("nicht lesbare Adresse: kein Wurf, die Logzeile nennt nur den Fehlernamen, nie die Adresse", FRIST, async (t) => {
  await mitAttrappe(t, {}, async (attrappe, fehlerzeilen) => {
    await melde({ adresse: `kein-url-${GEHEIMER_PFAD}` });
    await attrappe.schranke();
    assert.equal(fehlerzeilen.length, 1);
    assert.match(fehlerzeilen[0], /^\[stripe-money-event\] Better-Stack-Meldung stripe-money-event:\S+ nicht zugestellt: TypeError$/);
    assert.ok(!fehlerzeilen[0].includes(GEHEIMER_PFAD));
  });
});

test("die Frist des POST betraegt 5000 Millisekunden", FRIST, async (t) => {
  await mitAttrappe(t, {}, async (attrappe) => {
    const original = AbortSignal.timeout.bind(AbortSignal);
    const fristen = mock.method(AbortSignal, "timeout", (millisekunden) => original(millisekunden));
    await melde({ adresse: attrappe.url });
    const fristenDesPost = fristen.mock.calls.map((aufruf) => aufruf.arguments);
    fristen.mock.restore();
    await attrappe.aufMeldungen(1);
    assert.deepEqual(fristenDesPost, [[BETTERSTACK_FRIST_MS]]);
  });
});

test("ein Abbruch ohne Fehlerobjekt wird eine Logzeile und laesst den Prozess weiterlaufen, nie mit der Adresse", FRIST, async (t) => {
  t.after(() => mock.restoreAll());
  const fehlerzeile = new Promise((bereit) => {
    mock.method(console, "error", (...teile) => bereit(teile.join(" ")));
  });
  mock.method(globalThis, "fetch", () => Promise.reject(undefined));
  await melde({ adresse: `https://eingang.example.test/${GEHEIMER_PFAD}` });
  const zeile = await fehlerzeile;
  assert.match(zeile, /^\[stripe-money-event\] Better-Stack-Meldung stripe-money-event:\S+ nicht zugestellt: undefined$/);
  assert.ok(!zeile.includes(GEHEIMER_PFAD));
});
