const ipLimits = new Map();
const userLimits = new Map();
const cache = new Map();
const globalStats = { total: 0 };

const IP_LIMIT = 20;
const USER_LIMIT = 10;
const RATE_WINDOW = 24 * 60 * 60 * 1000;
const CACHE_TTL = 5 * 60 * 1000;

export const config = { maxDuration: 30 };

const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'gemma2-9b-it'];

const SERVER_CONTEXT = {
  tech: 'A technology, programming, or software development server. Members are developers, coders, and tech enthusiasts.',
  aviation: 'An aviation server focused on real-world flying, flight simulation, aircraft, or pilot training.',
  scp: 'An SCP Foundation server based on the SCP wiki universe — anomalous entities, containment procedures, and horror/sci-fi lore.',
  muslim: 'A Muslim/Islamic community server for faith, discussion, Quran, and halal community.',
  roleplay: 'A roleplay server where members create characters and engage in collaborative storytelling.',
  gaming: 'A gaming community server for playing, competing, and discussing video games.',
  roblox: 'A Roblox server — either a game community, asset store, or development community.',
  anime: 'An anime and manga community server for fans to discuss series, characters, and culture.',
  business: 'A business, entrepreneurship, or marketing server for professionals.',
  creative: 'A creative arts server for artists, designers, musicians, and creators.',
  social: 'A general social community server for hanging out and meeting people.',
  other: 'A general Discord server.'
};

const STYLE_GUIDE = {
  bold: 'Write with MAXIMUM ENERGY. Use ALL CAPS for headers. Multiple fire/hype emojis. Extremely punchy 1-sentence hook that hits hard. Short sentences. Exclamation marks.',
  clean: 'Write professionally and polished. Minimal emojis (2-3 total). Structured and clear. Trustworthy tone. No hype, just value.',
  friendly: 'Write warmly like you\'re talking to a friend. Casual language. Light emojis. Welcoming tone. Conversational.',
  luxury: 'Write with exclusivity. Premium language. Imply scarcity and high value. Minimal emojis. Sophisticated.',
  urgent: 'Write with urgency. FOMO language. "Limited", "Don\'t miss", "Act now". High pressure but genuine.',
  funny: 'Write with humor and self-awareness. Meme-like energy. Slightly sarcastic. Still sells the server.'
};

