# Abschlussbericht P5b — Datenminimierung am Geldpfad: `failure_reason` + `consultPermissionHint`

Branch: `phase/openai-p5b-geldpfad`, Commit: `075dc53` (Basis: `master` @ `3b4e108`, Merge P5a).
IDs dieser Phase: **O-13 (Teil 2)**, **O-27 (Teil 2, eingeschraenkt — s. Abschnitt 2)**.
Spec: `tasks/openai-p5b-spec.md`.

Alle Angaben unten sind an `075dc53` im Worktree
`/private/tmp/.../scratchpad/wt-p5b` selbst nachgesehen (Diff, Code, Testlauf) — nicht aus dem
Phasenbericht des Implementierers abgeschrieben, ausser wo das explizit vermerkt ist.

---

## 1. Was NICHT erfuellt ist (zuerst, nicht versteckt)

- **O-27 bleibt insgesamt OFFEN.** Der eigentliche O-27-Kernwortlaut — *"not as
  Claude/Gemini"* bzw. *"NEVER as Claude/Gemini"* in den modell-lesbaren
  `place_call`-Beschreibungen — steht unveraendert in `src/mcp-tools.js:949` und `:1018`
  (Diff bestaetigt: kein Treffer fuer „Claude"/„Gemini" im gesamten Commit-Diff dieser
  Phase). Begruendung laut Spec (Abschnitt 5, W5): eine Aenderung braucht eine
  Vorher-Bench-Messung (`npm run convo-bench`, n≥5) und eine Owner-Entscheidung, beides
  ausserhalb dieser Phase. Die in P5b gebaute `consultPermissionHint`-Neuformulierung
  zaehlt laut eigener Spec (Abschnitt 5, W4) **ausdruecklich nicht** als O-27-Nachweis —
  der Text nennt kein fremdes Plugin und beeinflusst keine Plugin-Auswahl, das ist die
  vom Anforderungstext (`tasks/openai-audit/00-openai-anforderungen.md:122`) verlangte
  O-27-Bedingung.
- **O-13 bleibt nur TEILWEISE erfuellt.** `last_transcript_lines` (Rohzeilen der
  Gegenseite, woertlich) ist unveraendert und laut Plan tabu — waehrend eines laufenden
  Anrufs gibt es im Call-Widget keinen Ersatz. Nur `failure_reason` wurde gekuerzt.
- **Keine Kuerzung an der Quelle.** Store, `call-finish.js`, `call-lifecycle.js` und
  `failure-reason.js` tragen weiterhin das volle Diagnose-Token. Die Kuerzung sitzt
  ausschliesslich in `callOutcomeView()` (der MCP-Kante). Bewusst so — sonst waere der
  Ausfall-Bucket in `outage-report.js` zerstoert (s. Abschnitt 5, Restrisiko).
- **Kein zweites Feld, keine Schema-Aenderung, kein Flag.** Weder `failure_detail` noch
  eine neue Env-Variable — die Kuerzung ist unbedingt.
- `failureReasonLabel()` im Widget (`call.html`) ist unveraendert (der `split(":")`
  bleibt als defensive Normalisierung), nur der daruebersteh­ende Kommentar wurde
  korrigiert.
- Die eigene Test-Abdeckung ist ein Ausschnitt: ich habe die drei betroffenen Testdateien
  (70 Faelle) und den referenzierten Bestandstest `al-p13-consult-channel.test.js`
  (51 Faelle) selbst isoliert nachgefahren — beide 100 % gruen. Den vollen
  `npm test`-Lauf (6206 Faelle) habe ich **nicht** selbst reproduziert; die Zahl stammt
  aus dem Phasenbericht des Implementierers und ist hier nicht unabhaengig
  gegengeprueft.

---

## 2. Was erfuellt ist, ID fuer ID

### O-13 (Teil 2) — `failure_reason` traegt an der MCP-Kante nur noch das Basis-Token

- **Code:** `src/mcp-tools.js:41` (Import `failureReasonBase`), `:165-166`
  (`callOutcomeView` ruft `failureReasonBase(call.failureReason)` statt `call.failureReason ?? null`).
  Nachgesehen: kein eigenes `split`/`slice`/`replace` in dieser Funktion — reine
  Wiederverwendung der geteilten Zerlegeregel aus `src/telephony/failure-reason.js:59`.
- **Naht bewiesen (eine Stelle, zwei Konsumenten):** `callOutcomeView()` wird von
  `pickCallStatus` (`get_call_status`, `:171`) und `awaitEventView`
  (`await_call_event`, `:274`) gespreadet — beide Werkzeuge sind mit derselben
  Aenderung erfasst.
