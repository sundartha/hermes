# P1 — Annotationen und Beschreibungen (Spec)

Phase P1 der OpenAI-Einreichung. IDs: **N-1, X-1, N-3, N-4, N-11**.
Massgeblich: `tasks/openai-audit/00-openai-anforderungen.md`. NICHT massgeblich: `00-mcp-spec.md`.
Vorrang bei Widerspruch: `tasks/openai-p0-entscheidungen.md` schlaegt `tasks/PLAN-OPENAI-TECHNIK.md`.

Diese Phase aendert **Werte in einer Tabelle, einen Kommentar, eine Beschreibung, einen
Lint-Pin und Tests**. Keine Struktur, keine Route, kein Gate, keine Env-Variable.

---

## 0. Was vor dem Schreiben gemessen wurde (nicht abgeschrieben)

| Messung | Kommando / Stelle | Ergebnis |
|---|---|---|
| Tool-Flaeche ueber die echte HTTP-Route mit Consult-Faehigkeit | Wegwerf-Test `startServer({seed: seedState({}), env:{CONSULT_ENABLED:"true", ASSISTANT_CONTEXT_ENABLED:"true"}})` + `tools/list` | **12** Werkzeuge, Reihenfolge `place_call, await_call_event, answer_consult, get_call_status, get_transcript, cancel_call, get_my_number, list_calls, check_inbox, list_action_items, get_calendar, get_agent_status` |
| `annotations` ausserhalb `src/mcp-tools.js` | `grep -rn "annotations" src/ --include="*.js" \| grep -v "src/mcp-tools.js" \| wc -l` | **0** |
| Aufrufer von `registerTools()` | `grep -rn "registerTools(" src/ --include="*.js"` | genau zwei: `src/mcp-server.js:26` (stdio), `src/routes/mcp.js:151` (HTTP) |
| `destructiveHint`-Schluessel heute | `grep -c "destructiveHint:" src/mcp-tools.js` | **5** (die colon-lose Variante liefert 6) |
| Lint-Pin von `registerTools` | `npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js` | `Function 'registerTools' has too many lines (512)` — gepinnt in `eslint-legacy-exceptions.json` |
| Emphase-Pin `await_call_event` | `test/p15-mcp-tool-descriptions-en.test.js:198` | `["REPEATEDLY", "NEVER"]` |
| Wer pinnt Annotationswerte | `grep -rln "openWorldHint\|destructiveHint" test/` | genau **eine** Datei: `test/mcp-tool-annotations.test.js` |

Der Wegwerf-Test ist nach der Messung geloescht worden; er ist nicht Teil dieser Phase.

---

## 1. Arbeitsschritte

Reihenfolge ist bindend. **Zwischen S1 und S7 ist die Suite absichtlich rot** (die
Erwartungstabellen pinnen noch die alten Werte). Beurteilt wird der Endzustand nach S10.

### S1 — `openWorldHint`: drei Werte auf `false`

**Datei:** `src/mcp-tools.js:612` (`await_call_event`), `:621` (`get_call_status`), `:622`
(`get_transcript`).
**IDs:** N-4.
**Was:** `openWorldHint: true` -> `false` an genau diesen drei Werkzeugen. Alle uebrigen neun
Werte bleiben unveraendert.

Massstab ist N-4 woertlich: `true` bei Zugriff auf das oeffentliche Internet oder offene
externe Entitaeten ("send messages to external recipients"). Entscheidend ist der **Zugriff**
des Werkzeugs, nicht das Thema seiner Daten. Am Code nachgeprueft:

| Werkzeug | Soll | Route (nachgeprueft) |
|---|---|---|
| `place_call` | **true** | `POST /api/calls` (`src/routes/api-calls.js:394`) — echter Carrier-Anruf |
| `await_call_event` | **false** | `GET /api/calls/:id/consult` (`src/routes/api-calls.js:658`) + `GET /api/calls/:id` (`src/routes/api-read.js:98`) — beide tenant-lokal |
| `answer_consult` | **true** | `POST /api/calls/:id/consult/answer` (`src/routes/api-calls.js:690`) — der Text wird am Telefon ausgesprochen |
| `get_call_status` | **false** | `GET /api/calls/:id` (`src/routes/api-read.js:98`) |
| `get_transcript` | **false** | `GET /api/calls/:id` (`src/routes/api-read.js:98`) — **dieselbe Route wie `get_call_status`** |
| `cancel_call` | **true** | `POST /api/calls/:id/cancel` (`src/routes/api-calls.js:717`) — ruft den Anbieter |
| `get_my_number` | **false** | `GET /api/state` (`src/routes/api-read.js:63`) |
| `list_calls` | **false** | `GET /api/state` (`src/routes/api-read.js:63`) |
| `check_inbox` | **false** | `POST /api/inbox/poll` (`src/routes/api-inbox.js:40`) |
| `list_action_items` | **false** | `GET /api/state` (`src/routes/api-read.js:63`) |
| `get_calendar` | **false** | `GET /api/state` (`src/routes/api-read.js:63`) |
| `get_agent_status` | **false** | `GET /api/state` (`src/routes/api-read.js:63`) |

`get_transcript` und `get_call_status` lesen dieselbe Route — sie muessen denselben Wert
tragen, sonst bleibt genau die Inkonsistenz stehen, die N-6 als haeufigen Ablehnungsgrund
fuehrt.

