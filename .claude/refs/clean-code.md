# Clean-Code-Referenz — Prüfkatalog für den Audit-Agenten

> **Repo-Hinweis (vodafone-agent):** Dieses Repo ist Node.js/ESM (JavaScript, kein TypeScript), ohne Test-Framework und ohne Lint-/Diff-Hook. Die Java-Einträge (J1–J3) sind hier n. z. (Geist übertragen, nicht die Syntax). Test-Einträge (T-Serie, P11–P14): solange kein Test-Framework existiert, tritt an die Stelle automatisierter Tests der dokumentierte Smoke-Test (siehe CLAUDE.md "Befehle") — fehlende Verifikation neuen Verhaltens zählt trotzdem als S1. Sicherheitsrelevante Verstöße (Safety-Gates, Auth, Secrets — siehe CLAUDE.md "Absolute Regeln") zählen immer als S1.

> Dies ist die Wissensbasis, gegen die du Code prüfst. Quelle: *Clean Code* (Robert C. Martin), destilliert. Jeder Eintrag hat eine **ID**, eine **Kurzregel**, ein **Signal** (woran man den Verstoß erkennt) und einen **Fix**. Bei den wichtigsten Heuristiken steht ein **Vorher/Nachher**-Beispiel — daran erkennst du den Verstoß im echten Code am sichersten. Die Beispiele sind in Java (Buchsprache); die Konzepte gelten sprachübergreifend.
>
> Einträge mit dem Marker **`[Prozess/Repo]`** betreffen Build, Test-Prozess, Tooling, zeitliche Reihenfolge oder Autoren-Intention und sind aus einem reinen Datei-Snapshot/Diff **nicht** zuverlässig entscheidbar — Umgang siehe Audit-Regel 7.

## Wie du dieses Dokument benutzt

Gehe **Kategorie für Kategorie, Eintrag für Eintrag** durch den geprüften Code. Pro Eintrag triffst du eine von drei Bewertungen:

- **PASS** — Anforderung erfüllt.
- **FLAG** — Verstoß. Gib aus: `ID · Schweregrad · Datei:Zeile · was den Verstoß ausmacht · konkreter Fix`.
- **n. z.** — im vorliegenden Code nicht anwendbar (oder nicht aus dem Code entscheidbar, siehe Regel 7).

Regeln für deinen Audit:

1. **Bewerte nur Code, den du tatsächlich siehst.** Erfinde keine Verstöße, rate nicht über Ungesehenes, FLAGge nichts „auf Verdacht".
2. **Schweregrad S1–S4 nach der Design-Priorität (siehe P1):** **S1** Tests · **S2** Duplizierung · **S3** Ausdrucksstärke · **S4** Anzahl Klassen/Methoden. S1 wiegt am schwersten, S4 am leichtesten — ordne jeden FLAG einer Stufe zu. **Korrektheits-/Sicherheitsverstöße** (Datenverlust, Geld als Fließkomma, abgeschaltete Sicherungen, Race Conditions) zählen wie **S1**, auch wenn sie keine der vier Regeln direkt betreffen.
3. **Vorrang Lesbarkeit.** Würde das Beheben den Code im Einzelfall *unklarer* machen, FLAGge nicht — oder markiere es als bewusste, begründete Ausnahme.
4. **Java-Einträge (J1–J3) nur bei Java.** Sonst den Geist übertragen, nicht die Syntax. (Die Vorher/Nachher-Beispiele bei anderen IDs sind nur zufällig in Java geschrieben — sie illustrieren sprachunabhängige Prinzipien.)
5. **Scope = die geänderten/geprüften Dateien.**
6. **Gib am Ende eine kurze Gesamtbewertung:** Anzahl FLAGs je Schweregrad (S1–S4) + die 1–3 wichtigsten To-dos.
7. **`[Prozess/Repo]`-Einträge nur bei direkter Evidenz im Scope bewerten.** Diese Checks sind aus dem Snapshot/Diff nicht entscheidbar (z. B. ob ein Test *zuerst* geschrieben wurde, ob der Build *ein* Schritt ist, ob ein Coverage-Tool läuft). FLAGge sie **nur**, wenn der Beleg unmittelbar sichtbar ist (z. B. eine Testdatei liegt im Scope, ein offensichtlich langsamer Test mit echtem Netz-Call). Sonst **n. z.** — niemals raten (Regel 1).
8. **Ausgabe priorisieren (gegen FLAG-Flut).** **S1/S2-FLAGs** einzeln und vollständig melden. **S3/S4-FLAGs** (Stil-/Kleinkram) am Ende **gebündelt** auflisten (gleicher ID-Typ zusammenfassen), nicht einzeln im Fließtext — sonst geht das Wichtige unter.

---

## P — Prinzipien & Design (Fundament, Kap. 1–13)

Diese Konzepte vergibt Kapitel 17 keine eigene ID — sie sind aber Pflicht-Prüfpunkte. **Wertung:** Einträge mit „vgl. <ID>" werden **einmal** unter der dort genannten konkreten ID gezählt; in der P-Sektion dienen sie nur als Prioritäts- und Philosophie-Anker (nicht doppelt FLAGgen). Einträge **ohne** „vgl." (P3, P4, P7–P11, P15, P16) sind selbst der Prüf- und Wertungspunkt.

**P1 — Vier Regeln einfachen Designs (priorisiert).** (1) besteht alle Tests, (2) keine Duplizierung, (3) drückt die Absicht aus, (4) minimiert Anzahl Klassen/Methoden. → Diese Reihenfolge **definiert die Schweregrade S1–S4** (siehe Regel 2). Regel 4 (S4) hat die niedrigste Priorität — auch over-fragmentierten Code (viele winzige Klassen aus Dogmatismus) FLAGgen, aber eben nur als S4.
→ **Signal:** fehlende/rote Tests (S1); dieselbe Logik mehrfach (S2); kryptische, intentionsfreie Namen/Strukturen (S3); Indirektion ohne Mehrwert, Ein-Methoden-Klassen ohne Grund (S4).

