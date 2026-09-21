# Abschlussbericht P1 — Annotationen und Beschreibungen (OpenAI-Einreichung)

Branch: `phase/openai-p1-annotationen`, aktueller Stand: **`b8cb2db`** (nicht `272db48` —
siehe Abweichung unten). Spec: `tasks/openai-p1-spec.md`. Anforderungsquelle:
`tasks/openai-audit/00-openai-anforderungen.md`.

Dieser Bericht ist fuer einen Lead, der den Code nicht liest. Alle Aussagen unten wurden fuer
diesen Bericht am ausgecheckten Branch-Stand nachgemessen (nicht nur aus den TATSACHEN
uebernommen) — Kommandos stehen bei jedem Punkt.

---

## 1. Was NICHT erfuellt ist — zuerst, ungeschoent

- **Kein stdio-JSON-RPC-Harness** (echter Kindprozess `src/mcp-server.js` ueber die Pipe).
  Bewusst nicht gebaut (Spec Abschnitt 2, Owner-Entscheidung im Spec-Dokument). Die
  Nicht-Divergenz zwischen stdio und HTTP wird stattdessen indirekt belegt: ein
  ctx-Vergleichstest (`P1 (DP-1)`) plus zwei grep-Belege (eine Werte-Quelle, zwei
  `registerTools()`-Aufrufer). Das ist eine schwaechere Beweisform als ein echter
  End-to-End-Lauf ueber die stdio-Pipe — sie beweist "kann nicht divergieren", nicht "hat in
  diesem Lauf nicht divergiert".
- **`idempotentHint` fehlt weiterhin an allen sieben reinen Lese-Werkzeugen**
  (`get_call_status`, `get_transcript`, `get_my_number`, `list_calls`, `list_action_items`,
  `get_calendar`, `get_agent_status`). Laut N-1 optional und an einem Nur-Lese-Werkzeug ohne
  Aussagewert — absichtlich unveraendert, kein Bug, aber ein OpenAI-Reviewer koennte das
  Fehlen trotzdem als Luecke werten, weil "optional" nicht "verboten" heisst.
- **`place_call.idempotentHint` bleibt `false`**, obwohl E3 (Anruf-Idempotenz) eine
  Entdopplung fuer laufende Anrufe eingefuehrt hat. Bewusst: die Entdopplung gilt nur fuer die
  Laufzeit des Anrufs, ein spaeterer Aufruf waehlt erneut — `true` waere eine Falschangabe.
- **`npm run format:check` bleibt rot** — vorbestehend, nicht Teil des P1-Scopes. Wichtig fuer
  den Lead: der in den TATSACHEN genannte Wert "999 Dateien" ist **kontaminiert** durch
  unbezogene, uncommittete Dateien im Haupt-Arbeitsverzeichnis (siehe Abschnitt 5,
  Restrisiko/Korrektur). Sauber gemessen (Branch vs. `master`, beide aus einem committeten,
  unveraenderten Checkout): `master` (728f053) = 848 unformatierte Dateien, dieser Branch
  (b8cb2db) = 849 — **eine mehr**, nicht 999. `src/mcp-tools.js` war auf `master` bereits
  unformatiert und ist es auf dem Branch immer noch (Status quo, nicht neu kaputt gemacht;
  `npx prettier --check src/mcp-tools.js` liefert auf beiden Staenden Exit 1). Die zusaetzliche
  Datei aus der 848→849-Differenz wurde in diesem Bericht nicht einzeln identifiziert (siehe
  UNKNOWN unten) — sie liegt aber ausserhalb der vier von diesem Diff beruehrten Dateien
  (`git diff --stat master..HEAD` zeigt exakt vier), kann also keine der vier P1-Dateien sein
  ausser ggf. der Formatierungszustand selbst einer der drei anderen (eslint-legacy-exceptions.json
  ist JSON, kein Prettier-Ziel unter dem Standard-Glob; die beiden Testdateien sind moeglich).
  UNKNOWN, welche genau — fuer die Merge-Entscheidung ohne Belang, da format:check bereits vor
  dieser Phase rot war und kein Abnahmekriterium dieser Phase ist.
