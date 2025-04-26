import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";
import { Browsable } from "@outerbase/browsable-durable-object";
import { Env } from "../types/env";

@Browsable()
export class UserDurableObject extends DurableObject<Env> {
    // Hono application instance for serving routes
    private app: Hono = new Hono();
    // Connection between the users clients (e.g. browsers, could be multiple) and the users singular Durable Object instance (this)
    private connections = new Map<string, WebSocket>();
    // Channels we are subscribed to as a user
    public channels = ['general', 'sports', 'politics']; // Could be multiple -> ['general', 'sports', 'politics'];
    // A map of CHANNEL objects we have open web socket communications with
    private channelConnections = new Map<string, WebSocket>();

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async webSocketMessage(ws: WebSocket, message: any) {
        // When a message comes in from one of our clients, pass it along to all
        // of the connected CHANNEL objects, but also echo back to the client to let
        // them know we received their message.
        for (const [_, socket] of this.connections.entries()) {
            if (socket === ws) {
                ws.send(`[USER]: Echo message = ${message}`);

                const { channel, message: userMessage } = JSON.parse(message)

                // Only forward message to the specified channel
                const channelSocket = this.channelConnections.get(channel);
                if (channelSocket) {
                    channelSocket.send(userMessage);
                }

                break;
            }
        }

        // If the message is coming from a CHANNEL then pass it back to all of our
        // users connected clients letting this USER object act as an intermediary
        // between client <-> CHANNEL.
        for (const [_, socket] of this.channelConnections.entries()) {
            if (socket === ws) {
                // Forward message to all user clients
                for (const [_, userSocket] of this.connections.entries()) {
                    userSocket.send(message);
                }

                break;
            }
        }
    }

    async webSocketClose(
        ws: WebSocket,
        code: number,
        reason: string,
        wasClean: boolean
    ) {
        for (const [id, socket] of this.connections.entries()) {
            if (socket === ws) {
                this.connections.delete(id);
                break;
            }
        }

        // If all our users clients have ceased to exist, sever all
        // channel relationships with their websocket connection.
        if (this.connections.size === 0) {
            this.changeSubscriptionStatus(false);
            console.log('Closed all CHANNEL connections.')
        }

        ws.close(code, "Durable Object is closing WebSocket");
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        // Establish a websocket connection between client <-> USER durable object (this).
        if (url.pathname === '/ws') {
            const webSocketPair = new WebSocketPair();
            const [client, server] = Object.values(webSocketPair);

            const connectionId = crypto.randomUUID();
            this.connections.set(connectionId, server);
            this.ctx.acceptWebSocket(server);

            // Now that we have an active WS connection we want to subscribe and
            // listen to all of our channels we subscribe to.
            // Create an open websocket connection between this USER durable object
            // and each CHANNEL durable object we are subscribed to.
            this.changeSubscriptionStatus(true);

            return new Response(null, {
                status: 101,
                webSocket: client,
            });
        }

        return this.app.fetch(request);
    }

    async changeSubscriptionStatus(subscribe: boolean) {
        for (const channel of this.channels) {
            try {
                if (subscribe) {
                    // Create a new websocket connection between USER <-> CHANNEL
                    this.createChannelSocketConnection(channel)
                } else {
                    // Close and remove the WebSocket connection between USER <-> CHANNEL
                    const webSocket = this.channelConnections.get(channel);
                    if (webSocket) {
                        webSocket.close();
                        this.channelConnections.delete(channel);
                    }
                }
            } catch (error) {
                console.error(`Error with channel ${channel}:`, error);
            }
        }
    }

    async createChannelSocketConnection(channel: string) {
        const stubId = this.env.CHANNEL_DURABLE_OBJECT.idFromName(channel);
        const stub = this.env.CHANNEL_DURABLE_OBJECT.get(stubId);

        const response = await stub.fetch('http://internal/ws', {
            headers: {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade'
            }
        });
        
        if (response.status === 101) {
            const webSocket = response.webSocket;
            if (!webSocket) throw new Error('WebSocket connection failed');
            
            await webSocket.accept();
            
            // Add message and error handlers for the channel websocket
            webSocket.addEventListener('message', (event) => {
                this.webSocketMessage(webSocket, event.data);
            });
            
            webSocket.addEventListener('error', (error) => {
                console.error(`Channel ${channel} WebSocket error:`, error);
            });
            
            this.channelConnections.set(channel, webSocket);
        }
    }
} 