# T2-13 Spec: Geldpfad, serverseitige Bestaetigung vor dem Waehlen

- IDs (gepinnt): **N-10** (Serverteil; erfuellt erst zusammen mit T2-14)
- Branch: `phase/openai-t2-13-prepare-call-confirm`, Worktree `.../scratchpad/wt-t2-13`
- Basis: master `1a31815`
- Baseline im Worktree: `npm test -- -- --test-concurrency=4` -> `# tests 6435`, `# pass 6435`, `# fail 0`
- Diese Datei bleibt UNGETRACKT im Haupt-Arbeitsbaum. Nicht adden, nicht in den Worktree kopieren.

## 0. Was die Bestaetigung beweist, und was nicht (Pflichttext fuer Kommentare, Inventar, PLAN-SECURITY)

**Sie beweist:** Der Server hat fuer GENAU diese Anfrage (Mandant, normalisiertes Ziel, alle
uebrigen Argumente) innerhalb der letzten maximal 10 Minuten einen Code ausgestellt, und dieser
Code ist noch nicht verbraucht. Der Code steht nur im Ergebnis-`_meta` von `prepare_call`. Laut
OpenAI ist das fuer das Modell nicht sichtbar und geht nur an die Karte. Auf einem Host, der sich
an diesen Vertrag haelt, kommt der Code also nur durch eine Nutzerhandlung ins Modell (Karte in
T2-14).

**Sie beweist NICHT:**
- dass ein Mensch die Vorschau gelesen hat. Reicht ein Host `_meta` doch ans Modell weiter, kann
  das Modell sich unbemerkt selbst bestaetigen. Das kann nur die Owner-Probe OW-C(6)/OW-D
  feststellen;
- dass die Person, die klickt, der Kontoinhaber ist;
- eine Autorisierung: Sie ersetzt kein Gate. Abo+KYC-Permit, OUTBOUND_FROZEN, Denylist, Land,
  Stundenlimit/Ziel-Cap, Tenant-Kostendecke, Max-Dauer und die Signaturpruefung laufen beim
  echten Waehlen unveraendert in `POST /api/calls`.

Nirgends (Kommentar, Beschreibung, Inventar, PLAN-SECURITY) darf "vom Nutzer bestaetigt" als
Garantie stehen. Die Formulierung lautet: "Der Code erreicht das Modell auf Hosts, die `_meta`
dem Modell vorenthalten, nur ueber die Karte."

## 1. Befund am Code (gelesen im Worktree)

- `place_call` ist heute in `src/mcp-tools.js:1170-1364` registriert. Der Handler ruft
  `placeCallHopCall(args)` (`:1331`) -> `placeCallHop` (`:410`) -> `POST /api/calls`. Eine
  Bestaetigung gibt es nicht.
- `POST /api/calls` ist in `src/routes/api-calls.js:458` definiert (`internalOnly`). Der Plan
  nennt dafuer `:394`, das ist falsch. Laut grep ist `src/mcp-tools.js:414` der einzige Aufrufer
  in `src/` und `apps/`.
- Die Normalisierung passiert im Gate `normalize_target` (`src/telephony/outbound-gates.js:730-744`).
  Dafuer braucht sie den Store (`tenantPrivateNumber`, `findActiveNumber(store.load())`,
  `tenantGeo`). Der stdio-Prozess (`src/mcp-server.js`) hat keinen Store und spricht nur REST
  ueber `GATEWAY_URL`. Deshalb muss die Vorschau samt Code in einem REST-Endpunkt im
  Gateway-Prozess entstehen.
- Der Mandant ist nur im Gateway massgeblich: `requestTenant(req)` liest `X-Internal-Tenant`, und
  das nur von Loopback. Bei stdio kommt kein Header, also gilt der Owner-/Bootstrap-Tenant.
- Die Dedup (`src/telephony/call-dedup.js:20,26`) greift nur fuer AKTIVE Anrufe an dasselbe
  Ziel, die hoechstens 180 s alt sind. Laut Plan faengt sie "Replay im Fenster". Das stimmt nur
  teilweise: Ein Replay NACH Ende eines kurzen Anrufs innerhalb der Code-Gueltigkeit wuerde erneut
  waehlen. Deshalb gibt es zusaetzlich einen Einmal-Verbrauch (Schritt 3).
- Das SDK ist 1.29.0. Die Plan-Belege stimmen: `mcp.js:125` (validateToolInput), `:135-141`
  (catch), `:152` (createToolError), `:178` (Input validation error).
- `enableWidgetUi(WIDGET_CALL)` ist NICHT idempotent. `src/ui/contract.js:148` ruft
  `server.registerResource`, und das SDK wirft beim zweiten Aufruf "Resource ... is already
  registered" (`mcp.js:456/476`). Der Kommentar in `src/mcp-tools.js:1112` ("idempotent pro
  Server-Instanz") ist irrefuehrend. `prepare_call` darf deshalb NICHT ein zweites Mal
  `enableWidgetUi(WIDGET_CALL)` aufrufen. Das Fragment wird einmal berechnet und an beiden
  Werkzeugen gespreadet.
