export const POOL_GRENZEN = Object.freeze({
  maxHaupt: 6,
  maxPortal: 10,
  maxWarteschlange: 8,
  connectionTimeoutMillis: 10_000,
  statementTimeoutMs: 30_000,
  flushStatementTimeoutMs: 120_000,
  datenbankBudget: 80,
  instanzen: 2,
  zusatzInstanzenBeimDeploy: 1,
});

function poolOptionen(connectionString, max, ueberschreibungen = {}) {
  return {
    connectionString,
    max,
    connectionTimeoutMillis: POOL_GRENZEN.connectionTimeoutMillis,
    statement_timeout: POOL_GRENZEN.statementTimeoutMs,
    ...ueberschreibungen,
  };
}

export function hauptPoolOptionen(connectionString, ueberschreibungen) {
  return poolOptionen(connectionString, POOL_GRENZEN.maxHaupt, ueberschreibungen);
}

export function portalPoolOptionen(connectionString, ueberschreibungen) {
  return poolOptionen(connectionString, POOL_GRENZEN.maxPortal, ueberschreibungen);
}

export function poolFehlerZeile(name, fehler) {
  return `[pool:${name}] Verbindung im Leerlauf verloren: ${fehler.message}`;
}

export function flushAnfang() {
  return [
    { text: "BEGIN", params: [] },
    {
      text: `SELECT set_config('statement_timeout', $1, true)`,
      params: [String(POOL_GRENZEN.flushStatementTimeoutMs)],
    },
  ];
}
