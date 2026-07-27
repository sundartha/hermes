# Phase GATES-P3 — Kauf-Land-Tabelle (DID-05, DID-09)

**Gate:** PASS
**finalBranch:** `phase/gates-p3-provisioning-geo`

## Hinweis zur Herkunft dieses Laufs

Die Implementierung stammt aus dem am 2026-07-27 abgestuerzten Lauf. Dieser
Workflow hat KEINE neue Implementierung erstellt, sondern ausschliesslich
Review (Safety + Clean-Code) und Self-Fix auf dem bestehenden Stand
nachgeholt.

## Zusammenfassung

Erweitert die Kauf-Land-Tabelle in `src/telephony/provisioning-geo.js` um 7
neue Laender (AT, AU, CA, CH, ES, IE, IT) und macht `phone_number_type` bei
jeder Telnyx-Nummernsuche explizit (Konstante `DEFAULT_PHONE_NUMBER_TYPE =
'local'`). Betrifft genau eine Datei, ein Commit (`1a93ef3` auf `695505e`),
43+/25-.

## Abnahme

### 1. Gates (DID-05, DID-09)

- Eigener Lauf `npm run test:gates` auf `review-gates-p3`
  (= `phase/gates-p3-provisioning-geo`): korrigiert tests 131 / pass 97 /
  fail 34.
- Beide Phasen-Gates GRUEN:
  - `ok 160 - DID-05 (SOLL, rot) - reale Laender ohne Tabellen-Eintrag
    kaufen im eigenen Land, nicht still im Provisioning-Default`
    (`test/f1-provisioning-geo.test.js:128`)
  - `ok 161 - DID-09 (SOLL, rot) - jedes bespielte Kauf-Land waehlt seinen
    phone_number_type explizit` (`test/f1-provisioning-geo.test.js:141`)
- Gegenprobe gegen die Basis: `npm run test:gates` auf `695505e` = fail 36.
- Mengendifferenz der Fehlerlisten (comm): NUR-IN-BASE = exakt DID-05 +
  DID-09; NEU-ROT = leer. Kein anderes Gate hat sich bewegt.
- Zusaetzlich weiter gruen: `DID-09 (Mechanismus, gruen) - searchNumbers
  setzt filter[phone_number_type] genau dann, wenn ein type kommt`
  (`test/telnyx-numbers.test.js`) — die Adapter-Gegenprobe.

### 2. Regression (`npm test`)

- Voller Lauf: korrigiert tests 3295 / pass 3286 / fail 9 (Soll 3295/0).
- Alle 9 Fehlschlaege sind KEINE Assertion-Fehler, sondern durchgaengig
  "Server-Start Timeout. Output: (leer)" nach 15 s aus
  `test/helpers.js:970` — der dokumentierte Voll-Last-Spawn-Race
  (Kindprozess-Server bootet nicht rechtzeitig), verschaerft durch
  parallele Wellen-Worktrees auf derselben Maschine.
- Betroffen: `dial-target-normalization.test.js` (2, davon 1 Subtest),
  `f1-geo-onboard.test.js` (1), `g2-opening-turn.test.js` (2),
  `g3-speech-timeout.test.js` (1), `g4-no-speech-reprompt.test.js` (1),
  `gap-10-hour-limit-per-tenant.test.js` (1),
  `gap-35-metrics-country.test.js` (1).
- Isolierte Gegenprobe nach Repo-Protokoll (rot ist nur echt, wenn isoliert
  rot): dieselben 7 Dateien mit identischem `--test-skip-pattern` erneut
  gefahren → tests 61 / pass 61 / fail 0.
- Kein neuer roter Bestandstest; keine der 9 Dateien beruehrt
  `provisioning-geo.js` in einer Assertion (`f1-geo-onboard`: der
  Nachbartest "FORCE_NUMBER_COUNTRY=US: number.country US ..." war im
  Volllauf gruen).
- Alle Bestandstests von `test/f1-provisioning-geo.test.js` (FR→FR,
  DE→Fallback, unbekannt→Fallback, Drain FR/DE, R1-Idempotenz, R5
  0-Treffer, DID-19, GAP-11-Geldinvariante) waren im Volllauf gruen =
  glueckliche Pfade unberuehrt.
- Nachtrag Clean-Code-Auditor: eigener voller `npm test`-Lauf 3316/3316,
  0 fail (nachgefahren, ohne den Spawn-Flake).

### 3. Produkt-Diff

Nicht leer und exakt die Dateiliste der Phase:

- `src/telephony/provisioning-geo.js` (einzige geaenderte Datei, 43+/25-,
  ein Commit `1a93ef3` auf `695505e`)