**Pfade:** HTTP `/mcp`, stdio, mcp-nativer Adapter, ChatGPT-Adapter — alle vier ueber die eine
Modultabelle `TOOL_ANNOTATIONS`.
**Beweis:** Test `P1 (N-1/X-1/N-3/N-4/N-11): tools/list ueber /mcp liefert mit
Consult-Faehigkeit alle 12 Werkzeuge - Annotationen vollstaendig und tabellentreu,
await_call_event nennt seinen Schreibeffekt` ist gruen (Lauf: `NODE_ENV=test node --test
test/mcp-tool-annotations.test.js` -> `# fail 0`).

---

### S2 — `destructiveHint` an allen zwoelf Werkzeugen

**Datei:** `src/mcp-tools.js:621, :622, :630, :631, :639, :640, :641` (Zeilenstand vor S1/S2).
**IDs:** N-1, X-1.
**Was:** Die sieben reinen Lese-Werkzeuge bekommen `destructiveHint: false`:
`get_call_status`, `get_transcript`, `get_my_number`, `list_calls`, `list_action_items`,
`get_calendar`, `get_agent_status`. Danach traegt jedes der zwoelf Werkzeuge alle drei von
OpenAI als **Required** gefuehrten Felder (`readOnlyHint`, `destructiveHint`,
`openWorldHint`). `idempotentHint` wird **nicht** ergaenzt — N-1 fuehrt es ausdruecklich als
optional, und an einem Nur-Lese-Werkzeug waere es ein bedeutungsloser Wert.

Hinweis fuer die Umsetzung: die sieben Eintraege stehen heute einzeilig. Mit dem vierten
Schluessel reissen sie `printWidth: 100` (`.prettierrc.json`) und werden von Prettier
mehrzeilig umbrochen. Das ist erwartet und liegt **ausserhalb** von `registerTools()` —
der Zeilen-Pin aus S6 ist davon nicht betroffen. Nach dem Edit `npx prettier --write
src/mcp-tools.js` laufen lassen, sonst schlaegt `npm run format:check` fehl.

**Pfade:** alle vier (eine Tabelle).
**Beweis:** derselbe E2E-Test wie S1 prueft `typeof annotations.destructiveHint === "boolean"`
fuer **jedes** ueber `tools/list` gelieferte Werkzeug — am ausgelieferten JSON, nicht am
Dateitext. Zusaetzlicher, nicht bindender Schnellabgleich:
`grep -c "destructiveHint:" src/mcp-tools.js` -> **12** (gilt nur, solange der Kommentar aus
S4 den Feldnamen ohne Doppelpunkt schreibt; deshalb ist der Test der Beweis, nicht das grep).

---

### S3 — `answer_consult.destructiveHint` auf `true`

**Datei:** `src/mcp-tools.js:617`.
**IDs:** N-3.
**Was:** `destructiveHint: false` -> `true`.

Begruendung am Code: der Handler speist den Text ueber
`POST /api/calls/:id/consult/answer` in einen laufenden, kostenpflichtigen Anruf
(`src/mcp-tools.js:1046-1076`). Hat der Agent den Satz ausgesprochen, ist er nicht
zuruecknehmbar. N-3 woertlich: "even in only select modes, through default parameters, or
through indirect side effects".

**Pfade:** alle vier; das Werkzeug wird nur bei `consultAllowedFor(profile)` registriert
(`src/mcp-tools.js:1003-1004`, `src/consult/gate.js:19-25`) — der Wert selbst ist
pfadunabhaengig.
**Beweis:** `grep -n -A 6 "answer_consult: {" src/mcp-tools.js` zeigt `destructiveHint: true`;
zusaetzlich deckt der E2E-Test aus S8 den Wert ueber die echte Route ab (er laeuft mit
`CONSULT_ENABLED=true`, sonst erschiene das Werkzeug gar nicht).

---

### S4 — Der begruendende Kommentar

**Datei:** `src/mcp-tools.js:581-586` (der Satz, der ersetzt werden muss, steht auf `:583-584`).
**IDs:** N-1, X-1, N-4, N-5.
**Was:** Der heutige Satz — *"destructiveHint und idempotentHint sind laut Spec nur
bedeutungstragend, wenn das Nur-Lese-Feld false ist - deshalb fehlen sie bei den reinen
Lese-Werkzeugen bewusst (kein toter Wert)"* — ist nach S2 falsch und muss weg. An seine
Stelle kommen vier Aussagen:

1. OpenAI fuehrt `readOnlyHint`, `destructiveHint` und `openWorldHint` als **Required**
   (Anforderung X-1/N-1); die MCP-Spec fuehrt zwei davon als optional. Bei Widerspruch
   gewinnt die OpenAI-Fassung. `idempotentHint` bleibt optional und steht deshalb weiterhin
   nur dort, wo es etwas aussagt.
2. `openWorldHint` entscheidet sich am **Zugriff** des Werkzeugs, nicht am Thema seiner
   Daten: `get_call_status`, `get_transcript` und `await_call_event` lesen ausschliesslich den
   tenant-lokalen Store (`GET /api/calls/:id`), auch wenn sie ueber einen Anruf nach draussen
   berichten.