- **`npm run test:gates` wurde nicht erneut gefahren.** Laut Spec nicht noetig (keine neuen
  Katalog-Praefix-Tests). Fuer diesen Bericht per Regex-Probe nachgerechnet (siehe Abschnitt 4)
  statt einfach uebernommen — alle sechs neuen/umbenannten Testnamen treffen das Muster
  `^(Charakterisierung )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]`
  aus `package.json` NICHT — bestaetigt, nicht nur behauptet.
- **Commit-Stand-Diskrepanz:** Die TATSACHEN nennen `272db48` als Commit, tatsaechlicher
  Branch-HEAD ist `b8cb2db` — ein zweiter Commit, der einen Runde-1-Review-Blocker fixt (siehe
  Abschnitt 2, N-11). `272db48` allein enthielte noch die von Review-Runde 1 als falsch
  erkannte Behauptung "so the same question is not handed out twice" in der
  `await_call_event`-Beschreibung. Dieser Bericht bewertet den tatsaechlichen HEAD (`b8cb2db`),
  nicht den in den TATSACHEN genannten Zwischenstand. Wer stattdessen `272db48` mergt, mergt
  eine falsche Aussage im Werkzeug-Text.

---

## 2. Was diese Phase erfuellt — ID fuer ID

Alle fuenf IDs (N-1, X-1, N-3, N-4, N-11) stammen aus
`tasks/openai-audit/00-openai-anforderungen.md:75-90,132`.

**N-4** — `openWorldHint` entscheidet sich am Zugriff, nicht am Thema.
`openWorldHint: false` an `await_call_event`, `get_call_status`, `get_transcript` (alle drei
lesen/schreiben ausschliesslich den tenant-lokalen Store), `true` bleibt an `place_call`,
`answer_consult`, `cancel_call` (wirken auf die echte Leitung/den Carrier). Tabelle:
`src/mcp-tools.js:637-715` (`TOOL_ANNOTATIONS`). Begruendungskommentar: `:608-614`.
Test: `P1 (N-1/X-1/N-3/N-4/N-11): tools/list ueber /mcp liefert mit Consult-Faehigkeit alle 12
Werkzeuge - Annotationen vollstaendig und tabellentreu, await_call_event nennt seinen
Schreibeffekt` (`test/mcp-tool-annotations.test.js:197`) — pruefte am realen `tools/list`-Wire-
Output, nicht am Config-Objekt.

**N-1 / X-1** — `readOnlyHint`, `destructiveHint`, `openWorldHint` als Required an allen zwoelf
Werkzeugen (OpenAI-Fassung gewinnt gegen die optionalen Felder der MCP-Spec bei Widerspruch);
`idempotentHint` bleibt bewusst optional. Alle sieben reinen Lese-Werkzeuge tragen jetzt
`destructiveHint: false` (vorher: bei drei fehlte das Feld ganz — `src/mcp-tools.js:659-714`).
Begruendungskommentar (vier Punkte, ersetzt den vorherigen, nach S2 falsch gewordenen Satz):
`:599-622`. Drift-Schutz-Test (faellt auch bei einem 13. Werkzeug ohne Annotationen auf):
`P0-1/P1 (X-1): kein registriertes Werkzeug kommt ohne die drei Pflicht-Annotationen durch`
(`test/mcp-tool-annotations.test.js:147`).

**N-3** — `answer_consult.destructiveHint: true`, weil der eingespeiste Text am Telefon
ausgesprochen und nicht zuruecknehmbar ist. `src/mcp-tools.js:652-658`. Begruendung im Kommentar
`:615-617`. Deckung: derselbe E2E-Test wie N-4 (`:197`), der mit `CONSULT_ENABLED=true` faehrt
(sonst erschiene das Werkzeug gar nicht).

