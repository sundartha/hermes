# T2-05 — Auth: Re-Auth-Challenge im Tool-Fehlerergebnis — Abschlussbericht

Branch `phase/openai-t2-05-reauth-challenge`, Commit `8bbf4bf`. Umfang: **genau T-14**.
Diff-Basis: `git diff master...HEAD` im Worktree (13 Dateien, +897/-197).

## 1. Was diese Phase NICHT erfuellt

- **T-14 ist NICHT vollstaendig erfuellt, nur fuer den B-1-Fall** ("gueltiges OAuth-Token,
  kein Mandant"). Ein abgelaufenes oder signaturungueltiges Token bleibt bewusst HTTP 401 mit
  Challenge, **kein** Tool-Ergebnis — d.h. fuer diese Faelle bekommt ChatGPT die
  Kontoverknuepfungs-UI weiterhin nur ueber den Transport-Kanal, nicht ueber ein Tool-Fehlerergebnis.
  Ob das im Review reicht, ist laut Bericht selbst offen (Owner-Punkt OP-1/O-6, s.u.).
- **Token- und Legacy-Modus bekommen die Challenge nicht.** Dort bleibt der Kein-Mandant-Fall
  weiterhin HTTP 403 ohne `WWW-Authenticate` — nur der OAuth-Zweig (`req.auth` gesetzt) wurde
  umgebaut. Das ist laut Plan gewollt (kein OAuth-Flow in diesen Modi), aber es bedeutet: T-14
  ist NICHT modusuebergreifend geloest, sondern nur dort, wo OpenAI/ChatGPT tatsaechlich landet.
- **Das Quotes-Format der Challenge ist ungeklaert (W1).** Der Plan/Bericht selbst haelt fest:
  das OpenAI-Beispiel zeigt einfache Anfuehrungszeichen im Challenge-String, die normative
  RFC-7235-Referenz kennt sie nicht; gebaut ist die RFC-konforme Variante ohne die Quotes. Ob
  ChatGPT beide Formen akzeptiert, ist **UNKNOWN**, ungetestet gegen echtes ChatGPT.
- **Kein Owner-Live-Beleg.** Ob ChatGPT bei diesem Ergebnis tatsaechlich die
  Konto-Verknuepfungs-UI zeigt, ist nicht am echten Draht gegen ChatGPT geprueft — nur die
  MCP-Antwortform (Ergebnis-Struktur, Header) ist belegt. Das ist der komplette Rest von T-14
  aus Sicht "wirkt es in der UI".
- Die Grundlinie wurde laut Bau-Notiz NICHT vor dem ersten Edit gemessen, sondern nachtraeglich
  durch Checkout auf `1cfa474` ermittelt (Prozessabweichung vom Auftrag, Messwert selbst laut
  Bericht sauber).

## 2. Was erfuellt ist — ID fuer ID

### T-14 (Teilbereich B-1: "gueltiges Token, kein Mandant")

- **Ort:** `src/mcp-no-tenant.js` (neue Datei), Einbindung in `src/routes/mcp.js:71-79` und
  `:196-201`, Challenge-Bauer geteilt aus `src/auth.js` (`oauthBearerChallenge`, neu exportiert,
  Zeilen 122-129 laut Diff — `deny401` ruft dieselbe Funktion auf statt den String zu duplizieren;
  am echten Code selbst nachgezogen).
- **Beleg Code:** `registerNoTenantStubs()` registriert dieselbe Tool-Menge wie `registerTools`
  (Namen/Schemas/`securitySchemes`/Widget-Verweise unveraendert), jeder Handler ist der
  synchron-triviale Stub `async () => result`; `scopedTenant` wird intern hart auf
  `TENANT_REJECT` gezwungen, unabhaengig vom uebergebenen Wert. Die Fassade
  (`noTenantFacade`) hat GENAU zwei Methoden (`registerTool`, `registerResource`); jede andere
  SDK-Methode auf dem Fassaden-Objekt existiert nicht und wirft `TypeError` (fail-closed,
  landet im Route-`catch` als 500).
- **Beleg Tests (Drahttest, echte `/mcp`-Route, Kindprozess):** `test/openai-t2-05-reauth-challenge.test.js`
  - `T05-1`: unbekannter `sub` → `initialize`/`tools/list` unveraendert, `place_call`-Aufruf
    liefert `isError:true` + `_meta["mcp/www_authenticate"]`, Spion-Gateway zaehlt **0** Aufrufe
    an den internen REST-Hop, Store bleibt ohne neuen Anruf, Owner-Nummer nicht im Body.
  - `T05-2`/`T05-3`: verifiziertes Token ohne `sub`, weitere Werkzeuge — Spion bleibt 0.
  - `T05-4` (**Positiv-Kontrolle**): echtes Mandanten-Token → Spion `>= 1`, keine Challenge im
    Ergebnis — belegt, dass der Spion ueberhaupt etwas misst.
  - `T05-5`: Challenge-Parameter (`resource_metadata`, `scope`) identisch zum HTTP-401-Header.
  - `T05-6`/`T05-7`: Token-Modus bleibt 403 ohne Challenge-Feld im Body; Legacy-Modus bleibt 401
    mit generischer Challenge ohne `resource_metadata`.
  - `T05-8`: stdio unveraendert — echter Handler laeuft, keine Challenge,
    `tools/list.length === TOOL_COUNT_WITHOUT_CONSULT`.
  - `T05-9`: ungueltige Signatur bleibt 401, kein JSON-RPC-Ergebnis.
  - Alle Unit-Tests (Fassaden-Form, TypeError bei fehlender Methode, Stub-Registrierung ruft
    nie `fetch`) sind Teil derselben Datei.
- **Bestandsdateien nachgezogen:** `test/am6-oauth-tenant.test.js`, `test/request-tenant.test.js`
  (`V3`, `V4`), `test/profiles.test.js`, `test/e4-mandantentrennung-default.test.js` — alle
  erwarteten vorher 403 fuer den Kein-Mandant-Fall, jetzt geprueft ueber
  `assertReauthChallenge` (neue geteilte Pruef-Funktion in `test/helpers.js`).
- **Messung (isoliert nachgefahren, nicht nur uebernommen):** `node --test` gegen die sechs
  betroffenen Dateien (`openai-t2-05-reauth-challenge`, `request-tenant`, `am6-oauth-tenant`,
  `e4-mandantentrennung-default`, `profiles`, `route-auth-inventory`) lief hier isoliert:
  **68 pass / 0 fail** (Log:
  `/private/tmp/claude-501/.../logs-t2-05/t2-05-tests.log`).

## 3. Beruehrte Pfade — Abdeckung

| Pfad | T-14 (B-1-Fall) erfuellt? |
|---|---|
| OAuth, HTTP, gueltiges Token ohne Mandant | Ja — Tool-Fehler mit Challenge (T05-1..5) |
| OAuth, HTTP, ungueltiges/abgelaufenes Token | Nein, bewusst — bleibt 401 mit Challenge, kein Tool-Ergebnis (T05-9) |
| Token-Modus (statischer Legacy-Token) | Unveraendert 403 ohne Challenge (T05-6) — T-14 dort nicht gebaut, nicht Ziel dieser Phase |
| Legacy-/off-Modus (kein Auth) | Unveraendert 401 ohne `resource_metadata` (T05-7) |
| stdio | Unveraendert — kein Auth-Layer, T-14 dort gegenstandslos (T05-8) |

Die Owner-Regel/Sicherheits-Invariante ("kein REST-Hop, keine Owner-Kosten im Kein-Mandant-Fall")
ist auf ALLEN oben gelisteten Pfaden geprueft, nicht nur auf dem Hauptpfad — inklusive
Positiv-Kontrolle, die zeigt, dass der Spion echt misst.

## 4. Was ein fremder Pruefer nachmessen sollte

- Ist die Fassade in `src/mcp-no-tenant.js` wirklich auf zwei Methoden beschraenkt, und wirft ein
  Aufruf einer dritten SDK-Methode (z.B. `server.tool(...)`, das Legacy-API) tatsaechlich einen
  `TypeError` statt still zu verpuffen? (`node --test test/openai-t2-05-reauth-challenge.test.js`,
  Tests "Unit S3 (i)".)
- Erreicht ein OAuth-Login ohne Mandant unter keinen Umstaenden den internen REST-Hop — miss das
  selbst mit einem eigenen Spion-Gateway gegen die echte `/mcp`-Route, nicht nur am
  Registrierungsobjekt (`registerTool` verwirft unbekannte Felder still, das ist im Auftrag
  ausdruecklich benannt).
- Stimmen `resource_metadata` und `scope` im Tool-Fehlerergebnis exakt mit dem Wert im
  HTTP-401-Header ueberein (dieselbe Quelle `oauthBearerChallenge`), oder driften sie bei
  einer kuenftigen Aenderung an nur einer Stelle auseinander?
- Bleibt der Legacy-/Token-Modus wirklich byte-identisch 403/401 (kein neuer Pfad, der versehentlich
  auch dort eine Challenge einfuehrt)?
- Ist das Quotes-Format der Challenge (`error="insufficient_scope"` vs. das im OpenAI-Beispiel
  gezeigte Format mit einfachen Anfuehrungszeichen) tatsaechlich das, was ChatGPT akzeptiert —
  das ist im Repo als UNKNOWN markiert, nicht am echten ChatGPT verifiziert.
- Deckt `TOOL_COUNT_WITHOUT_CONSULT`/die Namensmenge in `T05-1` wirklich denselben Mandanten-Fall
  ab wie in Produktion (Mandant ohne gespeichertes Profil = `DEFAULT_PROFILE`, 9 statt 10
  Werkzeuge) — der Bau haelt selbst fest, dass die urspruenglich geplante feste Zahl nicht haltbar
  war und durch einen Gleichheitsvergleich (Geist- vs. Echt-Liste) ersetzt wurde; pruefen, ob
  dieser Ersatzbeweis dieselbe Aussage traegt.

## 5. Owner-Punkte und Restrisiko

**Owner-Punkte (konsolidiert, nur nach der Owner-Regel):**
1. Live-Probe im ChatGPT Developer Mode nach dem Deploy: Connector mit einem IdP-Konto ohne
   Hermes-Mandant verbinden, ein Werkzeug aufrufen (z.B. `get_my_number`); erwartet ein
   Tool-Fehler "No Hermes account is linked ..." UND dass ChatGPT die Konto-Verknuepfung anbietet.
   Erscheint die UI nicht: Ergebnis notieren (Fehlercode-Frage, evtl. `invalid_token` statt
   `insufficient_scope` noetig, bzw. das Quotes-Format aus W1).
2. Live-Probe in Claude (claude.ai-Connector) mit demselben Konto: Verbindung soll gelingen,
   Werkzeugaufruf zeigt den Fehlertext, nichts stuerzt ab; Gegenprobe mit einem Konto MIT Mandant:
   Werkzeuge funktionieren unveraendert.
3. Deploy/Push durch den Owner — keine Deploy-Vorbedingung (kein neuer Live-Wert; `PUBLIC_URL` ist
   seit T2-04 Pflicht, hier nicht veraendert).

**Restrisiko in einem Absatz:** Der Code-Anteil ist fail-closed sauber belegt — kein REST-Hop, kein
Owner-Anruf, kein Legacy-`scopedTenant=null`-Rueckfall, Positiv-Kontrolle zeigt, dass die Messung
selbst funktioniert, und Token-/Legacy-/stdio-Pfade bleiben byte-identisch. Das echte Restrisiko
liegt ausserhalb dessen, was ohne ChatGPT/Claude messbar ist: ob die gebaute Challenge-Form (RFC-7235
ohne die einfachen Anfuehrungszeichen aus OpenAIs eigenem Beispielcode) am echten Client tatsaechlich
die Konto-Verknuepfungs-UI ausloest, ist ungetestet und im Repo selbst als offen markiert (W1, OP-1).
Bis diese Live-Probe steht, ist T-14 nur "strukturell richtig gebaut", nicht "beim Nutzer wirksam
belegt" — und nur fuer den B-1-Fall, nicht fuer abgelaufene/ungueltige Tokens.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: 8bbf4bf; Tests (volle Suite, pass/fail): 6316/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  | ID | erfuellt | Beleg | Luecke |
  |---|---|---|---|
  | T-14 | ja | Interface-IP, OAuth, unbekannter sub: tools/list 9; tools/call place_call/get_my_number/list_calls -> isError:true + _meta[mcp/www_authenticate]=[Bearer resource_metadata=..., error=insufficient_scope]; 0 Calls; mcp-no-tenant.js:44 | Keine im Branch. Die Challenge kommt nur im OAuth-Fall ohne Mandant. Token-/Legacy-Modus bleiben bei 403/401 (T05-6/7), stdio unveraendert (T05-8). Server lief ueber helpers.startServer mit eigenem Temp-DATA_DIR. |
- Isoliert rot: []
- Offene Blocker:
- (keine)
