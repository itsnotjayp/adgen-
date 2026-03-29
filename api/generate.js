const rateLimits = new Map();
const cache = new Map();
const globalStats = { total: 0 };

const RATE_LIMIT = 10;
const RATE_WINDOW = 24 * 60 * 60 * 1000;
const CACHE_TTL = 20 * 60 * 1000;

export const config = { maxDuration: 30 };

const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it'
];

const FORMATS = [
  `Use this exact structure:
# [SERVER NAME]
[Short punchy tagline]
**[Bold value proposition sentence]**
# Invite Link
[invite url]
[Images as [Label](url) at bottom]`,

  `Use this exact structure (everything in > blockquotes):
> # [emoji] [SERVER NAME] [emoji]
> [2-3 sentence description]
> **What We Offer:**
> [emoji] **[service]**
> [emoji] **[service]**
> ------------------------------
> **Join today:** [invite url]
> [raw image urls one per line]`,

  `Use this exact structure:
# [emoji] [SERVER NAME] [emoji]
[2 sentence hook]
## ✨ What We Offer
- [emoji] [service]
- [emoji] [service]
## 🔗 Join Today
[invite url]
## 📸 View Our Work
[raw image urls]`,

  `Use this exact structure:
**# [SERVER NAME]** *"[short tagline]"*
**[emoji] [Bold hook line]**
- [emoji] [service]
- [emoji] [service]
[Images as [Image 1](url)]
**🔗 Join us:** [invite url]`,

  `Minimal structure — under 500 chars total:
# [SERVER NAME]
**[One bold sentence]**
[emoji] [service] • [emoji] [service] • [emoji] [service]
🔗 [invite url]`
];

async function tryGroq(apiKey, prompt, model) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 22000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a Discord ad copywriter. Output ONLY the raw Discord ad text. No explanations, no code blocks, no backticks, no preamble. Just the ad.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 700,
        temperature: 0.92
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || 'API error ' + r.status);
    const text = (d?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('Empty response');
    return text;
  } catch(e) { clearTimeout(t); throw e; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — return total count
  if (req.method === 'GET') {
    return res.status(200).json({ total: globalStats.total });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();

  const lim = rateLimits.get(ip) || { count: 0, reset: now + RATE_WINDOW };
  if (now > lim.reset) { lim.count = 0; lim.reset = now + RATE_WINDOW; }
  if (lim.count >= RATE_LIMIT) {
    const wait = Math.ceil((lim.reset - now) / 3600000);
    return res.status(429).json({ error: `Daily limit reached. Resets in ${wait}h.` });
  }

  const { prompt, skipCache } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 5000) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  const clean = prompt.replace(/<[^>]*>/g, '').trim();
  const cacheKey = clean.slice(0, 200).toLowerCase();

  if (!skipCache) {
    const hit = cache.get(cacheKey);
    if (hit && now - hit.time < CACHE_TTL) {
      return res.status(200).json({ text: hit.text, cached: true, total: globalStats.total });
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API not configured' });

  const fmt = FORMATS[Math.floor(Math.random() * FORMATS.length)];
  const fullPrompt = `Write a Discord server advertisement. STAY UNDER 1800 CHARACTERS TOTAL.

${clean}

FORMAT TO FOLLOW EXACTLY:
${fmt}

Rules:
- Output ONLY the raw ad text
- Stay under 1800 characters
- Use Discord markdown (# headers, **bold**, > blockquotes, emojis)
- Place ALL image URLs at the very bottom`;

  let lastErr = null;
  for (const model of MODELS) {
    try {
      const text = await tryGroq(apiKey, fullPrompt, model);
      lim.count++;
      rateLimits.set(ip, lim);
      globalStats.total++;
      cache.set(cacheKey, { text, time: now });
      return res.status(200).json({ text, cached: false, total: globalStats.total, remaining: RATE_LIMIT - lim.count });
    } catch(e) { lastErr = e; }
  }

  return res.status(500).json({ error: lastErr?.message || 'All models failed. Try again.' });
}
