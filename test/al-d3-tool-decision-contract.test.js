import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../src/i18n/locales.js";
import { TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";
import { BASE_ENV } from "./helpers.js";

const LANGUAGES = ["de", "en", "fr"];
const toolsOf = (lang) => LOCALES[lang].prompt.tools;

const RULE_FIELD = Object.freeze({
  r1_exclusion: "takeMessageDescription",
  r1_trigger: "getConsultDescription",
  r2_takeMessage: "takeMessageDescription",
  r2_lookUp: "lookUpDescription",
  r3: "lookUpDescription",
  r4: "lookUpDescription",
  b2_exit: "takeMessageDescription",
});

const CONTRACT = Object.freeze({
  de: Object.freeze({
    r1_exclusion: ["Entscheidung deines Auftraggebers", "KEINE Nachricht", "get_consult"],
    r1_trigger: ["Der klare Fall", "verlangt ausdrücklich die Entscheidung deines Auftraggebers", "get_consult"],
    r2_takeMessage: ["look_up", "Sachauskunft"],
    r2_lookUp: ["die Antwort deinen AUFTRAG jetzt weiterbringt"],
    r3: ["NICHT auf", "deinen Auftrag nicht", "Das ist richtig so"],
    r4: ["SELBEN Zug", "look_up", "Sage NIE, dass du nachschaust"],
    b2_exit: "Wird dir das passende Werkzeug in diesem Zug nicht angeboten, bleibt die Nachricht der richtige Weg.",
  }),
  en: Object.freeze({
    r1_exclusion: ["your principal's decision", "do NOT record a message", "get_consult"],
    r1_trigger: ["The clear case", "explicitly asks for your principal's decision", "get_consult"],
    r2_takeMessage: ["look_up", "factual answer"],
    r2_lookUp: ["the answer moves YOUR TASK forward right now"],
    r3: ["do NOT call look_up", "does not concern your task", "That is correct"],
    r4: ["SAME turn", "look_up", "NEVER say that you are looking something up"],
    b2_exit: "If the matching tool is not offered to you in this turn, the message stays the right way.",
  }),
  fr: Object.freeze({
    r1_exclusion: ["la décision de ton donneur d'ordre", "n'en prends PAS un message", "get_consult"],
    r1_trigger: ["Le cas clair", "exige explicitement la décision de ton donneur d'ordre", "get_consult"],
    r2_takeMessage: ["look_up", "information factuelle"],
    r2_lookUp: ["la réponse fait avancer ta MISSION maintenant"],
    r3: ["n'appelle PAS look_up", "ne concerne pas ta mission", "C'est correct"],
    r4: ["tour MÊME", "look_up", "Ne dis JAMAIS que tu consultes"],
    b2_exit: "Si l'outil correspondant ne t'est pas proposé dans ce tour, le message reste la bonne voie.",
  }),
});

function assertSubstrings(text, needles, label) {
  for (const needle of needles) {
    assert.ok(text.includes(needle), `${label}: fehlt "${needle}"`);
  }
}

test("AL-D3-1 R1-Ausschluss: takeMessageDescription verweist Auftraggeber-verlangt -> KEINE Nachricht -> get_consult", () => {
  for (const lang of LANGUAGES) {
    assertSubstrings(toolsOf(lang)[RULE_FIELD.r1_exclusion], CONTRACT[lang].r1_exclusion, `${lang}/${RULE_FIELD.r1_exclusion}`);
  }
});

test("AL-D3-2 R1-Ausloeser: getConsultDescription benennt den klaren Fall", () => {
  for (const lang of LANGUAGES) {
    assertSubstrings(toolsOf(lang)[RULE_FIELD.r1_trigger], CONTRACT[lang].r1_trigger, `${lang}/${RULE_FIELD.r1_trigger}`);
  }
});

test("AL-D3-3 R2: takeMessageDescription nennt look_up + die Sachauskunft-Bedingung, lookUpDescription bindet an den Auftrag", () => {
  for (const lang of LANGUAGES) {
    assertSubstrings(toolsOf(lang)[RULE_FIELD.r2_takeMessage], CONTRACT[lang].r2_takeMessage, `${lang}/takeMessageDescription`);
    assertSubstrings(toolsOf(lang)[RULE_FIELD.r2_lookUp], CONTRACT[lang].r2_lookUp, `${lang}/lookUpDescription`);
  }
});

test("AL-D3-4 R3: lookUpDescription verbietet auftragsfremde Recherche als EIGENEN, richtig-so gerahmten Fall", () => {
  for (const lang of LANGUAGES) {
    assertSubstrings(toolsOf(lang)[RULE_FIELD.r3], CONTRACT[lang].r3, `${lang}/${RULE_FIELD.r3}`);
  }
});

test("AL-D3-5 R4: lookUpDescription verlangt den fuehrenden Satz im SELBEN Zug, der Bestandsriegel bleibt stehen", () => {
  for (const lang of LANGUAGES) {
    assertSubstrings(toolsOf(lang)[RULE_FIELD.r4], CONTRACT[lang].r4, `${lang}/${RULE_FIELD.r4}`);
  }
});

test("AL-D3-6 B2-Ausstieg: der Ausstiegssatz steht in takeMessageDescription NACH beiden Werkzeugnamen", () => {
  for (const lang of LANGUAGES) {
    const text = toolsOf(lang)[RULE_FIELD.b2_exit];
    const exit = CONTRACT[lang].b2_exit;
    assert.ok(text.includes(exit), `${lang}: Ausstiegssatz fehlt`);
    const exitIndex = text.indexOf(exit);
    assert.ok(exitIndex > text.indexOf("get_consult"), `${lang}: Ausstieg steht nicht nach get_consult`);
    assert.ok(exitIndex > text.indexOf("look_up"), `${lang}: Ausstieg steht nicht nach look_up`);
  }
});

test("AL-D3-7 Sprach-Paritaet: alle vier Tool-Felder sind in jeder Sprache nicht-leer, CONTRACT deckt jede Sprache identisch ab", () => {
  const FIELDS = ["takeMessageDescription", "getConsultDescription", "lookUpDescription", "endCallDescription"];
  for (const lang of LANGUAGES) {
    const tools = toolsOf(lang);
    for (const field of FIELDS) {
      assert.equal(typeof tools[field], "string", `${lang}/${field}: kein String`);
      assert.ok(tools[field].length > 0, `${lang}/${field}: leer`);
    }
  }
  const [deKeys, enKeys, frKeys] = LANGUAGES.map((lang) => Object.keys(CONTRACT[lang]).sort());
  assert.deepEqual(enKeys, deKeys, "CONTRACT.en deckt eine andere Regel-Menge ab als CONTRACT.de");
  assert.deepEqual(frKeys, deKeys, "CONTRACT.fr deckt eine andere Regel-Menge ab als CONTRACT.de");
});

test("AL-D3-8 Bestandsschutz E1: die Selbe-Zug-Zusage und die uebrigen Verbote bleiben, die Faehigkeits-Falschaussage ist weg", () => {
  const FALSE_CAPABILITY_CLAIM = Object.freeze({ de: "nachschlagen", en: "looking something up", fr: "rechercher" });
  const SAME_TURN_PIN = Object.freeze({ de: "in dieselbe Antwort", en: "in the very same reply", fr: "dans la réponse MÊME" });
  const RETAINED = Object.freeze({
    de: [
      "Versprich dabei NIEMALS, dass du selbst später nochmal anrufst",
      "behaupte NIE, ein Termin sei eingetragen oder gebucht",
      "Nutze es NICHT für etwas, das dein Auftrag dich selbst entscheiden lässt",
      "Halte bei einem Terminwunsch Tag, Uhrzeit und Gültigkeit mit fest",
    ],
    en: [
      "NEVER promise that you yourself will call back later",
      "that an appointment is entered or booked",
      "Do NOT use this for something your task lets you decide yourself",
      "For an appointment request, keep the day, time and validity on record",
    ],
    fr: [
      "Ne promets JAMAIS que tu rappelleras toi-même plus tard",
      "qu'un rendez-vous est enregistré ou réservé",
      "Ne l'utilise PAS pour quelque chose que ta mission te laisse décider toi-même",
      "Pour une demande de rendez-vous, consigne le jour, l'heure et la validité",
    ],
  });
  for (const lang of LANGUAGES) {
    const text = toolsOf(lang).takeMessageDescription;
    assert.ok(text.includes(SAME_TURN_PIN[lang]), `${lang}: AL-P4-9-Substring fehlt`);
    assert.ok(!text.includes(FALSE_CAPABILITY_CLAIM[lang]), `${lang}: Faehigkeits-Falschaussage noch vorhanden`);
    assertSubstrings(text, RETAINED[lang], `${lang}/takeMessageDescription (Bestandsschutz)`);
  }
});

test("AL-D3-9 Orthografie: DE traegt echte Umlaute ohne Transliteration, FR traegt Akzente - in allen drei neuen Descriptions", () => {
  const REAL_UMLAUT = /[äöüÄÖÜ]/u;
  const REAL_ACCENT = /[éèêëàâäùûüôöîïç]/iu;
  const FIELDS = ["takeMessageDescription", "getConsultDescription", "lookUpDescription"];
  for (const field of FIELDS) {
    const de = toolsOf("de")[field];
    assert.equal(TRANSLITERATION_STEMS.test(de), false, `de/${field}: Transliteration gefunden`);
    assert.match(de, REAL_UMLAUT, `de/${field}: kein echter Umlaut`);
    const fr = toolsOf("fr")[field];
    assert.match(fr, REAL_ACCENT, `fr/${field}: kein Akzent`);
  }
});

test("AL-D3-10 der Bench-Apparat leckt nicht in BASE_ENV: alle fuenf Flags bleiben auf dem Bestands-Default", () => {
  assert.equal(BASE_ENV.EXA_API_BASE, "");
  assert.equal(BASE_ENV.EXA_API_KEY, "");
  assert.equal(BASE_ENV.LOOKUP_ENABLED, "false");
  assert.equal(BASE_ENV.CONSULT_ENABLED, "false");
  assert.equal(BASE_ENV.IN_CALL_CONSULT_ENABLED, "false");
});