3. `answer_consult` traegt `destructiveHint: true`, weil der eingespeiste Text am Telefon
   ausgesprochen wird und nicht zurueckholbar ist.
4. `place_call` behaelt `idempotentHint: false`, obwohl der Aufruf fuer eine bereits laufende
   Nummer denselben Anruf zurueckgibt (`deduplicated`, E3): die Entdopplung gilt nur fuer die
   Dauer des laufenden Anrufs, ein spaeterer Aufruf waehlt erneut. Untertreiben ist hier die
   sichere Richtung; die Entdopplung selbst steht in der Beschreibung (`:549`) und ist damit
   nach N-11 offengelegt.

Dieser Kommentar ist die **Einreichungs-Begruendung nach N-5** und muss sie deshalb tragen:
die Spec-Dateien unter `tasks/` werden nach dem Merge geloescht (CLAUDE.md, Aufraeum-Regel),
der Kommentar bleibt.

**Pfade:** keiner (Kommentar), wirkt aber auf jede spaetere Sitzung.
**Beweis:** `grep -c "deshalb fehlen sie bei den reinen Lese-Werkzeugen" src/mcp-tools.js` ->
**0**; `grep -n "Required" src/mcp-tools.js` trifft im Kommentarblock vor `TOOL_ANNOTATIONS`.

---

### S5 — `await_call_event` nennt seinen Schreibeffekt

**Datei:** `src/mcp-tools.js:971-977` (die Beschreibung; `description:` steht auf `:971`, der
String auf `:972-977`).
**IDs:** N-11.
**Was:** zwei Teile in einem Schritt:

1. **Die Beschreibung wandert auf Modulebene** als `const AWAIT_CALL_EVENT_DESCRIPTION`,
   neben `PLACE_CALL_DESCRIPTION` (`:549`), `CANCEL_CALL_DESCRIPTION` (`:577`) und
   `CHECK_INBOX_DESCRIPTION`. Das ist das etablierte Muster dieser Datei und es ist hier
   Pflicht, nicht Geschmack: `registerTools()` darf per Owner-Auflage nicht wachsen (Kommentar
   `src/mcp-tools.js:500` und `:576`), und die Funktion ist auf ihre Zeilenzahl gepinnt (S6).
   Ausgelagert **schrumpft** sie statt zu wachsen.
2. **Ein Satz kommt hinzu**, der den Schreibeffekt in Klartext nennt — heute spricht die
   Beschreibung nur vom Warten, obwohl jeder Aufruf zwei Felder am Anruf-Datensatz schreibt
   (`store.noteConsultPoll`, `store.markConsultAskDelivered`). `readOnlyHint: false` steht
   bereits richtig (`:610`), aber N-11 verlangt, dass der Seiteneffekt auch menschenlesbar
   nicht versteckt ist.

Wortlaut-Vorgabe (Englisch, Systemgrenze O14 — das Client-Modell liest das, nicht der Tenant):

> `Each call also writes to the call record: it notes that you polled and marks a pending question as delivered, so the same question is not handed out twice.`

**Harte Nebenbedingung:** der neue Satz enthaelt **keinen Grossschreib-Marker**
(`\b[A-Z]{2,}\b`). `test/p15-mcp-tool-descriptions-en.test.js:198` pinnt die Emphase von
`await_call_event` auf `["REPEATEDLY", "NEVER"]` nach Anzahl UND Reihenfolge. Die Vorgabe oben
haelt diesen Pin ein; `test/p15-mcp-tool-descriptions-en.test.js` wird **nicht angefasst**.
Haelt eine spaetere Formulierung den Pin nicht ein, ist der Pin mit begruendetem Kommentar
nachzuziehen (Muster `max_duration_s`/KS-P3 in derselben Datei) — niemals wegzuschreiben.

Der interne Funktionsname `noteConsultPoll` gehoert **nicht** in die Beschreibung: sie ist
Modell-Text, kein Implementierungsprotokoll. Das Abnahmekriterium im Plan laesst die
Klartext-Variante ausdruecklich zu.

**Pfade:** HTTP `/mcp` und stdio (dieselbe Beschreibung), beide UI-Adapter unbeteiligt.
**Beweis:** der E2E-Test aus S8 prueft am ausgelieferten `tools/list`-JSON, dass
`await_call_event.description` die Klartext-Aussage ueber den Schreibeffekt enthaelt; und
`git diff --stat` zeigt `test/p15-mcp-tool-descriptions-en.test.js` **nicht** unter den
geaenderten Dateien, waehrend `NODE_ENV=test node --test
test/p15-mcp-tool-descriptions-en.test.js` `# fail 0` meldet.

---

### S6 — Den Lint-Pin von `registerTools` nachmessen

**Datei:** `eslint-legacy-exceptions.json` (Eintrag `src/mcp-tools.js`, Schluessel
`findings["max-lines-per-function :: Function 'registerTools' has too many lines (512). Maximum allowed is 100."]`).
**IDs:** keine OpenAI-ID — Betriebspflicht, ohne die S5 nicht committet werden kann.
**Was:** S5 aendert die Zeilenzahl von `registerTools`. Der Pin ist die **woertliche
ESLint-Meldung inklusive Zahl**; weicht sie ab, verweigert `scripts/check-staged-suppressions.js`
(Stufe 3, aufgerufen aus `.githooks/pre-commit`) den Commit — in **beide** Richtungen, auch
wenn die Zahl sinkt. Deshalb:

1. Nach S5 die ungefilterte Befundmenge neu ableiten:
   ```
   npx eslint --suppressions-location eslint-suppressions.empty.json -f json src/mcp-tools.js \
     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0];const m={};for(const x of r.messages){const k=x.ruleId+" :: "+x.message;m[k]=(m[k]||0)+1;}console.log(JSON.stringify(m,null,2));});'
   ```
2. **Jeden** abweichenden Schluessel im Pin ersetzen (nicht nur den offensichtlichen) —
   Stufe 3 vergleicht die ganze Map.
3. Dem Feld `reason` einen Satz im Bestandsmuster anhaengen:
   *"ZAHL KORRIGIERT <datum> (P1, N-11): die await_call_event-Beschreibung ist als
   Modulkonstante ausgelagert (Muster PLACE_CALL_DESCRIPTION), registerTools schrumpft von 512
   auf <gemessen> Zeilen. Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer
   Eintrag, keine neue Regel, keine neue Ausnahme."*

**`git commit --no-verify` ist verboten.** Eine stille Umgehung macht das Gate wertlos
(`scripts/check-staged-suppressions.js`, Kopfkommentar).

**Pfade:** keiner (Werkzeugkette).
**Beweis:** `npm run lint` endet mit Exit 0, und ein echter `git commit` der vorgemerkten
Dateien laeuft ohne `--no-verify` durch. Zusaetzlich: die Zahl im Pin ist identisch mit der
Zahl in der Ausgabe von
`npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js`.

---

### S7 — Die Erwartungstabellen im Bestandstest nachziehen

**Datei:** `test/mcp-tool-annotations.test.js:20-47` (`EXPECTED_ANNOTATIONS`) und `:54-68`
(`EXPECTED_CONSULT_ANNOTATIONS`).
**IDs:** N-1, X-1, N-3, N-4 (Regressionsschutz).
**Was:** Dies ist der Test, den S1-S3 **brechen** — er pinnt die Werte per `deepEqual`, an
drei Stellen (fakeServer-Capture ohne Consult, fakeServer-Capture mit Consult, E2E ueber
`/mcp`). Die Literale werden auf die neuen Sollwerte gezogen:

- sieben Lese-Werkzeuge: `destructiveHint: false` ergaenzt,
- `get_call_status`, `get_transcript`: `openWorldHint: false`,
- `await_call_event`: `openWorldHint: false`,
- `answer_consult`: `destructiveHint: true`.

Die Erwartung bleibt **Literal** und wird nicht aus `src/` importiert (Kopfkommentar der
Datei: ein Test, der seine Erwartung aus dem Pruefling zieht, belegt nichts).
`test/mcp-tool-annotations.test.js` traegt weder einen Eintrag in `eslint-suppressions.json`
noch in `eslint-legacy-exceptions.json` — das Aufraeum-Gate greift dort nicht.

**Pfade:** deckt alle Registrierwege ab, die die Datei bereits abdeckt (`server.tool`
positionsbasiert **und** `server.registerTool` per Config).
**Beweis:** `NODE_ENV=test node --test test/mcp-tool-annotations.test.js` -> `# fail 0`, und
`git diff master...HEAD -- test/mcp-tool-annotations.test.js` zeigt genau diese Werte-Aenderungen.

---

### S8 — Der Vollstaendigkeitsbeweis ueber die echte Route (alle 12)

**Datei:** `test/mcp-tool-annotations.test.js` — der bestehende E2E-Test (`:117-149`) bleibt
unveraendert stehen (er deckt die Default-Konfiguration ohne Consult ab); **ein neuer Test**
kommt dazu.
**IDs:** N-1, X-1, N-3, N-4, N-11.
**Was:** Ein Test, der den Server mit freigeschalteter Consult-Faehigkeit startet und den
echten `tools/list`-Output prueft:

```
startServer({ seed: seedState({}), env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" } })
```

Gemessen (s. Abschnitt 0): das liefert **genau die zwoelf** Werkzeuge, weil der
Bootstrap-Tenant auf `OWNER_PROFILE` aufloest (`src/routes/mcp.js:121`,
`src/store/defaults.js:1056-1065`) und `consultAllowedFor()` damit `true` wird
(`src/consult/gate.js:19-25`).

Der Test prueft vier Dinge:

1. **Mengengleichheit** zwischen den gelieferten Namen und der Vereinigung der beiden
   Erwartungstabellen — nicht die Zahl `12` gegen eine Konstante. So faellt sowohl ein
   fehlendes als auch ein dreizehntes Werkzeug auf, und der Test kann nicht still auf zehn
   Werkzeuge zusammenschrumpfen, wenn jemand das Consult-Gate verstellt.
2. Fuer **jedes** gelieferte Werkzeug: `typeof annotations.readOnlyHint === "boolean"`,
   dito `destructiveHint`, dito `openWorldHint`. Das ist X-1/N-1 am ausgelieferten JSON.
   Die Schleife laeuft ueber `result.tools`, **nicht** ueber eine handgepflegte Namensliste.