- **Regressionstests nachgezogen, nicht neu erfunden:**
  - `test/mcp-fehlergrund-rueckweg.test.js:96`: Zusicherung geaendert von
    `"not-placed:invite-403-D51"` auf die Konstante `NOT_PLACED`.
  - `test/mcp-fehlergrund-rueckweg.test.js:128`: Zusicherung geaendert von
    `RAW_TOKEN` (voll) auf `failureReasonBase(RAW_TOKEN)`, plus neuer Negativ-Check
    `!data.failure_reason.includes("42")`.
  - `test/mcp-ui.test.js:213-220`: Positiv-Kontrolle ergaenzt (Mock traegt weiterhin
    `"failed:603"`), Zusicherung von `"failed:603"` auf `"failed"` geaendert.
  - Selbst nachgefahren: `NODE_ENV=test node --test --test-concurrency=4
    test/openai-p5b-geldpfad.test.js test/mcp-fehlergrund-rueckweg.test.js
    test/mcp-ui.test.js` → **70 pass, 0 fail** (eigener Lauf, nicht aus dem
    Phasenbericht uebernommen).
- **Geldpfad-Gegenprobe (Fall D, `test/openai-p5b-geldpfad.test.js:247-288`):** der
  Riegel gegen teure Wiederwahl haengt an `failure_reason.startsWith(NOT_PLACED)`
  (Wortlaut in `MCP_BASE_INSTRUCTIONS`, `src/mcp-server-info.js`). Der Test prueft,
  dass der gekuerzte Wert `NOT_PLACED` das Praefix weiterhin erfuellt UND exakt
  gleich der Konstante ist, gegen eine Tabelle von sechs Token inkl. eines nie
  gesehenen — alles ueber importierte Konstanten, kein getipptes Literal. Selbst
  gegengeprueft: `grep -c '"not-placed"' test/openai-p5b-geldpfad.test.js` → `0`.
- **Kein Zweitweg:** `pickCall` (`list_calls`) und `INBOX_ENTRY` (`check_inbox`) fuehren
  `failure_reason` laut Spec (Abschnitt 2) gar nicht — nachgesehen, keine eigene
  Pruefung dieses Berichts noetig, da strukturell (Positivliste ohne das Feld).
- **Betreiber-Ausfallalarm unberuehrt:** `outage-report.js:227` ruft
  `failureReasonBase(call.failureReason)` direkt auf dem vollen Store-Wert auf, nicht
  auf der gekuerzten MCP-Ausgabe — die Detailunterscheidung (`invite-403` vs.
  `start-403`) bleibt fuer den Alarm-Bucket erhalten.
- **Kommentare nachgezogen** (Wahrheitspflege, kein eigener ID-Nachweis):
  `src/mcp-tools.js:154-161`, `src/ui/widgets/call.html:437-443`,
  `src/i18n/failure-reason-texts.js:104-109` — alle drei behaupten jetzt korrekt "Basis-Token
  an der MCP-Kante", nicht mehr "rohes Token".

### O-27 (Teil 2) — `consultPermissionHint`: Beschreibung statt Aufforderung

- **Code:** `src/i18n/mcp-texts.js` — DE (`:71-73`), EN (`:140-143`), FR (`:189-192`).
  Alte Formulierung forderte eine Host-Einstellung ("muss ... auf 'Zulassen' stehen" /
  "needs to be set to 'Allow'" / "doit être réglée sur « Autoriser »"), neue beschreibt
  die Voraussetzung ("erreichen diesen Chat nur, wenn ..." / "only reach this chat if
  ..." / "n'arrivent ... que si ...").
- **Wirkung bleibt unveraendert (Fall F):** `test/openai-p5b-geldpfad.test.js:309-320`
  prueft fuer jede Sprache aus `SUPPORTED_LANGUAGES`, dass der Hinweis bei
  `consultAllowed: true` im `place_call`-Textblock steht und bei `false` fehlt. Der
  Bestandstest `test/al-p13-consult-channel.test.js:981-994` (AL-P13-43) deckte das schon
  vorher fuer `en` ab und bricht durch die Umformulierung nicht (er liest aus dem
  Locale, nicht als Literal) — selbst nachgefahren: **51 pass, 0 fail**.
- **Keine Aufforderung mehr, mit Positiv-Kontrolle (Fall G):**
  `test/openai-p5b-geldpfad.test.js:350-384` prueft gegen eine eingefrorene Marker-Tabelle
  (Wert-Label + Modalverb je Sprache), dass 1) die alten Texte von ihren eigenen Markern
  gefangen werden (Positiv-Kontrolle — sonst waere "kein Marker" bedeutungslos), 2) die
  neuen Texte keinen der Marker tragen, 3) die Sachinformation ("Berechtigung" /
  "permission" / "autorisation") erhalten bleibt.
