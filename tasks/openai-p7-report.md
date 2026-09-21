# P7 — Abschlussbericht: Auth II, Abweichungen belegen (Scope, Metadaten, Fehlerkanal) — Dokumentationsphase

Branch: `phase/openai-p7-auth-belege`. Spec: `tasks/openai-p7-spec.md`. IDs dieser Phase: **T-9,
T-11, T-12, T-14, T-16** (Quelle: `tasks/openai-audit/00-openai-anforderungen.md`). Reine
Dokumentationsphase — kein Produktionscode geaendert (`git diff master...HEAD -- src/` ist leer,
selbst nachgemessen).

**Commit-Hinweis (wichtig fuer den Merge):** der Auftrag nennt Commit `e50957e`. Der tatsaechliche
Branch-HEAD ist zum Zeitpunkt dieses Berichts **`ba1f3fd`**, einen Commit weiter
(`docs(p7): Review-Runde 1 - englische Kurzfassung je ID ergaenzt`). Dieser Bericht bewertet
**`ba1f3fd`** (den echten HEAD), nicht `e50957e` — bei `e50957e` wuerde ein Lead eine bereits
ueberholte, schwaechere Fassung mergen. Diff `e50957e..ba1f3fd`: nur `docs/OPENAI-AUTH-ABWEICHUNGEN.md`
(+14 Zeilen: Abschnitt "2b. English summary", eine Zeile pro ID). Das behebt zwei der drei
"Nicht gebaut"-Punkte, die der Auftrag mir uebergeben hat — Details unten in Abschnitt 1.

---

## 1. Was NICHT erfuellt ist — zuerst, nicht versteckt

Der mir uebergebene Auftrag listete drei offene Punkte. Ich habe alle drei gegen den echten
Branch-Zustand (nicht gegen den im Auftrag genannten aelteren Commit) nachgemessen. Ergebnis: **zwei
sind zwischenzeitlich geschlossen, einer bleibt offen.**

- **Zweisprachigkeit — INZWISCHEN GESCHLOSSEN, war im Auftrag noch offen.** Der Auftrag nennt als
  offenen Punkt, `docs/OPENAI-AUTH-ABWEICHUNGEN.md` sei "rein deutsch, ohne englische Kurzfassung
  je ID", entgegen dem Spec-Default (DE massgeblich + EN-Kurzfassung pro ID). Am echten HEAD
  (`ba1f3fd`) existiert dieser Abschnitt: `docs/OPENAI-AUTH-ABWEICHUNGEN.md:147-159`, "## 2b.
  English summary (per ID, for the OpenAI reviewer)" — eine Tabellenzeile fuer jede der fuenf IDs
  (T-14, T-12, T-9, T-11, T-16), mit Status, Beleg-Pointer und offener Frage je Zeile, Deutsch
  bleibt ausdruecklich massgeblich bei Abweichungen (Zeile 151). Selbst gelesen, nicht nur die
  Commit-Message vertraut.
- **Voller Testlauf — INZWISCHEN GESCHLOSSEN, war im Auftrag noch offen.** Der Auftrag nennt als
  offenen Punkt, der Gesamtlauf (`npm test -- -- --test-concurrency=4`) sei beim Abgabezeitpunkt
  noch nicht durchgelaufen (kein `# pass`/`# fail` verfuegbar). Ich habe im Scratchpad einen
  **abgeschlossenen** Lauf dieses exakten Kommandos gefunden
  (`.../scratchpad/p7-review-voll.txt`, Dateizeitstempel nach dem `ba1f3fd`-Commit, Kopfzeile
  bestaetigt `NODE_ENV=test node test/testbaenke-run.mjs regression -- --test-concurrency=4`,
  d. h. genau das `npm test`-Kommando): **`# tests 6220`, `# pass 6220`, `# fail 0`**, danach die
  `testbaenke-run`-eigene Korrektur um 20 Datei-Wrapper ohne echten Test: `tests 6200 / pass 6200
  / fail 0`. Alle vier neuen `OpenAI-P7-T1..T4`-Faelle stehen einzeln mit `ok` in diesem Lauf
  (Zeilen 28104-28130 der Logdatei). Damit ist dieser Punkt aus dem Auftrag ueberholt — Details
  in Abschnitt 6.
