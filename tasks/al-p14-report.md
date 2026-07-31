# AL-P14 — Phasenbericht (`get_consult` im Gespraech, nicht-blockierend)

**Branch:** `phase/al-p14-get-consult` · **Basis:** `master` @ `3bc5f43` · **Stand:** 2026-07-31

## Was gebaut wurde

Der Telefon-Agent bekommt im Budget-/Shim-Turn ein zusaetzliches Werkzeug `get_consult`:
EINE kurze Sachfrage an den Auftraggeber, waehrend das Gespraech laeuft. Der Turn wartet
**nirgends** — er spricht einen deterministischen Ueberbrueckungssatz und endet. Die Frist
ist eine Wanduhr-Frist am Datensatz, ausgewertet beim naechsten Turn.

* `src/consult/in-call.js` — Registrierungs-Gate (`consultAvailableFor`), Zeitfenster-Regel
  (`consultFitsBillingMinute`), Entscheidung (`decideConsultRequest`), Wartezeit-Schritt
  (`advanceConsultWait`); `CONSULT_TIMEOUT_MS = 4000` als benannte Konstante ohne Env-Knopf.
* `src/consult/question.js` — Paraphrase-Riegel: Zitat-Spannen raus, >= 6 Woerter woertlich
  aus einer `caller`-Zeile -> Ablehnung, Kappung auf 200 Zeichen an der Wortgrenze.
* `src/store/state-ops.js` — `isInCallConsult` / `inCallConsults` / `noteConsultPoll` /
  `advanceInCallConsult`; `consultPolledAtMs` am Call (EPHEMER, keine pg-Spalte).
* `src/claude.js` — `agentTools(call)` (toolDefs bleibt unveraendert), Halte-Turn,
  Fallback-Marker, Consult-Auswertung vor dem generischen Tool-Mapping.
* `IN_CALL_CONSULT_ENABLED` (Default AUS) in `config.js`, `.env.example`, `render.yaml`,
  `test/helpers.js` BASE_ENV; Boot-Banner-Zeile, wenn scharf.

## Verifikation

