// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P10, FIX-RUNDE 2 (gerichtet).
//
// Vorgeschichte: die Wiederaufnahme endete BLOCKED - zu Recht. Beide Gates (MCP-14, LANG-15)
// sind gruen, aber "npm test" hatte fail=1: der Bestandstest "P1-02 (nach P2b):
// place_call-Schema bleibt strukturell unveraendert" pinnt den Feldsatz INKLUSIVE `language`,
// waehrend LANG-15 genau dieses Feld entfernt verlangt. Unter der urspruenglichen Liste
// zulaessiger Testaenderungen war die Phase damit UNABSCHLIESSBAR.
//
// Der Impl-Agent hat sich korrekt verhalten: Commit 88bb6ca nimmt die unautorisierte
// Testanpassung aus 3bdb835 wieder zurueck und meldet den Konflikt, statt ihn stillzulegen.
//
// Entschieden am 2026-07-28 (Nachtrag in tasks/gates-fix-chain.md, Abschnitt P10): die Liste
// wird erweitert. Der Parameter ist nachweislich wirkungslos (gruener Mechanismus-Test:
// body.language wird serverseitig ignoriert, der Geo-Anker gewinnt) - entfernt wird eine
// Attrappe, kein Verhalten. PLACE_CALL_SHAPE darf um dieses eine Feld bereinigt werden.
//
// Fix-Runden sind auf diesem Branch erschoepft (2 gefahren, die zweite ohne Commit), deshalb
// diese gerichtete Runde mit ausdruecklicher Autorisierung.

