# P5b — Datenminimierung am Geldpfad: `failure_reason` + `consultPermissionHint`

IDs: **O-13 (Teil 2, SIP-/Carrier-Detail in `failure_reason`)**, **O-27 (Teil 2, `consultPermissionHint`)**.
Quellen in Rangfolge: `tasks/PLAN-OPENAI-TECHNIK.md` (Abschnitt "P5b", Zeilen 579-648),
`tasks/openai-p0-entscheidungen.md`, `tasks/openai-audit/00-openai-anforderungen.md`.
Alle Zeilenangaben sind am Stand von `master` (Merge `3b4e108`, P5a) nachgesehen, nicht
aus dem Plan abgeschrieben. Wo Plan und Code auseinandergehen, steht es in Abschnitt 5.

**Testkommando dieser Phase:** `npm test -- -- --test-concurrency=4`. Nur der doppelte
`--`-Trenner kommt an. Der Exit-Code luegt — es zaehlen ausschliesslich die Zeilen
`# pass` / `# fail`. Grundlinie auf master: **6199 Faelle, 6198 gruen**; der eine rote ist
jedes Mal ein anderer Flake und zaehlt erst, wenn er ISOLIERT erneut rot ist. Die Ausgabe
wird NIE abgeschnitten.

---

## 1. Was diese Phase tut, in einem Satz

Der an MCP-Clients ausgelieferte `failure_reason` traegt nur noch sein **Basis-Token**
(`not-placed`, `unreachable`, `failed`, …) statt des vollen Diagnose-Tokens
(`not-placed:invite-403-D51`) — erzeugt durch **Wiederverwendung** von
`failureReasonBase()`, an **genau einer** Stelle, **ohne** das `not-placed`-Praefix zu
brechen; und der tenant-sichtbare `consultPermissionHint` beschreibt die Voraussetzung,
statt eine Einstellung zu fordern.

**Der Geldpfad in einem Satz:** der Riegel gegen teure Wiederwahl haengt an
`failure_reason.startsWith("not-placed")`. Der Satz steht in `MCP_BASE_INSTRUCTIONS`
(`src/mcp-server-info.js:97`) und ist von P4 in die ersten 512 Zeichen der Server-
`instructions` gepinnt (`test/openai-p4-ergebnisstruktur-instructions.test.js:236`). Er
nennt das Token bereits ueber die **Konstante** `${NOT_PLACED}`. Bricht das Praefix,
waehlt der Host nach jedem Fehlschlag erneut — jeder Versuch kostet Carrier-Geld.

---

## 2. Die Naht: warum genau `callOutcomeView`

`failure_reason` verlaesst den Server an **einer** Stelle:

```
src/mcp-tools.js:156-158   callOutcomeView(call)   -> { status, failure_reason }
                 :171      pickCallStatus   spreadet callOutcomeView   -> get_call_status
                 :265      awaitEventView   spreadet callOutcomeView   -> await_call_event
```

Gegengeprueft, dass es keine zweite Quelle gibt:

* `grep -rn "failureReason\|failure_reason" src/` — im MCP-Modul gibt es ausser
  `:157` nur Schema-Zeilen (`:186`, `:251`), einen Kommentar (`:154`, `:208`), den
  Nutzertext-Weg (`:212`, `texts.callFailedSummary`) und ein hartes `null` (`:1072`).
* `pickCall` (`:421-432`, `list_calls`) und `INBOX_ENTRY` (`:459-472`, `check_inbox`)
  tragen **kein** `failure_reason` — beide sind Positivlisten ohne das Feld.
* `src/ui/adapters/chatgpt.js` und `src/ui/adapters/mcp-native.js` enthalten **null**
  Treffer fuer `structuredContent` — beide Adapter bauen nur `_meta`/Resource. Der
  Feldwert entsteht also VOR der Adapter-Wahl (DP-2).
* `src/mcp-server.js` (stdio) und `src/routes/mcp.js` (HTTP) rufen dieselbe
  `registerTools()` (DP-1).

**Textblock-Reichweite:** `get_call_status` schreibt `failure_reason` NICHT in seinen
Textblock (`src/mcp-tools.js:1219-1227`, nur `status`/`duration_s`/
`last_transcript_lines`), `await_call_event` dagegen schon — dort ist der Textblock das
vollstaendige JSON (`:1125`). Eine Aenderung an `callOutcomeView` deckt beide Kanaele.

**Wo die Kuerzung NICHT hingehoert (Geldpfad-Gegenrichtung):** NICHT an
`call.failureReason` im Store, nicht in `call-finish.js`, nicht in `call-lifecycle.js`.
Der Betreiber-Ausfallalarm bildet seinen Bucket aus dem **vollen** Token:
`outageBucket("not-placed:invite-403-D51") === "not-placed:invite-403"`
(`test/ausfall-erkennung.test.js:194`, `src/telephony/outage-report.js:227-228`). Wer
dort kuerzt, wirft den Unterschied zwischen "unsere Absendernummer ist tot" (SIP 403)
und "Startfehler" (`start-403`) weg — genau die Unterscheidung, fuer die OUTBOUND-E2
nach dem Ausfall vom 27.08.2026 gebaut wurde.

