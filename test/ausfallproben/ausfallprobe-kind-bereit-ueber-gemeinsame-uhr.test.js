import { test } from "node:test";
import assert from "node:assert/strict";
import { warteBereit } from "../../scripts/ausfallproben/hermes-kind.mjs";
import { BEREIT_FRIST_MS } from "../../scripts/ausfallproben/schwellen.mjs";

const NICHT_DA = { status: null, schaden: null, ms: 0 };
const OK = { status: 200, schaden: null, ms: 10 };

function lauf(kind, antwort) {
  const uhr = { jetzt: 0, messungen: 0 };
  const optionen = {
    messe: async () => {
      uhr.messungen += 1;
      return antwort(uhr.jetzt);
    },
    jetzt: () => uhr.jetzt,
    pause: async (ms) => void (uhr.jetzt += ms),
  };
  return warteBereit(kind, optionen).then((bereit) => ({ bereit, uhr }));
}

const lebt = () => ({ url: "x", prozess: { exitCode: null } });

test("kind-bereit: ein lebendes Kind, das erst nach 45 s Uhr-Zeit 200 liefert, ist bereit", async () => {
  const { bereit } = await lauf(lebt(), (jetzt) => (jetzt >= 45_000 ? OK : NICHT_DA));
  assert.equal(bereit, true);
});

test("kind-bereit: ein Kind, das sofort 200 liefert, ist nach einer Messung bereit", async () => {
  const { bereit, uhr } = await lauf(lebt(), () => OK);
  assert.equal(bereit, true);
  assert.equal(uhr.messungen, 1);
});

test("kind-bereit: ein beendetes Kind ist sofort nicht bereit, ohne zu messen", async () => {
  const kind = { url: "x", prozess: { exitCode: 1 } };
  const { bereit, uhr } = await lauf(kind, () => OK);
  assert.equal(bereit, false);
  assert.equal(uhr.messungen, 0);
});

test("kind-bereit: endet das Kind waehrend des Wartens, ist es sofort nicht bereit", async () => {
  const kind = lebt();
  const { bereit, uhr } = await lauf(kind, (jetzt) => {
    if (jetzt >= 1000) kind.prozess.exitCode = 1;
    return NICHT_DA;
  });
  assert.equal(bereit, false);
  assert.ok(uhr.jetzt < 2000);
});

test("kind-bereit: ein lebendes Kind ohne 200 nach der Frist ist nicht bereit", async () => {
  const { bereit, uhr } = await lauf(lebt(), () => NICHT_DA);
  assert.equal(bereit, false);
  assert.ok(uhr.jetzt >= BEREIT_FRIST_MS);
  assert.ok(BEREIT_FRIST_MS > 45_000);
});

test("kind-bereit: eine Messung, die selbst die Frist verbraucht, zaehlt ihre verstrichene Zeit", async () => {
  const uhr = { jetzt: 0 };
  const bereit = await warteBereit(lebt(), {
    messe: async () => {
      uhr.jetzt += BEREIT_FRIST_MS;
      return NICHT_DA;
    },
    jetzt: () => uhr.jetzt,
    pause: async () => {},
  });
  assert.equal(bereit, false);
});
