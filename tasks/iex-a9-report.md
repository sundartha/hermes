# Phase IEX-A9 — Scope-Schalter und Abweisung ohne Registrierungs-Beleg

- **Gate:** PASS
- **finalBranch:** `phase/iex-a9-scope-schalter`
- **headCommit:** e5527fe3dc1fee1adbf51891ce8321d6b6b908dc
- **Basis:** master `dffd0ee`

---

## Plan (gekürzt)

Ziel: die ElevenLabs-Inbound-Weiche von zweiwertig (`budget`/`elevenlabs`) auf dreiwertig erweitern (`budget`/`elevenlabs`/`abgewiesen`), gesteuert über einen neuen Scope-Schalter `ELEVENLABS_INBOUND_SCOPE`:

- `allowlist` (Default) — heutiges Verhalten, nur gepinnte Tenants.
- `registrierte_dids` — jede aktive DID mit gültigem Registrierungs-Beleg; Tenant-Liste wirkt nicht. Ohne gültigen Beleg (Fingerabdruck ≠ laufender `sipUser`) → `abgewiesen`: fester Fehlersatz + Auflegen, kein Budget-Gespräch, keine Benachrichtigung (O5).

Kern-Entscheidungen:
- **D1** Scope-Enum als eigenes Blatt-Modul `src/elevenlabs/inbound-scope.js` (importfrei, Muster `stt-profile.js`).
- **D2** `zugangsFingerabdruck` zieht von `inbound-trunk-beleg.js` nach `inbound-path-decision.js` (vermeidet Import-Zyklus; die Weiche ist die „einzige Stelle, die den Zugang definiert“).
- **D3** Weiche ist strikt: unbekannter/fehlender Scope → `BUDGET` (fail-closed, in Produktion unerreichbar wegen fatalem Boot-Befund).
- **D4** ein Vokabular für den Pfad über `INBOUND_PATH`-Tokens (BUDGET/ELEVENLABS/ABGEWIESEN).
- **D5** Boot-Befund für unbekannten Scope ist unbedingt fatal, nennt nie den eingegebenen Wert (Log-Injection-Schutz).
- **D6** Pre-Mortem-Schutz gegen Wiederholte Zustellung nach Neustart: ein abgewiesener Call bekommt nie einen Gather, sondern Fehlersatz+Auflegen (`repeatDeliveryXml`/`inboundAbgewiesen`).
- **D7** Abweisung nutzt die bestehende `vermerkeUebergabeGescheitert` mit Grund `EL_OHNE_REGISTRIERUNG`.
- **D8** Testverteilung: spawn-lastige Weichen-Tests in `iel-b8-weiche.test.js`, reine Tabellen + Boot-Spawn in neuer `iex-a9-scope.test.js`.

Pre-Mortem deckte u. a. ab: Tippfehler im Scope, DID-Rotation mit altem Beleg, Owner-Benachrichtigung trotz Abweisung, Umgehung der Kostendecke, Budget-Gespräch nach Neustart ohne Hinweis, `.env`-Leck in Spawn-Tests, Owner-Pfad-Regression, Sweep-Race, falscher Tenant.