| Beweis | Ergebnis |
|---|---|
| `node --check` auf alle geaenderten/neuen `.js` | keine Ausgabe, exit 0 |
| `node --test test/al-p14-in-call-consult.test.js` | **pass 25 / fail 0** |
| `npm test` (json-Default + pglite-in-process in derselben Suite) | **3636 pass / 0 fail** (Bestand 3611 + 25); 4 Vollaeufe gefahren, 3 gruen, 1 mit einem einzelnen Rot, das im unmittelbar folgenden Lauf nicht reproduzierte — der dokumentierte Voll-Last-Flake (Lehre `suite-flake-p5-gate-proof`: „rot nur echt, wenn isoliert rot") |
| `npm run test:gates` | 129 Tests, **3 rot — unveraendert** zum Bestand (kein Test traegt eine Katalog-ID) |
| Smoke (Server-Spawn, freier Port) | `/healthz` 200; Boot-Banner zeigt `In-Call-Consult: AKTIV` bei `IN_CALL_CONSULT_ENABLED=true`; `GET /api/calls/<unbekannt>/consult` -> 404 (fail-closed) |

**Mutationsprobe (bindende Richtungs-Abnahme, Muster AL-P2b):** wird das Praedikat
`call.direction === "outbound"` aus `consultAvailableFor` entfernt, faellt `AL-P14-2`
(`pass 23 / fail 1`); mit Praedikat wieder `pass 24`. Der Test pinnt damit nachweislich das
Richtungs-Gate und nicht bloss die Nebenbedingungen.

**Byte-Gleichheit ohne erfuellte Bedingung:** `AL-P14-6` vergleicht das tatsaechlich an
Anthropic gesendete `tools`-Array `JSON.stringify`-genau gegen `toolDefs("de")` (mit dem
bestehenden `cache_control`-Marker am letzten Eintrag).

## Abweichungen vom Plan (alle bewusst, alle begruendet)

1. **Erster Ablehnungsgrund ist „Alleinstellung in der Runde" statt „`end_call` in
   derselben Runde".** Der Plan nennt nur `end_call`. Am Code ist das zu eng: eine
   angenommene Rueckfrage beendet den Turn SOFORT, also verschwindet jedes weitere
   Werkzeug derselben Runde ungefuehrt — ein begleitendes `take_message` waere ein
   stiller Datenverlust (der Owner bekaeme die Nachricht nie). `toolUses.length > 1`
   deckt den `end_call`-Fall als Teilmenge mit ab, ist EIN Riegel statt einer je
   Werkzeugart und braucht keine Kenntnis fremder Werkzeugnamen — womit auch der sonst
   noetige Zirkelimport `claude.js <-> consult/in-call.js` (bzw. eine dritte Kopie des
   `"end_call"`-Literals, G5) entfaellt. Gepinnt durch `AL-P14-11` und `AL-P14-11b`.
2. **`src/utils/text.js` neu** (nicht in der Diff-Liste des Plans). Der Plan verlangt eine
   Kappung an der Wortgrenze und nennt sie „geteilter Helfer", ohne dass ein solcher
   existiert — dieselbe Vier-Zeilen-Regel steckte bereits privat in
   `claude.js trimGoalForSpeech`. Eine zweite Kopie waere ein S2-Befund. Der Helfer liegt
   jetzt in `src/utils/` (Praezedenz `utils/timer.js`, dort wortgleich begruendet); beide
   Aufrufer nutzen ihn. `trimGoalForSpeech` bleibt verhaltensgleich (AL-P5-Pins gruen).
3. **`consultAvailableFor` fordert zusaetzlich `answeredAt`.** Der Plan listet die
   Bedingung nicht auf, seine Ableitung D4 setzt sie aber voraus: ohne `answeredAt` ist ein
   Consult per Definition kein In-Call-Consult, `inCallConsults` zaehlt ihn nie mit — das
   Kontingent waere blind und der Halte-/Timeout-Schritt griffe nie. Strikte Verschaerfung,
   fail-closed.
4. **DE-Modell-Strings tragen echte Umlaute** statt der vom Plan angenommenen
   Transliteration. Die Plan-Praemisse „wie der Bestand dort" ist am Code falsch:
   `src/i18n/prompts/de.js` schreibt `Gegenübers`, `unverständlich`, `Fähigkeit` — und
   `claude.js` begruendet das ausdruecklich als Priming-These (transliterierter Prompt-Text
   faerbt den frei generierten Modelltext). `test/cq-p5-prompt-redesign.test.js` P5-O3
   pinnt das fuer `toolDefs`; `get_consult` folgt derselben Regel.
5. **`test/al-p13-consult-channel.test.js` angefasst** (nicht in der Diff-Liste). Das
   Route-Test-Double dort ist ein handgebauter Store; der Lesepfad ruft seit dieser Phase
   `store.noteConsultPoll`. Ohne die eine Zeile wirft die Route `TypeError` — der Test war
   nach dem Route-Edit rot. Reine Double-Nachfuehrung, kein Verhaltenspin geaendert.
6. **Kein Test fuer den Flag-AUS-Pfad in-process** (Plan A5). Ein Prozess hat genau einen
   `config`-Snapshot; der AUS-Zweig wird ueber eine andere nicht erfuellte Bedingung
   erreicht — derselbe Code-Zweig, byte-genau verglichen. Der echte Flag-Default ist
   ueber `BASE_ENV` in allen Spawn-Tests gepinnt.

## Drift gegen `PLAN-ASSISTANT-LEAP.md` (am Code geprueft, NICHT nebenbei gefixt)

* `MS_PER_MINUTE` existierte nur als private Kopie in `billing/metering.js` — jetzt EINE
  Quelle in `utils/timer.js`, Verhalten unveraendert.
* `voiceMinutesOf` heisst so und rechnet mit `Math.ceil` auf `answeredAt..endedAt` (Plan
  korrekt); `callTariffCentsPerMin` heisst am Code `tariffCentsPerMin`
  (`telephony/outbound-gates.js`) und wurde nicht angefasst.
* `consultTimeoutMs` gibt es am Code nicht und wurde bewusst NICHT als Env-Knopf angelegt.
* `USER_IDLE_REPLY_SECS` ist eine Telnyx-**Assistant-Objekt**-Einstellung
  (`scripts/telnyx-assistant-provision.mjs`), zur Laufzeit nicht pro Call steuerbar. Die
  Aussetzung des Nachhakens passiert deshalb bei uns im Turn, nicht am Provider. Der
  Ist-Wert ist ungemessen -> Abnahme AL-P14-5.
* `PROVIDER_WEBHOOK_HARDCUT_MS = 15000` existiert (`turn-budget.js`), ist aber aus der
  Twilio-Doku abgeleitet und fuer den Shim-Pfad **live unbestaetigt** — AL-P2 ist bis heute
  nicht gemessen. `CONSULT_TIMEOUT_MS = 4000` ist deshalb im Code ausdruecklich als
  unbestaetigte Herleitung markiert.
* Tarif-Fallback 30 statt 300 ct/min (KS-P6), `MAX_CALL_DURATION_S` wird nicht mehr gelesen
  (KS-P3), die Plattform-Achse sperrt nicht mehr (KS-P9): alle drei sind fuer diese Phase
  ohne Wirkung — AL-P14 fasst keine Geld-Achse an, es liest nur die Minutendefinition.

## Offen (Owner)

Sechs Abnahmen in `tasks/al-testcall-checklist.md` (AL-P14-1 bis AL-P14-6). Die
Freischaltung (`IN_CALL_CONSULT_ENABLED=true`) ist an die Datenschutzerklaerung gekoppelt.
