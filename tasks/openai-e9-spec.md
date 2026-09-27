# E9 - Rechtstexte und Datenschutz-Abgleich (Implementierungs-Spec)

**Grundlage:** `tasks/openai-fix/S7-rechtstexte.md` (Ermittlung, alle Belege dort),
`PLAN-OPENAI.md` Etappe 9.
**Zielstand:** `master` @ `b901f4a`. Alle Ist-Angaben sind an diesem Stand gemessen.
**Blocker, die fallen sollen:** P0-3 (soweit ohne Owner-Lieferung moeglich), P0-9 vollstaendig;
angrenzend die Text-Haelfte von P1-39. Anforderungs-IDs O-6, O-7.

> ## WARNUNG - vor jeder Veroeffentlichung
>
> Diese Spec laesst einen Rechtstext entstehen, der **beschreibt, was der Code tut**. Sie ist
> **keine Rechtsberatung**, und der Umsetzer ist kein Anwalt. Der fertige Text MUSS vor der
> Veroeffentlichung vom Owner geprueft werden - insbesondere Drittlandsuebermittlung,
> Auftragsverarbeitung und die Angaben nach Paragraph 5 DDG. Der Selbst-Hinweis im Text
> (`privacy.de.json`, Abschnitt "Hinweis zu diesem Text") bleibt deshalb wortgleich stehen.
> **Merge dieser Etappe ist NICHT Veroeffentlichung**: das Live-Schalten der Website ist ein
> eigener, bewusster Owner-Schritt (`docs/RUNBOOK-LAB-LIVE.md`).

Diese Spec ist so geschrieben, dass sie ohne Rueckfrage abgearbeitet werden kann. Wo etwas offen
bleibt, steht es unter OWNER-EINGABE oder UNKNOWN; dort wird die Leerstelle **sichtbar stehen
gelassen**, nicht gefuellt.

---

## 0. Bindende Vorgaben (entschieden, NICHT neu aufrollen)

1. **`LLM_PROVIDER` = `deepseek`** (Owner-Angabe 2026-09-20). `render.yaml:384-385` sagt
   `anthropic` und ist VERALTET (dashboard-managed, `render.yaml:13-16`). Der Blueprint-Wert wird
   in dieser Etappe **nicht** geaendert - er ist Referenzdoku, keine Live-Quelle, und ein Flip
   dort waere eine Konfig-Aenderung, die niemand beauftragt hat.
2. **Empfaenger werden bedingungslos genannt** (S7/D1). Kein Satz der Form "derzeit abgeschaltet /
   nicht aktiv" ueber einen Schalter, der dashboard-verwaltet ist. Der Zweck wird statt dessen an
   die Funktion gebunden: "wenn <Funktion> fuer dein Konto aktiv ist, geht <Datenart> an <X>".
3. **ElevenLabs ist die Gespraechs-Plattform**, nicht "Sprachsynthese" (S7/D2, Belege E3/E4).
4. **Beide eigenen Sprachmodell-Anbieter werden genannt** (S7/D3): DeepSeek (heute im Einsatz) und
   Anthropic (gebauter Zweitadapter + Vorab-Recherche).
5. **Ungemessene Zusagen werden nicht behauptet** (S7/D4). Fehlt M-1/M-2, faellt die Zusage aus
   dem Text - sie wird NICHT ins Gegenteil verkehrt.
6. **Keine erfundene Rechtsangabe** (S7/D7). Jede `[OFFEN: ...]`-Marke ohne Owner-Lieferung bleibt
   unveraendert stehen.
7. **Absolute Regel 2 wird nicht beruehrt.** Der Abschnitt "Gespraechspartner"
   (`privacy.de.json:34`) beschreibt die Offenlegung und bleibt **byte-identisch**.

### 0.1 Sprachregel fuer die Textdateien

Die Rechtstexte sind **gesprochene/gelesene DE-Strings** und tragen **echte Umlaute** (ae/oe/ue
als "ä/ö/ü"). Die ASCII-Regel aus CLAUDE.md gilt fuer Code-Kommentare, nicht fuer diesen Inhalt -
der Bestand in `apps/web/src/data/legal/*.json` ist durchgehend mit Umlauten geschrieben und
bleibt es.

### 0.2 Vier verbotene Woerter in den Rechtstext-Dateien

