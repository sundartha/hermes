# Phase P4b — Portugiesisch wird eine unterstuetzte Sprache

**Gate: BLOCKED**
**finalBranch:** `phase/p4b-portugiesisch-fix3`

---

## 1. Ziel

`pt` (europaeisches Portugiesisch, `pt-PT`) wird als vollstaendige unterstuetzte Sprache in Hermes eingefuehrt: eigenes Locale-Bundle, eigener Prompt-Baustein, eigenes Voice-Profil, MCP-/Gate-/Ausfallgrund-Texte, Widget-Uebersetzung, Geo-Herleitung (Sprache/Zeitzone/Vorwahl) sowie der pflichtige Offenlegungssatz (Art. 50 EU AI Act) auf Portugiesisch.

Grundlage: `tasks/p4b-spec.md` (autoritativ), `PLAN-ANRUFDEFEKTE.md` §4 (P4), `.claude/refs/clean-code.md`. Ausgangsstand: `master` (`81629a6`, P4a bereits gemergt).

---

## 2. Plan (gekuerzt)

`SUPPORTED_LANGUAGES = Object.keys(LOCALES)` — ein neuer Bundle-Schluessel schaltet automatisch MCP-Katalogtext, Sprachvalidierung, Tenant-Settings-Enum, Greeting-Katalog, STT-Locale-Bruecke und Offenlegungs-Kerne frei, plus ~14 Testschleifen, die bereits ueber `SUPPORTED_LANGUAGES`/`LOCALES` laufen. `pt` traegt 179 Blattschluessel (wie `de`/`fr`; `en` hat 180, weil `prompt.calleeRelation` bewusst EN-only ist).

**Bindende Entscheidungen (D-1 bis D-9):**
- **D-1** — eigenes `voiceProfile` (`pt-female-neural`), Pflicht: `STT_LOCALE_BY_VOICE_PROFILE` ist nach Profil geschluesselt, ein wiederverwendetes Profil ueberschriebe die STT-Locale einer anderen Sprache.
- **D-2** — zwei getrennte Stimm-Achsen: Telnyx/Azure-Name **wird gesetzt** (`Azure.pt-PT-RaquelNeural`, sonst wirft `voiceAttrs` fail-closed = toter Anruf); ElevenLabs-Voice-ID **wird NICHT gesetzt** (nur per Synthese pruefbar, faellt fail-safe auf Plattform-Stimme zurueck) — offener Owner-Punkt.
- **D-3** — `realtimeVoice: null`, `whisperLocale: "pt"` (folgt dem DE/FR-Muster).
- **D-4** — Anbieter-Schreibweisen: `sttLocale`/`dateLocale` = `"pt-PT"`, EL-`agent.language`/Preset-Schluessel = `"pt"`.
- **D-5** — Geo: `PT` in beide Laender-Tabellen (`LANGUAGE_FOR_COUNTRY`, `CALLING_CODE_FOR_COUNTRY`), von Abnahme 3 erzwungen. Spannung zu I-3 (keine Sprache wird fuer bestehende Tenants automatisch aktiv) aufgeloest: betrifft nur neu aus Portugal registrierende Tenants, Weltdefault bleibt `en`, kein Backfill.
- **D-6** — `TIMEZONE_FOR_COUNTRY.PT = "Europe/Lisbon"`.
- **D-7** — kein Push an ElevenLabs in dieser Phase; Drift-Meldung `pt` ist erwarteter Zustand.
- **D-8** — I-4 (keine Ausnahmeliste) zweistufig: Vollstaendigkeits-/Paritaets-Schleifen laufen ueber `SUPPORTED_LANGUAGES`; historische Stichprobenlisten (z.B. `al-p5-opening#BOUNDARY_GOALS`) bleiben stehen, muessen aber im Bericht einzeln benannt werden.
- **D-9** — bekannte akzeptierte Luecke: `b1-doppelankaendigung.js` fuehrt keine pt-Leit-Cues (sprach-agnostische Nutzung, kein Wurf, kein roter Test).

