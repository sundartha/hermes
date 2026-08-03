# Phase KV-P7 — Latente Pfade fail-closed verriegeln

Gate: **PASS**
finalBranch: `phase/kv-p7-latente-pfade`
Basis: `master` @ `37953ca`

---

## Die Klaerung (das inhaltliche Herzstueck der Phase)

Die Erstfassung von KV-P7 ging davon aus, TTS-Kosten erreichten die Gate-Achse ueberhaupt
nicht ("es existiert repo-weit kein Preis-pro-Zeichen-Parameter"). Vor jeder Zeile Code
wurde diese Annahme geprueft und **widerlegt** (`tasks/kv-p7-tts-klaerung.md`).

### (a) Erreicht der von Telnyx berechnete TTS-Betrag die Gate-Achse? JA.

Vier Glieder, jedes am Code belegt:

1. **`text-to-speech` ist ein zuordenbarer Belegtyp.** `src/telephony/adapters/telnyx/voice.js:50-53` listet ihn in `COST_RECORD_TYPES`; `:168` schliesst nur `inference` aus; `:177-179` bildet `ASSIGNABLE_COST_RECORD_TYPES` als abgeleitete Gegenmenge — `text-to-speech` ist dabei. `COST_RECORD_TIME_FIELDS` (`:190-198`) bestaetigt: der Typ wird abgerufen und geblaettert, nicht uebersprungen.
2. **Geld und Zeichen kommen aus demselben Beleg.** `voice.js:425-450` (`toCostRecord`) liest fuer jeden Typ `costMicroCents = parseDecimalToMicroCents(raw.cost)` und daneben `ttsCharacters: elevenLabsCharactersOf(raw)`.
3. **Die Summe ist typ-blind.** `src/billing/cost-truing.js:289-299` (`sumRecordMicroCents`) addiert `r.costMicroCents` ueber alle Records ohne Typ-Auswahl → `classifyRecords.actualCostMicroCents` (`:316-331`).
4. **Der Ist-Betrag geht auf die Gate-Achse.** `cost-truing.js:469-481` → `store.applyCostCorrectionCents(...)` → `src/store/state-ops.js:2509-2531` → `bookCostCorrectionCents` → `bookCents(usage, ...)` — genau die Achse, die `budgetExceeded` liest.

Beleg als gruener Bestandstest: `test/cost-truing-tts-characters.test.js:130` pinnt
`actualCostMicroCents = 4_226_660` mit Kommentar `"0 + 4010000 + 0 + 200000 + 16660"` —
die `16660` sind der `text-to-speech`-Anteil. Live bestaetigt durch KV-M1 (13 zugeordnete
Belege, `complete:true`, darunter 5 `text-to-speech`-Belege mit zusammen 51.030 µct
innerhalb der Gesamtsumme 3.731.030 µct).

### (b) Waere ein Preis-pro-Zeichen-Parameter eine Doppelbuchung? JA — gerechnet am KV-M1-Anruf (729 Zeichen, 51.030 µct TTS, 3.731.030 µct Ist).

- **Variante A** (Preis am gemessenen Telnyx-Satz, 70 µct/Zeichen exakt): 3.731.030 µct
  Ist-Abgleich + 51.030 µct zusaetzlich = 3.782.060 µct auf der Gate-Achse — **+1,4 % je
  Anruf, dauerhaft**. Der Ist-Abgleich ist konvergent (`deltaCents = bucketCents -
  estimatedCostCents`), eine separate `bookCents`-Zeile waere additiv und ausserhalb dieser
  Konvergenz; `costTruedAt` (`cost-truing.js:281-287`) schliesst den Call danach fuer immer
  — keine Selbstheilung.
- **Variante B** (Preis am ElevenLabs-Tarif, `ttsCharacterQuota=39.981` gegen
  `platformFixedCostCentsPerMonth=600`): 15.007 µct/Zeichen = 214× der Telnyx-Satz →
  3,9× der echten Kosten auf demselben Anruf. Der Faktor 214 belegt: Telnyx' TTS-Gebuehr
  ist die eigene Relay-Gebuehr, nicht die durchgereichte ElevenLabs-Rechnung (der
  ElevenLabs-Vertrag laeuft ueber den eigenen Key, `config.js:354-360`, und steht auf
  keiner Telnyx-Position). Variante B waere die Umlage einer Fixgebuehr auf Anrufe —
  eine ausgeschlossene Preisfrage.

