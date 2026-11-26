import js from "@eslint/js";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
import * as espree from "espree";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tseslint from "typescript-eslint";

import { existsSync, readdirSync, readFileSync } from "node:fs";

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
const PROCESS_ENV_REGEL = {
  object: "process",
  property: "env",
  message:
    "process.env nur in src/config.ts verwenden (G35, CLAUDE.md). Neue Konfiguration braucht drei Schritte: den Schlüssel in rawConfig und im passenden Namensraum von CONFIG_NAMESPACES in src/config.ts anlegen, die Variable in .env.example eintragen und render.yaml prüfen.",
};
const KALIBRIERUNG_IMPORTE = {
  paths: ENDUNGEN_LISTE.map((endung) => ({
    name: `../telephony/outbound-gates.${endung}`,
    importNames: ["tariffCentsPerMin"],
    message:
      "Die Kosten-Kalibrierung rechnet mit dem Tarif aus der Konfiguration, nicht mit tariffCentsPerMin der Gates (P5-12).",
  })),
};

const UHR_MELDUNG =
  "Uhr als Wert übergeben: Fachlogik im Anrufbereich liest die Uhr nicht selbst (Date.now, new Date(), performance.now, setTimeout, setInterval, setImmediate, node:timers, sleep und defaultSetTimer aus utils/uhr-warten), sondern bekommt sie vom Aufrufer. Tests steuern die Zeit mit t.mock.timers oder einem übergebenen now-Wert.";
const UHR_BESTAND = [
  "src/elevenlabs/outbound.js",
  "src/telephony/adapters/telnyx/numbers.js",
  "src/telephony/adapters/telnyx/rate-limit.ts",
  "src/telephony/adapters/telnyx/signature.ts",
  "src/telephony/call-lifecycle.ts",
  "src/telephony/outage-report.js",
  "src/telephony/outbound-gates.js",
  "src/telephony/reattach.ts",
];
const UHR_QUELLEN_ORDNER = ["store", "routes", "billing", "queue", "worker", "consult", "conversation"];
const UHR_QUELLEN_BESTAND = [
  "src/billing/card-setup.ts",
  "src/billing/cost-cross-check.ts",
  "src/billing/cost-truing.ts",
  "src/billing/paid-without-number-watch.ts",
  "src/billing/price-drift-watch.ts",
  "src/billing/provision-retry-sweep.ts",
  "src/billing/webhook.ts",
  "src/consult/delivery.ts",
  "src/consult/in-call.js",
  "src/conversation/consult-raised.js",
  "src/queue/adapters/memory/queue.ts",
  "src/queue/adapters/pgboss/queue.ts",
  "src/routes/api-billing.ts",
  "src/routes/api-calls.ts",
  "src/routes/api-read.ts",
  "src/routes/intern-anrufe-laufend.js",
  "src/routes/intern-status.js",
  "src/routes/stripe-webhook.ts",
  "src/routes/voice.ts",
  "src/routes/webhooks-elevenlabs-init.ts",
  "src/routes/webhooks-elevenlabs.ts",
  "src/store/anrufe.js",
  "src/store/bereiche.js",
  "src/store/budget-reserve-pg.js",
  "src/store/einstellungen-sql.js",
  "src/store/ersatz-spur.js",
  "src/store/instanz-besitz.js",
  "src/store/json.js",
  "src/store/kennzahlen.js",
  "src/store/leitungsplaetze-pg.js",
  "src/store/leitungsplaetze.js",
  "src/store/login-bremse.js",
  "src/store/mandant-sql.js",
  "src/store/nutzung-pg.js",
  "src/store/pg.js",
  "src/store/state-ops.js",
  "src/store/stripe-ereignis-register.js",
  "src/store/tts-ablage.js",
  "src/store/views.ts",
  "src/store/webhook-zustellung.js",
  "src/store/zustand/einstellungen.ts",
  "src/store/zustand/grundlagen.js",
  "src/store/zustand/listen.js",
  "src/store/zustand/nummern.ts",
  "src/store/zustand/nutzung.js",
  "src/worker/provisioning-orchestrator.ts",
];
const UHR_DATUM_REGEL = { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: UHR_MELDUNG };
const QUELL_DATEIEN = `src/**/*.${ENDUNGEN}`;
export const HERMES_REGELN_DATEI = new URL("./tools/eslint-rules/index.js", import.meta.url);
const QUELLTEXT_BESTAND = "tools/basis/quelltext-als-text.json";
const WURZEL = new URL("./", import.meta.url);
const vorhanden = (datei) => existsSync(new URL(datei, WURZEL));
function vorhandenerPfad(datei) {
  const zwilling = datei.replace(/\.js$/, ".ts");
  return !vorhanden(datei) && vorhanden(zwilling) ? zwilling : datei;
}
const ANRUFSTART = "src/anrufe/start/anrufstart.ts";
const I18N_DATEIEN = readdirSync(new URL("src/i18n/", WURZEL), { recursive: true })
  .filter((datei) => ENDUNGEN_LISTE.includes(datei.split(".").pop()))
  .map((datei) => `src/i18n/${datei.replaceAll("\\", "/")}`);