---

## 3. Arbeitsschritte

### Schritt 1 — `failureReasonBase()` an der MCP-Kante anwenden

**Datei:** `src/mcp-tools.js:156-158` (`callOutcomeView`), dazu ein Import neben
`src/mcp-tools.js:30-31`.

**Aenderung:**

```js
import { failureReasonBase } from "./telephony/failure-reason.js";
...
function callOutcomeView(call) {
  return { status: mapStatus(call), failure_reason: failureReasonBase(call.failureReason) };
}
```

`failureReasonBase()` wird **unveraendert wiederverwendet**, nicht kopiert und nicht
nachgebaut: der Trenner ist dort die Konstante `DETAIL_SEPARATOR`
(`src/telephony/failure-reason.js:35`), und die Funktion liefert fuer `null`/leer weiter
`null` (`:59-60`) — das bisherige `?? null` wird dadurch ersetzt, nicht ergaenzt.
Es wird NICHT am Bindestrich getrennt und NICHT `reasonWithoutCarrier()` genommen (das
schneidet nur `-D51` ab und liesse `not-placed:invite-403` stehen).

**IDs:** O-13 (Teil 2).
**Pfade:** HTTP `/mcp`, stdio, mcp-nativ, ChatGPT — eine `registerTools()`, eine Naht,
vor der Adapter-Wahl.

**Beweis (fremd pruefbar):** Code an `src/mcp-tools.js`, Funktion `callOutcomeView`:
der Rueckgabewert entsteht aus `failureReasonBase(...)` und aus keinem eigenen
`split`/`slice`/`replace`. Gegenprobe-Kommando, das genau das zeigt:
`grep -n "split(\|slice(\|replace(" src/mcp-tools.js | grep -i "failure"` → **keine
Ausgabe**; Positiv-Kontrolle `grep -n "failureReasonBase" src/mcp-tools.js` → genau zwei
Treffer (Import + Aufruf). Verhaltensbeweis in Schritt 4/5/6.

---

### Schritt 2 — die drei Bestands-Zusicherungen nachziehen, die das ROH-Token pinnen

**Dateien:**

| Stelle | heute | nachher |
|---|---|---|
| `test/mcp-ui.test.js:217` | `assert.equal(..., "failed:603", "Grund exponiert")` | `"failed"`, plus eine Zeile, die belegt, dass der **Mock-Upstream** weiterhin `failureReason: "failed:603"` liefert (`:206`) — sonst ist der Test trivial gruen |
| `test/mcp-fehlergrund-rueckweg.test.js:96` | `assert.equal(data.failure_reason, "not-placed:invite-403-D51")` | `NOT_PLACED` (die bereits importierte Konstante, `:13`) |
| `test/mcp-fehlergrund-rueckweg.test.js:125-128` | Kommentar "Das Maschinenfeld darf das Token trotzdem tragen" + `assert.equal(data.failure_reason, RAW_TOKEN)` | Kommentar korrigiert; Zusicherung auf `failureReasonBase(RAW_TOKEN)` (`"brandneu-nie-gesehen"`), dazu `assert.ok(!data.failure_reason.includes("42"))` |

Kein neues Literal `"not-placed"` in diesen Tests — die Konstante ist schon importiert.

**IDs:** O-13 (Teil 2).
**Pfade:** in-process (beide Tests fahren `registerTools()` gegen einen Gateway-Mock).

**Beweis:** `NODE_ENV=test node --test --test-concurrency=4 test/mcp-ui.test.js
test/mcp-fehlergrund-rueckweg.test.js` → `# fail 0`; und in `test/mcp-ui.test.js` steht
die Upstream-Positiv-Kontrolle im Klartext (der Pruefer liest sie).

---

### Schritt 3 — die Kommentare korrigieren, die durch Schritt 1 falsch werden

**Dateien und Stellen:**

1. `src/mcp-tools.js:154` — "failure_reason ist das MASCHINENFELD (**rohes Token**,
   Diagnose)". Nach Schritt 1 ist es das **Basis-Token**; das Detail bleibt am
   Datensatz und im Ausfallbericht. Ein Satz, der genau das sagt, plus der Grund
   (O-13/Datenminimierung).
2. `src/ui/widgets/call.html:438-440` — "Das rohe Token bleibt unveraendert am
   Datensatz **und im Maschinenfeld failure_reason (get_call_status)**". Der zweite
   Halbsatz ist danach falsch. `failureReasonLabel()` selbst (`:441-445`) bleibt
   **unveraendert**: `String(raw).split(":")[0]` ist die defensive Normalisierung eines
   host-gepushten Fremdwerts, kein toter Code — das Widget darf seinem Eingang nicht
   vertrauen.
3. `src/i18n/failure-reason-texts.js:106-108` — "das Token bleibt der Diagnose
   vorbehalten - Store, Log **und das Maschinenfeld failure_reason**". Dieselbe
   Korrektur: Store und Log, nicht mehr das MCP-Feld.

