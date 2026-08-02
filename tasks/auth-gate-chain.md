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

## P2 — Live-Probe `scripts/probe-auth.sh` (fertig)

- **Erwartet:**
  1. Lauf gegen Live mit **Exit 0** (Ist-Aufnahme, Gate steht noch).
  2. Manipulierter Erwartungswert -> **Exit 1**.
  3. Falscher Commit -> **Exit 2**, ohne weitere Anfrage.
  4. Die Erwartungstabelle widerspricht `src/route-policy.js` nirgends.
- **Verifikation:** alle drei Exit-Faelle vorgefuehrt (nicht behauptet); `npm test`;
  drei Rot-vor-Fix-Laeufe gegen den Tabellen-Test.
- **Ergebnis:**
  - **Live-Lauf 2026-08-02**, `https://app.sundartha.com`, Commit `44a7d09`
    (= 16 Commits hinter dem lokalen `master`, **ohne** P1 — der Live-Stand kommt aus
    dem Upstream-Remote): **59 Routen, 0 Abweichungen, Exit 0. Kein Befund.**
    Belegt nebenbei, dass P1 kein Laufzeitverhalten geaendert hat: dieselbe Tabelle
    passt auf einen Deploy ohne `route-policy.js`.
  - Exit 1 vorgefuehrt: `/healthz`-Erwartung lokal von 200 auf 503 gedreht -> Zeile
    kippt von OK auf ABWEICHUNG, Zaehler 20 -> 21, Exit-Code 1. Zurueckgesetzt.
  - Exit 2 vorgefuehrt: falscher SHA (`ABBRUCH: Ziel-Pin verletzt`), fehlendes
    Argument, unbekannter Modus — je Exit 2, keine Messung.
  - `npm test`: gruen, 3763 Tests (Basis vor der Phase: 3758, +5 neue).
- **Dateien:** neu `scripts/probe-auth.sh`, `test/probe-auth-table.test.js`; geaendert
  `docs/RUNBOOK-AUTH-REVIEW.md` (Deploy-Schritt), `PLAN-SECURITY.md` (AUTH-P2).

### Entwurfsentscheidung, die ueber den Plantext hinausgeht

Der Plan verlangt "404 ist ein Fehlschlag" als W6-Detektor. **Solange das Gate steht,
ist dieser 404 nicht messbar**: das Gate haengt vor dem 404-Handler und beantwortet
jeden unbekannten Pfad mit 401 — eine fehlende Route sieht exakt aus wie eine
geschuetzte. Der Plan-Satz "die Probe ist der einzige Ort, an dem dieser Zustand
auffaellt" waere heute also unwahr gewesen.

Deshalb traegt jede Tabellenzeile zusaetzlich die **erwartete antwortende Schicht**
(`gate` / `webauth` / `mcpauth` / `keine`), geprueft ueber `WWW-Authenticate: Basic` —
den Fingerabdruck des Gates. Antwortet das Gate fuer eine Route, die der
Sitzungs-Cookie schuetzen soll, ist der Web-Login-Block nicht gemountet. Genau dieser
Durchfall ist lokal vorgefuehrt: gegen einen Server ohne pg-Backend melden alle 11
Web-Login-Routen `DURCHFALL ... W6`, obwohl sie mit 401 antworten. Ab P7 uebernimmt die
404-Regel; der Modus `nach-p7` verlangt dann, dass die Challenge ueberall fehlt.

Zweite Zugabe: `test/probe-auth-table.test.js`. Ohne ihn haetten Probe und
`route-policy.js` zwei Wahrheiten ueber dieselbe Route sagen koennen — die Probe waere
gruen ueber genau die Tuer gelaufen, die sie finden soll.

---

## P3 — Bootstrap-Fallback fail-closed (fertig, gemergt `8baf654`)

- **Erwartet:** eine fehlende Identitaet bindet nur noch den genuin lokalen
  In-Process-Aufrufer an den Bootstrap-Tenant; jeder andere identitaetslose Request
  bekommt `TENANT_REJECT` — **auch bei entferntem Gate**.
- **Verifikation:** `phase-impl-lean` (Plan/Safety auf Opus, Impl/Audit auf Sonnet),
  dualer Review, Mutationsprobe, `npm test` auf master.
- **Ergebnis:** Gate **PASS** ohne Fix-Runde. `npm test` gruen (3759 korrigiert).
  Eine benannte Quelle `operatorChannelTenant` an **beiden** Stellen; keine zweite
  Vertrauensquelle. Mutationsprobe: alter Fallback zurueckgedreht -> 11 von 16 neuen
  Tests rot, die 5 In-Process-Pins blieben gruen (genau die Trennung, die der Plan
  verlangt). Politik-Dateien (`route-policy.js`, `probe-auth.sh`, `auth-gate.js`)
  nachweislich unberuehrt.
- **Von aussen sichtbar heute: nichts.** Das Gate antwortet weiterhin zuerst. Die Phase
  zieht den Boden ein, auf dem P7 stehen wird.
- **Drei Befunde aus der Konsumenten-Enumeration, die offen bleiben:**
  1. `POST /mcp` lebt live nur deshalb weiter, weil `MCP_AUTH=oauth` laeuft (`req.auth`
     gesetzt, der geaenderte Zweig wird nicht betreten). Bei `MCP_AUTH=token/off` waere
     der Connector still tot. **Keine Boot-Sonde** deckt das ab.
  2. `GET /api/billing/checkout-return` liefert einem VOR dem Deploy geoeffneten
     Legacy-Checkout jetzt 403 statt Karten-Bindung. Kein Live-Regress (die aktive
     Kartenerfassung laeuft ueber den Self-Service-Pfad), aber der Grund, warum P9 die
     30 Tage Karenz hat.
  3. Zwei Tests in `test/security.test.js` bleiben gruen, messen aber weniger als ihr
     Name verspricht (sie pruefen nur `status===200`). Bewusst nicht angefasst
     (Scope-Grenze), in `PLAN-SECURITY.md` als Befund benannt.

---

## Owner-Entscheidung 2026-08-02 (bindend, fuer P7)

**Plan-Entscheidung 5 ist beantwortet: alle vorgeschlagenen Umleitungen kommen mit.**

| Pfad | Ziel |
| --- | --- |
| `/login`, `/signin`, `/sign-in` | 302 `/auth/login` |
| `/dashboard`, `/account`, `/portal`, `/admin` | 302 `/app` |

Pfade als benannte Konstanten in `src/portal-paths.js`, Mount VOR dem statischen
Serving (Muster `LEGACY_PORTAL_PATH`). Die drei `fehlt`-Zeilen der Probe (`/login`,
`/dashboard`, plus die vier neuen) werden im P7-Commit auf 302 gedreht (H10).

---

## Naechste Phase

**P4 — tote, aber scharfe Routen loeschen.** Vorbedingung (P3 gemergt) erfuellt.
Spec: `tasks/auth-gate-p4-spec.md`.

**Offener Owner-Entscheid (erst fuer P7):** Plan-Entscheidung 5 laesst `/signin`,
`/sign-in`, `/account`, `/portal`, `/admin` als zusaetzliche Redirect-Ziele
ausdruecklich offen.
