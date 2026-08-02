# Phase AUTH-P4 — Tote, aber scharfe Routen loeschen (B1)

**Gate: PASS**
**finalBranch:** `phase/auth-p4-tote-routen-loeschen`
**Commit-Hash:** `aff0009` (ein Commit, Basis `master@e76798c`)

---

## Ehrlichkeitshinweis vorab

Diese Phase behauptet **keinen unbelegten Gewinn**. Die Praemisse "diese sechs Routen sind tot"
beruht auf einer **repo-weiten `grep`-Enumeration** (`src/`, `scripts/`, `apps/web/src/`,
`public/`, `test/`, `docs/`, `tasks/`, `src/mcp-tools.js`) nach den sechs Routenpfaden und den
Fabriknamen `makeTenantWriteRoutes`/`makeProfileRoutes`. Diese Methode hat eine **harte Grenze**:
sie findet nur Aufrufer, die als Code oder Doku **im Repo** stehen. Ein Aufrufer **ausserhalb**
des Repos — ein Betreiber-`curl`, ein gespeichertes Postman-Request, ein Browser-Bookmark, ein
Cron-Job auf einer fremden Maschine — ist per `grep` grundsaetzlich nicht auffindbar und wurde
nicht ausgeschlossen, nur nicht gefunden. Was diese Phase am heutigen Live-Deploy aendert, siehe
Abschnitt "Was am Deploy von aussen sichtbar wird".

---

## 1. Aufrufer-Enumeration

Gegrept ueber `src/`, `scripts/`, `apps/web/src/`, `public/`, `test/`, `docs/`, `tasks/`,
`src/mcp-tools.js` sowie repo-weit (ohne `node_modules`, `.git`, `dist`, `.astro`) nach den sechs
Routenpfaden und den beiden Fabriknamen.

| Route / Symbol | Lebender Code-Aufrufer im Repo? | Fund-Zusammenfassung |
| --- | --- | --- |
| `POST /api/settings` | **Nein** | Nur Kommentare/Doku/Tests. ~10 tote Kommentare (C2, mitgezogen), zwei Betriebs-Notizen (`tasks/al-testcall-checklist.md:110`, `tasks/al-env-changes.md:43` — manueller Vorgang, s. u.), Rest Tests. |
| `POST /api/action-items/:id/toggle` | **Nein** | Nur Definition + ein Kommentar in `app.js` + ein Test. `src/mcp-tools.js:912` liest `s.actionItems` NUR ueber `GET /api/state` (lesend) — ruft die Toggle-Route nie. |
| `POST /api/calendar` | **Nein** | Nur Definition + Kommentare (`claude.js`, `app.js`, `api-calls.js`, `_validation.js`, `store/defaults.js` — alle C2) + `PLAN-SECURITY.md` (Doku, unberuehrt) + Tests. `src/mcp-tools.js` hat nur `get_calendar` (lesend), kein Schreib-Tool. |
| `GET/POST/DELETE /api/profiles` | **Nein** | Definition + Kommentare (`app.js`, `db/schema.sql`, mitgezogen), Mitzieh-Stellen (`route-policy.js`, `probe-auth.sh`, `route-auth-inventory.test.js`), diverse Tests. `apps/web/src/`, `public/`, `src/mcp-tools.js`, `scripts/` (ausser Probe): 0 Treffer. |
| `makeTenantWriteRoutes` / `makeProfileRoutes` | **Nein** | Einziger lebender Mount war `src/app.js` (jetzt entfernt). Uebrige Treffer: DI-Muster-Kommentare in anderen Routen-Modulen (C2). |
| `validIdentity` / `IDENTITY_MAX_LEN` | **Ja — genau ein Cross-Modul-Konsument** | `src/routes/api-onboard.js:17`, jetzt auf `_validation.js` umgestellt. Kein weiterer Treffer in `src/`, `scripts/`, `apps/web/src/`, `test/`. |

**Ergebnis in einem Satz:** kein lebender Code-Aufrufer ausserhalb von Tests gefunden — die
Praemisse "tot" haelt **innerhalb der Grenzen der Enumeration** (s. Ehrlichkeitshinweis oben und
Abschnitt "Was diese Phase NICHT belegt").