**Neue Dateien:** `src/i18n/prompts/pt.js` (Prompt-Baustein, Struktur byte-gleich zu `fr.js`, engen Tool-Verbote woertlich uebertragen), `test/pt-locale.test.js` (11 rein Faelle P4b-1..P4b-11, Praefix ausserhalb der Katalog-/Abnahme-Muster → zaehlt als Regressionsbank).

**Edits an Bestand:** `src/i18n/locales.js` (Import, Voice-Profil-Konstante, Anrede-/Stilklauseln, Offenlegungs-Rueckfall, das komplette `pt`-Bundle inkl. woertlich gepinntem Offenlegungssatz, `LANGUAGE_FOR_COUNTRY.PT`), `src/i18n/inbound-notice.js`, `src/i18n/mcp-texts.js`, `src/i18n/gate-texts.js`, `src/i18n/failure-reason-texts.js` (je ein neuer `pt`-Block), `src/telephony/directives.js` (`PT_FEMALE_NEURAL`), `src/telephony/adapters/telnyx/render.js` (`TELNYX_VOICE_NAME` fuer `pt`, `ELEVENLABS_VOICE_ID_BY_PROFILE` bewusst unveraendert), `src/store/defaults.js` (`CALLING_CODE_FOR_COUNTRY.PT`), `src/geo/resolve.js` (Zeitzone), `src/ui/widget-i18n.js` (`WIDGET_DICT.pt`), `apps/web/src/lib/api.js` (Sprachauswahl im Dashboard), `elevenlabs/agent_configs/outbound-agent.template.json` (`language_presets.pt`, Hinweistexte aktualisiert).

**Pflicht-Testanpassungen (§4.1 im Plan):** u.a. `place-call-sprachwahl.test.js` (neuer Fall P4b-A7 ueber die echte HTTP-Route, Abnahme 1+2+4), `f1-i18n-locale.test.js`, `elevenlabs-agent-werkzeuge.test.js`, `el-opening-line.test.js` (Anredeform-Erkennung), `gq-p15/gq-p14`, `el-stimme-abnahme.test.js`, `inbound-disclosure-mandatory.test.js` (End-zu-End-Beleg gegen den fail-closed Telnyx-Renderpfad), `p15-gate-denial-language.test.js`, `ww-f2`/`ww-f4`, **`al-d3-tool-decision-contract.test.js` als wichtigster Faenger** (beweist, dass die engen Werkzeug-Verbote in der pt-Uebersetzung nicht verwaessern), `persona-style`, `al-p14-in-call-consult`, `b3b-request-neutrality`, `c1-auftragstreue`.

**Nicht konvertierte Listen (Stufe 2, im Bericht zu nennen):** `al-p5-opening#BOUNDARY_GOALS`, `elevenlabs-sprachwahl#CASES`, `callee-is-owner-opening#LANGS`+`GOLDEN`, `ww-f1-booking-mandate-contradiction#LANGS`.

**Pre-Mortem (Auszug):** unfreigegebener Offenlegungssatz live geschaltet (PM-1), toter Anruf durch fehlenden Voice-Namen (PM-2), amerikanisch klingendes `pt` mangels ElevenLabs-ID (PM-3, bewusst offen als Owner-Punkt), verwaesserte Tool-Verbote in der Uebersetzung (PM-4), Offenlegungssprache-Verwechslung (PM-5), ungewollte Tenant-Aktivierung ueber Geo (PM-6), EL-Vorlagen-Drift (PM-7).

**Offene Owner-Punkte laut Plan:** (1) ElevenLabs-Stimm-ID fuer `pt`, (2) Bestaetigung Azure-Name `pt-PT-RaquelNeural`, (3) Freigabe des Offenlegungssatzes, (4) Portugal wird Registrierungsland mit Sprache `pt`, (5) fehlende pt-Leit-Cues in `b1-doppelankaendigung.js`, (6) `es`/`en` Preset-Asymmetrie bleibt unangetastet.