**Bewusst NICHT angefasst:** `src/telephony/call-lifecycle.js:31` und `:38`
("get_call_status reicht failure_reason unveraendert an MCP-Clients weiter"). Die
Aussage steht dort an `CAP_FAILURE_REASON = "max-duration-cap"` (`:33`) und
`BUDGET_FAILURE_REASON = "budget-exhausted"` (`:40`) — beide **detailfrei**, fuer sie
gilt `failureReasonBase(t) === t`, die Aussage bleibt also wahr. Schritt 4 Fall E pinnt
genau das, damit die Kommentare nicht durch eine spaetere Aenderung stillschweigend
falsch werden.

**IDs:** keine (Wahrheitspflege am Code, Clean-Code-Pflicht).
**Pfade:** keine — reine Kommentare, kein Verhalten.

**Beweis:** Code an den drei genannten Stellen; jede Aussage ist durch einen Testfall
aus Schritt 4 gedeckt (`:154`/`:106-108` durch Fall A + E, `call.html:438-440` durch
Fall A). `node --check src/mcp-tools.js src/i18n/failure-reason-texts.js` → Exit 0.

---

### Schritt 4 — neue Testdatei, Fall A (in-process, beide Werkzeuge) und Fall E (Durchreiche)

**Datei:** `test/openai-p5b-geldpfad.test.js` (neu). Muster:
`test/openai-p5a-datenminimierung.test.js` (Gateway-Mock `withMock`, `captureTools`),
`test/mcp-fehlergrund-rueckweg.test.js` (`withGateway`). Testnamen tragen **kein**
Katalog-Praefix (Lehre `catalog-id-prefix-misroutes-tests`), sie beginnen mit
`"P5b (O-13 Teil 2, …)"` — damit laufen sie in `npm test`, nicht im Gates-Lauf.

**Fall A — in-process, `get_call_status` UND `await_call_event`:**
Gateway-Mock liefert einen Call-Record mit `failureReason: `${NOT_PLACED}:invite-403-D51``
(aus der Konstante gebaut, nicht getippt). Erwartet:

* `get_call_status`: `structuredContent.failure_reason === NOT_PLACED`;
* `await_call_event` (`event:"done"`): `structuredContent.failure_reason === NOT_PLACED`
  **und** der Textblock (`content[0].text`) enthaelt weder `"invite-403"` noch `"D51"`
  (dort ist der Textblock das volle JSON, `src/mcp-tools.js:1125`);
* **Positiv-Kontrolle:** der Mock-Body traegt das volle Token — im Test als eigene
  Zusicherung, damit ein leerer Upstream nicht trivial gruen aussieht;
* `result_summary` bleibt unveraendert die lokalisierte Phrase
  (`FAILURE_REASON_TEXTS.de.phrases["not-placed"]`) — die Kuerzung darf den Nutzertext
  nicht beruehren.

**Fall E — Durchreiche detailfreier Token (Gegenrichtung):**
ueber eine Tabelle, jeweils Ein- und Ausgang gleich:
`"no-answer"`, `"busy"`, `"canceled"`, `CAP_FAILURE_REASON`, `BUDGET_FAILURE_REASON`
(die letzten beiden aus `src/telephony/call-lifecycle.js` importiert, nicht getippt),
dazu `null` → `null`. Damit ist belegt: die Kuerzung nimmt nichts weg, was kein Detail
ist, und die Kommentare in `call-lifecycle.js` bleiben wahr.

**IDs:** O-13 (Teil 2).
**Pfade:** in-process; deckt mcp-nativ und ChatGPT mit, weil der Wert vor der
Adapter-Wahl entsteht (Schritt 7 belegt das separat).

**Beweis:** `NODE_ENV=test node --test --test-concurrency=4
test/openai-p5b-geldpfad.test.js` → `# fail 0`, und der Pruefer liest in der Datei,
dass die Erwartung aus `NOT_PLACED` / den importierten Konstanten gebildet wird.

---

### Schritt 5 — Fall B (HTTP `/mcp`, echter Serverprozess) und Fall C (stdio, echter Kindprozess)

**Datei:** dieselbe neue Testdatei.

**Fall B (HTTP):** `startServer({ seed: seedState({ calls: [...] }) })` mit einem
gespeicherten Call, dessen `failureReason` das volle Token traegt. Dann
`mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_call_status", { call_id }))`.
Erwartet: `structuredContent.failure_reason === NOT_PLACED`.
**Positiv-Kontrolle am Upstream:** `GET ${srv.localUrl}/api/calls/<id>` liefert
`failureReason` weiterhin **vollstaendig** — `/api/*` ist NICHT Gegenstand dieser Phase
(Abschnitt 4), und ohne diese Zeile beweist Fall B nichts.

**Fall C (stdio, DP-1):** `StdioClientTransport` auf `src/mcp-server.js` mit
`env: { ...BASE_ENV, GATEWAY_URL: <Mock-URL> }` — der Mock ist derselbe Ein-Antwort-
HTTP-Server wie in Fall A. Dann ein echter `client.callTool({ name: "get_call_status",
arguments: { call_id } })`. Erwartet: `structuredContent.failure_reason === NOT_PLACED`.
**Ausdruecklich ein `tools/call`, nicht nur `tools/list`:** das Schema aendert sich in
dieser Phase nicht, eine Schema-Pruefung wuerde hier nichts beweisen. `GATEWAY_URL` wird
NUR an diesen Kindprozess gereicht und NICHT in `BASE_ENV` aufgenommen (das leakte in
jeden anderen Spawn-Test).

