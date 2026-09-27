// T2-15 (O-14, developers.openai.com/apps-sdk/app-submission-guidelines): Restricted Data
// an der MCP-Grenze - Eingabepruefung (prepare_call/place_call/answer_consult) UND
// Ausgabe-Maskierung (get_call_status/get_call_result/await_call_event/list_calls/
// check_inbox/list_action_items). Unit-Tabelle (reine Funktionen) + Draht-Tests ueber
// HTTP /mcp Legacy, HTTP /mcp OAuth und stdio (echter Kindprozess).
//
// Erkannt werden Zahlungskarten, beschriftete behoerdliche Kennnummern und Zugangsdaten.
// Bewusst NICHT erkannt: Gesundheitsangaben (Arzttermine muessen gehen) und IBANs (keine
// Kategorie der Richtlinie) - beides ist hier als Fehlalarm-Gegenprobe festgehalten.
//
// Fixtures im Format echter Anbieter-Secrets werden zur LAUFZEIT zusammengesetzt - im
// Quelltext steht keine Zeichenkette, die ein Secret-Scanner als Schluessel meldet.
//
// KEINE Katalog-ID am Namensanfang (CLAUDE.md): die Tests landen in npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { findRestrictedData, maskRestrictedText, firstRestrictedField } from "../src/restricted-data.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../src/i18n/mcp-texts.js";
import { toolErrorText } from "../src/mcp-tools.js";
import {
  startServer,
  startIdp,
  mcpPost,
  toolCall,
  readToolResult,
  seedState,
  seedCall,
  ROOT,
  BASE_ENV,
} from "./helpers.js";

const TEST_SECRET = "openai-t2-15-restricted-data-test-secret-min-32-zeichen";
const TARGET = "+4915112340077";
const CALL_EXEMPT_KEYS = ["to", "confirmation_code", "language"];
const CONFIRMATION_CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const CARD = "4111 1111 1111 1111";
const CARD_COMPACT = "4111111111111111";
const SSN_VALUE = "123-45-6789";
const PASSWORD_VALUE = ["Hunter2", "secret!"].join("");
const IBAN = "DE89 3704 0044 0532 0130 00";
// Luhn-gueltig, 13 Ziffern, IIN 4 - ohne Kontext waere das eine Kartennummer.
const PHONE_WITHOUT_PLUS = "4917000000001";

// ==================== Fixtures im Secret-Format (zur Laufzeit) ======================

// Tokens in realistischer Laenge, Rumpf mit '-' und '_' wie bei echten Schluesseln.
const TOKEN_BODY_UNIT = "Ab3_x-9Q";
const SK_PROJ_BODY_UNITS = 20; // 160 Zeichen Rumpf
const SK_ANT_BODY_UNITS = 12; // 96 Zeichen Rumpf
const JWT_PAYLOAD_CHARS = 700; // Payload deutlich ueber 500 Zeichen
const JWT_SIGNATURE_CHARS = 342; // RS256-Signatur, base64url
const GITHUB_PAT_SECRET_CHARS = 59;
const TOKEN_TAIL_CHARS = 16; // ein sichtbares Token-Ende waere eine Teilmaske

function longTokenFixtures() {
  const body = (units) => TOKEN_BODY_UNIT.repeat(units);
  return {
    skProj: "sk" + "-proj-" + body(SK_PROJ_BODY_UNITS),
    skAnt: "sk" + "-ant-api03-" + body(SK_ANT_BODY_UNITS) + "AA",
    longJwt: [
      "ey" + "JhbGciOiJSUzI1NiJ9",
      "ey" + "J" + "a".repeat(JWT_PAYLOAD_CHARS),
      "b".repeat(JWT_SIGNATURE_CHARS),
    ].join("."),
    githubPat: "github" + "_pat_" + "11ABCDEFG0123456789abc" + "_" + "x".repeat(GITHUB_PAT_SECRET_CHARS),
  };
}

function pemMarker(kind) {
  return [`-----${kind}`, "RSA PRIVATE KEY-----"].join(" ");
}

function secretFormatFixtures() {
  const pemHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const pemFooter = ["-----END", "PRIVATE KEY-----"].join(" ");
  return [
    ...Object.values(longTokenFixtures()),
    "AK" + "IA" + "1234567890ABCDEF", // AWS Access Key ID
    "gh" + "p_" + "a1B2c3D4e5f6G7h8I9j0K1l2M3n4O5p6Q7r8", // GitHub Token
    "xo" + "xb-" + "1234567890-abcdefghijklmnop", // Slack Token
    "sk" + "_live_" + "a1B2c3D4e5F6g7H8i9J0", // Stripe Key
    "AI" + "za" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5Pq6r7", // Google API Key
    "sk" + "-" + "a1B2c3D4e5F6g7H8i9J0k1L2", // OpenAI/Anthropic-Stil
    ["ey" + "JhbGciOiJub25lIn0", "ey" + "JzdWIiOiJ0ZXN0LXQyLTE1In0", "c2lnbmF0dXJlLXRlc3Q"].join("."), // JWT
    `${pemHeader}\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8w\n${pemFooter}`,
  ];
}

