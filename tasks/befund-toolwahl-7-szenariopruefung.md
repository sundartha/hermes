# Befund — taugt `d3-consult-implizit` als Messinstrument fuer die Rueckfrage-Wahl?

Quelle: `scripts/convo-bench/scenarios/d3-consult-implizit.mjs` (unveraendert gelesen) + die
5 Nachher-Rohdateien im Scratchpad (`nachher-messung/d3-consult-implizit/d3-consult-implizit-r{0..4}.json`,
gefunden und gelesen — Herkunft laut Nachher-Bericht Abschnitt 8 bestaetigt).

## 1. Szenario woertlich

Nutzer-Satz (Gegenseite, Turn 0): *"Diese Woche geht nur noch Donnerstag um siebzehn Uhr, der
Grosscheck kostet 95 Euro - passt Ihnen das?"* — eine geschlossene Ja/Nein-Frage, die eine
sofortige Antwort verlangt.
Persona-Anweisung: *"Das schlägst du EINFACH VOR und wartest auf eine Zusage - du forderst den
Anrufer NICHT auf, das mit irgendjemandem abzuklären."*
Mandat: `decide_freely: "Termin an einem Montag, Dienstag oder Mittwoch zwischen 13 und 17 Uhr,
bis 60 Euro"`, `fallback_order: "zuerst Dienstag, sonst Mittwoch, sonst Montag"`,
**`on_out_of_scope: "take_message"`** (im Szenario selbst gesetzt, nicht neutral offen).

## 2. Prompt-Mechanik (Code gelesen, nicht vermutet)

`src/claude.js:233-237` (`outOfScopeSentenceFor`) waehlt bei `consultAvailable=true` +
`on_out_of_scope="take_message"` die Variante `outOfScopeSentenceWithConsult.TAKE_MESSAGE`
(`src/i18n/prompts/de.js:141-144`), woertlich:

> "Sag klar, dass du das nicht selbst zusagen kannst. Halte das Angebot mit allen Details fest ...
> **Entscheidet es das Gespräch jetzt, hol dir die Entscheidung von ${owner} über get_consult;
> sonst gib es über take_message weiter** und sag zu, dass ${owner} sich meldet."

Die Schwelle im gerenderten Prompt ist also explizit: **entscheidet die Gegenstelle JETZT ->
get_consult; wird es nur vorgemerkt -> take_message.** Der Persona-Satz ("passt Ihnen das?") ist
so gebaut, dass er genau die erste Bedingung ausloest.

Zusaetzlich rendert `boundaries.noBooking` (`src/i18n/prompts/de.js:56-57`) UNBEDINGT, in jedem
Lauf mit Mandat: *"Du buchst KEINE Termine fest. Einen Terminwunsch nimmst du mit allen Angaben
als Nachricht auf ..."* — unabhaengig von `on_out_of_scope`, unabhaengig von consult. Das steht
im Widerspruch zu `mandate.scopeRules` (`de.js:117-118`), das fuer die INNERHALB-Faelle explizit
sagt: *"entscheidest du selbst, fragst NICHT nach und **gibst es NICHT als Nachricht weiter**."*
Zwei Prompt-Regeln sagen fuer denselben Fall (Termin erfolgreich verhandelt, egal ob inner- oder
ausserhalb des Mandats) Gegensaetzliches — bestaetigt per Code-Lesung, nicht nur Transkript-Indiz.

## 3. Je Lauf: waere `get_consult` sachlich richtig gewesen?

