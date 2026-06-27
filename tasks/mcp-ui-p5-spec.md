# P5 — Token-Pull-Disziplin + Restschuld (Einzel-Spec)

Autoritative Scope-/Invarianten-Spec fuer Phase **P5** der MCP-Rich-UI-Kette. Verbindlich vor dem
Umbrella-Doc. Umbrella: `docs/mcp-ui-strategy.md` (Abschnitt 4 Token-Strategie + Pre-Mortem #4),
Ketten-Doc: `tasks/mcp-ui-chain.md` §P5. Baseline `master`.

## Ziel (ein Satz)

Ein **Token-Sync-Gate** verankern, das Drift zwischen der Token-QUELLE
`apps/web/src/styles/tokens/` (`primitives.css`, `semantic.css`, `hero.css`, ggf. `index.css`) und
der kanonischen, self-contained Kopie `design-system/_shared/tokens.css` automatisch und
**fail-closed** erkennt — plus das self-contained-Gate (`@import`-Verbot) und den `@dsCard`-Index
maschinell pruefbar macht.

## Warum (Grounding)

`design-system/_shared/tokens.css` ist laut Strategie-Doc Abschnitt 4 die kanonische Kopie der
Quell-Tokens; Drift wird heute nur durch manuelle Disziplin verhindert (Pre-Mortem #4: "Widgets
sehen anders aus als das Web-UI / DesignSync 404"). Es gibt **keinen** automatischen Check. P5
schliesst diese Luecke. Q6 (Token-Pull-Gate) ist vom Owner ENTSCHIEDEN — P5 setzt es nur um, es
wird NICHTS neu entschieden.

## Deliverables (genau diese, NICHTS darueber hinaus — Regel 6)

1. **Sync-Beziehung empirisch ableiten (zuerst):** Lies die Quell-Dateien UND `_shared/tokens.css`
   und leite ab, wie die Kopie aus der Quelle entsteht (Konkatenations-Reihenfolge; Light=`:root`,
   Dark/Hero=`.on-dark`-Scope; etwaige Transformationen). NICHT raten. Ist die Beziehung **nicht
   deterministisch 1:1 reproduzierbar** (manuelle Anpassungen in der Kopie), waehle einen
   **Hash-/Manifest-Ansatz**: erwartete Quell-Inhalts-Hashes neben der Kopie festschreiben (z.B.
   `design-system/_shared/tokens.lock` oder Header-Kommentar in `tokens.css`), Check vergleicht
   Ist-Hash gegen Soll. Waehle den **einfachsten Ansatz, der Drift zuverlaessig faengt**, und
   begruende die Wahl im Report.

2. **Fail-closed Sync-Check** als ESM-Node-Script `scripts/check-token-sync.js` (KEIN neuer
   npm-Dep, kein Build-Step). Exit `0` = synchron; Exit `!=0` mit klarer Meldung, **welche** Datei
   driftet. Fail-closed: fehlende Datei / Parse-Fehler / unlesbar -> Exit `!=0`. Plus npm-Script
   `"check:tokens": "node scripts/check-token-sync.js"` in `package.json`.

3. **`@import`-Verbot + `@dsCard`-Marker-Check** (im selben Script oder als Teil davon): verifiziere
   dass die ausgelieferten Design-System-Token-/Widget-Dateien (`design-system/_shared/tokens.css`,
   `design-system/mcp/*.html`, `src/ui/widgets/*.html`) **KEIN** `@import` enthalten (Iframe-
   Sandbox-Gate) und dass jede `design-system/mcp/*.html` ihren `@dsCard`-Marker in Zeile 1 behaelt.

4. **Automatisierter Test** in `test/*.test.js` (`node:test`, ohne Netz/ohne .env): fuehrt den
   Sync-Check aus (gruen wenn synchron) UND **beweist Drift-Erkennung** ueber eine Fixture bzw.
   temporaere Kopie in einem Temp-Verzeichnis (`DATA_DIR`-Muster) — die **echten Repo-Dateien
   NIEMALS zerstoerend anfassen**. Mindestens: (a) synchron -> Pass; (b) kuenstlich verfaelschte
   Token-Kopie -> Check meldet Drift (Exit !=0); (c) `@import` injiziert -> Check schlaegt an;
   (d) fehlende Datei -> fail-closed.

5. **Doku-Restschuld:** `STATUS.md` nachziehen (Token-Gate existiert jetzt); in
   `tasks/mcp-ui-chain.md` §P5 und `docs/mcp-ui-strategy.md` (Q6) als **umgesetzt** markieren. Die
   bereits gepinnten Owner-Entscheidungen Q1/Q5/Q6 NICHT neu entscheiden — nur Status setzen.

## Harte Constraints / Abgrenzung

- KEIN neuer npm-Dependency. KEIN Build-Step. ESM. Deutsche Kommentare OHNE Umlaute (ue/oe/ae).
- Der Check ist **fail-closed** (im Zweifel Exit !=0).
- **NICHT beruehren:** `src/` Laufzeit-Code (Telefonie/Auth/MCP-Tools/Billing/UI-Seam), Safety-
  Gates, Call-Pfad, Disclosure. P5 ist reine Build-/Check-/Doku-Disziplin — kein Laufzeit-Verhalten
  aendert sich, die Bestandssuite bleibt OHNE Aenderung gruen (nur additive neue Tests).
- Falls die Token-Quelle und die Kopie **aktuell bereits driften** (Ist-Zustand inkonsistent):
  NICHT die Quelle/Kopie "anpassen", sondern den Check so verankern, dass er den Ist-Zustand als
  Soll festschreibt (Manifest aus dem aktuellen Stand erzeugen) und kuenftige Drift faengt. Den
  vorgefundenen Zustand im Report dokumentieren.

## Definition of Done

- `scripts/check-token-sync.js` existiert, ist fail-closed, `npm run check:tokens` -> Exit 0 gruen.
- Neuer Test gruen; Drift-Erkennung bewiesen (Fixture). Bestandssuite unveraendert gruen
  (Baseline aktuell 1108 Tests, fail 0 -> danach 1108 + neue, fail 0).
- `node --check` auf jeder neuen/geaenderten `.js`-Datei.
- Doku (STATUS.md / chain / strategy) nachgezogen.
- Dualer Review PASS (Safety APPROVED + Clean-Code keine S1/S2).
