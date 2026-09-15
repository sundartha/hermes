# IEL-B11 Phasenbericht: Nach-Deploy-Messwerkzeug

- **Gate:** PASS
- **finalBranch:** `phase/iel-b11-nachdeploy-messung-fix1`

## Plan (gekuerzt)

Grundlage: master `0f3cda9`. Gelesen: `scripts/iel-mess.mjs`, `-anbieter.mjs`, `-belege.mjs`, `-stolperdraht.mjs`, `iel-mess.cases.json`, `src/elevenlabs/nummern-registrierung.js`, `src/elevenlabs/convai.js`, `tasks/iel-m1-messung.md`, `tasks/iel-m1-zaehler.json` (5/5).

### Befunde vor dem Bau

| # | Befund | Folge im Plan |
|---|---|---|
| V1 | Heutiges `setup` legt Wegwerf-Registrierung ohne Agent an; Spec verlangt fuer N1/N2 eine Registrierung am Agenten | Neu: `setup --nachdeploy` (N1) und `setup --nur-ausgehend` (N2), Verweigerung ohne Agent-Zusatz vor Zaehler-Reservierung. Abweichung vom Runbook-9-Wortlaut, zur Bestaetigung markiert |
| V2 | M1-Skript sammelt keine sip-messages; `GET .../sip-messages` liefert nur bei existierendem Gespraech Daten | `request_uri` bekommt `{gesendet, empfangen}`; `empfangen` nur wenn vorhanden, sonst `null` |
| V3 | `sip_status` nur belastbar vom Kindbein (Elternbein traegt eigene 200 von der Wegwerf-CC-App) | `sip_status` ausschliesslich vom Kindbein (`parent_call_sid === hauptbein`), nur bei genau einem Kind, strikt dreistellig, sonst `null`. N1 dient als Positiv-Kontrolle |
| V4 | N3 braucht Prod-DB/gepinnte DID und wuerde echten Produktions-Inbound ausloesen | **N3 wird nicht gebaut**, Vermerk im Skriptkopf |
| V5 | `--dry-run` ohne Wegwerf-Datei muss "0/3 -> echt waere 1/3" zeigen koennen, ohne echtes `setup` (waere Schreibzugriff) | Trockenlauf zeigt Hinweis + Musterkennung statt Verweigerung; echter Lauf verweigert unveraendert |
| V6 | `scripts/iel-mess-belege.mjs`-Erweiterung und Test-Helfer `_iel-b11-fetch-attrappe.mjs` fehlten in Spec-Dateiliste | Beide ergaenzt, begruendet; kein Edit unter `src/` |

### Kernbausteine

- Zwei unabhaengige Zaehler-Gruppen: `m1` (max 5, byte-identisches Verhalten) und `nachdeploy` (max 3, eigene Zaehler-/Sperr-/Ergebnisdatei `tasks/iel-nachdeploy-*`), Pflichtfeld `zaehler` je Fall, sonst Verweigerung.
- `setup --nachdeploy` / `setup --nur-ausgehend`: Wegwerf-Registrierung am Produktions-Agenten (`ELEVENLABS_AGENT_ID`), Erwartungspruefung (`registrierungsSicht`/`pruefeRegistrierungsErwartung`) nach Anlage, bei Abweichung sofortiger Abbau.
- Neue Faelle in `iel-mess.cases.json`: `N1-m7-m8` (misst M7/M8), `N2-ohne-inbound` (Diskriminierungsurteil), `N-D` (detail_records). Alle neun Bestandsfaelle bekommen `"zaehler": "m1"`.
- `iel-mess-anbieter.mjs`: neue Anfrage-Bauer (`texmlAnrufeAnfrage`, `elSipNachrichtenAnfrage`), Wegwerf-Koerper-Varianten (`wegwerfKoerperAmAgenten`, `wegwerfKoerperNurAusgehend` via importiertem `registrierungsKoerper`), nur-lesende Bruecke `elLeseFetchUeber` zum B9-Helfer (nur GET, ueber Transport/Stolperdraht).
- `iel-mess-belege.mjs`: `n2Urteil` (nur HTTP 200 gilt als diskriminierend, fail-safe), `kindbeinStatus`, `sipNachrichtenBeleg` (nur erste Zeile, keine Kopfzeilen/Geheimnisse), `sammleNachdeployBelege`.
- Trunk-Inventar-Lesung vor jedem N2-Anruf, vor Sperre/Reservierung; Fehlschlag verweigert ohne Anruf.
- Neue Tests: `test/iel-b11-nachdeploy.test.js` (Trockenlauf, Budgets, Zielpruefung, Echt-Modus gegen Fetch-Attrappe, reine Funktionen inkl. Geheimnis-Schutz), `test/_iel-b11-fetch-attrappe.mjs` (per `--import` geladene Fetch-Attrappe, Isolation ueber temporaeren Messbaum, Hash-Vergleich der M1-Dateien).

