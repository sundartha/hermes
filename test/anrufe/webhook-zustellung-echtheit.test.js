import assert from "node:assert/strict";
import { test } from "node:test";

import {
  antwortVon,
  mitInstanzenAufPostgres,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ZEILEN_JE_ZUSTELLUNG = 2;
const GESPROCHEN = "Ich möchte einen Termin";
const GESPROCHEN_ZWEI = "Ich möchte einen Termin morgen";
const KONTROLLE = "Guten Tag";
const BEANTWORTET_SQL = "SELECT count(*)::int AS anzahl FROM webhook_zustellung WHERE koerper IS NOT NULL";
const KENNUNGEN_SQL = "SELECT kennung FROM webhook_zustellung GROUP BY kennung ORDER BY min(angenommen_um)";
const KOPIE_SQL = `UPDATE webhook_zustellung AS ziel
  SET kennung = quelle.kennung, status = quelle.status, content_type = quelle.content_type,
      iv = quelle.iv, koerper = quelle.koerper, tag = quelle.tag
  FROM (SELECT * FROM webhook_zustellung WHERE kennung = $2 LIMIT 1) AS quelle WHERE ziel.kennung = $1`;

const zustellung = (callId, token, gesagt, callSid = "CA_geteilt") => ({
  callId,
  token,
  felder: gesagt === undefined ? { CallSid: callSid } : { CallSid: callSid, SpeechResult: gesagt },
});

async function kennungDerAnnahme(sql, reihenfolge) {
  return (await sql(KENNUNGEN_SQL)).rows[reihenfolge].kennung;
}

async function aendereZeilen(sql, reihenfolge, spalte, wert) {
  const kennung = await kennungDerAnnahme(sql, reihenfolge);
  const { rowCount } = await sql(`UPDATE webhook_zustellung SET ${spalte} = $2 WHERE kennung = $1`, [kennung, wert]);
  assert.equal(rowCount, ZEILEN_JE_ZUSTELLUNG);
}

async function beantwortenLassen({ a, sql, signer }, zustellungen) {
  const antworten = [];
  for (const eingang of zustellungen) {
    antworten.push(await antwortVon(a, signierteZustellung(signer, eingang)));
  }
  for (const antwort of antworten) assert.match(antwort.xml, /<Gather/);
  await zeilenBis(
    async () => (await sql(BEANTWORTET_SQL)).rows[0].anzahl,
    (anzahl) => anzahl >= zustellungen.length * ZEILEN_JE_ZUSTELLUNG,
  );
  return antworten;
}

async function pruefeEchtheit({ b, signer, modell }, { marke, angefragt, vonA }) {
  const vorher = modell.count();
  const antwort = await antwortVon(b, signierteZustellung(signer, angefragt));
  assert.equal(antwort.status, HTTP_OK);
  assert.match(antwort.contentType, /^text\/xml/);
  assert.match(antwort.xml, /<Gather/);
  assert.notEqual(antwort.xml, vonA, `${marke}: nicht das abgelegte XML`);
  assert.equal(modell.count(), vorher + 1, `${marke}: die Attrappe zählt einen weiteren Aufruf`);
}

async function pruefeUnveraendert({ b, signer, modell }, { angefragt, vonA }) {
  const vorher = modell.count();
  const antwort = await antwortVon(b, signierteZustellung(signer, angefragt));
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(antwort.xml, vonA, "die unveränderte Schwesterzeile liefert B byte-gleich aus");
  assert.equal(modell.count(), vorher, "ohne zusätzlichen Aufruf der Attrappe");
}

test("K3: ein in die Zeile eines anderen Anrufs kopierter Körper wird nicht ausgeliefert, die Schwesterzeile schon", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: ["call_k3a", "call_k3b"] },
    async ({ instanzen: [a, b], sql, signer, modell }) => {
      const [vonA21, vonA22] = await beantwortenLassen({ a, sql, signer }, [
        zustellung("call_k3a", "t0021", GESPROCHEN),
        zustellung("call_k3b", "t0022", GESPROCHEN_ZWEI),
      ]);
      const [ziel, quelle] = [await kennungDerAnnahme(sql, 1), await kennungDerAnnahme(sql, 0)];
      const { rowCount } = await sql(KOPIE_SQL, [ziel, quelle]);
      assert.equal(rowCount, ZEILEN_JE_ZUSTELLUNG);
      const rahmen = { b, signer, modell };
      await pruefeEchtheit(rahmen, {
        marke: "t0022",
        angefragt: zustellung("call_k3b", "t0022", "Hallo"),
        vonA: vonA21.xml,
      });
      assert.notEqual(vonA22.xml, vonA21.xml);
      await pruefeUnveraendert(rahmen, { angefragt: zustellung("call_k3a", "t0021", KONTROLLE), vonA: vonA21.xml });
    },
  );
});

test("K4: ein geänderter Status in der Zeile verhindert die Auslieferung, die Schwesterzeile bleibt gültig", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: ["call_k4"] },
    async ({ instanzen: [a, b], sql, signer, modell }) => {
      const [abgelegt, schwester] = await beantwortenLassen({ a, sql, signer }, [
        zustellung("call_k4", "t0023", GESPROCHEN),
        zustellung("call_k4", "t0023k", GESPROCHEN_ZWEI),
      ]);
      await aendereZeilen(sql, 0, "status", 500);
      const rahmen = { b, signer, modell };
      await pruefeEchtheit(rahmen, {
        marke: "t0023",
        angefragt: zustellung("call_k4", "t0023", "Hallo"),
        vonA: abgelegt.xml,
      });
      await pruefeUnveraendert(rahmen, { angefragt: zustellung("call_k4", "t0023k", KONTROLLE), vonA: schwester.xml });
    },
  );
});

test("K5: ein geänderter Content-Type in der Zeile verhindert die Auslieferung, die Schwesterzeile bleibt gültig", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: ["call_k5"] },
    async ({ instanzen: [a, b], sql, signer, modell }) => {
      const [abgelegt, schwester] = await beantwortenLassen({ a, sql, signer }, [
        zustellung("call_k5", "t0024", GESPROCHEN),
        zustellung("call_k5", "t0024k", GESPROCHEN_ZWEI),
      ]);
      await aendereZeilen(sql, 0, "content_type", "text/plain");
      const rahmen = { b, signer, modell };
      await pruefeEchtheit(rahmen, {
        marke: "t0024",
        angefragt: zustellung("call_k5", "t0024", "Hallo"),
        vonA: abgelegt.xml,
      });
      await pruefeUnveraendert(rahmen, { angefragt: zustellung("call_k5", "t0024k", KONTROLLE), vonA: schwester.xml });
    },
  );
});

test("K14: dieselbe Marke mit anderem CallSid im signierten Körper liefert die Antwort nicht aus, mit demselben CallSid schon", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anzahl: 3, anrufe: ["call_k14"] },
    async ({ instanzen: [a, b, c], sql, signer, modell }) => {
      const [abgelegt] = await beantwortenLassen({ a, sql, signer }, [
        zustellung("call_k14", "t0031", GESPROCHEN, "CAbind01"),
      ]);
      await pruefeEchtheit(
        { b, signer, modell },
        { marke: "t0031", angefragt: zustellung("call_k14", "t0031", "Hallo", "CAbind02"), vonA: abgelegt.xml },
      );
      await pruefeUnveraendert(
        { b: c, signer, modell },
        { angefragt: zustellung("call_k14", "t0031", "Hallo", "CAbind01"), vonA: abgelegt.xml },
      );
    },
  );
});
