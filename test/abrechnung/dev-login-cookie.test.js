import { test } from "node:test";
import assert from "node:assert/strict";
import { devLoginCookie } from "../gemeinsam/dev-login-cookie.mjs";

test("Dev-Login mit 500 scheitert mit Status und Antworttext", async () => {
  const antwort = new Response("dev-login fehlgeschlagen", { status: 500 });
  await assert.rejects(devLoginCookie(antwort), {
    message: "Dev-Login: Status 500, Cookie fehlt, Antwort: dev-login fehlgeschlagen",
  });
});

test("Dev-Login mit 302 ohne Cookie scheitert mit Status und Antworttext", async () => {
  const antwort = new Response("", { status: 302 });
  await assert.rejects(devLoginCookie(antwort), {
    message: "Dev-Login: Status 302, Cookie fehlt, Antwort: ",
  });
});

test("Dev-Login mit 200 und Cookie scheitert wegen des Status", async () => {
  const antwort = new Response("ok", { status: 200, headers: { "set-cookie": "sid=abc; Path=/" } });
  await assert.rejects(devLoginCookie(antwort), {
    message: "Dev-Login: Status 200, Cookie gesetzt, Antwort: ok",
  });
});

test("Dev-Login mit 302 und Cookie liefert nur Name und Wert", async () => {
  const antwort = new Response(null, {
    status: 302,
    headers: { "set-cookie": "sid=abc; Path=/; HttpOnly" },
  });
  assert.equal(await devLoginCookie(antwort), "sid=abc");
});
