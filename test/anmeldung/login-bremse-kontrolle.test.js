import assert from "node:assert/strict";
import { test } from "node:test";

import { statusNachWiederholung } from "../gemeinsam/status-nach-wiederholung.mjs";

async function ablauf(antworten, vorWiederholung) {
  const ereignisse = [];
  const rest = [...antworten];
  const status = await statusNachWiederholung(
    async () => {
      const wert = rest.shift();
      ereignisse.push(`abfrage:${wert}`);
      return wert;
    },
    vorWiederholung ?? (async () => ereignisse.push("warten")),
  );
  return { status, ereignisse };
}

test("Login-Kontrolle: ein sofortiges 302 braucht eine Abfrage und kein Warten", async () => {
  const { status, ereignisse } = await ablauf([302]);
  assert.equal(status, 302);
  assert.deepEqual(ereignisse, ["abfrage:302"]);
});

test("Login-Kontrolle: nach einem 503 wartet sie genau einmal und fragt dann erneut", async () => {
  const { status, ereignisse } = await ablauf([503, 302]);
  assert.equal(status, 302);
  assert.deepEqual(ereignisse, ["abfrage:503", "warten", "abfrage:302"]);
});

test("Login-Kontrolle: bei dauerhaftem 503 bleibt es bei fünf Abfragen und vier Wartezeiten", async () => {
  const { status, ereignisse } = await ablauf([503, 503, 503, 503, 503, 302]);
  assert.equal(status, 503);
  assert.deepEqual(ereignisse, [
    "abfrage:503",
    "warten",
    "abfrage:503",
    "warten",
    "abfrage:503",
    "warten",
    "abfrage:503",
    "warten",
    "abfrage:503",
  ]);
});

test("Login-Kontrolle: vier 503 und dann 302 ergeben 302", async () => {
  const { status, ereignisse } = await ablauf([503, 503, 503, 503, 302]);
  assert.equal(status, 302);
  assert.equal(ereignisse.length, 9);
  assert.equal(ereignisse.at(-1), "abfrage:302");
});

test("Login-Kontrolle: ein 400 wird weder wiederholt noch abgewartet", async () => {
  const { status, ereignisse } = await ablauf([400, 302]);
  assert.equal(status, 400);
  assert.deepEqual(ereignisse, ["abfrage:400"]);
});

test("Login-Kontrolle: die zweite Abfrage startet erst nach der Antwort der Datenbank", async () => {
  const ereignisse = [];
  const antworten = [503, 302];
  const status = await statusNachWiederholung(
    async () => {
      const wert = antworten.shift();
      ereignisse.push(`abfrage:${wert}`);
      return wert;
    },
    () =>
      new Promise((fertig) => {
        ereignisse.push("warten-beginnt");
        setImmediate(() => {
          ereignisse.push("warten-fertig");
          fertig();
        });
      }),
  );
  assert.equal(status, 302);
  assert.deepEqual(ereignisse, ["abfrage:503", "warten-beginnt", "warten-fertig", "abfrage:302"]);
});

test("Login-Kontrolle: ohne Wartefunktion bricht sie mit einem Fehler ab", async () => {
  await assert.rejects(statusNachWiederholung(async () => 302), /vorWiederholung fehlt/);
});
