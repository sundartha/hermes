import { after, before } from "node:test";

export function aufbauUndAbbau(aufbauen, abbauen) {
  let aufbau;
  before(() => {
    aufbau = Promise.resolve(aufbauen());
    return aufbau;
  });
  after(async () => {
    await aufbau?.catch(() => {});
    await abbauen();
  });
}
