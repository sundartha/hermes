# T2-18 - Kompatibilitaets-Vertrag und Update-Runbook (Spec)

Umfang: GENAU T-33. Basis: master `f492a19`. Worktree:
`/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-18`
(Branch `phase/openai-t2-18-compat-contract-runbook`, `node_modules` als Symlink). Alle Agenten arbeiten NUR dort.

## Kurzfassung

Diese Phase aendert KEINE Zeile unter `src/` ausser einem JSON-Kommentarfeld (Schritt 7, optional) und
aendert weder `tools/list` noch `initialize`. Sie baut:

1. `docs/mcp-vertrag.json` - den Vertrag: die am ECHTEN Draht gemessenen, zugesicherten Merkmale
   (Werkzeugnamen je Pfad, Eingabe-Gerippe inkl. Pflichtfelder und Typen, Ausgabe-Gerippe,
   Annotation-Hinweise, securitySchemes je Pfad, Widget-resourceUri je Werkzeug, resources/list-URIs)
   plus eine Aenderungskette (jede Aenderung = Eintrag mit Art, Begruendung, SHA-256 des neuen Stands).
2. `test/mcp-vertrag-pruefung.js` - reine Pruef-Logik (kein Netz, keine Datei): Gerippe, kanonischer
   Hash, Klassifikation einer Abweichung (additiv / bruch, fail-closed), Ketten-Pruefung,
   Runbook-Verweis-Pruefung.
3. `test/mcp-kompatibilitaetsvertrag.test.js` - Unit-Tests mit Positiv-Kontrollen + Draht-Test auf
   ALLEN Pfaden (HTTP Legacy, HTTP Token ueber Interface-IP, HTTP OAuth, OAuth ohne Mandant, stdio;
   jeweils mit/ohne Consult bzw. mit/ohne `MCP_UI_ENABLED`).
4. `docs/RUNBOOK-MCP-UPDATE.md` - geregelter Aenderungsvorgang (was ist Bruch, was additiv, was verlangt
   OpenAI nach der Freigabe - woertlich zitiert, Rest UNKNOWN).

Der Vertrag friert den heutigen Stand NICHT ein: jede Aenderung ist erlaubt, braucht aber einen
Ketten-Eintrag mit Begruendung; der Test sagt bei Rot, welche Klasse die Abweichung hat und welcher
Runbook-Abschnitt gilt. Die Folgephase (Werkzeug-AUSGABEN: `get_call_status` ohne woertliche
Transkriptzeilen nach Anrufende; ehrliche `list_action_items`-Beschreibung) bleibt ohne Vertragseintrag
gruen, solange sie das Ausgabe-SCHEMA nicht aendert (Inhalt und Beschreibungen sind kein
Vertragsmerkmal) - und bekommt, falls sie das Feld `last_transcript_lines` entfernt, einen klaren
roten Hinweis "bruch: Ausgabefeld entfernt".

## Primaerquellen (am 2026-09-27 abgerufen, woertlich geprueft)

Geprueft gegen `https://developers.openai.com/plugins/llms-full.txt` und die HTML-Seiten selbst
(`curl` in `logs-t2-18/`). Seitenzuordnung: der Abschnitt "Remote MCP server review requirements" =
`https://developers.openai.com/plugins/deploy/app-review`; "Build an MCP server" =
`https://developers.openai.com/plugins/build/mcp-server`.