**N-11** — Seiteneffekte duerfen nicht versteckt sein. `await_call_event` schreibt bei jedem
Aufruf zwei Felder an den Anruf-Datensatz; das steht jetzt in Klartext in der Beschreibung:
"Each call also writes to the call record: it notes that you polled and marks a pending
question as delivered." (`src/mcp-tools.js:589-597`, Konstante `AWAIT_CALL_EVENT_DESCRIPTION`,
ausgelagert auf Modulebene nach dem Muster `PLACE_CALL_DESCRIPTION`). Test (Positiv, Wire-Text):
`:197`, Assertion `/writes to the call record/` (`test/mcp-tool-annotations.test.js:239-243`).
Zusaetzlich ein **negativer** Test, der aus dem Runde-1-Review-Blocker entstand: die
Beschreibung darf NICHT behaupten, dass die Server-Seite selbst entdoppelt (das tut sie nicht —
`pendingConsult` in `state-ops.js` filtert nur auf `status`/`seq`, `askDeliveredAt` ist ein
reiner Beobachtungs-Zeitstempel ohne Sperrwirkung). Assertion:
`assert.doesNotMatch(..., /same question is not (handed out|delivered)/, ...)`
(`test/mcp-tool-annotations.test.js:248-252`). Die tatsaechliche Entdopplung leistet
ausschliesslich der client-gefuehrte Parameter `after_event_id`, und die Beschreibung sagt das
jetzt auch so (letzter Satz, `:597`).

**Alle fuenf IDs zusammen, Regressionsschutz:** `EXPECTED_ANNOTATIONS` /
`EXPECTED_CONSULT_ANNOTATIONS` als Literal-Tabellen (nicht aus `src/` importiert) in
`test/mcp-tool-annotations.test.js:20-107`, geprueft in drei unabhaengigen Testfaellen
(fakeServer ohne Consult, fakeServer mit Consult, echte `/mcp`-Route).

**Nebenwirkung, ebenfalls verifiziert:** der Lint-Pin fuer `registerTools` wurde von 512 auf 506
Zeilen nachgezogen (`eslint-legacy-exceptions.json`, Eintrag `src/mcp-tools.js`) — Funktion ist
durch die Auslagerung der Beschreibung geschrumpft, nicht gewachsen. Gemessener Wert stimmt mit
dem Pin exakt ueberein (Nachmessung s. Abschnitt 4). `test/check-staged-suppressions.test.js`
traegt die identische Reason-Zeile in seiner `LEGACY_FINGERPRINT`-Kopie nach (sonst haette das
Aufraeum-Gate selbst den Commit verweigert).

---

## 3. Beruehrte Pfade — Deckung

Vier Zugangswege existieren fuer MCP-Tools in diesem Repo: **HTTP `/mcp`**, **stdio**,
**mcp-nativer Adapter**, **ChatGPT-Adapter**. Alle vier lesen aus derselben Modultabelle
`TOOL_ANNOTATIONS` — es gibt in diesem Repo nur EINE Werte-Quelle
(`grep -rn "TOOL_ANNOTATIONS" --include="*.js" . --exclude-dir=node_modules` trifft nur
`src/mcp-tools.js` und seine beiden Testdateien, 0 Treffer sonst) und genau zwei Aufrufer von
`registerTools()`: `src/mcp-server.js:26` (stdio) und `src/routes/mcp.js:151` (HTTP; die beiden
UI-Adapter haengen an derselben HTTP-Route).

