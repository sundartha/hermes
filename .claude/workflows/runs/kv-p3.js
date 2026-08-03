// PER-RUN-Skript KV-P3 (Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.
// Schema traegt NUR Skalare mit Laengenlimit (Lehre: 16-KB-Nutzlast toetet den Lauf).

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P3: Inbound in den Ist-Abgleich - die Schaetzung aus KV-P2 wird gegen die Provider-Belege korrigiert.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan inkl. Lastrechnung (Opus)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten (Opus) + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-p3-report.md" },
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
const PHASE = "KV-P3";
const PHASE_TITLE = "Inbound in den Ist-Abgleich";
const BRANCH = "phase/kv-p3-inbound-ist-abgleich";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-p3-report.md";
const LAST_PATH = "tasks/kv-p3-lastrechnung.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-P3 beruehrt Absolute Regel 1 (Geld-Pfad)
// -> Plan und Safety auf Opus/high, Impl/Audit/Fix/Report auf Sonnet.
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE langen eingebetteten Zeilenumbrueche. Alles Umfangreiche schreibst du in eine DATEI und nennst im Feld nur den Pfad plus einen Satz. Ein Vorlauf dieser Kette ist an einer 16-KB-Nutzlast gestorben, nachdem die Arbeit bereits committet war.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2); Geld NIE als Fliesskomma (G26/S1) - Mikro-Cent bleiben Ganzzahl; keine Magic Numbers ausser 0/1/-1 (G25); konfigurierbare Werte nach src/config.js (G35); Name auf der Abstraktionsebene der Funktion (N2 - ein Name, der "Outbound" behauptet, waehrend die Funktion beide Richtungen behandelt, ist eine Luege); ueberholte Kommentare sind gefaehrlich (C2 - was diese Phase unrichtig macht, MUSS mitgezogen werden); kein toter/auskommentierter Code (C5/G9); eine Aufgabe pro Funktion (G30/G34), <=3 Argumente (F1); ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), Grenzfaelle (T5), Build-Operate-Check (P13).
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Die pro-Tenant-Kostendecke ist ein GESCHUETZTES Gate. Diese Phase macht ihre Zahl GENAUER, sie schwaecht die Sperrwirkung NICHT.
- Die Inbound-Abweisung bei erschoepfter Decke (routes/voice.js) bleibt UNVERAENDERT (E11 bleibt zurueckgezogen). Jede Beruehrung ist ein BLOCKER.
- Alle uebrigen Safety-Gates NIE entfernen/aufweichen/per-Default umgehen.
- Disclosure-Satz unberuehrt. SECRETS nur via env, nie loggen.
- AUTH FAIL-CLOSED: keine neue Route, kein neuer Endpunkt.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_P3_SCOPE = `SCOPE DIESER PHASE (bindend):

AUSGANGSLAGE: KV-P2 ist gemergt. Ein beendeter Inbound-Call bucht jetzt eine SCHAETZUNG auf die Gate-Achse (VOICE_TARIFF_INBOUND_CENTS, 6 ct je angefangener Minute). Ohne Ist-Abgleich bleibt diese Schaetzung fuer immer stehen. Bei Outbound liegt die Schaetzung gemessen systematisch UEBER dem Ist (alle beobachteten Korrekturen waren negativ); bei Inbound ist der Abstand nach KV-M1 noch groesser - gemessene Ist-Kosten 1,87 US-Cent je angefangener Minute gegen 6 ct Schaetzung. **Ohne diese Phase belastet KV-P2 die Kunden dauerhaft um etwa das Dreifache der realen Kosten.** Das ist der Zweck von KV-P3, und er gehoert in den Bericht.

TEIL 1 - Der Richtungsfilter faellt:
- \`isEndedOutbound\` und \`isTruingCandidate\` (src/billing/cost-truing.js) verlieren ihren Richtungsfilter. \`isEndedOutbound\` verliert dabei auch seinen NAMEN - er behauptet danach eine Richtung, die die Funktion nicht mehr hat (N2). Zieh alle Aufrufer, Kommentare und Testnamen mit.
- Der Provider-Adapter kann Inbound bereits: die Zuordnung laeuft ueber den \`call_control_id\`-Anker und Session-Felder, beides richtungsunabhaengig. **PRUEFE DAS SELBST AM CODE, statt es zu glauben** - wenn die Zuordnung doch irgendwo eine Richtung annimmt, ist das der eigentliche Befund dieser Phase und gehoert in den Bericht, bevor eine Zeile Code entsteht.

TEIL 2 - Die Korrektur-Richtung verstehen, nicht reparieren:
- Die Delta-Buchung wird bei Inbound typischerweise NEGATIV sein (6 ct gebucht gegen ~1,9 ct Ist). Eine negative Korrektur laeuft ueber den Gutschrift-Pfad, und der riegelt bewusst gegen rueckwirkende Buchungen ueber PERIODENGRENZEN. Lies diesen Riegel und beschreibe im Bericht, was mit einer Korrektur passiert, die nach einem Periodenwechsel eintrifft. **Das ist Bestandsverhalten und wird NICHT geaendert** - es zu kennen ist Teil der Phase, es zu "reparieren" waere Scope-Bruch.
- Rechne im Bericht vor, was die Korrektur fuer die Reichweite bedeutet: wenn Inbound nach dem Abgleich real ~1,9 statt 6 ct/min kostet, wie viele Inbound-Minuten traegt die Starter-Decke dann? (Die Decken-Rechnung aus KV-P2 liegt in tasks/kv-p2-decken-rechnung.md.)

TEIL 3 - Die Lastrechnung (Pre-Mortem TOD 5, PFLICHT):
Schreibe sie nach "${REPO}/${LAST_PATH}" (falls Schreiben ausserhalb des Worktrees blockiert ist: in den Worktree schreiben und den Pfad nennen). Inhalt:
- Der Bruchpunkt-Waechter in cost-truing.js warnt ab einer bestimmten Zahl Provider-Anfragen je Sweep. Finde die Schwelle SELBST im Code (nicht aus dem Plan-Doc uebernehmen).
- KV-P3 erhoeht die Kandidatenzahl je Sweep um die Inbound-Calls. Rechne mit einer benannten, begruendeten Annahme, wie viele Anfragen ein Kandidat erzeugt, und sag, ab wie vielen Anrufen pro Sweep-Fenster die Schwelle reisst.
- Urteil: reisst die Schwelle bei realistischem Betrieb? Wenn ja, ist das ein BLOCKER und gehoert vor dem Merge geloest.

TEIL 4 - Die Deckungsquote (Wechselwirkung mit KV-M3, die NACH dieser Phase kommt):
- Inbound-Calls kommen jetzt in den Nenner von \`costTruingCoveragePercent\`. Die Quote ist heute schon strukturell rot (der Nenner enthaelt Calls, die gar keinen Beleg haben KOENNEN). Beschreibe im Bericht, in welche Richtung sich die Quote durch diese Phase bewegt - **aber aendere die Formel NICHT**. Das ist KV-M3, die naechste Phase.

TEIL 5 - Die Landkarte:
- **Diese Phase kippt KEINE Zeile.** \`voice_minute_inbound\` steht seit KV-P2 auf \`gate: true\`; KV-P3 fuegt keine neue Kosten-Kante hinzu, sondern macht eine vorhandene genauer. \`ledger\` und \`gate\` bleiben in ALLEN Zeilen unveraendert - eine Wertaenderung dort ist ein BLOCKER.
- Der \`preisquelle\`-Text der Inbound-Zeile DARF praezisiert werden (die Schaetzung wird jetzt korrigiert), muss aber nicht. Wenn du ihn anfasst, muss der KV-P1-Verhaltenstest weiter gruen sein.

DIE PFLICHT-ABNAHMEN:
(1) Ein beendeter INBOUND-Call mit gestellten Provider-Records bekommt \`cost_trued_at\`, \`actual_cost_micro_cents\` und eine Delta-Buchung auf der Gate-Achse. Mutationsprobe: Richtungsfilter wieder einsetzen -> dieser Test rot.
(2) Ein ZWEITER Sweep ueber denselben Call bucht NICHT erneut (\`costTruedAt !== null\` riegelt). Das ist der Riegel gegen Doppelbelastung (Pre-Mortem TOD 2) und muss fuer Inbound identisch greifen.
(3) Grenzfall: ein Inbound-Call OHNE persistierte Schaetzung landet in \`no_estimate\` und bucht nichts - genau der Zustand der historischen Altzeilen. Er darf keine Korrektur ausloesen und keinen Fehler werfen.
(4) Der Outbound-Pfad bleibt unveraendert: ein Bestandstest fuer Outbound-Truing muss ohne Anpassung gruen bleiben. Wenn du ihn anfassen musst, begruende es einzeln.

TEST-IDs: "KV-P3-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).

DEFINITION OF DONE, zusaetzlich: PLAN-SECURITY.md bekommt die Inbound-Kante des Ist-Abgleichs MIT ZAHLEN (Schaetzsatz 6 ct/min, gemessener Ist-Satz 1,87 US-Cent/min, die erwartete Korrekturrichtung, und das Restrisiko aus TOD 4: zwischen Buchung und Korrektur liegen COST_TRUING_DELAY_MINUTES plus ein Sweep-Takt, in denen das Gate nur die Schaetzung sieht).

NICHT-ZIELE (ausdruecklich):
- KEINE neue DB-Spalte, KEIN Backfill. Die historischen Inbound-Calls ohne Schaetzung bleiben in \`no_estimate\` - sie werden NICHT nachtraeglich bebucht.
- KEINE Aenderung an der Deckungsquoten-FORMEL (das ist KV-M3).
- KEINE Aenderung an der Sofortbuchung aus KV-P2, am Inbound-Satz, am Tarif oder am Preismodell.
- KEINE Aenderung an der Inbound-Abweisung in routes/voice.js.
- KEINE Aenderung am Gutschrift-Riegel gegen Periodengrenzen.
- KEIN zweiter Sweep, kein neuer Timer, kein Cron.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A". Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}": den Abschnitt "KV-P3" VOLLSTAENDIG, dazu "KV-P2" (die Phase davor, jetzt gemergt), das ERGEBNIS KV-M1, den Befund N4 (die Deckungsquote misst den falschen Nenner) und das Pre-Mortem TOD 2/TOD 4/TOD 5. Lies ausserdem "${REPO}/tasks/kv-p2-decken-rechnung.md" (die Decken-Rechnung der Vorphase).
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md" (Absolute Regeln).
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern (sie rotten):
   - src/billing/cost-truing.js VOLLSTAENDIG: \`isEndedOutbound\`, \`isTruingCandidate\`, der Sweep, die Delta-Buchung, der \`costTruedAt\`-Riegel, der Bruchpunkt-Waechter, \`costTruingCoveragePercent\`, \`bookTtsCharactersFor\`
   - der Provider-Adapter fuer die Kosten-Belege (telephony/adapters/telnyx/voice.js): wie werden Belege einem Call zugeordnet? Nimmt irgendetwas dort eine Richtung an? Das ist die Kernfrage von Teil 1.
   - src/store/state-ops.js: die Delta-/Gutschrift-Buchung, \`applyCreditCents\` und sein Riegel gegen Periodengrenzen, die Achsen-Anker
   - src/billing/metering.js: \`reconcileVoiceBudget\` (KV-P2, die Schaetzung, die hier korrigiert wird)
   - src/billing/cost-ledger-map.js + test/kv-p1-cost-ledger-map.test.js
   - test/: bestehende Cost-Truing-Tests, besonders die Outbound-Faelle, die unveraendert gruen bleiben muessen
4. ENTSCHEIDE UND BEGRUENDE:
   (a) Der neue Name fuer \`isEndedOutbound\` und alle Stellen, die mitziehen.
   (b) Nimmt die Beleg-Zuordnung im Adapter irgendwo eine Richtung an? Zeig die Fundstellen, an denen du das geprueft hast.
   (c) Was passiert mit einer NEGATIVEN Korrektur - welchen Pfad nimmt sie, und was macht der Periodengrenzen-Riegel damit? Beschreiben, nicht aendern.
   (d) Der \`costTruedAt\`-Riegel: greift er fuer Inbound identisch? Gibt es einen zweiten Pfad, der eine Korrektur ausloesen kann?
5. RECHNE DIE LASTRECHNUNG VOR (TOD 5): Schwelle des Bruchpunkt-Waechters aus dem Code, Anfragen je Kandidat, ab wie vielen Anrufen je Sweep-Fenster die Schwelle reisst, und das Urteil.
6. Nenne ausdruecklich, welche Bestandstests kippen und wie du mit jedem einzelnen umgehst. Ein Bestandstest, der "Inbound wird nicht abgeglichen" pinnt, ist eine ZUSAGE, die diese Phase bewusst dreht - er wird umgeschrieben, nicht geloescht, und die Aenderung wird begruendet.
7. PRE-MORTEM dieser Phase: ein Jahr spaeter hat KV-P3 Schaden angerichtet. Was ist passiert? Nenne mindestens: eine Korrektur wurde doppelt gebucht, weil der costTruedAt-Riegel bei Inbound nicht griff; der Sweep reisst den Bruchpunkt und faellt aus, wodurch AUCH Outbound nicht mehr korrigiert wird; eine negative Korrektur ueber eine Periodengrenze verschwindet stillschweigend und der Kunde bleibt auf der zu hohen Schaetzung sitzen; die Beleg-Zuordnung ordnet einem Inbound-Call fremde Belege zu. Fuer jedes: die Gegenmassnahme oder die ehrliche Feststellung eines getragenen Restrisikos.
${KV_P3_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei (Vorher/Nachher-Skizze); (2) die vier Pflicht-Abnahmen als konkrete Tests KV-P3-* mit Assertions plus Mutationsproben; (3) die Lastrechnung mit Zahlen und Urteil; (4) die Beschreibung der Korrektur-Richtung inkl. Periodengrenzen-Riegel; (5) den PLAN-SECURITY.md-Text ausformuliert; (6) das Pre-Mortem. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung. Je Eintrag hoechstens 250 Zeichen.",
    },
    renamedFunction: { type: "string", description: "Alter -> neuer Name, Zahl der mitgezogenen Stellen. Hoechstens 250 Zeichen." },
    adapterDirectionNeutral: {
      type: "string",
      description:
        "Nimmt die Beleg-Zuordnung im Provider-Adapter irgendwo eine Richtung an? Womit selbst geprueft? Hoechstens 400 Zeichen.",
    },
    correctionDirectionNote: {
      type: "string",
      description:
        "Welchen Pfad nimmt eine NEGATIVE Korrektur, und was macht der Periodengrenzen-Riegel damit? Hoechstens 400 Zeichen.",
    },
    lastRechnungPath: { type: "string", description: "Pfad der geschriebenen Lastrechnung" },
    lastRechnungVerdict: {
      type: "string",
      description:
        "Schwelle des Bruchpunkt-Waechters, Anfragen je Kandidat, ab wann sie reisst, Urteil JA/NEIN. Hoechstens 400 Zeichen.",
    },
    acceptance1: { type: "string", description: "Inbound-Call wird korrigiert: Testname + Ergebnis. Hoechstens 250 Zeichen." },
    acceptance2: { type: "string", description: "Zweiter Sweep bucht NICHT erneut: Testname + Ergebnis. Hoechstens 250 Zeichen." },
    acceptance3: { type: "string", description: "Inbound ohne Schaetzung -> no_estimate, keine Buchung, kein Fehler: Testname + Ergebnis. Hoechstens 250 Zeichen." },
    acceptance4: { type: "string", description: "Outbound-Bestandstest unveraendert gruen? Wenn angepasst: welcher und warum. Hoechstens 300 Zeichen." },
    coverageDirectionNote: {
      type: "string",
      description: "In welche Richtung bewegt sich die Deckungsquote durch diese Phase? Formel UNVERAENDERT? Hoechstens 300 Zeichen.",
    },
    noMapRowFlipped: {
      type: "boolean",
      description: "MUSS true sein: kein ledger/gate-Wert in der Landkarte geaendert",
    },
    voiceRouteUntouched: { type: "boolean" },
    creditPeriodGuardUntouched: { type: "boolean", description: "Der Gutschrift-Riegel gegen Periodengrenzen ist unveraendert" },
    coverageFormulaUntouched: { type: "boolean", description: "costTruingCoveragePercent unveraendert (das ist KV-M3)" },
    planSecurityUpdated: { type: "boolean" },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    mutationProbeResult: { type: "string", description: "Hoechstens 500 Zeichen" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: [
    "headCommit",
    "renamedFunction",
    "adapterDirectionNeutral",
    "correctionDirectionNote",
    "lastRechnungPath",
    "lastRechnungVerdict",
    "acceptance1",
    "acceptance2",
    "acceptance3",
    "acceptance4",
    "coverageDirectionNote",
    "noMapRowFlipped",
    "voiceRouteUntouched",
    "creditPeriodGuardUntouched",
    "coverageFormulaUntouched",
    "planSecurityUpdated",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "existingTestsAdjusted",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. REGEL 0: ZUERST \`git checkout -b ${BRANCH} ${BASE}\`, DANN erst lesen.
3. Umsetzung: Richtungsfilter raus + Umbenennung + Kommentare mitziehen; Tests KV-P3-*; PLAN-SECURITY.md; Lastrechnung nach "${LAST_PATH}".
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-p3): Inbound in den Ist-Abgleich".
${KV_P3_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests einzeln in existingTestsAdjusted begruenden.
6. npm run test:gates zusaetzlich (DARF rot sein). HINWEIS: test/auth-p9a-cache-headers.test.js haengt bekanntermassen unter --test-name-pattern (Bestandsdefekt, NICHT deine Aufgabe) - wenn der Lauf haengt, brich ab und melde es.
7. MUTATIONSPROBEN, einzeln, jede danach zuruecknehmen:
   (a) Richtungsfilter wieder einsetzen -> der Inbound-Korrektur-Test MUSS rot werden.
   (b) Den costTruedAt-Riegel entfernen -> der Zweiter-Sweep-Test MUSS rot werden (Doppelbuchung).
   Jede Mutation zuruecknehmen, npm test erneut gruen. Der finale Diff darf keine Mutation tragen.
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH fuellen. adapterDirectionNeutral ist keine Floskel: entweder du hast die Beleg-Zuordnung selbst gelesen (sag wo) oder nicht (sag das).`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    ...IMPL_AGENT,
  },
);