**Zwei Betriebs-Notizen als Sonderfall:** `tasks/al-testcall-checklist.md:110` (`allowCallMemory=true`
per `POST /api/settings` setzen) und `tasks/al-env-changes.md:43` beschreiben einen **manuellen**
Vorgang, keinen Code-Aufrufer. Owner-Entscheidung 4 (Plan) akzeptiert diesen Verlust ausdruecklich;
der Ersatzweg (direkter DB-Eingriff) steht in `PLAN-SECURITY.md`.

---

## 2. Umzug `validIdentity` / `IDENTITY_MAX_LEN`

Byte-identisch von `src/routes/api-profiles.js` nach `src/routes/_validation.js` gezogen — als
Anbau an eine seit T4 Phase 2 **bestehende** Datei (kein Neuanlage-Vorgang, entgegen einer
ueberholten Formulierung in Spec/`PLAN-AUTH-GATE.md`, s. Befund B1 im Plan). Der Block sitzt
direkt nach dem `KEY_FACTS_LIMITS`-Re-Export, vor `TEXT_LIMITS`.

```js
export const IDENTITY_MAX_LEN = 254; // RFC 5321
export const validIdentity = (e) =>
  typeof e === "string" && e.length > 0 && e.length <= IDENTITY_MAX_LEN && !/\s/.test(e);
```

Der Modulkopf-Kommentar von `_validation.js` wurde korrigiert (nannte vorher nur `/api/calls` +
`/api/calendar` als Konsumenten; jetzt generisch "mehrere Konsumenten", ohne Route-Aufzaehlung,
damit er nicht erneut verrottet).

**Einziger Konsument danach:** `src/routes/api-onboard.js`, ein Zeilen-Edit:

```diff
-import { validIdentity, IDENTITY_MAX_LEN } from "./api-profiles.js";
+import { validIdentity, IDENTITY_MAX_LEN } from "./_validation.js";
```

Warum `node --check` hier nicht reicht: es prueft Syntax, nicht Modul-Aufloesung. Ein vergessener
Export waere erst zur Ladezeit als `SyntaxError` sichtbar geworden. Der Nachweis ist deshalb ein
**Spawn-Test**, der wirklich bootet — AUTH-P4-7 (s. Abschnitt 4).

---

## 3. Die vier Mitzieh-Stellen (Vorher/Nachher)

**(1) `src/route-policy.js`** — sechs Eintraege **ersatzlos** aus `GATE_ONLY_ROUTES` entfernt
(nicht nach `PUBLIC_ROUTES` verschoben).

| | vorher | nachher |
| --- | --- | --- |
| `GATE_ONLY_ROUTES`-Eintraege | 21 | 15 |
| `PUBLIC_ROUTES` | 19 | 19 (unveraendert — die sechs sind gefallen, nicht umetikettiert) |

Block-Kommentar ("HARTE VORBEDINGUNG FUER P7 …") bleibt wortgleich stehen — er beschreibt genau
diesen Vorgang und ist danach weiterhin wahr.

**(2) `test/route-auth-inventory.test.js`** — sechs Zeilen aus `ROUTE_FINGERPRINT` gestrichen.

| | vorher | nachher |
| --- | --- | --- |
| Fingerprint-Eintraege | 52 | 46 |

Liste bleibt alphabetisch sortiert (Assertion vergleicht gegen `[...PROD_KEYS].sort()`).

**(3) `scripts/probe-auth.sh`** — sechs Zeilen aus dem `sitzung`-Block **entfernt**, im
`fehlt`-Block (nach `/dashboard`) neu eingesetzt.

| | vorher (ART) | nachher (ART / STATUS / ANTWORTET) |
| --- | --- | --- |
| Alle sechs Routen | `sitzung` | `fehlt` / `401` / `gate` |

Begruendung (ein Satz): das Basic-Auth-Gate haengt **vor** Express' 404-Handler — eine geloeschte
Route ist von aussen von einer geschuetzten nicht zu unterscheiden; messbar wird der 404 erst mit
P7. `bash -n scripts/probe-auth.sh` gruen.

