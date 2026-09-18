# Runbook: AS-Metadata-Sonde (E1, S5-A4 + F1-F5)

## 1. Wozu

Vor jeder Codeaenderung an der OAuth-Seite (Etappen 6 und 8 der
OpenAI-Sanierung, s. `PLAN-OPENAI.md`) muss feststehen, was der Authorization
Server (WorkOS AuthKit) tatsaechlich kann und was unser eigenes Gateway live
ausliefert. Das ist die Feststellungsaufgabe F1-F5 aus
`tasks/openai-fix/S5-authorization-server.md`. Diese Datei ist die Ablage
dafuer - und zugleich die Quelle, die `PLAN-SECURITY.md` bisher nur als
Messnotiz kennt (dort `:2052-2056`).

## 2. Was die Sonde ist und NICHT ist

`scripts/probe-as-faehigkeiten.mjs` ist ein Messwerkzeug, **kein Gate**. Sie
haengt an keinem `package.json`-Script, keinem CI-Lauf und keinem Boot-Pfad -
ein WorkOS-Ausfall macht damit nie den Build oder den Start rot.

Sie misst zwei Dinge:

1. den Authorization Server (WorkOS AuthKit): acht benannte Faehigkeiten an
   seiner AS-Metadata (F4/F5).
2. unser eigenes Gateway: den Live-Issuer und die Live-Audience aus der
   Protected-Resource-Metadata (F1/F2) sowie den Live-Auth-Modus von `/mcp`
   (F3).

Sie beweist **keinen** erfolgreichen ChatGPT-Connector-Flow (S5-Pre-Mortem 3):
CIMD/DCR koennen an sein und die Verbindung trotzdem an etwas anderem
scheitern (Scopes, Consent, Redirect-URI). Der Nachweis dafuer bleibt der
erste echte Verbindungsversuch.

## 3. Aufruf und Sicherheitszusagen

```
node scripts/probe-as-faehigkeiten.mjs <basis-url>
```

Kein Secret, kein Token, kein Cookie - weder als Argument, aus der Umgebung
noch in der Ausgabe. Alle drei abgefragten Dokumente sind oeffentliche
Discovery-Metadata. Der Schritt "POST /mcp ohne Token" (F3) sendet keinen
Koerper und liest den Antwortkoerper **nie** - nur Statuszeile und
`WWW-Authenticate`-Header werden ausgewertet. Jeder Lauf erzeugt eine
`auth_failed`-Audit-Zeile am Gateway (der 401 auf `/mcp`) - das ist erwartet,
keine Alarmkette haengt daran.

Exit-Codes: `0` = alle PFLICHT-Zeilen PASS · `1` = mindestens eine
PFLICHT-Zeile nicht PASS (ein 404 auf einem Discovery-Pfad eingeschlossen,
nicht "still gruen") · `2` = Aufruffehler VOR der ersten Netzanfrage (kein
oder falsches Argument).

## 4. Lesart

Jede Zeile traegt zwei unabhaengige Werte: den Status (`PASS`/`FAIL`/`UNKNOWN`)
und das Gewicht (`PFLICHT`/`BEFUND`). Nur PFLICHT-Zeilen entscheiden den
Exit-Code. `UNKNOWN` ist niemals "in Ordnung" - es heisst nur "nicht
feststellbar" (z.B. weil das AS-Dokument fehlte).

PFLICHT-Zeilen (4): "PRM erreichbar", "AS-Metadata erreichbar",
`1/8 issuer-Gleichheit`, `3/8 PKCE S256 beworben`.

| # | Faehigkeit | Gewicht | Was tun bei FAIL |
|---|---|---|---|
| - | PRM erreichbar | PFLICHT | Gateway/`/.well-known/oauth-protected-resource` pruefen (`src/auth.js registerWellKnown`); ein 404 bedeutet i.d.R. `MCP_AUTH != oauth` oder fehlenden `OAUTH_ISSUER_URL` |
| - | AS-Metadata erreichbar | PFLICHT | Issuer-URL falsch/nicht erreichbar, oder WorkOS-Umgebung down; beide Well-known-Pfade pruefen |
| 1/8 | issuer-Gleichheit (A-06/T-7) | PFLICHT | Vorbedingung fuer Etappe 6 (A1): das Dokument-`issuer`-Feld weicht von `OAUTH_ISSUER_URL` ab - A1 NICHT bauen, bevor das geklaert ist (s. Abschnitt 7) |
| 2/8 | jwks_uri auf Issuer-Origin | BEFUND | Owner-Entscheidung (S5-Nachbesserung 2), kein Fehler des AS von sich aus |
| 3/8 | PKCE S256 beworben (T-8) | PFLICHT | ohne S256 ist der OAuth-Flow fuer OpenAI-Connectoren nicht spezifikationskonform - Blocker fuer Etappe 6/8, WorkOS-Support kontaktieren |
| 4/8 | DCR: registration_endpoint (T-10) | BEFUND | Dynamic Client Registration im WorkOS-Dashboard pruefen (B3) |
| 5/8 | CIMD beworben (T-10) | BEFUND | Client-ID-Metadata-Documents im WorkOS-Dashboard aktivieren (B2, Default laut Doku AUS) |
| 6/8 | Token-Auth 'none' moeglich (T-10) | BEFUND | `token_endpoint_auth_methods_supported` im Dashboard pruefen |
| 7/8 | RFC 9207 iss-Parameter (T-11) | BEFUND | fehlt das Feld (UNKNOWN) oder steht es auf false (FAIL): ChatGPT nutzt dann die callback-spezifische Redirect-URI statt der stabilen (s. Abschnitt 6) - kein Blocker |
| 8/8 | userinfo_endpoint (T-16) | BEFUND | nur relevant, falls Workspace-Domain-Restriktionen gewuenscht sind |

