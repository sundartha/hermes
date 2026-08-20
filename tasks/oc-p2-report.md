# Phasenbericht OC-P2 — Owner-Call-Wirkung auf dem Live-Pfad (ElevenLabs)

Gate: **PASS**
finalBranch: `phase/oc-p2-el-wirkung`
headCommit: `10e831960caabb4fffc772307c59a255d446baf4`
Basis: `master` @ `c391c12`

## 1. Zweck der Phase

OC-P2 baut die Wirkung des OC-P1-Praedikats (`call.calleeIsOwner`) fuer den EINEN Ausnahmefall aus: ruft der Agent die eigene hinterlegte Nummer des Tenants an (Owner-Anruf), entfaellt die lange Offenlegungs-Eroeffnung zugunsten einer kurzen Du-Anrede-Begruessung ("Hallo <Vorname>, hier ist dein KI-Assistent."). Fuer jedes andere Ziel (Fremd-Ziel) muss der Anfragekoerper an ElevenLabs **byte-identisch** zum Bestand bleiben.

## 2. Byte-Identitaets-Grenze — was sich NUR im Owner-Fall aendert

Gemessen am tatsaechlichen `conversation_initiation_client_data`-Koerper (12 Bestandsvariablen + neu `callee_relation`, `conversation_config_override` mit `agent`/`tts`):

| # | Wert | Fremd-Ziel (`calleeIsOwner !== true`) | Owner-Ziel (`calleeIsOwner === true`) |
|---|---|---|---|
| 1 | `conversation_config_override.agent.first_message` | **Schluessel existiert nicht** (nicht `""`, nicht `null`) | die zusammengesetzte Owner-Eroeffnung |
| 2 | `dynamic_variables.callee_relation` | `""` — einzige zugelassene Ergaenzung | der Owner-Prompt-Block (inkl. voller Rueckfall-Offenlegungszeile) |
| 3 | `dynamic_variables.consult_available` | unveraendert (Tor entscheidet normal) | hart `"unavailable"` |
| 4 | `agent.language`, `tts.voice_id` | unveraendert | unveraendert |
| 5 | `agent_id`/`agent_phone_number_id`/`to_number` | unveraendert | unveraendert |
| 6 | die 12 Bestandsvariablen (`opening_line`, `owner_name`, ...) | byte-identisch | byte-identisch (opening_line bleibt Teil der Owner-Eroeffnung) |
| 7 | Schluessel-Reihenfolge im Override (`agent` vor `tts`) | unveraendert | unveraendert |

Ausdruecklich unberuehrt: `voicemail_message`, das statische `agent.first_message` der Vorlage, `language_presets.{de,fr,es}`, `disable_first_message_interruptions`, `providerOpeningFor`, `disclosureSentence`.

Beweisfuehrung: Golden-Datei `test/fixtures/el-anrufstart-fremdziel.json`, auf **unveraendertem master** vor jeder Aenderung abgegriffen, unveraendert in den Branch kopiert (Reihenfolge-Falle "Fixture aus geaendertem Code" damit konstruktionsbedingt ausgeschlossen). Vergleich per `assert.deepEqual` **und** `JSON.stringify`-Gleichheit (deckt Schluessel-Reihenfolge ab, die `deepEqual` nicht sieht). Nur zwei laufabhaengige Felder maskiert (`today`, `consult_available`), je begruendet.

## 3. Abnahmepunkte — einzeln, Urteil + Kommando

