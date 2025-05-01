# Twilio Conversation Relay Forge in a Box

This repo demonstrates building an interactive voice assistant using Twilio's `<ConversationRelay>` and an OpenAI LLM backend.

Each branch builds on the last:

1. `cr-1-twiml-websocket` — Basic TwiML and WebSocket echo
2. `cr-2-llm-integration` — Add OpenAI chat completion
3. `cr-3-streaming` — Upgrade to streaming responses
4. `cr-4-interruptions` — Handle spoken user interruptions

## Getting Started

```bash
git clone https://github.com/pheathtwilio/forge-in-a-box-cr.git
cd forge-in-a-box-cr
git checkout cr-1-twiml-websocket
npm install
cp .env.example .env  # Then fill in keys
node server.js
