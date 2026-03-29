const cache = new Map();
const rateLimits = new Map();

const RATE_LIMIT = 2;
const RATE_WINDOW = 24 * 60 * 60 * 1000;
const CACHE_TTL = 60 * 60 * 1000;

export const config = { maxDuration: 30 };

const MODELS = [
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'mixtral-8x7b-32768'
];

const FORMAT_STYLES = [
  `Use this structure: Start with a # header with the server name and a short punchy tagline on the next line. Then a bold sentence describing the value. Then a # Invite Link section with the link. Then any images as [Label](url) markdown links, each on its own line.`,

  `Use this structure: Wrap everything in > blockquotes. Start with a # header inside the quote with an emoji, server name, and a subtitle. Write 2-3 sentences about the server. List services with emoji bullet points inside the quote. Put image URLs raw inside the quote at the bottom. End with the Discord invite link outside the quote.`,

  `Use this structure: Start with a # header with emojis on both sides and the server name. Write a 2 sentence hook. Use ## for each section like "What We Offer", "Why Choose Us", "Join Today". Under each section use - bullet points. Put raw image URLs under a ## View Our Work section. End with a big # Join section and the invite link.`,

  `Use this structure: Start with **# Server Name** in bold-header style and a short italic quote tagline. Then a bold hook line with emoji and price or value proposition. List services as - emoji Name lines. Add a hiring section if applicable. Put images as [Image 1](url) [Image 2](url) style links. End with a bold join line and the invite link.`,

  `Use this structure: Keep it very minimal and clean. Just the server name as a # header. One short bold sentence. A clean bullet list of services with emojis. The invite link. Images as plain URLs on their own lines. No extra sections or headers. Under 400 characters total.`
];

async function tryGroq(apiKey, prompt, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.95
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Groq error');
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Empty response');
    return text;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  const userLimit = rateLimits.get(ip) || { count: 0, reset: now + RATE_WINDOW };
  if (now > userLimit.reset) { userLimit.count = 0; userLimit.reset = now + RATE_WINDOW; }
  if (userLimit.count >= RATE_LIMIT) {
    const wait = Math.ceil((userLimit.reset - now) / 1000 / 3600);
    return res.status(429).json({ error: `Daily limit reached. Resets in ${wait} hour(s).` });
  }

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  const cacheKey = prompt.trim().toLowerCase().slice(0, 300);
  const cached = cache.get(cacheKey);
  if (cached && now - cached.time < CACHE_TTL) {
    return res.status(200).json({ text: cached.text, cached: true });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const formatStyle = FORMAT_STYLES[Math.floor(Math.random() * FORMAT_STYLES.length)];

  const fullPrompt = `You are a Discord ad copywriter. Write a Discord server advertisement using Discord markdown.

CRITICAL: The entire ad must be UNDER 1800 characters. Count carefully. Do not exceed this.

${prompt}

FORMAT INSTRUCTION (follow this structure exactly):
${formatStyle}

Output ONLY the raw Discord ad text. No explanation, no preamble, no code blocks. Just the ad itself.`;

  let lastError = null;
  for (const model of MODELS) {
    try {
      const text = await tryGroq(apiKey, fullPrompt, model);
      userLimit.count++;
      rateLimits.set(ip, userLimit);
      cache.set(cacheKey, { text, time: now });
      const remaining = RATE_LIMIT - userLimit.count;
      return res.status(200).json({ text, cached: false, remaining });
    } catch (e) {
      lastError = e;
    }
  }

  return res.status(500).json({ error: lastError?.message || 'All models failed. Try again.' });
}