### Urteil zu Massnahme 4: entfaellt ersatzlos

Das ist ein **Ergebnis, kein Versaeumnis**. Massnahme 4 wurde nicht gebaut, weil ihre
Wirkung bereits ueber den Telnyx-Beleg erzielt ist und ein zusaetzlicher
Preis-pro-Zeichen-Parameter dieselben Zeichen ein zweites Mal bepreist haette — dauerhaft
und ohne Selbstkorrektur (Variante A) oder eine erfundene Umlage einer Fixgebuehr
(Variante B). Beide Wege widersprechen der Absoluten Regel der Phase: die Gate-Achse nur
bei belegter, ungedeckter Kante beschreiben. Diese Kante ist nicht belegt — sie ist
widerlegt. Eine Doppelbuchung waere schlimmer als eine unveraendert bestehende, kleinere
Luecke gewesen.

Folge fuer die Landkarte (`src/billing/cost-ledger-map.js`): die Zeile
`play_tts_characters` bleibt unveraendert bei `kind: null, ledger: false, gate: false`.
Nur ihr `preisquelle`-Text war seit KV-M1/KV-P3 nicht mehr korrekt (er behauptete pauschal,
TTS-Zeichen koennten kein Geld werden) und wurde korrigiert: fuer den Play-TTS-Pfad stimmt
das weiterhin, fuer den von Telnyx berechneten TTS-Betrag nicht mehr.

### Was als echte Luecke bleibt: eine Kontingent-Luecke, keine Geld-Luecke

| Zaehler | gespeist von | Wirkung |
|---|---|---|
| `usage[tenant].ttsCharacters` | Ist-Abgleich | keine — reine Lebenszeit-Summe |
| `platformTtsUsage.characters` | vor der Phase nur `tts/directive-synth.js:92` | Warnschwelle + Erschoepfung |
| `actualCostMicroCents` → Gate | alle zugeordneten Belege | Geld, gedeckt (s.o.) |

Der Relay-Pfad (`config.telnyx.telnyxElevenLabs`, `voice.js:316-323`) verbraucht dasselbe
ElevenLabs-Konto wie der Play-TTS-Pfad, erreichte den Kontingent-Zaehler vor dieser Phase
aber nie. Geldseitig ist das folgenlos (der Telnyx-Anteil ist gedeckt, der ElevenLabs-
Vertrag ist eine Fixgebuehr ohne Grenzkosten, Erschoepfung sperrt nichts, sie degradiert nur
auf Azure-`<Say>`). Real blieb aber: der Betreiber-Zaehner
(`GET /api/billing/platform-costs`), an dem die Warn-SMS haengt, stand bei 0, waehrend das
Konto lief — eine blinde Sicherung, aus der jemand Sicherheit ableiten konnte.

---

## Die zwei Guards

Beide in `src/boot-guard.js`, Findung `LATENT_COST_PATH_FINDING`, beide **WARN** (nicht
fatal), je mit P8-Handlungsanweisung im Meldungstext.

### Guard 1 — `PLAY_TTS_UNPRICED`

- **Bedingung:** `config.voice.elevenLabsPlayTts.enabled === true`
- **Test:** KV-P7-1 (Befund inkl. Handlungstext wird erzeugt)
- **Gegenbeispiel:** KV-P7-2 — Flag aus (Standard), Ergebnis `[]`

### Guard 2 — `REALTIME_NO_MIDCALL_BUDGET`

- **Bedingung:** `VOICE_ENGINE=realtime` UND `REALTIME_MID_CALL_BUDGET_CHECK` (Konstante
  in `src/bridge.js`, aktuell `false`, weil die Realtime-Bruecke nach Gespraechsbeginn
  keine Geld-Achse mehr prueft — nur einen Max-Dauer-Timer)
- **Tests:** KV-P7-3 (Befund entsteht, gegen die REALE Konstante aus `bridge.js`, nicht
  gegen eine Kopie), KV-P7-6 (haelt die Konstante gegen den echten Dateiinhalt von
  `bridge.js`, damit ein spaeteres `= true` ohne begleitenden Check den Test rot macht)
- **Gegenbeispiele:** KV-P7-4 (Konstante `true` → `[]`), KV-P7-5 (Budget-Engine
  `VOICE_ENGINE≠realtime` → `[]`)

