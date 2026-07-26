// EINMALIGER nachgezogener Safety-Review fuer P13 (Lead, 2026-07-26).
//
// WARUM: P13 (Widget und Kanarienvogel) wurde gemergt, obwohl in seiner Kette NIE ein
// Safety-Urteil eingetragen wurde - tasks/p13-report.md fuehrt "Safety-Urteil: null". Der
// Clean-Code-Auditor war gruen, die Suite war gruen, aber die zweite, adversariale Pruefung
// auf Gates/Offenlegung/Auth/Secrets hat fuer diese eine Phase nicht stattgefunden. Das ist
// eine Luecke im NACHWEIS, kein bekannter Fehler - sie wird hier nachgeholt.
//
// BESONDERHEIT: die Phase ist BEREITS GEMERGT. Es gibt also nichts zu blockieren; das
// Ergebnis ist ein Urteil ueber Bestand. Findet der Review etwas, entscheidet der Owner
// ueber die Folge - deshalb KEINE Self-Fix-Schleife in diesem Workflow.

export const meta = {
  name: "p13-safety-review",
  description:
    "Nachgezogener Safety-/Verhaltens-Review fuer die bereits gemergte Phase P13 (Widget und Kanarienvogel). Urteil ueber Bestand, kein Fix.",
  phases: [
    { title: "Review", detail: "Adversarialer Safety-Review des P13-Diffs (opus/xhigh)" },
    { title: "Report", detail: "Urteil nach tasks/p13-safety-review.md" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// HART GEPINNT. P13 kam mit dem Merge f07669f auf master; e014dbf war die Basis davor.
// "git diff e014dbf f07669f" ist damit exakt die Aenderung der Phase.
const P13_BASE = "e014dbf";
const P13_MERGE = "f07669f";
const REPORT_PATH = "tasks/p13-safety-review.md";

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
    audioNeverThroughMcp: { type: "boolean" },
    behaviorAsIntended: { type: "boolean" },
    stillHoldsAtHead: {
      type: "boolean",
      description:
        "true, wenn die P13-Invarianten auf dem HEUTIGEN master noch gelten (P15/P15b haben mcp-tools.js danach angefasst)",
    },
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
    "authFailClosedIntact",
    "noSecretsLeaked",
    "audioNeverThroughMcp",
    "stillHoldsAtHead",
    "blockers",
    "verdict",
  ],
};

phase("Review");
const safety = await agent(
  `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Du holst ein NIE ERSTELLTES Urteil nach.

KONTEXT (bindend): Phase P13 "Widget und Kanarienvogel" (Katalog-IDs MCP-09, UI-14, UI-18, MCP-12) ist BEREITS auf master gemergt. In ihrer Workflow-Kette wurde nie ein Safety-Review eingetragen ("Safety-Urteil: null" in ${REPO}/tasks/p13-report.md). Du pruefst also Bestand. Du sollst NICHTS aendern und NICHTS committen - nur urteilen.

WAS P13 GEAENDERT HAT: die Widget-Sprache wird nicht mehr im Iframe aus navigator.language geraten, sondern serverseitig als Agentensprache gerendert (loc.language -> enableWidgetUi -> registerResource -> widgetHtml); die Berechtigungs-Feldnamen der MCP-Antwort folgen der Tenant-Sprache; das Widget-HTML wird als zweistufige Sprach-Matrix beim Modul-Load gebaut.

VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-p13-nachgezogen ${P13_MERGE}
3. npm test selbst fahren (beide Backends, json-Default + pglite) -> testsPassIndependently + Zahlen in independentTestSummary.
4. Der Diff der Phase ist "git diff ${P13_BASE} ${P13_MERGE}". Lies ihn VOLLSTAENDIG. Neue Dateien per "git show ${P13_MERGE}:<pfad>".
5. Lies ${REPO}/tasks/p13-report.md (Selbstauskunft des Impl-Agenten - misstraue ihr, pruefe am Code) und den Abschnitt "### P13 - Widget und Kanarienvogel" in ${REPO}/PLAN-I18N-FIX.md (Soll-Zustand inkl. Pre-Mortem).

PRUEFE GEGEN DIE ABSOLUTEN REGELN (CLAUDE.md):
- safetyGatesIntact: hat der Diff irgendein Gate (Denylist/Land/Stundenlimit/Budget/Max-Dauer/Signaturpruefung) beruehrt, aufgeweicht oder umgangen?
- disclosureIntact: disclosureSentence in claude.js/bridge.js unveraendert?
- authFailClosedIntact: /mcp bleibt hinter mcpAuth, kein neuer Endpunkt ohne Auth, keine aufgeweichte Pruefung?
- noSecretsLeaked: kann ueber die neue Sprach-Matrix, registerResource oder die Berechtigungs-Zusammenfassung irgendein Secret, ein interner Wert oder ein FREMD-Tenant-Wert in die Widget-/Tool-Ausgabe geraten? Der Whitelist-Filter pickAgentStatus ist hier der kritische Punkt.
- audioNeverThroughMcp: laeuft weiterhin ausschliesslich Transkript/Status durch MCP, niemals Audio?
- scopeRespected: nur die vier Katalog-IDs, keine ungefragten Extras, keine neue Dependency/Env-Variable?
- behaviorAsIntended: bekommt ein Tenant WIRKLICH das Widget seiner Sprache - und ist die Sprache Teil des Cache-Schluessels? Pre-Mortem 2 der Phase lautet woertlich: "Das Widget wurde sprachabhaengig serverseitig gerendert, der Cache-Key vergass die Sprache - deutsche Kunden bekamen englische Widgets." PRUEFE GENAU DAS am Code, nicht an der Behauptung.
- Pre-Mortem 1 der Phase: "permissionsSummary bekam neue Feldnamen, ui/widget-bind.js wurde nicht mitgezogen -> Live-Widget blieb stumm leer." Der Impl-Agent behauptet, widget-bind.js parse keine Feldnamen und muesse deshalb nicht mit. VERIFIZIERE das selbst am Code.

ZUSAETZLICH stillHoldsAtHead: P15 und P15b haben src/mcp-tools.js nach P13 erneut angefasst. Pruefe auf dem HEUTIGEN master (git log --oneline -1), ob die P13-Invarianten dort noch gelten - insbesondere, dass die Sprache weiterhin Teil des Widget-Cache-Schluessels ist und die Berechtigungs-Feldnamen weiterhin aus dem Locale-Buendel kommen.

approved=true NUR wenn alle Einzelflags erfuellt sind UND deine eigenen Tests gruen sind. Im Zweifel blockieren. Benenne in blockers/concerns konkret Datei + Sachverhalt, erfinde nichts. Deine Rueckgabe IST das Urteil.`,
  {
    label: "P13-safety-nachgezogen",
    phase: "Review",
    schema: SAFETY_SCHEMA,
    isolation: "worktree",
    model: "opus",
    effort: "xhigh",
  },
);

phase("Report");
let reportPath = "";
try {
  const written = await agent(
    `Schreibe das nachgezogene Safety-Urteil zu Phase P13 in die Datei "${REPO}/${REPORT_PATH}" (Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown, deutsch OHNE Umlaute): Kopf mit Datum, geprueftem Diff (${P13_BASE}..${P13_MERGE}) und dem Hinweis, dass die Phase bereits gemergt ist und dieses Urteil eine Nachweis-Luecke schliesst; dann Urteil (approved/verdict), die Einzelflags als Tabelle, die eigenstaendigen Belege des Reviewers, Blocker, Concerns, und die Aussage zu stillHoldsAtHead. Quelle:
=== SAFETY ===
${JSON.stringify(safety, null, 1)}
Antworte NUR mit dem geschriebenen Dateipfad.`,
    { label: "P13-safety-report", phase: "Report", model: "sonnet", effort: "low" },
  );
  reportPath = (written || "").toString().trim().slice(0, 300) || REPORT_PATH;
} catch {
  reportPath = "(Report fehlgeschlagen)";
}

return {
  phase: "P13 (nachgezogener Safety-Review)",
  reviewedDiff: `${P13_BASE}..${P13_MERGE}`,
  approved: !!(safety && safety.approved),
  stillHoldsAtHead: !!(safety && safety.stillHoldsAtHead),
  testsPassIndependently: !!(safety && safety.testsPassIndependently),
  blockers: (safety && safety.blockers) || [],
  concerns: ((safety && safety.concerns) || []).slice(0, 8),
  verdict: safety && safety.verdict ? safety.verdict.slice(0, 800) : "",
  reportPath,
};
