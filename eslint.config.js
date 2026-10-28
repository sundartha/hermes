import js from "@eslint/js";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
import * as espree from "espree";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tseslint from "typescript-eslint";

import { existsSync, readFileSync } from "node:fs";

const ZEITGLIEDER_BESTAND_DATEI = new URL(
  "./tools/basis/zeitglieder-bestand.json",
  import.meta.url,
);
const zeitgliederBestand = existsSync(ZEITGLIEDER_BESTAND_DATEI)
  ? JSON.parse(readFileSync(ZEITGLIEDER_BESTAND_DATEI, "utf8"))
  : {};
const ENDUNGEN_LISTE = ["js", "mjs", "cjs", "ts", "mts", "cts"];
const ENDUNGEN = `{${ENDUNGEN_LISTE.join(",")}}`;
const ENDUNGEN_OHNE_JS = `{${ENDUNGEN_LISTE.filter((endung) => endung !== "js").join(",")}}`;
const TS_ENDUNGEN = "{ts,mts,cts}";
const QUELL_DATEIEN = `src/**/*.${ENDUNGEN}`;
export const HERMES_REGELN_DATEI = new URL("./tools/eslint-rules/index.js", import.meta.url);
const QUELLTEXT_BESTAND = "tools/basis/quelltext-als-text.json";
const WURZEL = new URL("./", import.meta.url);
const vorhanden = (datei) => existsSync(new URL(datei, WURZEL));
function vorhandenerPfad(datei) {
  const zwilling = datei.replace(/\.js$/, ".ts");
  return !vorhanden(datei) && vorhanden(zwilling) ? zwilling : datei;
}
const WORT_NUR_IN_EINTRAEGE = [
  {
    name: "telnyx-belegabruf",
    nurIn: ["src/billing/cost-truing.js", "src/telephony/adapters/telnyx/voice.js"],
    meldung:
      "Den Telnyx-Belegabruf gibt es nur im Kosten-Abgleich src/billing/cost-truing.js und im Telnyx-Adapter (LCT P3); Geld- und Gate-Pfade rufen ihn nie auf. Ein neuer Nutzer braucht einen Eintrag in eslint.config.js mit Freigabe der Owner.",
  },
  {
    name: "kein-anrufzeit-gate",
    nurIn: [
      "src/billing/cancellation-mail.js",
      "src/claude.js",
      "src/elevenlabs/inbound-initiation.js",
      "src/elevenlabs/nanp-area-codes.js",
      "src/elevenlabs/outbound.js",
      "src/elevenlabs/time-context.js",
      "src/geo/resolve.js",
      "src/store.js",
      "src/store/defaults.js",
      "src/store/json.js",
      "src/store/pg.js",
      "src/store/state-ops.js",
      "src/store/zustand/mandant.js",
      "src/web-auth.js",
    ],
    meldung:
      "Zeitzonen und Zeitzonen-Quellen gehören nicht in diese Datei (LAW-07: kein Anrufzeit-Gate). Reine Anzeige außerhalb der Gate-Kette braucht einen Eintrag in eslint.config.js mit Freigabe der Owner; Gate-Kette, Anrufabschluss und Dauerbegrenzung nie.",
  },
  {
    name: "trunk-beleg-felder",
    nurIn: [
      "src/store/state-ops.js",
      "src/store/zustand/nummern.js",
      "src/store/pg.js",
      "src/elevenlabs/inbound-path-decision.js",
    ],
    meldung:
      "Die Beleg-Felder des Inbound-Trunks stehen nur im Store und in der Weiche (IEX-A8). Andere Module lesen und schreiben sie über die Store-Operationen (markNumberElInboundTrunkBelegt, clearNumberElInboundTrunkBeleg).",
  },
  {
    name: "anthropic-vokabular",
    nurIn: ["src/llm/adapters/anthropic.js", "src/llm/adapters/deepseek.js"],
    meldung:
      "Anbieter-Vokabular der LLM-Schnittstelle (input_schema, cache_control, max_tokens, tool_choice) steht nur in den LLM-Adaptern (B3B-1); der übrige Code bleibt anbieterneutral.",
  },
  {
    name: "keine-aufnahme",
    nurIn: [],
    meldung:
      "Hermes nimmt keine Gespräche auf, und Audio läuft nie durch MCP (CLAUDE.md, Regel AUDIO); recordingUrl und startRecording gibt es im Code nicht.",
  },
  {
    name: "tote-wahlwege",
    nurIn: [],
    meldung:
      "originateViaCallControl und originateAiAssistantCall sind stillgelegte Wahlwege ohne Gates (SEC-P6); Anrufe starten nur über originateCall und originateElevenLabsCall in src/routes/api-calls.js.",
  },
  {
    name: "sprachkosten-buchen",
    art: "aufruf",
    nurIn: ["src/billing/metering.js", "src/store/json.js", "src/store/pg.js"],
    meldung:
      "Sprachkosten bucht nur src/billing/metering.js über store.addVoiceUsageCostCents (KV-P1-10); ein zweiter Aufrufer wäre eine mögliche Doppelbelastung.",
  },
  {
    name: "anruf-starten",
    art: "aufruf",
    nurIn: ["src/routes/api-calls.js"],
    meldung:
      "originateCall und originateElevenLabsCall ruft nur src/routes/api-calls.js auf, hinter allen Outbound-Gates (SEC-P6); ein neuer Wahlweg braucht dieselben Gates und eine Freigabe der Owner.",
  },
  {
    name: "inbound-tarif",
    nurIn: ["src/billing/cost-calibration.js", "src/billing/metering.js", "src/config.js"],
    meldung:
      "Der Inbound-Tarif wird nur in src/billing/metering.js (Buchung) und src/billing/cost-calibration.js (Wächter) gelesen und nur in src/config.js gesetzt (KV-P2-5).",
  },
  {
    name: "altpfad-dashboard",
    nurIn: ["src/portal-paths.js"],
    meldung:
      "Das alte Dashboard /tenant.html gibt es nicht mehr (P14); Ziele zeigen auf die App-Shell, den Altpfad kennt nur src/portal-paths.js.",
  },
];
const WORT_NUR_IN = WORT_NUR_IN_EINTRAEGE.map((eintrag) => ({
  ...eintrag,
  nurIn: eintrag.nurIn.map(vorhandenerPfad),
}));
const WEB_WORT_NUR_IN = [
  {
    name: "sprachkennung",
    nurIn: ["apps/web/src/lib/subscribe.js"],
    meldung:
      "Sprach-Kennungen für die Datumsformatierung stehen in apps/web nur in src/lib/subscribe.js (WEB-18); andere Module formatieren über dessen Funktionen.",
  },
  {
    name: "datumsformat",
    nurIn: ["apps/web/src/lib/subscribe.js"],
    meldung:
      "Datum und Zahlen formatiert apps/web nur in src/lib/subscribe.js (WEB-18); andere Module rufen dessen Funktionen auf, statt toLocale…, toString oder Intl zu benutzen.",
  },
];
const SKRIPT_MELDUNG_ADRESSE =
  "Die öffentliche Adresse des Dienstes liest dieses Skript nicht selbst (IEL-B9-24, IEL-B10-15); das Webhook-Ziel kommt aus src/elevenlabs/init-webhook-ziel.js.";