---

## Massnahme 3 — was sie wirklich leistet

`recordTtsCharacters` (`state-ops.js`) wurde in eine private `bumpPlatformTtsQuota`
(Zyklus-Zaehler, Warnungen — unveraendertes Verhalten, byte-gleich zum Bestand) und eine
neue, exportierte `recordRelayTtsCharacters(s, { tenantId, chars, cfg, nowIso })`
aufgeteilt. Letztere wird jetzt aus `src/billing/cost-truing.js` (`bookTtsCharactersFor`)
fuer jeden zugeordneten Telnyx-TTS-Beleg aufgerufen: der Relay-Verbrauch fuellt seither
sowohl den echten Tenant-Bucket (`usageFor(tenant).ttsCharacters`) als auch den globalen
`platformTtsUsage`-Zaehler in einem Aufruf — belegt direkt am Zaehler (KV-P7-8/9,
Sweep-Ebene KV-P7-12).

Zusaetzlich gibt es eine **permanente Banner-Zeile**
(`ttsQuotaCoverageBannerLine`), belegt durch KV-P7-14 (Funktion) und KV-P7-15 (echter
Boot-Lauf) — ein Hinweistext, kein eigener Zaehlmechanismus.

**Ehrlich benannt:** Massnahme 3 ist damit beides — die eigentliche Zaehlungs-Fuellung
(Kern) und ein Banner-Hinweis (begleitend), nicht nur Letzteres. Der Kontingent-Zaehler
`platformTtsUsage`, den `GET /api/billing/platform-costs` zeigt und an den die Warn-SMS
haengt, sieht seit dieser Phase den Relay-Verbrauch. Vor der Phase sah er ihn nicht. Details
im Abschnitt "Was offen bleibt" unten (eine Randfrage bleibt tatsaechlich unbenannt).

Meldungscodes in `cost-truing.js`: zwei neue Werte im bestehenden
`COST_TRUING_FINDING` (`TTS_QUOTA_WARN_THRESHOLD`, `TTS_QUOTA_EXHAUSTED`) — derselbe
Kanal (entprellen → WARN → Audit) wie alle uebrigen Ist-Abgleich-Findings, kein eigener
Alarmweg, keine zusaetzliche SMS.

---

## Standard-Boot-Beleg

Echter lokaler Start (`PORT=3999`, generiertes `.env` aus `test/helpers.js` BASE_ENV,
frischer `DATA_DIR` via `scripts/bootstrap-tenant.js`, `NODE_ENV=production`): Boot-Log
enthaelt **weder** `play_tts_unpriced` **noch** `realtime_no_midcall_budget`. `/healthz`
antwortet 200. Prozess sauber beendet. Kein neuer Befund im Standardbetrieb — beide Guards
sind konditional und schlagen nur bei abweichender Konfiguration an.

---

## Landkarten-Entscheidung

`src/billing/cost-ledger-map.js`: die Zeile `play_tts_characters` bleibt unveraendert
(`kind: null, ledger: false, gate: false`) — Massnahme 4 entfaellt, also aendert sich die
Klassifikation nicht. Korrigiert wurde ausschliesslich der `preisquelle`-Text, der vor
KV-M1/KV-P3 pauschal behauptete, TTS-Zeichen koennten kein Geld werden; das stimmt weiter
fuer den Play-TTS-Pfad, nicht mehr fuer den von Telnyx berechneten Anteil. Keine andere
Zeile der Landkarte wurde angefasst.

---

## Mutationsproben

Sechs Mutationen gesetzt und wieder zurueckgenommen, jede hat genau die erwarteten Tests
rot gemacht:

- M1 `playTtsEnabled`-Bedingung invertiert → KV-P7-1, KV-P7-2 rot
- M2 Realtime-Bedingung vereinfacht (Check-Teil entfernt) → KV-P7-4 rot
- M3 `REALTIME_MID_CALL_BUDGET_CHECK` auf `true` gesetzt → KV-P7-3, KV-P7-6 rot
- M4 Aufruf von `bumpPlatformTtsQuota` im Relay-Pfad entfernt → KV-P7-8, KV-P7-12 rot
- M5 `changed`-Riegel in `recordRelayTtsCharacters` entfernt → KV-P7-11 rot
- M6 Kostentraeger-Zeile (`recordTenantTtsCharacters`-Aufruf) entfernt → KV-P7-10 rot