`test/gap-15-legal-pages-no-placeholder-en-routes.test.js:37` grept den gesamten Inhalt von
`apps/web/src/data/legal/` nach `Platzhalter|ergaenzt der finale|liefert der Owner|liefert
Sundartha`. Keines dieser Woerter darf im neuen Text auftauchen - sonst wird GAP-15 aus einem
FALSCHEN Grund rot, und der echte Grund (fehlende EN-Fassungen) verschwindet hinter dem neuen.
`[OFFEN: ...]` ist die im Bestand etablierte Marke und bleibt es.

---

## 1. Ist-Zustand (Kurzfassung, Details in S7)

- Drei Textdateien, EINE Quelle, von Seiten und Startseiten-Rechtsblatt gelesen
  (`apps/web/src/pages/datenschutz.astro:7`, `apps/web/src/lib/legal.js:12-28`), Pflichtfeld-
  Pruefung mit Build-Abbruch (`legal.js:40-73`).
- **19 `[OFFEN`-Marken** in den drei Dateien (S7 Abschnitt 4).
- **6 Falschaussagen** F1-F3, F5-F7 (S7 Abschnitt 3), davon vier in einem einzigen `text`-Feld
  (`privacy.de.json:38`). Die vormalige F4 ("keine Tonaufzeichnungen") entfaellt: M-1 hat sie am
  20.09.2026 als richtig bestaetigt (GET am Live-Agenten + `npm run elevenlabs:drift`,
  `record_voice = false`).
- **Drei Empfaenger fehlen ganz:** DeepSeek, Exa, MCP-Host.
- Keine EN-Fassung; `apps/web/src/data/legal/*.en.json` existiert nicht, EN-Rechtsrouten liefern
  404 (`legal.js:133-138`).

---

## 2. Soll-Zustand (Abnahme des Gesamtschnitts)

1. Die Datenschutzerklaerung nennt **jeden** Empfaenger aus S7 Abschnitt 2 (E1-E13) mit Zweck und
   Datenart.
2. Keine der sechs Falschaussagen F1-F3, F5-F7 steht noch im Text.
3. Jede verbliebene Luecke ist als `[OFFEN: ...]` sichtbar und benennt, WER sie schliesst.
4. `npm test -- --test-concurrency=4` ist gruen, inklusive der neuen Anbieter-Naht.
5. `npm run test:abnahme` fuehrt zwei neue, ROTE Kriterien mit benanntem Grund.
6. `npm run test:gates` bleibt unveraendert - GAP-15 bleibt rot aus demselben Grund wie vorher.
7. Der Astro-Build von `apps/web` laeuft durch (Pflichtfeld-Pruefung).

---

## 3. Aenderungen

Reihenfolge ist bindend: A1-A7 bearbeiten dieselbe Datei und werden **in einem Zug** gemacht,
danach A8-A11.

### A1 - `apps/web/src/data/legal/privacy.de.json`, Abschnitt "Empfaenger und Auftragsverarbeiter"

**Aenderung:** das `text`-Feld (heute Zeile 38) vollstaendig neu schreiben. Einleitungssatz
bleibt sinngemaess ("aus der tatsaechlichen Anbindung im System abgeleitet"), aber mit
aktualisiertem Stand. Danach je Empfaenger ein mit "— " eingeleiteter Block (Bestandsform
beibehalten), **in dieser Reihenfolge**:

| Block | Muss enthalten |
|---|---|
| Telefonie | Telnyx; Rufnummer, Anrufauf-/abbau, SIP-Transport, SMS-Versand. Daten: Rufnummern beider Seiten, Gespraechsaudio, Verbindungsdaten, SMS-Inhalt |
| Spracherkennung auf dem Telefonie-Weg | Deepgram-Modelle, von Telnyx betrieben - nur fuer den Telnyx-Weg (Rueckfall-Betrieb) |
| **Gespraechs-Plattform** | ElevenLabs; **fuehrt das Gespraech**: erkennt das Gesprochene beider Seiten, laesst ein Sprachmodell antworten, erzeugt die Stimme. Daten: Gespraechsaudio beider Seiten, Wortprotokoll, Gespraechsauftrag, Hintergrundangaben, Name des Auftraggebers, Rufnummer der Gegenstelle, Zeitzonen. **Ausdruecklich: dorthin geht auch das Gesprochene der Gespraechspartner** |
| Sprachmodell im Gespraech | das Modell, das auf der Gespraechs-Plattform antwortet, ist ein Unterauftragsverarbeiter des Plattform-Anbieters; heute ein Modell von Anthropic. `[OFFEN: Bestaetigung des Betreibers, welches Modell am Live-Agenten gesetzt ist (npm run elevenlabs:drift) und ob es in der Unterauftragsverarbeiter-Liste des Plattform-Anbieters gefuehrt wird]` |
| Sprachmodell fuer Zusammenfassung und Vorbereitung | **DeepSeek** (Stand 2026-09; die Wahl ist eine Konfiguration und kann auf Anthropic zurueckwechseln - beide sind im System angebunden). Daten: Wortprotokoll, Gespraechsauftrag, Namen, Sprache. `[OFFEN: Vertragspartner, Sitz, Verarbeitungsort, Auftragsverarbeitungsvertrag und Trainings-Ausschluss des Sprachmodell-Anbieters DeepSeek - OWNER-EINGABE OE-4]` |
| Zweiter Sprachmodell-Anbieter | Anthropic; derselbe Zweck wie die Zeile darueber, wenn die Konfiguration auf Anthropic steht; zusaetzlich die **Vorab-Recherche** vor einem Gespraech, die innerhalb des Modellaufrufs als Websuche laeuft. Daten: zusaetzlich der aus dem Auftrag gebildete Suchbegriff |
| Nachschlagen im Gespraech | **Exa**; wenn die Nachschlage-Funktion fuer das Konto aktiv ist, geht die im Gespraech entstandene Frage - also auch Gesprochenes der Gegenstelle - als Suchanfrage dorthin |
| Anmeldung und Kontoverwaltung | WorkOS (Bestandstext uebernehmen) |
| Zahlungsabwicklung | Stripe (Bestandstext uebernehmen) |
| Hosting und Datenbank | Render, Region Frankfurt (Bestandstext uebernehmen) |
| E-Mail-Versand | Brevo, ersatzweise SMTP-Postfach. `[OFFEN: Bestaetigung des Betreibers, welcher SMTP-Anbieter fuer den Ersatzweg gesetzt ist - OWNER-EINGABE OE-5]` |
| Auftragsverarbeitungsvertraege | die bestehende `[OFFEN: ...]`-Marke uebernehmen und um DeepSeek und Exa erweitern |

**Ersatzlos entfallen:** der Satz ueber "derzeit abgeschaltete Anbindungen ... nicht aktiv"
(F3) und die Formulierung "kein Audio der Gespraechspartner" (F2). Die Laenderermittlung aus der
IP-Adresse wird **nicht** mehr als Anbindung an Dritte gefuehrt (sie liest eine lokale Datei,
`src/config.js:1757-1763`) - entweder ganz weglassen oder als lokale Verarbeitung beschreiben.

**Abnahmekriterium A1:**
- `grep -c "DeepSeek" apps/web/src/data/legal/privacy.de.json` >= 1
- `grep -c "Exa" apps/web/src/data/legal/privacy.de.json` >= 1
- `grep -c "kein Audio der Gesprächspartner" ...` = 0
- `grep -c "nicht aktiv" ...` = 0
- Der ElevenLabs-Block enthaelt das Wort "beider Seiten".

### A2 - dieselbe Datei, Abschnitt "Daten aus Anrufen"

**Aenderung:** der Satz "Nach Codestand werden keine Tonaufzeichnungen der Gespraeche
gespeichert" wird praezisiert: **in unserem System** werden keine Tonaufzeichnungen gespeichert.
Fuer die Gespraechs-Plattform gilt:
- Ist M-1 gemessen und `record_voice === false`: Satz "Beim Anbieter der Gespraechs-Plattform ist
  der Audio-Mitschnitt abgeschaltet."
- Ist M-1 **nicht** gemessen (Regelfall bei der Umsetzung): statt dessen
  `[OFFEN: Audio-Mitschnitt beim Anbieter der Gespraechs-Plattform - der Betreiber misst
  platform_settings.privacy.record_voice am Live-Agenten (npm run elevenlabs:drift) und traegt
  das Ergebnis hier ein; der Anbieter-Standard ist "Mitschnitt an"]`

**M-1 gemessen 20.09.2026** (GET am Live-Agenten + `npm run elevenlabs:drift`, rein lesend):
`record_voice = false` - es gilt der erste Fall, keine `[OFFEN`-Marke mehr noetig.