| Pfad | Erfuellt? | Belegform |
|---|---|---|
| HTTP `/mcp` | Ja | E2E-Test gegen den echten, laufenden Server (`:164`, `:197`) — direkter Beleg |
| stdio | Ja, indirekt | Ctx-Vergleichstest `P1 (DP-1)` (`:265`) + die zwei-Aufrufer/eine-Quelle-Struktur — struktureller Beleg, KEIN echter stdio-Prozesslauf |
| mcp-nativer Adapter | Ja, indirekt | Haengt an HTTP `/mcp`, kein eigener Registrierweg |
| ChatGPT-Adapter | Ja, indirekt | Dito |

Der Unterschied zwischen "direkt" (HTTP) und "indirekt" (stdio, beide Adapter) ist die bewusste
Luecke aus Abschnitt 1 — kein echter Kindprozess-Lauf ueber die stdio-Pipe existiert in diesem
Testkatalog, weder vor noch nach P1.

---

## 4. Was ein fremder Pruefer nachmessen sollte

Alle Befehle laufen im ausgecheckten Branch-Worktree (`phase/openai-p1-annotationen`,
`b8cb2db`). Formulierung bewusst neutral — die Kommandos beweisen nichts von sich aus, sie
liefern nur die Zahl/den Text, die der Pruefer selbst bewertet.

1. **Sind alle fuenf IDs am Wire-Output umgesetzt?**
   `NODE_ENV=test node --test test/mcp-tool-annotations.test.js` — welche Zahl steht hinter
   `# fail`? Trifft der Test `P1 (N-1/X-1/N-3/N-4/N-11): ...` zu, und pruefen seine
   Assertions (Zeilen 219-252 der Datei) tatsaechlich `deepEqual` gegen eine Wahrheitstabelle
   statt nur Existenz?
2. **Gibt es eine zweite Werte-Quelle, die divergieren koennte?**
   `grep -rn "TOOL_ANNOTATIONS" --include="*.js" . --exclude-dir=node_modules` — wie viele
   Dateien ausser `src/mcp-tools.js` und seinen beiden Testdateien tauchen auf?
   `grep -rn "registerTools(" --include="*.js" src/` — wie viele Aufrufer, welche Dateien?
3. **Ist der Lint-Pin ehrlich?**
   `npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js 2>&1 |
   grep max-lines-per-function` — welche Zahl liefert das, und steht dieselbe Zahl im
   `reason`-Feld von `eslint-legacy-exceptions.json` unter `src/mcp-tools.js`? Traegt
   `test/check-staged-suppressions.test.js` dieselbe Zahl in seiner `LEGACY_FINGERPRINT`-Kopie?
4. **Behauptet die neue Beschreibung etwas Falsches?**
   `grep -n "AWAIT_CALL_EVENT_DESCRIPTION" -A 9 src/mcp-tools.js` lesen — steht dort eine
   Aussage ueber serverseitige Entdopplung? Dann in `src/store/state-ops.js` nach
   `pendingConsult` suchen: filtert die Funktion tatsaechlich nur auf `status`/`seq`, oder
   spielt `askDeliveredAt` doch eine Sperrrolle?
5. **Ist der Emphase-Pin (Regressionsfang einer anderen Kette) unangetastet?**
   `git diff master..HEAD -- test/p15-mcp-tool-descriptions-en.test.js` — leer oder nicht?
   `NODE_ENV=test node --test test/p15-mcp-tool-descriptions-en.test.js` — welche `# fail`-Zahl?
6. **Landet ein neuer Testname im falschen Testlauf (Katalog-Kollision)?**
   Die Testnamen aus `test/mcp-tool-annotations.test.js` gegen
   `package.json` `config.i18nCatalogPattern` pruefen (`^(Charakterisierung
   )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]`) — trifft das
   Muster auf einen der Namen zu?
7. **Stimmt die Gesamtzahl?**
   `npm test -- -- --test-concurrency=4` — welche Werte stehen hinter `# pass`/`# fail` (nicht
   der Exit-Code, der Exit-Code ist fuer diese Suite bekanntlich nicht aussagekraeftig)? Wie
   viele Tests mehr/weniger als vor dieser Kette (Vergleichswert: `master`-Stand)?