**IDs:** O-13 (Teil 2).
**Pfade:** HTTP `/mcp` (B), stdio (C) — DP-1 beidseitig belegt.

**Beweis:** derselbe Testlauf wie Schritt 4, `# fail 0`; der Pruefer sieht in Fall B die
Upstream-Positiv-Kontrolle und in Fall C den Kindprozess-Aufruf.

---

### Schritt 6 — Fall D: die Geldpfad-Gegenprobe gegen die KONSTANTE

**Datei:** dieselbe neue Testdatei. Dieser Fall ist der Grund, warum P5b eine eigene
Phase ist.

Zugesichert wird, ohne ein einziges getipptes `"not-placed"`:

1. `MCP_BASE_INSTRUCTIONS.includes(NOT_PLACED)` — der Riegel nennt das Token
   (`src/mcp-server-info.js:97`), mit **Positiv-Kontrolle**
   `MCP_BASE_INSTRUCTIONS.includes("get_transcript")`, sonst zeigt "gefunden/nicht
   gefunden" nur einen leeren String an.
2. Der von `get_call_status` gelieferte Wert erfuellt
   `emitted.startsWith(NOT_PLACED) === true` **und** `emitted === NOT_PLACED`.
3. `emitted === failureReasonBase(roh)` fuer jedes Token der Tabelle — d.h. das Werkzeug
   benutzt die **geteilte** Zerlegeregel und keine zweite. Tabelle mindestens:
   `${NOT_PLACED}:invite-403-D51`, `${NOT_PLACED}:start-403`, `unreachable:invite-404`,
   `result-unknown:poll-timeout`, `failed:603`, `brandneu-nie-gesehen:42`.
4. **Negativ-Waechter gegen den Pre-Mortem-Fall:** `emitted !== "not"` und
   `NOT_PLACED.includes("-")` — wer zusaetzlich am Bindestrich trennt, faellt hier rot,
   nicht erst beim Kunden.
5. **Waechter gegen ein zweites Literal:** `MCP_BASE_INSTRUCTIONS` enthaelt die
   Zeichenkette `NOT_PLACED` genau so, wie das Werkzeug sie liefert — beide Seiten
   werden im Test aus **derselben** importierten Konstante gebildet, nirgends getippt.

**IDs:** O-13 (Teil 2) — Geldpfad-Absicherung.
**Pfade:** in-process (Punkt 2-4) + der Instruktionstext, der ueber HTTP wie stdio
identisch ausgeliefert wird (Punkt 1, `src/mcp-server-info.js` ist die gemeinsame
Quelle beider Einstiege).

**Beweis:** der Test ist gruen, und der Pruefer bestaetigt beim Lesen, dass in der
gesamten Datei **kein** Literal `"not-placed"` vorkommt:
`grep -c '"not-placed"' test/openai-p5b-geldpfad.test.js` → `0`, Positiv-Kontrolle
`grep -c "NOT_PLACED" test/openai-p5b-geldpfad.test.js` → `> 0`.

---

### Schritt 7 — DP-2 belegen (mcp-nativ und ChatGPT), ohne Code

**Keine Aenderung.** Belegt wird per lesender Messung, dass kein Adapter den
`structuredContent` anfasst und die Kuerzung deshalb auf beiden Adapterwegen identisch
wirkt.

**Kommando und erwartete Ausgabe:**

```
grep -rn  "structuredContent" src/ui/adapters/   -> KEINE Ausgabe
grep -rln "makeUiRenderer"    src/ui/adapters/   -> src/ui/adapters/chatgpt.js
                                                    src/ui/adapters/mcp-native.js
```

Die zweite Zeile ist die Positiv-Kontrolle (Lehre
`pruefkommando-ohne-positiv-kontrolle`): sie zeigt, dass das Kommando die Dateien
ueberhaupt sieht. Beide Adapter sind zusammen **29 Zeilen** und uebergeben derselben
Fabrik `makeUiRenderer` (`src/ui/contract.js`) nur `mimeType`, `metaKey` und
`buildMeta` — sie bauen ausschliesslich `_meta`/Resource. Auch die Fabrik selbst fasst
den Feldwert nicht an: `grep -n "structuredContent" src/ui/contract.js src/ui/registry.js`
liefert nur **Kommentarzeilen** (`contract.js:19`, `registry.js:25`), keine Zuweisung.

**IDs:** O-13 (Teil 2), Pfad-Abdeckung.
**Pfade:** mcp-nativ, ChatGPT.
**Beweis:** genau die zwei Kommandos oben mit genau dieser Ausgabe; sie gehoeren in den
Abschlussbericht.

---

### Schritt 8 — `consultPermissionHint` neutral formulieren (drei Sprachen)