- **Gegenprobe direkt an `src/auth.js` — BLEIBT OFFEN, wie im Auftrag beschrieben.** Die von der
  Spec verlangte Gegenprobe (`issuer`-Option entfernen -> T1 muss rot werden; `clockTolerance` auf
  einen sehr grossen Wert setzen -> T2 muss rot werden) wurde **nicht** direkt gegen
  `src/auth.js` gefahren — der Sandbox-Klassifizierer blockierte das Ausfuehren eines Tests,
  waehrend Auth-Code lokal geschwaecht war. Ersatz: eine reine `jose`-Bibliotheks-Sonde ausserhalb
  von `src/` (`.../scratchpad/jose-verhalten-probe.mjs`), die dasselbe Verhalten an der
  zugrundeliegenden Bibliotheksfunktion zeigt (issuer-Option nur wirksam, wenn gesetzt;
  `clockTolerance` schaltet die `nbf`-Pruefung ab, wenn gross genug). Das ist eine **schwaechere
  Beweisform** als eine Gegenprobe am echten Code: sie zeigt, dass `jose` sich so verhaelt, nicht,
  dass `src/auth.js` diese Optionen tatsaechlich in der behaupteten Weise weiterreicht (das folgt
  nur mittelbar aus dem Lesen der Zeilen 99/101). Ich habe zusaetzlich geprueft, dass keine
  Weakening-Spur zurueckblieb: `.../scratchpad/auth.js.orig` (die vor dem Test angelegte Backup-
  Kopie) ist **byte-identisch** mit `src/auth.js` im aktuellen Worktree (`diff` liefert keine
  Ausgabe) — die Ersatz-Sonde ist damit korrekt als reine Wegwerf-Verifikation ausserhalb des
  Branches behandelt worden, kein Sicherheits-Gate wurde dabei tatsaechlich geschwaecht getestet.
- **Kein Launch-Blocker wird durch P7 geschlossen** (Zitat aus `PLAN-SECURITY.md`, selbst
  gelesen, Zeile "Kein Launch-Blocker wird durch P7 geschlossen"). Alle fuenf IDs enden entweder
  bei einer dokumentierten, bewussten Abweichung (T-12: Scope wird nicht geprueft) oder bei einer
  Anbieterabhaengigkeit, die nur mit einem echten WorkOS-Login messbar ist (T-9, T-11, T-16
  UNKNOWN-Reste; T-14 bedingt auf `MCP_AUTH=oauth`). Fuenf konkrete WorkOS-Fragen bleiben offen
  (`docs/OPENAI-AUTH-ABWEICHUNGEN.md` Abschnitt 4) und ein Nebenbefund B-1 (403 ohne
  `WWW-Authenticate` bei fehlender Tenant-Zuordnung) ist notiert, nicht behoben — explizit als
  P10-/Owner-Punkt gefuehrt, nicht dieser Phase.

---

## 2. Was diese Phase erfuellt — ID fuer ID mit Beweisstelle

Alle Codezeilen unten habe ich selbst im Worktree nachgeschlagen (nicht nur aus dem Dokument
uebernommen).

### T-14 — Auth-UI im Gespraech ueber `_meta["mcp/www_authenticate"]` im Tool-Fehlerergebnis