---

## 3. Implementierung — Zusammenfassung

Portugiesisch (`pt-PT`) wurde als vollstaendige Sprache umgesetzt: neues Locale-Bundle `LOCALES.pt` mit eigenem Prompt-Baustein (`src/i18n/prompts/pt.js`, strukturell identisch zu `fr.js`), eigenem `voiceProfile` (`pt-female-neural`, Kollisionsriegel D-1), kuratiertem Azure-Voice-Namen fuer den fail-closed Telnyx-Renderer (D-2), bewusst ohne eigene ElevenLabs-Voice-ID (offener Owner-Punkt), MCP-/Gate-/Ausfallgrund-Texten, Widget-Dict-Eintrag und vollstaendiger Geo-Herleitung (`LANGUAGE_FOR_COUNTRY.PT`, `CALLING_CODE_FOR_COUNTRY.PT`, `TIMEZONE_FOR_COUNTRY.PT`). `SUPPORTED_LANGUAGES` erweitert sich automatisch aus `LOCALES`. Der pflichtige Offenlegungssatz ist woertlich in `test/pt-locale.test.js` gepinnt und im ElevenLabs-Preset ergaenzt (kein Push in dieser Phase, D-7).

14 Bestandstestdateien wurden um `pt`-Faelle erweitert (Vollstaendigkeits-/Sprachmengen-Faenger gegen I-4), neuer Test `test/pt-locale.test.js` deckt Abnahme 1/2/3/6 sowie Struktur-/Kollisionsinvarianten ab.

**Testergebnis (Impl-Agent):** `npm test`: 5798 Faelle, 5796 gruen, 2 vorbestehende Fehlschlaege (KV2-10 d1/d2, unveraendert gegenueber master). `npm run test:gates`: 3 vorbestehende Fehlschlaege (GAP-05, GAP-15, E2E-03), keiner pt-bezogen. `npm run lint`: 0 Fehler (67 unveraenderte Bestandswarnungen). `src/claude.js` und `src/bridge.js` bleiben mit leerem Diff. `smokePass: false` — manueller Server-Smoke scheiterte am boot-guard "Keine aktive Nummer im Store" (Bestandsverhalten, kein P4b-Befund); der staerkere End-zu-End-Beleg liegt in `test/inbound-disclosure-mandatory.test.js` (echter Server, realer `/voice/incoming`-Call, gerenderter TeXML-Body inkl. Pflichtsatz — gruen).

### Deviations (waehrend der Umsetzung entdeckt, nicht im Plan vorgesehen)

1. **`test/p9-voice-locale-source.test.js`** — der Bestandstest erwartete fuer ALLE `VOICE_PROFILE`-Werte, dass der Renderer von der globalen Stimme abweicht. Fuer `pt` (D-2: bewusst keine kuratierte ElevenLabs-ID) faellt der Renderer selbst auf die globale Stimme zurueck, wodurch die Schleife faelschlich rot wurde. Fix: Schleife auf die drei Profile mit kuratierter ID (DE/FR/EN) eingegrenzt, mit Kommentar-Begruendung (D-2). Keine Datei aus dem Plan.
2. **`src/i18n/mcp-texts.js`** — der vierte `pt`-Block liess den Bestands-Zaehler fuer `id-length` (`consultAnswerAccepted(n)`) von 3 auf 4 steigen und haette den pre-commit-Suppressions-Hook ausgeloest. Gemaess expliziter Plan-Anweisung ("wird die Datei aufgeraeumt, nicht die Buchfuehrung aufgeweicht") wurde der Parameter in allen vier Sprachbloecken auf `count` umbenannt und der `eslint-suppressions.json`-Eintrag entfernt (jetzt 0 echte Verstoesse).
3. **`test/gq-p14-summary-recorded-items.test.js`** — Plan wollte `SUPPORTED_LANGUAGES` in der Schleife, aber diese Konstante wird in der Datei erst asynchron in `before()` gesetzt, waehrend die betroffene Schleife synchron auf Modul-Top-Level Tests registriert (vor `before()`). Bei woertlicher Umsetzung waere `SUPPORTED_LANGUAGES` zum Schleifenzeitpunkt `undefined` gewesen. Bei der Literal-Liste `["de","en","fr","pt"]` geblieben, mit Kommentar-Begruendung.

