import { test } from "node:test";
import { echtWarten } from "./echt-warten.js";
const WARTE_MS = 500;
test("wartet", async () => {
  await echtWarten(WARTE_MS);
});
