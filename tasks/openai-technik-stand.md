# Stand: OpenAI-Einreichung, technische Restarbeiten

Gedaechtnisdatei des Lean Lead. Auftrag: `tasks/kickoff-openai-technik.md`.
Massgeblicher Vorrat: `tasks/openai-audit/00-openai-anforderungen.md` (100 IDs).
NICHT massgeblich: `00-mcp-spec.md` (andere Norm, Widerspruch bei destructiveHint).
Plan: `tasks/PLAN-OPENAI-TECHNIK.md` (1315 Zeilen, Stufe 1 fertig).

## ERGEBNIS (2026-09-21, Schlussabnahme P11 an master `21ff856`)

**41 von 84 technischen IDs erfuellt.** Voller Befund: `tasks/openai-technik-schlussabnahme.md`.

| Status | Anzahl |
|---|---|
| ERFUELLT | 41 |
| TEILWEISE | 22 |
| NICHT ERFUELLT | 3 (T-14, T-17, X-9) |
| GEGENSTANDSLOS | 13 |
| GEGATET (wartet auf Owner) | 4 (T-30, T-31, O-4, O-18) |
| NICHT IN UNSERER HAND | 1 (T-11) |
| ausgeschlossen (reine Owner-Punkte) | 16 |

Vollstaendigkeit geprueft: genau 100 IDs. Technisch sind 84, nicht die geplanten 72 - die
Liste gewinnt. Die Kette hat den Kickoff-VORRAT (~40 Punkte) abgearbeitet; die Schlussabnahme
misst ALLE 84 technischen IDs und findet dabei auch Luecken, die nie im Vorrat standen.
**Nichts davon ist live** - live laeuft `728f053`. Merge ist nicht Deploy.

## DIE OWNER-LISTE (kompakt, nach Dringlichkeit)

**A. Deploy - alles liegt auf master `21ff856`, live ist `728f053`**
1. master nach `upstream` pushen und deployen. DANACH SOFORT: im Claude-Connector die Werkzeuge
   zaehlen, Claude Desktop (stdio) starten und pruefen, dass die Werkzeuge erscheinen, und
   pruefen, dass `/healthz` keinen `configHash` mehr zeigt. Fuer `securitySchemes` gibt es
   KEINEN Abschalter - Rueckweg waere nur ein Revert-Deploy.
2. **Bis zum Deploy ist ein Sicherheitsbefund live:** aus `configHash` auf `/healthz` laesst sich
   zurueckrechnen, wie Land-Gate und Stundenlimit eingestellt sind.
3. Dein lokales `docs/RUNBOOK-LIVE-WERTE.md` nach dem Deploy nachziehen: `configHash` steht dann
   nicht mehr in `/healthz`, sondern im Boot-Log und unter `GET /api/admin/deploy-info` (Admin-Sitzung).
4. Branch `phase/openai-p10b-http` NIE pushen (Zwischen-Commits mit Produktionswerten); mit
   `git branch -D` loeschen. Die uebrigen zehn `phase/openai-p*`-Branches sind gemergt.
5. Bei JEDEM kuenftigen Bump von `@modelcontextprotocol/sdk` zuerst
   `test/openai-p3-security-schemes.test.js` fahren (einzige Sicherung der privaten SDK-Naht).

**B. Entscheidungen**
6. **Einreichung MIT oder OHNE Widget-UI.** MIT UI sind T-30/T-31 offen: `_meta.ui.domain` ist laut
   OpenAI "required when submitting a plugin with UI" und gehoert an den Resource-Inhalt - Claude
   und OpenAI erwarten dort aber VERSCHIEDENE Formate, und der zustandslose Transport kann den Host
   nicht unterscheiden. Braucht eine Live-Probe in Claude plus eine Loesung fuer die
   Host-Unterscheidung. OHNE UI entfallen T-30, T-31, X-3, X-7 und die Screenshots - aber
   `MCP_UI_ENABLED` ist global, Claude-Nutzer verloeren die Live-Karte.
