# AL-P17 — Die erste Modellrunde hoerbar machen (Befund D-1)

**Kontext:** `tasks/al-handover-2026-08-01.md` §4 Punkt 3 (Befund D-1) und die Messung
`tasks/al-d2-diagnose.md` §3. **Basis:** `master` @ `8461b69`.
**Das ist eine VERHALTENS-Aenderung auf dem Sprechpfad eines laufenden Telefonats.**
Sie ist die riskanteste Phase dieser Kette. Entsprechend eng ist der Rahmen.

---

## 0. Warum diese Phase, in einem Absatz

AL-D2 hat gemessen: in **18 von 21** Live-Turns rief das Modell kein Werkzeug. Ein solcher
Turn ist **eine** Modellrunde, deren Text die fertige Antwort ist. Die vom Owner gehoerten
Pausen (0,9–3,0 s) sind die Dauer genau dieser einen Runde. Das Denk-Signal kann dort per
Konstruktion nicht wirken (`speakBridge` laeuft erst NACH der Runde). Der einzige Mechanismus
im Repo, der diese Latenz adressiert, ist der Satz-Chunker aus AL-P7 (`streamSinkFor`) — und
der armiert heute **nie**, weil `look_up` in jedem Turn im angebotenen Werkzeugsatz liegt.

Ziel der Phase: **der erste fertige Satz der Antwort geht raus, sobald er fertig ist, statt
am Ende der Runde.** Nichts weiter.

---

## 1. Owner-Entscheidungen (2026-08-01, bindend)

**O-D1-A — Die Armierungsregel wird PRAEZISIERT, nicht gelockert.**
Gesperrt wird nur, wenn im angebotenen Werkzeugsatz ein Werkzeug liegt, das bereits
gesprochenen Text **ersetzen** kann. `look_up` gehoert nicht dazu: bei einer Runde mit Text +
`look_up` ist der fuehrende Text exakt das, was das Denk-Signal ohnehin spraeche — Streaming
und Bruecke sagen dort dasselbe, nur frueher.

**O-D1-B — Consult-Kollision: nur der Modellsatz.**
Hat das Modell in einer armierten Runde bereits selbst ueberbrueckt und ruft dann
`get_consult`, entfaellt der deterministische Consult-Fueller. Sagt das Modell nichts
(`speechStreamed === false`), springt der Fueller **unveraendert** ein.
Ausdruecklich akzeptierte Folge: die AL-P14-Zusage „der Haltesatz ist LLM-frei" gilt in
**genau diesem einen** Fall nicht mehr. Das ist eine bewusste Owner-Entscheidung und gehoert
als solche in den Code-Kommentar und in `tasks/al-chain-state.md`.

---

## 2. Drei Aenderungen, mehr nicht

### E1 — `streamSinkFor`: ALLOWLIST erweitern, NICHT in eine Denylist drehen

Bedingung 2 lautet heute: jedes angebotene Werkzeug muss ein Seiteneffekt-Werkzeug sein.
Sie wird erweitert auf die Menge der **strom-sicheren** Werkzeuge.

**Hart bindend: die Regel bleibt eine ALLOWLIST.** Der heutige Bau hat eine Eigenschaft, die
nicht verloren gehen darf (G27, im Quellkommentar von `streamSinkFor` ausdruecklich genannt):
*ein kuenftiges, unbekanntes Werkzeug schaltet das Streamen von selbst ab.* Eine Regel der
Form „sperre bei `get_consult`" ist eine **Denylist** und faellt bei jedem neuen Werkzeug
**fail-open** — genau die Klasse Regression, die dieses Repo nicht baut. Die neue Bedingung
muss also lauten: *jedes angebotene Werkzeug ist bekannt und strom-sicher*, sonst `null`.

Die Zugehoerigkeit gehoert an **eine** Stelle (G5) — dorthin, wo heute
`SIDE_EFFECT_ONLY_TOOL_NAMES` steht. Ein Test muss nachweisen, dass ein **erfundenes**,
unbekanntes Werkzeug im Satz das Streaming abschaltet.

Bedingung 1 (`onSpeechChunk`) und Bedingung 3 (Frist) bleiben **unveraendert**.