8. **Ist `format:check` wirklich nur ein Vorbestand?**
   `git checkout --detach master` (bzw. den `master`-Commit vor dieser Kette) und dort
   `npm run format:check | tail -1` gegen denselben Befehl auf dem Branch vergleichen — wie
   gross ist die Differenz in der Dateizahl, und liegt `src/mcp-tools.js` auf BEIDEN Staenden
   in der Warnliste?
9. **Ist der Branch-Stand der richtige?**
   `git log --oneline master..phase/openai-p1-annotationen` — wie viele Commits, welcher ist
   HEAD? Enthaelt der zweite Commit eine Verhaltensaenderung an der Werkzeug-Beschreibung
   gegenueber dem ersten?

---

## 5. Restrisiko

Der eigentliche fachliche Kern der Phase — zwoelf Werkzeuge, fuenf IDs, eine Werte-Quelle,
Wire-Level-Tests statt Config-Objekt-Tests — ist solide belegt und fuer diesen Bericht
unabhaengig nachgemessen worden (Suite isoliert: 47/47 in den beiden neuen/geaenderten
Testdateien zusammen, 41/41 in `check-staged-suppressions.test.js` allein, 146/146 in fuenf
weiteren Dateien, die `await_call_event` ebenfalls beruehren, 8/8 im Emphase-Pin-Test, und
6155/6155 im vollen `npm test`-Lauf mit `--test-concurrency=4` — alle Zahlen in diesem Bericht
frisch gemessen, nicht aus den TATSACHEN uebernommen). Das groesste **strukturelle** Restrisiko
ist die bewusste Nicht-Abdeckung von stdio ueber einen echten Prozesslauf (Punkt 1 oben): sollte
das MCP-SDK stdio und HTTP intern unterschiedlich behandeln (z. B. eine andere Serialisierung
der `annotations`), wuerde das aktuell NICHT auffallen, weil kein Test tatsaechlich ueber die
stdio-Pipe spricht — nur ueber denselben In-Process-`registerTools()`-Aufruf mit unterschiedlichem
`ctx`. Das Risiko ist von der Phase selbst benannt und bewusst vertagt (P2/P3 haben dort laut
Spec groesseren Nutzlast-Bedarf), nicht verschwiegen. Das zweite Risiko ist prozessual, nicht
inhaltlich: die TATSACHEN dieses Auftrags nannten einen um einen Fix-Commit veralteten
Commit-Hash (`272db48` statt `b8cb2db`) — waere dieser Bericht unbesehen auf `272db48`
geschrieben worden, haette er eine seither korrigierte Falschaussage im Werkzeug-Text
("serverseitige Entdopplung") als Endzustand bestaetigt. Fuer diesen Bericht wurde stattdessen
der tatsaechliche Branch-HEAD geprueft. Drittens: die "999 Dateien"-Zahl fuer `format:check` in
den TATSACHEN ist eine Verwechslung zwischen dem kontaminierten Haupt-Arbeitsverzeichnis (mit
unbezogenen uncommitteten Dateien aus einer parallelen Session) und dem sauberen Branch-Stand
(849) — inhaltlich folgenlos fuer die Merge-Entscheidung, weil `format:check` ohnehin kein
Abnahmekriterium dieser Phase ist, aber ein Hinweis, dass mindestens eine Zahl in den TATSACHEN
ungeprueft aus einer verschmutzten Umgebung stammt statt aus einem sauberen Checkout.

---

*Bericht erstellt 2026-09-20 durch unabhaengige Nachmessung am Branch-Stand `b8cb2db`
(scratchpad-Worktree). Kein Code in diesem Repo wurde durch die Berichtserstellung veraendert
(zwei `git checkout --detach`-Ausfluege zur Vergleichsmessung wurden auf den Branch
zurueckgesetzt).*