- `withWidgetLocale` (`src/mcp-tools.js:1060-1068`) MERGT das Ergebnis-`_meta`
  (`{...result?._meta, ...}`). Ein Code-`_meta` des Handlers bleibt also erhalten, und bei
  `isError` wird nichts angehaengt.
- Lint-Pins: `registerTools` ist auf 459 Zeilen gepinnt (`eslint-legacy-exceptions.json`,
  `src/mcp-tools.js`), `makeCallRoutes` ebenfalls (`src/routes/api-calls.js`). Beide duerfen NICHT
  wachsen, und es gibt keine neuen Eintraege. Folge:
  - Die neue Route kommt in eine NEUE Datei.
  - Das `place_call`-inputSchema (heute ca. 150 Zeilen IN `registerTools`) wird zur
    Modulkonstante, die `prepare_call` und `place_call` teilen.
  - `registerTools` SCHRUMPFT dadurch. Der Pin wird GESENKT und der Schluesseltext mit der neu
    gemessenen Zahl nachgezogen, das ist erlaubt.
- Die Schluessel-Frage laut Plan ("Pflicht-Secret laut Boot-Guard"): In `PRODUCTION_FOOTGUNS`
  (`src/config.js:2433ff`) ist `DASHBOARD_PASSWORD` das einzige boot-pflichtige Geheimnis. Laut
  `src/config.js:2435-2439` liest es aber keine Route mehr, und es bleibt nur bis AUTH-P8 als
  Rollback-Sicherung. Einen Schluessel darauf aufzubauen, machte es wieder tragend und blockierte
  AUTH-P8. `SESSION_SECRET` ist nicht boot-pflichtig. Deshalb gibt es laut Plan-Rueckfall eine
  **neue Env-Var `CALL_CONFIRMATION_SECRET`** und damit eine Deploy-Vorbedingung.
- Das Rate-Limit auf POST /mcp ist je Mandant `RATE_LIMIT_PER_MIN`, Default 120/min
  (`src/config.js:1954`, `src/mcp-rate-limit.js`). Das ist die Grundlage der Brute-Force-Rechnung.
- In den Tests steht in `BASE_ENV` `MCP_UI_ENABLED: "false"` (`test/helpers.js:388`). Tests fuer
  den Code-Weg setzen deshalb `MCP_UI_ENABLED=true` ausdruecklich.

## 2. Entwurf (verbindlich fuer den Bau)

**Ablauf:** `prepare_call(args)` -> Vorschau (Modell) + Code (`_meta`, nur Karte) -> Nutzer ->
`place_call(args, confirmation_code)` -> Pruefung + Verbrauch -> unveraenderter Weg
`POST /api/calls` mit allen Gates.

1. **Reines Modul `src/call-confirmation.js`** (Muster `src/elevenlabs/tenant-tool-token.js`):
   - Konstanten, benannt und kommentiert:
     - `CONFIRMATION_CODE_LENGTH = 6`
     - `CONFIRMATION_CODE_ALPHABET` = Crockford-Base32 ohne I/L/O/U
     - `CONFIRMATION_WINDOW_MS = 5 min`
     - `ACCEPTED_WINDOWS = 2` (aktuelles + vorheriges Fenster, Gueltigkeit also 5 bis 10 min)
     - `CONFIRMATION_SECRET_MIN_LENGTH = 32`
     - `DERIVATION_VERSION = "v1"`
     - HKDF-Info-String
   - `deriveConfirmationKey(secret)`: `hkdfSync("sha256", secret, "", info, 32)`. Ein leeres oder
     zu kurzes Geheimnis ergibt `null`, also nicht ableitbar (fail-closed).
   - `canonicalCallRequest({ to, args })`: bindet ALLE Argumente ausser `confirmation_code`, mit
     `to` in NORMALISIERTER Form. Die Schluessel werden rekursiv sortiert, `undefined`/fehlend wird
     gleich behandelt. Strings bleiben exakt, es gibt kein Trim.
   - `issueConfirmationCode({ key, tenantId, canonical, nowMs })` liefert `{ code, expiresAtMs }`.
     Der Code ist HMAC-SHA256 ueber `v1|tenantId|windowIndex|canonical`, abgebildet auf das
     Alphabet und gekuerzt.
   - `verifyConfirmationCode({ key, tenantId, canonical, code, nowMs })` liefert einen Boolean.
     Die Eingabe wird normalisiert (Grossbuchstaben, Leerzeichen und Bindestriche entfernt).
     Verglichen wird gegen das aktuelle und das vorherige Fenster, jeweils mit `safeEqual`
     (`src/util.js:5`). `key === null` ergibt immer `false`.
   - Die Brute-Force-Rechnung steht als Kommentar an `CONFIRMATION_CODE_LENGTH`: 32^6 = 2^30,
     etwa 1,07e9. Bei 120 Aufrufen/min je Mandant und 10 min Gueltigkeit sind das hoechstens 1200
     Versuche, P(Treffer) etwa 1,1e-6. Dazu kommt, dass jeder Versuch dieselben Argumente tragen
     muss.