**Abnahmekriterium A2:** der Satz "keine Tonaufzeichnungen" steht nicht mehr unqualifiziert da -
im selben Satz steht "in unserem System" oder eine gleichwertige Einschraenkung; ohne M-1 steht
die `[OFFEN`-Marke im Abschnitt. M-1 liegt vor (`false`) - es gilt der Satz "Audio-Mitschnitt
abgeschaltet", keine `[OFFEN`-Marke.

### A3 - dieselbe Datei, Abschnitt "Speicherdauer"

**Aenderung:** ein Absatz zur Aufbewahrung **beim Anbieter der Gespraechs-Plattform** kommt hinzu.
Er sagt, dass das Gespraech dort eigenstaendig gespeichert wird und nach welcher Frist es dort
geloescht wird. Ohne M-2:
`[OFFEN: Aufbewahrungsfrist der Gespraeche beim Anbieter der Gespraechs-Plattform - der Betreiber
misst platform_settings.privacy.retention_days am Live-Agenten und traegt den Wert hier ein]`

**M-2 gemessen 20.09.2026** (GET am Live-Agenten + `npm run elevenlabs:drift`, rein lesend):
`retention_days = -1` (unbegrenzt) - die `[OFFEN`-Marke entfaellt, der Absatz nennt `-1`
(unbegrenzte Aufbewahrung) als Beleg dafuer, dass eine ungenannte Anbieter-Frist irrefuehrend war.

Die Bestandssaetze zur Loeschung im eigenen Store (Wortprotokoll nach der Zusammenfassung,
30-Tage-Lauf) bleiben - sie sind korrekt und beschreiben unseren Store.

**Abnahmekriterium A3:** der Abschnitt nennt die Anbieter-Aufbewahrung als eigene Groesse; ohne
M-2 traegt er die `[OFFEN`-Marke. M-2 liegt vor (`-1`) - der Abschnitt nennt `-1` (unbegrenzt)
statt der `[OFFEN`-Marke.

### A4 - dieselbe Datei, Abschnitt "Deine Rechte"

**Aenderung:** "eine vollstaendige Loeschung deiner Anruf- und Kontodaten fuehren wir auf Anfrage
durch" wird durch eine wahrheitsgemaesse Beschreibung ersetzt (S7/F6, D5):
- Auf Anfrage geloescht werden: Anrufe samt Wortprotokollen, daraus abgeleitete Aufgaben, die
  zugehoerigen Benachrichtigungen und die hinterlegte private Rufnummer
  (`src/store/state-ops.js:534-543`).
- Ausdruecklich benannt wird, was **darueber hinaus** geschieht und dass es heute **von Hand**
  erfolgt: Konto beim Anmeldedienst, Einstellungen, Profil, Kalender, Nutzungszahlen,
  Abrechnungsdaten (mit den gesetzlichen Aufbewahrungsfristen) und die Gespraeche beim Anbieter
  der Gespraechs-Plattform.
- Der Auskunftsweg bleibt genannt; er ist ein **Teil**-Export (`src/routes/api-read.js:119-123` -
  ohne Einstellungen, Profil, KYC und Zahlungs-Kennungen).
- Rechte-Aufzaehlung, Kontaktadresse und Beschwerderecht bleiben unveraendert.

**Abnahmekriterium A4:** `grep -c "vollständige Löschung" apps/web/src/data/legal/privacy.de.json`
= 0; der Abschnitt nennt mindestens die Woerter "Anmeldedienst" und "von Hand" (oder eine
gleichwertige Aussage, dass kein Selbstbedienungs-Loeschweg existiert).

### A5 - dieselbe Datei, NEUER Abschnitt "Anbindung an einen KI-Assistenten"

**Aenderung:** neuer Eintrag in `sections`, eingefuegt **nach** "Empfaenger und
Auftragsverarbeiter" und **vor** "Uebermittlung in Drittlaender". Inhalt:
- Hermes laesst sich aus einem KI-Assistenten heraus steuern (Anbindung ueber eine Schnittstelle,
  die der Nutzer selbst verbindet).
- Ist die Anbindung verbunden, erhaelt der Betreiber dieses Assistenten: Status und Ergebnis eines
  Anrufs, die Zusammenfassung, **die letzten Zeilen des Wortprotokolls beider Seiten**
  (`src/mcp-tools.js:169-172`) und - wenn die Rueckfrage-Funktion aktiv ist - die im Gespraech
  gestellte Frage.
