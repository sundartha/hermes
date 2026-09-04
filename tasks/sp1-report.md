# Phasenbericht SP1 — Sprach-Gegenkraft in der EL-Vorlage

**Status:** Gate = PASS. `finalBranch = phase/sp1-sprachgegenkraft`. Basis `master @ 207ee57`, Head-Commit `5ba507a`.

## Ueberblick

SP1 setzt zwei aufeinander bezogene Gegenkraefte gegen den am 2026-09-04 belegten Sprachdefekt (Phantom-Turn -> unbeabsichtigter Sprachwechsel, Detail-RCA in `tasks/UEBERGABE-SPRACHDEFEKT.md`, BELEGT 15/18) in die ElevenLabs-Vorlage:

1. **Prompt-Regel E-5b**: der Sprachwechsel im Agenten-Prompt ist nicht mehr bedingungslos ("bei einem Wechsel mitgehen"), sondern erfordert eine Bestaetigung der Gegenstelle in der anderen Sprache, bevor gewechselt wird. Ein einzelnes Wort, ein Fragment oder etwas Unklares ist ausdruecklich NIE ein Wechselgrund.
2. **`transcribe_on_disabled_interruptions` von `true` auf `false`**: waehrend der gesperrten Eroeffnung (Offenlegungssatz) erkannte Gegenstellen-Rede erreicht das Modell nicht mehr — genau darueber war am 04.09. ein Phantom-Zug der Anbieter-Spracherkennung als echter User-Zug angekommen und hatte den Anruf nach Spanisch gekippt.

Geaendert wurden **genau 4 Dateien**: `elevenlabs/agent_configs/outbound-agent.template.json`, `test/elevenlabs-agent-werkzeuge.test.js`, `test/elevenlabs-anrufstart.test.js`, `PLAN-SECURITY.md`. Kein `src/`-Code, kein Push, kein Deploy, keine neue Dependency.

---

## Plan (gekuerzt)

- **Scope**: 3 Kern-Dateien (Vorlage + 2 Tests) plus 1 Doku-Zeile in `PLAN-SECURITY.md`. Ausdruecklich unangetastet: `scripts/push-elevenlabs.mjs` (SP2), `language_detection`, `only_at_conversation_start`, `disable_first_message_interruptions` (bleibt `true`), Presets, Tools, Stimme, LLM.
- **Edit A (Prompt)**: der Satz "Begin the call in English. If the other party switches to another language, continue in that language and keep pursuing the same objective." wird ersetzt durch den bindenden Spec-Wortlaut: Sprache der Eroeffnung halten, bei Verdacht einmal kurz zweisprachig nachfragen, erst nach Bestaetigung in der anderen Sprache wechseln, "A single word, a fragment or anything unclear is never a reason to switch the language or to comment on the connection - briefly repeat your last question instead."
- **Edit B (Turn-Schalter)**: `agent.conversation_config.turn.transcribe_on_disabled_interruptions` `true` -> `false`.
- **Edit C/D**: Doku-Hinweise `_offenlegung_unterbrechung_hinweis` und der Besitz-Eintrag fuer das Feld nachgezogen — der Waechter bewacht ab jetzt die Rueckkehr nach `true` (nicht mehr das Zuruecksetzen nach unten, das jetzt gewollt ist).
- **Edits E1-E6**: sechs von neun "E-5"-Doku-Stellen bekommen einen Nachtrag "NACHTRAG E-5b (2026-09-04)"; drei bleiben unangetastet, weil ihre Aussage weiter stimmt.
- **Edit F**: eine Zeile in `PLAN-SECURITY.md` (Abschnitt zur Offenlegungslaufzeit-Garantie), die den alten Zustand ("transcribe_on_disabled_interruptions, damit waehrend der Offenlegung Gesagtes nicht verloren geht") korrigiert.
- **Test SP1-C.1** (`elevenlabs-agent-werkzeuge.test.js`): vier statt drei REQUIRED-Zusicherungen ((a) Startsprache = Eroeffnungssprache, (b) Wechsel erst nach Bestaetigung, (c) Wort/Fragment/Unklares kein Wechselgrund, (d) Ziel bleibt gleich), vier statt drei FORBIDDEN-Regeln mit neuer `entkraeftet`-Klausel (Begriffe, die eine Regel fuer denselben Satz entschaerfen — noetig, weil der neue Prompt-Satz sonst sein eigenes Verbot ausloest), neuer Matcher `anySentenceIsForbidden(text, rule)`, `CONTROL_OK` als echte Paraphrase (keine Vorlagen-Woerter ausser Fachbegriffen), 5 statt 4 `CONTROL_VIOLATIONS` (die fuenfte prueft die neue `entkraeftet`-Mechanik gegen ein Schlupfloch).
- **Test SP1-C.2** (`elevenlabs-anrufstart.test.js`): EL-START T5 (f) bekommt je Feld ein eigenes `soll` (true fuer `disable_first_message_interruptions`, false fuer `transcribe_on_disabled_interruptions`) statt eines gemeinsamen `true` — verhindert, dass ein Auseinanderlaufen kuenftig still das falsche Feld verteidigt.
- **Rotproben vorab am echten Prompt simuliert** (Abschnitt 6 des Plans): neue Fassung besteht alle vier REQUIRED und verletzt keine FORBIDDEN; alte Fassung faellt bei (a)/(b)/(c) durch und verletzt "bedingungsloses Mitgehen".
- **Pre-Mortem** (Auszug): Risiko "echter Fremdsprachler wird nicht mehr bedient" — durch die Bestaetigungs-Rueckfrage statt eines harten Verbots entschaerft, `entkraeftet` ist je Regel gesetzt (kein globales Schlupfloch), Artikel-50-Feld bleibt getrennt bewacht.

