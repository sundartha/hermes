// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P4, FIX-RUNDE 3 (gerichtet).
//
// Vorgeschichte: die Wiederaufnahme endete BLOCKED. Beide GAP-11-Gates sind gruen, aber
// "npm test" hatte fail=2: zwei gruene Bestandstests des Geld-Pfads pinnen
// `prov.log === []` ("kein Provider-Aufruf ohne reserviertes Geld"), und P4 ruft die
// Preis-Suche jetzt VOR dem Hold auf. Der Impl-Agent hatte R4 eigenmaechtig per Kommentar
// verengt - das war der richtige Reflex am Code und der falsche Weg (unautorisiert).
//
// Der Owner hat die Frage am 2026-07-28 entschieden: die Suche DARF vor den Hold. Der Hold
// ist die einmalige Setup-Gebuehr, und die ist aus (PAYMENT_ENABLED=false,
// NUMBER_SETUP_FEE_CENTS=0) - der Kunde zahlt sein Abo und sonst nichts, die Nummer ist
// unsere Kosten. searchNumbers kostet nichts und kauft nichts; geldbewegend ist orderNumber,
// und der bleibt hinter dem Hold. Der Nachtrag steht in tasks/gates-fix-chain.md, Abschnitt
// P4 - er ist die Autorisierung, ohne die der Review erneut (zu Recht) blockieren wuerde.
//
// Modell-Abweichung: Fix-Runde auf Opus statt Sonnet. Geld-Pfad, und zwei Runden sind hier
// bereits am Urteil gescheitert, nicht an der Ausfuehrung.

