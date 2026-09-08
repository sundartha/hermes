# PLAN-SEC-FIX — Behebungskette zum Sicherheitstest

Stand 2026-09-08. **Ein** Entwurfsdokument fuer die gesamte Behebung (nicht eines je Stufe),
plus je Phase eine duenne Arbeitsanweisung weiter unten. Die Befunde selbst stehen NICHT hier,
sondern in `tasks/sicherheitstest-befunde.md`; der Testkatalog in `PLAN-SICHERHEITSTEST.md`.
Dieses Dokument sagt, WAS in welcher Reihenfolge gebaut wird und WORAN man erkennt, dass es
fertig ist.

Entscheidungen, die die Zukunft binden (Idempotenz-Schluessel, `nodemailer`-Major,
CSRF-Modus, Cookie-Rename), gehoeren NICHT hierher, sondern als Owner-Entscheidungs-Block in
`PLAN-SECURITY.md` — dort liegen sie unveraendert, waehrend dieses Dokument mit der Kette
altert.

## 0. Reichweite

**Drin:** Testbank, Webhook-Idempotenz, Lieferkette, Eingabegrenzen + CSRF,
Mandanten-Bindung des ElevenLabs-Werkzeug-Tokens, Web-Haertung, Antwortverhalten der
Gate-Kette, drei Struktur-Waechter.

**Bewusst DRAUSSEN (Owner-Entscheidung 2026-09-08):** ID-01, der Besitznachweis fuer die
eigene Nummer. Der Befund bleibt im Protokoll und in `PLAN-SECURITY.md` als getragenes
Risiko stehen; er wird in dieser Kette nicht gebaut.

**Nicht baubar, weil an fremden Konten:** die vier Repo-Secrets des Drift-Waechters,
Render-Zugang (DB-05/OPS-03), Stripe (OPS-04), Rotation des Render-Schluessels. Diese vier
stehen in Abschnitt 3 als Owner-Blocker, nicht als Phase.

## 1. Reihenfolge und ihre Begruendung

Die Spalte **Groesse** steuert den Zuschnitt des Laufs: `S` heisst wenige Dateien, ein
Testfile, `maxFixRounds: 1` — dort ist ein dreistuendiger Lauf ein Fehler, kein Fleiss. `L`
heisst mehrere Nahtstellen und verdient die volle Behandlung.

| Phase | Titel | Groesse | Warum an dieser Stelle |
|---|---|---|---|
| SEC-P0 | Testbank gruen | M | Ohne gruene Bank ist KEIN spaeterer Fix beweisbar. Solange 1-4 wechselnde Flakes pro Lauf auftreten, ist eine echte Regression vom Rauschen nicht unterscheidbar. Billigster Schritt, hoechster Hebel |
| SEC-P1 | Webhook-Idempotenz | L | Der einzige Befund, der OHNE Angreifer Geld kostet (Anbieter-Retry genuegt). Zwei Befunde, ein Fix |
| SEC-P2 | Lieferkette | S | Drei High-Advisories in Produktionsabhaengigkeiten, `nodemailer` direkt auf dem Live-Mailpfad. Fremder Code, den wir nicht pruefen — schneller Wert je Aufwand |
| SEC-P3 | Eingabegrenzen + CSRF | M | Erste Phase, die den Angreifer mit Konto adressiert |
| SEC-P4 | EL-Token je Mandant | S | Belegte Quer-Mandanten-Reichweite eines statischen Tokens |
| SEC-P5 | Web-Haertung | M | Verteidigung in der Tiefe. Bewusst SPAET: der Cookie-Rename beendet alle laufenden Sitzungen, das will man nicht mitten in der Kette |
| SEC-P6 | Antwort statt Haenger + Waechter | L | Verfuegbarkeit + die drei Struktur-Waechter, die den erreichten Stand einfrieren |