2. **Neue Route `POST /api/call-confirmations`** in NEUER Datei
   `src/routes/api-call-confirmations.js`. Die Factory ist
   `makeCallConfirmationRoutes({ store, config, tenant: { requestTenant }, now = Date.now })`.
   Sie ist hinter `internalOnly` und wird in `src/app.js` direkt vor `makeCallRoutes` montiert.
   Absichtlich NICHT unter `/api/calls/...`, damit sie nicht mit `/api/calls/:id` kollidiert.
   - Eingabe: dieselben Felder wie `POST /api/calls`, optional `confirmation_code`.
   - Pruefungen in derselben Reihenfolge und mit denselben 400-Bodies wie die Vor-Gate-Pruefungen
     von `/api/calls`:
     - `normNum`, to/objective Pflicht
     - `isTrunkZeroFormatError`
     - `supportedLanguageOf`/`unsupportedLanguageBody`/`languageUnavailableBody`: aus
       `api-calls.js` auf Modul-Ebene in ein geteiltes Modul heben, KEINE Kopie
     - `TENANT_REJECT` -> 403
     - Normalisierung ueber den NEU exportierten Helfer `resolveDialTarget({ store, tenantId, to })`
       aus `src/telephony/outbound-gates.js`. Das Gate `normalize_target` ruft denselben Helfer,
       das ist ein reiner Extract ohne Verhaltensaenderung.
     - `isTrunkZeroFormatError` auf dem normalisierten Ziel
   - OHNE Code liefert die Route `200 { preview, confirmation: { code, expires_at } }`. Fehlt der
     Schluessel, kommt `503 { reason: "confirmation_unavailable" }`.
   - MIT Code liefert sie `200 { preview, confirmed }`. Bei `confirmed === true` wird der Code
     VERBRAUCHT: Eine In-Memory-Menge je App-Instanz haelt den Digest von
     Mandant+Fenster+Code bis zum Fensterende und bereinigt sich beim Zugriff. Ein zweiter Treffer
     ergibt `confirmed: false`.
   - Die Route schreibt NICHTS in den Store und ruft KEIN `audit()`. Sie loggt weder Code noch
     Ziel.
   - `preview` = `{ status: "awaiting_confirmation", to: <normalisiert>, objective, language,
     max_duration_s, briefing, constraints, mandate, context, diagnostic }`, also genau die
     gebundenen Felder, fehlende weggelassen.
3. **Einmal-Verbrauch:** Er liegt im Speicher und ist bewusst so einfach. Die Architektur setzt
   heute ohnehin eine Instanz voraus (der pg-Store haelt Zustand im Speicher). Grenze, benannt:
   Nach einem Neustart ist ein noch gueltiger Code hoechstens 10 min lang erneut nutzbar. Die
   bestehende Dedup faengt davon den Fall eines noch aktiven Anrufs.