### E2 — Doppelrede-Riegel: die Bruecke schweigt, wenn der Text schon auf der Leitung liegt

Heute garantiert `sideEffectOnlyRound` die Ausschliesslichkeit von Streaming und Bruecke:
eine armierte Runde ist nie eine Runde, die den Loop fortsetzt. **Mit E1 faellt diese
Garantie weg** — eine Runde mit Text + `look_up` wuerde ihren Text streamen und ihn danach
ueber `speakBridge` ein **zweites Mal** sprechen.

Also: die Bruecke feuert nicht, wenn der Text dieser Runde bereits gestreamt wurde. Der
Anrufer hoert denselben Satz wie bisher — nur frueher. Das ist ein **Korrektheitsriegel**,
keine Geschmacksfrage, und braucht einen Test, der ohne ihn rot ist.

**Diagnose-Ehrlichkeit:** `thinkingSignalSpoken` darf danach nicht zweideutig werden. Der
Plan entscheidet und begruendet, ob das Feld „die Bruecken-Funktion hat gesprochen" bleibt
(dann traegt `streamChunks`/`streamArmedRounds` den Fall) oder „dieser Turn hat ueberbrueckt"
bedeutet. **Eine** Lesart, im Kommentar festgeschrieben — die Live-Abnahme haengt daran.

### E3 — Consult-Fueller entfaellt bei bereits gestreamtem Text (O-D1-B)

Im `consult?.accepted`-Zweig von `agentTurn` wird `speech` heute unbedingt durch
`consult.speech` ersetzt und `speechStreamed` auf `false` gesetzt. Kuenftig nur noch, wenn
nichts gestreamt wurde. War bereits Text auf der Leitung, bleibt er stehen.

**Bewusst NICHT geaendert:** das Consult selbst (Kontingent, Frische, Timeout,
Mandats-Fallback, Laengenbegrenzung/Paraphrase-Pflicht aus AL-P14). Nur die Frage, welcher
Satz gesprochen wird.

---

## 3. Nicht-Ziele (harte Grenze)

- **Kein Prompt-Eingriff** am Tool-Entscheidungspunkt — das ist D-3, die naechste Phase.
- **Der K4-Befund aus AL-D2 bleibt offen** (`look_up` ohne fuehrenden Text ⇒ Stille waehrend
  der Suche). Diese Phase loest ihn NICHT und behauptet das auch nicht.
- **Bedingung 3** (`roundFitsDeadline`) wird nicht angefasst.
- **Keine** neue Env-Variable, **kein** neues Flag. Begruendung: `TELNYX_SHIM_TOKEN_STREAMING`
  existiert bereits und ist der Schalter dieser Faehigkeit; ein zweites Flag fuer „die neue
  Armierungsregel" waere ein Schalter, den niemand je auf den alten Wert zurueckdreht.
  Der Rueckweg ist das bestehende Flag.
- **Keine** Aenderung an Safety-Gates, Offenlegung, Auth, Geldpfad, Kostenbuchung.
  Insbesondere bleibt die Buchungsregel aus `completeRound` unangetastet (genau EIN
  `bookTokenUsage` je Modellrunde, auch im Abrissfall).
- **Keine** echten Anrufe zur Verifikation. Alles offline.

---

## 4. Pre-Mortem — was in einem Jahr schiefgegangen sein koennte