// ==================== Unit: Erkennung ==============================================

const CARD_POSITIVES = [
  CARD,
  "4111-1111-1111-1111",
  CARD_COMPACT,
  "4111, 1111, 1111, 1111", // Diktat-Schreibweise mit Komma
  "4111,1111,1111,1111",
  "4111.1111.1111.1111",
  "5555 5555 5555 4444",
  "3782 822463 10005", // Amex 4-6-5
  `meine Karte ist ${CARD} vielen dank`,
  `${CARD} 123`, // Karte + CVV-Gruppe direkt dahinter
  `${CARD_COMPACT} 123`,
  `Hausnummer 12 ${CARD}`, // fremde Zifferngruppe VOR der Karte
  `Wie telefonisch besprochen: ${CARD}`,
  `Telefon ${CARD}`, // formatiert - der Rufnummern-Kontext greift nicht
  `IBAN ${IBAN} und Karte ${CARD}`, // Karte neben einer IBAN bleibt erkennbar
];

const GOVERNMENT_ID_POSITIVES = [
  `SSN ${SSN_VALUE}`,
  `my SSN is ${SSN_VALUE}`,
  "Social Security Number: 123 45 6789",
  "passport number 123456789",
  "Steuer-ID: 12 345 678 901",
  "Steueridentifikationsnummer 12345678901",
  "Sozialversicherungsnummer 65 170839 J 003",
  "Personalausweisnummer L01X00T47",
  "Reisepassnummer C01X00T47",
  "Passnr. 12AB34567",
  "Numéro de sécurité sociale : 1 85 05 78 006 084 36",
  "numero de securite sociale 185057800608436",
  "NIR 1 85 05 78 006 084 36",
  "numéro fiscal 1234567890123",
  "numéro de passeport 12AB34567",
];

const LABELED_CREDENTIAL_POSITIVES = [
  `password: ${PASSWORD_VALUE}`,
  `The password is ${PASSWORD_VALUE}`,
  `Passwort ist ${PASSWORD_VALUE}`,
  `Kennwort = ${PASSWORD_VALUE}`,
  "mot de passe est azerty123",
  "Mot de passe : azerty123",
  "PIN ist 1234",
  "my PIN is 4711",
  "TAN: 123456",
  "OTP: 123456",
  "one-time code: 482913",
  "Einmalcode = 12ab34",
];

const NEGATIVES = [
  "+4915112345678",
  "+49 151 12345678",
  "0151 12345678",
  "0049 151 12345678",
  "015112345678",
  "25.09.2026",
  "2026-09-25 14:30",
  "2026-09-25 2026-09-26",
  "14:30",
  "PLZ 10115",
  "Kundennummer 4111 1111 1111 1112", // nicht Luhn
  "Kundennummer 123456789", // unbeschriftete Kennnummer - bewusst nicht erkannt
  "1234567890123", // erste Ziffer 1
  "+4915112345678 +4915112345679",
  "12345678-1234-4123-8123-123456789012", // UUID
  "call_abcdef1234567890",
  "Rechnungen 2021, 2022, 2023, 2024",
  // Gesundheitsangaben: bewusst KEINE Stichwort-Sperre (Arzttermine muessen gehen).
  "Zahnarzttermin wegen Zahnschmerzen vereinbaren",
  "Termin beim Hausarzt wegen Diabetes-Kontrolle",
  // IBAN: keine Kategorie der Richtlinie - weder erkannt noch maskiert.
  IBAN,
  "de89370400440532013000",
  "GB82 WEST 1234 5698 7654 32",
  // Wortgrenzen: kein Label-Treffer in zusammengesetzten Woertern.
  "Pinnwand: 1234",
  "Tankstelle: 12345",
  "Gastank ist 1234",
  "Spin: 12345",
  // Label ohne Secret-Form oder ohne Trenner - Alltagssaetze.
  "Die PIN ist gesperrt.",
  "TAN ist abgelaufen",
  "Mein Kennwort ist geheim, aber ich sage es nicht",
  "kein Passwort noetig, alles offen",
  "The password is required",
  "Reisepassnummer ist abgelaufen seit 2024",
  "Passnummer 2024 verlaengern",
  // Rufnummer ohne '+' mit Rufnummern-Kontext (de/en/fr) - keine Karte.
  `Rückrufnummer ${PHONE_WITHOUT_PLUS}`,
  `Rueckrufnummer ${PHONE_WITHOUT_PLUS}`,
  `Rückrufnummer ist ${PHONE_WITHOUT_PLUS}`,
  `Rueckruf unter ${PHONE_WITHOUT_PLUS}`,
  `Rufnummer ${PHONE_WITHOUT_PLUS}`,
  `Tel. ${PHONE_WITHOUT_PLUS}`,
  `Telefon: ${PHONE_WITHOUT_PLUS}`,
  `Mobil ${PHONE_WITHOUT_PLUS}`,
  `Handy ${PHONE_WITHOUT_PLUS}`,
  `Mobile ${PHONE_WITHOUT_PLUS}`,
  `Phone number ${PHONE_WITHOUT_PLUS}`,
  `Please call me back on ${PHONE_WITHOUT_PLUS}`,
  `Callback ${PHONE_WITHOUT_PLUS}`,
  `Numéro de téléphone : ${PHONE_WITHOUT_PLUS}`,
  `numero de telephone ${PHONE_WITHOUT_PLUS}`,
  `Portable ${PHONE_WITHOUT_PLUS}`,
  `Rappel au ${PHONE_WITHOUT_PLUS}`,
];

