const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(GEMINI_API_KEY),
    modelConfigured: Boolean(GEMINI_MODEL)
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
  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'Gemini is not configured. The site owner needs to add GEMINI_API_KEY in Render environment settings.'
    });
  }

  const messages = req.body && req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({
      error: 'Please send a conversation with between 1 and 20 messages.'
    });
  }

  const validMessages = messages.every((message) =>
    message &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim().length > 0 &&
    message.content.length <= 8000
  );

  if (!validMessages || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({
      error: 'The conversation format is invalid. Please try sending your question again.'
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const contents = messages.slice(-20).map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents,
          generationConfig: {
            maxOutputTokens: 1200,
            temperature: 0.7
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Log status and provider error code only; never log API keys or full response bodies.
      console.error('Gemini request failed:', {
        status: response.status,
        errorStatus: data && data.error && data.error.status
      });

      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({
          error: 'Gemini rejected the API credentials. Check the GEMINI_API_KEY in Render.'
        });
      }
      if (response.status === 429) {
        return res.status(503).json({
          error: 'Gemini usage is temporarily limited. Please try again later.'
        });
      }
      if (response.status === 400) {
        return res.status(502).json({
          error: 'Gemini rejected this request. Please try a shorter or simpler question.'
        });
      }
      return res.status(502).json({
        error: 'Gemini is temporarily unavailable. Please try again.'
      });
    }

    const answer = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || '')
      .join('\n')
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: 'Gemini returned an empty answer. Please try again.'
      });
    }

    return res.json({ text: answer });
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    console.error(
      'MediGuide request failed:',
      timedOut ? 'upstream timeout' : (error && error.name) || 'unknown error'
    );

    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'Gemini took too long to respond. Please try again.'
        : 'MediGuide could not reach Gemini. Check your connection and try again.'
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MediGuide server listening on port ${PORT}`);
});