7. **O-27:** `place_call` nennt in modell-lesbaren Beschreibungen fremde Produkte ("not as
   Claude/Gemini") und Werkzeugklassen ("calendar, mail, files, chat"). Die Texte sind an
   `convo-bench` kalibriert - aendern nur mit Vorher-Messung (`npm run convo-bench`, n>=5).
8. **Drei Einzeiler am Live-Auth-Pfad** (je fail-closed, aber live-wirksam):
   `requiredClaims: ['exp']` (ein Token ohne `exp` wird heute unbefristet angenommen);
   `MCP_AUTH` trimmen (`" oauth"` faellt heute still auf Legacy); Boot-Sperre gegen
   Nicht-OAuth in Produktion (O-7).
9. Legacy-Token-Pfad abschalten (T-5)? `answer_consult` `idempotentHint` auf `true`?

**C. Messungen, die nur du machen kannst**
10. **ChatGPT Developer Mode, EIN Mitschnitt:** Origin-Header, Quell-IP, Capabilities.
    `/mcp` weist heute `Origin: https://chatgpt.com` mit 403 ab (CORS, T-29) - sendet ChatGPT den
    Header browserseitig, ist das ein harter Blocker.
11. Echtes Access-Token dekodieren: `aud`, `scope`/`scp`, UserInfo `email_verified` (T-9, T-12, T-16).
12. Challenge-Token fuer `/.well-known/openai-apps-challenge` setzen (Route fertig, O-4/O-5).
13. Render-Dashboard: `MCP_AUTH_TOKEN` gesetzt? `MCP_UI_ENABLED`? (`CONSULT_ENABLED` ist live AN -
    `render.yaml` sagt `false`, ist aber nicht die Wahrheit.)
14. `retention_days` beim Anbieter steht auf -1 (unbegrenzt) - Launch-Blocker (O-6).

**D. Website `sundartha.com` (`apps/web`, nur ueber `staging`/Labor)**
15. Referrer-Policy, `security.txt`, `POST /mcp` -> 200 mit 0 Byte statt 404, die
    Challenge-Route liefert eine 6-KB-HTML-404-Seite. HSTS-preload ist faktisch irreversibel.

**E. In der Schlussabnahme neu gefunden (technisch offen, nie im Vorrat)**
16. **Rate-Limit 120/min PRO IP** - hinter OpenAIs gemeinsamen Egress-IPs drosselt es ALLE
    ChatGPT-Nutzer zusammen.
17. `cancel_call` ohne Timeout (T-27); kein Schutz, der eine publizierte Tool-Definition aufrufbar
    haelt (T-33); keine serverseitige Bestaetigung fuer `place_call` (N-10).
18. Namen/Beschreibungen: `get_transcript` liefert kein Transkript (N-12); `get_calendar`
    verschweigt Demo-/Leer-Kalender (N-13); `briefing`/`context` als zwei parallele Kanaele (N-14).
19. Datenminimierung: `OUTBOUND_FROZEN` steht im Fehlertext, Action-Item-ID in der Antwort, rohe
    Transportfehler (O-13); kein Ausschluss von Restricted Data (O-14) und Art.-9-Inhalten (O-15);
    "Bitte Tarif anpassen" in einer Tool-Antwort (O-20); Loeschen nur per CLI (O-6).
20. Keine Support-URL, Rechtsseiten nur deutsch (O-7); Zweckbindung gegen Werbeanrufe fehlt (O-19).

**F. Einreichungsunterlagen**
21. `docs/OPENAI-TOOL-INVENTORY.md` ist einreichungsfertig (zweimal unabhaengig geprueft).
    Von `docs/OPENAI-AUTH-ABWEICHUNGEN.md` NUR die englischen Abschnitte einreichen.
22. `security.txt` laeuft am 2027-09-01 ab, kein Test bewacht das.
23. Groesstes Einzelrisiko, ausserhalb jeder Phase: ob ein Plugin, das echte Telefonanrufe
    ausloest, bei OpenAI ueberhaupt zulaessig ist, ist nirgends dokumentiert (U-10).

## Kettenstand

| Stufe | Was | Status |
|---|---|---|
| 1 | Strategiedokument `tasks/PLAN-OPENAI-TECHNIK.md` | FERTIG (wf_3ad3e1bf-061, 7 Agenten) |
| 2 | Phasen-Workflows, eine Bahn zur Zeit | **FERTIG**: P0-P10b gemergt, P9 bewusst nicht gebaut |
| 3 | Schluss-Agent P11: technische IDs gegen die 100er-Liste | **FERTIG** - 41 von 84 (wf_aed13dd9-21e) |

Git-Basis bei Kettenstart: `728f053` (master).
caffeinate PID 5869, `-t 7200`, gestartet 17:10 -> Ablauf ~19:10, erneuern.

## Phasen aus dem Plan (13, eine Bahn zur Zeit)

| # | Titel | Status |
|---|---|---|
| P0 | Messen und entscheiden (kein Code) | FERTIG + korrigiert |
| P1 | Annotationen und Beschreibungen | **GEMERGT 72fbc78** |
| P2 | Registrierweg vereinheitlichen: `title` + `toolInvocation` | **GEMERGT 91ef2d2** |
| P3 | `securitySchemes` an der SDK-Grenze (nur Weg B, Low-Level-Override) | **GEMERGT 8f8de37** |
| P4 | Zwei echte Defekte: `get_transcript` + Server-`instructions` (+ O-27 Teil 1) | **GEMERGT 03bc3a0** |
| P5a | Datenminimierung, rein subtraktiv | **GEMERGT 3b4e108** |
| P5b | Datenminimierung am Geldpfad (`failure_reason`, `consultPermissionHint`) | **GEMERGT 4e81f42** |
| P6 | Auth I: `WWW-Authenticate` auf allen 401-Pfaden | **GEMERGT 5bd5aa9** |
| P7 | Auth II: geschrumpft zur Dokumentationsphase (kein Scope da) | **GEMERGT f769841** |
| P8 | Widget-UI | **GEMERGT dcb2d3c** (Ergebnis: Richtigstellung, kein Code) |
| P9 | Transport/CORS | **NICHT GEBAUT** - gegatet an OW-4 (D0-4 OWNER), kein Workflow gestartet |
| P10a | Randpunkte I: Hygiene (Tests, Kommentare, Doku, Inventar) - kein Live-Verhalten | **GEMERGT 76a6072** |
| P10b | Randpunkte II: HTTP-Oberflaeche NUR Hauptserver (`/healthz`, Header) - Live-Verhalten | **GEMERGT 21ff856** (Squash) |
| P11 | Schlussabnahme (kein Code) | **FERTIG** - 41/84 |

## Betriebswissen (teuer belegt, gilt fuer alle Phasen)

- **Testkommando:** `npm test -- -- --test-concurrency=4`. Nur der DOPPELTE `--`-Trenner kommt an;
  `npm test --test-concurrency=4` ergibt argv `["regression"]`, `npm test -- --test-concurrency=4`
  wird von `extraArgsFrom` (`test/i18n-catalog-run.mjs:103-106`) verworfen. In P0 am echten Lauf
  zu belegen.
- Exit-Code luegt: nur `# pass` / `# fail` zaehlen.
- Diff-Basis in jeder Uebergabe: `git diff master...phase/<branch> -- <pfad>`.

## Korrekturen am Kickoff-Vorrat (aus Stufe 1, belegt)

1. Die Rohzeilen-Durchreichung (`last_transcript_lines`) steht im Kickoff unter **O-14**; O-14 ist
   in der massgeblichen Liste "Restricted Data verboten". Richtig ist **O-13**. Gleiche
   Fehlerklasse wie die destructiveHint-Verwechslung.
2. Der Kickoff-Befund "falscher Kommentar bei `src/mcp-tools.js:163`" ist **falsch**: `:163`
   spricht ueber Felder und bleibt wahr; der Roh-Transkript-Satz steht bei `:193-195` und ist dort
   korrekt. Gestrichen.
3. **O-4/O-5 ist ueberholt**: die Challenge-Route existiert vollstaendig und getestet
   (`src/app.js:184-187`, 9/9 gruen), fail-closed 404 ohne Token. Offen ist NUR die Token-Eingabe
   des Owners.
4. ~~**`widgetDescription`** (X-3) existiert in keiner Quelle (0 Treffer)~~ **STRITTIG seit P8:**
   der P8-Planer sagt, die OpenAI Apps-SDK-Reference fuehrt `_meta['openai/widgetDescription']`
   am Resource-Inhalt. Die Stufe-1-Aussage "0 Treffer" war dann eine Suche im REPO, nicht in der
   Primaerquelle. Bleibt trotzdem ungebaut: optional und nicht in der 100er-Liste.
   `locale` ist X-4 und ein Client-Feld.
5. **N-15** betrifft den Chatverlauf des Hosts, nicht ein Telefontranskript -> raus aus P5.
6. **`last_transcript_lines` wird NICHT entfernt**: Live-Konsument
   `src/ui/widgets/call.html:167/:551/:584`, und waehrend eines laufenden Anrufs existiert keine
   Zusammenfassung (`AWAIT_SUMMARY_PLACEHOLDER`). Der Injektions-Befund bleibt offener
   O-13-Teilbefund.

## P0-Ergebnis (Datei: `tasks/openai-p0-entscheidungen.md`)

| Punkt | Status | Ergebnis |
|---|---|---|
| D0-1 UI | ENTSCHIEDEN | Ist MIT UI, Default `true`, `=false` bricht nichts. ABER T-34 und T-23/X-7 sind NICHT additiv |
| D0-2 search/fetch | ENTSCHIEDEN | Deep Research nicht angestrebt -> T-24/T-25 gegenstandslos |
| D0-3 Legacy-Token | ENTSCHIEDEN | Prod laeuft auf `oauth`; Legacy wird GEHAERTET statt entfernt |
| D0-4 CORS | OWNER | server-/browserseitig nur indiziert -> fail-closed, keine Zeile CORS |
| D0-5 securitySchemes | ENTSCHIEDEN | Feld existiert in KEINER SDK-Version (1.29.0 installiert, 1.30.0 auch nicht) -> nur Weg B |
| D0-6 T-14 Ausloeser | ENTSCHIEDEN | kein Ausloesepfad, weder HTTP noch stdio -> T-14 gegenstandslos (waere toter Code) |
| D0-7 Scope | ENTSCHIEDEN | kein Scope konsumiert/beworben -> T-12 entfaellt; Audience+Tenant decken teilweise |
| D0-8 skybridge | OWNER | kein Beleg in der Anforderungsliste; der String stammt aus Hermes' EIGENEM Code |

**Planaenderungen:** T-14, T-12, T-24/T-25 entfallen. P3 fixiert auf Weg B (Low-Level-Override
nach `registerTools()`), weil `registerTool()` unbekannte Felder STILL VERWIRFT - Test muss den
echten `tools/list`-Output pruefen. P6 schrumpft: Haertung additiv ueber eine neue
`PRODUCTION_FOOTGUNS`-Zeile, fasst KEINE Testdatei an (Plan-Zahl "37 von 53" war falsch, richtig
8 von 21). P7 schrumpft zur Dokumentationsphase. P8: T-23+X-7 nur im ChatGPT-Adapter erweitern,
NICHT in der geteilten Fabrik; T-34 ist NICHT additiv (`uiResourceUri()` sitzt in der geteilten
Fabrik `src/ui/contract.js:21/92/96/105`, `toolMeta()` bekommt `language` gar nicht
`src/mcp-tools.js:723-724`) -> gegatet. T-18 wandert zu P2 (kein SDK-Problem, `title` wird
bereits nativ Top-Level ausgeliefert). T-22 ist ueber den in Hermes live bewiesenen `_meta`-Weg
baubar.

**Baseline vor jeder Aenderung:** Suite 6153 korrigiert / 6152 gruen, der eine rote Test war ein
Flake (isoliert nachgemessen 18/18). Die CLAUDE.md-Zahl 3044 ist veraltet.

**Nachmesser-Urteil: korrekturbeduerftig.** Alle 8 Entscheidungen halten, aber 3 Begruendungen und
die Baseline-Zahl waren falsch belegt (laeuft in wf_e3cd5d37-5c5):
1. Tool-Flaeche NICHT "9 bzw. 12". Richtig: DEFAULT_PROFILE 9; OWNER_PROFILE mit allen Schaltern
   12; zahlender Plan hoechstens 11 (`PAID_PLAN_PROFILE allowCalendar:false`, `src/plans.js:107-111`);
   HEUTIGE Produktion 10 fuer den Owner / 9 sonst (`CONSULT_ENABLED=false`, `render.yaml:424-425`);
   stdio 10. Ueber die echte Route gemessen: **10**.
2. "`err.httpStatus` wird repo-weit nirgends ausgelesen" ist falsch (`src/mcp-tools.js:1070/:1072`).
   D0-6-Ergebnis bleibt, Begruendung war falsch.
3. "401 + Challenge" ist zu breit: der 401 faellt immer, die Challenge NUR im oauth-Zweig
   (`src/auth.js:66-71` vs. `:102/:110/:113`). Genau diesen Satz sollte P7 als Beleg fuehren.
4. D0-3-Kernbeleg (curl gegen die Live-URL) ist nicht nachpruefbar dokumentiert -> "indiziert",
   nicht "belegt". Ergebnis bleibt (fail-closed ohnehin).

## Phasenprotokoll

| Phase | Branch | Run-ID | Verifikation | Merge |
|---|---|---|---|---|
| P0 | (kein Code) | wf_22feb748-1fa | korrekturbeduerftig -> korrigiert, sauber | - |
| P1 | phase/openai-p1-annotationen | wf_126ec7dc-bfc | keine Blocker | **72fbc78** |
| P2 | phase/openai-p2-registrierweg | wf_511306eb-43f (+Rettung) | keine Blocker, Mutationsprobe bestanden | **91ef2d2** |
| P3 | phase/openai-p3-securityschemes | wf_b1fe4ed2-d10 (+Korrektur) | keine Blocker; Lead hat gegen den Bau entschieden | **8f8de37** |
| P4 | phase/openai-p4-defekte | wf_728d83ae-855 | keine Blocker; Defekt auf master reproduziert | **03bc3a0** |
| P5a | phase/openai-p5a-datenminimierung | wf_77126619-a80 | keine Blocker; Gegenprobe faerbt 8 Tests rot | **3b4e108** |
| P5b | phase/openai-p5b-geldpfad | wf_8039cf66-52b (+Kommentare wf_43829b1f-bc2) | keine Blocker; Geldpfad-Riegel haelt | **4e81f42** |
| P6 | phase/openai-p6-auth-challenge | wf_6661ce17-2ba (+Doku wf_74f625b9-3c4) | keine Blocker; 321 Draht-Faelle je Baum, 0 Abweichungen | **5bd5aa9** |
| P7 | phase/openai-p7-auth-belege | wf_047b628a-4fc (+Korrektur wf_3e2ef9d5-e1c) | erst ABGELEHNT (10 Ueberbehauptungen), nach Korrektur mergefaehig | **f769841** |
| P8 | phase/openai-p8-widget-ui | wf_ae38c1e8-8cc (+Kommentare wf_f943b1c2-16c) | keine Blocker; src/ AST-identisch zu master | **dcb2d3c** |
| P9 | - | - | nicht gebaut (OW-4) | - |
| P10a | phase/openai-p10a-hygiene | wf_c7f027e5-273 (+Korr. wf_0c531944-cfc, +Rest wf_54847109-f62) | **ZWEITE ABLEHNUNG**, nach 2 Korrekturrunden mergefaehig | **76a6072** |
| P10b | phase/openai-p10b-http | wf_089e2d14-828 (+Verweise/Abnahme wf_169c5d27-8ca) | keine Blocker; Health-Check 200 unveraendert, Admin-Route fail-closed | **21ff856** (Squash) |

### P10b - Merge-Technik (Betriebswissen)

Squash-Merge scheiterte zuerst am pre-commit-Hook: der lintet den GANZEN Arbeitsbaum inkl.
UNGETRACKTER Dateien, und `docs/architektur/erzeuge-karte.mjs` (ungetrackt, Owner) hat 35 Fehler.
`--no-ff`-Merges waren davon nie betroffen, weil ein Merge-Commit den pre-commit-Hook NICHT
ausloest. Loesung ohne `--no-verify`: `git reset --merge HEAD` (nimmt nur die gestagten Dateien
zurueck, laesst die ungestagte `tasks/lessons.md` des Owners stehen - vorher gesichert, danach per
`cmp` byte-identisch bestaetigt), dann Squash-Commit in einem SAUBEREN Hilfs-Worktree
(node_modules per Symlink), dann `git merge --ff-only` auf master. Hilfs-Worktree und
Hilfs-Branch danach entfernt.

Testzahl-Raetsel aufgeklaert: kein Test verschwunden. master hatte 6242 (nicht 6243 - alter
Messwert), die neue Datei 6 Faelle (nicht 7). 6242 + 6 = 6248, auf den Fall genau.

### P10a - das zweite externe Dokument ist durchgefallen, und es ist ein Muster

Code, Tests und Lint waren sauber: `src/` unberuehrt; `eslint-suppressions.json` -44 Zeilen als
ECHTE Verschaerfung nachgemessen (strikter eslint-Lauf mit leerer Suppressions-Datei: 9/16/6/1
Befunde auf master -> 0/0/0/0 auf dem Branch); kein Bestandstest schwaecher, `ohneWidgetMeta()`
jetzt STAERKER (exakte Schluesselmenge + Kontrollfall); neue Tests per Mutation als wirksam belegt.
Die Werte im Inventar stimmen alle am Draht (12/10/9/11/9/10).

Durchgefallen ist das **Werkzeug-Inventar fuer OpenAI**: acht Falschaussagen in den BEGRUENDUNGEN,
einige im WIDERSPRUCH zu den eigenen Werkzeug-Beschreibungen, die derselbe OpenAI-Pruefer sieht:
`answer_consult` "wird im Anruf gesprochen" (falsch: Hintergrund-Fakt an den Agenten) und "ein
zweiter Aufruf spricht erneut" (falsch: 409 already_answered); `cancel_call` "beendet einen echten
Anruf" (die eigene Beschreibung sagt: nicht garantiert); `get_calendar` "Daten stammen aus einem
Anruf" (falsch: Demo-Kalender, Buchen im Gespraech abgeschaltet); die allgemeine Regel "ohne
Berechtigung nicht registriert" (falsch: `place_call` erscheint auch ohne Outbound-Recht).

**MUSTER, als Lehre fuer den Rest der Kette:** BEIDE externen Dokumente (P7, P10a) sind in erster
Fassung durchgefallen - beide Male, weil Begruendungen aus Plausibilitaet geschrieben wurden statt
aus dem Code. Die Code-Phasen sind dagegen alle beim ersten Pruefer durchgegangen. Ab jetzt:
externe Dokumente schreibt Opus, und fuer JEDE Aussage ueber ein Werkzeug wird ZUERST der Handler
und die eigene `tools/list`-Beschreibung gelesen. Gilt fuer P10b und P11.

### P8 - T-30/T-31 sind NIRGENDS erfuellt, und das verschiebt die UI-Entscheidung

**Ergebnis der Phase ist eine Richtigstellung, kein Code.** Der `src/`-Diff ist reiner Kommentar -
per SYNTAXBAUM-Vergleich (acorn, ohne Positionen) aller 5 Dateien bewiesen, mit
Positiv-Kontrolle gegen den zurueckgenommenen Commit 4adee50 (dort meldet dasselbe Werkzeug
"abweichend"). Am Draht byte-identisch: 19/19 Dateien, HTTP + echter stdio-Kindprozess
(1.150.398 Byte stdio-Ausgabe identisch).

**Drei Befunde, alle unabhaengig bestaetigt:**

1. **T-30 und T-31 sind NICHT erfuellt - nirgends.** Plan und Phase 0 lagen falsch. OpenAI-Referenz
   (developers.openai.com/plugins/reference), woertlich: "`_meta.ui.csp` | **Resource contents**"
   und "`_meta.ui.domain` | **Resource contents** | ... (**required when submitting a plugin with
   UI**; must be unique per plugin)". Die MCP-Apps-Spezifikation typt `McpUiToolMeta.csp` als
   `never`: "Hosts read it from the `resources/read` content item ... and ignore it here."
   Hermes setzt beides am TOOL-DESKRIPTOR (wirkt bei keinem Host), der Resource-Inhalt traegt nur
   `{uri, mimeType, text}`, und auch `resources/list` hat kein `_meta`. Der CSP-INHALT waere
   korrekt (Widget-HTML: 0 externe URLs, kein fetch/XHR/WebSocket) - er steht nur am falschen Ort.
   T-23 ist dagegen erfuellt (`_meta.ui.resourceUri` ist der Standard-Schluessel).