// Ein Kartenwort (de/en/fr) neben der Folge hebt die Rufnummern-Ausnahme IMMER auf.
const CARD_WORD_OVERRIDES_PHONE_CONTEXT = [
  `Rückrufnummer ${PHONE_WITHOUT_PLUS} (Kreditkarte)`,
  `Kreditkarte ${PHONE_WITHOUT_PLUS}`,
  `Karte, Rückruf ${PHONE_WITHOUT_PLUS}`,
  `credit card, phone ${PHONE_WITHOUT_PLUS}`,
  `card ${PHONE_WITHOUT_PLUS}`,
  `carte bancaire, téléphone ${PHONE_WITHOUT_PLUS}`,
  `carte ${PHONE_WITHOUT_PLUS}`,
];

function assertOnlyCategory(texts, category) {
  for (const text of texts) {
    const hits = findRestrictedData(text);
    assert.ok(hits.length > 0, `nicht erkannt: ${text}`);
    assert.ok(hits.every((hit) => hit.category === category), `${text} -> ${JSON.stringify(hits)}`);
  }
}

test("T1a: Zahlungskarten werden erkannt, auch mit Komma-/Punkt-Trennung", () => {
  assertOnlyCategory(CARD_POSITIVES, "payment_card");
});

test("T1b: beschriftete behoerdliche Kennnummern werden erkannt (de/en/fr)", () => {
  assertOnlyCategory(GOVERNMENT_ID_POSITIVES, "government_id");
});

test("T1c: Zugangsdaten werden erkannt - Secret-Formate und beschriftete Werte (de/en/fr)", () => {
  assertOnlyCategory([...secretFormatFixtures(), ...LABELED_CREDENTIAL_POSITIVES], "credential_secret");
});

test("T1d: Fehlalarm-Gegenproben bleiben unerkannt (Rufnummern, Gesundheit, IBAN, Wortgrenzen)", () => {
  for (const negative of NEGATIVES) assert.deepEqual(findRestrictedData(negative), [], negative);
});

test("T1e: ein Kartenwort gibt eine Luhn-gueltige Folge nie als Rufnummer frei", () => {
  assertOnlyCategory(CARD_WORD_OVERRIDES_PHONE_CONTEXT, "payment_card");
});

// Referenz-/Rufnummern-Kontext und die 13-14-Ziffern-Regel. Alle Folgen sind Luhn-gueltig
// mit IIN 2-6 - ohne die Regeln waeren sie Karten.
const MOBILE_WITHOUT_PLUS = "4915112345678";
const ORDER_REFERENCE = "2026092512345";
// 16 Ziffern, Luhn-gueltig, IIN 2 - aber in KEINEM Kartenmarken-Praefixbereich (2026).
const ORDER_REFERENCE_OUTSIDE_BRANDS = "2026092512345672";
const ORDER_REFERENCE_STARTING_WITH_ONE = "1234567812345670";
const VISA_TEST_NUMBER = "4532015112830366";
const NOT_A_CARD_BY_CONTEXT = [
  MOBILE_WITHOUT_PLUS, // 13 Ziffern ohne Kartenwort
  `Auftragsnummer ${ORDER_REFERENCE}`,
  `Rechnungsnummer ${ORDER_REFERENCE}`,
  `Invoice ${ORDER_REFERENCE}`,
  `Facture ${ORDER_REFERENCE}`,
  "Diners 3056 930902 5904", // 14 Ziffern ohne Kartenwort
  ORDER_REFERENCE_STARTING_WITH_ONE,
  `Bestellnummer ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `Kundennummer ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `Vorgangsnummer ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `Aktenzeichen ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `Order number ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `Reference ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `Booking ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `Numéro de commande ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
  `numero client ${ORDER_REFERENCE_OUTSIDE_BRANDS}`,
];
const CARD_BY_CARD_WORD = [
  `Kreditkarte ${MOBILE_WITHOUT_PLUS}`,
  `Karte: ${ORDER_REFERENCE}`,
  "Kreditkarte 3056 930902 5904",
  `Kreditkarte, Bestellnummer ${CARD_COMPACT}`,
  `credit card, order number ${CARD_COMPACT}`,
  `carte bancaire, facture ${CARD_COMPACT}`,
  `Bestellnummer ${CARD}`, // gruppiert - keine Referenznummernschreibweise
  // Referenzwort, aber Markenpraefix + Luhn + 15-19 Ziffern: die Karte gewinnt.
  `invoice ${VISA_TEST_NUMBER}`,
  `Bestellnummer ${CARD_COMPACT}`,
  `Numéro de commande ${CARD_COMPACT}`,
  // Rufnummernwort, aber mehr als 15 Ziffern (E.164-Maximum): keine Rufnummer.
  `Telefon ${CARD_COMPACT}`,
  // Kontrolle: ohne Referenzwort ist die Folge ausserhalb der Markenbereiche verdaechtig.
  ORDER_REFERENCE_OUTSIDE_BRANDS,
];

