// EINMALIGES Fix-Workflow fuer den letzten P10-Blocker (Lead, 2026-07-26).
// Kein Plan-, kein Impl-Agent: der Befund und der Fix-Ort stehen fest. Nur Fix + dualer
// Review, damit die Aenderung dasselbe Gate durchlaeuft wie jede Phase - der Lead patcht
// Testprämissen NICHT selbst.
export const meta = {
  name: "p10-failclosed-fix",
  description:
    "P10: die drei Weltdefault-Tests an den fail-closed Schalter anpassen, dann dualer Review bis PASS.",
  phases: [{ title: "Self-Fix" }, { title: "Review" }],
};

const REPO =
  typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
const NODE_MODULES = `${REPO}/node_modules`;
const BASE = "master";
const START = "phase/i18n-p10-lead-failclosed";
const MAX_ROUNDS = 2;

const ABS_RULES = `ABSOLUTE REGELN (CLAUDE.md): Safety-Gates nie aufweichen; Offenlegungssatz fest verdrahtet; Auth fail-closed; Secrets nie loggen; Audio nie durch MCP. SCOPE: NUR dieser Blocker, keine Extras.`;
const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn. ESM, kein Build-Step, Kommentare deutsch OHNE Umlaute. Keine Duplizierung, keine Magic Numbers, kein toter Code.`;

const AUFGABE = `KONTEXT. Auf Branch "${START}" ist der letzte P10-Blocker bereits behoben: src/config.js setzt WORLD_DEFAULT_LANGUAGE_ENABLED jetzt fail-closed (fallback: false). Das ist BINDEND und wird NICHT rueckgaengig gemacht - PLAN-I18N-FIX.md, Abschnitt P10 "Aktivierungsfenster (S2, quer zu P10-P13)" verlangt woertlich: "der Env-Schalter aus ENTSCHAERFT (1) bleibt nach diesem Deploy AUS und wird erst nach der Abnahme von P13 eingeschaltet." Der Blueprint-Wert in render.yaml reicht als Schutz nicht, weil der Render-Service dashboard-managed ist.

FOLGE, die du behebst: drei Tests pruefen den Weltdefault IN-PROCESS und importieren dabei ueber test/helpers.js transitiv src/config.js. Dadurch drueckt der Setter setWorldDefaultLanguageEnabled() den Wert auf "de", und ihre Assertions auf den Weltdefault "en" scheitern:
 1. test/f1-i18n-locale.test.js - "localeFor(null|undefined|'xx') liefert das EN-Locale (Weltdefault) (ex WORLD-03)"
 2. test/disclosure-regression.test.js - "P10-S1-1: disclosureSentence ohne language faellt auf den Weltdefault (DEFAULT_LANGUAGE) zurueck"
 3. test/p8-tenant-geo-timezone.test.js - "tenantGeoForCountry: US -> defaultLanguage 'en' (Weltdefault) + America/New_York"

SOLLZUSTAND: diese Tests pruefen den FLIP-MECHANISMUS und muessen den Schalter deshalb selbst und sichtbar scharf stellen (analog zu test/e2e-05-us-launch-full-chain.test.js, das laut render.yaml-Kommentar "den Flip-MECHANISMUS unter einem eigenen env-Override" prueft). Waehle den saubersten Weg im Bestand (z.B. setWorldDefaultLanguageEnabled(true) in einem before()-Hook, oder was die Datei schon nutzt) und mach im Testnamen/Kommentar sichtbar, dass der Weltdefault hier bewusst aktiviert ist.

VERBOTEN: die Assertions abschwaechen, die Erwartung von "en" auf "de" drehen, den fail-closed Default zurueckdrehen, oder PLAN-I18N-FIX.md aendern. Wenn ein Test sachlich falsch ist, korrigierst du ihn nach Regel R5 MIT Begruendung im Commit - nie stillschweigend.

