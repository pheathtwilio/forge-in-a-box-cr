import Fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import OpenAI from "openai"
import dotenv from "dotenv";
dotenv.config();

// Create the Fastify Server and include middleware for accepting
// x-www-form-urlencoded content
// and setting up Web Sockets
const fastify = Fastify();
fastify.register(fastifyFormbody);
fastify.register(fastifyWs);
fastify.register(fastifyCors, {
    origin: true, // Allow all origins for demo purposes
    credentials: true
});

// HOST is the public domain — set by Fly.io (APP_NAME.fly.dev) or NGROK_DOMAIN for local dev
const HOST = process.env.HOST || process.env.NGROK_DOMAIN;
if (!HOST) throw new Error('No HOST or NGROK_DOMAIN specified in environment');

const WS_URL = `wss://${HOST}/ws`;
const PORT = process.env.PORT || 8080;
const OPEN_AI_MODEL = "gpt-4o-mini"

// Setup Welcome Greeting
const WELCOME_GREETING = `Hi! I am a voice assistant powered by Twilio and Open AI. Ask me anything!`;

// Setup the Interrupt Variable
const INTERRUPT="any"

// Flex / TaskRouter config
const FLEX_WORKFLOW_SID = "WWaa740f6c6c725172f6fa3051356f3524";

// Handoff action URL — Twilio Serverless Function (matches blog pattern)
const HANDOFF_URL = process.env.HANDOFF_URL || "https://sfbli-2271-dev.twil.io/handoff";

// Create the TwiML — action URL points to Twilio Function for reliable TwiML processing
const TWIML =
`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
    <Connect action="${HANDOFF_URL}">
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" interruptible="${INTERRUPT}" />
    </Connect>
 </Response>
`
// Create a simple sessions handler
// Structure: { callSid: { messages: [], transcript: [], context: {}, createdAt: timestamp } }
const sessions = new Map();

// Setup the System Prompt
const SYSTEM_PROMPT = `
You are a helpful assistant. This conversation is being translated to voice, so answer carefully.
When you respond, please spell out all numbers, for example twenty not 20.
Do not include emojis in your responses. Do not include bullet points, asterisks, or special symbols.
`

// Setup the LLM to handle completions
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /context - Store customer context before call is made
// Returns a temporary sessionId that will be matched to callSid when WebSocket connects
fastify.post("/context", async (request, reply) => {
    // Store all context fields sent by the browser
    const ctx = request.body;

    // Create temporary session with pending key
    // Note: In a single-presenter demo, only one pending session exists at a time
    const sessionId = `pending_${Date.now()}`;

    sessions.set(sessionId, {
        context: ctx,
        messages: [],
        transcript: [],
        createdAt: Date.now()
    });

    console.log(`Context stored for session ${sessionId}:`, ctx.customer_name || ctx.customerName, ctx.policy_number || ctx.policyNumber);

    reply.send({ sessionId, status: 'context_stored' });
});

// GET /transcript - Retrieve transcript entries since a given index
fastify.get("/transcript", async (request, reply) => {
    const { callSid, since } = request.query;

    const session = sessions.get(callSid);
    if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
    }

    const sinceIdx = parseInt(since) || 0;
    const entries = session.transcript.slice(sinceIdx);

    reply.send({
        entries,
        total: session.transcript.length,
        callStatus: session.callStatus || 'in-progress',
        handoff: session.handoff || false
    });
});

// POST /status - Handle call lifecycle events
fastify.post("/status", async (request, reply) => {
    const { CallSid, CallStatus } = request.body;

    console.log(`Call ${CallSid} status: ${CallStatus}`);

    // Store call status on session so transcript poll can detect completion
    const session = sessions.get(CallSid);
    if (session) {
        session.callStatus = CallStatus;
    }

    // Clean up session 30 seconds after call ends
    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled') {
        console.log(`Scheduling cleanup for session ${CallSid}`);
        setTimeout(() => {
            sessions.delete(CallSid);
            console.log(`Session ${CallSid} cleaned up`);
        }, 30000);
    }

    reply.send({ status: 'ok' });
});

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