// ---------- Phase 3: Dualer Review ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string", description: "Hoechstens 300 Zeichen" },
    scopeRespected: { type: "boolean" },
    noDoubleCorrection: {
      type: "boolean",
      description:
        "SELBST verifiziert: ein zweiter Sweep korrigiert denselben Inbound-Call NICHT erneut; kein zweiter Pfad kann eine Korrektur ausloesen",
    },
    outboundPathUnchanged: {
      type: "boolean",
      description: "SELBST geprueft: der Outbound-Abgleich verhaelt sich unveraendert",
    },
    adapterDirectionNeutral: {
      type: "boolean",
      description:
        "SELBST am Adapter-Code geprueft: die Beleg-Zuordnung nimmt keine Richtung an; einem Inbound-Call werden keine fremden Belege zugeordnet",
    },
    creditPeriodGuardUntouched: { type: "boolean" },
    coverageFormulaUntouched: { type: "boolean", description: "costTruingCoveragePercent unveraendert (das ist KV-M3)" },
    noMapValueChanged: { type: "boolean", description: "Kein ledger/gate-Wert in der Landkarte geaendert" },
    voiceRouteUntouched: { type: "boolean" },
    sweepLoadAcceptable: {
      type: "boolean",
      description: "SELBST nachgerechnet: der Bruchpunkt-Waechter reisst bei realistischem Betrieb nicht",
    },
    noEstimateCaseSafe: {
      type: "boolean",
      description: "Ein Inbound-Call ohne Schaetzung bucht nichts und wirft nicht",
    },
    staleCommentsFixed: { type: "boolean" },
    planSecurityUpdated: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
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
    "noDoubleCorrection",
    "outboundPathUnchanged",
    "adapterDirectionNeutral",
    "creditPeriodGuardUntouched",
    "coverageFormulaUntouched",
    "noMapValueChanged",
    "voiceRouteUntouched",
    "sweepLoadAcceptable",
    "noEstimateCaseSafe",
    "staleCommentsFixed",
    "planSecurityUpdated",
    "noSecretsLeaked",
    "existingAssertionsNotWeakened",
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
    grepCheckDone: { type: "boolean" },
    passNotes: { type: "string", description: "Hoechstens 400 Zeichen" },
    verdict: { type: "string", description: "Hoechstens 400 Zeichen" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "grepCheckDone", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase korrigiert Betraege, die bereits auf einem geschuetzten Gate gebucht sind - ein Fehler hier belastet Kunden doppelt oder laesst sie auf einer dreifach zu hohen Schaetzung sitzen.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_P3_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet - glaube keinem Bericht:
- noDoubleCorrection: DAS IST DER WICHTIGSTE PUNKT (Pre-Mortem TOD 2). Lies den costTruedAt-Riegel und pruefe, ob er fuer Inbound IDENTISCH greift. Konstruiere: Sweep korrigiert, Prozess-Neustart, naechster Sweep - wird erneut gebucht? Gibt es einen zweiten Pfad (Retry, Redrive, manueller Endpunkt), der dieselbe Korrektur ausloest? Ein zweiter Aufrufer der Delta-Buchung ist ein BLOCKER.
- adapterDirectionNeutral: lies die Beleg-Zuordnung im Provider-Adapter SELBST. Kann einem Inbound-Call ein Beleg zugeordnet werden, der zu einem anderen Anruf gehoert? Der Anker ist die entscheidende Stelle - wenn er bei Inbound anders belegt ist als bei Outbound, ist das ein BLOCKER.
- outboundPathUnchanged: der Outbound-Abgleich lief bisher korrekt (8 von 8 belegbaren Calls belegt). Pruefe im Diff, dass sich fuer ihn nichts aendert - eine Regression dort waere teurer als der ganze Gewinn dieser Phase.
- sweepLoadAcceptable: finde den Bruchpunkt-Waechter SELBST im Code und rechne nach, ab wie vielen Kandidaten er anschlaegt. Reisst er bei realistischem Betrieb, faellt der Sweep aus - und dann wird AUCH Outbound nicht mehr korrigiert. Das waere ein BLOCKER.
- noEstimateCaseSafe: ein Inbound-Call ohne persistierte Schaetzung darf nichts buchen und nicht werfen. Pruefe den Pfad selbst.
- coverageFormulaUntouched + noMapValueChanged + creditPeriodGuardUntouched + voiceRouteUntouched: git diff. Jede Aenderung dort ist scope-fremd und ein BLOCKER.
- staleCommentsFixed: greppe nach Kommentaren, die behaupten, der Abgleich sei outbound-only. Stehen sie noch da, sind sie jetzt Luegen im Geld-Pfad (C2).
- existingAssertionsNotWeakened: git diff auf test/ genau lesen. Ein Bestandstest, der "Inbound wird nicht abgeglichen" pinnte, DARF gedreht werden - aber nur mit Begruendung.
BEVOR du behauptest, ein Symbol existiere nicht: greppe am AUSGECHECKTEN BRANCH (Repo-Lehre KV-M0).
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
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}").
1. ln -s "${NODE_MODULES}" node_modules ; git checkout -b cc-${String(PHASE).toLowerCase()}${suffix} ${target}
2. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
3. git diff ${BASE} ${target} ; neue Dateien vollstaendig lesen.
4. PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: git grep am ausgecheckten Branch. Ein Symbol kann ueber die Basis hereingekommen sein (Repo-Lehre KV-M0). grepCheckDone erst true, wenn wirklich getan.
5. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad. S3/S4 gebuendelt.
Achte besonders auf: (a) G26/S1 - Mikro-Cent bleiben Ganzzahl, keine Fliesskomma-Arithmetik, kein Runden an der falschen Stelle; (b) N2 - kein Funktionsname, der eine Richtung behauptet, die er nicht mehr hat; (c) C2 - Kommentare ueber "nur Outbound" muessen mitgezogen sein; (d) G5/S2 - keine zweite Kandidaten-Auswahl, keine zweite Delta-Buchung; (e) G25 - benannte Konstanten; (f) die neuen Tests: ein Konzept pro Test (P14), Grenzfaelle (T5 - ohne Schaetzung, zweiter Sweep, leere Belegliste), unterscheidbare Fixture-Werte je Fall; (g) Kommentare deutsch OHNE Umlaute; (h) toter Code, ungenutzte Imports.
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