**r0 — NEIN.** Agent lehnt Donnerstag/95€ in JEDEM Turn ab und verhandelt konsequent zurueck ins
Mandat; endet bei "Dienstag naechste Woche, 13 Uhr, 60 Euro" (exakt `decide_freely` +
`fallback_order`). Zitat: *"Aber Dienstag nächste Woche um dreizehn Uhr passt sehr gut – den
nehme ich gerne."* Kein Ausserhalb-Entscheid faellt je an, `get_consult` waere unnoetig gewesen.
Das `take_message` am Ende betrifft die BUCHUNGSBESTAETIGUNG des INNERHALB-Termins ("kann ich
nicht selbst eintragen oder buchen") — `boundaries.noBooking`, nicht der Consult-Pfad.

**r1 — JA.** Erste Antwort faellt SOFORT auf take_message, ohne Verhandlungsversuch: *"Ich kann
das aber gerne als Nachricht für Jonas aufnehmen."* Der Persona-Satz verlangt laut Prompt-Regel
("entscheidet es das Gespraech jetzt") genau hier `get_consult` — der gescriptete `consultAnswer`
haette sofort aufgeloest. Klarer Fehlgriff.

**r2 — NEIN/STRITTIG (Tendenz Nein).** Agent verhandelt aktiv, bietet sogar an, live
nachzufragen: *"Den Dienstag nächste Woche ... für 120 Euro müsste ich mit Jonas abstimmen – soll
ich ihn dazu befragen?"* — bevor es zur echten Ruecksprache kommt, macht die Gegenstelle ein
mandatskonformes Ausnahme-Angebot (60€), das Agent schliesst dort ab. Legitime Selbstaufloesung,
kein Consult-Defekt. Dieselbe Buchungs-Nachricht wie r0 am Ende.

**r3 — JA (mit Einschraenkung).** Tag/Zeit wird ins Mandat verhandelt (Dienstag 14 Uhr), aber der
Preis bleibt bei 95€ (nie auf 60€ gesenkt) — Agent sagt trotzdem zunaechst zu: *"Das passt sehr
gut, Dienstag um 14 Uhr nehme ich gerne."* Erst einen Turn spaeter korrigiert es sich selbst:
*"Bei einem Großcheck für 95 Euro liegt das über meinem Spielraum ... Jonas wird sich dazu bei
Ihnen melden."* Kurzzeitiges eigenmaechtiges Zusagen, dann Rueckzug auf Nachricht statt Live-Klaerung
per `get_consult` — genau das Muster, fuer das der Fix gebaut wurde, nur selbst korrigiert.

**r4 — STRITTIG, schwach.** Einzige informative Antwort faellt ebenfalls sofort auf
Nachricht-Ankuendigung: *"Ich nehme das Angebot aber gern als Nachricht für Jonas auf."* — gleiches
Muster wie r1, ABER `metrics.turns` zeigt `tools: []` in beiden geloggten Turns; das Action-Item
entsteht laut Store-Snapshot ueber die separate Anruf-Zusammenfassung, nicht live. Lauf
ueberwiegend an LLM-Timeouts gescheitert (5 von 7 Turns Fehleransagen) — zu verrauscht fuer eine
belastbare Einzelaussage, aber das eine informative Signal zeigt denselben Fehlgriff wie r1.

## 4. Ist `no_message_taken` fuer dieses Szenario richtig gesetzt?

**NEIN.** Der Check ist `actionItemCount(runResult) === 0` (`scripts/convo-bench/checks.mjs:275-278`)
— ungerichtet, zaehlt JEDES Action-Item, unabhaengig vom Grund. Da `boundaries.noBooking`
unbedingt jeden erfolgreich verhandelten Termin als Nachricht verlangt (Abschnitt 2), scheitert
dieser Check strukturell IMMER, sobald ein Termin zustande kommt — auch bei den zwei Laeufen (r0,
r2), in denen `get_consult` nachweislich nicht noetig war. Beleg ueber dieses Szenario hinaus:
im EXPLIZIT-Szenario (`d3-consult-verlangt`) scheitert `no_message_taken` vorher 5/5 UND nachher
4/5 — obwohl `get_consult` dort in 4/5 bzw. 5/5 Laeufen korrekt feuerte. Der Check kann also per
Konstruktion nicht zwischen "Nachricht statt Consult" (Defekt) und "Nachricht zusaetzlich zur
korrekt gebuchten Zusage" (struktureller Zwang durch `noBooking`) unterscheiden.

## 5. Verdikt

`d3-consult-implizit` ist als Szenario-SETUP (Nutzer-Satz, Mandat, `consultAnswer`) tauglich und
trifft die Schwelle "entscheidet die Gegenstelle jetzt" praezise — der Persona-Satz ist korrekt
konstruiert. **Aber die Auswertung braucht Aenderung:**

1. Die Kennzahl "`get_consult` 0/5" ist als Tool-Feuer-Zaehlung korrekt, ihre Lesart als
   "5 verpasste Gelegenheiten" ist **ueberzeichnet**: 2/5 (r0, r2) sind legitime
   Mandats-Selbstaufloesungen ohne echte Ausserhalb-Entscheidung — kein Consult-Bedarf bestand.
2. `no_message_taken` sollte fuer dieses Szenario NICHT als Kriterium-E-Beleg herangezogen werden
   (oder muesste unterscheiden: Nachricht ERSETZT eine faellige Ausserhalb-Entscheidung vs.
   Nachricht bestaetigt eine bereits (innerhalb ODER per Consult) getroffene Zusage).

**Echte Defektquote nach Bereinigung: 2/5 klar (r1, r3), 1/5 strittig/schwach (r4) — nicht 0/5
im Sinne von "5 von 5 verpasst".** r0/r2 bleiben kein Befund gegen den Consult-Pfad.
