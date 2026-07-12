# Detailbericht — Phase `widget-wire` (F1/F2/F3/F5)

**Ergebnis:** Die Live-Karte (`widgets/call.html`) spricht nur noch das spec-konforme
`tools/call`-Wire-Format an den Host, und dieser Sendeweg ist an ALLEN Aufrufstellen
(Poll-Tick, `get_transcript`, Cancel) hinter dem `ui/initialize`-Handshake gegatet.
Die frühere „Schrotflinte" aus drei parallelen Kandidaten (`window.openai.callTool`,
dem selbst erfundenen `ui/tool-call`, `tools/call`) ist restlos entfernt.

- **Gate:** PASS
- **finalBranch:** `phase/widget-wire-tools-call-gate-fix2`
- **Basis:** `master` (`6031f7c`)

---

## 1. Plan (gekürzt)

### 0. Vorab — Spec-Kollision

Die Spec fordert, dass das ausgelieferte `widgetHtml('call')` kein `window.openai`
mehr enthält. Das trifft nicht nur `call.html`, sondern auch die i18n-Bootstrap-Zeile
in `src/ui/widget-i18n.js` (`resolveLocale([window.openai && window.openai.locale, ...])`),
die per `withI18nScript()` in den `<head>` jedes Widgets injiziert wird.

**Entscheidung (bindend):** Die Zeile wird auf `resolveLocale([navigator.language], WIDGET_DICT)`
reduziert. Begründung: In claude.ai ist `window.openai` ohnehin undefined, der Kandidat
ist dort wirkungslos — Verhalten in claude.ai bleibt byte-gleich. Verloren geht nur ein
Host-Locale-Override in einem nicht-live ChatGPT-Host (Fallback bleibt `navigator.language`).

Anmerkung zur Invariante „übrige Widgets unverändert": Byte-Identität ist durch F2
konstruktiv unmöglich (das `BIND_SCRIPT` steckt in allen 5 Widgets und wächst um
`signalUiReady`). Gelesen als „Verhalten unverändert + Bestandstests der anderen Widgets
ohne Änderung grün".

### 2. Exakte Edits pro Datei

**`src/ui/widget-bind.js` (F2, additiv):**
- Kopfkommentar ergänzt: Nach der Host-Antwort wird GENAU EINMAL „ui ready" signalisiert
  (Flag + CustomEvent). Erst danach darf ein Widget eigene `tools/call` senden.
- Neue Exporte: `UI_READY_FLAG = "__hermesUiReady"`, `UI_READY_EVENT = "hermes:ui-ready"`
  (Vertrag zwischen `widget-bind.js` und dem self-contained `call.html`-Inline-Skript).
- Neue Funktion `signalUiReady(root)`: setzt das Flag idempotent, feuert ein `CustomEvent`
  falls die Browser-API vorhanden ist, sonst fail-safe (nur Flag, kein Crash).
- `handleHostMessage`, initialize-Zweig: ruft `signalUiReady(root)` NACH bestätigtem
  `initialized` (gebunden an `message.result` — eine JSON-RPC-Fehlerantwort signalisiert
  kein ready).
- `buildBindScript()`: projiziert beide Konstanten + die neue Funktion ins BIND_SCRIPT
  (sonst existiert `signalUiReady` im Iframe nicht).