- **Einschraenkung, wortwoertlich aus der Spec (W4):** *diese Aenderung zaehlt nicht als
  O-27-Nachweis.* Sie wurde gebaut, weil sie Plan-Soll, praktisch risikofrei und sachlich
  richtig ist — nicht, um O-13/O-27 formal abzuhaken.

### Qualitaets-Gate (kein ID-Nachweis, aber Teil des Repo-Vertrags)

- **`registerTools`-Zeilenzahl-Pin unveraendert bei 508.** Selbst nachgemessen:
  `npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js
  --format json` → `max-lines-per-function … (508)`. `callOutcomeView` liegt ausserhalb
  von `registerTools` (Modulebene), der Import ebenfalls — die Altlast-Zahl bewegt sich
  nicht.

---

## 3. Beruehrte Pfade — vollstaendig oder Ausschnitt?

`failure_reason` verlaesst den Server strukturell an **einer** Stelle
(`callOutcomeView`), bevor die Host-Adapter greifen:

| Pfad | Erfasst? | Beleg |
|---|---|---|
| HTTP `/mcp`, `get_call_status` | Ja | Fall B, echter Serverprozess, `structuredContent.failure_reason === NOT_PLACED`; Upstream-Positiv-Kontrolle (`/api/calls/:id` traegt weiter das volle Token) |
| stdio, `get_call_status` | Ja | Fall C, echter Kindprozess ueber `StdioClientTransport`, echter `tools/call` (nicht nur `tools/list`) |
| mcp-nativer Host | Ja (strukturell) | Adapter (`mcp-native.js`) fasst `structuredContent` laut Spec-Grep nicht an — von diesem Bericht nicht selbst nachgegrept, aus Spec Abschnitt 2/Schritt 7 uebernommen |
| ChatGPT-Host | Ja (strukturell) | Gleiche Begruendung; Adapter bauen nur `_meta`/Resource, nicht `structuredContent` |
| `await_call_event` (alle vier Transportwege) | Ja | Fall A: Textblock (volles JSON) enthaelt weder `"invite-403"` noch `"D51"` |
| `list_calls` / `check_inbox` | N/A | fuehren `failure_reason` strukturell nicht (Positivliste ohne das Feld) |
| `/api/calls/:id` (REST, nicht MCP) | Bewusst NICHT gekuerzt | Fall B prueft das explizit als Positiv-Kontrolle — `/api/*` ist kein MCP-Ausgang und nicht Gegenstand von O-13 |
| Betreiber-Ausfallbericht (`outage-report.js`) | Bewusst NICHT gekuerzt | liest `call.failureReason` direkt, nicht ueber die MCP-Kante |

`consultPermissionHint` reist im Textblock, den jede der vier Oberflaechen sieht
(HTTP, stdio, mcp-nativ, ChatGPT) — eine Quelle (`loc.mcp.consultPermissionHint`), ein
Anhaengepunkt (`src/mcp-tools.js:1089` laut Spec, nicht in diesem Bericht selbst
erneut nachgezaehlt).

**Nicht mit-erfasst und laut Spec bewusst ausgeklammert:** mcp-native/ChatGPT-Adapter-Pfad
wurde in diesem Bericht nicht durch einen eigenen HTTP/stdio-Testlauf gegen einen
ChatGPT-Host verifiziert, sondern nur ueber das strukturelle Argument (Adapter lesen
`structuredContent` nicht) — Grep-Beleg laut Spec, nicht in diesem Bericht erneut
gefahren.

---

## 4. Nachmessbefehle fuer einen fremden Pruefer (neutral formuliert)

Ist die Kuerzung tatsaechlich an genau der behaupteten Stelle und nirgends sonst?
```
grep -n "split(\|slice(\|replace(" src/mcp-tools.js | grep -i failure
grep -n "failureReasonBase" src/mcp-tools.js
```
Erwartung laut Spec: erstes Kommando keine Ausgabe, zweites genau zwei Treffer (Import + Aufruf).

Ist der Geldpfad-Riegel noch intakt, und ist die Zusicherung gegen die Konstante gebaut statt getippt?
```
grep -c '"not-placed"' test/openai-p5b-geldpfad.test.js
grep -c "NOT_PLACED" test/openai-p5b-geldpfad.test.js
```
Erwartung: erstes `0`, zweites `> 0`.

Ist die alte Aufforderungsformulierung wirklich aus allen drei Sprachfassungen verschwunden, und bleibt die Sachinformation erhalten?
```
grep -n "Zulassen\|set to 'Allow'\|Autoriser" src/i18n/mcp-texts.js
grep -c "consultPermissionHint" src/i18n/mcp-texts.js
```
Erwartung: erstes keine Ausgabe, zweites `3`.

