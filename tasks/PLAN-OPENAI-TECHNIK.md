# PLAN-OPENAI-TECHNIK

Strategie fuer die technischen Restarbeiten der OpenAI-Plugin-Einreichung von Hermes.
Massgeblich: `tasks/openai-audit/00-openai-anforderungen.md` (100 IDs). NICHT massgeblich:
`00-mcp-spec.md` (andere Norm; bei Widerspruch gewinnt die OpenAI-Fassung).

Stand der Faktenbasis: Sondierung durch vier Kundschafter am 2026-09-20, vom Strategie-Agenten
an den load-bearing Stellen selbst am Code nachgeprueft (SDK 1.29.0, `src/mcp-tools.js`,
`src/auth.js`, `src/ui/*`, `src/routes/mcp.js`, `src/app.js`).

---

## 0. Zwei Korrekturen am Arbeitsvorrat des Kickoffs

Beide sind dieselbe Fehlerklasse wie die `destructiveHint`-Verwechslung, die schon einmal ein
falsches "fertig" erzeugt hat: eine ID wurde mit dem falschen Inhalt verknuepft.

| Stelle im Kickoff | Behauptung | Befund | Konsequenz |
|---|---|---|---|
| F, "O-14 `last_transcript_lines`" | O-14 sei die Datenminimierung im Output | O-14 ist in der massgeblichen Liste **"Restricted Data verboten"** (PCI-DSS, PHI, staatliche IDs, Zugangsdaten). Die Rohzeilen-Durchreichung faellt unter **O-13** (Datenminimierung) und beruehrt **N-15** (kein Chatlog-Aufbau). | Der Punkt gehoert unter **O-13**, nicht O-14 — die N-15-Zuordnung faellt ebenfalls (naechste Zeile unten). O-14 im Wortsinn wird in **P5a** separat geprueft. Die Rohzeilen selbst werden **nicht** angefasst (P5b-Anhang: Live-Konsument belegt), der Befund bleibt offen. |
| D, "X-3 (widgetCSP, widgetDescription, toolInvocation, locale)" | vier Felder unter X-3 | X-3 nennt `openai/outputTemplate`, `openai/widgetAccessible`, `openai/visibility`, `openai/profile`, `openai/fileParams`, `openai/toolInvocation/*`. `widgetCSP` ist **X-7**. `locale` ist **X-4** und ein **Client**-Feld (der Host schickt es, der Server setzt es nie). **`widgetDescription` existiert in keiner der beiden Quellen** (grep: 0 Treffer). | X-3 wird auf seinen tatsaechlichen Wortlaut zurueckgefuehrt. `widgetDescription` wird **nicht gebaut** (s. Abschnitt "Was nicht gebaut wird"). |
| F, "Der Kommentar bei `:163` behauptet das Gegenteil" | bei `src/mcp-tools.js:163` stehe ein falscher Kommentar | **Nachgemessen, der Kickoff irrt.** `:163` lautet "Kein Secret/Identitaet/Audio/Cross-Tenant-Feld passiert diese Funktion" — eine Aussage ueber FELDER, die wahr ist und wahr bleibt. Der Satz "Das Roh-Transkript (`c.transcript`: role/text/t) wird NIE durchgereicht" steht bei `:193-195` und gehoert zum Datenkontrakt von `get_transcript`, wo er **korrekt** ist. | Der Befund "falscher Kommentar bei :163" wird **gestrichen**. Was tatsaechlich irrefuehren kann, ist das Nebeneinander von `pickCallStatus` (`:164-173`, reicht die Rohzeilen durch) und dem Whitelist-Vokabular im Kommentarblock `:160-163` darueber — genau diese Praezisierung macht P5a, mit woertlich zitierter Soll-Zeichenkette im Abnahmekriterium. |
| Eigener Entwurf, P5-ID-Liste | N-15 (kein Chatlog-Aufbau) gehoere zu `last_transcript_lines` | N-15 lautet woertlich: der Server darf den vollstaendigen **Chatverlauf** nicht ziehen, rekonstruieren oder erschliessen ("must not pull, reconstruct, or infer the full chat log", Anforderungsliste Zeile 89). Gemeint ist der Konversationsverlauf des **Hosts**, nicht ein Telefontranskript. | Dieselbe Fehlerklasse, diesmal im eigenen Entwurf — deshalb hier und nicht stillschweigend: **N-15 wird aus der P5-ID-Liste entfernt** und steht in Abschnitt 8 unter "Wird nicht gebaut". |

Zusaetzlich ueberholt: der Kickoff nennt `/.well-known/openai-apps-challenge` als "fehlt auf
beiden Hosts (404)". Die Route **existiert vollstaendig**, ist getestet und live
(`src/app.js:184-187`, `test/openai-e7-challenge.test.js`, 9/9 gruen). Offen ist nur die
Owner-Eingabe des Tokens. Siehe Abschnitt "Nur der Owner kann das".

---

## 1. Phase 0 — Messen und entscheiden (KEIN Code)

Zweck: jede Annahme, die spaeter mitten im Bauen platzen wuerde, wird **vorher** zu einer
Messung oder zu einem ausdruecklich notierten UNKNOWN. Phase 0 aendert keine Datei ausser dem
eigenen Messbericht `tasks/openai-mess-0.md`.

**Harte Regel fuer Phase 0:** jede Messung ist lesend. Kein Anruf, keine SMS, kein Schreibzugriff
auf Produktion, kein echter OAuth-Login-Flow.