4. **MCP-Seite (`src/mcp-tools.js`):**
   - `PLACE_CALL_REQUEST_SCHEMA` wird als Modulkonstante gebaut, aus dem heutigen inputSchema
     woertlich verschoben.
   - `place_call.inputSchema = { ...PLACE_CALL_REQUEST_SCHEMA, confirmation_code:
     z.string().optional().describe(...) }`. Direkt an der Zeile steht ein Kommentar mit dem
     SDK-Grund: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:125,166-178`, ein
     Pflichtfeld wuerde als "Input validation error" ohne Handlertext enden.
   - `const callWidgetUi = enableWidgetUi(WIDGET_CALL)` wird EINMAL berechnet und bei
     `place_call` und `prepare_call` gespreadet.
   - `prepare_call`:
     - Annotationen `readOnlyHint:true, destructiveHint:false, openWorldHint:false` (+
       idempotentHint laut Tabellen-Konvention), dazu `title` und Statuszeilen in
       `TOOL_ANNOTATIONS`/`TOOL_INVOCATION_STATUS`.
     - `outputSchema` = Vorschau-Schema.
     - Handler: `call("POST", "/api/call-confirmations", args)`. Er liefert `content` (Textvorschau
       OHNE Code) und `structuredContent` = preview. `_meta["hermes/confirmation_code"]` und
       `_meta["hermes/confirmation_expires_at"]` setzt er NUR, wenn `callWidgetUi._meta` gesetzt
       ist. Ohne Karte gibt es keinen Code, und der Text sagt, dass dieser Host nicht bestaetigen
       kann.
     - Die `_meta`-Schluessel sind als benannte Konstanten ausgelagert.
   - Der `place_call`-Handler:
     - `const { confirmation_code, ...request } = args`
     - `call("POST", "/api/call-confirmations", { ...request, confirmation_code })`
     - Bei `!confirmed` kommt `errText(...)` mit normalisiertem `to`, `objective` und dem Satz: "den
       Anruf in der Hermes-Karte bestaetigen; ein Host ohne Karte kann nicht waehlen". Der Text ist
       lokalisiert ueber `loc.mcp`, in ALLEN Sprachbuendeln von `src/i18n/mcp-texts.js`, und
       enthaelt keinen Code.
     - Sonst wird unveraendert `placeCallHopCall(request)` aufgerufen, OHNE `confirmation_code`
       im Body.
     - `503 confirmation_unavailable` wird auf eine eigene `MCP_ERROR_CODE`-Kennung mit neutralem
       Text abgebildet.
     - Die Handler-Logik liegt so weit wie moeglich auf Modul-Ebene (Muster `placeCallHop`), damit
       `registerTools` nicht waechst.
   - Beschreibung `place_call` (`placeCallDescription`) + Feldbeschreibung: ohne gueltigen
     `confirmation_code` wird nicht gewaehlt; der Code kommt nur aus der Hermes-Karte nach
     `prepare_call`; vorher `prepare_call` mit denselben Argumenten aufrufen.
   - Den veralteten Kommentar `src/mcp-tools.js:1163-1169` korrigieren. Er nennt "Allowlist" und
     "src/server.js /api/calls", richtig sind `routes/api-calls.js` +
     `telephony/outbound-gates.js`; die Allowlist ist tot.
5. **Server-Instruktionen** (`src/mcp-server-info.js`, `MCP_BASE_INSTRUCTIONS`): ein Satz zur
   Sequenz: prepare_call -> Nutzer bestaetigt in der Hermes-Karte und nennt den Code ->
   place_call mit denselben Argumenten + confirmation_code; Hosts ohne Karte koennen nicht
   waehlen.
6. **`cancel_call` und `answer_consult` bekommen KEINE zweite Stufe.** Begruendung im Inventar:
   - `cancel_call` mindert Schaden. Eine Bestaetigung verzoegert nur das Auflegen, und es entstehen
     keine neuen Kosten und kein neuer Kontakt.
   - `answer_consult` ist sekundenkritisch. Es laeuft nur innerhalb eines bereits bestaetigten
     Anrufs, und eine Karten-Runde wuerde den Anruf abbrechen lassen.

## 3. Schritte

| Nr | Was | Wo | IDs | Pfade | Beweis |
|---|---|---|---|---|---|
| 1 | Reines Modul Code-Bau/-Pruefung (s. 2.1) inkl. Brute-Force-Kommentar | NEU `src/call-confirmation.js` | N-10 | alle (serverseitig) | (b) NEU `test/call-confirmation.test.js`: gleiche Eingabe -> gleicher Code; Laenge 6, nur Alphabet; jede Aenderung an to/objective/briefing/language/max_duration_s/mandate/tenantId -> anderer Code; Schluesselreihenfolge egal; vorheriges Fenster akzeptiert, zwei Fenster spaeter abgelehnt (injizierte Uhr); leeres/31-Zeichen-Geheimnis -> Schluessel null -> verify false; Kleinbuchstaben/Leerzeichen akzeptiert. (a) `grep -n safeEqual src/call-confirmation.js` trifft die Vergleichszeile |
| 2 | `resolveDialTarget` aus `normalize_target` extrahieren (reiner Extract) | `src/telephony/outbound-gates.js:730-744` | N-10 | HTTP /mcp, stdio (beide via REST) | (b) bestehende Gate-Reihenfolge-/Normalisierungstests gruen (voller Lauf, `# fail 0`); (a) das Gate ruft den Helfer, `git diff` zeigt keine geaenderte Bedingung |
| 3 | Sprach-Helfer (`unsupportedLanguageBody`, `languageUnavailableBody`) auf Modul-Ebene in ein geteiltes Modul heben, `api-calls.js` importiert sie (makeCallRoutes-Zeilen unveraendert) | `src/routes/api-calls.js:280-300` -> NEU z.B. `src/routes/_call-request.js` | N-10 | REST intern | (c) `npx eslint src/routes/api-calls.js --suppressions-location eslint-suppressions.empty.json --format json`: makeCallRoutes-Zeilenzahl <= Pin; (b) bestehende LANG-/P4a-Tests gruen |
| 4 | Route `POST /api/call-confirmations` (s. 2.2, 2.3) + Montage | NEU `src/routes/api-call-confirmations.js`; `src/app.js:~403` (vor makeCallRoutes) | N-10 | HTTP /mcp (OAuth + Legacy), stdio | (b) `test/route-auth-inventory.test.js` gruen, Route als `internalOnly` klassifiziert; (b) Route-Unit-Test mit injizierter Uhr: abgelaufen -> confirmed:false; zweiter Treffer -> confirmed:false; fremder Tenant-Header -> confirmed:false; kein Secret -> 503 `confirmation_unavailable`; (c) Interface-IP-Request (Muster test/helpers.js) an die Route -> 403 (nicht loopback) |
| 5 | Neue Env-Var `CALL_CONFIRMATION_SECRET` an allen vier Orten + Boot-WARN (keine Sperre) | `src/config.js` (Namespace `auth`, Key-Liste `:2301`), `.env.example`, `render.yaml` (`sync: false`), `test/helpers.js` BASE_ENV `""` | N-10 | alle | (b) `test/config-shape.test.js` + BASE_ENV-Drift-Test gruen; (a) `grep -n CALL_CONFIRMATION_SECRET src/config.js .env.example render.yaml test/helpers.js` = 4 Dateien; (a) nicht in `src/config-fingerprint.js`-Hash/Log (grep, Test falls Fingerprint alle Keys nimmt); (b) Test: ohne Wert -> Boot-WARN-Zeile, Boot laeuft weiter |
| 6 | `PLACE_CALL_REQUEST_SCHEMA` als Modulkonstante; `callWidgetUi` einmal berechnen; `prepare_call` registrieren; `place_call` bekommt `confirmation_code` (optional im Schema, Pflicht im Handler, SDK-Kommentar) und prueft vor dem Hop; Code nur bei Karte; neue MCP-Fehlerkennung; Texte in allen Sprachbuendeln; veralteten Kommentar korrigieren | `src/mcp-tools.js:1163-1364`, `TOOL_ANNOTATIONS` (~`:882`), `TOOL_INVOCATION_STATUS` (~`:962`), `src/i18n/mcp-texts.js` (`:127/:210/:277` Nachbarn) | N-10 | HTTP /mcp OAuth, HTTP /mcp Legacy, stdio | (b) NEU `test/openai-t2-13-bestaetigung.test.js`, Kriterien (a)-(g) unten, am Draht; (c) `npx eslint src/mcp-tools.js --suppressions-location eslint-suppressions.empty.json --format json`: registerTools-Zeilen < 459, Pin GESENKT, kein neuer Eintrag |
| 7 | Server-Instruktionen: ein Satz zur Sequenz | `src/mcp-server-info.js:99-104` | N-10 | HTTP /mcp, stdio | (b) `initialize`-Antwort am Draht (HTTP und stdio) enthaelt `prepare_call` und `confirmation_code` im `instructions`-String; bestehende Instruktions-Pins nachgezogen |
| 8 | Bestehende Tests nachziehen (Handler-Mocks beantworten `/api/call-confirmations` mit `confirmed:true`; Namensmengen 10/12; Inventar-/Doku-Pins) | voraussichtlich: `test/mcp-ui.test.js`, `test/place-call-context-bridge.test.js`, `test/profiles.test.js`, `test/profile-tenant-key.test.js`, `test/p15-mcp-tool-descriptions-en.test.js`, `test/gq-b1-briefing-openness.test.js`, `test/openai-t2-09-neutrale-fehlertexte.test.js`, `test/openai-s3-hop-frist.test.js`, `test/openai-t2-08-hop-frist.test.js`, `test/openai-t2-05-reauth-challenge.test.js`, `test/openai-p5b-geldpfad.test.js`, `test/al-p13-consult-channel.test.js`, `test/check-staged-suppressions.test.js`, `test/mcp-tool-annotations.test.js`, `test/openai-p4-ergebnisstruktur-instructions.test.js`, `test/openai-t2-11-werkzeugtexte.test.js` - MESSEN, nicht aus dieser Liste glauben | N-10 | alle | (b) voller Lauf `# fail 0`; jeder zuvor rote Test isoliert gruen (`NODE_ENV=test node --test --test-name-pattern=...`). Kein Test wird geloescht oder abgeschwaecht, der ein Gate prueft |
| 9 | Inventar fuer den OpenAI-Pruefer: Table A 12 Tools, Table B Namensmengen (10 ohne / 12 mit Consult), Annotation-Begruendung `prepare_call`, warum `cancel_call`/`answer_consult` keine zweite Stufe, was die Bestaetigung beweist/nicht beweist (Abschnitt 0), Folge "Hosts ohne Karte koennen nicht waehlen". KEINE internen Kennungen (keine Phasen-/Katalog-IDs, keine Env-Namen) | `docs/OPENAI-TOOL-INVENTORY.md` (`:19`, `:80`, `:238`) | N-10 | Doku | (b) bestehender Doku-Pin-Test (z.B. `test/openai-policy-abgleich-doku.test.js`/Inventar-Test) gruen; (c) `grep -nE "T2-|N-10|OW-|CALL_CONFIRMATION" docs/OPENAI-TOOL-INVENTORY.md` -> keine neue Zeile |
| 10 | PLAN-SECURITY.md: neuer Abschnitt "OpenAI-T2-13 - Bestaetigung vor dem Waehlen" (Schritt, Host-Abhaengigkeit, Abschnitt 0 woertlich sinngemaess, Vertrauensgrenze `/api/calls` = Loopback, Einmal-Verbrauch im Speicher + Neustart-Grenze, Brute-Force-Rechnung, Deploy-Vorbedingung, "nur zusammen mit T2-14") ohne Produktionswerte | `PLAN-SECURITY.md` (nach `:6149`-Abschnitt) | N-10 | Doku | (a) Abschnitt vorhanden; (c) `grep -n "CALL_CONFIRMATION_SECRET=" PLAN-SECURITY.md` -> kein Wert |