**(4) `docs/RUNBOOK-AUTH-REVIEW.md`** — **kein Edit.** Verifiziert per `grep` auf
`profiles|settings|calendar|action-item|api-tenant-write|api-profiles`: 0 Treffer. Die Spec sah
diesen Punkt selbst als bedingt vor ("nur, falls").

---

## 4. Neue Tests

Neue Datei `test/auth-p4-deleted-routes.test.js` (AUTH-P4-1..7), plus AUTH-P4-8 in
`test/probe-auth-table.test.js`. Praefix `AUTH-` faellt nicht unter das i18n-Katalogmuster
(`DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD` + Ziffer) — laeuft im
`npm test`-Regressionslauf, wo Rot zaehlt.

**Diskriminator:** Status allein reicht nicht — zwei der geloeschten Handler antworteten **auch
gemountet** mit 404 (`action-items/:id/toggle` bei unbekannter id, `DELETE /api/profiles/:tenantId`
bei unbekannter tenantId). Gemeinsamer Helfer prueft deshalb zusaetzlich den Content-Type: alle
sechs Handler antworteten mit `res.json(...)`, Express' eingebauter 404 liefert `text/html`.

| ID | Assertion (Kern) |
| --- | --- |
| AUTH-P4-1 | `POST /api/settings` → 404 + kein JSON-Body; `settings[TENANT].agentName` unveraendert |
| AUTH-P4-2 | `POST /api/action-items/:id/toggle` auf **existierende** id → 404 + kein JSON; `done === false` bleibt |
| AUTH-P4-3 | `POST /api/calendar` → 404 + kein JSON; kein neuer Eintrag im Store |
| AUTH-P4-4 | `GET /api/profiles` → 404 + kein JSON |
| AUTH-P4-5 | `POST /api/profiles { unrestricted: true }` → 404 + kein JSON; kein Profil im Store (der sicherheitstragende Test — schliesst den Umgehungs-Vektor auf `outbound-gates.js`) |
| AUTH-P4-6 | `DELETE /api/profiles/:tenantId` auf **existierendes** Profil → 404 + kein JSON; Profil bleibt bestehen |
| AUTH-P4-7 | Server bootet (ueberhaupt-Spawn = Boot-Beweis); `POST /api/onboard` liefert 400 mit interpoliertem `254`-Fehlertext an zwei Nutzungsorten (tenantId, idpSubject) |
| AUTH-P4-8 | Die sechs Routen: `GATE_ONLY_KEYS.has(k) === false`, Probe-Tabellen-Eintrag existiert mit `art==="fehlt"`, `status==="401"`, `antwortet==="gate"` — deckt Befund B3 (Politik nachgezogen, Probe-Skript vergessen) |

Isoliert gruen: 7/7 in `auth-p4-deleted-routes.test.js`.

---

## 5. Entfallene / umgestellte Bestandstests

### Ganze Dateien geloescht

| Datei | Begruendung |
| --- | --- |
| `test/api-routes.test.js` | einziger Test pinnte Paritaet der `/api/profiles`-Gruppe; Route weg → Zusage kehrt um, getragen von AUTH-P4-4/-5/-6 |
| `test/api-action-items-toggle.test.js` | Charakterisierungstest genau der geloeschten Route; ersetzt durch AUTH-P4-2 |

### Einzelne Tests ersatzlos entfallen (Route WAR die Zusage)

- `test/profiles.test.js`: Profil-Verwaltung POST/GET/DELETE + Audit (Handler weg)
- `test/profiles.test.js`: Booking-Gate auf `POST /api/calendar` (einziger Konsument von
  `allowBooking` faellt mit — **die gegatete Aktion selbst verschwindet**, benannter Rest 6.2)
- `test/api.test.js`: Eingabe-Validierung `/api/calendar` (route-lokale Datumslogik)
- `test/api.test.js`: `VOICE-09` (Zusage haelt `test/f1-geo-store.test.js` auf Store-Ebene weiter
  — **verifiziert**, kein Verlust; aber der `test:gates`-Katalog verliert einen gruenen
  Mechanismus-Test)
- `test/i6-write-scope.test.js`: drei Sub-/Testfaelle (Settings-Scoping, Calendar-Scoping,
  X-Internal-Identity-Huelle) — HTTP-Naht weg, Zusage **gegenstandslos**, nicht ungeprueft (der
  verbleibende `/api/self-service/settings`-Pfad nimmt den Tenant strukturell aus der Session)
