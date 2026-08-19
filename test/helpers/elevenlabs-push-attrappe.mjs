// Die Ablauf-Attrappe fuer das schreibende Kommando (scripts/push-elevenlabs.mjs).
//
// GETEILT von test/elevenlabs-push-feldauswahl.test.js und
// test/elevenlabs-push-sperrliste.test.js. Beide messen dieselbe Zusage - "es
// ist nichts rausgegangen" - und zwei eigene Attrappen wuerden gegeneinander
// driften; driftet die eine, hoert genau eine der beiden Suiten still auf zu
// messen, ohne rot zu werden.
//
// KEIN NETZ, NIE. Der Stellvertreter beantwortet JEDEN Aufruf aus dem Speicher
// und schreibt Adresse und Methode mit; api.elevenlabs.io wird nicht beruehrt.
// Die Aufrufliste ist der eigentliche Beleg: "nicht geschrieben" heisst hier
// "kein einziger Aufruf, der nicht GET ist" - gemessen, nicht geglaubt. Ein
// Abbruch NACH dem Senden saehe am Exit-Code genauso aus wie einer davor.

export const METHODE_GET = "GET";
export const KEIN_AUFRUF = 0;
export const EIN_AUFRUF = 1;

// Ein Platzhalter, kein echter Schluessel - er muss gesetzt sein, BEVOR das
// Kommando (und mit ihm src/config.js) geladen wird, sonst bricht es
// fail-closed ab, bevor es zu dem Riegel kaeme, den der Fall messen will.
export const TEST_SCHLUESSEL = "test-schluessel-ohne-netz";

// Der gestellte Live-Agent: bewusst winzig. Er fuehrt genau die beiden
// Datenschutz-Felder mit ihren heutigen Live-Werten (Aufbewahrung an,
// Mitschnitt an - die bewusste Abweichung von der Vorlage) und die Sammlung,
// ohne die das Verbot der Vorlage nichts pruefen koennte. Alles andere fehlt
// und weicht deshalb ab; das ist fuer die gemessenen Aussagen ohne Belang und
// der einzige Weg, den echten Live-Stand nicht ins Repo zu kopieren.
export const LIVE_MIT_DATENSCHUTZ = {
  conversation_config: { language_presets: {} },
  platform_settings: { privacy: { retention_days: -1, record_voice: true } },
};

// Antwortet auf JEDEN Aufruf mit dem gestellten Agenten. Nur ok und text()
// werden vom Kommando gelesen; mehr vorzugaukeln wuerde nur verdecken, was
// wirklich gebraucht wird.
function fetchAttrappe(koerper) {
  const aufrufe = [];
  const stellvertreter = async (adresse, optionen = {}) => {
    aufrufe.push({ adresse: String(adresse), methode: optionen.method || METHODE_GET });
    return { ok: true, text: async () => JSON.stringify(koerper) };
  };
  return { aufrufe, stellvertreter };
}

// runCli wird uebergeben und nicht hier importiert: die Testdatei setzt den
// Schluessel und laedt das Kommando erst danach (dynamischer Import). Wer das
// hier uebernaehme, verschoebe die Ladereihenfolge in eine Datei, in der sie
// niemand vermutet.
export async function laufeMitAttrappe({ runCli, argumente, live = LIVE_MIT_DATENSCHUTZ }) {
  const { aufrufe, stellvertreter } = fetchAttrappe(live);
  const echtesFetch = globalThis.fetch;
  const echtesLog = console.log;
  const echtesError = console.error;
  const zeilen = [];
  globalThis.fetch = stellvertreter;
  console.log = (zeile) => zeilen.push(zeile);
  console.error = (zeile) => zeilen.push(zeile);
  try {
    const code = await runCli(["node", "push-elevenlabs.mjs", ...argumente]);
    return { code, aufrufe, ausgabe: zeilen.join("\n") };
  } finally {
    globalThis.fetch = echtesFetch;
    console.log = echtesLog;
    console.error = echtesError;
  }
}

// Die Aufrufe, die geschrieben haetten. Leer ist die Zusage des Trockenlaufs.
export function schreibendeAufrufe(aufrufe) {
  return aufrufe.filter((aufruf) => aufruf.methode !== METHODE_GET);
}