test("T1e-2: Referenz-/Rufnummernwort oder 13-14 Ziffern ohne Kartenwort -> keine Karte", () => {
  for (const negative of NOT_A_CARD_BY_CONTEXT) assert.deepEqual(findRestrictedData(negative), [], negative);
});

test("T1e-3: ein Kartenwort gewinnt immer, auch bei 13-14 Ziffern und neben Referenzwoertern", () => {
  assertOnlyCategory(CARD_BY_CARD_WORD, "payment_card");
});

test("T1e-4: private Schluessel - Kopfzeile genuegt; ohne END bis Textende, lang mit END als ganzer Block", () => {
  const LONG_KEY_BODY_CHARS = 5000; // ueber der frueheren 4096-Zeichen-Grenze
  const withoutEnd = `Schluessel: ${pemMarker("BEGIN")}\nMIIEabc123 und weiterer Text`;
  assert.equal(maskRestrictedText(withoutEnd), "Schluessel: [restricted-credential]");
  const longBlock = `${pemMarker("BEGIN")}\n${"A".repeat(LONG_KEY_BODY_CHARS)}\n${pemMarker("END")}`;
  assert.equal(maskRestrictedText(`vorher ${longBlock} danach`), "vorher [restricted-credential] danach");
});

test("T1e-5: PGP-Schluesselblock - Kopfzeile genuegt, mit END als Block, ohne END bis Textende", () => {
  const pgpMarker = (kind) => [`-----${kind} PGP`, "PRIVATE KEY BLOCK-----"].join(" ");
  const block = `${pgpMarker("BEGIN")}\n\nlQOYBGTest\n${pgpMarker("END")}`;
  assert.equal(maskRestrictedText(`A ${block} B`), "A [restricted-credential] B");
  assert.equal(maskRestrictedText(`A ${pgpMarker("BEGIN")}\nlQOYBGTest`), "A [restricted-credential]");
});

// ==================== Unit: IBAN bleibt draussen (Stichprobe) =======================

// Ohne IBAN-Schutz galten rund 5 % zufaelliger deutscher IBANs als Karte (ein Luhn-
// gueltiges 4er-Gruppen-Fenster in den Ziffern). Deterministische Stichprobe: ein fester
// linearer Kongruenzgenerator statt Math.random (wiederholbar).
const IBAN_SAMPLE_SIZE = 400;
const DE_IBAN_BBAN_DIGITS = 18;
const IBAN_DIGIT_BASE = 10;
const IBAN_CHECK_COMPLEMENT = 98n;
const IBAN_MOD97 = 97n;
const IBAN_CHECK_DIGITS_WIDTH = 2;
const DE_COUNTRY_DIGITS = "1314"; // "DE" nach ISO 13616 (D=13, E=14)
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2147483648;
const LCG_SEED = 20260925;
const IBAN_GROUP_PATTERN = /(.{4})(?=.)/g;

function makeDigitSource(seed) {
  let state = seed;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state % IBAN_DIGIT_BASE;
  };
}

function germanIban(nextDigit) {
  const bban = Array.from({ length: DE_IBAN_BBAN_DIGITS }, nextDigit).join("");
  const remainder = BigInt(`${bban}${DE_COUNTRY_DIGITS}00`) % IBAN_MOD97;
  const checkDigits = String(IBAN_CHECK_COMPLEMENT - remainder).padStart(IBAN_CHECK_DIGITS_WIDTH, "0");
  return `DE${checkDigits}${bban}`.replace(IBAN_GROUP_PATTERN, "$1 ");
}

