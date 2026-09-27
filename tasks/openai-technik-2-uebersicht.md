# OpenAI-Einreichung, Technik Runde 2 - Uebersicht

Stand: 27.09.2026, nach Sitzung 6 und dem Deploy von `59beeb8`. Kompakte Sicht fuer den Owner: was steht, was fehlt, was nur du
erledigen kannst, wo was liegt. Das ausfuehrliche Protokoll bleibt `tasks/openai-technik-2-stand.md`.

## 1. Kurzstand

- **LIVE seit 27.09.2026 ~18:35: `59beeb8`** (Runde 1 + Runde 2 bis T2-20 + Cookie-Consent aus upstream).
  lokal = origin/master = upstream/master. Gateway per manuellem Deploy (autoDeploy ist AUS),
  Website `hermes-web` per autoDeploy (AN) - `/support` ist live.
- Nach dem Deploy von aussen gemessen: `/healthz` ok mit Commit `59beeb8`; Boot-Log ohne Warnung zu
  `CALL_CONFIRMATION_SECRET` und `MCP_AUTH`; `/mcp` ohne Token -> 401 mit Bearer-Challenge und Scopes;
  OAuth-Metadaten korrekt; `https://sundartha.com/support` -> 200, kein noindex.
- **21 von 24 Phasen gemergt**, jede mit unabhaengiger Opus-Verifikation ("MERGE-FREIGABE ja").
- Offen: **T2-21, T2-22, T2-24**, danach die **Schlussabnahme** (Messung aller 100 IDs).
- Letzte Messung: Zwischenmessung 1 (24.09., master `1a31815`): 79 technische IDs, davon 55 ERFUELLT,
  11 GEGENSTANDSLOS, 6 OWNER. Seitdem gemergt: T2-13 bis T2-20 - die Schlussabnahme misst neu.
- **Nie pushen:** `phase/openai-t2-15-restricted-data-mask` (Zwischen-Commit mit Secret-foermigen
  Test-Fixtures) und `phase/openai-t2-18-compat-contract-runbook` (Zwischenhistorie mit verworfenem
  922-KB-Widget-Archiv). Beide sind gesquasht auf master, die Branches liegen nur lokal.

## 2. Gemergte Phasen

| Phase | Inhalt | IDs | Commit |
|---|---|---|---|
| T2-01 | Widget: CSP/Domain am Ressourcen-Inhalt, Origin | T-30, T-31, T-23 | a941d23 |
| T2-02 | Widget-URIs versioniert | T-34 | fff3b95 |
| T2-03 | Auth: `exp`-Pflicht, Boot-WARN | T-12, T-5 | 24ff703 |
| T2-23 | Auth: Scopes (beworben vs. erzwungen) | T-16, T-12 | c0438bd |
| T2-04 | `PUBLIC_URL` Pflicht | T-32 | 1cfa474 |
| T2-05 | Re-Auth-Challenge im Tool-Fehlerergebnis | T-14 | 8a5b7ce |
| T2-06 | CORS nur fuer freigegebene Origins | T-29 | e8a0120 |
| T2-07 | Rate-Limit je Mandant statt je IP | T-28 | 4cc2e9a |
| T2-08 | Geldpfad: Hop-Fristen, Stundenlimit unter Sperre | T-27 | 33d7f80 |
| T2-09 | Neutrale Fehlertexte an der MCP-Grenze | O-13, O-20 | 0cdb817 |
| T2-10 | Abgleich Usage Policies (Doku) | O-18 (Teil) | 6b3f9d1 |
| T2-11 | Ehrliche Werkzeugnamen (`get_call_result`, `get_agent_number`) | N-12, N-13, N-11 | 91fc847 |
| T2-12 | Widgets ziehen Umbenennung nach, Kalender entfaellt | N-12, N-13, O-25 | 1a31815 |
| T2-13 | Serverseitige Bestaetigung vor dem Waehlen (`prepare_call`) | N-10 | c726212 |
| T2-14 | Bestaetigungs-Klick in der Call-Karte | N-10 | 252d154 |
| T2-15 | Restricted Data: ablehnen und maskieren (Squash) | O-14 | 66d95ae |
| T2-16 | `place_call`-Texte neutral + Zweckbindung, Messwerkzeug | O-27, N-14, O-15, O-19, O-18 | 28e6fdb |
| T2-17 | Server-instructions: Kern in den ersten 512 Zeichen | T-21 | f492a19 |
| T2-18 | Kompatibilitaetsvertrag + Update-Runbook (Squash) | T-33 | f096103 |
| T2-19 | Support-Seite `/support` auf der Website | O-7 | 1c6b7a4 |
| T2-20 | Reviewer-Zugang: Anleitung, Seed-Skript, Login-Pfad | O-9 | 91ef8cc |

