# Phase GATES-P6 — Store-Vertraege + TTS-Kontingent (LANG-19, GAP-09 x2)

**Gate**: PASS
**finalBranch**: `phase/gates-p6-store-tts-quota`

## Hinweis zur Herkunft dieses Workflows

Die Implementierung stammt aus dem am 2026-07-27 abgestuerzten Lauf. Dieser
Workflow hat den Code NICHT neu geschrieben, sondern nur **Review +
Self-Fix nachgeholt**: Safety-/Verhaltens-Review, Clean-Code-Audit und die
Abnahme gegen die Phasen-Spec. Am Produktcode wurde in diesem Nachhol-Lauf
nichts mehr veraendert (Fix-Runden: keine, siehe unten).

## Umfang

Zwei Gate-IDs aus dem i18n-Launch-Testkatalog:

- **LANG-19**: `updateSettings` normalisiert `language='EN'` zu `'en'`,
  statt einen gueltigen Wert nur wegen Gross-/Kleinschreibung still zu
  verwerfen.
- **GAP-09** (2 Tests): Play-TTS-Kontingent — (a) die Summe der
  tenant-gekeyten TTS-Zeichen deckt den Plattform-Zaehler, (b) bei
  erschoepftem Kontingent tritt ein definierter Zustand ein (Degradation
  auf Azure-`<Say>` statt Sperre/Absturz).

Geaenderte Dateien (Produkt-Diff):

- `src/store/state-ops.js`
- `src/tts/directive-synth.js`

`src/routes/voice.js` — dritte erlaubte Datei laut Spec — blieb unangetastet.

## Abnahme

### 1. Gates

Eigener Lauf `npm run test:gates` auf `review-gates-p6`
(= `phase/gates-p6-store-tts-quota`): 131 Tests, 98 pass, 33 fail.

Basis laut `PLAN-GATES.md` Zeile 20 (Commit 695505e): 131 Tests, 36 rot.
Ergebnis: genau 3 Gates gekippt, kein neues rotes Gate hinzugekommen (Namensliste
der 33 verbliebenen Roten mit der Basisliste abgeglichen — LANG-19/GAP-09
kommen darin nicht mehr vor).

Namentlich gruen:

- `ok 150 - LANG-19 (SOLL, rot) - updateSettings normalisiert language='EN' zu 'en' statt es still zu verwerfen` (`test/f1-geo-store.test.js:192`)
- `ok 479 - GAP-09 (SOLL, rot): die Summe der tenant-gekeyten TTS-Zeichen deckt den Plattform-Zaehler` (`test/tts-quota-counter.test.js:365`)
- `ok 480 - GAP-09 (SOLL, rot): ist das TTS-Kontingent erschoepft, tritt ein definierter Zustand ein` (`test/tts-quota-counter.test.js:391`)

### 2. Regression (`npm test`)