**P2 — SRP (Single Responsibility).** Eine Klasse/ein Modul hat genau einen Grund zur Änderung. → **Signal:** lässt sich nicht ohne „und/oder/aber" beschreiben; Namen wie `Manager`, `Processor`, `Super`; gemischte Zuständigkeiten (z. B. Fachlogik + Persistenz + Formatierung in einer Klasse). (vgl. G17)

**P3 — OCP (Open/Closed).** Offen für Erweiterung, geschlossen für Änderung. → **Signal:** eine Klasse mit mehreren Gründen zur Änderung; eine neue Variante zwingt zum Eingriff in bestehenden Code statt zu einer neuen Subklasse; private Methoden, die nur einen Teilfall betreffen (`selectWithCriteria` in einer `Sql`-Gott-Klasse).

```java
// Vorher: eine Gott-Klasse mit mehreren Gründen zur Änderung
public class Sql {
  public String create() { ... }
  public String insert(Object[] fields) { ... }
  public String selectAll() { ... }
  private String selectWithCriteria(...) { ... }   // bezieht sich NUR auf select
}
// Nachher: ein Abstraktum + je eine Subklasse pro Anweisungstyp
abstract public class Sql { abstract public String generate(); }
public class CreateSql extends Sql { ... }
public class SelectSql extends Sql { ... }
public class InsertSql extends Sql { ... }
// Eine neue UpdateSql kommt als neue Subklasse hinzu — bestehender Code bleibt unberührt.
```

**P4 — DIP (Dependency Inversion).** Von Abstraktionen abhängen, nicht von konkreten Details. → **Signal:** Fachklasse `new`t eine konkrete Implementierung selbst oder hält ein konkretes Framework-/IO-/Netzwerk-Objekt als Feld; Tests brauchen echte Infrastruktur (DB, Markt-API, Dateisystem) statt eines Stubs.

```java
// Vorher: hängt direkt von konkreter API ab → Test instabil (echte Marktdaten, Volatilität)
public class Portfolio {
  private TokyoStockExchange exchange;
}
// Nachher: hängt von einer Abstraktion ab, injiziert über den Konstruktor
public interface StockExchange { Money currentPrice(String symbol); }
public class Portfolio {
  private StockExchange exchange;
  public Portfolio(StockExchange exchange) { this.exchange = exchange; }
}
// Im Test: FixedStockExchangeStub liefert feste Werte → stabil und schnell.
```

**P5 — Command-Query-Trennung.** Eine Funktion *tut etwas* **oder** *gibt etwas zurück*, nie beides. → **Signal:** Funktion ändert Zustand **und** liefert einen Wert, auf den der Aufrufer verzweigt (`if (set("x", "y"))`). (vgl. F-Serie)

**P6 — Keine Nebeneffekte.** Eine Funktion tut nur das, was ihr Name verspricht — keine verborgenen Änderungen an Klassen-State, Parametern, Globals. „Nebeneffekte sind Lügen." → **Signal:** Name verspricht eine Sache (`checkPassword`), Body ändert zusätzlich Felder/Parameter/Globals (initialisiert nebenbei eine Session). (vgl. N7)

**P7 — Objekt vs. Datenstruktur bewusst wählen; keine Hybride.** Objekte verbergen Daten + exponieren Verhalten; Datenstrukturen exponieren Daten + haben kein Verhalten. → **Signal:** Klasse mit öffentlichen Feldern/Accessoren **und** Geschäftslogik (Hybrid).

```java
// Smell (Hybrid): Active Record (öffentliche Felder + Navigations-Methoden) MIT Geschäftslogik
public class Employee {
  public String name;
  public Money salary;
  public void save() { ... }                       // Datenstruktur-Teil
  public boolean isEligibleForBonus() { ... }       // Geschäftsregel — gehört hier NICHT hin
}
// Fix: Active Record als reine Datenstruktur behandeln, Geschäftsregeln in ein separates
//      Objekt auslagern, das seine Daten verbirgt.
```

**P8 — Exceptions mit Kontext (Kap. 7.4).** Jede geworfene Exception nennt die gescheiterte Operation und den Typ des Scheiterns, mit einer Meldung, die beim Catch sauber protokolliert werden kann. → **Signal:** nacktes `throw new Exception()` / `throw new RuntimeException()` ohne aussagekräftige Message; Catch, der nichts Diagnostizierbares loggt.

**P9 — Exception-Klassen nach Aufrufer-Sicht (Kap. 7.5).** Fehler danach klassifizieren, *wie* sie gefangen werden — nicht nach technischer Quelle. → **Signal:** viele Exception-Typen nach technischer Herkunft, die der Aufrufer aber alle gleich behandelt (identische Catch-Blöcke); fehlende gemeinsame Wrapper-Exception an der Grenze.

**P10 — Learning Tests für Drittanbieter-Code (Kap. 8).** `[Prozess/Repo]` — nur prüfbar, wenn die Tests im Scope sichtbar sind. Fremde APIs mit Tests absichern, die genau die erwartete Nutzung prüfen. → **Signal (bei sichtbarer neuer Library-Integration):** keine Tests, die das angenommene Verhalten der Fremd-API festnageln. (Ob eine Integration *neu* ist, ist aus dem Snapshot allein nicht sicher erkennbar → im Zweifel n. z.)

