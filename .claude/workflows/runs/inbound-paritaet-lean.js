// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Unterschiede zum kanonischen phase-impl.js:
//  1) ARGS-DRIVEN + FAIL-CLOSED: die Phase kommt ueber args (phaseId/specFile), NICHT
//     ueber einen hartkodierten A-Fallback. Fehlt args.phaseId -> sofortiger Abbruch
//     (KEIN Default-Phase-Bau -> kein "baut versehentlich eine gemergte Phase"-Unfall,
//     siehe Memory [[phase-impl-workflow-args]]).
//  2) SELF-FIX-LOOP: ist der Gate BLOCKED (Safety nicht approved ODER Clean-Code S1/S2),
//     fixt ein Fix-Agent die Blocker im Worktree und der Review laeuft erneut - bis PASS
//     oder MAX_FIX_ROUNDS erschoepft. So muss der Lead NIE einen Diff lesen/fixen.
//  3) POSTAGE-STAMP-RETURN: der Workflow gibt nur eine kleine Zusammenfassung zurueck
//     (gate/finalBranch/testPassCount/blocker-Kurztitel) - NICHT plan/diff/volle Reviews.
//     Die Details schreibt ein Report-Agent in tasks/<phase>-report.md (Lead liest sie NICHT).
//
// AUFRUF (Lead): Workflow({ scriptPath: ".../phase-impl-lean.js", args: {
//   phaseId:"P6b2", phaseTitle:"...", branch:"phase/p6b2-async-worker", baseBranch:"master",
//   planDoc:"PLAN-MULTI-TENANT-TELNYX.md", specFile:"tasks/p6-rest-chain.md", maxFixRounds:2 } })
// KEIN resume. Der Lead merged danach den ZURUECKGEGEBENEN finalBranch (kann BRANCH oder
// BRANCH-fixN sein), NICHT blind BRANCH.

export const meta = {
  name: "phase-impl-lean",
  description:
    "Schlankes selbst-fixendes Phasen-Workflow: Plan -> Impl (Worktree) -> dualer Review -> Self-Fix bis PASS -> kompakter Return + Report-Datei. Lead bleibt duenn.",
  phases: [
    {
      title: "Plan",
      detail:
        "Code-gegroundeter Umsetzungsplan (clean-code.md + Plan-Doku + specFile + echter Code)",
    },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, commit" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    {
      title: "Self-Fix",
      detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS oder maxFixRounds",
    },
    { title: "Report", detail: "Detailbericht in tasks/<phase>-report.md (Lead liest ihn nicht)" },
  ],
};