2. **Der Kern: `domain` ist HOST-ABHAENGIG.** Claude erwartet
   `sha256(connector-URL)[:32].claudemcpcontent.com`, OpenAI einen eigenen Origin. Ein
   gemeinsamer `resources/read`-Weg kann nicht beide Formate zugleich bedienen - er muesste
   wissen, welcher Host fragt. Genau diese Unterscheidung faellt am zustandslosen Transport weg.
   Die in Runde 1 gebaute Nachruestung wurde vom Safety-Review ZWEIMAL abgelehnt und
   zurueckgenommen: sie haette Claudes `resources/read` ohne Live-Beleg veraendert. Richtig so.

3. **Der ChatGPT-Adapter ist fuer echte Clients tot - von Anfang an.** `/mcp` ist zustandslos
   (seit P1, 6c251f5); die Capability aus `initialize` kommt beim naechsten Request nicht an. Der
   Adapter kam danach (bf4026c, 26.06.) und war fuer echte Clients nie erreichbar. Es gibt einen
   Weg (`params.capabilities` im selben Request, `src/routes/mcp.js:155`), den kein
   standardkonformer Client geht. Damit ist D0-8 (skybridge) fuer P8 gegenstandslos -
   "skybridge" kommt in der aktuellen OpenAI-Doku gar nicht mehr vor (0 Treffer in 4 Seiten).