Eine Phase gilt erst als fertig, wenn ihr Abnahmekriterium (unten, deterministisch) erfuellt
ist UND `npm test` gruen bleibt. Rot in `npm run test:gates` oder `npm run test:abnahme` ist
erlaubt — das sind Launch-Baenke, keine Regressionsbaenke.

## 2. Die Phasen

### SEC-P0 — Testbank gruen

**Ausgang.** `npm test` ist rot: lokal `tests 5803 / pass 5800 / fail 3`, in CI
`5803 / 5796 / 6`. Einzeln mit `NODE_ENV=test` nachgemessen ist genau EIN Testfile echt rot:
`test/kv2-10-tarifpaar.test.js`, 2 von 17 Faellen. Alle anderen roten Faelle beider Laeufe
(`auth-p5-internal-only`, `el-consult-timeout-spur`, `el-geldpfad-s1`,
`telnyx-p5-origination`, `al-p10-precall-research`) sind einzeln gruen — Flakes unter
Parallel-Last.

**Auftrag.** (a) Wurzel des echten Defekts: der Tarifpaar-Waechter meldet bei Unterschaetzung
ZWEI Mails/SMS statt einer und bei gedecktem Tarif EINE statt keiner
(`test/kv2-10-tarifpaar.test.js:233,245`). Erst entscheiden, ob der Test oder der Code die
richtige Erwartung traegt — der Alarmkanal ist die Sache, die geschuetzt wird, nicht der Test.
(b) Die fuenf Flake-Dateien stabilisieren. Die Ursache ist bekannt gefaehrlich: Spawn-Races
und geteilte Ports/Prozesse (s. `tasks/lessons.md`, Lehren `suite-flake-p5-gate-proof` und
`verwaiste-testserver-elternwaechter`).

**Abnahme.** `npm test` liefert Exit 0 in **zwei aufeinanderfolgenden vollen Laeufen**
(ein einzelner gruener Lauf beweist bei Flakes nichts). Kein Test wird uebersprungen,
`--test-skip-pattern` bleibt unveraendert, die Zahl der Faelle sinkt nicht.

**Abgrenzung.** Keine Produktionslogik ausserhalb des Tarifpaar-Alarmpfads anfassen.

---

### SEC-P1 — Webhook-Idempotenz

**Ausgang, gemessen.** Ein byte-identischer, gueltig signierter Request, zweimal zugestellt:
- `POST /voice/incoming` -> **zwei** Anruf-Datensaetze statt einem (REPLAY-01).
- `POST /voice/turn` -> **zweite Modellrunde**: Token 4.000.000/1.000.000 -> 8.000.000/2.000.000,
  gebucht **828 -> 1656 Cent**, Transkript **2 -> 4 Zeilen** (REPLAY-02).
- `POST /voice/status` -> **unveraendert**. Der persistierte `billedAt`-Marker
  (`src/telephony/call-finish.js:258-266`) ist bereits ein tragender Idempotenz-Anker.

**Auftrag.** Einen Idempotenz-Anker fuer die beiden ungeschuetzten Webhooks. Zwei Vorbilder
existieren im Haus und sind zu bevorzugen statt einer dritten Bauart: `billedAt` (persistiert,
ueberlebt Neustart) und die Stripe-Redelivery-Abwehr ueber `event.id`
(`test/stripe-webhook-signature.test.js`). Der Schluessel MUSS aus dem Anbieter-Ereignis
kommen, nicht aus unserer Uhr, und den Neustart ueberleben (`numInstances=1` ist heute wahr,
aber kein Verlass — s. A-08).

**Abnahme.** Neue Regressionstests, die den exakten Messaufbau spiegeln (EIN Body, EIN
Zeitstempel, EINE Signatur, zweimal zugestellt):
- `/voice/incoming` zweimal -> `store.calls.length === 1`, beide Antworten 200 (Anbieter-Retry
  ist legitim und darf nicht mit 4xx quittiert werden).
