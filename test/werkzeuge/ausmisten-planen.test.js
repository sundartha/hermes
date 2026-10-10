import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SCHWELLE_MINUTEN,
  geschaetzteSekunden,
  packe,
} from "../../tools/tests-ausmisten/planen.mjs";

const SEKUNDEN_JE_MINUTE = 60;
const SCHWELLE_SEKUNDEN = SCHWELLE_MINUTEN * SEKUNDEN_JE_MINUTE;
const TESTLAUF_LAUF_37985787064 = 27.3;
const KNAPP_UEBER_DER_SCHWELLE = 988;

function verteilt({ anzahl, von, bis }) {
  return Array.from({ length: anzahl }, (_leer, nummer) => {
    const zeile = von + (nummer % (bis - von + 1));
    return [zeile, zeile];
  });
}

function quelle({ datei, umfassend = [], einzeilig }) {
  const orte = [...umfassend.map(({ von, bis }) => [von, bis]), ...einzeilig.flatMap(verteilt)];
  return { datei, mutanten: orte.length, orte };
}

const CONFIG = quelle({
  datei: "src/config.js",
  umfassend: [{ von: 275, bis: 867 }],
  einzeilig: [
    { anzahl: 634, von: 276, bis: 866 },
    { anzahl: 418, von: 21, bis: 274 },
    { anzahl: 418, von: 868, bis: 1157 },
  ],
});
const PG = quelle({
  datei: "src/store/pg.js",
  umfassend: [
    { von: 20, bis: 645 },
    { von: 111, bis: 644 },
  ],
  einzeilig: [
    { anzahl: 331, von: 21, bis: 644 },
    { anzahl: 766, von: 646, bis: 1907 },
  ],
});
const DAVOR = { anzahl: 100, von: 1, bis: 100 };
const UNTEILBAR = { von: 101, bis: 2100, mutanten: 1500 };
const DANACH = { anzahl: 100, von: 2101, bis: 2200 };
const GANZE_DATEIEN = ["src/a.js", "src/b.js", "src/c.js"];
const MUTANTEN_JE_GANZER_DATEI = 400;

function liegtIn([von, bis], teil) {
  return von >= teil.von && bis <= (teil.bis ?? Infinity);
}

function teileVon(pakete, datei) {
  return pakete.filter(({ dateien }) => dateien.includes(datei));
}

test("ausmisten-planen: config.js und pg.js aus Lauf 37985787064 werden unter die Schwelle geschnitten, ohne einen Mutanten zu verlieren", () => {
  const ungeteilt = geschaetzteSekunden(CONFIG.mutanten + PG.mutanten, TESTLAUF_LAUF_37985787064);
  assert.ok(ungeteilt > SCHWELLE_SEKUNDEN);

  const pakete = packe([CONFIG, PG], TESTLAUF_LAUF_37985787064);

  for (const paket of pakete) assert.ok(paket.sekunden <= SCHWELLE_SEKUNDEN, JSON.stringify(paket));
  for (const { datei, orte } of [CONFIG, PG]) {
    const teile = teileVon(pakete, datei);
    assert.ok(teile.length > 1, datei);
    for (const ort of orte) {
      const treffer = teile.filter(({ teil }) => liegtIn(ort, teil));
      assert.equal(treffer.length, 1, `${datei} ${ort}`);
    }
    for (const { mutanten, teil } of teile) {
      assert.equal(
        mutanten,
        orte.filter((ort) => liegtIn(ort, teil)).length,
        `${datei} ${teil.von}`,
      );
    }
  }
  const summe = pakete.reduce((gesamt, { mutanten }) => gesamt + mutanten, 0);
  assert.equal(summe, CONFIG.mutanten + PG.mutanten);
});

test("ausmisten-planen: eine Datei knapp über der Schwelle wird in zwei Teile geschnitten", () => {
  const datei = quelle({
    datei: "src/knapp.js",
    einzeilig: [{ anzahl: KNAPP_UEBER_DER_SCHWELLE, von: 1, bis: KNAPP_UEBER_DER_SCHWELLE }],
  });

  const pakete = packe([datei], TESTLAUF_LAUF_37985787064);

  assert.deepEqual(
    pakete.map(({ teil }) => teil),
    [
      { von: 1, bis: KNAPP_UEBER_DER_SCHWELLE - 1 },
      { von: KNAPP_UEBER_DER_SCHWELLE, bis: null },
    ],
  );
});

test("ausmisten-planen: ein Block, der sich nicht unter die Schwelle schneiden lässt, wird ein eigener Teil", () => {
  const { von, bis, mutanten } = UNTEILBAR;
  const datei = quelle({
    datei: "src/block.js",
    umfassend: [{ von, bis }],
    einzeilig: [DAVOR, { anzahl: mutanten - 1, von: von + 1, bis: bis - 1 }, DANACH],
  });
  assert.ok(geschaetzteSekunden(mutanten, TESTLAUF_LAUF_37985787064) > SCHWELLE_SEKUNDEN);

  const pakete = packe([datei], TESTLAUF_LAUF_37985787064);

  assert.deepEqual(
    pakete.map(({ teil, mutanten: anzahl }) => ({ ...teil, anzahl })),
    [
      { von: 1, bis: von - 1, anzahl: DAVOR.anzahl },
      { von, bis, anzahl: mutanten },
      { von: bis + 1, bis: null, anzahl: DANACH.anzahl },
    ],
  );
});

test("ausmisten-planen: ganze Dateien, die zusammen über der Schwelle liegen, kommen in getrennte Pakete", () => {
  const zahlen = GANZE_DATEIEN.map((datei) =>
    quelle({
      datei,
      einzeilig: [{ anzahl: MUTANTEN_JE_GANZER_DATEI, von: 1, bis: MUTANTEN_JE_GANZER_DATEI }],
    }),
  );
  const jeDatei = geschaetzteSekunden(MUTANTEN_JE_GANZER_DATEI, TESTLAUF_LAUF_37985787064);
  assert.ok(jeDatei <= SCHWELLE_SEKUNDEN);
  assert.ok(jeDatei * GANZE_DATEIEN.length > SCHWELLE_SEKUNDEN);

  const pakete = packe(zahlen, TESTLAUF_LAUF_37985787064);

  assert.ok(pakete.length > 1);
  for (const paket of pakete) {
    assert.equal(paket.teil, undefined);
    assert.ok(paket.dateien.length * jeDatei <= SCHWELLE_SEKUNDEN, JSON.stringify(paket));
  }
  assert.deepEqual(pakete.flatMap(({ dateien }) => dateien).toSorted(), GANZE_DATEIEN);
});