| # | Kommando | Erwartung | Urteil |
|---|---|---|---|
| 1 | `node --check` auf allen vier Kernquelldateien + `JSON.parse` der Vorlage | `vorlage ok`, Exit 0 | **ERFUELLT** |
| 2 | `NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner-elevenlabs.test.js` | `pass 39 / fail 0` (Minimum 24) | **ERFUELLT** |
| 3 | Riegel-Suiten (Anrufstart, Whitelist, Vorlagen-Abgleich, Sprachwahl, Opening-Line, Torzustand, Umlaut-Orthografie) | `fail 0`, T5(a)/(c)/(e) unveraendert gruen | **ERFUELLT** — 156-160/… pass, 0 fail |
| 3b | Diff-Kontrolle der zwei erlaubten Testaenderungen | nur `EXPECTED_VARIABLE_COUNT` 12→13 + Kommentar; `elevenlabs-torzustand.test.js` unveraendert | **ERFUELLT** |
| 4 | `LLM_PROVIDER=anthropic npm test` | `fail 0`, Anker 4960 + 39 = 4999 | **ERFUELLT** (4999/4999/0) |
| 5 | `npm run test:gates` | exakt `129/126/3` (unveraendert, kein Katalog-Leck) | **ERFUELLT** |
| 5b | `npm run elevenlabs:check` | `OK`, Exit 0 — nur gruen, weil die 18 `test_configs` mitgezogen wurden | **ERFUELLT** |
| 6 | `git diff master -- outbound-agent.template.json` | genau vier Zeilen, keine Beruehrung von `conversation_config.agent.first_message` oder Presets | **ERFUELLT** |
| 6b | Karte-sauber-Check (kein `_`-Schluessel in `conversation_config_override`) | `karte sauber`, `erlaubnis first_message: true` | **ERFUELLT** |
| 7 | statische `first_message` + de/fr-Presets | beginnen weiterhin mit dem vollen Offenlegungssatz | **ERFUELLT** |
| 8 | `grep` auf CLAUDE.md/PLAN-SECURITY.md-Eintraege | je `>= 1` | **ERFUELLT** |
| 9 | `git diff --stat` gegen `claude.js`/`bridge.js`/`voice.js`/`telnyx-ingest`/`apps/web` | leer | **ERFUELLT** |
| 10 | `git diff --stat` gegen `callee-is-owner.js`/`call-locale.js` | `callee-is-owner.js` leer, `call-locale.js` nur Kommentarzeilen | **ERFUELLT** |

Zusatz: Lint (Pre-Commit-Hook) durchgelaufen, 0 Fehler (61 Warnungen ausschliesslich in unberuehrten Bestandsdateien).

## 4. Ausgefuehrte Gegenproben — woertlich

**Sabotage-Gegenprobe (zweimal ausgefuehrt, zweiter/massgeblicher Lauf gegen den finalen committeten Code):**

Sabotage: in `ownerFirstMessage` die Zeile `if (call.calleeIsOwner !== true) return "";` entfernt; in `calleeRelationText` `!== true` durch `=== false` ersetzt.

```
$ NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner-elevenlabs.test.js test/elevenlabs-anrufstart.test.js
  ✖ OC-P2-A1: Fremd-Ziel - der Koerper traegt keinen Blatt-Pfad agent.first_message (8.353167ms)
  ✖ OC-P2-A2: Fremd-Ziel - callee_relation ist der leere String (0.306375ms)
  ✖ OC-P2-A3: Fremd-Ziel - der Rest des Koerpers ist byte-identisch zum Bestand (Golden aus master) (0.331084ms)
  ✖ OC-P2-A4: Fremd-Ziel - das Uebersteuerungs-Objekt fuehrt nur Sprache und Stimme (0.155166ms)
  ✖ OC-P2-C1: calleeIsOwner fehlt (Bestands-Datensatz) -> keine Uebersteuerung, callee_relation leer (0.174334ms)
  ✖ OC-P2-C2: calleeIsOwner === false -> keine Uebersteuerung, callee_relation leer (0.12375ms)
  ✖ OC-P2-C3: calleeIsOwner === "true" (String) -> keine Uebersteuerung, callee_relation leer (0.123ms)
  ✖ OC-P2-E2: Fremd-Anruf mit identischem Aufbau -> unveraendert available (Gegenprobe) (0.10375ms)
  ✖ EL-START T5 (a): der Anrufstart uebergibt owner_name und uebersteuert first_message NICHT (440.556ms)
ℹ tests 97 / ℹ pass 51 / ℹ fail 46
```

Damit sind alle geforderten Zusagen (A1, A3, A4, C1, C2, C3, E2) rot geworden — zusaetzlich A2 und, entscheidend, der Bestandsriegel "EL-START T5 (a)": Beweis, dass die Grenze wirklich haelt und nicht nur die eigenen neuen Tests sich selbst bestaetigen.

Ungeplanter Zweitbefund: von 97 Faellen fielen 46, weil unter aktiver Sabotage JEDER Anruf `agent.first_message` sendet und `assertOverrideWhitelisted` den GESAMTEN Anrufstart abbricht (kein stiller Filter) — zusaetzlicher Beleg der fail-closed-Kette.

Wiederherstellung: Datei zurueckgespielt, `node --check` Exit 0, `git diff --stat` zeigt exakt den beabsichtigten Stand (147 insertions/22 deletions), danach `131/131 pass, fail 0`.

**Weitere vom Safety-Review selbst ausgefuehrte Sabotagen (alle rot gesehen, alle revertiert):**
- Zusaetzliche Aufweichung des Waechter-Flags (`startCallRequest` "=== true" → "!== false"): A1, A3 (Golden-Byte-Diff), A4, C1, C3 rot.
- `"KI"` aus `LOCALES.de.ownerOpening` entfernt: B4-de rot.
- woertlichen `${disclosure}` in der Rueckfallzeile durch Umschreibung ersetzt: B6-de/fr/en rot (alle drei Sprachen).

