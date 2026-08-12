# Clean-Code-Referenz — Auftrag für den LLM-Prüfer (gekürzt)

> Dies ist der **Auftrag** für den LLM-Prüfer, keine neue Wissensbasis. Die vollständige
> Referenz mit allen 82 IDs, Vorher/Nachher-Beispielen und ausführlichen Erläuterungen
> bleibt unverändert unter `.claude/refs/clean-code.md` bestehen — bei Unklarheiten dort
> nachschlagen. Dieses Dokument enthält nur noch, was ein Werkzeug **nicht** sicher
> abdeckt: was die Maschine bereits fängt, kostet hier nur Aufmerksamkeit und wurde
> gestrichen (Begründung je ID im Abschnitt „Gestrichen und warum" am Ende).
>
> Maschinell läuft: `npm run lint` (ESLint — das **GATE**, Exit-Code ungleich 0
> blockiert), `npm run dup` (jscpd, Duplizierung, ohne Schwelle — reines
> Messinstrument), `npm run deadcode` (knip, ungenutzte Dateien/Exports, ohne
> Schwelle) und `npm run coverage` (c8, ohne Schwelle und ohne vollständige
> Basiszahl — siehe T2). **Was der Linter meldet, ist immer BLOCKER**, unabhängig
> davon, welchem Schweregrad S1–S4 der jeweilige Katalogeintrag sonst zugeordnet wäre.

## Wie du dieses Dokument benutzt

> Einträge mit dem Marker **`[Prozess/Repo]`** betreffen Build, Test-Prozess, Tooling,
> zeitliche Reihenfolge oder Autoren-Intention und sind aus einem reinen
> Datei-Snapshot/Diff **nicht** zuverlässig entscheidbar — Umgang siehe Audit-Regel 7.

Gehe **Kategorie für Kategorie, Eintrag für Eintrag** durch den geprüften Code. Pro
Eintrag triffst du eine von drei Bewertungen:

- **PASS** — Anforderung erfüllt.
- **FLAG** — Verstoß. Gib aus: `ID · Schweregrad · Datei:Zeile · was den Verstoß ausmacht · konkreter Fix`.
- **n. z.** — im vorliegenden Code nicht anwendbar (oder nicht aus dem Code entscheidbar, siehe Regel 7).

Regeln für deinen Audit:

1. **Bewerte nur Code, den du tatsächlich siehst.** Erfinde keine Verstöße, rate nicht über Ungesehenes, FLAGge nichts „auf Verdacht".
2. **Schweregrad S1–S4 nach der Design-Priorität (siehe P1):** **S1** Tests · **S2** Duplizierung · **S3** Ausdrucksstärke · **S4** Anzahl Klassen/Methoden. S1 wiegt am schwersten, S4 am leichtesten — ordne jeden FLAG einer Stufe zu. **Korrektheits-/Sicherheitsverstöße** (Datenverlust, Geld als Fließkomma, abgeschaltete Sicherungen, Race Conditions) zählen wie **S1**, auch wenn sie keine der vier Regeln direkt betreffen.
3. **Vorrang Lesbarkeit.** Würde das Beheben den Code im Einzelfall _unklarer_ machen, FLAGge nicht — oder markiere es als bewusste, begründete Ausnahme.
4. **Java-Einträge nur bei Java.** Sonst den Geist übertragen, nicht die Syntax. (In diesem Repo — Node.js/ESM — sind Java-Einträge ohnehin bereits gestrichen, siehe unten.)
5. **Scope = die geänderten/geprüften Dateien.**
6. **Gib am Ende eine kurze Gesamtbewertung:** Anzahl FLAGs je Schweregrad (S1–S4) + die 1–3 wichtigsten To-dos.
7. **`[Prozess/Repo]`-Einträge nur bei direkter Evidenz im Scope bewerten.** Diese Checks sind aus dem Snapshot/Diff nicht entscheidbar (z. B. ob ein Test _zuerst_ geschrieben wurde, ob der Build _ein_ Schritt ist, ob ein Coverage-Tool läuft). FLAGge sie **nur**, wenn der Beleg unmittelbar sichtbar ist. Sonst **n. z.** — niemals raten (Regel 1).
8. **Ausgabe priorisieren (gegen FLAG-Flut).** **S1/S2-FLAGs** einzeln und vollständig melden. **S3/S4-FLAGs** (Stil-/Kleinkram) am Ende **gebündelt** auflisten (gleicher ID-Typ zusammenfassen), nicht einzeln im Fließtext.

---

## P — Prinzipien & Design

**P1 — Vier Regeln einfachen Designs (priorisiert).** (1) besteht alle Tests, (2) keine Duplizierung, (3) drückt die Absicht aus, (4) minimiert Anzahl Klassen/Methoden — diese Reihenfolge **definiert die Schweregrade S1–S4** (siehe Audit-Regel 2). Signal: fehlende/rote Tests (S1); dieselbe Logik mehrfach (S2); kryptische, intentionsfreie Namen/Strukturen (S3); Indirektion ohne Mehrwert, Ein-Methoden-Klassen ohne Grund (S4, auch dogmatische Over-Fragmentierung).

**P2 — SRP.** Ein Modul hat genau einen Grund zur Änderung. Signal: lässt sich nicht ohne „und/oder/aber" beschreiben; Namen wie `Manager`/`Processor`; gemischte Zuständigkeiten (Fachlogik + Persistenz + Formatierung). (vgl. G17)

**P3 — OCP.** Offen für Erweiterung, geschlossen für Änderung. Signal: eine Klasse mit mehreren Gründen zur Änderung; eine neue Variante zwingt zum Eingriff in bestehenden Code statt zu einer neuen Subklasse/einem neuen Branch. Fix: Abstraktum + je eine Implementierung pro Variante statt einer wachsenden `switch`-Gott-Klasse.

**P4 — DIP.** **Werkzeug: keins verdrahtet — bleibt vollständig beim Prüfer.** Von Abstraktionen abhängen, nicht von konkreten Details. Signal: Fachklasse `new`t eine konkrete Implementierung selbst oder hält ein konkretes Framework-/IO-/Netzwerk-Objekt als Feld; Tests brauchen echte Infrastruktur statt eines Stubs. Fix: Interface/Port + Injektion über Konstruktor/Parameter.

**P5 — Command-Query-Trennung.** Eine Funktion tut etwas **oder** gibt etwas zurück, nie beides. Signal: Funktion ändert Zustand **und** liefert einen Wert, auf den der Aufrufer verzweigt (`if (set(...))`). (vgl. F2, F3)

**P6 — Keine Nebeneffekte.** Signal: Name verspricht eine Sache, Body ändert zusätzlich Felder/Parameter/Globals. Fix: Nebeneffekt entweder entfernen oder in den Namen aufnehmen. **Werkzeug:** `no-param-reassign` fängt Mutation eines übergebenen Parameters/dessen Properties; der Prüfer beurteilt Mutation von Klassen-State/Globals und ob der Funktionsname die Wirkung ehrlich beschreibt. (vgl. N7)

**P7 — Objekt vs. Datenstruktur bewusst wählen; keine Hybride.** Objekte verbergen Daten + exponieren Verhalten; Datenstrukturen exponieren Daten + haben kein Verhalten. Signal: Klasse mit öffentlichen Feldern/Accessoren **und** Geschäftslogik gleichzeitig.

**P8 — Exceptions mit Kontext.** Signal: Catch, der nichts Diagnostizierbares loggt. **Werkzeug:** `unicorn/error-message` fängt `new Error()` ganz ohne Message; der Prüfer beurteilt, ob eine vorhandene Message wirklich die gescheiterte Operation nennt und ob der Catch-Block sauber loggt.

**P9 — Exception-Klassen nach Aufrufer-Sicht.** Fehler danach klassifizieren, _wie_ sie gefangen werden — nicht nach technischer Quelle. Signal: viele Exception-Typen nach technischer Herkunft, die der Aufrufer aber identisch behandelt; fehlender gemeinsamer Wrapper an der Grenze.

**P11 — TDD-Gesetze.** `[Prozess/Repo]` — zeitliche Reihenfolge (Test zuerst, minimaler Test, minimaler Produktionscode) ist aus einem Snapshot nicht sichtbar und bleibt n. z. Aus Code direkt prüfbar: fehlt **jeder** Test zu neuem Produktionscode → S1-FLAG. **Werkzeug:** `c8`/`npm run coverage` kann für eine Datei zeigen, ob ihr Code überhaupt von einem Test erreicht wird (reiner Existenznachweis); der Prüfer beurteilt Reihenfolge und Minimalität.

**P12 — F.I.R.S.T.** **Werkzeug: keins verdrahtet — bleibt vollständig beim Prüfer.** Fast, Independent, Repeatable, Self-validating, Timely. Aus Code prüfbar (FLAGgen): Tests mit gemeinsamem veränderlichem Zustand oder Reihenfolge-Abhängigkeit (I); echtem Netz/DB/Uhr/Zufall ohne Abstraktion (R); ohne Assertion, die nur loggen (S). Fast/Timely sind Prozess-Eigenschaften (vgl. T9, `[Prozess/Repo]`).

**P13 — Build-Operate-Check.** Testdaten bauen → Operation ausführen → Ergebnis prüfen, Setup hinter Helper-Methoden verstecken. **Werkzeug:** `max-lines-per-function` (>100 Zeilen) fängt XXL-Testfunktionen als grobes Symptom; der Prüfer beurteilt, ob die drei Phasen inhaltlich erkennbar getrennt sind — auch bei kurzen Tests.

**P14 — Ein Konzept pro Test.** Asserts minimieren; mehrere Asserts nur, wenn sie _ein_ Konzept verifizieren. Signal: Testname mit „and". **Werkzeug:** dieselbe `max-lines-per-function`/`complexity`-Schwelle wie P13/G30 markiert überlange, verzweigte Testfunktionen als Symptom; der Prüfer beurteilt inhaltlich, ob mehrere unabhängige Konzepte gemischt sind. (vgl. T1)

**P15 — Konstruktion von Anwendung trennen.** Objekt-Erzeugung/Verdrahtung gehört nach `main`/Factory/DI-Container, nicht in den Fachcode. Signal: Fachcode enthält `new ConcreteImpl(...)`, Lazy-Init-Antipattern oder Verdrahtungslogik statt fertiger Abhängigkeit. Der BDUF-/Inkrementell-Aspekt ist `[Prozess/Repo]`; aus Code nur sichtbare Über-Vorausplanung (Abstraktionen/Konfiguration ohne aktuellen Nutzer) FLAGgen.

**P16 — Nebenläufigkeit sauber halten.** Eigene Verantwortlichkeit, vom übrigen Code getrennt halten; n. z. ohne echte Parallelität. Signal: geteilter **veränderlicher** Zustand ohne Schutz; nicht-atomares read-modify-write (`x++`, prüfen-dann-handeln, ungeschütztes Lazy-Init); zu große kritische Abschnitte; „nicht reproduzierbare" Fehler, als Einmal-Ereignis abgetan. In diesem Repo relevant für: async/await-Races auf `store`-State, parallele Webhook-Callbacks, Timer vs. WebSocket-Events in `bridge.js`.

---

## C — Kommentare

**C1 — Ungeeignete Information.** Metadaten (Autor, Datum, Change-Log) gehören ins VCS. Signal: `@author`, Datums-/Änderungshistorie, Ticket-Logs im Quelltext.

**C2 — Überholte Kommentare.** Signal: Kommentar widerspricht dem danebenstehenden Code. Fix: aktualisieren oder löschen.

**C3 — Redundante Kommentare.** Signal: `i++ // increment i`, Kommentar über einem Konstruktor, der nur „Konstruktor" sagt. Fix: löschen.

**C4 — Schlecht geschriebene Kommentare.** Signal: schwammige, unvollständige oder fehlerhafte Kommentare ohne klaren Informationswert.

---

## E — Umgebung

**E1 — Build = mehr als ein Schritt.** `[Prozess/Repo]` — nur bei sichtbaren Build-Skripten/CI-Konfig im Scope prüfbar. Signal (falls sichtbar): mehrstufige Build-Anleitung. Sonst n. z.

**E2 — Tests = mehr als ein Schritt.** `[Prozess/Repo]` — nur bei sichtbarer Test-/CI-Konfig prüfbar. Signal (falls sichtbar): Tests erfordern manuelles Setup/mehrere Befehle. Sonst n. z.

---

## F — Funktionen

**F2 — Output-Argumente.** Argument, das mutiert wird, um ein Ergebnis zurückzugeben. Fix: Ergebnis als Rückgabewert. **Werkzeug:** `no-param-reassign` (props: true) fängt Mutation eines übergebenen Objekts/einer übergebenen Collection; der Prüfer beurteilt Fälle außerhalb einfacher Property-Mutation (z. B. Callback-basiertes Befüllen) und ob das Ergebnis sauber als Rückgabewert modelliert ist.

**F3 — Flag-Argumente.** Boolesches Argument → die Funktion tut zweierlei. Signal: boolescher Parameter, der intern eine `if`-Weiche steuert; Aufruf wie `render(true)`. Fix: zwei getrennte Funktionen. (Breiter: G15 Selektor-Argumente.)

---

## G — Allgemein

**G1 — Mehrere Sprachen in einer Quelldatei.** Signal: mehrere fremde Syntaxen in einer Datei (z. B. große Inline-Strings mit fremder Syntax). Fix: Umfang fremder Sprachen pro Datei minimieren.

**G2 — Offensichtliches Verhalten nicht implementiert (Least Astonishment).** Signal: Name verspricht mehr, als der Body leistet.

**G3 — Falsches Verhalten an den Grenzen.** Auf Intuition statt Tests vertraut. **Werkzeug:** `c8` (`npm run coverage`) zeigt nie ausgeführte Branches/Zeilen als Kandidaten für unbehandelte Grenzfälle; der Prüfer beurteilt, ob eine konkrete Grenze (leer/null/0/Max/negativ) tatsächlich fehlt oder falsch behandelt ist. (vgl. T5)

**G4 — Übergangene Sicherungen.** Schweregrad **S1**. **Werkzeug:** ESLint `noInlineConfig`/`reportUnusedDisableDirectives` blockt eslint-disable-Kommentare, `no-restricted-syntax` blockt `test.skip`/`it.skip`/`describe.skip`/`{skip:true}`; der Prüfer beurteilt alles daneben: abgeschaltete Sicherungen außerhalb ESLint (auskommentierte Assertions, handgepflegte Prüf-Umgehungen, „fixe ich später"-Kommentare ohne technischen Skip).

**G5 — Duplizierung.** Die wichtigste Regel, Schweregrad **S2**. Jede Duplizierung = verpasste Abstraktion. **Werkzeug:** `jscpd` fängt textgleiche Wiederholung über das GANZE Repo (Form 2 ganz, Form 3 teilweise); der Prüfer beurteilt strukturelle Duplizierung ohne Textgleichheit (Form 1, Template-Method-Kandidaten) — und ist laut Audit-Regel 5 nur für geänderte Dateien zuständig, während jscpd auch Duplizierung gegen unveränderten Bestand abdeckt. (siehe G23)

**G6 — Falsche Abstraktionsebene.** Signal: Basisklasse/-Interface enthält Methode/Konstante, die nur für _eine_ konkrete Implementierung Sinn ergibt.

**G7 — Basisklasse hängt von abgeleiteten Klassen ab.** Signal: Basisklasse referenziert Namen ihrer Subklassen (`instanceof Sub`, Import der Subklasse). Ausnahme: feste FSM mit Dispatch in der Basis, gemeinsam ausgeliefert.

**G8 — Zu viele Informationen.** Breite, tiefe Interfaces. Signal: Klasse exponiert viele öffentliche Methoden/Felder; üppige `protected`-Schnittstelle. Fix: kleine, knappe Interfaces.

**G10 — Vertikale Trennung.** Signal: lokale Variable Dutzende Zeilen vor erster Nutzung deklariert; private Funktion weit vom Aufrufer entfernt.

**G11 — Inkonsistenz (Least Astonishment).** Signal: wechselnde Namen für dasselbe Konzept; uneinheitliche Methodennamen für analoge Operationen.

**G12 — Müll.** **Werkzeug:** `no-unused-vars` fängt ungenutzte Variablen/Imports, `no-useless-constructor` fängt leere Weiterreich-Konstruktoren; der Prüfer beurteilt den Rest: ungenutzte Felder, inhaltsleere Kommentare, leere Default-Konstruktoren außerhalb dessen, was die beiden Regeln erfassen.

**G13 — Künstliche Kopplung.** Signal: allgemeines Enum/Konstante in einer speziellen Klasse eingeschlossen, sodass Verwender die spezielle Klasse importieren müssen.

**G14 — Feature Envy.** Signal: Methode ruft überwiegend Accessoren/Mutatoren eines fremden Objekts auf, um dessen Daten zu manipulieren. Fix: Logik dorthin verschieben, wo die Daten leben.

**G15 — Selektor-Argumente.** Jedes Argument, das nur Verhaltensvarianten umschaltet. Signal: Aufruf wie `calculateWeeklyPay(false)`, bei dem der Leser nachschlagen muss, was der Wert bedeutet. Fix: getrennte Funktionen.

**G16 — Verschleierte Absicht.** **Werkzeug:** `id-length` (min 2, Ausnahme i/j/k) fängt kryptische Ein-Buchstaben-Namen außerhalb der Ausnahmen; der Prüfer beurteilt Run-on-Ausdrücke, Hungarian Notation und alles, was trotz längerem Namen unklar bleibt.

**G17 — Falsch platzierte Verantwortung.** Code nicht dort, wo der Leser ihn sucht. Frage: „Wo würde jemand das suchen?" (vgl. P2)

**G18 — Fälschlich `static`.** Signal: statische Methode, die alle Daten aus Argumenten zieht, aber fachlich variieren könnte (Polymorphie ausgeschlossen). Faustregel: im Zweifel non-static.

**G19 — Aussagekräftige Zwischenvariablen.** Signal: lange, verschachtelte Ausdrücke ohne benannte Zwischenergebnisse. Eine der wirksamsten Lesbarkeits-Maßnahmen.

**G20 — Funktionsnamen sagen, was sie tun.** Signal: man muss den Aufrufer/die Implementierung ansehen, um das Verhalten (insb. Mutation vs. Neu-Objekt) zu verstehen.

**G22 — Logische → physische Abhängigkeiten.** Signal: ein Modul pflegt eine Konstante/Annahme, die eigentlich einem anderen Modul gehört, statt es zu fragen.

**G23 — Polymorphie statt `switch`/`if-else`.** **Werkzeug: keins verdrahtet — bleibt vollständig beim Prüfer.** Zuerst eine polymorphe Lösung erwägen. Signal: wiederholte `switch`/`if-else` über denselben Typ-Diskriminator in mehreren Modulen. One-Switch-Regel: pro Auswahl-Art nur _ein_ `switch`, das die polymorphen Objekte erzeugt; jeder weitere `switch` über denselben Diskriminator ist Duplizierung (vgl. G5). Bewusste Ausnahme: Factory, wo neue Funktionen statt neuer Typen dazukommen.

**G24 — Konventionen beachten.** Signal: Abweichung vom im Projekt sichtbaren Codierstandard (Klammern, Benennung, Reihenfolge).

**G26 — Präzise sein (Vagheit = Faulheit).** Signale, alle FLAGgen, tendenziell S1: Geld als Fließkomma; `null`-Rückgabe ungeprüft verwendet; angenommen, der erste DB-Treffer sei der einzige; Locks weggelassen, weil Konflikt „unwahrscheinlich"; zu einschränkender/zu offener Typ (konkrete Collection statt Interface, alles `protected` per Default).

**G27 — Struktur > Konvention.** Signal: Verlass auf Disziplin (`switch` über Enum, das jeder Verwender korrekt erweitern muss), wo eine erzwingende Struktur die Implementierung sichern würde.

**G28 — Bedingungen einkapseln.** Signal: zusammengesetzte boolesche Logik direkt im `if` statt hinter einer benannten Prädikatsfunktion.

**G30 — Eine Aufgabe pro Funktion.** **Werkzeug:** `complexity` (McCabe >10) und `max-lines-per-function` (>100 Zeilen) fängt grobe Symptome (zu lang/zu verzweigt); der Prüfer beurteilt, ob eine Funktion inhaltlich mehrere Aufgaben/Abstraktionsebenen mischt, auch wenn sie kurz und linear bleibt (mehrere erkennbare Abschnitte/Absätze).

**G31 — Verborgene zeitliche Kopplungen.** Signal: Methoden müssen in fester Reihenfolge aufgerufen werden, aber nichts in den Signaturen erzwingt sie. Fix: Bucket-Brigade — jede Funktion liefert, was die nächste braucht.

**G32 — Keine Willkür.** Signal: Struktur ohne erkennbare Begründung. Jede Struktur muss begründet und als systematisch erkennbar sein.

**G33 — Grenzbedingungen einkapseln.** Signal: derselbe `+1`/`-1`-Ausdruck mehrfach verstreut statt einmal benannt.

**G34 — In Funktionen nur eine Abstraktionsebene tiefer.** Signal: High-Level-Aufrufe und Low-Level-Details (String-/Byte-Gefrickel) nebeneinander in derselben Funktion. Eine der schwersten Heuristiken; mit Augenmaß (Vorrang Lesbarkeit) prüfen.

**G35 — Konfigurierbare Daten hoch ansiedeln.** **Werkzeug:** `no-restricted-properties` verbietet `process.env` außerhalb `src/config.js`; der Prüfer beurteilt alle anderen tief vergrabenen Default-/Konfigurationswerte, die nicht über `process.env` laufen. In diesem Repo: alle konfigurierbaren Werte gehören nach `src/config.js`.

**G36 — Transitive Navigation vermeiden (Law of Demeter).** Ein Modul kennt nur seine unmittelbaren Mitarbeiter. **Werkzeug:** `no-restricted-syntax` (Demeter-Selektor) fängt Aufrufketten ab dem 5. verketteten Punktzugriff (`a.b.c.d.e`); der Prüfer beurteilt kürzere, aber trotzdem unpassende Ketten (Kenntnis fremder interner Struktur schon bei 2–4 Punkten).

---

## N — Namen

**N1 — Deskriptive Namen.** Namen tragen ~90 % zur Lesbarkeit bei. **Werkzeug:** `id-length` (min 2, Ausnahme i/j/k) fängt Ein-Buchstaben-Namen außerhalb der Ausnahmen; der Prüfer beurteilt längere, aber trotzdem kryptische Namen (`kk`, `tmp2`, `data2`) und ob der Name den Zweck wirklich trifft.

**N2 — Namen auf der Abstraktionsebene der Klasse/Funktion.** Signal: Name legt sich auf eine konkrete Implementierung fest, die später bricht (`phoneNumber` statt `connectionLocator`).

**N3 — Standardnomenklatur / Ubiquitous Language.** Signal: eigene Erfindung, wo ein etablierter Begriff existiert; Code spricht nicht die Fachsprache der Domäne. Erst Standard, dann eigene Erfindung.

**N4 — Eindeutige Namen.** Signal: zwei ähnliche Funktionen im selben Modul, deren Unterschied der Name nicht verrät.

**N5 — Lange Namen für große Geltungsbereiche.** Namenslänge proportional zum Scope. Signal: kurze Namen für weit gestreute/lang lebende Variablen. Kurze Namen (`i` in einer engen Schleife) in winzigen Scopes sind **richtig** — nicht FLAGgen.

**N6 — Codierungen vermeiden.** **Werkzeug: keins verdrahtet — bleibt vollständig beim Prüfer.** Signal: Typ-/Scope-Präfixe (`m_`, `f`), Subsystem-Präfixe (`vis_`), Hungarian Notation.

**N7 — Namen beschreiben Nebeneffekte.** Tut die Funktion mehr als das simple Verb, muss der Name das sagen. Signal: `get…`/`is…`-Name bei einer Funktion, die nebenbei erzeugt, initialisiert oder mutiert. (vgl. P6)

---

## T — Tests

**T1 — Unzureichende Tests.** „Scheint genug" reicht nicht. **Werkzeug:** `c8` (`npm run coverage`) zeigt Zeilen-/Branch-Lücken; der Prüfer beurteilt, ob die abgedeckten wie unabgedeckten Fälle fachlich relevant sind — Coverage allein beweist keine Korrektheit, nur Ausführung.

**T2 — Coverage-Tool verwenden.** `[Prozess/Repo]`. **Nicht belegt:** `c8` ist installiert und konfiguriert (`npm run coverage`), aber ein vollständiger Lauf über die gesamte Suite wurde nie zu Ende gemessen (Zeitfenster gesprengt). Als Praxis-Nachweis gilt das **nicht** als erbracht — T2 bleibt vollständig beim Prüfer, ohne Werkzeug-Rückendeckung, bis eine Basiszahl vorliegt.

**T3 — Triviale Tests nicht überspringen.** Ihr dokumentarischer Wert übersteigt die Kosten. Signal (begrenzt, Abwesenheits-Nachweis): nur FLAGgen, wenn offensichtlich naheliegende triviale Fälle ungetestet sind; sonst n. z.

**T4 — Ignorierter Test = Mehrdeutigkeit.** **Werkzeug:** `no-restricted-syntax` (test/**-Override) fängt `test.skip`/`it.skip`/`describe.skip`/`{skip:true}`; der Prüfer beurteilt, ob eine vorhandene Skip-Begründung nachvollziehbar ist, und ob ein nicht übersprungener, aber sinnlos gewordener Test vorliegt.

**T5 — Grenzbedingungen testen.** Die Mitte stimmt meist, die Ränder werden falsch beurteilt. **Werkzeug:** `c8` zeigt, ob Rand-Branches (leer/null/0/Max/negativ) überhaupt durchlaufen werden; der Prüfer wählt, welche Ränder fachlich nötig sind. (vgl. G3)

**T9 — Tests müssen schnell sein.** `[Prozess/Repo]` — Laufzeit-Eigenschaft. **Werkzeug: keins verdrahtet — bleibt vollständig beim Prüfer.** Aus Code prüfbar nur bei offensichtlichen Mustern: Sleep-Aufrufe im Test, echte Netz-/DB-Calls, große Schleifen. Sonst n. z.

---

## Gestrichen und warum

- **C5** auskommentierter Code → `sonarjs/no-commented-code` (rot-geprüft, erkennt ES6 nach Parser-Fix).
- **F1** zu viele Argumente → `max-params` (max 3, rot-geprüft).
- **F4** tote Funktionen → `knip` (rot-geprüft, erkennt ungenutzte Exports/Dateien).
- **G9** toter Code → `no-unreachable` (rot-geprüft).
- **G25** Magic Numbers → `no-magic-numbers` (ignore 0/1/-1, rot-geprüft).
- **G29** negative Bedingungen → `no-negated-condition` (rot-geprüft).
- **P10** Learning Tests für Drittanbieter-Code → entfällt, `[Prozess/Repo]`: ob eine Integration neu ist, ist aus dem Snapshot nicht entscheidbar.
- **G21** Den Algorithmus verstehen → entfällt, `[Prozess/Repo]`: Autoren-Intention ist aus Code nicht belegbar.
- **T6** Bei einem Bug die Nachbarschaft testen → entfällt, `[Prozess/Repo]`: Vorgehensregel beim Bugfix, kein statischer Check.
- **T7** Muster des Scheiterns zur Diagnose → entfällt, `[Prozess/Repo]`: Diagnose beim Testlauf, kein statischer Check.
- **T8** Coverage-Patterns als Hinweise → entfällt, `[Prozess/Repo]`: Diagnose beim Testlauf, kein statischer Check.
- **J1** Lange Importlisten → entfällt, Java-spezifisch (`import package.*`), im ESM-Repo gegenstandslos.
- **J2** Konstanten nicht vererben → entfällt, Java-spezifisch (Interface-Vererbung für Konstanten), im JS-Repo gegenstandslos.
- **J3** Enums statt `public static final int` → entfällt, Java-spezifisch, im JS-Repo gegenstandslos.

---

**Rechnung:** 68 behaltene IDs + 14 gestrichene IDs = 82.