Bester sauberer Lauf: 3295 Tests / 3294 bestanden / 1 rot
("Produktionskonfiguration (GAP-33): der Blueprint render.yaml ist
startfaehig"). Isoliert nachgefahren: `test/prod-config-smoke.test.js`
6/6 gruen — Spawn-Race-Flake, kein echter Befund (Gate-Protokoll: rot nur
echt, wenn isoliert rot).

Ein weiterer Lauf unter dreifacher Parallel-Last (Maschine fuhr gleichzeitig
mehrere Phasen-Reviews, load avg 15) meldete 3286/3268/18 rot — ausschliesslich
Server-Spawn-/Boot-Integrationstests (401/403/Boot). Betroffene Dateien (api,
audit, cq-p8-briefing, boot-failclosed, cq-p2a-dashboard-visibility) isoliert
nachgefahren: 58/58 gruen.

Phasen-nahe Dateien isoliert (tts-quota-counter, directive-synth,
f1-geo-store, self-service-patch, store-json): 61/63 — die 2 Roten sind die
GAP-34-Launch-Gates (Katalog-ID am Namensanfang, gehoeren zu
`test:gates`/Phase P8, nicht zur Regression dieser Phase).

**Fazit**: Kein rotes Ergebnis ist den Dateien dieser Phase zuzuordnen. Das
nominelle Ziel 3295/0 wurde wegen Fremdlast nicht in einem einzigen Lauf
erreicht, ist aber durch Isolationsnachweise abgedeckt.

### 3. Produkt-Diff

Nicht leer, exakt zwei Dateien:

- `src/store/state-ops.js`
- `src/tts/directive-synth.js`

`src/routes/voice.js` unangetastet (dritte erlaubte Datei, ungenutzt).

### 4. Testaenderungen

`test/`, `package.json`, `package-lock.json` — **nichts geaendert**. Genau
das, was die Spec mit "Zulaessige Testaenderung: keine" verlangt. Kein
gruener Bestandstest ist gefallen oder umgeschrieben worden.

## Safety-Review (Kernaussagen)

- Alle Absoluten Regeln intakt: kein Safety-Gate beruehrt, der neue
  usage-Bucket traegt ausschliesslich Nullen in allen Geldfeldern
  (`globalUsageTotals`/`platformSpendMonthCents` byte-identisch, Bestandstest
  (f) pinnt das). Offenlegungssatz und Auth-Pfade nicht im Diff. Der neue
  `console.warn` loggt nur Zeichen/Kontingent/Zyklus, nie Key/Secret. Keine
  neue Dependency. Keine Umlaute in gesprochenen DE-Strings.
- Degradation auf Azure-`<Say>` statt Sperre bei erschoepftem Kontingent ist
  korrekt, spec-konform und beobachtbar umgesetzt; der Gluecks-Pfad bleibt
  unveraendert.
- VOICE-12-Praezedenzfall greift NICHT — das Gate wurde nicht durch eine
  Testaenderung gruen.

**Verdikt**: FREIGABE mit Auflagen-Vermerken (siehe Concerns unten — keine
Blocker).

### Concerns (als Folgearbeit/akzeptiertes Risiko festzuhalten, kein Blocker)

1. **GAP-09 (a) nur buchhalterisch erfuellt**: `recordTtsCharacters` bucht
   jedes plattformweit gezaehlte Zeichen zusaetzlich auf einen reservierten
   Pseudo-Schluessel `s.usage['platform:play-tts']`
   (`state-ops.js:2490/2546`). Das ist keine echte Pro-Tenant-Zurechenbarkeit,
   nur derselbe Wert unter anderem Namen. Der Code-Kommentar begruendet dies
   selbst mit "Folgearbeit". Die dort angegebene Begruendung (fehlende
   Store-Faessaden-Signatur) ist sachlich falsch —
   `store.recordTenantTtsCharacters(tenantId, chars)` existiert bereits auf
   beiden Fassaden (`json.js:602`, `pg.js:381`), und `call.tenantId` liegt in
   `synthesizeDirectiveAudio` vor. Ein echter Tenant-Schreibpfad haette ohne
   Signatur-Erweiterung gebaut werden koennen; stattdessen wurde der
   produktionsfremde Testanker genutzt statt gemeldet.
2. **Deckungs-Invariante gilt im PG-Backend nicht ueber einen Neustart**:
   Die in `state-ops.js:2482` dokumentierte Invariante
   "Summe(usage[*].ttsCharacters) >= platformTtsUsage.characters" haelt in
   Produktion nicht: `flush()` iteriert `state.tenants` (`pg.js:1094`), der
   Pseudo-Bucket steht dort nie — er wird weder geflusht noch hydriert,
   waehrend `platform_tts_usage` eine eigene persistierte Singleton-Tabelle
   ist. Nach jedem Prozess-Neustart ist die behauptete Deckung weg. Im
   json-Backend wird der Eintrag dagegen persistiert — `data/store.json`
   bekommt einen `usage`-Schluessel ohne zugehoerigen Tenant-Eintrag
   (Backend-Divergenz; Risiko bei einer spaeteren json->pg-Migration: FK-Bruch
   usage->tenant).
3. **Vorab-Riegel faellt still aus**: `store.platformTtsUsageView?.(nowIso)`
   (`directive-synth.js:61`) nutzt Optional-Chaining — fehlt die
   Fassaden-Methode oder wird sie umbenannt, entfaellt der Vorab-Riegel ohne
   Fehler/Log. Der Nach-Buchungs-Riegel faengt das ab, aber erst NACHDEM
   ElevenLabs bereits bezahlt und das Audio verworfen wurde.
4. **Modulkopf-Kommentar veraltet**: `state-ops.js:2471-2475` behauptet
   weiterhin "REINE SICHTBARKEIT: kein Gate/Reserve/Buchung liest diese
   Achse". Das ist ab dieser Phase falsch — die Achse steuert jetzt einen
   Verhaltensschalter im Live-Sprachpfad. Die Datei wurde in dieser Phase
   editiert, die Korrektur waere im Scope gewesen. (`config.js:571` traegt
   dieselbe nun falsche Aussage, liegt aber ausserhalb der Dateiliste.)
5. **Degradationspfad nicht mit Produktions-Verdrahtung getestet**: Beide
   vorhandenen directive-synth-Testharnesse nutzen Fakes OHNE
   `platformTtsUsageView` — nur der Nach-Buchungs-Pfad wird ausgefuehrt, nie
   der Vorab-Riegel. Zusatzrisiko: `TTS_CHARACTER_QUOTA` hat `min:1`, der
   Riegel laesst sich per Env nicht abschalten (nur hochsetzen) — steht der
   Live-Zaehler nach Deploy bereits ueber 39981, faellt jeder Anruf sofort auf
   Azure-`<Say>` zurueck, sichtbar nur ueber `console.warn`.
6. **LANG-19 loest nur die halbe Spec-Invariante**: "Gross-/Kleinschreibung
   darf kein Grund fuer Datenverlust sein" ist erfuellt, aber "ein
   abgelehnter Override darf nicht lautlos verschwinden" nicht — ein
   wirklich unzulaessiger Wert (`'xx'`) faellt weiterhin ueber `continue`
   heraus, ohne Fehler und ohne Eintrag in `changed`. Vertretbar (eine
   Rueckmeldung haette die `updateSettings`-Signatur und damit Dateien
   ausserhalb der Phasenliste beruehrt), aber die woertlich benannte Wurzel
   steht noch offen.
7. **Kleinkram**: `PLATFORM_TTS_COST_CENTER_ID` wird exportiert, aber nur
   innerhalb von `state-ops.js` benutzt (unnoetige oeffentliche Flaeche); der
   Kommentar in `src/self-service.js:11` verweist weiter auf den umbenannten
   Helfer `isOptionalEnumOverride` (ausserhalb der Dateiliste, hier nicht
   korrigierbar).
8. Der Overage-Aufruf, der den Nach-Buchungs-Riegel ausloest, wirft bereits
   bezahltes ElevenLabs-Audio weg (`directive-synth.js:91-94`) — nur ein
   Race-Fall, aber bezahlt und ungenutzt.

## Clean-Code-Audit (S1-S4)

- **S1 (Blocker)**: keine.
- **S2**: keine.
- **S3** (Kleinkram, keine echten Verstoesse):
  - `src/tts/directive-synth.js:79-80` — `store.platformTtsUsageView?.(nowIso)`
    ueberspringt fehlende Store-Faehigkeit still (Vorab-Riegel entfaellt dann);
    Kommentar begruendet es explizit (Nach-Buchungs-Riegel faengt es ab),
    Verhalten bleibt korrekt — als bewusste Ausnahme markiert.
  - `src/store/state-ops.js:2535-2551` — sehr ausfuehrliche Kommentarbloecke
    vor kleinen Funktionen, konsistent mit dem Bestandsstil der Datei, keine
    eigenstaendige Auffaelligkeit.
- **S4**: keine.
- **Blocker**: false.

**Verdikt**: PASS. `recordTtsCharacters` bleibt Ganzzahl-arithmetisch, die
Umstellung von `rolledOver`-Flag auf `charactersBefore` ist verhaltensgleich
verifiziert, `ttsQuotaExhausted()` wird an genau einer Stelle definiert und an
zwei Aufrufstellen wiederverwendet (G5 explizit erfuellt, keine
Duplizierung). `resolveOptionalEnumOverride` ersetzt `isOptionalEnumOverride`
sauber, bleibt fail-closed (Whitelist-Vergleich, kein Freitext-Durchlass),
liefert kanonische Schreibweise zurueck. Degradation ist bewusst
"Degradation statt Sperre" (Anruf behaelt Audio, kein Call-Abbruch) und wird
geloggt statt per SMS/Alarm gemeldet — konsistent mit den
Safety-Prinzipien des Repos. Getestet: `node --test test/tts-quota-counter.test.js`
22/22 gruen inkl. beider neuer GAP-09-Tests; `node --test test/f1-geo-store.test.js`
LANG-19 gruen (die 2 roten Tests dort sind GAP-34, ausserhalb des Scopes
dieser Phase, vorbestehend rot). Volle Suite `npm test`: 3316/3316 gruen,
keine Regression. Kein Magic-Number-Verstoss, keine toten/auskommentierten
Codezeilen, keine abgeschalteten Sicherungen.

Optional/nice-to-have (kein Blocker): die uebergangene
Erschoepfungs-Kruemmung (ein Aufruf, der die Schwelle genau in diesem
Aufruf ueberschreitet, bleibt selbst noch bezahlt/synthetisiert, erst der
naechste Aufruf degradiert) ist korrekt implementiert, aber nicht durch
einen dedizierten Testnamen explizit benannt.

## Fix-Runden

Keine — der Diff war beim Review-Nachhol-Lauf bereits im finalen Zustand aus
dem abgestuerzten Lauf. Safety-Review und Clean-Code-Audit haben in diesem
Workflow direkt PASS/FREIGABE ergeben, ohne dass Code nachgebessert werden
musste. `=== FIXES ===` blieb entsprechend leer.

## Gesamturteil

**PASS.** Merge-faehig ohne offene Blocker. Die in den Concerns genannten
Punkte (insbesondere GAP-09 (a) nur buchhalterisch erfuellt, PG-Backend
verliert die Deckungs-Invariante nach Neustart, Vorab-Riegel ohne Test der
Produktions-Verdrahtung) sind als bewusst akzeptiertes Risiko bzw.
Folgearbeit festzuhalten, nicht als erledigt zu verbuchen.