Betroffene Dateien laut Plan: neues `src/elevenlabs/inbound-scope.js` + `test/iex-a9-scope.test.js`; Edits an `inbound-path-decision.js`, `inbound-trunk-beleg.js`, `inbound-bridge-state.js`, `inbound-uebergabe-gescheitert.js`, `telephony/inbound-path.js`, `routes/voice.js`, `routes/webhooks-elevenlabs-init.js`, `config.js`, `boot-guard.js`, `boot.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, `test/helpers.js` sowie mehreren Testdateien (`iel-b1-schalter`, `iel-init-webhook`, `iel-b8-weiche`, `iex-a8-beleg`, `ie6-s1-assistant-entfernt`).

---

## Impl-Zusammenfassung

Neues Blatt-Modul `src/elevenlabs/inbound-scope.js`: Enum `allowlist|registrierte_dids`, Default `allowlist`, kein Wildcard.

Die Weiche in `inbound-path-decision.js` liefert jetzt drei Ergebnisse. Unter `registrierte_dids` wird der gespeicherte Beleg-Fingerabdruck gegen den laufenden `sipUser` geprüft. `zugangsFingerabdruck` zog dorthin um (`inbound-trunk-beleg.js` importiert es jetzt), kein Import-Zyklus. `INBOUND_PATH` bekam `ABGEWIESEN`.

`voice.js`:
- `INBOUND_PFAD` ist über die Weichen-Tokens indiziert (computed keys statt switch/if-else).
- Neue `sendAbweisung`: Sonde, Marker+Grund `ohne_el_registrierung` vor der Synthese, `[inbound]`-Logzeile ohne Nummer, fester Fehlersatz, Auflegen, Kurzbein-Kostenprofil.
- `repeatDeliveryXml` liefert für abgewiesene Calls nach Neustart Fehlersatz ohne Gather (D6), über gemeinsame `fehlersatzOhneAufloesungXml`.

Init-Route Stufe 3 nutzt dieselbe Weiche inkl. der angerufenen Nummer. `config.js` liest den Scope; `boot-guard.js#elInboundScopeFindings` ist fatal, nennt nie den Wert; `boot.js` ergänzt `assertElInboundScope` (13. Boot-Gate) und `scope=` im Banner. Sweep-Ergebniszeile trägt jetzt `scope=`. `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV und `PLAN-SECURITY.md` (neuer IEX-A9-Abschnitt) aktualisiert.

Tests: neue `test/iex-a9-scope.test.js` (28 Fälle inkl. Boot-Spawn), IEX-A9-8/9 in `iel-b1-schalter`, IEX-A9-10a/b/c in `iel-init-webhook`, IEX-A9-11..16 (Spawn) in `iel-b8-weiche`, mechanische Anpassungen in `iex-a8-beleg` und `ie6-s1-assistant-entfernt`. Phasen-Abnahme: 171/171 grün.

**Smoke-Test:** unbekannter Scope → exit 1, Wert nicht in der Ausgabe; Default-Start → Banner „Inbound-EL: aus, 0 Tenants, scope=allowlist“, `/healthz` 200, `/voice/incoming` 200 mit Budget-Gather.

### Deviations

1. `inboundAbgewiesen` prüft exakt `costProfile === TELNYX_INBOUND_BUDGET && elFallbackAt` statt der im Plan skizzierten `bridgeStateOf === KEIN_EL_INBOUND && elFallbackAt` — die geplante Tabelle IEX-A9-6 verlangt „Outbound-Profil + Marker → false“, was die Plan-Fassung fälschlich `true` ergeben hätte. Die präzisere Fassung erfüllt die eigene Testtabelle.
2. `render.yaml`: `ELEVENLABS_INBOUND_SCOPE` steht nach `ELEVENLABS_INIT_WEBHOOK_TOKEN` statt direkt nach `TENANT_IDS`, weil der Gruppenkommentar dort „ALLE sync: false“ sagt und ein `value`-Eintrag mittendrin das falsch gemacht hätte. IEX-A9-9 prüft per Regex, nicht positionsabhängig.
3. `iel-b8-weiche`: statt neuer `FEHLERSATZ_XML`-Konstante Wiederverwendung des bestehenden identischen Helfers `fehlersatzTexml()` (keine Duplikation). Neue Konstanten `EL_ALLOWLIST_ENV` und `GOLDEN_CALL_SID` für IEX-A9-16.
4. `iel-init-webhook`: IEX-A9-10 in drei Tests (10a/b/c) mit geteilten Helfern gesplittet; ein `angerufeneNummer`-Helfer war nötig, weil Lint-Regel G36 die tiefe Aufrufkette ablehnt.
5. **Voller `npm test` ist nicht grün:** `IEL-B4-4` (`test/iel-b4-nachlauf.test.js`, von dieser Phase nicht angefasst) schlägt in beiden vollen Läufen fehl, läuft isoliert grün (19/19). Ursache: zwei getrennte `Date.now()`-Aufrufe im Test-Seed plus `Math.ceil`-Minutenrundung (120.001 s → 3 statt 2 Minuten) unter Last — ein Timing-Flake, nicht durch IEX-A9 verursacht, ehrlich als rot gemeldet.
6. `.env.example`-Kommentar verweist wie im Plan gefordert auf `node scripts/iel-geheimnisse.mjs scope`; dieser Unterbefehl existiert laut `tasks/iex-spec-a.md` erst in einer späteren Phase der Kette (Vorwärtsverweis).