**Byte-Identitaets-Gegenprobe** (unabhaengiges Messwerkzeug des Safety-Reviewers, nicht die Impl-Attrappe): Fremd-Ziel de/fr/en plus Rueckfallpfad (`ownerName` leer → `owner_name` "mon mandant") — einziger Unterschied im gesamten Koerper ist `"callee_relation": ""`. `calleeIsOwner=false`, `"true"` (String), `1` (truthy) landen alle byte-genau auf demselben Fremd-Ziel-Koerper.

## 5. Was fuer die LIVE-SCHALTUNG offen bleibt

**Push-Reihenfolge ist bindend und darf nicht gedreht werden:** Push MUSS vor Deploy erfolgen (Bestandsreihenfolge fuer Code-vor-Vorlage). Grund: die Vorlage hat auf dem EL-Live-Pfad **keinen Laufzeit-Leser** (`src/conversation/elevenlabs-agent-config.js:30` liest sie zwar, hat aber keinen `src/`-Aufrufer — nur `test/`-Nutzer). Ein reiner Repo-Stand ohne Push ist strukturell wirkungslos, kein "vermutlich harmlos".

Vier gemessene Kombinationen (aus dem Plan, am Code verifiziert):
1. Vorlage im Repo neu, live alt → **nichts passiert** (kein Leser).
2. Code neu, Vorlage live alt (Prompt) → toter Ballast, in diesem Fenster zusaetzlich `OWNER_SELF_CALL_ENABLED=false`, also keine Uebersteuerung moeglich.
3. Code neu, Erlaubnis-Karte live noch `false` → Anbieter ignoriert `agent.first_message` still, Owner hoert weiter die Offenlegung — harmlose Richtung, Uebererfuellung.
4. **Push vor Deploy** (fuer diese Kette verboten) → Live-Prompt traegt `{{callee_relation}}`, alter Code liefert die Variable nicht → ungemessen, potenziell 1008-Klasse, traefe JEDEN laufenden Anruf.

**Vor dem naechsten `elevenlabs:push`:** Live-Stand der Erlaubnis-Karte MUSS lesend belegt werden (`npm run elevenlabs:drift`, Runbook 8.3/1b) — OC-P2 hatte keinen Netzzugriff und durfte nicht messen. Meldet der Drift-Lauf `tts.voice_id` oder `conversation.text_only` weiterhin als Abweichung: **anhalten**, denn derselbe Push wuerde dann zusaetzlich die Stimme fuer ALLE Anrufe drehen (`conversationConfigOverride` sendet `tts.voice_id` bei jedem Anruf).

Weitere offene Punkte fuer den Kettenstand:
- PLAN-SECURITY.md Launch-Blocker "Besitz-Verifikation der eigenen Nummer" muss vor Freischalten von `OWNER_SELF_CALL_TENANT_IDS` fuer echte Kunden geschlossen werden.
- `src/routes/api-calls.js:102-103` traegt einen jetzt veralteten Kommentar ("Feld wirkt in dieser Phase noch nirgends") — ab OC-P2 falsch, nicht Teil der Plan-Nachzieh-Pflicht, daher offen liegen gelassen.
- Rueckfrage-Webhook (`routes/webhooks-elevenlabs.js`) entscheidet weiterhin nur nach Profil; OC-P2 setzt nur `consult_available="unavailable"`. Riefe der Agent `get_consult` trotzdem im Owner-Anruf, naehme der Webhook es an — fuer OC-P3/Runbook vormerken.

## 6. Impl-Zusammenfassung

Gebaut: `LOCALES.<de|fr|en>.ownerOpening` (gesprochene Owner-Begruessung, KI/IA/AI-Wort tragend und per Test gepinnt), `PROMPT_EN.calleeRelation` (Owner-Prompt-Sektion samt Pflicht-Rueckfallzeile mit dem vollen, serverseitig eingesetzten Offenlegungssatz), `{{callee_relation}}` als 13. dynamische Variable, vierfach fail-closed Uebersteuerung von `agent.first_message` nur im Owner-Fall (Schluessel weglassen statt leer setzen), `convai.js`-Waechter mit zweiter, ausdruecklicher Menge `OVERRIDE_OWNER_ONLY_LEAF_PATHS` (strenger als der Anbieter: bricht den gesamten Anrufstart ab statt still zu ignorieren), Rueckfrage-Tor bei Owner-Anrufen geschlossen (Recherche-Tor unberuehrt), genau vier Aenderungen an der Vorlage, Doku (CLAUDE.md Regel 2, PLAN-SECURITY.md) woertlich aus dem Plan uebernommen.

