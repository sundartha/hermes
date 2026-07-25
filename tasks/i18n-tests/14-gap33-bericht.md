# 14 - GAP-33 umgesetzt (Bericht)

Stand: 2026-07-25 | Commit `dfd18d1` | Vorlauf: `deb0c8c` (Testkatalog + Owner-Entscheidungen)

GAP-33 ist der erste Test des Katalogs und der Abbruchpunkt von Welle W1
(`PLAN-I18N-TESTS.md` Kapitel 5): solange kein Lauf die ausgelieferte Konfiguration faehrt,
beweist kein gruener Test etwas ueber Produktion.

---

## 1. Was gebaut wurde

| Datei | Inhalt |
| --- | --- |
| `test/prod-env.js` | Rohstoff: `LIVE_ENV`, `RENDER_ENV`, `prodEnv()`, `blueprintEnv()`, `divergentGateKeys()` |
| `test/prod-config-smoke.test.js` | Sechs Tests: zwei Meta, Boot, Outbound Inland, Outbound Ausland, Blueprint-Befund |

**Suite nach dem Einbau: 2941 Tests, 2939 gruen, 2 rot** - die beiden roten sind die
Befunde unten. Kein Bestandstest ist gebrochen (Bestandslauf vorher: 2938/2936, die zwei
roten waren die noch unfertige GAP-33-Vorfassung).

---

## 2. Die Quellenfrage - warum nicht render.yaml

Die abgebrochene Vorsession hatte `render.yaml` als Quelle gewaehlt und im Datei-Kommentar
festgehalten, eine Abweichung zwischen Blueprint und Live-Messung sei "ein Befund, kein
Grund, die Quelle zu wechseln". Der erste Lauf widerlegt das: **der Blueprint bootet nicht.**
Ein Lauf gegen ihn kommt nie bis zu einem Gate und wiederholt nur denselben Boot-Abbruch.

**Owner-Entscheidung 2026-07-25: Live-Env traegt die Gate-Aussagen, der Blueprint bekommt
einen eigenen Befund-Test.**

Damit GAP-33 nicht eine dritte, erfundene Konfiguration faehrt, ist jede Abweichung belegt:

| Achse | Blueprint | Live | Beleg |
| --- | --- | --- | --- |
| `ALLOWED_COUNTRY_CODES` | `+49,+33,+44` | `*` | Boot-Banner `Nummern-Gates: Land *`, JEDER Boot 07-18 bis 07-25T09:03:22Z |
| `MAX_BUDGET_EUR` | `8` | `30` | `test/env-docs-spend-cap-coherence.test.js:105`, `test/helpers.js:41-47`; Live-Boot zeigt den `plan_cap_inert`-Abbruch nicht, den `8` reproduzierbar ausloest |

Achsen ohne belegbaren Live-Wert stehen **benannt** in `LIVE_UNMEASURED` (laufen auf dem
Blueprint-Wert) bzw. als begruendete Substitution in `PROD_ENV_EXEMPTIONS` - statt in einem
stillen Default zu verschwinden. Ein Meta-Test haelt beide Listen widerspruchsfrei und frei
von Karteileichen.

---

## 3. Befunde

### B1 - Outbound ins Ausland endet unter den ausgelieferten Werten mit 402 (rot)

```
+12025550143 -> 402
{"error":"Dieser Anruf passt nicht mehr in dein Budget: es fehlen 3.00 EUR.
          Aktueller Spend-Monat endet am 2026-07-31."}
```

Das Inlandsziel (`+49`) kommt im selben Lauf sauber bis zum Provider durch (500). Der
Unterschied ist allein der Tarif: `+1` steht nicht in `VOICE_TARIFF_DOMESTIC_PREFIXES`
(`src/config.js:105`), die Worst-Case-Reserve laeuft gegen die Tenant-Decke.

**Das ist der Existenzbeweis fuer GAP-33**: unter `BASE_ENV` ist dieser 402 unsichtbar, weil
die Tarife dort auf `0` stehen (`test/helpers.js:263-264`). Bestaetigt PAY-04 / GAP-32 /
ORIG-05 aus dem Katalog - die dortigen Einzeltests bleiben trotzdem noetig, sie pruefen die
Reserve-Rechnung selbst, nicht den scharfen Env-Lauf.

### B2 - `render.yaml` ist nicht startfaehig (rot)