**`src/ui/widgets/call.html` (F1 + F2 + F3):**
- Kopfkommentar präzisiert („der ausgehende tools/call an den Host" statt „die
  ausgehende Host-Bruecke").
- Konstanten-Block: nur noch `METHOD_TOOLS_CALL = "tools/call"` und
  `METHOD_TOOL_RESULT = "ui/notifications/tool-result"`; `FORMAT_OPENAI` und
  `METHOD_UI_TOOL_CALL` entfernt. Neu: lokal duplizierte `UI_READY_FLAG`/`UI_READY_EVENT`
  (kein Import möglich, self-contained Iframe-Skript) + benannte Konstante
  `MAX_CONSECUTIVE_RPC_ERRORS = 3`.
- Zustandsvariablen: `confirmedFormat` entfällt (keine Format-Auswahl mehr nötig);
  `pendingRequests` speichert nur noch den Tool-Namen statt `{format, tool}`; neu
  `consecutiveRpcErrors`.
- Sende-Pfad `markResponse`/`dispatchFor`/`sendToolCall` vereinfacht auf EIN Format.
  `sendToolCall(tool, args)` prüft `window[UI_READY_FLAG]` als einziges Gate, bevor
  per `postMessage` ein `tools/call`-JSON-RPC-Request rausgeht.
- `handleMessage`: JSON-RPC-Fehlerantworten werden nicht mehr still verschluckt.
  Zähler `consecutiveRpcErrors` hoch bei Fehler, `stopPolling()` ab
  `MAX_CONSECUTIVE_RPC_ERRORS`; ein Erfolg setzt den Zähler zurück. Karte behält dabei
  ihren letzten Stand (kein Blanking, kein erfundener Fehlertext).
- `init`: Polling startet nur noch über `whenUiReady(startPolling)`. `whenUiReady` ist
  late-safe (Flag schon gesetzt → Sofortstart, sonst einmaliges Warten auf
  `UI_READY_EVENT`), kein Timeout-Fallback („ein Host, der den Handshake nicht
  beantwortet, beantwortet auch keinen tools/call").

**`src/ui/widget-i18n.js`:**
- Kopfkommentare an den neuen Zustand angepasst.
- `buildI18nScript()`: `resolveLocale`-Kandidatenliste auf `[navigator.language]`
  reduziert (siehe §0).

### 3. Tests

Eine Testdatei geändert: `test/mcp-ui-w1-call-widget.test.js` (Harness lebt dort,
kein zweites Testfile zur Vermeidung von Duplizierung).

- Harness importiert jetzt echtes `signalUiReady`/`UI_READY_FLAG` aus `widget-bind.js`
  und fährt den echten Signalpfad (nicht nur eine Test-Attrappe) über Fake-`CustomEvent`/
  `dispatchEvent`.
- `sandbox.openai`-Fake entfernt (nach F1 tot).
- Neue Option `readyBeforeScript` für den late-safe-Pfad; Rückgabe um `uiReady()` erweitert.
- Bestandstests angepasst: AC4 (Positiv-Assertions auf `window.openai`/`ui/tool-call` raus),
  AC5/AC7a (`env.uiReady()`, `get_transcript`-Erwartung 2→1), AC7d (`env.uiReady()` vor
  `fireTimeout()`), AC-cancel (Handshake-Gate-Beweis, Cancel-Erwartung 2→1).
- AC7b (3-Kandidaten-Test) und AC7c (`confirmedFormat`) entfallen, ersetzt durch neue
  F1/F1-tick/F2/F2-late-safe/F2-contract/F3-Tests.
- Neue Tests (F5): `T-W1-call-F1` (kein `ui/tool-call`/`window.openai`/`callTool`/
  `confirmedFormat` im ausgelieferten HTML, `"tools/call"` bleibt), `T-W1-call-F1-tick`
  (ein Poll-Tick = genau eine `tools/call`-Nachricht), `T-W1-call-F2` (kein `tools/call`
  vor dem Handshake, kein Timer), `T-W1-call-F2-late-safe` (Flag schon gesetzt →
  Sofortstart), `T-W1-call-F2-contract` (Anti-Drift Flag-/Event-Namen zwischen
  `call.html` und `widget-bind.js`), `T-W1-call-F3` (3 Fehler in Folge stoppen,
  Erfolg setzt zurück, kein Blanking).

### 4. Deterministisch prüfbares Ergebnis (Section-4-Checks)

1. `widgetHtml('call').includes('ui/tool-call')` / `.includes('window.openai')` → `false false`
2. `.includes('"tools/call"')` / `'__hermesUiReady'` / `'hermes:ui-ready'` → `true true true`
3. `node --check` auf allen geänderten `.js`-Dateien → OK
4. Alle 5 Widgets weiterhin ausliefer-fähig → `true`
5. `npm test` → 0 fail

### 5. Pre-Mortem (akzeptierte Risiken)

1. Host beantwortet `ui/initialize` nie/mit Fehler → kein ready → kein Polling. Kein
   Regress (ohne Handshake pusht der Host auch kein `tool-result`). Bewusst kein
   Timeout-Fallback (würde den behobenen Fehler wieder einbauen).
2. F3 stoppt bei dauerhaft ablehnendem Host (Tool-Berechtigung „Fragen") → Karte friert
   auf letztem Stand ein. Spec-Vorgabe (kein Blanking); Gegen-Hebel ist der Owner-Handgriff.
3. Doppel-Mount (Host-Verhalten) → Flag/Event sind pro Window-Instanz frisch,
   `signalUiReady` idempotent, `{ once: true }` verhindert Doppelstart.
4. i18n-Locale-Override im ChatGPT-Host entfällt → Fallback `navigator.language`.
   Adapter nicht live, reversibel.
5. String-Duplizierung der zwei Vertragsnamen zwischen `widget-bind.js` und `call.html`
   unvermeidbar (self-contained Iframe, kein Import) → durch `T-W1-call-F2-contract`
   gegen Drift gepinnt.

Unberührt laut Plan: Call-Pfad, Safety-Gates, Disclosure, Auth/Signaturprüfung, Billing,
`MCP_UI_ENABLED`, Statelessness von `/mcp`, `widget-catalog.js`. Keine neuen Dependencies,
kein Build-Step, kein TypeScript.

---

## 2. Impl-Zusammenfassung

Phase `widget-wire` (F1/F2/F3/F5) exakt gemäß Plan umgesetzt und committed auf Branch
`phase/widget-wire-tools-call-gate` (HEAD `364da8a`, Basis `master` `6031f7c`).

**Geänderte Dateien (nur die 4 geplanten):**

- **`src/ui/widget-bind.js`** — `UI_READY_FLAG`/`UI_READY_EVENT` exportiert; neue
  Funktion `signalUiReady(root)` (Flag+CustomEvent, idempotent, fail-safe ohne
  Browser-Event-API); `handleHostMessage` ruft `signalUiReady` NACH bestätigtem
  `initialized`; `buildBindScript()` projiziert beide Konstanten + die neue Funktion
  ins BIND_SCRIPT.
- **`src/ui/widget-i18n.js`** — locale-Bootstrap verliert den toten
  `window.openai.locale`-Kandidaten. Empirisch bestätigt: eine Kommentarzeile mit
  „window.openai" landet NICHT in der Projektion (I18N_SCRIPT), da sie reiner
  Quelltext-Kommentar zwischen Array-Elementen ist, kein String-Element.
- **`src/ui/widgets/call.html`** — 3-Kandidaten-Schrotflinte restlos entfernt; einziger
  Sendeweg ist `METHOD_TOOLS_CALL` (`"tools/call"`). `sendToolCall()` prüft
  `UI_READY_FLAG` als einziges Gate für alle Aufrufer. Neu: `MAX_CONSECUTIVE_RPC_ERRORS=3`
  (benannte Konstante) + `consecutiveRpcErrors`-Zähler — 3 Fehler in Folge stoppen das
  Polling (kein Blanking), ein Erfolg setzt zurück. `init()` startet über
  `whenUiReady(startPolling)` (late-safe).
- **`test/mcp-ui-w1-call-widget.test.js`** — Harness fährt den echten
  `signalUiReady`-Pfad; totes `sandbox.openai`-Fake entfernt; `readyBeforeScript`-Option
  für den late-safe-Pfad. Bestandstests AC4/AC5-AC7a/AC7d/AC-cancel angepasst; AC7b/AC7c
  ersetzt durch 6 neue F1/F1-tick/F2/F2-late-safe/F2-contract/F3-Tests. 24/24 grün in
  dieser Datei, 2137/2137 in der Gesamtsuite.

**Deterministische Section-4-Checks:** alle bestätigt (1: `false false`; 2: `true true true`;
3: `node --check` OK; 4: alle 5 Widgets ausliefer-fähig; 5: `npm test` 2137/2137).

**Smoke:** Server lokal gebootet (`PORT=0`, `SKIP_TWILIO_SIGNATURE_CHECK=true`,
Dummy-Env inkl. `OWNER_NUMBER_SEED`), `/healthz` → `{"ok":true}`. Zusätzlich voller
MCP-Handshake über echten `curl` (initialize + `resources/read` für `ui://hermes/call`)
gegen den LIVE-Prozess — bestätigt kein `ui/tool-call`, kein `window.openai`,
`tools/call` vorhanden, `__hermesUiReady` + `hermes:ui-ready` vorhanden. Stärkere
Verifikation als im Plan gefordert (echter Server statt nur `node -e`).

### Deviations

1. Plan-Kommentartexte in `call.html` enthielten wörtlich `window.openai.callTool` und
   `ui/tool-call` — umformuliert (Verweis auf alte Konstantennamen
   `FORMAT_OPENAI`/`METHOD_UI_TOOL_CALL` statt wörtliche Wire-Strings), da diese
   Substrings sonst im ausgelieferten `widgetHtml('call')` gelandet wären und die
   Plan-eigene Verifikation (Section 0 + 4, F1-Test) zum Scheitern gebracht hätten.
   Bedeutung/Intent unverändert.
2. `T-W1-call-F2-contract` importiert `UI_READY_EVENT` jetzt aus `widget-bind.js`
   statt es lokal als Magic-String zu duplizieren (G5/G25 clean-code Nachbesserung,
   kein Plan-Abweichen in der Sache).
3. Kleine Wortlaut-Korrektur im `widget-i18n.js`-Kopfkommentar (Plan-Text hatte eine
   redundante Doppelung „des Betrachters ... des Betrachters"), auf einmalige Nennung
   reduziert — reine Lesbarkeits-Korrektur, keine Verhaltensänderung.
4. Smoke-Test ging über den im Plan vorgeschlagenen `node -e`-Check hinaus: echter
   Server-Boot + echter MCP-JSON-RPC-Handshake per `curl` gegen den LIVE-Prozess, um
   die Verdrahtung end-to-end zu beweisen statt nur die Modulfunktion direkt aufzurufen.

**Clean-Code-Self-Check (Impl-Runde):** G5/S2 (Duplizierung) — `UI_READY_FLAG`/
`UI_READY_EVENT` haben eine Quelle in `widget-bind.js`, in `call.html` zwangsläufig
wörtlich dupliziert (self-contained Iframe), gegen Drift gepinnt durch
`T-W1-call-F2-contract`. G25 (Magic Numbers) — `MAX_CONSECUTIVE_RPC_ERRORS=3` als
benannte Konstante. C5/G9 (toter/auskommentierter Code) — `confirmedFormat`,
`sendViaOpenai`, `sendViaPostMessage`, `FORMAT_OPENAI`, `METHOD_UI_TOOL_CALL` restlos
entfernt. C2 (überholte Kommentare) — angepasst. N7, F1 (≤3 Argumente), P15, P11
(Test-Pflicht) — jeweils erfüllt.

---

## 3. Safety-Urteil (final)

**Verdict: APPROVED.** Alle absoluten Regeln eingehalten, eigene Tests grün.

- **testsPassIndependently:** true
- **safetyGatesIntact:** true
- **disclosureIntact:** true
- **authFailClosedIntact:** true
- **noSecretsLeaked:** true
- **scopeRespected:** true
- **behaviorAsIntended:** true
- **blockers:** keine

**Unabhängiger Testlauf (frischer Worktree, Branch `review-widget-wire-r2` von
`phase/widget-wire-tools-call-gate-fix2`):**
Volle Suite auf dem Phase-Branch: Lauf 1 rot (`outbound-reconcile-finishcall`,
vorbestehender dokumentierter Voll-Last-Spawn-Race-Flake, isoliert 3/3 grün, von
diesem Diff nicht berührt), Lauf 2 + Lauf 3 grün, 2140/2140. Master-Baseline (sauber
via detached HEAD): 2133/2133. Delta = +7 Tests (genau die neuen Widget-Tests).
Beide Store-Backends geprüft (json = Suite-Default; pg/pglite-Dateien separat:
43/43). Widget-Tests isoliert: 74/74. `node --check` über alle `src/ui/*.js` sauber.
Kein `eslint-disable`/`@ts-ignore`/`.only`/`skip` im Diff.

**Scope:** sauber und minimal — nur `src/ui/{registry.js,widget-bind.js,widget-i18n.js,
widgets/call.html}` + `test/{mcp-ui-w1-call-widget,mcp-ui}.test.js`. `package.json`/
`package-lock.json` = Null-Diff (keine ungefragte Dependency).

**Regel 1 (Safety-Gates):** unberührt — `src/claude.js`, `src/bridge.js`,
`src/server.js`, `src/auth.js`, `src/web-auth.js`, `src/config.js`, `src/mcp-tools.js`,
`src/middleware.js`, `src/telephony/`, `src/billing/` = 0 Diff-Zeilen. Grep über den
gesamten Diff nach `numberGateError|ALLOWED_NUMBERS|MAX_BUDGET|safeEqual|
validateSignature|disclosureSentence`: 0 Treffer.

**Regel 2 (Offenlegung):** `claude.js`+`bridge.js` Diff = 0 Zeilen, `disclosureSentence`
byte-identisch.

**Regel 3 (Auth fail-closed):** kein Auth-Code angefasst, keine neuen Endpunkte.

**Regel 4/5 (Secrets/Audio):** Widget sendet als `arguments` ausschließlich
`{call_id}`; Whitelists `pickCallStatus`/`pickTranscript` unverändert; kein neues
Logging, kein Audio-Pfad.

**Verhalten (empirisch am tatsächlich gerenderten HTML geprüft, nicht nur Quell-Grep):**
verbotene Wire-Formate (`window.openai`, `ui/tool-call`, `callTool`, `openai.locale`)
allesamt weg; `"tools/call"` als einziger Sendeweg vorhanden;
`sendToolCall`-Ready-Gate im ausgelieferten HTML verifiziert; Flag-off byte-identisch
bewiesen (`uiRendererFor({enabled:false})`/`undefined`/`{}` → jeweils `null`).

**Concerns (keine Blocker):**
1. **Live-Verifikation nötig** (einziges echtes Restrisiko, testtechnisch nicht
   beweisbar): kein Timeout-Fallback im ready-Gate — beantwortet der echte
   claude.ai-Host den Handshake nicht, kippt die Karte von „aktualisiert sich" zu
   „statisch". Degradiert, nicht unsicher (kein Call, kein Geld, kein Leak). Pflicht-
   Smoke: `place_call` → Karte aktualisiert sich selbst UND kein roter Pfeil im Chat.
2. **ChatGPT-Host-Interaktivität** ist eine wissentlich akzeptierte Regression:
   Self-Poll/Cancel/`get_transcript` bleiben bei einem echten ChatGPT-Host stumm
   (Erst-Aufruf mit Text+structuredContent funktioniert weiter). Dokumentiert in
   `src/ui/registry.js` und per `T-P3-AC7` gepinnt.
3. Kosmetik: `call.html` enthält weiterhin das Token `FORMAT_OPENAI` als reine Prosa
   in einem Kommentar (Zeile ~230), kein Code, kein Wire-String.
4. Vorbestehend, nicht von dieser Phase eingeführt: `postMessage` an den Parent nutzt
   `targetOrigin '*'` — überträgt nur `call_id`, kein Secret; war auf `master` identisch.

---

## 4. Clean-Code-Audit (final)

**Verdict:** PASS mit einem kleinen S3-Hinweis. Kein S1/S2-Fund.

- **s1 (Blocker):** keine
- **s2 (schwerwiegend):** keine
- **s3 (Hinweis):**
  - `test/mcp-ui-w1-call-widget.test.js:566` — Kommentar im Test „T-W1-call-G2"
    verweist auf eine Test-ID „T-W1-call-F5-transcript-race", die nirgends im Repo
    existiert (0 Treffer per grep). Vermutlich Umbenennungs-Artefakt aus einer der
    Fix-Runden; inhaltlich naheliegend ist „T-W1-call-G3" (deckt genau das dort
    referenzierte Race — Terminal-Notification vor dem Handshake — ab). Empfehlung:
    Verweis korrigieren oder Zeile streichen.
- **s4:** keine

**passNotes:** Alle 74 widget-scoped Tests grün, volle Suite 2138/2140 — die 2 Fails
(`test/outbound-reconcile-finishcall.test.js`, `test/telnyx-event-ingest-route.test.js`)
unverändert vom Diff, auf `master` isoliert nachweislich grün → vorbestehender
Voll-Last-Flake, keine Regression. `node --check` sauber. Sicherheitsrelevante
Bereiche vom Diff nicht berührt — reines UI-Widget-Wiring. `MAX_CONSECUTIVE_RPC_ERRORS=3`
korrekt als benannte Konstante mit Begründungskommentar. Kein toter/auskommentierter
Code — alte Kandidaten restlos entfernt und per Negativ-Assertion (`T-W1-call-F1`)
gegen stillen Rückfall gepinnt. String-Duplizierung `UI_READY_FLAG`/`UI_READY_EVENT`
zwischen `widget-bind.js` und `call.html` unvermeidbar (kein ES-Import im Iframe-Skript)
und durch `T-W1-call-F2-contract` gegen Drift abgesichert — daher nicht als S2
geflaggt. Boundary-Verhalten (2 vs. 3 Fehler in Folge, Reset nach Erfolg, später vs.
früher Handshake, Terminal-Push vor Handshake) explizit und präzise getestet.
`registry.js`-Änderung ist reiner Kommentar (dokumentiert bewusst offene
ChatGPT-Interaktivitäts-Lücke inkl. Regressions-Pin `T-P3-AC7`) — keine Logikänderung.

---

## 5. Fix-Runden

**Runde 1 (r1):** Beide Review-Blocker (G3 Grenzbedingungs-Race, G2
Least-Astonishment) minimal und mit derselben Wurzel behoben: `sendToolCall()`
liefert jetzt einen Erfolgs-Rückgabewert (`true` = tatsächlich per `postMessage`
gesendet, `false` = Ready-Gate/Host-Brücke fehlt), und beide betroffenen Aufrufer
(u. a. `fetchTranscriptOnce`-Pfad, Cancel) werten diesen Rückgabewert aus statt
optimistisch einen Versand anzunehmen.

**Runde 2 (r2):** G3-Blocker (`widget-i18n.js:146-150` + Widerspruch zur
`registry.js`) behoben, per Option (c) aus dem Blocker-Text: Die Entscheidung
„ChatGPT-Host bleibt vorerst mit bekannter Interaktivitäts-Lücke bedient" wurde
bewusst getroffen und an der eigentlichen Entscheidungsstelle (`src/ui/registry.js`,
wo `uiRendererFor` den Host auswählt) dokumentiert statt implizit im i18n-Modul zu
stehen.

Nach beiden Fix-Runden: finaler Branch `phase/widget-wire-tools-call-gate-fix2`,
Safety-Review und Clean-Code-Audit beide PASS/APPROVED (siehe oben).