- `test/audit.test.js`: `settings_update`-Audit-Test — Event existierte nur in
  `api-tenant-write.js` und ist weg. **Ehrliche Luecke:** der ueberlebende Pfad
  (`self_service_settings`) hat heute keinen Audit-Test; unveraendertes Verhalten, nur ungetestet.

### Umgestellt (Zusage bleibt, Messpunkt wandert auf Store-Ebene)

- `test/api.test.js` Body-Size-Limit → Traeger auf `POST /api/calls` (413) bzw.
  `POST /voice/turn?callId=missing` (kleiner Body) umgestellt
- `test/profiles.test.js` `(e) {profiles}`-Whitelist → direkt gegen `updateSettings` (Store-Ebene)
- `test/api.test.js` Settings-Whitelist (2 Sub-Tests) → direkt gegen `updateSettings`
- `test/language-switch-midcall.test.js` (E2E-03, 2 Tests) → Seed traegt `call.language="de"` UND
  `settings.language="en"` von Anfang an statt Live-HTTP-Flip; verifiziert isoliert gruen (2/2)
- `test/auth-p3-bootstrap-fallback.test.js` `AUTH-P3-12` → Traeger auf
  `POST /api/calls/:id/consult/answer` umgestellt, ID/Name bleiben. **Von SAFETY als Konzern
  vermerkt:** die Store-Assertion ("Settings-Bucket bleibt unangetastet") ist dabei ersatzlos
  entfallen, geprueft wird nur noch 403 + `assertGateAbsent`; entschaerft, weil
  `requireTenant(req, res)` in `api-calls.js:332` nachweislich die erste Anweisung des Handlers
  ist — der Write kann nicht laufen, aber die Messung ist schwaecher als vorher.
- `test/plans-route.test.js` 401-Kontrast → `GET /api/state` statt `/api/profiles`

Nur Kommentar, keine Testaenderung: `test/f2-sms-opt-in-persist.test.js`,
`test/p1b-no-booking.test.js`.

---

## 6. Boot-Nachweis

AUTH-P4-7 spawnt den Server als echten Kindprozess (`startServer()`, kein `node --check`) und
beweist zweifach, dass der Import in `api-onboard.js` nicht zerrissen ist: (1) der Server bootet
ueberhaupt (`startServer()` wirft sonst), (2) der Fehlertext von `POST /api/onboard` enthaelt den
interpolierten Wert `254` (= `IDENTITY_MAX_LEN`) an zwei Nutzungsorten (`tenantId`, `idpSubject`).

Die SAFETY-Gegenprobe (unabhaengiger Worktree) hat das nochmal mit einem **eigenen** Spawn
nachgemessen: `/healthz` → 200 mit `configHash`, kein `stderr`; alle sechs Pfade → 404
`text/html` (Express-Default, kein Handler antwortet); Kontrastprobe im selben Lauf (Legacy-
Checkout-Paar) → 404 `application/json` (Route steht noch, eigener Handler). Eigener
Routengraph (`app._router` rekursiv durchlaufen, `storeBackend='pg'`): 46 Routen, keine der
sechs darunter, `PUBLIC_ROUTES` unveraendert bei 19.

---

## 7. Safety-Urteil

**Verdict: FREIGABE (approved: true), keine Blocker.**

- `disclosureSentence`, Signaturpruefung, `OUTBOUND_FROZEN`, Denylist/Land/Stundenlimit, pro-Tenant-
  Kostendecke: alle unberuehrt — verifiziert per Null-Diff auf `outbound-gates.js`, `plans.js`,
  `config.js`, `wiring/auth-gate.js`.
- Sicherheitsrelevanter Gewinn (verifiziert, nicht nur behauptet): `POST /api/profiles
  {"unrestricted":true}` konnte fuer eine beliebige `tenantId` das Feld setzen, das
  `src/telephony/outbound-gates.js:310` liest, um das Verifikations-Gate (Abo+KYC) zu umgehen —
  dieser HTTP-Weg existiert nach dieser Phase nicht mehr (AUTH-P4-5 pinnt es).
