import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock, test } from "node:test";

import { sendBootstrapAlertSms } from "../../src/telephony/alert-sms.js";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";

const FRIST = { timeout: 5000 };
const GEHEIMER_PFAD = "geheimer-eingang-q7x9";
const BETTERSTACK_FRIST_MS = 5000;
const MELDEZEILE_MAX_ZEICHEN = 1000;

function melde({ adresse, prefix = "[Hermes] ", detail = "x", logTag = "cost-truing" }) {
  sendBootstrapAlertSms({ config: { billing: { betterstackAlertUrl: adresse } }, prefix, detail, logTag });
}

function kurzHashVon(text) {
  const pruefsumme = createHash("sha256").update(text).digest("hex");
  return pruefsumme.slice(0, 8);
}

async function mitAttrappe(optionen, ablauf) {
  const attrappe = await starteBetterStackAttrappe(optionen);
  const fehlerzeilen = [];
  mock.method(console, "error", (...teile) => fehlerzeilen.push(teile.join(" ")));
  try {
    return await ablauf(attrappe, fehlerzeilen);
  } finally {
    mock.restoreAll();
    await attrappe.close();
  }
}

test("S3: eine Tarif-Abweichung geht als genau ein alert-Vorfall per POST an den Eingang", FRIST, async () => {
  await mitAttrappe({}, async (attrappe) => {
    melde({ adresse: attrappe.url, prefix: "[Hermes] Tarif-Drift: ", detail: "+49 zu teuer" });
    await attrappe.aufMeldungen(1);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 1);
    const [meldung] = attrappe.meldungen;
    assert.equal(meldung.methode, "POST");
    assert.equal(meldung.contentType, "application/json");
    assert.deepEqual(Object.keys(meldung.koerper).sort(), ["incident", "text"]);
    assert.deepEqual(Object.keys(meldung.koerper.incident).sort(), ["id", "status"]);
    assert.equal(meldung.status, "alert");
    assert.equal(meldung.text, "[Hermes] Tarif-Drift: +49 zu teuer");
  });
});

test("S16: zwei Meldezeilen im selben Lauf ergeben zwei verschiedene Vorfall-Schluessel mit Kurz-Hash", FRIST, async () => {
  await mitAttrappe({}, async (attrappe) => {
    melde({ adresse: attrappe.url, detail: "+49 zu teuer" });
    melde({ adresse: attrappe.url, detail: "+33 zu teuer" });
    await attrappe.aufMeldungen(2);
    const ids = attrappe.meldungen.map((meldung) => meldung.id);
    assert.equal(new Set(ids).size, 2);
    for (const meldung of attrappe.meldungen) {
      const kurzHash = kurzHashVon(meldung.text);
      assert.match(meldung.id, /^cost-truing:\d{4}-\d\d-\d\dT[\d:.]+Z:[0-9a-f]{8}$/);
      assert.ok(meldung.id.endsWith(`:${kurzHash}`));
    }
  });
});

test("die Meldezeile wird auf 1000 Zeichen gekuerzt, 1000 Zeichen bleiben ganz", FRIST, async () => {
  await mitAttrappe({}, async (attrappe) => {
    melde({ adresse: attrappe.url, prefix: "", detail: "a".repeat(MELDEZEILE_MAX_ZEICHEN) });
    melde({ adresse: attrappe.url, prefix: "", detail: "b".repeat(MELDEZEILE_MAX_ZEICHEN + 1) });
    await attrappe.aufMeldungen(2);
    const texte = attrappe.meldungen.map((meldung) => meldung.text).sort();
    assert.deepEqual(texte, ["a".repeat(MELDEZEILE_MAX_ZEICHEN), "b".repeat(MELDEZEILE_MAX_ZEICHEN)]);
  });
});

test("Antwort 500: genau ein Versuch, keine Wiederholung, Logzeile nennt Status und Schluessel, nie die Adresse", FRIST, async () => {
  await mitAttrappe({ antwortStatus: 500 }, async (attrappe, fehlerzeilen) => {
    melde({ adresse: attrappe.url, logTag: "tts_quota_warning" });
    await attrappe.aufMeldungen(1);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 1);
    assert.equal(fehlerzeilen.length, 1);
    const schluessel = attrappe.meldungen[0].id;
    assert.equal(fehlerzeilen[0], `[tts_quota_warning] Better-Stack-Meldung ${schluessel} nicht zugestellt: HTTP 500`);
    assert.ok(!fehlerzeilen[0].includes(GEHEIMER_PFAD));
  });
});

test("Antwort 2xx: keine Fehlerzeile", FRIST, async () => {
  await mitAttrappe({ antwortStatus: 204 }, async (attrappe, fehlerzeilen) => {
    melde({ adresse: attrappe.url });
    await attrappe.aufMeldungen(1);
    await attrappe.schranke();
    assert.deepEqual(fehlerzeilen, []);
  });
});

test("leere Adresse: nichts gesendet, kein Wurf, keine Fehlerzeile", FRIST, async () => {
  await mitAttrappe({}, async (_attrappe, fehlerzeilen) => {
    const sendeversuche = mock.method(globalThis, "fetch", async () => new Response(null));
    melde({ adresse: "" });
    assert.equal(sendeversuche.mock.callCount(), 0);
    assert.deepEqual(fehlerzeilen, []);
  });
});

test("nicht lesbare Adresse: kein Wurf, die Logzeile nennt nur den Fehlernamen, nie die Adresse", FRIST, async () => {
  await mitAttrappe({}, async (attrappe, fehlerzeilen) => {
    melde({ adresse: `kein-url-${GEHEIMER_PFAD}` });
    await attrappe.schranke();
    assert.equal(fehlerzeilen.length, 1);
    assert.match(fehlerzeilen[0], /^\[cost-truing\] Better-Stack-Meldung cost-truing:\S+ nicht zugestellt: TypeError$/);
    assert.ok(!fehlerzeilen[0].includes(GEHEIMER_PFAD));
  });
});

test("die Frist des POST betraegt 5000 Millisekunden", FRIST, async () => {
  await mitAttrappe({}, async (attrappe) => {
    const original = AbortSignal.timeout.bind(AbortSignal);
    const fristen = mock.method(AbortSignal, "timeout", (millisekunden) => original(millisekunden));
    melde({ adresse: attrappe.url });
    await attrappe.aufMeldungen(1);
    assert.deepEqual(fristen.mock.calls.map((aufruf) => aufruf.arguments), [[BETTERSTACK_FRIST_MS]]);
  });
});