---

## 4. Safety-Urteil (final)

**approved: false — BLOCKIERT**, nicht wegen eines Sicherheitsdefekts, sondern wegen zweier bindender Spec-Entscheidungen, die ausdruecklich dem Owner gehoeren, plus roter Regressionsbank.

**Positiv verifiziert:**
- **Safety-Gates intakt.** Kein Eingriff in `outbound-gates.js`, `number-denylist.js`, `config.js` oder die Gate-Logik in `state-ops.js`. Der einzige gate-nahe Effekt (Portugal in `CALLING_CODE_FOR_COUNTRY`, das auch `allowedPrivateNumberCodes` speist) wurde in Fix-Runde 3 sauber abgeriegelt: `PRIVATE_NUMBER_GATE_EXCLUDED_COUNTRIES = ["PT"]` haelt `allowedPrivateNumberCodes("PT")` beim strengen Bestands-Default `["+49"]`. Zwei neue Tests (`p8-private-number-country-gate`) und Eintrag in `PLAN-SECURITY.md`. Das zweite von `countryForE164` gespeiste Gate (GAP-19) wird durch `PT` ausschliesslich strenger.
- **Offenlegung mechanisch intakt.** `src/claude.js`/`src/bridge.js` nicht im Diff. `pt` laeuft durch dieselbe `makeDisclosure`-Faktorei, Satz traegt alle drei Pflichtaussagen. I-1 (Offenlegungssprache folgt dem Angerufenen, nicht dem Sprachwunsch) durch drei Nahttests + HTTP-Routentest (P4b-A7) gepinnt. Pflicht-Rueckfall aus CLAUDE.md Regel 2 steht in `identityLines.outboundOwner`.
- **Auth fail-closed intakt.** Keine Datei aus `auth.js`/`web-auth.js`/`middleware.js`/`route-policy.js` im Diff, keine neue Route, keine Aenderung an Telnyx-Ed25519-Pruefung.
- **Keine Secrets, keine neue Dependency.**
- **I-2/I-3/I-4 erfuellt** (additiv, kein automatischer Tenant-Flip, sieben Literal-Listen auf `SUPPORTED_LANGUAGES` umgestellt, die eine verbliebene mit belegter Begruendung).

**Blocker:**
1. **E-3 verletzt und bleibt verletzt:** `TELNYX_VOICE_NAME[PT_FEMALE_NEURAL] = "Azure.pt-PT-RaquelNeural"` ist ein geratener, nicht per Synthese/Anbieter-Katalog belegter Stimmname. Verschaerfend: der `/voice/incoming`-Fehlerpfad kann einen vom Provider abgelehnten Voice-Namen strukturell nicht fangen (XML scheitert erst bei Telnyx). Erreichbarer Pfad: ein Tenant kann `pt` als Default setzen (`state-ops.js:4961` validiert nur gegen `SUPPORTED_LANGUAGES`) → die Inbound-Pflichtansage wird mit ungeprueftem Voice-Attribut gerendert. Owner-Entscheidung noetig.
2. **E-4 prozessual offen:** der portugiesische Offenlegungssatz ist owner-pflichtig; der eigene Test heisst woertlich "Freigabe AUSSTEHEND". Mit Merge spricht der Agent diesen unfreigegebenen Art.-50-Satz sofort gegenueber jedem `+351`-Angerufenen (per Call-Override der `first_message`, unabhaengig vom Tenant — der gesperrte Anbieter-Push ist dafuer nicht noetig). Freigabe muss vor Merge vorliegen.
3. **`npm test` rot:** `KV2-10 (d1)` und `(d2)` in `test/kv2-10-tarifpaar.test.js`. Nicht von P4b verursacht — isoliert und im Vollauf identisch auf merge-base `81629a6` reproduziert (Bestandsdefekt von master). Kein P4b-Blocker im Sinne von Verursachung, aber "Tests gruen" als Abnahmebedingung nicht erfuellt.