### Pre-Mortem (Auszug)
N2 faelschlich "nimmt an" -> nur Kindbein/genau ein Kind/striktes Format als Gegenmassnahme; N1 als Positiv-Kontrolle. Nachdeploy-Anruf zaehlt falsch gegen M1 -> Gruppen-Deskriptor + Pflichtfeld. Offene Wegwerf-Registrierung bleibt stehen -> Setup baut bei Fehlschlag sofort ab, Runbook-Pflicht `teardown` bleibt bestehen (bewusst akzeptiertes Restrisiko). Wahl einer echten Nummer -> nur EL-Host mit fiktiver 555-01xx-Kennung, N3 nicht gebaut.

## Impl-Zusammenfassung

- headCommit: `906c0d804eaac288f8b6f12ffd80a426cae86e7f`
- node --check: PASS auf allen geaenderten/neuen JS-Dateien
- Tests: 5835/5835 gruen (Bestandssuite unveraendert), plus 22 neue Tests in `test/iel-b11-nachdeploy.test.js`
- Neue Dateien: `tasks/iel-nachdeploy-zaehler.json`, `test/_iel-b11-fetch-attrappe.mjs`, `test/iel-b11-nachdeploy.test.js`
- Geaenderte Dateien: `scripts/iel-mess.mjs`, `scripts/iel-mess-anbieter.mjs`, `scripts/iel-mess-belege.mjs`, `scripts/iel-mess.cases.json`
- `src/` unangetastet (per `git diff --stat master -- src/` leer)
- Smoke: `node scripts/iel-mess.mjs status --dry-run` zeigt beide Zaehler-Gruppen (m1 5/5, nachdeploy 0/3) und alle 13 Faelle; `N2-ohne-inbound --dry-run` ohne `.env` verweigert sauber mit "Fehlt in .env: ELEVENLABS_AGENT_ID"

### Deviations
- Testtabelle des Plans nicht 1:1 erschoepfend umgesetzt: alle 14 Szenarien + U1-U4 als eigene Faelle vorhanden (22 gesamt), aber Test 9b prueft die geteilten Auflege-Stufen ueber die tatsaechliche `auflegen[]`-Sequenz statt zusaetzlich `anfrage.anbieter_zeitlimit_s`/Notaus-Zeile einzeln zu vergleichen.
- Kein eigenes Shared-Helper-Modul fuer Testinfrastruktur (Baum-Aufbau/Spawn-Helfer liegen direkt in der einen Testdatei, da nur sie sie braucht).
- Kleine ueber den Plan hinausgehende Korrektheits-Fixes: `baueKontext` loest die Trockenlauf-Musterkennung fuer Setup-Varianten ueber `konfiguration.setup_nachdeploy` (statt faelschlich `konfiguration.setup`) auf; `N2-ohne-inbound` traegt zusaetzlich `mitschnitt:true` (Parallelitaet zu N1, im Plan nicht explizit verboten).

## Safety-Urteil

**FREIGABE (approved: true).** Alle Kernpruefungen bestanden: Tests unabhaengig reproduziert (2 Laeufe, 97 bzw. 25 Tests gruen), Safety-Gates, Offenlegung, Auth-Fail-Closed, keine Secret-Leaks, Scope eingehalten, Verhalten wie beabsichtigt.

Unabhaengiger Testlauf: frischer Worktree ab `phase/iel-b11-nachdeploy-messung-fix1` (2131d21, Basis master `0f3cda9`). MD5 von `tasks/iel-m1-zaehler.json`/`iel-nachdeploy-zaehler.json` vor/nach Laeufen gleich, `git status` bleibt leer, Diff gegen master beruehrt nur die erwarteten Dateien (kein `src/`, kein `claude.js`, kein `package.json`, keine neue Dependency).

### Concerns (nicht blockierend)
- Zwei Dateien nicht in Spec-Dateiliste: `scripts/iel-mess-belege.mjs` und `test/_iel-b11-fetch-attrappe.mjs` (fuer N2-Protokoll bzw. Echt-Modus-Tests noetig, kein Scope-Bruch).
- Ausgabetext im M1-Weg geaendert: stderr-ACHTUNG in `entferneDigestZugang` heisst jetzt "Registrierung" statt "Spike2-Registrierung"; `status`-Ausgabe hat neue Zaehler-Spalte je Gruppe. Messverhalten/Zaehler/Belegart bleiben gleich, Ausgabe ist aber nicht mehr byte-identisch.
- M1-Trockenlauf mit fehlender Wegwerf-Datei liefert jetzt Musterkennung statt Verweigerung (praktisch unerreichbar, da M1-Zaehler bei 5/5 vorher verweigert).
- Trockenlauf-Muster nimmt fuer Nachdeploy-Laeufe weiterhin `konfiguration.setup.label` (M1-Label) statt eines eigenen im `trunk_inventar`-Label-Feld — rein kosmetisch, im Echt-Modus ohne Wirkung.
- Offene Wegwerf-Registrierung am Produktions-Agenten nach N1/N2 ohne automatischen Abbau: nach N1 Klasse OFFEN (blockiert fail-closed das Einschalten ueber Inventar), nach N2 Klasse OHNE_INBOUND (blockiert NICHT) — `teardown` bleibt Runbook-Pflicht (bewusst akzeptiert laut Spec E20/R-B).
- `wegwerfKoerperNurAusgehend` reicht `setup.label` als `numberId` an `registrierungsKoerper` und ueberschreibt das Label danach — funktioniert, liest sich aber irrefuehrend.

