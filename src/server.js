import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import dotenv from "dotenv";
dotenv.config();

// Create the Fastify Server and include middleware for accepting
// x-www-form-urlencoded content
// and setting up Web Sockets
const fastify = Fastify();
fastify.register(fastifyFormbody); 
fastify.register(fastifyWs);

if(!process.env.NGROK_DOMAIN) throw new Error(`No Ngrok Domain has been specified in .env`)
if(!process.env.PORT) throw new Error(`No Port specified in the .env file`)

// Setup Configuration Options
const NGROK_DOMAIN = process.env.NGROK_DOMAIN
const WS_URL = `wss://${NGROK_DOMAIN}/ws`;
const PORT = process.env.PORT || 8080

// Setup Welcome Greeting
const WELCOME_GREETING = `Hi! I am a voice assistant powered by Twilio and Open AI. Ask me anything!`;

// Create the TwiML
const TWIML = 
`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
    <Connect>
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" />
    </Connect>
 </Response>
`

// // Setup the route for TwiML and output the request for debugging
fastify.post("/twiml", async (request, reply) => {
    console.log("=== Incoming Request ===");
    console.log("Method:", request.method);
    console.log("URL:", request.url);
    console.log("Headers:", request.headers);
    console.log("Body:", request.body);  
    console.log("========================");

    reply.type("text/xml").send(TWIML);
});

// // Register the Web Socket
fastify.register(async function (fastify) {
    // On a get request against the WebSocket
    fastify.get("/ws", { websocket: true }, (ws, req) => {
        // When a message is received
        ws.on("message", async (data) => {

            // Get the message data
            const message = JSON.parse(data);

            // out the payload to the console
            console.log(`MESSAGE ${JSON.stringify(message)}`)

            switch (message.type) {
                case "setup":
                    console.log(`Setup`)
                    break;
                case "prompt":
                    console.log(`Prompt Message`)
                    break;
                case "interrupt":
                    console.log(`Interrupt`);
                    break;
                default:
                    console.warn("Unknown message type received:", message.type);
                    break;
            }
        });

        // tidyup on close 
        ws.on("close", () => {
            console.log("WebSocket connection closed");
        });
    });
});


try {
    fastify.listen({ port: PORT });
    console.log(`Server running at http://localhost:${PORT} and wss://${NGROK_DOMAIN}/ws`);
} catch (e) {
    fastify.log.error(`Fastify Server Error ${e}`);
    process.exit(1);
}