Zwei **unabhaengige** Boot-Blocker, nacheinander freigelegt:

1. `MAX_BUDGET_EUR="8"` (`:275-276`) -> `platformSpendCapCents=800` -> `plan_cap_inert`,
   `exit(1)`.
2. `COST_TRUING_REQUIRED_RECORD_TYPES=""` (`:212-213`) -> Pflicht-Mengen-Riegel, `exit(1)`.
   `src/config.js:418-424` setzt hier bewusst KEINEN Nicht-leer-Default.

Der zweite Blocker war bisher **nirgends erfasst**. Der bestehende statische Kohaerenz-Test
(`test/env-docs-spend-cap-coherence.test.js:127`) rechnet nur Achse 1 nach und kennt Achse 2
nicht - ein echter Boot deckt beide.

**Tragweite ueber i18n hinaus:** `render.yaml` ist die einzige versionierte Beschreibung des
Dienstes. Der Live-Service ist dashboard-managed; geht er verloren, ist der Blueprint der
Wiederherstellungs-Pfad - und ein Deploy daraus startet heute nicht. Das gehoert zu W26 /
GAP-36 ("render.yaml ist Doku, nicht Wahrheit"), ist dort aber nur als Doku-Drift
beschrieben, nicht als Nicht-Startfaehigkeit.

### B3 - Nebenbefund: der Alarmkanal ist inzwischen besetzt

Die Boot-Warnung `PLATFORM_ALERT_SMS_TO ist leer` steht in **jedem** Boot bis
2026-07-23T23:23:24Z und **fehlt** im Boot vom 2026-07-25T09:03:22Z. Damit ist die
Betriebsauflage aus Entscheidung **7.8** erfuellt (erst Warnkanal besetzen, dann
`BUDGET_MONTH_ENABLED=true`). `13-live-env-befund.md` Abschnitt 3 (GAP-07 "live bestaetigt,
Kanal leer") ist fuer den heutigen Stand ueberholt.

---

## 4. Offene Punkte

1. **Vier Achsen sind nicht live-belegt** und laufen auf dem Blueprint-Wert:
   `BUDGET_MONTH_ENABLED` (beruehrt das Budget-Gate direkt, `state-ops.js:1961,1974`),
   `MULTI_TENANT`, `SELF_SERVICE_ENABLED`, `PLATFORM_ALERT_SMS_TO`. Keine druckt eine
   Boot-Zeile. Aufloesbar nur durch Ablesen im Render-Dashboard (Owner-Zugriff) - danach
   wandern sie aus `LIVE_UNMEASURED` nach `LIVE_MEASURED`.
2. **`npm test` ist ab jetzt dauerhaft rot.** Das ist der Katalog-Charakter
   (`PLAN-I18N-TESTS.md` 4.1: "Kein roter Test in diesem Katalog ist ein Regressionsfang;
   alle sind Launch-Gates"), macht aber den Bestands-Gruen-Check schwerer lesbar - und der
   dokumentierte Voll-Last-Flake (`p5-gate-proof`, ~12 %) verlangt ohnehin schon eine
   Isoliert-Gegenprobe. Vor Welle W1 zu entscheiden, ob Launch-Gate-Tests eine eigene
   Lauf-Kennung bekommen.
3. **Polaritaets-Nachbarschaft** zu `env-docs-spend-cap-coherence.test.js:127`: jener Test
   pinnt `MAX_BUDGET_EUR=8` bewusst als bekannte Luecke (mit Aufhebungsanleitung im
   Kommentar). Wer den Blueprint anhebt, dreht dort die Assertion; hier wird nichts
   angefasst - der Befund-Test wird von selbst gruen. Beide Tests bleiben, sie messen
   Verschiedenes (statische Formel gegen echten Boot).

---

## 5. Stand des Katalogs

| | |
| --- | --- |
| Arbeitsvorrat | 217 kanonische Tests (`00-kanonische-liste.md`) |
| umgesetzt | **1** (GAP-33) |
| naechster Schritt | Welle W1, 106 P0-Tests in sechs Gruppen (`PLAN-I18N-TESTS.md` Kapitel 5) |

Der Abbruchpunkt "Wenn GAP-33 nicht gebaut ist, ist W1 nicht abgeschlossen" ist damit
aufgehoben. Der zweite W1-Abbruchpunkt (E2E-05 muss bis Schritt 4 kommen) steht noch aus.
