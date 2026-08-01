# Kickoff: PLAN-AUTH-GATE umsetzen

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er ist so
geschrieben, dass er ohne Kenntnis vorheriger Gespraeche funktioniert.

---

## Prompt

Du setzt `PLAN-AUTH-GATE.md` um. Lies zuerst diese Dateien vollstaendig, bevor du
irgendetwas tust:

1. `CLAUDE.md` — die Absoluten Regeln sind bindend, besonders 1 (SAFETY-GATES),
   3 (AUTH FAIL-CLOSED), 4 (SECRETS) und 6 (SCOPE)
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md` — Pflicht, nicht Empfehlung
3. `PLAN-AUTH-GATE.md` — der Plan selbst, inklusive Warnkasten ganz oben
4. `tasks/auth-gate-vs-assistant-leap.md` — Beruehrungspunkte mit der parallel
   umgesetzten Kette
5. `PLAN-SECURITY.md` — bei sicherheitsrelevanten Aenderungen fortzuschreiben

### Worum es geht

Das Basic-Auth-Gate (`src/wiring/auth-gate.js`) faellt. Ziel ist **ein einziger
Auth-Mechanismus** fuer menschliche Nutzer: die WorkOS/OIDC-Browser-Session.
Owner-Entscheidung, nicht verhandelbar.

Der Grund, warum das nicht in einem Schritt geht: Das Gate ist heute die
**einzige** Sicherung mehrerer Routen. Empirisch belegt — ohne das Gate liefert
`POST /api/calls` eine 200 und originiert einen **echten Anruf**, weil eine
fehlende Identitaet auf den Bootstrap-Tenant zurueckfaellt. Ein blosses Loeschen
haette Anruf-Origination und Gespraechs-Transkripte oeffentlich gemacht.

Deshalb: **Die Phasen-Reihenfolge im Plan ist bindend.** Messbarkeit (P1
Inventar-Test, P2 Live-Probe) steht vor dem Umbau, tote Routen fallen vor dem
Gate. Wer umsortiert, oeffnet ein Zeitfenster, in dem das System schwaecher ist
als heute.

### REGEL 0 — Worktree-Isolation (zuerst, nicht ueberspringen)

Am Repo arbeiten **parallel weitere Sessions**. Du darfst ihnen nicht in die
Quere kommen.

- Arbeite ausschliesslich in einem **eigenen git-Worktree auf einem eigenen
  Branch**. Nicht auf `master`, nicht im Haupt-Arbeitsbaum.
- Branch von `master` abzweigen und VORHER pruefen, dass du auf dem aktuellen
  Stand sitzt: `git fetch origin`, dann `git log --oneline -1 origin/master` und
  `git merge-base --is-ancestor origin/master HEAD`. Ein Worktree landet nicht
  zuverlaessig auf `master` — pruef es, verlass dich nicht darauf.
- **NIEMALS `git stash`.** `refs/stash` ist zwischen Worktrees geteilt; ein Stash
  hier reisst einer anderen Session die Arbeit weg.
- **NIEMALS `git add -A`.** Im Repo liegen untrackte Dateien mit Kundendaten.
  Fuege jede Datei einzeln und bewusst hinzu.
- **Kein Merge nach `master`, kein Push, kein Deploy.** Du lieferst Branches ab.
  Der Owner merged und deployed.
- Untrackte Dateien anderer Sessions nicht anfassen und nicht mitcommitten.

### REGEL 1 — Zeilennummern sind Fundstellen von gestern

Der Plan wurde gegen Commit `a727804` (2026-07-28) geschrieben. Seither sind ueber
140 Commits gelandet. Zwei Pruefungen am 2026-08-01 haben ergeben: **keine
inhaltliche Aussage des Plans ist veraltet** — aber viele Zeilennummern sind
verschoben, bei `claude.js`, `mcp-tools.js`, `telnyx-llm-shim.js`, `boot.js` und
`config.js` um bis zu ~220 Zeilen.

An der alten Zeile steht heute **plausibel aussehender, aber falscher Code**. Das
ist die gefaehrlichste Sorte Drift.

Deshalb: Codestellen **immer per `grep -n` auf den zitierten Funktionsnamen,
Variablennamen oder Kommentartext** suchen. Niemals blind einer Zeilennummer
folgen. Und erwarte weitere Drift waehrend deiner Arbeit.

### Phase 0 — Re-Baseline, bevor du irgendetwas aenderst

Der Plan ist gepruefte Vorarbeit, kein Freibrief. Erhebe zuerst selbst:

1. Zaehle die Routen auf, die heute hinter dem Gate liegen, und diffe gegen die
   Routentabelle in Abschnitt 3 des Plans. Jede Abweichung ist ein Befund.
2. Pruefe die tragenden Behauptungen am Code nach: Bootstrap-Fallback in
   `src/routes/_tenant.js`, Mount-Reihenfolge in `src/app.js`, Inhalt von
   `config.server.publicDir`, Nutzer von `DASHBOARD_PASSWORD`.
3. Pruefe, ob eine der im Plan als tot eingestuften Routen inzwischen einen
   Aufrufer bekommen hat. Eine faelschlich geloeschte Route ist ein Prod-Ausfall.

Melde das Ergebnis, **bevor** du mit P1 beginnst. Weicht der Ist-Zustand
wesentlich vom Plan ab, halt an und frag — arbeite nicht nach einem Plan, dessen
Grundlage sich verschoben hat.

### Arbeitsregeln je Phase

- **Eine Phase, ein Commit.** Das ist keine Kosmetik: P7 muss genau ein Commit
  sein, damit ein Rollback nicht zwischen zwei Zustaenden landen kann.
- Nach jeder Aenderung: `node --check <datei>` fuer jede geaenderte `.js`, dann
  `npm test`. **`npm test` muss gruen sein.** `npm run test:gates` darf rot sein
  (offene Produktbefunde), `npm test` nicht.
- Wird ein Bestandstest rot: pruef ZUERST, ob er den SOLL-Zustand pinnt (dann ist
  dein Code falsch) oder das alte Verhalten (dann passt du ihn an und begruendest
  es im Commit). Bekannter Flake: `p5-gate-proof` unter Volllast — rot zaehlt nur,
  wenn der Test **isoliert** ebenfalls rot ist.
- **Testnamen:** NIEMALS mit einem Katalog-Praefix beginnen (`GAP-`, `WEB-`,
  `PAY-`, `DID-`, `FMT-`, `OUT-`, `E2E-`, `PROMPT-`). Solche Tests wandern still
  in den `test:gates`-Lauf, wo Rot erlaubt ist — dein Regressionsschutz meldet
  dann nie.
- Neue Env-Variable: in `src/config.js` zentralisieren, in `.env.example`
  dokumentieren, `render.yaml` pruefen **und** in `BASE_ENV` in
  `test/helpers.js` nachziehen — sonst leckt die lokale `.env` in Spawn-Tests.
- Neue DB-Spalte: es gibt **keine** automatische Migration. `applySchema` laeuft
  nur in Tests. Eine Schema-Aenderung muss der Owner vor dem Deploy von Hand per
  `psql` einspielen — sag es ihm ausdruecklich.
- Nach Spawn-Tests: keine verwaisten `node src/server.js`-Kinder zuruecklassen.
- Sicherheitsrelevante Aenderung: `PLAN-SECURITY.md` fortschreiben.

### Abnahme

Jede Phase, die live gehen soll, wird durch die Live-Probe aus P2 abgenommen —
nicht durch "sieht gut aus". Die Probe prueft `Pfad -> erwartete Antwort` gegen die
laufende Instanz und bricht mit Fehlercode ab, wenn eine Erwartung verletzt ist.

### Wenn du unsicher bist

Frag. Eine Annahme ist hier immer schlechter als eine Rueckfrage — es geht um
Routen, die echte Anrufe ausloesen und Gespraechs-Transkripte herausgeben.