**`widgetDescription`:** der P8-Planer hatte recht - die OpenAI-Referenz fuehrt
`_meta['openai/widgetDescription']` am Resource-Inhalt. Meine Stufe-1-Aussage "existiert in keiner
Quelle" war eine Suche im REPO, nicht in der Primaerquelle. Optional, nicht in der 100er-Liste,
bleibt ungebaut.

### P7 - die Abnahme hat NEIN gesagt, der Bericht hatte JA gesagt

Genau der Fall, fuer den die Abnahmeregel existiert: der Workflow meldete PASS, der
Phasenbericht "Merge-Empfehlung ja". Der unabhaengige Pruefer (Leseverbot fuer beide) fand
**zehn Ueberbehauptungen in einem Dokument, das an OpenAI gehen soll**. Der Pruefer gewinnt.

- **T-14 falsch geurteilt:** der massgebliche Wortlaut sagt, Auth-UI im Gespraech gibt es NUR
  ueber das Fehlerergebnis mit `_meta`. Das Dokument liess "nur" weg und urteilte "nicht
  anwendbar". Richtig: **bewusst nicht erfuellt**, ChatGPTs Reaktion auf einen 401 mitten im
  Gespraech UNKNOWN.
- **Die englische Fassung war glatter als die deutsche** - vier Einschraenkungen und ein UNKNOWN
  fehlten. Das ist der Teil, den OpenAI liest.
- Das Dokument berief sich gegenueber OpenAI auf die INTERNE deutsche Paraphrase als
  "requirement text", statt auf developers.openai.com/plugins/build/auth.

Die Anbieter-Messungen trugen alle (per `cmp` byte-identisch nachgeprueft), der neue Test traegt.
Falsch waren Urteile und Formulierungen.

**Echter Haertungsbefund aus P7 (nicht behoben, Owner):** `jwtVerify` in `src/auth.js` verlangt
`exp` NICHT (kein `requiredClaims`). jose prueft `exp`/`nbf` nur, wenn der Claim vorhanden ist. Ein
vom Anbieter signiertes Token OHNE `exp` wuerde **unbefristet** angenommen. WorkOS stellt in der
Praxis `exp` aus - der Code verlangt es aber nicht. Haertung: `requiredClaims: ['exp']`.

**Sandbox-Beobachtung:** der Bau-Agent wollte fuer eine Gegenprobe `src/auth.js` lokal
abschwaechen (`issuer` weg, `clockTolerance` riesig). Der Klassifizierer hat das als
"Auth Weaken" BLOCKIERT - auch fuer einen Test. Per `cmp` nachgemessen: `src/auth.js` im Worktree
byte-identisch zu master, nichts zurueckgeblieben. Die Beweisform "Gegenprobe durch Abschwaechen
von Auth-Code" ist in dieser Umgebung nicht verfuegbar; Ersatz ist das Lesen der Zusicherungen.

### P6 - Auth am Draht, fail-closed belegt

**321 Spawn-Faelle je Baum + 40 In-Process**, master gegen Branch, alle Auth-Modi (oauth, token,
Legacy "", off, und kaputte Werte wie `bogus` / `" oauth"`), mit Randfaellen (leerer Header,
`Bearer` ohne Wert, `bearer`/`BEARER`, doppelte Leerzeichen, Tab, Token im Query-String, doppelter
Header, alg=none, abgelaufen, falsche aud/iss/Key). Ergebnis: **0 Abweichungen im Statuscode,
0 im Body, 0 in anderen Headern.** Kein 401 im Branch ohne Challenge. Kein vorher abgelehnter
Request kommt durch.

**Live-OAuth-Zweig byte-identisch** - mechanisch belegt: master-`discoverJwksUri`/`verifyOauth`
per perl-Umbenennung umgeschrieben ergibt exakt den Branch (bis auf Kommentare). jwtVerify-Optionen,
JWKS, iss/aud/exp und Fehlerverhalten unveraendert. 69 oauth-401 mit identischem Header und Body.

**T-13 ehrlich gezaehlt:** war im OAuth-Modus schon auf master erfuellt. P6 aendert den
T-13-Stand fuer die Einreichung NICHT - sein Beitrag ist die Challenge im token-/Legacy-Zweig
(T-5-Haertung). In der Schlussabnahme nicht doppelt als P6-Leistung zaehlen.

**render.yaml:** `MCP_AUTH` von `value: ""` auf `sync: false`. Das SENKT ein Risiko: auf master
haette ein Blueprint-Sync `MCP_AUTH` auf `""` gesetzt, und zusammen mit
`MCP_AUTH_TOKEN generateValue: true` waere Produktion still auf statisches Bearer
zurueckgefallen. UNKNOWN bleibt, ob der Prod-Service ueberhaupt an einen Blueprint gebunden ist.

**Zwei aeltere Befunde, beim Messen aufgefallen (NICHT von P6, nicht behoben, fuer den Owner):**
- `MCP_AUTH` wird nicht getrimmt: **`" oauth"` (mit Leerzeichen) wird STILL zu Legacy.** Ein
  Tippfehler im Dashboard setzt Produktion damit von OAuth auf statisches Bearer herab. Kein
  Fail-open (das Token wird weiter verlangt), aber eine stille Herabstufung.
- Der oauth-Zweig akzeptiert ein gueltiges JWT auch OHNE `Bearer `-Praefix.