## Messung 2026-09-18 (vor B1-B3, F1-F4)

Kommando: `node scripts/probe-as-faehigkeiten.mjs https://app.sundartha.com`
Datum (UTC): 2026-09-18T10:11:49.901Z
Deployter Commit: nicht per `/healthz` erhoben (D6, akzeptiertes Restrisiko -
die Sonde pinnt keinen Commit). Repo-HEAD zum Messzeitpunkt: `3d32492`.

```
=== Sonde AS-Faehigkeiten ===  Ziel: https://app.sundartha.com   Datum (UTC): 2026-09-18T10:11:49.901Z
--- Schritt 1: Protected Resource Metadata (F1/F2) ---
[PASS   ] [PFLICHT] PRM erreichbar    HTTP 200
[INFO   ] resource (F2) = https://app.sundartha.com/mcp
[INFO   ] authorization_servers[0] (F1) = https://fearless-network-26.authkit.app
--- Schritt 2: POST /mcp ohne Token (F3) ---
[PASS   ] [BEFUND ] WWW-Authenticate vorhanden -> Modus oauth    Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Kein Token"
[INFO   ] publicUrl aus resource_metadata = https://app.sundartha.com
[INFO   ] A3-Vorhersage = NEIN - Footgun feuert NEIN (resource == publicUrl/mcp)
--- Schritt 3: AS-Metadata am Issuer (F4) ---
[PASS   ] [PFLICHT] AS-Metadata erreichbar    Quelle: oauth-authorization-server (HTTP 200) | oauth-authorization-server: HTTP 200 | openid-configuration: HTTP 200
[INFO   ] issuer-Feld je Pfad = oauth-authorization-server=https://fearless-network-26.authkit.app | openid-configuration=https://fearless-network-26.authkit.app
[INFO   ] scopes_supported = email, offline_access, openid, profile
[PASS   ] [PFLICHT] 1/8 issuer-Gleichheit (A-06/T-7)    Dokument-issuer: https://fearless-network-26.authkit.app
[PASS   ] [BEFUND ] 2/8 jwks_uri auf Issuer-Origin (A1-Vorbedingung)    jwks_uri: https://fearless-network-26.authkit.app/oauth2/jwks
[PASS   ] [PFLICHT] 3/8 PKCE S256 beworben (T-8)    code_challenge_methods_supported: S256
[PASS   ] [BEFUND ] 4/8 DCR: registration_endpoint (T-10)    registration_endpoint: https://fearless-network-26.authkit.app/oauth2/register
[PASS   ] [BEFUND ] 5/8 CIMD beworben (T-10)    client_id_metadata_document_supported: true
[PASS   ] [BEFUND ] 6/8 Token-Auth 'none' moeglich (T-10)    token_endpoint_auth_methods_supported: none, client_secret_post, client_secret_basic
[UNKNOWN] [BEFUND ] 7/8 RFC 9207 iss-Parameter (T-11)    authorization_response_iss_parameter_supported: (fehlt)
[FAIL   ] [BEFUND ] 8/8 userinfo_endpoint (T-16)    userinfo_endpoint: (fehlt)
=== Ergebnis: PFLICHT 4/4 PASS - Befunde 5 PASS, 1 FAIL, 1 UNKNOWN -> Exit 0
```

### Live-Werte

- F1 (Live-`OAUTH_ISSUER_URL`): `https://fearless-network-26.authkit.app`
- F2 (Live-`OAUTH_AUDIENCE`/`resource`): `https://app.sundartha.com/mcp`
  (kanonisch = `publicUrl` + `/mcp`; die A3-Vorhersage lautet NEIN - der A3-
  Footgun aus Etappe 8 wuerde heute NICHT ausloesen)
- F3 (Live-Auth-Modus von `/mcp`): `oauth` (401 mit `WWW-Authenticate` und
  `resource_metadata`)
