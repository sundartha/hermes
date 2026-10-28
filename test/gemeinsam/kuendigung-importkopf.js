import request from "./testserver-anfrage.mjs";
import express from "express";
import { makePgTestStore } from "../pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, makeAccounts, makeSessions, signValue } from "../../src/web-auth.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

export {
  request,
  express,
  makePgTestStore,
  SESSION_COOKIE_NAME,
  webAuth,
  makeAccounts,
  makeSessions,
  signValue,
  makeSelfServiceRoutes,
  withConfigNamespaces,
};
