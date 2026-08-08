// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/b3a.js, Phase HART GEPINNT auf B4a.

export const meta = {
  name: "phase-impl-lean-b4a",
  description:
    "B4a: Preisstaffel je Token-Sorte, worstCasePrice, Boot-Abbruch bei unbepreistem Modell. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Preistabelle + Boot-Abbruch code-gegroundet planen" },
    { title: "Implementieren", detail: "config/state-ops/boot im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Abnahme A-1..A-7 + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Detailbericht in tasks/b4a-report.md (Lead liest ihn nicht)" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT B4a: Phase HART GEPINNT.
// highStakes=true: die Preisrechnung speist BEIDE Geld-Achsen (Budget-Gate nach
// Absoluter Regel 1 UND den Stripe-Kundenbeleg), und ein zu breit greifender
// Boot-Abbruch legt die Telefonie lahm.
const A = {
  phaseId: "B4a",
  phaseTitle: "Preisstaffel je Token-Sorte + Boot-Abbruch bei unbepreistem Modell",
  branch: "phase/b4a-preisstaffel-gate",
  baseBranch: "master",
  planDoc: "PLAN-ANBIETER-PORT.md",
  specFile: "tasks/b4-spec.md",
  maxFixRounds: 2,
  highStakes: true,
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
const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_OPUS, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: keine Duplizierung (G5/S2 - die Preisformel existiert GENAU EINMAL, sie speist Gate und Ledger gemeinsam); keine Magic Numbers ausser 0/1/-1 (G25, Preise gehoeren nach config.js G35); **Geld NIE als Fliesskomma dort, wo gerundet gebucht wird** (G26 - die Ganzzahl-/Mikro-Cent-Konventionen des Bestands sind bindend); kein toter/auskommentierter Code (C5/G9); intentions-ausdrueckende Namen (N1/N7); eine Aufgabe je Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, Kommentare deutsch OHNE Umlaute (ue/oe/ae). Neues Verhalten braucht einen automatisierten Test (P11/T-Serie).`;

// BINDENDE LEAD-ENTSCHEIDUNGEN (dokumentiert in tasks/todo.md, Commit 7fe7ba3).
const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:

1. **Der Zuschnitt B4a/B4b ist angenommen.** Du baust NUR B4a: Tabellenform, vier Raten, Aufloesung beim Boot, Boot-Abbruch, worstCasePrice, die neue Preisrechnung, alle Tests. **B4b - der gemessene Betrag-Rueckgang an ECHTEM Verkehr (W6) - ist NICHT dein Scope** und ist blockiert (seit 2026-08-04 kein Anruf, Anthropic-Guthaben leer).

2. **Die Preise sind abgerufen, nicht abzuleiten** (Quelle + asOf stehen in der Spec, Abschnitt 1). USD je 1 Mio. Token: claude-haiku-4-5 = 1.00 / 1.25 / 0.10 / 5.00 (Input / 5m-Cache-Write / Cache-Read / Output). claude-sonnet-5 **bis 2026-08-31** = 2.00 / 2.50 / 0.20 / 10.00, **ab 2026-09-01** = 3.00 / 3.75 / 0.30 / 15.00. Die **5m**-Schreibrate ist die richtige, weil CACHE_CONTROL_EPHEMERAL kein ttl traegt - pruefe das selbst am Code nach.

3. **W4: der Preis-Fallback wird NICHT gestrichen, sondern zu worstCasePrice** = punktweises Maximum JEDER der vier Raten ueber alle Eintraege. Grund, am Code belegt: tokenCostUsd liest price.inPerMTok OHNE Null-Check - ohne Fallback endet ein unbekanntes Modell im TypeError (Ausfall im Buchungspfad) oder in NaN, und **NaN > limit ist immer false, also fail-open am Gate**. Eine Tabelle je Anbieter scheidet aus, weil der B2-Vertrag nur billingModelId kennt und kein Anbieterfeld.

4. **W5: KEINE Store-Migration, KEINE Schema-Aenderung, KEIN Backfill.** Die Aufschluesselung reicht bis zur Preisrechnung; Bucket-Zaehler und usage_event.quantity bleiben Summen mit identischem Zahlenwert. Tragende Tatsache: die Gate-Kette (budgetExceeded -> tenantSpendOrDeny) liest ausschliesslich Cent-Achsen - verifiziere das, bevor du dich darauf verlaesst.

5. **Die Sonnet-Korrektur (2.00/10.00 bis 31.08.) gehoert IN diese Phase**, als Folge der Tabellenform - nicht als vorgezogener Einzelfix. Der Befund ist "die Tabelle kann keinen terminierten Wechsel ausdruecken", nicht "eine Zahl ist falsch".

6. **F-1 wird mitkorrigiert:** src/llm/ports.js nennt inputUncachedTokens die "teuerste Eingabeklasse". Das ist mit den echten Raten falsch (die 5m-Schreibrate liegt in allen drei Preiszeilen darueber). **Das VERHALTEN bleibt unveraendert - nur die Behauptung im Kommentar wird richtiggestellt.** Kein Umbau des Notfall-Zweigs.

7. **NICHT dein Scope, nicht anfassen:** WF-4 (src/bridge.js bucht keine Token - Bestandsbefund, braucht den Owner), W7 (Traeger der Perioden-Gegenprobe), B3b (Anfrageseite), B5 (DeepSeek-Adapter).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- **Absolute Regel 1 ist der Kern dieser Phase:** die pro-Tenant-Kostendecke. Sie sperrt BEIDE Richtungen, Inbound eingeschlossen. Eine Aenderung, die sie spaeter greifen laesst oder blind macht, ist ein BLOCKER - auch wenn alle Tests gruen sind.
- Die uebrigen Gates (Outbound-Permit Abo+KYC, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen.
- Provider-Signaturpruefung Telnyx Ed25519 fail-closed; SKIP_TWILIO_SIGNATURE_CHECK bleibt unangetastet. Disclosure-Satz unveraendert. Auth fail-closed. Secrets nur via env.
- **DER BOOT-ABBRUCH IST EIN ZWEISCHNEIDIGES SCHWERT.** Ein Dienst, der nicht startet, nimmt keine Anrufe an. Es bricht NUR ab, was die Spec als Ausloeser benennt; jeder in der Spec benannte NICHT-Ausloeser muss weiterhin normal starten (Abnahme A-5). Greift der Abbruch breiter als spezifiziert, ist die Phase gescheitert.
- KEIN Aufruf gegen die echte Anthropic-API: **das Guthaben ist leer** (HTTP 400, gemessen 2026-08-08). Alles laeuft offline gegen Attrappen - das genuegt fuer B4a vollstaendig.
- SCOPE: NUR B4a gemaess tasks/b4-spec.md. Kein B4b, kein W7, kein Anfassen von bridge.js.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG (807 Zeilen) - das ist die AUTORITATIVE Definition. Besonders Abschnitt 1 (bindende Entscheidungen), 2 (Bestand), 3 (der Sonnet-Befund), 4 (Entwurf: 4.1 Tabellenform, 4.2 resolveModelPrices, 4.4 Boot-Abbruch, 4.5 W4, 4.6 Preisrechnung, 4.7 W5, 4.8 Zuschnitt), 5 (Abnahme A-1..A-7), 6 (Pre-Mortem).
2. Lies "${REPO}/src/llm/ports.js" - der gemergte B2-Vertrag ist bindend.
3. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/${PLAN_DOC}" Teil 2 (Abschnitt B4 + die drei Abnahmekriterien).
4. Lies den ECHTEN Code auf Basis "${BASE}": src/config.js (modelPricesUsd, usdToEur, claudeModel, briefingModel), src/store/state-ops.js (tokenCostUsd, priceForModel, mostExpensivePrice, trackUsage, budgetExceeded), src/store/defaults.js (emptyUsage), src/llm-usage.js, src/boot.js (warnUnpricedModels), src/llm/adapters/anthropic.js. Grep gezielt; uebernimm KEINE Zeilennummer ungeprueft.
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN ZWEI AUFGABEN:
(a) **Die Ausloeser-Liste des Boot-Abbruchs exakt ziehen.** Liefere eine Tabelle "Konfiguration -> bricht ab JA/NEIN -> Grund". Jeder NICHT-Ausloeser braucht einen Test (A-5). Das ist die Stelle, an der diese Phase die Telefonie lahmlegen kann.
(b) **Den Datenpfad der Preisrechnung von der Verbrauchsform bis in beide Geld-Achsen durchzeichnen** (Gate-Achse UND Stripe-Ledger) und benennen, wo sich der gebuchte Betrag aendert und wo nicht.
LIEFERE AUSSERDEM: die exakten Edits je Datei (Vorher/Nachher); die neuen/angepassten Tests inkl. der Gegenprobe aus A-3 samt der Sabotage, die sie rot machen MUSS; je Abnahmepunkt A-1..A-7 das Kommando mit erwarteter Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    bookingProofRedProof: {
      type: "string",
      description:
        "A-3: die AUSGEFUEHRTE Gegenprobe - ohne die Buchung ist der Test rot. Kommando + Ausgabe woertlich",
    },
    bootAbortProof: { type: "string", description: "A-4: Spawn-Test, Exit 1 + stderr-Zeile" },
    nonTriggersStillBoot: {
      type: "string",
      description: "A-5: die NICHT-Ausloeser starten weiterhin normal - Beleg je Fall",
    },
    fixtureCalculation: {
      type: "string",
      description: "A-6: beide USD-Betraege (vorher/nachher) und die Differenz",
    },
    storeUnchanged: {
      type: "boolean",
      description: "W5: keine Schema-Aenderung, keine Migration, kein Backfill",
    },
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
    "bookingProofRedProof",
    "bootAbortProof",
    "nonTriggersStillBoot",
    "fixtureCalculation",
    "storeUnchanged",
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
3. Lies "${REPO}/${SPEC_FILE}" SELBST (Abschnitt 4 ist der Entwurf, Abschnitt 5 die Abnahme). Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei (A-1).
5. npm test (beide Backends). **pass MUSS >= 4026 sein (gefiltert; roh 4046) und fail == 0.** Ein SINKEN ist ein Blocker - dann sind Tests verschwunden statt gruen zu sein.
6. **A-3 IST DIE OWNER-ABNAHME:** ein Test, der beweist, dass nach einem Turn auf der Budget-Achse der ERWARTETE BETRAG steht - nicht "die Funktion wurde aufgerufen". **Fuehre die Gegenprobe AUS**: entferne die Buchung, sieh den Test rot werden, stell sie wieder her. Kommando + Ausgabe woertlich nach bookingProofRedProof. Ohne ausgefuehrte Gegenprobe zaehlt der Test nicht.
7. **A-4:** Spawn-Test - konfiguriertes Modell ohne Preiseintrag -> Boot bricht ab (Exit 1 + stderr-Zeile). Beleg nach bootAbortProof.
8. **A-5 IST DIE SICHERUNG GEGEN EINEN ZU BREITEN ABBRUCH:** jeder in der Spec benannte NICHT-Ausloeser muss weiterhin normal starten. Beleg je Fall nach nonTriggersStillBoot. Ein Dienst, der nicht startet, nimmt keine Anrufe an.
9. **A-6:** die Fixture-Rechnung (5 / 20 / 100 / 7) - beide USD-Betraege und die Differenz nach fixtureCalculation.
10. A-7: npx prettier --check auf die geaenderten Dateien.
11. node_modules NICHT committen. git add (betroffene Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen, Gegenprobe nicht ausgefuehrt, Boot-Abbruch greift breiter als spezifiziert -> ehrlich melden, nicht schoenen.`,
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
    testCountNotShrunk: { type: "boolean", description: "A-2: pass >= 4026, fail 0" },
    bookingProofActuallyFails: {
      type: "boolean",
      description: "A-3: du hast die Gegenprobe SELBST ausgefuehrt und den Test rot gesehen",
    },
    bootAbortsOnUnpricedModel: { type: "boolean", description: "A-4 selbst nachgefahren" },
    nonTriggersStillBoot: {
      type: "boolean",
      description: "A-5: jeder benannte Nicht-Ausloeser startet weiterhin - selbst geprueft",
    },
    fixtureCalculationCorrect: { type: "boolean", description: "A-6 nachgerechnet" },
    costCeilingIntact: {
      type: "boolean",
      description:
        "Absolute Regel 1: die pro-Tenant-Kostendecke greift nicht spaeter und wird nicht blind",
    },
    noFailOpenPath: {
      type: "boolean",
      description: "kein Pfad fuehrt zu NaN/undefined in der Preisrechnung",
    },
    storeUnchanged: { type: "boolean", description: "W5: keine Migration, kein Schema-Diff" },
    scopeRespected: { type: "boolean", description: "NUR B4a; bridge.js unberuehrt" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "bookingProofActuallyFails",
    "bootAbortsOnUnpricedModel",
    "nonTriggersStillBoot",
    "fixtureCalculationCorrect",
    "costCeilingIntact",
    "noFailOpenPath",
    "storeUnchanged",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase beruehrt BEIDE GELD-ACHSEN und den BOOT - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test SELBST (beide Backends). testCountNotShrunk: pass >= 4026 UND fail == 0. Gesunkene Zahl bei fail 0 ist ein BLOCKER.
4. Lies "${REPO}/${SPEC_FILE}" Abschnitt 4 (Entwurf) und 5 (Abnahme A-1..A-7) sowie "${REPO}/src/llm/ports.js".
5. Arbeite A-1..A-7 EINZELN ab, jeden mit eigenem Kommando. **Verlass dich auf KEINE Behauptung des Impl-Agenten** - fahre jede Probe selbst:
   **A-3 ist die Owner-Abnahme.** Entferne die Buchung SELBST, sieh den Test rot werden, stell sie wieder her. Wird er dabei NICHT rot, ist der Test wertlos und das ein BLOCKER.
   **A-4** Spawn-Test selbst fahren: unbepreistes Modell -> Exit 1 + stderr-Zeile.
   **A-5** ist die Sicherung gegen einen zu breiten Abbruch: fahre JEDEN in der Spec benannten Nicht-Ausloeser selbst und sieh den Prozess normal starten. Bricht einer davon ab, legt diese Phase die Telefonie lahm -> BLOCKER.
   **A-6** rechne die Fixture (5/20/100/7) selbst nach, beide Betraege.
6. **costCeilingIntact (Absolute Regel 1):** pruefe am Diff, dass die pro-Tenant-Kostendecke nicht spaeter greift und nicht blind wird. Der gebuchte Betrag DARF sich aendern (das ist der Zweck) - aber nur dort, wo die Spec es sagt, und nie so, dass eine Ueberschreitung unentdeckt bleibt.
7. **noFailOpenPath:** suche aktiv nach einem Pfad, auf dem die Preisrechnung den Wert undefined oder NaN sieht. Ein Vergleich "NaN groesser als limit" ist IMMER false - das waere fail-open am Gate. Der Bestand hatte an dieser Stelle keinen Null-Check.
8. **storeUnchanged:** git diff auf src/db/ und die Store-Schemata MUSS leer sein (W5). **scopeRespected:** src/bridge.js unberuehrt, kein B4b, kein W7.
${LEAD_DECISIONS}
${ABS_RULES}
approved=true NUR wenn alle Punkte erfuellt sind, deine Tests gruen sind UND du die A-3-Rotprobe sowie die A-5-Nicht-Ausloeser selbst gesehen hast. Rueckgabe IST das Urteil.`,
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
 - **G5/S2:** die Preisformel muss GENAU EINMAL existieren. Gate-Achse und Stripe-Ledger leiten ihren Betrag aus derselben Stelle ab - eine zweite Formel ist der Hauptbefund, den diese Phase produzieren kann.
 - **G26/S1 (Korrektheit):** Geld als Fliesskomma dort, wo gerundet gebucht wird. Die Mikro-Cent-/Ganzzahl-Konventionen des Bestands sind bindend; eine neue Rundungsstelle ist S1.
 - **G25/G35:** Preise und Schwellen gehoeren nach config.js, nicht in die Rechnung.
 - **P11/T-Serie:** neues Verhalten braucht einen Test. Fehlt die AUSGEFUEHRTE Gegenprobe zu A-3, ist das S1.
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
3. Behebe DIESE Blocker sauber und minimal; fuer jeden korrektheits-/geldrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test (beide Backends) gruen, pass >= 4026. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  // Ohne belegten Commit wird die Schleife abgebrochen; das Gate bleibt BLOCKED mit den
  // ECHTEN Blockern der letzten belastbaren Review-Runde (beobachtet 2026-07-25 in P5).
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
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; **die Ausloeser-Tabelle des Boot-Abbruchs VOLLSTAENDIG** (Konfiguration -> bricht ab JA/NEIN -> Grund), weil sie das Betriebswissen dieser Phase ist; die Abnahmepunkte A-1..A-7 einzeln mit Urteil und Kommando; **die ausgefuehrte A-3-Gegenprobe woertlich**; die A-6-Fixture-Rechnung mit beiden Betraegen und der Differenz; was sich am gebuchten Betrag aendert und was nicht; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Halte fest, was fuer **B4b** offen bleibt und dass dessen Messung an fehlendem Verkehr UND leerem Anthropic-Guthaben haengt. Quelle:
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
  bookingProofActuallyFails: (safety && safety.bookingProofActuallyFails) || false,
  nonTriggersStillBoot: (safety && safety.nonTriggersStillBoot) || false,
  costCeilingIntact: (safety && safety.costCeilingIntact) || false,
  noFailOpenPath: (safety && safety.noFailOpenPath) || false,
  storeUnchanged: (safety && safety.storeUnchanged) || false,
  fixtureCalculation: (impl && impl.fixtureCalculation) || "",
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
