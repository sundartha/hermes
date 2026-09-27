# Phase E8 — Angekuendigten Origin festschreiben (Produktions-Footgun)

**Gate:** PASS
**finalBranch:** `phase/openai-e8-origin-footgun-fix1`

## Plan (gekuerzt)

Kernbefund: die eigentliche Code-Anforderung (fataler, beidseitig normalisierter
Audience-Divergenz-Riegel) war bereits seit Etappe E5 in `src/boot-guard.js` gebaut
(`angekuendigterOriginFindings`, inkl. PM-8-Normalisierung). Plan-Entscheidung:
KEIN Eintrag in `PRODUCTION_FOOTGUNS` (`src/config.js`) bauen — vier Gruende: null
zusaetzliche Schutzwirkung (Produktions-Menge ist echte Teilmenge des unconditional
laufenden E5-Gates), Duplizierung (G5/S2, Bestandskommentar verbietet das explizit),
wuerde als S5-A3-Wortlaut die PM-8-Normalisierung wieder aufreissen, und die in der
urspruenglichen Spec genannten Footgun-Testdateien haengen am falschen Eigentuemer.

Stattdessen vier reine Doku-/Test-Nachzuege, null Zeilen in `src/`:
1. `test/s2-mcp-origin.test.js` — ein fehlender Testfall (`E8-U01`: gesetzte, exakt
   kanonische `OAUTH_AUDIENCE` -> kein Befund), gegen `kanonischeAudience()` gerufen
   statt gegen ein Literal.
2. `.env.example` — WorkOS-Resource-Indicator-Hinweis an `OAUTH_AUDIENCE`.
3. `render.yaml` — erklaerender Kommentar am `OAUTH_ISSUER_URL`-Block, warum
   `OAUTH_AUDIENCE` dort bewusst keinen Eintrag hat.
4. `PLAN-SECURITY.md` — nachgezogener E5/E8-Sicherheitsabschnitt (Anlass, Eigentuemer,
   Normalisierung, bewusst kein Zweitriegel, akzeptiertes Risiko, Tests).

Eine Kontingenz-Bauform fuer den `config.js`-Footgun (falls der Owner ihn trotzdem
verlangt) ist im Plan als Abschnitt 6 dokumentiert, ausdruecklich als schlechtere
Variante, nicht als Empfehlung.

Deterministische Pruefkommandos (Abschnitt 5 des Plans) belegten gegen `master`:
leer/kanonisch/kanonisch+slash -> 0 Befunde; divergent -> 1 Befund, nennt
`OAUTH_AUDIENCE`, nennt nie den Wert.

## Impl-Zusammenfassung

- Kein Code in `src/` geaendert (`git diff --stat master -- src/` leer).
- Vier Dateien editiert: `test/s2-mcp-origin.test.js`, `.env.example`, `render.yaml`,
  `PLAN-SECURITY.md`. Keine neuen Dateien.
- Ein neuer Test: `E8-U01` (gesetzte, exakt kanonische `OAUTH_AUDIENCE` -> kein Befund).
- Vollstaendiger Regressionslauf: 6117 Tests, 0 Fehler (Implementierer-Lauf), gruen
  inkl. `E8-U01`.
- `smokePass: false` — Boot-Smoke via `node src/server.js` scheiterte NICHT wegen
  E8, sondern weil ein frischer `DATA_DIR` keinen Bootstrap-Tenant/keine aktive
  Nummer hat ("Keine aktive Nummer im Store"). Seeding waere Scope-Zuwachs bei einem
  reinen Doku-/Test-Diff gewesen; als Ersatz dienen die bereits gruenen
  Kindprozess-Boot-Tests (`E5-B01..B05`, `test/oauth.test.js`), die denselben
  Boot-Pfad inkl. `angekuendigterOriginFindings` mit korrektem Env durchlaufen.

### Deviations

1. Kein Code in `src/` geaendert (plangemaess) — `PRODUCTION_FOOTGUNS`-Eintrag
   bewusst NICHT gebaut (Duplizierung, Schutzwirkung=0, reisst PM-8-Normalisierung
   wieder auf).
2. Boot-Smoke (aus dem Auftragstext) konnte lokal nicht bis `listen()` durchlaufen
   werden (fehlender Tenant-Bootstrap in frischem `DATA_DIR`); Ersatz: bereits
   gruene Kindprozess-Boot-Tests (`E5-B01..B05`, `oauth.test.js`).

## Safety-Urteil

**verdict: PASS (approved), 0 Blocker, 6 Concerns.**

- `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`,
  `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`,
  `behaviorAsIntended: true`.
- Unabhaengiger Testlauf (frischer Worktree, Branch `review-e8-r1`): json-Backend
  6120/6121 gruen; einziger roter Fall (`SEC-P4-5`) isoliert gruen nachgemessen
  (bekanntes Parallelitaets-Rennen der Bank, kausal ausgeschlossen — E8 beruehrt
  keine Mandanten-Token-Logik). pg-Backend-Lauf in dieser Umgebung nicht fahrbar
  (kein Postgres erreichbar), auf `master` byte-identisch reproduziert — Umgebung,
  nicht Phase. Zielgerichteter Lauf der E8-relevanten Dateien: 109/109 gruen.
