# Durchgang 2026-08-19 (2): EL-Weg LIVE bringen (Cutover auf Auftrag des Eigentuemers)

Auftrag woertlich: "mache alles, was du jetzt gesagt hast" - Push, Deploy, Keys,
Tenant-Freischaltung, Prod-Smoke-Anruf. Erster Live-Eingriff dieser Kette,
ausdrueckliches Go liegt vor.

- [ ] 1. Merge upstream/master (33 Commits, u.a. Stripe-Reconcile + Web-Login) in
      master. 19 beidseitig geaenderte Dateien, darunter config.js/schema.sql/
      state-ops.js/pg.js. ERWARTET: Merge ohne verlorene Seite; `node --check`
      auf allen Konfliktdateien OK. PRUEFUNG: `git diff --stat`, Konfliktliste 0.
- [ ] 2. Volle Suite gruen NACH dem Merge. ERWARTET: `npm test` 0 rot.
      PRUEFUNG: Exit-Code + Schlusszeile.
- [ ] 3. Push origin + upstream (KEIN force). ERWARTET: beide Remotes auf dem
      Merge-Commit. PRUEFUNG: `git rev-parse` remote == lokal.
- [ ] 4. Render-Inventur VOR jedem Eingriff: Service-IDs, autoDeploy-Zustand,
      vorhandene Env-Keys (nur Namen). ERWARTET: Hermes-Hauptservice gefunden;
      ELEVENLABS_API_KEY + Webhook-Token + DeepSeek-Key vorhanden.
      PRUEFUNG: get_service/Env-Liste.
- [ ] 5. Env setzen: ELEVENLABS_OUTBOUND_ENABLED=true, LOOKUP_ENABLED=true,
      EXA_API_KEY (aus lokaler .env). Fehlende Consult-Flags ergaenzen.
      ERWARTET: nur ADDITIV (kein bestehender Key geloescht). PRUEFUNG:
      Env-Liste vorher/nachher vergleichen.
- [ ] 6. Deploy ausloesen, Ende abwarten. ERWARTET: Status live, /healthz 200.
      PRUEFUNG: get_deploy + curl https://app.sundartha.com/healthz.
- [ ] 7. Prod-DB: Owner-Tenant-Profil allowLookup=true (DB-Schnappschuss!).
      Danach Neustart (Deploy aus Schritt 6 zaehlt nur, wenn DB-Update VOR dem
      Neustart lag - sonst zweiter Restart). ERWARTET: SELECT zeigt
      allowLookup=true. PRUEFUNG: psql-Readback.
- [ ] 8. Routen-Smoke ohne Anruf: POST /webhooks/elevenlabs/lookup ohne Token
      -> fail-closed (401/403, NICHT 404). PRUEFUNG: curl-Statuscode.
- [ ] 9. Prod-Smoke-Anruf ueber den MCP-Connector (place_call an die eigene
      Nummer, await_call_event-Schleife; falls consult kommt: answer_consult).
      ERWARTET: opening-line-Logzeile + look_up ueber app.sundartha.com.
      PRUEFUNG: Render-Logs + Call-Datensatz.
- [ ] 10. Doku (.fortschritt.md Cutover-Eintrag), Commit, Push beide Remotes,
      Caffeinate aus.

Risiken (Pre-Mortem): (a) Env-Update-Werkzeug koennte ERSETZEN statt mergen ->
erst Schema/Semantik pruefen, sonst Render-API direkt; (b) Merge verliert eine
Seite -> Suite + gezielte Diffs; (c) autoDeploy koennte beim Upstream-Push sofort
deployen - unkritisch, weil Flag noch aus = Verhalten unveraendert (byte-identisch
belegt); (d) RLS blockt naive Prod-DB-Queries -> Forensik-Muster aus Memory.