test("T1f: gueltige IBANs werden nie als Karte erkannt und nie maskiert (Stichprobe)", () => {
  const nextDigit = makeDigitSource(LCG_SEED);
  for (let sample = 0; sample < IBAN_SAMPLE_SIZE; sample++) {
    const iban = germanIban(nextDigit);
    assert.deepEqual(findRestrictedData(`IBAN ${iban}`), [], iban);
    assert.equal(maskRestrictedText(`IBAN ${iban}`), `IBAN ${iban}`);
  }
});

// ==================== Unit: Maskierung und Feldsuche ================================

test("T1g: maskRestrictedText - Karte ****+letzte 4, Label bleibt, Wert weg, Rest byte-gleich", () => {
  const masked = maskRestrictedText(
    `Karte ${CARD}, SSN ${SSN_VALUE}, password: ${PASSWORD_VALUE} und IBAN ${IBAN} danke`,
  );
  assert.equal(
    masked,
    `Karte ****1111, SSN [restricted-government-id], password: [restricted-credential] und IBAN ${IBAN} danke`,
  );
});

test("T1h: Secret-Formate werden vollstaendig ersetzt, kein Praefix bleibt sichtbar", () => {
  for (const secret of secretFormatFixtures()) {
    const masked = maskRestrictedText(`Mein Key ist ${secret} bitte loeschen`);
    assert.equal(masked, "Mein Key ist [restricted-credential] bitte loeschen", secret);
  }
});

test("T1i: Nicht-String bleibt unveraendert (Aufrufer duerfen blind durchreichen)", () => {
  const NON_STRING_PROBE = 42;
  assert.equal(maskRestrictedText(null), null);
  assert.equal(maskRestrictedText(undefined), undefined);
  assert.equal(maskRestrictedText(NON_STRING_PROBE), NON_STRING_PROBE);
  assert.equal(maskRestrictedText(""), "");
});

test("T1j: firstRestrictedField findet Feldpfad und Kategorie, exemptKeys ausgenommen", () => {
  assert.deepEqual(firstRestrictedField({ to: TARGET, objective: `Karte ${CARD}` }, CALL_EXEMPT_KEYS), {
    category: "payment_card",
    field: "objective",
  });
  assert.deepEqual(
    firstRestrictedField({ to: TARGET, context: { key_facts: ["ok", `SSN ${SSN_VALUE}`] } }, CALL_EXEMPT_KEYS),
    { category: "government_id", field: "context.key_facts" },
  );
  assert.deepEqual(
    firstRestrictedField({ to: TARGET, briefing: `password: ${PASSWORD_VALUE}` }, CALL_EXEMPT_KEYS),
    { category: "credential_secret", field: "briefing" },
  );
  // to selbst ist Luhn-gueltig mit '+' - wird nie geprueft (exemptKeys).
  assert.equal(firstRestrictedField({ to: "+4791111111111", objective: "Termin" }, CALL_EXEMPT_KEYS), null);
});

// ==================== Unit: Laufzeit (kein exponentielles Verhalten) ================

const RUNTIME_BUDGET_MS = 2000; // grosszuegig - Ziel ist "linear", nicht "schnell"
const MEGABYTE_REPEAT = 100000;
const DENSE_HIT_REPEAT = 20000;

function assertMasksWithinBudget(text) {
  const started = Date.now();
  maskRestrictedText(text);
  assert.ok(Date.now() - started < RUNTIME_BUDGET_MS, "kein exponentielles Verhalten");
}

test("T1k: Laufzeit - 1 MB Ziffern/Leerzeichen ohne Treffer", () => {
  assertMasksWithinBudget("1234567890 ".repeat(MEGABYTE_REPEAT));
});

test("T1l: Laufzeit - 1 MB Buchstaben/Ziffern/Bindestriche ohne Treffer", () => {
  assertMasksWithinBudget("abcdefghij0123456789-_.".repeat(MEGABYTE_REPEAT));
});

test("T1l-2: Laufzeit - offene Token-Muster bleiben linear (lange Laeufe, viele Kopfzeilen)", () => {
  const MEGABYTE_CHARS = 1000000;
  const JWT_LIKE_REPEAT = 60000;
  const PEM_HEADER_REPEAT = 30000;
  assertMasksWithinBudget("sk" + "-" + "a".repeat(MEGABYTE_CHARS));
  assertMasksWithinBudget("eyJaaaaaaaaaaaa.".repeat(JWT_LIKE_REPEAT));
  assertMasksWithinBudget(`${pemMarker("BEGIN")}\n`.repeat(PEM_HEADER_REPEAT));
});

test("T1m: Laufzeit - dicht gepackte Treffer aller drei Kategorien", () => {
  assertMasksWithinBudget(`${CARD} SSN ${SSN_VALUE} PIN: 12ab34 `.repeat(DENSE_HIT_REPEAT));
});

// ==================== Unit: Ablehnungstext =========================================

const RESTRICTED_ERROR_CODES = [
  MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD,
  MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID,
  MCP_ERROR_CODE.RESTRICTED_CREDENTIAL,
];