const WAHLSKRIPT_WORT_NUR_IN = [
  {
    name: "zugangsdaten",
    nurIn: [],
    meldung:
      "Dieses Skript setzt keine SIP-Zugangsdaten (IEL-B9-24); die Zugangsdaten verwaltet nur src/elevenlabs/nummern-registrierung.js.",
  },
  { name: "oeffentliche-adresse", nurIn: [], meldung: SKRIPT_MELDUNG_ADRESSE },
];
const GEHEIMNIS_SKRIPT_WORT_NUR_IN = [
  {
    name: "inbound-geheimnis",
    nurIn: [],
    meldung:
      "Die Geheimnis-Skripte lesen den Inbound-Zugang nicht aus der Konfiguration des Dienstes (IEL-B10-15); sie arbeiten nur mit den Render-Umgebungsvariablen.",
  },
  { name: "oeffentliche-adresse", nurIn: [], meldung: SKRIPT_MELDUNG_ADRESSE },
  {
    name: "speicher-import",
    nurIn: [],
    meldung: "Die Geheimnis-Skripte laden den Speicher nie (IEL-B10-14 und -15).",
  },
];
const STEUERUNG_AUSNAHMEN = [
  {
    datei: "src/elevenlabs/outbound.js",
    grund: "zeile.message ist eine Transkriptzeile, kein Fehlerobjekt (reportAudioTags meldet nur).",
  },
  {
    datei: "src/llm/adapters/anthropic.js",
    grund:
      "isBillingError liest die Marke des LLM-Anbieters für ‚Guthaben leer‘; das ist die LLM-Naht, nicht der Geldpfad.",
  },
].map((ausnahme) => ({ ...ausnahme, datei: vorhandenerPfad(ausnahme.datei) }));
const PROZESS_WAECHTER = "./process-guards.js";
const KONFIG_GRUPPEN = ["telnyxElevenLabs", "elevenLabsPlayTts"];
const KONFIG_SKRIPTE_MIT_BLATT = [
  `scripts/telnyx-call-latency.${ENDUNGEN_OHNE_JS}`,
  `scripts/smoke-stripe-payment.${ENDUNGEN_OHNE_JS}`,
  `scripts/el-nummern-registrierung.${ENDUNGEN_OHNE_JS}`,
];
const KONFIG_TABELLE = { datei: "src/config.js", tabelle: "CONFIG_NAMESPACES" };
const SPEICHER_FASSADE = {
  fassade: "src/store.js",
  speicher: [{ datei: "src/store/pg.js", fabrik: "makePgStore" }, { datei: "src/store/json.js" }],
};
const ABLEHNUNGS_TABELLE = {
  datei: "src/i18n/mcp-denial-texts.js",
  tabelle: "MCP_DENIAL_TEXTS",
  sprache: "en",
};
export const TESTREGELN_DATEI = new URL("./tools/eslint-rules/tests.js", import.meta.url);
const SELBSTPRUEFUNG_BESTAND = "tools/basis/selbstpruefung.json";
const FESTER_IMPORTPFAD_BESTAND = "tools/basis/fester-importpfad.json";
const SPEICHER_ATTRAPPE_BESTAND = "tools/basis/keine-speicher-attrappe.json";
const ANFRAGE_FRIST_BESTAND = "tools/basis/anfrage-mit-frist.json";
const hermesRegeln = (await import(HERMES_REGELN_DATEI.href)).default;
const hermesBloecke = [
  {
    name: "hermes",
    plugins: { hermes: hermesRegeln },
    rules: {
      "hermes/keine-kommentare": "error",
      "hermes/namen-ohne-begruendung": "warn",
    },
  },
  {
    name: "hermes-tests",
    files: ["test/**"],
    rules: {
      "hermes/kein-quelltext-als-text": ["error", { bestand: QUELLTEXT_BESTAND }],
    },
  },
  {
    name: "hermes-wort-nur-in",
    files: [QUELL_DATEIEN],
    rules: { "hermes/wort-nur-in": ["error", ...WORT_NUR_IN] },
  },
  {
    name: "hermes-wort-nur-in-web",
    files: ["apps/web/src/**/*.js"],
    rules: { "hermes/wort-nur-in": ["error", ...WEB_WORT_NUR_IN] },
  },
  {
    name: "hermes-wort-nur-in-wahlskripte",
    files: [`scripts/el-nummern-registrierung.${ENDUNGEN_OHNE_JS}`, `scripts/push-elevenlabs.${ENDUNGEN_OHNE_JS}`],
    rules: { "hermes/wort-nur-in": ["error", ...WAHLSKRIPT_WORT_NUR_IN] },
  },
  {
    name: "hermes-wort-nur-in-geheimnis-skripte",
    files: [`scripts/iel-geheimnisse*.${ENDUNGEN_OHNE_JS}`],
    rules: { "hermes/wort-nur-in": ["error", ...GEHEIMNIS_SKRIPT_WORT_NUR_IN] },
  },
  {
    name: "hermes-steuerung-ueber-meldung",
    files: [QUELL_DATEIEN],
    rules: { "hermes/keine-steuerung-ueber-meldung": ["error", ...STEUERUNG_AUSNAHMEN] },
  },
  {
    name: "hermes-erster-import",
    files: [`src/server.${ENDUNGEN}`, `src/mcp-server.${ENDUNGEN}`],
    rules: { "hermes/erster-import": ["error", { quelle: PROZESS_WAECHTER }] },
  },
  {
    name: "hermes-ablehnungsgruende",
    files: [`src/telephony/outbound-gates.${ENDUNGEN}`],
    rules: { "hermes/ablehnungsgruende": ["error", ABLEHNUNGS_TABELLE] },
  },
  {
    name: "hermes-speicher-fassade",
    files: [QUELL_DATEIEN],
    rules: { "hermes/speicher-fassade": ["error", SPEICHER_FASSADE] },
  },
  {
    name: "hermes-config-pfade",
    files: [`scripts/**/*.${ENDUNGEN}`],
    ignores: KONFIG_SKRIPTE_MIT_BLATT,
    rules: {
      "hermes/config-pfade": [
        "error",
        { ...KONFIG_TABELLE, gruppen: KONFIG_GRUPPEN, blattPflicht: false },
      ],
    },
  },
  {
    name: "hermes-config-pfade-mit-blatt",
    files: KONFIG_SKRIPTE_MIT_BLATT,
    rules: { "hermes/config-pfade": ["error", { ...KONFIG_TABELLE, gruppen: KONFIG_GRUPPEN }] },
  },
];
const testRegeln = (await import(TESTREGELN_DATEI.href)).default;
const testRegelBloecke = [
  {
    name: "hermes-testregeln",
    files: ["test/**"],
    plugins: { "hermes-tests": testRegeln },
    rules: {
      "hermes-tests/keine-selbstpruefung": ["error", { bestand: SELBSTPRUEFUNG_BESTAND }],
      "hermes-tests/fester-importpfad": ["error", { bestand: FESTER_IMPORTPFAD_BESTAND }],
      "hermes-tests/anfrage-mit-frist": "error",
      "hermes-tests/keine-speicher-attrappe": ["error", { bestand: SPEICHER_ATTRAPPE_BESTAND }],
    },
  },
  {
    name: "hermes-anfrage-frist-produkt",
    files: [QUELL_DATEIEN],
    plugins: { "hermes-tests": testRegeln },
    rules: {
      "hermes-tests/anfrage-mit-frist": ["error", { bestand: ANFRAGE_FRIST_BESTAND }],
    },
  },
];

