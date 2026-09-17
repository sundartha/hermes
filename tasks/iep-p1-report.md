# Phase IEP-P1 "Der Ohrzeuge" — Detailbericht

**Gate: PASS** · finalBranch: `phase/iep-p1-ohrzeuge-fix1` · headCommit (vor Fix-Runde r1): `8ffa127`

Ziel der Phase (§IEP-P1 der Strategie): ein Messanruf auf die eigene DID mit dual-kanaligem
Mitschnitt, um erstmals zu hoeren/messen, was ein Anrufer wirklich zu hoeren bekommt — abgesichert
durch vier fail-closed-Riegel und ausgewertet in sieben Kennzahlen.

---

## 1. Plan (gekuerzt)

Grundentscheidung: **kein zweites Werkzeug.** Der Ohrzeuge ist eine dritte Fall-Gruppe im
Bestandsmesswerkzeug `scripts/iel-mess.mjs` (neben `m1`/`nachdeploy`), die deren Verhalten und
Zaehlerdateien unberuehrt laesst.

Ablauf:
```
node scripts/iel-mess.mjs OZ-vorher
  pruefeAnrufFall -> gruppe.pruefeZiel(fall)      [4 Riegel, rein, OHNE Netz]
  pruefeSchluessel / leseZaehler(ohrzeuge, max 18)
  gruppe.pruefeVorAnruf(kontext)                  [Vorlauf-Beleg + Konto-DIDs + Sprechspur]
  mitSperre -> reserviere -> fuehreAnrufDurch
      texml-ohrzeuge -> POST /v2/texml/calls (GENAU EIN <Dial><Number>, kein <Say>)
      nimmAnruferAn -> answer + record_start {format:"wav", channels:"dual"}
      begleiteBisEnde: spieleSprechspur (playback_start, eigene command_id)
                       -> Wachhund 40s -> Nachfassen 48s -> Notaus 55s
  sammleBelegeNachAnruf -> Sitzungs-Ereignisse beider Beine, WAV-Auswertung, 7 Kennzahlen
```

**Vier Riegel** (`scripts/iel-mess-ohrzeuge.mjs`, reine Funktionen, kein Netz/Config/Datei-IO):

| Riegel | Pruefung |
|---|---|
| R2 Notaus | `OUTBOUND_FROZEN === true` -> Verweigerung |
| R1 Ziel | strikte String-Gleichheit `ziel === OHRZEUGE_ZIEL_PIN`, Mess-Tenant eindeutig gepinnt (Allowlist-Scope) |
| R3 Denylist | `deniedPrefix` aus `src/telephony/number-denylist.js` (Bestandsquelle) auf Ziel UND Absender |
| R4 Absender | Pflicht, E.164, != Ziel, kein Feld mit Anbieter-Schreibzugriff (`digest`/`el_registrierung_id`/…) |

Zusaetzlich: 24h-befristeter Vorlauf-Beleg (Tenant-Bindung, `sms_summary_opt_in=false`,
`private_number_treffer=false`, Kostendecke-Kopfraum >= 500 ct) und ein Telnyx-Eigentumsbeleg
(exakter Vergleich, da `filter[phone_number]` teil-matcht).

**Sieben Kennzahlen** (`ohrzeugeKennzahlen`): (i) `annahme_ms`, (ii) `fremdton_vor_hermes`,
(iii) `tonereignisse` (eigene Sprechspur ausgeklammert), (iv) `erste_agenten_silbe_ms`,
(v) `laengste_stille_ms`, (vi) `turn_luecken_ms[]`, (vii) `klang` (Bandanteil/Grundrauschen).
Jede Zahl ist entweder beziffert oder `{messbar:false, grund}` — nie eine stille 0.

Neue Dateien: `scripts/iel-mess-ohrzeuge.mjs` (Riegel/Kennzahlen, rein), `scripts/iel-mess-audio.mjs`
(WAV-Parser ohne neue Dependency: RIFF/PCM16/A-law/µ-law, Huellkurve, Stille-/Ton-Segmente,
Bandanteil via eigener FFT), `test/_iel-messbaum.mjs` (geteilter Test-Helfer, aus
`iel-b11-nachdeploy.test.js` extrahiert), drei neue Testdateien.

