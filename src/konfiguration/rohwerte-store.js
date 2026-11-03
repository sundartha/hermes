export function storeRohwerte(umgebung) {
  const { env } = umgebung;
  return {
    storeBackend: (env.STORE_BACKEND || "json").toLowerCase(),
    databaseUrl: env.DATABASE_URL || "",
    queueBackend: (env.QUEUE_BACKEND || "memory").toLowerCase(),
  };
}
