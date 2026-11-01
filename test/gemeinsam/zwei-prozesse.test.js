import assert from "node:assert/strict";
import { test } from "node:test";

import { anfrage, beenden, zweiProzesse } from "./zwei-prozesse.js";

const HTTP_OK = 200;
const SAUBER_BEENDET = 0;
const ZEITGRENZE_MS = 60_000;

test(
  "Zwei Prozesse: A und B starten nacheinander auf derselben echten Datenbank und antworten beide auf /healthz",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const prozesse = await zweiProzesse(t);
    if (!prozesse) return;
    const { a, b } = prozesse;
    assert.notEqual(a.port, b.port);
    for (const prozess of [a, b]) {
      const antwort = await anfrage(prozess, "/healthz");
      assert.equal(antwort.status, HTTP_OK);
      assert.equal((await antwort.json()).ok, true);
    }
    assert.equal(await beenden(b), SAUBER_BEENDET);
    assert.equal(await beenden(a), SAUBER_BEENDET);
  },
);