const demeterChainSelector =
  "MemberExpression MemberExpression MemberExpression MemberExpression";
const ZEITGLIEDER_MELDUNG =
  "Echte Wartezeit in Tests nur über echtWarten(ms) aus test/echt-warten.js. Sonst simulierte Zeit (t.mock.timers, jumpClock aus test/fake-clock.js), auf ein Ereignis warten, Reihenfolge über setImmediate oder queueMicrotask, Frist über die Option timeout von node:test oder spawn oder AbortSignal.timeout.";
const ZEITGLIEDER_MODULE = ["node:timers", "timers", "node:timers/promises", "timers/promises"];
const demeterChainMessage =
  "Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)";
const demeterRegel = { selector: demeterChainSelector, message: demeterChainMessage };
const HANDLER_EXPORT_SELECTOR = [
  "ExportNamedDeclaration > FunctionDeclaration[id.name=/Handler$/]",
  "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name=/Handler$/]",
  "ExportNamedDeclaration > ClassDeclaration[id.name=/Handler$/]",
  "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > :matches(ObjectPattern, ArrayPattern) Identifier[name=/Handler$/]:not(Property > Identifier.key, AssignmentPattern > Identifier.right)",
  "ExportDefaultDeclaration > FunctionDeclaration[id.name=/Handler$/]",
  "ExportDefaultDeclaration > ClassDeclaration[id.name=/Handler$/]",
  "ExportDefaultDeclaration > Identifier[name=/Handler$/]",
  "ExportSpecifier[local.name=/Handler$/]",
  "ExportAllDeclaration[exported.name=/Handler$/]",
  "ExportAllDeclaration[exported.value=/Handler$/]",
  "ExportDefaultDeclaration > :matches(FunctionExpression, ClassExpression)[id.name=/Handler$/]",
  "ExportSpecifier[exported.name=/Handler$/]",
  "ExportSpecifier[exported.value=/Handler$/]",
].join(", ");
const ROUTER_FORM_MELDUNG =
  "Eine Route steht in Router-Form: `export function make<Name>Routes(…)` gibt einen `Router()` zurück (Muster: der Eintrag „Route“ in `tools/auftrag/musterdateien.json`, `npm run neu -- route …`); Eingabe prüfst du mit einem Schema über den Helfer in `src/routes/_validation.js`.";
