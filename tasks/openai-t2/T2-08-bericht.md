# T2-08 — Geldpfad: Hop-Fristen und Stundenlimit unter Sperre

Branch `phase/openai-t2-08-hop-timeouts-hour-cap`, kein neuer Commit ueber `c447cd3` hinaus
(letzter Commit: `docs(t2-08): PLAN-SECURITY.md ...`). Scope: **nur T-27**. Basis: T2-01..T2-07 +
T2-23 gemergt (master `4cc2e9a`), nicht zurueckgenommen.

## 1. Was diese Phase NICHT erfuellt

- **Kein neuer Merge-Commit** — der Worktree steht auf `c447cd3`; wer "PASS -> merge" liest, muss
  wissen: es gibt aktuell nichts, das ohne einen Squash/Merge-Schritt in `master` landet.
- **Zwei offene Review-Befunde ohne Owner-Entscheidung** (Detail unten, Abschnitt 5):
  1. Ein bewusster Ein-Zeilen-Hack in `outbound-gates.js:466`, der zwei unabhaengige
     Anweisungen auf eine physische Zeile zwingt, nur um eine bereits gepinnte
     `max-lines-per-function`-Metrik unveraendert zu halten.
  2. Echte Duplizierung der Antwortformung (Text/Status) fuer Stundenlimit/Ziel-Cap an zwei
     Stellen (`numberGateError` und der neue `callQuotaError`) — dieselbe Ursache wie 1.
- **S1-Abweichung vom Spec-Vorschlag**: `numberGateError` ruft `callQuotaError` NICHT auf
  (bewusst, aus demselben Metrik-Pin-Grund). Die sicherheitsrelevante Schwellwert-Logik
  (`tenantHourReached`/`perTargetCapReached`) bleibt zwar eine einzige Quelle, aber die
  Fehlertext-/Status-Formung ist an zwei Stellen im Code vorhanden.
- **T6 im Nebenlaeufigkeitstest nutzt kein L=1** wie im Spec-Bullet genannt, sondern ein
  grosszuegiges Limit — Begruendung dokumentiert in "Abweichungen von der Spec"
  (bei L=1 lehnt der fruehe `number_gate`-Check den Retry schon vor der Dedup-Pruefung ab,
  ein von der Spec selbst als akzeptiertes Bestandsverhalten benanntes Problem, aber es
  liesse T6 nichts Deterministisches ueber die neue Funktion pruefen).
- **Historien-Granularitaet**: S1-S4 landeten wegen eines Bau-Fehlers (`git reset --soft` +
  versehentliches `git add` aller Dateien) in einem einzigen Commit statt in Teilschritten.
  Inhaltlich verifiziert, aber "ein Commit je Schritt" ist nicht eingehalten.
- **Eslint-Legacy-Pins zweier bestehender Eintraege wurden angehoben** (api-calls.js
  complexity 25->26, Async-Arrow 138->145, `makeCallRoutes` 234->242; mcp-tools.js
  `registerTools` 512->519), ohne dass dafuer im Rahmen dieser Phase eine frische
  Owner-Freigabe eingeholt wurde (die Datei verlangt laut eigenem Kopfkommentar D11 Punkt 1
  eine menschliche Pruefung). Bestandspraxis laut Bauer, aber nicht dasselbe wie eine
  eingeholte Freigabe.

## 2. Was erfuellt ist — ID T-27

T-27 zerfaellt in zwei unabhaengige Teile, beide fuer sich pruefbar:

**Teil A — Hop-Frist fuer jeden UEBRIGEN MCP->REST-Hop**
(`cancel_call`, `answer_consult`, `check_inbox`, `get_call_status`, `list_calls`, alle
`GET /api/state`-Leser, der Abschluss-`GET` in `await_call_event`):

- Neue benannte Konstante `MCP_HOP_TIMEOUT_MS = 60000` in `src/mcp-tools.js:338`, mit
  Werkherleitung im Kommentar (laengster begrenzter Serverweg = `cancel_call` auf
  gebundenem EL-Inbound-Anruf, rechnerisch 40000 ms — 60000 ms als Sicherheitsabstand).
- `call()` in `src/mcp-tools.js:888` reicht jetzt `timeoutMs: MCP_HOP_TIMEOUT_MS` an
  `api()` durch (vorher: kein `timeoutMs`, also nie eine Frist fuer diese Hops); ein
  Abort wird zu `ToolError(MCP_ERROR_CODE.HOP_TIMEOUT)`, lokalisierter Text in
  `src/i18n/mcp-texts.js:35/66/153/208` (drei Sprachbloecke).
- `PLACE_CALL_HOP_TIMEOUT_MS` (place_call) und der Consult-Long-Poll bleiben unangetastet
  (eigene, bereits vorhandene Fristen — Gegenprobe im Test).
