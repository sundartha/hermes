// PER-RUN-Skript KV-P1 WIEDERAUFNAHME (Phase HART GEPINNT).
// Vorgeschichte: der erste Lauf (wf_af632311-4d5) hat die Phase fertig IMPLEMENTIERT und
// committet (049bacd), ist dann aber am StructuredOutput-Aufruf gestorben - die
// Markdown-Tabellen im Schema ergaben eine 16-KB-Nutzlast, die zweimal nicht parsebar war.
// LEHRE, hier umgesetzt: grosse Inhalte gehen in eine DATEI, das Schema traegt nur Skalare.
// Dieses Skript ueberspringt Plan und Implementierung und startet bei der Verifikation.

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P1 (Wiederaufnahme): fertigen Branch verifizieren, dualer Review, Self-Fix, Report - Implementierung liegt bereits als 049bacd vor.",
  phases: [
    { title: "Verifikation", detail: "Branch selbst nachmessen: npm test + die vier Mutationsproben" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-p1-report.md" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN HART GEPINNT (Lead): keine args-Abhaengigkeit, kein Misfire moeglich.
const PHASE = "KV-P1";
const PHASE_TITLE = "Die Kosten-Landkarte wird Struktur statt Konvention";
const BRANCH = "phase/kv-p1-kosten-landkarte";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-p1-report.md";
const TABLES_PATH = "tasks/kv-p1-tables.md";

const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-P1 aendert kein Verhalten -> komplett Sonnet.
// Pins explizit pro agent(), nie erben lassen (Memory [[workflow-model-policy]]).
const VERIFY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const SAFETY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE eingebetteten Zeilenumbrueche in laengeren Bloecken. Alles Umfangreiche schreibst du in eine DATEI und nennst im Feld nur den Pfad plus einen Satz. Der Vorlauf dieser Phase ist genau daran gestorben (16-KB-Nutzlast, nicht parsebar).`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog). Insbesondere: keine Duplizierung (G5/S2); Struktur schlaegt Konvention (G27 - das ist der Kern DIESER Phase); keine Magic Numbers ausser 0/1/-1 (G25); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N1/N7); eine Aufgabe pro Funktion (G30/G34), <=3 Argumente (F1); ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), Build-Operate-Check (P13), keine geteilte veraenderliche Fixture (P12).
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH danach, nicht nur im Diff. Ein Symbol kann ueber die Basis hereingekommen sein und taucht dann im Diff gar nicht auf. Ein S1 auf einer nicht durchgefuehrten Grep-Pruefung ist ein Fehlalarm und kostet eine ganze Runde (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae) - wie im Bestand.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE entfernen/aufweichen/per-Default umgehen.
- Diese Phase aendert KEIN Produktionsverhalten. Sie deklariert den IST-Zustand und pinnt ihn mit Tests.
- SECRETS nur via env, nie loggen/leaken - auch nicht in Fixtures.
- AUTH FAIL-CLOSED: keine neue Route, kein Endpunkt, keine HTTP-Ausgabe.
- Disclosure-Satz (disclosureSentence) unberuehrt.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_P1_SCOPE = `SCOPE DIESER PHASE (bindend):
ZIEL: Die Wurzel dieses Plans ist, dass es ZWEI Kostenbuecher gibt und KEINE Kante zwischen ihnen - Buch A ist der Verbrauchs-Ledger (\`usage_event\`, Schreiber \`recordUsageEvent\`), Buch B ist die Gate-Achse (\`usage.costCents\`/\`usage.spendMonthCostCents\`, Schreiber \`bookCents\` ueber \`trackUsage\`/\`addUsageCostCents\`/\`applyCreditCents\`, gelesen von \`budgetExceeded\`). Weil es keine Kante gibt, muss jede Kosten-Art ZWEIMAL von Hand verdrahtet werden. Vollstaendigkeit ist damit heute eine Eigenschaft der Sorgfalt, nicht der Struktur. Diese Phase macht sie zu einer Eigenschaft der Struktur (Clean-Code G27).

WAS DER BRANCH ${BRANCH} (Commit 049bacd) BEREITS ENTHAELT:
- src/billing/cost-ledger-map.js (neu, 122 Zeilen) - die deklarative Landkarte
- test/kv-p1-cost-ledger-map.test.js (neu, 400 Zeilen) - der Verhaltenstest
- src/billing/metering.js, src/llm-usage.js, src/telephony/call-finish.js - je NUR
  Kommentarzeilen, die auf die Landkarte zeigen (vom Lead selbst am Diff geprueft)

DIE DREI PFLICHTFELDER JE ZEILE, OHNE DEFAULT:
- \`ledger\` - schreibt diese Art einen \`usage_event\`?
- \`gate\` - erreicht diese Art \`usage.costCents\`?
- \`preisquelle\` - woher kommt der Betrag, und was passiert, wenn er fehlt?

DIE HAERTESTE ANFORDERUNG - DER TEST DARF KEINE TAUTOLOGIE SEIN:
Fuer JEDE Zeile muss der Test einen ECHTEN Buchungspfad AUSLOESEN und danach BEIDE Buecher lesen. Ein Test, der die Tabelle nur gegen sich selbst, gegen eine zweite Konstante, gegen ein handbefuelltes Store-Objekt oder gegen einen Regex ueber den Quelltext prueft, ist wertlos und verfehlt die Phase vollstaendig. Zeilen, die nicht ueber einen echten Pfad ausloesbar sind, MUESSEN als offener Befund ausgewiesen sein - nicht durch eine Deklarations-Prueferei kaschiert.

WEITERE RIEGEL, die vorhanden sein muessen:
- Vollstaendigkeits-Riegel: ein neuer Wert in \`USAGE_EVENT_KIND\` (src/store/defaults.js) ohne Tabellenzeile faerbt den Test rot; eine Tabellenzeile ohne Kosten-Art ebenfalls.
- Ein-Aufrufer-Riegel (Pre-Mortem TOD 2): \`addVoiceUsageCostCents\` hat repo-weit genau EINEN Aufrufer; ein zweiter faerbt den Test rot (Doppelbelastung des Kunden ist der Schadensfall).

KERNREGEL - DIESE PHASE AENDERT KEIN VERHALTEN:
Sie bildet den IST-Zustand ab, LUECKEN INKLUSIVE (\`voice_minute inbound: gate=nein\`, \`sms: gate=nein\`, \`tts: gate=nein\`, \`number_month: gate=nein\`). Wer eine Luecke "nebenbei" schliesst, hat die Phase verfehlt und macht die Kette unpruefbar - jede folgende Bau-Phase kippt genau EINE Zeile von \`nein\` auf \`ja\`, und der Test erzwingt, dass die Realitaet mitkippt. Die Tabelle ist der Fortschrittsanzeiger des ganzen Plans. Ein Diff, der einen Buchungspfad, eine Bedingung, einen Filter oder einen Betrag aendert, ist ein BLOCKER.

TEST-IDs: "KV-P1-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).

NICHT-ZIELE: keine neue Env-Variable, kein neues Flag, keine neue DB-Spalte, kein Backfill, keine geschlossene Luecke. NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A". Dateien EINZELN adden.`;

// ---------- Phase 1: Verifikation (die Implementierung liegt bereits vor) ----------
phase("Verifikation");
const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    tablesFileWritten: { type: "boolean", description: `Wurde ${TABLES_PATH} geschrieben?` },
    rowCount: { type: "number", description: "Anzahl Zeilen der Landkarte" },
    rowsWithRealTrigger: {
      type: "number",
      description: "Zeilen, die im Test ueber einen ECHTEN Buchungspfad ausgeloest werden",
    },
    unreachableRows: {
      type: "array",
      items: { type: "string" },
      description: "Je Zeile ohne echten Ausloeser: 'zeile - grund' (je hoechstens 150 Zeichen)",
    },
    mutationLie: {
      type: "string",
      description:
        "Probe (a) EINE Zeile luegen lassen: welche Zeile, welcher Test wurde rot, oder blieb er GRUEN? Hoechstens 400 Zeichen.",
    },
    mutationNewKind: {
      type: "string",
      description: "Probe (b) neuer USAGE_EVENT_KIND-Wert ohne Zeile: rot oder gruen? Hoechstens 300 Zeichen.",
    },
    mutationRemoveRow: {
      type: "string",
      description: "Probe (c) Tabellenzeile entfernt, Kosten-Art existiert weiter: rot oder gruen? Hoechstens 300 Zeichen.",
    },
    mutationSecondCaller: {
      type: "string",
      description:
        "Probe (d) zweiter Aufrufer von addVoiceUsageCostCents: rot oder gruen? Hoechstens 300 Zeichen.",
    },
    tautologyVerdict: {
      type: "string",
      description:
        "Dein Urteil: loest der Test echte Buchungspfade aus, oder prueft er Deklaration gegen Deklaration? Hoechstens 400 Zeichen.",
    },
    noBehaviourChange: {
      type: "boolean",
      description: "Der Diff aendert keinen Buchungspfad, keine Bedingung, keinen Filter, keinen Betrag",
    },
    gapsStillOpen: {
      type: "boolean",
      description:
        "Inbound bucht weiterhin NICHT auf die Gate-Achse; SMS/TTS/DID-Miete erreichen sie weiterhin nicht - selbst am Code geprueft",
    },
    mutationsReverted: { type: "boolean", description: "Alle Mutationen zurueckgenommen, Branch unveraendert" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: [
    "headCommit",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "tablesFileWritten",
    "rowCount",
    "rowsWithRealTrigger",
    "unreachableRows",
    "mutationLie",
    "mutationNewKind",
    "mutationRemoveRow",
    "mutationSecondCaller",
    "tautologyVerdict",
    "noBehaviourChange",
    "gapsStillOpen",
    "mutationsReverted",
    "summary",
  ],
};
const verify = await agent(
  `Du VERIFIZIERST eine bereits fertig implementierte Phase. Du implementierst NICHTS neu und aenderst den Branch NICHT (ausser fuer Mutationsproben, die du wieder zuruecknimmst).
Der Branch "${BRANCH}" (Commit 049bacd) traegt die vollstaendige Umsetzung von Phase ${PHASE}. Der Lauf davor ist erst NACH dem Commit gestorben, deshalb fehlt nur die Messung.

VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b verify-${String(PHASE).toLowerCase()} ${BRANCH}
3. Lies "${REPO}/${PLAN_DOC}" Abschnitt "KV-P1" + "Die gemeinsame Wurzel" + Pre-Mortem TOD 2/TOD 7. Lies dann den ECHTEN Code auf dem Branch: src/billing/cost-ledger-map.js und test/kv-p1-cost-ledger-map.test.js VOLLSTAENDIG, dazu src/store/defaults.js (USAGE_EVENT_KIND) und die Buchungspfade, die der Test ausloest.
4. npm test -> testsPass, testPassCount, testFailCount.
5. SCHREIBE die Datei "${REPO}/${TABLES_PATH}" (im HAUPT-Repo, nicht im Worktree - benutze den absoluten Pfad) mit ZWEI Markdown-Tabellen:
   (A) DIE LANDKARTE: je Zeile Kosten-Art | USAGE_EVENT_KIND | ledger | gate | preisquelle - woertlich aus src/billing/cost-ledger-map.js uebernommen, nichts nacherzaehlt.
   (B) DIE AUSLOESER-TABELLE: Kosten-Art | ECHTER Ausloeser im Test (konkreter Funktionsaufruf) | Assertion Buch A | Assertion Buch B. Zeilen ohne echten Ausloeser ausdruecklich als "KEIN echter Ausloeser: <grund>" markieren.
   Diese Datei ist der Beweis, dass der Test nicht tautologisch ist - sie entscheidet ueber die Phase.
6. FUEHRE DIE VIER MUTATIONSPROBEN SELBST DURCH, einzeln, jede danach zuruecknehmen:
   (a) EINE Tabellenzeile luegen lassen (eine gate=nein-Zeile auf gate=ja drehen) -> wird GENAU der zugehoerige Verhaltenstest rot? Bleibt er GRUEN, ist der Test eine Tautologie - das ist der wichtigste Befund dieser Phase und gehoert unverbluemt in tautologyVerdict.
   (b) einen neuen Wert in USAGE_EVENT_KIND ergaenzen, ohne Tabellenzeile -> rot?
   (c) eine Tabellenzeile entfernen, deren Kosten-Art es weiterhin gibt -> rot?
   (d) einen zweiten Aufrufer von addVoiceUsageCostCents anlegen -> rot?
   Nach jeder Probe zuruecknehmen und npm test erneut gruen fahren. Am Ende: git status sauber, git diff leer -> mutationsReverted=true.
7. SCOPE-PRUEFUNG: git diff ${BASE} ${BRANCH} -- src/. Aendert der Diff irgendwo eine Bedingung, einen Filter, einen Betrag oder einen Buchungspfad? In src/billing/metering.js, src/llm-usage.js und src/telephony/call-finish.js duerfen NUR Kommentarzeilen dazugekommen sein. Pruefe zusaetzlich am Code, dass die Luecken NOCH OFFEN sind: bucht Inbound weiterhin nicht auf die Gate-Achse? Erreichen SMS/TTS/DID-Miete sie weiterhin nicht?
8. KEIN Commit. Der Branch bleibt wie er ist.
${KV_P1_SCOPE}
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH: wenn Probe (a) gruen bleibt, sag das klar - eine geschoenigte Antwort hier macht die ganze Kette wertlos, weil jede folgende Phase sich auf diesen Test verlaesst.`,
  {
    label: `${PHASE}-verify`,
    phase: "Verifikation",
    schema: VERIFY_SCHEMA,
    isolation: "worktree",
    ...VERIFY_AGENT,
  },
);

// ---------- Phase 2: Dualer Review (parallel, wiederholbar) ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string", description: "Hoechstens 300 Zeichen" },
    scopeRespected: { type: "boolean" },
    noBehaviourChange: {
      type: "boolean",
      description:
        "SELBST geprueft: kein Buchungspfad, keine Bedingung, kein Filter, kein Betrag geaendert - nur additive Kommentare",
    },
    noGapClosed: {
      type: "boolean",
      description:
        "Keine Luecke 'nebenbei' geschlossen - inbound/sms/tts/number_month stehen weiterhin auf gate=nein, und der Code bucht sie weiterhin nicht",
    },
    testIsNotTautological: {
      type: "boolean",
      description:
        "SELBST verifiziert durch eigene Mutation (eine Zeile luegen lassen) - wurde der Test rot?",
    },
    completenessGuardWorks: {
      type: "boolean",
      description: "SELBST verifiziert: neuer USAGE_EVENT_KIND-Wert ohne Zeile -> Test rot",
    },
    singleCallerGuardWorks: {
      type: "boolean",
      description: "SELBST verifiziert: zweiter Aufrufer von addVoiceUsageCostCents -> Test rot",
    },
    tableReadableInReview: {
      type: "boolean",
      description: "Die Tabelle ist an EINER Stelle, geschlossen und kurz genug, dass ein Mensch sie vollstaendig liest",
    },
    unreachableRowsHonest: {
      type: "boolean",
      description: "Zeilen ohne echten Ausloeser sind als solche ausgewiesen, nicht kaschiert",
    },
    noSecretsLeaked: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 500 Zeichen" },
    concerns: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    verdict: { type: "string", description: "Hoechstens 600 Zeichen" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "scopeRespected",
    "noBehaviourChange",
    "noGapClosed",
    "testIsNotTautological",
    "completenessGuardWorks",
    "singleCallerGuardWorks",
    "tableReadableInReview",
    "unreachableRowsHonest",
    "noSecretsLeaked",
    "existingAssertionsNotWeakened",
    "disclosureIntact",
    "safetyGatesIntact",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 500 Zeichen" },
    s2: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 500 Zeichen" },
    s3: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    s4: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    blocker: { type: "boolean" },
    grepCheckDone: {
      type: "boolean",
      description:
        "Wurde vor jedem 'existiert nicht'-Befund am ausgecheckten Branch gegrept (nicht nur im Diff gelesen)?",
    },
    passNotes: { type: "string", description: "Hoechstens 500 Zeichen" },
    topTodos: { type: "array", items: { type: "string" } },
    verdict: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "grepCheckDone", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase soll KEIN Verhalten aendern und dafuer sorgen, dass kuenftige Kosten-Aenderungen nicht mehr unbemerkt an einem der zwei Buecher vorbeilaufen.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_P1_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet - glaube keinem Bericht:
- testIsNotTautological: DAS IST DER WICHTIGSTE PUNKT. Lies test/kv-p1-cost-ledger-map.test.js SELBST. Loest er fuer jede Zeile einen ECHTEN Buchungspfad aus und liest danach beide Buecher - oder vergleicht er Deklaration gegen Deklaration (zweite Konstante, handbefuelltes Store-Objekt, Regex ueber den Quelltext)? FUEHRE DIE MUTATION SELBST DURCH: dreh EINE gate=nein-Zeile auf gate=ja und lauf den Test. Bleibt er gruen, ist er wertlos - BLOCKER. Mutation zuruecknehmen.
- completenessGuardWorks: fuege TESTWEISE einen neuen Wert in USAGE_EVENT_KIND ein, ohne Tabellenzeile. Test rot? Wenn nein: BLOCKER. Zuruecknehmen.
- singleCallerGuardWorks: leg TESTWEISE einen zweiten Aufrufer von addVoiceUsageCostCents an. Test rot? Wenn nein: BLOCKER. Zuruecknehmen.
- noBehaviourChange + noGapClosed: git diff auf src/. Jede geaenderte Bedingung, jeder geaenderte Filter, jeder geaenderte Betrag ist ein BLOCKER - auch wenn er "richtig" aussieht. Diese Phase deklariert, sie repariert nicht. Pruefe insbesondere: bucht Inbound weiterhin NICHT auf die Gate-Achse? Erreichen SMS/TTS/DID-Miete sie weiterhin NICHT?
- tableReadableInReview: EINE Stelle, geschlossen, kurz? Eine verstreute oder generierte Tabelle erfuellt TOD 7 nicht - der einzige Schutz dort ist, dass ein Mensch sie im Diff vollstaendig liest.
- unreachableRowsHonest: suche gezielt nach Tests, die zwar echt aussehen, aber nur ein Store-Objekt von Hand befuellen und sich dann selbst pruefen.
- existingAssertionsNotWeakened: git diff auf test/ genau lesen.
BEVOR du behauptest, ein Symbol existiere nicht: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
${SCHEMA_RULE}
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren.`,
        {
          label: `${PHASE}-review-safety${suffix}`,
          phase: "Review",
          schema: SAFETY_SCHEMA,
          isolation: "worktree",
          ...SAFETY_AGENT,
        },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. ln -s "${NODE_MODULES}" node_modules ; git checkout -b cc-${String(PHASE).toLowerCase()}${suffix} ${target}
2. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
3. git diff ${BASE} ${target} ; neue Dateien vollstaendig lesen.
4. PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: git grep <symbol> am ausgecheckten Branch. Ein Symbol kann ueber die Basis hereingekommen sein und taucht im Diff nicht auf. Ein S1 auf ungepruefter Annahme ist ein Fehlalarm und kostet eine ganze Runde (Repo-Lehre KV-M0). Setze grepCheckDone erst auf true, wenn du das wirklich getan hast.
5. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf: (a) G27 Struktur > Konvention ist das THEMA - erzwingt die Loesung wirklich etwas, oder verlaesst sie sich auf Disziplin? (b) die Tabelle darf nicht dupliziert sein (G5/S2): eine Quelle, nicht eine im Code und eine im Test; (c) die drei Pflichtfelder brauchen eine echte Validierung, kein Kommentar-Versprechen; (d) die Verhaltenstests: ein Konzept pro Test (P14), Build-Operate-Check (P13), keine geteilte veraenderliche Fixture (P12/I), unterscheidbare Fixture-Werte je Fall (gleiche Werte testen nichts); (e) benannte Konstanten statt Magic Strings (G25); (f) Kommentare deutsch OHNE Umlaute; (g) toter/auskommentierter Code, ungenutzte Imports (C5/G9/G12).
${SCHEMA_RULE}
blocker=true wenn s1 ODER s2 nicht leer. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
          isolation: "worktree",
          ...CLEANCODE_AGENT,
        },
      ),
  ]);
}

const gateOk = (s, c) => !!(s && s.approved && c && !c.blocker);
const blockerList = (s, c) => [
  ...((s && s.blockers) || []),
  ...((c && c.s1) || []),
  ...((c && c.s2) || []),
];

phase("Review");
let reviewTarget = BRANCH;
let [safety, cc] = await runReview(reviewTarget, "");

// ---------- Phase 3: Self-Fix-Loop ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    rejectedAsFalsePositive: {
      type: "array",
      items: { type: "string" },
      description:
        "Blocker, die du NICHT reproduzieren konntest - je mit Kommando und widerlegendem Ergebnis, hoechstens 300 Zeichen",
    },
    filesTouched: { type: "array", items: { type: "string" } },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: ["headCommit", "testsPass", "committed", "summary"],
};
let round = 0;
const fixSummaries = [];
while (!gateOk(safety, cc) && round < MAX_FIX_ROUNDS) {
  round++;
  phase("Self-Fix");
  const fixBranch = `${BRANCH}-fix${round}`;
  const blockers = blockerList(safety, cc);
  const fix = await agent(
    `Du behebst die REVIEW-BLOCKER der Phase ${PHASE} in einem frischen Worktree. NUR die Blocker fixen, kein Scope-Drift.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. REPRODUZIERE JEDEN BLOCKER ZUERST. Ein Blocker ist eine Behauptung, kein Befund (Repo-Lehre KV-M0: ein Auditor meldete "Feld existiert nicht", obwohl es ueber die Basis hereingekommen war). Was sich nicht reproduzieren laesst, kommt nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen".
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_P1_SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren: dann committe eine Klarstellung (ein praezisierender Kommentar oder ein Test, der den vermeintlichen Defekt widerlegt) mit "fix(kv-p1): Review-Blocker geprueft (Runde ${round})". Ein ausbleibender Commit beendet die Schleife und laesst die Phase auf BLOCKED stehen, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(
    `r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`,
  );
  if (fix && Array.isArray(fix.rejectedAsFalsePositive) && fix.rejectedAsFalsePositive.length) {
    fixSummaries.push(
      `r${round} FEHLALARME: ${fix.rejectedAsFalsePositive.join(" | ").slice(0, 600)}`,
    );
  }
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 4: Prozessbericht ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
EHRLICHKEITSREGEL: dieser Bericht darf KEINE Absicherung behaupten, die nicht am Verhalten belegt ist. Wenn eine Zeile der Landkarte nur deklariert und nicht gegen einen echten Buchungspfad geprueft ist, MUSS das dort stehen - eine Landkarte, der man das nicht ansieht, ist gefaehrlicher als keine.
LIES ZUERST "${REPO}/${TABLES_PATH}" und uebernimm beide Tabellen woertlich in den Bericht (Landkarte + Ausloeser-Tabelle). Wenn die Datei fehlt, schreib das ausdruecklich hin.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die Landkarte; die Ausloeser-Tabelle als Beweis gegen Tautologie; das Tautologie-Urteil; Zeilen ohne echten Ausloeser als eigener, deutlicher Abschnitt; die vier Mutationsproben mit Ergebnis; der Vollstaendigkeits-Riegel und der Ein-Aufrufer-Riegel; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. Fehlalarme; ein Abschnitt "Wie die naechsten Phasen diese Tabelle benutzen": jede Bau-Phase kippt GENAU EINE Zeile von nein auf ja, und der Test erzwingt, dass die Realitaet mitkippt (KV-P2 kippt voice_minute/inbound); ein Abschnitt "Vorgeschichte dieses Laufs": die Implementierung entstand im Lauf wf_af632311-4d5 und wurde als 049bacd committet; dieser Lauf starb danach am StructuredOutput (16-KB-Nutzlast, nicht parsebar), weshalb Verifikation und Review separat nachgeholt wurden. Quelle:
=== VERIFIKATION ===
${JSON.stringify(verify, null, 1)}
=== SAFETY (final) ===
${JSON.stringify(safety, null, 1)}
=== CLEANCODE (final) ===
${JSON.stringify(cc, null, 1)}
=== FIXES ===
${fixSummaries.join("\n")}
Antworte NUR mit dem geschriebenen Dateipfad.`,
    { label: `${PHASE}-report`, phase: "Report", ...REPORT_AGENT },
  );
  reportPath = (reportAgent || "").toString().trim().slice(0, 300) || REPORT_PATH;
} catch {
  reportPath = "(Report fehlgeschlagen)";
}

return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (verify && verify.headCommit) || null,
  testPassCount: (verify && verify.testPassCount) || null,
  rowCount: (verify && verify.rowCount) ?? null,
  rowsWithRealTrigger: (verify && verify.rowsWithRealTrigger) ?? null,
  unreachableRows: (verify && verify.unreachableRows) || [],
  tautologyVerdict: (verify && verify.tautologyVerdict) || "",
  mutationLie: (verify && verify.mutationLie) || "",
  mutationNewKind: (verify && verify.mutationNewKind) || "",
  mutationRemoveRow: (verify && verify.mutationRemoveRow) || "",
  mutationSecondCaller: (verify && verify.mutationSecondCaller) || "",
  noBehaviourChange: verify ? verify.noBehaviourChange === true : false,
  gapsStillOpen: verify ? verify.gapsStillOpen === true : false,
  mutationsReverted: verify ? verify.mutationsReverted === true : false,
  tablesPath: verify && verify.tablesFileWritten ? TABLES_PATH : "(nicht geschrieben)",
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: verify && verify.summary ? verify.summary.slice(0, 600) : "",
};
