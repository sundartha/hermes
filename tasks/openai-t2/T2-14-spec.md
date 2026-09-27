# T2-14 - Widget: Bestaetigungs-Ansicht im Call-Widget (Spec fuer den Bau)

- IDs: **N-10** (sichtbarer Schritt; erfuellt erst zusammen mit dem gemergten Serverteil T2-13).
- Branch: `phase/openai-t2-14-call-widget-confirm-ui`, Worktree
  `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-14`
- Basis: `c726212` (master, T2-01..T2-13 + T2-23 gemergt - nichts davon zuruecknehmen).
- Diese Datei bleibt UNGETRACKT im Haupt-Arbeitsbaum. Alle Arbeit NUR im Worktree.

## 0. Kernentscheidung (bindend fuer den Bau) - und warum sie vom Plan abweicht

Der Plan-Abschnitt T2-14 (tasks/PLAN-OPENAI-TECHNIK-2.md:926-973) will: die Karte schickt nach
dem Klick eine `ui/message` (role user) MIT dem Code an das Modell, das Modell ruft dann
`place_call` mit dem Code; "Das Widget ruft `place_call` NIE selbst"; Rueckfall "Code anzeigen,
Gib diesen Code im Chat ein". Die gepinnte Lead-Vorgabe dieser Phase sagt das Gegenteil: **die
Karte sendet `place_call` mit Code selbst ueber die Host-Bruecke (`tools/call`), der Code
erreicht das Modell NIE (keine `ui/message` mit Code, kein Code-Text an das Modell).**

Gebaut wird die Lead-Vorgabe. Gruende, am Code belegt:

1. **Anzeige = Gesendetes (Pre-Mortem a) geht nur so.** Der Code ist an ALLE Argumente gebunden
   (`src/call-confirmation.js:106-109`, `canonicalCallRequest`: alles ausser `confirmation_code`,
   inkl. `briefing`, `context`, `mandate`, `constraints`, `diagnostic`, `language`,
   `max_duration_s`). Muss das Modell einen langen `briefing`/`context` Zeichen fuer Zeichen
   wiederholen, scheitert jede Umformulierung an der HMAC-Pruefung (isError-Schleife). Die Karte
   dagegen sendet exakt das Objekt, das sie anzeigt.
2. **Die Vorschau IST die gebundene Argumentmenge.** `buildPreview`
   (`src/routes/api-call-confirmations.js:47-53`) gibt `to` (normalisiert) + `objective` + alle
   mitgegebenen Felder aus `PREVIEW_OPTIONAL_FIELDS` (`:45`) zurueck; das zod-Schema
   `PLACE_CALL_REQUEST_SCHEMA` (`src/mcp-tools.js:1177ff`) kennt genau diese neun Felder, das SDK
   verwirft alles andere. `structuredContent` von `prepare_call` ist damit dieselbe Quelle fuer
   Anzeige UND Senden.
3. **Der Sendeweg existiert schon.** Die Karte ruft heute `get_call_status`, `get_call_result`,
   `cancel_call` ueber JSON-RPC `tools/call` an den Host (`src/ui/widgets/call.html:655-667`,
   `sendToolCall`). Kein neuer Transport.
4. **Der Plan-Einwand ist loesbar:** "das Modell braucht den `call_id` fuer `await_call_event`".
   Nach ERFOLGREICHEM `place_call` sendet die Karte GENAU EINE `ui/message` (role user) mit
   `call_id` und Ziel - OHNE Code. Das ist kein Code-Text an das Modell.

