// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/inbox-p3.js, Phase HART GEPINNT auf OUTBOUND-E1.

export const meta = {
  name: "phase-impl-lean-outbound-e1",
  description:
    "OUTBOUND-E1 (WURZEL): Plattform-Nummern-Bindung (platform_number_use) + dreifacher Freigabe-Riegel, damit kein Lebenszyklus-Weg eine in Benutzung stehende Absendernummer freigeben kann. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-OUTBOUND-RESILIENZ.md, Etappe E1)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/outbound-e1-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT OUTBOUND-E1: Phase HART GEPINNT.
const RUN = {
  phaseId: "OUTBOUND-E1",
  phaseTitle:
    "WURZEL: Plattform-Nummern-Bindung (platform_number_use) und dreifacher Freigabe-Riegel (releaseNumber wirft / Verdikt HOLD vor Provider-DELETE / pg-Backstop)",
  branch: "phase/outbound-e1-plattform-nummer",
  baseBranch: "master",
  planDoc: "PLAN-OUTBOUND-RESILIENZ.md",
  befundDoc: "tasks/befund-outbound-ausfall-2026-08-27.md",
  maxFixRounds: 4,
};

const PHASE = RUN.phaseId;
const PHASE_TITLE = RUN.phaseTitle;
const BRANCH = RUN.branch;
const BASE = RUN.baseBranch;
const PLAN_DOC = RUN.planDoc;
const BEFUND_DOC = RUN.befundDoc;
const MAX_FIX_ROUNDS = Number.isInteger(RUN.maxFixRounds) ? RUN.maxFixRounds : 2;
const REPORT_PATH = "tasks/outbound-e1-report.md";

// MODELL-POLITIK: Urteilen=Opus, Ausfuehren=Sonnet; Pins pro agent() (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: vom Lead auf master (c1d7c0d) SELBST gemessen, zweiter Lauf sauber:
// pass 5111 / fail 0 (der erste Lauf hatte EINEN Flake, isoliert gruen).
// Der Plan-Agent misst nach und pinnt den ECHTEN Stand; SINKEN ist ein Blocker.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5111;

const LINT_REGEL = `LINT-PFLICHT (P1-Lehre, tasks/lessons.md): npm run lint (eslint ., volles Repo im Worktree) MUSS "0 errors" melden - nicht nur die Zieldateien linten. eslint-suppressions.json und eslint-legacy-exceptions.json duerfen NUR Eintraege von Dateien aendern, die im eigenen Diff stehen; Eintraege UNBETEILIGTER Dateien sind TABU (kein Regenerieren der Gesamtdatei).`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: EINE Quelle der Wahrheit fuer die Frage "ist diese Nummer plattform-gebunden?" - kein zweiter Praedikat-Ort, keine kopierte Bedingung in einem zweiten Aufrufer; das Praedikat ist rein und ohne Seiteneffekt; Magic Numbers verboten (benannte Konstanten); kein toter Code; Kommentare deutsch OHNE Umlaute; nutzer-/betreiber-sichtbare deutsche Texte MIT echten Umlauten. Neues Verhalten braucht Tests. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV (Abschnitt "E-1 (WURZEL)" und Etappe "E1", dazu Pre-Mortem-Abschnitt 7 und "Bewusst akzeptierte Risiken" 8 sowie Testkonzept 6). Der gemessene Ausfall-Befund steht in "${BEFUND_DOC}". Umzusetzen ist NUR Etappe E1. Echte Widersprueche Spec vs Ist-Code in deviations melden, Ist-Code respektieren.
2. Die Bindung ist eine GLOBALE Tabelle/Collection (Schluessel e164), NICHT eine Rollen-Spalte an number - Begruendung steht im Plan (number ist tenant-isoliert unter FORCE RLS; die Plattform-ANI hat heute gar keine number-Zeile). Beide Store-Backends (json + pg) muessen sie tragen.
3. Durchsetzung auf DREI Ebenen, alle drei sind Liefergegenstand: (A) der Store-Engpass zu status='released' wirft bei gebundener Nummer; (B) der Freigabe-Orchestrator bekommt ein VERDIKT (Koerbe), damit der irreversible Provider-DELETE gar nicht erst startet, und zaehlt HOLD als abgebrochen inkl. Audit-Eintrag; (C) ein DB-seitiger Backstop gegen manuelle Eingriffe. Ein Fremdschluessel taugt NICHT, weil unsere Freigabe keine Zeile loescht, sondern den Status setzt.
4. VORBEDINGUNG, ZUERST empirisch klaeren (Plan-Agent, offener Punkt 9 des Plans): fuehrt PGlite die geplante Trigger-/plpgsql-Form aus? Es waere die erste Trigger-DDL im Repo und die pg-Tests laufen gegen PGlite. Faellt die Messung negativ aus, baust du Ebene C in der staerksten Form, die PGlite UND Postgres tragen (z.B. CHECK-/Constraint-Form), und begruendest die Wahl im Report - Ebene C ersatzlos streichen ist NICHT erlaubt.
5. Die DSGVO-Loeschung darf NICHT brechen: eraseTenantData loescht weiterhin ALLE personenbezogenen Daten (Artikel 17 bleibt erfuellt); nur die Rueckgabe der DID haelt an (HOLD + Audit). Ein Test muss GENAU das zeigen - Loeschung vollstaendig, Nummer gehalten.
6. POSITIV-KONTROLLE ist Pflicht (Repo-Lehre "Pruefkommando ohne Positiv-Kontrolle"): eine NICHT gebundene Nummer wird weiterhin normal freigegeben. Ein Riegel, der alles blockiert, besteht jeden Negativ-Test und ist trotzdem kaputt.
7. Neue Env-Variable PLATFORM_ANI_E164 (Plan E-1): zentral in src/config.js, dokumentiert in .env.example, geprueft in render.yaml UND eingetragen in test/helpers.js BASE_ENV (Repo-Lehre "Test BASE_ENV-Drift": fehlt der Eintrag, leakt die echte .env in Spawn-Tests). Default leer; leer darf NIE wie "alles gruen" aussehen.
8. Bei Freigabe wird e164 geleert (Plan-Entscheidung F-9), damit dieselbe Nummer spaeter zurueckgekauft werden kann - inklusive der pg-Flush-/Prune-Regression aus dem Abnahmekatalog (eine gebundene, bereits released-e Zeile zweimal flushen darf nicht werfen).
9. PII (bindend): keine echten Rufnummern in Logs, Tests oder Fixtures. Nur erkennbar fiktive Nummern im Bestandsstil (+15005550006, +4915112345678).
10. Schritt 0 (Pflicht, VOR dem ersten Edit): npm run test:gates auf ${BASE} ausfuehren und die Zahl der roten Faelle festhalten - nach der Umsetzung darf sie NICHT hoeher sein.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung). Offenlegungs-Mechanik und das callee_is_owner-Praedikat NICHT beruehren. Auth fail-closed. Secrets nur via env, nie loggen. AUDIO NIEMALS durch MCP.
- KEINE echten Anrufe/SMS, KEINE Provider-SCHREIBzugriffe (kein Telnyx/ElevenLabs POST/PATCH/DELETE), KEIN Deploy, KEIN Nummernkauf. Alles offline gegen Attrappen.
- SCOPE: NUR Etappe E1 gemaess "${PLAN_DOC}". Kein src/bridge.js. Die Fehlerklassifikation (E2), der Nutzer-Rueckweg (E3a), der Betreiber-Alarm (E3b), der Drift-Waechter (E4) und die Absender-Wahrheit (E5) sind EIGENE Etappen - hier nicht vorgreifen.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: die Entwurfsentscheidung "E-1 (WURZEL)", die Etappe "E1" samt Abnahmekatalog, Abschnitt 6 (Testkonzept), Abschnitt 7 (Pre-Mortem, besonders die Punkte zu Freigabe/Kuendigung/Backstop) und Abschnitt 8 (bewusst akzeptierte Risiken). AUTORITATIV. Dazu "${REPO}/${BEFUND_DOC}" (der gemessene Hergang).
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": den Freigabe-Pfad (src/store/state-ops.js releaseNumber und ALLE Aufrufer - selbst grepen, nicht dem Plan glauben), den Erase-/Loeschweg (grep erase, did_released, release-reconcile), src/store/pg.js + das Schema (DDL beim Boot), src/store/json.js, src/store/defaults.js, src/config.js (Namespace-Konvention), test/helpers.js (BASE_ENV) und die bestehenden Store-Tests als Muster.
4. Miss selbst: ${TEST_CMD} auf ${BASE} (pass-Zahl = Anker, Lead-Messung war ${TEST_FLOOR}), npm run test:gates auf ${BASE} (rote Faelle = Vorher-Zahl, in den Plan schreiben!), npm run lint (MUSS 0 Fehler sein - sonst STOPP und melden).
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN DREI AUFGABEN:
(a) **Die Vollstaendigkeit des Engpasses beweisen:** finde JEDEN Pfad, der eine Nummer freigeben oder umwidmen kann (Store-Funktionen, Worker, Skripte unter scripts/, Admin-Routen, Queue-Jobs). Fuer jeden Pfad: laeuft er durch den Engpass aus Ebene A? Wenn nein, ist das ein Plan-Befund - benenne ihn und leite ab, warum Ebene B/C ihn trotzdem decken (oder was zusaetzlich noetig ist). Diese Liste ist der Kern der Etappe: eine Sperre mit einem Schleichweg ist keine Sperre.
(b) **Die PGlite-Vorbedingung empirisch klaeren** (Lead-Entscheidung 4): schreibe ein Wegwerf-Skript im Scratchpad, das die geplante DDL gegen PGlite ausfuehrt, und berichte das ECHTE Ergebnis. Danach entscheidest du die Form von Ebene C.
(c) **Die Testfaelle einzeln entwerfen**, inklusive: Positiv-Kontrolle (ungebundene Nummer wird freigegeben), DSGVO-Fall (Loeschung vollstaendig, Nummer gehalten), Flush-/Prune-Regression, Backstop-Fall (Umgehung des Store-Engpasses wird DB-seitig abgewiesen) und der Sabotage-Gegenprobe (Riegel absichtlich entfernen -> ein Test MUSS rot werden).
LIEFERE: exakte Edits je Datei (Vorher/Nachher), Migrations-/DDL-Text, neue Tests, je Abnahmepunkt der Etappe Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    riegelProof: {
      type: "string",
      description: "Ebene A+B+C einzeln nachgewiesen: gebundene Nummer -> Freigabe wirft/HOLD, Provider-DELETE startet nicht, DB-Backstop weist ab. Kommando + Ausgabe",
    },
    positivKontrollProof: {
      type: "string",
      description: "AUSGEFUEHRT: eine NICHT gebundene Nummer wird weiterhin normal freigegeben. Kommando + Ausgabe",
    },
    dsgvoProof: {
      type: "string",
      description: "AUSGEFUEHRT: Tenant-Loeschung entfernt weiterhin ALLE personenbezogenen Daten, nur die DID haelt (HOLD + Audit). Kommando + Ausgabe",
    },
    failClosedProof: {
      type: "string",
      description: "AUSGEFUEHRTE Sabotage-Gegenprobe: Riegel entfernt -> Test MUSS rot -> wiederhergestellt. Woertlich",
    },
    beideBackendsProof: {
      type: "string",
      description: "Bindung und Riegel in BEIDEN Backends (json + pg/PGlite) nachgewiesen, inkl. Flush-/Prune-Regression. Kommando + Ausgabe",
    },
    envProof: {
      type: "string",
      description: "PLATFORM_ANI_E164 in config.js, .env.example, render.yaml geprueft, test/helpers.js BASE_ENV. Woertlich",
    },
    gatesProof: { type: "string", description: "npm run test:gates: Vorher-Zahl (Schritt 0) und Nachher-Zahl. Woertlich" },
    lintProof: { type: "string", description: "npm run lint (eslint ., VOLL) = 0 Fehler. Woertlich" },
    abnahmeProofs: { type: "string", description: "JEDER Abnahmepunkt der Etappe: Kommando + Ausgabe" },
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
    "riegelProof",
    "positivKontrollProof",
    "dsgvoProof",
    "failClosedProof",
    "beideBackendsProof",
    "envProof",
    "gatesProof",
    "lintProof",
    "abnahmeProofs",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} (${PHASE_TITLE}) GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Lies die Etappe E1 und die Entwurfsentscheidung E-1 in "${REPO}/${PLAN_DOC}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; SINKEN unter den vom Plan gemessenen ${BASE}-Anker ist ein Blocker). DAZU npm run lint = 0 Fehler (VOLL) UND npm run test:gates nicht roeter als die Vorher-Zahl.