// Spawn-fest: im ACP-/Spawn-Kontext gibt es kein process-Global. Dann faellt REPO
// auf '.' zurueck (Spawn-cwd ist der Worktree-Root, relative Pfade greifen korrekt).
const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// HART GEPINNT fuer diesen Lauf (Lead): kein args-Threading, kein Fallback auf eine
// fremde Phase. Siehe Memory [[phase-impl-workflow-args]]. Dieser Block wird VOR JEDEM
// Lauf neu gesetzt und vor dem Start noch einmal gelesen - eine stale Phase hier ist
// ein Umbau am falschen Code.
// KETTEN-LAUF: die gepinnten Phasen laufen nacheinander; Phase n baut auf dem finalBranch der
// GEPRUEFTEN Phase n-1 auf (erste Phase auf CHAIN_BASE). Beim ersten BLOCKED endet der Lauf -
// keine Folgephase baut auf ungeprueftem Stand. Gemergt wird NUR im Lead (git diff --stat).
const CHAIN_BASE = "master";
const IEL_COMMON = {
  "planDoc": "tasks/kickoff-iep-abschluss.md",
  "specFile": "tasks/iep-abschluss-spec.md",
  "maxFixRounds": 2
};
const PHASES = [
  { ...IEL_COMMON, "phaseId": "IEP-A", "phaseTitle": "Messmaschine (\"Ohrzeuge\", IEP-P1/P1b) restlos aus dem Bestand entfernen. OWNER-ENTSCHEIDUNG 2026-09-17 (Nr. 14, tasks/todo.md): der Owner-Testanruf ist bestanden, die Messmaschine hat genau einen unbrauchbaren Lauf gemacht und ist durch den direkten Owner-Anruf ersetzt - \"ich habe keine Lust auf totes Gewicht\". Die vollstaendige, autoritative Phasendefinition steht in tasks/iep-abschluss-spec.md unter der Ueberschrift \"## Phase IEP-A - ...\" und ist bindend: dort stehen Scope (10 Positionen), Scope-Haertung (Position 11), NICHT-Scope, die Invarianten I1-I7, die Testpflicht, die Abnahmekriterien und das Pre-Mortem R1-R4. KERN DER PHASE, nicht uebersehen: die Ohrzeugen-Gruppe war der EINZIGE Weg, auf dem scripts/iel-mess.mjs eine echte Telefonnummer waehlen konnte. Die Entfernung muss die Angriffsflaeche VERKLEINERN - nach der Phase weist das Werkzeug fail-closed ab, wenn ein Fall das Feld ziel_e164, eine unbekannte art oder eine unbekannte Zaehler-Gruppe traegt (mit Grund, nicht stilles Durchfallen), und dafuer gibt es Tests. Eine Loeschung, die diese Sicherung mitnimmt, sieht im Diff aus wie Aufraeumen und ist ein Blocker. UNBERUEHRT bleiben: die Zaehler-Gruppen m1 und nachdeploy, der vom Owner abgenommene Begruessungslaut samt scripts/render-begruessungslaut.mjs und test/iep-p2-begruessungslaut.test.js, test/iel-b11-nachdeploy.test.js (muss inhaltlich unveraendert gruen bleiben) und der gesamte Produktivpfad src/ - diese Phase aendert KEINE Zeile in src/.", "branch": "phase/iep-a-ohrzeuge-raus", "highStakes": false }
];