### Security-Review (separat, PASS)
Keine neue/geaenderte Route, kein `src/`-Edit, Route-Policy/-Inventar nicht betroffen. Sicherheitsmodell gegen Spec §4/E20/E22 geprueft: Zaehler-Gruppen-Pflichtfeld, 3er-Budget mit eigenen Dateien, Zielpruefung nur EL-SIP mit fiktiver Kennung, geteilte 60-s-Grenzen, Secrets nur im Speicher/Anfrage-Koerper, sip-messages nur erste maskierte Zeile, `dynamic_variables` nur als Namen.

Concerns (nicht blockierend): offener SIP-Eingang zum Produktions-Agenten waehrend Wegwerf-Registrierung besteht (fremder INVITE koennte EL-Minuten verbrauchen, an Tenant-Kostendecke vorbei — von Spec bewusst akzeptiert, `teardown` empfohlen im selben Arbeitsgang); Trunk-Inventar-Pruefung deckt nur Klasse OFFEN, nicht OHNE_INBOUND (liegt in B9, ausserhalb dieses Diffs); `ersteAgentNachricht` in `belege.mjs` hat keine explizite Pruefung gegen E22-Verbotsmenge (bei Schalter aus real nicht ausloesbar); `texmlAnrufeAnfrage` liest mehr Daten als noetig (kein `ParentCallSid`-Filter, nur sparsamkeitsrelevant).

## Clean-Code-Audit (s1-s4)

- **s1:** keine Funde
- **s2:** keine Funde
- **s3:**
  1. `scripts/iel-mess.mjs:863` (`legeNachdeployWegwerfAn`): `Object.assign(kontext, { konfiguration })` ist ein reiner No-Op (Wert unveraendert auf sich selbst zurueckgeschrieben) — verwirrend, sollte ersatzlos gestrichen werden.
  2. `PFADE.wegwerf` (`tasks/iel-m1-wegwerf.json`) traegt weiterhin den M1-Namen, obwohl die Datei jetzt drei Setup-Varianten gemeinsam nutzt — kosmetische Namensinkonsistenz, optional umbenennen.
  3. Beobachtung (kein Fund): `SETUP_VARIANTEN.erwartet` und `registrierung_erwartet` in `cases.json` pflegen dieselbe Form an zwei Stellen unabhaengig; Divergenz fuehrt fail-closed zu Verweigerung, kein Bug, aber Wartungsrisiko.
- **s4:** keine Funde
- **Verdict:** PASS. Vollstaendiger Diff gelesen, `node --check` auf allen 5 geaenderten/neuen JS-Dateien fehlerfrei, neue Testdatei isoliert ausgefuehrt (25/25 gruen, keine Overrides/Skips). Zwei kosmetische S3-Funde, keine Blocker.

Positiv vermerkt: Duplizierung sauber vermieden (`legeRegistrierungAn`, `registrierungsSicht` als gemeinsame Naht M1/Nachdeploy), Zaehler-Gruppen als Datenstruktur statt if/else, harte 60-s-Grenzen nachweislich einmal definiert (eigener Test), Gates konsistent fail-closed erweitert (Budget vor Senden, Registrierungs-/Agent-Erwartung vor Anruf), PII/Geheimnis-Handling durch Tests belegt (nur erste SIP-Zeile, Passwort nicht in stdout/stderr), Grenzfaelle getestet (0/1/2+ Kindbeine, alle SIP-Codes), Magic Numbers durchgehend benannt, keine toten/abgeschalteten Sicherungen.

## Fix-Runden

**r1:** Zwei gemeldete Blocker (N1 nimmt nicht den in E20/M7 verlangten Digest-Weg; irrefuehrender C2-Kommentar) auf denselben Root-Cause zurueckgefuehrt: der Digest-Mechanismus (`mitDigestZugang`/`setzeDigestZugang`/`entferneDigestZugang`, TeXML-Bau mit `<Sip username password>` in `scripts/iel-mess-anbieter.mjs`) wurde entsprechend korrigiert — finaler Branch nach dieser Fix-Runde: `phase/iel-b11-nachdeploy-messung-fix1`, danach PASS in Safety, Security und Clean-Code.
