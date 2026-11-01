import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { PRE_PUSH_HOOK, PRUEFLEITER_TOOL, probeRepository, runIn } from "./probe-repo.js";
import { FRIST, SCHWERLAUF, arbeit, halter, stand, starte, starteArbeit, starteSteuerbar, umgebung, wartet, zeitenVon } from "./schwerlauf-lauf.js";

const UPSTREAM_BASE_REF = "refs/remotes/upstream/master";
const VORRANG_VON_AUSSEN = { SCHWERLAUF_VORRANG: "push" };
const PUSH_HALTER = "pruefleiter --basis upstream\\/master --ohne-werkzeugtests";
const ZWEI_PLAETZE = 2;
const ALLE_DREI_PLAETZE_BELEGT = 3;

function pushRepo(context, env, { name, verschachtelt }) {
  const pruefleiter = `SCHWERLAUF_SPERRDATEI=${JSON.stringify(env.SCHWERLAUF_SPERRDATEI)} ${JSON.stringify(process.execPath)} ${JSON.stringify(PRUEFLEITER_TOOL)}`;
  const arbeitAufruf = `${JSON.stringify(process.execPath)} arbeit.js`;
  const verzeichnis = probeRepository(context, {
    "package.json": JSON.stringify({
      name: "schwerlauf-reihenfolge-probe",
      private: true,
      scripts: {
        lint: "true",
        "test:betroffen": verschachtelt ? `${JSON.stringify(process.execPath)} ${JSON.stringify(SCHWERLAUF)} -- ${arbeitAufruf}` : arbeitAufruf,
        pruefleiter,
      },
    }),
    "arbeit.js": arbeit(name),
  });
  runIn(verzeichnis, "git", ["update-ref", UPSTREAM_BASE_REF, "HEAD"]);
  return verzeichnis;
}

function pushUeberDenHook(context, env, { name = "push", verschachtelt = false } = {}) {
  const verzeichnis = pushRepo(context, env, { name, verschachtelt });
  return starteSteuerbar(context, [PRE_PUSH_HOOK], { env: { ...env, GIT_DIR: join(verzeichnis, ".git") }, cwd: verzeichnis, programm: "sh" });
}

function erstesVon(laeufe) {
  return Promise.race(Object.entries(laeufe).map(([name, ereignis]) => ereignis.then(() => name)));
}

function beginntOderWartet(lauf) {
  return erstesVon({ begonnen: lauf.begonnen, wartet: lauf.wartend });
}

async function beenden(lauf) {
  lauf.kind.stdin.end();
  await lauf.ende;
}

async function beginnenderPush(context, env, name) {
  const lauf = pushUeberDenHook(context, env, { name });
  assert.equal(await beginntOderWartet(lauf), "begonnen", lauf.stderr);
  return lauf;
}

function haltVonPush(platz) {
  return new RegExp(`^${platz}: belegt von PID \\d+, ${PUSH_HALTER}, `, "m");
}

test("wird der Platz frei, bekommen ihn gewöhnliche Wartende in der Reihenfolge ihres Wartebeginns", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const a = starteArbeit(context, "A", { env });
  await a.wartend;
  const b = starteArbeit(context, "B", { env });
  await b.wartend;

  const wartende = (await stand(env)).split("\n").filter((zeile) => zeile.startsWith("Wartet: "));
  gehalten.kind.kill("SIGKILL");
  assert.equal(await erstesVon({ a: a.begonnen, b: b.begonnen }), "a");
  await beenden(a);
  await b.begonnen;
  await beenden(b);

  assert.deepEqual([a, b].map(({ kind }) => kind.exitCode), [0, 0]);
  assert.ok(zeitenVon(a).ende <= zeitenVon(b).beginn, JSON.stringify([zeitenVon(a), zeitenVon(b)]));
  assert.equal(wartende.length, 2, wartende.join("\n"));
  assert.match(wartende[0], new RegExp(`^Wartet: PID ${a.kind.pid}, `));
  assert.match(wartende[1], new RegExp(`^Wartet: PID ${b.kind.pid}, `));
  assert.doesNotMatch(wartende.join("\n"), /Vorrang/);
});

