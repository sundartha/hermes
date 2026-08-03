// PER-RUN-Skript AL-D3 (Kopie von al-p17.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AL-D3: den Tool-Entscheidungspunkt schaerfen - enge Verbote statt Beschreibungen (Befund D-3).",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, zwei Commits, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/al-d3-report.md" },
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
const PHASE = "AL-D3";
const PHASE_TITLE = "Den Tool-Entscheidungspunkt schaerfen (Befund D-3)";
const BRANCH = "phase/al-d3-tool-entscheidungspunkt";
const BASE = "master";
const PLAN_DOC = "PLAN-ASSISTANT-LEAP.md";
const SPEC_FILE = "tasks/al-d3-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/al-d3-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Memory [[workflow-model-policy]], Kickoff-Vorgabe): Plan und Safety auf
// opus, Impl/Audit/Fix/Report auf sonnet. Pins explizit pro agent(), nie erben lassen.
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren, EINE Quelle fuer eine Zugehoerigkeit); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript.
UMLAUT-REGEL, HIER KRITISCH: Kommentare und Identifier OHNE Umlaute (ue/oe/ae). Die Tool-Beschreibungen in src/i18n/prompts/*.js sind dagegen MODELLTEXT und tragen KORREKTE Orthografie - deutsche Umlaute, franzoesische Akzente. Eine transliterierte Beschreibung ist ein Fehler, kein Stil.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN) NIE entfernen/aufweichen/per-Default umgehen.
- Die Werkzeug-Gates sind Safety-Gates: Richtungs-Gate (outbound-only), Kontingente (1x get_consult, 2x look_up), Frische-Bedingung, Flag x Tenant-Recht x Secret, der serverseitige Query-Filter (research/lookup-guard.js) und der Paraphrase-Zwang (consult/question.js) bleiben UNBERUEHRT. Der Prompt war nie die Durchsetzung.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet und unveraendert.
- Auth fail-closed. Secrets nur via env, nie loggen/leaken - auch nicht die Basic-Auth-Zugangsdaten, die der Bench-Apparat zum Pollen braucht.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const D3_SCOPE = `SCOPE DIESER PHASE (bindend, Spec ist die Autoritaet):
- GENAU EINE Produktaenderung: die Tool-Beschreibungen in src/i18n/prompts/de.js, en.js UND fr.js (E1 takeMessageDescription, E2 getConsultDescription, E3 lookUpDescription). Alles andere in dieser Phase ist Messapparat (E4/E5, NUR scripts/convo-bench/**) und Vertrag (E6, NUR test/**).
- KEINE Logik-Aenderung in src/claude.js. Kommentare dort duerfen praezisiert werden, wenn E1-E3 sie unrichtig machen - mehr nicht.
- KEINE neue Env-Variable und KEIN neues Flag auf dem Produktpfad. src/config.js, .env.example und render.yaml bleiben unangetastet. BASE_ENV in test/helpers.js bleibt unveraendert (EXA_API_BASE/EXA_API_KEY leer, die drei Flags auf false) - ein Test pinnt das.
- FAIL-SAFE-PFLICHT (Spec B2): take_message wird IMMER angeboten, get_consult und look_up NIE auf dem Inbound-Pfad. Jede Klausel, die auf ein anderes Werkzeug verweist, MUSS ihren Ausstiegssatz tragen ("wird dir das nicht angeboten, ..."). Eine Klausel ohne Ausstieg macht den Inbound-Agenten kaputt und ist ein BLOCKER.
- K4-AUFLOESUNG (Spec B3): look_up verlangt einen kurzen ueberbrueckenden Satz im SELBEN Zug. Der Bestandsriegel "Sage NIE, dass du nachschaust, und nenne NIE eine Quelle" BLEIBT. src/thinking-signal.js wird NICHT angefasst.
- BESTANDSSUBSTRING: der Selbe-Zug-Satz in takeMessageDescription ist per AL-P4-9 gepinnt ("in dieselbe Antwort" / "in the very same reply" / "dans la réponse MÊME"). Er muss erhalten bleiben.
- BENCH-APPARAT: kein echter Exa-Aufruf (lokaler Fake-HTTP-Server, EXA_API_BASE nur im gespawnten Kindprozess), kein echter Anruf. Vorlage fuer den Fake: test/al-p10b-lookup.test.js.
- DER WORKFLOW FUEHRT KEINEN BENCH-LAUF AUS. "npm run convo-bench" ist in dieser Phase VERBOTEN: es braucht Netz und einen echten ANTHROPIC_API_KEY und kostet je Lauf Geld. Die Messung macht der Lead nach dem Merge. Wer den Bench startet, hat die Phase verfehlt.
- TEST-IDs: "AL-D3-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist.
- ZWEI COMMITS, in dieser Reihenfolge (Spec B7): erst der Messapparat (E4+E5), DANN die Produktaenderung (E1-E3+E6). Nur so ist die Vorher-Messung mit demselben Apparat erhebbar. Beide Hashes zurueckmelden.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien einzeln adden.
- NICHT-ZIELE: D-4 (Poll-Frische/CONSULT_POLL_FRESH_MS) wird NICHT gefixt - die Consult-Pumpe im Bench ist Messapparat, kein Fix. D-5 (STT) und D-6 (Eroeffnung) nicht anfassen. Die AL-P17-Streaming-Armierung bleibt eine ALLOWLIST und wird nicht gedreht. Kein Modellwechsel, kein Stack-Umbau, keine neue Faehigkeit.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase (verbindlich vor dem Plan-Doc). Lies ausserdem "${REPO}/tasks/al-handover-2026-08-01.md" (Abschnitt 1, Befund D-3: die Messung, auf der diese Phase steht) und "${REPO}/tasks/al-d2-diagnose.md" Abschnitt 5 (der K4-Befund samt Begruendung, warum die Bruecken-Mechanik NICHT der Hebel ist).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/i18n/prompts/de.js, en.js, fr.js (Block "tools"), src/claude.js (toolDefs, getConsultToolDef, lookUpToolDef, agentTools, execTool), src/consult/in-call.js (consultAvailableFor), src/research/in-call.js (lookupProviderFor/lookupAvailableFor), scripts/convo-bench/runner.mjs (buildEnv, extractStoreSnapshot, pushSample, der Turn-Loop), scripts/convo-bench/checks.mjs (Check-Registry + wie ein Check an seine Signale kommt), scripts/convo-bench/metrics-parse.mjs, scripts/convo-bench/scenarios/ (Aufbau eines Szenarios, besonders mandat-innerhalb und friseur-voll), src/metrics.js (logTurn), test/al-p10b-lookup.test.js (der Exa-Fake), test/al-p14-in-call-consult.test.js (Muster), test/al-p8-bench-checks.test.js, test/p11-agent-language-contract.test.js, test/al-p4-side-effect-tool-loop.test.js (AL-P4-8/AL-P4-9), test/helpers.js (BASE_ENV, startServer). Grep nach Symbolen - KEINE Zeilennummern uebernehmen (sie rotten).
4. Formuliere die neuen Klauseln fuer E1/E2/E3 AUSFORMULIERT und dreisprachig (de/en/fr), Satz fuer Satz, mit Begruendung je Klausel, welche der vier Regeln R1-R4 sie traegt. Das ist der Kern der Phase - hier wird nicht improvisiert. Deutsche Umlaute und franzoesische Akzente korrekt setzen.
5. Zaehle je Description und Sprache die Zeichen VORHER und die geplanten NACHHER-Zeichen. E1 muss mindestens so viel entfernen, wie E1-E3 hinzufuegen. Wachstum ueber 30% braucht eine ausdrueckliche Begruendung - Bloat am Entscheidungspunkt kippt Haiku in Ueberkorrektur (Repo-Lehre call-quality-chain).
6. Pruefe fuer JEDE neue Klausel den Inbound-Fall: get_consult und look_up sind dort NIE im Werkzeugsatz. Ergibt der Text dann noch eine eindeutige, richtige Anweisung? Nenne den Ausstiegssatz je Klausel.
7. Nenne ausdruecklich, welche Bestandstests und welche Bench-Bestandsszenarien durch die Aenderung kippen koennten und wie du mit jedem einzelnen umgehst.
${D3_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei (Vorher/Nachher) fuer E1, E2, E3, dreisprachig ausformuliert; (2) den Bauplan des Bench-Apparats E4 (Env-Naht in buildEnv, Exa-Fake, Consult-Pumpe) und E5 (neue Checks aus dem bereits geloggten tools-Feld + vier Szenarien); (3) die neuen Tests AL-D3-* mit konkreten Assertions, inklusive Sprach-Paritaetstest und dem Negativfall R3 als EIGENEM Fall; (4) die Zeichenzahl-Tabelle vorher/geplant; (5) die Inbound-Pruefung je Klausel; (6) die Mutationsproben; (7) den Commit-Schnitt (was in den Apparat-Commit, was in den Produkt-Commit). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    apparatusCommit: { type: "string", description: "Hash des Commits mit E4+E5 (Messapparat)" },
    productCommit: { type: "string", description: "Hash des Commits mit E1-E3+E6 (Produktaenderung)" },
    headCommit: { type: "string" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung",
    },
    clauseRationale: {
      type: "array",
      items: { type: "string" },
      description:
        "Je neuer/entfernter Klausel eine Zeile: Werkzeug - Regel R1-R4 - was der Satz sagt - der Ausstiegssatz fuer den Inbound-Fall",
    },
    charCountTable: {
      type: "string",
      description:
        "Markdown-Tabelle: Description x Sprache, Zeichen vorher/nachher/Delta in Prozent",
    },
    inboundSafetyVerdict: {
      type: "string",
      description:
        "Ergebnis der Inbound-Pruefung: bleibt take_message ohne get_consult/look_up eine eindeutige, richtige Anweisung? Womit belegt?",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates (Baseline 3)" },
    mutationProbeResult: { type: "string" },
    parityProbeResult: {
      type: "string",
      description:
        "Mutationsprobe des Sprach-Paritaetstests: eine Klausel NUR in de.js aendern -> wurde er rot? Welcher Test, welche Meldung?",
    },
    benchNotRun: {
      type: "boolean",
      description: "MUSS true sein: es wurde KEIN convo-bench-Lauf gestartet",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "apparatusCommit",
    "productCommit",
    "headCommit",
    "clauseRationale",
    "charCountTable",
    "inboundSafetyVerdict",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "parityProbeResult",
    "benchNotRun",
    "existingTestsAdjusted",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. ZUERST der Messapparat: E4 (Env-Naht in buildEnv, lokaler Exa-Fake, Consult-Pumpe) und E5 (neue Checks + vier Szenarien + Bestandsschutz mandat-innerhalb). node --check, npm test gruen, dann Dateien EINZELN adden und committen: "feat(al-d3): Bench-Apparat - get_consult/look_up im Bench ueberhaupt messbar machen". Diesen Hash als apparatusCommit merken.
4. DANN die Produktaenderung: E1/E2/E3 in allen DREI Sprachdateien + E6 (Vertragstests AL-D3-*, Sprach-Paritaetstest, Registry-Test, BASE_ENV-Test). node --check, npm test gruen, einzeln adden und committen: "feat(al-d3): enge Verbote am Tool-Entscheidungspunkt". Diesen Hash als productCommit merken.
${D3_SCOPE}
${CLEAN_CODE_REQ}
5. npm test nach BEIDEN Commits gruen. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden (ID, alte Zusage, neue Zusage, warum das die Absicht ist). Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
6. npm run test:gates - die Baseline ist 3 rot (GAP-05, GAP-15 zweimal). Mehr rot = deine Aenderung, in deviations. Zahl in gatesRedCount.
7. Mutationsproben: (a) je Klausel R1-R4 die Klausel entfernen -> GENAU der zugehoerige Test rot, nicht die halbe Suite; (b) Paritaetsprobe: eine Klausel NUR in de.js aendern -> der Paritaetstest MUSS rot werden. Jede Mutation ZURUECKNEHMEN und npm test erneut gruen fahren. Der finale Diff darf keine Mutation tragen.
8. Zeichenzahl je Description und Sprache vorher/nachher messen (z.B. mit node -e und den beiden Commits) und als charCountTable liefern.
9. KEIN Bench-Lauf. benchNotRun=true. Wenn du versucht warst: nicht tun, es kostet Geld und braucht Netz.
10. node_modules-Symlink NICHT committen. Nach dem Lauf pruefen: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen. inboundSafetyVerdict ist keine Floskel: entweder du hast den Inbound-Fall am Text nachgerechnet (sag wie) oder du hast es nicht getan (sag das).`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    ...IMPL_AGENT,
  },
);

// ---------- Phase 3: Dualer Review (parallel, wiederholbar) ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    scopeRespected: { type: "boolean" },
    failSafeClauses: {
      type: "boolean",
      description:
        "Jede verweisende Klausel traegt ihren Ausstieg; der Inbound-Agent bleibt ohne get_consult/look_up handlungsfaehig",
    },
    languageParityEnforced: {
      type: "boolean",
      description: "de/en/fr tragen dieselben Klauseln UND ein Test faerbt eine DE-only-Aenderung rot",
    },
    toolGatesIntact: {
      type: "boolean",
      description:
        "Richtungs-Gate, Kontingente, Frische, Flag x Tenant x Secret, lookup-guard und Paraphrase-Zwang unveraendert",
    },
    noProductEnvChange: {
      type: "boolean",
      description: "Keine neue Env/Flag auf dem Produktpfad; config.js/.env.example/render.yaml/BASE_ENV unberuehrt",
    },
    benchApparatusIsolated: {
      type: "boolean",
      description: "Apparat lebt nur in scripts/ und test/; kein Leck in .env, BASE_ENV oder Produktcode",
    },
    noRealExaCalls: { type: "boolean", description: "Kein echter Exa-/Netz-Aufruf im Bench-Apparat" },
    benchNotRunConfirmed: {
      type: "boolean",
      description: "Kein convo-bench-Lauf wurde ausgeloest (Kosten-Regel)",
    },
    disclosureIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    twoCommitsInOrder: {
      type: "boolean",
      description: "Apparat-Commit liegt VOR dem Produkt-Commit; beide vorhanden",
    },
    noSecretsLeaked: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "failSafeClauses",
    "languageParityEnforced",
    "toolGatesIntact",
    "noProductEnvChange",
    "benchApparatusIsolated",
    "noRealExaCalls",
    "benchNotRunConfirmed",
    "disclosureIntact",
    "safetyGatesIntact",
    "existingAssertionsNotWeakened",
    "twoCommitsInOrder",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" } },
    s2: { type: "array", items: { type: "string" } },
    s3: { type: "array", items: { type: "string" } },
    s4: { type: "array", items: { type: "string" } },
    blocker: { type: "boolean" },
    passNotes: { type: "string" },
    topTodos: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase aendert, WELCHES WERKZEUG ein Telefon-Agent im Gespraech mit einem echten Menschen waehlt - pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${D3_SCOPE}
PRUEFE BESONDERS, jeweils selbst am Code nachgerechnet:
- failSafeClauses: DAS IST DER WICHTIGSTE PUNKT. Lies den neuen takeMessageDescription-Text und nimm an, du bist der Agent auf einem INBOUND-Anruf: get_consult und look_up sind dort NIE im Werkzeugsatz (belegt in src/consult/in-call.js und src/research/in-call.js, Richtungs-Gate outbound). Sagt der Text dir dann noch eindeutig, was du tun sollst? Oder verweist er ins Leere und laesst dich raten/versprechen? Eine verweisende Klausel ohne Ausstiegssatz ist ein BLOCKER.
- languageParityEnforced: lies de.js, en.js und fr.js NEBENEINANDER. Traegt jede der drei Sprachen jede Klausel R1-R4? Eine Sprache, die zurueckfaellt, ist ein BLOCKER. Und: entferne testweise eine Klausel NUR aus de.js - wird ein Test rot? Wenn nein, fehlt der Paritaetsschutz und das ist ein BLOCKER (die stille Sprachdivergenz ist die im Auftrag ausdruecklich benannte Falle). Mutation zuruecknehmen.
- toolGatesIntact: git diff auf src/consult/**, src/research/**, src/claude.js. Wurde ein Kontingent, das Richtungs-Gate, die Frische-Bedingung, der lookup-guard oder der Paraphrase-Zwang angefasst? Jede Aenderung dort ist scope-fremd und ein BLOCKER.
- noProductEnvChange + benchApparatusIsolated: git diff auf src/config.js, .env.example, render.yaml, test/helpers.js. Alles ausser test/helpers.js MUSS unveraendert sein; in test/helpers.js darf BASE_ENV NICHT veraendert sein (EXA_API_BASE/EXA_API_KEY leer, LOOKUP_ENABLED/CONSULT_ENABLED/IN_CALL_CONSULT_ENABLED false). Sonst BLOCKER.
- noRealExaCalls: greppe den Bench-Apparat nach api.exa.ai und nach echten Netz-Zielen. Der Fake MUSS lokal sein.
- benchNotRunConfirmed: gibt es Hinweise auf einen ausgefuehrten convo-bench-Lauf (neue Verzeichnisse unter data/convo-bench/, Report-Dateien im Diff)? Ein Lauf ist ein Kosten-Verstoss.
- existingAssertionsNotWeakened: git diff auf test/ genau lesen. Insbesondere AL-P4-9 (der Selbe-Zug-Substring in takeMessageDescription) und AL-P4-8 muessen ihre Zusage behalten. Jede geaenderte Assertion braucht eine Begruendung.
- twoCommitsInOrder: git log ${BASE}..${target} --oneline. Liegt der Apparat-Commit VOR dem Produkt-Commit? Ohne diese Trennung ist die Vorher-Messung nicht erhebbar - Blocker.
- Ueberkorrektur-Risiko: sind die Beschreibungen aufgeblaeht? Zaehle die Zeichen je Description vorher/nachher. Wenn eine Description deutlich waechst, ohne dass anderswo etwas weichen musste, ist das eine concern (Repo-Lehre: Haiku kippt bei Bloat am Entscheidungspunkt in Ueberkorrektur).
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
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf: (a) der Bench-Apparat (Exa-Fake, Consult-Pumpe) darf die Muster aus test/al-p10b-lookup.test.js nicht dupliziert nachbauen, wenn sich eine gemeinsame Quelle anbietet (G5/S2); (b) die neuen Checks in checks.mjs muessen ihr Signal aus EINER Quelle ziehen und benannt sein, keine verstreuten Inline-Filter (G5/G19); (c) die vier neuen Szenarien muessen sich WIRKLICH unterscheiden - gleiche Fixture-Werte testen nichts (Repo-Lehre rca-lessons-timezone-and-fixtures); (d) neue Konstanten (Kontingente, Timeouts, Poll-Intervall des Bench) als benannte Konstanten, keine nackten Zahlen (G25); (e) Kommentare deutsch OHNE Umlaute - ABER die Tool-Beschreibungen in src/i18n/prompts/*.js sind Modelltext und MUESSEN korrekte Umlaute/Akzente tragen; eine transliterierte Beschreibung ist ein S1-Korrektheitsfehler, kein Stilverstoss.
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

// ---------- Phase 4: Self-Fix-Loop ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" } },
    filesTouched: { type: "array", items: { type: "string" } },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string" },
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
3. Behebe DIESE Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${D3_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(al-d3): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
5. KEIN Bench-Lauf.
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

// ---------- Phase 5: Prozessbericht ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
WICHTIG - EHRLICHKEITSREGEL: dieser Bericht darf KEINEN Gewinn behaupten, der nicht gemessen wurde. In dieser Phase wurde bewusst KEIN Bench-Lauf gefahren (Netz + Kosten); die Verhaltensmessung macht der Lead danach. Der Bericht sagt also, was GEPINNT wurde (der Wortlaut-Vertrag in drei Sprachen) und was NOCH OFFEN ist (ob das Modell die Werkzeuge daraufhin tatsaechlich waehlt, und ob der fuehrende Satz bei look_up wirklich kommt - der K4-Befund). Formuliere das ausdruecklich, nicht als Fussnote.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die beiden Commit-Hashes (Apparat/Produkt) und wozu die Trennung dient; die Klausel-Begruendungen (clauseRationale) als Liste; die Zeichenzahl-Tabelle (charCountTable) unveraendert uebernehmen; die Inbound-Pruefung; Mutations- und Paritaetsproben mit Ergebnis; angepasste Bestandstests mit Begruendung; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; ein Abschnitt "Was diese Phase NICHT gemessen hat" mit der Bench-Anleitung fuer den Lead (welche Szenarien, --repeat 5, gegen welche beiden Commits). Quelle:
=== PLAN ===
${plan || ""}
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
  apparatusCommit: (impl && impl.apparatusCommit) || null,
  productCommit: (impl && impl.productCommit) || null,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  gatesRedCount: (impl && impl.gatesRedCount) ?? null,
  charCountTable: (impl && impl.charCountTable) || "",
  inboundSafetyVerdict: (impl && impl.inboundSafetyVerdict) || "",
  clauseRationale: (impl && impl.clauseRationale) || [],
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  parityProbeResult: (impl && impl.parityProbeResult) || "",
  benchNotRun: impl ? impl.benchNotRun === true : false,
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
  ].slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
