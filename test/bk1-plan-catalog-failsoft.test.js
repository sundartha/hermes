// BK1-1 Regression: loadPlanCatalog (inline in tenant.html) MUSS fail-soft sein - bei
// fetch-Rejection (offline/DNS/Reset) ODER non-JSON Body (200 mit Proxy/Interstitial auf
// Render) darf das Promise NICHT rejecten, sonst laeuft der Bootstrap-`.then(refresh)` nie
// und das ganze Dashboard (Calls, Billing, Auth-Hinweis) rendert nicht - nicht nur die
// Kacheln. Das Repo hat kein DOM-Harness, darum wird die echte Funktion aus dem HTML
// extrahiert und in einem isolierten vm-Kontext (lokales planCatalog + injizierter fetch)
// ausgefuehrt. So testet der Check die ausgelieferte Promise-Semantik, nicht eine Kopie.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, "../public/tenant.html"), "utf8");

// Extrahiert loadPlanCatalog aus dem HTML und liefert eine frische Instanz, die ueber den
// injizierten fetch (und ein nicht geteiltes planCatalog je Kontext) schliesst. Quelle ist
// die repo-eigene, committete tenant.html (trusted, kein externer Input -> keine Injection).
// Anker ist der Funktionsname + die spaltenbuendige schliessende Klammer, kein Datei:Zeile-
// Bezug (C2). runInNewContext gibt einen frischen Kontext je Aufruf -> Tests bleiben isoliert.
function loaderWith(fetchImpl){
  const m = html.match(/async function loadPlanCatalog\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, "loadPlanCatalog nicht in tenant.html gefunden");
  const code = `let planCatalog=null; ${m[0]} loadPlanCatalog;`;
  return vm.runInNewContext(code, { fetch: fetchImpl });
}

// Das await selbst beweist "kein Reject" (eine Rejection liesse den Test fehlschlagen). Die
// Array-Pruefung ist realm-sicher (Array.isArray/length sind kontext-uebergreifend, anders
// als deepStrictEqual, das den Prototyp des vm-Kontexts gegen den Test-Realm vergleicht).
async function assertEmptyCatalog(load){
  const r = await load();
  assert.ok(Array.isArray(r), "Rueckgabe ist ein Array");
  assert.equal(r.length, 0, "leerer Katalog");
}

test("loadPlanCatalog: fetch-Rejection -> leerer Katalog, kein Reject", async () => {
  await assertEmptyCatalog(loaderWith(() => Promise.reject(new Error("network down"))));
});

test("loadPlanCatalog: 200 mit non-JSON Body -> leerer Katalog, kein Reject", async () => {
  await assertEmptyCatalog(loaderWith(() =>
    Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
  ));
});

test("loadPlanCatalog: HTTP !ok -> leerer Katalog (Bestandsverhalten)", async () => {
  await assertEmptyCatalog(loaderWith(() =>
    Promise.resolve({ ok: false, json: () => Promise.resolve([{ slug: "x" }]) }),
  ));
});

test("loadPlanCatalog: ok -> Katalog aus /api/plans wird durchgereicht", async () => {
  const cat = [{ slug: "starter", name: "Starter" }];
  const load = loaderWith(() => Promise.resolve({ ok: true, json: () => Promise.resolve(cat) }));
  const r = await load();
  assert.equal(r.length, 1);
  assert.equal(r[0].slug, "starter");
});