---

## Safety-Urteil (final)

**approved: true** — alle Achsen (Tests unabhängig grün, Safety-Gates intakt, Offenlegung intakt, Auth fail-closed intakt, keine Secret-Lecks, Scope eingehalten, Verhalten wie beabsichtigt) bestätigt. Keine Blocker.

Concerns (keine Blocker):
- Kleine Restlücke (nicht aus A9): bei einem abgewiesenen Call liefert `bridgeStateOf` `KEIN_EL_INBOUND`; `/voice/el-rueckfall` würde bei einem wiederholten, Telnyx-signierten Body theoretisch `FOLGE_GATHER` liefern. Praktisch unerreichbar (kein Redirect/Gather im Abweisungs-TeXML, keine Fristen armiert). Vorschlag für Folgephase: `rueckfallEntscheidungFuer` soll bei `inboundAbgewiesen(call)` AUFLEGEN liefern.
- Begründete, testgestützte Scope-Erweiterungen: Verschiebung des Fingerabdrucks, `scope=` in der Sweep-Zeile, neues `inboundAbgewiesen`/D6, neues Blatt-Modul, erweiterte `ERLAUBTE_DATEIEN`-Whitelist im Leck-Wächter.
- `PLAN-SECURITY.md` erklärt F3 (Betreiber-Alarm) zur Vorbedingung vor dem Scope-Flip — strenger als Spec/Runbook (dort nur „offen“); Lead sollte das mit Runbook/Owner abgleichen.
- `.env.example` verweist vorwärts auf einen noch nicht existierenden Skript-Unterbefehl (IEX-A11).
- Reine Leerzeichen im Scope-Env werden nach `trim()` zu `''` und lösen den fatalen Boot-Befund aus (fail-closed, im Befundtext benannt).
- IEX-A9-12 prüft 0 Notifications und leere Summary, aber SMS/Mail nicht explizit (deckt A2-Tests ab).

## Security-Urteil (final)

**approved: true, keine Blocker.** Geprüfter Diff master..phase/iex-a9-scope-schalter (21 Dateien). Keine neue öffentliche Route, Signatur-MW und Init-Token-Schranke unverändert. Weiche fail-closed bestätigt (Schalter aus/unvollständiger Zugang/unbekannter Scope → BUDGET, unbekannter Scope zusätzlich fataler Boot-Befund). `registrierte_dids` nur mit Beleg UND passendem Fingerabdruck → ELEVENLABS, sonst ABGEWIESEN. Weiche läuft nach Signatur, `forIncoming`, `numberRecordByE164`, `budgetExceeded`; Kostendecke greift vor Abweisung (IEX-A9-13). Marker+Grund vor Synthese, kein Dial/Frist/Transkript/Notification/Summary. Wiederholte Zustellung nach Neustart liefert Fehlersatz ohne Gather. Secrets: kein Passwort/sipUser im Log.

