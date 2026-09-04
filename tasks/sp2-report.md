# Phasenbericht SP2 — Push-Werkzeug sendet Werkzeug-Objekte vollstaendig

- **finalBranch:** `phase/sp2-push-werkzeugobjekt`
- **Basis:** `master` (`0b6702e`, SP1 bereits gemergt)
- **headCommit:** `25ff227`
- **Gate:** PASS

## Kernbefund

Die Spec liess offen, ob die Vergleichs-Art `texte` fuer ein Blatt, das nur an EINEM
Sammlungs-Eintrag existiert, erweitert werden muss. Antwort, am echten Vergleichs-Kern
(`scripts/lib/elevenlabs-besitz.mjs` + `scripts/push-elevenlabs.mjs`) gemessen statt erschlossen:
**nein — der Mechanismus traegt den Fall bereits vollstaendig.** `mitBesessenenBlaettern`
schreibt ein Blatt nur, wenn die Vorlage es an DIESEM Eintrag fuehrt; `end_call`/
`language_detection` behalten deshalb ihren Live-Stand ohne Sonderregel.

Folge: **kein Skript wurde angefasst** (0 Zeilen Produktions-JS). SP2 ist eine Aenderung an
der Besitz-Erklaerung der Vorlage plus Tests — kleiner als die Spec annahm.

## Plan (gekuerzt)

- **Datei-Fix:** `elevenlabs/agent_configs/outbound-agent.template.json`, Besitz-Eintrag
  `voicemail_message`: `art "wert"` (Blattpfad) -> `art "texte"` ueber die Sammlung
  `built_in_tools`, mit `je_eintrag: "params.voicemail_message"`,
  `schreibweg: "je_schluessel"`, `schreibweg_besitz: ["params.voicemail_message"]`.
  Grund: der Anbieter ERSETZT das Werkzeug-Objekt beim PATCH statt zu mergen — ein Koerper
  mit nur dem Blattpfad endete am 2026-09-04 mit HTTP 400
  (`Field required, param: agent.prompt.built_in_tools.voicemail_detection.name`).
- **Keine Aenderung** an `scripts/push-elevenlabs.mjs`, `scripts/lib/elevenlabs-besitz.mjs`,
  `scripts/check-elevenlabs-drift.mjs`, `src/**` — die sieben Riegel bleiben unangetastet.
- **Tests:**
  - `test/elevenlabs-push-zusammenfuehrung.test.js`: neuer Abschnitt mit den Faellen
    (1) Koerper traegt alle Werkzeuge der Live-Sammlung, (2) `name`/`type`/nicht besessene
    `params` byte-identisch, keine Doku im Koerper, (3) nur `voicemail_detection` traegt den
    Vorlagenwert (+ Positiv-Kontrolle), (3b) live-`null`-Werkzeug reist nicht mit,
    (4) fremder Live-Schluessel bricht mit der BESTEHENDEN Meldung ab (+ Positiv-Kontrolle),
    (5) Trockenlauf gegen die ECHTE Vorlage: nur Pfade unter `built_in_tools.`,
    (6) Vorhersage `vergleicheBesitz` vorher/nachher: `voicemail_message` gruen, sonst nichts neu rot.
  - `test/elevenlabs-drift-rotprobe.test.js`: zwei neue Faelle in beide Richtungen
    (Text im Dashboard zurueckgeschrieben — gefangen; Blatt verschwindet ganz — gefangen,
    und zwar zweimal: `dynamic_variables` + `voicemail_message`), Positiv-Kontrolle 40/40 bleibt gruen.
- **Deterministische Pruefung:** JSON.parse, `npm test`, `npm run lint`, drei Rotproben
  (art zurueck auf `wert`, `schreibweg` entfernt, `je_eintrag` falsch).
- **Pre-Mortem:** Vier Gegenkraefte gegen versehentliches Loeschen eines Werkzeugs
  (Abbruch bei nur-live-Schluesseln, Trockenlauf-Default, Vorhersage+Ruecklese,
  Blattpfad-Riegel); akzeptiertes Restrisiko: live-`null`-Werkzeug faellt aus dem Dict
  (dokumentiert); Vorlagen-Werkzeug ohne Live-Entsprechung -> Riegel 2b (Entwickler-Doku
  im Koerper) bricht fail-closed ab.
- **Nicht Teil der Phase:** `only_at_conversation_start`, `disable_first_message_interruptions`,
  Presets, Stimme, LLM, Server-Code, Deploy, der eigentliche Push-Lauf.