Bewusst NICHT gebaut: `record-from-ringing-dual` (U3 entschaerft, A-Bein-Mitschnitt reicht),
Loeschen der Anbieter-Aufnahmen im Skript (waere Anbieter-Schreibzugriff), Prod-DB-Zugriff aus dem
Skript (Fakten kommen als Vorlauf-Beleg herein), neue Env-Schluessel, jede Aenderung an `src/`.

Lead-Schritte (ausdruecklich NICHT Teil des Workflows): Telnyx-Lesebeleg der TeXML-Application,
`OHRZEUGE_ZIEL_PIN` setzen, Sprechspur rendern + Hash pinnen, Vorlauf-Beleg schreiben, Vorher-Lauf
mit befristetem Flag-Flip, Kalibrierungs-Urteil je Kennzahl.

---

## 2. Impl-Zusammenfassung

- headCommit: `8ffa127` (vor Fix-Runde), `nodeCheckPass`/`testsPass`: true, 6032/6032 Tests gruen,
  `npm run lint`: 0 Errors.
- Neue Dateien: `scripts/iel-mess-ohrzeuge.mjs`, `scripts/iel-mess-audio.mjs`,
  `tasks/iel-ohrzeuge-zaehler.json`, `test/_iel-messbaum.mjs`,
  `test/iep-p1-ohrzeuge-riegel.test.js`, `test/iep-p1-ohrzeuge-audio.test.js`,
  `test/iep-p1-ohrzeuge-lauf.test.js`.
- Geaenderte Dateien: `scripts/iel-mess.mjs`, `scripts/iel-mess-anbieter.mjs`,
  `scripts/iel-mess-belege.mjs`, `scripts/iel-mess.cases.json`, `test/iel-b11-nachdeploy.test.js`
  (nur Helfer-Extraktion, keine Assertion geaendert).
- 49 neue Tests in drei Dateien; Bestandssuite ohne geaenderte Assertion gruen.
- Smoke: Server auf Port 3999 (`SKIP_TWILIO_SIGNATURE_CHECK=true`), `/healthz` ok, `/voice/incoming`
  liefert unveraendertes Budget-Engine-Inbound-TeXML. `git diff --stat master -- src/ apps/
  render.yaml .env.example package.json` leer. `OZ-vorher --dry-run` -> "VERWEIGERT: Ziel-Pin nicht
  gesetzt", 0 fetch-Aufrufe, exit 2. `status` zeigt "Zaehler ohrzeuge: 0/18 Sperre: frei" neben
  unveraendertem m1 5/5 und nachdeploy 2/3.
- Ausgelieferter Zustand ist bewusst fail-closed und NICHT lauffaehig: `OHRZEUGE_ZIEL_PIN=""`,
  `OZ-vorher.ziel_e164=null`, `sprechspur_sha256=null`, Vorlauf-Beleg und Sprechspur-Datei fehlen im
  Commit.

### Deviations vom Plan

- `ohrzeugeVorlaufGrund` bekommt zusaetzlich `umgebung`/`jetztMs` (Tenant-Bindung + keine echte Uhr
  in reiner Funktion, P12).
- `ohrzeugeKennzahlen` nimmt `{mitschnitt, lauf}` statt fuenf Einzelfeldern (recording_started_at,
  laufId, unserBein zusaetzlich noetig).
- Zeitachse fuer (ii)/(iv) explizit definiert: Ton-Segmente vor/nach dem Annahme-Versatz
  (`call.answered` minus `recording_started_at`); fehlt der Zeitstempel, sind beide `messbar:false`.
- Kennzahl (vii) meldet ab Abtastrate < 16000 Hz "nicht messbar" (statt erst bei Nyquist <= 3000 Hz)
  — ein 8-kHz-Schmalbandmitschnitt misst sonst den Filterrand statt den Klang.
- Zusaetzlicher Gruppen-Haken `werteMitschnitt` (liefert fuer `ohrzeuge` null), um doppeltes
  Laden/STT-Senden derselben Aufnahme zu vermeiden (Kosten, G5).
- Riegel 3 nutzt `deniedPrefix` statt `isDenied`, weil der Verweigerungstext den Praefix nennen muss
  (dieselbe Quelldatei, keine Zweitwertung).