Folge: die Modelltexte aus T2-13 ("the card sends the confirmation code ... only then pass it to
place_call") werden falsch und muessen mitgezogen werden (Schritt 4). Der Plan-Rueckfall "Code
anzeigen / im Chat eingeben" entfaellt (er wuerde den Code ans Modell geben).

## 1. Ist-Stand (gelesen im Worktree, c726212)

- `prepare_call` (`src/mcp-tools.js:1439-1480`): `structuredContent = previewResult.preview`,
  `_meta = { "hermes/confirmation_code", "hermes/confirmation_expires_at" }` nur bei
  `MCP_UI_ENABLED`; `withWidgetLocale` (`:1155-1163`) haengt `hermes/locale` an.
  Schluessel-Konstanten `CONFIRMATION_CODE_META_KEY`/`CONFIRMATION_EXPIRES_META_KEY`
  (`:1170-1171`, NICHT exportiert).
- `place_call` (`:1492-1560`): Code optional im Schema, Pflicht im Handler (`confirmCallHop`,
  `:1519-1527`), sonst `errText(loc.mcp.confirmationRequired(to, objective))`. Hop-Frist
  `PLACE_CALL_HOP_TIMEOUT_MS = 180000` (`:333`) - `place_call` kann ueber die Klingelphase
  blockieren (Kommentar `:322`).
- `expires_at` = Ende des AUSSTELLUNGS-Fensters (`src/call-confirmation.js:157`), angenommen
  wird bis zu einem Fenster laenger (`ACCEPTED_WINDOWS = 2`, `:54`). Karten-Pruefung gegen
  `expires_at` ist also konservativ (fail-closed).
- Einmal-Verbrauch: `consumeIfCurrent` (`api-call-confirmations.js:168-186`) - ein zweiter
  `place_call` mit demselben Code -> `confirmed:false` -> isError, kein Anruf.
- Call-Widget: Kanal A (`ui/notifications/tool-result`) liest nur `params.structuredContent`
  (`call.html:718-723`), `_meta` wird von der Karte heute NICHT gelesen (nur vom I18N-Script,
  `src/ui/widget-i18n.js:200-214`). Ein `awaiting_confirmation`-Push landet heute in
  `applyCallStatus` -> `STATUS_VIEW` kennt den Status nicht -> alles "—", Cancel-Knopf
  sichtbar. Kein Bestaetigungsknopf, keine Anzeige von Ziel/Anliegen/Briefing.
- Werte landen nur ueber `textContent` (Test `T-W1-call-AC6`: kein `innerHTML`).
- `WIDGET_DICT` (`src/ui/widget-i18n.js:40ff`, de+fr, en = Key) wird in JEDES Widget serialisiert
  (`buildI18nScript`, `:182`) -> neue Keys aendern das HTML ALLER vier Widgets.
- Versions-Pins: `src/ui/widget-versions.json` (call hoechste Version 3; agent-status 3,
  my-number 4, calls 3). Regel dort: neue Version anhaengen, nie ueberschreiben.
- Groesse: call.html ausgeliefert 250501 Byte; harte Grenzen `T-W1-call-AC-size` < 266240 Byte
  (260 KB) und `S7(d)` <= 247763*1.1. Spielraum ~15 KB fuer ALLES Neue in call.html.
- Kein X-6-Sandbox-Scan im Bestand (`grep -rn clipboard test src` = 0 Treffer).

## 2. Schritte

### Schritt 1 - Bestaetigungs-Ansicht in `src/ui/widgets/call.html` (Markup + Zustand)
- **Wo:** Markup nach `.rows` (`call.html:163-184`) ein eigener Block `data-confirm` (anfangs
  `display:none`), Script im letzten Inline-Block (`:222-792`; Autorenregel: bleibt der LETZTE
  Script-Block).
- **Was:**
  - Neue Konstanten (benannt, keine Magic Numbers): `TOOL_PLACE_CALL = "place_call"`,
    `METHOD_UI_MESSAGE = "ui/message"`, `CONFIRMATION_CODE_META_KEY =
    "hermes/confirmation_code"`, `CONFIRMATION_EXPIRES_META_KEY =
    "hermes/confirmation_expires_at"`, `STATUS_AWAITING_CONFIRMATION = "awaiting_confirmation"`,
    `PLACE_CALL_RESPONSE_TIMEOUT_MS` = groesser als `PLACE_CALL_HOP_TIMEOUT_MS` (180000) plus
    Marge (z.B. 200000), mit Kommentar, woher die Zahl kommt; `BOUND_ARG_FIELDS` = die neun Felder
    aus `PLACE_CALL_REQUEST_SCHEMA` (`to, objective, briefing, constraints, mandate, context,
    language, max_duration_s, diagnostic`).
  - Zustand `confirmState`: `"none" | "awaiting" | "submitting" | "placed" | "rejected" |
    "uncertain" | "expired"` plus `pendingConfirmation = { args, code, expiresAtMs }` - EIN
    eingefrorenes Objekt; Anzeige UND `tools/call`-Argumente werden AUSSCHLIESSLICH daraus
    gelesen.
  - Kanal A: kommt `ui/notifications/tool-result` mit `structuredContent.status ===
    "awaiting_confirmation"`: NUR wenn `confirmState` `"none"` oder `"awaiting"` ist, wird
    `pendingConfirmation` gebaut (`args` = die `BOUND_ARG_FIELDS` aus `structuredContent`,
    Kopie; `code`/`expires` aus `params._meta`). Jeder andere Zustand ignoriert den Push (ein
    Replay aus dem Verlauf setzt eine bereits abgeschickte Karte NIE zurueck). Dieser Push geht
    NICHT in `applyCallStatus` (kein Status-Slot-Bruch, kein Poll).
  - Anzeige (nur `textContent`): Ziel (`to`), Anliegen (`objective`), Briefing, Sprache
    (`language`, roh), Maximaldauer (`max_duration_s`, ueber `formatDuration`), dazu jedes
    weitere gesendete Feld (`constraints`, `mandate`, `context`, `diagnostic`) als eigene Zeile;
    Objekte als `schluessel: wert`-Zeilen (Werte `String()`/`JSON.stringify` fuer Verschachtelte),
    NIE als Markup. Fehlt ein Feld in `args`, entfaellt seine Zeile. Ein Feld, das gesendet wird,
    MUSS sichtbar sein (Test Schritt 6 d).
  - Die Anzeige-Elemente tragen KEIN `data-mcp` (sonst schreibt BIND_SCRIPT dieselben Werte
    ein zweites Mal aus einem zweiten Pfad - Muster Kommentar `call.html:158-162`).
  - Cancel-Knopf im Zustand `awaiting` verborgen; Status-Pill/HUD zeigen einen eigenen
    Bestaetigungs-Text (neuer `STATUS_VIEW`-Eintrag oder eigene Anzeige).
  - Knopf "Confirm call" (`data-confirm-button`). Klick-Handler (EINZIGER Sendeort):
    1. `confirmState !== "awaiting"` -> return (Doppelklick-Sperre, synchron VOR jedem Senden).
    2. Kein Code / kein `expiresAtMs` / `Date.now() >= expiresAtMs` -> Zustand `expired`, Hinweis
       "neu vorbereiten", KEIN Senden.
    3. `sendToolCall(TOOL_PLACE_CALL, Kopie von args + { confirmation_code: code })`; liefert es
       `false` (Handshake noch nicht fertig), bleibt der Zustand `awaiting` und der Knopf aktiv
       (Muster `onCancelClick`, `call.html:691-696`). Bei `true`: Zustand `submitting`, Knopf
       `disabled`, Timer `PLACE_CALL_RESPONSE_TIMEOUT_MS`.
  - Antwort (Kanal B, `pendingRequests[id] === "place_call"`):
    - Erfolg (`result.structuredContent.call_id` vorhanden, kein `isError`): Zustand `placed`,
      Bestaetigungsblock weg, `applyCallStatus(structuredContent)` -> Karte laeuft als Live-Karte
      weiter (Polling existiert schon). Danach GENAU EINE `ui/message`:
      `{ jsonrpc:"2.0", id, method:"ui/message", params:{ role:"user", content:[{ type:"text",
      text }] } }` - Text lokalisiert, enthaelt `call_id` und Ziel, NIE den Code, NIE briefing/
      context. Form von `params` vor dem Bau woertlich gegen die Primaerquelle pruefen
      (ext-apps `specification/2026-01-26/apps.mdx`, Abschnitt `ui/message`) und im Kommentar
      zitieren. Eine Fehlerantwort des Hosts auf diese `ui/message` wird ignoriert (die Karte
      pollt ohnehin selbst), kein zweiter Versand.
    - `result.isError` (Code verbraucht/abgelaufen/Argument geaendert, oder ein Gate lehnt ab):
      Zustand `rejected`, lokalisierter Hinweis "Anruf wurde nicht gestartet - bitte den Assistenten,
      ihn neu vorzubereiten", Knopf bleibt gesperrt, KEINE `ui/message`, kein Code im DOM-Text.
    - JSON-RPC-Fehler (`m.error`) ODER Timer abgelaufen: Zustand `uncertain` - Hinweis "Unklar,
      ob der Anruf gestartet wurde. Nicht erneut bestaetigen; Anrufliste pruefen." Knopf bleibt
      gesperrt, KEIN erneuter `tools/call`. (Ein Host-Timeout heisst nicht "nicht gewaehlt" -
      der Server kann den Anruf schon angelegt haben.) Genau eine `ui/message` OHNE Code: "Ich
      habe einen Anruf an <Ziel> in der Hermes-Karte bestaetigt; die Karte hat keine
      Rueckmeldung erhalten. Bitte mit list_calls pruefen, nicht erneut place_call." Kein Code.
  - Spaet eintreffende Antwort nach Timer: Erfolg wird noch angewendet (Karte zeigt den Anruf),
    aber keine zweite `ui/message`.
  - Verboten in der Datei: `navigator.clipboard`, `window.alert/prompt/confirm`, bare `alert(`,
    `prompt(`, `confirm(` (Funktionsnamen entsprechend waehlen, z.B. `onConfirmButtonClick`),
    `innerHTML`, `window.openai`, der Teilstring `callTool` (T-W1-call-F1), jedes `console.*`
    mit dem Code.
- **IDs:** N-10. **Pfade:** Widget laeuft im Host; ausgeliefert ueber `resources/read` auf HTTP
  `/mcp` (OAuth und Token/Legacy) und stdio - dieselbe Datei.
- **Beweis:** (b) Tests Schritt 6 (a)-(k).

### Schritt 2 - Texte in `src/ui/widget-i18n.js` (`WIDGET_DICT`, de + fr; en = Key)
- **Was:** alle neuen sichtbaren Texte aus Schritt 1 (Titel "Confirm this call", Zeilenlabels
  "To", "Request", "Briefing", "Call language", "Max. duration", "Constraints", "Mandate",
  "Context", "Diagnostic", Knopf "Confirm call", Hinweise expired/rejected/uncertain,
  Status-Label, die zwei `ui/message`-Texte mit Platzhalter). Platzhalter-Ersetzung im Widget
  per String-`replace` auf festen Token, Ergebnis nur als Text.
  Statische Labels mit `data-i18n="<EN-Text>"` (Muster `call.html:166`).
- **IDs:** N-10. **Pfade:** alle Widget-Pfade (Dict geht in jedes Widget).
- **Beweis:** (b) `test/mcp-ui-widget-i18n.test.js` gruen (Vollstaendigkeit de/fr) + Test
  Schritt 6 (i) (DE/EN/FR-Rendering der Ansicht).

### Schritt 3 - Widget-Versionen und Pins nachziehen
- **Wo:** `src/ui/widget-versions.json`; `test/openai-p8-widget-ui.test.js` (tools/list-Hash-Pin,
  Kommentar "Voriger Sollwert" wie Bestand).
- **Was:** fuer JEDES Widget, dessen `sha256(widgetHtml(id))` sich aendert (erwartet: alle vier,
  weil `WIDGET_DICT` in jedes serialisiert wird), eine NEUE Version anhaengen (call 4,
  agent-status 4, my-number 5, calls 4 - am Test messen, nicht schaetzen). `_comment`
  um einen Satz T2-14 ergaenzen (ohne interne Produktionswerte). Alte Eintraege NIE aendern.
- **IDs:** N-10 (Folge). **Pfade:** tools/list HTTP + stdio (resourceUri traegt die Version).
- **Beweis:** (b) `test/openai-t2-02-widget-uris.test.js` S7(a)/(a)-Ledger/(b)/(c)/(d) gruen;
  P8-Hash-Test gruen mit neuem Sollwert.

### Schritt 4 - Modelltexte an das neue Verhalten anpassen
- **Wo:**
  - `src/mcp-tools.js:806-807` `PLACE_CALL_DESCRIPTION` (erster Satz),
    `:818-819` `PREPARE_CALL_DESCRIPTION`, `:1504-1509` Beschreibung von `confirmation_code`,
    Kommentare `:790-805`, `:809-817`, `:1433-1437`, `:1449-1461` (nennen "die Karte sendet den
    Code" - richtigstellen: die Karte waehlt selbst, das Modell sieht den Code nie).
  - `src/i18n/mcp-texts.js` de/en/fr: `confirmationRequired`, `prepareCallCardHint`
    (`:120-147`, en `:248-258`, fr entsprechend), `prepareCallNoCardHint` nur falls noetig.
  - `src/mcp-server-info.js:106-115` (Bestaetigungs-Satz der Server-Instruktionen).
- **Was (inhaltlich):** der NUTZER bestaetigt in der Hermes-Karte; die Karte startet den Anruf
  dann selbst und meldet den `call_id`; das Modell ruft fuer diesen Anruf `place_call` NICHT
  selbst auf; nie einen Code raten oder erfinden; aendert sich ein Argument -> neues
  `prepare_call`, Nutzer bestaetigt neu; zeigt der Host keine Karte, ist kein Anruf moeglich -
  ehrlich sagen. `place_call` bleibt fuer die Karte registriert (sie ruft es ueber den Host).
- **Harte Randbedingungen (bestehende Tests):**
  - `test/openai-t2-13-bestaetigung.test.js:525-589`: `REQUIRED_STATEMENTS` muessen in
    `prepareCallCardHint`, `confirmationRequired` (je Sprache) und in allen drei Beschreibungen
    (`never guess or invent`) erhalten bleiben; `SELF_CONFIRMATION_PATTERNS` (z.B. "take ...
    code", "read ... code") duerfen NICHT treffen.
  - `test/p15-mcp-tool-descriptions-en.test.js:71` Emphase `place_call` =
    `["REQUIRES","FIRST","NOT","NOT","NOT","ALWAYS"]`, `:138` `place_call.confirmation_code` =
    `["SAME","REQUIRED","NOT"]` - Anzahl und Reihenfolge der Grossschreib-Marker halten (oder
    begruendet nachziehen, Praezedenz-Kommentar dort).
  - `test/gq-b1-briefing-openness.test.js:55-56` Zeichen-Budget 6700 / 7100 fuer die
    place_call-Pfade - neue Texte nicht laenger machen als noetig.
  - P8-tools/list-Hash (Schritt 3) aendert sich dadurch ebenfalls.
- **IDs:** N-10. **Pfade:** tools/list + `initialize.instructions` auf HTTP (OAuth, Legacy) und
  stdio; isError-Text von `place_call` auf allen drei.
- **Beweis:** (b) bestehender Draht-Test `Modelltexte am Draht` (t2-13) gruen + neuer Draht-Scan
  Schritt 6 (l): kein String in tools/list, `initialize.instructions`, `prepare_call`-content
  enthaelt Anleitung, den Code an `place_call` weiterzugeben (Muster z.B.
  `/pass (it|the code) to place_call|only then pass/i`), Positiv-Kontrolle: das Muster trifft
  den heutigen Text von `src/mcp-server-info.js:109-111` (c726212).

### Schritt 5 - Doku
- `docs/OPENAI-TOOL-INVENTORY.md:259-292` ("Confirmation before placing a call"): ein Absatz
  zum Ablauf: prepare_call -> Karte zeigt alle gebundenen Argumente -> Nutzerklick -> die Karte
  ruft place_call mit dem Code ueber den Host -> Karte meldet dem Chat den call_id (ohne Code).
  Der Satz "reaches the model only through a user action" wird ersetzt durch: der Code wird dem
  Modell auf einem MCP-Apps-konformen Host gar nicht gezeigt. KEINE internen Kennungen
  (keine Phasen-/Anforderungs-IDs), keine Produktionswerte. Zeilenverweise (`:1438`, `:1447-1479`)
  auf neue Zeilen nachziehen.
- `PLAN-SECURITY.md`: neuer Abschnitt "OpenAI-T2-14 - Bestaetigung in der Karte" nach `:6177ff`:
  was die Karte sendet, dass der Code nie in `ui/message`/DOM-Hinweisen landet, Restrisiko
  (Host reicht `_meta` oder die Argumente eines App-`tools/call` doch ans Modell), Restrisiko
  Host-Permission ("Fragen" blockiert App-`tools/call`), Deploy-Vorbedingung. Den T2-13-Satz
  "die Karte sendet den Code" (`:6226-6228`) richtigstellen. Keine Produktionswerte.
- **IDs:** N-10. **Pfade:** Doku. **Beweis:** (a) Textstellen; (c)
  `grep -n -E "T2-|N-10|X-2|X-6" docs/OPENAI-TOOL-INVENTORY.md` -> keine NEUEN Treffer gegenueber
  c726212 (vorher/nachher zaehlen).

### Schritt 6 - Neuer Test `test/openai-t2-14-call-widget-confirm.test.js`
Fake-Window nach dem Muster `test/mcp-ui-w1-call-widget.test.js` (node:vm, `parent.postMessage`
mitgeschnitten, `makeFakeDocument` erweitern um den Knopf/Click und die neuen Selektoren).
**Die ausgefuehrte HTML ist der `resources/read`-Text des Call-Widgets vom gespawnten Server
(HTTP `/mcp`)**, nicht `widgetHtml()`; einmal zusaetzlich `assert.equal(resourcesReadText,
widgetHtml(WIDGET_CALL))` und stdio-`resources/read` == HTTP-Text. Kein `NODE_ENV`-Sonderweg im
Widget. Server/Kindprozesse am Ende beenden.
- (a) tool-result mit echter prepare_call-Vorschau + `_meta`-Code, KEIN Klick, dasselbe Push ein
  zweites Mal -> 0 Nachrichten mit `method: "ui/message"`, 0 `tools/call` mit `name:
  "place_call"`.
- (b) ein Klick -> genau 1 `tools/call` `place_call`; `params.arguments` ==
  (`structuredContent` ohne `status`) + `{ confirmation_code }` (deepEqual).
- (c) Doppelklick (zwei synchrone Klicks) und Klick nach Antwort -> weiterhin genau 1
  `tools/call place_call`.
- (d) **Anzeige = Gesendetes:** fuer eine Vorschau mit ALLEN neun Feldern (briefing, context mit
  Unterfeldern, mandate, constraints, diagnostic, language, max_duration_s) steht jeder Wert aus
  `params.arguments` (skalare Werte bzw. jede Blatt-Zeichenkette) als Text im sichtbaren
  Bestaetigungsblock. Positiv-Kontrolle: ein Feld, das gesendet, aber absichtlich nicht
  angezeigt wird (manipulierte Kopie der Pruef-Funktion), wird erkannt.
- (e) **End-to-End am Draht (HTTP Legacy, HTTP OAuth ueber Interface-IP, stdio):**
  echtes `prepare_call` -> Ergebnis als tool-result in die Karte -> Klick -> das gepostete
  `tools/call` UNVERAENDERT an denselben Server weiterreichen -> kein isError, genau ein
  Anruf-Datensatz (Fake-Originate wie `test/openai-t2-13-bestaetigung.test.js` `(c)`/`(h)`/`(i)`),
  Argumente im Datensatz == Vorschau; Antwort zurueck in die Karte -> genau 1 `ui/message`,
  `params.role === "user"`, Text enthaelt den `call_id`; danach `get_call_status` (bzw. bei
  `CONSULT_ENABLED` `await_call_event`) mit diesem `call_id` funktioniert. Mit allen neun
  Feldern inkl. `to` in Nicht-E.164-Eingabe (Normalisierung idempotent belegen).
- (f) **Code nie ans Modell:** ueber ALLE Faelle: der Codewert steht in genau EINER gesendeten
  Nachricht (dem `tools/call place_call`) und in keiner `ui/message`, keinem `textContent` des
  Dokuments, keinem `console`-Aufruf (console im Sandbox-Kontext mitschneiden). Positiv-Kontrolle:
  die Suchfunktion findet einen absichtlich in eine Kopie der Nachricht eingebauten Code.
- (g) Host antwortet auf `tools/call place_call` mit JSON-RPC-Fehler -> Zustand "unklar"
  sichtbar, KEIN zweites `tools/call`, genau 1 `ui/message` ohne Code; kein
  `navigator.clipboard`-Zugriff (Getter im Fake mitschneiden).
- (h) Host antwortet gar nicht -> nach `PLACE_CALL_RESPONSE_TIMEOUT_MS` (Fake-Timer) derselbe
  "unklar"-Zustand; Konstante > `PLACE_CALL_HOP_TIMEOUT_MS` (Sync-Test gegen den Export aus
  `src/mcp-tools.js`).
- (i) `result.isError` (z.B. zweiter Verbrauch am echten Server aus (e)) -> Hinweis "neu
  vorbereiten" sichtbar, keine `ui/message`, kein weiteres Senden.
- (j) `expires_at` in der Vergangenheit (beim Rendern und: gueltig beim Rendern, abgelaufen beim
  Klick) -> 0 `tools/call place_call`, 0 `ui/message`, Hinweistext sichtbar. Fehlender Code im
  `_meta` (z.B. Host reicht `_meta` nicht durch) -> Knopf nicht bedienbar, Hinweis sichtbar,
  0 Senden.
- (k) Replay: nach `placed` ein erneuter `awaiting_confirmation`-Push -> Karte bleibt Live-Karte,
  kein Knopf, 0 weiteres Senden.
- (l) XSS: `objective`/`briefing`/`context.summary` = `<img src=x onerror=alert(1)>` -> landet
  woertlich als Text, kein Element erzeugt (Fake-DOM zaehlt createElement/innerHTML-Setter).
- (m) Sprachen: tool-result mit `hermes/locale` de, fr, en -> Knopf-/Label-Texte aus
  `WIDGET_DICT` bzw. EN-Key.
- (n) `ui/message`-Text der Erfolgs-/Unklar-Meldung enthaelt nie `briefing`/`context`-Inhalte.
- Kennungen: KEINE Katalog-ID (`GAP-`, `PROMPT-` ...) und kein `ABNAHME-` am Testnamen-Anfang
  (sonst landet der Test in der falschen Bank).
- **IDs:** N-10. **Pfade:** HTTP `/mcp` Legacy (Loopback), HTTP OAuth (Interface-IP, Muster
  `test/helpers.js`), stdio (Kindprozess).
- **Beweis:** (b) diese Tests gruen, isoliert und in der Suite.

### Schritt 7 - Waechter X-6 und X-2 am Draht (Plan-Kriterien g, h)
- X-6: neuer Test (in derselben Datei oder `test/openai-t2-14-...`): `resources/read` ALLER
  Widget-Resources ueber HTTP und stdio enthaelt kein `navigator.clipboard`,
  `window.alert|window.prompt|window.confirm`, `\b(alert|prompt|confirm)\s*\(`, kein
  `<iframe`. Positiv-Kontrolle: der Scan trifft einen eingeschleusten `navigator.clipboard`-String.
  csp/domain aus T2-01: `test/openai-t2-01-widget-resource-meta.test.js` T1/T2a/T3 bleiben
  gruen (kein Neubau).
- X-2: Draht-Test: je Werkzeug, das im Test aufgerufen wird (mindestens prepare_call, place_call,
  get_call_status, get_call_result, list_calls, get_my_number, get_agent_status), die
  `_meta`-Schluessel des Ergebnisses: prepare_call nur `hermes/confirmation_code`,
  `hermes/confirmation_expires_at`, `hermes/locale`; alle anderen hoechstens `hermes/locale`.
  Werte in `_meta` sonst nie Nutzdaten.
- **IDs:** N-10 (Plan-Kriterien g/h). **Pfade:** HTTP + stdio.
- **Beweis:** (b) diese Tests gruen.

### Schritt 8 - Pruefen
- `node --check` fuer jede geaenderte `.js`; `npx eslint` auf geaenderte Dateien ohne neue
  Legacy-Eintraege, Pins in `eslint-legacy-exceptions.json` NIE anheben.
- VOR dem ersten Edit Basislauf, nach dem Bau erneut:
  `npm test -- -- --test-concurrency=4 > <logs-t2-14>/suite-*.log 2>&1`; nur `# pass`/`# fail`
  zaehlen; jeder rote Test isoliert nachpruefen
  (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`).
- Danach `ps aux | grep -E "node .*src/(server|mcp-server)"` - keine verwaisten Server.
- Erwartet brechende Bestandstests (nachziehen, nie abschwaechen): `openai-t2-02-widget-uris`
  (Pins), `openai-p8-widget-ui` (tools/list-Hash), ggf. `p15-mcp-tool-descriptions-en`
  (Marker), `gq-b1-briefing-openness` (Budget), `mcp-ui-w1-call-widget` (Fake-DOM kennt neue
  Selektoren evtl. nicht; AC-size), `mcp-ui-widget-i18n` (Dict-Vollstaendigkeit).

## 3. Nicht bauen (mit Grund)

1. **Code-Anzeige "im Chat eingeben" als Rueckfall (Plan (d))** - gibt den Code ans Modell und
   widerspricht der Lead-Vorgabe; der Rueckfall ist jetzt "unklar - nicht erneut bestaetigen,
   Anrufliste pruefen".
2. **`ui/message` mit Code (Plan (b))** - dito.
3. **`place_call` fuer das Modell verstecken (`_meta.ui.visibility: ["app"]`)** - nicht von N-10
   verlangt, Host-Unterstuetzung ungemessen, bricht die Namensmengen aus T2-12/T2-13 (10/12) auf
   allen Pfaden; die Beschreibungen reichen, ein Modell-Aufruf ohne Code scheitert fail-closed.
4. **Bestaetigung ohne Karte (Claude Code, stdio-Clients)** - bewusst ausgeschlossen seit T2-13
   (PLAN-SECURITY `:6205-6220`); keine Aenderung.
5. **Persistenz "Code schon benutzt" im Widget (localStorage)** - Sandbox-Speicher unzuverlaessig;
   der Server verbraucht den Code ohnehin einmalig (`consumeIfCurrent`), das ist die Idempotenz.
6. **Mehrinstanz-Einmalverbrauch** - In-Memory-Register ist T2-13-Bestand und dokumentiert;
   nicht N-10-Scope dieser Phase.
7. **Echter Consult-Frage/Antwort-Austausch waehrend des Anrufs** (PLAN-SECURITY `:6385` schob ihn
   "T2-14 vor") - der Consult-Mechanismus aendert sich hier nicht; neu ist nur, woher das
   Modell den `call_id` bekommt, und das belegt Schritt 6 (e). Ein vollstaendiger Consult-
   Rundlauf ist nicht N-10.
8. **Neue Env-Variable** - keine noetig (`MCP_UI_ENABLED`, `CALL_CONFIRMATION_SECRET` bestehen).
9. **`apps/web`** - nicht betroffen.
10. **Gates/Offenlegungssatz** - unangetastet; der Karten-Aufruf faehrt denselben
    `place_call`-Handler -> `confirmCallHop` -> `POST /api/calls` mit der vollen Gate-Kette.

## 4. Pre-Mortem (ein Jahr spaeter war T2-14 ein Fehler - was ist passiert?)

1. **Ungewollter Anruf durch Replay/Reload (Plan-PM).** Die Karte sendet beim Rendern oder beim
   Neuaufbau aus dem Verlauf. -> Senden NUR im Klick-Handler, Zustandsmaschine ignoriert
   Awaiting-Pushes nach dem Abschicken; Tests 6 (a), (c), (k). Server-Backstop: Einmal-Code.
2. **Doppelanruf durch Doppelklick oder Wiederholung nach Timeout.** -> Zustand synchron vor
   dem Senden umgestellt, Knopf gesperrt, nach Fehler/Timeout KEIN Neuversand; Tests 6 (c),
   (g), (h). Server: Einmal-Verbrauch + Dedup laufender Anrufe.
3. **Karte zeigt etwas anderes als gewaehlt wird (z.B. `context` versteckt, Nutzer bestaetigt
   einen harmlosen Anliegen-Text, der Agent sagt am Telefon etwas anderes).** -> eine Quelle
   (`pendingConfirmation.args`), jedes gesendete Feld sichtbar; Test 6 (d) mit
   Positiv-Kontrolle, 6 (e) am echten Server.
4. **Code leakt ans Modell** (ui/message, Fehlertext, DOM-Hinweis, console, oder der Host
   loggt App-`tools/call`-Argumente in den Modellkontext). -> Test 6 (f) deckt alles im Widget;
   der Host-Teil ist ungemessen -> Owner-Probe (Modell nach dem Code fragen, vor UND nach dem
   Klick). Restrisiko gering: nach dem Klick ist der Code verbraucht.
5. **Toter Knopf in einem Host.** Claude beantwortet App-`tools/call` mit Fehler, wenn die
   Werkzeug-Berechtigung auf "Fragen" steht (Kommentar `call.html:252-254`); ChatGPT-Verhalten
   fuer schreibende App-Aufrufe ungemessen. Folge: niemand kann mehr per MCP waehlen. -> Zustand
   "unklar" statt stummem Fehler, Owner-Probe in beiden Hosts mit beiden Berechtigungen; falls
   Claude "Fragen" blockiert, muss die Karte/Doku den Nutzer anleiten, `place_call` zu erlauben
   (Folgeentscheidung, nicht auf Verdacht).
6. **Host-Timeout != nicht gewaehlt.** place_call blockiert bis 180 s; ein Host bricht frueher
   ab, die Karte sagt "fehlgeschlagen", der Nutzer bestaetigt neu -> zweiter Anruf. -> kein
   "fehlgeschlagen", sondern "unklar, nicht erneut bestaetigen", Frist > Hop-Frist, Sync-Test
   6 (h); zweiter Versuch braucht ohnehin neues prepare_call.
7. **XSS ueber briefing/objective** (Modelltext aus einer Webseite mit Injection). -> nur
   `textContent`, Test 6 (l), `T-W1-call-AC6` bleibt; CSP unveraendert (T2-01-Tests).
8. **Karte bricht in einer Sprache / bleibt englisch.** -> Dict de+fr, Test 6 (m),
   `mcp-ui-widget-i18n`.
9. **Gecachte alte Karte (ChatGPT cacht Resources bis 1 h) ohne Bestaetigungsknopf** zeigt nur
   "—": -> neue Versionen fuer alle geaenderten Widgets (neue URIs), Schritt 3.
10. **Modell ruft weiter selbst place_call auf und haengt in isError-Schleifen**, weil Texte noch
   "pass the code" sagen. -> Schritt 4 + Draht-Scan 6/Schritt 4 mit Positiv-Kontrolle.
11. **Uhrversatz des Clients** blockiert einen noch gueltigen Code (Karte sagt "abgelaufen"). ->
   akzeptiert (fail-closed, neues prepare_call loest es).
12. **Deploy nur von T2-13 oder mit `MCP_UI_ENABLED=false`** -> niemand kann waehlen. ->
   Owner-Punkt Deploy-Vorbedingung.

## 5. Owner-Punkte (nur nach Owner-Regel)

1. **Deploy-Vorbedingung:** T2-13 und T2-14 nur gemeinsam deployen; im Render-Dashboard
   `MCP_UI_ENABLED` nicht `false`, `CALL_CONFIRMATION_SECRET` gesetzt (>= 32 Zeichen, Wert nie
   in Repo/Chat). Erwartet: `prepare_call` liefert eine Karte mit Knopf, kein
   `confirmation_unavailable`.
2. **Live-Probe Claude (claude.ai, Connector neu verbinden):** Anruf an die sichere Testnummer
   erbitten -> Karte zeigt Ziel, Anliegen, Briefing, Sprache, Dauer in der Chat-Sprache; VOR dem
   Klick das Modell nach dem Bestaetigungscode fragen (erwartet: kennt ihn nicht); Klick ->
   Anruf startet, Karte wird Live-Karte, im Chat erscheint die Meldung mit call_id (ohne Code),
   das Modell verfolgt den Anruf; NACH dem Klick erneut nach dem Code fragen (erwartet: kennt
   ihn nicht). Das Ganze einmal mit Werkzeug-Berechtigung `place_call` = "Immer erlauben" und
   einmal = "Fragen" (erwartet bei "Fragen": entweder Host-Rueckfrage oder Karte zeigt "unklar"
   - Ergebnis zurueckmelden, davon haengt eine Folgeentscheidung ab).
3. **Live-Probe ChatGPT Developer Mode:** dieselben Schritte; zusaetzlich pruefen, ob ChatGPT
   `_meta` des Tool-Ergebnisses an die Karte liefert (Knopf bedienbar) und ob der App-Aufruf von
   `place_call` eine eigene Host-Bestaetigung zeigt. Erwartet: ein Anruf pro Klick.
4. **Reload-Probe (beide Hosts):** Chat nach dem Anruf neu laden -> keine neue Waehl-Aktion;
   erneuter Klick auf eine alte Karte -> Hinweis "neu vorbereiten", kein zweiter Anruf.
