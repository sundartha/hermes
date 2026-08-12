import js from "@eslint/js";
import globals from "globals";
import sonarjs from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
import * as espree from "espree";

// Gesetz von Demeter (G36): ab dem 5. verketteten Punktzugriff in Folge
// (a.b.c.d.e) gilt eine Aufrufkette als Kopplungsrisiko - bis a.b.c.d bleibt
// sie erlaubt. Selektor zaehlt verschachtelte MemberExpression-Vorfahren.
const demeterChainSelector =
  "MemberExpression MemberExpression MemberExpression MemberExpression";
const demeterChainMessage =
  "Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)";

export default [
  {
    ignores: [
      "node_modules/**",
      ".npm-cache/**",
      "coverage/**",
      "data/**",
      // Wegwerf-Skripte je Workflow-Lauf (CLAUDE.md: nach Merge geloescht) -
      // die dauerhaften Werkzeuge unter .claude/workflows/*.js bleiben gelintet.
      ".claude/workflows/runs/**",
    ],
  },
  js.configs.recommended,
  {
    linterOptions: {
      // G4 - abgeschaltete Sicherungen sind laut CLAUDE.md hart verboten:
      // keine Inline-eslint-disable-Kommentare, keine stillen Leichen-Direktiven.
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
      // sonarjs/no-commented-code liest context.languageOptions.parser direkt
      // (cjs/S125/rule.js) und bricht ohne gesetzten Parser still ab - ESLint
      // setzt dieses Feld seit der Language-Plugin-Architektur (Flat Config)
      // nicht mehr implizit, auch wenn espree weiterhin der De-facto-Standard
      // ist. espree ist eine direkte Dependency von eslint selbst, keine neue
      // devDependency dieses Projekts.
      parser: espree,
      // Ohne eigene parserOptions faellt espree fuer die Regel auf seinen
      // Standard (ecmaVersion 5) zurueck - const/let/Arrow-Funktionen im
      // Kommentartext liessen die Regel dann scheitern. Diese Werte spiegeln
      // nur das, was oben in languageOptions bereits fuers Datei-Parsen gilt
      // (package.json: "type": "module"); am Parsen der Dateien selbst
      // aendert sich dadurch nichts.
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

      // --- Pruef-Harness-Ergaenzung (Clean-Code-Katalog, s. .claude/refs/clean-code.md) ---

      // G9 - bereits in js.configs.recommended enthalten, hier nur fixiert.
      "no-unreachable": "error",

      // F1 - Obergrenze aus CLAUDE.md ("Argumente": Obergrenze 3).
      "max-params": ["error", { max: 3 }],

      // CLAUDE.md Richtwert "Verschachtelungstiefe": Obergrenze 4.
      "max-depth": ["error", { max: 4 }],

      // P13, G30 - CLAUDE.md Richtwert "Funktionslaenge": Obergrenze 100 Zeilen.
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],

      // G30 - 10 ist der verbreitete McCabe-Schwellenwert fuer noch wartbare Funktionen.
      complexity: ["error", { max: 10 }],

      // G25 - Magic Numbers ausser 0/1/-1 sind laut CLAUDE.md hart verboten.
      "no-magic-numbers": [
        "error",
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],

      // G29 - negierte Bedingung mit else ist schwerer lesbar als die positive Form.
      "no-negated-condition": "error",

      // P6, F2 - Funktionen duerfen ihre Parameter (inkl. Properties) nicht mutieren.
      "no-param-reassign": ["error", { props: true }],

      // G12 - ein Konstruktor, der nur super(...args) durchreicht, ist ueberfluessig.
      "no-useless-constructor": "error",

      // N1, G16 - min 2: Ein-Buchstaben-Namen sind ausserhalb enger Scopes unlesbar.
      // N5: kurze Namen in winzigen Scopes sind RICHTIG - Schleifenzaehler ausgenommen.
      "id-length": ["error", { min: 2, exceptions: ["i", "j", "k"] }],

      // G35 - alle konfigurierbaren Werte gehoeren nach src/config.js (CLAUDE.md);
      // Ausnahme fuer genau diese Datei steht unten als eigener Override.
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

      // C5 - auskommentierter Code.
      "sonarjs/no-commented-code": "error",

      // P8 - new Error() ohne Message ist ein stummer Fehler.
      "unicorn/error-message": "error",
    },
  },
  {
    // Browser-side assets (served to the client)
    files: ["apps/web/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Workflow-Skripte laufen in einer eigenen Runtime, die diese Namen als
    // Globals bereitstellt (kein Import) - ohne diesen Block meldet no-undef
    // hier nur Rauschen. Dieselbe Runtime fuehrt den Dateiinhalt als
    // Funktionskoerper aus (vgl. CommonJS-Modul-Wrapper) - top-level
    // return ist dort gueltig, espree lehnt es ohne globalReturn als
    // Parse-Fehler ab (und ein Parse-Fehler ist nicht unterdrueckbar).
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
    // G35-Ausnahme: hier LEBT process.env, das ist der vorgesehene Sammelort.
    files: ["src/config.js"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    // T4, G4 - uebersprungene Tests duerfen nicht dauerhaft im Bestand bleiben.
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
];