test("sind alle gewöhnlichen Plätze belegt, startet ein Push sofort auf dem Push-Platz, ein zweiter Push wartet auf ihn, ein gewöhnlicher Lauf bekommt den Push-Platz nie", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const a = starteArbeit(context, "A", { env });
  await a.wartend;
  const vorDenPushes = await stand(env);
  const erster = pushUeberDenHook(context, env, { name: "push-1" });
  assert.equal(await beginntOderWartet(erster), "begonnen", erster.stderr);
  const zweiter = pushUeberDenHook(context, env, { name: "push-2" });
  assert.equal(await beginntOderWartet(zweiter), "wartet", zweiter.stdout);
  const beidePushes = await stand(env);
  await beenden(erster);
  await zweiter.begonnen;
  await beenden(zweiter);
  const nachDenPushes = await stand(env);
  gehalten.kind.kill("SIGKILL");
  await a.begonnen;
  await beenden(a);

  assert.deepEqual([erster, zweiter, a].map(({ kind }) => kind.exitCode), [0, 0, 0]);
  assert.ok(zeitenVon(erster).ende <= zeitenVon(zweiter).beginn, JSON.stringify([zeitenVon(erster), zeitenVon(zweiter)]));
  assert.ok(zeitenVon(zweiter).ende <= zeitenVon(a).beginn, JSON.stringify([zeitenVon(zweiter), zeitenVon(a)]));
  assert.match(vorDenPushes, /^Push-Platz: frei$/m);
  assert.match(vorDenPushes, new RegExp(`^Wartet: PID ${a.kind.pid}, `, "m"));
  assert.match(beidePushes, new RegExp(`^Platz 1: belegt von PID ${gehalten.kind.pid}, Halter im Test, `, "m"));
  assert.match(beidePushes, new RegExp(`^Push-Platz: belegt von PID \\d+, ${PUSH_HALTER}, `, "m"));
  assert.match(beidePushes, new RegExp(`^Wartet: PID \\d+, ${PUSH_HALTER}, .*, Vorrang$`, "m"));
  assert.match(nachDenPushes, /^Push-Platz: frei$/m);
  assert.match(nachDenPushes, new RegExp(`^Wartet: PID ${a.kind.pid}, `, "m"));
});

test("ein schwerer Lauf, den die Push-Prüfung selbst startet, wartet nicht auf die belegten gewöhnlichen Plätze", FRIST, async (context) => {
  const env = umgebung(context);
  await halter(context, env);
  const push = pushUeberDenHook(context, env, { verschachtelt: true });
  assert.equal(await beginntOderWartet(push), "begonnen", push.stderr);
  await beenden(push);

  assert.equal(push.kind.exitCode, 0, push.stdout + push.stderr);
});

test("ein Alleinlauf hält auch die Push-Prüfung zurück, bis er fertig ist", FRIST, async (context) => {
  const env = umgebung(context);
  const allein = starteArbeit(context, "allein", { env, optionen: ["--allein"] });
  await allein.begonnen;
  const push = pushUeberDenHook(context, env);
  assert.equal(await beginntOderWartet(push), "wartet", push.stdout);
  await beenden(allein);
  await push.begonnen;
  await beenden(push);

  assert.ok(zeitenVon(allein).ende <= zeitenVon(push).beginn, JSON.stringify([zeitenVon(allein), zeitenVon(push)]));
  assert.deepEqual([allein, push].map(({ kind }) => kind.exitCode), [0, 0]);
});

test("SCHWERLAUF_VORRANG von außen verschafft einem schweren Lauf keinen Vorrang und erreicht seinen Befehl nicht", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const a = starteArbeit(context, "A", { env });
  await a.wartend;
  const vorgedraengt = starte([SCHWERLAUF, "--", process.execPath, "-e", "console.log(process.env.SCHWERLAUF_VORRANG ?? 'ohne')"], {
    env: { ...env, ...VORRANG_VON_AUSSEN },
  });
  context.after(() => vorgedraengt.kind.kill("SIGKILL"));
  await wartet(vorgedraengt);

  gehalten.kind.kill("SIGKILL");
  assert.equal(await erstesVon({ a: a.begonnen, vorgedraengt: vorgedraengt.ende }), "a");
  await beenden(a);
  await vorgedraengt.ende;

  assert.equal(vorgedraengt.kind.exitCode, 0, vorgedraengt.stderr);
  assert.equal(vorgedraengt.stdout, "ohne\n");
});

