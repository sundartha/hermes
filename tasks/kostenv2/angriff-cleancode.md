# Clean-Code-Angriff: Entwurf A vs. Entwurf B (KV2)

Stand 2026-08-30. Gegenlesen von `tasks/kostenv2/entwurf-a.md` und
`tasks/kostenv2/entwurf-b.md` gegen `.claude/refs/clean-code.md` und die im Repo
geltenden Prinzipien (Auftrag: `tasks/kostenv2/AUFTRAG.md`). Beide Entwuerfe sind
Architektur-Prosa, kein Code — die meisten reinen Code-Kategorien (Funktionslaenge,
Verschachtelung, Java-Muster) sind daher **n. z.**, weil es keine Implementierung gibt,
die man vermisst. Bewertet wird, was diese Dokumente TATSAECHLICH festlegen: Datenfluss,
Vollstaendigkeits-Praedikate, Phasenreihenfolge, Sicherungen.

Kennzeichnung wie im Auftrag: **BELEGT** = Zitat/Zeile aus den beiden Entwuerfen selbst.
**Schluss** = meine eigene Ableitung, ausdruecklich markiert.

---

## Befund 1 (BLOCKER, Entwurf A) — KV2-1 macht die Anruferzeugung selbst fail-closed, ohne Stufenweg

**Belegstelle:** `entwurf-a.md:370` ("KV2-1 — Kostenprofil-Registry (**Struktur, kein
Verhalten**)") und `entwurf-a.md:121`: "Der Store-Mutator ist fail-closed auf die
Profil-Enum ... Ein neuer Wahlpfad, der kein Profil setzt, **kann keinen Call
anlegen**."