const FORMATS = [
  `BLOCKQUOTE FORMAT — use > for every line:
> # [EMOJI] [SERVER NAME] [EMOJI]
> [Hook sentence that grabs attention instantly]
> **[Bold value statement — what makes this server worth joining]**
> **━━━━━━━━━━━━━━━━━━━━━━**
> **What We Offer:**
> [emoji] **[Service/Feature 1]** ✦
> [emoji] **[Service/Feature 2]** ✦
> [emoji] **[Service/Feature 3]** ✦
> **━━━━━━━━━━━━━━━━━━━━━━**
> [emoji] **Join [server name] now:** [invite link]
[image urls at bottom, one per line, NO blockquote]`,

  `HEADER FORMAT — use markdown headers:
# [emoji] [SERVER NAME]
## *"[motto or tagline]"*
[2 sentence description of what this server is and why it's worth joining]

**🎯 What Makes Us Different:**
> [emoji] [Unique selling point 1]
> [emoji] [Unique selling point 2]
> [emoji] [Unique selling point 3]

**📋 We Offer:**
[emoji] [service] | [emoji] [service] | [emoji] [service]

**[emoji] Join today:** [invite link]
[image urls]`,

  `CLEAN LIST FORMAT:
**# [SERVER NAME]** — *"[motto]"*

**[emoji] [Bold punchy hook — 1 sentence max]**

**What we offer:**
- [emoji] **[Service 1]**
- [emoji] **[Service 2]**  
- [emoji] **[Service 3]**
- [emoji] **[Service 4]**

[If hiring:]
**💼 We're Hiring:** [roles]

**🔗 Join us:** [invite link]
[images as [Name](url) links]`,

  `CENTERED BLOCKQUOTE FORMAT:
> ## [SERVER NAME]
> *[motto or tagline]*
> ━━━━━━━━━━━━━━━━━━━━━━
> [3-4 sentence engaging description about the server. Include what makes it unique. Speak directly to the reader.]
> ━━━━━━━━━━━━━━━━━━━━━━
> ✅ [Feature 1] | ✅ [Feature 2] | ✅ [Feature 3]
> ━━━━━━━━━━━━━━━━━━━━━━
> 🔗 **[invite link]**
[image urls]`,

  `EMOJI-HEAVY FORMAT:
# [emoji][emoji] [SERVER NAME] [emoji][emoji]
> [Very punchy 1 sentence hook]

[emoji] **[service/feature]**
[emoji] **[service/feature]**
[emoji] **[service/feature]**
[emoji] **[service/feature]**

[If hiring: [emoji] **Hiring:** [roles]]

[emoji] **Invite:** [invite link]
[images]`,

  `ANNOUNCEMENT STYLE:
📢 **[SERVER NAME] IS [OPEN/GROWING/LOOKING FOR MEMBERS]!**

[2-3 sentences describing the server, its community, and what members get from joining. Be specific about the server type and audience.]

**🏷️ What We Provide:**
> [emoji] [detailed service description]
> [emoji] [detailed service description]
> [emoji] [detailed service description]

**👥 Community:** [tags/vibe description]
**🔗 Discord:** [invite link]
[images as [Label](url)]`,

  `MINIMAL CLEAN:
# [SERVER NAME]
**[One powerful sentence. Make it specific to this server type. No generic phrases.]**

[emoji] [service] • [emoji] [service] • [emoji] [service]

[If motto exists: *"[motto]"*]

🔗 [invite link]
[images]`,

  `STORY FORMAT:
> # [emoji] [SERVER NAME]
> [Start with a question or problem the reader has — e.g. "Tired of dead servers?" or "Looking for serious [server type] players?"]
> 
> [Answer the problem with what this server offers — 2 sentences]
> 
> **[emoji] Here's what awaits you:**
> [emoji] [feature with brief description]
> [emoji] [feature with brief description]
> [emoji] [feature with brief description]
> 
> **[emoji] [Closing call to action sentence]**
> 🔗 [invite link]
[image urls]`
];

function sanitize(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').trim().slice(0, 1000);
}

async function tryGroq(apiKey, prompt, model, seed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 22000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are an expert Discord ad copywriter. Your seed for this response is: ${seed}. 
CRITICAL RULES:
1. Output ONLY the raw Discord ad text — absolutely no explanations, no "Here's your ad:", no backticks, no code blocks
2. The ad MUST be between 300-1800 characters — NOT shorter, NOT longer  
3. Make it SPECIFIC to the server details provided — no generic filler
4. Follow the format structure provided EXACTLY
5. Every ad you write must feel unique and different from others
6. Use the server's actual name, services, and details throughout`
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 900,
        temperature: 0.98,
        top_p: 0.95,
        frequency_penalty: 0.6,
        presence_penalty: 0.4
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || 'API error ' + r.status);
    let text = (d?.choices?.[0]?.message?.content || '').trim();
    // Strip any preamble the model might add
    text = text.replace(/^(here'?s?|this is|your ad:|ad:)[^\n]*\n/i, '').trim();
    text = text.replace(/^```[^\n]*\n?/,'').replace(/```$/,'').trim();
    if (!text || text.length < 100) throw new Error('Response too short — retrying');
    return text;
  } catch(e) { clearTimeout(t); throw e; }
}

async function rateAd(apiKey, adText, model) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are an expert Discord marketing analyst. Rate Discord ads honestly and critically.
Output ONLY valid JSON in this exact format, nothing else:
{"attraction": <1-10>, "info": <1-10>, "visuals": <1-10>, "overall": <1-10>, "tip": "<one short improvement tip under 80 chars>"}`
          },
          {
            role: 'user',
            content: `Rate this Discord ad on three criteria (1-10 each, be honest and critical):
- Attraction: Does the hook grab attention? Would someone stop scrolling?
- Info: Does it clearly explain what the server is and what you get?
- Visuals: Is the formatting, emoji use, and visual structure appealing in Discord?

