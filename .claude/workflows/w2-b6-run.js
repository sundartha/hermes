// PER-RUN-WRAPPER fuer Welle W2, Block B6 (Web, Dashboard, Widget-Oberflaechen).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// 21 Tests - groesster Block der Welle:
//   WEB-03/07/08/10/13/18/19/25 + UI-01..07/13/15/19 + FMT-15 + GAP-30/37.
//
// VIER Praemissen sind durch die Fix-Kette ueberholt (Baseline 19-w2-baseline.md) - NICHT
// blind gegen den Katalogtext bauen:
//   - UI-03/UI-04/UI-19: der navigator.language-Strang ist tot. Seit P13/E4 rendert der
//     Server die Agentensprache ins Widget-HTML (resolveWidgetLocale + buildI18nScript).
//     UI-03 verliert seine Praemisse ganz, UI-04 behaelt den Mechanismus bei neuer Quelle,
//     die von UI-19 beschriebene Divergenz existiert nicht mehr.
//   - FMT-15: P15b hat tenant.html auf eine Server-Locale umgestellt. Der Test darf nur
//     noch den FALLBACK-Zweig pinnen (STATIC_FORMAT_LOCALE vor dem ersten /state, also
//     401/403 und gefuehrte Aktivierung), nicht mehr die Seite insgesamt.
//   - WEB-10: apps/web/src hat weder eine api/onboard-Route noch einen PUBLIC_URL-Treffer.
//     Die ID beschreibt den Stand vor dem Single-Origin-Umbau -> entscheiden, nicht bauen.
//   - GAP-37: buildFilter existiert im Repo NICHT (0 Treffer ausserhalb node_modules).
//     Braucht ein neues Subjekt oder faellt weg -> entscheiden, Ergebnis in den Blockreport.
//
// Ausserdem getragenes Risiko (Owner-Entscheidung 7.14): die Kalender-Achse ist gestrichen.
// public/calendar.html und public/calls.html bleiben dauerhaft deutsch - KEIN Test dagegen.

export const meta = {
  name: "w2-b6-run",
  description: "W2-B6: Web, Dashboard, Widget-Oberflaechen (21 Katalogtests)",
  phases: [{ title: "W2-B6" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B6",
    phaseTitle: "Web, Dashboard, Widget-Oberflaechen",
    branch: "phase/w2-b6-web-dashboard-ui",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