Zahlen: `npm test` 4960→4999 (+39, fail 0), `test:gates` unveraendert 129/126/3, `elevenlabs:check` OK.

Neue/geaenderte Testdateien: `test/callee-is-owner-elevenlabs.test.js` (neu, 39 Faelle A-G), `test/fixtures/el-anrufstart-fremdziel.json` (neu, Golden-Datei aus master), `test/helpers/elevenlabs-anrufstart-attrappe.mjs` (erweitert um `sendeAnrufstartKoerper`), `test/el-vorlage-variablen-abgleich.test.js` (nur `EXPECTED_VARIABLE_COUNT` 12→13 + Kommentar), `test/elevenlabs-override-whitelist.test.js` (Paritaets-Test erweitert).

### Deviations (D1-D11)

- **D1**: `npm test`-Anker der Spec (4909) war der Stand VOR OC-P1; gueltiger Anker ist 4960. Abnahme gegen 4960+39=4999 gefahren.
- **D2**: Spec-Skizze `locale.ownerOpening(firstName)` am Code nicht aufloesbar (`locale` ist das callLocale-Objekt, nicht das Bundle); geloest via `bundle = localeFor(locale.language)` einmalig in `startCallBody`.
- **D3**: Spec-Bedingung "Text nach trim nicht leer" ist heute unerreichbar (bei nicht-leerem Vornamen liefert `ownerOpening` nie `""`); trotzdem gebaut als Doppelsicherung (Muster `consult_available`), erreichbare Haelfte als Fall C5 gepinnt.
- **D4** (Scope-Erweiterung): 18 `elevenlabs/test_configs/*.json` mussten mitgezogen werden, sonst faellt `elevenlabs:check` still um (nicht Teil von `npm test`). Positiv-Kontrolle vom Safety-Reviewer bestaetigt: ohne die Aenderung schlaegt das Gate real fehl.
- **D5**: `assertOverrideWhitelisted(body, callId, calleeIsOwner)` traegt einen booleschen Parameter — bewusste Ausnahme, begruendet: `calleeIsOwner` ist eine serverseitig entschiedene Tatsache, keine Verhaltenswahl des Aufrufers; zwei Funktionen waeren zwei Umgehungswege.
- **D6**: PLAN-SECURITY.md-Ueberschrift `###`→`##` gehoben (Text byte-identisch), damit der Blocker als Top-Level-Abschnitt statt als Unterabteilung von "Prod-DB-IP-Allowlist" einsortiert ist.
- **D7** (Befund, nicht repariert): `test/el-vorlage-variablen-abgleich.test.js:80` fuehrt weiterhin den Namen "(zwoelf Namen)", prueft aber 13 — Spec erlaubte an dieser Datei nur die `EXPECTED_VARIABLE_COUNT`-Zeile.
- **D8** (wichtigster Punkt, echter Spec-Widerspruch): Spec §2.3 macht `callee_relation` allein vom Praedikat abhaengig; Spec §5-C verlangt fuer ALLE Fail-closed-Faelle (auch leerer Vorname) zusaetzlich `callee_relation === ""`. Beides nicht gleichzeitig erfuellbar. Umgesetzt wurde die detaillierte Normvorschrift §2.3; Tests C4/C5 halten den Ist-Zustand offen fest. Sicherheitsbewertung: ungefaehrlich, Richtung Mehr-Offenlegung. Vom Safety-Review bestaetigt als korrekte Lesart (kein Blocker), aber als Verhaltensdetail fuer den Kettenstand vorgemerkt.
- **D9**: neue Modul-Funktion `startCallRequest` eingefuehrt, um den Lint-Riegel `max-lines-per-function` (100 Zeilen) einzuhalten — rein strukturell, kein Verhaltensunterschied.
- **D10** (Suite-Flake, ehrlich benannt): einer von vier vollen `npm test`-Laeufen meldete `fail 1`, Fall nicht namentlich festgehalten; drei weitere Laeufe (inkl. isolierter Wiederholung der betroffenen Suiten) waren 0. Als Flake gewertet, nicht verschwiegen.
- **D11**: neue Testdatei mit prettier formatiert; uebrige beruehrte Dateien melden bereits auf master bestehende prettier-Abweichungen (per stash nachgemessen, identisch) — nicht angefasst.

## 7. Safety-Urteil

**verdict: PASS — Freigabe zum Merge.** Alle Abnahmepunkte selbst (unabhaengig vom Impl-Agenten) gefahren.

