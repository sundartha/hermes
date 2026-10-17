import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

import { FRIST, SCHWERLAUF, halter, naechsterLaufNachTodVon, stand, starte, starteArbeit, umgebung, wartet, zeile, zeitenVon } from "./schwerlauf-lauf.js";

const EXIT_FRIST = 124;
const ZWEI_PLAETZE = 2;
const EXIT_NICHT_GESTARTET = 1;
const FRIST_SEKUNDEN = 1;
const MS_PRO_SEKUNDE = 1000;
const ABGELAUFEN = new RegExp(`Frist von ${FRIST_SEKUNDEN} s ab Erhalt des Platzes abgelaufen`);

async function erstesEreignis(lauf) {
  return Promise.race([lauf.begonnen, lauf.wartend, lauf.ende.then(() => "geendet")]);
}

async function beenden(...laeufe) {
  for (const lauf of laeufe) lauf.kind.stdin.end();
  await Promise.all(laeufe.map(({ ende }) => ende));
}

function mitFrist(befehl) {
  return [SCHWERLAUF, "--frist", String(FRIST_SEKUNDEN), "--", ...befehl];
}

async function prozessNummerAus(context, lauf) {
  const nummer = Number(await zeile(lauf.kind.stdout, /^\d+$/));
  context.after(() => spawnSync("/bin/kill", ["-KILL", String(nummer)]));
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

test("--frist zählt erst ab Erhalt des Platzes: wer länger als seine Frist auf den Platz gewartet hat, läuft danach durch", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const gestartet = Date.now();
  const lauf = starte(mitFrist(["/bin/echo", "lief"]), { env });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await wartet(lauf);
  const gewartetMs = Date.now() - gestartet;
  gehalten.kind.kill("SIGKILL");
  await lauf.ende;

  assert.ok(gewartetMs > FRIST_SEKUNDEN * MS_PRO_SEKUNDE, `nur ${gewartetMs} ms gewartet`);
  assert.equal(lauf.kind.exitCode, 0, lauf.stderr);
  assert.equal(lauf.stdout, "lief\n");
});

test("läuft ein Lauf über seine Frist, wird er beendet und endet mit Exit 124", FRIST, async (context) => {
  const env = umgebung(context);
  const lauf = starte(mitFrist([process.execPath, "-e", "setInterval(() => {}, 1000)"]), { env });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, EXIT_FRIST, lauf.stderr);
  assert.match(lauf.stderr, ABGELAUFEN);
});

test("ignoriert ein Lauf das Ende seiner Frist, wird er hart beendet und endet mit Exit 124", FRIST, async (context) => {
  const env = umgebung(context);
  const stur = "process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000)";
  const lauf = starte(mitFrist([process.execPath, "-e", stur]), { env });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await prozessNummerAus(context, lauf);
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, EXIT_FRIST, lauf.stderr);
  assert.match(lauf.stderr, ABGELAUFEN);
});

test("läuft ein Lauf über seine Frist, endet auch der Enkelprozess, den er gestartet hat", FRIST, async (context) => {
  const env = umgebung(context);
  const enkel = `${JSON.stringify(process.execPath)} -e "console.log(process.pid); setInterval(() => {}, 1000)" & wait`;
  const lauf = starte(mitFrist(["/bin/sh", "-c", enkel]), { env });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await prozessNummerAus(context, lauf);
  await Promise.all([lauf.ende, once(lauf.kind.stdout, "end")]);

  assert.equal(lauf.kind.exitCode, EXIT_FRIST, lauf.stderr);
});

test("ist die Zahl der Plätze keine positive ganze Zahl, startet der schwere Lauf nicht", FRIST, async (context) => {
  const env = { ...umgebung(context), SCHWERLAUF_PLAETZE: "0" };
  const lauf = starte([SCHWERLAUF, "--", process.execPath, "-e", "console.log('lief')"], { env });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, EXIT_NICHT_GESTARTET);
  assert.match(lauf.stderr, /Sperre für schwere Läufe nicht erhalten: SCHWERLAUF_PLAETZE=0 /);
  assert.equal(lauf.stdout, "");
});

test("ohne SCHWERLAUF_PLAETZE hat die Sperre zwei Plätze: zwei Läufe laufen gleichzeitig, ein dritter wartet, bis einer fertig ist", FRIST, async (context) => {
  const env = umgebung(context);
  delete env.SCHWERLAUF_PLAETZE;
  const [erster, zweiter] = ["A", "B"].map((name) => starteArbeit(context, name, { env }));

  assert.deepEqual(await Promise.all([erster, zweiter].map(erstesEreignis)), ["begonnen", "begonnen"]);
  const dritter = starteArbeit(context, "C", { env });
  assert.equal(await erstesEreignis(dritter), "wartet");
  assert.match(await stand(env), /, 2 Plätze\n/);
  await beenden(erster);
  await dritter.begonnen;
  await beenden(zweiter, dritter);
  assert.ok(zeitenVon(erster).ende <= zeitenVon(dritter).beginn);
});