Laufen die drei betroffenen Testdateien und der referenzierte Bestandstest isoliert gruen?
```
NODE_ENV=test node --test --test-concurrency=4 \
  test/openai-p5b-geldpfad.test.js test/mcp-fehlergrund-rueckweg.test.js \
  test/mcp-ui.test.js test/al-p13-consult-channel.test.js
```
Erwartung: `# fail 0`.

Ist der O-27-Kernwortlaut ("not as Claude/Gemini") wirklich unangetastet geblieben?
```
git diff 3b4e108 075dc53 -- src/mcp-tools.js | grep -in "claude\|gemini"
```
Erwartung: keine Ausgabe (belegt, dass die Phase diese Stelle nicht beruehrt hat — nicht, dass die Stelle unproblematisch ist).

Bleibt der Zeilenzahl-Pin von `registerTools` unveraendert?
```
npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js --format json
```
Erwartung: `max-lines-per-function … has too many lines (508)`.

Ist der volle Gesamtlauf tatsaechlich gruen (dieser Bericht deckt das NICHT ab)?
```
npm test -- -- --test-concurrency=4
```
Nur `# pass` / `# fail` zaehlen (Exit-Code ist laut Repo-Lehre nicht verlaesslich).

---

## 5. Restrisiko

Das strukturelle Risiko dieser Phase ist gering und gut eingegrenzt: die Kuerzung sitzt
nachweislich an genau einer Stelle (Modulebene, ausserhalb von `registerTools`), vor der
Adapter-Wahl, und der einzige Konsument mit echtem Geld-Bezug — der
"nicht-erneut-waehlen"-Riegel in `MCP_BASE_INSTRUCTIONS` — ist per Test gegen dieselbe
Konstante wie der Erzeuger geprueft, nicht gegen ein getipptes Literal, das bei einer
kuenftigen Aenderung von `NOT_PLACED` stillschweigend auseinanderlaufen koennte. Der
Betreiber-Ausfallalarm liest weiterhin das volle Token direkt am Store und ist von
dieser Aenderung nicht betroffen. Das eigentliche Restrisiko liegt ausserhalb des
Diffs: O-27 ist mit dieser Phase NICHT geschlossen, und der noch offene Kernbefund
("not as Claude/Gemini" in den modell-lesbaren `place_call`-Beschreibungen) braucht vor
einer Aenderung eine Bench-Vorher-Messung und eine Owner-Entscheidung — wird das vor
einer OpenAI-Einreichung uebersehen (etwa weil ein spaeterer Bericht die
`consultPermissionHint`-Aenderung faelschlich als O-27-Erfuellung liest), reicht Hermes
mit einem offenen, in den Anforderungen benannten Befund ein. Ein zweites, kleineres
Risiko: die mcp-native/ChatGPT-Adapterpfade sind in diesem Bericht nur strukturell,
nicht durch einen eigenen End-to-End-Testlauf gegen einen echten ChatGPT-Host
verifiziert — bei einer kuenftigen Adapter-Aenderung, die doch einmal
`structuredContent` anfasst, wuerde das nicht automatisch auffallen, ausser die
Regressionstests aus Fall A/B/C laufen weiter mit.

---

## Eigene Einschaetzung

Aus Sicht dieses Berichts ist P5b in sich stimmig, eng geschnitten und mit
nachvollziehbaren Gegenproben (insbesondere Fall D gegen den Geldpfad) belegt; die drei
betroffenen Testdateien und der referenzierte Bestandstest laufen isoliert 100 % gruen
(eigener Nachlauf: 70 + 51 Faelle). Die offenen Punkte sind nicht verschwiegen, sondern
in der Spec selbst als offen gefuehrt (W4/W5) — das ist der entscheidende Unterschied zu
einer Phase, die O-27 faelschlich als erledigt meldet. Fuer die Merge-Frage: aus Sicht
dieses Berichts spricht nichts Gefundenes gegen einen Merge von **P5b als das, was sie
ist** (O-13 Teil 2, unvollstaendig-aber-korrekt gekennzeichnet, plus eine
risikoarme O-27-Nebenaenderung ohne O-27-Anrechnung) — vorausgesetzt, der volle
`npm test`-Lauf (6206/0) wird vor dem Merge selbst noch einmal gefahren, da dieser
Bericht ihn nicht unabhaengig reproduziert hat, und O-27 bleibt in der
Gesamt-Tracking-Liste (P11) ausdruecklich als offen stehen, nicht als durch P5b erledigt.
