const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const SYSTEM_PROMPT = `You are MediGuide, a general medical information assistant embedded in a minimal chat app.

Scope of what you answer:
- General symptoms commonly associated with a disease or condition the user names.
- The general class/category of medication typically used for a condition (e.g. "antihistamines are commonly used for allergic reactions"), and, when asked, the generic composition or active ingredient(s) of a named medicine.
- What a named medicine is generally used for, in plain terms.

Hard limits:
- Never give specific dosages, dosing schedules, or administration instructions.
- Never tell a specific person what they personally should take, or confirm/deny a diagnosis for them.
- Always keep answers concise (short paragraphs or a short list), plain-language, and non-alarmist.
- End every substantive answer with a brief, non-repetitive one-line reminder to consult a doctor or pharmacist — vary the wording naturally, don't template it.
- If asked about dosage, self-treatment, or anything beyond general information, decline that specific part and redirect to a healthcare professional, while still answering the general-information part of the question if there is one.
- If the question is unrelated to health/medicine, gently redirect back to what you can help with.

Tone: calm, clear, plain language, no jargon without explanation, no scare-mongering, no filler.`;

app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is not configured with an API key.' });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: 'Upstream API error.' });
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    res.json({ text });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong reaching the model.' });
  }
});

app.listen(PORT, () => {
  console.log(`MediGuide server running on port ${PORT}`);
});
