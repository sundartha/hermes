# Phase IEP-P2 — Sofortannahme statt Klingeln

**Gate:** PASS
**finalBranch:** `phase/iep-p2-sofortannahme`
**headCommit:** `1fa226041d9e484cc73492531703615d32f52e13`

## Was die Phase tut

Der eingehende Anruf wird angenommen, BEVOR zu ElevenLabs gewaehlt wird, und die Luecke bis zur
ersten Agentensilbe traegt einen kurzen, von uns erzeugten Begruessungslaut.

**GRUND (belegt):** `answerOnBridge=true` liess das Anrufer-Bein 1,56 s unbeantwortet
(`src/elevenlabs/inbound-rueckfall.js:35`, `src/telephony/adapters/telnyx/render.js:172-177`); in
dieser Zeit hoerte der Owner Netz-Klingeln und eine fremde Roboteransage. Test #1 nahm sofort an —
dort trat beides nicht auf.

**OWNER-ENTSCHEIDUNG 10:** kurzer Begruessungslaut, NICHT Stille und NICHT Dauerton. Der alte
TeXML-Pflichtsatz kommt NICHT zurueck (Entscheidung 1). Fail-closed bleibt: scheitert die
Uebergabe, spricht der Fehlersatz auf dem bereits beantworteten Bein und legt auf. Keine Aenderung
am Outbound-Weg, keine Aenderung fuer nicht-gepinnte Tenants.

## Plan (gekuerzt)

Basis `master` (HEAD `9330640`). Autoritativ: `tasks/iep-strategie.md` Abschnitt IEP-P2, §1, §2.1–2.4,
§5, §6, §7 F4/F9, Owner-Entscheidungen 8–13. Kein Abschnitt „Offene Review-Concerns" in der
Strategie-Datei gefunden (0 Treffer) — adressiert ueber §6 Risiken, §7 F4a/F4b/F9.

**Tragende Planabweichung (bewusst, mit Beleg):** Die Strategie nahm an, die Fensterbesetzung
brauche ein Medien-Verb VOR dem `<Dial>` (unbelegte Annahme U2, harte Stopp-Regel bei
Nichtbelegung). Belegt wurde stattdessen: das Telnyx-Dial-Verb kennt `audioUrl` — „custom ringback
tone … while waiting for the call to be answered" (Telnyx-Doku, zitiert in
`tasks/iex-r1-eroeffnung.md`). Mit `audioUrl` AM `<Dial>` bleibt das Dial das erste Verb (keine
Verschiebung), der Anbieter-Freiton wird ERSETZT statt ergaenzt, und U2 samt Stopp-Regel wird
gegenstandslos statt umgangen. Alle drei harten Bedingungen der Strategie (kein Freiton/Netzansage,
keine konkurrierende Sprache, statisches Asset ohne Parameter/neue Route) bleiben erfuellt.

