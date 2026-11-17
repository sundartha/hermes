import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { importNachKonfiguration } from "../gemeinsam/umgebung-import.js";
import { postgresVorhanden } from "./hermes-mit-postgres.js";
import { startServer } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const MANDANT = "t_marker_fassade";
const ZEITPUNKT = "2026-11-17T10:00:00.000Z";

test("Mit Postgres schreibt die Fassade den Anrufstart-Marker in die Datenbank", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden() || !process.env[POSTGRES_VARIABLE]) return;
  const db = await echteDatenbankMitRolle(t);
  await (await startServer({ env: pgStartUmgebung(db.adresse) })).stop();
  const verwaltung = new pg.Client({ connectionString: db.adresse });
  verwaltung.on("error", () => {});
  await verwaltung.connect();
  t.after(() => verwaltung.end().catch(() => {}));
  const [{ anrufstartMarker, createCall, oeffneSpeicher, persistCall }] = await importNachKonfiguration(
    {},
    { store: { storeBackend: "pg", databaseUrl: db.adresse } },
    () => import("../../src/store.js"),
  );
  await oeffneSpeicher();
  await verwaltung.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  await verwaltung.query("INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)", [MANDANT]);
  const call = createCall({ direction: "outbound", from: "+4930555000402", to: "+4915112340012", goal: "Test", tenantId: MANDANT });
  await persistCall(call.id);
  assert.equal(await anrufstartMarker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: ZEITPUNKT }), true);
  assert.equal(await anrufstartMarker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: ZEITPUNKT }), false);
  assert.equal(await anrufstartMarker.lies(call.id), ZEITPUNKT);
});