3. Fuer **jedes** gelieferte Werkzeug: `deepEqual(tool.annotations, tabelle[tool.name])` —
   das ist die `openWorldHint`-Wahrheitstabelle aus S1 und `answer_consult.destructiveHint`
   aus S3, Zeile fuer Zeile.
4. `await_call_event.description` enthaelt die Klartext-Aussage ueber den Schreibeffekt
   (N-11) — geprueft am Wire-Text, nicht am Dateitext.

Warum das ueber `tools/list` laufen muss und nicht ueber das Registrierobjekt:
`registerTool()` des SDK destrukturiert eine feste Feldliste und **verwirft unbekannte Felder
still** (P0/U-2, `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:703`). Ein
Test am Config-Objekt belegt deshalb nichts ueber das, was der Host sieht.

Testname (bindend, weil er der Beweis ist):
`P1 (N-1/X-1/N-3/N-4/N-11): tools/list ueber /mcp liefert mit Consult-Faehigkeit alle 12 Werkzeuge - Annotationen vollstaendig und tabellentreu, await_call_event nennt seinen Schreibeffekt`

**Namensfalle:** der Name darf **nicht** mit einem Katalog-Praefix beginnen. `package.json`
`config.i18nCatalogPattern` = `^(Charakterisierung )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]`.
Ein Name wie `MCP-1: ...` landete im `test:gates`-Lauf statt im Regressionslauf und waere in
`npm test` unsichtbar. `P1 (` ist sicher.

**`env`-Hinweis:** `CONSULT_ENABLED` und `ASSISTANT_CONTEXT_ENABLED` sind **bestehende**
Variablen, beide bereits in `src/config.js` und `.env.example`; `startServer({env})` legt sie
ueber `BASE_ENV` (`test/helpers.js:1401`). **Diese Phase fuehrt keine neue Env-Variable ein** —
die Vier-Orte-Regel (`src/config.js`, `.env.example`, `render.yaml`, `BASE_ENV`) hat hier
nichts zu tun.

**Pfade:** HTTP `/mcp` (echter Request), beide Registrierwege (`uiTool`/`tool`), beide
UI-Adapter (unbeteiligt, weil `annotations` ausserhalb von `src/mcp-tools.js` nirgends
vorkommt).
**Beweis:** `NODE_ENV=test node --test test/mcp-tool-annotations.test.js` -> `# fail 0`; der
Pruefer liest den Test und bestaetigt, dass Schleife (2) und (3) ueber `result.tools` laufen
und nicht ueber eine Namensliste.

---

### S9 — Doppelter Pfad HTTP/stdio: belegt statt behauptet

**Datei:** `test/mcp-tool-annotations.test.js` (neuer Test), Belegstellen `src/mcp-server.js:26`
und `src/routes/mcp.js:151`.
**IDs:** N-1, X-1, N-3, N-4 (Pfad-Abdeckung).
**Was:** Zwei Dinge:

1. Der bestehende Vollstaendigkeitstest (`test/mcp-tool-annotations.test.js:105`) wird
   umbenannt und um `destructiveHint` erweitert:
   `P0-1/P1 (X-1): kein registriertes Werkzeug kommt ohne die drei Pflicht-Annotationen durch`.
2. Ein neuer Test vergleicht zwei `captureAnnotations(...)`-Laeufe:
   - **stdio-ctx**, genau wie `src/mcp-server.js:26-28` ihn uebergibt: `{ uiHost: { enabled: false } }`
     (Defaults der Funktion: `allowCalendar = true`, `consultAllowed = false`,
     `src/mcp-tools.js:657-666`),
   - **HTTP-ctx**: `{ allowCalendar: true, consultAllowed: true, uiHost: { enabled: true } }`.

   Erwartung: fuer jeden Namen, den **beide** Laeufe kennen, sind die Annotationen
   `deepEqual`. Damit ist belegt, dass der ctx nur entscheidet, **welche** Werkzeuge
   registriert werden, nie **mit welchen Werten**.

Testname: `P1 (DP-1): stdio-ctx und HTTP-ctx liefern fuer dasselbe Werkzeug identische Annotationen`.

Ein echter stdio-JSON-RPC-Harness wird **nicht** gebaut (s. Abschnitt 2).

**Pfade:** stdio und HTTP `/mcp` explizit; mcp-nativer und ChatGPT-Adapter ueber den
grep-Beleg.
**Beweis:** (a) `grep -rn "annotations" src/ --include="*.js" | grep -v "src/mcp-tools.js" | wc -l`
-> **0** und `grep -rn "registerTools(" src/ --include="*.js"` zeigt genau zwei Aufrufer
(`src/mcp-server.js:26`, `src/routes/mcp.js:151`); (b) der Test oben ist gruen.

---

### S10 — Gesamtlauf gegen die Grundlinie

**Datei:** keine.
**IDs:** alle.
**Was:** `npm test -- -- --test-concurrency=4`. **Nur der doppelte `--`-Trenner reicht das
Flag durch** (`test/i18n-catalog-run.mjs:103-106`); ohne ihn laeuft die Suite mit voller
Parallelitaet, also in dem Zustand, in dem sie bekanntermassen rot wird.
Ausgewertet werden ausschliesslich die TAP-Zeilen `# pass` und `# fail`, **nie** der
Exit-Code.

