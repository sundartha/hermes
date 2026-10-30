import { BOOTSTRAP_TENANT_ID, makePgStore } from "../../src/store/pg.js";
import { setTenantIdentityIfAbsent } from "../../src/store/state-ops.js";
import { findActiveNumber } from "../../src/store/views.js";
import { registrierungAnhaengen } from "../../src/store/zustand/nummern.js";

const ANBIETER = "telnyx";
const STARTBESTAND_REGISTRIERUNG = "phnum_hermes_ctl_start";

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
  const state = store.load();
  registrierungAnhaengen(state, findActiveNumber(state, BOOTSTRAP_TENANT_ID).id, STARTBESTAND_REGISTRIERUNG);
  setTenantIdentityIfAbsent(state, BOOTSTRAP_TENANT_ID, {
    firstName: vorname,
    lastName: nachname,
  });
  await store.save();
  await store.drainFlushes();
}
