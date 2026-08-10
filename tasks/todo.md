# Offene Arbeit, Stand 2026-08-10

Regel: jeder Punkt traegt sein **erwartetes Ergebnis** und seine **Verifikationsmethode**
(`.claude/refs/workflow.md`, Regel 7). Nur Gemessenes; Vermutungen sind markiert.

---

## 1. SOFORT: Dead-Air-Fix deployen und abnehmen

Der Fix ist gemergt (`95bf1f2`), auf `origin` UND `upstream` gepusht, **aber nicht live**.
Render deployt `upstream` mit `autoDeploy: no` — es braucht den manuellen Deploy im
Dashboard.

**Was er behebt:** Der Dead-Air-Waechter mass "Sekunden ohne Shim-Turn", und ein Shim-Turn
entsteht nur, wenn der ANRUFER spricht. Redete der Agent laenger als 45 s am Stueck, hielt
der Waechter die aktive Leitung fuer tot und legte auf. Live reproduziert am 10.08.
(`call_msn34lpf77wg`, 86,05 s, `hangup_source=caller`; Owner-Gegenprobe: Abbruch bei der
gesprochenen Zahl 70).

**Erwartetes Ergebnis:** Ein Anruf, in dem der Agent laenger als 45 s am Stueck spricht,
laeuft weiter.

**Verifikationsmethode:** Testanruf mit Zaehl-Auftrag (Vorlage: der Briefing-Text von
`call_msn34lpf77wg`). Danach in der DB `answered_at -> ended_at` messen: deutlich ueber 86 s,
und im Render-Log **keine** `[telnyx-watchdog] dead_air`-Zeile, solange der Agent spricht.

---

## 2. 91-Sekunden-Kappung — beim Telnyx-NOC, nichts mehr zu messen

**Geklaert:** Das BYE kommt vom deutschen Ziel-Carrier (`hangup_details=recv_bye`, von Telnyx
bestaetigt), Muster konsistent mit einem nicht aufgefrischten 90-s-Session-Timer nach
RFC 4028. **In unserem Code nicht behebbar.** Vollstaendiger Befundstand mit 12
ausgeschlossenen Kandidaten: `tasks/91s-kappung-befunde-2026-08-10.md`.

**Offen:** Support-Ticket an support@telnyx.com (Text steht im Chat-Verlauf der Session vom
10.08., 2504 Zeichen, mit allen 13 Session-IDs und 6 Gegenbeispielen). Der Fall ist beim NOC
in der Warteschlange.

**Billiger Eigen-Test, unabhaengig vom NOC:** ein Anruf auf eine ANDERE deutsche Nummer
(anderes Netz oder Festnetz). Kappt der auch bei ~91 s, ist es nicht carrier-spezifisch.
Laeuft er durch, ist eine +49-Absender-DID die naheliegende Abhilfe.

---

## 3. Zusammenfassungs-SMS scheitert bei JEDEM Anruf

`[sms] Telnyx sendSms fehlgeschlagen: HTTP 400 (40305 Invalid 'from' address)` — im Log am
10.08. bei beiden Anrufen belegt. Der Owner bekommt nach keinem Anruf eine Zusammenfassung.
Eindeutig unsere Seite, unabhaengig von allem anderen.

**Vermutung, ungeprueft:** die Absendernummer ist nicht SMS-faehig oder das Land passt nicht.
**Erst messen, dann fixen** — die Fehlermeldung nennt Twilio, der Dienst laeuft aber auf
Telnyx (die Meldung selbst ist also schon irrefuehrend).

**Erwartetes Ergebnis:** nach einem Anruf trifft eine Zusammenfassungs-SMS ein.
**Verifikationsmethode:** Testanruf, danach Log ohne `sendSms fehlgeschlagen` + SMS auf dem
Geraet.

---

## 4. `silenced` verwirft ganze fertige Antworten (GQ-P18)

Seit dem 10.08. belegt (beide Anrufe je einmal). Eine vollstaendig generierte Antwort wird
verworfen, `agentTurn` liefert `speech:""`, der Transkript-Eintrag entfaellt — fuer den
Anrufer eine Runde komplette Stille.

**Wurzel am Code belegt:** GQ-P18 stellte `speakChunk` von direktem Schreiben auf Puffern um;
dadurch bleibt `wire.chunkCount()` bis zur Freigabe 0 und der `ALREADY_SPOKEN`-Schutz greift
nicht. Das Verwurf-Fenster waechst von ~0 ms auf bis zu `TELNYX_SHIM_EXTEND_HOLD_MS` (3000).