- **A3-Vorhersage**: NEIN
- **F4-Kurzfazit**: 4/4 PFLICHT-Zeilen PASS, `S256` PASS. Von den vier
  BEFUND-Zeilen, die S5 als UNKNOWN einstufte, sind DCR/CIMD/Token-Auth-none
  bereits PASS (CIMD ist laut Live-Messung schon aktiv - abweichend vom in
  S5 dokumentierten "Default AUS"); `userinfo_endpoint` fehlt (FAIL, nur
  relevant bei Workspace-Domain-Restriktionen); `authorization_response_iss_
  parameter_supported` bleibt UNKNOWN (T-11, SHOULD-Feld nicht dokumentiert).

## 6. Folgerungen

- **Etappe 6 (A1, Issuer-Gleichheit/jwks_uri-Origin):** `1/8` ist PASS -
  der strikte Issuer-Vergleich kann ohne Ueberraschung gebaut werden (F4 vor
  A1 erfuellt, S5-Abhaengigkeit 1). `2/8` (jwks_uri-Origin) ist ebenfalls
  PASS, bleibt aber laut S5 eine Owner-Entscheidung fuer A1, kein
  automatischer Fehlerfall.
- **Etappe 8 (A3, Kanonizitaet der Resource-URI):** F2 = kanonischer Wert,
  A3-Vorhersage NEIN - A3 kann deployt werden, ohne den Boot zu gefaehrden
  (S5-Abhaengigkeit 2, Pre-Mortem 1 entschaerft).
- **Redirect-URI-Entscheidung (T-11):** `7/8` ist UNKNOWN (Feld fehlt in der
  Live-Metadata) -> ChatGPT nutzt die callback-spezifische Redirect-URI
  `https://chatgpt.com/connector/oauth/{callback_id}` statt der stabilen
  `https://chatgpt.com/connector_platform_oauth_redirect`. Dafuer ist laut
  S5 kein Code zu bauen - der Client bringt seine Redirect-URI per CIMD/DCR
  mit. Owner-Entscheidung ausstehend: diese Antwort formell bestaetigen
  (S5-Abhaengigkeit 5).

## 7. Deckungsgrenze der Messung (wichtig)

Die Sonde liest den Issuer aus `PRM.authorization_servers[0]`. Das ist nur
deshalb der Live-Wert von `OAUTH_ISSUER_URL`, weil `registerWellKnown`
(`src/auth.js`) das PRM-Dokument aus genau diesem Config-Wert baut:

```
authorization_servers: config.auth.oauthIssuerUrl ? [config.auth.oauthIssuerUrl] : []
```

Aendert eine spaetere Etappe diese Quelle (z.B. ein zweiter Issuer, eine
andere Herleitung), verliert F4 seine Deckung fuer die A1-Vorbedingung - die
Sonde misst dann einen anderen Wert als den, gegen den A1 tatsaechlich
vergleicht. Diese Kopplung ist der Grund, warum F4 in S5 als Vorbedingung von
A1 gefuehrt wird, nicht als Beiwerk.

## 8. Diagnose-Aenderung nach Etappe 6 (S5-PM-6/PM-7)

Heute (vor A2) heisst ein 404 auf der PRM einfach "Route nicht erreichbar/
Modus nicht oauth". Ab A2 (Etappe 6, fail-closed PRM) heisst ein 404 auf
diesem Pfad ausdruecklich "Modus nicht oauth" - kein Ausfall der Route mehr.
Die Sonde meldet in beiden Faellen FAIL + Exit 1; das ist nach A2 weiterhin
korrekt, nur die Interpretation des Befunds aendert sich.

## F5 - Platzhalter (Messung nach B1-B3)

Noch nicht gefuellt (bewusst - diese Ueberschrift beginnt absichtlich NICHT
mit "## Messung", damit sie nicht als zweite ausgefuellte Messung
mitgezaehlt wird). F5 gehoert zu Etappe 8 (nach den Owner-Dashboard-
Aenderungen B1-B3) und wird dort als zweite, mit "## Messung" ueberschriebene
datierte Messung ergaenzt.

## 10. Abgrenzung zu `scripts/check-setup.js`

`check-setup.js` prueft die LOKALE Config gegen den LOKAL laufenden Gateway
(`http://localhost:<port>`) und bricht bei der Well-known-Discovery beim
ersten Treffer ab. Diese Sonde bekommt den Host als Pflichtargument, leitet
den Issuer aus der LIVE-PRM-Antwort ab, liest BEIDE Well-known-Pfade und
bewertet acht benannte Felder statt eines. Beide teilen sich nur die Liste
der zwei Pfade (eine Konstante, keine Logik) - keine dritte Kopie derselben
Discovery-LOGIK entsteht dadurch. Sobald eine Laufzeitstelle (z.B. ein
Boot-Gate in einer spaeteren Etappe) dieselbe Acht-Felder-Bewertung braucht,
wandert `bewerteFaehigkeiten` nach `src/` und beide Skripte importieren sie
von dort.

## 11. Owner-Vorbehalt

Die Issuer-URL ist `sync: false` in `render.yaml`, aber kein Credential - sie
steht deshalb oben im Klartext. Sieht der Owner das anders, ist der
Schnappschuss ohne Host zu fuehren (Owner-Entscheidung, keine Bauaufgabe).