Grundlinie vor dieser Kette: **6153 Tests, 6152 gruen**, ein bekannter Flake
(`test/sec-p4-mandanten-token.test.js`, isoliert 18/18 gruen). Nach P1 kommen die neuen Faelle
aus S8/S9 hinzu; **weniger gruen als vorher heisst: etwas ist kaputt**. Ein roter Test wird
isoliert nachgefahren (`NODE_ENV=test node --test <datei>`), bevor er als Defekt gilt.

Zusaetzlich: `npm run test:gates` bleibt unveraendert (P1 fuegt keinen Katalogtest hinzu — s.
Namensfalle in S8), `npm run format:check` und `npm run lint` enden mit Exit 0.

**Pfade:** alle.
**Beweis:** die Zeilen `# pass` / `# fail` des Laufs, Grundlinie 6152 gruen + die neuen Faelle,
`# fail 0` (oder `# fail 1` mit isoliert gruenem Nachlauf des bekannten Flakes).

---

## 2. Was in dieser Phase NICHT gebaut wird

| Nicht gebaut | Grund |
|---|---|
| **stdio-JSON-RPC-Harness** (Kindprozess `src/mcp-server.js`, `tools/list` ueber die Pipe) | Neue Testinfrastruktur, deren einzige P1-Nutzlast S9 bereits abdeckt: es gibt genau eine Quelle (`TOOL_ANNOTATIONS`, 0 Treffer ausserhalb `src/mcp-tools.js`) und genau zwei `registerTools()`-Aufrufer. Die Werte koennen zwischen den Transporten nicht divergieren. Der Harness hat mehr Nutzlast in P2/P3, wo `title`/`_meta` an der SDK-Grenze haengen. |
| **`idempotentHint` an den sieben Lese-Werkzeugen** | N-1 fuehrt das Feld ausdruecklich als optional. An einem Nur-Lese-Werkzeug waere es ein Wert ohne Aussage — und damit toter Code im Sinne von CLAUDE.md. |
| **`place_call.idempotentHint` auf `true`**, obwohl E3 entdoppelt | Die Entdopplung gilt nur fuer die Dauer eines laufenden Anrufs (`src/mcp-tools.js:549`, `:946`); danach waehlt ein zweiter Aufruf erneut. `false` untertreibt und ist die sichere Richtung — `true` waere eine Falschangabe (N-5/N-6). Die Entdopplung ist in der Beschreibung offengelegt, N-11 ist damit erfuellt. Nur der Kommentar aus S4 haelt die Entscheidung fest. |
| **Die uebrigen neun `openWorldHint`-Werte** | Am Zugriff geprueft, alle bereits richtig (Tabelle in S1). Eine Aenderung waere eine Falschangabe. |
| **`title` als Top-Level-Feld, `openai/toolInvocation`** | Gehoert zu P2. Gemessen: `tools/list` liefert heute `["name","description","inputSchema","annotations","execution","outputSchema"]` — kein Top-Level-`title`. Das ist ein Befund fuer P2, kein P1-Schritt. |
| **`securitySchemes`** | P3, Weg B (Low-Level-Override), D0-5. |
| **Beschreibungs-Aenderungen ausser `await_call_event`** | `get_transcript` und der Server-`instructions`-Text gehoeren zu P4; Datenminimierung zu P5a/P5b. |
| **Ein N-5-Einreichungstext als eigenes Dokument** | Die Begruendung gehoert dorthin, wo sie ueberlebt: in den Kommentar bei `TOOL_ANNOTATIONS` (S4). `tasks/**` wird nach dem Merge geloescht. Das Abtippen in das Einreichungsformular ist Owner-Arbeit. |
| **Jede Aenderung an `test/p15-mcp-tool-descriptions-en.test.js`** | Der Emphase-Pin ist ein Regressionsfang der Anrufqualitaets-Kette. S5 ist so formuliert, dass er unberuehrt gruen bleibt. Ihn "gruen zu machen" waere das Abschalten einer Sicherung. |
| **Neue Env-Variable, `render.yaml`, `.env.example`, Config** | P1 fasst keine Konfiguration an. `CONSULT_ENABLED`/`ASSISTANT_CONTEXT_ENABLED` existieren bereits und werden nur im Test gesetzt. |
| **`grep -c` als bindendes Abnahmekriterium** | Gemessen: `grep -c "destructiveHint:"` liefert heute **5**, nicht die im Plan genannte 6 (das ist die colon-lose Variante). Ein Zahlkriterium, das am Kommentartext haengt, laesst einen fremden Pruefer die Phase falsch durchfallen. Der Beweis ist der Test. |

---

## 3. Pre-Mortem — ein Jahr spaeter war P1 ein Fehler