export const meta = {
  name: "gates-p4-fix3",
  description: "Gates W2/P4 Fix-Runde 3: die zwei Geld-Pfad-Tests auf die autorisierte Reihenfolge heben",
  phases: [
    { title: "Fix", detail: "Assertions anheben, inhaltliche Zusage gepinnt lassen" },
    { title: "Nach-Review", detail: "dualer Review + Self-Fix ueber gates-review-resume" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const BASE = "5fe5980";
const SOURCE_BRANCH = "phase/gates-p4-did-preis-fix2";
const FIX_BRANCH = "phase/gates-p4-did-preis-fix3";

phase("Fix");

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    committed: { type: "boolean" },
    filesTouched: { type: "array", items: { type: "string" } },
    regressionGreen: { type: "boolean", description: "npm test fail=0" },
    regressionSummary: { type: "string" },
    gatesGreen: { type: "boolean" },
    pinnedPromises: {
      type: "string",
      description:
        "Welche Zusagen die beiden Tests NACH der Aenderung noch pinnen - woertlich die Assertions nennen",
    },
    commentPrecision: {
      type: "string",
      description: "Wie der R4-Kommentar in src/onboarding.js jetzt lautet und worauf er verweist",
    },
    scopeNote: {
      type: "string",
      description:
        "Je Datei ausserhalb der Spec-Dateiliste (schema.sql, store/pg.js, store/state-ops.js, telephony/ports.js): warum sie fuer die Persistenz von monthly_cost noetig ist",
    },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "committed",
    "regressionGreen",
    "regressionSummary",
    "gatesGreen",
    "pinnedPromises",
    "summary",
  ],
};

const fix = await agent(
  `Du fuehrst eine GERICHTETE Fix-Runde fuer Phase P4 (DID-Preis aus der Provider-Antwort) in einem frischen Worktree aus. Enger, abschliessend beschriebener Auftrag - kein Scope-Drift.

REGEL 0 (Basis): pruefe "git rev-parse HEAD". Lege deinen Branch EXPLIZIT an:
  ln -s "${REPO}/node_modules" node_modules
  git checkout -b ${FIX_BRANCH} ${SOURCE_BRANCH}
Basis-Commit der Phase ist ${BASE}.

LIES ZUERST: "${REPO}/tasks/gates-fix-chain.md", Abschnitt "P4" - inklusive des Abschnitts
"Nachtrag 2026-07-28 - die Reihenfolgen-Frage ist entschieden". Dieser Nachtrag ist die
AUTORISIERUNG fuer die Aenderung, die du machst. Lies auch "${REPO}/.claude/refs/clean-code.md".

AUSGANGSLAGE (verifiziert, nicht neu erheben): "npm test" hat auf ${SOURCE_BRANCH} fail=2.
Beide Fehlschlaege sind deterministisch (isoliert reproduziert, KEIN Spawn-Flake):
  - test/billing-hold-capture.test.js: "Hold vor Order: placeHold wirft -> failed, KEIN Provider-Call, KEIN cancelHold" - erwartet prov.log [], ist ['search:DE'].
  - test/p4-setup-fee-hold.test.js: "exempt + placeHold wirft -> failNumber, KEIN orderNumber" - erwartet prov.log [], ist ['search:DE'].
Ursache: die Preis-Suche laeuft seit P4 VOR dem Hold, weil der Hold den Preis aus der Provider-Antwort tragen soll.

WAS DU TUST - genau diese vier Punkte:
(a) Hebe in DIESEN ZWEI Testdateien die zu weite Erwartung an: statt "der Provider wurde gar nicht gerufen" nun "nur die kostenlose Preis-Suche lief". Also prov.log === ['search:DE'] statt []. NICHTS ANDERES in diesen Dateien.
(b) Die inhaltliche Zusage MUSS erhalten bleiben und im Test sichtbar gepinnt sein: KEIN 'order:'-Eintrag in prov.log (kein Kauf ohne Hold), der Ausgang bleibt failNumber/failed, KEIN cancelHold. Wenn eine dieser Zusagen in der bisherigen Assertion nur implizit war, mach sie EXPLIZIT - der Test soll nach deiner Aenderung MEHR sichern, nicht weniger. Nenne die neuen Assertions woertlich in pinnedPromises.
(c) Der Kommentar in src/onboarding.js, der R4 praezisiert ("Hold vor jedem GELD-bewegenden Provider-Call"), bleibt inhaltlich - aber er darf nicht wie eine eigenmaechtige Entscheidung dastehen. Formuliere ihn so, dass er auf die Owner-Entscheidung verweist (Setup-Gebuehr ist aus, Kunde zahlt das Abo, Suche ist kostenlos und kauft nichts) und dass der geldbewegende Schritt orderNumber weiterhin strikt hinter dem Hold liegt. KEINE Datei:Zeile-Referenzen im Kommentar (C2, sie rotten).
(d) Fuelle scopeNote: die Phase hat ausser ihrer Dateiliste auch src/db/schema.sql, src/store/pg.js, src/store/state-ops.js und src/telephony/ports.js angefasst. Begruende je Datei in einem Satz, warum das fuer die PERSISTENZ von monthly_cost (die P5 zwingend braucht) noetig ist. Wenn eine dieser Aenderungen NICHT dafuer noetig ist, nenne sie ehrlich als Scope-Drift.

WAS DU NICHT TUST:
- Keine weitere Testdatei anfassen. Der GAP-11-Test bleibt, wie er ist.
- Keine Aufweichung von Safety-Gates (Budget-Guard, Land-Gate, Denylist, Stundenlimit bleiben unveraendert wirksam).
- Kein neuer Boot-Guard, kein process.exit-Pfad, keine neue Dependency, render.yaml nicht anfassen.
- Die Waehrung nicht verlieren: ein USD-Betrag, der als EUR gebucht wird, ist ein stiller Geldfehler.

ABSOLUTE REGELN (CLAUDE.md): Disclosure-Satz unveraendert; Auth fail-closed; Secrets nie loggen/leaken; ESM, kein Build-Step; Kommentare deutsch OHNE Umlaute (ue/oe/ae).

ABSCHLUSS: node --check auf jede geaenderte .js-Datei; "npm run test:gates" (beide GAP-11-Gates gruen) UND "npm test" mit **fail = 0** - die Gesamtzahl waechst mit den Tests der Phase, massgeblich ist fail=0 und dass kein weiterer Bestandstest kippt. Rote Spawn-Tests ("Server-Start Timeout") sind der bekannte Voll-Last-Flake: isoliert nachfahren, erst dann bewerten. node_modules NICHT committen, KEIN "git add -A". git commit -m "fix(gates-p4): Geld-Pfad-Tests auf die autorisierte Reihenfolge heben". headCommit = git rev-parse HEAD.
EHRLICH melden, was du nicht loesen konntest.`,
  {
    label: "GATES-P4-fix-r3",
    phase: "Fix",
    schema: FIX_SCHEMA,
    isolation: "worktree",
    model: "opus",
    effort: "high",
  },
);

if (!fix || !fix.committed || !fix.headCommit) {
  return {
    phaseId: "GATES-P4",
    gate: "BLOCKED",
    finalBranch: SOURCE_BRANCH,
    reason: "Fix-Runde 3 hat nicht committet (Agent tot oder blockiert).",
    fix,
  };
}

log(`P4 Fix-Runde 3 committet (${fix.headCommit}). Jetzt dualer Review auf ${FIX_BRANCH}.`);

phase("Nach-Review");
const review = await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P4",
    phaseTitle: "DID-Preis aus der Provider-Antwort (GAP-11), nach der Reihenfolgen-Entscheidung",
    branch: FIX_BRANCH,
    baseBranch: BASE,
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P4 (inklusive Nachtrag 2026-07-28 - er autorisiert die Aenderung an den zwei Geld-Pfad-Tests)",
    gates: "GAP-11 in test/f1-provisioning-geo.test.js",
    maxFixRounds: 1,
    highStakes: true,
  },
);

return {
  phaseId: "GATES-P4",
  fixRound3: {
    headCommit: fix.headCommit,
    regressionGreen: fix.regressionGreen,
    regressionSummary: fix.regressionSummary,
    pinnedPromises: fix.pinnedPromises,
    commentPrecision: fix.commentPrecision || "",
    scopeNote: fix.scopeNote || "",
    summary: fix.summary,
  },
  review,
};