AD:
${adText.slice(0, 1500)}`
          }
        ],
        max_tokens: 150,
        temperature: 0.3
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const d = await r.json();
    if (!r.ok) throw new Error('Rating API error');
    const content = (d?.choices?.[0]?.message?.content || '').trim();
    const json = content.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
    return JSON.parse(json);
  } catch(e) { clearTimeout(t); throw e; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ total: globalStats.total });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();

  const ipl = ipLimits.get(ip) || { count: 0, reset: now + RATE_WINDOW };
  if (now > ipl.reset) { ipl.count = 0; ipl.reset = now + RATE_WINDOW; }
  if (ipl.count >= IP_LIMIT) return res.status(429).json({ error: 'Too many requests from this network.' });

  const body = req.body || {};
  const { prompt, userId, skipCache, serverType, tags, motto, style, rateOnly, adToRate } = body;

  // Rate existing ad endpoint
  if (rateOnly && adToRate) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API not configured' });
    try {
      const rating = await rateAd(apiKey, String(adToRate).slice(0, 2000), MODELS[0]);
      return res.status(200).json({ rating });
    } catch(e) {
      return res.status(500).json({ error: 'Rating failed: ' + e.message });
    }
  }

  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  if (userId && typeof userId === 'string') {
    const uid = userId.slice(0, 36);
    const ul = userLimits.get(uid) || { count: 0, reset: now + RATE_WINDOW };
    if (now > ul.reset) { ul.count = 0; ul.reset = now + RATE_WINDOW; }
    if (ul.count >= USER_LIMIT) {
      const wait = Math.ceil((ul.reset - now) / 3600000);
      return res.status(429).json({ error: `Daily limit reached. Resets in ${wait}h.` });
    }
    ul.count++;
    userLimits.set(uid, ul);
  }

  const clean = sanitize(prompt);
  const seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const cacheKey = skipCache ? null : (clean.slice(0, 120).toLowerCase() + serverType + style);

  if (!skipCache && cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && now - hit.time < CACHE_TTL) {
      return res.status(200).json({ text: hit.text, cached: true, total: globalStats.total });
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API not configured' });

  // Pick random format — weighted to avoid repetition
  const fmtIdx = Math.floor(Math.random() * FORMATS.length);
  const fmt = FORMATS[fmtIdx];
  const srvCtx = SERVER_CONTEXT[serverType] || SERVER_CONTEXT.other;
  const tagStr = Array.isArray(tags) && tags.length ? 'Community vibe/tags: ' + tags.map(t => '#' + t).join(' ') : '';
  const mottoStr = motto ? `Server motto: "${sanitize(motto)}"` : '';
  const styleGuide = STYLE_GUIDE[style] || STYLE_GUIDE.bold;

  const fullPrompt = `Write a Discord server advertisement. UNIQUE ID: ${seed}

SERVER DETAILS:
${clean}
Server type context: ${srvCtx}
${mottoStr}
${tagStr}

WRITING STYLE: ${styleGuide}

FORMAT TO USE (follow this structure):
${fmt}

IMPORTANT:
- The ad MUST be 400-1800 characters (not shorter!)
- Use the server's ACTUAL name and details throughout — no placeholders
- Make the hook specific to "${serverType}" servers — not generic
- Place ALL image URLs at the very bottom with no blockquote prefix
- Output ONLY the ad text, nothing else whatsoever`;

  let lastErr = null;
  for (const model of MODELS) {
    try {
      const text = await tryGroq(apiKey, fullPrompt, model, seed);
      ipl.count++;
      ipLimits.set(ip, ipl);
      globalStats.total++;
      if (cacheKey) cache.set(cacheKey, { text, time: now });

      // Auto-rate the ad
      let rating = null;
      try { rating = await rateAd(apiKey, text, MODELS[0]); } catch {}

      return res.status(200).json({ text, cached: false, total: globalStats.total, rating });
    } catch(e) { lastErr = e; }
  }

  return res.status(500).json({ error: lastErr?.message || 'Generation failed. Try again.' });
}