Nach jeder Ruecknahme: `npm test` wieder vollstaendig gruen.

---

## Angepasste Bestandstests

Keine. `existingTestsAdjusted` ist leer — alle 15 neuen Tests (KV-P7-1 bis KV-P7-15) sind
Neuzugaenge in `test/kv-p7-latent-paths.test.js`; die einzige Aenderung an einer
Bestandsdatei (`test/cost-truing-tts-characters.test.js`) betraf nur den Test-Harness
(`test/cost-truing-harness.js`), keine bestehende Assertion wurde geschwaecht.

---

## Safety-Urteil

**PASS.** Aus der unabhaengigen Safety-Review (eigener `npm test`-Lauf: 3878/3878 gruen,
103 s, kein Flake):

- Massnahme 4 entfaellt zu Recht — text-to-speech steht in `ASSIGNABLE_COST_RECORD_TYPES`,
  `sumRecordMicroCents` ist typ-blind, der Betrag geht ueber `applyCostCorrectionCents`
  auf die Achse; selbst nachgeprueft plus Bestandstest-Pin (16660).
- Kein Preis-Parameter im Diff, keine zweite Buchung.
- Beide Guards WARN mit je einem Gegenbeispiel-Test.
- Massnahme 3 ist flag-unabhaengig (Zaehler + unkonditionaler Banner), nicht bloss ein
  Text-Hinweis.
- Eigener Boot sauber, kein neuer Befund im Standardbetrieb.
- Fuenf Mutationen unabhaengig nachvollzogen, je genau die richtigen Tests rot.

Drei nicht-blockierende Concerns aus der Review:

- **C1:** `bumpPlatformTtsQuota` setzt `warnedCycle` einmal je Zyklus. Der Relay-Pfad
  speist den Zaehler jetzt live und kann diese Warnung fuer den Zyklus bereits
  beanspruchen. Wird Play-TTS spaeter eingeschaltet, kann dessen SMS-Alarm
  (`server.js:187-191`) fuer denselben Zyklus ausbleiben. Heute folgenlos (Play-TTS aus),
  aber im Code nicht benannt.
- **C2:** `ttsQuotaExhausted` liest denselben Zaehler — Relay-Verbrauch fuellt ihn, ein
  spaeter eingeschaltetes Play-TTS degradiert dadurch frueher auf Azure-`<Say>`. Semantisch
  richtig (ein Konto, ein Kontingent), aber als Folge nicht dokumentiert.
- **C3 (kosmetisch):** Die Klaerung zitiert `src/api-billing.js:160`; der tatsaechliche
  Pfad ist `src/routes/api-billing.js:160` (Inhalt korrekt, nur der Pfad im Doku-Text
  ungenau).

---

## Clean-Code-Audit

Verdikt: sauber, kein Blocker. Zwei S3-Stilbefunde:

- **C2** (`src/store.js:182-185`): der Kommentar ueber dem `recordTenantTtsCharacters`-
  Re-Export behauptete, `cost-truing.js` wuerfe ohne ihn einen TypeError — stimmt seit
  diesem Diff nicht mehr, da `cost-truing.js` jetzt `store.recordRelayTtsCharacters`
  ruft; einziger verbleibender Aufrufer der Re-Export-Funktion ist ein Test. Empfehlung:
  Kommentar korrigieren.
- **G28** (`src/boot-guard.js`, `latentCostPathFindings()`): die zusammengesetzte
  Bedingung `realtimeEngineSelected && !realtimeMidCallBudgetCheck` steht direkt im `if`,
  nicht als benanntes Praedikat gekapselt. Empfehlung: z.B.
  `const realtimeCostPathUnguarded = realtimeEngineSelected && !realtimeMidCallBudgetCheck;`
  extrahieren.

18 neue/geaenderte Tests gruen, Gegenbeispiele je Guard vorhanden, P8-Handlungsanweisungen
in beiden Boot-Befunden, C2-Korrektur der Preisquelle-Texte vollzogen, keine
Fliesskomma-Geldarithmetik, kein toter Code/Import.

---

## Fix-Runden inkl. Fehlalarme

