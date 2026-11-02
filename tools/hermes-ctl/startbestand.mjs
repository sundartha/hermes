import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONEN = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));
const SQL_ENDUNG = ".sql";
const EIGENTUEMER_MANDANT = "owner";
const MANDANT_AKTIV = "active";
const MANDANT_MIT_NAMEN_ANLEGEN =
  "INSERT INTO tenant (id, status, owner_name, first_name) VALUES ($1, $2, $3, $4)";

async function schemaAnlegen(datenbank) {
  const dateien = readdirSync(MIGRATIONEN).filter((name) => name.endsWith(SQL_ENDUNG)).sort();
  for (const name of dateien) await datenbank.exec(readFileSync(join(MIGRATIONEN, name), "utf8"));
}

export async function startbestandAnlegen(datenbank, { vorname, nachname }) {
  const rufname = vorname.trim();
  await schemaAnlegen(datenbank);
  await datenbank.query(MANDANT_MIT_NAMEN_ANLEGEN, [
    EIGENTUEMER_MANDANT,
    MANDANT_AKTIV,
    `${rufname} ${nachname.trim()}`,
    rufname,
  ]);
}
