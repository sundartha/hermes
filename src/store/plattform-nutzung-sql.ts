const FEHLER = "[pg] plattform-nummern fehlgeschlagen:";
const SPALTEN = "id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note";
const LESEN_SQL = `SELECT ${SPALTEN} FROM platform_number_use WHERE released_at IS NULL OR id = ANY($1::text[]) ORDER BY bound_at`;
const ANLEGEN_SQL = `INSERT INTO platform_number_use (${SPALTEN}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`;
const SCHLIESSEN_SQL = `UPDATE platform_number_use SET released_at = $2 WHERE id = $1 AND released_at IS NULL`;

export interface Bindung {
  id: string;
  e164: string;
  purpose: string;
  provider: string;
  tenantId?: string | null;
  providerNumberId?: string | null;
  boundAt: string;
  releasedAt?: string | null | undefined;
  note?: string | null;
}

type Zeit = Date | string | null | undefined;
interface Zeile {
  id: string;
  e164: string;
  purpose: string;
  provider: string;
  tenant_id: string | null;
  provider_number_id: string | null;
  bound_at: Zeit;
  released_at: Zeit;
  note: string | null;
}

interface Client {
  query: (sql: string, werte?: unknown[]) => Promise<{ rows: Zeile[] }>;
}

interface Abhaengigkeiten {
  einreihen: <T>(arbeit: (client: Client) => Promise<T>) => Promise<T>;
  runner: { withClient: <T>(arbeit: (client: Client) => Promise<T>) => Promise<T> };
  protokoll?: { error: (...teile: unknown[]) => void };
}

const alsIso = (zeit: Zeit): string | null => (zeit instanceof Date ? zeit.toISOString() : (zeit ?? null));

function zeileZuBindung(zeile: Zeile): Bindung {
  return {
    id: zeile.id,
    e164: zeile.e164,
    purpose: zeile.purpose,
    provider: zeile.provider,
    tenantId: zeile.tenant_id,
    providerNumberId: zeile.provider_number_id,
    boundAt: alsIso(zeile.bound_at) as string,
    releasedAt: alsIso(zeile.released_at),
    note: zeile.note,
  };
}

function uebernehmen(spiegel: Bindung[], bindung: Bindung): void {
  const vorhanden = spiegel.find((eintrag) => eintrag.id === bindung.id);
  if (!vorhanden) spiegel.push(bindung);
  else if (vorhanden.releasedAt === null) vorhanden.releasedAt = bindung.releasedAt;
}

async function schreibeBindung(client: Client, bindung: Bindung): Promise<void> {
  await client.query(ANLEGEN_SQL, [
    bindung.id, bindung.e164, bindung.purpose, bindung.provider, bindung.tenantId ?? null,
    bindung.providerNumberId ?? null, bindung.boundAt, bindung.releasedAt ?? null, bindung.note ?? null,
  ]);
  if (bindung.releasedAt) await client.query(SCHLIESSEN_SQL, [bindung.id, bindung.releasedAt]);
}

async function inTransaktion(client: Client, arbeit: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await arbeit();
    await client.query("COMMIT");
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    throw fehler;
  }
}

export function machePlattformNutzungSql({ einreihen, runner, protokoll = console }: Abhaengigkeiten) {
  async function ausfuehren<T>(arbeit: () => Promise<T>): Promise<T> {
    try {
      return await arbeit();
    } catch (fehler) {
      protokoll.error(FEHLER, (fehler as Error).message);
      throw fehler;
    }
  }

  return {
    nachladen: (spiegel: Bindung[]) =>
      ausfuehren(async () => {
        const ids = spiegel.map((bindung: Bindung) => bindung.id);
        const { rows } = await runner.withClient((client) => client.query(LESEN_SQL, [ids]));
        for (const zeile of rows) uebernehmen(spiegel, zeileZuBindung(zeile));
      }),
    schreiben: (spiegel: Bindung[]) =>
      ausfuehren(() =>
        einreihen((client) =>
          inTransaktion(client, async () => {
            for (const bindung of spiegel) await schreibeBindung(client, bindung);
          }),
        ),
      ),
  };
}
