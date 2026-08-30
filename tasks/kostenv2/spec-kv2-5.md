<!-- Auftragsblatt KV2-5. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 1111-1330). -->

# Pflichtlektuere vor der Umsetzung

Dieses Blatt ist der Auftrag, aber NICHT der ganze Kontext. Vor dem ersten Edit zu lesen:

- `tasks/PLAN-KOSTEN-V2.md` Abschnitt 2 (Zielbild), Abschnitt 3 (Kostenarten-Tabelle, inkl. 3.5 Einheiten und
  3.6 die ID-Falle), Abschnitt 4 (Architektur-Entscheidung, insbesondere 4.3
  Durchsetzungsstelle, 4.5 Settlement, 4.6 Matrix, 4.7 Schliessregel) und
  **Abschnitt 7 (Eigentuemer-Entscheidungen) vollstaendig**.
- `tasks/kostenv2/befund-code.md`, `befund-elevenlabs.md`, `befund-gate.md`,
  `befund-telnyx.md` - der gemessene Ist-Zustand. Keine Annahme ueber Bestandscode ohne
  Beleg aus diesen Befunden ODER aus dem Code selbst.
- `CLAUDE.md` (Absolute Regeln) und `.claude/refs/clean-code.md`.

# Harte Randbedingungen dieser Kette

1. **Safety-Gates, Offenlegungssatz und `callee_is_owner` werden NICHT angefasst.** Beruehrt
   die Umsetzung eines davon, ist das ein Abbruchgrund mit Meldung an den Lead - keine
   eigenmaechtige Aenderung, auch keine "harmlose" Umformulierung.
2. **Abschnitt 7, Punkte 1-9 und 13 sind entschieden** - umsetzen wie dort festgelegt.
   **Die Punkte 10, 11, 12, 14, 15 und 16 laufen auf Default und sind so gekennzeichnet.**
   Verlangt die Phase, einen davon scharf zu stellen, wird er auf dem dokumentierten
   Default gebaut und der Punkt im Report als Rueckfrage an den Owner gemeldet -
   NICHT eigenmaechtig festgelegt.
3. Neue Env-Variable: sofort in `src/config.js`, `.env.example` UND in `BASE_ENV` der
   Test-Helfer (sonst leakt die echte `.env` in Spawn-Tests).
4. Neues Verhalten braucht einen Test. Geldrechnung braucht einen Test, der die Rechnung
   pinnt, nicht nur ihre Existenz.

---

### KV2-5 - Der Telnyx-SIP-Beleg, plus die Messung der Pflicht-Typmenge

**Ziel.** Der Sweep findet die SIP-Belege der EL-Anrufe und legt sie als
`traeger=telnyx_sip` ab - und fuer die Bestandsprofile legt derselbe Sweep im selben Zug die
Zeile `traeger=telnyx_call_records` an, damit der Traeger von vier der fuenf Profile ueberhaupt
je einen Beleg bekommt (g). Und er misst, welche `record_type`-Werte der EL-Weg ueberhaupt
liefert - denn `COST_TRUING_REQUIRED_RECORD_TYPES` steht live auf
`sip-trunking,call-control`, und ob der EL-Weg je einen `call-control`-Beleg fuehrt, ist
UNGEMESSEN (BELEGT, `befund-telnyx.md`, Schlussabschnitt). Bleibt die Pflichtmenge global
und liefert der EL-Weg nie `call-control`, ist `dataComplete` fuer EL-Anrufe NIE wahr, es
gaebe nie eine Erstattung, und die Deckung laege dauerhaft unter der Schwelle.