**Concerns (nicht blockierend, festzuhalten):**
- Scope groesser als die Spec-Tabelle (17 src-Dateien + apps/web + 2 eslint-Dateien) — groesstenteils unvermeidliche Tabellenfolge, drei echte Extras: `src/routes/voice.js`-Haertung, `apps/web/src/lib/api.js`, kosmetische `n→count`-Umbenennung.
- `src/routes/voice.js`: neuer `sendIncomingErrorXml`-Fallback in der sicherheitskritischsten Datei (Signaturpruefung + Offenlegungspfade), inhaltlich harmlos und getestet, aber Defensivcode fuer einen Fall, den die Phase durch den geratenen Azure-Namen selbst nicht mehr ausloest — bewusst uebernehmen oder herausnehmen, nicht stillschweigend.
- `apps/web/src/lib/api.js`: `pt` als waehlbare Dashboard-Kachel ist von keinem Test erzwungen und macht den in Blocker 1 beschriebenen Pfad leichter erreichbar.
- `INBOUND_ERROR_FALLBACK_XML` ist hart deutschsprachig, unabhaengig vom Locale (nur Fehlerpfad/Hangup, kein Art.-50-Problem, aber sichtbarer Sprachbruch).
- `p9-voice-locale-source.test.js`-Verzweigung sauber geloest, aber: fuer `pt` bedeutet "gruen" hier "faellt auf englische Plattform-Stimme zurueck" — ein portugiesischer Anruf klingt ueber den EL-Weg heute englisch (zweite Haelfte desselben Owner-Punkts wie Blocker 1).
- `AL-P10-1` einmal im Vollauf rot, isoliert gruen, im zweiten Vollauf gruen — als Flake eingeordnet, im Auge behalten.

**Verdict-Text (Kern):** "Warum trotzdem blockiert: E-3 ist bewusst und dauerhaft verletzt (geratener Azure-Stimmname), E-4 ist unfreigegeben und geht mit dem Merge fuer jeden +351-Angerufenen live, und die Regressionsbank ist rot — letzteres nachweislich als Bestandsdefekt von master, nicht durch P4b verursacht. Alle drei Punkte sind Owner-Entscheidungen bzw. Bestandsarbeit, keine Nachbesserung, die der Impl-Agent alleine leisten kann. [...] der Lead sollte die drei Punkte dem Owner vorlegen; danach ist der Branch aus meiner Sicht technisch merge-faehig."

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — keine S1/S2-Befunde.

- **s1 (Blocker):** keine.
- **s2 (Blocker):** keine.
- **s3 (Info, 2 Eintraege):**
  1. `src/telephony/adapters/telnyx/render.js` (`TELNYX_VOICE_NAME.PT_FEMALE_NEURAL`) — Azure-Stimmname geraten, nicht per Synthese verifiziert (verletzt E-3), aber bewusst offen dokumentiert (`PLAN-SECURITY.md` B2, Owner-Entscheidung ausstehend) — kein Flag, da transparent gefuehrt und mit Fallback abgesichert, nicht verdeckt.
  2. `src/routes/voice.js` (`INBOUND_ERROR_FALLBACK_XML`) — letzter Fehler-Rueckfall hart deutschsprachig, unabhaengig vom Locale; nachvollziehbar (muss lookup-frei sein, um nicht selbst zu werfen), kein Blocker, Rand-/Doppelfehlerfall.
- **s4 (Info, 1 Eintrag):** `eslint-legacy-exceptions.json` (`src/routes/voice.js`) — `makeVoiceRoutes` waechst 269 → 280 Zeilen durch den neuen Fehler-Rueckfall; Pin sauber dokumentiert, G30-Split bleibt bewusst zurueckgestellt, kein neuer Verstoss.