## Impl-Zusammenfassung

- **headCommit:** `25ff227`, `node --check`: pass, `npm test`: 5697 pass / 0 fail
  (Basis vor SP2: 5686 + 11 neue Faelle).
- **Dateien editiert (4, nicht 3 — s. Deviations):**
  - `elevenlabs/agent_configs/outbound-agent.template.json` — Besitz-Eintrag
    `voicemail_message` umgestellt wie geplant, `_hinweis` per Nachtrag ergaenzt (Bestandstext
    unveraendert), `_schreibweg_begruendung` neu.
  - `test/elevenlabs-push-zusammenfuehrung.test.js` — 9 neue Faelle (1),(2),(3),
    (3)-Positiv-Kontrolle, (3b), (4), (4)-Positiv-Kontrolle, (5), (6).
  - `test/elevenlabs-drift-rotprobe.test.js` — 2 neue Drift-Faelle in beide Richtungen.
  - `test/helpers/elevenlabs-push-attrappe.mjs` — gestellter Live-Agent
    `LIVE_MIT_DATENSCHUTZ` fuehrt jetzt `built_in_tools`; neue Exporte `liveWerkzeuge()`,
    `VOICEMAIL_LIVE_TEXT`, `UNKONFIGURIERTES_WERKZEUG`.
- **Smoke:** HTTP-Smoke nicht moeglich (Boot-Guard verweigert Start im frischen Worktree
  mangels Env/Store-Seed) — kein Blocker, da SP2 keine Server-Route/`src/`-Datei anfasst.
  Stattdessen: Trockenlauf des ECHTEN Push-Kommandos (netzfrei ueber Attrappe) gegen die
  ECHTE Vorlage — lieferte exakt die vorhergesagte Ausgabe (11 Blatt-Pfade unter
  `built_in_tools.`, `voicemail_message` faellt aus der Vorhersage weg, Trockenlauf ohne
  schreibenden Aufruf).

### Deviations

1. **Blast-Radius 4 statt 3 Dateien (noetig, sonst waere `npm test` rot):** der gestellte
   Live-Agent in `test/helpers/elevenlabs-push-attrappe.mjs` fuehrte kein `built_in_tools`.
   Sobald der Besitz-Eintrag auf die Sammlung zeigt, kommt sie bei fehlendem Live-Stand
   vollstaendig aus der Vorlage (samt `_`-Doku-Schluesseln) und Riegel 2b bricht ab —
   faerbte den Bestandstest "Trockenlauf ohne Feldauswahl" rot. Vom Plan als Pre-Mortem-Zeile
   korrekt vorhergesagt, aber nicht als Fixture-Luecke erkannt. Fix: Sammlung in den
   gestellten Live-Agenten aufgenommen. Kein Test geloescht oder entschaerft.
2. Werkzeug-Fabrik liegt im geteilten Helfer (`liveWerkzeuge()`) statt in der Testdatei —
   zwei Fabriken fuer dieselbe Sammlung waeren Duplizierung.
3. Statisches `import { ladeVorlage }` nicht moeglich (zieht `src/config.js` via
   `process.env.ELEVENLABS_API_KEY`-Zuweisung mit, liess Faelle fail-closed abbrechen) —
   jetzt dynamischer Import nach Schluessel-Setzung, begruendet im Code.
4. Rotprobe c) (`je_eintrag` falsch) traf anders als vorhergesagt: die Drift-Positiv-Kontrolle
   blieb gruen (falscher Pfad ergibt beidseits "(fehlt)"); rot wurden stattdessen die
   beiden neuen Drift-Faelle plus (5) und (6) — Mechanismus dennoch belegt, ehrlich vermerkt.
5. Fall (5) um eine Nicht-Leerlauf-Zusicherung ergaenzt (das gemeinte Blatt MUSS unter den
   gedruckten Pfaden sein), sonst waere die Schleife auch ueber einer leeren Liste erfuellt.
6. `npm run format:check` bereits im Basis-Commit rot (815 Warnungen); die drei
   JS-Dateien sind prettier-sauber, `npm run lint`: 0 errors.

## Safety-Urteil

**FREIGABE (approved: true).** Alle Pruefpunkte grün: Tests unabhaengig nachgestellt bestanden,
Safety-Gates intakt, Offenlegung intakt, Auth fail-closed intakt, keine Secrets geleakt,
Scope eingehalten, Verhalten wie beabsichtigt. Keine Blocker.

