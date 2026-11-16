const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    modelConfigured: Boolean(ANTHROPIC_MODEL)
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const SYSTEM_PROMPT = `You are MediGuide, a health education assistant. You provide general, evidence-informed health information in clear, calm language.

You can explain:
- Commonly recognized symptoms and general information about health conditions.
- What medicines are generally used for and their active ingredients.
- Basic health terminology and how to prepare questions for a qualified clinician.

Safety boundaries:
- You are not a doctor and must not diagnose a person, assess their individual risk, or say that a particular treatment is right for them.
- Never provide medication dosages, dosing schedules, or instructions for starting, stopping, or changing medication.
- Do not replace professional care. Encourage the user to speak with a qualified healthcare professional for personal medical decisions.
- If someone describes a possible emergency or severe symptoms, advise them to seek urgent local medical care now and contact local emergency services. Do not try to manage the emergency through chat.
- For children, pregnancy, allergies, or existing medical conditions, direct personal questions to a qualified healthcare professional.
- If asked something unrelated to health, politely explain your scope.
- Do not invent sources, statistics, or certainty. State when information is uncertain.
- Keep answers concise, structured, and understandable. Avoid frightening language.

End substantive answers with a short reminder that this is general information, not a diagnosis or personal medical advice.`;

app.post('/api/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'The AI service is not configured yet. The site owner needs to add ANTHROPIC_API_KEY in Render environment settings.'
    });
  }

  const messages = req.body && req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({ error: 'Please send a conversation with between 1 and 20 messages.' });
  }

  const validMessages = messages.every((message) =>
    message &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim().length > 0 &&
    message.content.length <= 8000
  );

  if (!validMessages || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'The conversation format is invalid. Please try sending your question again.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: messages.slice(-20)
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Log only status and a provider request ID; never log keys or full request/response bodies.
      console.error('Anthropic request failed:', {
        status: response.status,
        requestId: response.headers.get('request-id') || undefined,
        errorType: data && data.error && data.error.type
      });

      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({ error: 'The AI provider rejected the server credentials. The site owner should check and rotate the API key in Render.' });
      }
      if (response.status === 429) {
        return res.status(503).json({ error: 'The AI service is temporarily rate-limited or has reached its usage limit. Please try again later.' });
      }
      if (response.status === 400) {
        return res.status(502).json({ error: 'The AI provider rejected this request. Please try a shorter or simpler question.' });
      }
      return res.status(502).json({ error: 'The AI provider is temporarily unavailable. Please try again in a little while.' });
    }

    const answer = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!answer) {
      return res.status(502).json({ error: 'The AI returned an empty answer. Please try asking in a different way.' });
    }

    return res.json({ text: answer });
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    console.error('MediGuide request failed:', timedOut ? 'upstream timeout' : (error && error.name) || 'unknown error');
    return res.status(504).json({
      error: timedOut
        ? 'The AI took too long to respond. Please try again.'
        : 'MediGuide could not reach the AI service. Check your connection and try again.'
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MediGuide server listening on port ${PORT}`);
});