async function runPhase(A) {
const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`;
const BASE = A.baseBranch || "master";
const PLAN_DOC = A.planDoc || "PLAN-MULTI-TENANT-TELNYX.md";
const SPEC_FILE = A.specFile || "";
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const REPORT_PATH = `tasks/${String(PHASE).toLowerCase()}-report.md`;

// MODELL-POLITIK: jeder agent() wird explizit gepinnt. Ohne Pin erbt der Subagent das
// Session-Modell - bei einer Fable-Session ein Vielfaches der noetigen Kosten (Memory
// [[workflow-model-policy]]). Zuordnung: Plan + Safety-Review = opus (dort entstehen bzw.
// sterben Fehler), Impl/Clean-Code/Fix = sonnet (Ausfuehrung gegen fertige Spec bzw.
// Regelanwendung gegen einen geschriebenen Katalog), Report = sonnet/low (reines
// Zusammenschreiben).
const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// HOCHRISIKO-PHASEN: hier ist ein Impl-Fehler kein haesslicher Code, sondern eine falsche
// Geldrechnung (Tarif-Signatur), ein blindes Safety-Gate (Budget/Stundenlimit) oder ein
// Live-Dienst, der nicht mehr startet (fatal:true beim Boot). Dort laeuft die Umsetzung
// ebenfalls auf opus und der Safety-Review eine Stufe schaerfer.
const HIGH_STAKES_PHASES = [];
const HIGH_STAKES =
  typeof A.highStakes === "boolean" ? A.highStakes : HIGH_STAKES_PHASES.includes(PHASE);

// Plan-Modell pro Lauf steuerbar (Default unveraendert opus/high). Der Hebel ist eine
// KOSTENENTSCHEIDUNG, keine Stall-Abhilfe: eine Phase ohne Architekturentscheidung (ein
// Messwerkzeug, ein Skript) braucht kein opus im Plan. Opus bleibt Default fuer alles, wo
// Fehler ENTSTEHEN - Architektur, Geld, Gates.
// NICHT verwechseln: die drei IP2-Abbrueche am 2026-09-13 waren ein INTERNET-AUSFALL beim
// Owner (Modell-Anfrage haengt -> 180 s ohne Fortschritt -> Stall auf allen 6 Versuchen),
// kein Modell- und kein Lastproblem. Dieser Schalter haette sie nicht verhindert.
const PLAN_AGENT = {
  model: A.planModel || MODEL_OPUS,
  effort: A.planEffort || "high",
};
const IMPL_AGENT = HIGH_STAKES
  ? { model: MODEL_OPUS, effort: "high" }
  : { model: MODEL_SONNET, effort: "medium" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: HIGH_STAKES ? "xhigh" : "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const SECURITY_AGENT = { model: MODEL_OPUS, effort: "high" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); Lazy-Init-Antipattern vermeiden (P15); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie), reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE entfernen/aufweichen/per-Default umgehen: pro-Tenant-Kostendecke (sperrt BEIDE Richtungen, Inbound eingeschlossen), Denylist/Land-Gate/Stundenlimit, Max-Gespraechsdauer, Verifikation als Outbound-Permit, Kill-Switch OUTBOUND_FROZEN. Neue Endpunkte, die Calls/SMS/Geld ausloesen, brauchen dieselben Gates. (ALLOWED_NUMBERS ist seit dem outbound-p3-Cutover wirkungslos und wird nicht mehr gelesen - sein Fehlen ist KEIN Befund. MAX_BUDGET_EUR ist per Owner-Entscheidung E10 kein geschuetztes Gate mehr, sondern Beobachtung.)
- Disclosure-Satz (disclosureSentence, claude.js) und die Outbound-Offenlegung bleiben fest verdrahtet, unveraendert. Inbound: der KI-Hinweis steckt im festen, serverseitig gesetzten und geprueften first_message-Satz des Agenten - kein separater TeXML-Pflichtsatz mehr auf dem EL-Pfad; ohne gueltigen Hinweis-Baustein kein Gespraech (fail-closed -> Fehlersatz). Die sieben Sicherungen in /voice/incoming laufen unveraendert VOR der Uebergabe. WORTLAUT AKTUELL (Owner-Entscheidung 2026-09-16, ERSETZT die aeltere Spec-Fassung IEX-A O1): Fremde "Hallo, hier ist der KI-Assistent von <Name>. Das Gespraech wird transkribiert und zusammengefasst. Wie kann ich helfen?"; erkannter Owner "Hallo <Vorname>, hier ist dein KI-Assistent. Das Gespraech wird transkribiert und zusammengefasst. Wie kann ich helfen?". Kein "Hinweis:", kein "Sie sprechen mit einer KI", keine Sie-Form. Massgeblich ist tasks/todo.md (Entscheidungen 9-13), NICHT der aeltere O1-Wortlaut in tasks/iex-spec-a.md.
- Kette IEX Teil A: nicht-gepinnte Tenants bleiben bis zum Rollout unveraendert (Inbound-TeXML byte-identisch zu heute). Outbound-Verhalten bleibt unveraendert (einzige gewollte Wirkung: record_voice=false). Die Budget-Engine wird in Teil A NICHT geloescht (nur der Rueckfall-Sprung des EL-Pfads entfaellt). Nie Stille fuer den Anrufer: jeder Fehlerpfad des EL-Pfads endet im festen Fehlersatz + Auflegen, ohne Owner-Benachrichtigung (O3).
- Auth fail-closed: Provider-Signaturpruefung /voice (Telnyx Ed25519; die Twilio-HMAC-Pruefung ist seit C-P3 per Owner-Entscheidung entfernt, ihr Fehlen ist KEIN Befund), Browser-Session (webAuthMw/adminMw) bzw. internalOnly, MCP-Auth - timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies ohne explizite Freigabe in der Spec.
- KEINE PRODUKTIONSHANDLUNG im Workflow: kein echter Anruf (auch kein Mess-/Probeanruf), kein Flip von ELEVENLABS_INBOUND_ENABLED oder OUTBOUND_FROZEN, kein Push, kein Deploy, keine Aenderung an EL-Agent/Telnyx-Konfiguration/Render-Env, kein Schreiben in Zaehlerdateien. Gebaut und getestet wird NUR gegen Attrappen/in-process. Die Ausfuehrung am lebenden System macht danach der Lead. Wer einen echten Anruf ausloest, hat die Phase verfehlt.`;

const specInstruction = SPEC_FILE
  ? `Lies in "${REPO}/${SPEC_FILE}" den Abschnitt mit der Ueberschrift "## Phase ${PHASE} - ..." VOLLSTAENDIG (Ziel/Scope/NICHT-Scope/Betroffene Dateien/Invarianten/Abnahmekriterium/Testpflicht/Risiko) - das ist die AUTORITATIVE Definition dieser Phase und bindend. Lies zusaetzlich Abschnitt 1.2 (die belegten Wurzeln), Abschnitt 2 (Leitentscheidung) und Abschnitt 5 (Clean-Code-Auflagen) derselben Datei als Rahmen, sofern vorhanden; sonst die Abschnitte Leitentscheidungen, Datenfluss und Sicherheitsmodell. Lies ausserdem den Abschnitt "Offene Review-Concerns" am Ende der Datei und adressiere jeden Concern, der deine Phase betrifft (oder begruende im Plan, warum nicht). Die Abschnitte der ANDEREN Phasen sind NICHT dein Auftrag - lies sie nur, wenn der eigene Abschnitt ausdruecklich auf sie verweist.`
  : `(Keine specFile uebergeben - nutze ausschliesslich ${PLAN_DOC}.)`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (Arbeitsbaum bzw. git show ${BASE}:<pfad>). Grep gezielt nach den relevanten Symbolen/Call-Sites - KEINE Zeilennummern uebernehmen (sie rotten).
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) neue Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher); (3) neue/angepasste Tests (oder Begruendung, warum die Bestandssuite reicht); (4) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
    cleanCodeSelfCheck: { type: "string" },
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
3. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test -- --test-concurrency=4 (beide Backends: json-Default + pglite-in-process; OHNE Concurrency-Limit flaked die Bank auf dieser Maschine - Bestandsverhalten, kein Befund). Waehrend der Arbeit gezielte Testdateien, die volle Bank EINMAL am Ende. Als Beleg NUR Exit-Code und die Zeilen # pass/# fail in den Kontext holen (z.B. | grep -E "^# (pass|fail)"), nie die volle Ausgabe (workflow.md 2a). Bestandstests nur bei bewusster Verhaltens-/Signatur-Aenderung anpassen (im Plan begruendet); neues Verhalten -> neuer Test.
6. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env, betroffene Route via curl; zu flaky -> smokePass=false + Grund (kein Blocker).
7. node_modules-Symlink NICHT committen. git add (nur die betroffenen src/test/config/doc-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen / blockiert -> testsPass=false + deviations, nicht schoenen.`,
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
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    behaviorAsIntended: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "safetyGatesIntact",
    "disclosureIntact",
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

const SECURITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["approved", "blockers", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. NICHT die volle Bank (workflow.md 2a: laeuft einmal im Impl und einmal beim Lead). Fuehre nur die vom Diff neu/geaendert betroffenen Testdateien aus (node --test <dateien>), als Beleg nur Exit-Code und # pass/# fail -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur ${PHASE}, keine Extras, kein ungefragter npm-Dep), safetyGatesIntact, disclosureIntact (claude.js und Outbound-Offenlegung unveraendert; Inbound-Pflichtsatz vor der Uebergabe), authFailClosedIntact, noSecretsLeaked, behaviorAsIntended (Schalter aus byte-identisch, Outbound unveraendert, nie Stille, Invarianten wie in der Spec).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
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
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
          isolation: "worktree",
          ...CLEANCODE_AGENT,
        },
      ),
    () =>
      agent(
        `SECURITY-REVIEWER (adversarial, denke wie ein Angreifer). Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") per git diff ${BASE} ${target} bzw. git show ${target}:<pfad>. Lies den Abschnitt Sicherheitsmodell in "${REPO}/${SPEC_FILE}".
PRUEFE: jede neue oder geaenderte oeffentlich erreichbare Route (Auth fail-closed, timing-sicherer Vergleich per safeEqual, Eintrag + Begruendung in src/route-policy.js, test/route-auth-inventory), Eingabevalidierung, Replay/Raten von Tokens, Tenant-Verwechslung (falscher Tenant bekommt Daten/Kosten), Datenabfluss (Owner-Name, Transkripte, Nummern) in Responses/Logs/MCP-Ausgaben, Secrets in TeXML/Logs/Fehlermeldungen, Kosten-Missbrauch (wer kann Anrufe/ElevenLabs-Minuten ohne unsere Sicherungen ausloesen), Umgehung der Gates. Jede Luecke ohne Gegenmassnahme UND Test ist ein Blocker.
${ABS_RULES}
Nur gesehenen Code bewerten, nichts erfinden, jeder Blocker mit Datei:Symbol. approved=true nur ohne Blocker.`,
        {
          label: `${PHASE}-review-security${suffix}`,
          phase: "Review",
          schema: SECURITY_SCHEMA,
          isolation: "worktree",
          ...SECURITY_AGENT,
        },
      ),
  ]);
}

const gateOk = (s, c, x) => !!(s && s.approved && c && !c.blocker && x && x.approved);
const blockerList = (s, c, x) => [
  ...((s && s.blockers) || []),
  ...((c && c.s1) || []),
  ...((c && c.s2) || []),
  ...((x && x.blockers) || []),
];

phase("Review");
let reviewTarget = BRANCH;
let [safety, cc, security] = await runReview(reviewTarget, "");

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
while (!gateOk(safety, cc, security) && round < MAX_FIX_ROUNDS) {
  round++;
  phase("Self-Fix");
  const fixBranch = `${BRANCH}-fix${round}`;
  const blockers = blockerList(safety, cc, security);
  const fix = await agent(
    `Du behebst die REVIEW-BLOCKER der Phase ${PHASE} in einem frischen Worktree. NUR die Blocker fixen, kein Scope-Drift.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. Behebe DIESE Blocker (S1 Korrektheit/Sicherheit + S2 Duplizierung + Safety-Blocker) sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test -- --test-concurrency=4 (beide Backends) gruen. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  // ${fixBranch} existiert in dem Fall NICHT. Frueher wurde reviewTarget trotzdem
  // weitergesetzt: die Folgerunde reviewte einen Phantom-Branch, meldete "Branch existiert
  // nicht" als Blocker und verbrannte die letzte Fix-Runde an einem Nicht-Befund
  // (beobachtet 2026-07-25 in P5, ausgeloest durch ein API-529 in Runde 1). Ohne
  // belegten Commit wird die Schleife deshalb abgebrochen; das Gate bleibt BLOCKED mit
  // den ECHTEN Blockern der letzten belastbaren Review-Runde.
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet, Blocker der Runde ${round - 1 || "Erstreview"} bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc, security] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc, security);

