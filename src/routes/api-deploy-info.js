import { Router } from "express";
import { configFingerprint } from "../config-fingerprint.js";
import { operatorRoutes } from "../wiring/operator-routes.js";

export const DEPLOY_INFO_PATH = "/api/admin/deploy-info";

export function makeDeployInfoRoutes({ config, operatorAuth }) {
  const router = Router();
  const operator = operatorRoutes({ router, operatorAuth });

  operator.get(DEPLOY_INFO_PATH, (_req, res) => {
    res.json({ commit: config.server.deployedCommit, configHash: configFingerprint(config) });
  });

  return router;
}