- Eigene Aufrufer-Enumeration (SAFETY, unabhaengig von IMPL) kommt zum selben Ergebnis: kein
  lebender Aufrufer.
- `npm test`: 3753/3753 gruen im zweiten Lauf (ein transienter Volllast-Flake in
  `test/assistant-context-http.test.js` im ersten Lauf, isoliert 10/10 gruen — bekanntes Muster,
  keine Regression, Datei vom Commit nicht beruehrt).
- `npm run test:gates`: 3 rote Tests, alle drei **pre-existing und unberuehrt** (GAP-05,
  2x GAP-15 — Stripe-Coupons/Rechtstext, nichts mit Auth-Routen zu tun). Die von dieser Phase
  geaenderten E2E-03-Tests laufen NUR in diesem Lauf (bei `npm test` ausgefiltert) und sind beide
  gruen.

**Von SAFETY benannte Concerns (kein Blocker, aber Merge-relevant):**

1. **Stale Base**: Branch-Basis `e76798c`, `master` steht auf `eef7f13` (4 AL-D3-Commits Differenz).
   `git merge-base --is-ancestor master HEAD` schlaegt fehl — vor dem Merge Rebase/Merge + erneuter
   `npm test` noetig.
2. AUTH-P3-12 misst nach der Umstellung schwaecher (s. Abschnitt 5).
3. Ein Umlaut in einer neuen Kommentarzeile in `test/language-switch-midcall.test.js`
   ("die frühere" statt "die fruehere") — Konventionsbruch, einzige Fundstelle im Diff.
4. Vier Store-Fassaden-Funktionen (`listProfiles`, `deleteProfile`, `toggleActionItem`,
   `addCalendarEvent`) verlieren ihren letzten `src/`-Aufrufer — bewusst vertagt (eigener
   Store-Aufraeum-Schritt, zwei Backends betroffen), aber offene Schuld gegen das CLAUDE.md-Verbot
   toten Codes.
5. `PROFILE_FIELDS.allowBooking` ist ein Gate ohne gegatete Aktion (einziger Konsument war
   `/api/calendar`).
6. `tasks/al-testcall-checklist.md:110` beschreibt weiterhin den jetzt-404-Weg, ohne selbst
   editiert zu sein (Scope-Entscheidung, Ersatzweg nur in `PLAN-SECURITY.md`).
7. `test/audit.test.js` verliert den einzigen Test fuer `settings_update`; nachgeprueft: der
   ueberlebende Pfad hatte **auch vorher schon** keinen eigenen Audit-Test — keine neue Luecke,
   aber die letzte Settings-Audit-Naht bleibt ungetestet.
8. `test:gates` verliert `VOICE-09` als gruenen Mechanismus-Test; die materielle Zusage lebt
   nachweislich in `test/f1-geo-store.test.js:201` weiter.
9. `src/routes/_tenant.js:11` nennt weiterhin `makeProfileRoutes` als DI-Vorbild (toter Verweis,
   bewusst nicht angefasst — Datei steht unter Anfassverbot dieser Phase, faellt in P5).

---

## 8. Clean-Code-Audit

**Verdict: PASS — keine S1/S2-Blocker.**

- **S1:** keine Funde.
- **S2:** keine Funde.
- **S3 (ein Fund):** `src/routes/_tenant.js:11` — Modulkommentar nennt weiterhin `makeProfileRoutes`
  als DI-Vorbild; das Modul ist geloescht, der Verweis zeigt ins Leere. In `PLAN-SECURITY.md`
  unter "Drei benannte Reste" explizit als toter Verweis benannt, bewusst auf P5 verschoben (Datei
  steht unter Anfassverbot dieser Phase).
- **S4:** keine Funde.

Geprueft (Auszug): keine verwaisten Importe (G12); Kommentar-Mitzug systematisch durchgegangen —
ein uebersehener Fund (der S3 oben, aber im Plan bereits als offener Rest dokumentiert); tote
Testfixtures/Helfer keine gefunden, die vier verwaisten Store-Fassaden sind bewusst nicht entfernt
(richtige Scope-Entscheidung fuer eine chirurgische Loesch-Phase); `_validation.js` traegt exakt
das Umgezogene, keine Duplizierung (G5/S2); neue Tests: ein Konzept pro Test (P14), kein geteilter
veraenderlicher Zustand zwischen Tests. Audit lief korrekt gegen `git merge-base master
phase/auth-p4-tote-routen-loeschen` (= `e76798c`), nicht gegen den heute weiter gelaufenen
`master`-HEAD — sonst haetten AL-D3-Divergenzen faelschlich als Teil des Diffs gezaehlt.