- `/voice/turn` zweimal -> Usage-Stand byte-identisch zum Stand nach dem ersten Request,
  Transkript-Laenge unveraendert, LLM-Aufrufzaehler unveraendert.
- Positiv-Kontrolle im selben Test: ein Request mit ANDEREM Ereignis-Schluessel wird normal
  verarbeitet (sonst misst der Test eine tote Route).

**Entscheidung fuer `PLAN-SECURITY.md`:** woraus genau der Schluessel gebildet wird und wie
lange er vorgehalten wird.

---

### SEC-P2 — Lieferkette

**Ausgang, gemessen.** `npm audit --omit=dev`: 8 Verwundbarkeiten, **3 hoch**, alle mit
verfuegbarem Fix. Herkunft ueber das Lockfile aufgeloest:
- `nodemailer` — **direkte** Abhaengigkeit, hoch (SMTP-Command-Injection ueber `envelope.size`,
  CRLF-Injection ueber Transport-Name und `List-*`-Header, fehlende TLS-Zertifikatspruefung
  beim OAuth2-Token-Abruf). Fix = **Major 10.x, breaking**.
- `ip-address` (hoch) via `express-rate-limit` — SSRF/Trust-Boundary-Umgehung auf genau der
  IP-Achse, auf der unser Limiter und `isTrustedLocalCaller` arbeiten.
- `fast-uri` (hoch) via `ajv`; `hono` + `@hono/node-server` (moderat) via
  `@modelcontextprotocol/sdk`; `qs`/`body-parser` via `express`.