- Beleg: `test/openai-t2-08-hop-frist.test.js`, 7 Tests, isoliert gruen (siehe Log unten):
  vier Zeitablauf-Faelle (cancel_call/answer_consult/check_inbox/get_call_status) je
  mit `isError` + `HOP_TIMEOUT` in jeder Sprache, zwei Gegenproben (await_call_event,
  place_call behalten ihre eigenen Fristen), ein struktureller Ungleichungstest
  (`MCP_HOP_TIMEOUT_MS` > errechneter Serverweg).

**Teil B — Stundenlimit (und Ziel-Cap) zaehlt und reserviert atomar**

- Neue Fabrik `makeCallQuotaCheck` in `src/telephony/outbound-gates.js:283-345` liefert
  `callQuotaDenial(ctx)`, das dieselben, UNVERAENDERTEN Praedikate
  (`tenantHourReached`, `perTargetCapReached`, `gateTexts`) wie der bestehende fruehe
  `number_gate`-Check verwendet — keine zweite Zaehl-/Schwellwert-Quelle.
  `makeOutboundGates` gibt zusaetzlich `callQuotaDenial` zurueck (Zeile 1051).
- `claimCallRecord` in `src/routes/api-calls.js:304-321` prueft `callQuotaDenial(ctx)` jetzt
  **innerhalb desselben synchronen `store.withStoreLock`-Bodys** wie die Dedup-Entscheidung
  — nach Dedup, vor `store.createCall`. Reihenfolge belegt in T6.
- Verdrahtung: `server.js` destrukturiert `callQuotaDenial` aus derselben
  `makeOutboundGates`-Instanz und reicht es ueber `deps` (`app.js`) an `makeCallRoutes`
  durch; fehlt es, wirft `callQuotaDenialNotWired()` (lauter Fallback, fail-closed statt
  stillem "immer erlaubt") — `src/routes/api-calls.js:104-110, 371`.
- Ablehnungspfad bei Quoten-Treffer im Lock: Reserve wird in einem zweiten kurzen Lock
  zurueckgebucht, Audit/Metrik laufen, **kein** Originate/Consult/Timer/Kostenprofil, **kein**
  Datensatz entsteht (`src/routes/api-calls.js:556-566`).
- Beleg: `test/openai-t2-08-stundenlimit-sperre.test.js`, 6 Tests, isoliert gruen:
  - T1: N parallele `place_call` eines Mandanten am Limit -> hoechstens L angenommen.
  - T2: zweiter Mandant parallel bleibt frei (keine Serialisierung ueber Mandanten hinweg).
  - T3: Wurf in `createCall` -> 503, 0 Datensaetze, Reserve wieder frei, naechste Anfrage 200
    (Beleg fuer "Sperre bleibt nach Fehler nicht haengen").
  - T4: nicht platzierter Anruf behaelt den Stundenlimit-Slot (Pre-Mortem-Frage explizit in
    Richtung strenger beantwortet, siehe Widerspruch-Liste des Bauers).
  - T5: Ziel-Cap zaehlt einen beendeten/gescheiterten Anruf mit.
  - T6: Dedup hat Vorrang vor der Quote bei zwei parallelen Anfragen an dasselbe Ziel.

**Lauf, isoliert (beide neuen Dateien zusammen):**
`13 tests, 13 pass, 0 fail` — Logdatei:
`/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/logs-t2-08/t2-08-tests.log`

Weiter berichtete Werte (nicht in dieser Session nachgemessen, aus dem Auftrag uebernommen):
Baseline unberuehrter Worktree auf master `4cc2e9a` = 6326 pass / 27 fail (alle 27 als
Bestand/Flake benannt, nicht T2-08-bezogen); nach dem Bau 6366 pass / 0 fail, 0 isoliert rot.

## 3. Pfade — ist der Punkt auf ALLEN Wegen erfuellt?

| Pfad | Hop-Frist (Teil A) | Stundenlimit-Sperre (Teil B) |
|---|---|---|
| MCP (stdio + HTTP) ueber `call()` in `registerTools` | JA — `call()` ist der einzige Hop-Wrapper, betrifft stdio wie HTTP gleich | mittelbar: `place_call` ruft REST auf, siehe REST-Zeile |
| REST `POST /api/calls` (`makeCallRoutes`) | n/a (das ist der REST-Endpunkt selbst, keine MCP->REST-Frist noetig) | JA — `claimCallRecord` im Lock, unabhaengig vom Aufrufer (MCP oder direkter REST-Client) |
| EL-Anrufstart (dritter Outbound-Weg, laut CLAUDE.md/Memory ein separater Pfad) | nicht gepruefte — der Bericht des Bauers macht dazu keine Aussage; die Diffs zeigen keine Aenderung an einem EL-eigenen Claim-Pfad | **UNKNOWN** — falls der EL-Weg einen eigenen Anruf-Claim ohne `claimCallRecord` anlegt, waere die Quote dort nicht atomar geschlossen. In den gepruesten Diffs kein Hinweis auf einen zweiten Claim-Ort, aber auch kein expliziter Beleg, dass der EL-Weg ueber `POST /api/calls` laeuft. |
| `place_call` (eigene Frist `PLACE_CALL_HOP_TIMEOUT_MS`) | unveraendert, Gegenprobe im Test bestanden | n/a |