### Abnahme am Draht (Schritt 6)

Die neue Testdatei spawnt den Server mit `FAKE_ORIGINATE=true`, `MCP_UI_ENABLED=true`, einem
Test-`CALL_CONFIRMATION_SECRET` (>= 32 Zeichen, im Test erzeugt) und KYC/Abo-Fixture wie in den
bestehenden Outbound-Tests. Sie laeuft je Pfad: HTTP /mcp Legacy-Token, HTTP /mcp OAuth
(Mini-IdP `startIdp`, Interface-IP), jeweils mit und ohne Consult, sowie stdio (`src/mcp-server.js`
mit `GATEWAY_URL` auf den gespawnten Server).

- (a) `tools/call prepare_call`:
  - `result._meta["hermes/confirmation_code"]` passt auf `^[0-9A-HJKMNP-TV-Z]{6}$`.
  - Der Codewert kommt NICHT in `JSON.stringify(result.content)` vor und NICHT in
    `JSON.stringify(result.structuredContent)`.
  - `structuredContent.status === "awaiting_confirmation"`, `structuredContent.to` ist normalisiert
    (Eingabe national mit 0 -> E.164).
- (b) `place_call` ohne Code, mit `""` und mit einem erfundenen Code:
  - Ergebnis jeweils `isError`.
  - Der Text enthaelt normalisiertes `to`, `objective` und den Kartensatz inkl. "Host ohne Karte".
  - Er enthaelt NICHT "Input validation error".
  - Der Store hat keinen neuen Call, und `POST /api/calls` wurde nicht erreicht (kein Audit
    `place_call*`, keine FAKE_ORIGINATE-Spur).