const NUR_LESEN_MELDUNG =
  "Dieses Skript liest nur: kein Dateisystem-Schreiben und keine schreibende HTTP-Methode.";
const DATEISYSTEM_MODULE = ["fs", "node:fs", "fs/promises", "node:fs/promises"];
const nurLesenImporte = [
  "error",
  { paths: DATEISYSTEM_MODULE.map((name) => ({ name, message: NUR_LESEN_MELDUNG })) },
];
const schreibFunktion = {
  selector: "Identifier[name=/^(writeFile|appendFile|createWriteStream)(Sync)?$/]",
  message: NUR_LESEN_MELDUNG,
};
const dateiBloecke = [
  {
    name: "rueckfrage-auditor",
    files: [`src/server.${ENDUNGEN}`, `src/app.${ENDUNGEN}`],
    rules: {
      "no-restricted-syntax": [
        "error",
        demeterRegel,
        {
          selector:
            'VariableDeclarator[id.name="durableAuditFor"]:not(:has(CallExpression[callee.name="makeDurableAudit"] Property[key.name="tenantId"]))',
          message:
            "durableAuditFor wird über makeDurableAudit mit tenantId gebaut, damit die Rückfrage-Spur dauerhaft und je Mandant geschrieben wird (P3-7).",
        },
        {
          selector:
            'CallExpression[callee.name="makeElevenLabsWebhookRoutes"]:not(:has(Property[key.name="auditFor"][value.name="durableAuditFor"]))',
          message: "Die Rückfrage-Route bekommt durableAuditFor als auditFor (P3-7).",
        },
      ],
    },
  },
  {
    name: "cent-schreibstellen",
    files: [`src/store/**/*.${ENDUNGEN}`],
    ignores: [`src/store/json.${ENDUNGEN}`, `src/store/pg.${ENDUNGEN}`],
    rules: {
      "no-restricted-syntax": [
        "error",
        demeterRegel,
        {
          selector:
            'AssignmentExpression[left.property.name="costCents"]:not(FunctionDeclaration[id.name=/^(bookCents|applyCreditCents)$/] AssignmentExpression)',
          message:
            "Cent-Stände schreiben nur bookCents und applyCreditCents; die Gate-Achse hat genau zwei Kanten (KV2-8).",
        },
        {
          selector:
            'UpdateExpression[argument.property.name="costCents"]:not(FunctionDeclaration[id.name=/^(bookCents|applyCreditCents)$/] UpdateExpression)',
          message:
            "Cent-Stände schreiben nur bookCents und applyCreditCents; die Gate-Achse hat genau zwei Kanten (KV2-8).",
        },
      ],
    },
  },
  {
    name: "route-in-router-form",
    files: [`src/routes/**/*.${ENDUNGEN}`],
    rules: {
      "no-restricted-syntax": [
        "error",
        demeterRegel,
        {
          selector: HANDLER_EXPORT_SELECTOR,
          message: ROUTER_FORM_MELDUNG,
        },
      ],
    },
  },
  {
    name: "kalibrierung-ohne-gate-tarif",
    files: [`src/billing/cost-calibration.${ENDUNGEN}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ENDUNGEN_LISTE.map((endung) => ({
            name: `../telephony/outbound-gates.${endung}`,
            importNames: ["tariffCentsPerMin"],
            message:
              "Die Kosten-Kalibrierung rechnet mit dem Tarif aus der Konfiguration, nicht mit tariffCentsPerMin der Gates (P5-12).",
          })),
        },
      ],
    },
  },
  {
    name: "anruf-unterbrechungen-nur-lesen",
    files: [`scripts/anruf-unterbrechungen.${ENDUNGEN_OHNE_JS}`],
    rules: {
      "no-restricted-imports": nurLesenImporte,
      "no-restricted-syntax": [
        "error",
        demeterRegel,
        schreibFunktion,
        { selector: 'Property[key.name="method"]', message: NUR_LESEN_MELDUNG },
        { selector: 'Property[key.value="method"]', message: NUR_LESEN_MELDUNG },
      ],
    },
  },
  {
    name: "probe-as-nur-lesen",
    files: [`scripts/probe-as-faehigkeiten.${ENDUNGEN_OHNE_JS}`],
    rules: {
      "no-restricted-imports": nurLesenImporte,
      "no-restricted-syntax": [
        "error",
        demeterRegel,
        schreibFunktion,
        { selector: "ImportExpression", message: "Die Sonde lädt keine Module nach (E1-15)." },
        {
          selector: "Property[key.name=/^authorization$/i]",
          message: "Die Sonde schickt keine Anmeldedaten (E1-15).",
        },
        {
          selector: "Property[key.value=/^authorization$/i]",
          message: "Die Sonde schickt keine Anmeldedaten (E1-15).",
        },
        { selector: "Identifier[name=/cookie/i]", message: "Die Sonde schickt keine Cookies (E1-15)." },
        { selector: "Literal[value=/cookie/i]", message: "Die Sonde schickt keine Cookies (E1-15)." },
        {
          selector: "TemplateElement[value.raw=/cookie/i]",
          message: "Die Sonde schickt keine Cookies (E1-15).",
        },
        {
          selector: "Property[key.name=/^methode?$/][value.value=/^(PUT|PATCH|DELETE)$/]",
          message: "Die Sonde fragt nur lesend ab (E1-15).",
        },
      ],
    },
  },
  {
    name: "iel-mess-auflegestufen",
    files: [`scripts/iel-mess*.${ENDUNGEN_OHNE_JS}`],
    ignores: ["scripts/iel-mess.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        demeterRegel,
        {
          selector: "VariableDeclarator[id.name=/^(HART_MAX_S|WACHHUND_AUFLEGEN_S|NACHFASSEN_S|NOTAUS_S)$/]",
          message:
            "Die Auflege-Stufen stehen genau einmal in scripts/iel-mess.mjs (Test 9a); die Hilfsmodule bekommen sie von dort.",
        },
      ],
    },
  },
];
const TS_ORDNER = "{src,test,tools,scripts}";
const TS_DATEIEN = [`${TS_ORDNER}/**/*.${TS_ENDUNGEN}`];
const TS_DEKLARATIONEN = [`${TS_ORDNER}/**/*.d.${TS_ENDUNGEN}`];
const UNGENUTZT_OPTIONEN = {
  vars: "all",
  args: "after-used",
  caughtErrors: "all",
  ignoreRestSiblings: false,
  ignoreClassWithStaticInitBlock: false,
  ignoreUsingDeclarations: false,
  reportUsedIgnorePattern: false,
};
const DEKLARATION_MELDUNG =
  "Eine eigene Typdeklaration behauptet Typen, ohne sie zu prüfen, wie ein as in anderer Form. Den Nachbarn selbst typisieren oder den Wert an der Grenze prüfen.";
const TYPWAECHTER_MELDUNG =
  "Ein Typwächter (wert is T, asserts wert is T, asserts wert) behauptet dem Typprüfer einen Typ, den niemand prüft, wie ein as in anderer Form. Den Wert an der Grenze prüfen und den geprüften Typ zurückgeben.";
const typenRegeln = { rules: { "keine-typwaechter": builtinRules.get("no-restricted-syntax") } };
const TS_VORGABEN = [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked];
const tsBloecke = [
  ...TS_VORGABEN.map((vorgabe) => ({ ...vorgabe, files: TS_DATEIEN })),
  {
    name: "typescript-sperrregeln",
    files: TS_DATEIEN,
    plugins: { "hermes-typen": typenRegeln },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "hermes-typen/keine-typwaechter": ["error", { selector: "TSTypePredicate", message: TYPWAECHTER_MELDUNG }],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-check": true, "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          ignoreVoid: false,
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "describe", "it", "suite"] },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", UNGENUTZT_OPTIONEN],
      "no-unreachable": "error",
    },
  },
];

export default [
  {
    ignores: [
      "node_modules/**",
      ".npm-cache/**",
      "coverage/**",
      "data/**",
      ".claude/workflows/runs/**",
      ".claude/worktrees/**",
      ".mutationspruefung/**",
      "**/dist/**",
      "**/dist-*/**",
      "**/build/**",
      "**/out/**",
      "**/.astro/**",
    ],
  },
  js.configs.recommended,
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      sonarjs,
      unicorn: unicornPlugin,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
      parser: espree,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": ["warn", UNGENUTZT_OPTIONEN],
      "no-console": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-useless-assignment": "warn",
      "no-regex-spaces": "warn",

      "no-unreachable": "error",

      "max-params": ["error", { max: 3 }],

      "max-depth": ["error", { max: 4 }],

      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],

      complexity: ["error", { max: 10 }],

      "no-magic-numbers": [
        "error",
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],

      "no-negated-condition": "error",

      "no-param-reassign": ["error", { props: true }],

      "no-useless-constructor": "error",

      "id-length": ["error", { min: 2, exceptions: ["i", "j", "k"] }],

      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "process.env nur in src/config.js verwenden (G35, CLAUDE.md). Lege den Wert dort in rawConfig an, nimm den Schlüssel in den passenden Namensraum von CONFIG_NAMESPACES auf, trage die Variable in .env.example ein und lies sie an dieser Stelle über config.<namensraum>.<schluessel>.",
        },
      ],

      "no-restricted-syntax": [
        "error",
        {
          selector: demeterChainSelector,
          message: demeterChainMessage,
        },
      ],

      "sonarjs/no-commented-code": "error",

      "unicorn/error-message": "error",
    },
  },
  ...tsBloecke,
  {
    name: "zustand-parameter-state",
    files: [`src/store/zustand/**/*.${ENDUNGEN}`],
    rules: {
      "no-param-reassign": ["error", { props: true, ignorePropertyModificationsFor: ["state", "tenant"] }],
    },
  },
  {
    files: ["apps/web/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["src/config.js"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["test/**"],
    rules: {
      "no-restricted-properties": "off",
      "no-magic-numbers": "off",
      "id-length": "off",
    },
  },
  {
    files: ["test/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: demeterChainSelector,
          message: demeterChainMessage,
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='skip'][callee.object.name=/^(test|it|describe)$/]",
          message: "uebersprungener Test (test.skip/it.skip/describe.skip) - T4, G4.",
        },
        {
          selector: "Property[key.name='skip'][value.value=true]",
          message: "uebersprungener Test ({ skip: true }) - T4, G4.",
        },
      ],
    },
  },
  {
    name: "zeitglieder-in-tests",
    files: ["test/**"],
    ignores: ["test/echt-warten.js", ...Object.keys(zeitgliederBestand)],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "setTimeout", message: ZEITGLIEDER_MELDUNG },
        { name: "setInterval", message: ZEITGLIEDER_MELDUNG },
      ],
      "no-restricted-imports": [
        "error",
        { paths: ZEITGLIEDER_MODULE.map((name) => ({ name, message: ZEITGLIEDER_MELDUNG })) },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Atomics", property: "wait", message: ZEITGLIEDER_MELDUNG },
        { object: "globalThis", property: "setTimeout", message: ZEITGLIEDER_MELDUNG },
        { object: "globalThis", property: "setInterval", message: ZEITGLIEDER_MELDUNG },
      ],
    },
  },
  ...dateiBloecke,
  ...hermesBloecke,
  ...testRegelBloecke,
  {
    name: "keine-eigenen-typdeklarationen",
    files: TS_DEKLARATIONEN,
    rules: { "no-restricted-syntax": ["error", { selector: "Program", message: DEKLARATION_MELDUNG }] },
  },
];
