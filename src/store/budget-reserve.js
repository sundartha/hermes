export const RESERVIERUNG_GRUND = Object.freeze({ DECKE: "decke", DB: "db" });

export const KEINE_DB_RESERVIERUNG = Object.freeze({
  reservieren: async () => ({ reserviert: true }),
  freigeben: async () => {},
});