const EROEFFNUNG_NUR_IN = [ANRUFSTART, ...I18N_DATEIEN];
const WORT_NUR_IN_EINTRAEGE = [
  {
    name: "eroeffnung-platzhalter",
    nurIn: EROEFFNUNG_NUR_IN,
    meldung:
      "Die Platzhalter {{eroeffnung}} und {{opening_line}} der ersten Äußerung kommen nur aus src/anrufe/start/anrufstart.ts (anrufStart) und src/i18n; andere Stellen beziehen die Eröffnung von dort.",
  },
  {
    name: "eroeffnung-schreiben",
    art: "schluessel",
    nurIn: EROEFFNUNG_NUR_IN,
    meldung:
      "first_message und opening_line schreibt nur src/anrufe/start/anrufstart.ts (anrufStart) und src/i18n; Lesen bleibt überall erlaubt, geschrieben wird an keiner zweiten Stelle.",
  },
  {
    name: "offenlegung-lesen",
    art: "aufruf",
    nurIn: EROEFFNUNG_NUR_IN,
    meldung:
      "Den Offenlegungssatz liest nur src/anrufe/start/anrufstart.ts oder src/i18n über LOCALES.<lang>.disclosure; andere Stellen beziehen ihn als Ausfuhr von dort (CLAUDE.md Regel 2: keine zweite Stelle).",
  },
  {
    name: "telnyx-belegabruf",
    nurIn: ["src/billing/cost-truing.ts", "src/telephony/adapters/telnyx/voice.js"],
    meldung:
      "Den Telnyx-Belegabruf gibt es nur im Kosten-Abgleich src/billing/cost-truing.ts und im Telnyx-Adapter (LCT P3); Geld- und Gate-Pfade rufen ihn nie auf. Ein neuer Nutzer braucht einen Eintrag in eslint.config.js mit Freigabe der Owner.",
  },
  {
    name: "kein-anrufzeit-gate",
    nurIn: [
      "src/billing/cancellation-mail.ts",
      "src/claude.js",
      "src/elevenlabs/inbound-initiation.js",
      "src/elevenlabs/nanp-area-codes.ts",
      "src/elevenlabs/outbound.js",
      "src/elevenlabs/time-context.ts",
      "src/geo/resolve.js",
      "src/store.js",
      "src/begriffe/sprache-zeit.js",
      "src/store/json.js",
      "src/store/pg.js",
      "src/store/state-ops.js",
      "src/store/zustand/mandant.js",
      "src/web-auth.js",
    ],
    meldung:
      "Zeitzonen und Zeitzonen-Quellen gehören nicht in diese Datei (LAW-07: kein Anrufzeit-Gate). Wer eine Zeitzone braucht, braucht einen Eintrag in der nurIn-Liste dieser Regel in eslint.config.js mit Freigabe der Owner; Gate-Kette, Anrufabschluss und Dauerbegrenzung nie.",
  },
  {
    name: "trunk-beleg-felder",
    nurIn: [
      "src/store/zustand/nummern.ts",
      "src/store/pg.js",
      "src/elevenlabs/inbound-path-decision.js",
    ],
    meldung:
      "Die Beleg-Felder des Inbound-Trunks stehen nur im Store und in der Weiche (IEX-A8). Andere Module lesen und schreiben sie über die Store-Operationen (markNumberElInboundTrunkBelegt, clearNumberElInboundTrunkBeleg).",
  },
  {
    name: "anthropic-vokabular",
    nurIn: ["src/llm/adapters/anthropic.ts", "src/llm/adapters/deepseek.ts"],
    meldung:
      "Anbieter-Vokabular der LLM-Schnittstelle (input_schema, cache_control, max_tokens, tool_choice) steht nur in den LLM-Adaptern (B3B-1); der übrige Code bleibt anbieterneutral und ruft die Schnittstelle in src/llm/adapters/anthropic.ts oder deepseek.ts über den Adapter-Eingang auf.",
  },
  {
    name: "keine-aufnahme",
    nurIn: [],
    meldung:
      "Hermes nimmt keine Gespräche auf, und Audio läuft nie durch MCP (CLAUDE.md, Regel AUDIO); recordingUrl und startRecording gibt es im Code nicht. Brauchst du ein Gesprächsergebnis, nimm das Transkript und den Status über das MCP-Werkzeug get_call_result (registerGetCallResult in src/mcp/anruf-lesen.js), das pickTranscript und mapStatus aus src/mcp/anruf-ergebnis.js nutzt.",
  },
  {
    name: "tote-wahlwege",
    nurIn: [],
    meldung:
      "originateViaCallControl und originateAiAssistantCall sind stillgelegte Wahlwege ohne Gates (SEC-P6); Anrufe starten nur über originateCall und originateElevenLabsCall in src/routes/api-calls.ts.",
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
    nurIn: ["src/routes/api-calls.ts"],
    meldung:
      "originateCall und originateElevenLabsCall ruft nur src/routes/api-calls.ts auf, hinter allen Outbound-Gates (SEC-P6); ein neuer Wahlweg braucht dieselben Gates und eine Freigabe der Owner.",
  },
  {
    name: "inbound-tarif",
    nurIn: [
      "src/billing/cost-calibration.ts",
      "src/billing/metering.js",
      "src/config.ts",
      "src/konfiguration/rohwerte-billing.ts",
    ],
    meldung:
      "Der Inbound-Tarif wird nur in src/billing/metering.js (Buchung) und src/billing/cost-calibration.ts (Wächter) gelesen und nur in src/config.ts gesetzt (KV-P2-5).",
  },
  {
    name: "begriffe-sammeldatei",
    nurIn: [],
    meldung:
      "Die Sammeldatei src/store/defaults gibt es nicht mehr: Ein Begriff (Statuswert, Stufe, Konstante) steht in der passenden src/begriffe/<thema>.js und wird von dort importiert, nie in einer Sammeldatei.",
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
      "Dieses Skript setzt keine SIP-Zugangsdaten (IEL-B9-24); die Zugangsdaten verwaltet nur src/elevenlabs/nummern-registrierung.ts.",
  },
  { name: "oeffentliche-adresse", nurIn: [], meldung: SKRIPT_MELDUNG_ADRESSE },
];
const GEHEIMNIS_SKRIPT_WORT_NUR_IN = [
  {
    name: "inbound-geheimnis",
    nurIn: [],
    meldung:
      "Die Geheimnis-Skripte lesen den Inbound-Zugang nicht aus der Konfiguration des Dienstes (IEL-B10-15); sie arbeiten nur mit den Render-Umgebungsvariablen, die du dem Skript als process.env mitgibst.",
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
    datei: "src/llm/adapters/anthropic.ts",
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
const KONFIG_TABELLE = { datei: "src/config.ts", tabelle: "CONFIG_NAMESPACES" };
const STATUS_MODUL = "src/utils/http.ts";
const ZEIT_MODUL = "src/utils/timer.ts";
const MONAT_MODUL = "src/utils/month.js";
const SPEICHER_FASSADE = {
  fassade: "src/store.js",
  speicher: [{ datei: "src/store/pg.js", fabrik: "makePgStore" }, { datei: "src/store/json.js" }],
};
const ABLEHNUNGS_TABELLE = {
  datei: "src/i18n/mcp-denial-texts.ts",
  tabelle: "MCP_DENIAL_TEXTS",
  sprache: "en",
};
export const TESTREGELN_DATEI = new URL("./tools/eslint-rules/tests.js", import.meta.url);
const SELBSTPRUEFUNG_BESTAND = "tools/basis/selbstpruefung.json";
const FESTER_IMPORTPFAD_BESTAND = "tools/basis/fester-importpfad.json";
const SPEICHER_ATTRAPPE_BESTAND = "tools/basis/keine-speicher-attrappe.json";
const ECHT_WARTEN_BESTAND = "tools/basis/echte-wartezeiten.json";
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
    name: "hermes-status-aus-http",
    files: [QUELL_DATEIEN],
    rules: { "hermes/status-aus-http": ["error", { quelle: STATUS_MODUL }] },
  },
  {
    name: "hermes-zeiteinheiten-aus-timer",
    files: [QUELL_DATEIEN],
    ignores: ["src/ui/wing-canvas-engine.js"],
    rules: { "hermes/zeiteinheiten-aus-timer": ["error", { quelle: ZEIT_MODUL }] },
  },
  {
    name: "hermes-monatsrechnung-aus-month",
    files: [QUELL_DATEIEN],
    rules: { "hermes/monatsrechnung-aus-month": ["error", { quelle: MONAT_MODUL }] },
  },
  {
    name: "hermes-eingabe-nur-mit-schema",
    files: [QUELL_DATEIEN],
    rules: { "hermes/eingabe-nur-mit-schema": "error" },
  },
  {
    name: "hermes-eingabe-nur-mit-schema-nutzlast",
    files: [
      "src/telephony/adapters/telnyx/{webhook-events.js,speak-events.ts}",
      "src/billing/webhook.ts",
      "src/elevenlabs/inbound-initiation.js",
    ],
    rules: { "hermes/eingabe-nur-mit-schema": ["error", { nutzlast: true }] },
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
const ZEITGLIEDER_MELDUNG =
  "Echte Wartezeit in Tests ist gesperrt. Erlaubt: simulierte Zeit (t.mock.timers, jumpClock aus test/fake-clock.js), auf ein Ereignis warten, Reihenfolge über setImmediate oder queueMicrotask, Frist über die Option timeout von node:test oder spawn oder AbortSignal.timeout. echtWarten aus test/echt-warten.js gilt nur noch für den Altbestand in tools/basis/echte-wartezeiten.json.";
const ZEITGLIEDER_EIGENSCHAFTEN = [
  { object: "Atomics", property: "wait", message: ZEITGLIEDER_MELDUNG },
  { object: "globalThis", property: "setTimeout", message: ZEITGLIEDER_MELDUNG },
  { object: "globalThis", property: "setInterval", message: ZEITGLIEDER_MELDUNG },
];
const testRegelBloecke = [
  {
    name: "hermes-testregeln",
    files: ["test/**"],
    plugins: { "hermes-tests": testRegeln },
    rules: {
      "hermes-tests/keine-selbstpruefung": ["error", { bestand: SELBSTPRUEFUNG_BESTAND }],
      "hermes-tests/fester-importpfad": ["error", { bestand: FESTER_IMPORTPFAD_BESTAND }],
      "hermes-tests/anfrage-mit-frist": "error",
      "hermes-tests/keine-selbstaufruf": "error",
      "hermes-tests/keine-speicher-attrappe": ["error", { bestand: SPEICHER_ATTRAPPE_BESTAND }],
      "hermes-tests/testdatei-im-bereich": "error",
      "hermes-tests/kein-echt-warten": ["error", { bestand: ECHT_WARTEN_BESTAND, meldung: ZEITGLIEDER_MELDUNG }],
    },
  },
  {
    name: "hermes-anfrage-frist-produkt",
    files: [QUELL_DATEIEN],
    plugins: { "hermes-tests": testRegeln },
    rules: {
      "hermes-tests/anfrage-mit-frist": "error",
    },
  },
];

const demeterChainSelector =
  "MemberExpression MemberExpression MemberExpression MemberExpression";
const ZEITGLIEDER_MODULE = ["node:timers", "timers", "node:timers/promises", "timers/promises"];
const demeterChainMessage =
  "Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36). Leg das Zwischenergebnis in eine benannte Variable oder in eine kleine Funktion.";
const demeterRegel = { selector: demeterChainSelector, message: demeterChainMessage };
const UHR_TESTS_MELDUNG =
  "Echte Uhr in Tests ist gesperrt (Date.now, performance.now, new Date() ohne Argument, process.hrtime). Erlaubt: die gemeinsame Uhr aus test/fake-clock.js oder t.mock.timers, ein fester Zeitwert wie new Date(\"2026-01-01\"), oder auf ein Ereignis warten.";
const UHR_TESTS_BESTAND = [
  "test/_iel-inbound-harness.js",
  "test/abrechnung/312k-p5-cancellation-mail.test.js",
  "test/abrechnung/abo-abweichende-kennung.test.js",
  "test/abrechnung/abo-ende-fremdes-abo.test.js",
  "test/abrechnung/abo-plan-nach-verlorener-antwort.test.js",
  "test/abrechnung/abrechnung-liest-anrufe-aus-datenbank.test.js",
  "test/abrechnung/api-cost-drift.test.js",
  "test/abrechnung/api-cost-truing-sweep.test.js",
  "test/abrechnung/api-flush-meters.test.js",
  "test/abrechnung/b2-quota-gate.test.js",
  "test/abrechnung/bk4-self-service-quota.test.js",
  "test/abrechnung/budget-reserve-tabelle.test.js",
  "test/abrechnung/call-actual-cost-roundtrip.test.js",
  "test/abrechnung/cost-calibration.test.js",
  "test/abrechnung/cost-drift-boot.test.js",
  "test/abrechnung/cost-truing-booking.test.js",
  "test/abrechnung/cost-truing-observe.test.js",
  "test/abrechnung/cost-truing-pool.test.js",
  "test/abrechnung/cost-truing-schreibfehler.test.js",
  "test/abrechnung/cost-truing-sweep-log.test.js",
  "test/abrechnung/cost-truing-tts-characters.test.js",
  "test/abrechnung/cost-truing-zaehlzeile-fehlgeschlagen.test.js",
  "test/abrechnung/drift-bericht-unbeantwortet.test.js",
  "test/abrechnung/fw2-llm-billing-latch.test.js",
  "test/abrechnung/gap-04-activation-transaction.test.js",
  "test/abrechnung/h11-api-billing-fehlerweitergabe.test.js",
  "test/abrechnung/iel-b2-tarif.test.js",
  "test/abrechnung/inklusivminuten-nach-erstattung.test.js",
  "test/abrechnung/kostenabgleich-herkunft-gespeichert.test.js",
  "test/abrechnung/kostenabgleich-vormonat.test.js",
  "test/abrechnung/kostenabruf-messung-sweep.test.js",
  "test/abrechnung/ks-p2-live-carrier-spend.test.js",
  "test/abrechnung/kv-m3-coverage-denominator.test.js",
  "test/abrechnung/kv-p3-inbound-truing.test.js",
  "test/abrechnung/kv2-1-kosten-alarm-naht.test.js",
  "test/abrechnung/kv2-11-el-settlement.test.js",
  "test/abrechnung/kv2-4-el-kosten-beleg.test.js",
  "test/abrechnung/kv2-5-telnyx-sip-beleg.test.js",
  "test/abrechnung/kv2-6-deckung-herzschlag.test.js",
  "test/abrechnung/kv2-6-kosten-deckung-route.test.js",
  "test/abrechnung/kv2-7-nachlauf.test.js",
  "test/abrechnung/kv2-7-schliessregel.test.js",
  "test/abrechnung/kv2-8-settlement.test.js",
  "test/abrechnung/kv2-9-el-reifung.test.js",
  "test/abrechnung/kv2-9-nachlauf-zwangssettlement.test.js",
  "test/abrechnung/nur-us-nummern-zahlung.test.js",
  "test/abrechnung/openai-t2-09-neutrale-fehlertexte.test.js",
  "test/abrechnung/openai-t2-20-reviewer-seed-pg.test.js",
  "test/abrechnung/openai-t2-20-reviewer-seed.test.js",
  "test/abrechnung/p4-activation-order.test.js",
  "test/abrechnung/p4-money-events.test.js",
  "test/abrechnung/plan-cap-derivation.test.js",
  "test/abrechnung/profile-a2-activation.test.js",
  "test/abrechnung/prov01-boot-reconcile.test.js",
  "test/abrechnung/server-mit-testdatenbank.js",
  "test/abrechnung/stripe-ereignis-register-fehlerwege.test.js",
  "test/abrechnung/stripe-ereignis-register-gemeinsam.test.js",
  "test/abrechnung/stripe-geld-antwortfrist.test.js",
  "test/abrechnung/stripe-webhook.test.js",
  "test/abrechnung/usage-event-meter.test.js",
  "test/anmeldung/auth-p4-deleted-routes.test.js",
  "test/anmeldung/auth-p5-internal-only.test.js",
  "test/anmeldung/login-bremse-gemeinsam.test.js",
  "test/anmeldung/login-bremse-wurf-art.test.js",
  "test/anmeldung/sec-p6-waechter-werkzeugsatz.test.js",
  "test/anmeldung/web-auth-middleware.test.js",
  "test/anmeldung/web-login-verdrahtung.test.js",
  "test/anrufe/2940-h1-consult-profil.test.js",
  "test/anrufe/2973-h6b-idempotenz-liest-per-sql.test.js",
  "test/anrufe/2973-h7a-zaehler-per-sql.test.js",
  "test/anrufe/2973-h7b-nummern-per-sql.test.js",
  "test/anrufe/2973-h7b-start-helfer.js",
  "test/anrufe/2973-h7c1-flush-schreibt-nur-geaenderte-anrufe.test.js",
  "test/anrufe/2973-h7c2b4a-leser-ohne-spiegel.test.js",
  "test/anrufe/2973-h7c2b4b1-abrechnung-liest-per-sql.test.js",
  "test/anrufe/2973-h7c2b4b1-start-helfer.js",
  "test/anrufe/2973-h7c2b4b2-el-webhooks-sql.test.js",
  "test/anrufe/2973-h7c2b4b4-zaehler-sql.test.js",
  "test/anrufe/3266-a3-init-bearbeitungszeit.test.js",
  "test/anrufe/3303-init-outbound-binding.test.js",
  "test/anrufe/3303-outbound-el-profil.test.js",
  "test/anrufe/3365-vorspann-erzeugen-logik.test.js",
  "test/anrufe/3365-vorspann-erzeugen.test.js",
  "test/anrufe/3365-vorspann-init.test.js",
  "test/anrufe/3395-routen-consult-verhalten.test.js",
  "test/anrufe/3395-routen-init-verhalten.test.js",
  "test/anrufe/3403-api-calls-vorbereitung.test.js",
  "test/anrufe/4755-nicht-erreicht-frist.test.js",
  "test/anrufe/5183-uebergabe-einmal-eine-stimme.test.js",
  "test/anrufe/a8-abschluss-zusammenfassung.test.js",
  "test/anrufe/al-d1-cause-diagnostics.test.js",
  "test/anrufe/al-p11-result-card.test.js",
  "test/anrufe/al-p12-call-memory.test.js",
  "test/anrufe/al-p14-in-call-consult.test.js",
  "test/anrufe/alert-sms.test.js",
  "test/anrufe/annahmezeit-messung.test.js",
  "test/anrufe/annahmezeit-ohne-messung.test.js",
  "test/anrufe/anruf-ende-null-sekunden-mit-text-zaehlt-nicht-angenommen.test.js",
  "test/anrufe/anruf-export-postgres.test.js",
  "test/anrufe/anruf-lesen-ohne-anbinden.test.js",
  "test/anrufe/anruf-monatszaehlung-postgres.test.js",
  "test/anrufe/anruf-selfservice-zustand.test.js",
  "test/anrufe/anruf-zeitpunkte-fuer-anzeige.test.js",
  "test/anrufe/anruf-zustand-postgres.test.js",
  "test/anrufe/anrufe-pausieren.test.js",
  "test/anrufe/anrufende-messung-zusammenfassung.test.js",
  "test/anrufe/anrufende-messung.test.js",
  "test/anrufe/anrufstart-anbieter-abgleich.test.js",
  "test/anrufe/anrufstart-einreihen.test.js",
  "test/anrufe/auflegen-ueber-anrufsteuerung.test.js",
  "test/anrufe/ausfall-erholung-schliesst-vorfall.test.js",
  "test/anrufe/ausfall-meldung-als-vorfall.test.js",
  "test/anrufe/betriebsmeldungen-gehen-als-vorfall-an-better-stack.test.js",
  "test/anrufe/call-lifecycle-logzeilen.test.js",
  "test/anrufe/call-termination-order.test.js",
  "test/anrufe/deny-diagnosability.test.js",
  "test/anrufe/diagnostic-retention.test.js",
  "test/anrufe/directive-synth.test.js",
  "test/anrufe/eigene-nummer-ohne-plattform-gate.test.js",
  "test/anrufe/eigene-zeitzone-ohne-angabe.test.js",
  "test/anrufe/el-abfrage-frist-beim-abheben.test.js",
  "test/anrufe/el-action-items.test.js",
  "test/anrufe/el-anbieterfehler-anker.test.js",
  "test/anrufe/el-beende-versuch.test.js",
  "test/anrufe/el-boot-rearm.test.js",
  "test/anrufe/el-consult-timeout-spur.test.js",
  "test/anrufe/el-fixtures-echte-antworten.test.js",
  "test/anrufe/el-geldpfad-s1.test.js",
  "test/anrufe/el-medienweg-wache.test.js",
  "test/anrufe/el-sip-call-id-join.test.js",
  "test/anrufe/elevenlabs-anker-nachziehen.test.js",
  "test/anrufe/elevenlabs-anrufstart.test.js",
  "test/anrufe/elevenlabs-data-collection.test.js",
  "test/anrufe/elevenlabs-ende-export-ohne-kennungen.test.js",
  "test/anrufe/elevenlabs-ende-messung.test.js",
  "test/anrufe/elevenlabs-teil-a-grenzen.test.js",
  "test/anrufe/elevenlabs-zeitkontext.test.js",
  "test/anrufe/fehlergrund-vor-der-buchung.test.js",
  "test/anrufe/frist-ende-bewertung.test.js",
  "test/anrufe/fristen-abfrage-boot-json.test.js",
  "test/anrufe/fristen-boot-json.test.js",
  "test/anrufe/fristen-lesefehler-boot-json.test.js",
  "test/anrufe/fristen-lesefehler-nur-abgelaufene.test.js",
  "test/anrufe/fristen-reserve-boot-json.test.js",
  "test/anrufe/fristen-uebergabe-ohne-takt-zuschlag.test.js",
  "test/anrufe/geld-boot-json-aufbau.mjs",
  "test/anrufe/gespraechsverlauf-aufbewahrung.test.js",
  "test/anrufe/getcall-nur-eigene.test.js",
  "test/anrufe/hermes-mit-mail-neustart.js",
  "test/anrufe/hermes-mit-postgres.js",
  "test/anrufe/ie2-geld-wache.test.js",
  "test/anrufe/ie6-s2-realtime-entfernt.test.js",
  "test/anrufe/iel-b11-nachdeploy.test.js",
  "test/anrufe/iel-b4-nachlauf.test.js",
  "test/anrufe/iel-b5-status-ende.test.js",
  "test/anrufe/iel-b8-weiche.test.js",
  "test/anrufe/iel-inbound-bridges.test.js",
  "test/anrufe/iel-init-webhook.test.js",
  "test/anrufe/iep-p6-owner-ton.test.js",
  "test/anrufe/iex-a1-inbound-el-join.test.js",
  "test/anrufe/iex-a8-beleg.test.js",
  "test/anrufe/intern-anrufe-laufend.test.js",
  "test/anrufe/intern-anrufpause.test.js",
  "test/anrufe/leitungsplaetze-elevenlabs-freigabe.test.js",
  "test/anrufe/nachlauf-aktionspunkt-schreibfehler.test.js",
  "test/anrufe/openai-t2-08-stundenlimit-sperre.test.js",
  "test/anrufe/outbound-gates-verhalten.test.js",
  "test/anrufe/p15-gate-denial-language.test.js",
  "test/anrufe/p8-prompt-timezone.test.js",
  "test/anrufe/reattach-active-call.test.js",
  "test/anrufe/schutz-bei-ausgehenden-anrufen.test.js",
  "test/anrufe/stimmen-anzahl-ausweisen.test.js",
  "test/anrufe/telefonie-anrufende-verhalten.test.js",
  "test/anrufe/telefonie-waechter-verhalten.test.js",
  "test/anrufe/telnyx-adapter-verhalten.test.js",
  "test/anrufe/telnyx-p5-gate-proof.test.js",
  "test/anrufe/telnyx-p6-cap-callcontrol.test.js",
  "test/anrufe/uhr-vorspann.test.js",
  "test/anrufe/vorspann-el-fehler-grenzfaelle.test.js",
  "test/anrufe/webhook-el-kostendecke-sql.test.js",
  "test/anrufe/webhook-idempotenz-uhr.test.js",
  "test/anrufe/webhook-innerer-fehler-antwortet-intern.test.js",
  "test/anrufe/webhook-zustellung-aufbewahrung.test.js",
  "test/anrufe/webhook-zustellung-el-bein-ablage-ausfall.test.js",
  "test/anrufe/webhook-zustellung-loeschfrist-code.test.js",
  "test/anrufe/webhook-zustellung-loeschfrist.test.js",
  "test/anrufe/webhook-zustellung-nachlauf-zweifach.test.js",
  "test/anrufe/webhook-zustellung-rueckfall.test.js",
  "test/anrufe/webhook-zustellung-status-zweifach.test.js",
  "test/anrufe/webhook-zustellung-vorspann-zweifach.test.js",
  "test/anrufe/ww-f1-booking-mandate-contradiction.test.js",
  "test/anrufe/ww-p3-consult-prompt-routing.test.js",
  "test/anrufe/zaehlung-sql-postgres.test.js",
  "test/anrufe/ziel-erreicht-nach-auftrag.test.js",
  "test/anrufe/ziel-erreicht-nach-max-dauer.test.js",
  "test/anrufe/zustandsansicht-ratenbegrenzung.test.js",
  "test/anrufe/zwei-instanzen-postgres.js",
  "test/ausfallproben/ausfall-liest-anrufe-aus-datenbank.test.js",
  "test/ausfallproben/ausfallprobe-instanz-tod-meldet-gruen-oder-rot.test.js",
  "test/ausfallproben/ausfallprobe-postgres-neustart-meldet-gruen-oder-rot.test.js",
  "test/conversation-driver-contract.js",
  "test/cost-truing-harness.js",
  "test/gemeinsam/3365-vorspann-el-bein.test.js",
  "test/gemeinsam/3365-vorspann-fristen.test.js",
  "test/gemeinsam/al-p10b-lookup.test.js",
  "test/gemeinsam/aufbewahrung-sql.test.js",
  "test/gemeinsam/ausfall-server-wiring.test.js",
  "test/gemeinsam/ausgelieferte-ablehnungen.js",
  "test/gemeinsam/bootstrap-heal-boot.test.js",
  "test/gemeinsam/budget-failure-reason.test.js",
  "test/gemeinsam/budget-reserve-zwei-prozesse.test.js",
  "test/gemeinsam/cap-failure-reason.test.js",
  "test/gemeinsam/chatgpt-egress.test.js",
  "test/gemeinsam/eingabe-schema-webhooks.test.js",
  "test/gemeinsam/fristen-abfrage-pglite.test.js",
  "test/gemeinsam/fristen-geld-pglite.test.js",
  "test/gemeinsam/fristen-reserve-pglite.test.js",
  "test/gemeinsam/fristen-schreiben-pglite.test.js",
  "test/gemeinsam/fristen-sql-pglite.test.js",
  "test/gemeinsam/fristen-uebergabe-pglite.test.js",
  "test/gemeinsam/healthz-lokale-schaeden.test.js",
  "test/gemeinsam/iel-inbound-werkzeuge.test.js",
  "test/gemeinsam/kennzahlen-anrufe.js",
  "test/gemeinsam/kennzahlen-lauf-zaehlt-anmeldungen-und-abos.test.js",
  "test/gemeinsam/konfiguration-umgebungswerte.test.js",
  "test/gemeinsam/lebenszeichen-hilfe.mjs",
  "test/gemeinsam/lebenszeichen-meldet-nur-gesund.test.js",
  "test/gemeinsam/lebenszeichen-prueft-event-loop-und-datenbank.test.js",
  "test/gemeinsam/leitungsplaetze-eingehend-zwei-prozesse.test.js",
  "test/gemeinsam/leitungsplaetze-zwei-prozesse.test.js",
  "test/gemeinsam/max-duration-rearm.test.js",
  "test/gemeinsam/mcp-tools.test.js",
  "test/gemeinsam/migrationen-bereich-frist.test.js",
  "test/gemeinsam/month.test.js",
  "test/gemeinsam/openai-p4-ergebnisstruktur-instructions.test.js",
  "test/gemeinsam/openai-p7-token-pruefachsen.test.js",
  "test/gemeinsam/openai-s3-place-call-idempotenz.test.js",
  "test/gemeinsam/openai-t2-15-restricted-data.test.js",
  "test/gemeinsam/p4-number-request-eligibility.test.js",
  "test/gemeinsam/pool-schutz.test.js",
  "test/gemeinsam/postgres-echt.test.js",
  "test/gemeinsam/read-scope-tenant.test.js",
  "test/gemeinsam/ressourcenmessung-eventloop-intervall.test.js",
  "test/gemeinsam/retention.test.js",
  "test/gemeinsam/speichern-dauer-grenzen-in-sekunden.test.js",
  "test/gemeinsam/speichern-messung.test.js",
  "test/gemeinsam/spike1-consult-echo.test.js",
  "test/gemeinsam/status-monatszaehlung.test.js",
  "test/gemeinsam/statusroute-meldet-datenbank.test.js",
  "test/gemeinsam/statusroute-meldet-fruehwarnung.test.js",
  "test/gemeinsam/stopp-gesamtfrist-haengender-flush.test.js",
  "test/gemeinsam/stopp-ignoriert-abgebrochene-anfrage.test.js",
  "test/gemeinsam/stopp-wartet-auf-offene-anfragen.test.js",
  "test/gemeinsam/store-pg-tenant-budget.test.js",
  "test/gemeinsam/store-pg.test.js",
  "test/gemeinsam/telnyx-p6-boot-rearm.test.js",
  "test/gemeinsam/testprozess-endet-nach-letztem-test.test.js",
  "test/gemeinsam/tts-quota-counter.test.js",
  "test/gemeinsam/voice-budget-reconcile-finishcall.test.js",
  "test/gemeinsam/voice-speak-status.test.js",
  "test/gemeinsam/w5-abo-allowlist-gate.test.js",
  "test/gemeinsam/widget-anruffolge-video.mjs",
  "test/gemeinsam/widget-timer-live.test.js",
  "test/helpers.js",
  "test/helpers/inbound-router-harness.js",
  "test/helpers/uhr-festlegen.mjs",
  "test/mandant/sperre-place-call.test.js",
  "test/mandant/sperre-zwei-instanzen.test.js",
  "test/nummern/bootstrap-halt.test.js",
  "test/nummern/f1-provisioning-geo.test.js",
  "test/nummern/number-gate.test.js",
  "test/nummern/nummerntausch-absender.test.js",
  "test/nummern/nummerntausch-gesperrte-wege.test.js",
  "test/nummern/prov01-retry-redrive-http.test.js",
  "test/nummern/provisioning-enqueue-order.test.js",
  "test/pglite-helfer.js",
  "test/posteingang/aktionspunkte-per-sql.test.js",
  "test/posteingang/aufbewahrung-loeschung-per-sql.test.js",
  "test/posteingang/flush-loescht-nicht.test.js",
  "test/posteingang/lesen-per-sql.test.js",
  "test/posteingang/posteingang-poll-seite.test.js",
  "test/rueckfrage/al-p13-consult-channel.test.js",
  "test/rueckfrage/el-consult-neustart.test.js",
  "test/rueckfrage/el-consult-staffelung.test.js",
  "test/rueckfrage/elevenlabs-consult-webhook-blockers.test.js",
  "test/rueckfrage/elevenlabs-consult-webhook-guards.test.js",
  "test/rueckfrage/gq-p13-consult-answer-without-facts.test.js",
  "test/rueckfrage/gq-p2-consult-deadline.test.js",
  "test/rueckfrage/gq-p8-consult-arrival-marker.test.js",
  "test/rueckfrage/leere-antwort.test.js",
  "test/rueckfrage/rueckfrage-staende-am-echten-server.test.js",
  "test/rueckfrage/zusammenfassung-wartefrist.test.js",
  "test/sicherheit/abhaengigkeits-updates-wartezeiten.test.js",
  "test/sicherheit/ci-lockfile-alter.test.js",
  "test/sicherheit/fehler-log.test.js",
  "test/sicherheit/freigabe-queue-ruft-update-regel.test.js",
  "test/start/heilung-und-sweep-einmal.test.js",
  "test/start/rueckfrage-zwei-instanzen.test.js",
  "test/testbaenke-run.mjs",
  "test/utils/anbieter-aufrufe-anrufsteuerung.test.js",
  "test/utils/anbieter-aufrufe-lesen-webhook.test.js",
  "test/utils/anbieter-aufrufe-reservierung-verbrauch.test.js",
  "test/utils/anbieter-aufrufe-werden-gemessen.test.js",
  "test/website-onboarding/onboarding-route.test.js",
  "test/website-onboarding/p8-tenant-geo-timezone.test.js",
  "test/werkzeuge/anruf-probe-lauf.test.js",
  "test/werkzeuge/anruf-probe-modul.test.js",
  "test/werkzeuge/freigabe-pr-merge-stand.test.js",
  "test/werkzeuge/lastlauf-vorspann-ablauf.test.js",
  "test/werkzeuge/mutation-eingebettete-skripte.test.js",
  "test/werkzeuge/mutation-frist-arbeiterzahl-aus-pid-dateien.test.js",
  "test/werkzeuge/mutation-haengende-testdatei.test.js",
  "test/werkzeuge/mutation-zeilen-abdeckung.test.js",
  "test/werkzeuge/nachtlauf-vorfall.test.js",
  "test/werkzeuge/sofort-pruefen-architektur.test.js",
  "test/werkzeuge/staging-deploy-vorfall.test.js",
  "test/werkzeuge/tests-ohne-internet.test.js",
  "test/werkzeuge/vorfall-anbieterstatus.test.js",
];
const TEST_SYNTAX_REGELN = [
  {
    selector: demeterChainSelector,
    message: demeterChainMessage,
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='skip'][callee.object.name=/^(test|it|describe)$/]",
    message: "uebersprungener Test (test.skip/it.skip/describe.skip) - T4, G4. Entferne den Test oder repariere ihn, überspringe ihn nie.",
  },
  {
    selector: "Property[key.name='skip'][value.value=true]",
    message: "uebersprungener Test ({ skip: true }) - T4, G4. Entferne den Test oder repariere ihn, überspringe ihn nie.",
  },
];
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
  "Eine Route steht in Router-Form: `export function make<Name>Routes(…)` gibt einen `Router()` zurück (Muster: `src/routes/api-billing.ts`); Eingabe prüfst du mit einem Schema über den Helfer in `src/routes/_validation`.";
const NUR_LESEN_MELDUNG =
  "Dieses Skript liest nur: kein Dateisystem-Schreiben und keine schreibende HTTP-Methode. Nimm GET und gib das Ergebnis auf die Konsole aus, statt es in eine Datei zu schreiben.";
const DATEISYSTEM_MODULE = ["fs", "node:fs", "fs/promises", "node:fs/promises"];
const nurLesenImporte = [
  "error",
  { paths: DATEISYSTEM_MODULE.map((name) => ({ name, message: NUR_LESEN_MELDUNG })) },
];
const schreibFunktion = {
  selector: "Identifier[name=/^(writeFile|appendFile|createWriteStream)(Sync)?$/]",
  message: NUR_LESEN_MELDUNG,
};
const CENT_REGELN = [
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
];
const ROUTE_REGELN = [{ selector: HANDLER_EXPORT_SELECTOR, message: ROUTER_FORM_MELDUNG }];
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
      "no-restricted-syntax": ["error", demeterRegel, ...CENT_REGELN],
    },
  },
  {
    name: "route-in-router-form",
    files: [`src/routes/**/*.${ENDUNGEN}`],
    rules: {
      "no-restricted-syntax": ["error", demeterRegel, ...ROUTE_REGELN],
    },
  },
  {
    name: "kalibrierung-ohne-gate-tarif",
    files: [`src/billing/cost-calibration.${ENDUNGEN}`],
    rules: {
      "no-restricted-imports": ["error", KALIBRIERUNG_IMPORTE],
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
        { selector: "ImportExpression", message: "Die Sonde lädt keine Module nach (E1-15). Importiere oben in der Datei mit einem festen import." },
        {
          selector: "Property[key.name=/^authorization$/i]",
          message: "Die Sonde schickt keine Anmeldedaten (E1-15). Frag nur öffentliche Adressen ab, ohne Authorization-Kopf.",
        },
        {
          selector: "Property[key.value=/^authorization$/i]",
          message: "Die Sonde schickt keine Anmeldedaten (E1-15). Frag nur öffentliche Adressen ab, ohne Authorization-Kopf.",
        },
        { selector: "Identifier[name=/cookie/i]", message: "Die Sonde schickt keine Cookies (E1-15). Frag ohne Cookie-Kopf ab; nötige Antwort-Kopfzeilen liest du über antwort.headers.get." },
        { selector: "Literal[value=/cookie/i]", message: "Die Sonde schickt keine Cookies (E1-15). Frag ohne Cookie-Kopf ab; nötige Antwort-Kopfzeilen liest du über antwort.headers.get." },
        {
          selector: "TemplateElement[value.raw=/cookie/i]",
          message: "Die Sonde schickt keine Cookies (E1-15). Frag ohne Cookie-Kopf ab; nötige Antwort-Kopfzeilen liest du über antwort.headers.get.",
        },
        {
          selector: "Property[key.name=/^methode?$/][value.value=/^(PUT|PATCH|DELETE)$/]",
          message: "Die Sonde fragt nur lesend ab (E1-15). Nimm GET statt PUT, PATCH oder DELETE.",
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

      "no-restricted-properties": ["error", PROCESS_ENV_REGEL],

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
    files: ["src/config.ts"],
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
        ...TEST_SYNTAX_REGELN,
      ],
    },
  },
  {
    name: "zeitglieder-in-tests",
    files: ["test/**"],
    ignores: ["test/echt-warten.js", "test/gemeinsam/testgruppe.mjs", "test/gemeinsam/ppid-waechter.mjs", ...Object.keys(zeitgliederBestand)],
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
        ...ZEITGLIEDER_EIGENSCHAFTEN,
      ],
    },
  },
  {
    name: "uhr-in-tests",
    files: [`test/**/*.${ENDUNGEN}`],
    ignores: ["test/echt-warten.js", "test/gemeinsam/testgruppe.mjs", "test/gemeinsam/ppid-waechter.mjs", ...UHR_TESTS_BESTAND],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...TEST_SYNTAX_REGELN,
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: UHR_TESTS_MELDUNG },
        { selector: "MemberExpression[object.property.name='performance'][property.name='now']", message: UHR_TESTS_MELDUNG },
      ],
      "no-restricted-properties": [
        "error",
        ...ZEITGLIEDER_EIGENSCHAFTEN,
        { object: "Date", property: "now", message: UHR_TESTS_MELDUNG },
        { object: "performance", property: "now", message: UHR_TESTS_MELDUNG },
        { object: "process", property: "hrtime", message: UHR_TESTS_MELDUNG },
      ],
    },
  },
  {
    name: "uhr-als-wert",
    files: [`src/telephony/**/*.${ENDUNGEN}`, `src/elevenlabs/**/*.${ENDUNGEN}`],
    ignores: UHR_BESTAND,
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "setTimeout", message: UHR_MELDUNG },
        { name: "setInterval", message: UHR_MELDUNG },
        { name: "setImmediate", message: UHR_MELDUNG },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ZEITGLIEDER_MODULE.map((name) => ({ name, message: UHR_MELDUNG })),
          patterns: [{ regex: "(^|/)utils/(timer|uhr-warten)(\\.(js|ts))?$", importNames: ["sleep", "defaultSetTimer"], message: UHR_MELDUNG }],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: demeterChainSelector, message: demeterChainMessage },
        UHR_DATUM_REGEL,
      ],
      "no-restricted-properties": [
        "error",
        PROCESS_ENV_REGEL,
        { object: "Date", property: "now", message: UHR_MELDUNG },
        { object: "performance", property: "now", message: UHR_MELDUNG },
        { object: "globalThis", property: "setImmediate", message: UHR_MELDUNG },
        { object: "globalThis", property: "setTimeout", message: UHR_MELDUNG },
        { object: "globalThis", property: "setInterval", message: UHR_MELDUNG },
      ],
    },
  },
  ...dateiBloecke,
  ...hermesBloecke,
  ...testRegelBloecke,
  {
    name: "uhr-als-wert-quellen",
    files: UHR_QUELLEN_ORDNER.map((ordner) => `src/${ordner}/**/*.${ENDUNGEN}`),
    ignores: UHR_QUELLEN_BESTAND,
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "setTimeout", message: UHR_MELDUNG },
        { name: "setInterval", message: UHR_MELDUNG },
        { name: "setImmediate", message: UHR_MELDUNG },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ZEITGLIEDER_MODULE.map((name) => ({ name, message: UHR_MELDUNG })),
          patterns: [{ regex: "(^|/)utils/(timer|uhr-warten)(\\.(js|ts))?$", importNames: ["sleep", "defaultSetTimer"], message: UHR_MELDUNG }],
        },
      ],
      "no-restricted-syntax": ["error", demeterRegel, UHR_DATUM_REGEL],
      "no-restricted-properties": [
        "error",
        PROCESS_ENV_REGEL,
        { object: "Date", property: "now", message: UHR_MELDUNG },
        { object: "performance", property: "now", message: UHR_MELDUNG },
        { object: "process", property: "hrtime", message: UHR_MELDUNG },
        { object: "globalThis", property: "setImmediate", message: UHR_MELDUNG },
        { object: "globalThis", property: "setTimeout", message: UHR_MELDUNG },
        { object: "globalThis", property: "setInterval", message: UHR_MELDUNG },
      ],
    },
  },
  {
    name: "uhr-als-wert-quellen-kalibrierung",
    files: [`src/billing/cost-calibration.${ENDUNGEN}`],
    ignores: UHR_QUELLEN_BESTAND,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...ZEITGLIEDER_MODULE.map((name) => ({ name, message: UHR_MELDUNG })),
            ...KALIBRIERUNG_IMPORTE.paths,
          ],
          patterns: [{ regex: "(^|/)utils/(timer|uhr-warten)(\\.(js|ts))?$", importNames: ["sleep", "defaultSetTimer"], message: UHR_MELDUNG }],
        },
      ],
    },
  },
  {
    name: "uhr-als-wert-quellen-store",
    files: [`src/store/**/*.${ENDUNGEN}`],
    ignores: UHR_QUELLEN_BESTAND,
    rules: { "no-restricted-syntax": ["error", demeterRegel, ...CENT_REGELN, UHR_DATUM_REGEL] },
  },
  {
    name: "uhr-als-wert-quellen-routen",
    files: [`src/routes/**/*.${ENDUNGEN}`],
    ignores: UHR_QUELLEN_BESTAND,
    rules: { "no-restricted-syntax": ["error", demeterRegel, ...ROUTE_REGELN, UHR_DATUM_REGEL] },
  },
  {
    name: "keine-eigenen-typdeklarationen",
    files: TS_DEKLARATIONEN,
    rules: { "no-restricted-syntax": ["error", { selector: "Program", message: DEKLARATION_MELDUNG }] },
  },
];
