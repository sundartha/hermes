// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/c-p6.js, Phase HART GEPINNT auf B2.
// Unterschiede zum kanonischen phase-impl.js: siehe Kopf von c-p6.js
// (args-driven+fail-closed, Self-Fix-Loop, Postage-Stamp-Return).

export const meta = {
  name: "phase-impl-lean-b2",
  description:
    "B2: LLM-Port-Vertrag src/llm/ports.js schreiben. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix bis PASS -> Report-Datei.",
  phases: [
    {
      title: "Plan",
      detail: "Belege der b2-spec gegen den echten Code gegrounded, dann Umsetzungsplan",
    },
    { title: "Implementieren", detail: "src/llm/ports.js im Worktree, npm test gruen, commit" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel)" },
    {
      title: "Self-Fix",
      detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS oder maxFixRounds",
    },
    { title: "Report", detail: "Detailbericht in tasks/b2-report.md (Lead liest ihn nicht)" },
  ],
};

// HART GEPINNT auf das Haupt-Repo. Der fruehere cwd-Fallback lieferte im Spawn-Kontext
// ".", was im Agent-Worktree einen SELBSTREFERENZIELLEN node_modules-Symlink erzeugte
// ("Too many levels of symbolic links", npm test Exit 0 bei 4 Zeilen Output) -
// beobachtet und aufgedeckt im C-P4-Review-Lauf wf_ff179540-31e.
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT B2: Phase HART GEPINNT.
// highStakes=false: reine Vertrags-/Dokumentphase (JSDoc + "export {};"), kein Verhalten,
// keine Laufzeit-Logik. Der Impl-Agent laeuft trotzdem auf effort:high - die eigentliche
// Arbeit ist nicht Schreiben, sondern das Nachschlagen JEDER Belegstelle am echten Code.
const A = {
  phaseId: "B2",
  phaseTitle: "Der LLM-Port-Vertrag: was ein Sprachmodell-Anbieter koennen muss",
  branch: "phase/b2-llm-port-vertrag",
  baseBranch: "master",
  planDoc: "PLAN-ANBIETER-PORT.md",
  specFile: "tasks/b2-spec.md",
  maxFixRounds: 2,
  highStakes: false,
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`;
const BASE = A.baseBranch || "master";
const PLAN_DOC = A.planDoc || "PLAN-ANBIETER-PORT.md";
const SPEC_FILE = A.specFile || "";
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const REPORT_PATH = `tasks/${String(PHASE).toLowerCase()}-report.md`;
const TARGET_FILE = "src/llm/ports.js";

// MODELL-POLITIK: jeder agent() wird explizit gepinnt. Ohne Pin erbt der Subagent das
// Session-Modell (Memory [[workflow-model-policy]]). Plan + Safety-Review = opus,
// Impl/Clean-Code/Fix = sonnet, Report = sonnet/low.
const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: keine Duplizierung (G5/S2); kein toter/auskommentierter Code (C5/G9); intentions-ausdrueckende Namen (N1/N2); praezise, nicht schwammige Kommentare (C4); keine redundanten Kommentare (C3); KEINE brittle Datei:Zeile-Kommentare (C2). ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae statt ü/ö/ä).`;

// LEAD-ENTSCHEIDUNG (Kollision Spec <-> Bestand, gemessen vor dem Start):
// Die Spec verlangt in Abnahme-Punkt 4 Aufrufer-Belege "datei.js:zeile". Der Nachbar-Port
// src/telephony/ports.js enthaelt jedoch NULL solcher Verweise (grep -cE '\.js:[0-9]' -> 0),
// und clean-code C2 verbietet brittle Zeilen-Kommentare. Aufgeloest zugunsten der
// Bestandspraxis: die DATEI nennt Datei + SYMBOLNAME, die Zeilenbelege stehen im Report.
// Grund: ein Symbolname ist grepbar und bricht sichtbar, eine verrottete Zeilennummer zeigt
// still auf die falsche Zeile.
const CITATION_RULE = `BELEGFORM (bindende Lead-Entscheidung, geht der Spec-Formulierung vor):
In "${TARGET_FILE}" wird jeder Aufrufer mit DATEI + SYMBOLNAME genannt (Beispiel: "claude.js agentTurn", "precall-briefing.js"), NIEMALS mit Zeilennummer. Begruendung: src/telephony/ports.js enthaelt gemessen NULL Datei:Zeile-Verweise, und clean-code C2 verbietet brittle Zeilen-Kommentare. Die Zeilenbelege aus Spec-Tabelle 3.1 werden trotzdem EINZELN am echten Code nachgeschlagen (Abnahme-Punkt 4) - ihr Ergebnis gehoert in den Plan bzw. Report, nicht in die Vertragsdatei. Weicht eine Spec-Zeilenangabe vom echten Code ab, ist das ein zu MELDENDER Befund, kein stiller Fix.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Outbound-Permit Abo+KYC, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen.
- Provider-Signaturpruefung: Telnyx Ed25519, fail-closed. SKIP_TWILIO_SIGNATURE_CHECK ist trotz des Namens der globale /voice-Bypass und bleibt unangetastet.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed; Secrets nur via env, nie loggen/leaken. Audio nie durch MCP.
- SCOPE B2 (aus tasks/b2-spec.md, Abschnitt 10 "Nicht-Ziele" - BINDEND):
  * GENAU EINE neue Datei: ${TARGET_FILE}. Sonst NICHTS.
  * KEINE Aenderung an bestehendem Code - auch keine "kleine" Umbenennung in llm-usage.js,
    llm.js, claude.js, config.js, state-ops.js, boot.js.
  * KEIN Adapter, KEINE Registry, KEIN Preiseintrag, KEIN Boot-Guard.
  * KEIN config-Key, KEIN .env.example-Eintrag, KEIN BASE_ENV-Eintrag.
  * KEINE Laufzeit-Logik: die Datei besteht aus JSDoc-Kommentaren plus der EINZIGEN
    Anweisung "export {};" (Vorbild src/telephony/ports.js).
  * KEIN neuer Test. B2 aendert kein Verhalten; die Spec haelt ausdruecklich fest, dass
    gruene Tests hier KEIN Beleg fuer die Richtigkeit des Vertrags sind. npm test dient
    nur dem Nachweis, dass nichts kaputtgegangen ist.
  * KEINE Entscheidung ueber die Werkzeug-Schleifen-Form (das ist B3) und keine ueber
    Modelle flash/pro (das ist B5).`;

const specInstruction = SPEC_FILE
  ? `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Scope-/Design-/Invarianten-/Abgrenzungs-Definition dieser Phase (verbindlich vor dem Plan-Doc). Abschnitt 3.2 gibt den Feldbestand und die Zusicherungen BINDEND vor; Formulierung darf geschliffen werden, Felder nicht.`
  : `(Keine specFile uebergeben - nutze ausschliesslich ${PLAN_DOC}.)`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" Teil 2 als Umbrella-Kontext, "${REPO}/tasks/b1-report.md" als Faktenbasis und "${REPO}/.claude/refs/clean-code.md".
3. Lies das VORBILD "${REPO}/src/telephony/ports.js" GANZ (280 Zeilen) - Aufbau, Ton, Kommentarstil und Umfang von ${TARGET_FILE} folgen ihm. Ebenso "${REPO}/src/research/ports.js" (29 Zeilen, Praezedenz "null = unbekannt").
4. GROUNDING (das ist der Kern deiner Aufgabe, Abnahme-Punkt 4 der Spec): Schlage JEDE Belegstelle der Spec-Tabellen 2 und 3.1 EINZELN am echten Code auf Basis "${BASE}" nach (sed -n '<zeile>p' bzw. grep nach dem Symbol). Pruefe fuer jede: enthaelt die genannte Zeile wirklich das genannte Symbol/Verhalten? LIEFERE eine Liste "Spec-Angabe -> am Code gefunden ja/nein -> tatsaechliches Symbol". Abweichungen sind BEFUNDE und werden gemeldet, nicht still korrigiert.
${CITATION_RULE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die Grounding-Liste aus Schritt 4; (2) die vollstaendige Gliederung von ${TARGET_FILE} (Kopfkommentar + jeder Typdef-Block mit seinen Feldern und Zusicherungen, in der Reihenfolge der Spec 3.2); (3) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe) fuer die Abnahmepunkte 1-3 und 8 der Spec. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string", description: "git rev-parse HEAD nach dem Commit" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    noRuntimeLogic: {
      type: "boolean",
      description: "grep nach function/=>/const/let liefert NUR Treffer innerhalb von Kommentaren",
    },
    noRuntimeLogicEvidence: { type: "string", description: "das Grep-Kommando und seine Ausgabe" },
    diffStatOutput: { type: "string", description: "git diff --stat der Phase, woertlich" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    specDeviationsFound: {
      type: "array",
      items: { type: "string" },
      description: "Spec-Belegstellen, die am echten Code NICHT stimmen",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "nodeCheckPass",
    "noRuntimeLogic",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Lies "${REPO}/tasks/b2-spec.md" SELBST (Abschnitt 3.2 ist der bindende Feldbestand) und das Vorbild "${REPO}/src/telephony/ports.js". Schreibe dann ${TARGET_FILE}: Kopfkommentar, JSDoc-Typdefs, als EINZIGE Anweisung "export {};".
${CITATION_RULE}
${CLEAN_CODE_REQ}
4. node --check ${TARGET_FILE} -> Exit 0.
5. ABNAHME-PUNKT 3 SELBST PRUEFEN: grep -nE "function|=>|\\bconst\\b|\\blet\\b" ${TARGET_FILE} - jeder Treffer MUSS innerhalb eines Kommentars liegen. Kommando + Ausgabe woertlich nach noRuntimeLogicEvidence.
6. npm test (beide Backends: json-Default + pglite-in-process). KEINE Testdatei anfassen - diese Phase aendert kein Verhalten.
7. git diff --stat ${BASE} zeigt AUSSCHLIESSLICH ${TARGET_FILE} - woertlich nach diffStatOutput. Zeigt es mehr, hast du den Scope verletzt.
8. node_modules-Symlink NICHT committen. git add ${TARGET_FILE} && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Weicht eine Spec-Belegstelle vom echten Code ab: nach specDeviationsFound, NICHT stillschweigend anpassen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen.`,
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
    onlyOneNewFile: { type: "boolean", description: "Abnahme 1: nur src/llm/ports.js im Diff" },
    nodeCheckPass: { type: "boolean", description: "Abnahme 2" },
    noRuntimeLogic: { type: "boolean", description: "Abnahme 3: keine Laufzeit-Logik" },
    everyCapabilityHasCaller: {
      type: "boolean",
      description: "Abnahme 4: jede Faehigkeit nennt einen am Code verifizierten Aufrufer",
    },
    everyUsageFieldAccountedFor: {
      type: "boolean",
      description: "Abnahme 5: jedes B1-usage-Feld zugeordnet ODER begruendet ungelesen",
    },
    paperRunDeepseekHolds: { type: "boolean", description: "Abnahme 6: 99+0+3200=3299 haelt" },
    paperRunAnthropicHolds: { type: "boolean", description: "Abnahme 7: 5/20/100/7 abgebildet" },
    noSecretsLeaked: { type: "boolean", description: "Abnahme 8" },
    scopeRespected: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    behaviorUnchanged: {
      type: "boolean",
      description: "kein Bestandscode geaendert, kein Verhalten beruehrt",
    },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "onlyOneNewFile",
    "noRuntimeLogic",
    "everyCapabilityHasCaller",
    "everyUsageFieldAccountedFor",
    "paperRunDeepseekHolds",
    "paperRunAnthropicHolds",
    "behaviorUnchanged",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: {
      type: "array",
      items: { type: "string" },
      description: 'Tests/Sicherheit/Korrektheit - "ID · Datei · Verstoss · Fix"',
    },
    s2: { type: "array", items: { type: "string" }, description: "Duplizierung" },
    s3: { type: "array", items: { type: "string" } },
    s4: { type: "array", items: { type: "string" } },
    blocker: { type: "boolean", description: "true wenn s1 oder s2 nicht leer" },
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst (beide Backends) -> testsPassIndependently + Zahlen.
4. Lies "${REPO}/tasks/b2-spec.md" Abschnitt 7 (Abnahme) und "${REPO}/tasks/b1-report.md" Abschnitt 5.
5. Arbeite die ACHT Abnahmepunkte der Spec EINZELN ab, jeden mit einem eigenen Kommando:
   (1) git diff --stat ${BASE} ${target} zeigt AUSSCHLIESSLICH ${TARGET_FILE}.
   (2) node --check ${TARGET_FILE} -> Exit 0.
   (3) grep -nE "function|=>|\\bconst\\b|\\blet\\b" ${TARGET_FILE}: jeder Treffer MUSS in einem Kommentar liegen; die einzige Anweisung ist "export {};".
   (4) JEDE im Vertrag genannte Faehigkeit nennt einen Aufrufer, den es WIRKLICH gibt - schlage jedes genannte Symbol per grep im echten Code nach. Ein Aufrufer, den du nicht findest, ist ein BLOCKER.
   (5) JEDES von B1 gemeldete usage-Feld (prompt_tokens, completion_tokens, total_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens, prompt_tokens_details.cached_tokens, completion_tokens_details.reasoning_tokens) ist im Vertrag ENTWEDER einer Sorte zugeordnet ODER namentlich als bewusst ungelesen begruendet. Null unzugeordnete Felder.
   (6) Papier-Durchlauf DeepSeek: 99 + 0 + 3200 = 3299 == prompt_tokens - traegt der Vertrag das?
   (7) Papier-Durchlauf Anthropic (5/20/100/7): bildet der Vertrag alle vier Zahlen ab?
   (8) Kein Secret, keine PII, kein API-Schluessel in der neuen Datei.
6. behaviorUnchanged: git diff ${BASE} ${target} darf KEINE Zeile Bestandscode enthalten. Ein einziger geaenderter Bestandscode-Hunk ist ein BLOCKER (Spec Abschnitt 10).
${ABS_RULES}
BEACHTE: die Datei nennt Aufrufer bewusst mit Symbolnamen statt Zeilennummern (Lead-Entscheidung wegen clean-code C2 und der Bestandspraxis in src/telephony/ports.js, das NULL Zeilenverweise fuehrt). Das ist KEIN Befund. Die Verifikation der Aufrufer laeuft ueber grep nach dem Symbol.
approved=true NUR wenn alle acht Punkte erfuellt sind UND deine Tests gruen sind. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
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
2. git diff ${BASE} ${target} ; die neue Datei per git show ${target}:${TARGET_FILE}.
3. Vergleiche Ton, Aufbau und Kommentardichte mit dem Vorbild "${REPO}/src/telephony/ports.js" (git show ${BASE}:src/telephony/ports.js) - Abweichungen vom Hausstil sind G24/G11.
4. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad. S3/S4 gebuendelt.
BEACHTE ZWEI PUNKTE, die hier KEIN Befund sind:
 - Diese Phase ist eine reine Vertragsphase OHNE Verhalten. Ein fehlender Test ist deshalb KEIN S1 (P11): die Spec haelt ausdruecklich fest, dass gruene Tests die Richtigkeit des Vertrags nicht belegen koennen.
 - Aufrufer werden bewusst mit Symbolnamen statt Zeilennummern genannt (Lead-Entscheidung, C2-konform).
Ein reiner Kommentarblock ist per se keine Duplizierung; FLAGge S2 nur, wenn derselbe Sachverhalt in DERSELBEN Datei mehrfach ausformuliert wird.
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
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
3. Behebe DIESE Blocker sauber und minimal - alles ausschliesslich in ${TARGET_FILE}:
${JSON.stringify(blockers, null, 1)}
${CITATION_RULE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test (beide Backends) gruen. node_modules NICHT committen. git add ${TARGET_FILE} && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  // Ein Fix-Agent kann sterben (API-Fehler, Abbruch) und liefert dann null - der Branch
  // existiert in dem Fall NICHT. Ohne belegten Commit wird die Schleife deshalb abgebrochen;
  // das Gate bleibt BLOCKED mit den ECHTEN Blockern der letzten belastbaren Review-Runde
  // (beobachtet 2026-07-25 in P5, ausgeloest durch ein API-529 in Runde 1).
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet, Blocker der Runde ${round - 1 || "Erstreview"} bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Report-Datei (Lead liest sie NICHT) ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die GROUNDING-LISTE aus dem Plan (Spec-Angabe -> am Code gefunden -> tatsaechliches Symbol) VOLLSTAENDIG, weil sie die Zeilenbelege der Abnahme traegt; die acht Abnahmepunkte einzeln mit Urteil; Impl-Zusammenfassung + deviations + specDeviationsFound; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Halte ausdruecklich als dokumentierte ABWEICHUNG fest: die Vertragsdatei nennt Aufrufer mit Symbolnamen statt "datei.js:zeile" (Lead-Entscheidung; Grund: src/telephony/ports.js fuehrt gemessen NULL Zeilenverweise, clean-code C2 verbietet brittle Zeilen-Kommentare, ein Symbolname ist grepbar und bricht sichtbar). Quelle:
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

// ---------- POSTAGE-STAMP-RETURN (klein, damit der Lead duenn bleibt) ----------
return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
  ].slice(0, 40),
  specDeviationsFound: (impl && impl.specDeviationsFound) || [],
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
