import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";
import { Browsable } from "@outerbase/browsable-durable-object";
import { Env } from "../types/env";

@Browsable()
export class ChannelDurableObject extends DurableObject<Env> {
    // Hono application instance for serving routes
    private app: Hono = new Hono();
    // Map of connections between the USER <-> CHANNEL (this) durable objects. These do not hibernate.
    private connections = new Map<string, WebSocket>();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async webSocketMessage(ws: WebSocket, message: any) {
        // When a message is received by a USER, just echo back to the USER
        // a confirmation message noting that this particularly channel has
        // received that message.
        ws.send(`[CHANNEL]: Received message from [USER]`);
    }

    async webSocketClose(
        ws: WebSocket,
        code: number,
        reason: string,
        wasClean: boolean
    ) {
        // When a particular user has ended its websocket connection, we should 
        // find their entry in our connections map and prune it from our list we are
        // managing.
        for (const [id, socket] of this.connections.entries()) {
            if (socket === ws) {
                this.connections.delete(id);
                break;
            }
        }

        ws.close(code, "Durable Object is closing WebSocket");
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        // Establish a websocket connection between USER <-> CHANNEL durable object (this).
        // While the incoming nature of this websocket _is_ hibernatable (see: `acceptWebSocket`)
        // rather than just `accept`), the outgoing aspect of the USER durable object makes
        // its socket non-hibernatable.
        if (url.pathname === '/ws') {
            const webSocketPair = new WebSocketPair();
            const [client, server] = Object.values(webSocketPair);

            // Assign a random identifier to the socket and save the pair locally.
            const connectionId = crypto.randomUUID();
            this.connections.set(connectionId, server);
            this.ctx.acceptWebSocket(server);

            return new Response(null, {
                status: 101,
                webSocket: client,
            });
        }

        return this.app.fetch(request);
    }
} 