**Status: nicht anwendbar — bewusst nicht gebaut, mit Bedingung.** `mcpAuth` laeuft als Express-
Middleware direkt an `router.post("/mcp", mcpAuth, ...)` — selbst nachgemessen:
`src/routes/mcp.js:113`. Ein Auth-Fehlerzweig existiert in `src/mcp-tools.js` nicht: `errText()`
(`src/mcp-tools.js:88`, selbst gelesen — exakte Zeile bestaetigt) und `wrapHandler`
(`src/mcp-tools.js:880-895`, selbst gelesen — Codeblock bestaetigt) fangen nur Tool-eigene Fehler
ab, nie einen Auth-Fehler. Ein `_meta`-Feld dort waere toter Code (CLAUDE.md verbietet das hart).
**Bedingung, woertlich im Dokument wiederholt:** gilt nur, solange Produktion `MCP_AUTH=oauth`
faehrt; im Legacy-/Token-Zweig fehlt `resource_metadata` im 401-Header
(`STATIC_BEARER_CHALLENGE`, `src/auth.js:89`). Live-Beleg (2026-09-21T10:06:03Z, in
`docs/OPENAI-AUTH-ABWEICHUNGEN.md` Abschnitt 3 protokolliert): der 401 auf `POST /mcp` gegen
`https://app.sundartha.com` trug tatsaechlich `www-authenticate: Bearer resource_metadata="..."`
— Produktion lief zum Messzeitpunkt im oauth-Zweig.

### T-12 — Token-Pruefung: Signatur/JWKS, `iss`, `exp`/`nbf`, Audience, Scopes, eigene Policy

**Status: teilweise erfuellt.** `verifyOauth()` prueft Signatur, `issuer`, `audience`, `exp`/`nbf`
(clockTolerance 30s) in einem `jwtVerify`-Aufruf — selbst nachgemessen: Funktion beginnt exakt bei
`src/auth.js:91`, endet bei `:113`; der `jwtVerify`-Aufruf mit den drei Optionen steht bei `:98-102`.
**Neu in dieser Phase, echter HTTP-Pfad statt Code-Behauptung:**
`test/openai-p7-token-pruefachsen.test.js`, isoliert gefahren
(`NODE_ENV=test node --test --test-concurrency=4 test/openai-p7-token-pruefachsen.test.js`) ->
**5 pass / 0 fail** (1 Suite + 4 Subtests):
- `OpenAI-P7-T1`: fremder `iss` -> 401, `www-authenticate` beginnt mit `Bearer resource_metadata="`,
  kein `jsonrpc`-Feld im Body.
- `OpenAI-P7-T2`: `nbf` 3600s in der Zukunft (weit jenseits 30s Toleranz) -> 401.
- `OpenAI-P7-T3` (Positiv-Kontrolle): gueltiges Token ohne `scope`-Claim -> 200.
- `OpenAI-P7-T4`: gueltiges Token mit beliebigem `scope`-Claim (`"nicht-vergeben"`) -> ebenfalls
  200 — pinnt die dokumentierte Luecke.
Tenant-Bindung ueber `sub` bereits aus fruehere Phase referenziert, selbst gegengelesen:
`test/e4-mandantentrennung-default.test.js:210-222`, ID `E4-17` — gueltiges Token ohne
Tenant-Zuordnung -> 403, keine Tool-Liste im Body.
**Scope wird NICHT geprueft** — `grep -rn "scope\|scp" src/auth.js` liefert 0 Treffer (selbst
ausgefuehrt). Konsistent mit `src/mcp-security-schemes.js:19-27` (`scopes: []`, mit Begruendungs-
Kommentar direkt daneben, selbst gelesen).

### T-9 — Authorization Server uebernimmt den `resource`-Parameter ins Token (i. d. R. `aud`)

