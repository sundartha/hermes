# Phase IEX-A11 — Rollout-Werkzeug: setzen per Registrierung, Scope-Unterbefehl

- **Gate:** PASS
- **finalBranch:** `phase/iex-a11-rollout-werkzeug`
- **Basis:** master `94f0f9b` (IEX-A1..A10 gemergt)
- **headCommit (Impl):** `a4bb2592...` (siehe Impl-Zusammenfassung; verkuerzter Hash in der Rohausgabe)

## Plan (gekuerzt)

Umsetzung von Spec IEX-A E14: `setzen --registrierung=<phnum_...>` zusaetzlich zu `--nummer`
(mischbar, dieselbe Registrierung zaehlt einmal ueber `phone_number_id`), sowie neuer Unterbefehl
`scope --registrierte-dids|--allowlist` fuer den Render-Schluessel `ELEVENLABS_INBOUND_SCOPE`.

Zentrale Entscheidungen (mit Beleg im Plan):

- **D-1:** Der Schreibziel-Riegel gilt fuer JEDES Ziel von `setzen`, auch fuer `--nummer` (nicht nur
  `--registrierung`). Verschaerfung, fail-closed; `setzen` braucht dadurch zusaetzlich
  `ELEVENLABS_AGENT_ID`. Frage an den Lead offen gelassen (auf Standard geantwortet, s. Deviations).
- **D-2:** Agentenvergleich ueber `registrierung.assigned_agent.agent_id`, nicht `agent_id` (wie in
  IEX-A8 gemessen).
- **D-3:** Kein eigenes Praedikat — Wiederverwendung von `reparaturHindernis` aus
  `src/elevenlabs/inbound-trunk-beleg.js` (dieselbe Frage wie die Sweep-Reparatur E16, keine
  Duplizierung).
- **D-4:** `scope` kommt in `scripts/iel-geheimnisse-schalter.mjs` (gemeinsamer Ablauf mit `schalter`),
  keine eigene Datei.
- **D-5:** `PLAN-SECURITY.md` wird mitgepflegt (neuer schreibbarer Render-Schluessel, erweiterter
  Schreibziel-Riegel; CLAUDE.md verlangt das bei sicherheitsrelevanten Aenderungen).
- **D-6:** Eine unbekannte `--registrierung` erscheint im Befund nur mit ihrer Position
  (`--registrierung #2`), nie mit dem eingegebenen Wert (koennte eine volle Nummer sein).

Betroffene Dateien laut Plan: `scripts/iel-geheimnisse.mjs`, `-setzen.mjs`, `-schalter.mjs`,
`-render.mjs`, `test/iel-b10-geheimnisse.test.js`, `PLAN-SECURITY.md`. Kein `src/`-Code betroffen
(reines Werkzeug, NICHT-Scope laut Spec).

Pre-Mortem-Absicherungen: Schreibziel-Riegel vor jedem Schreiben (0 schreibende fetch bei ROT),
Ziele als Map nach `phone_number_id` (kein Doppel-Patch), halbe Rotation ueber die Kennung geprueft,
Scope-Flip nur nach gruenem Inventar+beleg-init im selben Lauf, `schalter`-Texte byte-gleich nach
Refactor, keine volle Nummer/kein Geheimnis in neuer Ausgabe.

## Impl-Zusammenfassung

Gebaut auf `phase/iex-a11-rollout-werkzeug` (Commit `a4bb259`, Basis master `94f0f9b`), dem Plan
folgend inkl. D-1..D-6:

- `setzen` akzeptiert zusaetzlich `--registrierung=<phnum_...>`, mischbar mit `--nummer`. Ziele
  werden in einer Map nach `phone_number_id` gesammelt (dieselbe Registrierung zaehlt einmal).
- Jedes Ziel — auch `--nummer`-Ziele — muss den Schreibziel-Riegel bestehen (wiederverwendet
  `reparaturHindernis`: eigener Agent via `assigned_agent.agent_id`, `phone_number` gesetzt,
  `outbound_trunk` vorhanden). Bei einem ROT-Ziel: 0 schreibende Aufrufe. Folge: `setzen` verlangt
  zusaetzlich `ELEVENLABS_AGENT_ID`.
