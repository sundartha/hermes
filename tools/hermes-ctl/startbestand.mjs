import { BOOTSTRAP_TENANT_ID, makePgStore } from "../../src/store/pg.js";
import { setTenantIdentityIfAbsent } from "../../src/store/state-ops.js";

const ANBIETER = "telnyx";

export async function startbestandAnlegen(datenbank, { nummer, vorname, nachname }) {
  const runner = {
    withClient: (arbeit) =>
      arbeit({
        query: (text, parameter) => datenbank.query(text, parameter),
        exec: (sql) => datenbank.exec(sql),
      }),
  };
  const store = makePgStore(runner);
  await store.init();
  await store.bootstrapTenant(nummer, BOOTSTRAP_TENANT_ID, ANBIETER);
  setTenantIdentityIfAbsent(store.load(), BOOTSTRAP_TENANT_ID, {
    firstName: vorname,
    lastName: nachname,
  });
  await store.save();
  await store.drainFlushes();
}