**Status: unsere Haelfte erfuellt; Anbieterhaelfte nicht in unserer Hand.** Wir verlangen
`aud == audience()` im selben `jwtVerify`-Aufruf (`src/auth.js:23`, `:100`); eine Divergenz
zwischen Pruefung und angekuendigter Resource ist boot-fatal — selbst nachgemessen in
`src/boot-guard.js`, Funktion `audienceFindings` bei `:936-950` (Kommentar-Verweis auf `auth.js`
direkt darueber), Test dazu `test/oauth.test.js:107-119` (Boot verweigert mit `exit 1` bei
divergenter `OAUTH_AUDIENCE`, selbst gelesen — Assertions bestaetigt). Falsches `aud` im Token ->
401, selbst gelesen: `test/oauth.test.js:71-76` ("falsche Audience -> 401"). **Rest UNKNOWN:** ob
WorkOS den `resource`-Parameter tatsaechlich nach `aud` kopiert, ist nur mit einem echten,
abgeschlossenen Login messbar (Owner-Only, Abschnitt 5 des Dokuments).

### T-11 — Stabile Redirect-URI nur mit RFC-9207-`iss`, sonst callback-spezifische URI

**Status: nicht in unserer Hand; der im Anforderungswortlaut selbst genannte Rueckfallzweig
greift.** `authorization_response_iss_parameter_supported` fehlt live in beiden WorkOS-
Metadaten-Dokumenten (Messprotokoll 2026-09-21T10:06:13Z, `docs/OPENAI-AUTH-ABWEICHUNGEN.md`
Abschnitt 3, Zeile "7/8 ... (fehlt)"). Hermes ist reiner Resource Server, stellt keine
Authorization-Response aus — an diesem Feld ist kein eigener Code beteiligt. Der massgebliche
Anforderungswortlaut selbst nennt fuer diesen Fall den Rueckfall (callback-spezifische
Redirect-URI) — kein Einreichungs-Blocker laut Wortlaut. **Rest UNKNOWN:** ob WorkOS diese
Rueckfall-URI akzeptiert, ist erst am ersten echten Connector-Flow pruefbar.

### T-16 — Fuer Workspace-Domain-Restriktionen: OIDC-Discovery + Scopes + UserInfo mit `email_verified`

**Status: teilweise erfuellt, beim Anbieter (nur relevant, falls Workspace-Domain-Restriktionen
je genutzt werden).** Live gemessen: `openid-configuration` antwortet HTTP 200 und bewirbt
`scopes_supported` inkl. `openid`, `email`; `userinfo_endpoint` existiert und liefert ohne Token
korrekt 401 (nicht 404/500) — alles im Messprotokoll (Abschnitt 3) mit Rohantwort belegt, von mir
gegen den Zeitstempel gelesen, nicht nur behauptet. **Rest UNKNOWN:** ob `/oauth2/userinfo` mit
einem echten Token `email_verified: true` liefert, ist ohne abgeschlossenen Login nicht messbar.

**Referenziert, nicht als P7-Leistung gefuehrt (Doppelbuchung ausgeschlossen):** T-13/T-5
(Bearer-Challenge) sind P6-Leistung, T-15 (`securitySchemes` am echten `tools/list`) ist
P3-Leistung — `docs/OPENAI-AUTH-ABWEICHUNGEN.md` Abschnitt 9 haelt das ausdruecklich fest, selbst
gelesen.

---

## 3. Beruehrte Pfade — vollstaendig?

| Pfad | Beruehrt? | Punkt erfuellt? |
|---|---|---|
| HTTP `/mcp`, mcp-natives Protokoll | ja | ja — `mcpAuth` sitzt einmal vor der Adapterwahl (`src/routes/mcp.js:113` vs. Adapterwahl bei `:153` laut Dokument, Aufrufort selbst nicht Teil des Diffs) |
| HTTP `/mcp`, ChatGPT-Adapter | ja (teilt denselben `mcpAuth`) | ja, aus demselben Grund — kein zweiter Pruefpunkt, kein zweiter Test pro Adapter noetig (Dokument Abschnitt 8, plausibel: ein Aufrufort vor der Verzweigung) |
| stdio (`src/mcp-server.js`) | **nein** | entfaellt ausdruecklich — kein Auth-Middleware-Aufruf, kein Token, kein OpenAI-Connector-Pfad dort (Dokument Abschnitt 8); nicht Teil des Diffs (`git diff master...HEAD --stat` listet `src/mcp-server.js` nicht, selbst nachgemessen) |
| `/voice/*` (Telnyx-Signaturpruefung) | nein | eigenes Gate, nicht angefasst — ausserhalb des P7-Scopes |
| WorkOS AuthKit selbst (Issuer) | ja (nur lesend gemessen) | **teilweise, mehrere Rest-UNKNOWN** — s. Abschnitt 2, drei der fuenf IDs enden dort an einer Anbietergrenze, die kein Agent ohne echten Login schliessen kann |