1. **`answer_consult.destructiveHint: true` hat den Consult-Kanal getoetet.** ChatGPT
   eskalierte auf `destructiveHint` und verlangte pro Rueckfrage eine Bestaetigung; der Agent
   stand am Telefon, niemand klickte, die Frist lief ab.
   *Entschaerfung:* N-8 bindet die Bestaetigungspflicht an **Write-Actions**
   (`readOnlyHint: false`), nicht an `destructiveHint` — und `answer_consult` ist bereits
   heute `readOnlyHint: false` (`src/mcp-tools.js:616`). Die Pflicht besteht also schon und
   aendert sich durch P1 nicht. Zweitens ist der Kanal in Produktion heute gar nicht
   freigeschaltet (`CONSULT_ENABLED=false`, `render.yaml:424-425`) — die Sprengweite ist null,
   solange der Owner ihn nicht anschaltet. *Akzeptiertes Restrisiko:* ob ChatGPT intern
   zusaetzlich auf `destructiveHint` eskaliert, ist nicht dokumentiert (UNKNOWN). Die
   Alternative waere eine Falschangabe, und die ist nach N-5/N-6 teurer.
2. **`openWorldHint: false` an `get_transcript` galt dem Reviewer als Luege.** Er las das
   Werkzeug als "gibt Daten aus der offenen Welt zurueck" und lehnte nach N-5/N-6 ab.
   *Entschaerfung:* N-4 definiert das Feld ueber den **Zugriff**, nicht ueber das Thema; die
   Route steht in S1 je Zeile. Die Begruendung liegt als Kommentar im Code (S4) und ist damit
   im Einreichungsformular abschreibbar, statt frei erfunden zu werden.
3. **Der Lint-Pin wurde mit `--no-verify` uebergangen.** Der Commit ging durch, die
   Ratsche war ab diesem Tag wertlos, und ein halbes Jahr spaeter trug `src/mcp-tools.js`
   neue Verstoesse, die niemand gesehen hat.
   *Entschaerfung:* S6 ist ein eigener Schritt mit Ableitungskommando und Messpflicht; sein
   Beweis ist ein Commit, der ohne `--no-verify` durchlaeuft. `--no-verify` ist im Auftrag
   und im Kopfkommentar von `scripts/check-staged-suppressions.js` ausdruecklich verboten.
4. **Der neue Satz in `await_call_event` trug ein Grossschreib-Wort, `p15` wurde rot, und
   jemand hat den Emphase-Pin "aufgeraeumt".** Damit war der Regressionsfang der
   Anrufqualitaets-Kette weg, und die teuer erarbeiteten Verbote in `place_call` sind ueber die
   naechsten Monate abgeschliffen.
   *Entschaerfung:* der Wortlaut in S5 traegt keinen Marker; der Beweis ist, dass die Datei im
   Diff **nicht** vorkommt. Muss ein Marker sein, wird der Pin mit Begruendung nachgezogen,
   nie gesenkt.
5. **Ein dreizehntes Werkzeug kam dazu und trug kein `destructiveHint`.** Die Einreichung
   fiel durch, und niemand verstand warum, weil "P1 war doch gruen".
   *Entschaerfung:* der Vollstaendigkeitstest iteriert ueber `result.tools` bzw. ueber die
   Capture-Map, nicht ueber eine gepflegte Namensliste — ein neues Werkzeug ohne die drei
   Felder ist sofort rot. Die Mengengleichheit in S8 zwingt zusaetzlich dazu, die
   Erwartungstabelle bewusst zu erweitern.
6. **Der 12-Werkzeug-Test schrumpfte still auf zehn.** Jemand drehte das Consult-Gate oder
   `BASE_ENV`, die Consult-Werkzeuge erschienen nicht mehr, der Test blieb gruen — und
   `answer_consult.destructiveHint` war seit Monaten ungeprueft.
   *Entschaerfung:* S8 prueft **Mengengleichheit** gegen die Erwartungstabelle, nicht nur
   "jedes gelieferte Werkzeug ist in der Tabelle". Fehlt `answer_consult`, ist der Test rot.
7. **P1 wurde als "N-1 erfuellt" verbucht, obwohl stdio nie geprueft wurde.** Genau dort ist
   der letzte Anlauf auseinandergegangen.
   *Entschaerfung:* S9 belegt die Nicht-Divergenz zweifach — am Code (eine Quelle, zwei
   Aufrufer, 0 Treffer ausserhalb) und an einem Test, der beide ctx-Varianten vergleicht. Dass
   kein echter stdio-Wire-Test gebaut wird, steht ausdruecklich in Abschnitt 2 mit Grund, statt
   unausgesprochen zu bleiben.

---

## 4. Widersprueche zwischen Plan, P0 und dem Code — und wie sie aufgeloest sind