### 4. Testaenderungen

`git diff --stat 695505e..branch -- test/ package.json package-lock.json`
ist LEER — null Testaenderungen. Die Spec erlaubt fuer diese Phase keine
Testaenderungen; erfuellt.

## Safety-Review (Ergebnis)

**Verdict:** PASS — alle vier Abnahmepunkte erfuellt, absolute Regeln
halten. Kein VOICE-12-Muster: beide Gates gehen gruen, WEIL sich das
Produkt aendert — DID-05 durch 7 neue Tabellen-Schluessel (CA/IE/AU/CH/AT/
ES/IT, exakt die Liste des Testankers, kein Extra-Land), DID-09 durch die
benannte Konstante `DEFAULT_PHONE_NUMBER_TYPE='local'`, die ueber
`onboarding.js:83` → `adapters/telnyx/numbers.js:73` real als
`filter[phone_number_type]` auf dem Draht landet.

Absolute Regeln: keine Safety-Gate-Datei beruehrt (Denylist/Land/
Stundenlimit/Budget/Max-Dauer/Signatur unangetastet), FORCE_NUMBER_COUNTRY-
Override unangetastet und weiter vorrangig, Hold-vor-Order und die drei
Doppelkauf-Schloesser unberuehrt (R1/R5-Tests gruen), disclosureSentence
nicht beruehrt, kein Auth-/Endpunkt-Eingriff, kein Logging und kein Secret
im Diff, keine neue npm-Dependency (`package.json` unveraendert), keine
abgeschaltete Sicherung.

Clean Code (Safety-Review-Ebene): benannte Konstante statt Magic String,
Verschachtelung 1, keine Umlaute in Kommentaren, `prettier --check` gruen,
`node --check` gruen.

Merge-freigabefaehig; die folgenden Concerns sind Deploy-/Doku-Hinweise,
keine Blocker.

### Concerns (Safety-Review)

1. **LIVE-wirksame Verhaltensaenderung** (beabsichtigt, aber
   deploy-relevant): jede Telnyx-Suche traegt ab jetzt
   `filter[phone_number_type]=local` — auch der DE-/config-Fallback und der
   heute live laufende US-Kauf, der bisher OHNE Filter lief. Wert `local`
   ist nicht geraten: `tasks/i18n-tests/06-nummern-provisioning.md:240-241`
   nennt ihn woertlich als Soll. Fehlt `local`-Inventar in einem Land,
   liefert die Suche 0 Treffer → `onboarding.js:89` wirft → `failNumber` +
   `cancelHoldIfHeld` (kein bezahlter Orphan, R5-Test gruen). Kein
   Geldverlust, aber der Tenant bekommt keine Nummer. Der erste Kauf nach
   Deploy gehoert beobachtet.
2. DID-05 haengt 7 neue Kauf-Laender in die Tabelle (AT, AU, CA, CH, ES,
   IE, IT). Latent, solange `render.yaml:176-177` `FORCE_NUMBER_COUNTRY='US'`
   setzt (Override sticht weiterhin, weil er upstream `number.country`
   belegt — `api-onboard.js:142` / `provision-trigger.js:40`; die Tabelle
   keyt nur darauf). Faellt der Override, kauft Hermes dort ERSTMALS real
   ein; Telnyx-Regulatory-Anforderungen (Adressnachweis) fuer
   AT/CH/ES/IT/AU sind nirgends geprueft — ein Order kann dann 422 werfen.
   Kontrollierter Fehlschlag, aber betrieblich zu wissen.
3. Strukturaenderung ueber das Minimum hinaus: das Feld `telnyxCountryCode`
   wurde entfernt, der Tabellen-Schluessel ist jetzt selbst der
   Suchparameter (`countryCode: entry ? key : fallback`). Fuer FR/GB/US
   verhaltensgleich (dort galt `telnyxCountryCode === Schluessel`), aber
   die Faehigkeit "ISO-Land != Telnyx-Suchland" ist damit weg. Heute
   unbenutzt; P4 faehrt in der naechsten Welle an dieselbe Datei — falls
   sie die Unterscheidung braucht, muss sie zurueck.
4. Kommentar-Widerspruch in derselben Datei: der Bestandsblock Zeilen
   26-29 behauptet weiter "DE byte-identisch" / "Dry-Run byte-identisch",
   der neue Kopfblock Zeilen 7-10 sagt korrekt, dass ab jetzt jeder
   Suchaufruf einen `type` traegt. Fuer `countryCode`/`connectionId` und
   den Dry-Run stimmt die alte Aussage noch, fuer die abgesetzte
   Suchanfrage nicht mehr. Zwei Bloecke, die sich gegenseitig
   relativieren — reine Doku-Kosmetik, kein Verhaltensdefekt.