**Dateien:** `src/i18n/mcp-texts.js:71-73` (de), `:140-142` (en), `:188-190` (fr).
Es sind **genau drei** Sprachen: `SUPPORTED_LANGUAGES` = `['de','fr','en']`
(`src/i18n/locales.js:722`, per `node -e` nachgesehen).

**Ist (Aufforderung):** "… **muss** die Werkzeug-Berechtigung des Connectors auf
'Zulassen' **stehen**" / "… **needs to be set to** 'Allow'" / "… **doit être réglée sur**
« Autoriser »".

**Soll (Beschreibung, Sachinformation erhalten):**

* de: `"Hinweis: Live-Rueckfragen waehrend des Anrufs erreichen diesen Chat nur, wenn die Werkzeug-Berechtigung des Connectors erteilt ist."`
* en: `"Note: live questions during the call only reach this chat if the connector's tool permission is granted."`
* fr: `"Remarque : les questions en direct pendant l'appel n'arrivent dans cette conversation que si l'autorisation d'outil du connecteur est accordée."`

Die deutsche Fassung bleibt **ASCII-transliteriert** ("Rueckfragen", "waehrend") wie der
Bestand — es ist ein Chat-Text, kein gesprochener String (Lehre
`umlaut-transliteration-root-cause` gilt fuer **gesprochene** Strings).
Der Hinweis bleibt an derselben Stelle angehaengt: `src/mcp-tools.js:1089`,
`consultAllowed ? loc.mcp.consultPermissionHint : null` — **keine** Aenderung an der
Anhaenge-Logik, keine Entfernung.

**IDs:** O-27 (Teil 2) laut Plan — mit der Einschraenkung aus Abschnitt 5, W4: nach dem
**massgeblichen** O-27-Wortlaut ist dieser Text kein O-27-Fall. Die Aenderung wird
trotzdem gebaut (Plan-Soll, Risiko nahe null, sachlich besser), aber sie darf in P11
**nicht** als O-27-Nachweis gezaehlt werden.

**Pfade:** HTTP `/mcp`, stdio (derselbe `loc.mcp`), mcp-nativ, ChatGPT (der Hinweis
reist im Textblock, den jeder Host sieht).

**Beweis:** Code an den drei genannten Stellen + der Test aus Schritt 9.

---

### Schritt 9 — Gegenprobe Consult-Wirkung und Aufforderungs-Waechter

**Datei:** `test/openai-p5b-geldpfad.test.js` (zweiter Abschnitt derselben Datei — eine
Phase, eine Testdatei).

**Fall F — Wirkung bleibt (der Hinweis verschwindet NICHT):**
Der Bestandstest `test/al-p13-consult-channel.test.js:981-994` (AL-P13-43) deckt das
bereits ab und liest den Hinweis aus `localeFor("en").mcp.consultPermissionHint`, nicht
als Literal — er bricht durch die Umformulierung **nicht** und bleibt gruen. Neu
ergaenzt wird nur die Sprachabdeckung: fuer **jede** Sprache aus `SUPPORTED_LANGUAGES`
enthaelt der `place_call`-Textblock bei `consultAllowed: true` den Hinweis dieser
Sprache und bei `consultAllowed: false` **nicht**.

**Fall G — keine Aufforderung in irgendeiner Sprachfassung, mit Positiv-Kontrolle:**
Eine eingefrorene Tabelle `AUFFORDERUNGS_MARKER` (je Sprache: das Wert-Label und das
Modalverb, also `Zulassen` + `muss`, `Allow` + `needs to be set`, `Autoriser` +
`doit être`). Zugesichert wird:

1. `Object.keys(AUFFORDERUNGS_MARKER)` deckt `SUPPORTED_LANGUAGES` **vollstaendig** ab —
   eine vierte Sprache kann nicht stillschweigend durchrutschen;
2. **Positiv-Kontrolle:** eine zweite eingefrorene Tabelle `BESTAND_VORHER` mit den drei
   ALTEN Zeichenketten; jede davon wird von ihren Markern **gefangen**. Ohne das ist
   "kein Marker gefunden" nicht von "der Waechter sucht nichts" zu unterscheiden
   (Lehre `pruefkommando-ohne-positiv-kontrolle`);
3. keine der **neuen** Fassungen enthaelt einen ihrer Marker;
4. jede neue Fassung traegt die Sachinformation weiter — sie nennt den Gegenstand
   ("Berechtigung" / "permission" / "autorisation"), ist also nicht ersatzlos entkernt.

**IDs:** O-27 (Teil 2, mit der Einschraenkung W4).
**Pfade:** alle vier (der Textblock ist der Backward-Compat-Kanal jedes Hosts).

**Beweis:** `NODE_ENV=test node --test --test-concurrency=4
test/openai-p5b-geldpfad.test.js test/al-p13-consult-channel.test.js` → `# fail 0`.
Zusaetzlich das Grep-Kriterium des Plans, das der Pruefer selbst fahren kann:
`grep -n "Zulassen\|set to 'Allow'\|Autoriser" src/i18n/mcp-texts.js` → **keine
Ausgabe**; Positiv-Kontrolle `grep -c "consultPermissionHint" src/i18n/mcp-texts.js` →
`3`.