- Ausdruecklich: **Audio wird ueber diese Anbindung nie uebertragen** (absolute Regel 5).
- Ausdruecklich: welcher Assistent das ist, waehlt der Nutzer; die Verarbeitung dort richtet sich
  nach dessen eigenen Datenschutzbestimmungen.

**Abnahmekriterium A5:** der Abschnitt existiert, nennt "Wortprotokoll" und sagt, dass kein Audio
uebertragen wird.

### A6 - dieselbe Datei, Abschnitt "Uebermittlung in Drittlaender"

**Aenderung:** die Aufzaehlung wird um die neuen Empfaenger erweitert (DeepSeek, Exa, der Betreiber
der Assistenten-Anbindung) und die ElevenLabs-Zeile korrigiert (dorthin gelangt das Audio beider
Seiten und das Wortprotokoll, nicht nur die gesprochenen Saetze des Assistenten). Fuer jeden neuen
Empfaenger gilt: **Garantie nicht raten.** Ohne Owner-Lieferung:
`[OFFEN: Drittland-Garantie je Empfaenger (Angemessenheitsbeschluss oder Standardvertragsklauseln)
fuer DeepSeek, Exa und den Betreiber der Assistenten-Anbindung - OWNER-EINGABE OE-3/OE-4]`

Die bestehende DPF-Pruefmarke bleibt.

**Abnahmekriterium A6:** der Abschnitt nennt DeepSeek; die ElevenLabs-Zeile nennt das Wortprotokoll;
fuer jeden Empfaenger steht entweder eine Garantie oder eine `[OFFEN`-Marke.

### A7 - dieselbe Datei, Feld `note`

**Aenderung:** Stand aktualisieren (September 2026) und die Aufzaehlung der offenen Angaben auf
den neuen Stand bringen (Anschrift, Datenschutzbeauftragter, AVV-Bestaetigungen inkl. der neuen
Anbieter, DPF-Pruefung, Protokollfrist bei Render, die zwei Anbieter-Messungen).

**Abnahmekriterium A7:** `note` nennt "September 2026" und keines der vier in 0.2 verbotenen
Woerter.

### A8 - `apps/web/src/data/legal/imprint.de.json` (bedingt)

**Aenderung: KEINE**, solange der Owner die Angaben nach OE-1 nicht geliefert hat. Liegt eine
Lieferung vor, werden **genau** die Marken in den Zeilen 10, 14, 18, 22, 26 durch die gelieferten
Angaben ersetzt - Wort fuer Wort wie geliefert, ohne Ergaenzung, ohne Umformulierung. Faellt eine
Angabe weg (z. B. kein Registereintrag), wird der zugehoerige `sections`-Eintrag entfernt, nicht
mit einem leeren Text stehen gelassen (`legal.js:51-55` bricht bei leerem `text` den Build ab).

**Abnahmekriterium A8:** ohne Lieferung ist die Datei **byte-identisch** zum Ausgangsstand.

### A9 - `apps/web/src/data/legal/terms.de.json` (bedingt)

**Aenderung: KEINE** ohne Owner-Lieferung (OE-1, OE-7). Mit Lieferung: Zeilen 10, 38, 74 wie in
A8 beschrieben. Die Entscheidung zum vorzeitigen Leistungsbeginn (OE-7) zieht eine Aenderung im
Buchungsvorgang nach sich - die ist **nicht** Teil dieser Etappe und wird im Report benannt.

**Abnahmekriterium A9:** ohne Lieferung byte-identisch.

### A10 - `PLAN-SECURITY.md`

**Aenderung:** zwei Eintraege ergaenzen (CLAUDE.md, "Vor Edits": sicherheitsrelevante Aenderungen
aktualisieren `PLAN-SECURITY.md`):
1. **Loeschweg unvollstaendig (P1-39/P1-40).** Was `eraseTenantData` erfasst, was nicht, dass es
   keinen Netz-Endpunkt und keinen Audit-Eintrag gibt und dass die Gespraeche beim Anbieter der
   Gespraechs-Plattform gar nicht erfasst werden. Status: offen, Traeger Etappe 10.