6. **SECHS BEWEISE (alle Pflicht, alle AUSFUEHREN):** riegelProof, positivKontrollProof, dsgvoProof, failClosedProof (Sabotage), beideBackendsProof, envProof - Kommando+Ausgabe woertlich. Dazu gatesProof und lintProof.
7. JEDEN Abnahmepunkt der Etappe einzeln abarbeiten; Kommando+Ausgabe nach abnahmeProofs.
8. node_modules NICHT committen. git add (betroffene Dateien EINZELN, nie git add -A) && git commit (Botschaft deutsch). headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen; Offenes offen nennen, nicht schoenen.`,
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
    testCountNotShrunk: { type: "boolean", description: `pass >= ${TEST_FLOOR}, fail 0, nicht unter dem Plan-Anker` },
    riegelWirksam: {
      type: "boolean",
      description: "SELBST gefahren: gebundene Nummer kann ueber KEINEN gefundenen Pfad freigegeben werden (Ebene A, B und C je einzeln geprueft)",
    },
    engpassVollstaendig: {
      type: "boolean",
      description: "SELBST gegrept: ALLE Pfade zu status='released'/Provider-DELETE laufen durch den Riegel oder sind nachweislich gedeckt. Schleichweg = Blocker",
    },
    positivKontrolleGesehen: {
      type: "boolean",
      description: "SELBST gefahren: ungebundene Nummer wird weiterhin freigegeben (der Riegel blockiert NICHT pauschal)",
    },
    dsgvoIntakt: {
      type: "boolean",
      description: "SELBST gefahren: Tenant-Loeschung entfernt weiterhin alle personenbezogenen Daten; nur die DID haelt, mit Audit-Eintrag",
    },
    sabotageSelbstRotGesehen: {
      type: "boolean",
      description: "SELBST ausgefuehrt: Riegel entfernt -> Test rot -> wiederhergestellt",
    },
    beideBackends: { type: "boolean", description: "json UND pg/PGlite selbst geprueft, inkl. Flush-/Prune-Regression" },
    envVollstaendig: {
      type: "boolean",
      description: "PLATFORM_ANI_E164 in config.js + .env.example + render.yaml + test/helpers.js BASE_ENV; leer sieht NICHT wie gruen aus",
    },
    gatesNotWorse: { type: "boolean", description: "test:gates rote Faelle <= Vorher-Zahl (selbst auf Basis UND Branch gemessen)" },
    fullLintZeroErrors: { type: "boolean", description: "npm run lint (VOLL) SELBST gemessen = 0 Fehler; Suppressions nur Diff-eigene Dateien" },
    piiClean: { type: "boolean", description: "keine echten Rufnummern in Logs/Tests/Fixtures" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean", description: "Outbound-Permit, OUTBOUND_FROZEN, Kostendecke, Signaturpruefung, Offenlegung/callee_is_owner unveraendert" },
    noProviderWrites: { type: "boolean", description: "kein Telnyx/ElevenLabs-Schreibzugriff im Diff und in keinem Test" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "kein bridge.js; kein Vorgriff auf E2/E3a/E3b/E4/E5" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "riegelWirksam",
    "engpassVollstaendig",
    "positivKontrolleGesehen",
    "dsgvoIntakt",
    "sabotageSelbstRotGesehen",
    "beideBackends",
    "envVollstaendig",
    "gatesNotWorse",
    "fullLintZeroErrors",
    "piiClean",
    "routeAuthIntact",
    "safetyGatesIntact",
    "noProviderWrites",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Etappe soll verhindern, dass ein Aufraeumweg das Produkt abschaltet - ein Schleichweg um den Riegel, ein pauschal blockierender Riegel oder eine gebrochene DSGVO-Loeschung bricht das Kernversprechen. Im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-outbound-e1${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; Einzel-Flake isoliert wiederholen). DAZU npm run lint SELBST (VOLL) = 0 Fehler UND npm run test:gates auf ${BASE} UND auf ${target} (Vergleich!).
4. Lies die Etappe E1 + Entwurfsentscheidung E-1 + Pre-Mortem in "${REPO}/${PLAN_DOC}" und "${REPO}/${BEFUND_DOC}".
5. JEDEN Abnahmepunkt EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **engpassVollstaendig:** grep SELBST nach allen Pfaden zu status='released', did_released, Provider-DELETE, erase, Nummern-Umwidmung (auch scripts/, Worker, Queue, Admin-Routen). Jeder gefundene Pfad muss gedeckt sein. Ein ungedeckter Pfad ist ein BLOCKER.
   - **riegelWirksam:** Ebene A, B und C je EINZELN selbst ausloesen.
   - **positivKontrolleGesehen:** ungebundene Nummer wird freigegeben (sonst ist der Riegel ein Total-Blocker).
   - **dsgvoIntakt:** Loeschung vollstaendig, nur DID haelt, Audit vorhanden.
   - **sabotageSelbstRotGesehen:** Riegel SELBST entfernen -> Test MUSS rot -> wiederherstellen.
   - **beideBackends** inkl. Flush-/Prune-Regression; **envVollstaendig** inkl. BASE_ENV.
6. git diff ${BASE}..${target} durchsehen: kein Safety-Gate beruehrt, kein bridge.js, kein Provider-Schreibzugriff, kein Vorgriff auf spaetere Etappen.
${LEAD_DECISIONS}
${ABS_RULES}
approved=true NUR wenn alle Punkte selbst gesehen. Rueckgabe IST das Urteil.`,
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
 - **Single Source of Truth:** GENAU EIN Ort beantwortet "ist diese Nummer gebunden?"; keine kopierte Bedingung in einem zweiten Aufrufer; das Praedikat ist rein.
 - **Erzwungen statt konventionell** (Repo-Lehre "Fragilitaet = Invarianten-per-Konvention"): haengt die Invariante an einem Kommentar oder an Code/DB? Ein "bitte nicht aufrufen"-Kommentar ist S1.
 - **Store-Fassade respektiert:** json und pg gleichwertig, keine Backend-Logik im Aufrufer; Migration additiv, Backfill-Frage beantwortet.
 - **Suppression-Tabu (P1-Lehre):** Suppression-Dateien nur fuer Diff-eigene Dateien; volles Lint 0 Fehler; sonst S1.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Tests pinnen den SOLL-Zustand, nicht die Implementierung; Positiv-Kontrolle vorhanden.
 - Magic Numbers, Funktionslaenge (<=100, Ziel deutlich darunter), Verschachtelung (<=4, Ziel 2), Argumente (<=3).
 - Kommentare deutsch OHNE Umlaute; nutzer-sichtbare deutsche Texte MIT Umlauten; kein toter Code.
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