---

### Schritt 10 — eslint-Fingerprint messen, nur bei Bewegung nachziehen

`src/mcp-tools.js` steht mit einem Zeilenzahl-Pin auf der Altlast-Liste:
`"max-lines-per-function :: Function 'registerTools' has too many lines (508)."`
(`test/check-staged-suppressions.test.js:793`). `callOutcomeView` liegt **ausserhalb**
von `registerTools` (Modulebene, `:156`), der Import ebenfalls — die Zahl **soll** sich
nicht bewegen.

**Kommando:**
`npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js --format json`

**Erwartet:** `registerTools … (508)` unveraendert, `id-length` A/a/c/e/r/s/t/v =
1/2/8/4/2/9/1/1, `no-magic-numbers` 1000→1 und 2→6, `no-restricted-syntax` 18 —
alles wie in `test/check-staged-suppressions.test.js:782-794`.
Bewegt sich die Zahl doch, wird der Pin mit der **gemessenen** Zahl und einer
Begruendungszeile im Datei-Kopf nachgezogen (Muster der Eintraege vom 2026-09-20/21).
Geraten wird nichts. `src/i18n/mcp-texts.js`, `src/i18n/failure-reason-texts.js` und
`src/ui/widgets/call.html` stehen **nicht** auf der Liste (geprueft).

**IDs:** keine (Qualitaets-Gate).
**Pfade:** keine.
**Beweis:** die JSON-Ausgabe des Kommandos oben, im Abschlussbericht zitiert.

---

### Schritt 11 — Gesamtlauf

**Kommando:** `npm test -- -- --test-concurrency=4`, Ausgabe vollstaendig, nicht
abgeschnitten.
**Erwartet:** `# pass` mindestens 6198 + die neuen Faelle, `# fail 0`. Ein roter Test
zaehlt erst, wenn er **isoliert** erneut rot ist; das Isolierungskommando und sein
Ergebnis gehoeren in den Bericht. Zusaetzlich `node --check` auf jede geaenderte
`.js`-Datei.

**Beweis:** die beiden Zeilen `# pass` / `# fail` im Bericht, wortwoertlich.

---

## 4. Was in dieser Phase NICHT gebaut wird

1. **`last_transcript_lines`** — tabu (P5b-Anhang des Plans, Zeilen 622-648). Live-
   Konsument im Call-Widget (`src/ui/widgets/call.html:167/:551/:584`), waehrend eines
   laufenden Anrufs existiert kein Ersatz (`AWAIT_SUMMARY_PLACEHOLDER`,
   `src/mcp-tools.js:194-195`). O-13 bleibt danach **teilweise** erfuellt.
2. **Kuerzung an der Quelle** (Store, `call-finish.js`, `call-lifecycle.js`,
   `failure-reason.js`) — zerstoert den Ausfall-Bucket
   (`test/ausfall-erkennung.test.js:194`) und damit die Frueherkennung eines
   Outbound-Ausfalls. Die Kuerzung sitzt ausschliesslich an der MCP-Kante.
3. **Die Nennung "not as Claude/Gemini"** in den `place_call`-Beschreibungen
   (`src/mcp-tools.js:940`, `:1009`) — das ist der **Kern** des O-27-Wortlauts und der
   urspruengliche Befund (`tasks/OPENAI-MCP-READINESS.md:518`). P4 hat ihn bewusst
   liegen lassen (W-3 der P4-Spec): es sind GQ-B2-/Bench-kalibrierte
   Anrufqualitaetstexte, eine Aenderung braucht eine Vorher-Messung
   (`npm run convo-bench`, n>=5) und eine Owner-Entscheidung. Diese Phase hat weder
   Auftrag noch Messung dafuer. **Bleibt OFFEN und muss vor P11 entschieden werden.**
4. **Ein zweites Feld** (`failure_detail`, `diagnostic_code` o.ae.) — waere genau die
   Diagnose-ID, die O-13 verbietet, nur unter neuem Namen.
5. **Schema-Aenderungen** an `CALL_STATUS_OUTPUT` (`:181-187`) und `AWAIT_EVENT_OUTPUT`
   (`:247-257`) — Typ und Nullbarkeit bleiben; nur der Inhalt wird kuerzer.
6. **`failureReasonLabel()` im Widget** (`src/ui/widgets/call.html:441-445`) — der
   `split(":")` bleibt als defensive Normalisierung eines host-gepushten Fremdwerts.
   Nur der Kommentar darueber wird wahr gemacht.
7. **`pickCall` / `check_inbox`** — tragen kein `failure_reason` (nachgesehen,
   `:421-432`, `:459-472`). Nichts zu tun.
8. **`FAILURE_REASON_TEXTS` / `callFailedSummary`** — loesen bereits auf dem Basis-Token
   auf (`src/i18n/failure-reason-texts.js:79-81`) und reichen ein unbekanntes Token nie
   an den Nutzertext durch (Test 4 in `test/mcp-fehlergrund-rueckweg.test.js`).