---

## Implementierung — Zusammenfassung

- `elevenlabs/agent_configs/outbound-agent.template.json`: Prompt-Satzgruppe ersetzt, `turn.transcribe_on_disabled_interruptions` auf `false`, Doku-Hinweise (`_offenlegung_unterbrechung_hinweis`, Besitz-Eintrag-`_hinweis`, sechs "E-5"-Nachtraege E1-E6) nachgezogen. JSON bleibt gueltig, Struktur/Einrueckung unveraendert (nur Stringinhalt).
- `test/elevenlabs-agent-werkzeuge.test.js`: Testname umgepinnt ("...haelt die Startsprache und gibt den Wechsel erst nach Bestaetigung frei"), Begriffs-Konstanten `CONFIRM`, `UNKLARER_ANLASS`, `ERSTER_ZUG`, `AEUSSERUNG` neu, `REQUIRED_LANGUAGE_RULES` von 3 auf 4, `FORBIDDEN_LANGUAGE_RULES` von 3 auf 4 (mit `entkraeftet`), neuer Matcher `anySentenceIsForbidden`, `CONTROL_OK`/`CONTROL_VIOLATIONS` aktualisiert. Kein Test geloescht, Testanzahl der Datei unveraendert.
- `test/elevenlabs-anrufstart.test.js`: `OFFENLEGUNG_UNTERBRECHUNG`-Eintraege tragen je ein `soll`-Feld und `zweck`-Text statt gemeinsamem `true`; Testname unveraendert.
- `PLAN-SECURITY.md`: die eine Zeile zum Offenlegungs-Gegenmittel korrigiert (nennt jetzt die Drehung auf `false` und den Grund).

### Deviations (vom Plan)