5. `entry?.connectionId` und `entry?.phoneNumberType` sind
   Uebersteuerungspfade ohne heutigen Nutzer (alle 10 Eintraege sind
   `{}`). Das spiegelt das Bestandsmuster von `holdAmountCents` und ist im
   Kommentar als Erweiterungspunkt benannt — aber bis ein Land sie nutzt,
   sind beide Zweige ungetestet.

## Clean-Code-Audit

**Verdict:** PASS.

Sauberer, minimaler Diff (nur 1 Datei geaendert:
`src/telephony/provisioning-geo.js`, 43+/25-): erweitert die Kauf-Land-
Tabelle (DID-05) und macht die Nummernart pro Suche explizit (DID-09),
ohne Geld-Pfad oder Idempotenz-Schloesser anzufassen (per Kommentar UND
per Test bestaetigt). Beide zuvor rot markierten SOLL-Tests (DID-05,
DID-09 in `test/f1-provisioning-geo.test.js`) sind jetzt gruen verifiziert;
die volle Regressionssuite (`npm test`) laeuft gruen (3316/3316, 0 fail,
selbst nachgefahren). GAP-11 (Hold-pro-Land) bleibt bewusst rot —
ausserhalb des P3-Scopes (nur Suchparameter, kein Geld) und laut
Kommentar/Testname korrekt als offenes Gate deklariert, keine Regression.
DE bleibt byte-identisch ueber den config-Fallback (kein DE-Tabelleneintrag,
vermeidet G5-Duplizierung der Quelle). Keine Magic Numbers, keine toten
Zweige, keine abgeschalteten Sicherungen, keine Verschachtelungs-/
Argument-Verstoesse. Kommentardichte hoch, aber inhaltlich praezise und
konsistent mit dem Bestand (kein C2/C3/C5-Verstoss).

**passNotes:** Klare, knappe Aenderung mit hoher Test-Abdeckung:
existierende SOLL-Tests (rot vor der Phase) sind jetzt der Beweis, kein
neuer Test noetig. Kommentare erklaeren Rationale (warum DE nicht in der
Tabelle, warum `type` als Konstante statt Feld) statt nur zu
paraphrasieren. Idempotenz-/Geld-Invarianten explizit als unberuehrt
dokumentiert und durch R1/R5/P9-Tests weiterhin gruen bestaetigt (34/35 in
der Datei, der eine Fail ist das erwartet rote GAP-11 aus einem anderen
Scope).

### S1 (Blocker)

Keine.

### S2 (Blocker)

Keine.

### S3 (Hinweis)

- `src/telephony/provisioning-geo.js:79` — `entry?.phoneNumberType ||
  DEFAULT_PHONE_NUMBER_TYPE` (und ebenso `entry?.connectionId || ...`)
  nutzt `||` statt `??` — falls je ein Eintrag bewusst einen leeren String
  traegt, wuerde er lautlos auf den Default zurueckfallen. Heute kein Bug
  (kein Eintrag setzt das Feld), aber Nullish-Coalescing (`??`) waere
  praeziser (G26). Nur Hinweis, kein FLAG-Zwang.

### S4 (Hinweis)

- `src/telephony/provisioning-geo.js:41-51` — `COUNTRY_SEARCH_PARAMS`
  traegt jetzt 10 Laender-Schluessel, jeder mit leerem `{}` (nur
  AT/AU/CA/CH/ES/IE/IT sind neu, keiner hat heute eine Abweichung).
  Bewusst so kommentiert (ein Land = ein Eintrag, OCP-Vorbereitung) und
  durch den DID-05-Test erzwungen — vertretbar, kein harter Verstoss.

### topTodos (aus dem Clean-Code-Audit)

1. Optional: `||` durch `??` ersetzen bei
   `phoneNumberType`/`connectionId`-Fallback fuer Praezision (kein
   aktueller Bug).
2. Sobald ein Land eine Type-/Connection-Abweichung braucht, den leeren
   `{}`-Platzhalter mit echtem Wert fuellen statt neue Struktur
   einzufuehren.
3. GAP-11 (Hold pro Land) bleibt offen fuer eine Folge-Phase — nicht Teil
   von P3, aber im Backlog sichtbar halten.

## Fix-Runden

Keine — dieser Review-Lauf hat auf dem uebernommenen Implementierungsstand
keine Aenderungen vorgenommen (`=== FIXES ===` war leer). Beide Reviews
(Safety, Clean-Code) haben den Stand ohne Fix-Runde direkt auf PASS
gebracht.