## 3. Offene Phasen (baut die Kette ohne dich)

| Phase | Inhalt | IDs |
|---|---|---|
| T2-21 | Review-Testfaelle (5 positiv, 3 negativ) auf Basis des Reviewer-Zugangs | O-10 |
| T2-22 | Listing-Entwurf fuer die Einreichung | O-11 |
| T2-24 | Werkzeug-Ausgaben ehrlich und minimal (`get_call_status` liefert Transkriptzeilen nicht mehr woertlich nach Anrufende; `list_action_items` sagt "from all calls", sieht aber nur die 50 neuesten; veraltete Zeilenverweise im Werkzeug-Inventar) | O-13, N-13, N-5 |
| Schlussabnahme | 4 Opus-Pruefer gegen genau 100 IDs, Stichprobe, Zusammenfuehrer; Luecke gefunden -> weiterbauen | alle |

Bekannte kleine Restpunkte (kein Merge-Hindernis, in der Schlussabnahme entscheiden):
- `docs/OPENAI-REVIEWER-ACCESS.md:57-147`: Codeverweise nuetzen dem Reviewer nichts (Doku-Tests pinnen sie).
- Vertrag (T2-18): drei Server-Profile ungemessen (Legacy+Token, Token+Consult+UI, OAuth ohne Mandant mit Consult+UI).
- Server-instructions: Kern mit Consult hat nur 6 Zeichen Luft bis 512; einige Aussagen stehen doppelt (Kuerzungspotenzial).
- `call.html` steht bei 266193 von 266240 Byte - jede weitere Widget-Aenderung braucht Platz.
- Bestaetigungs-Ledger nur je Instanz im Speicher; Fingerabdruck in localStorage (in PLAN-SECURITY.md als akzeptiert gefuehrt).
- T2-08: kein Test fuer den Fallback `callQuotaDenialNotWired`. T2-09: `inputHint` reicht deutsche 400-Texte an EN-Mandanten durch (Bestand).

## 4. Deine Liste

### A. Vor dem naechsten Deploy (sonst Ausfall oder falsches Verhalten)

| # | Punkt | Was tun | Erwartet |
|---|---|---|---|
| A1 | OW-G `PUBLIC_URL` | **erledigt** (23.09. von aussen gemessen) | - |
| A2 | OW-B echtes Token | **erledigt** (23.09., `exp` + Scopes + `aud` passen) | - |
| A3 | OW-N (OFFEN, jetzt live relevant) | `WORLD_DEFAULT_LANGUAGE_ENABLED` live pruefen | `true`; sonst zeigt der MCP-Fehlerkanal EN-Mandanten deutschen Text |
| A4 | OW-H Werkzeugtext-Messung (OFFEN - ohne Messung deployt, Owner-Entscheidung 27.09.) | Anthropic-Guthaben aufladen, dann `scripts/briefing-bench` echt mit n=5: Alt `66d95ae` gegen Endstand (Anleitung `scripts/briefing-bench/README.md`) | Selbstnennung 0, erfundene Fakten 0, Luecken neu >= alt, Verweigerung legitimer Anrufe neu <= alt, Missbrauch abgewiesen neu >= alt. Verfehlt -> Werkzeugtext-Commits zuruecknehmen (Anleitung README + PLAN-SECURITY) |
| A5 | Bestaetigung vor dem Waehlen | **erledigt 27.09.**: `CALL_CONFIRMATION_SECRET` (48 Zeichen) per Render-MCP gesetzt; Boot ohne WARN. `MCP_UI_ENABLED` nicht `false` (nicht gemessen) | - |
| A6 | Deploy-Kopplungen | **erledigt**: master als Ganzes deployt | - |
| A7 | Kenntnisnahme | Ab dem Deploy kann **kein Host ohne Widget-Karte mehr waehlen**: Claude Code (auch der claude.ai-Connector in Claude Code), stdio, API, `MCP_UI_ENABLED=false`. claude.ai-Web und ChatGPT rendern Karten | bewusst so; ein Rueckfallweg waere eine eigene Phase |
| A8 | WorkOS-Aufraeumen | temporaeren Client `client_01M373KB0ZKABRXDMS4130KPMD` im WorkOS-Dashboard loeschen | - |

### B. Nach dem Deploy (Live-Proben, blockieren nichts)