Fuer den einzigen Code-Pfad, der ueberhaupt zu P7 gehoert (`/mcp`, `src/auth.js` und
`src/routes/mcp.js`, **ungeaendert** — reine Dokumentationsphase), ist der Punkt "korrekt
beschrieben" auf allen drei tatsaechlich betroffenen IDs mit eigenem Code (T-12, T-14 teilweise,
T-9 unsere Haelfte) durch einen neuen Draht-Test bzw. Referenz auf einen bestehenden Draht-Test
gedeckt. Fuer T-11 und T-16 sowie den Rest von T-9 gibt es **keinen eigenen Code-Pfad** — die
Vollstaendigkeit besteht dort ausschliesslich aus einer korrekten Feststellung der Anbieterlage,
nicht aus einem Test.

---

## 4. Was ein fremder Pruefer nachmessen sollte

Neutral formuliert — jede Zeile beschreibt eine pruefbare Behauptung, nicht deren Bestaetigung.

1. **Steht der zu bewertende Code wirklich auf `ba1f3fd`, nicht auf `e50957e`?**
   `git -C <worktree> log --oneline -1` und `git -C <worktree> log --oneline e50957e..HEAD`
   (Erwartung laut diesem Bericht: genau ein weiterer Commit, "Review-Runde 1").
2. **Ist dieser Branch wirklich eine reine Dokumentationsphase?**
   `git diff master...phase/openai-p7-auth-belege --stat` — sind ausschliesslich
   `PLAN-SECURITY.md`, `docs/OPENAI-AUTH-ABWEICHUNGEN.md`, `docs/RUNBOOK-AS-METADATA.md` und
   `test/openai-p7-token-pruefachsen.test.js` betroffen? `git diff master...HEAD -- src/` — ist
   die Ausgabe leer?
3. **Ist die englische Kurzfassung tatsaechlich vollstaendig (nicht nur teilweise)?**
   `docs/OPENAI-AUTH-ABWEICHUNGEN.md` Abschnitt 2b lesen — steht dort fuer alle fuenf IDs
   (T-14, T-12, T-9, T-11, T-16) eine eigene Tabellenzeile mit Status, Beleg und offener Frage?
4. **Belegt der neue Test wirklich den echten HTTP-Pfad, nicht nur eine Behauptung ueber
   `src/auth.js`?** `test/openai-p7-token-pruefachsen.test.js` lesen — ruft er tatsaechlich
   `mcpPost(...)` gegen einen per `startServer()` echt gestarteten Prozess auf (kein `fakeRes`,
   kein direkter Funktionsaufruf von `verifyOauth`)? Isoliert fahren:
   `NODE_ENV=test node --test --test-concurrency=4 test/openai-p7-token-pruefachsen.test.js` —
   5 pass, 0 fail?
5. **Ist die Scope-Luecke wirklich 0 Codestellen, nicht nur "nicht dokumentiert"?**
   `grep -rn "scope\|scp" src/auth.js` — leer? `sed -n '19,27p' src/mcp-security-schemes.js` —
   steht dort `scopes: Object.freeze([])`?