Der fremde Pruefer sollte den EL-Anrufstart-Pfad (server.js, dritter Outbound-Weg laut
Memory `elevenlabs-agent-ketten.md`) gezielt darauf pruefen, ob er ebenfalls durch
`claimCallRecord`/`store.withStoreLock` laeuft oder einen eigenen Claim-Ort hat.

## 4. Was ein fremder Pruefer nachmessen sollte (neutral)

1. Ist `MCP_HOP_TIMEOUT_MS` tatsaechlich auf JEDEN `call()`-Aufrufer in `registerTools`
   angewendet, oder gibt es einen Tool-Handler, der `api()` direkt statt ueber `call()`
   aufruft und die Frist umgeht? (`grep -n "api(" src/mcp-tools.js`)
2. Ist die Werkherleitung fuer `MCP_HOP_TIMEOUT_MS = 60000` (40000 ms errechneter
   Serverweg + Marge) noch gueltig, wenn `ELEVENLABS_RESULT_POLL_MS` oder
   `EL_TERMINATION_RESULT_ATTEMPTS`/`EL_ABORT_PROVIDER_TIMEOUT_MS` vom Owner geaendert
   werden? Der Ungleichungstest in `openai-t2-08-hop-frist.test.js` soll das fangen — laeuft
   er tatsaechlich rot, wenn man die Konstanten im Test lokal anhebt?
3. Laeuft `callQuotaDenial` wirklich unter DEMSELBEN `store.withStoreLock`-Aufruf wie die
   Dedup-Pruefung (kein zweiter, spaeter erworbener Lock)? (`src/routes/api-calls.js:304-321`
   und den Aufrufort `:556`)
4. Ist die Sperre wirklich prozessweit-aber-nicht-blockierend fuer andere Mandanten — teilt
   `store.withStoreLock` sich einen einzigen Mutex fuer ALLE Requests (Mandant A und B), und
   wenn ja: haelt der kritische Abschnitt (Dedup + Quoten-Check + `createCall`) tatsaechlich
   nur Mikrosekunden, so dass Mandant B durch Mandant A nicht spuerbar blockiert wird? Die
   Tests T1/T2 pruefen das Ergebnis (L angenommen, B frei), nicht die Latenz.
5. Gibt der neue lauter Fallback `callQuotaDenialNotWired()` tatsaechlich in JEDEM
   Kompositionspfad (Produktions-`server.js` UND jedem Test-Setup, das `makeCallRoutes`
   direkt aufruft) korrekt `callQuotaDenial` mit, oder wirft ein bestehender Test/Aufrufer
   jetzt unerwartet, weil er das Feld nicht kennt? (`grep -rn "makeCallRoutes(" test/ src/`)
6. Stimmt die Behauptung, dass `numberGateError` byte-identisch zum Bestand geblieben ist
   (0 Zeilen Diff im fruehen Gate-Block), waehrend `callQuotaError`/`callQuotaDenial`
   komplett neuer, separater Code sind — oder gibt es doch eine versteckte Verhaltens-
   aenderung im fruehen `number_gate`-Pfad? (`git diff master...HEAD -- src/telephony/outbound-gates.js`,
   Bereich um Zeile 460-480)
7. Laesst sich T4 ("nicht platzierter Anruf behaelt den Slot") als bewusste, im Pre-Mortem
   dokumentierte Verschaerfung nachvollziehen, oder wirkt es wie ein Fehlverhalten fuer
   den Endnutzer (ein gescheiterter Anruf verbraucht dauerhaft eine Stunden-Quote)?
8. Sind die beiden Eslint-Legacy-Pin-Anhebungen (api-calls.js, mcp-tools.js) tatsaechlich
   durch den Diff an `eslint-legacy-exceptions.json` und `test/check-staged-suppressions.test.js`
   gedeckt, und stimmen die genannten Zahlen (complexity 25->26 usw.) mit dem tatsaechlichen
   Diff ueberein?

## 5. Owner-Punkte und Restrisiko