**Betroffene Dateien.** `src/billing/cost-truing.js` (`providerLegIdOf`, `:138`, lernt
`call.sipCallId` als dritte Alternative), `src/telephony/adapters/telnyx/voice.js` (zweites
Ankerfeld `sip_call_id` als direkter Primaerschluessel-Vergleich fuer `sip-trunking`-Records
neben `ANCHOR_ID_FIELD`, `:140`, Zuordnung `:903`), `src/billing/kostenarten.js`
(Pflicht-Typmenge JE PROFIL statt global - fuer die Bestandsprofile bleibt diese Menge der
heutige Env-Wert, kein Literal im Katalog, s. Abnahmekriterium (f); ausserdem die
sipCallId-bewusste Legacy-Zuordnung fuer profillose Altzeilen, s. (h) - sie gehoert in DIESE
Phase, weil DIESE Phase mit dem `sipCallId`-Join die Gefahr ueberhaupt erst erzeugt), `src/config.js` /
`.env.example`, Tests. Zusaetzlich in `cost-truing.js` der zweite Belegschreiber neben
`bookCorrectionFor`: die `telnyx_call_records`-Zeile aus `measured` (`:665`), s. (g).

Der Join ist strikte String-Gleichheit `raw.sip_call_id === call.sipCallId` - kein Fuzzy,
keine Session-Heuristik. Belegt ausreichend: 12 von 12 EL-Anrufen haben genau einen Treffer,
alle 13 EL-Belege im Zeitraum tragen `sip_call_id`, keiner `call_control_id`
(`befund-telnyx.md` O1). Das ist strukturell sicherer als der bestehende zweistufige
Session-Mechanismus, der im Bestandskommentar selbst als "nie unter Parallelverkehr
gemessen" markiert ist.

