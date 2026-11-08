import { mock } from "node:test";

export const TABELLE_DES_FLUSHS = "cost_cross_check";
const TABELLE_VERSTECKT = "cost_cross_check_versteckt";

async function umbenennen(db, von, nach) {
  const { rows } = await db.query("SELECT current_user AS rolle");
  await db.exec(
    `RESET ROLE; ALTER TABLE ${von} RENAME TO ${nach}; SET ROLE ${rows[0].rolle};`,
  );
}

export async function mitGescheitertemFlush(db, speicher, aufruf) {
  await speicher.drainFlushes();
  await umbenennen(db, TABELLE_DES_FLUSHS, TABELLE_VERSTECKT);
  try {
    speicher.save();
    await speicher.drainFlushes().catch(() => {});
    return await aufruf();
  } finally {
    await umbenennen(db, TABELLE_VERSTECKT, TABELLE_DES_FLUSHS);
    speicher.save();
    await speicher.drainFlushes();
  }
}

export async function mitHaengendemFlush(pool, speicher, aufruf) {
  await speicher.drainFlushes();
  const echteVerbindung = pool.connect.bind(pool);
  const festgehalten = [];
  const beobachtet = mock.method(pool, "connect", async () => {
    const client = await echteVerbindung();
    return {
      release: () => client.release(),
      query: (text, ...weitere) => {
        if (!String(text).includes(TABELLE_DES_FLUSHS)) return client.query(text, ...weitere);
        return new Promise((fertig, fehler) => {
          festgehalten.push(() => client.query(text, ...weitere).then(fertig, fehler));
        });
      },
    };
  });
  try {
    speicher.save();
    return await aufruf();
  } finally {
    beobachtet.mock.restore();
    for (const freigeben of festgehalten) freigeben();
    await speicher.drainFlushes();
  }
}
