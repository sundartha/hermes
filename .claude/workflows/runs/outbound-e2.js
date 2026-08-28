// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/outbound-e1.js, Phase HART GEPINNT auf OUTBOUND-E2.

export const meta = {
  name: "phase-impl-lean-outbound-e2",
  description:
    "OUTBOUND-E2 (F1): EIN Fehlervokabular ueber alle Engines, getrennt nach Schuld (not-placed / unreachable / result-unknown) - der Anbieter-Fehlercode wird ausgelesen, klassifiziert und gespeichert. Regressionsfang 27.08. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-OUTBOUND-RESILIENZ.md, Etappe E2)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/outbound-e2-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT OUTBOUND-E2: Phase HART GEPINNT.
const RUN = {
  phaseId: "OUTBOUND-E2",
  phaseTitle:
    "F1: EIN Fehlervokabular ueber alle Engines, getrennt nach Schuld - Anbieter-Fehlercode auslesen, klassifizieren, speichern (Regressionsfang 27.08.)",
  branch: "phase/outbound-e2-fehlervokabular",
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
const REPORT_PATH = "tasks/outbound-e2-report.md";

// MODELL-POLITIK: Urteilen=Opus, Ausfuehren=Sonnet; Pins pro agent() (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: vom Lead auf master NACH dem E1-Merge (ee93638) selbst gemessen: pass 5147 / fail 0.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5147;

const LINT_REGEL = `LINT-PFLICHT (P1-Lehre, tasks/lessons.md): npm run lint (eslint ., volles Repo im Worktree) MUSS "0 errors" melden - nicht nur die Zieldateien linten. eslint-suppressions.json und eslint-legacy-exceptions.json duerfen NUR Eintraege von Dateien aendern, die im eigenen Diff stehen; Eintraege UNBETEILIGTER Dateien sind TABU. Einen GEPINNTEN Altlast-Wert (z.B. max-lines-per-function fuer makePgStore) hebst du NICHT an, um nicht blockiert zu sein - du baust die Loesung so, dass der Pin haelt, und meldest den Konflikt in deviations (E1-Lehre).`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: EIN Vokabular, EIN Klassifizierer - die Zuordnung "Anbieter-Antwort -> Fehlergrund" lebt an GENAU EINER Stelle und wird von allen Engines benutzt; keine zweite Fehlertabelle, keine kopierte Regex, keine parallele Textliste. Klassifikation ist eine reine Funktion (Eingabe: Anbieter-Antwort, Ausgabe: Token) ohne Netz-, Store- oder Log-Zugriff. Magic Numbers (HTTP-Codes, SIP-Codes) gehoeren in benannte Konstanten. Kein toter Code; Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht Tests. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV (Entwurfsentscheidung "E-2 (F1)" und Etappe "E2", dazu Testkonzept 6, Pre-Mortem 7, akzeptierte Risiken 8). Der gemessene Ausfall-Befund steht in "${BEFUND_DOC}" - die dort woertlich zitierte 403-Antwort ist die Regressions-Fixture. Umzusetzen ist NUR Etappe E2. Widersprueche Spec vs Ist-Code in deviations melden, Ist-Code respektieren.
2. E1 ist auf ${BASE} gemergt (platform_number_use, dreifacher Freigabe-Riegel, PLATFORM_ANI_E164). Nicht anfassen, nicht umbauen.
3. KEIN neuer Call-Status. Der Status bleibt "failed"; der GRUND ist der Unterscheider. Ein neuer Status waere ein Bruch von mapStatus/Widget/Dashboard und loest nichts - auch "niemand hat abgenommen" traegt heute failed.
4. Erweitert wird das BESTEHENDE Vokabular (failure-reason.js), nicht ein neues gebaut: die neuen Basis-Token gemaess Plan (Schuld-Trennung: der Anruf wurde NICHT PLATZIERT weil bei uns/beim Anbieter etwas nicht stimmt / der Angerufene war NICHT ERREICHBAR / das Ergebnis ist UNBEKANNT). Die Trennung nach Schuld ist der Kern der Etappe - der Tippfehler eines Nutzers und unser Konfigurationsdefekt duerfen NIE dasselbe Token tragen.
5. Klassifiziert wird auf metadata.error.code (in der Anbieter-OpenAPI required) PLUS dem aus dem Grundtext gezogenen SIP-/Carrier-Kuerzel. NIEMALS allein auf error_type - das Feld ist live vorhanden, aber nicht Teil der veroeffentlichten Schemazusicherung. Unbekannte Codes fallen auf die sichere, unspezifische Klasse zurueck (fail-closed), nie auf eine erfundene Spezifik.
6. PII: der Anbieter-ROHTEXT wird WEDER gespeichert NOCH geloggt (er kann Rufnummern tragen). Nur Token aus einer geschlossenen Whitelist verlassen den Klassifizierer - dasselbe Niveau wie der bestehende safeCauseToken. Ein Test muss belegen, dass ein Rohtext mit eingebetteter Rufnummer NICHT durchkommt.
7. GELD-PFAD UNBERUEHRT (harte Auflage): ein abgelehnter Anruf laeuft schon heute in clearAnchor -> answeredAt=null -> 0 gebuchte Minuten. Diese Etappe aendert NUR das Label. Ein Test misst Anker UND gebuchte Minuten an derselben Fixture vor und nach der Aenderung. Die Eigentuemer-Auflage "lieber eine Minute zu wenig als eine erfundene" bleibt. Ein Anbieterfehler bei bereits laufender Dauer (z.B. 42 s) darf den Anker NICHT loeschen.
8. ALLE ENGINES, nicht nur ElevenLabs: der Plan weist nach, dass der bestehende catch im Anruf-Start-Pfad alle drei Engine-Zweige umschliesst - damit bekommt auch eine Telnyx-Start-Ablehnung auf dem TeXML-Weg erstmals einen Grund. Die Luecke war nie EL-spezifisch. Beleg dafuer gehoert in die Abnahme.
9. RUECKWAERTSKOMPATIBILITAET: bestehende MCP-Clients, das Live-Widget und das Dashboard duerfen nicht brechen. Bestandsverhalten fuer Calls OHNE Anbieterfehler bleibt byte-identisch - ein Test pinnt das.
10. UMLAUT-FRAGE (offene Frage F-6 des Plans, hiermit entschieden): die Fehlergrund-Texte folgen EINHEITLICH dem Bestandsmuster GENAU DER Datei, in der sie leben - der Kopf-Kommentar dieser Datei belegt die Konvention (MCP-/Anzeige-Texte im Repo sind ASCII, weil sie nie gesprochen werden; gesprochene Strings tragen Umlaute). Miss das nach und begruende die Wahl im Report. Nicht halb und halb, keine gemischte Datei.
11. Schritt 0 (Pflicht, VOR dem ersten Edit): npm run test:gates auf ${BASE} ausfuehren und die Zahl der roten Faelle festhalten - nach der Umsetzung darf sie NICHT hoeher sein.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung). Offenlegungs-Mechanik und callee_is_owner NICHT beruehren. Auth fail-closed. Secrets nur via env, nie loggen. AUDIO NIEMALS durch MCP.
- KEINE echten Anrufe/SMS, KEINE Provider-SCHREIBzugriffe, KEIN Deploy. Alles offline gegen Attrappen/Fixtures.
- SCOPE: NUR Etappe E2. Der Nutzer-Rueckweg (E3a), der Betreiber-Alarm (E3b), der Drift-Waechter (E4) und die Absender-Wahrheit (E5) sind EIGENE Etappen - hier NICHT vorgreifen. Kein src/bridge.js.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: die Entwurfsentscheidung "E-2 (F1)", die Etappe "E2" samt Abnahmekatalog, Abschnitt 6 (Testkonzept), Abschnitt 7 (Pre-Mortem, besonders die Punkte zu Fehlerklassen, Alarm-Rauschen und Kostenbuchung) und Abschnitt 8. AUTORITATIV. Dazu "${REPO}/${BEFUND_DOC}" - dort steht die woertliche 403-Antwort vom 27.08., die als Fixture dient.
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": das bestehende Fehlergrund-Vokabular (grep failure-reason, failureReason, safeCauseToken - selbst finden, nicht dem Plan glauben), src/elevenlabs/outbound.js (Poll-Schleife, ANSWERED_*-Konstanten, recordAnsweredUnclearReason, clearAnchor), den Anruf-Start-Pfad mit dem catch ueber alle Engine-Zweige (src/routes/api-calls.js), die Telnyx-Adapter (hangup_cause-Verarbeitung), src/store/views.js publicCall, src/mcp-tools.js (welche Leser den Grund sehen) und die bestehenden Tests dazu.
4. Miss selbst: ${TEST_CMD} auf ${BASE} (pass-Zahl = Anker, Lead-Messung war ${TEST_FLOOR}), npm run test:gates auf ${BASE} (rote Faelle = Vorher-Zahl), npm run lint (0 Fehler; falls im Haupt-Repo gitignorierte Fremddateien stoeren: im WORKTREE messen, dort existieren sie nicht).
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN DREI AUFGABEN:
(a) **Die Fehlerlandschaft vollstaendig kartieren:** welche Fehlerarten kann JEDE Engine produzieren (Start-Ablehnung HTTP, SIP-Ablehnung, Zeitueberschreitung, Abbruch mitten im Gespraech, Anbieter nicht erreichbar, 5xx-Sturm)? Ordne JEDE einer der Schuld-Klassen zu und belege, wo im Code sie heute landet. Stellen, an denen heute MEHRERE Sachverhalte auf EIN Label fallen, listest du einzeln auf - sie sind der Kern der Etappe.
(b) **Den Geld-Pfad absichern:** zeige am Code, wo Anker/Minuten gebucht werden, und entwirf den Test, der Anker UND Minuten an derselben Fixture vor/nach vergleicht - inklusive des Falls "Anbieterfehler bei bereits gelaufener Dauer, Anker bleibt".
(c) **Die Testfaelle einzeln entwerfen:** die 403-Fixture vom 27.08. (muss die not-placed-Klasse mit dem SIP-Kuerzel ergeben), eine SIP-404-Fixture aus dem Bestand (muss die unreachable-Klasse ergeben), ein 5xx/Timeout (muss result-unknown ergeben und NICHT als unser Defekt zaehlen), ein Rohtext mit eingebetteter Rufnummer (darf NICHT durchkommen), ein Bestandsfall ohne Anbieterfehler (byte-identisch), und die Sabotage-Gegenprobe (Klassifizierer entschaerfen -> Test MUSS rot).
LIEFERE: exakte Edits je Datei (Vorher/Nachher), die vollstaendige Token-Liste mit Zuordnung, neue Tests, je Abnahmepunkt Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    regressionsfangProof: {
      type: "string",
      description: "Die gemessene 403-Antwort vom 27.08. ergibt das not-placed-Token mit SIP-Kuerzel; die SIP-404-Fixture ergibt die unreachable-Klasse. Kommando + Ausgabe",
    },
    schuldTrennungProof: {
      type: "string",
      description: "not-placed / unreachable / result-unknown sind an Fixtures einzeln unterscheidbar; 5xx/Timeout zaehlt NICHT als unser Defekt. Kommando + Ausgabe",
    },
    geldProof: {
      type: "string",
      description: "Anker UND gebuchte Minuten an derselben Fixture vor/nach identisch; Anbieterfehler bei gelaufener Dauer loescht den Anker NICHT. Kommando + Ausgabe",
    },
    alleEnginesProof: {
      type: "string",
      description: "Nachweis, dass auch der Nicht-EL-Zweig (TeXML/Telnyx-Start-Ablehnung) einen Grund bekommt. Kommando + Ausgabe",
    },
    piiProof: {
      type: "string",
      description: "AUSGEFUEHRT: Rohtext mit eingebetteter Rufnummer kommt weder in Store noch Log; nur Whitelist-Token. Kommando + Ausgabe",
    },
    bestandsverhaltenProof: {
      type: "string",
      description: "Calls OHNE Anbieterfehler byte-identisch zum Bestand (MCP/Widget/Dashboard brechen nicht). Kommando + Ausgabe",
    },
    failClosedProof: {
      type: "string",
      description: "AUSGEFUEHRTE Sabotage-Gegenprobe: Klassifizierer entschaerft -> Test MUSS rot -> wiederhergestellt. Woertlich",
    },
    umlautEntscheidung: {
      type: "string",
      description: "Gemessenes Bestandsmuster der Datei + getroffene Wahl (ASCII oder Umlaute), einheitlich. Woertlich",
    },
    gatesProof: { type: "string", description: "npm run test:gates: Vorher-Zahl und Nachher-Zahl. Woertlich" },
    lintProof: { type: "string", description: "npm run lint (eslint ., VOLL, im Worktree) = 0 Fehler. Woertlich" },
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
    "regressionsfangProof",
    "schuldTrennungProof",
    "geldProof",
    "alleEnginesProof",
    "piiProof",
    "bestandsverhaltenProof",
    "failClosedProof",
    "umlautEntscheidung",
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
3. Lies die Etappe E2 und die Entwurfsentscheidung E-2 in "${REPO}/${PLAN_DOC}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten). DAZU npm run lint = 0 Fehler (VOLL, im Worktree) UND npm run test:gates nicht roeter als die Vorher-Zahl.
6. **SIEBEN BEWEISE (alle Pflicht, alle AUSFUEHREN):** regressionsfangProof, schuldTrennungProof, geldProof, alleEnginesProof, piiProof, bestandsverhaltenProof, failClosedProof - Kommando+Ausgabe woertlich. Dazu umlautEntscheidung, gatesProof, lintProof.
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
    testCountNotShrunk: { type: "boolean", description: `pass >= ${TEST_FLOOR}, fail 0` },
    regressionsfangEcht: {
      type: "boolean",
      description: "SELBST gefahren: die 403-Fixture vom 27.08. ergibt die not-placed-Klasse; ohne den Fix waere sie ununterscheidbar von 'nicht abgenommen'",
    },
    schuldTrennungWirksam: {
      type: "boolean",
      description: "SELBST gefahren: Nutzerfehler, unser Defekt und unbekanntes Ergebnis tragen VERSCHIEDENE Token; 5xx/Timeout zaehlt nicht als unser Defekt",
    },
    geldPfadUnveraendert: {
      type: "boolean",
      description: "SELBST gemessen: Anker und gebuchte Minuten identisch zum Bestand; kein erfundener Betrag, keine geloeschte echte Buchung",
    },
    alleEnginesAbgedeckt: { type: "boolean", description: "SELBST geprueft: auch der Nicht-EL-Zweig bekommt einen Grund" },
    piiDicht: {
      type: "boolean",
      description: "SELBST gefahren: Rohtext mit Rufnummer kommt weder in Store noch Log; Whitelist ist geschlossen",
    },
    bestandsverhaltenIntakt: {
      type: "boolean",
      description: "SELBST geprueft: Calls ohne Anbieterfehler byte-identisch; MCP-Clients/Widget/Dashboard brechen nicht",
    },
    sabotageSelbstRotGesehen: { type: "boolean", description: "SELBST ausgefuehrt: Klassifizierer entschaerft -> Test rot -> wiederhergestellt" },
    einVokabular: {
      type: "boolean",
      description: "SELBST gegrept: GENAU EINE Stelle ordnet Anbieter-Antwort -> Grund zu; keine zweite Tabelle, keine kopierte Regex",
    },
    gatesNotWorse: { type: "boolean" },
    fullLintZeroErrors: { type: "boolean" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noProviderWrites: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "kein bridge.js; kein Vorgriff auf E3a/E3b/E4/E5; E1-Code unangetastet" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "regressionsfangEcht",
    "schuldTrennungWirksam",
    "geldPfadUnveraendert",
    "alleEnginesAbgedeckt",
    "piiDicht",
    "bestandsverhaltenIntakt",
    "sabotageSelbstRotGesehen",
    "einVokabular",
    "gatesNotWorse",
    "fullLintZeroErrors",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Etappe soll verhindern, dass ein Konfigurationsdefekt wie "niemand hat abgenommen" aussieht - eine verwaschene Klasse, ein PII-Leck oder eine veraenderte Geldbuchung bricht das Kernversprechen. Im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-outbound-e2${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0). DAZU npm run lint SELBST (VOLL) = 0 Fehler UND npm run test:gates auf ${BASE} UND auf ${target} (Vergleich!).
4. Lies die Etappe E2 + Entwurfsentscheidung E-2 + Pre-Mortem in "${REPO}/${PLAN_DOC}" und "${REPO}/${BEFUND_DOC}".
5. JEDEN Abnahmepunkt EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **regressionsfangEcht:** die woertliche 403-Antwort aus dem Befund selbst durch den Klassifizierer schicken.
   - **schuldTrennungWirksam:** Nutzerfehler vs unser Defekt vs unbekannt an eigenen Fixtures.
   - **geldPfadUnveraendert:** Anker und Minuten SELBST messen, vor/nach.
   - **piiDicht:** eigenen Rohtext mit Rufnummer einschleusen und Store+Log pruefen.
   - **einVokabular:** SELBST grepen, ob eine zweite Zuordnungstabelle/Regex entstanden ist.
   - **sabotageSelbstRotGesehen:** Klassifizierer SELBST entschaerfen -> Test MUSS rot -> wiederherstellen.
6. git diff ${BASE}..${target} durchsehen: kein Safety-Gate beruehrt, kein bridge.js, kein Provider-Schreibzugriff, kein Vorgriff auf spaetere Etappen, E1-Code unangetastet.
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
 - **Single Source of Truth:** GENAU EINE Zuordnung Anbieter-Antwort -> Grund; keine zweite Tabelle, keine kopierte Regex, keine parallele Textliste.
 - **Reinheit:** der Klassifizierer ist eine reine Funktion ohne Netz/Store/Log; Seiteneffekte sind S2.
 - **Magic Numbers:** HTTP-/SIP-Codes als benannte Konstanten, nicht roh im Code.
 - **Fail-closed:** unbekannter Code faellt auf die unspezifische Klasse, nicht auf eine erfundene Spezifik.
 - **Suppression-Tabu:** Suppression-Dateien nur fuer Diff-eigene Dateien; gepinnte Altlast-Werte NICHT angehoben; volles Lint 0 Fehler; sonst S1.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Tests pinnen den SOLL-Zustand; Positiv-Kontrolle (Bestandsfall bleibt identisch) vorhanden.
 - Funktionslaenge (<=100), Verschachtelung (<=4), Argumente (<=3); Kommentare deutsch OHNE Umlaute; Textkonvention der Zieldatei einheitlich.
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
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler, test:gates nicht roeter. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(outbound-e2): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die vollstaendige Token-Liste mit Zuordnung und Schuld-Klasse; die Fehlerlandschaft je Engine; die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich (Regressionsfang, PII, Geld-Pfad, Sabotage); die Umlaut-Entscheidung mit gemessener Begruendung; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden. Quelle:
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
  regressionsfangEcht: (safety && safety.regressionsfangEcht) || false,
  schuldTrennungWirksam: (safety && safety.schuldTrennungWirksam) || false,
  geldPfadUnveraendert: (safety && safety.geldPfadUnveraendert) || false,
  alleEnginesAbgedeckt: (safety && safety.alleEnginesAbgedeckt) || false,
  piiDicht: (safety && safety.piiDicht) || false,
  bestandsverhaltenIntakt: (safety && safety.bestandsverhaltenIntakt) || false,
  sabotageSelbstRotGesehen: (safety && safety.sabotageSelbstRotGesehen) || false,
  einVokabular: (safety && safety.einVokabular) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  safetyGatesIntact: (safety && safety.safetyGatesIntact) || false,
  blockers: blockerList(safety, cc),
  fixRounds: round,
  reportPath,
  safetyVerdict: (safety && safety.verdict) || "",
  ccVerdict: (cc && cc.verdict) || "",
  deviations: (impl && impl.deviations) || [],
  summary: (impl && impl.summary) || "",
};