Nach der OWNER-REGEL bleibt fuer den Menschen nur: Deploy/Push nach einem etwaigen Merge
(einziges Owner-Gate; keine neue Env-Variable, kein ungemessener Live-Wert, der die
Produktion beim Deploy lahmlegen koennte — Smoke danach: `/healthz` gruen, `place_call`
unter dem Limit weiterhin 200, am Limit 429 mit dem bisherigen Text). Als Kenntnisnahme
(nicht Freigabe-Pflicht, D11 Punkt 1, Bestandspraxis) gehoert die Anhebung der zwei
bestehenden Eslint-Legacy-Pins (api-calls.js, mcp-tools.js) auf die Owner-Liste. Eine
echte Eigentuemer-Entscheidung steht dagegen fuer den in Abschnitt 1 genannten
Ein-Zeilen-Hack in `outbound-gates.js:466` aus: entweder einen neuen
Legacy-Eintrag freigeben (der Bau-Agent durfte das laut eigenem Test nicht selbst tun) oder
den ohnehin geplanten G30-Split von `makeOutboundGates` vorziehen, um die Duplizierung der
Antwortformung (Stundenlimit/Ziel-Cap-Texte an zwei Stellen) aufzuloesen. Restrisiko: Die
sicherheitsrelevante Schwellwert-LOGIK ist nachweislich eine einzige Quelle (dieselben
Praedikate, injiziert), das Risiko der Duplizierung betrifft nur die Fehlertext-/
Status-Formung — driften Text oder Status kuenftig auseinander, bekommt der Aufrufer je
nach Codepfad (frueher number_gate-Check vs. Claim-Lock-Recheck) unterschiedliche
Fehlermeldungen fuer denselben Ablehnungsgrund, was Governance-/Wartungsrisiko ist, kein
Sicherheitsloch. Zusaetzliches, in dieser Session nicht auflösbares Risiko: ob der
dritte Outbound-Weg (EL-Anrufstart) ebenfalls durch den neuen Claim-Lock-Recheck laeuft
oder einen eigenen, ungeprueften Claim-Ort hat (UNKNOWN, siehe Abschnitt 3/4).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: c447cd3; Tests (volle Suite, pass/fail): 6366/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - T-27 | ja | mcp-tools.js:886-893 call() mit MCP_HOP_TIMEOUT_MS; eigene Sonde, alle 12 Tools gegen haengendes Gateway: je ~52ms isError (place_call 180000, await 25000). T1 auf master: 8x200 bei Limit 2, Branch: 2x200+6x429. Suite 6366/0 | Kein haengender Hop ueber den echten gespawnten Server gemessen (nur Handler plus haengendes HTTP-Gateway). stdio-Pfad (lokal, vertrauenswuerdig) hat kein Anfrage-Ratenlimit; place_call dort nur durch Stunden-/Ziellimit gedeckelt.
- Isoliert rot: []
- Offene Blocker:
  - safety/wichtig eslint-legacy-exceptions.json:91-99 (+ test/check-staged-suppressions.test.js:653-665, 756-807): Die Pins zweier bestehender Altlast-Eintraege wurden angehoben: api-calls.js complexity 25->26, Async-Arrow 138->145, makeCallRoutes 234->242; mcp-tools.js registerTools 512->519. LEGACY_FINGERPRINT im Ratschen-Test ist mitgezogen. Die Ratsche verlangt laut ihrem Kopfkommentar (D11, Punkt 1), dass ein MENSCH die Freigabe prueft. Eine frische Owner-Freigabe liegt nicht vor. Pin-Anhebungen durch Phasen sind allerdings belegte Bestandspraxis (z.B. IEX-A2, IEX-A8, IEX-A10, IEL-B5).
  - cleancode/wichtig src/telephony/outbound-gates.js:466: Zwei unabhaengige Anweisungen (gateTexts-Definition und die callQuotaDenial-Destrukturierung aus makeCallQuotaCheck) stehen bewusst auf derselben physischen Zeile, einzig um den Zeilenzaehler von makeOutboundGates fuer die eslint-Regel max-lines-per-function unveraendert zu halten (dokumentiert in Kommentar und im Testkommentar von test/check-staged-suppressions.test.js). Das ist ein Konventionsbruch (im restlichen Repo steht ein Statement pro Zeile) und erschwert das Lesen/Debuggen genau in der Datei, die die Safety-Gate-Kette traegt.
  - cleancode/wichtig src/telephony/outbound-gates.js:465-480 (numberGateError) und :560-580 (callQuotaError, neu): Die Antwortformung (status/grund/message-Objektliterale fuer Stundenlimit und Ziel-Cap) ist jetzt an zwei Stellen im Code vorhanden - in numberGateError (bewusst byte-identisch belassen) und in der neuen callQuotaError-Fabrik. Selbst zugegeben und begruendet (Vermeidung einer neuen Altlast-Eintragung), aber echte Duplizierung nach G5.