1. Zusaetzlicher Satz im Kopfkommentar von `elevenlabs-anrufstart.test.js` korrigiert ("Beide Anbieter-Defaults arbeiten gegen uns" war nach SP1-B fuer eine Haelfte sachlich falsch geworden — reiner Text, kein Verhalten beruehrt).
2. Kein separates "beide Backends"-Kommando existiert im Repo; pglite-Tests laufen innerhalb von `npm test` mit — ein Lauf deckt beide Backends ab, kein zweiter ausgelassen.
3. Rotprobe 1 ("vier Signale") brauchte eine temporaere Testdatei-Kopie (`test/zz-rotprobe-tmp.test.js`, spaeter geloescht), weil `node:test` beim ersten `assert`-Fehlschlag abbricht; Ergebnis exakt wie vom Plan vorhergesagt, Original per diff als unveraendert nachgewiesen.
4. Rotprobe 4 (`CONTROL_OK` = echter Vorlagen-Wortlaut) blieb wie geplant GRUEN — das ist der beabsichtigte Beleg, dass die Paraphrase-Kontrolle den Kern und nicht den Text misst.
5. `npm run elevenlabs:push -- --felder=prompt,transcribe_on_disabled_interruptions` (Trockenlauf) wurde NICHT gefahren — Sandbox-Sperre laut Spec, faehrt der Eigentuemer nach dem Merge.

### Messwerte

- `npm test`: 5686 pass / 0 fail (Implementierungs-Zeitpunkt) bzw. 5705/5705 (Safety-Review, Zeitversatz durch master-Wanderung — Namensabgleich: 0 entfernte Tests, 1 umbenannt).
- `npm run lint`: 0 errors.
- `npm run elevenlabs:check`: OK (offline, Vokabular deckt sich mit Vorlage).
- Rotproben (alle wie vom Plan vorhergesagt eingetroffen, danach zurueckgesetzt):
  - alter Sprachsatz zurueckgeschrieben -> `elevenlabs-agent-werkzeuge` rot: (a),(b),(c) fehlen + Verbot "bedingungsloses Mitgehen" trifft
  - `transcribe_on_disabled_interruptions: true` -> `elevenlabs-anrufstart` T5(f) rot: "steht nicht auf false"
  - `disable_first_message_interruptions: false` -> T5(f) rot: "steht nicht auf true" (Artikel-50-Haelfte bleibt scharf)
  - `CONTROL_OK` = echter Wortlaut -> bleibt gruen (gewollt)

---

## Safety-Urteil (final)

**Verdict: FREIGABE (approved=true).** Alle vier absoluten Regeln eingehalten:

- **Scope sauber**: genau 4 Dateien im Diff, Null-Diff auf `src/`, `apps/`, `scripts/`, `public/`, `.env.example`, `render.yaml`, `package.json`/`package-lock.json` byte-identisch (keine neue Dependency).
- **Safety-Gates unberuehrt**: kein Byte in `src/`; Denylist, Land-Gate, Stundenlimit, `OUTBOUND_FROZEN`, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Ed25519-Pruefung unangetastet, kein neuer Endpunkt.
- **Offenlegung intakt**: `first_message` (Artikel-50-Satz) byte-identisch; `disable_first_message_interruptions` bleibt hart `true` und ist jetzt SCHAERFER gepinnt (eigener `soll`-Wert statt geteiltem `true`). Die SP1-B-Drehung betrifft nur, ob Gegenstellen-Rede aus dem gesperrten Zug das Modell erreicht — nicht die Zustellung des Pflichtsatzes.
- **Auth fail-closed unberuehrt**: keine Route-/Middleware-/Policy-Datei im Diff.
- **Keine Secrets geleakt**, kein neues Logging, kein Audio-Pfad beruehrt.
- **Verhalten wie beabsichtigt**: Prompt-Wortlaut zeichengenau wie Spec; die Vorlage wird zwar von `src/conversation/elevenlabs-agent-config.js` geladen, aber `outboundAgentConfigFor` hat KEINEN Produktions-Aufrufer (nur Tests/Kommentarverweis) — Laufzeit bleibt bis zum naechsten Push unveraendert.
- Nebeneffekt als Verbesserung vermerkt: "Begin the call in English" widersprach dem de-Preset; "Speak the language of your opening message" behebt das.

