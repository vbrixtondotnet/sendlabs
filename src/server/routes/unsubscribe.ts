import { Hono } from "hono";
import type { AppEnv } from "../app";
import { unsubscribeKey } from "../lib/unsubscribe";
import { describeUnsubscribe, performUnsubscribe } from "../services/unsubscribe";

/**
 * PUBLIC: the person opening an unsubscribe link is not signed in to anything. The signed token in the address is the
 * only credential, and it only ever allows unsubscribing that one address from that one company.
 *
 *   GET  /api/unsubscribe/:token   what the page shows (masked address, company). Changes nothing.
 *   POST /api/unsubscribe/:token   unsubscribes. This is also the address in the `List-Unsubscribe` header: mail apps POST
 *                                  `List-Unsubscribe=One-Click` here (RFC 8058), so the body is ignored.
 */
export const unsubscribeRoutes = new Hono<AppEnv>();

unsubscribeRoutes.get("/:token", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await describeUnsubscribe(c.get("db"), unsubscribeKey(c.env), c.req.param("token")));
});

unsubscribeRoutes.post("/:token", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await performUnsubscribe(c.get("db"), unsubscribeKey(c.env), c.req.param("token")));
});
