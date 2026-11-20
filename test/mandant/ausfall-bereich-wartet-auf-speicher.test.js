import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import { makePgTestStore } from "../pg-helpers.js";

const NICHT_GEOEFFNET = "Speicher nicht geoeffnet";
const ANRUFE = [{ id: "call_1" }];

const { store: echterSpeicher } = await makePgTestStore();

function speicherMit(ausfallSql) {
  return new Proxy(echterSpeicher, {
    get: (ziel, name) => (name === "ausfallSql" ? ausfallSql : Reflect.get(ziel, name)),
  });
}

test("ausfall-bereich: Bereich lässt sich bauen, solange der Speicher noch nicht geöffnet ist", () => {
  const bereich = speicherBereiche(
    speicherMit(() => {
      throw new Error(NICHT_GEOEFFNET);
    }),
  ).ausfall;
  assert.equal(typeof bereich.notizClaimen, "function");
  assert.equal(typeof bereich.offeneAusfallZustand, "function");
});

test("ausfall-bereich: erst die Operation löst den Speicher auf und wirft, wenn er nicht bereit ist", async () => {
  const bereich = speicherBereiche(
    speicherMit(() => {
      throw new Error(NICHT_GEOEFFNET);
    }),
  ).ausfall;
  await assert.rejects(() => bereich.notizClaimen({ code: "c", nowMs: 1 }), new RegExp(NICHT_GEOEFFNET));
});

test("ausfall-bereich: nach dem Öffnen läuft die Operation über SQL, Urteil und Zustand bekommen die Anrufe", async () => {
  let bereit = false;
  const aufrufe = [];
  const sql = {
    notizClaimen: async (eingabe) => aufrufe.push(["notiz", eingabe]) && "sql-notiz",
    urteilClaimen: async (eingabe, calls) => aufrufe.push(["urteil", eingabe, calls]) && "sql-urteil",
    offeneAusfallZustand: async (calls) => aufrufe.push(["zustand", calls]) && "sql-zustand",
  };
  const speicher = new Proxy(echterSpeicher, {
    get: (ziel, name) => {
      if (name === "exportTenantDataGelesen") return async () => ({ calls: ANRUFE });
      if (name !== "ausfallSql") return Reflect.get(ziel, name);
      return () => {
        if (!bereit) throw new Error(NICHT_GEOEFFNET);
        return sql;
      };
    },
  });
  const bereich = speicherBereiche(speicher).ausfall;
  bereit = true;
  assert.equal(await bereich.notizClaimen({ code: "c", nowMs: 1 }), "sql-notiz");
  assert.equal(await bereich.urteilClaimen({ bucket: "b" }), "sql-urteil");
  assert.equal(await bereich.offeneAusfallZustand(), "sql-zustand");
  assert.deepEqual(aufrufe, [
    ["notiz", { code: "c", nowMs: 1 }],
    ["urteil", { bucket: "b" }, ANRUFE],
    ["zustand", ANRUFE],
  ]);
});

test("ausfall-bereich: ohne SQL-Speicher und für Operationen ohne SQL-Form gilt der JSON-Pfad", async () => {
  const ohne = speicherBereiche(speicherMit(undefined)).ausfall;
  assert.equal(await ohne.offenerMarker({ code: "x" }), undefined);
  const mitSql = speicherBereiche(speicherMit(() => ({}))).ausfall;
  assert.deepEqual(await mitSql.holdKandidaten({ nowMs: 1, istKandidat: () => true }), []);
});