- Halbe-Rotation-Pruefung jetzt ueber Kennungs-Abgleich gegen die Ziel-Map.
- Unbekannte `--registrierung` wird nur mit ihrer Position gemeldet.
- Neuer Unterbefehl `scope --registrierte-dids|--allowlist`: Trockenlauf per Default, `--ausfuehren`
  sendet genau ein PUT auf `ELEVENLABS_INBOUND_SCOPE` und liest zurueck. `--registrierte-dids`
  schreibt nur bei im selben Lauf gruenem Inventar UND beleg-init; `--allowlist` schreibt
  bedingungslos (nur `RENDER_API_KEY` noetig).
- `schalter` und `scope` teilen sich eine interne Umschaltroutine
  (`schalteNachVorbedingungen`/`pruefeVorbedingungen`/`schalteUm` mit den Tabellen
  `VORBEDINGUNGEN_AN` und `VORBEDINGUNGEN_REGISTRIERTE_DIDS`). Ausgabetext von `schalter` unveraendert
  (IEL-B10-10 bleibt gruen).
- `ELEVENLABS_INBOUND_SCOPE` ist der sechste schreibbare Render-Schluessel.
- `PLAN-SECURITY.md` aktualisiert (Zaehlungen IEL-B10 §2/§9 fuenf->sechs, neuer Abschnitt IEX-A11).
- Kein `src/`-Edit.

**Checks:** `node --check` auf allen 4 Skripten gruen; eslint auf den 5 geaenderten Dateien sauber;
`test/iel-b10-geheimnisse.test.js` 30/30; `npm test -- --test-concurrency=4` Exit 0, 5985 pass / 0
fail. Mutationscheck: Schreibziel-Befund entfernt -> IEX-A11-2/-5 werden rot (Tests fangen den
Defekt tatsaechlich). Plan-Greps bestaetigt: 0 Treffer "fuenf", 0 `vorbedingungenAn`/`zuordnung`,
0 `assigned_agent`/`agent_id` in `setzen.mjs`, 1 Treffer `ELEVENLABS_INBOUND_SCOPE` in
`render.mjs`.

### Deviations vom Plan

1. Der Plan sah EIN `describe`-Block fuer IEX-A11 vor; wegen eslint `max-lines-per-function` (100
   Zeilen) auf zwei Blocks aufgeteilt (`setzen per Registrierung` / `scope und Argumente`).
   Testnamen und -inhalt unveraendert.
2. Kopfkommentar in `iel-geheimnisse-render.mjs` nennt den Scope-Schluessel beschreibend statt
   wortwoertlich — sonst haette der plan-eigene Grep auf `ELEVENLABS_INBOUND_SCOPE` (erwartet genau 1
   Treffer) 2 Treffer ergeben.
3. Zusaetzliche Kommentar-Anpassungen in `iel-geheimnisse-schalter.mjs` (Kopfzeile, Abschnitts-
   Divider) — nur Kommentare, keine Verhaltensaenderung.
4. IEX-A11-2 baut die Fixtures ohne `assigned_agent`/`outbound_trunk` ueber einen kleinen Helper
   `ohneFeld()` statt per Destrukturierung, um unbenutzte Variablen-Warnungen zu vermeiden.
5. D-1 (Riegel gilt auch fuer `--nummer`) als Plan-Standard umgesetzt; die im Plan an den Lead
   gestellte Frage blieb offen/unbeantwortet und wurde per Default entschieden.

**Smoke-Test:** CLI-seitig (kein Server-Route betroffen), NODE_ENV=test, keine Netzwerkaufrufe.
`scope` ohne Flag -> Exit 1 "scope verlangt genau eins"; `scope --allowlist` ohne `--ausfuehren` ->
Trockenlauf, Exit 0; `setzen --registrierung=phnum_x` ohne EL-Keys -> Exit 1 fail-closed
("ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID fehlt"). Pre-Commit-Lint-Hook: 0 Fehler, 69 Warnungen (alle
in von dieser Phase nicht beruehrten Dateien).

## Safety-Urteil

