import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { app } from "./app.js";

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`@moneycontrol/server listening on http://localhost:${info.port}`);
  console.log(
    "auth: requests must include an x-user-id header. Set DEV_USER_ID and use the Next.js dev server, or curl with -H 'x-user-id: <uuid>'.",
  );
});
