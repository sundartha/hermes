import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { PRE_PUSH_HOOK, PRUEFLEITER_TOOL, probeRepository, runIn } from "./probe-repo.js";
import { FRIST, SCHWERLAUF, halter, stand, starte, starteArbeit, umgebung, wartet, zeitenVon } from "./schwerlauf-lauf.js";

const UPSTREAM_BASE_REF = "refs/remotes/upstream/master";
const VORRANG_VON_AUSSEN = { SCHWERLAUF_VORRANG: "push" };

function pushRepo(context, env) {
  const pruefleiter = `SCHWERLAUF_SPERRDATEI=${JSON.stringify(env.SCHWERLAUF_SPERRDATEI)} ${JSON.stringify(process.execPath)} ${JSON.stringify(PRUEFLEITER_TOOL)}`;
  const verzeichnis = probeRepository(context, {
    "package.json": JSON.stringify({
      name: "schwerlauf-reihenfolge-probe",
      private: true,
      scripts: { lint: "true", "test:betroffen": `${JSON.stringify(process.execPath)} arbeit.js`, pruefleiter },
    }),
    "arbeit.js": 'console.log(JSON.stringify({ name: "push", beginn: Date.now() }));',
  });
  runIn(verzeichnis, "git", ["update-ref", UPSTREAM_BASE_REF, "HEAD"]);
  return verzeichnis;
}

function pushUeberDenHook(context, env) {
  const verzeichnis = pushRepo(context, env);
  const lauf = starte([PRE_PUSH_HOOK], { env: { ...env, GIT_DIR: join(verzeichnis, ".git") }, cwd: verzeichnis, programm: "sh" });
  context.after(() => lauf.kind.kill("SIGKILL"));
  return lauf;
}

function erstesVon(laeufe) {
  return Promise.race(Object.entries(laeufe).map(([name, ereignis]) => ereignis.then(() => name)));
}

async function beenden(lauf) {
  lauf.kind.stdin.end();
  await lauf.ende;
}

test("wird der Platz frei, bekommt ihn zuerst der wartende Push, danach die übrigen in der Reihenfolge ihres Wartebeginns", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const a = starteArbeit(context, "A", { env });
  await a.wartend;
  const b = starteArbeit(context, "B", { env });
  await b.wartend;
  const push = pushUeberDenHook(context, env);
  await wartet(push);

  const wartende = (await stand(env)).split("\n").filter((zeile) => zeile.startsWith("Wartet: "));
  gehalten.kind.kill("SIGKILL");
  assert.equal(await erstesVon({ a: a.begonnen, b: b.begonnen }), "a");
  await beenden(a);
  await b.begonnen;
  await beenden(b);
  await push.ende;

  assert.equal(push.kind.exitCode, 0, push.stdout + push.stderr);
  assert.ok(zeitenVon(push).beginn < zeitenVon(a).beginn, `Push begann ${zeitenVon(push).beginn}, A begann ${zeitenVon(a).beginn}`);
  assert.ok(zeitenVon(a).ende <= zeitenVon(b).beginn);
  assert.equal(wartende.length, 3, wartende.join("\n"));
  assert.match(wartende[0], /^Wartet: PID \d+, pruefleiter --basis upstream\/master --ohne-werkzeugtests, .*, Vorrang$/);
  assert.match(wartende[1], new RegExp(`^Wartet: PID ${a.kind.pid}, `));
  assert.match(wartende[2], new RegExp(`^Wartet: PID ${b.kind.pid}, `));
  assert.doesNotMatch(wartende.slice(1).join("\n"), /Vorrang/);
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