// ---------- Phase 5: Report-Datei (Lead liest sie NICHT) ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree; lege tasks/ an, falls noetig). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Plan (gekuerzt); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Quelle:
=== PLAN ===
${plan || ""}
=== IMPL ===
${JSON.stringify(impl, null, 1)}
=== SAFETY (final) ===
${JSON.stringify(safety, null, 1)}
=== CLEANCODE (final) ===
${JSON.stringify(cc, null, 1)}
=== SECURITY (final) ===
${JSON.stringify(security, null, 1)}
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
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc, security).map((b) => String(b).slice(0, 240)),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
}

if (!PHASES.length) {
  return { gate: "BLOCKED", error: "PHASES leer - nichts gepinnt, kein Lauf" };
}
const stamps = [];
let chainBase = CHAIN_BASE;
for (const P of PHASES) {
  const stamp = await runPhase({ ...P, baseBranch: chainBase });
  stamps.push(stamp);
  if (stamp.gate !== "PASS") {
    log(`${P.phaseId} BLOCKED - Kette endet hier, Folgephasen laufen nicht`);
    break;
  }
  chainBase = stamp.finalBranch;
}
return { chainBase: CHAIN_BASE, lastPassBranch: stamps.filter((s) => s.gate === "PASS").map((s) => s.finalBranch).pop() || null, phases: stamps };
