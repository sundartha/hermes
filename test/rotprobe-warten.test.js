import { test } from "node:test";
const WARTE_MS = 500;
test("wartet", async () => {
  await new Promise((weiter) => setTimeout(weiter, WARTE_MS));
});