Unabhaengige Laeufe (Worktree `wf_ae0b42ef-4aa-3`, Branch `review-sp2` = HEAD `25ff227`):
`npm test` 5697/5697, pg-Bahn (29 pglite-Dateien) 183/183, `npm run lint` 0 errors/67 warnings
(keine in den 4 geaenderten Dateien), `elevenlabs:check` OK offline, JSON.parse OK, eigene
Gegenprobe des PATCH-Koerpers (eigenes Fetch-Double, kein Netz) bestaetigt: alle live
konfigurierten Werkzeuge vollstaendig im Koerper, nicht besessene `params` byte-identisch,
`null`-Werkzeug faellt weg, kein `_`-Doku-Schluessel, nur `voicemail_detection.params.voicemail_message`
traegt `{{voicemail_line}}`. Eigene Rotprobe (Eintrag auf alte Form zurueckgedreht): 36/37
gruen, nur Fall (6) rot — danach Vorlage per `git checkout` wiederhergestellt.

**Concerns (keine Blocker):**
- Rotprobe-Schwaeche: Faelle (1)-(5) bauen die Abweichung teils von Hand
  (`schreibweg`/`schreibweg_besitz` hartkodiert) statt die ECHTE Vorlagen-Erklaerung zu
  pruefen — folgt dem Bestandsmuster der Datei, ist aber duenner als die Spec suggeriert.
  Konkrete Luecke: eine Verbreiterung von `schreibweg_besitz` auf `["params"]` bliebe in
  allen sechs Faellen gruen.
- Akzeptiertes Restrisiko (in der Spec-Pre-Mortem benannt, hier bestaetigt): der PATCH
  ersetzt jetzt das ganze `built_in_tools`-Dict; ein Werkzeug, das der Anbieter fuehrt aber
  im GET nicht ausliefert, wuerde beim PATCH geloescht — Gegenkraft ist allein das
  Zurueck-Lesen nach dem Schreiben.
- Abbruch an Riegel 2b zeigt bei fehlendem Live-Werkzeug auf "Entwickler-Doku im Koerper"
  statt auf die eigentliche Ursache — fail-closed, aber beim Owner-Trockenlauf potentiell
  fehlgedeutet.
- `VOICEMAIL_LIVE_TEXT` in der Test-Attrappe ist laut eigenem Kommentar der am 2026-09-04
  tatsaechlich live gefuehrte Text (kein Secret/PII, aber Abweichung von "rein synthetisch").
- Nicht SP2 zuzurechnen: Trockenlauf druckt ElevenLabs-`secret_id`-Referenzen aus der
  Vorlage — bereits auf `master`, nicht im SP2-Diff, opake Anbieter-Referenzen.

## Clean-Code-Audit

**Verdict: PASS**, `blocker: false`.

- **s1 (Blocker):** keine Funde.
- **s2 (Blocker):** keine Funde.
- **s3:** keine Funde.
- **s4 (Beobachtung, kein Fix noetig):** `texteMenge()` in
  `test/elevenlabs-push-zusammenfuehrung.test.js:307-323` baut die Mengenform der Art
  `texte` von Hand nach statt sie aus dem Vergleichs-Kern zu importieren — bewusst begruendet,
  zusaetzlich durch Faelle (5)/(6) gegen die ECHTE Vorlage abgesichert.

Passnotes: neuer Besitz-Eintrag begruendet dieselbe Art wie `language_presets_offenlegung`
(Wiederverwendung statt Neubau); Tests klar in Build-Operate-Check getrennt, ein Konzept pro
Test, Grenzfaelle geprueft, jede neue Rotprobe hat eine Positiv-Kontrolle daneben; Kommentare
erklaeren das Warum und sind aktuell; Tests unabhaengig/schnell/ohne Netz oder Zeitabhaengigkeit.

**Top-Todo (optional, nicht dringend):** `texteMenge()`-Nachbau bei einer dritten
Anwendungsstelle in den Vergleichs-Kern exportieren statt erneut von Hand nachzubauen.

## Fix-Runden

Keine — der Workflow lief ohne Fix-Runde durch (`=== FIXES ===` leer). Die einzige
Abweichung vom urspruenglichen Plan (Attrappe muss `built_in_tools` fuehren) wurde
waehrend der Implementierung selbst behoben, nicht in einer separaten Review-Fix-Runde.