// POST /handoff - Called by Twilio when ConversationRelay <Connect> ends
// If session is marked for handoff, enqueue to Flex; otherwise hang up
fastify.post("/handoff", async (request, reply) => {
    const { CallSid, HandoffData } = request.body;
    console.log(`HANDOFF request for call ${CallSid}, HandoffData: ${HandoffData ? 'present' : 'absent'}`);

    const session = sessions.get(CallSid);
    const isHandoff = (session && session.handoff) || HandoffData;

    if (isHandoff) {
        const ctx = session.context || {};
        // Build transcript summary from last few exchanges
        const recentTranscript = (session.transcript || [])
            .slice(-6)
            .map(t => `${t.role}: ${t.content}`)
            .join(' | ');

        const taskAttributes = JSON.stringify({
            type: "inbound",
            name: ctx.customer_name || ctx.customerName || "Unknown",
            customerName: ctx.customer_name || ctx.customerName || "Unknown",
            customerPhone: ctx.phone || "",
            customerId: ctx.customer_id || ctx.customerId || "",
            email: ctx.email || "",
            policyNumber: ctx.policy_number || ctx.policyNumber || "",
            policyType: ctx.policy_type || ctx.policyType || "",
            premium: ctx.premium || "",
            coverage: ctx.coverage || "",
            renewalDate: ctx.renewal || "",
            riskScore: ctx.risk_score || "",
            customerSince: ctx.customer_since || "",
            claims: ctx.recent_claims || [],
            browsingHistory: ctx.browsingHistory || [],
            verificationStatus: ctx.verificationStatus || ctx.verification_status || "approved",
            transcriptSummary: recentTranscript
        });

        console.log(`HANDOFF -> Enqueuing to Flex with attributes:`, taskAttributes);

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Please hold while I connect you to a specialist.</Say>
    <Enqueue workflowSid="${FLEX_WORKFLOW_SID}">
        <Task>${taskAttributes}</Task>
    </Enqueue>
</Response>`;

        reply.type("text/xml").send(twiml);
    } else {
        console.log(`HANDOFF -> Normal call end, hanging up`);
        reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
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
            console.log(`MESSAGE ${JSON.stringify(message, null, 2)}`)

            switch (message.type) {
                case "setup":
                    // get the call sid as the unique identifier to the session
                    const callSid = message.callSid;
                    ws.callSid = callSid;

                    // Look for pending context session
                    // Note: This simple matching works for single-presenter demos
                    // For multi-presenter scenarios, implement a more robust matching mechanism
                    let pendingSessionKey = null;
                    let pendingSession = null;

                    for (const [key, value] of sessions.entries()) {
                        if (key.startsWith('pending_')) {
                            pendingSessionKey = key;
                            pendingSession = value;
                            break;
                        }
                    }

                    // Build system prompt
                    let systemPrompt = SYSTEM_PROMPT;

                    if (pendingSession && pendingSession.context) {
                        const ctx = pendingSession.context;
                        const browsingHistoryText = Array.isArray(ctx.browsingHistory)
                            ? ctx.browsingHistory.join(' → ')
                            : ctx.browsingHistory || 'None';

                        systemPrompt += `

CUSTOMER CONTEXT:
- Name: ${ctx.customer_name || ctx.customerName}
- Customer ID: ${ctx.customer_id || ctx.customerId}
- Phone: ${ctx.phone || 'N/A'}
- Email: ${ctx.email || 'N/A'}
- Customer Since: ${ctx.customer_since || 'N/A'}

POLICY DETAILS:
- Policy Number: ${ctx.policy_number || ctx.policyNumber}
- Policy Type: ${ctx.policy_type || ctx.policyType}
- Premium: ${ctx.premium || 'N/A'}
- Coverage Amount: ${ctx.coverage || 'N/A'}
- Renewal Date: ${ctx.renewal || 'N/A'}
- Risk Score: ${ctx.risk_score || 'N/A'}
- Claims Filed: ${ctx.claim_count ?? 'N/A'}
${ctx.recent_claims ? '\nRECENT CLAIMS:\n' + ctx.recent_claims.map(c => `- ${c.number}: ${c.date} — ${c.status} ($${c.amount})`).join('\n') : ''}

BROWSING HISTORY: ${browsingHistoryText}
VERIFICATION STATUS: ${ctx.verificationStatus || ctx.verification_status || 'approved'}

INSTRUCTIONS:
1. This call is being recorded. The recording notice was already played.
2. Greet the customer warmly and ask for their name to verify identity.
3. Once name confirmed, ask for their policy number.
4. Once policy number verified, ask how you can help them today.
5. You HAVE the customer's policy information above. Use it to answer questions about their policy — premium amount, coverage, renewal date, claims history, etc.
6. Be helpful and conversational. If asked about policy details, provide the specific numbers from the context.
7. If the customer asks to speak to a human agent, say "I'll transfer you to an agent now" and end the conversation.
${ctx.recent_claims ? `8. CLAIMS ESCALATION: If the customer is asking about an active claim (especially one Under Review), acknowledge the claim details you have, but explain that a claims specialist can provide more detailed information and help resolve their issue. Offer to transfer them to a specialist. When they agree, say "I'll transfer you to a claims specialist now who will have all your information."` : ''}
`;

                        console.log(`Context matched for call ${callSid}: ${ctx.customerName} (${ctx.customerId})`);

                        // Move session from pending to actual callSid
                        sessions.set(callSid, {
                            messages: [{ role: "system", content: systemPrompt }],
                            transcript: [],
                            context: ctx,
                            createdAt: pendingSession.createdAt
                        });

                        // Delete the pending session
                        sessions.delete(pendingSessionKey);
                    } else {
                        // No context found, use default system prompt
                        sessions.set(callSid, {
                            messages: [{ role: "system", content: systemPrompt }],
                            transcript: [],
                            context: null,
                            createdAt: Date.now()
                        });
                    }

                    console.log(`SETUP ${JSON.stringify(sessions.get(ws.callSid).messages, null, 2)}`)
                    break;
                case "prompt":
                    // get the session
                    const session = sessions.get(ws.callSid);
                    if (!session) {
                        console.error(`No session found for callSid: ${ws.callSid}`);
                        break;
                    }

                    const messages = session.messages;

                    // add the voice prompt to the messages
                    messages.push({ role: "user", content: message.voicePrompt})

                    // Record customer speech in transcript
                    session.transcript.push({
                        role: 'customer',
                        content: message.voicePrompt,
                        timestamp: Date.now()
                    });

                    let reply = "";

                    const stream = await openai.chat.completions.create({
                        model: OPEN_AI_MODEL,
                        messages: messages,
                        stream: true,
                    });

                    // iterate through the stream in chunks
                    for await (const chunk of stream){

                        // if there is a token get it
                        const token = chunk.choices?.[0].delta.content;
                        if(token){
                            reply += token;
                        }

                        // Only send if we have a token (skip empty/undefined chunks)
                        if (token) {
                            const tts = {
                                type: "text",
                                token: token,
                                last: false,
                            }
                            ws.send(JSON.stringify(tts));
                        }
                        // console.log(`RESPONSE -> ${JSON.stringify(tts, null, 2)}`)
                    }

                    // add the full text to the session
                    messages.push({ role: "assistant", content: reply })

                    // Record AI response in transcript
                    session.transcript.push({
                        role: 'ai',
                        content: reply,
                        timestamp: Date.now()
                    });

                    // Check if the AI wants to transfer to a human agent
                    const transferPhrases = ["transfer you", "connect you to", "transferring you", "connect you with an agent", "transfer you to an agent"];
                    const shouldHandoff = transferPhrases.some(phrase => reply.toLowerCase().includes(phrase));

                    if (shouldHandoff) {
                        console.log(`HANDOFF DETECTED for call ${ws.callSid}`);
                        session.handoff = true;

                        const ctx = session.context || {};
                        const recentTranscript = (session.transcript || [])
                            .slice(-6)
                            .map(t => `${t.role}: ${t.content}`)
                            .join(' | ');

                        // Send the final text token
                        ws.send(JSON.stringify({ type: "text", token: "", last: true }));

                        // Small delay to let TTS finish before ending session
                        setTimeout(() => {
                            // End session with handoffData — matches ConversationRelay blog pattern
                            // Twilio passes handoffData to the action URL as HandoffData
                            ws.send(JSON.stringify({
                                type: "end",
                                handoffData: JSON.stringify({
                                    reasonCode: "live-agent-handoff",
                                    reason: "Customer requested live agent",
                                    customerName: ctx.customer_name || ctx.customerName || "Unknown",
                                    customerId: ctx.customer_id || ctx.customerId || "",
                                    policyNumber: ctx.policy_number || ctx.policyNumber || "",
                                    transcriptSummary: recentTranscript
                                })
                            }));
                            console.log(`RESPONSE -> HANDOFF END sent with handoffData`);
                        }, 2000);
                    } else {
                        // send the final message
                        const tts = {
                            type: "text",
                            token: "",
                            last: true,
                        }
                        ws.send(
                            JSON.stringify(tts)
                        )
                        console.log(`RESPONSE -> ${JSON.stringify(tts, null, 2)}`)
                    }
                    console.log(`RESPONSE -> ${reply}`)
                    break;
                case "interrupt":

                    // in the case of an interrupt construct a final message token
                    const interrupt = {
                        type: "text",
                        token: "",
                        last: true,
                    }
                    ws.send(
                        JSON.stringify(interrupt)
                    )
                    console.log(`INTERRUPT -> ${JSON.stringify(interrupt, null , 2)}`)
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
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server running at http://0.0.0.0:${PORT} — public domain: ${HOST}`);
} catch (e) {
    fastify.log.error(`Fastify Server Error ${e}`);
    process.exit(1);
}
