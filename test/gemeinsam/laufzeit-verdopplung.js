import assert from "node:assert/strict";

const HALBE_LAENGE = 500000;
const VOLLE_LAENGE = 1000000;
const LAEUFE_JE_LAENGE = 5;
const HOECHSTES_VERHAELTNIS = 3;

function textAusEinheit(einheit, laenge) {
  return einheit.repeat(Math.round(laenge / einheit.length));
}

function dauerMs(pruefe, text) {
  const begin = performance.now();
  pruefe(text);
  return performance.now() - begin;
}

function median(werte) {
  return [...werte].sort((links, rechts) => links - rechts)[Math.floor(werte.length / 2)];
}

export function pruefeLaufzeitVerdopplung(einheit, pruefe) {
  const halb = textAusEinheit(einheit, HALBE_LAENGE);
  const voll = textAusEinheit(einheit, VOLLE_LAENGE);
  pruefe(halb);
  const dauernHalb = [];
  const dauernVoll = [];
  for (let lauf = 0; lauf < LAEUFE_JE_LAENGE; lauf += 1) {
    dauernHalb.push(dauerMs(pruefe, halb));
    dauernVoll.push(dauerMs(pruefe, voll));
  }
  assert.equal(pruefe(halb), halb);
  assert.equal(pruefe(voll), voll);
  const verhaeltnis = median(dauernVoll) / median(dauernHalb);
  assert.ok(
    verhaeltnis <= HOECHSTES_VERHAELTNIS,
    `kein exponentielles Verhalten: Verhältnis voll gegen halb ${verhaeltnis.toFixed(2)}`,
  );
}
