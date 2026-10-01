import express from "express";

const neueRoute = process.env.NEUE_ROUTE;
const lazyrouter = express.application.lazyrouter;

express.application.lazyrouter = function lazyrouterMitNeuerRoute() {
  const ohneRouter = !this._router;
  lazyrouter.call(this);
  if (ohneRouter) this._router.get(neueRoute, (_request, response) => response.json({}));
};
