// PER-RUN-Skript AUTH-P7 (Kopie von auth-p6.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AUTH-P7: das Basic-Auth-Gate entfernen - das eigentliche Delta, GENAU EIN Commit.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, GENAU EIN Commit, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/auth-gate-p7-report.md" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN HART GEPINNT (Lead): keine args-Abhaengigkeit, kein Misfire moeglich.
const PHASE = "AUTH-P7";
const PHASE_TITLE = "Das Gate entfernen";
const BRANCH = "phase/auth-p7-gate-entfernen";
const BASE = "master";
const PLAN_DOC = "PLAN-AUTH-GATE.md";
const SPEC_FILE = "tasks/auth-gate-p7-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/auth-gate-p7-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Memory [[workflow-model-policy]]): Plan und Safety auf opus,
// Impl/Audit/Fix/Report auf sonnet. Diese Phase entfernt eine Sicherung - der
// Safety-Reviewer laeuft auf der hoechsten Stufe.
const PLAN_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const IMPL_AGENT = { model: MODEL_SONNET, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "max" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2); keine Magic Numbers/Strings ausser 0/1/-1 (G25 - die sieben Umleitungs-Pfade sind benannte Konstanten in src/portal-paths.js, keine Stringliterale in app.js); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N1/N2); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript. Kommentare deutsch OHNE Umlaute (ue/oe/ae).
BESONDERS HIER: eine ENTFERNUNGS-Phase hinterlaesst Luegen. Jeder Kommentar, der "hinter Basic-Auth" behauptet, ist danach falsch (C2) - und zwar in mehreren Modulen. Jeder ungenutzte Import, jede tote Testhilfe, jede Env-Erwaehnung im Text muss mit. Ein Kommentar, der eine nicht mehr existierende Sicherung verspricht, ist gefaehrlicher als gar keiner.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN/Abo+KYC-Outbound-Permit) NIE entfernen/aufweichen/per-Default umgehen. Das Basic-Auth-Gate ist NICHT eines davon - sein Wegfall ist der ausdrueckliche Auftrag dieser Phase, jede andere Sicherung bleibt.
- AUTH FAIL-CLOSED bleibt die Regel: nach dieser Phase traegt JEDE Route ihre eigene Sicherung oder steht mit Begruendung in PUBLIC_ROUTES. Es darf KEINE Route geben, die nur deshalb erreichbar war, weil das Gate sie deckte.
- SECRETS (Regel 4): Audit-Eintraege tragen NIEMALS einen Query-String. Der Audit-Pfad aus AUTH-P5 bleibt unveraendert.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet und unveraendert.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const P7_SCOPE = `SCOPE DIESER PHASE (bindend, Spec ist die Autoritaet):
- LOESCHEN: src/wiring/auth-gate.js, test/auth-gate-exemption-order.test.js (durch den P1-Inventar-Test ersetzt), scripts/sweep-jetzt.sh ERSATZLOS (Plan-Entscheidung 3).
- AENDERN: src/app.js (installAuthGate: Funktion, Import, Aufruf verschwinden); alle Testdateien, die das Gate voraussetzen; README.md; CLAUDE.md (Absolute Regel 3 in der Neufassung aus Plan-Abschnitt 9 UND die public/-Beschreibung); alle Modulkommentare, die "hinter Basic-Auth" behaupten. Der Plan zaehlt 18 Testdateien - PRUEFE DIE ZAHL SELBST (grep nach DASHBOARD_PASSWORD, "Authorization: Basic", WWW-Authenticate, auth_failed unter test/), glaube sie nicht.
- DASHBOARD_PASSWORD BLEIBT in src/config.js, render.yaml und .env.example stehen - ungenutzt, aber gesetzt. Das ist KEIN Versehen: ein Rollback auf einen Commit vor P7 findet damit ein scharfes Gate vor. Entfernt wird die Variable erst in P8, fruehestens 14 Tage nach dem Live-Deploy. Wer sie hier entfernt, hat die Phase verfehlt.
- NEU: die sieben Umleitungen (Owner-Entscheidung 2026-08-02): /login, /signin, /sign-in -> 302 /auth/login; /dashboard, /account, /portal, /admin -> 302 /app. Mount VOR dem statischen Serving, Muster wie LEGACY_PORTAL_PATH; Pfade als benannte Konstanten in src/portal-paths.js. Die ZIELE existieren dort bereits als Konstanten - wiederverwenden.
- DIE LISTE MUSS LEER WERDEN: GATE_ONLY_ROUTES enthaelt heute noch das Legacy-Checkout-Paar (POST /api/billing/setup-checkout, GET /api/billing/checkout-return). Diese beiden bekommen in DIESER Phase internalOnly (dieselbe Middleware wie die sieben aus P5, KEIN neuer Mechanismus) und fallen damit in die Klasse AUTH. Danach ist GATE_ONLY_ROUTES leer - als Assertion im Test. Begruendung: seit AUTH-P3 liefert requireTenant fuer jeden nicht-lokalen Aufrufer ohnehin 403; internalOnly macht denselben Zustand nur sichtbar und maschinell pruefbar. GELOESCHT werden die beiden weiterhin erst in P9.
- scripts/probe-auth.sh: (a) Vorgabe-Modus wechselt von ist-aufnahme auf nach-p7; (b) die Spalte ANTWORTET bekommt den Wert "internal" fuer internalOnly-Routen, der Wert "gate" verschwindet VOLLSTAENDIG aus der Tabelle; (c) die neun internalOnly-Routen: 401 -> 403, gate -> internal; (d) die sechs P6-Routen: gate -> webauth (Status bleibt 401); (e) die fehlt-Zeilen (die sechs in P4 geloeschten plus /diese-route-gibt-es-nicht-12345): 401 -> 404, gate -> keine; (f) /login und /dashboard sind keine fehlt-Zeilen mehr, sondern oeffentlich|302|keine, die fuenf weiteren Umleitungen kommen dazu; (g) test/probe-auth-table.test.js zieht die ANTWORTET-Werte-Liste nach. JEDE dieser Zeilen ist eine VORHERSAGE aus dem Code - sie wird nach dem Deploy mit dem Live-Lauf geprueft, nicht nachtraeglich an das Ergebnis angepasst.
- src/route-policy.js: die sieben Umleitungen kommen als PUBLIC_ROUTES-Eintraege mit Begruendung dazu; GATE_ONLY_ROUTES wird leer, der Block-Kommentar wird auf den neuen Stand gebracht (die Liste BLEIBT als Mechanismus stehen). ROUTE_FINGERPRINT waechst um die sieben Umleitungen.
- NICHT ANFASSEN: die Fachlogik irgendeiner Route; src/wiring/internal-only.js (nur Nutzung, keine Aenderung); src/wiring/operator-routes.js aus P6; die Cache-Header (P9a); das Loeschen des Legacy-Paars (P9b).
- TEST-IDs: "AUTH-P7-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).
- DIESE PHASE IST GENAU EIN COMMIT. Sie darf nicht in Teil-Commits zerfallen - ein Rollback muss den Gate-Wegfall als Ganzes zuruecknehmen koennen.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien einzeln adden, geloeschte mit "git rm".`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase (verbindlich vor dem Plan-Doc).`;

// Token-Disziplin: PLAN-AUTH-GATE.md ist 65 KB. Gezielt lesen, nicht am Stueck.
const planDocInstruction = `Lies aus "${REPO}/${PLAN_DOC}" GEZIELT (die Datei ist gross - nicht am Stueck lesen): Abschnitt 5 (stille Fehler - der ganze Abschnitt, er beschreibt genau die Fehler dieser Phase), Abschnitt 7 den Unterabschnitt "### P7", Abschnitt 9 (Absolute Regel 3 - Neufassung, die woertlich nach CLAUDE.md gehoert) und Abschnitt 10 (Owner-Entscheidungen). Nutze grep -n auf die Ueberschriften. Lies ausserdem "${REPO}/tasks/auth-gate-chain.md" VOLLSTAENDIG (Kettenstand P1-P6 - dort steht, was die Vorphasen gebaut haben und worauf du dich verlassen kannst).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
DIES IST DIE GEFAEHRLICHSTE PHASE DER KETTE: sie entfernt die Sammelsicherung, die heute noch vor allem liegt. Alles, was vorher schiefgehen kann, geht nach diesem Deploy still schief.
1. ${specInstruction}
2. ${planDocInstruction} Lies ausserdem "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/app.js VOLLSTAENDIG (die gesamte Mount-Sequenz - du musst wissen, was nach dem Wegfall in welcher Reihenfolge greift), src/wiring/auth-gate.js (was genau wegfaellt, inkl. jeder Exemption - jede davon war ein Grund), src/portal-paths.js (die vorhandenen Konstanten), src/route-policy.js, scripts/probe-auth.sh (die GANZE Tabelle - du schreibst sie um), test/probe-auth-table.test.js, test/route-auth-inventory.test.js, src/wiring/internal-only.js, src/wiring/operator-routes.js, src/middleware.js (securityHeaders, Rate-Limiter). Grep nach Symbolen - KEINE Zeilennummern uebernehmen.
4. ZAEHLE SELBST: welche Dateien unter test/ setzen das Gate voraus? grep nach DASHBOARD_PASSWORD, "Authorization: Basic", WWW-Authenticate, auth_failed, assertGateAbsent. Liefere die Liste MIT je einem Satz, was dort zu tun ist. Der Plan behauptet 18 - sag, was du wirklich findest.
5. GEHE JEDE EXEMPTION DES GATES DURCH (voice, mcp, .well-known, Stripe-Webhook, healthz, Brand-Assets, favicon, isTrustedLocalCaller, safeEqual): war sie NUR eine Ausnahme vom Gate, oder haengt anderes daran? Eine Exemption, deren Wegfall etwas anderes mitreisst, ist der Fehler, den diese Phase machen kann. Nenne je Exemption das Urteil.
6. Entwirf die sieben Umleitungen: exakter Ort im Mount-Baum (VOR dem statischen Serving), Konstanten-Namen in src/portal-paths.js, und warum sie keine Route beschatten (Shadowing-Pruefung gegen die vorhandenen Mounts - besonders /admin gegen /api/admin/*).
7. Entwirf die NEUE Erwartungstabelle der Probe VOLLSTAENDIG, Zeile fuer Zeile, jede Zeile als Vorhersage aus dem Code abgeleitet (welche Schicht antwortet danach mit welchem Status). Das ist der Kern der Abnahme.
8. Entwirf die Tests AUTH-P7-*: /api/state ohne Sitzung -> 403 (nicht 401, nicht 200); unbekannter Pfad -> 404; /login -> 302 /auth/login; /dashboard -> 302 /app; KEINE Antwort traegt WWW-Authenticate; GATE_ONLY_ROUTES ist leer.
9. Nenne ausdruecklich, welche Bestandstests kippen und wie du mit jedem einzelnen umgehst.
${P7_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die Exemption-Analyse mit Urteil je Eintrag; (2) die exakten Edits je Datei; (3) die vollstaendige neue Probe-Tabelle; (4) die Umleitungen mit Shadowing-Pruefung; (5) die Tests AUTH-P7-* mit konkreten Assertions; (6) die Liste kippender Bestandstests mit Umgang; (7) die Neufassung von Absoluter Regel 3 fuer CLAUDE.md. Kleiner Blast-Radius, aber vollstaendig. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    exactlyOneCommit: { type: "boolean", description: "git log BASE..HEAD --oneline zeigt GENAU einen Commit" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    filesDeleted: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    exemptionAnalysis: {
      type: "array",
      items: { type: "string" },
      description:
        "Je Gate-Exemption eine Zeile: was sie war - haengt noch etwas daran? - was nach dem Wegfall greift",
    },
    gateOnlyEmpty: { type: "boolean", description: "GATE_ONLY_ROUTES ist leer - per Test-Assertion belegt" },
    dashboardPasswordKept: {
      type: "boolean",
      description: "DASHBOARD_PASSWORD steht weiterhin in config.js, render.yaml und .env.example",
    },
    grepWwwAuthenticateEmpty: {
      type: "boolean",
      description: 'grep -rn "WWW-Authenticate" src/ ist leer',
    },
    newProbeTable: {
      type: "string",
      description: "Die neue Erwartungstabelle als Text, so wie sie jetzt im Skript steht",
    },
    redirectsProven: {
      type: "string",
      description: "Die sieben Umleitungen mit ihrem Test und der Shadowing-Pruefung (besonders /admin)",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates (Baseline 3)" },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung",
    },
    mutationProbeResult: {
      type: "string",
      description:
        "Mutationsproben: (a) internalOnly von einer Route entfernt -> welcher Test rot? (b) eine Umleitung entfernt -> welcher Test rot?",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "exactlyOneCommit",
    "exemptionAnalysis",
    "gateOnlyEmpty",
    "dashboardPasswordKept",
    "grepWwwAuthenticateEmpty",
    "newProbeTable",
    "redirectsProven",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "existingTestsAdjusted",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Alles in EINEM Arbeitsgang, dann EIN Commit: "feat(auth-p7): Basic-Auth-Gate entfernen - jede Route traegt ihre eigene Sicherung". node --check je geaenderter Datei, npm test gruen VOR dem Commit.
${P7_SCOPE}
${CLEAN_CODE_REQ}
4. npm test gruen. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden. Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
5. npm run test:gates - Zahl in gatesRedCount (Baseline 3).
6. Mutationsproben: (a) internalOnly von einer der neun Routen entfernen -> der zugehoerige 403-Test UND der P1-Inventar-Test muessen rot werden; (b) eine der sieben Umleitungen entfernen -> genau ihr Test wird rot. Beide ZURUECKNEHMEN, npm test erneut gruen. Der finale Diff darf keine Mutation tragen.
7. BELEGE per grep: grep -rn "WWW-Authenticate" src/ ist leer; grep -rn "makeAuthGate\\|installAuthGate" src/ test/ ist leer; DASHBOARD_PASSWORD steht weiterhin in src/config.js, render.yaml, .env.example.
8. exactlyOneCommit per git log ${BASE}..HEAD --oneline belegen (GENAU eine Zeile).
9. node_modules-Symlink NICHT committen. Nach dem Lauf pruefen: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen. newProbeTable woertlich liefern - der Lead prueft sie gegen den Live-Lauf.`,
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
    everyRouteHasItsOwnGuard: {
      type: "boolean",
      description:
        "DER KERNPUNKT: keine Route ist nach dem Wegfall nur deshalb erreichbar, weil das Gate sie deckte. Selbst am Routengraph durchgegangen.",
    },
    unguardedRoutesFound: {
      type: "array",
      items: { type: "string" },
      description: "Routen, die nach dem Wegfall ohne Sicherung dastehen (leer = gut)",
    },
    exemptionsAccountedFor: {
      type: "boolean",
      description:
        "Jede der acht Gate-Exemptions ist einzeln beurteilt; keine hat etwas anderes mitgerissen",
    },
    gateOnlyEmpty: { type: "boolean" },
    dashboardPasswordKept: {
      type: "boolean",
      description: "DASHBOARD_PASSWORD steht noch in config.js, render.yaml, .env.example (Rollback-Sicherheit)",
    },
    noWwwAuthenticateLeft: { type: "boolean" },
    probeTablePredictsCode: {
      type: "boolean",
      description:
        "Die neue Probe-Tabelle ist aus dem Code abgeleitet und stimmt mit ihm ueberein - Zeile fuer Zeile selbst nachgerechnet, mindestens fuer alle sitzung- und fehlt-Zeilen",
    },
    redirectsDoNotShadow: {
      type: "boolean",
      description: "Keine der sieben Umleitungen beschattet eine bestehende Route (besonders /admin vs /api/admin/*)",
    },
    exactlyOneCommit: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    auditPathIntact: {
      type: "boolean",
      description: "Der Audit-Pfad aus P5 schreibt weiterhin auth_failed und leakt keinen Query-String",
    },
    existingAssertionsNotWeakened: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "everyRouteHasItsOwnGuard",
    "unguardedRoutesFound",
    "exemptionsAccountedFor",
    "gateOnlyEmpty",
    "dashboardPasswordKept",
    "noWwwAuthenticateLeft",
    "probeTablePredictsCode",
    "redirectsDoNotShadow",
    "exactlyOneCommit",
    "safetyGatesIntact",
    "disclosureIntact",
    "auditPathIntact",
    "existingAssertionsNotWeakened",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}".
DIESE PHASE ENTFERNT DIE SAMMELSICHERUNG EINES OEFFENTLICH ERREICHBAREN DIENSTES, der echte Anrufe fuehrt und Gespraechs-Transkripte speichert. Wenn du hier etwas uebersiehst, steht es nach dem Deploy fuer das ganze Internet offen. Deine Aufgabe ist NICHT, den Diff zu wuerdigen - sie ist, die eine Route zu finden, die niemand mehr schuetzt.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE}...${target} (DREI Punkte, gegen die Merge-Basis - sonst siehst du fremde Arbeit als Loeschung).
${P7_SCOPE}
PRUEFE BESONDERS, jeweils selbst am Code nachgerechnet:
- everyRouteHasItsOwnGuard + unguardedRoutesFound: DAS IST DIE PHASE. Bau den PRODUKTIONS-Routengraph (Muster: test/route-auth-inventory.test.js baut ihn offline mit pg-Schalter und Fake-Runner) und geh JEDE Route einzeln durch: welche Sicherung traegt sie jetzt? Eine Route, die weder eine benannte Auth-Middleware traegt noch mit tragfaehiger Begruendung in PUBLIC_ROUTES steht, ist ein BLOCKER. Verlass dich NICHT darauf, dass der Inventar-Test gruen ist - er prueft route-level Middleware, nicht ob die Begruendung in PUBLIC_ROUTES stimmt. LIES JEDE PUBLIC_ROUTES-BEGRUENDUNG und frag: ist das nach dem Gate-Wegfall noch wahr?
- exemptionsAccountedFor: das Gate hatte acht Ausnahmen (voice, mcp, .well-known, Stripe-Webhook, healthz, Brand-Assets, favicon, isTrustedLocalCaller). Jede war ein Grund. Ist jede einzeln beurteilt? Hat der Wegfall einer Ausnahme etwas mitgerissen (z.B. eine Route, die NUR ueber die Ausnahme erreichbar war)?
- probeTablePredictsCode: die neue Erwartungstabelle ist eine VORHERSAGE, die nach dem Deploy gegen die Live-Instanz geprueft wird. Rechne mindestens jede sitzung- und jede fehlt-Zeile selbst nach: welche Schicht antwortet, mit welchem Status? Eine falsche Zeile heisst nach dem Deploy entweder falscher Alarm oder uebersehene offene Tuer. Eine Tabelle, die nicht zum Code passt, ist ein BLOCKER.
- redirectsDoNotShadow: /admin ist ein Praefix von nichts, ABER pruefe die Mount-Reihenfolge gegen /api/admin/* und gegen das statische Serving. Beschattet eine Umleitung eine bestehende Route oder eine statische Datei, ist das ein BLOCKER.
- dashboardPasswordKept: die Variable MUSS noch in config.js, render.yaml und .env.example stehen. Wurde sie entfernt, ist der Rollback-Weg zerstoert - BLOCKER.
- exactlyOneCommit: git log ${BASE}..${target} --oneline. Mehr als eine Zeile ist ein BLOCKER (der Rollback muss den Wegfall als Ganzes zuruecknehmen).
- auditPathIntact: schreibt der Audit-Pfad aus P5 weiterhin auth_failed? Der Gate-Audit faellt weg - wenn dabei auch der neue Pfad beschaedigt wurde, verschwindet der Meldeweg fuer abgewiesene Zugriffe.
- existingAssertionsNotWeakened: git diff auf test/ SEHR genau lesen. Diese Phase aendert viele Tests. Ein Test, der frueher 401 erwartete und jetzt "irgendwas ausser 200" akzeptiert, ist eine abgeschwaechte Zusage - BLOCKER.
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Ein falsches PASS hier ist teurer als eine Fix-Runde.`,
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
2. git diff ${BASE}...${target} (DREI Punkte, gegen die Merge-Basis); neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf die typischen Reste einer ENTFERNUNGS-Phase: (a) Kommentare, die weiterhin "hinter Basic-Auth" oder "Gate-exempt" behaupten - das sind LUEGEN ueber eine Sicherung und zaehlen hier als S1-Korrektheitsfehler, nicht als Stil (C2); greppe selbst nach "Basic-Auth", "Basic Auth", "Gate", "exempt" ueber src/ und test/; (b) ungenutzte Importe und tote Testhelfer (G12/F4/G9); (c) die sieben Umleitungspfade: benannte Konstanten in src/portal-paths.js, nicht sieben Stringliterale in app.js (G25), und die Registrierung nicht siebenmal kopiert (G5/S2); (d) die neue Probe-Tabelle: bleibt sie maschinenlesbar und konsistent formatiert (G24)? (e) die neuen Tests: ein Konzept pro Test (P14), kein geteilter veraenderlicher Zustand (P12/I).
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
3. Behebe DIESE Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${P7_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(auth-p7): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
HINWEIS zur Ein-Commit-Regel: der Lead quetscht die Fix-Commits beim Merge zusammen - du sollst NICHT rebasen oder die Historie umschreiben.
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
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Prozessbericht ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
EHRLICHKEITSREGEL, hier besonders wichtig: diese Phase ist erst dann abgenommen, wenn die LIVE-PROBE nach dem Deploy gruen ist - und der Deploy ist eine Owner-Handlung, die in dieser Session NICHT stattgefunden hat. Der Bericht darf also NICHT sagen "das Gate ist gefallen", sondern "der Commit, der das Gate entfernt, liegt vor und ist im Test belegt; live steht es noch". Schreib den Deploy-Ablauf als nummerierte Handlungsanweisung: (1) deployen, (2) scripts/probe-auth.sh <url> <neuer-sha> nach-p7 fahren, (3) bei Exit != 0 sofort Rollback (Deploy des Vorgaenger-Commits; das alte Gate findet DASHBOARD_PASSWORD noch vor und ist sofort wieder scharf). Nenne das Abbruchsignal woertlich: 200 auf /api/state ohne Sitzung = Datenleck-Fall.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Commit-Hash; die Exemption-Analyse als Tabelle; was geloescht wurde; die sieben Umleitungen; die NEUE Probe-Tabelle woertlich (sie ist die Vorhersage, gegen die live gemessen wird); die Tests mit Assertions; die Mutationsproben; angepasste Bestandstests mit Begruendung; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; der Deploy-Ablauf; ein Abschnitt "Was diese Phase NICHT belegt". Quelle:
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

return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (impl && impl.headCommit) || null,
  exactlyOneCommit: impl ? impl.exactlyOneCommit === true : false,
  testPassCount: (impl && impl.testPassCount) || null,
  gatesRedCount: (impl && impl.gatesRedCount) ?? null,
  exemptionAnalysis: (impl && impl.exemptionAnalysis) || [],
  gateOnlyEmpty: impl ? impl.gateOnlyEmpty === true : false,
  dashboardPasswordKept: impl ? impl.dashboardPasswordKept === true : false,
  grepWwwAuthenticateEmpty: impl ? impl.grepWwwAuthenticateEmpty === true : false,
  newProbeTable: (impl && impl.newProbeTable) || "",
  redirectsProven: (impl && impl.redirectsProven) || "",
  unguardedRoutesFound: (safety && safety.unguardedRoutesFound) || [],
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
    ...((impl && impl.filesDeleted) || []),
  ].slice(0, 50),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