**P11 — TDD-Gesetze (Kap. 9).** `[Prozess/Repo]` — die zeitliche Reihenfolge ist aus einem Snapshot **nicht** sichtbar. Kein Produktionscode ohne vorher scheiternden Test; nur so viel Test, wie zum Scheitern nötig; nur so viel Produktionscode, wie zum Bestehen nötig. → **Aus Code prüfbar ist nur:** *ob überhaupt* ein zugehöriger Test existiert (Test-Existenz, nicht „test-first"). Fehlt jeder Test zu neuem Produktionscode → S1-FLAG; alles Weitere n. z.

**P12 — F.I.R.S.T.** Jeder Test ist **F**ast, **I**ndependent (unabhängig von anderen Tests, beliebige Reihenfolge), **R**epeatable (jede Umgebung, auch offline), **S**elf-validating (boolesches Bestanden/Gescheitert, kein manuelles Log-Lesen), **T**imely (kurz vor dem Code geschrieben). → **Aus Code prüfbar (FLAGgen):** Tests, die gemeinsamen veränderlichen Zustand teilen oder auf Ausführungsreihenfolge bauen (I); Tests mit echtem Netz/DB/Uhr/Zufall ohne Abstraktion (R); Tests ohne Assertion, die nur loggen (S). → *Fast (F)* und *Timely (T)* sind Laufzeit-/Prozess-Eigenschaften (vgl. T9, `[Prozess/Repo]`).

**P13 — Build-Operate-Check.** Saubere Tests haben drei Teile: Testdaten bauen → Operation ausführen → Ergebnis prüfen. Setup-Boilerplate hinter Helper-Methoden verstecken. → **Signal:** Test mit 15+ Zeilen Setup/Parsing/Casts inline, ohne erkennbare Build→Operate→Check-Trennung.

```java
// Nachher: drei klar lesbare Schritte statt 20 Zeilen Setup/Parsing/Casts
public void testGetPageHierarchyAsXml() throws Exception {
  makePages("PageOne", "PageOne.ChildOne", "PageTwo");                  // Build
  submitRequest("root", "type:pages");                                  // Operate
  assertResponseContains("<name>PageOne</name>", "<name>PageTwo</name>"); // Check
}
```

**P14 — Ein Konzept pro Test.** Asserts minimieren; mehrere Asserts nur, wenn sie *ein* Konzept verifizieren. → **Signal:** ein Test prüft mehrere unabhängige Konzepte (Asserts zu verschiedenen, nicht zusammenhängenden Aspekten); Testname mit „and". (vgl. T1)

**P15 — Konstruktion von Anwendung trennen (Kap. 11).** Objekt-Erzeugung und Verdrahtung gehören nach `main` / in Factories / einen DI-Container — nicht in den Fachcode gemischt. → **Signal:** Fachcode enthält `new ConcreteImpl(...)`, Lazy-Init-Antipattern oder Verdrahtungs-Logik, statt die fertige Abhängigkeit übergeben zu bekommen.

```java
// Smell: Lazy-Init-Antipattern — Konstruktion mit Laufzeitlogik vermischt
public Service getService() {
  if (service == null)
    service = new MyServiceImpl(...);   // hartcodierte Dependency, Test-Hürde, verstreutes Setup
  return service;
}
// Fix: Verdrahtung nach main / Factory / DI-Container; der Fachcode bekommt die fertige
//      Abhängigkeit übergeben und weiß nichts vom Konstruktionsprozess.
```

Außerdem: **einfachste funktionsfähige Lösung** wählen, **kein BDUF** (inkrementell wachsen). *BDUF ≠ „vorher überhaupt Design machen".* → Der BDUF-/Inkrementell-Aspekt ist eine Prozess-Bewertung (`[Prozess/Repo]`); aus Code FLAGgst du nur sichtbare Über-Vorausplanung (umfangreiche Abstraktionen/Konfiguration ohne aktuellen Nutzer).

**P16 — Nebenläufigkeit sauber halten (Kap. 13).** Nebenläufigkeitscode ist eine **eigene Verantwortlichkeit** → vom übrigen Code trennen. *(Sprachunabhängig; das Java-Beispiel illustriert nur. In Sprachen/Programmen ohne echte Parallelität → n. z.)* → **Signal:** geteilter **veränderlicher** Zustand, auf den mehrere Threads/Tasks/Coroutinen ungeschützt zugreifen; **nicht-atomares read-modify-write** (`x++`, „prüfen-dann-handeln", Lazy-Init ohne Schutz); zu große kritische Abschnitte; mehrere Sperren auf demselben Objekt; „nicht reproduzierbare" Fehler, die als Einmal-Ereignis abgetan werden.

```java
// Smell: scheinbar trivial, aber nicht atomar — ++ sind mehrere Schritte (lesen, erhöhen, schreiben).
// Bei zwei Threads kann lastIdUsed in Konflikt geraten (z. B. beide liefern 43).
public int getNextId() {
  return ++lastIdUsed;
}
```

Fix: geteilte Daten kapseln/kopieren, Tasks unabhängig machen, kritische Abschnitte minimal halten, atomare/`concurrent`-Bausteine der Plattform nutzen (z. B. `AtomicInteger`, Locks, `java.util.concurrent`; in anderen Sprachen das jeweilige Äquivalent). *(In diesem Repo relevant für: async/await-Races auf `store`-State, parallele Webhook-Callbacks, Timer vs. WebSocket-Events in `bridge.js`.)*

---

## C — Kommentare

**C1 — Ungeeignete Information.** Metadaten (Autor, Datum, Change-Log) gehören ins VCS, nicht in den Code. → **Signal:** `@author`, Datums-/Änderungshistorie, Ticket-Logs im Quelltext.

**C2 — Überholte Kommentare.** Veraltet/passt nicht mehr zum Code → gefährlich. → **Signal:** Kommentar widerspricht dem danebenstehenden Code (nennt andere Parameter, anderes Verhalten). Fix: aktualisieren oder löschen.

**C3 — Redundante Kommentare.** Beschreiben, was sich selbst erklärt. → **Signal:** `i++ // increment i`, `// Konstruktor` über einem Konstruktor. Fix: löschen.

**C4 — Schlecht geschriebene Kommentare.** Wenn schon Kommentar, dann sorgfältig: bewusste Wortwahl, korrekte Grammatik. → **Signal:** schwammige, unvollständige oder fehlerhafte Kommentare ohne klaren Informationswert.

**C5 — Auskommentierter Code.** → **Immer FLAGgen, immer löschen.** Steht im VCS. → **Signal:** auskommentierte Anweisungs-/Methodenblöcke.

---

## E — Umgebung

**E1 — Build = mehr als ein Schritt.** `[Prozess/Repo]` — nur bei sichtbaren Build-Skripten/CI-Konfig im Scope prüfbar. Bauen soll *eine* triviale Operation sein. → **Signal (falls sichtbar):** mehrstufige Build-Anleitung (Check-out + mehrere Skripte + manuelle Handgriffe). Sonst n. z.

**E2 — Tests = mehr als ein Schritt.** `[Prozess/Repo]` — nur bei sichtbarer Test-/CI-Konfig prüfbar. Alle Unit-Tests mit *einem* Befehl ausführbar (idealerweise ein Klick). → **Signal (falls sichtbar):** Tests erfordern manuelles Setup/mehrere Befehle. Sonst n. z.

---

## F — Funktionen

**F1 — Zu viele Argumente.** 0 ideal, dann 1, 2, 3; **mehr als 3 FLAGgen**. → **Signal:** Signatur mit ≥4 Parametern, besonders wenn mehrere davon offensichtlich zusammengehören.

```java
// Vorher: drei Argumente, von denen zwei zusammengehören
makeCircle(double x, double y, double radius);
// Nachher: das Konzept hinter den zusammen reisenden Argumenten bekommt einen Namen
makeCircle(Point center, double radius);
```

**F2 — Output-Argumente.** Argument, das mutiert wird, um ein Ergebnis zurückzugeben. → **Signal:** Funktion schreibt in ein übergebenes Objekt/eine übergebene Collection als „Rückgabeweg". Fix: Ergebnis als Rückgabewert; Statuswechsel betrifft das Objekt, auf dem die Methode läuft.

**F3 — Flag-Argumente.** Boolesches Argument → die Funktion tut zweierlei (eins für `true`, eins für `false`). → **Signal:** boolescher Parameter, der intern eine `if`-Weiche steuert; Aufruf wie `render(true)`.

```java
render(boolean isSuite);                 // Vorher: Flag schaltet zwei Verhalten
renderForSuite();  renderForSingleTest(); // Nachher: zwei Funktionen
```

(Breiter: G15 Selektor-Argumente.)

**F4 — Tote Funktionen.** Nie aufgerufene Methoden. → **Signal:** Methode ohne Aufrufer im Scope. → **Löschen.** (vgl. G9)

---

## G — Allgemein

**G1 — Mehrere Sprachen in einer Quelldatei.** → **Signal:** Java + HTML + XML + JS in einer Datei (z. B. große Inline-Strings mit fremder Syntax). Fix: Anzahl/Umfang fremder Sprachen pro Datei minimieren.

**G2 — Offensichtliches Verhalten nicht implementiert (Least Astonishment).** Funktion tut nicht, was ihr Name vernünftigerweise erwarten lässt. → **Signal:** Name verspricht mehr, als der Body leistet (keine Abkürzungen/Groß-Klein-Toleranz, wo man sie erwartet).

```java
Day day = DayDate.StringToDay("Montag");
// Erwartung: liefert Day.MONTAG, übersetzt gängige Abkürzungen, ignoriert Groß-/Kleinschreibung.
// Fehlt das, verliert der Leser das Vertrauen in den Namen und muss den Code studieren.
```

**G3 — Falsches Verhalten an den Grenzen.** Auf Intuition statt Tests vertraut. → **Signal:** Grenz-/Sonderfälle (leer, null, 0, Max, negativ) im Code unbehandelt und ungetestet. Fix: *alle* Grenz- und Sonderfälle testen. (vgl. T5)

**G4 — Übergangene Sicherungen.** Compiler-Warnungen abgeschaltet, scheiternde Tests deaktiviert („fixe ich später"), `serialVersionUID` von Hand. → **Signal:** `@SuppressWarnings` ohne Grund, `@Ignore`/`@Disabled` mit „später"-Kommentar, abgeschaltete Linter-Regeln. → **Schweregrad S1** (Sicherheit/Korrektheit).

**G5 — Duplizierung.** **Die wichtigste Regel (S2).** Jede Duplizierung = verpasste Abstraktion. → **Signal:** dieselbe Logik/dieselben Zeilen an mehreren Stellen; parallele `switch`/`if-else` über denselben Diskriminator. Drei Formen:

```java
// Form 1 — offensichtlich: Logik aus vorhandener Methode ausdrücken statt neu implementieren
boolean isEmpty() { return 0 == size(); }
```


```java
// Form 2 — gemeinsame Schritte extrahieren:
// scaleToOneDimension() und rotate() enden beide mit denselben drei Zeilen → herausziehen
private void replaceImage(RenderedOp newImage) {
  image.dispose();
  System.gc();
  image = newImage;
}
```


```java
// Form 3 — ähnliche Algorithmen, kleine Abweichung → Template Method
// Vorher: accrueUSDivisionVacation() und accrueEUDivisionVacation() unterscheiden sich
//          NUR in der Mindesturlaubs-Garantie.
// Nachher:
abstract public class VacationPolicy {
  public void accrueVacation() {
    calculateBaseVacationHours();
    alterForLegalMinimums();   // der einzige variable Teil
    applyToPayroll();
  }
  private void calculateBaseVacationHours() { /* ... */ }
  abstract protected void alterForLegalMinimums();
  private void applyToPayroll() { /* ... */ }
}
```

→ **Schweregrad S2.** (Form 2 über `switch`/`if-else`-Ketten → Polymorphie, siehe G23.)

**G6 — Falsche Abstraktionsebene.** Konkretes in der Basisklasse. → **Signal:** Basisklasse/-Interface enthält Methode, Konstante oder Utility, die nur für *eine* konkrete Implementierung Sinn ergibt.

```java
public interface Stack {
  Object pop() throws EmptyException;
  void push(Object o) throws FullException;
  double percentFull();   // FALSCH: manche Stacks kennen ihre Fülle nicht; return 0 wäre eine Lüge
}
// Fix: percentFull() in ein abgeleitetes Interface (z. B. BoundedStack) verschieben.
```

**G7 — Basisklasse hängt von abgeleiteten Klassen ab.** → **Signal:** Basisklasse referenziert Namen ihrer Subklassen (`if (this instanceof Sub)`, Import der Subklasse). (Ausnahme: feste FSM mit Dispatch in der Basis, gemeinsam ausgeliefert.)

**G8 — Zu viele Informationen.** Breite, tiefe Interfaces. → **Signal:** Klasse exponiert viele öffentliche Methoden/Felder; üppige `protected`-Schnittstelle für Subklassen. Fix: kleine, knappe Interfaces; wenig exponieren.

**G9 — Toter Code.** Nie ausgeführt: unmögliche `if`-Bedingungen, nie greifende `catch`, unerreichbare `case`. → **Signal:** Code hinter Bedingungen, die nie wahr werden; Branches nach `return`/`throw`. → **Löschen.**

**G10 — Vertikale Trennung.** Variablen/Funktionen fern ihres Verwendungsorts deklariert. → **Signal:** lokale Variable Dutzende Zeilen vor erster Nutzung; private Funktion weit entfernt vom Aufrufer. Fix: lokale Variablen direkt über erster Verwendung, private Funktionen direkt unter erster Verwendung.

**G11 — Inkonsistenz (Least Astonishment).** Gleiches nicht gleich behandelt. → **Signal:** wechselnde Namen für dasselbe Konzept (mal `response`, mal anders für `HttpServletResponse`); uneinheitliche Methodennamen (`processVerificationRequest` aber `handleDeletion`). Fix: Konvention wählen und konsequent anwenden.

**G12 — Müll.** → **Signal:** leere Default-Konstruktoren, ungenutzte Variablen/Felder, inhaltsleere Kommentare, ungenutzte Imports. → Löschen.

**G13 — Künstliche Kopplung.** Unabhängiges aneinandergebunden. → **Signal:** allgemeines Enum/Konstante in einer speziellen Klasse eingeschlossen, sodass Verwender die spezielle Klasse importieren müssen. Fix: am richtigen, allgemeinen Ort deklarieren.

**G14 — Feature Envy.** Methode interessiert sich mehr für Daten einer *anderen* Klasse. → **Signal:** Methode ruft überwiegend Accessoren/Mutatoren eines fremden Objekts auf, um dessen Daten zu manipulieren. Fix: Logik dorthin verschieben, wo die Daten leben.

**G15 — Selektor-Argumente.** Jedes Argument (`boolean`, `enum`, `int`), das nur Verhaltensvarianten umschaltet. → **Signal:** Aufruf wie `calculateWeeklyPay(false)`, bei dem der Leser nachschlagen muss, was der Wert bedeutet. Fix: getrennte Funktionen (`calculateStraightTime()`, `calculateOverTime()`).

**G16 — Verschleierte Absicht.** → **Signal:** Run-on-Ausdrücke, Hungarian Notation (`m_dwHeight`), Magic Numbers, kryptische Namen. → Wenn der Leser raten muss, FLAGgen.

**G17 — Falsch platzierte Verantwortung.** Code nicht dort, wo der Leser ihn sucht. → **Signal:** Berechnung/Konstante an unerwarteter Stelle (`PI` in einer Geo-Hilfsklasse statt `Math`; Stunden-Report in `Employee` statt `Reporter`). → Frage: „Wo würde jemand das suchen?"

**G18 — Fälschlich `static`.** `static`, obwohl mehrere Algorithmen denkbar sind. → **Signal:** statische Methode, die alle Daten aus Argumenten zieht, aber fachlich variieren könnte.

```java
HourlyPayCalculator.calculatePay(employee, overtimeRate);  // sieht statisch aus (alle Daten aus Args)
// ABER: es könnte OvertimeHourlyPayCalculator / StraightTimeHourlyPayCalculator geben.
// Fix: als nicht-statisches Member an Employee. Faustregel: im Zweifel non-static
//      (static schließt Polymorphie aus). Sauber statisch ist z. B. Math.max(a, b).
```

**G19 — Aussagekräftige Zwischenvariablen.** → **Signal:** lange, verschachtelte Ausdrücke ohne benannte Zwischenergebnisse. Fix: Berechnung in benannte Teilschritte zerlegen. (Eine der wirksamsten Lesbarkeits-Maßnahmen.)

**G20 — Funktionsnamen sagen, was sie tun.** → **Signal:** man muss den Aufrufer/Implementierung ansehen, um das Verhalten zu verstehen.

```java
Date newDate = date.add(5);   // Vorher: 5 Tage? Wochen? Wird date mutiert oder neues Objekt?
// Nachher — Verhalten im Namen:
date.increaseByDays(5);            // mutierend (verändert date selbst)
Date later = date.daysLater(5);    // return-new (date bleibt unverändert)
```

**G21 — Den Algorithmus verstehen.** `[Prozess/Repo]` — betrifft die Autoren-Intention, kaum aus Code belegbar. Nicht per Trial-and-Error die Tests grün kriegen. → **Aus Code prüfbar (FLAGgen) nur bei direktem Beleg:** Kommentare, die Unsicherheit eingestehen („not sure why this works"), redundante/experimentelle Bedingungen ohne erkennbaren Zweck, dead-experimental-Branches. Sonst n. z.

**G22 — Logische → physische Abhängigkeiten.** Abhängiges Modul nimmt etwas an, statt explizit zu fragen. → **Signal:** ein Modul pflegt eine Konstante/Annahme, die eigentlich einem anderen Modul gehört.

```java
// Vorher: HourlyReporter pflegt eine eigene Konstante und NIMMT AN, der Formatter rechne mit 55 Zeilen
private final int PAGE_SIZE = 55;
// Nachher: er fragt den Formatter, dem die Seitengröße eigentlich gehört (vgl. G17)
int pageSize = formatter.getMaxPageSize();
```

**G23 — Polymorphie statt `switch`/`if-else`.** Zuerst eine polymorphe Lösung erwägen. → **Signal:** wiederholte `switch`/`if-else` über denselben Typ-Diskriminator in mehreren Modulen. **One-Switch-Regel:** pro Auswahl-Art nur *ein* `switch`, das die polymorphen Objekte erzeugt; jeder weitere `switch` über denselben Diskriminator ist Duplizierung (vgl. G5). *(Bewusste Ausnahme: in Abschnitten, wo neue Funktionen statt neuer Typen dazukommen, kann ein `switch` in einer Factory richtig sein.)*

**G24 — Konventionen beachten.** → **Signal:** Abweichung vom im Projekt sichtbaren Codierstandard (Klammern, Benennung, Reihenfolge). Der Code selbst ist das Beispiel.

**G25 — Magic Numbers → benannte Konstanten.** → **Signal:** nackte Zahl/String mit Bedeutung mitten im Code.

```java
// Vorher: nackte Zahlen/Strings
... 86400 ...   ... 55 ...   ... "John Doe" ...
// Nachher:
static final int SECONDS_PER_DAY = 86400;
static final int LINES_PER_PAGE  = 55;
static final String HOURLY_EMPLOYEE_NAME = "John Doe";
```

→ *Ausnahme:* selbsterklärend (`2 * Math.PI`, `hourlyRate * 8`).

**G26 — Präzise sein (Vagheit = Faulheit).** → **Signale, alle FLAGgen (Korrektheit, tendenziell S1):** Geld als Fließkomma (→ Ganzzahl/`Money`); `null`-Rückgabe ungeprüft verwendet; angenommen, der erste DB-Treffer sei der einzige; Locks weggelassen, weil Konflikt „unwahrscheinlich"; `ArrayList` deklariert, wo `List` reicht (zu einschränkend); alles `protected` per Default (nicht einschränkend genug).

**G27 — Struktur > Konvention.** Erzwingende Struktur schlägt Disziplin. → **Signal:** Verlass auf Disziplin (`switch` über Enum, das jeder Verwender korrekt erweitern muss), wo eine abstrakte Methode die Implementierung erzwingen würde.

**G28 — Bedingungen einkapseln.** → **Signal:** zusammengesetzte boolesche Logik direkt im `if`.

```java
if (shouldBeDeleted(timer))                       // gut
if (timer.hasExpired() && !timer.isRecurrent())   // schlechter
```

**G29 — Negative Bedingungen vermeiden.** → **Signal:** negierte Prädikate, besonders doppelte Negation.

```java
if (buffer.shouldCompact())       // gut
if (!buffer.shouldNotCompact())   // schlechter
```

**G30 — Eine Aufgabe pro Funktion.** → **Signal:** Funktion mit mehreren erkennbaren Abschnitten/Absätzen oder mehreren Abstraktionsebenen. Mehrere Abschnitte → mehrere Aufgaben → zerlegen.

```java
// Vorher: Schleife + Payday-Prüfung + Bezahlung in einer Methode
public void pay() {
  for (Employee e : employees) {
    if (e.isPayday()) {
      Money pay = e.calculatePay();
      e.deliverPay(pay);
    }
  }
}
// Nachher: jede Funktion genau eine Aufgabe, eine Abstraktionsebene
public void pay() {
  for (Employee e : employees)
    payIfNecessary(e);
}
private void payIfNecessary(Employee e) {
  if (e.isPayday())
    calculateAndDeliverPay(e);
}
private void calculateAndDeliverPay(Employee e) {
  Money pay = e.calculatePay();
  e.deliverPay(pay);
}
```

**G31 — Verborgene zeitliche Kopplungen.** → **Signal:** Methoden müssen in fester Reihenfolge aufgerufen werden, aber nichts in den Signaturen erzwingt sie (parameterlose Aufrufkette).

```java
// Schlecht: nichts erzwingt die Reihenfolge
public void dive(String reason) {
  saturateGradient();
  reticulateSplines();
  diveForMoog(reason);
}
// Gut: Bucket Brigade — jede Funktion liefert, was die nächste braucht
public void dive(String reason) {
  Gradient gradient = saturateGradient();
  List<Spline> splines = reticulateSplines(gradient);
  diveForMoog(splines, reason);
}
```

**G32 — Keine Willkür.** → **Signal:** Struktur ohne erkennbare Begründung (z. B. öffentliche Nicht-Hilfsklasse als innere `public static class` an fremder Stelle statt auf Package-Top-Level). Jede Struktur muss begründet und als systematisch erkennbar sein.

**G33 — Grenzbedingungen einkapseln.** → **Signal:** derselbe `+1`/`-1`-Ausdruck mehrfach verstreut.

```java
// Schlecht: level + 1 zweimal verstreut
if (level + 1 < tags.length) {
  parts = new Parse(body, tags, level + 1, offset + endTag);
  body = null;
}
// Gut: in nextLevel eingekapselt
int nextLevel = level + 1;
if (nextLevel < tags.length) {
  parts = new Parse(body, tags, nextLevel, offset + endTag);
  body = null;
}
```

**G34 — In Funktionen nur eine Abstraktionsebene tiefer.** → **Signal:** in einer Funktion stehen High-Level-Aufrufe und Low-Level-Details (String-/Byte-Gefrickel) nebeneinander.

```java
// Vorher: HR-Tag-Syntax und size-Logik vermengt
public String render() throws Exception {
  StringBuffer html = new StringBuffer("<hr");
  if (size > 0)
    html.append(" size=\"").append(size + 1).append("\"");
  html.append(">");
  return html.toString();
}
// Nachher: HtmlTag kümmert sich um die Tag-Syntax, render() nur um die HR-Logik
public String render() throws Exception {
  HtmlTag hr = new HtmlTag("hr");
  if (extraDashes > 0)               // size umbenannt zu extraDashes (wahrer Zweck)
    hr.addAttribute("size", hrSize(extraDashes));
  return hr.html();
}
private String hrSize(int height) {
  int hrSize = height + 1;
  return String.format("%d", hrSize);
}
```

→ Eine der schwersten Heuristiken; mit Augenmaß (Vorrang Lesbarkeit) prüfen.

**G35 — Konfigurierbare Daten hoch ansiedeln.** → **Signal:** Default-/Konfigurationswert tief in einer Low-Level-Funktion vergraben. Fix: auf Top-Level (z. B. `DEFAULT_PORT` in einer `Arguments`-Klasse, in der ersten Zeile von `main` geparst) und nach unten durchreichen. *(In diesem Repo: alle konfigurierbaren Werte gehören nach `src/config.js`.)*

**G36 — Transitive Navigation vermeiden (Law of Demeter).** Ein Modul kennt nur seine unmittelbaren Mitarbeiter. → **Signal:** Aufrufketten über mehrere Objekte (`a.getB().getC().doSomething()`, „Train Wreck").

```java
a.getB().getC().doSomething();    // schlecht (Train Wreck) — würde man Q zwischen B und C
                                  //   einschieben wollen, müsste jede solche Kette umgeschrieben werden
myCollaborator.doSomething();     // gut — der unmittelbare Mitarbeiter bietet den Service direkt an
```

---

## J — Java (nur bei Java-Code; sonst Geist übertragen — in diesem Repo n. z.)

**J1 — Lange Importlisten → Platzhalter.** Bei ≥2 Klassen aus einem Package `import package.*;` — reduziert Kopplung (Platzhalter erzeugt keine harte Abhängigkeit auf Einzelklassen). → **Signal:** viele Einzel-Imports aus demselben Package. *Allgemein:* Imports schlank nach Sprach-Norm.

**J2 — Konstanten nicht vererben.** → **Signal:** Klasse `implements`/`extends` ein Interface nur, um an dessen Konstanten zu kommen.

```java
// Vorher: Konstanten über Vererbung „eingeschmuggelt" — sie verstecken sich oben in der Hierarchie
public abstract class Employee implements PayrollConstants { ... }
public interface PayrollConstants {
  public static final int TENTHS_PER_WEEK = 400;
  public static final double OVERTIME_RATE = 1.5;
}
// Nachher: static import
import static PayrollConstants.*;
```

→ *Allgemein:* Konstanten nicht via Vererbung einschmuggeln, um Scope-Regeln zu umgehen.

**J3 — Enums statt `public static final int`.** → **Signal:** Gruppen verwandter `public static final int`-Konstanten, die eine Aufzählung darstellen. Enums tragen Methoden/Felder und verlieren ihre Bedeutung nicht.

```java
public enum HourlyPayGrade {
  APPRENTICE            { public double rate() { return 1.0; } },
  LIEUTENANT_JOURNEYMAN { public double rate() { return 1.2; } },
  JOURNEYMAN            { public double rate() { return 1.5; } },
  MASTER                { public double rate() { return 2.0; } };
  public abstract double rate();
}
```

→ *Allgemein:* typsichere Aufzählung vor nackten Integer-Konstanten.

---

## N — Namen

**N1 — Deskriptive Namen.** Namen tragen ~90 % zur Lesbarkeit bei. → **Signal:** Ein-Buchstaben-/kryptische Namen außerhalb winziger Scopes (`x`, `q`, `l`, `kk`), aus denen der Zweck nicht hervorgeht.

```java
// Vorher: Symbol-Salat — niemand erkennt, dass das ein Bowling-Score ist
public int x() {
  int q = 0; int z = 0;
  for (int kk = 0; kk < 10; kk++) {
    if (l[z] == 10) { q += 10 + (l[z+1] + l[z+2]); z += 1; }
    else if (l[z] + l[z+1] == 10) { q += 10 + l[z+2]; z += 2; }
    else { q += l[z] + l[z+1]; z += 2; }
  }
  return q;
}
// Nachher: deskriptive Namen — die Struktur tritt sofort hervor, Magic Numbers verlieren ihre Magie
public int score() {
  int score = 0;
  int frame = 0;
  // ...
}
```

**N2 — Namen auf der Abstraktionsebene der Klasse/Funktion.** Keine Implementierungsdetails im Namen. → **Signal:** Name legt sich auf eine konkrete Implementierung fest (`phoneNumber`, `mysqlConnection`), die später bricht.

```java
// Vorher: phoneNumber legt sich auf Telefonleitung fest — bricht bei Kabel-/USB-Modems
public interface Modem {
  boolean dial(String phoneNumber);
  String getConnectedPhoneNumber();
}
// Nachher: deckt den Telefon-Fall mit ab, ohne sich darauf festzulegen
public interface Modem {
  boolean connect(String connectionLocator);
  String getConnectedLocator();
}
```

**N3 — Standardnomenklatur / Ubiquitous Language.** → **Signal:** eigene Erfindung, wo ein etablierter Begriff existiert (`…Decorator`, `toString`); Code spricht nicht die Fachsprache der Domäne. Erst Standard, dann eigene Erfindung.

**N4 — Eindeutige Namen.** → **Signal:** zwei ähnliche Funktionen im selben Modul, deren Unterschied der Name nicht verrät.

```java
doRename();   // Vorher: was unterscheidet das von renamePage() im selben Modul?
renamePageAndOptionallyAllReferences();  // Nachher: lang, aber eindeutig (nur an einer Stelle aufgerufen)
```

**N5 — Lange Namen für große Geltungsbereiche.** Namenslänge ∝ Scope. → **Signal:** kurze Namen für weit gestreute/lang lebende Variablen. → Kurze Namen (`i` in `for (int i=0; …)`) in winzigen Scopes sind **richtig** — **nicht FLAGgen.** Je weiter vom Verwendungsort deklariert, desto präziser/länger.

**N6 — Codierungen vermeiden.** → **Signal:** Typ-/Scope-Präfixe (`m_`, `f`), Subsystem-Präfixe (`vis_`), Hungarian Notation.

**N7 — Namen beschreiben Nebeneffekte.** Tut die Funktion mehr als das simple Verb, muss der Name das sagen. → **Signal:** `get…`/`is…`-Name bei einer Funktion, die nebenbei erzeugt, initialisiert oder mutiert.

```java
// Vorher: getOos() suggeriert reines Abrufen — erstellt das Objekt aber bei Bedarf
public ObjectOutputStream getOos() throws IOException {
  if (m_oos == null)
    m_oos = new ObjectOutputStream(m_socket.getOutputStream());
  return m_oos;
}
// Nachher: Name macht den Nebeneffekt sichtbar
public ObjectOutputStream createOrReturnOos() throws IOException { ... }
```

---

## T — Tests

**T1 — Unzureichende Tests.** „Scheint genug" reicht nicht; alles prüfen, was schiefgehen kann. → **Signal (aus Code prüfbar):** sichtbare Bedingungen/Branches/Berechnungen ohne zugehörige Assertion. (Vollständige Abdeckung allein aus dem Snapshot zu beurteilen ist begrenzt → kombiniere mit T2, sonst nur das offensichtlich Ungeprüfte FLAGgen.)

**T2 — Coverage-Tool verwenden.** `[Prozess/Repo]` — ob ein Coverage-Tool läuft, ist kein Code-Merkmal. → **Aus Code prüfbar:** nichts direkt; n. z., außer eine Coverage-Konfiguration liegt sichtbar im Scope.

**T3 — Triviale Tests nicht überspringen.** Ihr dokumentarischer Wert übersteigt die Kosten. → **Signal (begrenzt):** Fehlen lässt sich kaum sicher belegen (Abwesenheits-Nachweis) → nur FLAGgen, wenn offensichtlich naheliegende triviale Fälle ungetestet sind; sonst n. z.

**T4 — Ignorierter Test = Mehrdeutigkeit.** → **Signal:** `@Ignore`/`@Disabled` oder auskommentierter Test. (Als Ausdruck einer offenen Anforderung legitim — FLAGge nur fehlende Begründung; siehe auch G4, falls „fixe ich später".)

**T5 — Grenzbedingungen testen.** Die Mitte stimmt meist, die Ränder werden falsch beurteilt. → **Signal:** Tests prüfen nur den Normalfall, nicht leer/null/0/Max/negativ. (vgl. G3)

**T6 — Bei einem Bug die Nachbarschaft gründlich testen.** `[Prozess/Repo]` — Vorgehensregel beim Bugfix, kein statischer Check. → n. z. im reinen Code-Audit (höchstens als Hinweis im Review-Kommentar, wenn ein Fix sichtbar ist).

**T7 — Muster des Scheiterns zur Diagnose nutzen.** `[Prozess/Repo]` — Diagnose beim Testlauf, kein statischer Check. → n. z.

**T8 — Coverage-Patterns als Hinweise.** `[Prozess/Repo]` — Diagnose beim Testlauf. → n. z.

**T9 — Tests müssen schnell sein.** `[Prozess/Repo]` — Laufzeit-Eigenschaft. → **Aus Code prüfbar nur bei offensichtlichen Mustern:** `Thread.sleep` im Test, echte Netz-/DB-Calls, große Schleifen. Sonst n. z.

---

*Die Liste ist bewusst nicht „vollständig" — Clean Code entsteht nicht durch Regel-Befolgung, sondern durch das zugrunde liegende Wertesystem. Prüfe mit Urteilsvermögen, nicht mechanisch.*
