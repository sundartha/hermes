import assert from "node:assert/strict";

const HALBE_LAENGE = 500000;
const VOLLE_LAENGE = 1000000;
const LAEUFE_JE_LAENGE = 9;
const MINDESTDAUER_EINER_MESSUNG_MS = 300;
const HOECHSTES_VERHAELTNIS = 3;

function textAusEinheit(einheit, laenge) {
  return einheit.repeat(Math.round(laenge / einheit.length));
}

function dauerJeAufrufMs(pruefe, text) {
  const begin = performance.now();
  let aufrufe = 0;
  let verstrichen;
  do {
    pruefe(text);
    aufrufe += 1;
    verstrichen = performance.now() - begin;
  } while (verstrichen < MINDESTDAUER_EINER_MESSUNG_MS);
  return verstrichen / aufrufe;
}

function median(werte) {
  const sortiert = [...werte].sort((a, b) => a - b);
  return sortiert[Math.floor(sortiert.length / 2)];
}

export function pruefeLaufzeitVerdopplung(einheit, pruefe) {
  const halb = textAusEinheit(einheit, HALBE_LAENGE);
  const voll = textAusEinheit(einheit, VOLLE_LAENGE);
  pruefe(halb);
  pruefe(voll);
  const verhaeltnisse = [];
  for (let lauf = 0; lauf < LAEUFE_JE_LAENGE; lauf += 1) {
    const halbVorher = dauerJeAufrufMs(pruefe, halb);
    const dauerVoll = dauerJeAufrufMs(pruefe, voll);
    const halbNachher = dauerJeAufrufMs(pruefe, halb);
    verhaeltnisse.push(dauerVoll / ((halbVorher + halbNachher) / 2));
  }
  assert.equal(pruefe(halb), halb);
  assert.equal(pruefe(voll), voll);
  const verhaeltnis = median(verhaeltnisse);
  assert.ok(
    verhaeltnis <= HOECHSTES_VERHAELTNIS,
    `kein exponentielles Verhalten: Verhältnis voll gegen halb ${verhaeltnis.toFixed(2)}`,
  );
}