- (c) Der Code aus (a) wird aus `_meta` gelesen (simuliert Karte -> Nutzer -> Modell). Ergebnis:
  Anruf angelegt, `call_id` vorhanden, danach funktioniert `await_call_event` mit dieser
  `call_id` (Consult-Variante) bzw. `get_call_status`.
- (d) Diese Faelle ergeben jeweils `isError` ohne Anruf:
  - geaendertes `to`
  - geaendertes `objective`
  - geaendertes `briefing`
  - Code von Mandant A bei Mandant B (OAuth, zwei Tokens)
  - derselbe Code ein ZWEITES Mal (Einmal-Verbrauch)
  - Ablauf: injizierte Uhr im Route-Unit-Test (Schritt 4). Am gespawnten Server gibt es KEINE
    Uhr-Naht per Env.
- (e) `prepare_call` veraendert den Store nicht: `data/store.json` im DATA_DIR hat vorher und
  nachher denselben sha256. Die Audit-Ausgabe waechst nicht um einen `place_call`/Gate-Eintrag.
  Die Server-Logzeilen enthalten den Codewert nicht (Substring-Suche im gesammelten
  stdout/stderr).
- (f) `tools/list`:
  - `prepare_call` traegt `readOnlyHint:true, destructiveHint:false, openWorldHint:false`.
  - Die `place_call`-Annotationen sind byte-gleich zu vorher.
  - `confirmation_code` steht in `place_call.inputSchema.properties`, aber NICHT in `required`.
  - Seine Beschreibung nennt die Pflicht und die Hermes-Karte.
  - `prepare_call._meta.ui.resourceUri` ist gleich der von `place_call`.
- (g) Die Namensmenge ist ohne Consult genau 10 Werkzeuge, mit Consult genau 12 (T2-12-Menge plus
  `prepare_call`).
- Zusatz Gates:
  - gueltiger Code + `OUTBOUND_FROZEN=true` -> `isError` (Frozen-Text), kein Anruf.
  - gueltiger Code + Denylist-Ziel -> Ablehnung.
  - Beleg: Die Bestaetigung umgeht kein Gate.
- Zusatz ohne Karte: `MCP_UI_ENABLED=false` -> `prepare_call` liefert eine Vorschau OHNE
  `_meta`-Code, und `place_call` waehlt nicht.
- Zusatz ohne Secret: `CALL_CONFIRMATION_SECRET=""` -> `prepare_call` ist `isError` mit neutralem
  Text, und es kommt kein Anruf zustande.

## 4. Nicht bauen (mit Grund)

- **Bestaetigungs-Ansicht im Call-Widget:** Das ist T2-14. T2-13 bindet das Widget nur an
  `prepare_call`.
- **Weg ohne Karte** (Claude Code, stdio ohne UI, `MCP_UI_ENABLED=false`), etwa ein
  Web-App-Link oder ein Code im Text: Plan Abschnitt 5 schliesst das aus. Ein Code, den das Modell
  sieht, macht die Bestaetigung formal, und ein Web-Link waere ein neuer, zustandsbehafteter
  Geldpfad-Endpunkt. Folge, bewusst: Aus diesen Hosts wird per MCP nicht gewaehlt.
- **MCP-Elicitation:** Der Transport ist zustandslos, die Antwort kaeme bei einer anderen
  Instanz an.
- **Zweite Stufe fuer `cancel_call`/`answer_consult`:** Begruendung in 2.6.
- **Pruefung des Codes in `POST /api/calls` bzw. ein neues Gate in der Gate-Kette:**
  - Die Route ist `internalOnly` (Loopback); ihr einziger Aufrufer ist der MCP-Handler.
  - Ein Gate dort braeuchte Zeilen in der gepinnten `makeCallRoutes`/Gate-Kette.
  - Es braeche die vielen REST-direkten Gate-Tests.
  - Plan-Kriterium (b) verlangt ausdruecklich, dass `/api/calls` NICHT getroffen wird.
  - Die Vertrauensgrenze "Loopback darf waehlen" besteht heute schon und wird in PLAN-SECURITY
    benannt.
