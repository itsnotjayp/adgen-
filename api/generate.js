const cache = new Map();
const rateLimits = new Map();

const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 1000;
const CACHE_TTL = 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  const userLimit = rateLimits.get(ip) || { count: 0, reset: now + RATE_WINDOW };
  if (now > userLimit.reset) { userLimit.count = 0; userLimit.reset = now + RATE_WINDOW; }
  if (userLimit.count >= RATE_LIMIT) {
    const wait = Math.ceil((userLimit.reset - now) / 1000);
    return res.status(429).json({ error: `Rate limit reached. Try again in ${wait} seconds.` });
  }
  userLimit.count++;
  rateLimits.set(ip, userLimit);

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const cacheKey = prompt.trim().toLowerCase().slice(0, 300);
  const cached = cache.get(cacheKey);
  if (cached && now - cached.time < CACHE_TTL) {
    return res.status(200).json({ text: cached.text, cached: true });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.9 }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Gemini API error');

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) throw new Error('Empty response from Gemini');

    cache.set(cacheKey, { text, time: now });
    return res.status(200).json({ text, cached: false });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
