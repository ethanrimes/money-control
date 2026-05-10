import { Hono } from "hono";
import { config } from "../config.js";

// Teller routes are wired up in the next commit (mTLS client + Connect callback
// + /sync). For now we expose the SDK config so the web app can render the
// Connect button against the right environment.
export const tellerRoutes = new Hono();

tellerRoutes.get("/config", (c) => {
  return c.json({
    appId: config.teller.appId || null,
    environment: config.teller.env,
  });
});

tellerRoutes.get("/enrollments", (c) => c.json([]));
tellerRoutes.post("/enrollments", (c) => c.json({ error: "not implemented yet" }, 501));
tellerRoutes.post("/sync", (c) => c.json({ error: "not implemented yet" }, 501));