- `apps/web`: 0 Verwundbarkeiten.
- **Nicht einschlaegig:** das `body-parser`-Advisory ("ungueltiger `limit` schaltet die
  Groessenpruefung still ab") — `BODY_LIMIT = "100kb"` (`src/app.js:53`) ist gueltig.

**Auftrag.** Zuerst die nicht-brechenden Anhebungen (`npm audit fix` ohne `--force`), getrennt
davon der `nodemailer`-Major. Der Mailpfad ist live (Call-Summary, Newsletter-Double-Opt-in) —
die Migration braucht einen Rauchtest, nicht nur gruene Unit-Tests.

**Abnahme.** `npm audit --omit=dev --audit-level=high` liefert Exit 0. `npm test` gruen.
Mail-Rauchtest: eine Zustellung ueber den real konfigurierten Adapter (`selectMailer`) laeuft
durch oder scheitert mit derselben Fehlerklasse wie vor der Anhebung — belegt am Log, nicht
behauptet. `.github/dependabot.yml` (liegt bereits vor, unversioniert) wird in diesem Zug
committet.

---

### SEC-P3 — Eingabegrenzen + CSRF

**Ausgang, gemessen.**
- `POST /api/self-service/settings` mit 20.000 Zeichen in `agentName` -> HTTP 200, alle 20.000
  Zeichen gespeichert. Das Feld erreicht den System-Prompt des Telefon-Agenten;
  `src/self-service.js` prueft nur `typeof`.
- `POST /api/self-service/private-number` mit gueltigem Sitzungs-Cookie und
  `Origin: https://boese.example` -> HTTP 200. In `src/app.js`, `src/middleware.js`,
  `src/server.js`, `src/web-auth.js` existiert **keine** Origin-, Referer- oder
  CSRF-Token-Pruefung. Die heutige Deckung ist `SameSite=Lax` (`src/web-auth.js:97`) — also
  Browser-Verhalten, und `SameSite` ist site-, nicht origin-basiert: eine kompromittierte
  Subdomain von `sundartha.com` gilt als same-site.

**Auftrag.** (a) Laengen- und Inhaltsgrenzen auf allen Freitextfeldern, die in einen Prompt
laufen. (b) Serverseitige Herkunftspruefung auf den zustandsaendernden Self-Service-Routen.

**Abnahme.**
- 20.000 Zeichen in `agentName` -> **400** mit Laengenfehler, Wert im Store unveraendert.
- Fremder `Origin` auf `settings`, `private-number`, `subscribe`, `cancel` -> **403**, kein
  Zustandswechsel.
- **Fehlender** `Origin` -> weiterhin **200**. Das ist kein Schoenheitsfehler, sondern Pflicht:
  Server-zu-Server-Aufrufer senden keinen Origin, und eine fail-closed-Variante bricht sie.
- Jede neue Env-Variable (`CSRF_ENFORCE`, `AGENT_NAME_MAX_LEN`) wird neutral in `BASE_ENV`
  (`test/helpers.js`) gepinnt — sonst leakt die echte `.env` in jeden Spawn-Test
  (Lehre `test-base-env-drift`).

---

### SEC-P4 — ElevenLabs-Werkzeug-Token je Mandant

**Ausgang, gemessen (Differential mit Positiv-Kontrolle).** Gegen
`POST /webhooks/elevenlabs/lookup`, zwei Mandanten mit je einem laufenden Anruf:
(0) falsches Token -> `403 token`; (a) erfundene `conversation_id` -> `404
kein_laufender_anruf`; (b) `conversation_id` des Anrufs von Tenant B -> **`404
kanal_nicht_freigegeben`**. Der ABWEICHENDE Ablehnungsgrund in (b) ist der Beweis: die Bindung
an den fremden Anruf ist gelungen, gestoppt hat allein die Konfiguration des Opfers.
`activeCallBoundTo` (`src/routes/webhooks-elevenlabs.js:144-152`) sucht ueber alle Anrufe und
matcht nur `elevenlabsConversationId` + `status==='active'` — **kein Mandanten-Praedikat**.

**Auftrag.** Dem Token eine Mandanten-Dimension geben. Rotation allein genuegt nicht — das war
die gemessene Antwort auf Owner-Frage 8.4-5.

**Abnahme.** Derselbe Differential-Aufbau als Regressionstest: Fall (b) liefert denselben
Ablehnungsgrund wie Fall (a) — die Antwort darf nicht mehr verraten, dass der fremde Anruf
existiert. Positiv-Kontrolle: der BERECHTIGTE Mandant kommt unveraendert durch.

---

### SEC-P5 — Web-Haertung

**Ausgang, von aussen gemessen.** HSTS fehlt auf **allen drei** Oberflaechen
(`vodafone-agent.onrender.com`, `app.sundartha.com`, `sundartha.com`); `'unsafe-inline'` in
`script-src` auf zwei von drei; Session-Cookie heisst `session`, nicht `__Host-…`.

**Auftrag.** HSTS setzen, `'unsafe-inline'` aus `script-src` entfernen, Cookie auf
`__Host-`-Praefix umstellen.

**Abnahme.** `strict-transport-security` vorhanden mit `max-age >= 15552000` und
`includeSubDomains`; `script-src` ohne `'unsafe-inline'` und ohne `'unsafe-eval'`;
Set-Cookie-Name beginnt mit `__Host-`, traegt `Secure; Path=/` ohne `Domain=`.

**Kopplung, die im SELBEN Commit erledigt werden muss:** `test/headers.test.js:25` pinnt heute
das Gegenteil (`unsafe-inline` als Soll). Wird der Fix gebaut, ohne diesen Test umzuschreiben,
ist die Regressionsbank rot — und die Kette faellt hinter SEC-P0 zurueck.

**Preis, bewusst:** der Cookie-Rename beendet alle laufenden Sitzungen. Deshalb steht diese
Phase spaet.

---

### SEC-P6 — Antwort statt Haenger + drei Struktur-Waechter

**Ausgang, gemessen.** 17 von 17 sterbenden Gate-Datenquellen fuehren zu **null**
Wahlversuchen — das Sicherheitsversprechen haelt. Aber 14 der 17 enden **ohne jede Antwort**:
der Request haengt bis zum Client-Timeout, im Log steht `[guard] unhandledRejection`. Express 4
faengt Promise-Rejections aus async-Handlern nicht, und die Gate-Schleife
(`src/routes/api-calls.js:331-341`) hat keinen try/catch. `/voice/incoming` hat genau diesen
Schutz (`src/routes/voice.js:279`) — die Bauart existiert im Haus.

**Auftrag.** (a) Die Gate-Schleife antwortet auch im Fehlerfall. (b) Drei Waechter, die den
erreichten Stand einfrieren. (c) `scripts/spike2-anruf.mjs` entfernen oder hinter dieselbe
Gate-Kette legen: das committete Skript waehlt heute direkt beim Anbieter, an Denylist,
Land-Gate, Kostendecke und `OUTBOUND_FROZEN` vorbei.

**Abnahme.**
- Wirft eine Gate-Datenquelle, antwortet `/api/calls` mit Status >= 400 **und** der Dial-Spion
  bleibt bei 0 (die zweite Haelfte ist die wichtigere — sie darf sich nicht verschlechtern).
- **Waechter 1 (RLS-Inventar):** jede Tabelle mit Spalte `tenant_id` hat FORCE + Policy ODER
  steht mit Begruendung in einer im Test hartkodierten Liste. Positiv-Kontrolle im selben
  Test: eine angelegte Tabelle `probe_leak(tenant_id text)` ohne Policy MUSS rot machen.
- **Waechter 2 (Wahlfunktions-Aufrufer):** die Menge der Aufrufer je Dial-Weg entspricht der
  Erwartungsliste. Heute gemessen: `voiceControl().originateCall` <- `api-calls.js:502`;
  `originateViaCallControl` <- `telnyx-origination.js:20` <- `api-calls.js:479`; ElevenLabs
  `originateCall` <- `api-calls.js:464`. Positiv-Kontrolle: ein synthetischer Zusatz macht rot.
- **Waechter 3 (Werkzeugsatz):** `toolDefs("de")` liefert exakt
  `["end_call","get_consult","look_up","take_message"]`. Heute gruen — er soll gruen BLEIBEN.

## 3. Owner-Blocker (keine Phase, nicht vom Assistenten baubar)

| Was | Warum blockiert | Wirkung, solange offen |
|---|---|---|
| Vier Repo-Secrets `TELNYX_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `PLATFORM_ANI_E164` | nur mit `admin` auf `jonas986/vodafone-agent`; der Owner hat dort `admin=false` | der Art.-50-Offenlegungs-Drift-Waechter hat **nie** gelaufen und scheitert stuendlich (A-18 unbewacht) |
| Render-Zugang fuer den Owner | Produktions-Workspace gehoert `jonas@kroh-willich.de`; Owner-Konto: `Access denied` | DB-05 (Backup + Drill) und der OPS-03-Rest (Log-Stream zu einem Drittdienst) sind nicht messbar |
| Rotation des Render-API-Schluessels | Schluessel liegt literal in `~/.claude.json`, mit Schreibrechten auf die Produktion, ohne Ablauf | ein lokaler Schluessel-Abfluss ist ein Produktions-Vollzugriff |
| Stripe-Zugang | Konto `team@sundartha.com`, Google-Weg abgelehnt | OPS-04 (100-Prozent-Dauergutschein) offen — entscheidet, ob A-09 Geld- oder nur Invariantenschaden ist |
| Zwei-Faktor am Render-Konto des Owners | aus | die Sicherheit des Render-Kontos ist heute die des Google-Kontos |

## 4. Ausdruecklich NICHT Teil dieser Kette

- **ID-01** (Besitznachweis eigene Nummer) — Owner-Entscheidung 2026-09-08.
- **L-04** (Injektions-Bench) — kostet Geld, misst Modellverhalten; aendert die Fix-Liste nicht.
- **GATE-04** (prozessuebergreifende Reservierung) — latent, solange `numInstances=1`.
- **W4** (aktive Tests gegen Produktion) — durch Anbieter-Regeln gesperrt.
