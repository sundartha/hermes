import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import pg from "pg";

import { createPgPoolRunner } from "../../src/store/pg-runner.js";
import { mitAnrufSperre } from "../../src/store/anruf-sperre-pg.js";

const MANDANT = "tenant_verwerfen";

function pruefPool(scheitert) {
  const freigaben = [];
  pg.Pool = class PruefPool extends EventEmitter {
    waitingCount = 0;
    totalCount = 0;
    async connect() {
      return {
        query: async (text) => {
          if (scheitert(text)) throw new Error(`fehler bei ${text}`);
          return { rows: [] };
        },
        release: (fehler) => freigaben.push(fehler),
        on() {},
      };
    }
  };
  return freigaben;
}

async function sperreMit(scheitert, arbeit) {
  const freigaben = pruefPool(scheitert);
  const { runner } = await createPgPoolRunner("postgres://verwerfen.invalid/hermes");
  const lauf = await mitAnrufSperre(runner, MANDANT, arbeit).then(
    (wert) => ({ wert }),
    (fehler) => ({ fehler }),
  );
  return { freigaben, ...lauf };
}

test("scheitern Aufheben und Aufheben-aller, wird die Verbindung verworfen und das Ergebnis bleibt", async (t) => {
  t.mock.method(console, "error", () => {});
  const { freigaben, wert } = await sperreMit((text) => /pg_advisory_unlock/.test(text), async () => "bleibt");
  assert.equal(wert, "bleibt");
  assert.equal(freigaben.length, 1);
  assert.match(freigaben[0].message, /pg_advisory_unlock_all/);
});

test("gelingt das Aufheben erst ueber unlock_all, geht die Verbindung in den Pool zurueck", async (t) => {
  t.mock.method(console, "error", () => {});
  const { freigaben, wert } = await sperreMit((text) => /^SELECT pg_advisory_unlock\(/.test(text), async () => "bleibt");
  assert.equal(wert, "bleibt");
  assert.deepEqual(freigaben, [undefined]);
});

test("gelingt das Aufheben, geht die Verbindung in den Pool zurueck", async () => {
  const { freigaben } = await sperreMit(() => false, async () => "ok");
  assert.deepEqual(freigaben, [undefined]);
});

test("der Fehler der Arbeit bleibt, auch wenn die Verbindung verworfen wird", async (t) => {
  t.mock.method(console, "error", () => {});
  const { freigaben, fehler } = await sperreMit((text) => /pg_advisory_unlock/.test(text), async () => {
    throw new Error("arbeit kaputt");
  });
  assert.match(fehler.message, /arbeit kaputt/);
  assert.match(freigaben[0].message, /pg_advisory_unlock_all/);
});