**PLAN-SECURITY.md trug drei falsche Aussagen** (TENANT_REJECT-Behauptung, "erst nach P6
erkennbar", verschwiegene Umbenennung im Live-Pfad). Werden vor dem Merge korrigiert - die Datei
ist laut CLAUDE.md Pflichtlektuere vor jeder Security-Arbeit.

### P5b - der Geldpfad haelt, und eine ID wurde NICHT abgehakt

**Geldpfad am Draht belegt:** ein Anruf wurde ueber den echten Lifecycle in den Fehlerfall
gebracht (POST /voice/status, CallStatus=failed, SipHangupCause=403, KEIN echter Anruf). Im Store
steht `not-placed:invite-403`; ueber `/mcp` liefern `get_call_status` UND `await_call_event`
`failure_reason = "not-placed"`. Die `instructions` nennen dasselbe Token auf HTTP und stdio, beide
Seiten aus derselben Konstante `NOT_PLACED`. Der Test prueft gegen die Konstante - das Literal
"not-placed" kommt in der Testdatei 0-mal vor. Mutationsprobe: Split zusaetzlich am Bindestrich
(aus "not-placed" wuerde "not") -> 7 Tests rot.

**Gekuerzt nur an der MCP-Kante** (`callOutcomeView`). Store, Ausfall-Marker, Log und
`/api/calls/:id` tragen das volle Token. Reste-Suche ueber fuenf Werkzeuge, Text UND
`structuredContent`: 0 Treffer fuer SIP-/Carrier-Reste, mit Positiv-Kontrolle am API-Wert.

**O-27 BLEIBT OFFEN - ausdruecklich nicht abhaken.** Der Plan hatte die Umformulierung von
`consultPermissionHint` als O-27-Nachweis verbucht. Planer UND Pruefer haben das unabhaengig
voneinander zurueckgewiesen: O-27 betrifft Felder, die beeinflussen, wie das Modell ANDERE
Plugins auswaehlt oder benutzt (`00-openai-anforderungen.md:122`); `consultPermissionHint`
betrifft die Berechtigung des EIGENEN Connectors. Die Aenderung passt eher zu N-8/N-10 (das
Draengen auf "Allow" unterlief die manuelle Bestaetigung vor Schreibaktionen). Gebaut wurde sie
trotzdem, weil sie sachlich richtig ist.
**Die eigentliche O-27-Oberflaeche:**
- `src/mcp-tools.js:949` - `place_call.briefing`: "could you answer it yourself during the call
  (calendar, mail, files, chat)?" - dieselbe Aufzaehlung fremder Werkzeugklassen, die P4 aus den
  `instructions` gestrichen hat, mit genau dieser Begruendung.
- `src/mcp-tools.js:949` "not as Claude/Gemini" und `:1018` "NEVER as Claude/Gemini" nennen
  Fremdprodukte in modell-lesbaren Beschreibungen.
Nicht gebaut: beide Texte sind an `convo-bench` kalibriert; aendern ohne Vorher-Messung
(`npm run convo-bench`, n>=5) verletzt `bench-must-reproduce-defect`. -> OWNER-Liste.

**Fuenf falsche Kommentare zum `failure_reason`-Fluss** - einer davon DURCH P5b falsch geworden
(`src/mcp-server-info.js:84-86` behauptete, das Modell sehe `not-placed:invite-403-D51`), einer von
P5b neu geschrieben und ueberbehauptet (`src/mcp-tools.js:158-164`), zwei von P5b faelschlich als
"weiter wahr" bestaetigt (`src/telephony/call-lifecycle.js:31-32/:38-39`), einer Bestand
(`src/ui/widgets/call.html:272-273`). Werden vor dem Merge korrigiert.
**Damit sind es in dieser Kette neun luegende Kommentare.** Das Muster: sie sitzen gehaeuft dort,
wo sich Verhalten geaendert hat und der Kommentar nicht mitgezogen wurde.

### P5a - der Plan kannte EINE Stelle, es waren SIEBEN

Schema, Pick-Funktion, Stufe-0-Textblock, Tool-Beschreibung, `MCP_TEXTS` in drei Sprachen,
Widget-Markup, `WIDGET_DICT` in zwei Sprachen. **Nur das Schema zu aendern haette woertlich
"undefined" in den Chat geschrieben** - der Textblock liest die Felder getrennt.

Das Plan-Abnahmekriterium war ein `grep`, das die PROSA der Tool-Beschreibung nicht trifft: beide
greps waeren 0 gewesen, waehrend `tools/list` weiter zwei Felder verspricht, die nicht mehr
kommen. Ersetzt durch einen Draht-Beweis.

Am Draht gemessen (HTTP + stdio): Text ohne `undefined`, Schema ohne die Felder, Beschreibung
ohne die Zusage. Auf master sind beide da. **Positiv-Kontrolle:** `/api/state` liefert sie
weiter - die Whitelist filtert echt, der Upstream ist nicht trivial leer. Widget rendert sauber
(entferntes Feld -> kein Schluessel -> kein Knoten -> keine Leerzeile), 0 verwaiste
Woerterbuch-Schluessel. Lint-Pin 509 -> **508**, Verschaerfung.

**Offen:** `/api/state` behaelt `voiceEngine`/`model`. Nach Clean-Code waere das jetzt toter Code
(0 Konsumenten in `apps/`), bewusst stehen gelassen: ausgelieferter REST-Kontrakt hinter der
Tenant-Sitzung und Betreiberkanal, der den Diagnoseverlust abfedert.

**Eigener Fehler, behoben:** im Phasen-Skript stand an zweiter Stelle noch die Grundlinie
6153/6152, waehrend der Rahmen 6195 sagte. Ein Agent kann mit zwei Zahlen nicht entscheiden, ob
er etwas kaputtgemacht hat. Es gibt jetzt genau eine Quelle.

### P4 - die Messung, an der alles hing

Der Defekt wurde auf master AM DRAHT reproduziert (`MCP error -32602: Output validation error`),
bevor er auf dem Branch behoben wurde. Kein Phantom. Die Huelle bleibt fuer heutige Konsumenten
identisch (`{content, isError}`) - die alte `{"error":...}`-JSON-Huelle erreichte nie einen
Client, der SDK-Validator ersetzte sie. Keines der 10 anderen `outputSchema`-Werkzeuge nimmt
denselben Weg.

Die drei geaenderten Bestandstests einzeln beurteilt: `mcp-tools-language` **staerker**,
`al-p13-consult-channel` gleich in der Hauptsache, `gq-b1-briefing-openness` in der geaenderten
Zeile **schwaecher** - aber ersetzt, weil ein neuer Fall die Position von `NOT_PLACED` in den
ersten 512 Zeichen pinnt (gegen master rot). Keiner auf "prueft nur, dass nichts wirft" reduziert.

Testzahl-Delta exakt erklaert: master 6186 -> Branch 6195 = **genau +9** neue Faelle.

**BETRIEBSBEFUND, wichtig fuer die Owner-Liste:** die Instruktion des LIVE-Connectors traegt den
Consult-Text - **`CONSULT_ENABLED` ist in Produktion also AN**, obwohl `render.yaml:424-425`
`false` sagt. Der Live-Wert ist Dashboard-gepflegt; `render.yaml` ist hier NICHT massgeblich.
Das aendert die Tool-Flaeche in Produktion auf 12 statt 10 und bestaetigt Owner-Punkt O-6.

**Offene Befunde aus P4 (kein Merge-Hindernis, fuer P5b/P10):**
- `src/mcp-tools.js:940`: die `briefing`-Beschreibung von `place_call` traegt weiter
  "(calendar, mail, files, chat)". Bewusst nicht geaendert - convo-bench-kalibrierter Text mit
  eigenen Zeichenbudget-Tests; ohne Vorher-Messung anfassen verletzt
  `bench-must-reproduce-defect`. O-27 gilt erst mit Teil 2 als geschlossen.
- `consultPermissionHint` (`src/i18n/mcp-texts.js:71-73/:142-144/:192-194`) draengt auf
  "Zulassen"/"Allow" - Bestand, gehoert in **P5b**.
- **Neue Abdeckungsluecke:** die Zusicherung "keine `capabilities` ohne `uiEnabled`" ist jetzt
  von KEINEM Test mehr gedeckt (fiel mit AL-P13-37 weg). Am Draht nachgemessen und unveraendert,
  aber ungesichert. Kandidat fuer P10.
- Ein Code-Kommentar behauptet, Produktion laufe mit `CONSULT_ENABLED=false` - der Live-Connector
  spricht dagegen. **Vierte luegende Kommentarstelle dieser Kette.**

### P3 - die Lead-Entscheidung, die der Review nicht selbst treffen konnte

Der Bau deklarierte `securitySchemes` auf BEIDEN Transporten. Zurueckgenommen fuer stdio, siehe
"Autonome Entscheidungen". Nachgemessen nach der Korrektur: HTTP **12/12**, stdio **0/10** (echter
Kindprozess, keine Attrappe). Gegenprobe auf master: 0 von 12. P1/P2 unbeschaedigt, `_meta.ui`
vollstaendig.

Belegt wurde ausserdem der Sprengradius, statt ihn zu vermuten: der SDK-Parser STRIPPT unbekannte
Felder, er wirft nicht (`ToolSchema` ist ein `z.object` ohne `.passthrough()`,
`node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:1229-1273`) - mit echtem SDK-Client
gegengeprueft. Vier Ausfallformen der privaten Naht durchgespielt: **alle vier werfen laut**,
kein stiller Rueckfall.

**Offener Nebenbefund:** bricht die Naht, wirft der stdio-Prozess zwar - aber
`src/process-guards.js:30-32` loggt nur und beendet NICHT. Der Prozess endet mit **Exit-Code 0**
und ohne Werkzeuge. Das ist Bestandsverhalten, nicht von P3 eingefuehrt, aber es macht genau
diesen Ausfall schwer erkennbar. Kandidat fuer P10.

### P2 - Verlauf und Abnahme

**Der erste Bau-Lauf ist ABGESTUERZT** (Agent endete ohne strukturierte Rueckgabe, nach 269
Werkzeugaufrufen). Die Arbeit lag vollstaendig GESTAGED im Worktree, null Commits. Ein
Aufnahme-Agent hat sie geprueft, eine ueberholte Kommentarzeile berichtigt und committet.
**Lehre, ins Phasen-Skript eingebaut:** frueh committen, und die strukturierte Rueckgabe abgeben,
solange noch Luft ist - eine Rueckgabe mit offenen Punkten schlaegt gar keine.
**Zweite Lehre, ebenfalls eingebaut:** das Skript kann jetzt einen fertig gebauten Branch
AUFNEHMEN (`VORGEBAUT`) und direkt beim Review einsteigen, statt neu zu bauen.

Abnahme (Leseverbot fuer Spec+Report), alles selbst am Draht gemessen:
- T-18/T-22 auf allen drei Werkzeugmengen (9/10/12) und beiden Transporten erfuellt; laengster
  `toolInvocation`-Wert 32 von 64 Zeichen.
- **Mutationsprobe**: `src/mcp-tools.js` durch die master-Fassung ersetzt -> 4 von 5 neuen Tests
  rot. Der Test beweist tatsaechlich etwas.
- **`_meta`-Kollision gepruefft (das Risiko dieser Phase)**: `_meta.ui` ist bei allen 12
  Werkzeugen identisch zu master, nichts weggefallen. Der Live-Connector verliert nichts.
- Lint: die max-params-Suppression faellt ERSATZLOS weg (Verschaerfung). Der Zeilenzahl-Pin fuer
  `registerTools` geht 506 -> **509** (die Funktion ist gewachsen) - nachgemessen, kein
  aufgeweichter Schwellwert, aber eine kleine Drift.

**Offene Nacharbeit aus P2 (kosmetisch, ohne Laufzeitwirkung, Kandidat fuer P10):**
- Der tote `tool()`-Zweig steht noch in NEUN weiteren Test-Attrappen (`test/mcp-ui.test.js:69`,
  `mcp-tools.test.js:28`, `mcp-tools-i18n.test.js:47`, `mcp-tools-language.test.js:37`,
  `mcp-fehlergrund-rueckweg.test.js:26`, `openai-s3-hop-frist.test.js:25`,
  `place-call-context-bridge.test.js:39`, `al-p11-result-card.test.js:320`,
  `mcp-ui-i18n-divergence.test.js:23`) - samt ueberholter Kommentare. Die Commit-Botschaft
  "toter tool-Trap raus" behauptet mehr als getan wurde.
- `test/mcp-ui.test.js:61` `ohneWidgetMeta()`: acht Zusicherungen wurden von "gar kein `_meta`"
  auf "nicht diese zwei Schluessel" abgeschwaecht; der Kommentar daneben nennt das faelschlich
  "Verschaerfung". **Ein Kommentar, der luegt** - in diesem Repo die dritte Fundstelle dieser Art.

### P1 - was die Abnahme ergab (Verifikations-Agent, Leseverbot fuer Spec+Report)

Alle 5 IDs (N-1/X-1/N-3/N-4/N-11) erfuellt, **am echten `tools/list`-JSON belegt**, HTTP UND
stdio selbst gemessen (JSON-RPC gegen `src/mcp-server.js`). 4 Dateien, +231/-35, Tests 6155/0.

- Safety-Review gab in Runde 1 **FAIL**: die neue `await_call_event`-Beschreibung behauptete eine
  serverseitige Entdopplung, **die es nicht gibt**. Behoben in `b8cb2db`.
- Lint-Pin `registerTools` wurde nach UNTEN nachgezogen (512 -> 506) - Ratsche in die erlaubte
  Richtung, KEINE abgeschwaechte Sicherung.
- Werte-Quelle ist jetzt die Modultabelle `TOOL_ANNOTATIONS` (`src/mcp-tools.js:637-712`), 0
  Treffer ausserhalb der Datei -> keine Konfiguration kann ein unannotiertes Werkzeug ausliefern.
- Der alte Code-Kommentar hielt die **MCP-Spec-Lesart** von `destructiveHint` fest (also die
  nicht-massgebliche Norm) und wurde mitgeaendert - sonst dreht die naechste Sitzung die Werte
  unter Verweis darauf zurueck.

**Offene Nebenbefunde aus P1 (kein Merge-Hindernis, fuer P11 vormerken):**
- Der Test `P1 (DP-1)` ist KEIN echter stdio-Harness (beidseitig fakeServer). Der stdio-Wire-Beleg
  stammt aus der Messung des Verifikations-Agenten, nicht aus der Suite.
- **N-5** (Begruendung je Annotation bei der Einreichung): liegt als Code-Kommentar vor
  (`src/mcp-tools.js:600-622`), ist aber noch in kein Einreichungsdokument ueberfuehrt.
- Das Einreichungs-Inventar muss die Spannweite 9/10/12 nennen - welche Werkzeuge OpenAI sieht,
  haengt an Transport und Tenant-Profil.
- `answer_consult` meldet jetzt `destructiveHint:true`. Ein Host, der destruktive Werkzeuge
  zusaetzlich bestaetigen laesst, koennte die Antwort verzoegern, waehrend der Agent an der
  Leitung haengt (Serveranweisung verlangt "innerhalb von Sekunden"). `readOnlyHint` - woran der
  Write-Gate nach N-7/N-8 tatsaechlich haengt - ist unveraendert.

## SAMMELLISTE FUER P10 (Randpunkte) - aus den Abnahmen, kein Merge-Hindernis

| Herkunft | Punkt |
|---|---|
| P2 | toter `tool()`-Zweig in NEUN Test-Attrappen + ueberholte Kommentare |
| P2 | `test/mcp-ui.test.js:61` `ohneWidgetMeta()` - Kommentar nennt Abschwaechung "Verschaerfung" |
| ~~P3~~ | ~~`src/process-guards.js:30-32`: bricht die SDK-Naht, endet stdio mit Exit 0~~ - **gegenstandslos**: seit der P3-Korrektur greift stdio nicht mehr in die private SDK-Naht |
| P4 | Abdeckungsluecke: "keine `capabilities` ohne `uiEnabled`" von keinem Test mehr gedeckt |
| P4 | Kommentar behauptet Produktion laufe mit `CONSULT_ENABLED=false` - Live-Connector widerspricht |
| P7 | `docs/OPENAI-AUTH-ABWEICHUNGEN.md`: EN nennt sich "complete on its own", verweist aber auf deutsche Abschnitte (O-3, WorkOS-Fragen, B-1) |
| P7 | `PLAN-SECURITY.md` P6-Abschnitt (~Z.5070) nennt T-14 noch "gegenstandslos" - widerspricht P7-Punkt 2 "bewusst nicht erfuellt" |
| Kickoff I | `/healthz` gibt unauthentifiziert Commit-SHA + configHash preis; Referrer-Policy, security.txt, HSTS preload; `POST sundartha.com/mcp` -> 200 mit 0 Byte |
| Kickoff I | Tool-Menge variiert pro Tenant (9/10/12) - abfangen oder bewusst festhalten |
| P10a | `src/mcp-tools.js:~613`: Kommentar sagt, die MCP-Spec erlaube, "zwei davon" wegzulassen - alle drei Hints sind dort optional. **Zehnte luegende Kommentarstelle.** `src/` war in P10a tabu -> P10b |
| P10a | `answer_consult` `idempotentHint:false`: nach der MCP-Definition ("kein zusaetzlicher Effekt") waere `true` vertretbar (zweiter Aufruf -> 409, speist nichts ein). Wertaenderung = Owner-Entscheidung |

## DEPLOY-AUFLAGEN (ueberleben das Aufraeumen - NICHT loeschen)

Diese Punkte stehen sonst nur in Commit-Texten und Phasenberichten. Die werden nach der
CLAUDE.md-Aufraeumregel geloescht; die Auflagen hier bleiben.

**Aus P3 (`securitySchemes`), weil es dafuer KEINEN Abschalter gibt:**
1. Unmittelbar nach dem naechsten Deploy am LIVE-Connector pruefen, dass claude.ai weiterhin ALLE
   Werkzeuge listet (Connector oeffnen, zaehlen). Der einzige Rueckweg waere ein Revert-Deploy.
2. Claude Desktop (stdio) einmal starten und pruefen, dass die Werkzeuge erscheinen. **Der
   Ausfallmodus dort ist "stderr-Zeile + Exit 0"** - er sieht also nach einem sauberen Ende aus.
   Im Zweifel das MCP-Log auf `[guard] uncaughtException` pruefen.
3. **Bei JEDEM kuenftigen Bump von `@modelcontextprotocol/sdk` zuerst
   `test/openai-p3-security-schemes.test.js` fahren.** Sie ist die einzige Sicherung gegen den
   Verlust der privaten SDK-Naht (`server.server._requestHandlers`) - und sie greift nur, wenn
   jemand die Tests auch laufen laesst.

## Autonome Entscheidungen

- 2026-09-20: **D0-1 (UI ja/nein) wird nicht auf Verdacht entschieden.** `MCP_UI_ENABLED` ist heute
  per Default AN, also ist der Ist-Zustand "MIT UI". P8 wird deshalb GEBAUT (die Widget-Korrekturen
  sind additiv und richtig, egal ob die UI am Ende ausgeliefert wird). Das Umlegen des Schalters
  bleibt Owner-Sache.
- 2026-09-21 (P10b): **P10b wird per SQUASH gemergt, nicht per `--no-ff`.** Der Branch hatte die
  Produktionswerte (Land-Gate, Stundenlimit, Mandantentrennung, Kostendecken) im Klartext in
  `PLAN-SECURITY.md` geschrieben - also genau die Werte, deren oeffentliche Preisgabe diese Phase
  behebt. Der Nachzug hat sie entfernt, sie stehen aber noch in den ZWISCHEN-Commits. Ein
  `--no-ff`-Merge braechte sie dauerhaft in die master-Historie und beim naechsten Push nach
  GitHub. Der Squash nimmt nur den bereinigten Endstand. **Der Branch
  `phase/openai-p10b-http` darf NIE gepusht werden**; nach dem Merge mit `git branch -D` loeschbar
  (Owner-Entscheidung, nicht von dieser Kette ausgefuehrt).
- 2026-09-21 (P10b): **`docs/RUNBOOK-LIVE-WERTE.md` wird NICHT committet.** Der P10b-Review
  schlug vor, die Datei einzuchecken, weil vier neue Verweise auf sie zeigen. Abgelehnt: sie ist
  die lokale Arbeitsdatei des Owners, enthaelt LIVE-WERTE (SECRETS-Regel), und ueber eine Datei, die
  der Owner bewusst nicht eingecheckt hat, entscheidet nicht diese Kette. Die Verweise werden auf
  `PLAN-SECURITY.md` umgehaengt, dort OHNE Produktionswerte.
- 2026-09-21 (P10b): **Die Website-Punkte (`sundartha.com`) baut diese Kette NICHT.**
  Referrer-Policy, security.txt, HSTS-preload und `POST sundartha.com/mcp -> 200/0 Byte` liegen in
  `apps/web`. Website-Aenderungen laufen laut CLAUDE.md ueber den `staging`-Branch und das Labor
  (`docs/RUNBOOK-LAB-LIVE.md`), BEVOR sie auf master duerfen; ein Merge dieser Kette auf master
  wuerde das Labor umgehen, und beim naechsten Website-Deploy gingen ungetestete Header live.
  Ausserdem deckt `npm test` `apps/web` nicht ab, und HSTS-preload ist faktisch irreversibel.
  P10b nimmt nur den Hauptserver. Die Website-Punkte stehen als Owner-Punkt mit Anleitung auf der Liste.
- 2026-09-21 (P9): **P9 wird nicht gebaut, und es wird kein Workflow dafuer gestartet.** P0 hat
  belegt (vom unabhaengigen Nachmesser bestaetigt), dass sich server- vs. browserseitige Anfrage
  nur am echten Einreichungsweg messen laesst (OW-4). Die heutige CORS-Strenge ist die sichere
  Richtung und wird laut Kickoff nicht auf Verdacht gelockert. Ein Workflow, der "nichts
  aendern" feststellt, waere Verschwendung. T-4 (SSE) ist laut Kickoff "feststellen, nicht bauen".
  P11 zaehlt T-29 und T-4 ehrlich als offen/gegatet.
- 2026-09-21 (P10): **P10 wird geteilt** - die Sammelliste mischt zwei Risikoklassen. P10a:
  Hygiene (Tests, Kommentare, Doku, Einreichungs-Inventar), `src/` NUR an Kommentarzeilen, per
  Syntaxbaum-Vergleich zu beweisen. P10b: HTTP-Oberflaeche (`/healthz`, Security-Header,
  Parent-Host) - Live-Verhalten, eigene Phase mit eigener Gegenprobe (Kickoff-Schnittregel).
- 2026-09-21 (P6): **Keine neue Boot-Verweigerung in P6.** Phase 0 hatte P6 auf "Haertung
  ueber eine neue `PRODUCTION_FOOTGUNS`-Zeile" geschrumpft, fuehrte dieselbe Frage aber zugleich
  als Owner-Punkt O-7. Aufgeloest zugunsten O-7: eine Boot-Sperre ist maximal live-wirksam
  (verweigert der Start, faellt ALLES aus, auch eingehende Anrufe), und P4 hat hart belegt, dass
  die Repo-Konfiguration NICHT die Produktionskonfiguration ist (`render.yaml` sagt
  `CONSULT_ENABLED=false`, der Live-Connector zeigt Consult an). Auf dieser Grundlage eine
  Sperre zu bauen hiesse, beim naechsten Deploy moeglicherweise die ganze Produktion
  stillzulegen. Erlaubt ist hoechstens ein WARN-Logeintrag ohne Sperrwirkung. P6 baut nur die
  Challenge auf allen 401-Pfaden - additiv, fail-closed-Richtung.
- 2026-09-21 (P3): **Der stdio-Pfad traegt `securitySchemes` NICHT.** Der Bau hatte
  `[{type:"oauth2"}]` auf BEIDEN Transporten deklariert, mit dem Argument "eine Wahrheit statt
  zweier". Zurueckgenommen: stdio hat nachweislich GAR KEINE Auth-Schicht
  (`src/mcp-server.js` importiert nichts dergleichen; `mcpAuth` haengt allein an
  `src/routes/mcp.js:112`). Die Angabe war also unwahr - und zwar in die GEFAEHRLICHE Richtung:
  `noauth` faelschlich zu melden ist harmlos, `oauth2` faelschlich zu melden behauptet Schutz,
  den es nicht gibt. Dazu: der Nutzen ueber stdio ist messbar NULL (Claude Desktop strippt das
  Feld), das Risiko messbar groesser null (der Griff ins private SDK-Feld laege sonst im
  Boot-Pfad von Claude Desktop, einem LIVE-Pfad). OpenAI erreicht uns nie ueber stdio.
- 2026-09-20: **D0-4 (CORS) fail-closed.** Ist die Anfragerichtung nicht lesend belegbar, wird an
  CORS KEINE Zeile geaendert. Die heutige Strenge ist die sichere Richtung; sie wird nicht auf
  Verdacht aufgeweicht (so auch der Kickoff). P9 faellt dann auf "nicht gebaut, Owner-Messung".

## Fuer den Owner (am Ende, EINE Liste)

Aus P0 (Nummerierung der Entscheidungsdatei):
- **O-1** Produktentscheidung UI MIT/OHNE. Ohne Antwort: Ist-Zustand MIT UI bleibt.
- **O-2** Deploy-Freigabe fuer jede Aenderung an der `mcpAuth`-Verzweigung. Ohne: P6 baut+testet, deployt nicht.
- **O-3** Echtes Access-Token dekodieren (`scope`/`scp`?) + UserInfo (`email_verified`? = T-16).
- **O-4** Designentscheidung T-34: Suffix nur im ChatGPT-Renderer vs. geteilter Weg mit URI-Aenderung fuer Claude.
- **O-5** Developer-Mode-Connector in ein echtes ChatGPT-Konto haengen, EIN Mitschnitt: Origin-Header,
  Quell-IP, `params.capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes`. Ohne: P9 ungebaut,
  P8-ChatGPT-Teil ungestartet.
- **O-6** Render-Dashboard: traegt `MCP_AUTH_TOKEN` einen Wert? Weicht `MCP_UI_ENABLED` ab? `CONSULT_ENABLED=false`?
- **O-7** `PRODUCTION_FOOTGUNS`-Luecke (Legacy/Token nicht boot-gesperrt) jetzt schliessen oder als Risiko
  in `PLAN-SECURITY.md` eintragen?
- **O-8** Formelle Bestaetigung, dass Deep Research nicht auf der Roadmap steht.
- **O-9** Token fuer `/.well-known/openai-apps-challenge` eintragen (Route existiert, gruen getestet).

Vorher schon bekannt:

- **OW-1/OW-2:** Challenge-Token fuer `/.well-known/openai-apps-challenge` (O-4/O-5). Route ist
  gebaut und getestet, sie antwortet ohne Token fail-closed 404. Fehlt nur der Wert, auf beiden Hosts.
- **OW-3:** Einreichung MIT oder OHNE Widget-UI (`MCP_UI_ENABLED`). Ausschalten kostet die
  Claude-Nutzer die Live-Karte. **Seit P8 keine reine Produktfrage mehr:** eine Einreichung MIT UI
  hat T-30/T-31 offen (`_meta.ui.domain` ist laut OpenAI "required when submitting a plugin with
  UI"), und die lassen sich nicht ohne Live-Probe in Claude schliessen, weil `domain`
  host-abhaengig ist und der zustandslose Transport den Host nicht unterscheiden kann. MIT UI
  braucht also vorher: (a) eine Live-Probe im Claude-Connector (Web und Desktop), ob Claude
  `_meta.ui.csp`/`_meta.ui.domain` am Resource-Inhalt vertraegt, und (b) eine Loesung fuer die
  Host-Unterscheidung. OHNE UI entfallen T-30, T-31, X-3, X-7 und die Screenshot-Pflicht.
- **OW-4:** CORS-Messung: fragt OpenAI server- oder browserseitig an? Nur am echten
  Einreichungsweg messbar. Browserseitig = harter Blocker.
- **OW-5:** Abschaltung des Legacy-Token-Pfads (T-5/T-13) - live-wirksam.
- **`exp` nicht verlangt (aus P7):** `jwtVerify` in `src/auth.js` setzt kein `requiredClaims`.
  Ein signiertes Token ohne `exp` wuerde unbefristet angenommen. WorkOS stellt `exp` in der Praxis
  aus, der Code verlangt es aber nicht. Haertung `requiredClaims: ['exp']` ist fail-closed, aber
  eine Aenderung am Live-Auth-Pfad -> Owner-Freigabe, eigene kleine Phase.
- **`MCP_AUTH` ungetrimmt (aus P6):** `" oauth"` mit Leerzeichen faellt still auf Legacy. Ein
  Tippfehler im Render-Dashboard stuft Produktion von OAuth auf statisches Bearer herab. Ein
  `.trim()` in `src/config.js` waere ein Einzeiler - aber es ist eine Aenderung an der
  Auth-Konfiguration eines Live-Dienstes. Owner-Freigabe, dann in einer eigenen kleinen Phase.
- **`configHash` war oeffentlich rueckrechenbar (aus P10b, SICHERHEITSBEFUND):** aus `/healthz`
  liess sich der Live-Wert aus 9216 Kandidaten eindeutig zurueckrechnen, mit allen sieben
  Konfig-Achsen - darunter die Werte von Land-Gate und Stundenlimit. Die Einstellungen zweier
  Sicherheits-Gates waren damit oeffentlich lesbar. P10b nimmt `configHash` aus der oeffentlichen
  Antwort (Ersatz: Admin-Route + Boot-Log). **Bis zum naechsten Deploy ist die Preisgabe live.**
  Dein lokales `docs/RUNBOOK-LIVE-WERTE.md` sagt noch "configHash aus GET /healthz" - nach dem
  Deploy steht er dort nicht mehr; die geaenderten Saetze liefert der P10b-Nachzug.
- **`security.txt` laeuft still ab:** `Expires: 2027-09-01`. Kein Test bewacht das Ablaufdatum.
  Die Erneuerung steht nur in `PLAN-SECURITY.md`. Ob `kontakt@sundartha.com` Sicherheitsmeldungen
  tatsaechlich bearbeitet, ist UNKNOWN.
- **Branch `phase/openai-p10b-http` NIE pushen** - seine Zwischen-Commits enthalten
  Produktionswerte. Nach dem Squash-Merge mit `git branch -D` loeschen.
- **Website `sundartha.com` (aus P10b ausgeschlossen, Labor-Pflicht):** `Referrer-Policy` fehlt,
  kein `/.well-known/security.txt`, HSTS ohne `preload`, `POST sundartha.com/mcp` antwortet 200 mit
  0 Byte statt 404, und `/.well-known/openai-apps-challenge` liefert dort eine 6-KB-HTML-404-Seite
  statt eines sauberen 404 (O-4/O-5 verlangen: sauberer 404 ODER der Token, nichts dazwischen).
  Alles in `apps/web`, muss ueber `staging` + `hermes-web-staging` laufen. HSTS-preload ist
  faktisch nicht rueckgaengig zu machen - eigene Entscheidung.
- **Nur die ENGLISCHEN Abschnitte von `docs/OPENAI-AUTH-ABWEICHUNGEN.md` einreichen.** Die deutsche
  Fassung ist das interne Arbeitsdokument und traegt Phasen-Verweise (Z.3, 59, 114, 702-705).
- **O-27 (aus P5b):** `place_call`-Beschreibungen nennen fremde Werkzeugklassen
  ("calendar, mail, files, chat", `src/mcp-tools.js:949`) und Fremdprodukte ("not as
  Claude/Gemini", `:949` / `:1018`). Das ist der Kern von O-27. Die Texte sind an `convo-bench`
  kalibriert - eine Aenderung braucht eine Vorher-Messung (`npm run convo-bench`, n>=5, kostet
  LLM-Tokens) UND eine Entscheidung, ob die Formulierung fuer die Einreichung weichen muss.
  **Solange sie stehen, ist O-27 nicht erfuellt.**
- **U-10 (groesstes Einzelrisiko, ausserhalb jeder Phase):** ob ein Plugin, dessen Tools echte
  Telefonanrufe ausloesen, ueberhaupt zulaessig ist, ist in der gesamten OpenAI-Doku nicht
  dokumentiert.
