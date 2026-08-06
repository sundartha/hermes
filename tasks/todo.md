# B-7 — Der Agent versteht den Menschen am Telefon nicht

Auftrag aus `tasks/kickoff-kauderwelsch-2026-08-07.md`. Regel: nur Gemessenes; jede Aussage
traegt einen Beleg oder ist als **unbelegt** markiert.

## Schritt 1 — Die Weggabelung: Audio oder Erkennung? **ERLEDIGT, entschieden**

**Erwartetes Ergebnis (vorab formuliert):** eine unabhaengige Transkription des isolierten
Gegenstellen-Kanals ist entweder ebenfalls Salat (-> Audio-Weg ist die Wurzel) oder sauber
(-> Erkennung ist die Wurzel).

**Verifikationsmethode:** Dual-Channel-Aufnahme von Telnyx holen, Kanal L (Gegenstelle) mit
`ffmpeg` isolieren, mit einem zweiten, unabhaengigen Erkenner abschreiben, Wortfehlerrate
gegen Telnyx' eigenes Gespraechsprotokoll rechnen.

**Ergebnis, gemessen:** Die Aufnahme ist sauber. Beleg in
`data/evidence/stt-wer-2026-08-06/befund.md` (gitignored, bleibt lokal).

| Messung | WER |
|---|---|
| Telnyx `deepgram/flux` + `de`, Anruf 1 (`call_mshb9v7btbsp`) | **21,8 %** |
| Telnyx `deepgram/flux` + `de`, Anruf 2 (`call_mshbrhnc7nfp`) | **45,7 %** |
| Kontrolle: Referenz-Erkenner gegen bekannten Agententext | 4,3 % / 5,7 % |

Das sind die **Vorher-Werte**. Jede kuenftige Konfiguration wird gegen sie gemessen.

## Schritt 2 — Hypothesen-Landkarte: Urteile

| # | Hypothese | Urteil |
|---|---|---|
| H1 | Audio-Weg verstuemmelt (US-DID, Transcoding, Paketverlust) | **widerlegt** — ein zweiter Erkenner holt aus demselben (verlustbehafteteren) 8-kHz-MP3 94-96 % der Woerter zurueck |
| H2 | STT-Modell ungeeignet fuer Deutsch (`deepgram/flux`) | **BESTAETIGT — das ist die Wurzel.** flux liefert auf deutschem Telefon-Audio englischen Kauderwelsch (97,0 % / 95,7 % WER) und ignoriert den Sprach-Hint (`de` und `multi` byte-identisch). `nova-3` auf denselben Aufnahmen: 18,8 % / 12,9 % |
| H3 | STT-Konfiguration unvollstaendig (`keyterm`, `smart_format`, `numerals` = `null`) | **hinfaellig** — `smart_format`/`numerals` gelten laut Doku fuer Deepgram AUSSER flux; mit dem Wechsel auf nova-3 stehen beide auf `true`. `keyterm` bleibt ein ungenutzter Hebel fuer spaeter |
| H4 | Eager-EOT schneidet Aeusserungen ab | **widerlegt am Beleg, den ich zuerst falsch gelesen hatte** — zwischen *"Du bist"* und *"ein Idiot"* liegen **2,0 s echte Pause**. Die Turn-Trennung war korrekt; *"ein Idiot"* -> *"Anil Jones"* ist reiner Erkennungsfehler |
| H5 | Sprachmischung kippt das Modell | **widerlegt als Erklaerung** — *"What the fuck"* wurde korrekt erkannt; der Salat steht rundherum |
| H6 | Aufnahmesituation der Gegenstelle | **widerlegt** — derselbe Kanal ist fuer den Referenz-Erkenner sauber |
| H7 | Fehler konzentriert am Anfang der Aeusserung | **teilweise** — erste drei Woerter 39 % Fehler (14/36), Rest 24 % (37/155); erhoeht, aber nicht die Erklaerung |
| H8 | Kurze Aeusserungen sind schlechter | **widerlegt als alleinige Erklaerung** — <=6 Woerter: 33 %, laenger: 32 % |

| H9 | Barge-in: die Live-Strecke verliert den Anfang, wenn der Mensch dem Agenten ins Wort faellt | **widerlegt** — Beginn waehrend Agentenrede 31 % mittlere WER, Beginn in Stille 33 % |
| H10 | Die Erkennung hoert den Agenten mit (Echo/Mischung) | **widerlegt** — beide Kanaele gemischt durch dieselbe Engine liefert saubere Transkripte BEIDER Sprecher, keinen Salat |

## Schritt 3 — Der Hebel: `deepgram/flux` -> `deepgram/nova-3` **UMGESETZT, Abnahme offen**

Owner-Entscheidung 2026-08-06: nova-3 setzen, danach ein Testanruf an die Owner-Nummer,
normal gesprochen (nicht ueberdeutlich, kein Skript).

Der Wechsel ist **kein reiner Konfigurations-Schalter**: das Modell geht bei JEDEM Anruf mit
(`transcriptionFields` in `src/telephony/adapters/telnyx/voice.js`). Geaendert wurden daher
beide Stellen — die Konstante `STT_MODEL` im Adapter und das Assistant-Objekt.

**Erwartetes Ergebnis:** die WER des Testanrufs liegt deutlich unter 21,8 % / 45,7 % und in
der Naehe der Bank-Werte (12,9 % / 18,8 %). Der Agent spricht keine erfundenen Namen aus.

**Verifikationsmethode:** `node scripts/stt-wer.mjs <call_session_id>` nach dem Anruf.

**Zusaetzlich zu beurteilen (nicht die WER):** das Gespraechs-Timing. `eot_threshold`,
`eager_eot_threshold` und `eot_timeout_ms` sind flux-only; mit nova-3 bestimmt Telnyx die
Turn-Grenzen selbst. Faellt der Agent haeufiger ins Wort oder wartet er spuerbar laenger, ist
das eine Folge dieses Wechsels und gehoert in die Abnahme.

**Rueckweg:** ein `PATCH` auf das Assistant-Objekt plus ein Revert der Konstante.
Snapshot vorher: `data/evidence/telnyx-config/assistant-snapshot-2026-08-06-vor-nova3.json`.

## Nicht vergessen

- Aufnahmen liegen NUR im Scratchpad, nie im Repo, nach Gebrauch loeschen (Absolute Regel 5).
- Eine Messung gilt nur fuer die Konfiguration, in der sie erhoben wurde.
- Nach B-7: P2 (Modellwechsel Haiku -> Sonnet, A/B), danach P3 (Persona/Identitaet).
