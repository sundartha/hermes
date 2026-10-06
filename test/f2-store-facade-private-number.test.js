import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../src/store.js";

test("store.js re-exportiert die F2-Private-Number-API (sonst TypeError zur Laufzeit)", () => {
  assert.equal(
    typeof store.tenantPrivateNumber,
    "function",
    "tenantPrivateNumber fehlt in der Fassade",
  );
  assert.equal(typeof store.setPrivateNumber, "function", "setPrivateNumber fehlt in der Fassade");
});