| # | Widerspruch | Aufloesung |
|---|---|---|
| **W-1** | Plan: "die **12** ueber `tools/list` gelieferten Tools". P0: heute liefert die Route **10** (Owner) bzw. **9** (alle uebrigen), ein zahlender Plan hoechstens **11**. | **Beides stimmt, der Plan meint die Registrierungen.** Selbst gemessen: mit `CONSULT_ENABLED=true` + `ASSISTANT_CONTEXT_ENABLED=true` liefert die echte HTTP-Route genau 12. Der Test aus S8 setzt diese Umgebung und prueft **Mengengleichheit gegen die Namenstabelle**, nicht die Zahl 12 gegen die Default-Konfiguration. Haette der Test die Zahl 12 gegen den Default gestellt, waere er sofort rot; haette er sie weggelassen, waere er still auf 10 geschrumpft. |
| **W-2** | Plan, Abnahmekriterium 1: `grep -c "destructiveHint:" src/mcp-tools.js` -> 12; "heute gemessen 6". | **Gemessen: 5** mit Doppelpunkt, 6 ohne. Die Plan-Zahl 6 gehoert zur colon-losen Variante. Nach S2/S4 ergibt die colon-Variante 12 — aber nur, solange der neue Kommentar den Feldnamen ohne Doppelpunkt schreibt. Ein Kriterium, das an einer Kommentar-Schreibweise haengt, ist kein Kriterium: das grep ist als **nicht bindender Schnellabgleich** gefuehrt, bindend ist der Test aus S8. |
| **W-3** | Plan: "`await_call_event`-Beschreibung `:972-978`". | Tatsaechlich steht `description:` auf `:971`, der String auf `:972-977`, `annotations:` auf `:978`. Um eine Zeile verschoben, sachlich gleich. Korrigiert in S5. |
| **W-4** | Der Plan kennt den **Lint-Pin** nicht. | `eslint-legacy-exceptions.json` pinnt `registerTools` woertlich auf "(512)"; `scripts/check-staged-suppressions.js` (Stufe 3, aus `.githooks/pre-commit`) verweigert den Commit bei jeder Abweichung, auch nach unten. Die P1-Aenderung an der Beschreibung liegt **in** dieser Funktion. Neuer Schritt S6; zusaetzlich ist die Beschreibung ausgelagert (S5), damit die Funktion schrumpft statt zu wachsen — die Owner-Auflage "registerTools darf nicht wachsen" steht als Kommentar in derselben Datei (`:500`, `:576`). |
| **W-5** | Der Plan kennt den **Emphase-Pin** nicht. | `test/p15-mcp-tool-descriptions-en.test.js:198` pinnt `await_call_event` auf `["REPEATEDLY","NEVER"]` nach Anzahl und Reihenfolge. Der Wortlaut in S5 traegt bewusst keinen Marker; die Datei bleibt unberuehrt und gruen. |
| **W-6** | Plan, Abnahmekriterium 4: die Beschreibung soll das Wort `noteConsultPoll` enthalten. | **Abgelehnt.** Die Beschreibung ist Modell-Text an der Systemgrenze O14, kein Implementierungsprotokoll; ein interner Funktionsname dort ist weder Englisch noch Klartext. Der Plan laesst die Klartext-Variante ausdruecklich zu ("bzw. eine Klartext-Aussage"). Gewaehlt: Klartext. |
| **W-7** | Plan, DP-3: "Legacy `tool()` vs. `uiTool()` — P1 nicht betroffen". | **Bestaetigt am Code**, aber schaerfer: beide Wege reichen `annotations` durch, und der bestehende E2E-Test pinnt genau deshalb `cancel_call` und `list_action_items` als Legacy-Pfad-Beleg (`test/mcp-tool-annotations.test.js:144-147`). Dieser Beleg bleibt erhalten. |
| **W-8** | Weder Plan noch P0 haben `idempotentHint` gegen E3 (Anruf-Entdopplung) geprueft. | Neuer Befund: `place_call` traegt `idempotentHint: false` (`:604`), obwohl der Aufruf fuer eine laufende Nummer denselben Anruf zurueckgibt (`:549`, `:946`). **Kein Wertwechsel** — die Entdopplung ist zeitlich begrenzt, `false` untertreibt und ist die sichere Richtung. Die Entscheidung wird im Kommentar (S4) festgehalten, damit die naechste Sitzung sie nicht "korrigiert". |
| **W-9** | Plan: "`openWorldHint` ist an sechs Tools `true` (:605, :612, :619, :621, :622, :628)". | **Stimmt zeilengenau**, nachgeprueft. Ebenso die Zeilen der sieben Werkzeuge ohne `destructiveHint` und die Routenverweise in der Wahrheitstabelle. Keine Abweichung. |
| **W-10** | P0 nennt `answer_consult` einmal bei `:968`. | P0 korrigiert das selbst (NACHTRAG N-3): `await_call_event` wird auf `:969` registriert, `answer_consult` auf `:1003-1004`. Am Code bestaetigt. |

---

## 5. UNKNOWN (mit Grund, nicht wegerklaert)

- **Eskaliert ChatGPT auf `destructiveHint` zusaetzlich zu `readOnlyHint`?** Nicht
  dokumentiert; N-8 spricht nur von Write-Actions. Nicht klaerbar ohne einen echten
  Developer-Mode-Connector in einem ChatGPT-Konto (Owner-Messung O-5/OW-4). Folge: keine —
  die Alternative waere eine Falschangabe.
- **Wie viele Werkzeuge sieht ein echter Reviewer live?** Abhaengig vom Live-Wert von
  `CONSULT_ENABLED` im Render-Dashboard (O-6) und vom Plan des Demo-Accounts (P0/N-1:
  ein zahlender Plan erreicht hoechstens 11). Nicht aus dem Repo lesbar. Folge fuer P1: keine —
  der Test setzt die Umgebung selbst und prueft alle zwoelf.
- **Wie genau muss `destructiveHint` bei einem Nur-Lese-Werkzeug gesetzt sein, damit OpenAIs
  Pruefung es akzeptiert (`false` vs. weglassen)?** Die Anforderungsliste sagt nur "Required".
  `false` ist die einzige Lesart, die "Required" erfuellt, ohne zu luegen.