test("T2: Ablehnungstext nennt Feld, keine Ziffer, keinen Wert - alle Kategorien, alle Sprachen", () => {
  for (const lang of ["de", "en", "fr"]) {
    for (const code of RESTRICTED_ERROR_CODES) {
      const text = toolErrorText({ code, field: "objective" }, MCP_TEXTS[lang]);
      assert.ok(text.includes("objective"), `${lang}/${code}`);
      assert.doesNotMatch(text, /\d/, `${lang}/${code}: keine Ziffer`);
    }
  }
});

// ==================== Draht: Eingabepruefung (HTTP Legacy) ==========================

const RESTRICTED_INPUTS = [
  { label: "Karte", objective: `Bitte Karte ${CARD} hinterlegen`, leaks: [CARD, CARD_COMPACT] },
  { label: "SSN", objective: `SSN ${SSN_VALUE} beim Amt angeben`, leaks: [SSN_VALUE] },
  { label: "Passwort", objective: `Login pruefen, password: ${PASSWORD_VALUE}`, leaks: [PASSWORD_VALUE] },
];

const ALLOWED_INPUTS = [
  "Zahnarzttermin wegen Zahnschmerzen vereinbaren",
  `Termin vereinbaren, Rückrufnummer ${PHONE_WITHOUT_PLUS}`,
  `Termin vereinbaren, Rueckrufnummer ${PHONE_WITHOUT_PLUS}`,
  `Rechnung klaeren, IBAN ${IBAN}`,
  "Rueckruf unter 0151 12345678 am 25.09.2026 um 14:30, Kundennummer 4111 1111 1111 1112, PLZ 10115",
];

async function withCallServer(run, extraEnv = {}) {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
      ...extraEnv,
    },
  });
  try {
    await run(srv);
  } finally {
    await srv.stop();
  }
}

async function callTool({ srv, token = null, name, args }) {
  return readToolResult(await mcpPost(`${srv.localUrl}/mcp`, token, toolCall(name, args)));
}

function assertRejectedWithoutLeak(result, { field, leaks }) {
  assert.equal(result.isError, true, JSON.stringify(result));
  const [{ text }] = result.content;
  assert.ok(text.includes(field), text);
  assert.equal(result._meta?.["hermes/confirmation_code"], undefined, "kein Bestaetigungscode");
  const whole = JSON.stringify(result);
  for (const leak of leaks) assert.ok(!whole.includes(leak), `Treffer im Ergebnis: ${leak}`);
}

function assertCodeIssued(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.match(result._meta?.["hermes/confirmation_code"], CONFIRMATION_CODE_SHAPE);
}

test("T3a (Draht HTTP Legacy): prepare_call mit Karte/SSN/Passwort -> isError, kein Code, kein Treffer im Text", async () => {
  await withCallServer(async (srv) => {
    for (const input of RESTRICTED_INPUTS) {
      const result = await callTool({ srv, name: "prepare_call", args: { to: TARGET, objective: input.objective } });
      assertRejectedWithoutLeak(result, { field: "objective", leaks: input.leaks });
    }
  });
});

test("T3b (Draht HTTP Legacy): Fehlalarm-Gegenproben (Zahnarzt, Rückrufnummer ü/ue, IBAN, Datum) -> normaler Code", async () => {
  await withCallServer(async (srv) => {
    for (const objective of ALLOWED_INPUTS) {
      assertCodeIssued(await callTool({ srv, name: "prepare_call", args: { to: TARGET, objective } }));
    }
  });
});

test("T3c (Draht HTTP Legacy): Treffer in context.key_facts nennt den Feldpfad", async () => {
  await withCallServer(async (srv) => {
    const result = await callTool({
      srv,
      name: "prepare_call",
      args: { to: TARGET, objective: "Termin vereinbaren", context: { key_facts: ["Kundin seit 2020", `SSN ${SSN_VALUE}`] } },
    });
    assertRejectedWithoutLeak(result, { field: "context.key_facts", leaks: [SSN_VALUE] });
  });
});

test("T3d (Draht HTTP Legacy): place_call mit Karte/SSN/Passwort im briefing -> isError, KEIN Anruf-Datensatz", async () => {
  await withCallServer(async (srv) => {
    const before = srv.readStore().calls.length;
    for (const input of RESTRICTED_INPUTS) {
      const result = await callTool({
        srv,
        name: "place_call",
        args: { to: TARGET, objective: "Termin vereinbaren", briefing: input.objective, confirmation_code: "AAAAAA" },
      });
      assertRejectedWithoutLeak(result, { field: "briefing", leaks: input.leaks });
    }
    assert.equal(srv.readStore().calls.length, before, "kein Anruf-Datensatz entstanden");
  });
});