1. Claude-Connector und ChatGPT Dev Mode **trennen und neu verbinden** -> `tools/list` zeigt `get_call_result`, `get_agent_number`, `prepare_call`, kein `get_calendar`.
2. Widget rendert in ChatGPT und in Claude; im Render-Log Klasse `chatgpt` bei ChatGPT, `andere` bei Claude.
3. DE-Mandant fragt in Claude nach seiner Nummer -> Karte auf Deutsch.
4. Boot-Log ohne WARN "MCP_AUTH ist nicht oauth"; ein Tool-Aufruf im Claude-Connector ohne 401.
5. `email` / `email_verified: true` belegen (Login ohne `resource`-Parameter oder `id_token` auswerten).
6. ChatGPT Dev Mode mit IdP-Konto **ohne** Mandant -> Tool-Fehler + Konto-Verknuepfung; Konto mit Mandant unveraendert.
7. CORS: Render-Log auf `grund=mcp_cross_origin origin=` pruefen; nur wenn ein Fremd-Origin geloggt wird, `MCP_ALLOWED_ORIGINS=https://<Host>` exakt setzen (nicht die Widget-Sandbox-Domain), Neustart, curl-Probe.
8. `req.ip` hinter Render = echte Client-IP (eigene IP mit `auth_failed`-Zeile vergleichen); `await_call_event`-Schleife ueber mehrere Minuten -> kein 429.
9. `list_action_items` ohne `[..]`-Kennung; Aufruf mit Ziel 112 -> Fehler mit Denylist-Text in Mandanten-Sprache, kein "HTTP", kein Env-Name, **kein Anruf**.
10. Bestaetigung: Karte zeigt Vorschau, **1 Klick = genau 1 Anruf**, das Modell kennt den Code nie (je mit "Immer erlauben" und "Fragen"); Reload einer alten Karte -> Hinweis statt zweitem Anruf.
11. Restricted Data: `prepare_call` mit Testkarte `4111 1111 1111 1111` -> Fehler ohne Karte; Gegenprobe Rufnummer ohne `+` und ein Datum -> normale Karte.
12. Zweckbindung: legitimer Terminanruf -> Karte mit Zweckhinweis; Aufforderung zu Werbe-/Wahlkampf-/Massenanrufen -> Ablehnung ohne Karte.
13. Instructions: Modell ruft `place_call` nicht selbst, fragt keinen Code ab, quittiert Consult mit `working`.
14. Testanruf an die eigene Nummer im ChatGPT Dev Mode: Karte bis `completed`, keine Kalender-Karte.
15. Werkzeugnamen, Pflichtfelder und Widget-URIs im ChatGPT Dev Mode mit dem passenden Profil in `docs/mcp-vertrag.json` vergleichen; fehlt eines, Profil ergaenzen.

### C. Website `/support` live bringen (OW-K)

**Erledigt 27.09. per autoDeploy von `hermes-web` (ohne Labor-Schritt); Messung 4 bestanden. Offen nur Schritt 5.**

1. Labor: `git fetch upstream && git checkout -b web-support upstream/master`, dann die T2-19-Commits
   `21fc199..78110e1` cherry-picken (nur `apps/web/**`), `git push upstream web-support:staging`.
2. Seite im Labor (`hermes-web-staging`) pruefen.
3. Live: `git push upstream web-support:master`, danach `hermes-web` **manuell** im Render-Dashboard
   deployen. **Achtung:** ein Push auf `upstream/master` kann auch den Gateway mitdeployen (Build-Filter pruefen).
4. Messen: `curl -sI https://sundartha.com/support` -> 200, kein `X-Robots-Tag: noindex`; kein robots-meta im HTML.
5. Die URL als Support-URL ins OpenAI-Formular eintragen.

Ablauf im Detail: `docs/RUNBOOK-LAB-LIVE.md`.

### D. Reviewer-Konto (OW-L)

1. Beim Login-Anbieter ein Konto mit **frischer, bei Hermes unbekannter** E-Mail anlegen, verifiziert, **ohne MFA**; Login im privaten Fenster ausserhalb des Firmennetzes gegenpruefen.
2. Einmal mit diesen Daten im Web einloggen (legt genau einen suspendierten Mandanten an, noch keine Nummer) und echtes Abo + KYC abschliessen. Den Mandanten **nicht** in `OWNER_SELF_CALL_TENANT_IDS` eintragen, kein `profile.unrestricted` / `allowedNumbers` setzen - der Reviewer bekommt exakt dieselben Gates wie jeder Kunde.
3. Beispieldaten: `scripts/seed-reviewer-demo.mjs` aus dem **deployten** Commit und mit **produktionsgleicher** Umgebung fahren (mit abweichender lokaler `.env` koennte der Store-Start ein fehlendes `idp_subject` aus dieser Datei schreiben). Ablauf: Dienst stoppen -> `--apply --dienst-gestoppt` -> Dienst starten (der pg-Store haelt den Zustand im Speicher). Das Skript fuehrt nie DDL aus und bricht bei Schema-Abweichung ohne Schreiben ab. Vor der Einreichung bzw. einem langen Review wiederholen (Aufbewahrungsfrist).
4. Zugangsdaten **nur** im Einreichungsformular hinterlegen, nirgends im Repo.