- Mehrere im Plan gelistete Symbole (`E164_STRIKT`, `STILLE_MIN_MS`, `nichtMessbar`,
  `STILLE_SCHWELLE_DBFS` u.a.) sind modul-privat statt exportiert, weil keine ausserhalb genutzt
  werden (G12).
- FFT-Helfer (`fft`/`schmetterling`/`addiereBlockSpektrum`) zu EINER Funktion `periodogramm`
  zusammengefasst statt aufgeteilt, weil eine Aufteilung `no-param-reassign` verletzt haette (waere
  eine neue abgeschaltete Sicherung gewesen).
- `BASIS_ENV` des geteilten Messbaums traegt zusaetzlich `OUTBOUND_FROZEN`,
  `ELEVENLABS_INBOUND_SCOPE`, `ELEVENLABS_INBOUND_TENANT_IDS` (BASE_ENV-Drift-Lehre).
- NICHT ausgefuehrt (Workflow-Verbot, Lead-Schritte): Telnyx-Lesebeleg, Pin setzen, Sprechspur
  rendern, Vorlauf-Beleg schreiben, Vorher-Lauf.

---

## 3. Safety-Urteil

**approved: true**, alle Kern-Flags true (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended),
**keine Blocker**.

Kernaussage: Diff fasst ausschliesslich `scripts/`, `test/`, `tasks/` an — kein `src/`, kein
`package.json`, kein `.env.example`, kein `render.yaml`, kein `apps/web`. Safety-Gates sind
unveraendert bzw. an einer Stelle erweitert (Notaus-Riegel dort, wo der direkte
`POST /v2/texml/calls` die outbound-gates.js-Kette umgeht, sonst haette der Kill-Switch dort eine
Luecke). Offenlegung, Auth, Secrets, Audio-nie-durch-MCP, Scope: alle unberuehrt/eingehalten.

Independent-Test: eigener Worktree, 77/77 Tests gruen (4 Dateien einzeln), `node --check` auf allen
fuenf geaenderten `scripts/`-Dateien ok, MD5 der Zaehlerdateien vor/nach Testlauf identisch, kein
Push, kein Netzdurchgriff (Fetch-Attrappe ohne Passthrough).

### Concerns (nicht blockierend, Auflagen an den Lead)

1. `sprechspur_nach_s` hat als einziges neues Zeitfeld keine Bereichspruefung (anders als
   `dial_timeout_s`/`eltern_auflegen_nach_s`); die 60-s-Grenze haelt trotzdem doppelt (Notaus 55s,
   Anbieter-TimeLimit 60s). Empfehlung fuer Folgephase: `pruefeSprechspurNachS` ergaenzen.
2. Der Vorlauf-Beleg ist eine vom Betreiber geschriebene Behauptung, keine Maschinenmessung — Lead
   muss die drei Werte (Kostendecke-Rest, SMS-Opt-in, private_number) vor jedem Messfenster wirklich
   an der Prod-DB ablesen.
3. Der Ohrzeugen-Weg umgeht bewusst `outbound-gates.js` (Land-Gate, Stundenlimit, per-Ziel-Deckel
   greifen nicht); kompensiert durch die vier Riegel, den 18er-Deckel und die 60-s-Stufen. Wichtig:
   das Ziel wird NICHT aus dem Nummern-Inventar abgeleitet.
4. Die Phase liefert bewusst nur die baubare Haelfte (Abnahmepunkte f/g/h/i offen) — Lead muss vor
   dem ersten echten Lauf `OHRZEUGE_ZIEL_PIN`, `sprechspur_sha256`, `ziel_e164` per reviewbarem
   Commit setzen.
5. Das Unterkommando `sprechspur` loest im Echt-Modus eine echte ElevenLabs-TTS-Anfrage aus (Geld) —
   im Workflow nicht gelaufen, aber bewusste Betreiber-Handlung.

Zusaetzliches Security-Review (separat, ebenfalls approved/PASS) nennt inhaltlich dieselben fuenf
Punkte plus: `tasks/iel-ohrzeuge-messung.jsonl` enthaelt einen 80-Zeichen-STT-Auszug (Nummern
maskiert) — gleiche Behandlung wie bestehende Ergebnisdateien, nicht committen.

---

## 4. Clean-Code-Audit

**blocker: false**, Gesamturteil PASS.