**Concerns (kein Blocker, Owner-Hinweise):**
1. Beweiskette verkuerzt: mit `transcribe_on_disabled_interruptions=false` ist ein Widerspruch der Gegenstelle waehrend der gesperrten Offenlegung nicht mehr im Transkript belegbar — in Spec/Vorlage als Preis akzeptiert.
2. Waechter-Praezision: das Verbot "Wechsel-Verbot ohne Bestaetigungsweg" wird durch `entkraeftet=[UNKLARER_ANLASS]` fuer jeden Satz mit "fragment/unclear/..." stillgelegt — praktisch durch REQUIRED (b) gedeckt, aber der Negativ-Waechter allein ist enger als sein Label.
3. Drift-Waechter einseitig: SOLL von `transcribe_on_disabled_interruptions` faellt jetzt mit dem Anbieter-Default zusammen; Waechter schlaegt nur noch bei Flip nach oben an — bewusst so begruendet.
4. Bestands-Flake (ausserhalb SP1): `AL-P10-1` haengt an 50-ms-Timeout, reproduziert auf `master`, kein SP1-Bezug.
5. Spec-Zahl veraltet (kosmetisch): Spec nennt "5686 pass vor SP1", gemessen 5705 auf beiden Zweigen (master ist gewandert, 0 Tests verloren).

Unabhaengige Nachlaeufe im frischen Worktree bestaetigten: Regression gruen bis auf den bekannten Bestands-Flake, zweites Backend (pg via pglite) 344/345 gruen (roter Fall ein Artefakt des erzwungenen Overrides, ohne Override 13/13 gruen), alle Rotproben eigenstaendig reproduziert.

---

## Clean-Code-Audit (final)

**Verdict: PASS, blocker=false.**

- **s1 (Blocker-Kategorie)**: keine Funde.
- **s2 (Blocker-Kategorie)**: keine Funde.
- **s3 (informativ)**: keine Verstoesse — `_built_in_tools_begruendung`-Kommentar sauber fortgeschrieben (kein C2/veraltet), Prompt-Wortlaut deckt sich exakt mit der Test-Regelmenge.
- **s4 (informativ, vertretbar)**: `anySentenceIsForbidden` fuehrt pro Regel eine eigene `entkraeftet`-Liste ein — als kleine, gut benannte Erweiterung eines Bestandsmusters bewertet, keine neue Klasse/Datei, kein Flag.
- Verifiziert per Code-Diff (nicht vermutet): Templatewerte, Prompttext und Testerwartungen stimmen ueberein. `elevenlabs-agent-werkzeuge.test.js` isoliert 10/10 gruen, volle Suite 5686/5686.
- Keine Magic Numbers, kein toter/auskommentierter Code, keine Testabschaltung, keine neuen Sicherheitsluecken.
- Sicherheitsrelevant (Art. 50): `disable_first_message_interruptions` bleibt hart `true`; nur `transcribe_on_disabled_interruptions` kippt mit Owner-Begruendung und nachgezogenem Kommentar/Test-SOLL.
- Top-TODOs: keine Blocker; optional-Hinweis, dass vor dem echten Push die Live-Konfiguration am ElevenLabs-Agenten mit dem neuen SOLL (`false`) abgeglichen werden muss, sonst droht Vorlage/Live-Drift wie in fruehreren Ketten.

---

## Fix-Runden

Keine — es gab keine Blocker aus Safety- oder Clean-Code-Review, daher keine Fix-Runde noetig (`=== FIXES ===` im Quellmaterial ist leer).

---

## Offene Punkte fuer den Eigentuemer

1. Trockenlauf und echter Push nicht durch den Agenten gefahren (Sandbox-Sperre): `npm run elevenlabs:push -- --felder=prompt,transcribe_on_disabled_interruptions`, danach echter Testanruf zur Abnahme (kein Test im Repo kann belegen, dass ein Phantom-Zug die neue Rueckfrage nicht doch "bestaetigt").
2. Bestands-Flake `AL-P10-1` (50-ms-Timeout, ausserhalb SP1) sollte unabhaengig behoben werden — er macht `npm test EXIT=0` aktuell zu einem unzuverlaessigen Merge-Signal.
3. Owner-Hinweis aus dem Clean-Code-Audit: Live-Agent-Konfiguration nach Push gegen das neue SOLL (`transcribe_on_disabled_interruptions=false`) abgleichen.
