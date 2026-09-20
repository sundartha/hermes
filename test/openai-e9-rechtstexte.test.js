// E9 - Rechtstexte: die Aussagen der Datenschutzerklaerung sind an den Code genaeht.
//
// WARUM ein Test auf einem Rechtstext: der Befund, der diese Etappe ausgeloest hat
// (tasks/openai-fix/S7-rechtstexte.md), ist entstanden, weil ein Anbieterwechsel den
// Text still falsch gemacht hat und niemand die Frage gestellt hat. T1 stellt sie bei
// jedem Lauf - ein rotes Gate bei Anbieter-Umbau ist die GEWOLLTE Wirkung, der Fix ist
// eine Textzeile, nie eine Abschaltung des Tests (S7/D8, Pre-Mortem 3).
//
// Zwei Baenke in EINER Datei: die Zuordnung laeuft ueber den Testnamen
// (package.json config.abnahmePattern), nicht ueber die Datei.
//
// KEIN eigener Mechanik-Fall fuer indexLegalContent: den fuehrt
// test/legal-content.test.js bereits ueber genau diese drei Echtdateien
// ("Echtdaten-Gate"). Dieselbe Pruefung zweimal waere Duplizierung (G5).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const LEGAL_DIR = path.join(ROOT, "apps/web/src/data/legal");
const PRIVACY_FILE = "privacy.de.json";
const IMPRINT_FILE = "imprint.de.json";
const TERMS_FILE = "terms.de.json";

const ADAPTER_DIRS = Object.freeze([
  path.join(ROOT, "src/llm/adapters"),
  path.join(ROOT, "src/research/adapters"),
]);

// Anzeigename je gebauter Adapter-Datei. Bewusst eine Karte IM TEST und keine Ableitung
// aus dem Dateinamen: der Rechtstext nennt den ANBIETER, nicht das Modul. Ein neuer
// Adapter ohne Eintrag laesst requireProviderDisplayNames werfen - stilles
// Ueberspringen sieht aus wie ein bestandener Test (Lehre: Pruefkommando ohne
// Positiv-Kontrolle).
const PROVIDER_DISPLAY_NAMES = Object.freeze({
  "anthropic.js": "Anthropic",
  "deepseek.js": "DeepSeek",
  "anthropic-web-search.js": "Anthropic",
  "exa-search.js": "Exa",
});

const OFFEN_MARKER = "[OFFEN:";
const ASSISTENT_HEADING = "Anbindung an einen KI-Assistenten";
const KEIN_AUDIO_SATZ = "Audio wird über diese Anbindung nie übertragen";

// Aussagen, die der Bestand vor E9 getroffen hat und die dem Code widersprachen
// (S7 Abschnitt 3: F2, F3, F6). Sie duerfen nicht zurueckkehren.
const WIDERLEGTE_AUSSAGEN = Object.freeze([
  "kein Audio der Gesprächspartner",
  "nicht aktiv",
  "vollständige Löschung",
]);

function legalDocument(fileName) {
  return JSON.parse(fs.readFileSync(path.join(LEGAL_DIR, fileName), "utf8"));
}

function documentText(doc) {
  const abschnitte = doc.sections.map((section) => `${section.heading}\n${section.text}`);
  return [doc.note ?? "", ...abschnitte].join("\n");
}