app-review (https://developers.openai.com/plugins/deploy/app-review):
- "Treat the metadata exposed by your MCP server as a versioned API contract for the plugin."
- "OpenAI periodically fetches your MCP server's tools and compares them with the published definitions, including their descriptions, schemas, and annotations."
- "**Deleted tools:** Removed from the published tool list as soon as a scan detects the deletion, without waiting for automated checks."
- "**New tools:** Made available after they pass automated checks. Until then, they aren't available to users."
- "**Changed tools:** The previous definition stays live until the updated definition passes automated checks or a scan detects that you removed the tool."
- "Keep your server compatible with the live definition while an update is held."
- "OpenAI retains the definition, not a copy of your server implementation."
- "An incomplete check doesn't approve an update, even if it has no findings."
- Tabelle "Other changes" (Zeilen woertlich): UI-Resource-Referenzen/CSP -> "Deploy the change. These fields are reviewed with the tool definition through continuous review."; "Backward-compatible content update served from the same published UI resource URI" -> "Deploy the content update. You don't need to scan, submit, or publish a new version if the URI and published contract remain compatible." / "After deployment. ChatGPT may continue serving cached resource contents for up to one hour."; "Server-only fix or change to live tool results, including result `_meta`, or business data" -> "Deploy the server change. You don't need to scan, submit, or publish a new version if the change preserves the published contract."; Origin -> "To change the origin, create a new plugin, then complete its scan, submission, review, and publication flow. To change only the endpoint path, use the normal new-version flow."
- "Server changes take effect before a scan can discover or approve them. Keep existing input schemas and each published UI resource URI working during that gap. If a deployment breaks the live contract, roll back the server change rather than waiting for review."
- "To change submitted plugin information or imported skills, create a new draft version of the existing plugin and resubmit it for review. Continuous tool review doesn't replace this process."
- "only one version may be published at a time and only one version may be in review at a time."

mcp-server (https://developers.openai.com/plugins/build/mcp-server):
- "Keep published tool names and schemas backward compatible. Add fields or tools without breaking existing contracts. If metadata changes, refresh the developer-mode connection and rerun the evaluation set before submission."
- "For optional UI, version resource identifiers when HTML, JavaScript, or CSS changes in a way that could break a cached component."

Hinweis: im HTML ist "Keep existing input schemas and each published UI resource URI working" ueber
einen Zeilenumbruch verteilt; im `llms-full.txt` steht der Satz zusammenhaengend (Zeilen um 5625).
Beim Zitat-Check deshalb Whitespace normalisieren.

## Gemessener Ist-Stand am Draht (Planungsmessung, Worktree f492a19)

Gemessen mit einem Scratch-Skript ueber `test/mcp-draht-pfade.js` (legacySnapshot/oauthSnapshot/stdioSnapshot):

| Pfad | Werkzeuge | Widget-URIs |
|---|---|---|
| HTTP Legacy ohne Consult | 10 | keine |
| HTTP Legacy mit Consult-Env | 12 (+ await_call_event, answer_consult) | keine |
| HTTP Legacy, MCP_UI_ENABLED=true | 10 | call/v12 (prepare_call, place_call), my-number/v8, calls/v7, agent-status/v7 |
| HTTP OAuth ohne Consult | 10 | keine |
| HTTP OAuth mit Consult + UI | 12 | wie oben |
| HTTP OAuth ohne Mandant | 10 | keine |
| stdio ohne/mit UI | 10 | ohne / wie oben |

- Die Vertragsmerkmale (Pflichtfelder, Eingabe-/Ausgabe-Typen, additionalProperties, Annotation-Hints,
  execution) sind auf ALLEN gemessenen Pfaden je Werkzeug identisch. Unterschiede nur: `securitySchemes`
  (nur OAuth-Pfade: `[{type:"oauth2",scopes:[...]}]`), `_meta.ui` (nur mit UI), `description` von
  `place_call` (Consult-abhaengig) - Beschreibungen sind kein Vertragsmerkmal.
- Consult-Werkzeuge erscheinen nur ueber HTTP und nur, wenn `CONSULT_ENABLED` UND
  `ASSISTANT_CONTEXT_ENABLED` an sind UND das Profil `allowConsult` traegt
  (`src/consult/gate.js:19-25`, Aufruf `src/routes/mcp.js:232`); stdio registriert sie nie
  (`src/mcp-tools.js:1513` Default `consultAllowed = false`, Block `:1744`).
- `cancel_call` und `list_action_items` haben KEIN outputSchema (Ausgabe-Vertrag = "keins").
- Schema-Schluesselwoerter am Draht: type, properties, required, additionalProperties, items, enum,
  anyOf, exclusiveMinimum, maximum, description, $schema.
- Widget-URI-Schema: `src/ui/contract.js:27-28` (`ui://hermes/<id>/v<version>.html`), Version = hoechste
  in `src/ui/widget-versions.json` (`src/ui/widget-catalog.js:172`). Es wird NUR die aktuelle Version
  registriert (`src/mcp-tools.js:1556-1562`, `src/ui/contract.js:146`): eine aeltere URI ist nach einem
  Versionssprung NICHT mehr lesbar.
- `MCP_UI_ENABLED` Default AN (`src/config.js:1645`), Tests pinnen `false` via BASE_ENV (`test/helpers.js:390`).
- Baseline: `openai-t2-02`, `openai-t2-16`, `openai-t2-17` isoliert 95/95 gruen.

## Schritte

### Schritt 1 - Pruef-Logik als reines Modul
- Was: neue Datei `test/mcp-vertrag-pruefung.js` (ohne `.test.js`, wie `test/mcp-draht-pfade.js`), nur
  reine Funktionen:
  - `schemaGerippe(schema)`: rekursiv NUR `type, required (sortiert), properties (rekursiv),
    additionalProperties, items (rekursiv), enum, anyOf (rekursiv), exclusiveMinimum, maximum`
    (weitere Constraint-Schluessel `minimum/exclusiveMaximum/minLength/maxLength/minItems/maxItems/
    pattern/format/const/default` ebenfalls, falls vorhanden) - OHNE description, title, $schema,
    examples. `null` bei fehlendem Schema.
  - `werkzeugMerkmale(tool)`: `{ eingabe, ausgabe, hinweise: {readOnlyHint, destructiveHint,
    idempotentHint, openWorldHint}, ausfuehrung: tool.execution ?? null }` (annotations.title NICHT -
    Text).
  - `standAusDraht(profile)`: aus `{ profilId: { tools, resources } }` den Vertrags-Stand
    `{ profile: { id: { werkzeuge:[namen sortiert], sicherheitsschemata, widgets:{name:uri}, ressourcen:[{uri,mimeType}] } }, werkzeuge: { name: merkmale } }`;
    WIRFT, wenn dasselbe Werkzeug auf zwei Pfaden verschiedene Merkmale hat (Pfad-Divergenz ist
    selbst ein Befund).
  - `kanonisch(wert)` (Schluessel sortiert, stabil) und `standSha256(stand)`.
  - `klassifiziere(alt, neu)` -> Liste `{ art: "bruch"|"additiv", merkmal, werkzeug|profil, detail,
    runbook }`. Regeln FAIL-CLOSED - additiv ist NUR: neues Werkzeug (in Profil und Katalog), neue
    NICHT-Pflicht-Eingabe-Eigenschaft, neue Ausgabe-Eigenschaft, neues outputSchema wo keins war, neue
    Resource-URI. ALLES andere ist bruch, insbesondere: Werkzeug fehlt (entfernt/umbenannt), neues oder
    neu verpflichtendes Eingabefeld, entfernte Eingabe-Eigenschaft (additionalProperties:false - ein
    alter Aufrufer, der sie sendet, wird abgelehnt), jede Typ-/enum-/anyOf-/Constraint-/
    additionalProperties-Aenderung, entferntes oder nicht mehr verpflichtendes Ausgabefeld,
    Ausgabe-Typwechsel, geaenderte Annotation-Hints, geaenderte securitySchemes, geaenderte oder
    entfernte Widget-URI, entfernte Resource-URI. `runbook` = Anker-Name des zustaendigen Abschnitts
    in `docs/RUNBOOK-MCP-UPDATE.md`.
  - `pruefeKette(vertrag)` -> Befundliste: `aenderungen` nicht leer; erster Eintrag `art:"erstfassung"`;
    jede `art` in `{erstfassung, additiv, bruch}`; `datum` ISO `JJJJ-MM-TT`; `begruendung` mindestens
    `MIN_BEGRUENDUNG_ZEICHEN` (benannte Konstante, z.B. 40) Zeichen; `stand_sha256` des LETZTEN
    Eintrags == `standSha256({profile, werkzeuge})` der Datei; zwei aufeinanderfolgende Eintraege
    tragen nie denselben Hash (Neu-Pinnen ohne Aenderung).
  - `fehlendeVeroeffentlichteUris(veroeffentlicht, lesbar)` -> URIs aus `veroeffentlichte_widget_uris`,
    die per resources/read nicht lesbar sind.
  - `runbookBefunde(text, exists)` -> backtick-Verweise auf `docs/ src/ test/ scripts/ package.json`,
    die nicht existieren; `npm run <x>`, das nicht in package.json `scripts` steht; interne Kennungen
    (Regex mindestens `\b(T2-\d+|T-\d+|OW-[A-Z0-9]+|H-\d+|[NOWX]-\d+)\b`).
- Datei: `test/mcp-vertrag-pruefung.js` (neu). Magic Numbers nur als benannte Konstanten; Funktionen
  kurz (<=3 Argumente, Tiefe <=2 angestrebt).
- IDs: T-33. Pfade: pfadunabhaengig (reine Logik).
- Beweis: (b) Schritt 3, Unit-Faelle mit Positiv-Kontrollen.

### Schritt 2 - Draht-Erfassung inkl. Ressourcen und Token-Pfad
- Was: `test/mcp-draht-pfade.js` ADDITIV erweitern (bestehende Exporte und `MCP_WIRE_PATHS` mit sieben
  Pfaden bleiben unveraendert - T2-16/T2-17 haengen daran):
  - Snapshot-Funktionen liefern optional zusaetzlich `resources` (resources/list) und die per
    resources/read lesbaren URIs; ohne Option byte-gleiches Verhalten fuer Bestandsaufrufer.
    Ausgestaltung (Optionsobjekt als zweites Argument, max. 3 Argumente) entscheidet der Bau.
  - neuer Export `tokenSnapshot(env)`: `MCP_AUTH=token`, `MCP_AUTH_TOKEN=<Fixture wie
    "t2-18-vertrag-probe">` (NICHT im Format echter Secrets), Anfrage ueber `srv.externalUrl` mit
    Bearer-Token (Interface-IP, damit nicht `isTrustedLocalCaller` den Auth-Pfad ueberspringt); ist
    `externalUrl` null, faellt die Messung auf `localUrl` MIT Token zurueck und der Testname/die
    Meldung sagt das (kein stilles Uebergehen).
- Datei: `test/mcp-draht-pfade.js:26-100` (httpSnapshot/legacySnapshot/oauthSnapshot/stdioSnapshot);
  Kopfkommentar `:1-6` nachziehen.
- IDs: T-33. Pfade: HTTP /mcp Legacy (localhost), HTTP Token/Legacy (Interface-IP), OAuth, stdio.
- Beweis: (b) T2-16/T2-17 unveraendert gruen (Positiv: `NODE_ENV=test node --test
  test/openai-t2-16-place-call-texte.test.js test/openai-t2-17-instructions-kern.test.js` -> 0 fail);
  Schritt 3 misst Ressourcen ueber diese Exporte.

### Schritt 3 - Vertragstest
- Was: neue Datei `test/mcp-kompatibilitaetsvertrag.test.js`. Testnamen beginnen mit
  "Kompatibilitaetsvertrag" (KEIN Katalog-Praefix `MCP-<Ziffer>` o.ae., sonst landet der Test in
  `test:gates`). Faelle:
  - U1 Klassifikation, je Klasse eine Positiv-Kontrolle an einer synthetischen Kopie des Vertrags-Stands:
    Werkzeug entfernt -> bruch; umbenannt -> bruch (+ additiv fuer den neuen Namen); neues Pflichtfeld
    -> bruch; bestehendes Feld wird Pflicht -> bruch; Typwechsel Eingabe -> bruch; optionale
    Eingabe-Eigenschaft entfernt -> bruch; enum verengt -> bruch; Ausgabefeld entfernt -> bruch;
    Annotation-Hint geaendert -> bruch; Widget-URI geaendert -> bruch; Resource-URI entfernt -> bruch;
    neue optionale Eingabe / neue Ausgabe-Eigenschaft / neues Werkzeug / neue Resource -> additiv;
    identischer Stand -> keine Befunde.
  - U2 Kette: die committete `docs/mcp-vertrag.json` hat 0 Ketten-Befunde; Positiv-Kontrollen: Stand
    geaendert ohne neuen Eintrag -> Befund; Eintrag mit zu kurzer Begruendung -> Befund; unbekannte
    `art` -> Befund; zwei Eintraege gleichen Hashes -> Befund.
  - U3 `fehlendeVeroeffentlichteUris`: Positiv-Kontrolle (gelistete, nicht lesbare URI -> Befund).
  - D1 Draht, je Profil ein Testfall (sequenziell): Stand am echten `tools/list`-/`resources/list`-Output
    == Vertrag. Profile (Ids stabil, im Vertrag gleich benannt):
    `http-legacy`, `http-legacy-consult`, `http-legacy-ui`, `http-token-interface-ip`,
    `http-oauth`, `http-oauth-consult`, `http-oauth-consult-ui`, `http-oauth-ohne-mandant`,
    `stdio`, `stdio-consult-env`, `stdio-ui`. Consult-Env = `CONSULT_ON` aus
    `test/mcp-draht-pfade.js:13`; UI = `MCP_UI_ENABLED: "true"`.
    Bei Abweichung: Meldung listet JEDEN Befund aus `klassifiziere(vertrag, draht)` mit Art, Merkmal,
    Werkzeug und `docs/RUNBOOK-MCP-UPDATE.md#<anker>`, schreibt den Ist-Stand samt `standSha256` in eine
    Datei unter `os.tmpdir()` und nennt deren Pfad (Inhalt nur Schemata/Namen/URIs - keine Daten,
    keine Secrets). Zusaetzlich wird geprueft: Nicht-UI-Profile tragen KEIN `_meta.ui`.
  - D2 Draht: jede URI aus `veroeffentlichte_widget_uris` ist auf JEDEM UI-Profil
    (`http-legacy-ui`, `http-oauth-consult-ui`, `stdio-ui`) per resources/read lesbar (heute leere
    Liste -> formal gruen; die Mechanik ist durch U3 belegt). Die Meldung verweist auf den
    Runbook-Abschnitt "Widget-URIs nach der Veroeffentlichung".
  - R1 Runbook: `runbookBefunde(docs/RUNBOOK-MCP-UPDATE.md)` == []; Positiv-Kontrolle: ein Text mit
    nicht existierendem Pfad, unbekanntem `npm run`-Skript und einer internen Kennung liefert je einen
    Befund.
  - Server-Hygiene: jeder gestartete Server/IdP/stdio-Client im `finally` beendet (die Harness-Funktionen
    tun das bereits).
- Datei: `test/mcp-kompatibilitaetsvertrag.test.js` (neu).
- IDs: T-33. Pfade: HTTP /mcp Legacy, HTTP Token (Interface-IP), OAuth (mit/ohne Consult, ohne Mandant,
  mit UI), stdio (ohne/mit Consult-Env, mit UI).
- Beweis: (b) `NODE_ENV=test node --test --test-name-pattern="Kompatibilitaetsvertrag" test/mcp-kompatibilitaetsvertrag.test.js > <log>`
  -> `# fail 0`. (c) Positiv-Kontrolle am ECHTEN Draht, nur im Worktree, danach `git checkout -- src/mcp-tools.js`:
  in `src/mcp-tools.js` bei `get_call_result` (Registrierung ab `:1900`) ein zusaetzliches
  Pflicht-Eingabefeld eintragen -> D1 wird auf ALLEN Profilen rot mit "bruch ... neues Pflichtfeld
  ... get_call_result ... RUNBOOK-MCP-UPDATE.md#..."; zweite Kontrolle: Werkzeug `cancel_call`
  auskommentiert -> rot "bruch ... Werkzeug entfernt". Danach `git diff --stat -- src/` leer.

### Schritt 4 - Vertragsdatei (Erstfassung aus dem Draht)
- Was: `docs/mcp-vertrag.json` erzeugen, AUSSCHLIESSLICH aus dem Ist-Stand, den D1 bei leerem Vertrag
  in die tmp-Datei schreibt (nie von Hand abtippen). Aufbau:
  `{ "_kommentar": <was, wozu, wie aendern -> Runbook>, "profile": {...}, "werkzeuge": {...},
  "veroeffentlichte_widget_uris": [], "aenderungen": [ { "datum": "2026-09-27", "art": "erstfassung",
  "begruendung": "...", "stand_sha256": "<Hash>" } ] }`. Keine Produktionswerte (die Datei enthaelt nur
  Test-Konfigurationsprofile; welcher Profil-Mix live gilt, bestimmt das Render-Dashboard, s. Owner-Punkt).
  `_kommentar` ohne interne Kennungen.
- Datei: `docs/mcp-vertrag.json` (neu).
- IDs: T-33. Pfade: alle elf Profile.
- Beweis: (b) U2 + D1 gruen; (c) `node -e 'const v=require("./docs/mcp-vertrag.json");console.log(Object.keys(v.profile).length, Object.keys(v.werkzeuge).length, v.aenderungen.length)'`
  -> `11 12 1`.

### Schritt 5 - Runbook
- Was: `docs/RUNBOOK-MCP-UPDATE.md` (Deutsch; internes Betriebsdokument - keine EN-Fassung). Keine
  internen Kennungen, keine Produktionswerte, nur existierende Dateien/Kommandos. Abschnitte (Anker
  = die in `klassifiziere` verwendeten):
  1. Zweck und Geltung: was der Vertrag sichert, was NICHT (Beschreibungen, Titel, server-instructions,
     `_meta`-Texte, CSP/`ui.domain` - Beschreibungen/instructions sind durch eigene Tests gepinnt; CSP
     ist laut OpenAI-Tabelle "reviewed with the tool definition", aber kein Kompatibilitaetsmerkmal).
  2. OpenAI-Regeln - NUR woertliche Zitate aus der Liste oben, jeweils mit URL und Abrufdatum 2026-09-27.
  3. Aenderungsklassen (Tabelle additiv/bruch aus Schritt 1) und Zuordnung zur OpenAI-Tabelle
     "Other changes": Inhalt eines Ergebnisses (z.B. weniger Transkript im Ergebnis bei gleichem
     Schema) = "Server-only fix or change to live tool results" (Zitat); Beschreibungsaenderung =
     "Changed tools" (Zitat) - kein Vertragsbruch, aber Scan/Review und vorher die Messung mit
     `node scripts/briefing-bench/lauf.mjs` (Aufruf aus `scripts/briefing-bench/README.md:42-44`).
  4. Ablauf bei rotem Vertragstest: Befund lesen -> Klasse -> Abschnitt; Ist-Stand aus der tmp-Datei
     uebernehmen; Eintrag anhaengen (Art, Begruendung, `stand_sha256`); Befehl
     `NODE_ENV=test node --test test/mcp-kompatibilitaetsvertrag.test.js`.
  5. Vor der Veroeffentlichung: Brueche zulaessig, wenn eine Anforderung sie verlangt, immer mit
     Eintrag und mit ALLEN Aufrufern/Tests/Doku; danach im Dashboard erneut "Scan Tools" (Zitat
     "select **Scan Tools** again" nur, wenn woertlich uebernommen) und Developer-Mode-Verbindung
     aktualisieren (Zitat mcp-server).
  6. Nach der Veroeffentlichung - gehaltene Updates: die alte Definition bleibt lauffaehig (Zitat).
     Deshalb kein Umbenennen und kein neues Pflichtfeld an einem veroeffentlichten Werkzeug; statt dessen
     neues Werkzeug/optionales Feld, altes erst entfernen, wenn die neue Definition live ist (Begruendung
     aus den Zitaten "Deleted tools ... removed ... as soon as a scan detects" und "New tools: Made
     available after they pass automated checks"). Rollback statt Warten (Zitat).
  7. Widget-URIs nach der Veroeffentlichung: `veroeffentlichte_widget_uris` bei Veroeffentlichung mit den
     dann live referenzierten URIs fuellen; ab dann haelt D2 jede dieser URIs lesbar. HEUTIGER
     CODE-STAND ehrlich: der Server liefert nur die hoechste Version aus
     (`src/ui/contract.js`, `src/ui/widget-catalog.js`); `src/ui/widget-versions.json` verlangt fuer JEDE
     Byte-Aenderung eine neue Version. Vor dem ersten Versionssprung nach der Veroeffentlichung muss
     also das Weiter-Ausliefern alter URIs gebaut werden - D2 wird sonst rot. Cache-Zitat
     ("up to one hour").
  8. Was einen neuen Plugin-/Versionsvorgang braucht (Zitate Origin, "submitted plugin information or
     imported skills", "only one version ... in review").
  9. UNKNOWN (je mit Grund "in der Primaerquelle nicht geregelt"): wie lange ein gehaltenes Update
     gehalten wird; welche "automated checks" laufen; ob ein Bruch am outputSchema anders behandelt wird
     als am inputSchema (die Quelle sagt nur "schemas"); ob OpenAI eine geaenderte securitySchemes-Angabe
     haelt oder sofort uebernimmt (Tabelle sagt "reviewed ... through continuous review", Zeitpunkt
     "After the updated tool definition passes automated checks" - nur das zitieren); ob eine entfernte
     Resource-URI von OpenAI erkannt wird.
  10. Pfade/Schalter, die die Werkzeugliste veraendern, je mit Code-Stelle: `MCP_UI_ENABLED`
      (`src/config.js:1645`), Consult (`src/consult/gate.js:19-25`), `MCP_AUTH`
      (`src/config.js:2072`), stdio ohne Consult (`src/mcp-tools.js:1513`).
- Datei: `docs/RUNBOOK-MCP-UPDATE.md` (neu).
- IDs: T-33. Pfade: dokumentiert alle.
- Beweis: (b) R1 gruen. (c) Zitat-Check:
  `curl -sSL https://developers.openai.com/plugins/llms-full.txt | tr -s ' \n' ' ' > /tmp/oa.txt`, dann
  jedes in Anfuehrungszeichen gesetzte Englisch-Zitat des Runbooks (Whitespace normalisiert, Markdown-
  Sternchen entfernt) mit `grep -F -c` suchen -> je >= 1. Jede Code-Stelle im Runbook per `sed -n` an der
  genannten Zeile nachsehen.

### Schritt 6 - Kommentar-Nachzug an der Harness
- Was: Kopfkommentar `test/mcp-draht-pfade.js:1-6` und der Kommentar vor `MCP_WIRE_PATHS` (`:101`)
  nennen die neue Ressourcen-/Token-Erfassung und den Vertragstest als Verbraucher.
- Datei: `test/mcp-draht-pfade.js`.
- IDs: T-33. Pfade: -.
- Beweis: (a) Kommentarzeilen an den genannten Stellen.

### Schritt 7 - Hinweis in der Widget-Pin-Datei (klein, empfohlen)
- Was: `_comment` in `src/ui/widget-versions.json` um EINEN Satz ergaenzen: nach der Veroeffentlichung
  muss eine gebumpte Widget-URI laut `docs/RUNBOOK-MCP-UPDATE.md` weiter ausgeliefert werden, der
  Vertragstest verlangt dafuer einen Ketten-Eintrag. Keine Hash-/Versionsaenderung (`_comment` wird von
  `loadPins`/`widgetVersion` uebersprungen, ist kein ausgeliefertes Widget-Byte).
- Datei: `src/ui/widget-versions.json:2`.
- IDs: T-33. Pfade: UI (alle Transporte).
- Beweis: (b) `test/openai-t2-02-widget-uris.test.js` gruen, D1 gruen (URIs unveraendert); (c)
  `git diff master -- src/ | grep '^[+-]' | grep -v '^[+-]\{3\}'` zeigt nur die `_comment`-Zeile.

### Schritt 8 - Gesamtverifikation
- `git -C <wt> diff --stat master -- src/` -> hoechstens `src/ui/widget-versions.json` (1 Zeile).
- tools/list und initialize byte-gleich master: bestehende Text-Pins gruen
  (`test/openai-t2-16-place-call-texte.test.js`, `test/openai-t2-17-instructions-kern.test.js`,
  `test/openai-p10a-tool-inventar.test.js`, `test/mcp-tool-annotations.test.js`).
- Lint: `npx eslint test/mcp-vertrag-pruefung.js test/mcp-kompatibilitaetsvertrag.test.js test/mcp-draht-pfade.js`
  -> 0 Befunde; `eslint-legacy-exceptions.json` unveraendert (`git diff --stat master -- eslint-legacy-exceptions.json` leer).
- Suite: `npm test -- -- --test-concurrency=4 > <logs>/npm-test.log 2>&1`; nur `# pass`/`# fail` zaehlen;
  ein roter Test zaehlt erst, wenn isoliert erneut rot.
- Danach `ps -ax -o pid,command | grep -E "src/server.js|mcp-server.js" | grep -v grep` -> leer.
- Keine neue Env-Variable -> kein Vier-Orte-Schritt.

## Tests: was bricht, was beweist
- Bricht: nichts erwartet (keine Aenderung an `src/` ausser `_comment`; Harness nur additiv).
- Beweist: U1 (Klassifikation, 15+ Positiv-Kontrollen), U2 (Kette gegen stumpfes Neu-Pinnen), U3
  (veroeffentlichte URIs), D1 (elf Profile am echten Draht), D2 (veroeffentlichte URIs am Draht lesbar),
  R1 (Runbook-Verweise/Kennungen). Laufzeit: elf Server-/stdio-Starts sequenziell (Groessenordnung wie
  T2-17).

## Nicht bauen (je mit Grund)
- Ausliefern alter Widget-Versionen (Mehrversions-HTML): heute ist nichts veroeffentlicht, es gibt keine
  live referenzierte alte URI; alte HTML-Staende liegen nicht vor (nur Hashes). Das waere spekulativ.
  Der Vertrag erzwingt es ab Veroeffentlichung (D2 + Runbook Abschnitt 7).
- Aenderung der Versionierungsregel aus `src/ui/widget-versions.json` (jede Byte-Aenderung = neue
  Version): strenger als OpenAI verlangt, aber nicht Teil von T-33 vor Veroeffentlichung; die Spannung
  steht im Runbook und in "widersprueche".
- Werkzeugtexte, Beschreibungen, server-instructions, Annotation-Werte: in dieser Phase verboten
  (byte-gleich master, Bench scheitert am Anbieterguthaben).
- Beschreibungen/Titel/instructions/_meta-Texte/CSP im Vertrag: kein Kompatibilitaetsmerkmal, anderweitig
  gepinnt bzw. von OpenAI als Review-Metadaten behandelt; sie zu pinnen haette die Folgephase
  (`list_action_items`-Beschreibung) ohne Kompatibilitaetsgrund blockiert.
- Generator-Skript fuer den Vertrag: der Test schreibt den Ist-Stand samt Hash selbst in eine tmp-Datei;
  ein zweites Werkzeug waere doppelte Logik.
- `MCP_WIRE_PATHS` erweitern: T2-16/T2-17 zaehlen darauf (sieben Pfade); der Vertragstest fuehrt eigene
  Profile.
- EN-Fassung des Runbooks: internes Betriebsdokument (Plan: `dokumentFuerOpenAI: nein`).
- `PLAN-SECURITY.md`: keine sicherheitsrelevante Aenderung (kein Gate, keine Auth, kein Endpunkt).
- render.yaml, Sprachagent, `src/claude.js`, Prompts, ElevenLabs-/Telnyx-Template, Offenlegungssatz,
  Safety-Gates: unangetastet.

## Pre-Mortem (ein Jahr spaeter war die Phase ein Fehler - was ist passiert?)
1. Der Vertrag wird bei jeder Aenderung stumpf neu gepinnt und schuetzt nichts. -> Kette mit
   `stand_sha256` + Pflicht-Begruendung + Verbot gleicher Hashes (U2); Rest-Risiko: Floskel-Begruendung
   - bleibt Review-Sache im Diff (akzeptiert).
2. Nach der Veroeffentlichung wird ein Widget geaendert, die Version springt, die alte URI verschwindet;
   OpenAI haelt das Update, die live Definition zeigt auf eine nicht mehr lesbare URI -> Karte bricht,
   ChatGPT cached bis zu einer Stunde. -> D2 an `veroeffentlichte_widget_uris`, Runbook-Abschnitt 7,
   Hinweis in `widget-versions.json`. Rest-Risiko: niemand fuellt die Liste bei Veroeffentlichung ->
   Runbook-Pflichtschritt; offen als Launch-Checkpunkt.
3. Der Test prueft ein Registrierungsobjekt statt des Drahts und bleibt gruen, waehrend das SDK Felder
   verwirft. -> ausschliesslich `tools/list`/`resources/list`/`resources/read` ueber HTTP und stdio;
   Positiv-Kontrolle am echten Draht (Schritt 3c).
4. Ein Pfad driftet (z.B. stdio oder "ohne Mandant" meldet ein anderes Pflichtfeld) und nur OAuth ist
   gepinnt. -> elf Profile + `standAusDraht` wirft bei Pfad-Divergenz.
5. Die Klassifikation stuft einen Bruch als additiv ein (verengtes enum, entfernte optionale Eingabe bei
   `additionalProperties:false`) und das Runbook laesst ihn "einfach deployen". -> fail-closed: additiv
   nur fuer die fuenf explizit genannten Faelle; jede Abweichung ist ohnehin rot.
6. Das Runbook behauptet aus Plausibilitaet, was OpenAI verlangt (z.B. "Umbenennen braucht neue
   Einreichung"). -> nur woertliche Zitate mit URL+Abrufdatum, Zitat-Check per `grep -F`; Ungeregeltes
   als UNKNOWN.
7. Das Runbook widerspricht dem Code (Env-Namen, Pfade). -> jede Code-Stelle belegt, R1 prueft
   Existenz von Dateien und `npm run`-Skripten.
8. Produktionswerte landen im Repo (welches Profil live gilt). -> der Vertrag nennt nur Test-Profile;
   welche Kombination live ist, misst der Owner im Developer Mode.
9. Der Draht-Test ist flaky/langsam und wird uebersprungen. -> sequenziell, Harness mit
   Eltern-Waechter, Server im `finally` beendet; externalUrl-null-Fall ausdruecklich behandelt statt
   `skip`.
10. Die Folgephase wird unnoetig blockiert oder ein echter Bruch rutscht durch: Inhaltsaenderung bei
    gleichem Schema -> gruen (richtig laut "Server-only ... change to live tool results"); entferntes
    `last_transcript_lines` -> rot "bruch" (richtig: Ausgabe-Vertrag).
11. Ungewollter Anruf, Kosten, Transkript-Leak, Auth-Loch: die Phase fuehrt keinen Werkzeugaufruf aus
    (nur tools/list/resources), aendert keinen Handler und kein Gate; die tmp-Datei enthaelt nur
    Schemata und URIs. Beleg: `git diff --stat master -- src/`.

## Widersprueche
- Plan T2-18: "Letzte Code-Phase (nach allen Breaking Changes)" - laut Lead folgt eine Phase, die
  Werkzeug-Ausgaben aendert. Aufgeloest: Vertrag als geregelter Aenderungsvorgang, nicht als Einfrieren.
- Plan: "dokumentFuerOpenAI: nein" vs. Auftragsvorlage "DIESE PHASE SCHREIBT EIN DOKUMENT, DAS AN OPENAI
  GEHT". Aufgeloest: Runbook ist intern (keine EN-Fassung), aber mit derselben Strenge (woertliche
  Zitate, keine internen Kennungen, jede Aussage am Code).
- Plan-Runbookpunkt "Widget-URI bei Bruch neu versionieren und alte weiter ausliefern": der Code liefert
  nur die hoechste Version aus (`src/ui/contract.js:28`, `src/ui/widget-catalog.js:172`,
  `src/mcp-tools.js:1556-1562`); eine aeltere URI ist nach dem Sprung nicht lesbar. Zudem verlangt
  `src/ui/widget-versions.json` fuer JEDE Byte-Aenderung (auch Kommentare) eine neue Version, OpenAI nur
  "in a way that could break a cached component" - nach der Veroeffentlichung wird so jede
  Widget-Aenderung zu einem gehaltenen Tool-Update mit verschwundener alter URI. Nicht in dieser Phase
  geloest (nichts veroeffentlicht), erzwungen ueber D2 + Runbook.
- Lead: "Werkzeuge 10 (stdio) bzw. 12 (HTTP mit Consult)" - praezisiert: HTTP ohne Consult ebenfalls 10;
  Consult braucht `CONSULT_ENABLED` + `ASSISTANT_CONTEXT_ENABLED` + Profil `allowConsult`.
- Plan-Ziel nennt "outputSchema-Felder" fuer alle Werkzeuge - `cancel_call` und `list_action_items`
  haben keins; Vertrag pinnt dort "kein outputSchema" (nachtraegliches Hinzufuegen = additiv).
- `test/mcp-draht-pfade.js` (`MCP_WIRE_PATHS`) deckt weder `MCP_UI_ENABLED=true` noch Token-Modus ueber
  die Interface-IP noch Ressourcen ab - der Vertragstest ergaenzt diese Profile.
- Plan-Primaerquellen-Zitate: beide woertlich bestaetigt (kein Widerspruch).

## Owner-Punkte (nur nach OWNER-REGEL)
1. Messung im ChatGPT Developer Mode (keine Deploy-Vorbedingung): nach dem naechsten Deploy den
   Hermes-Connector im Developer Mode aktualisieren und Werkzeugnamen, Pflichtfelder und Widget-URIs
   mit dem Profil `http-oauth-consult-ui` (bzw. `http-oauth` / `http-oauth-consult`, je nach
   Live-Schaltern) in `docs/mcp-vertrag.json` vergleichen. Erwartet: exakt ein Profil stimmt ueberein.
   Stimmt keines, ist die Live-Konfiguration ein Pfad, den der Vertrag nicht abdeckt -> Profil ergaenzen.

Keine Deploy-Vorbedingung (keine Laufzeitaenderung).