test("T3e (Draht HTTP Legacy): to selbst Luhn-gueltig mit '+' wird NIE abgelehnt", async () => {
  await withCallServer(async (srv) => {
    assertCodeIssued(await callTool({ srv, name: "prepare_call", args: { to: "+4791111111111", objective: "Termin" } }));
  });
});

function tokenLeaks(token) {
  return [token, token.slice(-TOKEN_TAIL_CHARS)];
}

test("T3f (Draht HTTP Legacy): prepare_call mit sk-proj-/sk-ant-Key, langem JWT, github_pat_ -> isError, kein Code, kein Token-Rest", async () => {
  await withCallServer(async (srv) => {
    for (const token of Object.values(longTokenFixtures())) {
      const result = await callTool({ srv, name: "prepare_call", args: { to: TARGET, objective: "Termin", briefing: `Key ${token}` } });
      assertRejectedWithoutLeak(result, { field: "briefing", leaks: tokenLeaks(token) });
    }
  });
});

test("T4 (Draht HTTP Legacy): answer_consult mit Karte/SSN/Passwort -> Restricted-Text VOR dem Hop", async () => {
  const srv = await startServer({
    env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true", MCP_UI_ENABLED: "true" },
  });
  const consultArgs = (answers) => ({ call_id: "call_unbekannt_xyz", event_id: "c0", answers });
  try {
    const rejectedTexts = new Set();
    for (const input of RESTRICTED_INPUTS) {
      const result = await callTool({ srv, name: "answer_consult", args: consultArgs([input.objective]) });
      assertRejectedWithoutLeak(result, { field: "answers", leaks: input.leaks });
      rejectedTexts.add(result.content[0].text);
    }
    // Kontrolle: eine harmlose Antwort an dieselbe unbekannte call_id laeuft in den Hop-
    // Fehlerweg (ein anderer Text) - die Pruefung sitzt wirklich VOR dem Hop.
    const harmless = await callTool({ srv, name: "answer_consult", args: consultArgs(["Ja"]) });
    assert.ok(!rejectedTexts.has(harmless.content[0].text), harmless.content[0].text);
  } finally {
    await srv.stop();
  }
});

// ==================== Draht: Ausgabe-Maskierung ====================================

const CALL_STARTED_MS_AGO = 60000;
const CALL_ANSWERED_MS_AGO = 55000;
const SEED_CALL_ID = "call_t2_15_seed";
const SEED_COUNTERPARTY = "+4915112345678";
const ALL_RESTRICTED = `Karte ${CARD}, SSN ${SSN_VALUE}, password: ${PASSWORD_VALUE}`;
const RAW_LEAKS = [CARD, CARD_COMPACT, SSN_VALUE, PASSWORD_VALUE];

function seededTranscriptState() {
  const call = seedCall({
    id: SEED_CALL_ID,
    direction: "outbound",
    to: SEED_COUNTERPARTY,
    status: "completed",
    startedAt: new Date(Date.now() - CALL_STARTED_MS_AGO).toISOString(),
    answeredAt: new Date(Date.now() - CALL_ANSWERED_MS_AGO).toISOString(),
    endedAt: new Date().toISOString(),
    transcript: [
      { role: "agent", text: "Guten Tag, wie kann ich helfen?" },
      { role: "counterparty", text: `${ALL_RESTRICTED} und IBAN ${IBAN}` },
    ],
    summary: `Kunde nannte ${ALL_RESTRICTED}. IBAN ${IBAN} fuer die Rechnung.`,
    objectiveAchieved: true,
    result: {
      outcome: `Bestaetigt, Karte ${CARD} notiert.`,
      commitments: [`Prueft SSN ${SSN_VALUE}`],
      counterpartyCommitments: [`Aendert password: ${PASSWORD_VALUE}`],
      openPoints: [`IBAN ${IBAN} noch zu pruefen`],
      nextStep: ALL_RESTRICTED,
    },
    inboxEntryAt: new Date().toISOString(),
    from: SEED_COUNTERPARTY,
  });
  const actionItem = {
    id: "ai_t2_15_seed",
    callId: call.id,
    text: `${ALL_RESTRICTED} im System hinterlegen`,
    type: "todo",
    done: false,
    createdAt: new Date().toISOString(),
  };
  call.actionItemIds = [actionItem.id];
  return seedState({ calls: [call], actionItems: [actionItem] });
}

function assertMasked(payload) {
  const whole = JSON.stringify(payload);
  for (const leak of RAW_LEAKS) assert.ok(!whole.includes(leak), `Rohwert sichtbar: ${leak}`);
  assert.match(whole, /\*\*\*\*1111/);
  assert.match(whole, /\[restricted-government-id\]/);
  assert.match(whole, /\[restricted-credential\]/);
}

