import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { logBis } from "./log-bis.mjs";

const ZEILE = "[pg] einstellungen nachladen fehlgeschlagen: Frist abgelaufen";

function kindAttrappe() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const text = { stand: "" };
  stderr.on("data", (stueck) => (text.stand += stueck.toString()));
  stdout.on("data", (stueck) => (text.stand += stueck.toString()));
  return {
    child: { stdout, stderr },
    get stdout() {
      return text.stand;
    },
  };
}

test("logBis: eine Zeile, die erst nach dem Aufruf ankommt, beendet das Warten", async () => {
  const instanz = kindAttrappe();
  const gewartet = logBis(instanz, ZEILE);
  let fertig = false;
  gewartet.then(() => (fertig = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fertig, false);

  instanz.child.stderr.write(`${ZEILE}\n`);

  await gewartet;
});

test("logBis: eine schon vorhandene Zeile beendet das Warten sofort", async () => {
  const instanz = kindAttrappe();
  instanz.child.stdout.write(`${ZEILE}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  await logBis(instanz, ZEILE);
});

test("logBis: eine Zeile vor dem Stand ab zaehlt nicht, eine danach schon", async () => {
  const instanz = kindAttrappe();
  instanz.child.stderr.write(`${ZEILE}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  const ab = instanz.stdout.length;
  const abbruch = new AbortController();
  const gewartet = logBis(instanz, ZEILE, { ab, signal: abbruch.signal });

  abbruch.abort();
  await assert.rejects(gewartet, /Logzeile nicht erschienen/);

  const zweiter = logBis(instanz, ZEILE, { ab });
  instanz.child.stderr.write(`${ZEILE}\n`);
  await zweiter;
});

test("logBis: ohne die Zeile endet das Warten mit der Frist und nennt Zeile und Log", async () => {
  const instanz = kindAttrappe();
  instanz.child.stdout.write("anderes\n");
  await new Promise((resolve) => setImmediate(resolve));
  const abbruch = new AbortController();
  const gewartet = logBis(instanz, ZEILE, { signal: abbruch.signal });

  abbruch.abort();

  await assert.rejects(gewartet, (fehler) => {
    assert.ok(fehler.message.includes(ZEILE));
    assert.ok(fehler.message.includes("anderes"));
    return true;
  });
  assert.equal(instanz.child.stderr.listenerCount("data"), 1);
});

test("logBis: eine schon abgelaufene Frist lehnt sofort ab", async () => {
  const instanz = kindAttrappe();
  const abbruch = new AbortController();
  abbruch.abort();

  await assert.rejects(logBis(instanz, ZEILE, { signal: abbruch.signal }), /nicht erschienen/);
});