**passNotes:** Durchgaengig sorgfaeltige Kommentierung. H1-Gate-Trennung (`defaults.js`) als Lehrbuchbeispiel gewertet ("Land-Ableitung darf ein Sicherheits-Gate nicht implizit aufweiten"), mit Test in beide Richtungen. `sendIncomingErrorXml` sauber als eigene Funktion extrahiert (ctx-Objekt statt vierter Parameter), mit Regressionstest fuer den simulierten Doppelwurf. i18n-Buendel vollstaendig und parallel zu bestehenden Sprachen strukturiert. Rename `n→count` korrekt als Nebeneffekt der eslint-Bereinigung erkennbar. `PLAN-SECURITY.md` dokumentiert beide Runde-3-Fixe exakt nach Repo-Konvention.

**topTodos:**
1. Owner-Entscheidung fuer PT-Stimme einholen (B2, `PLAN-SECURITY.md`): geratenen Azure-Namen freigeben, per Synthese verifizierte Alternative waehlen, oder TeXML-Weg fuer `pt` zurueckstellen.
2. Falls `PT` spaeter in die H1-Allowlist (private Summary-Nummer) soll: zuerst `+351`-Premium-/Mehrwert-Praefixe in `number-denylist.js` kuratieren und testen, dann erst aus `PRIVATE_NUMBER_GATE_EXCLUDED_COUNTRIES` entfernen.

---

## 6. Fix-Runden

**r1** — E-3-Fix in Runde 1 zunaechst falsch angesetzt (Voice-Guard-Test durch eine 3-Profile-Ausnahmeliste enger gemacht, die `pt` stillschweigend ausschloss) und wieder verworfen, nachdem belegt war, dass das einen echten Inbound-Anrufpfad bricht — voller `VOICE_PROFILE`-Loop wiederhergestellt.

**r2** — Beide Review-Blocker minimal behoben, ohne den geratenen Azure-Namen oder den Offenlegungssatz-Wortlaut selbst anzufassen (beide bewusst wie in Runde 1 belassen, im Impl-Bericht als offene Owner-Punkte gefuehrt). `src/routes/voice.js` bekommt in der `/voice/incoming`-Fehlerbehandlung einen zweiten, statischen Fallback (`sendIncomingErrorXml`/`INBOUND_ERROR_FALLBACK_XML`) fuer den Fall, dass `render()` im catch-Block erneut wirft.

**r3** — Worktree-Setup: der wortwoertliche Befehl `ln -s "./node_modules" node_modules` erzeugte einen selbstreferenzierenden, kaputten Symlink im Worktree-Verzeichnis — auf den absoluten Pfad des Haupt-Repos korrigiert (wie bei den Schwester-Worktrees), sonst waeren `npm run lint`/Tests im Worktree nicht lauffaehig gewesen.

Nach den drei Fix-Runden bleibt der Safety-Review-Status **BLOCKIERT** — die verbliebenen Blocker (E-3, E-4, KV2-10-Bestandsdefekt) sind Owner-Entscheidungen bzw. Bestandsarbeit ausserhalb des Fix-Agenten-Mandats, keine weitere autonome Nachbesserung vorgesehen ("nach Fund-SCHWERE steuern, nicht nach Zahl").

---

## 7. Naechste Schritte

Branch `phase/p4b-portugiesisch-fix3` ist technisch merge-faehig nach Safety-Einschaetzung, **aber blockiert bis der Owner entscheidet:**
1. Freigabe (oder Alternative) fuer den Azure-Stimmnamen `Azure.pt-PT-RaquelNeural` (E-3).
2. Freigabe des Wortlauts des portugiesischen Offenlegungssatzes (E-4).
3. `KV2-10`-Bestandsdefekt auf master klaeren (unabhaengig von P4b, aber Voraussetzung fuer eine gruene Regressionsbank).