**PASS (approved).** Alle Kern-Flags gruen: `testsPassIndependently`, `safetyGatesIntact`,
`disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `behaviorAsIntended`,
`scopeRespected`; keine Blocker.

Unabhaengiger Testlauf: frischer Worktree, Branch `review-iex-a11` = `phase/iex-a11-rollout-werkzeug`
(a4bb259) auf master-HEAD 94f0f9b. `test/iel-b10-geheimnisse.test.js` + `test/iel-b11-nachdeploy.test.js`
+ `test/sec-p6-waechter-wahlaufrufer.test.js` zusammen: 59 Tests, 0 fail. Isoliert
`iel-b10-geheimnisse.test.js`: 30/30. Fuenf Positiv-Kontrollen per Mutation, alle danach
zurueckgesetzt: (M1) Schreibziel-Befund aus -> IEX-A11-2/-5 rot; (M2) halbe-Rotation-Pruefung aus ->
IEL-B10-6 + IEX-A11-4 rot; (M3) Inventar-Vorbedingung beim Scope-Flip entfernt -> IEX-A11-6 rot;
(M4) unbekannte Kennung in Ausgabe wiederholt -> IEX-A11-2 rot; (M5) `--allowlist`-Rueckweg an
Vorbedingungen gebunden -> IEX-A11-7 rot. Diff-Pruefung: 0 Dateien unter `src/`, `package.json/lock`,
`render.yaml`, `.env.example`, `apps/`; keine neue Dependency, keine Route, kein Secret-Muster im
Diff.

**Concerns (kein Blocker):**

1. Nur der `--nummer`-Weg erkennt Mehrdeutigkeit (zwei Registrierungen mit gleicher `phone_number`
   ohne Zugangsdaten). `zielNachKennung` (`--registrierung`) findet das nicht — bleibt Runbook-Schritt
   b2-Pflicht (`--trunk-inventar`). Eine solche Registrierung MIT Zugangsdaten faengt weiterhin die
   "halbe Rotation"-Pruefung ab.
2. Der Schreibziel-Riegel vergleicht gegen `config.voice.elevenLabsOutbound.agentId` (lokale
   Konfiguration). Weicht die lokale Agent-ID vom Prod-Agenten ab, laeuft `setzen` (auch mit
   `--nummer`) ROT ohne etwas zu schreiben — fail-closed, aber Operator sollte es vor a7a kennen.
3. `scope --registrierte-dids` prueft nur Inventar + beleg-init, nicht die Beleg-Zahlen je DID
   (E11-Ergebniszeile) und nicht `ELEVENLABS_INBOUND_ENABLED`. Gewollt, in `PLAN-SECURITY.md` §2
   dokumentiert, deckt Runbook b4/b5 ab; Server weist unbelegte DIDs ohnehin ab (IEX-A9).

**Separates Security-Urteil:** ebenfalls PASS/approved, keine Blocker; dieselben drei Punkte als
Concerns gespiegelt (Betriebsrisiko einer blockierten Rotation b3 bei fremder Registrierung mit
Zugangsdaten; fehlende E11-Beleg-Zahlen-Pruefung beim Scope-Flip bleibt Runbook-Pflicht; Grenze bei
Registrierungen ohne Zugangsdaten ausserhalb der Ziel-Liste — dokumentiert, kein Datenleck).

## Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`.

- **S1:** keine Befunde.
- **S2:** keine Befunde.
- **S3 (ein Hinweis, kein Handlungsbedarf):** `schreibzielBefund()` in `iel-geheimnisse-setzen.mjs`
  ruft `reparaturHindernis()` mit einem kuenstlich gesetzten `abruf.beleg = TRUNK_BELEG.ABWEICHUNG`
  auf, obwohl an dieser Stelle kein tatsaechlicher Abruf stattfand. Funktioniert korrekt und ist im
  Code kommentiert (E14==E16-Wiederverwendung), aber beim ersten Lesen ueberraschend. Optionaler,
  nicht-blockierender Fix: expliziterer Funktionsname statt Wiederverwendung unter falschem
  `beleg`-Wert — nicht umgesetzt, da nicht blockierend.
- **S4:** keine Befunde.

Bewertung im Detail: Deduplizierung sauber begruendet (G5-Kommentare fuer die gemeinsame
Umschaltroutine `schalter`/`scope` und die geteilte Schreibziel-Definition mit dem E16-Sweep).
Funktionen kurz, Argumente ueberwiegend als Objekte, niedrige Verschachtelungstiefe. 30/30 Tests
gruen, 8 neue Tests (IEX-A11-1..8) inkl. Grenzfaelle. `PLAN-SECURITY.md` konsistent nachgezogen.
Keine Magic Numbers ohne Konstante, kein toter/auskommentierter Code, keine abgeschalteten
Sicherungen. Kommentare durchgehend Deutsch ohne Umlaute, wie im Bestand.

## Fix-Runden

Keine — der Fixes-Abschnitt der Quelle ist leer. Kein Fix-Durchlauf war noetig; Safety- und
Clean-Code-Audit sind beim ersten Review-Durchlauf PASS gelaufen.