Verworfen und im Bericht festgehalten: `ringTone` (Default ist der US-Doppelton aus Test #1),
`<Play>` vor dem Dial (verschiebt den Dial), Call-Control-`playback_start` parallel (zusaetzlicher
Anbieter-Roundtrip), Rueckkehr des TeXML-Pflichtsatzes.

**Preis, bewusst akzeptiert:** die Schreibweise von `audioUrl` ist nur doku-belegt, nie am Konto
gemessen. Fehlschlag ist fail-soft und exakt der Schalter-Aus-Zustand (US-Freiton, kein Abbruch,
kein Gate beruehrt).

Geplante Bausteine: neues Asset `public/brand/hermes-begruessungslaut.wav` (vorab gerendert, ueber
den bestehenden `public/`-Static-Mount, keine neue Route); Rezept-Skript
`scripts/render-begruessungslaut.mjs` (rein, byte-genau reproduzierbar statt Blindgaenger-Binary);
neues Feld `ringbackAudioUrl` an `dialSip` (Direktiven-Ebene, provider-neutral) → Renderer-Attribut
`audioUrl` im Telnyx-Adapter; AN/AUS-Schalter `ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED`
(Default an) in `src/config.js`, entschieden im Aufrufer (`routes/voice.js`), damit
`inbound-rueckfall.js` config-frei bleibt; Tests `IEP-P2-1..9` (Direktiven/Renderer) und
`IEP-P2-A1..A6` (Asset/Rezept/Auslieferung/Env-Kohaerenz).

## Impl-Zusammenfassung

15 Dateien geaendert/neu, +616/-68, committet auf `phase/iep-p2-sofortannahme` (`1fa2260`).

**Verhaltensaenderung, nur auf dem EL-Inbound-Pfad:** `<Dial>` traegt kein `answerOnBridge` mehr
(`EL_DIAL_ANSWER_ON_BRIDGE = false`) → beantwortet das eingehende Bein sofort; waehrend der
Dial-Wartezeit laeuft ueber `audioUrl` der eigene, sprachlose Begruessungslaut statt des
US-Freitons. `ringTone` wird bewusst nie gesetzt (Default = 440/480-Hz-Doppelton).

**Asset:** 8 kHz mono, 700 ms hoerbar (D5→A5, ~-11 dBFS), 1,8 s Nachlauf-Stille → erste
Ringback-Wiederholung erst bei 2,5 s (hinter dem EL-Annahmefenster 0,7–0,9 s), keine
Freiton-Frequenz. Aus reinem Rezept erzeugt, byte-genau nachpruefbar (`IEP-P2-A1`).

**Neue Dateien:**
- `scripts/render-begruessungslaut.mjs`
- `public/brand/hermes-begruessungslaut.wav`
- `test/iep-p2-begruessungslaut.test.js`

**Geaenderte Dateien:**
- `src/elevenlabs/inbound-rueckfall.js` (Flag-Flip + Kommentar, `EL_BEGRUESSUNGSLAUT_PFAD` +
  `elBegruessungslautUrl`, `begruessungslautUrl`-Parameter an `elUebergabeDirektiven`)
- `src/telephony/directives.js` (`ringbackAudioUrl`-Feld an `dialSip`)
- `src/telephony/adapters/telnyx/render.js` (`ringbackAudioAttr`, Attributzeile im Dial)
- `src/routes/voice.js` (`sendElUebergabe`: `zugang`→`elInbound` umbenannt, AN/AUS-Entscheidung
  hier)
- `src/config.js` (Schalter `begruessungslautEnabled`, Boot-Riegel bei fehlendem Asset)
- `.env.example`, `render.yaml`, `PLAN-SECURITY.md` (vier Stellen nachgezogen)
- `test/helpers.js` (`BASE_ENV`-Pin, `quelltexteUnter`-Helfer geteilt statt dupliziert)
- `test/iex-a4-answer-on-bridge.test.js` (gedreht auf Sofortannahme, wie im eigenen Dateikopf
  vorgesehen)
- `test/iel-dial-render.test.js`, `test/iel-b8-weiche.test.js` (minimal angepasst)

**Rueckwege (zwei, unabhaengig):** `ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED=false` (nur
Fuellung aus, ein Env-Wert) und `EL_DIAL_ANSWER_ON_BRIDGE = true` (Sofortannahme aus, eine
Code-Zeile + Deploy). Zweite Linie unveraendert: `ELEVENLABS_INBOUND_ENABLED=false`.

**Smoke (Kindprozess, PORT=0, Temp-DATA_DIR, gueltige Telnyx-Signatur):** `POST /voice/incoming` →
200, TeXML startet `<Dial audioUrl="https://agent.test/brand/hermes-begruessungslaut.wav"
callerId=…>`, kein `answerOnBridge`, kein `<Say>/<Play>/<Gather>`, `<Redirect>` unveraendert
dahinter. Asset-Auslieferung `GET /brand/hermes-begruessungslaut.wav` → 200, `audio/wav`, 40044
Bytes, ohne Auth. Boot-Riegel gegengeprueft (Asset weg → Boot-Abbruch mit Klartextmeldung; Asset
zurueck → Start ok). Regeneration idempotent (`node scripts/render-begruessungslaut.mjs` zweimal →
Datei unveraendert).

**Testergebnis (committeter Stand):** `npm test` → 6070 pass, 0 fail. `npm run lint` → 0 errors.

### Deviations

- **Planabweichung (begruendet, s.o.):** `audioUrl` am `<Dial>` statt Medien-Verb davor; U2 und
  die Stopp-Regel aus Schritt 3 sind gegenstandslos statt umgangen.
- **Zusatz (G5-Pflicht):** Grep-Helfer `quelltexteUnter` aus `test/iel-b8-weiche.test.js` nach
  `test/helpers.js` verschoben, weil `IEP-P2-5` zweiter Nutzer ist — sonst waere es eine
  woertliche Kopie (S2).
- **Ermessenspunkt umgesetzt:** Boot-Riegel bei fehlendem Asset (Muster `WEB_DIST_DIR`-Build), am
  laufenden Server gegengeprueft.
- **Nicht bewiesen, braucht den Ohrzeugen-Nachher-Lauf des Leads:** (a) dass die fremde
  Roboteransage verschwindet — sie entsteht nach Messlage eher vor Telnyx; die Phase verkuerzt das
  Fenster und besetzt den Rest, loescht aber keine fremde Ansage. (b) dass Telnyx `audioUrl` in
  diesem Konto wirklich annimmt (Kennzahl: `playback_start` zeigt unsere URL statt
  `tone_stream://`). (c) U1: dass der Anbieter-Default sofort annimmt — alle M1-Messungen liefen
  auf bereits beantworteten Beinen. (d) M-S2/Stille-Zahlen.
- **Offene Owner-Punkte, sperren die Auslieferung (nicht den Bau), muessen VOR dem Nachher-Lauf
  feststehen:** F4a (Stille-Schwelle, Vorschlag 300 ms) und F4b (Freigabe von Klang, Dauer,
  Lautstaerke — hier umgesetzt: 700 ms hoerbar, ~-11 dBFS, D5→A5, 1,8 s Nachlauf-Stille).
- **IEP-P0-Ausgang (A/B/C) im Repo nicht hinterlegt** (`tasks/iep-p0-delta.md` enthaelt nur
  Delta-Tabelle/Verdaechtige, keinen Hoerbeleg am Hoerer). Der Bau ist in allen drei Ausgaengen
  identisch, die VERKAUFSFORMEL nicht. Bis der Ausgang schriftlich vorliegt: Phase als
  Hygiene-Phase fuehren, nicht als Antwort auf die Ansage.
- **Kalibrierungs-Urteil aus IEP-P1 Schritt 9 fehlt weiterhin.** Abnahme (b)
  (`call_initiated`→`call_answered` unter 0,8 s) gilt nur, wenn die Kalibrierung diese Kennzahl als
  tauglich ausweist.
- **Rollout-Gate (nicht Owner-Test-Gate), in `PLAN-SECURITY.md` eingetragen:** eine in der
  Wartephase abgebrochene Zustellung erzeugt jetzt eine real abgerechnete Traegerminute. Anteil
  vor dem Rollout aus `detail_records` beziffern; ist er nennenswert, `EL_DIAL_RING_TIMEOUT_S`
  senken. Umgekehrt entschaerft die Umstellung den Bestandsbefund „`answeredAt` vor der
  Traeger-Annahme".
- **Testbank-Flake (Bestandsverhalten, kein Befund dieser Phase):** zwei von fuenf Volllaeufen
  zeigten je einen roten Test, beide isoliert gruen, beide auf unberuehrtem Code (Lehre
  `sec-testbank-parallel-race`).
- **Keine Produktionshandlung:** kein Anruf, kein Flag-Flip, kein Push, kein Deploy, keine
  Aenderung an EL-Agent/Telnyx/Render-Env, kein Schreiben in Zaehlerdateien.

## Safety-Urteil

**PASS.** Alle absoluten Regeln gehalten. Unabhaengige Testlaeufe des Reviewers: 5 Laeufe, Exit 0,
784 pass / 0 fail.

- **Safety-Gates unangetastet:** die sieben Sicherungen in `/voice/incoming` (Signatur-MW,
  Wiederholungs-Riegel, Nummern-Aufloesung, Kostendecke, Notbremse, Cap/Geld-Wache,
  set-once-Kostenprofil) laufen zeilengleich vor der Uebergabe. `timeLimitS` kommt weiter aus
  `callMaxDurationMs`. Pro-Tenant-Decke, Denylist/Land-Gate/Stundenlimit, Verifikations-Permit,
  `OUTBOUND_FROZEN` nicht beruehrt. `dialSip()` hat genau einen Aufrufer — der Outbound-Pfad sieht
  die Aenderung nicht.
- **Offenlegung unangetastet:** `claude.js`/`disclosureSentence` nicht im Diff. Kein Sprech-Verb im
  Uebergabe-TeXML (`IEP-P2-3` pinnt es in beiden Varianten). Fuellung ist reiner Zweiklang, keine
  Sprache, konkurriert nicht mit der Offenlegung.
- **Auth fail-closed:** kein neuer Endpunkt, kein `route-policy.js`-Eintrag noetig — Asset laeuft
  ueber bestehenden `public/`-Mount, `route-auth-inventory` bleibt gruen.
- **Secrets:** keine. SIP-Passwort behaelt seine eine Lesestelle trotz Umbenennung. URL laeuft
  durch `escapeXml`.
- **Scope:** 15 Dateien, alle IEP-P2, keine neue Dependency.

**Concerns (nicht blockierend, an den Lead):**
1. Boot-Riegel (`REQUIRED_CONFIG`-Eintrag „Begruessungslaut-Asset") ist breiter als noetig — hängt
   NICHT an `ELEVENLABS_INBOUND_ENABLED`, verweigert also bei fehlendem Asset den gesamten Boot
   (alle Tenants, beide Richtungen), obwohl der geschuetzte Fall selbst fail-soft ist (Telnyx faellt
   auf seinen Freiton zurueck). Billigste Haertung: `&& config.voice.elevenLabsInbound.enabled` im
   `fehlt()`-Praedikat.
2. Ob Telnyx `audioUrl` in diesem Konto wirklich ehrt, ist doku-belegt, aber ungemessen — faellt es
   negativ aus, landet man im von der Strategie ausdruecklich verbotenen Zustand „Sofortannahme
   ohne Fuellung"; dann NICHT ausliefern.
3. U1 bleibt bis zum Nachher-Lauf unbelegt.
4. Geld-Delta bewusst und dokumentiert (Traegerminute bei Abbruch in der Wartephase) — Decke wird
   dadurch nicht geschwaecht, sondern bucht konservativer.
5. Kleinigkeit (Clean-Code, kein Safety-Befund): `EL_BEGRUESSUNGSLAUT_PFAD` wiederholt das Literal
   `/brand`, obwohl `BRAND_ASSETS_PREFIX` in `src/mcp-server-info.js` bereits existiert.
6. Keine Produktionshandlung feststellbar.

## Clean-Code-Audit (S1–S4)

**Blocker:** keine (leere S1/S2/S3/S4-Listen). **Verdict:** PASS.

- Env-Schalter konsistent in `config.js`/`.env.example`/`render.yaml`/`BASE_ENV`, gegen Drift
  abgesichert (`IEP-P2-A6`).
- Begruessungslaut ist reproduzierbares Rezept, kein Blindgaenger-Binary — byte-genauer
  Regenerations-Test plus Spektral-/Kadenz-Pruefung mit Positiv-Kontrollen (Lehre
  `pruefkommando-ohne-positiv-kontrolle`). Alle Magic Numbers benannt (G25).
- `directives.js`/`render.js` sauber erweitert, Provider-Name (`audioUrl`) bleibt im Adapter
  gekapselt (Muster `answerOnBridge`/`voiceAttrs`); Renderer fail-soft bei non-String/leer,
  TeXML byte-identisch bei Fuellung aus (`IEP-P2-4`/`IEP-P2-7`).
- `inbound-rueckfall.js` bleibt config-frei; AN/AUS-Entscheidung faellt im Aufrufer
  (`routes/voice.js`) — sauberer Seam.
- Duplizierter Test-Helfer `quelltexteUnter` nach `test/helpers.js` verschoben statt zweite Kopie
  (G5).
- Neuer Boot-Riegel verhindert stille Regression bei fehlendem Asset, im Muster des bestehenden
  `WEB_DIST_DIR`-Riegels.
- Kein neuer Express-Route noetig, daher zu Recht kein `route-policy.js`-Eintrag.
- Umbenennung `zugang`→`elInbound` in `routes/voice.js` mit Kommentar begruendet.
- `PLAN-SECURITY.md` konsequent nachgezogen: Buchungs-Vorlauf-Befund gedreht, M-S3 als
  erledigt/entfallen markiert, neues ungemessenes Element U1 benannt statt verschwiegen.

**Top-Todos:** vor Rollout auf alle DIDs U1 messen sowie die Klingelphasen-Abbruchquote aus
`detail_records` beziffern — im Diff bereits als Rollout-Gate benannt, kein Merge-Blocker. Kein
Code-Fix noetig.

## Security-Review (final)

**Verdict:** PASS — keine Sicherheitsluecke, kein Gate geschwaecht. Blocker: keine.

Gepruefte Punkte: keine neue oeffentlich erreichbare Route (Asset ueber bestehenden
`express.static`-Mount, kein Auth-Gate davor, `route-auth-inventory`/`security.test.js` gruen,
kein Path-Traversal, kein Laufzeit-Schreibpfad nach `public/`); alle sieben Sicherungen in
`/voice/incoming` unveraendert vor der Uebergabe; Offenlegung unberuehrt, kein Sprech-Verb im
Uebergabe-TeXML in beiden Varianten, `ringTone` nie gesetzt; keine Injection (URL laeuft durch
`escapeXml`, positiv getestet), keine Anrufer-steuerbare Audio-Quelle (URL stammt aus
`config.server.publicUrl`, nicht aus Request-Headern), kein Secret-Leak, kein
Tenant-Verwechslungspfad; kein Namenskonflikt mit dem TTS-Pfad (`renderDialSip` liest
ausschliesslich `directive.ringbackAudioUrl`); Fail-Richtung des Renderers getestet (fehlend/leer/
false/Zahl/null → byte-gleich); Env fail-closed (`boolEnv`); kein Import-Zyklus (alle transitiven
Importe von `inbound-rueckfall.js` geprueft, keiner zieht `config.js`); keine neue Dependency; keine
Produktionshandlung im Diff.

**Concerns (nicht blockierend):**
1. Kosten: `EL_DIAL_ANSWER_ON_BRIDGE=false` erzeugt bei abgebrochenen Anrufen in der Wartephase
   eine real abgerechnete Traegerminute (vorher nur Buchungs-Vorlauf). Kein Gate geschwaecht
   (pro-Tenant-Kostendecke sperrte Inbound schon vorher, unveraendert weiter). Rollout-Gate in
   `PLAN-SECURITY.md` eingetragen (Klingelphasen-Abbruchquote aus `detail_records`); muss vor
   Ausweitung ueber den einen gepinnten Tenant hinaus gezogen werden.
2. Verfuegbarkeit/Radius: Boot-Riegel haengt nur an `begruessungslautEnabled` (Default true), nicht
   an `ELEVENLABS_INBOUND_ENABLED` — ein fehlendes Asset verweigert den Boot des gesamten Dienstes,
   nicht nur des EL-Pfads. Fail-closed, Datei repo-committet und gepinnt, Radius trotzdem groesser
   als das Feature.
3. Fragile Naht: Kommentar ueber dem neuen Import in `src/config.js` nennt 4 Module, tatsaechlich
   importiert `inbound-rueckfall.js` 7 (transitiv geprueft, kein Zyklus) — aber die Naht ist jetzt
   zyklusempfindlich und ungetestet; ein kuenftiger `config.js`-Import in eines der Module erzeugte
   stille Degradation eines Safety-Gates.
4. Betriebsmodus: `ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED=false` ergibt exakt den Zustand
   „Sofortannahme ohne Fuellung", den die Strategie als Auslieferungsstand ausdruecklich
   ausschliesst — korrekt als Rueckweg dokumentiert, darf aber nicht als normaler Betriebsmodus
   behandelt werden.

## Fix-Runden

Keine. Safety, Clean-Code-Audit und Security-Review kamen alle direkt auf PASS ohne Blocker; keine
Fix-Runde noetig.