9. **Kein Flag, keine neue Env-Variable.** Die Kuerzung ist unbedingt. Ein Schalter
   waere ein zweiter Zustand am Geldpfad — genau das, was P5b vermeiden soll.
10. **Kein Anfassen der Safety-Gates**, kein echter Anruf/SMS, kein Deploy, kein Push,
    kein Merge nach master.

---

## 5. Widersprueche zwischen Plan und Code (am Code nachgesehen)

**W1 — Anhaengepunkt des Consult-Hinweises.** Plan: `src/mcp-tools.js:956`. Tatsaechlich
`:1089` (`consultAllowed ? loc.mcp.consultPermissionHint : null`). Der Plan ist aelter
als P1/P2/P4/P5a, die dieselbe Datei umgebaut haben. **Aufgeloest:** die Spec nennt
`:1089`; die Logik selbst ist unveraendert, es ist nur eine Zeilenverschiebung.

**W2 — Ort des `not-placed`-Riegels.** Plan: `src/mcp-server-info.js:111`. Tatsaechlich
`:97`, in `MCP_BASE_INSTRUCTIONS` (nicht in `MCP_CONSULT_INSTRUCTIONS`, die den Block
nur einschliesst). Wichtiger noch: der Satz nennt das Token **bereits** ueber
`${NOT_PLACED}` — Abnahmekriterium 2 des Plans ("beide aus der Konstante") ist auf der
**Instruktionsseite schon heute** erfuellt; offen war nur die **Feldseite**.
**Aufgeloest:** Schritt 6 prueft beide Seiten gegen dieselbe importierte Konstante, und
Punkt 1 dort ist eine Regressionssicherung, keine Neubauaufgabe.

**W3 — Zahl der Sprachfassungen.** Plan: "`:71-73` DE, `:142-144` EN und alle weiteren
Sprachen"; die P4-Spec (`tasks/openai-p4-spec.md:386`) spricht von "vier
Sprachfassungen". Tatsaechlich: **drei** (`SUPPORTED_LANGUAGES` = `de`, `fr`, `en`,
`src/i18n/locales.js:722`), EN bei `:140-142`, FR bei `:188-190`. **Aufgeloest:**
Schritt 8 nennt die drei echten Stellen; Schritt 9 iteriert ueber
`SUPPORTED_LANGUAGES` statt ueber eine getippte Liste — eine vierte Sprache faellt dann
automatisch rot auf, statt still durchzurutschen.

**W4 — die O-27-Zuordnung von `consultPermissionHint` traegt nicht.** Massgeblich ist
`tasks/openai-audit/00-openai-anforderungen.md:122`: *"fields … that manipulate how the
model selects or uses **other plugins**"*. `consultPermissionHint` nennt kein fremdes
Plugin und beeinflusst keine Plugin-Auswahl; er beschreibt eine Berechtigung des
**eigenen** Connectors. Als O-27-Beleg taugt er nicht. **Aufgeloest:** die Aenderung
wird trotzdem gebaut — sie ist das Plan-Soll, praktisch risikofrei und sachlich richtig
(eine Handlungsaufforderung an einer Host-Sicherheitseinstellung gehoert nicht in eine
Werkzeugantwort) —, aber sie wird **nicht** als O-27-Nachweis verbucht. Der
Abschlussbericht fuehrt O-27 als **offen** (s. W5).

**W5 — O-27 hat eine offene dritte Oberflaeche, und es ist die eigentliche.**
`src/mcp-tools.js:940` und `:1009` enthalten woertlich *"not as Claude/Gemini"* bzw.
*"NEVER as Claude/Gemini"* in **modell-lesbaren** Tool-Beschreibungen — das ist der
O-27-Wortlaut im Kern und der urspruengliche Befund
(`tasks/OPENAI-MCP-READINESS.md:518`). P4 hat ihn ausdruecklich als offen ausgewiesen
(`tasks/openai-p4-spec.md:387`, `:414-429`, `:531-535`). **Aufgeloest:** nicht in dieser
Phase gebaut (Abschnitt 4, Punkt 3) — ohne Bench-Vorher-Messung waere es genau der
Fehler aus der Lehre `bench-must-reproduce-defect`. Die Spec traegt den Befund weiter,
damit P11 O-27 nicht faelschlich abhakt.

**W6 — der Plan sagt nicht, dass Kommentare falsch werden.** Drei Bestands-Kommentare
behaupten ausdruecklich, das **rohe** Token erreiche das MCP-Feld
(`src/mcp-tools.js:154`, `src/ui/widgets/call.html:438-440`,
`src/i18n/failure-reason-texts.js:106-108`). Nach Schritt 1 ist das falsch.
**Aufgeloest:** Schritt 3 zieht sie nach; die zwei Kommentare in
`src/telephony/call-lifecycle.js:31/:38` bleiben, weil sie fuer ihre **detailfreien**
Token wahr bleiben — und Fall E pinnt genau das.