function sectionByHeading(doc, heading) {
  return doc.sections.find((section) => section.heading === heading) ?? null;
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function adapterFileNames() {
  return ADAPTER_DIRS.flatMap((dir) => fs.readdirSync(dir)).filter((name) => name.endsWith(".js"));
}

function requireProviderDisplayNames(fileNames) {
  const namen = fileNames.map((fileName) => {
    const anzeigename = PROVIDER_DISPLAY_NAMES[fileName];
    if (!anzeigename) {
      throw new Error(
        `Anbieter-Adapter ohne Anzeigenamen: ${fileName} - Karte in dieser Testdatei ergaenzen UND den Anbieter in apps/web/src/data/legal/${PRIVACY_FILE} nennen`,
      );
    }
    return anzeigename;
  });
  return [...new Set(namen)];
}

function offenMarkerCount(fileName) {
  return countOccurrences(documentText(legalDocument(fileName)), OFFEN_MARKER);
}

// --- Regressionsbank (npm test) -----------------------------------------------------

test("Anbieter-Naht: jeder gebaute Sprachmodell- und Such-Adapter ist in der Datenschutzerklaerung genannt", () => {
  const text = documentText(legalDocument(PRIVACY_FILE));
  for (const anzeigename of requireProviderDisplayNames(adapterFileNames())) {
    assert.ok(text.includes(anzeigename), `Anbieter "${anzeigename}" fehlt in ${PRIVACY_FILE}`);
  }
});

test("Negativ-Kontrolle zur Anbieter-Naht: ein unbekannter Adapter laesst die Pruefung werfen", () => {
  assert.throws(() => requireProviderDisplayNames(["neuer-anbieter.js"]), /neuer-anbieter\.js/);
});

test("Datenschutzerklaerung traegt keine der vor E9 widerlegten Aussagen mehr", () => {
  const text = documentText(legalDocument(PRIVACY_FILE));
  const treffer = WIDERLEGTE_AUSSAGEN.filter((satz) => text.includes(satz));
  assert.deepEqual(treffer, [], `widerlegte Aussage(n) wieder im Text: ${treffer.join(" | ")}`);
});

test("Assistenten-Anbindung hat einen eigenen Abschnitt - mit Wortprotokoll und ohne Audio", () => {
  const abschnitt = sectionByHeading(legalDocument(PRIVACY_FILE), ASSISTENT_HEADING);
  assert.ok(abschnitt, `Abschnitt "${ASSISTENT_HEADING}" fehlt in ${PRIVACY_FILE}`);
  assert.ok(abschnitt.text.includes("Wortprotokoll"), "Abschnitt nennt das Wortprotokoll nicht");
  assert.ok(abschnitt.text.includes(KEIN_AUDIO_SATZ), "Abschnitt sagt nicht, dass kein Audio geht");
});

// Fund S1 (Review Runde 1): "Brevo und Zoho verarbeiten in der EU" im Abschnitt
// "Uebermittlung in Drittlaender" widersprach der [OFFEN]-Marke beim SMTP-Ersatzweg
// (Verarbeitungsort dort unbekannt). Zoho darf im Text nicht mehr namentlich als
// EU-Verarbeiter auftauchen, solange der Ersatzweg-Anbieter [OFFEN] ist.
test("Datenschutzerklaerung nennt Zoho nicht als EU-Verarbeiter, solange der SMTP-Ersatzweg offen ist", () => {
  const text = documentText(legalDocument(PRIVACY_FILE));
  assert.ok(!text.includes("Zoho"), "Zoho darf nicht mehr genannt werden - der Ersatzweg-Anbieter ist [OFFEN]");
});

// Fund S1 (Review Runde 1): der Telnyx-Rueckfall-Abschnitt nannte nur noch Deepgram
// (STT), obwohl derselbe Weg die Assistenten-Stimme ueber Microsoft-Azure-Sprachsynthese
// erzeugt (TELNYX_VOICE_NAME in src/telephony/adapters/telnyx/render.js). Eine
// Unterauftragsverarbeiter-Nennung ohne diesen Anbieter waere unvollstaendig.
test("Datenschutzerklaerung nennt Microsoft/Azure als Unterauftragsverarbeiter auf dem Telnyx-Weg", () => {
  const text = documentText(legalDocument(PRIVACY_FILE));
  assert.ok(text.includes("Microsoft"), "Microsoft/Azure fehlt als Unterauftragsverarbeiter der Telnyx-Sprachausgabe");
});

// --- Abnahmebank (npm run test:abnahme, DARF rot sein) ------------------------------

test("ABNAHME-E9-1: Impressum und AGB tragen keine [OFFEN]-Marke mehr | ROT WEIL: Firmenname, Rechtsform, ladungsfaehige Anschrift, Vertretung, Telefonnummer, Register, USt-IdNr. und die Entscheidung zum vorzeitigen Leistungsbeginn liegen nicht vor (OWNER-EINGABE OE-1/OE-7) | FIX: Owner liefert die Angaben; A8/A9 der Spec traegt sie Wort fuer Wort ein und entfernt einen Abschnitt, dessen Angabe ersatzlos entfaellt", () => {
  assert.deepEqual(
    { imprint: offenMarkerCount(IMPRINT_FILE), terms: offenMarkerCount(TERMS_FILE) },
    { imprint: 0, terms: 0 },
  );
});

test("ABNAHME-E9-2: Datenschutzerklaerung traegt keine [OFFEN]-Marke mehr | ROT WEIL: Anschrift der verantwortlichen Stelle, Angabe zum Datenschutzbeauftragten, Vertragsgrundlagen je Anbieter inkl. DeepSeek, SMTP-Anbieter des Ersatzwegs, DPF-Pruefung und Render-Protokollfrist stehen aus (OWNER-EINGABE OE-2 bis OE-6); die zwei Anbieter-Messungen M-1/M-2 liegen seit 20.09.2026 vor und blockieren nicht mehr | FIX: Owner liefert OE-2 bis OE-6 und traegt die Angaben an den markierten Stellen ein", () => {
  assert.equal(offenMarkerCount(PRIVACY_FILE), 0);
});
