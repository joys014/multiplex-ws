import { Hono } from "hono";
import { UserDurableObject } from "./durable-objects/user";
import { ChannelDurableObject } from "./durable-objects/channel";

export { UserDurableObject, ChannelDurableObject };

export default {
  async fetch(request, env, ctx) {
    const app = new Hono();

    app.get("/ws", async (c) => {
      // We need a userId so we can send the user to their very own Durable Object instance.
      const userId = c.req.query("id");

      if (!userId) {
        return c.text("No userId provided.");
      }

      // Instantiate our user DO to handle establishing our web socket
      // connection between the client (browser) <-> user session (DO).
      const stubId = env.USER_DURABLE_OBJECT.idFromName(userId);
      const stub = env.USER_DURABLE_OBJECT.get(stubId);
      return stub.fetch(request);
    });

    return app.fetch(request, env, ctx);
  },
};