Fix-Runde aus dem Clean-Code-Audit war noch offen (`=== FIXES ===` im Quelldokument war
leer) — beide S3-Befunde (C2-Kommentar, G28-Praedikat-Extraktion) sind niedrigschwellige
Stilhinweise ohne Blocker-Status und wurden nicht separat nachgezogen; sie bleiben als
offene, nicht-blockierende Nacharbeit stehen (siehe "Was offen bleibt").

Als Fehlalarm eingestuft und verworfen: ein einmaliges Flackern in
`test/dial-target-normalization.test.js` (404 statt 500 in einem NANP-Gate-Subtest)
waehrend der vollen Suite — kein grep-Treffer auf eine der KV-P7-Dateien, isoliert 33/33
gruen, zweiter Volllastlauf direkt danach 3858/3858 gruen. Bekannte
Sandbox-Flake-Klasse (Spawn-Test unter Last).

`npm run test:gates` haengte reproduzierbar an der bekannten Stelle
(`auth-p9a-cache-headers` unter `--test-name-pattern`) — dokumentierter Kickoff-Hinweis,
kein KV-P7-Testfall war zu diesem Zeitpunkt erreicht (alle KV-P7-N tragen kein
i18n-Katalog-Praefix). Nach 300 s abgebrochen, verwaister Test-Server manuell beendet.

---

## Was diese Phase NICHT tut

- Play-TTS bleibt aus (`ELEVENLABS_PLAY_TTS_ENABLED` weiterhin Default `false`) und wird
  durch diese Phase nicht aktiviert oder umgebaut — nur ein WARN-Boot-Guard beschreibt die
  Konsequenz, falls es jemand einschaltet.
- Realtime bleibt ungebaut in Bezug auf Mid-Call-Budgetpruefung — `bridge.js` bekommt
  keine neue Pruef-Logik, nur eine dokumentierte, auf `false` stehende Konstante
  (`REALTIME_MID_CALL_BUDGET_CHECK`) und einen Boot-Guard, der auf ihr Fehlen hinweist.
- Massnahme 4 (Preis-pro-Zeichen-Parameter) wird nicht gebaut — bewusst, s. Klaerung.
- Keine neue Env-Variable, keine neue `.env.example`/`render.yaml`-Verdrahtung.
- Kein neuer Alarmkanal (keine zusaetzliche SMS) — die neuen Findings laufen im
  bestehenden `COST_TRUING_FINDING`-Kanal.

---

## Was offen bleibt

- **Der ElevenLabs-Kontingent-Zaehler sieht den Relay-Verbrauch jetzt — nicht mehr
  blind.** Vor dieser Phase fuellte ausschliesslich der (deaktivierte) Play-TTS-Pfad
  `platformTtsUsage`; seit `recordRelayTtsCharacters` in `bookTtsCharactersFor`
  eingehaengt ist, speist jeder zugeordnete Telnyx-`text-to-speech`-Beleg denselben
  Zaehler. Das ist der Kern dessen, was Massnahme 3 tatsaechlich leistet — nicht nur ein
  Banner-Hinweis.
- Randfrage unbenannt im Code (Safety-Concern C1/C2): mit einem gemeinsamen Zaehler kann
  Relay-Verbrauch die Warn-/Erschoepfungsschwelle eines Zyklus bereits verbrauchen, bevor
  ein spaeter eingeschaltetes Play-TTS an der Reihe waere — dessen SMS-Alarm koennte fuer
  den Zyklus ausbleiben (C1), und Play-TTS wuerde dadurch frueher auf Azure-`<Say>`
  degradieren (C2). Heute folgenlos, weil Play-TTS aus ist; sollte im Code kommentiert
  werden, wenn Play-TTS je aktiviert wird.
- Zwei nicht-blockierende Clean-Code-Stilbefunde offen: veralteter Kommentar in
  `src/store.js:182-185` (C2), ungekapselte zusammengesetzte Bedingung in
  `src/boot-guard.js` (`latentCostPathFindings`, G28).
- Kosmetische Pfadungenauigkeit in der Klaerungsdoku: `src/api-billing.js:160` sollte
  `src/routes/api-billing.js:160` heissen (Inhalt korrekt).
- `npm run test:gates` bleibt an der bekannten `auth-p9a-cache-headers`-Stelle haengend —
  vorbestehendes, dokumentiertes Problem, nicht durch diese Phase verursacht und nicht
  durch sie behoben.