// ---------- Phase 4: Self-Fix ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    rejectedAsFalsePositive: {
      type: "array",
      items: { type: "string" },
      description: "Blocker, die du NICHT reproduzieren konntest - mit Kommando und Ergebnis. Je Eintrag hoechstens 250 Zeichen.",
    },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string", description: "Hoechstens 400 Zeichen" },
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
3. REPRODUZIERE JEDEN BLOCKER ZUERST. Ein Blocker ist eine Behauptung, kein Befund (Repo-Lehre KV-M0). Was sich nicht reproduzieren laesst, kommt nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen".
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_P3_SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. node --check + npm test gruen. Dateien EINZELN adden, kein git stash.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren (dann eine Klarstellung committen) mit "fix(kv-p3): Review-Blocker geprueft (Runde ${round})". Ohne Commit bleibt die Phase auf BLOCKED, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(`r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`);
  if (fix && Array.isArray(fix.rejectedAsFalsePositive) && fix.rejectedAsFalsePositive.length) {
    fixSummaries.push(`r${round} FEHLALARME: ${fix.rejectedAsFalsePositive.join(" | ").slice(0, 500)}`);
  }
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht).`);
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Prozessbericht ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
LIES ZUERST die Lastrechnung. Sie sollte unter "${REPO}/${LAST_PATH}" liegen; fehlt sie dort, suche sie unter "${REPO}/.claude/worktrees/*/${LAST_PATH}" (ein Agent kann ausserhalb seines Worktrees nicht schreiben). Uebernimm sie WOERTLICH. Fehlt sie ganz, schreib das ausdruecklich hin.
EHRLICHKEITSREGEL: kein Schutz behaupten, der nicht am Code belegt ist. Ausdruecklich hineingehoerende Grenzen: zwischen Buchung und Korrektur liegen COST_TRUING_DELAY_MINUTES plus ein Sweep-Takt, in denen das Gate nur die Schaetzung sieht (TOD 4); die historischen Inbound-Calls ohne Schaetzung bleiben in no_estimate; die Live-Verifikation am echten KV-M1-Anruf steht bis zum Deploy aus.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; was gebaut wurde; die Umbenennung; der Beleg, dass die Beleg-Zuordnung richtungsneutral ist; die Korrektur-Richtung inkl. Periodengrenzen-Riegel; die Lastrechnung woertlich mit Urteil; die vier Pflicht-Abnahmen einzeln mit Testnamen; die Bewegung der Deckungsquote (und dass die Formel UNVERAENDERT blieb - das ist KV-M3); Mutationsproben; angepasste Bestandstests mit Begruendung; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. Fehlalarme; ein Abschnitt "Was diese Phase NICHT tut"; ein Abschnitt "Was der Lead nach dem Deploy verifizieren muss": der KV-M1-Anruf muss sich nach COST_TRUING_DELAY_MINUTES plus einem Sweep-Takt im Log als korrigiert nachweisen lassen - DAS ist die Live-Abnahme dieser Phase. Quelle:
=== PLAN ===
${(plan || "").slice(0, 12000)}
=== IMPL ===
${JSON.stringify(impl, null, 1)}
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
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  renamedFunction: (impl && impl.renamedFunction) || "",
  adapterDirectionNeutral: (impl && impl.adapterDirectionNeutral) || "",
  correctionDirectionNote: (impl && impl.correctionDirectionNote) || "",
  lastRechnungPath: (impl && impl.lastRechnungPath) || "",
  lastRechnungVerdict: (impl && impl.lastRechnungVerdict) || "",
  acceptances: [
    (impl && impl.acceptance1) || "",
    (impl && impl.acceptance2) || "",
    (impl && impl.acceptance3) || "",
    (impl && impl.acceptance4) || "",
  ],
  coverageDirectionNote: (impl && impl.coverageDirectionNote) || "",
  noMapRowFlipped: impl ? impl.noMapRowFlipped === true : false,
  coverageFormulaUntouched: impl ? impl.coverageFormulaUntouched === true : false,
  creditPeriodGuardUntouched: impl ? impl.creditPeriodGuardUntouched === true : false,
  voiceRouteUntouched: impl ? impl.voiceRouteUntouched === true : false,
  planSecurityUpdated: impl ? impl.planSecurityUpdated === true : false,
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  filesTouched: ((impl && impl.filesEdited) || []).slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