test("ist der Push-Platz belegt und ein gewöhnlicher Platz frei, startet ein weiterer Push sofort auf dem gewöhnlichen Platz", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const gehalten = await halter(context, env);
  const erster = await beginnenderPush(context, env, "push-1");
  const zweiter = await beginnenderPush(context, env, "push-2");
  const belegt = await stand(env);
  await beenden(erster);
  await beenden(zweiter);

  assert.deepEqual([erster, zweiter].map(({ kind }) => kind.exitCode), [0, 0]);
  assert.match(belegt, new RegExp(`^Platz 1: belegt von PID ${gehalten.kind.pid}, Halter im Test, `, "m"));
  assert.match(belegt, haltVonPush("Platz 2"));
  assert.match(belegt, haltVonPush("Push-Platz"));
  assert.match(belegt, /^Wartet: niemand$/m);
});

test("sind der Push-Platz und beide gewöhnlichen Plätze belegt, wartet ein weiterer Push und es laufen nie vier schwere Läufe gleichzeitig", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  await halter(context, env);
  await halter(context, env);
  const erster = await beginnenderPush(context, env, "push-1");
  const zweiter = pushUeberDenHook(context, env, { name: "push-2" });
  assert.equal(await beginntOderWartet(zweiter), "wartet", zweiter.stdout);
  const belegt = await stand(env);
  await beenden(erster);
  await zweiter.begonnen;
  await beenden(zweiter);

  assert.deepEqual([erster, zweiter].map(({ kind }) => kind.exitCode), [0, 0]);
  assert.equal(belegt.match(/belegt von/g).length, ALLE_DREI_PLAETZE_BELEGT, belegt);
  assert.match(belegt, new RegExp(`^Wartet: PID \\d+, ${PUSH_HALTER}, .*, Vorrang$`, "m"));
  assert.ok(zeitenVon(erster).ende <= zeitenVon(zweiter).beginn, JSON.stringify([zeitenVon(erster), zeitenVon(zweiter)]));
});

test("ist der Push-Platz frei und sind beide gewöhnlichen Plätze belegt, wartet ein gewöhnlicher Lauf weiter", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const gehalten = await halter(context, env);
  await halter(context, env);
  const gewoehnlich = starteArbeit(context, "gewoehnlich", { env });
  await gewoehnlich.wartend;
  const wartend = await stand(env);
  gehalten.kind.kill("SIGKILL");
  await gewoehnlich.begonnen;
  const danach = await stand(env);
  await beenden(gewoehnlich);

  assert.match(wartend, /^Push-Platz: frei$/m);
  assert.match(wartend, new RegExp(`^Wartet: PID ${gewoehnlich.kind.pid}, `, "m"));
  assert.match(danach, new RegExp(`^Platz 1: belegt von PID ${gewoehnlich.kind.pid}, `, "m"));
  assert.match(danach, /^Push-Platz: frei$/m);
});

test("ein Push nimmt bei freien Plätzen den Push-Platz, und ein Alleinlauf wartet, solange der Push-Platz belegt ist", FRIST, async (context) => {
  const env = umgebung(context, ZWEI_PLAETZE);
  const push = await beginnenderPush(context, env, "push");
  const nurPush = await stand(env);
  const allein = starteArbeit(context, "allein", { env, optionen: ["--allein"] });
  assert.equal(await beginntOderWartet(allein), "wartet", allein.stdout);
  await beenden(push);
  await allein.begonnen;
  await beenden(allein);

  assert.match(nurPush, haltVonPush("Push-Platz"));
  assert.match(nurPush, /^Platz 1: frei$/m);
  assert.match(nurPush, /^Platz 2: frei$/m);
  assert.ok(zeitenVon(push).ende <= zeitenVon(allein).beginn, JSON.stringify([zeitenVon(push), zeitenVon(allein)]));
  assert.deepEqual([push, allein].map(({ kind }) => kind.exitCode), [0, 0]);
});
