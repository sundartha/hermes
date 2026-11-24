const FEHLER = "[pg] plattform-nummern fehlgeschlagen:";
const SPALTEN = "id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note";
const LESEN_SQL = `SELECT ${SPALTEN} FROM platform_number_use WHERE released_at IS NULL OR id = ANY($1::text[]) ORDER BY bound_at`;
const ANLEGEN_SQL = `INSERT INTO platform_number_use (${SPALTEN}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`;
const SCHLIESSEN_SQL = `UPDATE platform_number_use SET released_at = $2 WHERE id = $1 AND released_at IS NULL`;

const alsIso = (zeit) => (zeit instanceof Date ? zeit.toISOString() : (zeit ?? null));

function zeileZuBindung(zeile) {
  return {
    id: zeile.id,
    e164: zeile.e164,
    purpose: zeile.purpose,
    provider: zeile.provider,
    tenantId: zeile.tenant_id,
    providerNumberId: zeile.provider_number_id,
    boundAt: alsIso(zeile.bound_at),
    releasedAt: alsIso(zeile.released_at),
    note: zeile.note,
  };
}

function uebernehmen(spiegel, bindung) {
  const vorhanden = spiegel.find((eintrag) => eintrag.id === bindung.id);
  if (!vorhanden) spiegel.push(bindung);
  else if (vorhanden.releasedAt === null) vorhanden.releasedAt = bindung.releasedAt;
}

async function schreibeBindung(client, bindung) {
  await client.query(ANLEGEN_SQL, [
    bindung.id, bindung.e164, bindung.purpose, bindung.provider, bindung.tenantId ?? null,
    bindung.providerNumberId ?? null, bindung.boundAt, bindung.releasedAt ?? null, bindung.note ?? null,
  ]);
  if (bindung.releasedAt) await client.query(SCHLIESSEN_SQL, [bindung.id, bindung.releasedAt]);
}

async function inTransaktion(client, arbeit) {
  await client.query("BEGIN");
  try {
    await arbeit();
    await client.query("COMMIT");
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    throw fehler;
  }
}

export function machePlattformNutzungSql({ einreihen, runner, protokoll = console }) {
  async function ausfuehren(arbeit) {
    try {
      return await arbeit();
    } catch (fehler) {
      protokoll.error(FEHLER, fehler.message);
      throw fehler;
    }
  }

  return {
    nachladen: (spiegel) =>
      ausfuehren(async () => {
        const ids = spiegel.map((bindung) => bindung.id);
        const { rows } = await runner.withClient((client) => client.query(LESEN_SQL, [ids]));
        for (const zeile of rows) uebernehmen(spiegel, zeileZuBindung(zeile));
      }),
    schreiben: (spiegel) =>
      ausfuehren(() =>
        einreihen((client) =>
          inTransaktion(client, async () => {
            for (const bindung of spiegel) await schreibeBindung(client, bindung);
          }),
        ),
      ),
  };
}
