import express from "express";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

export async function mitRoutenServer(router, aufruf, jsonOptionen = {}) {
  const app = express();
  app.use(express.json(jsonOptionen));
  app.use(router);
  const server = await new Promise((resolve) => {
    const laufend = app.listen(0, "127.0.0.1", () => resolve(laufend));
  });
  try {
    return await aufruf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export function postJson(url, body = {}) {
  return abrufMitFrist(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