2. **Anbieter-seitige Aufbewahrung und Audio-Mitschnitt (M-1/M-2).** `retention_days` steht laut
   Besitz-Ausnahme live auf `-1`; `record_voice` hat beim Anbieter den Standard `true`. **Launch-
   Blocker vor dem ersten Fremdkunden**, mit Verweis auf `npm run elevenlabs:drift` und auf die
   bereits im Bestand notierte Rueckdreh-Pflicht
   (`elevenlabs/agent_configs/outbound-agent.template.json:314`).

**Abnahmekriterium A10:** beide Eintraege stehen in `PLAN-SECURITY.md`, jeweils mit Codebeleg.

### A11 - `render.yaml` und `.env.example` (nur Kommentare)

**Aenderung:** an den drei Stellen, die die Nennung in der Datenschutzerklaerung zur Vorbedingung
des Anschaltens machen (`render.yaml:402-403` RESEARCH, `:408-410` LOOKUP, `:421-424`
IN_CALL_CONSULT; dazu die entsprechenden Stellen in `.env.example`), einen Satz ergaenzen: die
Nennung ist mit E9 erfolgt, die Vorbedingung ist damit erfuellt.

**Kein Wert wird geaendert.** Das ist eine Doku-Aenderung an Kommentarzeilen, keine Freigabe und
keine Empfehlung, etwas anzuschalten.

**Abnahmekriterium A11:** `git diff render.yaml .env.example` zeigt ausschliesslich Kommentarzeilen.

---

## 4. Tests

**Eine neue Datei: `test/openai-e9-rechtstexte.test.js`.** Sie enthaelt beide Testbaenke; die
Zuordnung laeuft ueber den Testnamen (`package.json` `config.abnahmePattern`), nicht ueber die
Datei. Kein bestehender Test wird geaendert, abgeschwaecht oder uebersprungen.

### 4.1 Regressionsbank (`npm test`) - MUSS gruen sein

| ID | Fall | Pruefung |
|---|---|---|
| T1 | **Anbieter-Naht:** jeder gebaute Anbieter-Adapter ist im Rechtstext genannt | Dateinamen aus `src/llm/adapters/` und `src/research/adapters/` lesen, ueber eine im Test stehende Karte auf den Anzeigenamen abbilden (`anthropic` -> "Anthropic", `deepseek` -> "DeepSeek", `exa-search` -> "Exa", `anthropic-web-search` -> "Anthropic") und pruefen, dass der Name in `privacy.de.json` vorkommt. **Ein Adapter ohne Karteneintrag laesst den Test fehlschlagen** - kein stilles Ueberspringen (Lehre: ein Pruefkommando ohne Positiv-Kontrolle sieht aus wie ein bestandener Test) |
| T2 | **Keine ueberholte Behauptung:** `privacy.de.json` enthaelt weder "kein Audio der Gesprächspartner" noch "nicht aktiv" noch "vollständige Löschung" | Zeichenketten-Suche ueber den zusammengesetzten Text aller `sections` plus `note` |
| T3 | **Assistenten-Anbindung genannt:** der Text nennt die Anbindung und die Aussage, dass darueber kein Audio geht | Zeichenketten-Suche |
| T4 | **Mechanik-Regression:** `indexLegalContent` akzeptiert alle drei Dateien weiterhin | die drei JSON-Dateien einlesen, in der von `indexLegalContent` erwarteten Pfad-Form uebergeben, keine Ausnahme erwartet |
| T5 | **Negativ-Kontrolle zu T1:** eine kuenstliche Adapterliste mit einem unbekannten Eintrag laesst die Pruef-Funktion werfen | die Pruef-Funktion aus dem Test heraus mit einer erfundenen Liste aufrufen; beweist, dass T1 ueberhaupt faengt |

Die Pruef-Funktion aus T1 wird im Test als benannte Funktion gebaut, damit T5 sie aufrufen kann.
Keine Produktionsdatei bekommt dafuer neuen Code.

### 4.2 Abnahmebank (`npm run test:abnahme`) - DARF rot sein

Namensform exakt: `ABNAHME-<ID>: <Text> | ROT WEIL: <Grund> | FIX: <Handgriff>`.