Kernaussagen des Safety-Reviews:
- Nicht-Owner-Byte-Identitaet mit eigenem Messwerkzeug gegen echten master-Export bewiesen (de/fr/en + Rueckfallpfad); einziger Unterschied im gesamten Koerper: `"callee_relation": ""`.
- Vier Sabotage-Gegenproben selbst rot gesehen und revertiert (s. Abschnitt 4).
- Absolute Regel 2 (Offenlegung) unangetastet: nur 5 Testdateien im Diff (neu + 3 erlaubte Aenderungen + Fixture), T5(c)/T5(e) unveraendert gruen, statischer Offenlegungssatz + de/fr-Presets woertlich unveraendert.
- Praedikat bleibt einzige Entscheidungsquelle (grep-belegt, keine zweite Vergleichslogik); `calleeIsOwner` rein serverseitig gesetzt, kein Client-Flag.
- Scope sauber: `bridge.js`/`claude.js`/`voice.js`/`telnyx-ingest`/`apps/web` diff-leer, Safety-Gates unberuehrt, keine Secrets.
- `noLivePushExecuted`: strukturell belegt (kein `scripts/`-Diff, keine Artefakte, keine untrackten Dateien).

Concerns (kein Blocker, fuer Kettenstand):
- D8-Widerspruch der Spec (s.o.), als korrekte Lesart bewertet.
- Owner-Fall mit leerem/fehlendem/`{{`-Vornamen: `callee_relation` reist weiter, `first_message` wird NICHT uebersteuert → Agent bekommt Owner-Prompt-Block, waehrend Anbieter vollen statischen Offenlegungssatz spricht. Richtung Ueber-Offenlegung, nicht Unter-Offenlegung.
- 17 `test_configs`-Dateien formal ausserhalb des Spec-Scopes geaendert, aber durch echtes Gate erzwungen (Positiv-Kontrolle bestaetigt).
- Runbook-Vorbehalt zur Live-Erlaubnis-Karte (s. Abschnitt 5) — bindend vor dem naechsten Push.
- Rueckfrage-Webhook entscheidet weiterhin nur nach Profil (Spec-konform, aber Notiz fuer OC-P3).

## 8. Clean-Code-Audit

**verdict: PASS**, kein Blocker, S1-S4 alle leer.

Gepruefte Kategorien (P, C, E, F, G, N, T):
- G5/S2 (Eroeffnungs-Komposition an EINER Stelle): erfuellt — `ownerFirstMessage()` ist die einzige Kompositionsstelle, Praedikat wird nur gelesen, nicht neu berechnet.
- Umlaut-Regel: keine Treffer in neuen Kommentaren; gesprochene DE/FR-Strings enthalten schlicht keine Umlaut-/Akzent-Woerter, explizit begruendet.
- P11/T-Serie (Byte-Identitaets-Fixture + Sabotage-Gegenprobe): erfuellt, alle 39 Tests tatsaechlich ausgefuehrt und gruen, volle Suite danach gruen.
- Vorlagen-JSON: einzige inhaltliche Push-Struktur-Aenderung ist `agent.first_message: false→true`, Dokukommentare nur in bereits bestehenden `_`-Geschwisterfeldern erweitert.
- G23/Fail-closed-Kette in `convai.js`: zweite ausdrueckliche Whitelist-Menge statt stiller Erweiterung.
- F1 (Argumentzahl): alle neuen Mehrparameter-Funktionen nehmen ein Objekt; `calleeIsOwner` als benannter, begruendeter dritter Parameter in `assertOverrideWhitelisted` (bewusste Ausnahme).
- G30/Funktionslaenge: neue Funktionen 5-11 Zeilen, `originateCall` 76 Zeilen — deutlich unter Richtwertgrenze.
- CLAUDE.md/PLAN-SECURITY.md: vollstaendig dokumentiert inkl. akzeptiertem Risiko und Launch-Blocker.

Keine Duplizierung, keine toten Funktionen, keine unbenannten Magic Numbers, kein auskommentierter Code, keine abgeschalteten Sicherungen.

topTodos aus dem Audit:
1. Vor dem naechsten echten `elevenlabs:push` Live-Stand von `tts.voice_id`/`conversation.text_only` lesend belegen (Runbook 8.3/1b).
2. PLAN-SECURITY.md Launch-Blocker vor Freischalten von `OWNER_SELF_CALL_TENANT_IDS` fuer echte Kunden-Accounts schliessen.

## 9. Fix-Runden

Keine Fix-Runde noetig — Safety und Clean-Code kamen beide im ersten Durchlauf auf PASS, `FIXES` leer.