- **s1 (Blocker):** leer im finalen Audit (siehe Fix-Runden — der urspruengliche S1-Fund wurde in
  r1 behoben).
- **s2 (moderate Funde):** eine triviale Konstanten-Duplizierung — `"active"` (Telnyx-Nummernstatus)
  ist in `scripts/iel-mess-anbieter.mjs` und `scripts/iel-mess-ohrzeuge.mjs` je eigenstaendig als
  `KONTO_NUMMER_AKTIV` definiert statt einmal geteilt. Nicht blockierend: bewusst, weil
  `iel-mess-ohrzeuge.mjs` rein bleiben soll (kein Import von `anbieter.mjs`, das `src/config.js`
  zieht). Empfehlung: dritter seiteneffektfreier Konstanten-Ort.
- **s3 (positiv hervorgehoben):** durchgehend sprechende deutsche Namen mit
  Begruendungskommentaren (G16/G20); zeitliche Kopplung in `pruefeOhrzeugeVorAnruf` explizit
  dokumentiert (G31).
- **s4 (bewusste Ausnahme, dokumentiert):** `periodogramm()` bleibt bewusst eine Funktion
  (In-Place-Mutation eigener Puffer) statt in Helfer aufgeteilt — Lesbarkeits-Vorrang korrekt
  begruendet, kein Flag.

topTodos: `KONTO_NUMMER_AKTIV` optional konsolidieren; vor dem ersten echten Lauf
`OHRZEUGE_ZIEL_PIN`/`sprechspur_sha256` setzen (reiner Betriebsschritt, kein Code-Fix).

---

## 5. Fix-Runden

**r1:** Beide S1-Blocker der ersten Review-Runde behoben — sie beschrieben dieselbe Luecke von zwei
Seiten (REGEL-1-Verletzung bzw. ungebundene `gruppeFuer`/`pruefeAnrufFall`-Paarung): ein
`texml-ohrzeuge`-Fall haette unter der `m1`-Gruppe eingereicht werden und damit alle vier Riegel
umgehen koennen. Fix: neue Funktion `pruefeArtZaehlerPaarung` in `scripts/iel-mess.mjs`, aufgerufen
aus `gruppeFuer` (laeuft in `loeseEinstieg`, also **vor** jedem Netzzugriff) — erzwingt die
`art`/`zaehler`-Paarung symmetrisch in beide Richtungen, inklusive Verbot von `ziel_e164` ausserhalb
der `ohrzeuge`-Gruppe. Nach dem Fix (Branch `phase/iep-p1-ohrzeuge-fix1`, review-Branch
`review-iep-p1-r1`): beide finalen Audits (Safety + Clean-Code) **PASS**, keine weitere Fix-Runde
noetig.

---

## 6. Bewertung / offene Punkte fuer den Lead

Die Phase ist als reine Werkzeug-Erweiterung ohne Produktionsberuehrung sauber und mit hoher
Test-/Riegel-Qualitaet umgesetzt (Aufweich-Gegenproben, Positiv-Kontrollen mit bekanntem
Fremdton/Stille, `nicht messbar` statt stiller 0). Vor dem ersten echten Ohrzeugen-Lauf sind
folgende Lead-Schritte (nicht Teil dieses Workflows) noch offen:

1. Telnyx-Lesebeleg der TeXML-Application/Connection/Voice-Profile (Ringback, SDP-Angebotsliste).
2. `OHRZEUGE_ZIEL_PIN` (Skript) + `ziel_e164` (`OZ-vorher`) auf die gepinnte Mess-Tenant-DID setzen.
3. Sprechspur rendern (`node scripts/iel-mess.mjs sprechspur`), Hash in `sprechspur_sha256` pinnen.
4. Vorlauf-Beleg (`tasks/iel-ohrzeuge-vorlauf.json`) aus echter Prod-DB-Abfrage schreiben, nicht von
   Hand behaupten.
5. Vorher-Lauf mit befristetem `ELEVENLABS_INBOUND_ENABLED`-Flip, danach zuruecksetzen (Abnahmepunkt).
6. Kalibrierungs-Urteil je Kennzahl, Anbieter-Aufnahmen loeschen (Loeschbeleg), Grenz-Satz
   (on-net, kein deutscher Mobilfunk/Roaming/Transit) in den Abnahmebericht aufnehmen.