**Owner-Entscheidung 10.08.: die Sperre bleibt an.** Die Notbremse `=0` beseitigt `silenced`
nachweislich, holt aber den Doppelantwort-Defekt zurueck — **kein Env-Wert vermeidet beide**.
Ein sauberer Fix braucht Code; vier Optionen sind skizziert (stumm verwerfen / ganz sprechen /
nur den gepufferten Teil / Ueberbrueckungssatz). Die Wahl ist eine Owner-Entscheidung.

---

## 5. Kleinere offene Punkte

- **`number.country` fuer `+18643028341` (Tenant `owner`) steht auf `DE`** — es ist eine
  US-Nummer. Reiner Datenfehler.
- **GQ-P2/P7** (Consult-Fristen, Zustellfenster) brauchen einen Anruf **mit echter
  Rueckfrage**. Am 10.08. gescheitert: `get_consult` war angeboten, der Agent waehlte es nie
  (bekannter Werkzeugwahl-Defekt der AL-D3-Klasse, NICHT die Consult-Mechanik).
- **GQ-P3/P6** brauchen einen **eingehenden** Anruf.
- **Prompt-Caching:** nur 2 von 7 LLM-Aufrufen treffen den Cache (gemessen 09.08.), der
  gebuchte Betrag liegt dadurch nur 8,44 % unter dem ungecachten. Wurzel am Code belegt:
  `systemPrompt` traegt veraenderlichen Per-Call-Zustand, `agentTools` nimmt Werkzeuge mitten
  im Call auf und heraus — das "stabile Praefix" ist nicht stabil. Eigene Phase.
- **Satzzeichen-Regression seit nova-3**: der erkannte Anrufer-Text erreicht das Sprachmodell
  zu **0 %** mit Satzzeichen/Grossschreibung (vorher unter `flux`: 93–97 %), zwei unabhaengige
  Quellen, n=50. `smart_format` ist als Fix **doppelt ausgeschlossen** (im Call-Schema nicht
  vorhanden; am Modell wirkungslos). Verbleibende Hypothese: der Pro-Call-Block ersetzt die
  `transcription` des Assistant-Objekts. **Erwartetes Ergebnis:** ein Call ohne
  Pro-Call-`transcription`-Block traegt wieder Satzzeichen. **Verifikationsmethode:** ein
  Testanruf mit reversiblem Schalter, danach `transcript_segment` auszaehlen.
  Vollstaendiger Befundstand + benanntes Risiko: `tasks/gq-chain-state.md`, Abschnitt
  "Satzzeichen-Regression seit nova-3". **Unbelegt bleibt, ob es dem Gespraech schadet.**
- **GAP-15** (2 rote Gates): englische Rechtstexte fehlen. **Rechtstexte nicht auf eigene
  Faust schreiben** — Owner fragen.
- Offene Punkte der laufenden Gespraechsqualitaets-Kette: `tasks/gq-chain-state.md`.

---

## Erledigt am 2026-08-10

- **Dead-Air-Defekt gefunden, reproduziert und behoben** (`95bf1f2`): der Waechter vertagt
  sich jetzt um die geschaetzte Sprechdauer, statt mitten in die Antwort zu kappen. Der
  Kosten-Notaus bleibt vollstaendig (T13 pinnt ihn). Suite 4148/4148.
- **91-Sekunden-Kappung als Carrier-Problem geklaert** und vom Anbieter bestaetigt — zuvor
  12 eigene Kandidaten mit Belegen ausgeschlossen.
- **Beide Sachverhalte sauber getrennt.** Sie erzeugen am Telefon dasselbe Erlebnis und
  liefen eine Session lang unter einem Label — die wiederkehrende Falle dieses Projekts.
- Repo aufgeraeumt: 74 -> 1 Branch (14 ungemergte als `archiv/2026-08-10/*` getaggt, nichts
  verloren), alle Worktrees entfernt, `origin` und `upstream` auf demselben Stand.
- **`smart_format`-Phase abgesagt, bevor eine Zeile Produktivcode entstand.** Vier Messungen
  (OpenAPI-Schema, WS-Replay-Bank A/B, Produktionstext flux vs. nova-3, Live-Assistant-Versionen)
  haben den geplanten Fix widerlegt und den Befund gleichzeitig geschaerft. Kein Testanruf noetig.
- **WS-Replay-Bank committet** (`d9c95f8`, `scripts/stt-wer.mjs --live-stt`): STT-Kandidaten
  sind damit ohne Testanruf messbar — auch der noch ungemessene `reson8/turns`. Sie existierte
  seit dem 06.08. nur als Prosa im Kettenstand.