const gateOk = (sa, cca) => !!(sa && sa.approved && cca && !cca.blocker);
const blockerList = (sa, cca) => [
  ...((sa && sa.blockers) || []),
  ...((cca && cca.s1) || []),
  ...((cca && cca.s2) || []),
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
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler, test:gates nicht roeter. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(outbound-e1): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Blocker bleiben stehen.`,
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
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die vollstaendige Liste der gefundenen Freigabe-/Umwidmungs-Pfade mit Urteil je Pfad; die drei Riegel-Ebenen einzeln; die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich (inkl. Positiv-Kontrolle und Sabotage); PGlite-Vorbedingung und die daraus gewaehlte Form von Ebene C; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden. Quelle:
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
  riegelWirksam: (safety && safety.riegelWirksam) || false,
  engpassVollstaendig: (safety && safety.engpassVollstaendig) || false,
  positivKontrolleGesehen: (safety && safety.positivKontrolleGesehen) || false,
  dsgvoIntakt: (safety && safety.dsgvoIntakt) || false,
  sabotageSelbstRotGesehen: (safety && safety.sabotageSelbstRotGesehen) || false,
  beideBackends: (safety && safety.beideBackends) || false,
  envVollstaendig: (safety && safety.envVollstaendig) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  safetyGatesIntact: (safety && safety.safetyGatesIntact) || false,
  noProviderWrites: (safety && safety.noProviderWrites) || false,
  blockers: blockerList(safety, cc),
  fixRounds: round,
  reportPath,
  safetyVerdict: (safety && safety.verdict) || "",
  ccVerdict: (cc && cc.verdict) || "",
  deviations: (impl && impl.deviations) || [],
  summary: (impl && impl.summary) || "",
};