export const meta = {
  name: "gates-p10-fix2",
  description: "Gates W2/P10 Fix-Runde 2: PLACE_CALL_SHAPE um das gestrichene language-Feld bereinigen",
  phases: [
    { title: "Fix", detail: "Schema-Waechter korrigieren, Toleranz gegen Altaufrufer pruefen" },
    { title: "Nach-Review", detail: "dualer Review + Self-Fix ueber gates-review-resume" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const BASE = "5fe5980";
const SOURCE_BRANCH = "phase/gates-p10-mcp-oberflaeche-fix1";
const FIX_BRANCH = "phase/gates-p10-mcp-oberflaeche-fix2";

phase("Fix");

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    committed: { type: "boolean" },
    filesTouched: { type: "array", items: { type: "string" } },
    regressionGreen: { type: "boolean" },
    regressionSummary: { type: "string" },
    gatesGreen: { type: "boolean" },
    remainingShapePins: {
      type: "string",
      description: "Welche Felder PLACE_CALL_SHAPE nach der Bereinigung noch pinnt - Liste",
    },
    unknownFieldBehaviour: {
      type: "string",
      description:
        "Was passiert, wenn ein Client place_call WEITERHIN mit language aufruft: still ignoriert oder abgelehnt? Beleg (Kommando + Ausgabe). Falls abgelehnt: was du getan hast, um die bisherige Toleranz herzustellen.",
    },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "committed",
    "regressionGreen",
    "regressionSummary",
    "gatesGreen",
    "remainingShapePins",
    "unknownFieldBehaviour",
    "summary",
  ],
};

const fix = await agent(
  `Du fuehrst eine GERICHTETE Fix-Runde fuer Phase P10 (MCP-Oberflaeche, MCP-14 + LANG-15) in einem frischen Worktree aus. Enger, abschliessend beschriebener Auftrag - kein Scope-Drift.

REGEL 0 (Basis): pruefe "git rev-parse HEAD". Lege deinen Branch EXPLIZIT an:
  ln -s "${REPO}/node_modules" node_modules
  git checkout -b ${FIX_BRANCH} ${SOURCE_BRANCH}
Basis-Commit der Phase ist ${BASE}.

LIES ZUERST: "${REPO}/tasks/gates-fix-chain.md", Abschnitt "P10" - INKLUSIVE des Abschnitts
"Nachtrag 2026-07-28 - die Spec-Luecke ist geschlossen". Dieser Nachtrag AUTORISIERT die
Testaenderung, die du machst; ohne ihn waere sie ein Blocker. Lies auch
"${REPO}/.claude/refs/clean-code.md".

AUSGANGSLAGE (verifiziert, nicht neu erheben): auf ${SOURCE_BRANCH} sind beide Gates gruen,
aber "npm test" hat fail=1: "P1-02 (nach P2b): place_call-Schema bleibt strukturell
unveraendert" in test/place-call-context-bridge.test.js. PLACE_CALL_SHAPE erwartet dort
weiterhin \`language: { optional: true }\`, obwohl LANG-15 das Feld aus dem Zod-Schema in
src/mcp-tools.js entfernt hat. Deterministisch, kein Spawn-Flake.

WAS DU TUST - genau diese drei Punkte:
(a) Bereinige PLACE_CALL_SHAPE in test/place-call-context-bridge.test.js um das Feld \`language\` (und passe den Testtitel an, falls er das Feld nennt). NICHTS ANDERES in dieser Datei.
(b) Der Test bleibt ein SCHEMA-WAECHTER: der uebrige Feldsatz von place_call samt Optionalitaet bleibt gepinnt, die deepEqual-Gegenprobe der Schluessel bleibt. Nenne in remainingShapePins, welche Felder danach noch gepinnt sind.
(c) VERTRAG NACH AUSSEN pruefen (das ist der eigentliche Risiko-Punkt): /mcp bedient echte Clients. Ein Aufruf, der \`language\` WEITERHIN mitschickt, wurde bisher stillschweigend ignoriert - genau das muss die Zusage bleiben. Pruefe am Code, ob das Zod-Schema unbekannte Felder toleriert oder zurueckweist, und BELEGE es (kleines node-Skript gegen das echte Schema, Kommando + Ausgabe). Falls es zurueckweist: stelle die Toleranz her und sichere sie mit einem Test ab. Falls es toleriert: nichts aendern, nur belegen. Ergebnis nach unknownFieldBehaviour.

WAS DU NICHT TUST:
- Keine weitere Testdatei anfassen; die beiden Gate-Tests bleiben unveraendert.
- Kein zweiter Anlauf an den Texten (MCP-14 ist gruen) - die Phase ist inhaltlich fertig.
- Audio laeuft NIEMALS durch MCP. Keine Secrets in MCP-Ausgaben.
- Kein "git stash" - refs/stash ist zwischen Worktrees GETEILT und andere Worktrees sind aktiv.
- KEIN "git add -A", node_modules nicht committen.

ABSOLUTE REGELN (CLAUDE.md): Safety-Gates unangetastet; Disclosure-Satz unveraendert; Auth fail-closed; ESM, kein Build-Step; Kommentare deutsch OHNE Umlaute (ue/oe/ae).

ABSCHLUSS: node --check auf jede geaenderte .js-Datei; "npm run test:gates" (MCP-14 + LANG-15 gruen) UND "npm test" mit **fail = 0**. Rote Spawn-Tests ("Server-Start Timeout") sind der bekannte Voll-Last-Flake: isoliert nachfahren, erst dann bewerten. git commit -m "fix(gates-p10): Schema-Waechter um das gestrichene language-Feld bereinigen". headCommit = git rev-parse HEAD.
EHRLICH melden, was du nicht loesen konntest.`,
  {
    label: "GATES-P10-fix-r2",
    phase: "Fix",
    schema: FIX_SCHEMA,
    isolation: "worktree",
    model: "sonnet",
    effort: "medium",
  },
);

if (!fix || !fix.committed || !fix.headCommit) {
  return {
    phaseId: "GATES-P10",
    gate: "BLOCKED",
    finalBranch: SOURCE_BRANCH,
    reason: "Fix-Runde 2 hat nicht committet (Agent tot oder blockiert).",
    fix,
  };
}

log(`P10 Fix-Runde 2 committet (${fix.headCommit}). Jetzt dualer Review auf ${FIX_BRANCH}.`);

phase("Nach-Review");
const review = await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P10",
    phaseTitle: "MCP-Oberflaeche (MCP-14, LANG-15), nach Schliessung der Spec-Luecke",
    branch: FIX_BRANCH,
    baseBranch: BASE,
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P10 (inklusive Nachtrag 2026-07-28 - er autorisiert die Bereinigung von PLACE_CALL_SHAPE)",
    gates: "MCP-14 in test/mcp-tools-i18n.test.js und LANG-15 in test/p15-mcp-tool-descriptions-en.test.js",
    maxFixRounds: 1,
    highStakes: false,
  },
);

return {
  phaseId: "GATES-P10",
  fixRound2: {
    headCommit: fix.headCommit,
    regressionGreen: fix.regressionGreen,
    regressionSummary: fix.regressionSummary,
    remainingShapePins: fix.remainingShapePins,
    unknownFieldBehaviour: fix.unknownFieldBehaviour,
    summary: fix.summary,
  },
  review,
};
