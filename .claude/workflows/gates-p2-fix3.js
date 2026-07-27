// PER-RUN-WRAPPER Gates-Kette Welle 1 — Phase P2, FIX-RUNDE 3 (gerichtet).
//
// Vorgeschichte: die Wiederaufnahme (gates-p2-resume.js) endete BLOCKED. Beide Gates sind
// gruen und die Regression ist sauber, aber die beiden Self-Fix-Runden haben den Scope
// verlassen: sie bauten in src/boot.js + src/boot-guard.js ein NEUES FATALES Boot-Gate
// (assertFxRateCoherent -> process.exit(1), wenn die beiden Kurs-Achsen um >= 0.005
// auseinanderliegen). Die Spec von P2 nennt abschliessend `src/config.js`, `.env.example`
// und schaerft nach: "Halte den Eingriff eng: eine Quelle, ihre Leser, sonst nichts."
//
// Warum das kein Formalstreit ist: die Render-Services sind dashboard-managed (Live !=
// render.yaml). Traegt das Live-Dashboard einen von Hand korrigierten Kurs, verweigert der
// Dienst beim naechsten Deploy den Start - der Ausgang, den die Kette selbst als teuersten
// benennt. Ausserdem gehoert src/boot.js in dieser Kette P7 (W2) und P5 (W3); P2 liegt in
// W1 und greift damit zwei Hochrisiko-Phasen vor.
//
// Die Runde loest die Wurzel STRUKTURELL statt per Waechter: der Mikro-Fallback wird aus
// demselben Literal abgeleitet, aus dem die LLM-Achse liest. Dann gibt es nur noch EINE
// echte Zahl im Code - und ein Waechter, der zwei Zahlen vergleicht, wird gegenstandslos.
//
// Modell-Abweichung von der Standard-Politik (Sonnet fuer Fixes), bewusst: diese Phase ist
// Geld UND hat in zwei Runden am Urteil gescheitert, nicht an der Ausfuehrung. Die Fix-Runde
// laeuft deshalb auf Opus.