| ID | Testname (gekuerzt) | Grund fuer Rot |
|---|---|---|
| ABNAHME-E9-1 | `0 [OFFEN]-Marken in imprint.de.json und terms.de.json` | Firmenname, Rechtsform, Anschrift, Vertretung, Telefonnummer, Register, USt-IdNr. und die Widerrufs-Entscheidung liegen nicht vor (OWNER-EINGABE OE-1/OE-7). FIX: Owner liefert, A8/A9 traegt ein |
| ABNAHME-E9-2 | `0 [OFFEN]-Marken in privacy.de.json` | Anschrift, Datenschutzbeauftragter, AVV-Bestaetigungen, DPF-Pruefung, Render-Protokollfrist (OE-2/OE-3/OE-4/OE-5/OE-6) stehen aus. Die zwei Anbieter-Messungen M-1/M-2 liegen seit 20.09.2026 vor (`record_voice=false`, `retention_days=-1`; GET am Live-Agenten + `npm run elevenlabs:drift`) und blockieren nicht mehr. FIX: Owner liefert OE-2/OE-3/OE-4/OE-5/OE-6 |

Wird eines gruen, legt es die Kennung ab, bekommt das Siegel `[abgenommen E9-1]` bzw.
`[abgenommen E9-2]` und einen Eintrag in `test/abnahme-ausgewandert.json` (Regel D13).

### 4.3 Was NICHT angefasst wird

`test/gap-15-legal-pages-no-placeholder-en-routes.test.js` bleibt unveraendert. Es gehoert dem
i18n-Katalog, wartet auf die EN-Fassungen (OE-9) und bleibt nach dieser Etappe aus **demselben**
Grund rot wie vorher. Wer es anfasst, hat den Auftrag verfehlt.

---

## 5. Verbote

1. **Kein Scope-Zuwachs.** Nicht gebaut werden: ein Loesch-Endpunkt, ein Loesch-Audit-Eintrag, die
   Erweiterung von `eraseTenantData`, eine EN-Uebersetzung der Rechtstexte, ein Umbau der
   `legal.js`-Mechanik, eine neue Env-Variable, ein neues Modul, eine Anbieter-Umstellung.
2. **Keine erfundene Rechtsangabe.** Kein geratener Firmenname, keine geratene Anschrift, kein
   geratenes Register, keine geratene Aufsichtsbehoerde, keine geratene Vertragsgrundlage
   (AVV/SCC/Angemessenheitsbeschluss), kein geratener Sitz eines Anbieters. Im Zweifel:
   `[OFFEN: ...]` mit Benennung, wer es liefert.
3. **Keine Aufweichung absoluter Regeln.** Regel 1 (Safety-Gates) und Regel 2 (Offenlegung) werden
   nicht beruehrt - der Abschnitt "Gespraechspartner" bleibt byte-identisch. Regel 4: kein Secret,
   kein API-Key, kein Token in einen Rechtstext. Regel 5: die Aussage "kein Audio ueber die
   Assistenten-Anbindung" beschreibt den Bestand und wird nicht relativiert.
4. **Keine Konfigurationsaenderung.** Kein Wert in `render.yaml`, `.env.example` oder
   `elevenlabs/agent_configs/*` wird geaendert. Messen (lesender `npm run elevenlabs:drift`) ist
   erlaubt, Pushen zum Anbieter nicht.
5. **Kein abgeschaltetes Gate.** Kein `--no-verify`, kein uebersprungener Test, kein
   `eslint-disable`, keine Absenkung einer bestehenden Erwartung.
6. **Kein Push, kein Merge, kein Deploy.** Die Etappe endet mit einem lokalen Commit auf dem
   Phasen-Branch. Website live schalten ist Owner-Arbeit ueber `docs/RUNBOOK-LAB-LIVE.md`.
7. **Kein `git add -A`.** Dateien einzeln adden; vor dem Commit auf Secrets/PII pruefen.

---

## 6. OWNER-EINGABEN und UNKNOWN

**OWNER-EINGABE** (Leerstelle bleibt sichtbar, S7 Abschnitt 6): OE-1 Firmenname/Rechtsform/
Anschrift/Vertretung/Telefon/Register/USt-IdNr.; OE-2 Datenschutzbeauftragter; OE-3
Vertragsgrundlage je Anbieter; **OE-4 DeepSeek: Vertragspartner, Sitz, Verarbeitungsort,
Drittland-Garantie, Trainings-Ausschluss**; OE-5 SMTP-Anbieter des Ersatzwegs; OE-6
Render-Protokollfrist; OE-7 vorzeitiger Leistungsbeginn; OE-8 Aufsichtsbehoerde; OE-9 EN-Fassung.

