import js from "@eslint/js";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
import * as espree from "espree";

import { existsSync, readFileSync } from "node:fs";

const ZEITGLIEDER_BESTAND_DATEI = new URL(
  "./tools/basis/zeitglieder-bestand.json",
  import.meta.url,
);
const zeitgliederBestand = existsSync(ZEITGLIEDER_BESTAND_DATEI)
  ? JSON.parse(readFileSync(ZEITGLIEDER_BESTAND_DATEI, "utf8"))
  : {};
const HERMES_REGELN_DATEI = new URL("./tools/eslint-rules/index.js", import.meta.url);
const KOMMENTAR_BESTAND = "tools/basis/kommentare.json";
const QUELLTEXT_BESTAND = "tools/basis/quelltext-als-text.json";
const WORT_NUR_IN = [
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
      "src/web-auth.js",
    ],
    meldung:
      "Zeitzonen und Zeitzonen-Quellen gehören nicht in diese Datei (LAW-07: kein Anrufzeit-Gate). Reine Anzeige außerhalb der Gate-Kette braucht einen Eintrag in eslint.config.js mit Freigabe der Owner; Gate-Kette, Anrufabschluss und Dauerbegrenzung nie.",
  },
  {
    name: "trunk-beleg-felder",
    nurIn: ["src/store/state-ops.js", "src/store/pg.js", "src/elevenlabs/inbound-path-decision.js"],
    meldung:
      "Die Beleg-Felder des Inbound-Trunks stehen nur im Store und in der Weiche (IEX-A8). Andere Module lesen und schreiben sie über die Store-Operationen (markNumberElInboundTrunkBelegt, clearNumberElInboundTrunkBeleg).",
  },
];
const hermesRegeln = existsSync(HERMES_REGELN_DATEI)
  ? (await import(HERMES_REGELN_DATEI.href)).default
  : undefined;
const hermesBloecke =
  hermesRegeln === undefined
    ? []
    : [
        {
          name: "hermes",
          plugins: { hermes: hermesRegeln },
          rules: {
            "hermes/keine-kommentare": ["error", { bestand: KOMMENTAR_BESTAND }],
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
          files: ["src/**/*.js"],
          rules: { "hermes/wort-nur-in": ["error", ...WORT_NUR_IN] },
        },
      ];

const demeterChainSelector =
  "MemberExpression MemberExpression MemberExpression MemberExpression";
const ZEITGLIEDER_MELDUNG =
  "Echte Wartezeit in Tests nur über echtWarten(ms) aus test/echt-warten.js. Sonst simulierte Zeit (t.mock.timers, jumpClock aus test/fake-clock.js), auf ein Ereignis warten, Reihenfolge über setImmediate oder queueMicrotask, Frist über die Option timeout von node:test oder spawn oder AbortSignal.timeout.";
const ZEITGLIEDER_MODULE = ["node:timers", "timers", "node:timers/promises", "timers/promises"];
const demeterChainMessage =
  "Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)";

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
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
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
          message: "process.env nur in src/config.js verwenden (G35, CLAUDE.md).",
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
  {
    files: ["apps/web/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: [".claude/workflows/**/*.js"],
    languageOptions: {
      globals: {
        agent: "readonly",
        parallel: "readonly",
        pipeline: "readonly",
        phase: "readonly",
        log: "readonly",
        args: "readonly",
        budget: "readonly",
        workflow: "readonly",
        meta: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { globalReturn: true },
      },
    },
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
  ...hermesBloecke,
];