- Diff-Pruefung gegen absolute Regeln: Safety-Gates, Offenlegung, Auth-Kette,
  Secrets — alle Traeger-Dateien mit leerem Diff gegen `master`; kein neuer
  Endpunkt, kein neuer Ausschalter, keine neue Dependency.

**Concerns (kein Blocker):**
1. `PLAN-SECURITY.md` beschreibt die Normalisierung falsch als "links UND rechts" —
   die Regex (`/\/+$/`, `src/boot-guard.js:915`) entfernt nur RECHTS. Code ist
   richtig, Doku-Wortlaut ist zu korrigieren (folgenlos fuer Verhalten).
2. `T-P0-5-18` (Bestandstest in `test/boot-prod-footguns.test.js`) diskriminiert
   nicht spezifisch fuer einen neuen Footgun-Eintrag — der E5-Riegel liefert
   dieselben Merkmale ohnehin. Kein Blocker, da so von der Spec verlangt.
3. Ein hypothetischer `PRODUCTION_FOOTGUNS`-Eintrag waere der erste, der
   `cfg.server.*` liest — Invariante per Konvention gegen bestehende Fixtures ohne
   `server`-Namespace (nur relevant fuer die in Abschnitt 6 dokumentierte, NICHT
   gebaute Kontingenz).
4. Faellt zukuenftig doch ein zusaetzlicher Riegel in Produktion vor
   `assertAngekuendigterOrigin`, wuerde der Betreiber eine kuerzere Meldung ohne
   den "erwartet"-Wert sehen — diagnostisch aermer, aber weiterhin handlungsfaehig.
   (Trifft die tatsaechlich gewaehlte "kein Zweitriegel"-Umsetzung nicht.)
5. Doppelter Riegel auf dieselbe Aussage waere G5-Spannung gewesen — wurde durch
   die Entscheidung "kein Zweitriegel" vermieden; die Owner-Frage (Etappe-8-Text
   festschreiben vs. Eintrag zurueckziehen) ist in `PLAN-SECURITY.md` vermerkt.
6. `docs/RUNBOOK-AS-METADATA.md` enthaelt eine live gegen Produktion gefahrene
   Sonden-Messung — nur oeffentliche Metadaten, kein Credential, keine Kundendaten,
   auf `master` bereits mehrfach dokumentiert. Nur zur Kenntnis.

## Clean-Code-Audit (S1-S4)

**verdict: PASS — keine S1/S2-Befunde.** S3/S4 ebenfalls leer.

- Reuse statt Duplizierung: der (letztlich nicht gebaute) Zweitriegel-Entwurf und
  die tatsaechliche Umsetzung nutzen durchgehend `fuerAudienceVergleich`/
  `kanonischeAudience` aus `src/boot-guard.js`, keine zweite Vergleichsformel.
- Neuer Testfall folgt Build-Operate-Check, ein Konzept pro Test, Grenzfall
  Trailing-Slash bereits durch Bestandstests abgedeckt.
- Keine Magic Numbers, kein toter/auskommentierter Code, keine neuen
  `eslint-disable`-artigen Marker.
- `node --check` auf den geaenderten Dateien fehlerfrei; keine neue Suppression in
  `eslint-suppressions.json`.

**Offene ToDos (nicht blockierend):**
1. Owner-Entscheidung einholen: Zwei-Riegel-Frage aus `PLAN-SECURITY.md`
   endgueltig klaeren (Footgun-Eintrag bauen und dauerhaft festschreiben, oder
   Etappe-8-Text im Plan auf `assertAngekuendigterOrigin` umschreiben).
2. F5-Messung in `docs/RUNBOOK-AS-METADATA.md` nachziehen, sobald die
   WorkOS-Dashboard-Schritte B2/B3 (CIMD/DCR) erledigt sind.

## Fix-Runden

**r1:** Beide Review-Blocker der Phase E8 behoben. (1) Der urspruenglich in
`PLAN-OPENAI.md` Etappe 8 verlangte `PRODUCTION_FOOTGUNS`-Eintrag fuer
`OAUTH_AUDIENCE` wurde gebaut, ohne eine zweite Vergleichsformel zu erfinden
(Reuse von `kanonischeAudience`/`fuerAudienceVergleich` aus `src/boot-guard.js`).
[Fix-Text im Quellmaterial nach diesem Punkt abgeschnitten — vollstaendiger
Wortlaut der Runde r1 liegt nicht vor.]

## Offene Owner-Handgriffe (aus dem Plan, kein Code)

| ID | Handgriff | Ort |
|---|---|---|
| S5-B1 | Kanonische MCP-URL als Resource Indicator eintragen | WorkOS Dashboard |
| S5-B2 | CIMD einschalten (Default AUS) | WorkOS Dashboard |
| S5-B3 | DCR parallel an lassen | WorkOS Dashboard |
| S2-A9 1b/1c | Soll-Ist-Vergleich `PUBLIC_URL`/`OAUTH_AUDIENCE` am Render-Service | Render-Dashboard |
| S5-F5 | Zweite AS-Metadata-Messung nach B1-B3 | `docs/RUNBOOK-AS-METADATA.md` |

Offene Nachweise, erst nach einem Deploy erbringbar: `/.well-known/oauth-protected-resource`,
Cross-Origin-403-Probe, Auth-401-Probe, echter Connector-Werkzeugaufruf.