**MESSUNGEN, die die Umsetzung anstossen, aber nicht erzwingen kann:** M-1 `record_voice`, M-2
`retention_days` am Live-Agenten (`npm run elevenlabs:drift`). Liegen sie beim Bauen nicht vor,
tragen A2/A3 die `[OFFEN`-Marken; der Report nennt beide ausdruecklich. **Gemessen 20.09.2026**
(GET am Live-Agenten + `npm run elevenlabs:drift`, rein lesend): `record_voice = false`,
`retention_days = -1` - A2/A3 tragen die gemessenen Werte ein, keine `[OFFEN`-Marke mehr noetig.

**UNKNOWN** (S7 Abschnitt 9): U-1 Live-Schalterstaende der Recherche-/Consult-Funktionen (durch
Vorgabe 2 nicht mehr veroeffentlichungs-blockierend), U-3 Live-Modell des Anbieter-Agenten, U-4
Azure-Stimmen als Unterauftragsverarbeiter, U-5 ob OpenAI eine deutschsprachige Privacy-URL fuer
das Listing akzeptiert.

---

## 7. Blast Radius und Pre-Mortem

**Beruehrt:** drei JSON-Textdateien unter `apps/web/src/data/legal/`, eine neue Testdatei,
`PLAN-SECURITY.md`, Kommentarzeilen in `render.yaml`/`.env.example`.
**Nicht beruehrt:** keine Laufzeit des Gateways, kein Telefonie-Pfad, kein Gate, kein Store, kein
Auth-Pfad, keine MCP-Werkzeugdefinition. Ein Fehler in dieser Etappe kann keinen Anruf ausloesen,
keinen Anruf verhindern und keine Kosten erzeugen. Der Ausfallmodus ist ein gebrochener
Astro-Build (`legal.js` bricht bei fehlendem Pflichtfeld ab) - laut, nicht still.

**Pre-Mortem** (ein Jahr spaeter, die Entscheidung war falsch), Kurzfassung aus S7 Abschnitt 8:
1. Der Text nennt DeepSeek, ohne dass ein AVV existiert -> OE-4 steht sichtbar im Text, die
   Veroeffentlichung ist ein Owner-Schritt.
2. Genannte, aber inaktive Empfaenger wirken irrefuehrend -> Vorgabe 2 bindet den Zweck an die
   Funktion, statt laufende Verarbeitung zu behaupten.
3. T1 wird bei einem Adapter-Refactoring rot, obwohl sich sachlich nichts aendert -> gewollt; der
   Fix ist eine Textzeile, nie eine Abschaltung des Tests.
4. Der Text wurde abgeschwaecht, der Loeschweg nie gebaut -> A10 macht den Eintrag in
   `PLAN-SECURITY.md` zur Abnahmebedingung, nicht zum Vorsatz.
5. M-1 blieb offen, die Seite ging live, der Anbieter schnitt Audio mit -> ohne M-1 steht die
   Zusage nicht im Text.

---

## 8. Abnahme (Kommandos, in dieser Reihenfolge)

```
# 1. Die drei Textdateien sind gueltiges JSON
for f in apps/web/src/data/legal/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || exit 1; done

# 2. Regressionsbank gruen (inkl. der fuenf neuen Faelle)
npm test -- --test-concurrency=4

# 3. Abnahmebank: zwei neue rote Kriterien mit benanntem Grund
npm run test:abnahme

# 4. Gates unveraendert - GAP-15 bleibt rot aus demselben Grund wie vorher
npm run test:gates

# 5. Astro-Build laeuft (Pflichtfeld-Pruefung in legal.js)
npm --prefix apps/web run build

# 6. Platzhalter-Zaehlung, dokumentiert im Report
grep -rc "\[OFFEN" apps/web/src/data/legal/

# 7. Keines der vier GAP-15-Signalwoerter im neuen Text
grep -rn "Platzhalter\|ergaenzt der finale\|liefert der Owner\|liefert Sundartha" apps/web/src/data/legal/ ; test $? -eq 1
```

**Der Report nennt ausdruecklich:** (a) ob M-1/M-2 gemessen werden konnten, (b) die
Platzhalter-Zaehlung vorher/nachher je Datei, (c) dass die Veroeffentlichung eine Owner-Pruefung
voraussetzt, (d) dass A8/A9 ohne Owner-Lieferung byte-identisch geblieben sind.
