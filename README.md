# MediGuide

A minimal chatbot that gives general information about disease symptoms and
medicine composition/use. Not a diagnostic tool — always says to consult a
doctor or pharmacist.

Created by Pratik Khadka.

## Structure
- `server.js` — Express server. Serves the frontend and relays chat requests
  to the Anthropic API so the API key never reaches the browser.
- `public/index.html` — the chat UI (single file, no build step).

## Run locally
```
npm install
cp .env.example .env   # then paste your real key into .env
npm start
```
Visit http://localhost:3000

## Deploy
Set the `ANTHROPIC_API_KEY` environment variable on your host (see deployment
notes). Start command: `npm start`.
