const VERBINDUNGSFEHLER = /^API Error: (?:Connection dropped \(ECONNRESET\)|Can't reach the API server — check your internet or DNS \(ENOTFOUND\))$/;

export function netzabbruch(lauf) {
  return lauf.exitCode !== 0 && VERBINDUNGSFEHLER.test((lauf.volleAntwort ?? "").trim());
}

const MS_JE_SEKUNDE = 1000;

export function meldeNetzabbruch({ rolle, sitzung, versuch, versuche, wartezeitMs, fehler }) {
  const eintrag = { rolle, sitzung, versuch, zeit: new Date().toISOString(), fehler: fehler.trim(), warteS: wartezeitMs / MS_JE_SEKUNDE };
  console.log(`${eintrag.zeit} ${rolle}: ${eintrag.fehler}; Sitzung ${sitzung} wird nach ${eintrag.warteS} s fortgesetzt (Versuch ${versuch} von ${versuche}).`);
  return eintrag;
}