test("T5 (Draht HTTP Legacy): alle sechs Ausgabe-Werkzeuge maskieren alle drei Kategorien; IBAN und Rufnummer bleiben; Store bleibt roh", async () => {
  const srv = await startServer({
    env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true", MCP_UI_ENABLED: "true" },
    seed: seededTranscriptState(),
  });
  try {
    for (const name of ["get_call_status", "get_call_result", "await_call_event"]) {
      assertMasked(await callTool({ srv, name, args: { call_id: SEED_CALL_ID } }));
    }
    for (const name of ["list_calls", "list_action_items"]) {
      assertMasked(await callTool({ srv, name, args: {} }));
    }
    // check_inbox verbraucht die Eintraege - EIN Aufruf, beide Pruefungen auf demselben Ergebnis.
    const inboxResult = await callTool({ srv, name: "check_inbox", args: {} });
    assertMasked(inboxResult);
    const inbox = JSON.stringify(inboxResult);
    assert.ok(inbox.includes(IBAN), "IBAN bleibt unmaskiert");
    assert.ok(inbox.includes(SEED_COUNTERPARTY), "Rufnummer bleibt sichtbar");
    // Positiv-Kontrolle: der Rohwert steht weiter im Store - maskiert wird NUR an der MCP-Grenze.
    const rawStore = JSON.stringify(srv.readStore());
    for (const leak of [CARD, SSN_VALUE, PASSWORD_VALUE]) assert.ok(rawStore.includes(leak), leak);
  } finally {
    await srv.stop();
  }
});

test("T5b (Draht HTTP Legacy): lange Tokens im Transkript werden in get_call_status/get_call_result ganz maskiert", async () => {
  const tokens = Object.values(longTokenFixtures());
  const call = seedCall({
    id: SEED_CALL_ID,
    direction: "outbound",
    to: SEED_COUNTERPARTY,
    status: "completed",
    startedAt: new Date(Date.now() - CALL_STARTED_MS_AGO).toISOString(),
    answeredAt: new Date(Date.now() - CALL_ANSWERED_MS_AGO).toISOString(),
    endedAt: new Date().toISOString(),
    transcript: [{ role: "counterparty", text: `Meine Schluessel: ${tokens.join(" ")}` }],
    summary: `Genannt: ${tokens.join(" ")}`,
    objectiveAchieved: true,
    from: SEED_COUNTERPARTY,
  });
  const srv = await startServer({ seed: seedState({ calls: [call] }) });
  try {
    for (const name of ["get_call_status", "get_call_result"]) {
      const whole = JSON.stringify(await callTool({ srv, name, args: { call_id: SEED_CALL_ID } }));
      for (const token of tokens) {
        for (const leak of tokenLeaks(token)) assert.ok(!whole.includes(leak), `${name}: Token-Rest sichtbar`);
      }
      assert.match(whole, /\[restricted-credential\]/);
    }
  } finally {
    await srv.stop();
  }
});

// ==================== Draht: OAuth (echtes Token) ==================================

test("T6 (Draht HTTP OAuth): prepare_call mit Karte/SSN/Passwort -> isError; get_call_status maskiert", async () => {
  const idp = await startIdp();
  const OWNER_SUB = "owner-sub-t2-15";
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      OWNER_IDP_SUBJECT: OWNER_SUB,
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: TEST_SECRET,
    },
    seed: seededTranscriptState(),
  });
  try {
    const token = await idp.sign({ sub: OWNER_SUB, email: "owner@team.test" });
    for (const input of RESTRICTED_INPUTS) {
      const result = await callTool({ srv, token, name: "prepare_call", args: { to: TARGET, objective: input.objective } });
      assertRejectedWithoutLeak(result, { field: "objective", leaks: input.leaks });
    }
    assertMasked(await callTool({ srv, token, name: "get_call_status", args: { call_id: SEED_CALL_ID } }));
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// ==================== Draht: stdio (echter Kindprozess) ============================

test("T7 (Draht stdio): prepare_call mit Karte/SSN/Passwort -> isError; get_call_result maskiert", async () => {
  const gateway = await startServer({
    env: { FAKE_ORIGINATE: "true", ALLOWED_COUNTRY_CODES: "*", CALL_CONFIRMATION_SECRET: TEST_SECRET },
    seed: seededTranscriptState(),
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: { ...BASE_ENV, GATEWAY_URL: gateway.localUrl, MCP_UI_ENABLED: "true" },
    stderr: "pipe",
  });
  const client = new Client({ name: "hermes-t2-15-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    for (const input of RESTRICTED_INPUTS) {
      const result = await client.callTool({ name: "prepare_call", arguments: { to: TARGET, objective: input.objective } });
      assertRejectedWithoutLeak(result, { field: "objective", leaks: input.leaks });
    }
    assertMasked(await client.callTool({ name: "get_call_result", arguments: { call_id: SEED_CALL_ID } }));
  } finally {
    await client.close();
    await gateway.stop();
  }
});