PRUEFE AUSSERDEM: test/dial-target-normalization.test.js ("POST /api/calls: nationale Schreibweise wird deterministisch normalisiert") war in einem von zwei Laeufen rot. Fahr die Datei ISOLIERT mehrfach. Ist sie isoliert stabil gruen -> Voll-Last-Flake, nichts tun, in summary vermerken. Ist sie isoliert rot -> es ist eine echte Folge des fail-closed Defaults (Heimatland-Aufloesung haengt an der Sprache) und du behebst sie mit.`;

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    branch: { type: "string" },
    addressed: { type: "array", items: { type: "string" } },
    filesTouched: { type: "array", items: { type: "string" } },
    dialTargetVerdict: { type: "string", description: "isoliert gruen (Flake) oder echt rot + Fix" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["headCommit", "branch", "testsPass", "testPassCount", "testFailCount", "committed", "summary"],
};

const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    failClosedIntact: { type: "boolean", description: "Code-Default von WORLD_DEFAULT_LANGUAGE_ENABLED ist weiterhin false" },
    noWeakenedAssertions: { type: "boolean" },
    scopeRespected: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["approved", "testsPassIndependently", "failClosedIntact", "noWeakenedAssertions", "blockers", "verdict"],
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
    verdict: { type: "string" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "verdict"],
};

async function review(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER Safety-/Verhaltens-Reviewer in frischem Worktree, Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-p10fc${suffix} ${target}
3. npm test SELBST fahren -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} pruefen.
PRUEFE HART: (a) failClosedIntact - src/config.js hat weiterhin fallback:false fuer WORLD_DEFAULT_LANGUAGE_ENABLED, und ein Boot OHNE gesetzte Env-Variable liefert DEFAULT_LANGUAGE "de" (selbst nachmessen, nicht glauben); (b) noWeakenedAssertions - KEINE Assertion wurde abgeschwaecht, keine Erwartung von "en" auf "de" gedreht, kein Test geloescht statt korrigiert; (c) scopeRespected - nur die genannten Testdateien plus ggf. dial-target, kein Produktionscode ausser dem bereits vorhandenen config.js-Fallback, PLAN-I18N-FIX.md unveraendert.
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren.`,
        { label: `p10fc-review-safety${suffix}`, phase: "Review", schema: SAFETY_SCHEMA, isolation: "worktree", model: "opus", effort: "high" },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR fuer den Diff von "${target}" gegen "${BASE}".
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
2. git diff ${BASE} ${target}.
Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad. blocker=true wenn s1 ODER s2 nicht leer. Erfinde nichts.`,
        { label: `p10fc-review-cleancode${suffix}`, phase: "Review", schema: CC_SCHEMA, isolation: "worktree", model: "sonnet", effort: "medium" },
      ),
  ]);
}

phase("Self-Fix");
let target = START;
let round = 0;
let safety = null;
let cc = null;
const notes = [];

while (round < MAX_ROUNDS) {
  round++;
  const branch = `phase/i18n-p10-failclosed-fix${round}`;
  const extra =
    round === 1
      ? ""
      : `\n\nDIES IST RUNDE ${round}. Die Review-Blocker der Vorrunde:\n${JSON.stringify([...(safety?.blockers || []), ...(cc?.s1 || []), ...(cc?.s2 || [])], null, 1)}`;
  const fix = await agent(
    `Du arbeitest in einem FRISCHEN Git-Worktree.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${branch} ${target}
3. ${AUFGABE}${extra}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check auf jede geaenderte .js-Datei, dann npm test (VOLL, nicht nur die Einzeldateien) gruen. node_modules NICHT committen. git add (nur betroffene Dateien) && git commit. headCommit = git rev-parse HEAD, branch = ${branch}.
EHRLICH fuellen: was nicht gruen ist, gehoert in summary, nicht geschoent.`,
    { label: `p10fc-fix-r${round}`, phase: "Self-Fix", schema: FIX_SCHEMA, isolation: "worktree", model: "sonnet", effort: "medium" },
  );
  notes.push(`r${round}: ${fix?.summary?.slice(0, 400) || "(kein Ergebnis)"}`);
  if (!fix || !fix.committed || !fix.headCommit) {
    notes.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten, Branch ${branch} existiert nicht.`);
    break;
  }
  target = branch;
  phase("Review");
  [safety, cc] = await review(target, `-r${round}`);
  if (safety?.approved && cc && !cc.blocker) break;
  phase("Self-Fix");
}

const approved = !!(safety?.approved && cc && !cc.blocker);
return {
  gate: approved ? "PASS" : "BLOCKED",
  finalBranch: target,
  rounds: round,
  dialTargetVerdict: notes.join(" | ").slice(0, 500),
  remainingBlockers: approved ? [] : [...(safety?.blockers || []), ...(cc?.s1 || []), ...(cc?.s2 || [])],
  notes,
};
