import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

export function starteMitKennzahlenPasswort(kodiert) {
  return starteHermesMitPglite({
    alarmPostfach: "",
    ohneStartanruf: true,
    kennzahlenAdresse: `postgres://kennzahlen_leser:${kodiert}@kennzahlen-attrappe.invalid/hermes`,
  });
}

export async function schreibeNachLauf(zeilen) {
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  const original = process.stderr._write;
  const gesehen = [];
  process.stderr._write = (stueck, _kodierung, fertig) => {
    gesehen.push(String(stueck));
    fertig();
  };
  try {
    for (const zeile of zeilen) process.stderr.write(`${zeile}\n`);
  } finally {
    process.stderr._write = original;
  }
  return gesehen.join("");
}