- **Uhr-Naht per Env fuer den gespawnten Server:** Eine Test-Naht, die in Produktion die
  Gueltigkeit verschieben koennte, ist eine neue abschaltbare Sicherung. Der Ablauf wird am
  Modul und an der Route-Factory mit injizierter Uhr bewiesen.
- **Persistenter Einmal-Verbrauch** (Store-Spalte): Das ist eine Schemaaenderung ohne Nutzen,
  solange die Architektur eine Instanz voraussetzt. Die Neustart-Grenze ist benannt.
- **Boot-Sperre bei fehlendem Secret:** Autonome Entscheidung P6 laesst keine neue
  Boot-Verweigerung zu. Es gibt nur eine WARN-Zeile.
- **Vorschau fuehrt die Gate-Kette als Probelauf aus:** Die Gates haben Nebenwirkungen
  (Reserve, Audit). Die Vorschau sagt keine Gate-Entscheidung voraus.

## 5. Pre-Mortem (ein Jahr spaeter war T2-13 ein Fehler)

1. **Das Modell bestaetigt sich selbst.** Ein Host reicht Ergebnis-`_meta` ans Modell weiter, das
   Modell verkettet prepare -> place, und es waehlt ohne Mensch. Alle Tests bleiben gruen.
   - Gegenmassnahmen:
     - Abschnitt 0 behauptet nichts Staerkeres.
     - Die Owner-Probe OW-C(6)/OW-D fragt das Modell VOR dem Klick nach dem Code.
     - Leakt ein Host, ist der Rueckfall aus Plan Abschnitt 5 dokumentiert: `place_call` nur fuer
       die App.
     - Die Gates laufen weiterhin, das Schadensmaximum bleibt also durch Kostendecke, Stundenlimit
       und Denylist begrenzt.
2. **Parametertausch zwischen Bestaetigen und Waehlen** (anderes Ziel/Briefing/Mandat).
   Gegenmassnahme: Der Code bindet ALLE Argumente + Mandant + Fenster. Der Kriterientest (d)
   aendert je ein Feld.
3. **Replay oder Doppelanruf.** Gegenmassnahme: Einmal-Verbrauch + bestehende Dedup (180 s,
   aktive Anrufe). Grenze: Nach einem Neustart ist ein Code hoechstens 10 min lang erneut nutzbar.
   Das ist akzeptiert und in PLAN-SECURITY benannt. Der Verbrauch passiert VOR `/api/calls`. Lehnt
   ein Gate ab, muss neu bestaetigt werden (fail-closed, laestig, nicht gefaehrlich).
4. **Code leakt** in den Text, ins Log, ins Audit, in `isError`-Texte oder in den REST-Body an
   `/api/calls` (und von dort in den Call-Datensatz). Gegenmassnahmen:
   - Kriterium (a) prueft per Substring.
   - (e) prueft die Logzeilen.
   - Der Handler entfernt `confirmation_code` vor dem Hop.
   - Die Route loggt nichts.
5. **Team kann plotzlich nicht mehr waehlen.** Ursachen: Claude Code/stdio ohne Karte, fehlendes
   Secret beim Deploy oder `MCP_UI_ENABLED=false`. Gegenmassnahmen:
   - Der `isError`-Text nennt den Grund ("Host ohne Karte").
   - Ein Boot-WARN meldet das fehlende Secret.
   - Deploy-Vorbedingung in owner_punkte.
   - T2-13 geht nur zusammen mit T2-14 live.
6. **`prepare_call` ist doch schreibend** (Audit, Cache) und falsch als lesend annotiert, was ein
   Ablehnungsgrund ist. Gegenmassnahme: Kriterium (e). Die Route ruft kein `audit()`, und
   `resolveDialTarget` liest nur.
7. **Jemand "haertet" spaeter das Schema** (`confirmation_code` required), oder ein SDK-Update
   dreht die Reihenfolge. Folge: Jeder Host sieht nur "Input validation error". Gegenmassnahmen:
   - Kriterium (f) prueft `required` am Draht.
   - Kriterium (b) prueft den Handlertext.
   - Der Kommentar an der Schemazeile nennt den Grund.
8. **Gate aufgeweicht durch den Extract** `resolveDialTarget`. Gegenmassnahmen: Es ist ein reiner
   Extract, alle Gate-Tests bleiben gruen, und `git diff` zeigt keine geaenderte Bedingung.
   `/api/calls` und die Gate-Kette werden sonst NICHT beruehrt, auch der Offenlegungssatz und
   `calleeIsOwner` nicht.
