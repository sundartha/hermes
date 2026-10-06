export function operatorAuthPassThrough() {
  return {
    webAuthMw: (_req, _res, next) => next(),
    adminMw: (_req, _res, next) => next(),
  };
}

export async function startRouterApp(router) {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
