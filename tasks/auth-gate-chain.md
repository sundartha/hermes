# PLAN-AUTH-GATE — Kettenstand

Branch `phase/auth-gate`, Worktree `.claude/worktrees/auth-gate`, Basis `8461b69`
(lokaler `master`). **Nichts gemergt, nichts deployed** — der Owner merged.

Je Phase: erwartetes Ergebnis (pruefbar formuliert) + Verifikationsmethode +
beobachtetes Ergebnis. Eine Phase gilt erst als fertig, wenn die Verifikation in
dieser Session gelaufen ist.

---

## P0 — Re-Baseline (fertig)

- **Erwartet:** das Routen-Inventar aus Plan-Abschnitt 3 stimmt mit dem Code ueberein;
  keine als tot eingestufte Route hat einen Aufrufer.
- **Verifikation:** `grep` ueber `src/`, `scripts/`, `apps/web/src/`, `public/`.
- **Ergebnis:** Diff leer (19 "nur Gate"-Zeilen / 21 Endpunkte). Vier handwerkliche
  Befunde (F1-F4). Vollstaendiger Bericht: `tasks/auth-gate-phase0.md`.

## P1 — Routen-Inventar-Test (fertig)

- **Erwartet:**
  1. `npm test` ist gruen und enthaelt den neuen Test.
  2. Eine Route ohne Auth-Middleware und ohne Eintrag in `src/route-policy.js` macht
     den Test **rot** (nicht "faellt auf").
  3. Ein Graph ohne pg-Backend macht den Test **rot** (Positiv-Assertion), sonst
     prueft er den mageren Testgraph und ist wertlos (Befund B3).
- **Verifikation:** `npm test`; zusaetzlich zwei Rot-vor-Fix-Laeufe mit absichtlich
  kaputtem Zustand.
- **Ergebnis:**
  - `npm test`: gruen (3751 Tests, +7 neue).
  - Rot-vor-Fix 1 — `app.get("/probe-rot-vor-fix", ...)` in `src/app.js` eingefuegt:
    **2 Tests rot** (Klassifikation + Fingerprint). Zurueckgesetzt.
  - Rot-vor-Fix 2 — Graph auf `storeBackend: "json"` gedreht: **4 Tests rot**.
    Zurueckgesetzt. **Wichtige Beobachtung:** die Klassifikations-Assertion blieb
    dabei GRUEN — der magere Graph enthaelt die ungeschuetzten Routen ja auch, nur
    die Web-Login-Routen fehlen. Ohne die Positiv-Assertion waere der Test also
    tatsaechlich gruen und wertlos gewesen. B3 ist damit nicht nur uebernommen,
    sondern am eigenen Testaufbau nachgemessen.
  - Ein **Bestandstest** wurde rot und hat einen echten Fehler gefangen:
    `P14: kein Server-Ziel zeigt mehr auf das geloeschte Dashboard` pinnt, dass das
    Literal `"/tenant.html"` nur in `src/portal-paths.js` stehen darf. Der Test pinnt
    den SOLL-Zustand -> mein Code war falsch. Fix: `route-policy.js` importiert
    `LEGACY_PORTAL_PATH` und `APP_PATH` statt die Pfade zu wiederholen.
- **Dateien:** neu `src/route-policy.js`, `test/route-auth-inventory.test.js`,
  `docs/RUNBOOK-AUTH-REVIEW.md`; geaendert `src/app.js` (optionaler
  `createPortalRunner`-Dep), `PLAN-SECURITY.md` (Abschnitt AUTH-P1).

### Abweichung vom Plantext (Owner-Entscheidung noetig, blockiert P1 nicht)

Der Plan beschreibt **zwei** Klassen: "hat Auth-Middleware" oder "steht in der
Oeffentlich-Liste". Umgesetzt sind **drei**. Grund: heute haengen 21 Routen allein am
Basic-Auth-Gate. Sie sind nicht oeffentlich — sie sind geschuetzt, nur eben von der
Sicherung, die dieser Plan aufloest. Haette ich sie in `PUBLIC_ROUTES` geschrieben,
haette die Liste 21-mal etwas Falsches behauptet, und beim Wegfall des Gates in P7
haette der Test gruen gemeldet, was in Wahrheit eine offene Tuer ist.

Stattdessen: `GATE_ONLY_ROUTES`. Der Test laesst sie durch (sie SIND heute geschuetzt)
und haelt sie sichtbar. Nebeneffekt, der mir den Ausschlag gab: **die Liste ist die
Arbeitsliste von P4/P5/P6 und macht P7 mechanisch pruefbar** — das Gate darf erst
fallen, wenn sie leer ist. Wer sie leert, ohne die Route abzusichern, faellt in
`UNPROTECTED` und macht `npm test` rot.

---

## Naechste Phase

**P2 — Live-Probe `scripts/probe-auth.sh`.** Aendert kein Laufzeitverhalten.
Vorbedingung erfuellt (P1 fertig). Danach erst P3 (Bootstrap-Fallback fail-closed),
und die verlangt laut Plan, dass P1+P2 **gemergt** sind.

**Offener Owner-Entscheid (erst fuer P7):** Plan-Entscheidung 5 laesst `/signin`,
`/sign-in`, `/account`, `/portal`, `/admin` als zusaetzliche Redirect-Ziele
ausdruecklich offen.
