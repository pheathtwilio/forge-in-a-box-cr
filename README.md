# Twilio Conversation Relay Forge in a Box

This repo demonstrates building an interactive voice assistant using Twilio's `<ConversationRelay>` and an OpenAI LLM backend.

Each branch builds on the last:

1. `cr-1-twiml-websocket` — Basic TwiML and WebSocket echo
2. `cr-2-llm-integration` — Add OpenAI chat completion
3. `cr-3-streaming` — Upgrade to streaming responses
4. `cr-4-interruptions` — Handle spoken user interruptions

## Getting Started
``` bash 
git clone https://github.com/pheathtwilio/forge-in-a-box-cr.git
cd forge-in-a-box-cr
git checkout cr-1-twiml-websocket
npm install
cp .env.example .env  # Then fill in keys
bash src/util/setupTwilioNumber.sh # This sets up and configures a number
ngrok http 8080 --domain=yourdomainname.ngrok.io
npm run dev
```

`cr-1-twiml-websocket`
This branch sets up the base Conversation Relay Configuration
- Sets up the Fastify server to handle -www-form-urlencoded content
- and Web Sockets. 
- Environment Variables are setup for NGROK_DOMAIN, WS_URL and PORT.
- The Welcome Greeting is then set up.
- A basic conversation relay TwiML verb is setup with the url and  
- the welcomeGreeting specified.
- Registers the route for handling the twiml request.
- Websocket is then setup and message handlers for setup, prompt and
- interrupt are then defined.
- The Fastify server is initiated with fastify.listen(PORT)

`cr-2-llm-integration`
This branch sets up the OpenAI Chat Completion Integration 
- Adding OpenAI import
- Adding Session Handler Map Object to track Messages
- Adding SYSTEM_PROMPT for OpenAI Chat Completions
- Adding the chat completion handler 
- Integrating the call to the handler to the prompt message
- Create a simple SPI Text Message to send to the Web Socket for TTS

`cr-3-streaming`
This branch sets up streaming from Chat completions and handles them
- Set stream to true in the completions API call
- Iterated through tokenized results from the stream
- Send each token to TTS
- Finalize when the stream is finished

`cr-4-interrupts`
This branch sets up simple interrupts 
- Modifies the TwiML to add the interruptible parameter
- Updates the interrupt case to send a last text token to TTS
- Does not handle context yet