Anleitung: `docs/OPENAI-REVIEWER-ACCESS.md`, Skriptkopf, `PLAN-SECURITY.md`.

### E. Bei und nach der Einreichung (OW-M)

- Support-URL (C) und Reviewer-Zugang (D) eintragen.
- Listing: Name, Kategorie, Laender (Entwurf kommt aus T2-22).
- Review-Testfaelle im Portal eintragen (kommen aus T2-21).
- Einhaltungs-Zusicherung zu den Usage Policies abgeben (O-18; die Kette liefert den belegten Abgleich).
- Nach der Freigabe: den `stand_sha256` des letzten Eintrags in `docs/mcp-vertrag.json` als Marke setzen (Ablauf in `docs/RUNBOOK-MCP-UPDATE.md`).

### F. Rechtstexte und Anbieter-Einstellungen (OW-J u.a.)

- Rechtstexte: Datenschutz, AGB, Mindestalter, Informationspflicht gegenueber dem Angerufenen, Einwilligung bei Gesundheitsangaben, Loeschfristen.
- Entscheidung, ob vor dem Waehlen eine Einwilligungs-/Zusicherungsformel in die Karte gehoert (Rechtstext, bewusst nicht gebaut).
- ElevenLabs: `retention_days` und Stimme einstellen (Aufbewahrung gilt als Launch-Blocker).
- Usage Policies vor der Attestation live gegenlesen, danach Nachpruef-Vermerk und den Test zu `UNFETCHABLE_SOURCE_URLS` anpassen.

## 5. Referenzen

| Datei | Wofuer |
|---|---|
| `tasks/kickoff-openai-technik-2.md` | Auftrag der Kette (Regeln, Owner-Grund-Regel, Schlussabnahme) |
| `tasks/kickoff-openai-technik-2-weiter.md` | Uebergabe fuer die naechste Sitzung (Start hier) |
| `tasks/openai-technik-2-stand.md` | Fortlaufendes Protokoll aller Phasen, Entscheidungen, Laeufe |
| `tasks/PLAN-OPENAI-TECHNIK-2.md` | Strategie-Plan mit allen Phasen und Pre-Mortems |
| `tasks/openai-audit/00-openai-anforderungen.md` | Die 100 Anforderungs-IDs |
| `tasks/openai-t2/zwischenmessung-1.md` | Zwischenmessung 1 (Tabelle aller 100 IDs). Berichte/Specs der gemergten Phasen sind aufgeraeumt (27.09.), Historie in git |
| `.claude/workflows/runs/openai-t2-phase.js` | Phasen-Vorlage (per-run-Kopie je Phase, Pin mit `pin-phase.py`; Beispiel `openai-t2-20.js`) |
| `.claude/workflows/runs/openai-t2-zwischenmessung.js` | Messskript fuer die Schlussabnahme |
| `docs/OPENAI-TOOL-INVENTORY.md` | Werkzeug-Inventar fuer OpenAI |
| `docs/OPENAI-POLICY-ABGLEICH.md` | Abgleich mit den Usage Policies |
| `docs/OPENAI-AUTH-ABWEICHUNGEN.md` | Auth-Abweichungen fuer OpenAI |
| `docs/OPENAI-REVIEWER-ACCESS.md` | Reviewer-Zugang (EN/DE) |
| `docs/RUNBOOK-MCP-UPDATE.md`, `docs/mcp-vertrag.json` | Kompatibilitaetsvertrag und Aenderungsablauf |
| `docs/RUNBOOK-LAB-LIVE.md` | Website Labor -> Live |
| `scripts/briefing-bench/README.md` | Werkzeugtext-Messung (A4) |
| `scripts/seed-reviewer-demo.mjs` | Beispieldaten fuer das Reviewer-Konto (D3) |
| `apps/web/src/pages/support.astro` | Support-Seite |
| `PLAN-SECURITY.md` | Deploy-Vorbedingungen, akzeptierte Grenzen, Rueckbau-Anleitungen |
