import assert from "node:assert/strict";
import { test } from "node:test";

import { FRIST, SCHWERLAUF, halter, naechsterLaufNachTodVon, starte, starteArbeit, umgebung, zeitenVon } from "./schwerlauf-lauf.js";

const ZWEI_PLAETZE = 2;
const EXIT_NICHT_GESTARTET = 1;

async function erstesEreignis(lauf) {
  return Promise.race([lauf.begonnen, lauf.wartend, lauf.ende.then(() => "geendet")]);
}

async function beenden(...laeufe) {
  for (const lauf of laeufe) lauf.kind.stdin.end();
  await Promise.all(laeufe.map(({ ende }) => ende));
}

async function stand(env) {
  const lauf = starte([SCHWERLAUF, "--stand"], { env });
  await lauf.ende;
  assert.equal(lauf.kind.exitCode, 0, lauf.stderr);
  return lauf.stdout;
}

test("mit zwei Plätzen laufen zwei gleichzeitig gestartete schwere Läufe gleichzeitig", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const laeufe = ["A", "B"].map((name) => starteArbeit(context, name, { env }));

  assert.deepEqual(await Promise.all(laeufe.map(erstesEreignis)), ["begonnen", "begonnen"]);
  await beenden(...laeufe);
  const [erster, zweiter] = laeufe.map(zeitenVon);
  assert.ok(erster.beginn < zweiter.ende && zweiter.beginn < erster.ende, JSON.stringify([erster, zweiter]));
  assert.deepEqual(laeufe.map(({ kind }) => kind.exitCode), [0, 0]);
});

test("sind beide Plätze belegt, wartet ein dritter Lauf, nennt beide Halter und startet, sobald einer frei wird", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const [erster, zweiter] = ["A", "B"].map((name) => starteArbeit(context, name, { env }));
  await Promise.all([erster.begonnen, zweiter.begonnen]);
  const dritter = starteArbeit(context, "C", { env });

  assert.equal(await erstesEreignis(dritter), "wartet");
  assert.match(dritter.stderr, new RegExp(`gehalten von PID (${erster.kind.pid}|${zweiter.kind.pid}), .*; PID (${erster.kind.pid}|${zweiter.kind.pid}), `));
  await beenden(erster);
  await dritter.begonnen;
  await beenden(zweiter, dritter);
  assert.ok(zeitenVon(erster).ende <= zeitenVon(dritter).beginn);
  assert.deepEqual([erster, zweiter, dritter].map(({ kind }) => kind.exitCode), [0, 0, 0]);
});

test("--allein wartet, auch wenn einer von zwei Plätzen frei ist, bis alle frei sind, und hält neue Läufe zurück, bis es fertig ist", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const vorher = starteArbeit(context, "vorher", { env });
  await vorher.begonnen;
  const allein = starteArbeit(context, "allein", { env, optionen: ["--allein"] });
  assert.equal(await erstesEreignis(allein), "wartet");
  const danach = starteArbeit(context, "danach", { env });
  assert.equal(await erstesEreignis(danach), "wartet");

  await beenden(vorher);
  await allein.begonnen;
  assert.match(await stand(env), new RegExp(`^Allein: belegt von PID ${allein.kind.pid}, `, "m"));
  assert.equal(danach.stdout, "");
  await beenden(allein);
  await danach.begonnen;
  await beenden(danach);
  assert.ok(zeitenVon(vorher).ende <= zeitenVon(allein).beginn);
  assert.ok(zeitenVon(allein).ende <= zeitenVon(danach).beginn);
  assert.deepEqual([vorher, allein, danach].map(({ kind }) => kind.exitCode), [0, 0, 0]);
});

test("stirbt der Prozess, der einen von zwei Plätzen hält, startet der nächste Lauf ohne Eingriff", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const [gestorben] = [await halter(context, env), await halter(context, env)];
  const naechster = await naechsterLaufNachTodVon(gestorben, env);

  assert.equal(naechster.kind.exitCode, 0, naechster.stderr);
  assert.equal(naechster.stdout, "lief\n");
});

test("--stand zeigt jeden von zwei Plätzen mit seinem Halter und die Wartenden", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const erster = await halter(context, env);
  const zweiter = await halter(context, env);
  const wartend = starteArbeit(context, "wartend", { env });
  await wartend.wartend;
  const belegt = await stand(env);
  erster.kind.kill("SIGKILL");
  await wartend.begonnen;
  const danach = await stand(env);

  assert.match(belegt, new RegExp(`^Platz 1: belegt von PID ${erster.kind.pid}, Halter im Test, `, "m"));
  assert.match(belegt, new RegExp(`^Platz 2: belegt von PID ${zweiter.kind.pid}, Halter im Test, `, "m"));
  assert.match(belegt, /^Allein: frei$/m);
  assert.match(belegt, new RegExp(`^Wartet: PID ${wartend.kind.pid}, `, "m"));
  assert.match(danach, new RegExp(`^Platz 1: belegt von PID ${wartend.kind.pid}, `, "m"));
  assert.match(danach, /^Wartet: niemand$/m);
});

test("ist die Zahl der Plätze keine positive ganze Zahl, startet der schwere Lauf nicht", FRIST, async (context) => {
  const env = { ...umgebung(context), SCHWERLAUF_PLAETZE: "0" };
  const lauf = starte([SCHWERLAUF, "--", process.execPath, "-e", "console.log('lief')"], { env });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, EXIT_NICHT_GESTARTET);
  assert.match(lauf.stderr, /Sperre für schwere Läufe nicht erhalten: SCHWERLAUF_PLAETZE=0 /);
  assert.equal(lauf.stdout, "");
});