---

## 9. Fix-Runden

**Keine.** Die Phase kam direkt aus IMPL mit `testsPass: true` und `nodeCheckPass: true` bei
SAFETY und CLEANCODE ohne Blocker durch — der `FIXES`-Abschnitt der Quelle ist leer. Alle unter
Punkt 7/8 gelisteten Concerns/S3-Fund sind bewusste, dokumentierte Vertagungen (P5 bzw.
eigenstaendiger Store-Aufraeum-Schritt), keine Nacharbeit innerhalb dieser Phase.

---

## 10. Was am heutigen Deploy von aussen sichtbar wird — und was nicht

**Fuer einen Aufrufer ohne Credentials: nichts.** Alle sechs Pfade antworten vorher wie nachher
**401 mit `WWW-Authenticate: Basic`**. Begruendung: `src/wiring/auth-gate.js` haengt vor Express'
404-Handler und deckt `/api/*` vollstaendig ab — ein unbekannter Pfad ist von einem geschuetzten
nicht zu unterscheiden. Diese Phase entfernt nur, was **hinter** dem Gate lag. Sichtbar wird der
Unterschied erst mit P7 (dann 404) — deshalb bleiben die Probe-Zeilen bewusst auf 401/`gate`
stehen und drehen erst dort.

**Fuer einen Aufrufer MIT dem Dashboard-Passwort** aendert sich sehr wohl etwas: die sechs Routen
antworten 404 statt zu wirken. Das ist der beabsichtigte Effekt dieser Phase. Laut Enumeration
gibt es im Repo keinen solchen Aufrufer — mit der in Abschnitt 1 genannten Grenze (ausserhalb des
Repos nicht pruefbar).

---

## 11. Was diese Phase NICHT belegt

- **Dass niemand ausserhalb des Repos diese Routen von Hand gefahren hat.** Die Enumeration deckt
  Code und Doku im Repo, nicht Betriebsgewohnheiten, gespeicherte Requests oder Bookmarks eines
  Betreibers. Ein solcher Aufrufer wuerde ab jetzt am Live-Deploy weiterhin 401 sehen (nicht 404,
  s. Abschnitt 10) — solange er kein gueltiges Dashboard-Passwort mitschickt, ist der Unterschied
  fuer ihn ohnehin nicht sichtbar; **mit** gueltigem Passwort wuerde er ab diesem Deploy 404 statt
  Wirkung erhalten, unbemerkt bis zum naechsten Versuch.
- **Dass die zwei Betriebs-Notizen (`tasks/al-testcall-checklist.md:110`,
  `tasks/al-env-changes.md:43`) angepasst sind.** Sie sind es nicht (Scope-Entscheidung); sie
  beschreiben weiterhin den jetzt-toten `POST /api/settings`-Weg.
- **Dass die vier verwaisten Store-Fassaden-Funktionen entfernt sind.** Sie bleiben bewusst stehen
  (eigener, spaeterer Store-Aufraeum-Schritt, zwei Backends betroffen).
- **Dass P7 (401→404-Umstellung) bereits umgesetzt ist.** Diese Phase bereitet sie vor (Probe-
  Zeilen auf `fehlt`/`gate` gedreht), setzt sie aber nicht um.
- **Dass die Merge-Bereitschaft gegeben ist ohne Weiteres.** Der Branch haengt auf einer stale
  Basis (`e76798c` vs. aktueller `master`); vor dem Merge ist Rebase/Merge + ein erneuter
  `npm test`-Lauf noetig (SAFETY-Concern 1).
- **Dass `settings_update`-Audit fuer den ueberlebenden Settings-Schreibpfad getestet ist.** Ist es
  nicht, war es aber laut Nachpruefung auch vorher nicht — keine neue Regression, eine bestehende
  Luecke.