9. **Doppelte Resource-Registrierung** crasht jede `/mcp`-Sitzung mit UI (SDK wirft "already
   registered"). Gegenmassnahme: `callWidgetUi` einmal berechnen. Kriterium (f) + ein
   `tools/list` mit `MCP_UI_ENABLED=true` beweisen es.
10. **Brute-Force des 6-stelligen Codes.** Gegenmassnahmen: 2^30 Codes, hoechstens 1200 Versuche je
    Gueltigkeit (Rate-Limit je Mandant), jeder Versuch mit identischen Argumenten und einmaliger
    Gueltigkeit. Rechnung als Kommentar. stdio hat kein Rate-Limit, ist aber lokal (der Nutzer
    selbst).
11. **Das Secret wird geloggt oder landet im Config-Fingerprint.** Gegenmassnahme: Schritt 5 prueft
    `config-fingerprint.js`. Das Secret steht nur in config.
12. **T2-13 wird ohne T2-14 deployt.** Dann rendert das Call-Widget ein Ergebnis ohne `call_id`
    und niemand kann waehlen. Gegenmassnahme: Deploy-Vorbedingung in OW-A (Plan) und
    owner_punkte.

## 6. Widersprueche

1. Lead-Notiz "diese Phase muss auch OHNE Widget funktionieren (Claude-Connector, ChatGPT,
   stdio)" gegen Plan T2-13/Abschnitt 5 ("nach T2-13 allein kann niemand mehr waehlen", Hosts
   ohne Karte waehlen nicht). Aufgeloest nach Rangfolge zugunsten des Plans: Die serverseitige
   Sperre gilt und ist auf ALLEN Pfaden ohne Widget testbar. Waehlen ohne Karte ist bewusst
   unmoeglich. Ein Code im Modelltext waere nur formal.
2. Lead bindet `briefing`, der Plan schliesst `briefing`/`context` aus. Aufgeloest zugunsten der
   strengeren Bindung ALLER Argumente, denn briefing/mandate/constraints steuern, was einem
   Dritten gesagt oder zugesagt wird. Preis: Formuliert das Modell um, muss neu bestaetigt werden.
3. Lead: "einmalig". Plan: zustandslos, Replay faengt die Dedup. Die Dedup deckt nur aktive
   Anrufe <= 180 s ab (`call-dedup.js:20,26`), die Code-Gueltigkeit ist aber bis 10 min.
   Deshalb kommt ein Einmal-Verbrauch im Speicher dazu.
4. Plan-Kriterium (d) "Fenster abgelaufen (Uhr injiziert)" am Draht: Ohne Uhr-Naht in Produktion
   geht das nur an Modul/Route-Factory.
5. Plan: "Schluessel aus in Produktion Pflicht-Secret laut Boot-Guard". Das einzige ist
   `DASHBOARD_PASSWORD`, laut `src/config.js:2435-2439` nur noch Rollback-Sicherung bis AUTH-P8.
   Deshalb neue Env-Var (Plan-Rueckfall).
6. Plan Abschnitt 5 nennt `src/routes/api-calls.js:394` fuer `internalOnly` an `POST /api/calls`.
   Richtig ist `:458` (`:399` ist `makeCallRoutes`).
7. Plan: `MCP_UI_ENABLED=false` -> "Code wird nie sichtbar", impliziert also, dass er trotzdem
   ausgestellt wird. Spec ist strenger: Ohne gebundene Karte wird kein Code ausgestellt.
8. Kommentar `src/mcp-tools.js:1112`: `enableWidgetUi` "idempotent pro Server-Instanz". Das ist
   falsch fuer einen Doppelaufruf, das SDK wirft (`mcp.js:456/476`).
9. Kommentar `src/mcp-tools.js:1167-1169`: Gates "in src/server.js /api/calls", inkl.
   "Allowlist". Beides ist veraltet (routes/api-calls.js + telephony/outbound-gates.js,
   Allowlist tot).
10. Die Zwischenmessung/Lead nennt `answer_consult`/`cancel_call` als Befund. Der Plan nimmt sie
    begruendet aus. Das bleibt so, mit Begruendung im Inventar.

## 7. Owner-Punkte (nur Owner-Regel)

1. **Deploy-Vorbedingung, Render-Dashboard:** `CALL_CONFIRMATION_SECRET` setzen, eine
   Zufallszeichenkette mit >= 32 Zeichen (z.B. `openssl rand -base64 48`). Der Wert steht nirgends
   im Repo.
   - Erwartet: Nach dem Deploy steht im Boot-Log KEINE Warnzeile "CALL_CONFIRMATION_SECRET
     fehlt", und `prepare_call` liefert eine Vorschau.
   - Fehlt der Wert, laeuft die Produktion weiter, aber per MCP waehlt niemand.
2. **Deploy nur zusammen mit T2-14** (beide gemergt), dazu `MCP_UI_ENABLED` im Dashboard NICHT
   `false` (OW-A/OW-G).
   - Erwartet: Der Connector zeigt `prepare_call` + `place_call`.
   - Die Karte zeigt den Code, erst T2-14 macht ihn sichtbar.
3. **Live-Probe ChatGPT Developer Mode + Claude (OW-C(6)/OW-D).** Ziel ist eine sichere
   Testnummer.
   - Einen Anruf erbitten und VOR dem Klick das Modell fragen, welcher Code in der Karte steht.
     Erwartet: Das Modell kennt ihn nicht.
   - Dann ueber die Karte bestaetigen. Erwartet: Genau ein Anruf.
   - Nennt das Modell den Code vorher, gilt der Rueckfall aus Plan Abschnitt 5 (Waehlen nur aus
     der App).
4. **Bewusste Folge zur Kenntnis:** Aus Claude Code/stdio (Hosts ohne Karte) ist per MCP kein
   Anruf mehr moeglich.