**Abnahmekriterium (ohne echten Anruf).**
(a) **Der B6-Test, und er ist der wichtigste Test der ganzen Kette:** ein Anruf mit Profil
`el_convai_sip`, `estimatedCostCents = 30`, ausschliesslich Telnyx-Beleg (4,01 US-ct) und
KEINEM EL-Beleg bewegt **null Cent** auf der Gate-Achse; `applyCostCorrectionCents` wurde
nachweislich nicht aufgerufen (Spion); `costCorrectionMicroCentsRem` ist bit-gleich. Der
Test wird rot, sobald jemand die Kette hier abkuerzt.
(b) Ein Telnyx-Engine-Anruf (mit `callControlId`) verhaelt sich auf der GATE-ACHSE exakt wie
vorher - derselbe Aufruf von `applyCostCorrectionCents` mit denselben Argumenten (Spion),
derselbe Herkunftswert, derselbe `costTruedAt`-Zeitpunkt; Regressionsschutz fuer die 56
heute funktionierenden Faelle. Was hinzukommt, ist ausschliesslich die Belegzeile aus (g):
sie wird geschrieben und in dieser Phase von niemandem gelesen. "Exakt wie vorher" heisst
also: kein Cent, kein Zustandsfeld am Anruf, kein Zaehler aendert sich - nicht: keine Zeile
im Kosten-Buch.
(c) Fixture mit dem gemessenen Roh-Record (`billed_sec=60`, `call_sec=35`, `cost=0.0401`,
`rate=0.0401`, `currency=USD`, `sip_call_id=otb_...`): genau eine `belegt`-Zeile mit
4,01 US-ct. Ein Record mit `currency != USD` wird fail-closed verworfen, nicht umgerechnet.
(d) **Messung, die in dieser Phase stattfinden MUSS und Teil der Abnahme ist** (nicht nur
eine Bitte, wie in beiden Entwuerfen): ein lesender Abruf
`GET /v2/detail_records?filter[record_type]=call-control` ueber den EL-Zeitraum und die
Feststellung, ob fuer die 12 bekannten `sip_call_id`-Werte Belege existieren. Ergebnis wird
als Pflicht-Typmenge des Profils `el_convai_sip` im Katalog eingetragen. Zusaetzlich: die
reale Latenz der `sip-trunking`-Belege (Abstand `started_at` zu erster Verfuegbarkeit),
weil genau diese Zahl darueber entscheidet, ob ein EL-Anruf je vollstaendig wird - bisher
ist nur ihre Existenz belegt, nicht ihre Latenz (`angriff-premortem.md` 6).
Dritter Punkt derselben Messung, weil er im selben lesenden Abruf mit abfaellt: ob
`record_type=inference` (Katalogzeile #15) auf unserem Konto ueberhaupt Betraege traegt. Der
Sweep holt diesen Typ nicht ab (`voice.js:656` laeuft ueber
`ASSIGNABLE_COST_RECORD_TYPES`), und ohne die Zahl bleibt eine Anbieter-Kostenart
unbeziffert, die per Konstruktion in keinem Buch landet. Das Ergebnis aendert an dieser Kette
NICHTS - es wird nur beziffert, nicht umgelegt - und wandert in Abschnitt 9 bzw. in die
`preisquelle` der Zeile #15.
**Scheitert der Abruf, ist das Ergebnis der Phase eine Owner-Meldung, kein gruener Test** -
dieselbe Regel wie in KV2-1(e) und KV2-2(f), hier ausdruecklich hingeschrieben statt
impliziert. Der Fall ist real und nicht hypothetisch: der Telnyx-Zugang ist im Vorlauf
dieses Plans mit HTTP 401 ausgefallen (BELEGT, `tasks/kostenv2/AUFTRAG.md:138`). Konkret
gilt dann: die Owner-Meldung nennt das Fehlerbild (Statuscode, Endpunkt, Zeitpunkt); die
Pflicht-Typmenge des Profils `el_convai_sip` bleibt UNGESETZT - kein geratener Wert, kein
Uebernehmen des Bestandswerts "weil er naheliegt"; die Latenz- und die
`inference`-Frage bleiben in Abschnitt 9 offen; und **KV2-8 bleibt blockiert.** Blockieren
ist hier die richtige Richtung: KV2-8 ist der Geld-Umschalter, und eine geratene
Pflichtmenge entscheidet dort ueber Erstattungen (die leere Menge ist allquantifiziert wahr,
s. Blocker-Befund 3/6 in Abschnitt 10). Die uebrigen Kriterien dieser Phase - (a), (b), (c),
(e), (f), (g), (h) - bleiben davon unberuehrt und werden normal abgenommen; die Phase ist
damit teil-erfuellt und ausdruecklich NICHT gruen. Fuer (h) gilt das ausdruecklich auch dann,
wenn (d) scheitert: der Riegel gegen eine Erstattung an den 12 EL-Altanrufen haengt NICHT an
der Antwort auf (d), sondern gerade daran, dass sie offen ist.
(e) Spion-Test: ein Fixture-Pool ausschliesslich mit `sip-trunking`-Records (keine
`text-to-speech`-Records) laesst `store.recordRelayTtsCharacters` ueber `bookTtsCharactersFor`
nachweislich UNGERUFEN. Traegt ein realer EL-Pool doch `text-to-speech`-Records, gehoert
dieses Ergebnis in die Messaufgabe KV2-5(d), nicht in eine Annahme.
(f) **Die Pflicht-Typmenge der Bestandsprofile veraendert sich durch die Umstellung NICHT.**
Fuer `telnyx_budget`, `telnyx_assistant` und `telnyx_inbound_budget` ist sie exakt der
heutige Live-Wert von `COST_TRUING_REQUIRED_RECORD_TYPES`, `sip-trunking,call-control`
(BELEGT, AUFTRAG O1 / `befund-telnyx.md`, Schluss von O1; `.env.example:573` ist leer, der
Wert kommt aus der Produktionsumgebung, gelesen ueber `csvEnv`, `config.js:1079`). Konkret:
die Umstellung macht die Menge nur ADRESSIERBAR je Profil; die drei Bestandsprofile lesen
weiterhin denselben Env-Wert, ein Literal im Katalog bekommt allein das neue Profil
`el_convai_sip` (aus der Messung (d)). `telnyx_inbound_realtime` bekommt KEINS: sein
zusaetzlicher Traeger `openai_realtime` ist seit Owner-Entscheidung 9 (2026-08-30)
`nicht_belegpflichtig` und geht gar nicht erst in eine Pflichtmenge ein; fuer seinen
Telnyx-Anteil gilt derselbe Env-Wert wie fuer die drei Bestandsprofile. So kann kein Deploy
die Menge der Bestandsprofile still verschieben, und der Boot-Waechter gegen die leere Menge
(`boot-guard.js:662`) bleibt wirksam.
**Ausdruecklich verboten ist die Ableitung der Menge aus Katalogzeile #3.** Deren
`record_type`-Angabe ist seit dem 2026-08-30 die aus `ASSIGNABLE_COST_RECORD_TYPES`
abgeleitete Menge ALLER sechs zuordenbaren Typen (`voice.js:178-180`); sie benennt die
betragstragenden Records, nicht das Vollstaendigkeits-Praedikat. Eine Ableitung setzte die
Pflichtmenge auf alle sechs Typen und machte `complete` in `classifyRecords`
(`cost-truing.js:328`) fuer JEDEN Bestandsanruf unwahr - `source` waere dauerhaft
`incomplete`, `refundProven` (`:452-457`) erstattete nie mehr, und die heute funktionierende
Erstattung (56 von 56, AUFTRAG B1) waere still tot. Auch die Gegenrichtung ist verboten und
war in der frueheren Fassung dieses Plans die naheliegende: solange Zeile #3 nur
`call-control` und `text-to-speech` nannte, verengte eine Ableitung die Menge auf
`call-control` und machte `complete` LEICHTER wahr - Erstattung fuer die 56 Bestandsanrufe
unter schwaecheren Bedingungen als heute. Beide Richtungen widersprechen (b) dieser Phase,
KV2-7(a) ("byte-identisch zu heute") und der Zusage aus Abschnitt 5, dass bis
einschliesslich KV2-7 kein Cent bewegt wird. Die Pflicht-Typmenge ist und bleibt ein
getrenntes Datum.
Test, zwei Richtungen (eine Richtung allein faengt nur den halben Fehler): ein
Fixture-Anruf des Profils `telnyx_budget` mit AUSSCHLIESSLICH `call-control`-Records ergibt
`source=incomplete` und KEINE Erstattung - genau wie heute; er wird rot, sobald jemand die
Menge verengt. Derselbe Fixture-Anruf mit genau der heutigen Live-Menge
(`sip-trunking` + `call-control`, `billedSecTotal > 0`) wird erstattet - er wird rot, sobald
jemand die Menge auf alle sechs zuordenbaren Typen ERWEITERT, also aus Katalogzeile #3
ableitet.
**Akzeptiertes Restrisiko, benannt:** eine Aenderung des Env-Werts bewegt weiterhin alle drei
Bestandsprofile gleichzeitig. Das ist das heutige Verhalten und wird hier bewusst nicht
verbessert - eine Aufteilung waere eine Verhaltensaenderung an der Erstattungsbedingung und
gehoert nicht in eine Phase, die keinen Cent bewegen darf.

(g) **Die Belegzeile `traeger=telnyx_call_records` - der Einsammler, ohne den vier der fuenf
Profile nie vollstaendig werden** (Owner-Entscheidung 11, Default: bauen). Fuer jeden Anruf,
dessen Profil diesen Traeger fuehrt (`telnyx_budget`, `telnyx_assistant`,
`telnyx_inbound_budget`, `telnyx_inbound_realtime`), legt `trueOneCall` die Zeile aus dem
BEREITS VORHANDENEN `measured`-Ergebnis an (`cost-truing.js:665`) - kein zweiter Abruf, kein
zusaetzliches Netz-IO, dieselbe Messung, die heute schon `bookCorrectionFor` speist. Betrag
`measured.actualCostMicroCents`, Waehrung USD, `quelle` `telnyx_detail_records`, `beleg_ref`
der Anker, ueber den die Records zugeordnet wurden (`call_control_id` bzw.
`telnyx_session_id`, `telephony/adapters/telnyx/voice.js:140/160/903`), `detail` mit
`billed_sec`/`rate` - alles nach der Allowlist aus KV2-3, also nie eine Rufnummer und nie ein
Anbieter-Rohbody. Die Reife wird NICHT neu erfunden, sondern Bedingung fuer Bedingung aus
dem Bestandspraedikat uebernommen:
- `belegt` genau dann, wenn `classifyRecords` `complete` liefert
  (`measured.source === COST_TRUING_SOURCE.DETAIL_RECORDS`, gesetzt `cost-truing.js:328/:331`)
  UND `measured.billedSecTotal > 0` - exakt die beiden Bedingungen, die `refundProven` heute
  prueft (`:452-457`);
- sonst `vorlaeufig`.
Die DRITTE Bedingung von `refundProven`, `isBookableCents(call.estimatedCostCents)`, ist eine
Eigenschaft des ANRUFS, nicht des Belegs. Sie wandert ausdruecklich NICHT in die Reife und
bleibt, wo sie heute steht (`bookCorrectionFor`, `cost-truing.js:477`); sonst haette ein
fehlender Schaetzbetrag stillschweigend die Bedeutung "Beleg fehlt" bekommen - zwei
Sachverhalte auf einem Label, genau das, was `truedSourceOf` (`:466-471`) im Bestand bereits
trennt.
**Profil-Trennung, sonst zaehlt das Buch doppelt:** die `telnyx_sip`-Zeile entsteht
AUSSCHLIESSLICH fuer `el_convai_sip`, die `telnyx_call_records`-Zeile AUSSCHLIESSLICH fuer die
vier Profile oben. Kein Anruf bekommt beide Zeilen aus demselben Record-Pool; sonst stuende
derselbe Betrag zweimal in der Belegsumme, die KV2-8 bildet.
Test: derselbe Fixture-Pool, der heute `refundProven === true` ergibt, erzeugt genau eine
`belegt`-Zeile mit `measured.actualCostMicroCents`; ein Pool ohne `sip-trunking`-Record
(also `source=incomplete`) erzeugt genau eine `vorlaeufig`-Zeile; ein Anruf des Profils
`el_convai_sip` erzeugt KEINE `telnyx_call_records`-Zeile. In allen drei Faellen bewegt sich
null Cent, und `usage.costCorrectionMicroCentsRem` ist bit-gleich.

(h) **Der Zwilling des B6-Tests, fuer die 12 EL-Altanrufe - dieselbe Bauform wie (a), nur
fuer die Altmenge.** Diese Phase macht die 12 Altanrufe mit dem `sipCallId`-Join erstmals
abrufbar (heute liefert `providerLegIdOf` fuer sie `null`, `isRetrievable`
`cost-truing.js:581` ist falsch); sie haben `costTruedAt === null` und 0 Versuche, werden
also im ersten Sweep nach dem Deploy Kandidaten und laufen in `trueOneCall`, wo
`cost-truing.js:684` `bookCorrectionFor` fuer JEDEN gemessenen Anruf ruft (alle Zahlen am
2026-08-30 lesend an der Produktions-DB gemessen, s. 4.3). Die Legacy-Zuordnung ist deshalb
`sipCallId`-bewusst (4.3, 4.6): eine profillose Altzeile MIT gesetztem `sipCallId` faellt auf
`el_convai_sip`, nicht auf `telnyx_budget`.
Fixture, wortgleich zur Bauform von (a): ein Anruf OHNE `costProfile`, MIT `sipCallId`,
`estimatedCostCents = 30`, ausschliesslich Telnyx-Beleg und ohne EL-Beleg bewegt **null
Cent**; `applyCostCorrectionCents` wurde nachweislich NICHT aufgerufen (Spion);
`costCorrectionMicroCentsRem` ist bit-gleich.
**Gegenprobe im selben Test, sonst pinnt er die Legacy-Regel nicht:** ein Anruf OHNE
`costProfile` und OHNE `sipCallId` (die gewoehnliche Telnyx-Altzeile) verhaelt sich
unveraendert wie heute - `applyCostCorrectionCents` wird mit denselben Argumenten gerufen
wie im Bestand, die Erstattung bleibt erhalten. Ohne diese zweite Richtung waere der Test
auch dann gruen, wenn jemand die Legacy-Zuordnung fuer ALLE Altzeilen abschaltet und damit
die 56 heute funktionierenden Faelle mit erschlaegt.
Der Test ist unabhaengig davon gruen, welche Bauform Owner-Entscheidung 14 waehlt: er misst
das Ergebnis (null Cent, Spion ungerufen), nicht den Weg dorthin.
Warum das nicht schon (a) abdeckt: (a) setzt das Profil `el_convai_sip` VORAUS. Genau das
haben die 12 Altzeilen nicht - sie sind vor KV2-2 entstanden und tragen gar kein Profil.

**Was diese Phase NICHT tut.** Sie ruft `bookCorrectionFor` (`cost-truing.js:476`) fuer
Anrufe der EL-Route ausdruecklich NICHT auf. Sie sammelt, sie bucht nicht. Die B6-Falle
wird durch eine Reihenfolge-Entscheidung entschaerft, nicht durch Sorgfalt. Fuer die
Bestandsprofile aendert sie am Buchungsweg NICHTS: `bookCorrectionFor` laeuft dort weiter wie
heute, die neue Zeile aus (g) liegt daneben und wird erst in KV2-8 gelesen. Sie liest die
Zeile also selbst nicht - auch nicht fuer die Deckungsquote, die kommt in KV2-6.

**Ein zweiter Zustands-Schreibweg laeuft trotzdem mit, benannt und gepinnt (statt
vermutet).** `trueOneCall` ruft fuer JEDEN gemessenen Anruf nicht nur `bookCorrectionFor`,
sondern zusaetzlich `bookTtsCharactersFor` (`cost-truing.js:685` -> `:515-521`), das
`store.recordRelayTtsCharacters` schreibt und einen Kontingent-Befund melden kann. Sobald
diese Phase EL-Anrufe messbar macht, laeuft dieser Schreibweg fuer sie mit. Der Betrag ist
fuer EL-Anrufe VERMUTET 0 (`measured.ttsCharacters <= 0` -> frueher Ausstieg), aber
unbelegt - Abnahmekriterium (e) macht daraus eine Messung statt einer Annahme.

**Abhaengigkeit.** KV2-4. Owner-Vorbedingung: Entscheidung 11 (Abschnitt 7) - baut diese
Phase den `telnyx_call_records`-Einsammler (a) oder settlen die Bestandsprofile dauerhaft ueber
den Bestandspfad (b)? Bleibt die Antwort aus, gilt die dortige Empfehlung als Default: (a),
also Kriterium (g) wie beschrieben - im Phasenbericht ausdruecklich als Default vermerkt,
nicht als getroffene Entscheidung. Faellt sie auf (b), entfaellt (g) ersatzlos, KV2-6(f)
wird zur Ausnahme-Regel des Herzschlags und KV2-8(i) zum Beleg, dass `refundProven`
UNVERAENDERT weiterlaeuft.
Entscheidung 9 beruehrt diese Phase nicht: sie betrifft nur die Traegerliste von
`telnyx_inbound_realtime`, nicht die drei Bestandsprofile, deren Pflicht-Typmenge (f)
unveraendert festschreibt.
Entscheidung 14 (Bauform des Altzeilen-Riegels, Abschnitt 7) beruehrt (h): Default ist
(a), die Umlenkung profilloser Altzeilen mit `sipCallId` auf `el_convai_sip`. Faellt sie auf
(b) - vollstaendige Herausnahme aus dem Buchungspfad -, aendert sich der WEG, nicht das
Kriterium: (h) misst null bewegte Cent und den ungerufenen Spion, und beide Bauformen
liefern das. Bleibt die Antwort aus, laeuft die Phase mit (a), und der Phasenbericht
vermerkt das ausdruecklich als Default, nicht als getroffene Entscheidung.
Entscheidung 12 (Traegername) beruehrt sie dagegen sehr wohl: faellt sie auf die
Aufspaltung in Traeger je Belegtyp, aendert sich (g) - dann legt der Sweep nicht EINE Zeile
mit `measured.actualCostMicroCents` an, sondern eine je Belegtyp, `dataComplete` misst gegen
eine laengere Pflichtliste, und der Regressionsbeleg gegen den Bestandspfad (b)/KV2-8(i)
muss diese Zerlegung mit abdecken. Default ist die Umbenennung; dann bleibt (g) exakt wie
beschrieben.
**Nicht-Ergebnis dieser Phase, ausdruecklich:** scheitert die Messung (d), ist die Phase
teil-erfuellt und meldet an den Owner (s. dort). KV2-6 kann darauf aufsetzen (sie misst
Deckung, nicht Vollstaendigkeit gegen eine Pflichtmenge), KV2-8 nicht.

---

