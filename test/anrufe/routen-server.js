import express from "express";

export async function mitRoutenServer(router, aufruf) {
  const app = express();
  app.use(express.json());
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
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