Concerns:
- Init-Route Stufe 3 (`elWegFuer`) prüft unter `registrierte_dids` nicht explizit `numberRecord.tenantId === call.tenantId` — praktisch ausgeschlossen (Beleg wird bei Freigabe genullt), aber ein zusätzlicher Tenant-Gleichheitsriegel wäre ein billiger Fail-closed-Zusatz.
- Abweisung synthetisiert je Call den Fehlersatz (TTS-Kosten) und bucht mind. eine Minute — durch Signatur/`budgetExceeded`/Max-Dauer begrenzt, entspricht Spec; Owner-Frage F2 bleibt offen.
- Fingerabdruck deckt nur `sipUser`; reine Passwort-Änderung von Hand lässt alte Belege wirksam (dokumentiert, Runbook-Sache).
- Restrisiko §6(a): DID ohne Beleg hört bis zum nächsten Boot-Sweep den Fehlersatz, ohne Benachrichtigung — F3 muss vor Scope-Umstellung erfüllt sein.

---

## Clean-Code-Audit (final)

- **s1:** []
- **s2:** []
- **s3:**
  1. `src/routes/voice.js:340-343/517` — `repeatDeliveryXml` nimmt jetzt das volle `deps`-Bündel statt der vorher explizit benannten `{render, followupTurnDirectives}`; kein Blocker (Vereinheitlichung vertretbar, da die Funktion jetzt auch `fehlersatzOhneAufloesungXml` aufruft), aber ein Kommentar mit den tatsächlich genutzten deps-Feldern würde die Lesbarkeit verbessern.
  2. `src/boot.js:181-182` — Kommentarzeile zu den 13 Boot-Gates ist sehr lang (rein kosmetisch, ggf. umbrechen).
- **s4:**
  1. `src/elevenlabs/inbound-scope.js` — eigene Datei für ein sehr kleines Enum+2 Konstanten+1 Prädikat, aber bewusst im Muster von `telephony/stt-profile.js` (importfreies Blatt gegen Zyklen), im Kontext gerechtfertigt, kein echter Flag.

**blocker: false**

**Verdict: PASS.** Sauberer, isolierter Feature-Schnitt: zyklenfreies Enum-Modul, dreiwertige Weiche mit kleinen Hilfsfunktionen statt verschachtelter ifs (max. Tiefe 2), Fingerabdruck-Funktion verschoben statt dupliziert (G5, per Test IEX-A9-4 abgesichert), fail-closed Boot-Gate mit Log-Injection-Schutz, fail-closed-Default bei unbekanntem Scope. Umfangreiche tabellengetriebene Tests inkl. Grenzfälle, alle 169 zielgerichteten Tests grün, `node --check` sauber. Voller `npm test`-Lauf zeigt bekannte Suite-Flakes (IE4-3/4/5, W5-6b), isoliert nachgestellt und grün — keine Regression durch diesen Diff.

**passNotes:** keine Duplizierung (Fingerabdruck an einer Stelle), G23-Polymorphie sauber (computed keys statt switch), Magic Numbers benannt (`ZUGANG_FP_HEX_ZEICHEN`, `FP_ALGORITHMUS`), Kommentare aktuell und dokumentieren Owner-Entscheidungen sauber, Safety-Gate-Reihenfolge unangetastet, Boot-Refusal end-to-end getestet (IEX-A9-7), Config/Env/BASE_ENV kohärent (IEX-A9-9), Money/Concurrency/Auth nicht berührt.

**topTodos:** kein Pflicht-Fix für diesen Merge; optional Kommentar an `repeatDeliveryXml`/`deps`-Parameter ergänzen; bekanntes Restrisiko (DID-ohne-Beleg-Lücke bis zum nächsten Boot-Sweep, Sweep-Skalierung) als Rollout-Vorbedingung im Auge behalten.

---

## Fix-Runden

Keine — der Clean-Code-Audit lief ohne s1/s2-Befunde durch, es waren keine Fix-Runden nötig (`=== FIXES ===` blieb leer).