export const meta = {
  name: "gates-p2-fix3",
  description: "Gates W1/P2 Fix-Runde 3: Scope-Rueckbau (Boot-Gate raus) + eine echte Zahl",
  phases: [
    { title: "Fix", detail: "Boot-Gate zurueckbauen, Fallback aus der einen Quelle ableiten" },
    { title: "Nach-Review", detail: "dualer Review + Self-Fix ueber gates-review-resume" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const BASE = "695505e";
const SOURCE_BRANCH = "phase/gates-p2-fx-single-source-fix2";
const FIX_BRANCH = "phase/gates-p2-fx-single-source-fix3";

phase("Fix");

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    committed: { type: "boolean" },
    filesTouched: { type: "array", items: { type: "string" } },
    bootFilesReverted: {
      type: "boolean",
      description: "src/boot.js und src/boot-guard.js sind byte-identisch zur Basis",
    },
    singleLiteralProof: {
      type: "string",
      description: "Beleg (Kommando + Ausgabe), dass nur noch EINE Kurs-Zahl im Code steht",
    },
    chosenRate: {
      type: "string",
      description: "Welcher Wert ist der gemeinsame Default und WELCHE Achse aendert dadurch ihren Wert",
    },
    gatesGreen: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    removedTests: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "committed",
    "bootFilesReverted",
    "singleLiteralProof",
    "chosenRate",
    "gatesGreen",
    "testsPass",
    "summary",
  ],
};

const fix = await agent(
  `Du fuehrst eine GERICHTETE Fix-Runde fuer Phase P2 (Wechselkurs, eine Quelle, GAP-08 x2) in einem frischen Worktree aus. Die Aufgabe ist eng und abschliessend beschrieben - kein Scope-Drift, keine Zusatzideen.

REGEL 0 (Basis): pruefe "git rev-parse HEAD". Lege deinen Branch EXPLIZIT an:
  ln -s "${REPO}/node_modules" node_modules
  git checkout -b ${FIX_BRANCH} ${SOURCE_BRANCH}
Basis-Commit der Phase ist ${BASE}; ${SOURCE_BRANCH} ist der Stand nach zwei Fix-Runden.

LIES ZUERST: "${REPO}/tasks/gates-fix-chain.md", Abschnitt "P2" (autoritative Spec) und die Regeln am Dokumentanfang, die fuer jede Phase gelten. Ausserdem "${REPO}/.claude/refs/clean-code.md".

WAS FALSCH IST (Befund des Safety-Reviews, bereits verifiziert - nicht neu erheben):
1. SCOPE-VERLETZUNG: der Branch aendert src/boot.js (+24) und src/boot-guard.js (+47) und baut dort ein neues FATALES Boot-Gate (fxRateAxesDiverged / assertFxRateCoherent, process.exit(1) bei Abweichung >= 0.005). Die Dateiliste der Phase ist abschliessend: src/config.js, .env.example. Ein Boot-Guard ist kein "Leser der Quelle". src/boot.js gehoert in dieser Kette den Phasen P7 (Welle 2) und P5 (Welle 3).
2. DEPLOY-RISIKO daraus: die Render-Services sind dashboard-managed (Live != render.yaml). Traegt das Live-Dashboard einen abweichenden, von Hand gesetzten Kurs, verweigert der Dienst beim naechsten Deploy den Start.
3. G5/S2 (die eigentliche, ungeloeste Wurzel): der Kurs existiert weiterhin als ZWEI unabhaengig gepflegte Literale - EXCHANGE_RATE_DEFAULTS.usdToEur und der numEnv-Fallback von providerToBucketRateMicro (920000). Die Kohaerenz wird heute nur durch Tests und den Boot-Waechter erzwungen, nicht durch die Struktur (G27: Disziplin statt Struktur).

WAS DU TUST - genau diese vier Punkte:
(a) BOOT-GATE ZURUECKBAUEN. src/boot.js und src/boot-guard.js muessen am Ende BYTE-IDENTISCH zu ${BASE} sein. Beleg fuehren: "git diff ${BASE} -- src/boot.js src/boot-guard.js" ist leer. Dazu gehoeren auch die Tests, die ausschliesslich diesen Waechter pinnen - nenne jeden entfernten Test in removedTests mit Begruendung.
(b) EINE ECHTE ZAHL. Leite den Mikro-Fallback rechnerisch aus derselben Konstante ab, aus der die LLM-Achse liest (Richtung: fallback = Math.round(<die eine Kurs-Konstante> * <benannte Mikro-Einheit>)). Danach steht der Kurs an genau EINER Stelle im Code; die Umgebungs-Variable bleibt die eine dokumentierte Stellschraube. Ein Waechter, der zwei Zahlen vergleicht, wird dadurch gegenstandslos - das ist der Sinn der Uebung. Fuehre den Beleg in singleLiteralProof (grep-Kommando + Ausgabe, das zeigt, dass es nur noch eine Kurs-Zahl gibt).
(c) DUPLIZIERUNG IM TESTHELFER (G5, klein): in test/fx-single-source-fallback-wiring.test.js sind readBuiltRates und readBuiltRatesWithoutUsdToEurEnv zwei Funktionen mit identischem script-String und identischem execFileSync-Aufruf, die sich nur in der env-Berechnung unterscheiden. Zieh das auf EINE Funktion mit Parameter zusammen.
(d) BEWUSSTE ENTSCHEIDUNG BENENNEN: welcher der beiden Werte (0.93 der LLM-Achse, 0.92 der Provider-Achse) ist der gemeinsame Default, und WELCHE Achse aendert dadurch ihren Wert? Das gehoert nach chosenRate - die Spec verlangt es ausdruecklich im Bericht. Aendere die getroffene Wahl NICHT, dokumentiere sie nur; sie steht bereits im Branch.

WAS DU NICHT TUST:
- Keine weitere Datei ausser src/config.js, .env.example und den Testdateien der Phase.
- Kein neuer Boot-Guard, kein Warnpfad in boot-Dateien, kein neuer Endpunkt, keine neue Dependency.
- render.yaml NICHT anfassen (P15 haelt die Datei).
- KEINEN Bestandstest umschreiben oder stilllegen. Die beiden GAP-08-Gates in test/fx-single-source.test.js bleiben unveraendert - sie sind die Spezifikation.
- Test-BASE_ENV-Drift beachten: eine config-Env-Var MUSS in BASE_ENV (test/helpers.js) stehen, sonst leakt die lokale .env in die Spawn-Tests.

ABSOLUTE REGELN (CLAUDE.md): Safety-Gates nie aufweichen; Disclosure-Satz unveraendert; Auth fail-closed; Secrets nie loggen/leaken; ESM, kein Build-Step, Kommentare deutsch OHNE Umlaute.

ABSCHLUSS: node --check auf jede geaenderte .js-Datei; "npm run test:gates" (beide GAP-08-Gates gruen) UND "npm test" (fail = 0; die Gesamtzahl waechst mit den Tests der Phase - massgeblich ist, dass KEIN bestehender Test rot wird). node_modules NICHT committen, KEIN "git add -A" - nur die betroffenen Dateien. git commit -m "fix(gates-p2): Boot-Gate zurueckbauen, Kurs-Fallback aus der einen Quelle ableiten". headCommit = git rev-parse HEAD.
EHRLICH melden, was du nicht loesen konntest.`,
  {
    label: "GATES-P2-fix-r3",
    phase: "Fix",
    schema: FIX_SCHEMA,
    isolation: "worktree",
    model: "opus",
    effort: "high",
  },
);

if (!fix || !fix.committed || !fix.headCommit) {
  return {
    phaseId: "GATES-P2",
    gate: "BLOCKED",
    finalBranch: SOURCE_BRANCH,
    reason:
      "Fix-Runde 3 hat nicht committet (Agent tot oder blockiert). Die Scope-Verletzung aus Runde 2 steht unveraendert.",
    fix,
  };
}

log(`P2 Fix-Runde 3 committet (${fix.headCommit}). Jetzt dualer Review auf ${FIX_BRANCH}.`);

phase("Nach-Review");
const review = await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P2",
    phaseTitle: "Wechselkurs - eine Quelle (GAP-08 x2), nach Scope-Rueckbau",
    branch: FIX_BRANCH,
    baseBranch: BASE,
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P2",
    gates: "die beiden GAP-08-Tests in test/fx-single-source.test.js",
    maxFixRounds: 1,
    highStakes: true,
  },
);

return {
  phaseId: "GATES-P2",
  fixRound3: {
    headCommit: fix.headCommit,
    bootFilesReverted: fix.bootFilesReverted,
    singleLiteralProof: fix.singleLiteralProof,
    chosenRate: fix.chosenRate,
    removedTests: fix.removedTests || [],
    summary: fix.summary,
  },
  review,
};