| # | Entscheidungspunkt | Die Messung | Ausgang A | Ausgang B | Was sich am Plan aendert |
|---|---|---|---|---|---|
| D0-1 | **UI ja / nein** | Kein neues Messen noetig, die Entscheidungsgrundlage steht: `MCP_UI_ENABLED` ist EIN globaler Schalter fuer EINEN `/mcp`-Endpunkt (`src/config.js:1633-1638`, `src/routes/mcp.js:150`); es gibt keinen Code-Pfad, der ChatGPT- von Claude-Clients trennt. Ausschalten nimmt **gleichzeitig** den heutigen Claude-Nutzern die Live-Karte. Phase 0 legt dem Owner die drei Optionen als Einzeiler vor (s. u.) und misst nur noch: bricht `npm test` bei `MCP_UI_ENABLED=false`? (Erwartung: nein, `test/helpers.js:363` setzt das bereits als BASE_ENV-Default.) | **MIT UI** | **OHNE UI** | A: P8 wird gefahren. B: P8 entfaellt vollstaendig, T-30/T-31/X-3/X-7/T-23/T-34 wandern nach "wird nicht gebaut", O-12 (Screenshot-Pflicht) entfaellt. **Default bis zur Owner-Antwort: A vorbereiten, Schalter nicht anfassen.** |
| D0-2 | **search/fetch ja / nein** | Lesende Pruefung: gibt es irgendwo im Repo (CLAUDE.md, STATUS.md, README.md, `tasks/`) eine Produktabsicht "Deep Research"/"Company Knowledge"? Kundschafter-Messung: 0 Treffer. | Deep Research **nicht** angestrebt | angestrebt | Nicht angestrebt: T-24/T-25 gegenstandslos (so vorgesehen). Angestrebt: eigene, neue Kette ausserhalb dieses Plans (zwei Tools mit festen Schemas + Retrieval-Quelle). |
| D0-3 | **Legacy-Token-Pfad abschalten ja / nein** | Zwei lesende Messungen: (a) Live-Modus per `curl -i -X POST https://app.sundartha.com/mcp` ohne Authorization — Kundschafter-Messung 2026-09-20: 401 **mit** `WWW-Authenticate` und Body `Kein Token` = der **oauth**-Zweig; (b) Zaehlung der Testdateien, die den Legacy-Bypass brauchen (`test/helpers.js:569` `MCP_AUTH:""`; 37 von 53 `/mcp`-Testdateien setzen ihn nicht selbst um). | Produktion **nutzt Legacy nicht** (bestaetigt) | — | Der Codepfad wird in P6 **nicht entfernt**, sondern gehaertet (T-13) und die `render.yaml`-Drift (`value: ""`) als Owner-Punkt notiert. Begruendung im Pre-Mortem P6. |
| D0-4 | **CORS server- oder browserseitig** | **Owner-Messung**, kein Agent kann sie fahren: der Owner haengt `https://app.sundartha.com/mcp` als Developer-Mode-Connector in ein echtes ChatGPT-Konto und liest am Server mit, ob der ankommende Request einen `Origin`-Header traegt. Vorarbeit in Phase 0: ein Agent belegt lesend den Ist-Zustand (403 `cross_origin_blocked` bei `Origin: https://chatgpt.com`, **null** CORS-Header selbst bei passendem Origin, `src/middleware.js:207-219`) und schreibt die Mess-Anleitung in den Bericht. | **server-seitig** (kein Origin) | **browser-seitig** (Origin vorhanden) | A: P9 entfaellt, T-29 gegenstandslos, die heutige Strenge bleibt. B: P9 wird gefahren — und zwar als echte CORS-Freigabe, **nicht** nur als Allowlist-Eintrag: die Wache ist rein ablehnend, sie setzt **nie** `Access-Control-Allow-Origin` (grep: 0 Treffer in `src/`). **Bis die Messung vorliegt: keine Zeile CORS.** |
| D0-5 | **SDK-Grenze fuer `securitySchemes` (T-15)** | Zwei lesende Messungen: (a) installiertes SDK 1.29.0 — bestaetigt: `registerTool()` destrukturiert nur `{title, description, inputSchema, outputSchema, annotations, _meta}` (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:702-704`), der ListTools-Handler baut eine **feste** Feldliste (`:71-95`), `securitySchemes` kommt in der ganzen Dependency **nirgends** vor (grep: 0 Dateien). (b) `npm view @modelcontextprotocol/sdk version` = **1.30.0**: dessen `dist` lesend ziehen (`npm pack` in den Scratchpad, **kein** Install) und dieselben zwei Stellen pruefen. | 1.30.0 kennt das Feld | 1.30.0 kennt es auch nicht | A: P3 = SDK-Anhebung + Feld durchreichen. B: P3 = Low-Level-Override des ListTools-Handlers nach `registerTools()`, oder Ablage unter `_meta`. **Welcher JSON-Pfad korrekt ist, ist UNKNOWN** (die Anforderungsliste zitiert T-15 nur im Wortlaut "set on their tool metadata", ohne Pfad) — Phase 0 ruft dazu `https://developers.openai.com/plugins/build/auth` lesend ab und zitiert woertlich. Bleibt es unklar: P3 baut die Variante, die der Wortlaut am ehesten traegt, und notiert die Unsicherheit im Report. |
| D0-6 | **Gibt es fuer T-14 ueberhaupt einen Ausloesepfad?** | Lesende Pruefung: existiert irgendwo eine Laufzeit-Berechtigungspruefung **innerhalb** eines Tool-Handlers? Kundschafter-Befund: nein — nach `mcpAuth` (`src/routes/mcp.js:112`) prueft kein Handler mehr ein Token. `_meta["mcp/www_authenticate"]` waere heute ein Feld ohne Ausloeser. | Es gibt einen sinnvollen Ausloeser (z.B. 402/403 vom internen REST-Hop, das der Nutzer per Re-Auth loesen kann) | Es gibt keinen | A: P7 baut die Fehlerklasse. B: T-14 wird **als Feld ohne Wirkung nicht gebaut**; stattdessen wird in P7 belegt, dass der Transport-Pfad (401 + `WWW-Authenticate`, `src/auth.js:66-70`) die Anforderung tatsaechlich abdeckt, und das als bewusste Abweichung festgehalten. |
| D0-8 | **Deklariert OpenAIs realer Client `text/html+skybridge`?** (U-7) | **Owner-Messung, an denselben Mitschnitt gehaengt wie D0-4** (OW-4): der Owner liest im `initialize`-Request zusaetzlich `params.capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` ab. Vorarbeit in Phase 0: ein Agent belegt lesend, dass `capabilityDeclaresChatgptUi` die **einzige** Bedingung fuer `chatgptRenderer` ist (`src/ui/registry.js:43-50`, `src/ui/contract.js:53-55`), und schreibt die Ableseanleitung in den Bericht. | Client deklariert `text/html+skybridge` | deklariert ihn nicht (oder gar keine UI-Capability) | A: P8 wird wie beschrieben gefahren. B: **P8 laeuft ins Leere** — der ChatGPT-Adapter wird nie gewaehlt, jede Aenderung an `src/ui/adapters/chatgpt.js` waere wirkungslos. Dann ist P8 auf den mcp-nativen Pfad zu reduzieren (T-34 bleibt; T-30/T-31 sind dort bereits erfuellt; X-7/T-23 betreffen die `openai/`-Schluessel und werden dann am mcp-nativen `_meta` gesetzt) oder ganz zu streichen. **P8 wird an dieses Ergebnis gegatet wie P9 an D0-4: bis die Messung vorliegt, wird P8 nicht gestartet.** |
| D0-7 | **T-12 Scope: kommt ein Scope ueberhaupt im Token an?** | Lesende Messung: `curl https://fearless-network-26.authkit.app/.well-known/oauth-authorization-server` — Kundschafter-Messung 2026-09-20: `scopes_supported = [email, offline_access, openid, profile]`, kein ressourcenspezifischer Scope beworben. Die entscheidende Messung (echtes Access-Token dekodieren) braucht einen abgeschlossenen Login-Flow und ist **Owner-Sache**. | WorkOS liefert einen eigenen Scope | liefert keinen | A: P7 baut die Pruefung. B: **Keine Scope-Pruefung bauen** — eine Pruefung gegen einen Claim, den niemand ausstellt, ist entweder wirkungslos oder legt jeden Bestandstoken lahm. Dann wird T-12 im Report als "durch Audience/Resource-Pruefung teilweise erfuellt, Scope-Achse UNKNOWN (Anbieter)" gefuehrt. |

### Ergebnis Phase 0 (nachgetragen 2026-09-20)

Alle Belege, Absaetze, Planaenderungen, die Owner-Liste und die Ueberraschungen stehen in
**`tasks/openai-p0-entscheidungen.md`** (diese Datei ersetzt den unten genannten Ablageort
`tasks/openai-mess-0.md`). Eine Zeile je Entscheidungspunkt:

| # | Status | Ergebnis | Wirkung |
|---|---|---|---|
| D0-1 | **ENTSCHIEDEN** (Ausgang A) | Ist-Zustand MIT UI (Default `true`), `false` bricht nichts. **Aber: T-34 und T-23/X-7 sind NICHT additiv** — die Pauschale "P8 ist additiv" faellt. | P8 wird vorbereitet; T-34 gegatet (Owner O-4). Schalter-Flip bleibt Owner-Sache. Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-1 |
| D0-2 | **ENTSCHIEDEN** (Ausgang A) | Deep Research nicht angestrebt, 0 Treffer. | T-24/T-25 **GEGENSTANDSLOS**. Keine Planaenderung. Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-2 |
| D0-3 | **ENTSCHIEDEN** (Ausgang A) | Produktion laeuft nachweislich auf `oauth` (frische eigene Live-Messung). Haertung additiv ueber `PRODUCTION_FOOTGUNS` moeglich. Zaehlung korrigiert: **8 von 21**, nicht 37 von 53. | P6 haertet statt zu entfernen, fasst keine Testdatei an; Deploy = Owner O-2. Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-3 |
| D0-4 | **OWNER** (OW-4 / O-5) | Ist-Zustand belegt (403 bei fremdem Origin, **nie** ein `Access-Control-*`-Header, auch bei erlaubtem Origin). Server- vs. browserseitig nur *indiziert*. | Fail-closed: **keine Zeile CORS**, P9 bleibt ungebaut. Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-4 |
| D0-5 | **ENTSCHIEDEN** (Ausgang B) | `securitySchemes` existiert weder in 1.29.0 noch in 1.30.0 noch irgendwo im Dependency-Baum; 1.30.0 im relevanten Code identisch. Top-Level-Platzierung *indiziert*. | P3 = **Weg B** (Low-Level-Override), Weg A entfaellt. `_meta` traegt T-15 nicht, aber T-22. T-18 hat gar kein SDK-Problem (-> P2). Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-5 |
| D0-6 | **ENTSCHIEDEN** (Ausgang B) | Kein Ausloesepfad, auf **keinem** der beiden Transportwege (HTTP und stdio). | T-14 **GEGENSTANDSLOS** (toter Code); P7 schrumpft auf Dokumentation. Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-6 |
| D0-7 | **ENTSCHIEDEN** (Ausgang B) | Kein Scope wird konsumiert, keiner ressourcenspezifisch beworben; Audience- und Tenant-Bindung decken teilweise ab. Scope-Achse selbst **UNKNOWN (Anbieter)**. Zusatz: T-9/T-11/T-16-Metadata fehlen **auch beim Anbieter**. | T-12 wird nicht gebaut; T-9/T-11/T-16 (Metadata) sind keine Bauaufgaben, sondern dokumentierte Anbieter-Luecke. Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-7 |
| D0-8 | **OWNER** (OW-4 / O-5) | **Kein Beleg** in der massgeblichen Anforderungsliste fuer `text/html+skybridge`; der String stammt aus Hermes' eigenem Code. | ChatGPT-Adapter-Teil von P8 bleibt **ungestartet**; T-34 am mcp-nativen Pfad haengt NICHT daran. Siehe `tasks/openai-p0-entscheidungen.md` §2 D0-8 |

**Abnahmekriterium Phase 0 (fremd-pruefbar):** `tasks/openai-mess-0.md` existiert und enthaelt
fuer jeden der acht Punkte D0-1..D0-8 (a) das ausgefuehrte Kommando bzw. die gelesene
Datei:Zeile, (b) die rohe Ausgabe oder das Zitat, (c) den daraus abgeleiteten Ausgang. Ein
fremder Pruefer wiederholt die Kommandos aus (a) und vergleicht mit (b). Kein Punkt darf ohne
Beleg ein Ergebnis behaupten; wo der Owner gebraucht wird (D0-4, D0-7, D0-8 und die
Produktentscheidung in D0-1), steht das Wort UNKNOWN mit Grund. **Kein `git diff` ausserhalb
von `tasks/openai-mess-0.md`.**

**Pre-Mortem Phase 0** — *ein Jahr spaeter: die Messphase war ein Fehler.*
Was ist passiert: Phase 0 hat Ergebnisse notiert, die aus den alten Reports abgeschrieben waren
statt selbst gemessen. Die Kette baute auf `T-15 geht per config.securitySchemes`, entdeckte die
SDK-Grenze erst in der Umsetzung und sprengte P3 mitten drin.
*Entschaerfung:* das Abnahmekriterium verlangt fuer jeden Punkt das **Kommando** und die **rohe
Ausgabe**, nicht die Schlussfolgerung. Ein Punkt ohne Kommando gilt als nicht gemessen.
Zweiter Fall: Phase 0 hat auf die Owner-Antwort zu D0-1/D0-4 gewartet und die Kette blockiert.
*Entschaerfung:* Phase 0 blockiert nie. Der Default ist notiert (UI vorbereiten, CORS nicht
anfassen), die Kette laeuft weiter, P8/P9 stehen am Ende und sind abschaltbar.

**Doppelte Pfade:** keine (Phase 0 aendert nichts).

---

## 2. Phasenuebersicht

| Phase | Titel | IDs | Risiko | Kann entfallen? |
|---|---|---|---|---|
| P0 | Messen und entscheiden | — | keins (kein Code) | nein |
| P1 | Annotationen und Beschreibungen | N-1, X-1, N-3, N-4 (Wahrheitstabelle ueber alle 12 Tools), N-11 | niedrig (reine Werte) | nein |
| P2 | Registrierweg vereinheitlichen: `title` + `toolInvocation` | T-18 (Name/Title/Description/`inputSchema`/`outputSchema`), T-22 | mittel (strukturell, 2 Tools wechseln den Registrierweg) | nein |
| P3 | `securitySchemes` an der SDK-Grenze | T-15 | mittel-hoch (SDK-Grenze) | nein |
| P4 | Zwei echte Defekte + der Instruktionstext: `get_transcript`, Server-`instructions` | T-19, T-20, T-21, O-27 (Teil 1) | mittel (Verhalten aendert sich sichtbar) | nein |
| P5a | Datenminimierung am Output-Objekt (rein subtraktiv) | O-13 (Teil `voiceEngine`/`model`), O-14 | niedrig | nein |
| P5b | **Geldpfad + tenant-sichtbarer Text** | O-13 (Teil `failure_reason`), O-27 (Teil 2) | **hoch (Geldpfad)** — eigene Phase, eigene Gegenprobe | nein |
| P6 | **Auth I**: `WWW-Authenticate` auf allen 401-Pfaden | T-13, T-5 | **hoch (Auth)** — eigene Phase, eigene Gegenprobe | nein |
| P7 | **Auth II**: Fehlerkanal und Scope | T-14, T-12, T-9, T-11, T-16 | **hoch (Auth)** — eigene Phase, eigene Gegenprobe | teilweise (haengt an D0-6/D0-7) |
| P8 | **Widget-UI** | T-30, T-31, X-3, X-7, T-23, T-34 | **hoch (Live-Verhalten)** — eigene Phase, eigene Gegenprobe | **ja**, wenn D0-1 = OHNE UI **oder** D0-8 negativ |
| P9 | **Transport/CORS** | T-29, T-4 | **hoch (Sicherung)** — eigene Phase, eigene Gegenprobe | **ja**, wenn D0-4 = server-seitig |
| P10 | Randpunkte und Reviewer-Konsistenz | I-1..I-4 | niedrig | nein |
| P11 | Schlussabnahme | alle | keins (kein Code) | nein |

**Warum P5 geteilt ist.** Der Kickoff verlangt: "alles, was Auth (C), CORS (E) oder
Live-Verhalten (D) beruehrt, bekommt eine eigene Phase mit eigener Gegenprobe". Der
Entwurf hatte drei Klassen in **einer** Phase: die Kuerzung von `failure_reason` beruehrt
das `not-placed`-Praefix, an dem die Wiederholungssperre fuer **kostenpflichtige** Anrufe
haengt (Geld); die Umformulierung von `MCP_CONSULT_INSTRUCTIONS` steuert das Host-Modell
**waehrend laufender** Anrufe (Live-Verhalten); das Entfernen von `voiceEngine`/`model`
ist Kosmetik. Die Kosmetik laeuft als P5a mit niedrigem Risiko; der Geldpfad und der
tenant-sichtbare Text laufen als P5b mit eigener Gegenprobe. Der Instruktionstext selbst
wandert nach **P4** — er liegt in derselben Datei und in demselben Test wie die
T-21-Umstellung, und zwei Phasen an einem Testpin waeren genau der Zwischenzustand, den
Abschnitt 7 verbietet.

**Reihenfolge ist bindend. Eine Bahn zur Zeit.** P8 und P9 stehen bewusst am Ende: beide
koennen nach der Messung ersatzlos entfallen, und beide beruehren Live-Verhalten bzw. eine
Sicherung. Alles, was davor liegt, ist einzeln mergebar und laesst den Server laufen.

---

## 3. Die Phasen im Einzelnen

### P1 — Annotationen und Beschreibungen

**Ziel.** Die OpenAI-Pflichtannotationen an allen 12 Tools vollstaendig und widerspruchsfrei
setzen, ohne eine einzige strukturelle Aenderung. Reine Werte in einer Tabelle plus zwei
Beschreibungstexte.

**IDs.** N-1, X-1 (destructiveHint an allen 12), N-3 (`answer_consult`), N-4
(`openWorldHint`-Divergenz), N-11 (`await_call_event` nennt seine Schreibwirkung).

**Dateien.** `src/mcp-tools.js` (`TOOL_ANNOTATIONS` :599-642, der begruendende Kommentar
:581-586, die `await_call_event`-Beschreibung :972-978), `test/mcp-tool-annotations.test.js`.

**Was konkret passiert.**

| ID | Ist | Soll | Begruendung |
|---|---|---|---|
| N-1/X-1 | 7 Tools ohne `destructiveHint`-Schluessel (`get_call_status`, `get_transcript`, `get_my_number`, `list_calls`, `list_action_items`, `get_calendar`, `get_agent_status`) | alle 12 tragen den Schluessel; die 7 Lese-Tools `destructiveHint: false` | OpenAI fuehrt das Feld als **Required** (X-1), die MCP-Spec als optional. Bei Widerspruch gewinnt OpenAI. |
| — | Kommentar :581-586 begruendet die Auslassung mit der MCP-Spec | Kommentar nennt die OpenAI-Pflicht und warum sie die Spec-Optionalitaet schlaegt | Sonst dreht die naechste Session es unter Verweis auf den dann veralteten Kommentar zurueck. Diese Kommentar-Aenderung ist **Teil des Abnahmekriteriums**, nicht Kosmetik. |
| N-3 | `answer_consult: destructiveHint: false` (:617) | `true` | Der Handler speist Text in einen laufenden, kostenpflichtigen Anruf (:1046-1076). Hat der Agent den Satz ausgesprochen, ist er nicht zuruecknehmbar — N-3 woertlich: "even ... through indirect side effects". |
| N-4 | `openWorldHint` ist an **sechs** Tools `true` (:605, :612, :619, :621, :622, :628) und an sechs `false` — drei der sechs `true`-Werte sitzen auf Tools, die nachweislich nur den tenant-lokalen Store lesen | die Wahrheitstabelle unten, Zeile fuer Zeile am Zugriff belegt | Der Entwurf hatte N-4 auf die Divergenz `get_call_status` vs. `list_calls` verengt. Das ist zu wenig: **`get_transcript` (:622) liest dieselbe Route wie `get_call_status` (`src/routes/api-read.js:98`) und traegt trotzdem `true`.** Waere nur `get_call_status` gedreht worden, bliebe die Inkonsistenz bestehen und N-4 waere als erfuellt verbucht, ohne es zu sein — exakt der Ablehnungsgrund aus N-5/N-6. Deshalb wird **jedes** der 12 Tools namentlich entschieden. |
| N-11 | Beschreibung :972-978 spricht nur vom Warten | Beschreibung nennt ausdruecklich, dass jeder Aufruf zwei Felder am Anruf-Datensatz schreibt (`noteConsultPoll`, `markConsultAskDelivered`) | `readOnlyHint:false` ist bereits korrekt gesetzt (:610), aber die **menschenlesbare** Beschreibung verschweigt den Effekt. N-11: "Side effects should never be hidden or implicit." |

**Wahrheitstabelle `openWorldHint` (alle 12 Tools, je Zeile mit dem Zugriffs-Beleg).**
Massstab ist N-4 woertlich: `true` bei Zugriff auf das **oeffentliche Internet oder offene
externe Entitaeten**, ausdruecklich inklusive "send messages to external recipients".
Entscheidend ist der **Zugriff** des Tools, nicht das Thema seiner Daten.

| Tool | Ist | Soll | Zugriffs-Beleg (Route) | Begruendung |
|---|---|---|---|---|
| `place_call` | true (:605) | **true** | `POST /api/calls` (`src/routes/api-calls.js:394`) | loest einen echten Anruf beim Carrier aus — externer Empfaenger. |
| `await_call_event` | true (:612) | **false** | `GET /api/calls/:id/consult` (`src/routes/api-calls.js:658`) + `GET /api/calls/:id` (`src/routes/api-read.js:98`) | liest und schreibt ausschliesslich den tenant-lokalen Anruf-Datensatz (`store.noteConsultPoll`, `store.markConsultAskDelivered`, `consultDelivery.waitForEvent`). Kein Netzzugriff nach aussen. Die **Schreib**wirkung traegt `readOnlyHint:false` (:610), nicht `openWorldHint`. |
| `answer_consult` | true (:619) | **true** | `POST /api/calls/:id/consult/answer` (`src/routes/api-calls.js:690`) | der eingespeiste Text wird vom Agenten am Telefon **ausgesprochen** — "send messages to external recipients" im Wortsinn. |
| `get_call_status` | true (:621) | **false** | `GET /api/calls/:id` (`src/routes/api-read.js:98`) | tenant-lokaler Store, kein Aussenkanal. |
| `get_transcript` | true (:622) | **false** | `GET /api/calls/:id` (`src/routes/api-read.js:98`) — **dieselbe Route wie `get_call_status`** | tenant-lokaler Store. Derselbe Sachverhalt, also derselbe Wert; alles andere waere genau die Inkonsistenz, die N-4 aufwirft. |
| `cancel_call` | true (:628) | **true** | `POST /api/calls/:id/cancel` (`src/routes/api-calls.js:717`) | ruft `hangUpAction`/`elevenLabsHangUpAction` und damit den Anbieter — Wirkung auf der echten Leitung. |
| `get_my_number` | false (:630) | **false** | `GET /api/state` (`src/routes/api-read.js:63`) | unveraendert. |
| `list_calls` | false (:631) | **false** | `GET /api/state` (`src/routes/api-read.js:63`) | unveraendert. |
| `check_inbox` | false (:637) | **false** | `POST /api/inbox/poll` (`src/routes/api-inbox.js:40`) | liest den lokalen Posteingang; unveraendert. |
| `list_action_items` | false (:639) | **false** | `GET /api/state` (`src/routes/api-read.js:63`) | unveraendert. |
| `get_calendar` | false (:640) | **false** | `GET /api/state` (`src/routes/api-read.js:63`) | unveraendert. |
| `get_agent_status` | false (:641) | **false** | `GET /api/state` (`src/routes/api-read.js:63`) | unveraendert. |

Geaendert werden damit **drei** Werte: `await_call_event`, `get_call_status`,
`get_transcript` → `false`. `answer_consult` bleibt bewusst `true` (begruendet oben);
diese Begruendung ist zugleich die Einreichungs-Begruendung nach N-5.

**Abnahmekriterium (fremd-pruefbar).**
1. Ein gruener Test iteriert ueber die **12 ueber `tools/list` gelieferten** Tools und
   prueft `typeof annotations.destructiveHint === "boolean"` — am ausgelieferten JSON,
   nicht am Dateitext. (Das ist derselbe Test wie Kriterium 5 und ersetzt den frueheren
   `grep -c "destructiveHint"`: `grep -c` zaehlt **Zeilen**, nicht Treffer, grenzt nicht
   auf `TOOL_ANNOTATIONS` ein und zaehlt den Kommentarblock mit — heute gemessen **6**,
   nach der Phase realistisch **13**, nicht 12. Ein fremder Pruefer wuerde die Phase an
   dieser Zahl faelschlich durchfallen lassen.) Soll ein `grep` bleiben, dann mit
   Doppelpunkt und genauer Sollzahl: `grep -c "destructiveHint:" src/mcp-tools.js` → **12**.
2. Ein gruener Test prueft den `openWorldHint`-Wert **jedes** ueber `tools/list`
   gelieferten Tools gegen die Wahrheitstabelle oben — nicht nur die Anwesenheit des
   Schluessels. Der Pruefer legt Tabelle und Test nebeneinander und bestaetigt, dass jede
   der 12 Zeilen im Test steht; namentlich zu finden sind `get_transcript`,
   `await_call_event` und `answer_consult`. Ausserdem: `answer_consult.destructiveHint
   === true` per `datei:zeile`.
3. Der Kommentar bei `src/mcp-tools.js:581-586` erwaehnt die OpenAI-Required-Einstufung; der
   alte Satz "deshalb fehlen sie bei den reinen Lese-Werkzeugen bewusst" steht **nicht mehr**
   da (grep auf den Wortlaut = 0 Treffer).
4. Die `await_call_event`-Beschreibung enthaelt die Woerter `noteConsultPoll` bzw. eine
   Klartext-Aussage ueber den Schreibeffekt.
5. Ein gruener Test in `test/mcp-tool-annotations.test.js`, der die **Vollstaendigkeit** prueft
   (nicht einzelne Werte): fuer jedes ueber `tools/list` ausgelieferte Tool sind
   `readOnlyHint`, `destructiveHint`, `openWorldHint` vorhanden. Der Pruefer **liest den Test**
   und bestaetigt, dass er ueber die Tool-Liste iteriert statt eine handgepflegte Namensliste
   zu fuehren — sonst faengt er das 13. Tool nicht.
6. `npm test -- -- --test-concurrency=4`: `# fail 0`. **Auswertungsregel:** nur die TAP-Zeilen `# pass` / `# fail` zaehlen, der Exit-Code **nicht** (er luegt, belegt 2026-09-20). **Der doppelte `--`-Trenner ist Pflicht und gemessen:** `npm test --test-concurrency=4` reicht die Flagge nicht durch (npm nimmt sie als eigene npm-Option), und `npm test -- --test-concurrency=4` landet zwar in `process.argv` des Wrappers, wird dort aber verworfen — `test/testbaenke-run.mjs` liest Zusatzflags erst NACH einem eigenen `--` (`extraArgsFrom`, `test/i18n-catalog-run.mjs:103-106`). Ohne den doppelten Trenner laeuft die Suite mit voller Parallelitaet, also in genau dem Zustand, in dem sie bekanntermassen rot wird.

**Pre-Mortem P1** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* `destructiveHint: true` an `answer_consult` hat in ChatGPT eine manuelle
  Bestaetigung pro Consult-Antwort erzwungen (N-8). Der Agent steht am Telefon, der Nutzer
  klickt nicht schnell genug, die Consult-Frist laeuft ab — der Consult-Kanal ist faktisch tot.
  *Entschaerfung:* N-8 bindet die Bestaetigung an **Write-Actions** (`readOnlyHint:false`),
  nicht an `destructiveHint`. `answer_consult` ist bereits heute `readOnlyHint:false` (:616) —
  die Bestaetigungspflicht besteht also schon und aendert sich durch P1 **nicht**. Der Review
  belegt das am Wortlaut von N-8. *Verbliebenes Risiko, ausdruecklich akzeptiert:* ob ChatGPT
  intern zusaetzlich auf `destructiveHint` eskaliert, ist nicht dokumentiert (UNKNOWN).
  Alternative waere eine Falschangabe — die ist teurer (N-5/N-6: falsche Annotationen sind ein
  haeufiger Ablehnungsgrund).
- *Was ist passiert:* `openWorldHint` wurde bei `get_call_status`, `get_transcript` und
  `await_call_event` auf `false` gedreht, obwohl die Tools den Zustand eines Anrufs in die
  offene Welt hinaus beschreiben — der Reviewer las das als Falschangabe. *Entschaerfung:*
  N-4 definiert `openWorldHint` ueber den **Zugriff** des Tools, nicht ueber das Thema
  seiner Daten; alle drei lesen einen tenant-lokalen Store (Wahrheitstabelle oben, je mit
  Route). Die Begruendung wird als Kommentar an `TOOL_ANNOTATIONS` hinterlegt, damit die
  Einreichungs-Begruendung (N-5) daraus entsteht und nicht neu erfunden wird.
- *Was ist passiert:* nur `get_call_status` wurde gedreht, `get_transcript` behielt `true`
  auf derselben Route. N-4 galt als erledigt, der Reviewer fand die Inkonsistenz und lehnte
  nach N-5/N-6 ab. *Entschaerfung:* die Wahrheitstabelle entscheidet **alle 12** Tools
  namentlich, Abnahmekriterium 2 prueft jeden einzelnen Wert gegen sie.

**Doppelte Pfade.** DP-1 (HTTP vs. stdio): `TOOL_ANNOTATIONS` wird von beiden Transporten ueber
dieselbe `registerTools()` gelesen — **eine** Aenderung genuegt, aber der Review belegt es am
gemeinsamen Aufruf (`src/mcp-server.js:26-28` und `src/routes/mcp.js:151-158`). DP-3
(Legacy `tool()` vs. `uiTool()`): beide Wege reichen `annotations` durch — P1 ist davon
**nicht** betroffen.

---

### P2 — Registrierweg vereinheitlichen: `title` + `toolInvocation`

**Ziel.** Top-Level-`title` und die zwei Statuszeilen an **allen 12** Tools — inklusive der
zwei Tools, die das heute strukturell nicht koennen.

**IDs.** T-18, T-22 (`openai/toolInvocation/invoking` + `/invoked`, je max. 64 Zeichen).

**T-18 ist mehr als `title`.** Der massgebliche Wortlaut (Anforderungsliste Zeile 51)
verlangt vier Dinge je Tool: eindeutiger **Name**, **Title**, **Description**, **expliziter
`inputSchema`** — plus `outputSchema` fuer alles, was `structuredContent` zurueckgibt
("Declare outputSchema for any tool that returns structuredContent"). Der Entwurf hatte
T-18 auf den Top-Level-`title` verkuerzt und gleichzeitig "keine 12 `outputSchema`"
gepinnt, ohne zu sagen, warum das vereinbar ist. Am Code ist es vereinbar, und der Beleg
gehoert hierher: **`cancel_call` (`src/mcp-tools.js:1173-1181`) und `list_action_items`
(`:1269-1287`) geben ausschliesslich `text(...)` zurueck, also `content` ohne
`structuredContent`** — fuer sie fordert T-18 kein `outputSchema`. Die restlichen 10 Tools
tragen eines (`grep -c "outputSchema:" src/mcp-tools.js` → 10, heute gemessen). Name,
Description und `inputSchema` liegen bei allen 12 vor; Abnahmekriterium 6 macht das
pruefbar, statt es zu behaupten.

**Dateien.** `src/mcp-tools.js` (`TOOL_ANNOTATIONS` :599-642, die Fabriken `tool()`/`uiTool()`
:755-762, `enableWidgetUi()` :718-725, die zwei Legacy-Registrierungen `cancel_call` :1173-1181
und `list_action_items` :1271-1287), `test/mcp-tool-annotations.test.js`.

**Der strukturelle Kern.** Das installierte SDK hardcodet im Legacy-Pfad `server.tool()` sowohl
`title` als auch `_meta` auf `undefined`
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:694`); nur `registerTool()`
liest `config.title` und `config._meta` (`:702-704`). 10 von 12 Tools laufen bereits ueber
`uiTool()` → `registerTool()`. **`cancel_call` und `list_action_items` muessen migriert
werden** — sonst bleibt die Phase 2/12 unvollstaendig, und die anderen 10 sehen nach
Vollstaendigkeit aus.

**Die Falle, die diese Phase wahrscheinlich versenkt.** Die 5 Widget-Tools spreaden
`...enableWidgetUi(widgetId)` als **letztes** Feld in ihr Config-Literal (z.B.
`src/mcp-tools.js:929`), und `enableWidgetUi()` liefert selbst ein komplettes `{_meta: {...}}`
(`:718-725`). Ein separat davor geschriebenes `_meta: {"openai/toolInvocation/invoking": ...}`
wird vom spaeteren Spread **vollstaendig ueberschrieben** (Objekt-Literal-Semantik, kein
Deep-Merge). Das Feld verschwindet still auf genau den 5 Tools, die ein Widget haben, waehrend
der Code aussieht, als sei es gesetzt.
**Bauvorgabe:** das `toolInvocation`-`_meta` wird **nicht** in die Config-Literale geschrieben,
sondern an genau einer Stelle gebaut und mit dem Widget-`_meta` zusammengefuehrt — der Ort ist
die `uiTool()`-Fabrik (`:761-762`), die das `_meta` des Aufrufers mit dem
`toolInvocation`-Fragment mergt. Damit gibt es **einen** Ort fuer alle 12 Tools und keine
Reihenfolge-Abhaengigkeit.

**Abnahmekriterium (fremd-pruefbar).**
1. Ein gruener Test fuehrt ein echtes `tools/list` gegen den gespawnten Server aus und prueft
   fuer **jedes** ausgelieferte Tool: `title` ist ein nicht-leerer String **auf der obersten
   Ebene des Tool-Objekts** (nicht unter `annotations`), und
   `_meta["openai/toolInvocation/invoking"]` sowie `_meta["openai/toolInvocation/invoked"]`
   sind nicht-leere Strings mit `length <= 64`. Der Pruefer **liest den Test** und bestaetigt,
   dass er ueber die gelieferte Liste iteriert, nicht ueber eine Namensliste.
2. Derselbe Test enthaelt **mindestens ein Widget-Tool und ein Nicht-Widget-Tool** namentlich
   in der Pruefmenge — ein Test, der nur Nicht-Widget-Tools prueft, faengt die Spread-Falle
   nicht. Der Pruefer bestaetigt, dass `place_call` (Widget) **und** `cancel_call`
   (Nicht-Widget, migriert) enthalten sind.
3. `grep -n "server.tool(" src/mcp-tools.js` liefert **nur noch** die Fabrik-Definition selbst
   oder 0 Treffer; `cancel_call` und `list_action_items` werden ueber `uiTool()` registriert
   (`datei:zeile`).
4. Verhaltensbeleg fuer die Migration: die Textausgabe von `cancel_call` und
   `list_action_items` ist unveraendert. Belegt durch die bestehenden Tests in
   `test/mcp-tools.test.js`, die diese beiden Tools aufrufen — sie bleiben gruen **ohne**
   angepasste Erwartungswerte. Der Pruefer vergleicht mit **expliziter Basis**:
   `git diff master...phase/<branch> -- test/mcp-tools.test.js` — keine geaenderte
   Assertion an diesen zwei Tools. Der Branch-Name steht in der Phasen-Uebergabe; ohne ihn
   ist das Kriterium nach dem Merge nicht mehr formulierbar. Ersatzweise pruefbar ohne
   Basis: die Zahl der Assertions an `cancel_call`/`list_action_items` ist als Testname
   gepinnt.
5. **T-18, Rest des Wortlauts:** ein gruener Test prueft am `tools/list`-Response, dass
   **jedes** der 12 Tools einen eindeutigen `name`, eine nicht-leere `description` und ein
   `inputSchema`-Objekt traegt. Der Pruefer liest den Test und bestaetigt die Iteration
   ueber die gelieferte Liste.
6. **T-18, `outputSchema`-Teil:** derselbe Test belegt, dass genau **10** der 12 Tools ein
   `outputSchema` liefern, und der Report belegt mit `datei:zeile`, dass die zwei ohne
   (`cancel_call` :1173-1181, `list_action_items` :1269-1287) **kein**
   `structuredContent` zurueckgeben. Erst mit diesem Beleg traegt die Aussage "weiterhin
   10, nicht 12"; ohne ihn kann ein fremder Pruefer T-18 nicht schliessen.
7. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P2** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* die Migration von `cancel_call` auf `registerTool()` hat versehentlich ein
  `outputSchema` eingefuehrt (weil das die neue Config-Form erlaubt), das Tool liefert aber
  weiterhin nur `text()` ohne `structuredContent` — der SDK-Validator wirft, und der Client
  sieht "Output validation error" statt der Antwort. **Das ist exakt der Defekt, den P4 fuer
  `get_transcript` repariert**, nur neu erzeugt. *Entschaerfung:* Bauvorgabe: die Migration
  fuegt **kein** `outputSchema` hinzu. Das Abnahmekriterium prueft es — und zwar am
  richtigen Muster: `grep -c "outputSchema" src/mcp-tools.js` liefert **21** (Zeilen, inkl.
  Schema-Konstanten und Kommentaren) und beweist nichts. Zu zaehlen ist der Konfig-
  Schluessel: `grep -c "outputSchema:" src/mcp-tools.js` → **10**, heute gemessen (:928,
  :989, :1044, :1119, :1136, :1193, :1222, :1252, :1302, :1342). Besser noch am
  `tools/list`-Response: genau 10 der 12 Tools liefern ein `outputSchema`, und
  `cancel_call`/`list_action_items` sind nicht darunter — das ist Abnahmekriterium 6.
- *Was ist passiert:* `toolInvocation` wurde in die Config-Literale geschrieben, der
  Widget-Spread hat es auf 5 Tools ueberschrieben, der Test prueft nur `get_transcript` (kein
  Widget) und ist gruen. Ein Jahr spaeter faellt im Review auf, dass die Statuszeilen genau bei
  den sichtbarsten Tools fehlen. *Entschaerfung:* Abnahmekriterium 1 iteriert ueber **alle**
  Tools, Kriterium 2 verlangt namentlich ein Widget-Tool.
- *Was ist passiert:* die 64-Zeichen-Grenze wurde in einer Sprache eingehalten und in einer
  anderen gerissen. *Entschaerfung:* die `toolInvocation`-Texte sind wie alle Tool-Metadaten
  **einsprachig Englisch** (Systemgrenze O14 im Bestandskommentar bei `TOOL_ANNOTATIONS`) — es
  gibt keine zweite Sprachfassung. Der Test prueft `length <= 64` trotzdem, weil der naechste
  Editor das nicht weiss.

**Doppelte Pfade.** DP-3 (Legacy `tool()` vs. `uiTool()`) — **das ist der Kern dieser Phase**;
sie loest den doppelten Pfad auf, statt ihn zu bedienen. DP-1 (HTTP vs. stdio): dieselbe
`registerTools()`, eine Aenderung genuegt; der Review belegt es. DP-7 (`enableWidgetUi`-`_meta`
vs. separates `_meta`) — durch die Bauvorgabe (ein Merge-Ort) beseitigt.

---

### P3 — `securitySchemes` an der SDK-Grenze

**Ziel.** T-15 erfuellen oder belegt als nicht erfuellbar festhalten — ohne die
`McpServer`-Kapselung zu beschaedigen.

**IDs.** T-15.

**Dateien.** `src/mcp-tools.js`, ggf. `src/routes/mcp.js` und `src/mcp-server.js` (wenn ein
Handler-Override noetig ist), `package.json` (nur bei SDK-Anhebung), Tests.

**Warum eine eigene Phase.** Es gibt heute **keinen** Andockpunkt: weder die
Config-Destrukturierung von `registerTool()` noch der ListTools-Response-Builder (feste
Feldliste `name/title/description/inputSchema/annotations/execution/_meta/outputSchema`,
`mcp.js:71-95`) kennen das Feld; das SDK wuerde es kommentarlos verwerfen. Im gesamten
`node_modules/@modelcontextprotocol/sdk` kommt `securitySchemes` **nicht vor** (grep: 0
Dateien). Das ist kein Ein-Zeilen-Fix und darf nicht in P2 mitlaufen.

**Der Weg haengt an D0-5.**

| D0-5-Ausgang | Weg | Zusatzrisiko |
|---|---|---|
| SDK 1.30.0 kennt das Feld | `package.json` anheben, Feld in der `uiTool()`-Fabrik durchreichen | SDK-Sprung beruehrt **alle** Tools und beide Transporte → volle Suite plus ein Smoke-Test gegen `tools/list` |
| 1.30.0 kennt es nicht, OpenAI erwartet es top-level | Low-Level-Override: nach `registerTools()` den `ListToolsRequestSchema`-Handler neu setzen und die Tool-Objekte um `securitySchemes` anreichern | Der Override ersetzt SDK-Logik (Schema-Normalisierung, `outputSchema`-Bau). **Bauvorgabe:** der Override ruft den urspruenglichen Handler auf und reichert dessen Ergebnis an, statt die Liste neu zu bauen. Anderenfalls wird der Punkt nicht gebaut. |
| 1.30.0 kennt es nicht, OpenAI akzeptiert `_meta` | Feld ueber denselben `_meta`-Merge-Ort wie T-22 (P2) | gering |
| JSON-Pfad bleibt UNKNOWN | **nicht bauen**, als UNKNOWN mit Grund in den Report | — |

**Werte.** Alle 12 Tools laufen hinter derselben Auth (`mcpAuth`, ein Mount-Punkt,
`src/routes/mcp.js:112`) — es gibt kein Tool mit abweichender Anforderung. Also **einheitlich**
`{"type":"oauth2","scopes":[]}` (leere Scope-Liste, solange D0-7 keinen ausgestellten Scope
belegt) — **nicht** `noauth`, denn kein Tool ist ohne Token erreichbar. Eine leere `scopes`-Liste
ist ehrlich; eine erfundene waere eine Falschangabe (N-5).

**Abnahmekriterium (fremd-pruefbar).**
1. Ein gruener Test fuehrt `tools/list` gegen den gespawnten Server aus und prueft fuer **jedes**
   Tool, dass `securitySchemes` vorhanden ist und `{"type":"oauth2"}` traegt — am tatsaechlich
   ueber die Leitung gegangenen JSON, **nicht** am Config-Objekt. Der Pruefer liest den Test und
   bestaetigt, dass er den HTTP-Response parst.
2. Wurde der Handler-Override gewaehlt: ein Test belegt, dass `outputSchema` weiterhin bei
   **10** Tools im `tools/list`-Response steht und `inputSchema` bei allen 12 ein
   JSON-Schema-Objekt ist — der Beleg, dass der Override die SDK-Normalisierung nicht
   zerschossen hat.
3. Wurde nichts gebaut: `tasks/`-Report nennt den Grund mit Zitat aus der OpenAI-Quelle und dem
   grep-Beleg fuer die SDK-Grenze. Der Pruefer wiederholt den grep.
4. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P3** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* der ListTools-Override hat die Liste selbst gebaut und dabei
  `outputSchema` und die Zod-zu-JSON-Schema-Normalisierung verloren. Alle Tools funktionierten
  noch, aber die Clients bekamen keine Ausgabeschemas mehr — sechs Wochen unbemerkt, weil kein
  Test die Schema-**Form** prueft, nur die Feld-Anwesenheit. *Entschaerfung:* die Bauvorgabe
  (anreichern statt neu bauen) plus Abnahmekriterium 2.
- *Was ist passiert:* das SDK wurde von 1.29.0 auf 1.30.0 gehoben, um ein Feld zu bekommen, und
  hat nebenbei das Verhalten von `validateToolOutput` geaendert — P4s Defekt kam in anderer Form
  zurueck. *Entschaerfung:* eine SDK-Anhebung ist eine **eigene** Aenderung mit eigenem Beleg:
  der Report nennt den Diff der beiden Dateien `server/mcp.js` (1.29.0 vs. 1.30.0) an den drei
  Stellen, die uns betreffen (ListTools-Builder, `registerTool`, `validateToolOutput`). Ohne
  diesen Vergleich wird nicht angehoben.
- *Was ist passiert:* `{"type":"noauth"}` wurde gesetzt, weil `initialize` und `tools/list` ohne
  Auth laufen sollen (Mixed Auth). Ergebnis: ein Reviewer rief ein Tool ohne Token auf, bekam
  401, und meldete eine Falschangabe. *Entschaerfung:* der Wert beschreibt das **Tool**, nicht
  den Listing-Vorgang. Alle 12 Tools brauchen ein Token → alle `oauth2`.

**Doppelte Pfade.** DP-1 (HTTP vs. stdio): bei der Fabrik-Variante wirkt die Aenderung auf
beiden; bei einem Handler-Override in `routes/mcp.js` wirkt sie **nur auf HTTP** — dann muss
`src/mcp-server.js:19-28` denselben Override bekommen oder der Report haelt ausdruecklich fest,
dass stdio (Claude Desktop, nicht Teil der Einreichung) ihn bewusst nicht traegt. DP-3 (durch P2
bereits aufgeloest).

---

### P4 — Zwei echte Defekte und der Instruktionstext

**Ziel.** Der Client sieht bei laufendem Anruf den tenant-sprachigen Hinweis statt
"Output validation error"; die Server-Instruktionen tragen das Wichtigste vorn, existieren
auf beiden Transporten und nennen keine fremden Werkzeuge mehr.

**IDs.** T-19, T-20 (Ergebnisstruktur/Fehlerkanal), T-21 (`instructions`), **O-27 Teil 1**
(die Instruktion steuert keine fremden Connectoren mehr).

**Warum O-27 Teil 1 hier liegt und nicht in P5.** Beides sind Aenderungen an **derselben**
Konstante `MCP_CONSULT_INSTRUCTIONS` in **derselben** Datei, und beide muessen **denselben**
Test anfassen: P4 pinnt die tragenden Aussagen dieses Textes, P5 haette genau eine davon
danach wieder umgeschrieben. Das ist der Zwischenzustand, den Abschnitt 7 verbietet ("kein
Zwischenzustand, der erst durch die naechste Phase repariert wird"). Also: Umstellung und
Umformulierung in **einem** Zug, mit **einem** Pin.

**Dateien.** `src/mcp-tools.js:1140`, `src/mcp-server-info.js:78-123` (inkl. `:94`),
`src/mcp-server.js:19-28`, `test/mcp-tools.test.js`.

**Defekt 1 — belegt und lokal reproduziert.** `src/mcp-tools.js:1140` gibt bei laufendem Anruf
`text({error: loc.mcp.callStillRunning})` zurueck. `text()` (:79-81) liefert **nur** `content`,
ohne `structuredContent` und ohne `isError`. `get_transcript` deklariert aber `outputSchema`
(:1136). Der SDK-Validator nimmt Fehlerergebnisse ausdruecklich aus
(`if (result.isError) return;`, `mcp.js:193`), **hier fehlt `isError` aber** — also greift
`if (!result.structuredContent) throw new McpError(...)` (`:196-198`), der Wurf wird im
CallTool-Handler gefangen und zu `isError:true` mit dem Text "Output validation error: ...".
Der Nutzer sieht die Systemmeldung statt des Hinweises.
**Fix:** `errText(loc.mcp.callStillRunning)` statt `text(...)` — `errText` (:84) setzt
`isError:true`, damit greift die SDK-Ausnahme, und der tenant-sprachige Text erreicht den
Client. Fachlich korrekt: "Anruf laeuft noch" **ist** ein Fehlerergebnis im MCP-Sinn (T-20).

**Der nachhaltige Teil.** Ein Ein-Zeilen-Fix wiederholt sich beim naechsten fruehen `return`.
Deshalb zusaetzlich eine **Regel mit Test**: jeder Handler eines Tools mit `outputSchema` muss
in jedem Rueckgabepfad entweder `structuredContent` **oder** `isError:true` tragen. Heute
betrifft das nur `get_transcript` (grep `text(` in `src/mcp-tools.js`: 4 Treffer, davon 1 in
einem `outputSchema`-Tool) — der Test ist fuer die Zukunft, nicht fuer heute.

**Defekt 2 — `instructions` (T-21).** Drei Teilbefunde:
- Laenge 1238 Zeichen (selbst gemessen), die ersten 512 enthalten **nur** die Poll-Mechanik.
  Der teure Inhalt (der `not-placed`-Hinweis gegen kostenpflichtige Wiederholungsanrufe) steht
  erst ab ~Zeichen 1050. T-21: "Keep the most important details in the first 512 characters."
  → **Umstellen, nicht kuerzen**: der `not-placed`-Satz und die Nicht-Erfinden-Regel nach vorn.
- Gesetzt **nur** bei `consultLoop` (`src/mcp-server-info.js:118-123`). Ein Tenant mit
  `DEFAULT_PROFILE` bekommt **gar keine** Instruktionen. → Ein transport-unabhaengiger
  Basis-Block, der **immer** gesetzt wird; der Consult-Block haengt weiterhin am Flag.
- Ueber stdio strukturell **nie** vorhanden: `src/mcp-server.js:19-21` baut `serverOptions`
  selbst und ruft `mcpServerOptions()` gar nicht auf. → stdio ruft denselben Builder.

**Abnahmekriterium (fremd-pruefbar).**
1. Ein gruener Test ruft `get_transcript` gegen einen gespawnten Server mit einem Anruf im
   Zustand `active` auf und prueft am **HTTP-Response**: `isError === true` und der Text ist der
   lokalisierte `callStillRunning`-Satz — **nicht** "Output validation error". Der Pruefer liest
   den Test und bestaetigt, dass die Assertion auf den Textinhalt geht, nicht nur auf `isError`.
2. Ein gruener Test belegt die Regel: fuer jedes Tool mit `outputSchema` fuehrt der bekannte
   fruehe Rueckgabepfad zu `isError:true` **oder** `structuredContent`. Der Pruefer liest den
   Test und bestaetigt, dass er nicht nur `get_transcript` prueft.
3. `MCP_CONSULT_INSTRUCTIONS.slice(0, 512)` enthaelt den `not-placed`-Hinweis. Pruefbar per
   `node -e 'import("./src/mcp-server-info.js").then(m=>console.log(m.MCP_CONSULT_INSTRUCTIONS.slice(0,512)))'`
   — der Pruefer fuehrt das Kommando selbst aus.
4. Ein gruener Test belegt, dass ein Tenant **ohne** Consult-Freigabe im `initialize`-Response
   ein nicht-leeres `instructions`-Feld erhaelt.
5. **stdio (T-21).** Verlangt ist ein **gruener Test**, der den stdio-Prozess spawnt
   (`npm run mcp`), einen `initialize`-Request ueber die Pipe schickt und im Response ein
   **nicht-leeres `instructions`-Feld** prueft. Das frueher zugelassene "ein Test **oder**
   eine lesende Pruefung" ist gestrichen: eine lesende Pruefung von `src/mcp-server.js`
   zeigt nur, dass `mcpServerOptions()` **aufgerufen** wird — nicht, dass `instructions`
   im `initialize`-Response **ankommt**. Genau diese Luecke (Aufruf vorhanden, Wirkung
   nicht) ist das Muster des letzten falschen "fertig". Zusaetzlich bleibt der
   Start-Smoke aus dem Pre-Mortem (`npm run mcp` mit sofortigem EOF). **Dieser Punkt ist
   der, an dem es beim letzten Mal auseinandergegangen ist** — ohne ihn gilt T-21 als
   nicht erfuellt.
6. **O-27 Teil 1.** `MCP_CONSULT_INSTRUCTIONS` enthaelt die Zeichenkette
   `calendar, mail, files` **nicht** mehr — Kommando, das der Pruefer selbst ausfuehrt:
   `node -e 'import("./src/mcp-server-info.js").then(m=>console.log(m.MCP_CONSULT_INSTRUCTIONS.includes("calendar, mail, files")))'`
   → `false`. **Und** der Pin aus Abnahmekriterium 7 belegt, dass die **Wirkung**
   erhalten ist. Ohne beides gilt O-27 Teil 1 als nicht erfuellt: eine Streichung ohne
   Ersatz waere ein Qualitaetsrueckschritt der Anrufkette (GQ-B2).
7. **Der Pin (T-21 + O-27 gemeinsam).** Ein gruener Test pinnt die vier tragenden
   **Wirkungen** des Textes — nicht seine Formulierungen: (a) die Poll-Schleife bis
   `done`, (b) die Quittung `working` binnen Sekunden, (c) **"antworte selbst zuerst,
   frage den Menschen nur bei echter Anwesenheit, erfinde nichts"** — ohne Nennung
   konkreter fremder Werkzeuge, (d) `not-placed` nicht wiederholen. Der Pruefer liest den
   Test und bestaetigt, dass Aussage (c) **die Wirkung** prueft und nicht die
   Aufzaehlung `calendar, mail, files`; ein Test, der die Aufzaehlung pinnt, waere mit
   Kriterium 6 unvereinbar.
8. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P4** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* `errText` gesetzt, aber `get_transcript` hat damit bei laufendem Anruf ein
  `isError` geliefert, und das aufrufende Modell hat das als endgueltiges Scheitern gelesen und
  den Anruf abgebrochen statt zu warten. *Entschaerfung:* der Text sagt woertlich, dass der Anruf
  noch laeuft und spaeter erneut zu versuchen ist (`loc.mcp.callStillRunning` enthaelt das
  bereits: "Bitte get_call_status pollen und spaeter erneut versuchen"). Der Review prueft den
  Wortlaut in **allen** Sprachfassungen in `src/i18n/mcp-texts.js`.
- *Was ist passiert:* die `instructions` wurden umgestellt und dabei der GQ-B2-Satz
  ("aus eigenen Quellen zuerst") gekuerzt. Der Consult-Kanal verlor seinen Nutzen, die
  Anrufqualitaet fiel — sechs Monate lang unbemerkt, weil kein Test den Inhalt prueft.
  *Entschaerfung:* **Umstellen und umformulieren, nicht kuerzen.** Abnahmekriterium 7: die
  Zeichenzahl darf sinken, aber ein Test pinnt die vier tragenden **Wirkungen** —
  ausdruecklich die Wirkung "eigene Quellen zuerst" und **nicht** die Aufzaehlung
  `calendar, mail, files`, die nach O-27 (Kriterium 6) im selben Zug verschwindet. Ein Pin
  auf die Aufzaehlung waere ein Pin, den dieselbe Phase sofort wieder brechen muesste.
- *Was ist passiert:* stdio bekam `instructions` — und zog dabei ueber
  `mcpServerOptions()` einen Store-Zugriff nach, den der stdio-Prozess bewusst nicht hat
  (Kommentar `src/mcp-server.js:22-24`: kein Store, sonst zweiter pg-Pool). Claude Desktop
  startete nicht mehr. *Entschaerfung:* `mcpServerOptions()` nimmt nur zwei Booleans und
  beruehrt keinen Store. Der Review belegt, dass der stdio-Aufruf **keine** neue
  Import-Abhaengigkeit einfuehrt (`node --check` plus ein Start-Smoke `npm run mcp` mit sofortigem
  EOF).

**Doppelte Pfade.** DP-1 (HTTP vs. stdio) — **das ist der Kern von T-21 in dieser Phase**.
Abnahmekriterium 5 macht ihn zur Bedingung. DP-5 (OWNER_PROFILE vs. DEFAULT_PROFILE): der
Basis-Instruktionsblock beseitigt die Varianz fuer T-21; die Tool-**Menge** bleibt varianz-behaftet
und ist P10.

---

### P5a — Datenminimierung am Output-Objekt (rein subtraktiv)

**Ziel.** Keine internen Konfigurationswerte mehr im Tool-Output; der Datenkontrakt von
`get_call_status` sagt, was er tut. Kein Geldpfad, kein tenant-sichtbarer Text, kein
Instruktionstext.

**IDs.** O-13 (Teil `voiceEngine`/`model`), O-14 (Restricted Data — separat geprueft).
**Nicht** N-15: die ID betrifft den Chatverlauf des Hosts, nicht ein Telefontranskript
(Abschnitt 0, letzte Zeile).

**Dateien.** `src/mcp-tools.js` (`pickAgentStatus` :385-386, `AGENT_STATUS_OUTPUT`, der
Kommentarblock :160-163), `test/mcp-tools.test.js`.

| Punkt | Ist | Soll | Wichtig |
|---|---|---|---|
| `voiceEngine`, `model` (O-13) | stehen im `get_agent_status`-Output (:385-386) | entfernen | Einordnung: das sind interne Produkt-/Konfigurationswerte (welche TTS-Engine, welches LLM), keine Session-/Trace-/Request-IDs im engen Wortlaut von O-13. Die Zuordnung ist eine **Wertung**. Sie werden trotzdem entfernt: sie leisten fuer den Nutzer nichts und sind bei einem Anbieterwechsel eine Aussage, die niemand pflegt. Die Felder verschwinden aus `pickAgentStatus` **und** aus `AGENT_STATUS_OUTPUT`. |
| Kommentarblock ueber `pickCallStatus` | `:160-163` beschreibt die Funktion als Whitelist ohne "Secret/Identitaet/Audio/Cross-Tenant-Feld" — wahr, aber unvollstaendig: direkt darunter (`:164-173`) reicht `pickCallStatus` **woertliche Drittzeilen** durch | den Block um **einen** Satz ergaenzen, der das benennt und auf den offenen Befund (P5b-Anhang) zeigt | **Korrektur am Kickoff:** dort stand, der Kommentar bei `:163` behaupte das Gegenteil. Das ist falsch (Abschnitt 0). `:163` sagt etwas ueber FELDER und bleibt wahr; der Satz "Das Roh-Transkript wird NIE durchgereicht" steht bei `:193-195` und gehoert zu `get_transcript`, wo er korrekt ist. Irrefuehrend ist nur das **Nebeneinander** — und genau das wird praezisiert. |
| O-14 (Restricted Data) | — | **Nachweis statt Aenderung** | Kein Tool-Output traegt PCI-DSS-Daten, PHI, staatliche Identifikatoren oder Zugangsdaten. Die Whitelist-Funktionen (`pickCallStatus`, `pickTranscript`, `pickAgentStatus`, `pickCall`) sind Positivlisten. Das wird belegt, nicht gebaut. **Einschraenkung, die in den Report gehoert:** `last_transcript_lines` bleibt (s. P5b-Anhang) — ueber diesen Kanal koennte ein Angerufener theoretisch woertlich etwas diktieren. O-14 gilt damit als erfuellt fuer alles, was der Server selbst erzeugt, und als **nicht abschliessend** fuer woertliche Gegenrede. |

**Abnahmekriterium (fremd-pruefbar).**
1. `grep -c "voiceEngine" src/mcp-tools.js` → **0** und `grep -c "agent.model" src/mcp-tools.js` → **0**.
   Ein gruener Test prueft am HTTP-Response von `get_agent_status`, dass beide Schluessel fehlen.
2. Der Kommentarblock ueber `pickCallStatus` nennt ausdruecklich, dass das Feld
   `last_transcript_lines` woertliche Zeilen der Gegenseite traegt. **Der Pruefer sucht die
   woertliche Zeichenkette `last_transcript_lines` im Kommentarblock `src/mcp-tools.js:160-163`
   und findet sie.** (Das frueher formulierte Kriterium "grep auf den alten Wortlaut = 0
   Treffer" ist gestrichen: es nannte keinen Wortlaut und war damit nicht ausfuehrbar — und der
   Wortlaut, den es meinte, war ohnehin am falschen Ort verortet.)
3. O-14: der Report nennt die vier Whitelist-Funktionen mit `datei:zeile` und den Satz, dass
   `last_transcript_lines` als **offener** Teilbefund weiterlaeuft. Eine Behauptung "O-14
   vollstaendig erfuellt" gilt als nicht erfuellt.
4. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P5a** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* `voiceEngine`/`model` wurden nur aus `pickAgentStatus` entfernt, nicht aus
  `AGENT_STATUS_OUTPUT`. Das Zod-Schema verlangte weiter zwei Felder, die
  `structuredContent` nicht mehr traegt — der SDK-Validator warf, `get_agent_status` lieferte
  "Output validation error". **Das ist derselbe Defekt wie T-19, neu erzeugt.**
  *Entschaerfung:* Abnahmekriterium 1 prueft am HTTP-Response, nicht an der Pick-Funktion.
- *Akzeptiertes Risiko:* `voiceEngine`/`model` zu entfernen nimmt einem Betreiber eine
  Selbstauskunft, die er heute im Dashboard nicht hat. Bewusst akzeptiert — der Kanal fuer
  Betriebswahrheit ist `/healthz` + `configHash`, nicht ein Kundentool.

**Doppelte Pfade.** DP-1 (HTTP vs. stdio): dieselbe `registerTools()`. DP-2 (mcp-nativ vs.
ChatGPT): die `_meta`-Form ist nicht betroffen, der `structuredContent`-Inhalt schon — auf
beiden gleich, weil er vor der Adapter-Wahl entsteht.

---

### P5b — Geldpfad und tenant-sichtbarer Text

**Ziel.** `failure_reason` traegt kein SIP-/Carrier-Detail mehr — **ohne** das
`not-placed`-Praefix zu brechen, an dem die Wiederholungssperre fuer kostenpflichtige Anrufe
haengt. Der tenant-sichtbare Consult-Hinweis draengt nicht mehr auf eine Permission-Entscheidung.

**IDs.** O-13 (Teil `failure_reason`), O-27 Teil 2 (`consultPermissionHint`).
**O-27 Teil 1 liegt in P4**, nicht hier (Begruendung dort).

**Warum eine eigene Phase mit eigener Gegenprobe.** Die Kuerzung von `failure_reason` ist ein
**Geld**-Risiko: bricht das Praefix-Matching, wiederholt das Host-Modell fehlgeschlagene Anrufe,
und jeder Versuch kostet Carrier-Geld. Das gehoert nicht in eine Phase mit Kosmetik.

**Dateien.** `src/mcp-tools.js` (`callOutcomeView` :156-158), `src/telephony/failure-reason.js`
(`failureReasonBase` :59-60, **nur lesend wiederverwenden**), `src/i18n/failure-reason-texts.js`,
`src/i18n/mcp-texts.js` (`consultPermissionHint` :71-73 DE, :142-144 EN und alle weiteren
Sprachen), `test/mcp-tools.test.js`.

| Punkt | Ist | Soll | Wichtig |
|---|---|---|---|
| `failure_reason` (O-13) | reicht `call.failureReason` **unveraendert** durch — ein Token mit SIP-/Carrier-Detail (`failed:603`, `not-placed:invite-403-D51`) | nur das Basis-Token, ohne Detail | **Es gibt bereits einen Minimierungs-Mechanismus im Bestand**: `failureReasonBase()` plus `FAILURE_REASON_TEXTS`, heute nur fuer den SMS-Kanal genutzt (`src/i18n/failure-reason-texts.js:12`: "der SIP-Detailwert bekommt bewusst KEINEN Nutzertext"). Er wird **wiederverwendet**, nicht neu gebaut. |
| — | — | — | **Bruchgefahr (Geld):** `MCP_CONSULT_INSTRUCTIONS` und das aufrufende Modell erkennen den Fall ueber `failure_reason.startsWith("not-placed")` (`src/mcp-server-info.js:111`). Das Basis-Token **behaelt** dieses Praefix (`failureReasonBase("not-placed:invite-403-D51")` → `"not-placed"`). Bricht das Praefix-Matching, wiederholt das Modell kostenpflichtige Anrufe. |
| O-27, Teil 2 | `consultPermissionHint` sagt tenant-sichtbar, die Werkzeug-Berechtigung muesse "auf Zulassen stehen" (`src/i18n/mcp-texts.js:71-73`, alle Sprachen), angehaengt an jedes `place_call`-Ergebnis mit Consult (`src/mcp-tools.js:956`) | neutral formulieren: **beschreiben**, dass Live-Rueckfragen eine erteilte Werkzeug-Berechtigung brauchen, **ohne** eine Einstellung zu fordern | Der Unterschied ist die Handlungsaufforderung. Sachinformation ist erlaubt, Draengen auf eine Permission-Entscheidung nicht. |

**Abnahmekriterium (fremd-pruefbar).**
1. Ein gruener Test belegt: fuer einen Anruf mit `failureReason = "not-placed:invite-403-D51"`
   liefert `get_call_status` bzw. `await_call_event` im `structuredContent`
   `failure_reason === "not-placed"` — **und** ein zweiter Test belegt, dass
   `failure_reason.startsWith("not-placed")` danach weiterhin wahr ist. Der Pruefer liest beide.
2. **Gegenprobe Geldpfad (namentlich):** ein gruener Test belegt, dass der
   `not-placed`-Erkennungssatz in `MCP_CONSULT_INSTRUCTIONS` (`src/mcp-server-info.js:111`)
   und der gekuerzte Feldwert **dieselbe** Zeichenkette verwenden — beide aus der Konstante
   `NOT_PLACED` (`src/telephony/failure-reason.js:79`), kein zweites Literal. Der Pruefer liest den Test und bestaetigt, dass er
   nicht gegen ein hart eingetipptes `"not-placed"` prueft.
3. **Gegenprobe Consult-Wirkung (namentlich):** ein gruener Test belegt, dass
   `consultPermissionHint` weiterhin an jedes `place_call`-Ergebnis mit Consult angehaengt
   wird (`src/mcp-tools.js:956`) und die Sachinformation traegt — die Neutralisierung darf
   den Hinweis nicht ersatzlos entfernen.
4. `consultPermissionHint` enthaelt in **keiner** Sprachfassung eine Aufforderung ("muss auf
   Zulassen stehen" / "needs to be set to Allow"). Der Pruefer greppt ueber
   `src/i18n/mcp-texts.js` und zaehlt die Sprachfassungen ab — **alle**, nicht nur DE/EN.
5. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Anhang zu P5b: `last_transcript_lines` — was NICHT passiert, und warum.**

Der Entwurf wollte das Feld ersatzlos entfernen mit der Begruendung "die Zusammenfassung liegt
bereits vor — das Feld ist redundant". **Beides ist am Code widerlegt, deshalb faellt die
Begruendung und die Aenderung mit ihr:**

- **Der Konsument ist live, nicht hypothetisch.** `src/ui/widgets/call.html:167` bindet den
  Slot (`data-mcp="last_transcript_lines"`), `:551` und `:584` rendern die Zeilen als
  Transkript-Zeile der Call-Karte; gespeist wird das aus `src/mcp-tools.js:1096`, und
  `place_call` setzt `:938` `last_transcript_lines: []` als Startwert fuer den Selbst-Poll der
  Karte. Mindestens sechs Testdateien haengen daran
  (`test/mcp-ui-i18n-divergence.test.js:108,:130`, `test/mcp-ui-w1-bind.test.js`,
  `test/mcp-ui-w1-call-widget.test.js`, `test/mcp-ui.test.js`, `test/mcp-tools-language.test.js`).
- **"Redundant" ist falsch.** Waehrend eines **laufenden** Anrufs existiert keine
  Zusammenfassung: `src/mcp-tools.js:190-191` haelt dafuer `AWAIT_SUMMARY_PLACEHOLDER`
  ("Noch keine Zusammenfassung verfuegbar") bereit. Genau in diesem Fenster ist die Karte
  nuetzlich, und genau dort waere sie nach der Entfernung leer.

**Entscheidung: der Punkt wird zurueckgelegt, nicht halb gebaut.** `last_transcript_lines`
bleibt unveraendert. Der Befund selbst bleibt **offen**: dieselben Rohzeilen sind die
Prompt-Injektionsflaeche gegen das Host-Modell (ein Angerufener diktiert Text, der ungefiltert
in den Host-Kontext laeuft). Ihn zu schliessen heisst: einen serverseitig gekuerzten,
ausdruecklich injektions-neutralisierten Ersatz bauen **und** `call.html` im selben Commit
darauf umstellen — das ist eine eigene Phase mit Live-Probe am Widget, keine Nebenwirkung einer
Minimierungsphase. **Folge fuer die Abnahme:** O-13 gilt nach P5a/P5b als **teilweise** erfuellt
(`failure_reason` und `voiceEngine`/`model` erledigt, `last_transcript_lines` offen). Der
Schluss-Agent (P11) zaehlt O-13 entsprechend und **nicht** als erledigt.

**Pre-Mortem P5b** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* `failureReasonBase()` wurde 1:1 auf die MCP-Kante gelegt, das
  `not-placed`-Praefix ging dabei verloren (z.B. weil jemand zusaetzlich auf den Bindestrich
  trennte), und das Modell wiederholte fehlgeschlagene Anrufe. Jeder Versuch kostete echtes
  Geld beim Carrier. *Entschaerfung:* Abnahmekriterien 1 und 2 pruefen genau dieses Praefix
  nach der Kuerzung, und zwar gegen **dieselbe Konstante**, die die Instruktion nennt.
  Zusaetzlich: `failureReasonBase()` wird **unveraendert wiederverwendet**, nicht kopiert oder
  nachgebaut — der Trenner ist dort eine Konstante (`DETAIL_SEPARATOR`,
  `failure-reason.js:35`), es entsteht keine zweite Zerlegeregel.
- *Was ist passiert:* `consultPermissionHint` wurde "neutralisiert", indem er ganz entfiel. Der
  Tenant sah nicht mehr, warum Live-Rueckfragen bei ihm nie ankommen, und meldete den
  Consult-Kanal als kaputt. *Entschaerfung:* Abnahmekriterium 3 verlangt, dass der Hinweis
  weiterhin angehaengt wird und die Sachinformation traegt.
- *Was ist passiert:* `last_transcript_lines` wurde doch entfernt, weil es "nur ein Feld" war,
  und die Call-Karte zeigte bei jedem Claude-Nutzer eine leere Transkript-Spalte.
  *Entschaerfung:* der Anhang oben ist die Entscheidung, nicht eine Warnung. Das Feld ist in
  dieser Phase **tabu**; wer es anfasst, baut den Ersatz und stellt `call.html` im selben
  Commit um.

**Doppelte Pfade.** DP-8 (`failure_reason` im MCP-Pfad vs. SMS-Notification-Pfad): der
Mechanismus wird geteilt, nicht dupliziert — der Review belegt, dass `failureReasonBase()`
**eine** Definition hat. DP-1 (HTTP vs. stdio): dieselbe `registerTools()`. DP-2 (mcp-nativ vs.
ChatGPT): die `_meta`-Form ist nicht betroffen, der `structuredContent`-Inhalt schon — auf
beiden gleich, weil er vor der Adapter-Wahl entsteht.

---

### P6 — Auth I: `WWW-Authenticate` auf allen 401-Pfaden

**Ziel.** Jede 401-Antwort von `/mcp` traegt die RFC-6750/9728-Challenge, egal in welchem
Auth-Modus. Der Legacy-Pfad wird **gehaertet, nicht entfernt** — und die
`render.yaml`-Drift wird als Owner-Punkt sichtbar gemacht.

**IDs.** T-13, T-5.

**Dateien.** `src/auth.js:94-117` (die drei rohen 401-Ruecksprunge ohne Header: :103, :110,
:114-116; `deny401` :66-72; die zwei Aufrufer :78, :90),
`render.yaml` (nur der Kommentar/Wert zu `MCP_AUTH`), `test/auth-mcp-bypass.test.js`,
`test/oauth.test.js`, `PLAN-SECURITY.md`.

**Warum eine eigene Phase.** Das ist Auth. Ein Fehler hier oeffnet `/mcp` oder schliesst es fuer
die Produktion. Die Phase bekommt eine eigene Gegenprobe und wird nicht mit P7 zusammengelegt.

**Befund (am Code nachgezaehlt, 2026-09-20).** `src/auth.js` hat **fuenf** Stellen mit
`res.status(401)`: eine **innerhalb** von `deny401()` (`:71`) und **drei rohe** in `mcpAuth`
(`:103`, `:110`, `:114-116`). `deny401()` wird an **zwei** Stellen gerufen, beide in
`verifyOauth` (`:78` und `:90`) — nicht `:75`/`:89`, wie ein frueherer Entwurf zitierte.
Damit ist die Zaehlung eindeutig: **drei** rohe 401-Ruecksprunge in `mcpAuth`, **zwei**
`deny401`-Aufrufe in `verifyOauth`. Die drei rohen sind `res.status(401).json({...})`
**ohne** `WWW-Authenticate`. Der Bestand kennt die Luecke bereits — `test/auth-p7-gate-removed.test.js:108-111`
haelt sie im Kommentar fest —, aber **kein Test fuehrt diesen Pfad aus**.

**Was konkret passiert.**
1. Alle **drei** rohen 401-Ruecksprunge in `mcpAuth` (:103, :110, :114-116) laufen ueber
   `deny401()`; die zwei Pfade in `verifyOauth` (:78, :90) tun es bereits. Danach gibt es im
   ganzen Modul genau **einen** Ort, der 401 sendet. Die Fehlercodes bleiben
   semantisch korrekt (`invalid_token` bei falschem/fehlendem Token). Der Body-Wortlaut darf
   sich aendern; die Statuscodes nicht.
2. **T-5, die Entscheidung:** der Legacy-Codepfad wird **nicht entfernt**. Begruendung: die
   Produktion nutzt ihn nachweislich nicht (D0-3, Live-Messung → oauth-Zweig), aber 37 von 53
   `/mcp`-Testdateien haengen am Loopback-Bypass (`test/helpers.js:569`). Eine Entfernung waere
   eine grossflaechige Testumstellung **ohne** Sicherheitsgewinn in Produktion — dort greift
   bereits `config.server.isProduction` und kippt den Bypass auf 401 (`src/auth.js:112-116`,
   getestet in `test/auth-mcp-bypass.test.js` AM1). Der Gewinn dieser Phase ist die Challenge,
   nicht die Amputation.
3. **Der echte T-5-Restposten ist Konfiguration, nicht Code:** `render.yaml` traegt fuer
   `MCP_AUTH` noch `value: ""` (Legacy). Live steht `oauth` (Dashboard). Ein Blueprint-Sync
   wuerde auf Legacy zurueckfallen. Das wird im `render.yaml` korrigiert **und** als
   Owner-Punkt notiert (Render-Services sind dashboard-verwaltet — ein Push macht nichts live).

**Abnahmekriterium (fremd-pruefbar).**
1. Ein gruener Test startet einen Server mit `MCP_AUTH=token` **ohne** gesetztes
   `MCP_AUTH_TOKEN`, sendet `POST /mcp` und prueft am **echten HTTP-Response**: Status 401
   **und** Header `www-authenticate` beginnt mit `Bearer resource_metadata=`. Analog fuer
   `MCP_AUTH=token` **mit** Token und falschem Bearer, und fuer den Legacy-Modus
   (`MCP_AUTH=""`) von einem **nicht**-Loopback-Socket bzw. mit `NODE_ENV=production`.
   **Drei Tests, drei Pfade.** Der Pruefer liest sie und bestaetigt, dass sie einen echten
   Server spawnen — `test/auth-mcp-bypass.test.js` prueft heute ueber ein `fakeRes()`, dessen
   `res.set()` ein No-Op ohne Aufzeichnung ist; **ein Fix waere dort unsichtbar**.
2. **Fuehrende Pruefung:** `grep -n "status(401)" src/auth.js` zeigt, dass **jeder** Treffer
   innerhalb von `deny401()` liegt oder es aufruft. Kein roher 401-Ruecksprung mehr. Heutiger
   Ist-Stand zum Abgleich: 5 Treffer (:71 in `deny401`, :103, :110, :114 roh).
3. `render.yaml`: `MCP_AUTH` traegt nicht mehr `value: ""`. Der Pruefer liest die Zeile.
4. Gegenprobe gegen Aufweichung: ein gruener Test belegt, dass `MCP_AUTH=oauth` mit gueltigem
   Token weiterhin **200** liefert und ohne Token **401** — die bestehenden Tests in
   `test/oauth.test.js` bleiben unveraendert gruen. Der Pruefer vergleicht `git diff` auf
   **mit expliziter Basis**: `git diff master...phase/<branch> -- test/oauth.test.js` ist
   **leer**. Der Branch-Name steht in der Phasen-Uebergabe; ohne Basis ist der Vergleich nach
   dem Merge nicht mehr formulierbar. Ersatzweise ohne Basis pruefbar: die Assertion-Zahl in
   `test/oauth.test.js` ist als Testname gepinnt.
5. `PLAN-SECURITY.md` ist aktualisiert (sicherheitsrelevante Aenderung, Pflicht aus CLAUDE.md).
6. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P6** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* beim Umbau der drei rohen 401-Zweige auf `deny401()` ist ein `return` verloren
  gegangen, der Request lief nach dem 401 in `next()` weiter, und `/mcp` war ohne Token
  erreichbar. Sechs Wochen offen, weil alle Tests nur den Statuscode prueften und der 401 ja
  kam. *Entschaerfung:* Abnahmekriterium 1 prueft am echten Server, nicht ueber ein Fake-`res`.
  Zusaetzlich verlangt der Review einen Test, der bei 401 belegt, dass **kein Tool ausgefuehrt
  wurde** (kein Body mit `jsonrpc`-Ergebnis).
- *Was ist passiert:* `deny401()` wurde in den Legacy-Zweig gelegt und verweist auf
  `metadataUrl()`, das aus `config.auth.oauthIssuerUrl`/`publicUrl` gebaut wird. Im
  Legacy-Modus sind die leer → die Challenge nennt eine kaputte URL, und ein Client rennt
  in eine Discovery-Schleife. *Entschaerfung:* der Review prueft `metadataUrl()` fuer den Fall
  "kein OAuth konfiguriert" und belegt, dass der Header dann entweder einen gueltigen Wert oder
  gar keinen `resource_metadata`-Parameter traegt — **nie** einen leeren.
- *Akzeptiertes Risiko:* der Legacy-Codepfad bleibt im Code. Wer ihn in Produktion aktiviert,
  umgeht OAuth. Bewusst akzeptiert, weil `isProduction` den Loopback-Bypass bereits kippt und
  eine statische Bearer-Pruefung per `safeEqual` keine Sicherheitsluecke ist, sondern ein
  schwaecheres Verfahren. Die verbleibende Angriffsflaeche ist eine Fehlkonfiguration — die
  `render.yaml`-Korrektur (Punkt 3) adressiert genau sie.

**Doppelte Pfade.** DP-4 (OAuth-Zweig vs. token/legacy-Zweig, **vier** 401-Ruecksprunge) — der
Kern dieser Phase; Abnahmekriterium 1 verlangt drei davon namentlich. DP-1 (HTTP vs. stdio):
stdio hat **keine** Auth (Vertrauensraum = lokaler Prozess) und ist fuer die Einreichung
irrelevant (kein oeffentliches HTTP). Der Report haelt das ausdruecklich fest, damit niemand
spaeter eine Luecke dort vermutet.

---

### P7 — Auth II: Fehlerkanal und Scope

**Ziel.** T-14 und T-12 entweder bauen oder belegt als nicht baubar festhalten; T-9/T-11/T-16
als Anbieterfrage dokumentieren.

**IDs.** T-14, T-12, T-9, T-11, T-16.

**Dateien.** `src/mcp-tools.js:82-84` (`errText`) und `:314-317` (`notAccepted`), `src/auth.js`,
Tests. **Bei Ausgang "nicht bauen": nur der Report.**

**Der Weg haengt an D0-6 und D0-7.**

| ID | Bedingung | Weg |
|---|---|---|
| T-14 | D0-6 = Ausloeser existiert | `_meta["mcp/www_authenticate"]` an genau **einem** Ort: die Fehlerhuelle `errText()`, angereichert wenn der interne REST-Hop eine Berechtigungsantwort liefert. Nicht pro Tool. |
| T-14 | D0-6 = kein Ausloeser | **nicht bauen.** Der Report belegt: nach `mcpAuth` (`src/routes/mcp.js:112`) prueft kein Handler ein Token; die Anforderung wird durch den Transport-Pfad (401 + Challenge, P6) erfuellt. Ein Feld ohne Ausloeser ist toter Code (CLAUDE.md, hart verboten). |
| T-12 | D0-7 = WorkOS stellt einen Scope aus | Pruefung in `verifyOauth` **nach** `jwtVerify`, fail-closed, mit einem Boot-Guard-Eintrag. |
| T-12 | D0-7 = kein Scope | **nicht bauen.** Eine Pruefung gegen einen Claim, den niemand ausstellt, ist entweder wirkungslos (greift nie) oder legt jeden Bestandstoken lahm. Der Report haelt fest: Signatur/JWKS, `iss`, `aud`, `exp`/`nbf` werden geprueft (`src/auth.js:81-84`) — die Scope-Achse ist UNKNOWN und liegt beim Anbieter. |
| T-9, T-11, T-16 (Metadata-Teil) | immer | **nicht baubar.** `resource_indicators_supported` (T-9), `authorization_response_iss_parameter_supported` (T-11) und `claims_supported` (T-16, Metadata-Teil) stehen ausschliesslich in **provider-gehosteten** Well-known-Dokumenten (WorkOS AuthKit, fremder Host). Unser Server erzeugt genau **ein** eigenes Well-known-Dokument: die Protected-Resource-Metadata (`src/auth.js:119-129`). Der Report belegt das lesend und notiert die drei als Owner-/Anbieter-Punkte. |
| T-16 (UserInfo-Teil) | Messung, nicht Annahme | **Der Entwurf hat T-16 auf "kein `claims_supported`" verkuerzt — das ist nur die halbe Anforderung.** Der massgebliche Wortlaut (Anforderungsliste Zeile 49) verlangt: OIDC-Discovery **plus** die Scopes `openid`/`email` **plus** einen UserInfo-Endpunkt, der `email` **und** `email_verified: true` liefert ("the UserInfo Endpoint is required for workspace domain restrictions"). Ob AuthKits UserInfo `email_verified: true` zurueckgibt, ist die eigentliche Frage — sie ist **lesend messbar**, sobald ein Token vorliegt, und wird deshalb als eigener Owner-Messpunkt in **OW-5** gefuehrt (derselbe abgeschlossene Login-Flow, der ohnehin fuer D0-7 gebraucht wird). Bis zur Messung: UNKNOWN mit Grund, nicht "Anbieterfrage, erledigt". |

**Ein Nebenbefund, der in den Report gehoert.** Die beiden AS-Metadata-Pfade liefern **live
unterschiedliche Feldmengen**: `/.well-known/openid-configuration` (den unser eigenes
`discoverJwksUri`, `src/auth.js:27-48`, zuerst probiert) enthaelt **kein**
`code_challenge_methods_supported`, `/.well-known/oauth-authorization-server` schon
(`["S256"]`). Das beruehrt **T-8** (PKCE-S256-Advertising, Pflicht). Ob ChatGPT denselben Pfad
zuerst abfragt wie wir, ist UNKNOWN. Der Punkt liegt ausserhalb des Kickoff-Vorrats, ist aber
ein potenzieller Einreichungs-Blocker und wird deshalb an den Owner gemeldet, nicht gebaut.

**Abnahmekriterium (fremd-pruefbar).**
1. Gebaut (T-14): ein gruener Test belegt am HTTP-Response, dass im Fehlerfall
   `_meta["mcp/www_authenticate"]` gesetzt ist **und** `isError:true` — und ein zweiter belegt,
   dass ein **normaler** Fehler (z.B. unbekannte `call_id`) das Feld **nicht** traegt. Ohne den
   zweiten Test ist der erste wertlos.
2. Nicht gebaut: der Report nennt fuer T-14 und/oder T-12 die lesende Messung aus Phase 0 mit
   `datei:zeile` bzw. Kommando und Ausgabe. Der Pruefer wiederholt sie. Eine Behauptung ohne
   wiederholbare Messung gilt als nicht erfuellt.
3. T-9/T-11/T-16 (Metadata-Teil): der Report enthaelt die drei `curl`-Kommandos gegen
   `https://fearless-network-26.authkit.app/.well-known/*` und die rohe Ausgabe, plus den
   Code-Beleg (`src/auth.js:119-129`), dass wir nur **ein** Well-known-Dokument erzeugen. Der
   Pruefer wiederholt die curls. **Zusaetzlich** nennt der Report den UserInfo-Teil von T-16
   (`email_verified`) ausdruecklich als UNKNOWN mit Verweis auf OW-5 — eine Zeile "T-16
   liegt beim Anbieter" ohne diese Unterscheidung gilt als nicht erfuellt.
4. Gegenprobe gegen Aufweichung: `test/oauth.test.js` unveraendert gruen —
   `git diff master...phase/<branch> -- test/oauth.test.js` ist **leer** (Branch-Name in der
   Phasen-Uebergabe). Ohne Basis ist das Kriterium nach dem Merge nicht formulierbar.
5. `PLAN-SECURITY.md` aktualisiert.
6. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P7** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* eine Scope-Pruefung wurde gebaut, WorkOS stellt keinen Scope aus, die
  Pruefung war fail-closed — und **jeder** Nutzer war ausgesperrt. Produktionsausfall am Tag des
  Deploys. *Entschaerfung:* D0-7 ist die Vorbedingung. Wird trotzdem gebaut, dann nur hinter
  einem Schalter mit Default **aus** und vier-Orte-Pflege (`src/config.js`, `.env.example`,
  `render.yaml`, `BASE_ENV` in `test/helpers.js`) — und der Report sagt ausdruecklich, dass der
  Schalter nicht ohne Owner-Freigabe umgelegt wird.
- *Was ist passiert:* `_meta["mcp/www_authenticate"]` wurde an `errText()` gehaengt und erschien
  seitdem bei **jedem** Tool-Fehler. ChatGPT zeigte bei jedem Netzfehler einen Re-Auth-Dialog,
  die Nutzer meldeten "die App loggt mich staendig aus". *Entschaerfung:* Abnahmekriterium 1
  verlangt den Negativ-Test. Zusaetzlich: das Feld haengt nicht an `errText()` pauschal, sondern
  an einer **eigenen** Fehlerursache.
- *Was ist passiert:* T-9/T-11/T-16 wurden als "erledigt, liegt beim Anbieter" abgehakt, der
  Owner hat bei WorkOS nie nachgefragt, und die Einreichung scheiterte an der
  Redirect-URI-Validierung (T-11). *Entschaerfung:* die drei stehen in der Owner-Liste mit dem
  konkreten Satz, der bei WorkOS anzufragen ist — nicht nur als "Anbieterfrage".

**Doppelte Pfade.** DP-4 (OAuth vs. Legacy): T-12 greift nur im OAuth-Zweig; der Report haelt
fest, dass der Legacy-Zweig keinen Token-Inhalt kennt und deshalb keine Scope-Achse hat. DP-1
(HTTP vs. stdio): T-14 wirkt ueber `registerTools()` auf beiden; stdio hat keinen Auth-Kontext,
das Feld waere dort wirkungslos — im Report festhalten, nicht per Sonderweg loesen.

---

### P8 — Widget-UI *(entfaellt, wenn D0-1 = OHNE UI oder D0-8 negativ)*

**Vorbedingung (neu, nach Kritik).** P8 wird **nicht gestartet**, bevor D0-8 beantwortet ist:
ob OpenAIs realer Client `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes`
mit `text/html+skybridge` deklariert. Das ist die **einzige** Bedingung, unter der
`chatgptRenderer` ueberhaupt gewaehlt wird (`src/ui/registry.js:43-50`). Faellt sie negativ
aus, laeuft jede Aenderung an `src/ui/adapters/chatgpt.js` ins Leere und P8 reduziert sich
auf T-34 am mcp-nativen Pfad (T-30/T-31 sind dort bereits erfuellt) — oder entfaellt. Die
Messung kostet nichts extra: sie haengt am selben Mitschnitt wie D0-4 (OW-4).

**Ziel.** Der ChatGPT-Adapter liefert dieselben Einreichungs-Pflichtfelder wie der mcp-native;
die Sprachvariante ueberlebt den 1-Stunden-Cache.

**IDs.** T-30 (CSP), T-31 (`_meta.ui.domain`), X-7 (`openai/widgetCSP.redirect_domains`),
X-3 (die tatsaechlichen OpenAI-`_meta`-Aliase), T-23 (beide Schluessel nebeneinander),
T-34 (Cache/Sprache).

**Dateien.** `src/ui/adapters/chatgpt.js:8-12`, `src/ui/contract.js` (`uiResourceUri` :21,
`uiSubmissionMeta` :88-92, `makeUiRenderer` :96-107), `src/ui/registry.js:43-50`,
`src/ui/widget-catalog.js:161-176`, `test/mcp-ui.test.js`.

**Befund.** `mcpNativeRenderer.buildMeta` ruft `uiSubmissionMeta()` und liefert
`{resourceUri, csp, domain}` (`mcp-native.js:16`). `chatgptRenderer.buildMeta` ist wortwoertlich
`(uri) => uri` — ein **flacher String**, ohne CSP, ohne Domain (`chatgpt.js:11`). Der gruene
Test `T-P3-AC2` (`test/mcp-ui.test.js:552-563`) **pinnt diesen unvollstaendigen Zustand als
Soll** — er muss in dieser Phase mitgeaendert werden, sonst blockiert er den Fix.

**T-23, auf den Wortlaut zurueckgefuehrt.** Der Entwurf hat hier eine SDK-Sperre
konstruiert und T-23 zum "Design-Entscheid" gemacht. Das ist zu viel. Der massgebliche
Wortlaut (Anforderungsliste Zeile 56) lautet woertlich:

> "Standard-Key `_meta.ui.resourceUri` bevorzugt, `_meta["openai/outputTemplate"]` nur als
> Kompatibilitaets-Alias" — Quellzitat: *"Prefer the MCP Apps standard key
> `_meta.ui.resourceUri`"*.

Das sind **zwei `_meta`-Schluessel am selben Tool-Deskriptor, die auf DIESELBE Resource
zeigen** — keine zweite Resource-Registrierung. Am Code ist das ohne Sperre erreichbar:
`makeUiRenderer` (`src/ui/contract.js:88-107`) trennt `registerResource()` (`:96-104`) und
`toolMeta()` (`:105`) bereits sauber; `toolMeta()` kann **beide** Schluessel liefern, ohne
dass eine zweite Resource entsteht. Die frueher angebotene Option (a) "getrennte URIs je
Konvention" wird **gestrichen**: sie braeche die Alias-Semantik (der Kompatibilitaets-Alias
zeigte dann auf ein anderes Template) und haette das alte Abnahmekriterium trotzdem
bestanden. **Bauvorgabe:** ein `toolMeta()`, zwei Schluessel, ein URI, eine Resource.

**T-34, der kleinere Weg.** Die Sprache steckt heute **nur im Inhalt** der Resource, nicht in
der URI (`contract.js:18-21`: "die ui://-URI bleibt bewusst sprachfrei";
`widget-catalog.js:175-176` waehlt `WIDGET_HTML_BY_LOCALE[...]`). Bei bis zu 1 h Cache unter
gleicher URI liefert der Host einem Tenant die Sprache eines anderen. **Sprach-Suffix in der
URI** (`ui://hermes/<widgetId>/<locale>`) ist der kleine Eingriff: eine Funktion plus ihre zwei
Aufrufer. **ETag/Versionierung wird nicht gebaut** — keine der zitierten OpenAI-Quellen sagt,
dass ChatGPT Conditional-GET respektiert; die Doku sagt nur, dass gecacht werden **darf**.

**Was aus X-3 tatsaechlich gebaut wird.** `openai/outputTemplate` (existiert bereits als
`CHATGPT_META_KEY`), `openai/widgetAccessible`, `openai/visibility` — je nach Bedarf der 5
Widgets. `openai/toolInvocation/*` kommt aus P2. `openai/profile` entfaellt (X-9, kein
Multi-Account). `openai/fileParams` entfaellt (kein Tool nimmt Dateien).
**`widgetDescription` wird nicht gebaut** — der Begriff existiert in keiner Quelle.

**Die Wahrheit, die im Report stehen muss.** Auch mit allen Feldern bleibt das Widget in einem
echten ChatGPT-Host nach heutigem Code voraussichtlich **leer**: das ausgelieferte Widget-HTML
spricht ausschliesslich das MCP-Apps-UI-Bridge-Protokoll (`ui/initialize` → `ui/notifications/tool-result`),
die `window.openai`-Bruecke wurde in Commit `364da8a` bewusst entfernt, weil sie im mcp-nativen
Host sichtbare JSON-RPC-Fehler ausloeste. Der gruene Test `T-P3-AC7` pinnt die Luecke
ausdruecklich als akzeptiert (`src/ui/registry.js:17-34`, `src/ui/widget-bind.js:2-16`).
**Diese Phase schliesst die Luecke nicht** — ein neuer, live-ungetesteter Brueckenbau ist exakt
das Muster, das `364da8a` schon einmal live gebrochen hat. Die Phase macht die Felder korrekt;
ob die Karte in ChatGPT lebt, bleibt offen und gehoert in die Owner-Liste.

**Abnahmekriterium (fremd-pruefbar).**
1. Ein gruener Test fuehrt `tools/list` mit ChatGPT-Capabilities
   (`capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes = ["text/html+skybridge"]`)
   aus und prueft fuer **jedes** der 5 Widget-Tools am Response, dass das ChatGPT-`_meta`
   `csp` mit `connectDomains`/`resourceDomains` und — sofern `publicUrl` gesetzt — `domain`
   traegt. Der Pruefer liest den Test und bestaetigt, dass `test/mcp-ui.test.js:552-563`
   (T-P3-AC2, der alte Pin) entsprechend angepasst wurde und nicht einfach geloescht ist.
2. Derselbe Test prueft den mcp-nativen Pfad **unveraendert** gruen — **beide Adapter in einem
   Testlauf**. Das ist DP-2; genau hier ist es beim letzten Mal auseinandergegangen.
3. T-23: ein gruener Test prueft am `tools/list`-Response, dass fuer **jedes** Widget-Tool
   **beide** Schluessel vorhanden sind — `_meta.ui.resourceUri` **und**
   `_meta["openai/outputTemplate"]` — und dass sie auf **denselben** URI zeigen
   (String-Gleichheit). **Und** derselbe Test belegt ueber `resources/list`, dass unter
   diesem URI genau **eine** Resource registriert ist. Der Pruefer liest den Test und
   bestaetigt beide Haelften; ein Test, der nur die Anwesenheit der Schluessel prueft,
   faengt getrennte URIs nicht.
4. T-34: `uiResourceUri` enthaelt die aufgeloeste Locale (`datei:zeile`); ein gruener Test
   belegt, dass zwei verschiedene Tenant-Sprachen zwei **verschiedene** URIs erzeugen und der
   Inhalt je URI der erwarteten Sprache entspricht.
5. `grep -rn "widgetDescription" src/` liefert **0** Treffer (der Punkt wurde bewusst nicht
   gebaut).
6. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P8** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* T-23 wurde umgesetzt, indem **beide Renderer** fuer dasselbe Widget
  aktiviert wurden. Der zweite `registerResource()` mit identischer URI warf
  (`Resource <uri> is already registered`,
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:473-481`, gelesen) — und zwar
  **im Request-Handler**, also als 500 bei jedem `tools/list` eines ChatGPT-Clients. Der
  Connector war tot. *Entschaerfung:* die Bauvorgabe oben (**ein** `toolMeta()` liefert zwei
  Schluessel, **eine** Resource) vermeidet den zweiten Aufruf ueberhaupt; Abnahmekriterium 3
  belegt ueber `resources/list`, dass unter dem URI genau eine Resource steht. Die SDK-Sperre
  bleibt mit Zeilennummer stehen, damit niemand sie fuer eine Vermutung haelt — sie ist aber
  **nicht** der Grund, T-23 zum Design-Entscheid zu machen.
- *Was ist passiert:* das Sprach-Suffix wurde in `uiResourceUri()` eingebaut, aber
  `registerResource()` und `toolMeta()` nutzen es unterschiedlich — das Tool zeigte auf
  `ui://hermes/call/de-DE`, registriert war `ui://hermes/call`. Kein Widget rendert mehr, auch
  nicht bei Claude. Live-Regression fuer Bestandsnutzer. *Entschaerfung:* beide Aufrufer liegen
  in **derselben Fabrik** (`makeUiRenderer`, `contract.js:96-107`) und bekommen denselben Wert
  aus einem Argument; Abnahmekriterium 4 prueft den Rundlauf ueber `resources/read`.
- *Was ist passiert:* die CSP-Listen wurden "sicherheitshalber" mit Domains gefuellt, von denen
  nichts laedt. Der Reviewer las das als Falschangabe. *Entschaerfung:* `UI_CSP` ist bereits
  belegt leer (`contract.js:66-73`: gemessen ueber alle 5 Widget-Quellen und 12 injizierte
  Bausteine, 0 Treffer fuer `fetch`/XHR/WebSocket/`@font-face`/absolute URLs). Die Listen
  bleiben leer; der Review wiederholt den grep.
- *Akzeptiertes Risiko:* die Widget-Karte bleibt in ChatGPT voraussichtlich stumm (Brueckenluecke
  `364da8a`). Bewusst akzeptiert: die Felder sind Einreichungs-Pflicht, die Bruecke ist eine
  eigene Entscheidung mit Live-Probe-Bedarf. Steht in der Owner-Liste.

**Doppelte Pfade.** DP-2 (mcp-nativ vs. ChatGPT-Adapter) — **der Kern dieser Phase**;
Abnahmekriterium 2 macht beide Pfade in einem Lauf zur Bedingung. DP-1 (HTTP vs. stdio): `uiHost`
wird an zwei Stellen unabhaengig konstruiert (`src/routes/mcp.js:150-158` mit Capabilities,
`src/mcp-server.js:26-28` ohne) — eine Aenderung in `contract.js`/`registry.js` wirkt auf beide,
**muss aber auf beiden gegengeprueft werden**, weil die Konstruktion dupliziert ist. DP-7
(`enableWidgetUi`-`_meta`): durch P2 bereits auf einen Merge-Ort gebracht.

---

### P9 — Transport/CORS *(entfaellt, wenn D0-4 = server-seitig)*

**Ziel.** `/mcp` ist fuer OpenAI erreichbar, **ohne** die Herkunftswache aufzuweichen.

**IDs.** T-29, T-4.

**Dateien.** `src/middleware.js:150-219`, `src/routes/mcp.js:101-116`, `src/config.js`
(`mcpAllowedOrigins`, `mcpOriginEnforce`), `.env.example`, `render.yaml`, `test/helpers.js`.

**Warum diese Phase ganz am Ende steht.** Die heutige Strenge ist die **sichere** Richtung.
Sie wird nicht auf Verdacht aufgeweicht. Ohne die Owner-Messung aus D0-4 wird hier **keine
Zeile** geaendert.

**Der Befund, der die Phase praegt.** Ein Allowlist-Eintrag allein wuerde nichts loesen: die
Wache ist **rein ablehnend** (403 bei Fremd-Origin, `createMcpOriginGuard`,
`src/middleware.js:207-219`). Der Server sendet **nie** `Access-Control-Allow-Origin` — auch
nicht bei passendem Origin (`grep -rn "access-control\|cors" src/` → 0 Treffer). Ein
browserseitiger Aufrufer scheitert also an der fehlenden **Freigabe**, nicht nur an der
Ablehnung. Waere D0-4 = browserseitig, braeuchte es beides: Allowlist **und** echte CORS-Header
inklusive `mcp-session-id` in `Access-Control-Allow-Headers`/`-Expose-Headers` (T-29 woertlich).

**T-4 ist gegenstandslos** und wird nicht gebaut: die Submission-Doku verlangt woertlich
"Support the MCP streamable HTTP transport" und nennt SSE **nicht**; SSE steht nur in der
Developer-Mode-Doku, und Developer Mode ist laut W-1/W-2 kein oeffentlicher Weg. Heute:
`GET /mcp` mit `Accept: text/event-stream` → 405 (`src/routes/mcp.js:174-176`, live bestaetigt).

**Abnahmekriterium (fremd-pruefbar).**
1. **Entfallen (D0-4 = server-seitig):** der Report zitiert die Owner-Messung (Request ohne
   `Origin`-Header, Quell-IP) und belegt lesend, dass die Wache erst bei vorhandenem `Origin`
   greift (`src/middleware.js:207-219`). **Mit expliziter Basis:**
   `git diff --stat master...phase/<branch> -- src/middleware.js src/routes/mcp.js` ist
   **leer** (Branch-Name in der Phasen-Uebergabe). Ohne Basis ist das Kriterium nach dem Merge
   nicht formulierbar; dann tritt an seine Stelle der direkte Code-Beleg, dass
   `createMcpOriginGuard` unveraendert rein ablehnend ist und `grep -rn "access-control" src/`
   weiterhin **0** Treffer liefert. Das ist das Abnahmekriterium: **nichts gebaut, belegt
   warum.**
2. **Gebaut (D0-4 = browserseitig):** ein gruener Test belegt am echten HTTP-Response fuer den
   freigegebenen Origin: Status ist **nicht** 403, `access-control-allow-origin` traegt **exakt**
   diesen Origin (kein `*`), `access-control-allow-headers` enthaelt `mcp-session-id`,
   `access-control-expose-headers` ebenso. **Und** ein zweiter Test belegt, dass ein **nicht**
   freigegebener Fremd-Origin weiterhin 403 `cross_origin_blocked` bekommt und **keinen**
   `access-control-allow-origin` erhaelt. Ohne den zweiten Test ist der erste eine Aufweichung.
3. T-4: der Report nennt das Zitat aus `https://developers.openai.com/plugins/build/mcp-server`
   und den Code-Beleg fuer den heutigen 405. Der Pruefer liest beides.
4. `PLAN-SECURITY.md` aktualisiert.
5. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P9** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* CORS wurde "sicherheitshalber" mit `Access-Control-Allow-Origin: *`
  freigegeben, damit es auf jeden Fall funktioniert. Ein beliebiger Browser konnte danach im
  Namen eines eingeloggten Nutzers `/mcp` ansprechen — und `/mcp` loest echte Anrufe aus.
  *Entschaerfung:* Abnahmekriterium 2 verbietet `*` ausdruecklich und verlangt den
  Negativ-Test. Zusaetzlich: `Access-Control-Allow-Credentials` wird **nicht** gesetzt (Auth
  laeuft ueber Bearer, nicht ueber Cookies).
- *Was ist passiert:* die Phase wurde ohne die Owner-Messung gefahren, weil "es sonst nicht
  weitergeht". Die Wache wurde auf Verdacht geoeffnet, OpenAI fragt server-seitig an, und die
  Aufweichung hat nur die Angriffsflaeche vergroessert. *Entschaerfung:* Abnahmekriterium 1 ist
  ein vollwertiger Abschluss der Phase. **Nichts bauen ist hier ein Ergebnis, kein Aufschub.**

**Doppelte Pfade.** DP-1 (HTTP vs. stdio): stdio hat kein Origin-Konzept — strukturell N/A, kein
Gap. DP-6 (Gateway vs. Static-Site): `sundartha.com` hat eine eigene Header-Konfiguration; T-29
betrifft **nur** den Gateway. Im Report festhalten.

---

### P10 — Randpunkte und Reviewer-Konsistenz

**Ziel.** Die billigen, echten Luecken schliessen und die bewussten Entscheidungen belegt
stehen lassen.

**IDs.** I-1 (`/healthz`), I-2 (Referrer-Policy, `security.txt`, HSTS), I-3
(`POST sundartha.com/mcp`), I-4 (Tool-Mengen-Varianz). Beruehrt N-5/N-6, O-9.

**Dateien.** `render.yaml` (Header-Block des Static-Service `hermes-web`, :779-810),
`src/app.js` (neue `security.txt`-Route), `src/route-policy.js` (Pflicht-Eintrag fuer jede
unauthentifizierte Route), `src/config.js` + `.env.example` + `render.yaml` + `test/helpers.js`
(nur falls der Kontakt aus einer Env kommt), `test/route-auth-inventory.test.js`.

| Punkt | Entscheidung | Begruendung |
|---|---|---|
| I-1 `/healthz` mit Commit-SHA + `configHash` | **nichts aendern**, im Report belegen | Dokumentierte Entscheidung (GAP-36 "Deploy-Wahrheit"). `configHash` ist ein SHA-256-Einweg-Hash ueber 7 nicht-geheime Betriebsachsen (`src/config-fingerprint.js:16-38`, der Kommentar zitiert Absolute Regel 4), **nie** ein Rohwert. Der Eintrag steht in `src/route-policy.js:74-79` und wird von `test/route-auth-inventory.test.js` erzwungen. **Keine ID der 100er-Liste verlangt eine Aenderung.** |
| I-2a Referrer-Policy auf `sundartha.com` | **bauen** (`render.yaml`-Header-Block) | Echter Gap, live gemessen: `sundartha.com` liefert `x-content-type-options`, `x-frame-options`, HSTS und CSP, aber **kein** `referrer-policy`. Der Gateway setzt es zentral (`src/middleware.js:41-47`). Reine Abweichung von der sonst durchgezogenen Header-Politik. **Achtung:** der Static-Service ist dashboard-verwaltet (`render.yaml:770-773`) — ein Push macht es nicht live. Owner-Punkt. |
| I-2b `/.well-known/security.txt` | **bauen** auf dem Gateway, nach dem Muster der Challenge-Route | RFC 9116, Kontakt-Konvention. Baulich identisch zum vorhandenen `openai-apps-challenge`-Muster (statischer Text unter `.well-known`), keine neue Architektur. Eintrag in `src/route-policy.js` ist Pflicht (Absolute Regel 3), sonst schlaegt `test/route-auth-inventory.test.js` fehl. |
| I-2c HSTS ohne `preload` | **nichts aendern**, im Report belegen | Bewusste, begruendete Entscheidung (`src/middleware.js:24-32`): die Preload-Zusage ist praktisch unwiderruflich; 180 Tage `max-age` ist das kleinste Zeitfenster im Fehlerfall. Eine Aenderung waere eine **neue** Sicherheitsentscheidung, nicht Teil dieses Auftrags. |
| I-3 `POST sundartha.com/mcp` → 200/0 Byte | **nichts aendern**, im Report belegen | Kein Hermes-Code: plattformweites Verhalten des Render-Static-Service. Gegenprobe gemessen — ein Zufallspfad und `/` liefern ebenfalls 200/0 Byte. Eine Behebung laege ausserhalb von `src/` (Cloudflare-Regel vor dem Static-Service) und ist Infra-Arbeit. Fuer die Einreichung irrelevant: OpenAI bekommt die exakte MCP-URL als Formularfeld. |
| I-4 Tool-Mengen-Varianz pro Tenant | **nicht technisch abfangen**, ausdruecklich festhalten | `await_call_event`/`answer_consult` haengen an `consultAllowed` (`src/mcp-tools.js:968`), `get_calendar` an `allowCalendar` (`:1295`). `OWNER_PROFILE` → 12 Tools (`src/store/defaults.js:1056-1065`), `DEFAULT_PROFILE` → 9 (`:1069-1078`) — **und das ist nur die Ober-/Untergrenze**: jeder ZAHLENDE Plan erreicht hoechstens 11 (`PAID_PLAN_PROFILE.allowCalendar:false`, `src/plans.js:107-111`, `:147-148`), in der heutigen Produktion mit `CONSULT_ENABLED=false` (`render.yaml:424-425`, Default `false` `src/config.js:1663`) sind es 10 (Owner) bzw. 9 (alle uebrigen), stdio liefert 10 (`src/mcp-tools.js:657-666`, `src/mcp-server.js:26-28`). Vollstaendige Staffelung mit Belegen: `tasks/openai-p0-entscheidungen.md`, Abschnitt "Baseline". Das ist MCP-konform (Variation je Autorisierung ist erlaubt) und **produktgewollt** — ein Tenant ohne Consult-Berechtigung soll die Werkzeuge nicht sehen. Das echte Risiko ist der **Review-Prozess**: sieht der Reviewer-Demo-Account 9 statt 12 Tools, bewertet er ein unvollstaendiges Set (N-5/N-6). Abhilfe ist die **Demo-Account-Konfiguration** — ein Owner-Punkt (O-9), kein Code-Gap. Technisch abzufangen hiesse, die Berechtigung zu untergraben. |

**Abnahmekriterium (fremd-pruefbar).**
1. `curl -I https://<gateway>/` (lokal gespawnter Server genuegt) zeigt `referrer-policy`
   weiterhin; `render.yaml` enthaelt im `hermes-web`-Header-Block eine `Referrer-Policy`-Zeile
   (der Pruefer liest sie). Dass die Live-Wirkung eine Dashboard-Eingabe braucht, steht im
   Report.
2. Ein gruener Test belegt: `GET /.well-known/security.txt` liefert 200 mit
   `content-type: text/plain` und einer `Contact:`-Zeile; die Route steht mit Begruendung in
   `src/route-policy.js`; `test/route-auth-inventory.test.js` ist gruen. Der Pruefer liest den
   `route-policy`-Eintrag.
3. Wurde eine Env eingefuehrt: sie steht an **allen vier** Orten (`src/config.js`,
   `.env.example`, `render.yaml`, `BASE_ENV` in `test/helpers.js`). Der Pruefer greppt den Namen
   und zaehlt vier Treffer. Bei weniger als vier gilt der Punkt als nicht erfuellt.
4. I-1, I-2c, I-3, I-4: der Report nennt je Punkt den Code-Beleg (`datei:zeile`) bzw. die
   Messung, die die Nicht-Aenderung traegt. Der Pruefer wiederholt sie stichprobenartig.
5. `npm test -- -- --test-concurrency=4`: `# fail 0` (nur `# pass`/`# fail` zaehlen, nicht der Exit-Code; der doppelte `--`-Trenner ist Pflicht, s. P1.6).

**Pre-Mortem P10** — *ein Jahr spaeter: die Phase war ein Fehler.*
- *Was ist passiert:* `security.txt` wurde gebaut, aber **ohne** Eintrag in
  `src/route-policy.js`. `test/route-auth-inventory.test.js` wurde rot, jemand hat den
  Routen-Fingerprint "nachgezogen" statt den Eintrag zu schreiben — und damit die Wirkung des
  Gates aufgehoben. *Entschaerfung:* Abnahmekriterium 2 verlangt, dass der Pruefer den
  `route-policy`-Eintrag **liest**. Ein nachgezogener Fingerprint ohne Eintrag faellt dabei auf.
- *Was ist passiert:* `security.txt` nannte eine persoenliche E-Mail-Adresse. Sie landete in
  Scraper-Listen. *Entschaerfung:* der Kontakt ist die vorhandene Support-Adresse aus dem
  Listing (O-8), keine private. Steht in der Owner-Liste, falls noch keine existiert.
- *Was ist passiert:* I-4 wurde "technisch abgefangen", indem alle 12 Tools immer registriert
  wurden und die nicht berechtigten bei Aufruf einen Fehler lieferten. Ein Tenant ohne
  Consult-Berechtigung sah seitdem zwei Werkzeuge, die nie funktionieren — schlechteres Produkt
  **und** eine N-13-Verletzung (Beschreibungen bilden das Verhalten nicht ab).
  *Entschaerfung:* die Entscheidung steht oben ausdruecklich: **nicht abfangen**, Owner-Punkt.
- *Akzeptiertes Risiko:* `/healthz` gibt den Commit-SHA weiter. Ohne Zugriff auf das private
  Repo ist er wertlos; der Hash ist nicht rueckrechenbar. Bewusst getragen, dokumentiert.

**Doppelte Pfade.** DP-6 (Gateway-Express-Header vs. Render-Static-Header) — genau hier ist der
Referrer-Policy-Punkt auf einem von zwei Pfaden erfuellt; die Phase adressiert den zweiten.
DP-5 (OWNER_PROFILE vs. DEFAULT_PROFILE) — bewusst **nicht** aufgeloest, als Owner-Punkt
festgehalten.

---

### P11 — Schlussabnahme (KEIN Code)

**Ziel.** Ein Agent, der keine Phase gebaut und keinen Phasen-Report gelesen hat, prueft alle
IDs des Vorrats erneut gegen die 100er-Liste und nennt die Zahl.

**Zaehlregel (bindend).** Der Schluss-Agent zaehlt **nur** als erfuellt, was eine der drei
Beweisarten traegt. Ausdruecklich **nicht** erfuellt sind: O-4 und O-5, solange keine lesende
Messung gegen den Live-Host den Token-Text bzw. die eingetragene Challenge-Base belegt
(Status "gebaut, blockiert an OW-1/OW-2"); O-13, solange `last_transcript_lines` offen ist
(teilweise erfuellt); T-16, solange der UserInfo-Teil (`email_verified`) ungemessen ist. Einen
Status "erledigt" gibt es in Abschnitt 8 nicht.

**Abnahmekriterium.** Ein Bericht, der fuer jede Zeile der ID-Abdeckungstabelle (Abschnitt 8)
eine der drei Beweisarten nennt: Code mit `datei:zeile`, ein gruener Test, **in den der Agent
hineingesehen hat** (Testname plus die tragende Assertion), oder eine lesende Messung mit
Kommando und Ausgabe. Behauptungen ohne Beweisart zaehlen als **nicht erfuellt**. Widerspricht
der Bericht einem Phasen-Report, gewinnt der Bericht.

**Pre-Mortem P11.** *Was ist passiert:* der Schluss-Agent hat die Phasen-Reports gelesen und
ihre Behauptungen uebernommen — genau der Fehler, den die vorige Abnahmepruefung aufgedeckt hat.
*Entschaerfung:* der Agent bekommt die ID-Tabelle und die 100er-Liste, **nicht** die Reports.
Die Frage wird neutral gestellt ("ist X erfuellt und woran siehst du das"), nie bestaetigend.

---

## 4. Was NICHT gebaut wird — und warum

| Punkt | Grund |
|---|---|
| **T-24 / T-25** `search`/`fetch` | Nur fuer ChatGPT Deep Research / Company Knowledge. Hermes hat keinen Dokumentenkorpus und kein Retrieval-Produkt; kein Produkt- oder Strategiedokument nennt die Absicht (grep ueber CLAUDE.md, STATUS.md, README.md: 0 Treffer). Zwei Tools mit festen Schemas plus eine Inhaltsquelle waeren ein neues Produkt, nicht eine Einreichungsarbeit. |
| **X-9** Profil-Tool | Kategorie C, "nur bei Multi-Account". Die Architektur kennt kein Multi-Account: ein Request loest **genau einen** Tenant aus **genau einem** verifizierten JWT-`sub` auf (`src/routes/mcp.js:116`), es gibt keinen Mechanismus zum Kontowechsel innerhalb einer Verbindung. |
| **T-17** mTLS | In der Anforderungsliste selbst als Kategorie C ("optional OpenAI-managed mTLS") gefuehrt. Keine Pflicht, keine Handlung fuer die Einreichung. |
| **T-33** Tool-Versionierung | Beschreibt OpenAIs Post-Launch-Continuous-Review. Setzt eine **bereits publizierte** Integration voraus. Hermes ist nicht eingereicht — es gibt heute nichts zu bauen. Wird mit dem ersten Produktiv-Update nach einer Publikation operativ relevant; gehoert dann in ein Betriebs-Runbook, nicht in diesen Plan. |
| **T-4** SSE auf `/mcp` | Die Submission-Doku verlangt woertlich nur "the MCP streamable HTTP transport". SSE steht ausschliesslich in der Developer-Mode-Doku, und Developer Mode ist laut W-1/W-2 der **private** Weg. Gegenstandslos fuer die Einreichung. |
| **T-9 / T-11 / T-16** AuthKit-Metadata | Alle drei Felder stehen ausschliesslich in **provider-gehosteten** Well-known-Dokumenten (WorkOS AuthKit — fremder Host, fremdes Zertifikat, kein Code von uns dazwischen). Unser Server erzeugt genau ein eigenes Well-known-Dokument (`src/auth.js:119-129`). In diesem Repo nicht baubar. → Owner-/Anbieterliste. |
| **T-12** Scope-Pruefung, falls D0-7 negativ | Eine fail-closed Pruefung gegen einen Claim, den der Authorization Server nicht ausstellt, sperrt entweder niemanden aus (wirkungslos) oder alle (Ausfall). Erst messen, dann bauen. |
| **T-14** `_meta["mcp/www_authenticate"]`, falls D0-6 negativ | Es gibt im Code keinen Pfad, der eine Berechtigung **waehrend** eines Tool-Aufrufs pruefen wuerde. Ein Feld, das nie gesetzt wird, ist toter Code — in CLAUDE.md hart verboten. Der Transport-Pfad (401 + Challenge, P6) deckt die Anforderung ab; die Abweichung wird belegt festgehalten. |
| **`widgetDescription`** (aus dem Kickoff-Vorrat unter X-3) | Existiert in **keiner** der beiden Anforderungsquellen und in keinem alten Report (grep: 0 Treffer). Herkunft UNKNOWN. Gegen eine Anforderung zu bauen, die die massgebliche Quelle nicht kennt, ist dieselbe Fehlerklasse wie die `destructiveHint`-Verwechslung. |
| **`openai/locale`** (im Kickoff unter X-3 gefuehrt) | Gehoert zu **X-4** und ist ein **Client**-Feld: der Host schickt es mit dem Request. Der Server setzt es nie. Nichts zu bauen. Relevant waere allenfalls, es zu **lesen** — das tut Hermes bewusst nicht, weil die Sprache aus dem Tenant aufgeloest wird (`src/routes/mcp.js:127`), mit **einer** Regel fuer Anruf, Self-Service und MCP. |
| **ETag/Versionierung fuer UI-Resources** (T-34-Alternative) | Keine der zitierten OpenAI-Quellen sagt, dass ChatGPT Conditional-GET oder ETags auf Resource-Reads respektiert — die Doku sagt nur, dass bis zu 1 h gecacht werden **darf**. Ein Mechanismus gegen eine unbelegte Client-Faehigkeit ist ein Griff ins Ungewisse. Der Sprach-Suffix-Weg loest dasselbe Problem ohne diese Annahme. |
| **Die `window.openai`-Widget-Bruecke** | Wurde in `364da8a` bewusst entfernt, weil sie im mcp-nativen Host live JSON-RPC-Fehler ausloeste. Ein neuer Brueckenbau ohne Live-Probe gegen einen echten ChatGPT-Host wiederholt exakt dieses Muster. Gehoert in die Owner-Liste, nicht in eine Einreichungs-Kosmetik-Phase. |
| **Ersatzlose Entfernung von `last_transcript_lines`** | Der Entwurf wollte das Feld streichen, weil "die Zusammenfassung bereits vorliegt". Am Code widerlegt: `src/ui/widgets/call.html:167/:551/:584` rendert das Feld live, und waehrend eines **laufenden** Anrufs existiert keine Zusammenfassung (`AWAIT_SUMMARY_PLACEHOLDER`, `src/mcp-tools.js:190-191`). Das Feld bleibt; der Injektions-Befund bleibt **offen** und braucht einen Ersatz plus Widget-Umstellung in einem Commit — eigene Phase, nicht Teil dieses Plans. Siehe P5b-Anhang. |
| **N-15** (im Entwurf faelschlich `last_transcript_lines` zugeordnet) | N-15 verbietet, den vollstaendigen **Chatverlauf des Hosts** zu ziehen/rekonstruieren/erschliessen. Ein Telefontranskript ist kein Chatverlauf. Hermes nimmt nirgends Konversationshistorie entgegen. Nichts zu bauen. |
| **`/healthz` hinter Auth** | Dokumentierte Entscheidung (GAP-36), von keiner ID der 100er-Liste verlangt, und der Zweck (Deploy-Verifikation an einem dashboard-verwalteten Dienst) verlangt die Unauthentifiziertheit. |
| **HSTS `preload`** | Bewusste, begruendete Entscheidung (`src/middleware.js:24-32`): praktisch unwiderrufliche Zusage. Eine Aenderung waere eine neue Sicherheitsentscheidung. |
| **`POST sundartha.com/mcp` → 404** | Plattformverhalten des Render-Static-Service (gegengeprueft: jeder Pfad antwortet so), nicht in `src/` oder `apps/web` beeinflussbar. Fuer die Einreichung irrelevant. |
| **Entfernung des Legacy-Auth-Codepfads** | Produktion nutzt ihn nachweislich nicht; 37 von 53 `/mcp`-Testdateien haengen am Loopback-Bypass. Entfernung = grossflaechige Testumstellung ohne Sicherheitsgewinn (Produktion ist ueber `isProduction` bereits fail-closed). Der Gewinn liegt in der Challenge (P6) und in der `render.yaml`-Korrektur. |
| **Alle Safety-Gates aus CLAUDE.md** | Unantastbar. Keine Aufweichung "fuer die Einreichung". Betrifft insbesondere: Outbound-Permit (Abo+KYC), `OUTBOUND_FROZEN`, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke (beide Richtungen), Max-Gespraechsdauer, Telnyx-Ed25519-Signaturpruefung. |
| **Der fest verdrahtete Offenlegungssatz** | Bleibt unveraendert erster Satz jedes Outbound-Calls. Die Owner-Ausnahme fuer den Anruf an die eigene hinterlegte Nummer (OC, 2026-08-20) bleibt in ihrem engen, fail-closed Umfang und wird von keiner Phase beruehrt. |
| **Owner-Punkte und Rechtstexte** | Per Auftrag ausgeschlossen: O-1..O-3, O-6..O-12, O-15..O-26, O-28..O-31, W-1..W-7, T-2, T-32, T-35, T-36. Sie stehen in der ID-Tabelle als "Owner", damit niemand sie fuer vergessen haelt. |

---

## 5. Nur der Owner kann das

Nichts davon blockiert die Kette. Alles wird vorbereitet und getestet, aber **nicht ohne
Freigabe live umgelegt.**

| # | Punkt | Was vorbereitet ist | Was der Owner tun muss |
|---|---|---|---|
| OW-1 | **Challenge-Token** (O-4) | Route, Env, Tests, `render.yaml`-Eintrag stehen vollstaendig (`src/app.js:184-187`, `test/openai-e7-challenge.test.js` 9/9 gruen). Live liefert `app.sundartha.com/.well-known/openai-apps-challenge` sauber 404/0 Byte — der erwartete Zustand vor der Einreichung. | Token im OpenAI-Portal beziehen und als `OPENAI_APPS_CHALLENGE_TOKEN` im **Render-Dashboard** setzen (nicht in `render.yaml` — der Dienst ist dashboard-verwaltet). |
| OW-2 | **Challenge-Base im Portal** (O-5) | Belegt: `app.sundartha.com` erfuellt die Anforderung bereits sauber; `sundartha.com` liefert dort eine 6-KB-HTML-404. O-5 ignoriert den Pfad und erlaubt MCP-Host **oder** Parent-Host. | Im Submissions-Formular **`app.sundartha.com`** eintragen, nicht `sundartha.com`. Dann ist an `apps/web` nichts zu tun. |
| OW-3 | **UI ja / nein** (D0-1) | Drei Optionen mit Folgen (s. u.). Beide Zweige sind im Plan vorbereitet (P8 vorhanden bzw. abschaltbar). | Entscheiden. `MCP_UI_ENABLED` ist ein **globaler** Schalter fuer **einen** `/mcp`-Endpunkt: ausschalten nimmt **gleichzeitig** den heutigen Claude-Nutzern die Live-Karte. Das ist eine Produktentscheidung mit Nutzenfolge, keine Einstellung. |
| OW-4 | **CORS-Messung + UI-Capability** (D0-4, D0-8, T-29, U-7) | Phase 0 schreibt die Mess-Anleitung; der Ist-Zustand ist lesend belegt. | `https://app.sundartha.com/mcp` als Developer-Mode-Connector in ein echtes ChatGPT-Konto haengen und am Server mitlesen. **Drei Dinge am selben Mitschnitt:** (1) traegt der Request einen `Origin`-Header (D0-4), (2) von welcher IP kommt er, (3) was steht im `initialize`-Request unter `params.capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` (D0-8/U-7 — daran haengt, ob P8 ueberhaupt etwas bewirkt). **Kein Agent kann das.** Bis dahin bleibt die Wache unveraendert streng und P8 ungestartet. |
| OW-5 | **WorkOS-Scope + UserInfo-Claims** (T-12, D0-7, **T-16 UserInfo-Teil**) | Live gemessen: der AS bewirbt nur `[email, offline_access, openid, profile]` — kein ressourcenspezifischer Scope. | Zwei Dinge am **selben** abgeschlossenen Login-Flow: (1) klaeren, ob Connect einen eigenen Scope fuer diese Resource ausstellen kann und ob er als `scope`/`scp` im Access-Token ankaeme (ohne diese Antwort wird keine Scope-Pruefung gebaut); (2) **den UserInfo-Endpunkt mit dem erhaltenen Token abrufen und pruefen, ob er `email` UND `email_verified: true` liefert** — das ist die eigentliche T-16-Frage (Anforderungsliste Zeile 49: "the UserInfo Endpoint is required for workspace domain restrictions"). Sie ist lesend messbar und wurde bisher nirgends gestellt. |
| OW-6 | **AuthKit-Metadata** (T-9, T-11, T-16) | Belegt: alle drei Felder fehlen in **beiden** Well-known-Dokumenten des Issuers; wir erzeugen sie nicht und koennen es nicht. | Bei WorkOS anfragen, ob `resource_indicators_supported` (T-9), `authorization_response_iss_parameter_supported` (T-11) und `claims_supported` (T-16) in die ausgelieferte AS-Metadata aufgenommen werden koennen. **T-11 ist potenziell ein Einreichungs-Blocker:** ohne RFC-9207-`iss` verlangt OpenAI die callback-spezifische Redirect-URI statt der stabilen. |
| OW-7 | **T-8 PKCE-Advertising** (Nebenbefund aus P7, nicht im Vorrat) | Gemessen: `/.well-known/openid-configuration` (den unser eigenes Discovery **zuerst** probiert) enthaelt **kein** `code_challenge_methods_supported`; `/.well-known/oauth-authorization-server` schon (`["S256"]`). Welchen Pfad ChatGPT zuerst nimmt, ist UNKNOWN. | Bei WorkOS klaeren bzw. im Review beobachten. T-8 ist Kategorie A ("Server ohne S256-Advertising sind unsupported per spec"). |
| OW-8 | **`MCP_AUTH` / `render.yaml`-Drift** (T-5) | P6 korrigiert `render.yaml`. | Im **Render-Dashboard** pruefen, dass `MCP_AUTH=oauth` steht und dort bleibt. Ein Blueprint-Sync aus einem alten `render.yaml` wuerde auf Legacy zurueckfallen. |
| OW-9 | **Reviewer-Demo-Account** (O-9, I-4) | Belegt: `OWNER_PROFILE` → 12 (`src/store/defaults.js:1056-1065`), `DEFAULT_PROFILE` → 9 (`:1069-1078`). | **Praezisiert (P0-Korrekturlauf, NACHTRAG N-1): "vollen Flag-Satz setzen" reicht nicht.** (a) Ein Demo-Account auf einem bezahlten Plan bekommt bei der Aktivierung `allowCalendar:false` (`PAID_PLAN_PROFILE`, `src/plans.js:107-111`, `:147-148`) und sieht `get_calendar` nie. (b) `allowConsult=true` ist wirkungslos, solange der plattformweite Schalter `CONSULT_ENABLED` auf `false` steht (`render.yaml:424-425`; `consultAllowedFor()` ist eine Schnittmenge, `src/consult/gate.js:19-25`). Der Reviewer saehe heute **10** bzw. **9** Tools, nicht 12. Owner muss entweder den Demo-Tenant auf `OWNER_PROFILE` pinnen **und** `CONSULT_ENABLED` aktivieren, oder die kleinere Tool-Menge bewusst einreichen (N-5/N-6: haeufiger Ablehnungsgrund). |
| OW-10 | **Deep Research ja / nein** (T-24, T-25) | Belegt: kein Produktdokument nennt die Absicht. | Bestaetigen, dass Deep Research / Company Knowledge **nicht** angestrebt wird. Sonst eigene Kette. |
| OW-11 | **Referrer-Policy auf `sundartha.com`** (I-2a) | P10 ergaenzt die Zeile in `render.yaml`. | Die Header-Ergaenzung zusaetzlich im **Render-Dashboard** des Static-Service `hermes-web` nachtragen — ein Push allein macht sie nicht live. |
| OW-12 | **Support-Kontakt fuer `security.txt`** (I-2b, O-8) | P10 baut die Route; der Kontaktwert ist die einzige Unbekannte. | Die oeffentliche Support-Adresse nennen (dieselbe wie im Listing, O-7/O-8). **Keine private Adresse.** |
| OW-13 | **Widget-Bruecke in ChatGPT** (P8, akzeptiertes Risiko) | Belegt: das Widget-HTML spricht nur das MCP-Apps-Protokoll; die `window.openai`-Bruecke wurde in `364da8a` bewusst entfernt. | Entscheiden, ob eine neue Bruecke gebaut wird — das braucht eine Live-Probe gegen einen echten ChatGPT-Host, also einen Developer-Mode-Zugang. Ohne Live-Probe wird nicht gebaut. |

**Die drei UI-Optionen aus OW-3, je eine Zeile:**

- **A — MIT UI einreichen:** P8 wird gefahren (T-30/T-31 klein, T-23 mittel mit
  URI-Design-Entscheid, X-3/X-7 klein, T-34 klein) **plus** die Screenshot-Pflicht (O-12) —
  kauft dafuer nach heutigem Code ein Widget, das in einem echten ChatGPT-Host voraussichtlich
  leer bleibt (belegter, bewusst akzeptierter Bestandsdefekt).
- **B — OHNE UI einreichen:** technisch ein sauberer Schalter (belegt: kein Test bricht,
  `test/helpers.js:363` setzt `MCP_UI_ENABLED=false` bereits als BASE_ENV-Default), T-30/T-31/
  X-3/X-7/T-23/T-34 und O-12 entfallen vollstaendig — kostet aber, weil der Schalter **global**
  ist, die heute live genutzte Widget-Funktion der **Claude**-Nutzer.
- **C — MIT UI, aber unveraendert einreichen:** spart die Arbeit aus A, riskiert eine Ablehnung
  speziell wegen T-30/T-31 (Kategorie A, Quelle `app-review`) und liefert im besten Fall
  dasselbe leere Widget.

---

## 6. Doppelte Pfade — die Stelle, an der beim letzten Mal ein "fertig" auseinanderging

Ein Punkt gilt erst als erfuellt, wenn er auf **allen** Pfaden erfuellt ist. Jede Phase nennt in
ihrem Abschnitt, welche Pfade sie beruehrt.

| Kennung | Der doppelte Pfad | Beleg | Beruehrt von |
|---|---|---|---|
| **DP-1** | HTTP `/mcp` (`src/routes/mcp.js:151-158`) vs. stdio (`src/mcp-server.js:26-28`) — beide rufen dieselbe `registerTools()`, aber stdio **ohne** Tenant-Parameter (Defaults `allowCalendar=true`, `consultAllowed=false`) und **ohne** `mcpServerOptions()` | `src/mcp-tools.js:657-667`; `src/mcp-server.js:19-28` vs. `src/mcp-server-info.js:118-123` | P1, P2, P3, **P4 (T-21 — hier ist es der Kern)**, P5a, P5b, P6, P7, P8 |
| **DP-2** | mcp-nativer Adapter (`src/ui/adapters/mcp-native.js:10-17`, **mit** `csp`/`domain`) vs. ChatGPT-Adapter (`src/ui/adapters/chatgpt.js:8-12`, **ohne**) — der gruene Test `T-P3-AC2` pinnt den unvollstaendigen Zustand als Soll | `test/mcp-ui.test.js:552-563` | **P8 (Kern)** |
| **DP-3** | Legacy `tool()` → `server.tool()` (SDK hardcodet `title` und `_meta` auf `undefined`) vs. `uiTool()` → `registerTool()` — 2 vs. 10 Tools, auf **jedem** Transport gleich | `src/mcp-tools.js:755-762`; `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:694` vs. `:702-704` | **P2 (loest ihn auf)**, danach entfallen |
| **DP-4** | 401-Ruecksprunge in `src/auth.js`: **zwei** mit Challenge (`deny401`-Aufrufe in `verifyOauth`) vs. **drei** roh ohne Header (in `mcpAuth`) — am Code nachgezaehlt | `src/auth.js:78`, `:90` (mit, ueber `deny401` :66-72) vs. `:103`, `:110`, `:114-116` (ohne) | **P6 (Kern)**, P7 |
| **DP-5** | Die ausgelieferte Tool-Menge variiert pro Tenant **und pro Plattform-Schalter**: `OWNER_PROFILE` 12, zahlender Plan hoechstens 11, `DEFAULT_PROFILE` 9, Produktion heute (`CONSULT_ENABLED=false`) 10/9, stdio 10 | `src/store/defaults.js:1056-1065` / `:1069-1078`; `src/plans.js:107-111`, `:147-148`; `src/mcp-tools.js:968-969`, `:1003-1004`, `:1295-1296`, `:657-666`; `src/consult/gate.js:19-25`; `render.yaml:424-425` | P4 (fuer `instructions` aufgeloest), **P10 (bewusst nicht aufgeloest, Owner-Punkt)** |
| **DP-6** | Gateway-Header aus Express (`src/middleware.js:41-47`, setzt `referrer-policy`) vs. Static-Site-Header aus `render.yaml:779-810` (setzt sie **nicht**) | live gemessen: `app.sundartha.com` hat den Header, `sundartha.com` nicht | **P10**, P9 (Abgrenzung) |
| **DP-7** | `enableWidgetUi()` baut ein komplettes `{_meta:{...}}` und wird als **letztes** Feld gespreadet — ein separat davor gesetztes `_meta` wird still ueberschrieben (kein Deep-Merge) | `src/mcp-tools.js:718-725` und die Spread-Stelle `:929` | **P2 (loest ihn auf: ein Merge-Ort)**, P7, P8 |
| **DP-8** | `failure_reason` im MCP-Pfad (roh durchgereicht) vs. SMS-Notification-Pfad (bereits minimiert ueber `failureReasonBase()` + `FAILURE_REASON_TEXTS`) | `src/mcp-tools.js:156-158` vs. `src/telephony/failure-reason.js:59-60` + `src/i18n/failure-reason-texts.js:12` | **P5b** |

---

## 7. Betriebsregeln fuer die Umsetzung

- **Eine Bahn zur Zeit.** Die Phasen laufen nacheinander, nie zwei Wellen parallel.
- **Waehrend eine Welle laeuft, wird nicht auf `master` gemergt** — sonst blockiert ein
  Stale-Base-Fehler.
- **Worktree:** erst `git checkout -b <branch> master`, **dann** lesen.
- **Nie `git add -A`.** Dateien einzeln adden. Force-Push nur `--force-with-lease`.
- **Neue Env-Variable heisst vier Orte:** `src/config.js`, `.env.example`, `render.yaml`,
  `BASE_ENV` in `test/helpers.js`. Weniger als vier → der Punkt gilt als nicht erfuellt (die
  echte `.env` leakt sonst in Spawn-Tests).
- **`npm test` luegt beim Exit-Code.** Nur `# pass` / `# fail` zaehlen. Das Kommando
  lautet `npm test -- -- --test-concurrency=4` — **mit doppeltem `--`-Trenner**. Gemessen
  2026-09-20: `npm test --test-concurrency=4` uebergibt die Flagge gar nicht (npm frisst
  sie als eigene Option), und `npm test -- --test-concurrency=4` erreicht zwar
  `process.argv` des Wrappers, wird dort aber verworfen, weil `test/testbaenke-run.mjs`
  Zusatzflags erst nach einem eigenen `--` liest (`extraArgsFrom`,
  `test/i18n-catalog-run.mjs:103-106`). **Der erste Phasen-Workflow belegt einmalig am
  Lauf, dass `--test-concurrency=4` tatsaechlich bei `node --test` ankommt** (z.B. an der
  gemessenen Laufzeit gegen einen Lauf ohne Flagge oder am echoten Kommando) und schreibt
  den Beleg in seinen Report. Ohne den Trenner laeuft jede Phase bei voller Parallelitaet
  ab — dem bekannten Rennen-Zustand.
- **Nach jeder Phase ein SEPARATER Verifikations-Agent**, der die Reports und Specs dieser Phase
  **nicht** lesen darf, die IDs neutral gegen die drei Beweisarten prueft und bei Widerspruch
  gewinnt. Deshalb ist jedes Abnahmekriterium oben so formuliert, dass es ohne Kenntnis der
  Umsetzung pruefbar ist: es nennt ein Kommando, eine `datei:zeile` oder einen Testnamen samt
  der tragenden Assertion.
- **Vor jedem Merge selbst `git diff --stat`.** Ein Workflow-PASS ist keine Abnahme.
- **Jedes Abnahmekriterium, das auf einen Diff zeigt, nennt seine Basis.** Der
  Verifikations-Agent hat die Phase nicht gebaut und darf ihre Reports nicht lesen — er weiss
  nicht, wogegen er diffen soll, und nach dem Merge auf `master` ist ein Vergleich ohne Basis
  gar nicht mehr formulierbar. Schreibweise:
  `git diff master...phase/<branch> -- <pfad>`; der Branch-Name gehoert in die
  Phasen-Uebergabe. Wo das nicht geht, wird die Absicht direkt pruefbar gemacht (z.B. die
  Assertion-Zahl der Datei als Testname gepinnt).
- **Jede Phase ist einzeln mergebar und der Server laeuft danach.** Kein Zwischenzustand, der
  erst durch die naechste Phase repariert wird.

---

## 8. ID-Abdeckungstabelle

Jede ID aus dem Arbeitsvorrat des Kickoffs steht in genau einer Zeile. Das ist die Pruefliste
des Schluss-Agenten (P11).

**Bindende Regel fuer diese Tabelle:** *jede ID, die irgendwo im Plan eine Phase nennt, hat
hier genau eine Zeile* — und jede Zeile traegt **entweder** eine Phase **oder** steht unter
"Wird nicht gebaut" mit Begruendung. Einen dritten Status ("erledigt") gibt es nicht; er hat
schon einmal zu einem falschen "fertig" gefuehrt. Wer eine ID in eine Phase aufnimmt, ohne
hier eine Zeile zu ergaenzen, sorgt dafuer, dass der Schluss-Agent sie **nie prueft**.

### Gebaut

| ID | Vorrat | Phase | Kurz |
|---|---|---|---|
| N-1 | A | **P1** | `destructiveHint` an allen 12 Tools, Kommentar :581-586 mitgeaendert |
| X-1 | A | **P1** | dieselbe Sache aus der Abweichungsliste (OpenAI Required schlaegt MCP-optional) |
| N-3 | A | **P1** | `answer_consult` → `destructiveHint: true` |
| N-4 | A | **P1** | `openWorldHint` fuer **alle 12** Tools gegen eine Wahrheitstabelle mit Zugriffs-Beleg entschieden; drei Werte drehen (`await_call_event`, `get_call_status`, `get_transcript` → `false`). **Nicht** nur `get_call_status` — sonst bliebe `get_transcript` auf derselben Route widerspruechlich. |
| N-11 | A | **P1** | `await_call_event`-Beschreibung nennt den Schreibeffekt |
| T-18 | A | **P2** | Top-Level-`title` an allen 12 (`cancel_call`/`list_action_items` migrieren vom Legacy-Weg) **plus** der Rest des Wortlauts: Name/Description/`inputSchema` je Tool getestet, und der Beleg mit `datei:zeile`, dass die zwei Tools ohne `outputSchema` kein `structuredContent` liefern |
| T-22 | A | **P2** | `openai/toolInvocation/invoking`+`/invoked`, `<= 64`, an **einem** Merge-Ort |
| T-15 | A | **P3** | `securitySchemes` — Weg haengt an D0-5 (SDK-Grenze belegt) |
| T-19 | B | **P4** | `get_transcript` liefert `isError` statt `structuredContent`-Bruch |
| T-20 | B | **P4** | dasselbe aus Sicht des Fehlerkanals (`isError` ist der MCP-Standardweg) |
| T-21 | B | **P4** | `instructions`: Wichtiges in die ersten 512, immer gesetzt, **auch ueber stdio** |
| O-13 | F | **P5a + P5b** | **teilweise:** `voiceEngine`/`model` raus (P5a), `failure_reason` gekuerzt (P5b). **`last_transcript_lines` bleibt** — Live-Konsument im Call-Widget belegt, "redundant" widerlegt (P5b-Anhang). O-13 gilt danach als teilweise erfuellt, **nicht** als erledigt. |
| O-14 | F | **P5a** | Restricted Data — **Nachweis statt Aenderung** (Whitelist-Funktionen sind Positivlisten), mit der ausdruecklichen Einschraenkung fuer woertliche Gegenrede |
| O-27 | F | **P4 (Teil 1) + P5b (Teil 2)** | Teil 1: Server-Instruktion nennt keine fremden Werkzeuge mehr — liegt in P4, weil dort derselbe Text und derselbe Testpin geaendert werden. Teil 2: `consultPermissionHint` neutral (P5b). |
| T-13 | C | **P6** | `WWW-Authenticate` auf **allen** 401-Ruecksprungen: drei rohe in `mcpAuth` (:103, :110, :114-116) laufen kuenftig ueber `deny401()`, die zwei in `verifyOauth` (:78, :90) tun es bereits |
| T-5 | C | **P6** | Legacy gehaertet statt entfernt + `render.yaml`-Drift korrigiert (Begruendung dort) |
| O-4 | G | **gebaut, blockiert an OW-1** | Die Route existiert vollstaendig (`src/app.js:184-187`, `test/openai-e7-challenge.test.js` 9/9 gruen) — aber sie antwortet **fail-closed mit 404, solange `OPENAI_APPS_CHALLENGE_TOKEN` leer ist** (`src/app.js:185-186`). O-4 verlangt woertlich die **Auslieferung genau dieses Tokens**. Erfuellt ist heute der **Bauzustand**, nicht die Anforderung. **P11 zaehlt O-4 als NICHT erfuellt**, bis eine lesende Messung gegen den Live-Host den Token-Text zurueckliefert. |
| O-5 | G | **gebaut, blockiert an OW-2** | Challenge-Base = `app.sundartha.com`, live sauber belegt. Erfuellt ist die technische Voraussetzung; die Anforderung selbst haengt an der Eintragung im Submissions-Formular. **P11 zaehlt O-5 als NICHT erfuellt**, bis das belegt ist. |
| T-30 | D | **P8** *(entfaellt bei OHNE UI oder D0-8 negativ)* | CSP im ChatGPT-Adapter |
| T-31 | D | **P8** *(entfaellt bei OHNE UI oder D0-8 negativ)* | `_meta.ui.domain` im ChatGPT-Adapter |
| X-3 | D | **P8** *(entfaellt bei OHNE UI oder D0-8 negativ)* | auf den tatsaechlichen X-3-Wortlaut zurueckgefuehrt |
| X-7 | D | **P8** *(entfaellt bei OHNE UI oder D0-8 negativ)* | `openai/widgetCSP.redirect_domains` (Legacy-Key, `_meta.ui.csp` kennt es nicht) |
| T-23 | D | **P8** *(entfaellt bei OHNE UI oder D0-8 negativ)* | beide `_meta`-Schluessel am **selben** Tool-Deskriptor auf **denselben** URI (`_meta.ui.resourceUri` bevorzugt, `openai/outputTemplate` als Alias), **eine** Resource. Kein Design-Entscheid, keine getrennten URIs — `toolMeta()` und `registerResource()` sind in `src/ui/contract.js:88-107` bereits getrennt. |
| T-34 | D | **P8** *(entfaellt bei OHNE UI oder D0-8 negativ)* | Sprach-Suffix in der `ui://`-URI, **kein** ETag |
| T-29 | E | **P9** *(entfaellt bei server-seitig)* | CORS erst nach der Owner-Messung; Allowlist allein reicht nicht |
| I-2a | I | **P10** | Referrer-Policy im `render.yaml`-Header-Block von `hermes-web` |
| I-2b | I | **P10** | `/.well-known/security.txt` nach dem Challenge-Muster, `route-policy`-Eintrag Pflicht |

### Wird nicht gebaut

| ID | Vorrat | Grund (Kurzform, ausfuehrlich in Abschnitt 4) |
|---|---|---|
| T-14 | A | Nur bei D0-6 positiv. Sonst: kein Ausloesepfad im Code → Feld ohne Wirkung = toter Code. Transport-Pfad (P6) deckt ab. |
| T-12 | C | Nur bei D0-7 positiv. Sonst: WorkOS bewirbt keinen ressourcenspezifischen Scope — Pruefung waere wirkungslos oder ein Totalausfall. |
| T-9 | C | Provider-gehostetes Well-known-Dokument (WorkOS). In diesem Repo nicht baubar. → OW-6 |
| T-11 | C | dito. **Potenzieller Einreichungs-Blocker** (Redirect-URI-Wahl haengt daran). → OW-6 |
| T-16 | C | dito (UserInfo-Endpunkt existiert; `claims_supported` fehlt in der Metadata). → OW-6 |
| T-4 | E | SSE ist Developer-Mode-only; die Submission-Doku verlangt nur streamable HTTP. Gegenstandslos. |
| T-24 | H | Deep Research / Company Knowledge nicht angestrebt (D0-2, 0 Treffer in allen Produktdokumenten). |
| T-25 | H | dito (Zitationsregel gilt nur fuer `search`/`fetch`). |
| X-9 | H | Kategorie C, "nur bei Multi-Account". Architektur kennt genau einen Tenant je Request. |
| T-17 | H | Kategorie C, ausdruecklich optional. |
| T-33 | H | Setzt eine bereits publizierte Integration voraus. Heute nichts zu bauen; spaeter Betriebs-Runbook. |
| I-1 | I | `/healthz`: dokumentierte Entscheidung (GAP-36), `configHash` ist ein Einweg-Hash, keine ID verlangt eine Aenderung. |
| I-2c | I | HSTS ohne `preload`: bewusste, begruendete Entscheidung (`src/middleware.js:24-32`). |
| I-3 | I | `POST sundartha.com/mcp` → 200/0: Render-Plattformverhalten, gegengeprueft an Zufallspfaden, ausserhalb `src/`. |
| I-4 | I | Tool-Mengen-Varianz: MCP-konform und produktgewollt. Technisch abzufangen hiesse, die Berechtigung zu untergraben. → OW-9 (Demo-Account). |
| N-15 | (kein Kickoff-Vorrat) | **Fehlzuordnung im eigenen Entwurf, korrigiert.** N-15 verbietet, den vollstaendigen **Chatverlauf des Hosts** zu ziehen, zu rekonstruieren oder zu erschliessen ("must not pull, reconstruct, or infer the full chat log", Anforderungsliste Zeile 89). `last_transcript_lines` ist ein **Telefon**transkript und beruehrt N-15 nicht. Hermes zieht keinen Chatverlauf: kein Tool nimmt Konversationshistorie entgegen, kein Handler fragt danach. Nichts zu bauen — die Zeile steht hier, damit der Schluss-Agent die ID nicht fuer vergessen haelt. |
| *`last_transcript_lines`* | F | **Offener Teilbefund von O-13, bewusst zurueckgelegt.** Live-Konsument (`src/ui/widgets/call.html:167/:551/:584`), waehrend laufender Anrufe kein Ersatz (`src/mcp-tools.js:190-191`). Schliessen heisst: entschaerften Ersatz bauen **und** das Widget im selben Commit umstellen — eigene Phase mit Live-Probe. Siehe P5b-Anhang. |
| *Vorfrage D* | D | **Keine ID, sondern eine Produktentscheidung.** → OW-3, drei Optionen mit Folgen. |

### Ausgeschlossen (Owner / Rechtstext, per Auftrag)

O-1, O-2, O-3, O-6, O-7, O-8, O-9, O-10, O-11, O-12, O-15, O-16, O-17, O-18, O-19, O-20, O-21,
O-22, O-23, O-24, O-25, O-26, O-28, O-29, O-30, O-31, W-1..W-7, T-2, T-32, T-35, T-36.
Sie stehen hier, damit der Schluss-Agent sie als **bewusst ausserhalb** erkennt und nicht als
vergessen. O-9 und O-12 tauchen zusaetzlich in der Owner-Liste auf, weil technische Phasen sie
beruehren (Demo-Account-Vollausstattung, Screenshot-Pflicht bei UI).

---

## 9. UNKNOWNs (mit Grund, nicht wegerklaert)

| # | UNKNOWN | Grund | Wo es haengt |
|---|---|---|---|
| U-1 | Erwartet OpenAI `securitySchemes` am **Top-Level** des Tool-Objekts oder innerhalb von `_meta`? | Die Anforderungsliste zitiert T-15 nur im Wortlaut ("security schemes set on their tool metadata"), ohne JSON-Pfad. Nicht aus dem Code klaerbar. | D0-5 → P3 |
| U-2 | Unterstuetzt `@modelcontextprotocol/sdk` 1.30.0 das Feld? | Nicht installiert; 1.29.0 kennt es nachweislich nirgends. | D0-5 → P3 |
| U-3 | Fragt OpenAIs `/mcp`-Client server- oder browserseitig an? | Zwei frische Doku-Abrufe (2026-09-20) sagen dazu **nichts**. Indirekte Evidenz (T-3 IP-Allowlist, T-17 mTLS-als-ChatGPT-Client) spricht fuer server-seitig, beweist es nicht. | D0-4 → OW-4 → P9 |
| U-4 | Stellt WorkOS Connect einen ressourcenspezifischen Scope aus, und kaeme er als `scope`/`scp` im Token an? | Braucht einen echten, abgeschlossenen Authorization-Flow. Kein Agent darf einen Login durchfuehren. | D0-7 → OW-5 → P7 |
| U-5 | Laesst WorkOS `resource_indicators_supported` / `authorization_response_iss_parameter_supported` / `claims_supported` nachruesten? | Ausserhalb dieses Repos (WorkOS-Dashboard/-Support). | OW-6 |
| U-6 | Welchen Well-known-Pfad fragt ChatGPT beim Discovery **zuerst** ab? | Entscheidet, welches der zwei live **unterschiedlichen** AS-Metadata-Dokumente aus ChatGPT-Sicht gilt — und damit, ob T-8 (PKCE-S256-Advertising) erfuellt ist. Nicht aus Code oder Doku ableitbar. | OW-7 |
| U-7 | Deklariert OpenAIs realer Client `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes = ["text/html+skybridge"]`? | Das ist die **einzige** Bedingung, unter der `chatgptRenderer` ueberhaupt gewaehlt wird (`src/ui/registry.js:48`). Alle bestehenden Tests arbeiten mit konstruierten Capability-Objekten; es gab nie eine echte ChatGPT-Verbindung. **Ist sie falsch, laeuft P8 ins Leere** — der ChatGPT-Adapter wuerde nie greifen. Deshalb ist U-7 seit dieser Fassung **ein eigener Entscheidungspunkt (D0-8)** und wird an OW-4 mitbestellt, statt als Annahme in P8 zu stecken. | **D0-8** → OW-4 → P8 |
| U-8 | Respektiert OpenAIs Cache ETags / Conditional-GET? | Die Doku sagt nur, dass bis zu 1 h gecacht werden **darf**. Deshalb der Sprach-Suffix-Weg statt ETag. | P8 (T-34) |
| U-9 | Eskaliert ChatGPT intern auf `destructiveHint` ueber die dokumentierte Write-Action-Bestaetigung hinaus? | Nicht dokumentiert. Die Alternative (Falschangabe) ist teurer — N-5/N-6. | P1 (akzeptiertes Risiko) |
| U-10 | Ist ein Plugin zulaessig, dessen Tools **echte Telefonanrufe** ausloesen? | In der gesamten Plugin-/API-Doku **nicht dokumentiert** (Volltext-Grep ueber beide `llms-full.txt`). Der einzige Telefonie-Treffer in den Verbotslisten ist "telemarketing ... schemes" (O-19) — das adressiert Maschen, nicht Telefonie. **Das ist das groesste Einzelrisiko der gesamten Einreichung und liegt ausserhalb jeder technischen Phase.** | Owner, vor der Einreichung |