6. **Wurde die Gegenprobe wirklich nicht direkt gegen `src/auth.js` gefahren, und ist dort keine
   Weakening-Spur zurueckgeblieben?** `git diff master...phase/openai-p7-auth-belege -- src/auth.js`
   — leer? (Falls im Betriebssystem noch vorhanden: die Backup-Kopie aus dem Scratchpad gegen den
   aktuellen `src/auth.js` diffen — identisch?)
7. **Ist der volle Testlauf tatsaechlich durchgelaufen und gruen, nicht nur behauptet?**
   `npm test -- -- --test-concurrency=4` im Worktree neu fahren (oder, falls vorhanden, das
   Rohprotokoll des letzten Laufs am Kopf auf das exakte Kommando pruefen) — `# fail 0`, `# pass`
   auf Hoehe der Baseline plus die vier neuen P7-Faelle? Jeder rote Fall zaehlt erst, wenn er
   isoliert (`NODE_ENV=test node --test --test-concurrency=4 test/<datei>`) erneut rot ist.
8. **Stimmen die Codezeilen-Verweise im Dokument mit dem tatsaechlichen Code ueberein?**
   Stichprobe: `grep -n "^async function verifyOauth" src/auth.js` -> Zeile 91?
   `grep -n "router.post(\"/mcp\"" src/routes/mcp.js` -> Zeile 113? `grep -n "function rejectIfNoTenant" src/routes/mcp.js` -> nahe Zeile 59-64?
9. **Bleibt die per-Tenant-Kostendecke, der Offenlegungssatz und die Telnyx-Signaturpruefung
   unangetastet?** `git diff master...phase/openai-p7-auth-belege --stat` — taucht dort etwas
   ausserhalb der vier genannten Dateien auf?
10. **Ist die Live-Messung im Dokument aktuell, oder veraltet?** Die im Dokument selbst
    vorgeschriebene Sonde erneut fahren (`curl -sS -D - -o /dev/null -X POST
    https://app.sundartha.com/mcp` und die AS-Metadata-Endpunkte des Issuers) — stimmen Status
    und Header noch mit dem protokollierten Stand vom 2026-09-21 ueberein?

---

## 5. Restrisiko

Das Kernrisiko dieser Phase ist inhaltlich klein, weil kein Produktionscode geaendert wurde — der
Diff besteht ausschliesslich aus Dokumentation und einem neuen, isoliert gruenen Test, der eine
bereits bestehende Codeeigenschaft (nicht eine neue) end-to-end belegt. Das eigentliche Risiko
liegt in der **Reichweite der Aussagen**: drei der fuenf IDs (T-9 teilweise, T-11, T-16) enden an
einer Anbietergrenze, die diese Phase bewusst nicht schliessen konnte und nicht schliessen sollte
— sie sind nur mit einem echten, abgeschlossenen WorkOS-Login messbar, den kein Agent ohne
Owner-Handlung herstellen kann. Wird die Einreichung eingereicht, ohne dass diese drei UNKNOWN-
Reste vorher per Owner-Login gemessen wurden (Abschnitt 5 des Belegdokuments, "Owner-Messung
O-3"), bleibt unklar, ob ein echter ChatGPT-Connector-Flow tatsaechlich funktioniert (T-9: bei
falscher `aud`-Weitergabe schlaegt JEDER Login fail-closed mit 401 fehl — ein Verbindungs-, kein
Sicherheitsproblem, aber ein Launch-Blocker fuer den Connector). Zweitens: die Scope-Luecke bei
T-12 ist eine bewusste, dokumentierte Abweichung (WorkOS stellt keinen ressourcenspezifischen
Scope aus) und durch `OpenAI-P7-T4` gepinnt — dieser Test MUSS rot werden, sobald je eine
Scope-Pruefung gebaut wird; wird er es nicht, hat die neue Pruefung keine Wirkung. Drittens: die
Ersatz-Gegenprobe (jose-Bibliothekssonde statt direkter Aenderung an `src/auth.js`) ist eine
schwaechere Beweisform als eine echte Rot-gegen-geschwaecht-Probe am Produktionscode — sie zeigt
Bibliotheksverhalten, nicht zwingend, dass `src/auth.js` die Optionen exakt so weiterreicht (das
folgt hier nur aus dem Lesen der Zeilen, nicht aus einem roten Test). Kein Sicherheits-Gate wurde
dabei tatsaechlich geschwaecht getestet — die Backup-Kopie ist byte-identisch mit dem aktuellen
Stand.