| Szenario | Riegel in dieser Phase |
|---|---|
| **Doppelrede.** Der Anrufer hoert denselben Satz zweimal. | E2, mit einem Test, der ohne den Riegel rot ist |
| **Zwei Haltesaetze.** „Einen Moment" + Consult-Fueller. | E3, Test fuer beide Richtungen (mit/ohne gestreamten Text) |
| **Fail-open bei neuem Werkzeug.** Jemand fuegt ein Werkzeug hinzu, das Text ersetzt; das Streaming laeuft weiter und spricht Falsches. | E1 bleibt ALLOWLIST; Test mit erfundenem Werkzeug |
| **Halbe Antwort + Fehlersatz.** Reisst die Modellrunde nach dem ersten gestreamten Satz ab, haengt der Shim den Degradations-Satz an das bereits Gesprochene. Heute selten (armierte Runden sind selten), nach E1 der **Normalfall**. | Der Plan MUSS diesen Pfad (`catch` in `telnyx-llm-shim.js`, `wire.finish(content)`) ausdruecklich bewerten und entweder als akzeptiertes Risiko begruenden ODER entschaerfen. **Nicht uebergehen.** |
| **Transkript weicht von der Leitung ab.** `shapeForSpeech` laeuft nach dem Streamen. | Bestandsgrenze aus AL-P7 — im Bericht benennen, nicht stillschweigend erben |
| **Der Gewinn wird behauptet, nicht gemessen.** | §5: die Abnahme ist eine Draht-Reihenfolge, keine Prosa |
| **Die Kostenbuchung kippt.** Gestreamte Runden buchen anders als nicht-gestreamte. | Buchungsregel unberuehrt; ein Test pinnt genau EIN `bookTokenUsage` je Runde im gestreamten Gutfall |
| **Ein Safety-Notaus wird unhoerbar.** Budget-Notaus/Loop-Guard sprechen nach bereits gestreamtem Text. | Der Plan prueft, dass `killCallForBudget` und der Loop-Guard weiterhin hoerbar sind |

---

## 5. Abnahme (deterministisch, offline)

Neue Tests `AL-P17-*`, Muster und Werkzeuge wie
`test/al-d2-thinking-signal-diagnostics.test.js` (Shim-Harness mit echtem SSE, gemeinsame
Fixtures aus `test/anthropic-sse-fixtures.js`).

1. **Der Kernbeweis.** Live-Werkzeugsatz (`look_up` UND `get_consult` angeboten), Modell
   antwortet mit **Text ohne Werkzeug** — also die Klasse mit 18/21 Live-Anteil. Erwartet:
   `streamArmedRounds === 1`, und auf dem SSE-Draht liegen **mehrere** content-Deltas, deren
   erstes der erste fertige Satz ist — **vor** dem Rest. Zum Vergleich: derselbe Fall auf
   `master` liefert genau **ein** Delta am Ende (das ist AL-D2-1, heute gruen).
2. **Doppelrede-Riegel** (E2): Text + `look_up`. Der Satz steht **genau einmal** auf dem
   Draht. Ein Test, der ohne den Riegel rot ist.
3. **Consult-Kollision** (E3), beide Richtungen: mit gestreamtem Text ⇒ **kein** Fueller,
   Modellsatz steht; ohne gestreamten Text ⇒ Fueller **unveraendert** wie heute.
4. **Fail-closed** (E1): ein erfundenes, unbekanntes Werkzeug im angebotenen Satz ⇒
   `streamArmedRounds === 0`.
5. **Kostenbuchung**: genau EIN `bookTokenUsage` je Modellrunde im gestreamten Gutfall.
6. **Mutationsprobe** je Riegel (E1, E2, E3): mutieren, selektives Rot beobachten, Mutation
   zuruecknehmen, Suite wieder gruen. Ergebnis in den Bericht.
7. `npm test` gruen, roter Lauf mitgeschnitten. `npm run test:gates` auf der dokumentierten
   Baseline (3 rot: GAP-05, GAP-15 zweimal). `node --check` je geaenderter Datei.
8. **Bestandstests:** `AL-P7-20` und die AL-P7b-Tests pinnen das ALTE Armierungsverhalten.
   Sie duerfen angepasst werden — aber **jede** Anpassung wird im Bericht einzeln begruendet
   („welche Zusage galt vorher, welche gilt jetzt, warum ist das die Absicht"). Eine
   stillschweigend abgeschwaechte Assertion ist ein Blocker.
9. **Smoke:** Server lokal starten, `/healthz`, plus ein Shim-Turn per `curl` mit
   `stream:true` — dass der Draht real spricht, nicht nur im Test.

**Bericht:** `tasks/al-p17-diagnose.md` — was gemessen wurde, die Draht-Reihenfolge vorher/
nachher, die Bewertung des Abriss-Pfads aus dem Pre-Mortem, jede angepasste Bestandsassertion
mit Begruendung, und was offen bleibt (K4).