**Das Problem:** Das ist nicht "Struktur, kein Verhalten" — das AENDERT das
sicherheitskritischste Verhalten des gesamten Produkts: ob ein Telefonanruf ueberhaupt
entsteht. Die Phase macht den `costProfile`-Enum-Check zur Vorbedingung der
Call-Erzeugung selbst (nicht nur der Kosten-Buchung), und das als ALLERERSTE Phase der
Kette — vor KV2-2, das den Alarmweg erst repariert. Damit gilt fuer den Moment des
Merges: sollte auch nur EIN heute existierender Wahlpfad (oder ein Sonderfall wie ein
Anruf, der vor dem Waehlen scheitert und nie regulaer angelegt wird) beim Umbau
uebersehen werden, blockiert das sofort und vollstaendig echte Anrufe — mit dem
schwaechsten verfuegbaren Sicherheitsnetz, weil der reparierte Alarmweg (KV2-2) noch gar
nicht existiert. Das Abnahmekriterium der Phase ("(c) `npm test` gruen, kein Cent
bewegt sich") beweist nur, dass keine BUCHUNG passiert — es beweist nicht, dass jeder
reale Wahlpfad in Produktion erfasst ist. Ein Inventar-Test kann nur pruefen, was er
kennt.

Der eigene Pre-Mortem des Entwurfs (Abschnitt 9, R1-R8) adressiert dieses Szenario
NICHT. Alle acht dort durchgespielten Ausfaelle handeln von "zu wenig/zu viel gebucht"
oder "Alarm nicht gesehen" — keiner von "ein Anruf konnte gar nicht erst stattfinden".
Genau das ist aber die Kehrseite eines fail-closed-Gates an der Anruferzeugung, und
CLAUDE.md verlangt explizit Pre-Mortem-Denken fuer "was passiert, wenn ... Kosten
explodieren" — die spiegelbildliche Frage "was passiert, wenn niemand mehr anrufen
kann" fehlt in der Analyse vollstaendig.

**Vergleich mit Entwurf B:** Der Katalog aus KV2-P1 ist nach eigener Aussage bis
einschliesslich P4 **inert** ("Nichts liest den Katalog produktiv", `entwurf-b.md:279`;
P4-Abnahme verifiziert per Spion, dass `applyCostCorrectionCents` NICHT aufgerufen
wird). Selbst wenn B's Vollstaendigkeits-Praedikat (P5) einen Fehler haette, ist die
schlechteste Folge "kein Refund" — niemals "kein Anruf". B traegt dieses Risiko nicht.

**Abhilfe:** KV2-1 in zwei Schritte teilen: zuerst der Registry-Check als reines
WARN-Log bei fehlendem Profil (additiv, blockiert nichts), erst NACH einer
Beobachtungsperiode (oder nach KV2-2, wenn der Alarmweg steht) auf fail-closed
umschalten. Bis dahin ist "Struktur, kein Verhalten" nur dann wahr, wenn der Store-
Mutator tatsaechlich nicht ablehnt, sondern nur meldet.

---

## Befund 2 (ernst, Entwurf B) — Routen-Erkennung ueber Feld-Inferenz statt Deklaration hat eine unspezifizierte Luecke

**Belegstelle:** `entwurf-b.md:87-91`: "Die Route wird aus dem Anruf abgeleitet
(EL-Outbound: `call.sipCallId !== null`; Telnyx-Outbound: `call.callControlId !==
null`; Inbound: `direction`), **nicht** aus einem Flag, das jemand setzen kann."

**Das Problem:** Der Entwurf begruendet das explizit als bewusste Entscheidung gegen
ein setzbares Feld (Sorge: falsch gesetztes Flag). Das ist ein legitimes Argument, aber
es tauscht ein Risiko gegen ein anderes, unadressiertes: die Inferenz funktioniert nur
fuer Anrufe, die tatsaechlich so weit gekommen sind, dass eine der beiden IDs vergeben
wurde. Fuer einen Anruf, der VOR der ID-Vergabe scheitert (z. B. Ablehnung durch ein
vorgelagertes Gate, Provider-Fehler beim Waehlen selbst) liefert die Inferenz
**keine der beiden Routen** — und das Dokument sagt nicht, was `postenVollstaendig`
in diesem Fall zurueckgibt. Bleibt die Pflicht-Traeger-Menge fuer eine unerkannte Route
leer, ist das Praedikat VAKUOS wahr (0 Pflicht-Traeger, alle erfuellt) — und ein
Anruf mit `estimatedCostCents > 0`, aber ohne erkennbare Route, wuerde die volle
Reserve zurueckerstattet bekommen, obwohl niemand geprueft hat, ob wirklich keine
Kosten entstanden sind. Das ist strukturell genau die Zwei-Zustaende-auf-einem-Label-
Falle, vor der der Auftrag warnt: "keine erkannte Route" und "erkannte Route mit
0 Pflicht-Traegern" duerfen nicht denselben Ausgang (Refund erlaubt) teilen.

Entwurf A umgeht dieses Problem strukturell: `costProfile` wird VOR dem Waehlen
gesetzt (Abschnitt 3.1), also unabhaengig davon, ob eine ID je vergeben wird. Ein
Anruf ohne Profil kann in A gar nicht existieren (siehe Befund 1 fuer den Preis
davon) — aber das bedeutet auch: es gibt in A keinen Anruf mit "unbekannter Route".

**Abhilfe:** `postenVollstaendig` fuer den Fall "keine der bekannten Routen trifft zu"
explizit auf `false` setzen (nie vakuos wahr), und diesen Fall im Fixture-Test aus
KV2-P5 als eigene Zeile fuehren.

---

## Befund 3 (ernst, Entwurf A) — KV2-5 entscheidet eine Owner-Frage, ohne sie als solche zu kennzeichnen

**Belegstelle:** `entwurf-a.md:408` (KV2-5, "Perioden-Anker-Symmetrie fuer POSITIVE
Nachbuchungen") beschreibt die Aenderung an `bookCents` als reinen Bugfix einer
"echten, ungetesteten Asymmetrie" und baut sie ungefragt in die Kette ein. Abschnitt 10
("Entscheidungen, die dem Eigentuemer gehoeren") fuehrt sechs Punkte — diese Aenderung
ist NICHT darunter.

**Das Problem:** Ob eine positive Nachbuchung aus einer abgelaufenen Periode die
LAUFENDE Kostendecke belastet oder nur eine periodenunabhaengige Lebenszeit-Achse
trifft, ist eine Entscheidung mit direkter Wirkung auf die pro-Tenant-Kostendecke —
genau die Achse, die CLAUDE.md als "nicht ohne ausdrueckliche Owner-Entscheidung
anfassen" markiert (Absolute Regel 1, Budget-Achsen-Abschnitt). Entwurf B behandelt
GENAU dieselbe Aenderung (KV2-P5b, `entwurf-b.md:351-358`) korrekt als offene
Owner-Entscheidung: "legt fest, ob die Nachbuchung ausserhalb ihres Ankers nur die
Lebenszeit-Achse trifft ... das ist eine Owner-Entscheidung (§9), die Phase
implementiert die getroffene." Dieselbe Aenderung wird in A stillschweigend als
technischer Fix durchgewunken.

**Abhilfe:** KV2-5 in A um die Frage aus B's P5b ergaenzen und als siebten Punkt in
Abschnitt 10 aufnehmen, bevor die Phase gebaut wird.

---

## Befund 4 (hinweis, Entwurf A) — Widerspruch zwischen Abnahme-Erzaehlung und eigenem Pre-Mortem

**Belegstelle:** `entwurf-a.md:132`: "Am 19.08. haette dieser Test den ConvAI-Umstieg
gestoppt" (KV2-1-Begruendung) vs. `entwurf-a.md:521-524` (R4): "Restrisiko,
akzeptiert: jemand traegt einen neuen Pfad in ein BESTEHENDES Profil ein, dessen
Traegerliste nicht passt. Der Test faengt das Fehlen, nicht die Falschzuordnung."

**Das Problem:** Beide Saetze koennen nicht gleichzeitig ohne Einschraenkung gelten.
Der Inventar-Test faengt zuverlaessig NUR einen Wahlpfad ohne JEDES Profil. Der
19.08.-Fall war aber (aus heutiger Sicht) genau ein neuer Anbieter innerhalb eines
Themas, das schon ein Profil gehabt haben koennte ("wir waehlen aus", nur die
Kostenstruktur dahinter aenderte sich) — ob der Test diesen konkreten Fall wirklich
gestoppt haette, haengt davon ab, ob jemand beim Bau des neuen Zweigs ein bestehendes
Profil wiederverwendet oder ein neues benannt haette. Der Text in KV2-1 verkauft eine
Garantie, die R4 selbst relativiert. Das ist kein Sachfehler, sondern eine
Ueberzeichnung an der Stelle, die den Nutzen der Phase begruenden soll — sollte
korrigiert werden, damit niemand aus der Kette den Test fuer staerker haelt, als er
ist.

**Abhilfe:** Den Satz in KV2-1 auf das begrenzen, was R4 zulaesst ("haette einen
KOMPLETT unprofilierten Zweig gestoppt — nicht garantiert einen mit falscher
Traegerliste in einem bestehenden Profil").

---

## Befund 5 (hinweis, Entwurf B) — Wiedervereinigung von Kosten- und Erloes-Daten in `usage_event` verlangt eine Allowlist statt struktureller Unmoeglichkeit

**Belegstelle:** `entwurf-b.md:71` (`STRIPE_METERED_KINDS`) und `entwurf-b.md:404`
(KV2-P9: neue `kind`s `provider_conversation`/`provider_telephony` landen in
`usage_event`, `flushableMeterEvents` filtert sie gegen die Allowlist heraus).

**Das Problem:** B begruendet die Vereinheitlichung von Gate-Achse und Ledger als
Kernvorteil gegenueber "zweier von Hand parallel gepflegter Buecher" (Zielbild, §1) —
genau das G5-Argument, das der Auftrag einfordert. Der Preis: Lieferantenkosten landen
jetzt in DERSELBEN Tabelle (`usage_event`), aus der `flushMeters` **jedes** `kind` an
Stripe meldet (BELEGT von B selbst zitiert, `meter.js:65`). Die Trennung "das ist
Einkauf, nicht Verkauf" haengt danach an einer gepflegten Allowlist, nicht an einer
strukturellen Unmoeglichkeit — exakt das Muster, das G27 ("Struktur statt Konvention")
und die eigene Fallgeschichte des Projekts (drei gescheiterte Versuche laut Auftrag)
als Risikoklasse benennen. B mildert das durch zwei konkrete Tests (P1(3), P9(3), die
`STRIPE_METERED_KINDS`-Inhalt und Nicht-Aufruf von `reportMeter` fuer die neuen kinds
pruefen) und die Ausfallrichtung ist die sichere (ein vergessener Eintrag fuehrt zu
NICHT-Berechnung, nicht zu Doppelberechnung) — deshalb nur "hinweis", kein "ernst".
Entwurf A vermeidet die Fallklasse vollstaendig, indem das Kosten-Buch eine eigene,
niemals von `flushMeters` gelesene Tabelle ist (`entwurf-a.md`, Abschnitt 2.0).

**Abhilfe:** Keine zwingende Aenderung noetig, wenn die zwei genannten Tests wirklich
gebaut werden. Wer maximale Sicherheit will, haelt Kosten- und Erloes-Tabelle getrennt
(wie A) und akzeptiert dafuer zwei Tabellen statt einer Projektion.

---

## Befund 6 (hinweis, Entwurf B) — `postenSummeMikroCents` spezifiziert das Verhalten fuer nicht-`gemessen`e Posten nicht

**Belegstelle:** `entwurf-b.md:84`: "`postenSummeMikroCents(posten)` — Summe der
Betraege, alle in Anbieter-Waehrung, ohne Umrechnung." Kein Wort dazu, ob Posten im
Zustand `erwartet` (Betrag `NULL`) oder `beleg_ausgeblieben` in die Summe eingehen.

**Das Problem:** Der Auftrag verlangt ausdruecklich, "kein Beleg" nie mit "Beleg sagt
0" zu verwechseln. Ein `NULL`-Betrag, der in einer Summierung als 0 behandelt wird
(z. B. durch `SUM()` in SQL oder eine JS-Reduktion mit `+`), ergibt zufaellig das
richtige Teilsummen-Ergebnis — aber aus dem falschen Grund, und die Spezifikation
sagt nicht, dass das Absicht ist. Sollte spaeter jemand `erwartet`-Posten mit
Platzhalter-Betrag `0` statt `NULL` anlegen (naheliegender Bug bei einer Migration),
wuerde derselbe Code plötzlich unbemerkt falsch rechnen, weil die Funktion nie
verlangt hat, nach `zustand` zu filtern.

**Abhilfe:** Vertragstext ergaenzen: "`postenSummeMikroCents` summiert ausschliesslich
Posten mit `zustand: gemessen`; `erwartet`/`beleg_ausgeblieben` tragen keinen Betrag
zur Summe bei" — und einen Test dafuer in KV2-P5 aufnehmen.

---

## Was NICHT gefunden wurde (bewusst notiert, nicht erfunden)

- **G5 (eine Wahrheit je Sachverhalt):** Beide Entwuerfe bestehen den Kerntest. Keiner
  fuehrt eine zweite Waehrungsumrechnung ein (beide referenzieren explizit denselben
  bestehenden Pfad `convertProviderMicroToBucketCents`). Keiner zerlegt `cost_fiat` in
  separat gebuchte Teile (beide buchen die Summe, Teilsummen bleiben Diagnose-Detail —
  A explizit in KV2-3, B explizit in Abschnitt 8 Punkt 7). Keiner fuehrt zwei konkurrierende
  Vollstaendigkeits-Praedikate fuer dieselbe Frage.
- **G27 (Struktur statt Konvention) im Grundsatz:** beide Entwuerfe bauen den
  Kostenarten-Katalog nach dem bestehenden, bewaehrten Muster
  (`cost-ledger-map.js`, Validierung beim Modul-Import) und fuegen einen
  Inventar-Test hinzu, der eine VERGESSENE Kostenart beim Bauen sichtbar machen soll.
  Der Unterschied liegt nicht im Prinzip, sondern in der Durchsetzungsstelle (siehe
  Befund 1 und 2).
- **Magic Numbers / tote Pfade / abgeschaltete Sicherungen:** keine gefunden. Beide
  Entwuerfe fuehren neue Schwellenwerte ausschliesslich als benannte, konfigurierbare
  Parameter mit begruendetem Default ein (`COST_SETTLE_DEADLINE_HOURS`,
  `EL_EVIDENCE_MIN_AGE_MINUTES` in A; `KOSTENPOSTEN_MAX_VERSUCHE`,
  `KOSTENPOSTEN_MAX_ALTER_H`, `KOSTEN_HEARTBEAT_FENSTER_H` in B). Keiner schwaecht ein
  Safety-Gate, beide bestehen ausdruecklich darauf, dass Rueckerstattung nur bei
  vollstaendigem Beleg moeglich bleibt (die Kernasymmetrie aus dem Bestand).
- **Benennung:** keine Namen gefunden, die etwas behaupten, das die Sache nicht tut.
  `costProfile`/`CALL_COST_PROFILE` (A) und `kostenarten`/`postenVollstaendig` (B)
  sind praezise. `trueUpBookedCents` (B) ist englisches Fachjargon in einer sonst
  deutsch kommentierten Codebasis, aber sachlich korrekt und kein Verstoss.
- **Phasenkette-Zerlegung, uebrige Phasen:** ausser den beiden benannten Faellen
  (Befund 1 bei A, indirekt Befund 2 bei B) zerfaellt die Kette in beiden Entwuerfen
  wirklich in einzeln lieferbare, einzeln testbare Stuecke. Insbesondere B's explizite
  "inert bis P5"-Eigenschaft (jede Phase P0-P4 beweist per Abnahmekriterium, dass sie
  keinen Cent bewegt) ist ein sauberes Muster, das A fuer seine Kosten-Buch-Phasen
  (KV2-3, KV2-4) ebenfalls hat — nur eben nicht fuer KV2-1 selbst.

---

## Gesamtbild

Kein Entwurf hat einen Konstruktionsfehler in der eigentlichen Geldrechnung: beide
respektieren "eine Wahrheit je Sachverhalt", vermeiden Magic Numbers, ruehren keine
Safety-Gates an und halten die Nie-erstatten-ohne-Vollbeleg-Asymmetrie hoch. Der
entscheidende Unterschied liegt in der DURCHSETZUNGSSTELLE der neuen Struktur: Entwurf
A erzwingt Vollstaendigkeit an der Anruferzeugung selbst (staerkere Dauer-Garantie,
aber ein scharfes Erst-Deploy-Risiko fuer das Kerngeschaeft, Befund 1) waehrend
Entwurf B die Vollstaendigkeitspruefung strikt auf die Nachbereitung beschraenkt
(schwaechere Garantie bei Rand-Faellen wie nie-gewaehlten Anrufen, Befund 2, aber ohne
Risiko fuer die laufende Telefonie). Beide Luecken sind mit klar benannten, kleinen
Aenderungen schliessbar, ohne die jeweilige Grundarchitektur zu verwerfen.
