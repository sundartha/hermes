// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/b4a.js, Phase HART GEPINNT auf OC-P1.

export const meta = {
  name: "phase-impl-lean-oc-p1",
  description:
    "OC-P1: Owner-Call-Praedikat, Persistenz, Schalter + Tenant-Allowlist. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Praedikat-Modul + Persistenz code-gegroundet planen" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Detailbericht in tasks/oc-p1-report.md (Lead liest ihn nicht)" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT OC-P1: Phase HART GEPINNT.
// highStakes: das Praedikat entscheidet, ob der Offenlegungssatz entfaellt (Absolute
// Regel 2, enge Owner-Ausnahme 2026-08-20). Fail-open hier = Rechtsverstoss.
const A = {
  phaseId: "OC-P1",
  phaseTitle: "Owner-Call-Praedikat, Persistenz, Schalter + Tenant-Allowlist",
  branch: "phase/oc-p1-praedikat",
  baseBranch: "master",
  planDoc: "PLAN-OWNER-CALL.md",
  specFile: "tasks/oc-p1-spec.md",
  maxFixRounds: 2,
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle;
const BRANCH = A.branch;
const BASE = A.baseBranch;
const PLAN_DOC = A.planDoc;
const SPEC_FILE = A.specFile;
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const REPORT_PATH = `tasks/${String(PHASE).toLowerCase()}-report.md`;

// MODELL-POLITIK: jeder agent() explizit gepinnt (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "sonnet", effort: "medium" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: 4909/4909 gruen am 2026-08-20 (nach GQ-B2), IMMER mit LLM_PROVIDER=anthropic.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 4909;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: das Praedikat existiert GENAU EINMAL (G5/S2 - ein Modul, alle Verbraucher; keine zweite Vergleichsstelle neben diagnosticRetentionGranted zuruecklassen, sondern die Bestandsstelle gemaess Spec auf das gemeinsame Modul umstellen, ohne ihr Verhalten zu aendern); keine Magic Values (G25/G35 - Schalter/Listen nach config.js); kein toter/auskommentierter Code (C5/G9); intentions-ausdrueckende Namen (N1/N7); eine Aufgabe je Funktion (G30/G34), <=3 Argumente (F1); ESM, kein Build-Step, Kommentare deutsch OHNE Umlaute (ue/oe/ae). Neues Verhalten braucht einen automatisierten Test (P11/T-Serie), Store-beruehrende Tests fuer BEIDE Backends (json+pg).`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. Die Spec "${SPEC_FILE}" ist AUTORITATIV. Der Plan "${PLAN_DOC}" liefert Kontext (Kapitel zu Praedikat, Datenmodell, Pre-Mortem). Bei Widerspruch gilt die Spec; jeden echten Widerspruch in deviations melden statt still zu entscheiden.
2. FAIL-CLOSED-KERN: calleeIsOwner liefert true NUR, wenn ALLE Konjunktionen erfuellt sind (globaler Schalter OWNER_SELF_CALL_ENABLED, Tenant in OWNER_SELF_CALL_TENANT_IDS, hinterlegte private Nummer vorhanden, exakter E.164-Match des normalisierten Ziels). Leere Allowlist = niemand. Jeder Fehler, jede fehlende Zutat, jeder Formatzweifel => false. KEIN Client-Input entscheidet.
3. SCOPE: NUR OC-P1 gemaess Spec. KEINE Wirkung auf Eroeffnung/Prompt in dieser Phase (das ist OC-P2/P3) - das Praedikat wird gebaut, persistiert und getestet, aber noch nirgends offenlegungs-wirksam verdrahtet, sofern die Spec nichts anderes sagt.
4. Neue Env-Vars an ALLE vier Orte: src/config.js, .env.example, render.yaml UND test/helpers.js BASE_ENV (Memory-Falle: fehlt BASE_ENV, leakt die lokale .env in Spawn-Tests). Defaults so, dass das Verhalten ohne gesetzte Vars byte-identisch zu heute ist.
5. KEINE Schema-Migration ausser dem, was die Spec ausdruecklich nennt; pg-Aenderungen brauchen den Roundtrip-Test (rowToCall/Hydration-Falle aus I8).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- **Absolute Regel 2 ist der Kern dieser Kette:** Der Offenlegungssatz bleibt fuer JEDES Nicht-Owner-Ziel fest verdrahtet erster Satz. Diese Phase implementiert die vom Owner am 2026-08-20 entschiedene ENGE Ausnahme (Ziel == eigene Nummer des anrufenden Tenants) NUR als Praedikat+Persistenz. Ein Pfad, der die Offenlegung fuer ein Fremd-Ziel stilllegen KOENNTE, ist ein BLOCKER - auch wenn alle Tests gruen sind.
- Safety-Gates (Outbound-Permit Abo+KYC, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer, Ed25519 fail-closed) NIE entfernen/aufweichen/umgehen. Auth fail-closed: neue/geaenderte Endpunkte hinter webAuthMw bzw. route-policy-konform (test/route-auth-inventory.test.js muss gruen bleiben). Secrets nur via env, nie loggen/leaken.
- KEINE echten Anrufe/SMS, KEINE Telnyx-/ElevenLabs-/Stripe-Schreibzugriffe, KEIN "elevenlabs:push", KEIN Deploy. Alles laeuft offline gegen Attrappen/Fakes.
- SCOPE: NUR OC-P1. Kein Anfassen von src/bridge.js, keine EL-Vorlagen-Aenderung (OC-P2), keine Prompt-Aenderung (OC-P3).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition (Scope, Entscheidungen, Invarianten, Abgrenzung, Abnahme).
2. Lies aus "${REPO}/${PLAN_DOC}" die Kapitel zu Praedikat-Architektur, Datenmodell und Pre-Mortem.
3. Lies "${REPO}/.claude/refs/clean-code.md".
4. Lies den ECHTEN Code auf Basis "${BASE}" an allen Stellen, die die Spec nennt (u.a. src/store/state-ops.js normalizePrivateNumber + diagnosticRetentionGranted, src/routes/api-calls.js, src/config.js, src/store/pg.js, src/db/schema.sql, test/helpers.js BASE_ENV). Grep gezielt; uebernimm KEINE Zeilennummer ungeprueft - die Spec warnt selbst vor Zeilendrift.
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN ZWEI AUFGABEN:
(a) **Die Fail-Closed-Wahrheitstabelle des Praedikats exakt ziehen**: jede Konjunktion einzeln, jede Ausfallart (Var fehlt, Liste leer, Nummer leer, Format weicht ab, fremder Tenant, Normalisierung wirft) -> Ergebnis MUSS false sein, mit dem Test, der es beweist.
(b) **Den Datenpfad der privaten Nummer durchzeichnen** (Schreibweg API -> Normalisierung -> Store json+pg -> Leser) und benennen, wo das neue Praedikat-Modul sitzt und wie die Bestandsleser (diagnosticRetentionGranted, SMS-Ziel) unveraendert weiterlaufen.
LIEFERE: die exakten Edits je Datei (Vorher/Nachher); die neuen Tests inkl. mindestens einer Sabotage-Gegenprobe (Praedikat kaputt machen -> Test MUSS rot werden); je Abnahmepunkt der Spec das Kommando mit erwarteter Ausgabe. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    failClosedProof: {
      type: "string",
      description:
        "Die AUSGEFUEHRTE Sabotage-Gegenprobe: Praedikat manipuliert -> Test rot -> wiederhergestellt. Kommando + Ausgabe woertlich",
    },
    abnahmeProofs: {
      type: "string",
      description: "JEDER Abnahmepunkt der Spec einzeln: Kommando + beobachtete Ausgabe",
    },
    envVarsFourPlaces: {
      type: "boolean",
      description: "neue Env-Vars in config.js + .env.example + render.yaml + test/helpers.js BASE_ENV",
    },
    bothBackendsTested: { type: "boolean", description: "Store-Tests json UND pg" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "failClosedProof",
    "abnahmeProofs",
    "envVarsFourPlaces",
    "bothBackendsTested",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Lies "${REPO}/${SPEC_FILE}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - **pass MUSS >= ${TEST_FLOOR} sein und fail == 0.** Ein einzelner roter Spawn-Test zaehlt nur, wenn er im isolierten Wiederholungslauf WIEDER rot ist (bekannter Volllast-Flake). Ein SINKEN der pass-Zahl ist ein Blocker - dann sind Tests verschwunden statt gruen zu sein.
6. **FAIL-CLOSED-GEGENPROBE (Pflicht):** manipuliere das Praedikat (z.B. eine Konjunktion entfernen), sieh den zugehoerigen Test rot werden, stelle es wieder her. Kommando + Ausgabe woertlich nach failClosedProof. Ohne ausgefuehrte Gegenprobe zaehlt der Test nicht.
7. Arbeite JEDEN Abnahmepunkt der Spec einzeln ab; Kommando + Ausgabe nach abnahmeProofs. Fehlt einer Spec-Abnahme eine Vorbedingung (z.B. Testnummer setzen), stelle sie her wie dort beschrieben.
8. node_modules NICHT committen. git add (betroffene Dateien EINZELN, nie git add -A) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen, Gegenprobe nicht ausgefuehrt, Abnahmepunkt offen -> ehrlich melden, nicht schoenen.`,
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
    independentTestSummary: { type: "string" },
    testCountNotShrunk: { type: "boolean", description: `pass >= ${TEST_FLOOR}, fail 0` },
    failClosedProofRepeated: {
      type: "boolean",
      description: "Sabotage-Gegenprobe SELBST ausgefuehrt und den Test rot gesehen",
    },
    predicateFailClosed: {
      type: "boolean",
      description:
        "Wahrheitstabelle selbst geprueft: JEDE Ausfallart liefert false; kein Pfad kann Offenlegung fuer Fremd-Ziel stilllegen",
    },
    noDisclosureEffectYet: {
      type: "boolean",
      description: "OC-P1 verdrahtet noch keine Offenlegungs-Wirkung (bzw. exakt das, was die Spec erlaubt)",
    },
    existingReadersUnchanged: {
      type: "boolean",
      description: "diagnosticRetentionGranted + SMS-Ziel verhalten sich byte-identisch",
    },
    envVarsFourPlaces: { type: "boolean" },
    routeAuthIntact: { type: "boolean", description: "route-auth-inventory gruen, neue Endpunkte fail-closed" },
    safetyGatesIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "NUR OC-P1; bridge.js/EL-Vorlage/Prompts unberuehrt" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "failClosedProofRepeated",
    "predicateFailClosed",
    "noDisclosureEffectYet",
    "existingReadersUnchanged",
    "envVarsFourPlaces",
    "routeAuthIntact",
    "safetyGatesIntact",
    "noSecretsLeaked",
    "scopeRespected",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase baut das Praedikat, das spaeter den Offenlegungssatz abschalten darf (Absolute Regel 2, enge Owner-Ausnahme) - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. ${TEST_CMD} SELBST. testCountNotShrunk: pass >= ${TEST_FLOOR} UND fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten).
4. Lies "${REPO}/${SPEC_FILE}" (Entwurf + Abnahme) und die Pre-Mortem-/Praedikat-Kapitel aus "${REPO}/${PLAN_DOC}".
5. Arbeite JEDEN Abnahmepunkt der Spec EINZELN ab, jeden mit eigenem Kommando. **Verlass dich auf KEINE Behauptung des Impl-Agenten** - fahre jede Probe selbst:
   - Die Sabotage-Gegenprobe SELBST ausfuehren: Praedikat manipulieren -> Test MUSS rot werden -> wiederherstellen. Wird er nicht rot, ist der Test wertlos = BLOCKER.
   - **predicateFailClosed:** konstruiere aktiv Gegenbeispiele (Formatvarianten 0049/+49/Leerzeichen, fremder Tenant, leere Allowlist, fehlende Env-Var, leere/null private Nummer, Normalisierung wirft). JEDES muss false liefern. Suche aktiv nach einem Pfad, der true liefert, ohne dass ALLE Konjunktionen gelten.
   - **existingReadersUnchanged:** diagnosticRetentionGranted und das SMS-Summary-Ziel byte-identisch (Diff + Tests).
   - **routeAuthIntact:** test/route-auth-inventory.test.js gruen; jeden neuen/geaenderten Endpunkt auf Auth-Kette pruefen.
   - **envVarsFourPlaces:** config.js + .env.example + render.yaml + test/helpers.js BASE_ENV.
6. git diff ${BASE}..${target} -- src/bridge.js MUSS leer sein; EL-Vorlagen und Prompt-Bausteine unberuehrt, sofern die Spec nichts anderes sagt.
${LEAD_DECISIONS}
${ABS_RULES}
approved=true NUR wenn alle Punkte erfuellt, deine Tests gruen und du Sabotage-Probe + Fail-Closed-Gegenbeispiele selbst gesehen hast. Rueckgabe IST das Urteil.`,
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
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad. S3/S4 gebuendelt.
BESONDERS ACHTEN:
 - **G5/S2:** das Praedikat existiert GENAU EINMAL; keine zweite Nummern-Vergleichsstelle, keine kopierte Normalisierung.
 - **G25/G35:** Schalter/Allowlist in config.js zentralisiert, nirgends direkt process.env gelesen.
 - **P11/T-Serie:** neues Verhalten hat Tests fuer BEIDE Store-Backends; fehlende AUSGEFUEHRTE Sabotage-Gegenprobe ist S1.
 - Keine brittle Datei:Zeile-Kommentare (C2); Kommentare deutsch ohne Umlaute.
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
3. Behebe DIESE Blocker sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  // Ein Fix-Agent kann sterben und liefert dann null - der Branch existiert dann NICHT.
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Blocker der Runde ${round - 1 || "Erstreview"} bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Report ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; **die Fail-Closed-Wahrheitstabelle des Praedikats VOLLSTAENDIG** (Konjunktion/Ausfallart -> Ergebnis -> beweisender Test); die Abnahmepunkte der Spec einzeln mit Urteil und Kommando; **die ausgefuehrte Sabotage-Gegenprobe woertlich**; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Quelle:
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

// ---------- POSTAGE-STAMP-RETURN ----------
return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  predicateFailClosed: (safety && safety.predicateFailClosed) || false,
  failClosedProofRepeated: (safety && safety.failClosedProofRepeated) || false,
  existingReadersUnchanged: (safety && safety.existingReadersUnchanged) || false,
  envVarsFourPlaces: (safety && safety.envVarsFourPlaces) || false,
  routeAuthIntact: (safety && safety.routeAuthIntact) || false,
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