**W7 — Abnahmekriterium 3 ist schon heute erfuellt.** Der Plan verlangt einen gruenen
Test, dass der Hinweis weiter an jedes `place_call`-Ergebnis mit Consult haengt. Den
gibt es: AL-P13-43 (`test/al-p13-consult-channel.test.js:981-994`), und er liest den
Text aus dem Locale, nicht als Literal — er bricht durch die Umformulierung nicht.
**Aufgeloest:** Schritt 9 Fall F baut den Test nicht neu nach, sondern ergaenzt nur die
fehlende Sprachabdeckung (AL-P13-43 prueft nur `en`).

**UNKNOWN (Grund: keine Quelle).** Ob OpenAIs Reviewer das Basis-Token allein als
"strictly required" akzeptiert oder auch das kuerzen will, steht in keiner der
massgeblichen Quellen. Das Basis-Token ist funktional zwingend (der Riegel haengt
daran), deshalb wird es behalten; eine weitergehende Kuerzung waere ohne Quelle
geraten und braeche den Geldpfad.

---

## 6. Pre-Mortem — ein Jahr spaeter war P5b ein Fehler

1. **Jemand legte `failureReasonBase()` an die Quelle statt an die Kante.** Der
   Ausfallbericht verlor seinen Bucket: `not-placed:invite-403` und
   `not-placed:start-403` fielen zu `not-placed` zusammen, der Schwellenalarm feuerte
   nicht mehr trennscharf, und ein zweiter Outbound-Ausfall wie am 27.08.2026 blieb
   stundenlang unbemerkt. *Entschaerfung:* die Aenderung sitzt ausschliesslich in
   `callOutcomeView`; der Bestandstest `test/ausfall-erkennung.test.js:194` faellt sofort
   rot, wenn jemand an der Quelle kuerzt, und Abschnitt 2 benennt das Verbot.
2. **Das Praefix brach.** Jemand nahm `reasonWithoutCarrier()` oder trennte zusaetzlich
   am Bindestrich; aus `not-placed` wurde `not`. Der Riegel in den Server-`instructions`
   griff nicht mehr, der Host wiederholte jeden gescheiterten Anruf, jeder Versuch
   kostete Carrier-Geld. *Entschaerfung:* Fall D prueft gegen die **Konstante**
   `NOT_PLACED`, gegen `MCP_BASE_INSTRUCTIONS.includes(NOT_PLACED)` (mit
   Positiv-Kontrolle) und ausdruecklich gegen den Bindestrich-Fall.
3. **Nur HTTP geprueft, stdio vergessen.** Claude Desktop lief ein Jahr weiter mit dem
   vollen SIP-/Carrier-Token im Modellkontext, und O-13 galt als erledigt, obwohl es das
   auf dem halben Feld nicht war. *Entschaerfung:* Fall C fuehrt einen echten
   `tools/call` ueber den stdio-Kindprozess, nicht nur ein `tools/list`.
4. **Die Diagnose verschwand, ohne dass jemand es merkte.** Ein Support-Fall ("warum kam
   der Anruf nicht zustande?") war nicht mehr zu beantworten, weil alle Kommentare
   weiterhin behaupteten, das rohe Token stehe im MCP-Feld, und niemand im Store
   nachsah. *Entschaerfung:* Schritt 3 macht die drei Kommentare wahr und sagt, **wo**
   das Detail jetzt liegt (Datensatz, Log, `/api/calls/:id`, Ausfallbericht); Fall B
   belegt am laufenden Server, dass der Upstream es weiterhin traegt.
5. **`consultPermissionHint` wurde leiser als die Wirklichkeit.** Bei der
   "Neutralisierung" fiel die Sachinformation mit weg; Tenants sahen nicht mehr, warum
   Live-Rueckfragen nie ankamen, und meldeten den Consult-Kanal als kaputt.
   *Entschaerfung:* Fall F (haengt weiter, in jeder Sprache, und nur mit Consult) und
   Fall G Punkt 4 (der Gegenstand muss genannt bleiben).
6. **P11 hakte O-27 ab.** `consultPermissionHint` war umformuliert, also galt O-27 als
   erfuellt — waehrend "not as Claude/Gemini" in zwei modell-lesbaren
   `place_call`-Beschreibungen stehen blieb. Die Einreichung ging mit halber Abdeckung
   raus und wurde abgelehnt. *Entschaerfung:* W4 und W5 stehen ausdruecklich in dieser
   Spec, und Abschnitt 4 Punkt 3 fuehrt den Befund als offen mit Owner-Entscheidung.
7. **Der Altlast-Pin brach und jemand schob `--no-verify` nach.** Eine Zeile mehr in
   `registerTools`, der Commit-Hook blockte, die Abkuerzung wurde zur Gewohnheit.
   *Entschaerfung:* Schritt 10 misst vorher mit dem echten eslint-Aufruf und zieht den
   Pin nur mit der gemessenen Zahl nach; `callOutcomeView` liegt ohnehin ausserhalb der
   gepinnten Funktion.
8. **Ein Flake wurde als Erfolg verbucht.** Der Gesamtlauf zeigte `# fail 1`, der
   Exit-Code war 0, niemand sah hin. *Entschaerfung:* Schritt 11 verlangt die Zeilen
   `# pass`/`# fail` woertlich im Bericht und einen isolierten Nachlauf fuer jeden roten
   Fall.
