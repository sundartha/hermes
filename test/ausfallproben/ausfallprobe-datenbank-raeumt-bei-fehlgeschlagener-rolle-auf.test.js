import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { echteDatenbank, mitVerbindung } from "../gemeinsam/echtes-postgres.js";
import { legeDatenbankAn } from "../../scripts/ausfallproben/datenbank.mjs";

const NAMENSBYTES = 6;
const KENNWORT = "ausfallprobe-pruefer-kennwort";

async function mitBeschraenkterVerwaltung(t, arbeit, rechte = "CREATEDB NOCREATEROLE") {
  const datenbank = await echteDatenbank(t);
  if (!datenbank) return;
  const rolle = `ausfallprobe_pruefer_${randomBytes(NAMENSBYTES).toString("hex")}`;
  const admin = new URL(datenbank.adresse);
  await mitVerbindung(admin.href, (v) =>
    v.query(`CREATE ROLE ${rolle} LOGIN ${rechte} PASSWORD '${KENNWORT}'`),
  );
  const verbunden = new Set();
  const connect = pg.Client.prototype.connect;
  const end = pg.Client.prototype.end;
  t.mock.method(pg.Client.prototype, "connect", function (...args) {
    if (this.user === rolle) verbunden.add(this);
    return connect.apply(this, args);
  });
  t.mock.method(pg.Client.prototype, "end", function (...args) {
    verbunden.delete(this);
    return end.apply(this, args);
  });
  const beschraenkt = new URL(admin.href);
  beschraenkt.username = rolle;
  beschraenkt.password = KENNWORT;
  try {
    await arbeit({ rolle, admin: admin.href, beschraenkt });
  } finally {
    await mitVerbindung(admin.href, async (v) => {
      await Promise.allSettled([...verbunden].map((client) => end.call(client)));
      await v.query(
        `SELECT datname FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = '${rolle}')`,
      ).then(({ rows }) =>
        Promise.all(rows.map((r) => v.query(`DROP DATABASE IF EXISTS ${r.datname} WITH (FORCE)`))),
      );
      await v.query(`DROP ROLE IF EXISTS ${rolle}`);
    });
  }
}

async function zustand(admin, rolle) {
  return mitVerbindung(admin, async (v) => {
    const dbs = await v.query(
      `SELECT datname FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [rolle],
    );
    const rollen = await v.query(
      `SELECT r.rolname FROM pg_roles r JOIN pg_auth_members m ON m.roleid = r.oid
       WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1) AND r.rolname LIKE 'ausfallprobe\\_%'`,
      [rolle],
    );
    const offen = await v.query(`SELECT 1 FROM pg_stat_activity WHERE usename = $1`, [rolle]);
    return { dbs: dbs.rows, rollen: rollen.rows.length, offen: offen.rows.length };
  });
}

test("legeDatenbankAn: scheitert CREATE ROLE, bleibt weder Datenbank noch offene Verbindung zurueck", async (t) => {
  await mitBeschraenkterVerwaltung(t, async ({ rolle, admin, beschraenkt }) => {
    const vorher = await zustand(admin, rolle);
    await assert.rejects(legeDatenbankAn(beschraenkt, { mitRolle: true }), /permission denied|berechtigung|role/i);
    const nachher = await zustand(admin, rolle);
    assert.deepEqual(nachher.dbs, []);
    assert.equal(nachher.rollen, vorher.rollen);
    assert.equal(nachher.offen, 0);
  });
});

test("legeDatenbankAn: scheitert ALTER DATABASE OWNER nach angelegter Rolle, bleibt weder Datenbank noch Rolle noch offene Verbindung zurueck", async (t) => {
  await mitBeschraenkterVerwaltung(
    t,
    async ({ rolle, admin, beschraenkt }) => {
      await assert.rejects(legeDatenbankAn(beschraenkt, { mitRolle: true }), /permission denied|berechtigung|role/i);
      const nachher = await zustand(admin, rolle);
      assert.deepEqual(nachher.dbs, []);
      assert.equal(nachher.rollen, 0);
      assert.equal(nachher.offen, 0);
    },
    "CREATEDB CREATEROLE",
  );
});

test("legeDatenbankAn: Gutfall ohne Rolle legt an und loesche raeumt auf", async (t) => {
  await mitBeschraenkterVerwaltung(t, async ({ rolle, admin, beschraenkt }) => {
    const probe = await legeDatenbankAn(beschraenkt);
    assert.equal((await zustand(admin, rolle)).dbs.length, 1);
    await probe.loesche();
    const danach = await zustand(admin, rolle);
    assert.deepEqual(danach.dbs, []);
    assert.equal(danach.offen, 0);
  });
});