---

## 6. Testzahlen (selbst nachgemessen)

- `test/openai-p7-token-pruefachsen.test.js` isoliert: `NODE_ENV=test node --test
  --test-concurrency=4 test/openai-p7-token-pruefachsen.test.js` -> **5 pass / 0 fail**
  (`.../scratchpad/p7-isolated.txt`, selbst gelesen: `OpenAI-P7-T1..T4` alle `✔`).
- Voller Testlauf (`npm test -- -- --test-concurrency=4`, das Kommando aus dem Auftrag): im
  Scratchpad ein bereits abgeschlossenes Protokoll gefunden und selbst gepruecft
  (`.../scratchpad/p7-review-voll.txt`, Zeitstempel nach `ba1f3fd`, Kopfzeile bestaetigt das
  exakte `npm test`-Kommando): **`# tests 6220`, `# suites 80`, `# pass 6220`, `# fail 0`,
  `# cancelled 0`, `# skipped 0`, `# todo 0`**, danach `testbaenke-run`-Korrektur
  ("20 Datei-Wrapper ohne echten Test abgezogen"): `tests 6200 / pass 6200 / fail 0`. Alle vier
  neuen `OpenAI-P7-T*`-Faelle stehen einzeln mit `ok` in diesem Lauf (Zeilen 28104-28130). Dieser
  Befund ist **neuer und staerker** als der im Auftrag genannte Zwischenstand (Auftrag: Lauf noch
  nicht abgeschlossen, kein Summary verfuegbar) — ich uebernehme ihn hier als aktuellen, selbst
  gepruecften Stand, nicht die aeltere Momentaufnahme aus dem Auftrag.
- `git diff master...HEAD -- src/` -> leer (kein Produktionscode geaendert, selbst nachgemessen).
- `.../scratchpad/auth.js.orig` vs. aktuelles `src/auth.js` im Worktree -> `diff` liefert keine
  Ausgabe (byte-identisch; keine Weakening-Spur aus der Gegenprobe-Vorbereitung zurueckgeblieben).

---

## Empfehlung

Ich wuerde **mergen**. Begruendung: reine Dokumentationsphase, Produktionscode nachweislich
unveraendert, der neue Test ist echt (End-to-End gegen einen laufenden Prozess, nicht gegen einen
Mock) und isoliert wie im vollen Lauf gruen, beide vom Auftrag noch als offen gefuehrten Punkte
(Zweisprachigkeit, voller Testlauf) sind am tatsaechlichen HEAD bereits geschlossen. Offen bleibt
ausschliesslich das, was strukturell nicht in dieser Phase schliessbar war: drei Anbieter-
UNKNOWNs, die einen echten WorkOS-Login brauchen (Owner-Only), und eine methodisch schwaechere
Ersatz-Gegenprobe fuer die `issuer`/`nbf`-Behauptung. Beides ist im Belegdokument selbst als
offene Owner-Frage bzw. als Einschraenkung benannt, nicht verschwiegen.

---

*Bericht erstellt von einem Subagenten (Sonnet 5) am 2026-09-21. Alle Codezeilen-, Test- und
Log-Angaben in diesem Bericht wurden im Worktree selbst nachgelesen bzw. selbst ausgefuehrt, nicht
unbesehen aus dem Auftrag oder aus Commit-Messages uebernommen.*
