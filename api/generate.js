const ipLimits = new Map();
const userLimits = new Map();
const cache = new Map();
const globalStats = { total: 0 };

const IP_LIMIT = 15;
const USER_LIMIT = 10;
const RATE_WINDOW = 24 * 60 * 60 * 1000;
const CACHE_TTL = 8 * 60 * 1000;

export const config = { maxDuration: 30 };

const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'gemma2-9b-it'];

const SERVER_CONTEXT = {
  gaming:'A gaming community server.', roleplay:'A roleplay/RP server.',
  roblox:'A Roblox game or asset store server.', tech:'A technology/programming server.',
  music:'A music community.', anime:'An anime/manga community.',
  business:'A business/entrepreneurship server.', social:'A general social hangout.',
  educational:'An educational/study server.', creative:'A creative arts community.',
  nft:'An NFT/crypto community.', other:'A general Discord server.'
};

const STYLE_PROMPTS = {
  bold:'BOLD AND HYPE: ALL CAPS headers, fire emojis, punchy hook. Maximum energy.',
  clean:'CLEAN PROFESSIONAL: Minimal emojis, polished, trustworthy tone.',
  friendly:'FRIENDLY CASUAL: Warm, conversational, welcoming language.',
  luxury:'LUXURY ELITE: Exclusive wording, premium feel, imply scarcity.',
  urgent:'URGENT FOMO: Limited time feel, act now, dont miss out energy.',
  funny:'FUNNY EDGY: Self-aware humor, meme energy, slightly sarcastic but sells.'
};

const FORMATS = [
  `> # [emoji] [NAME] [emoji]\n> [1 line hook]\n> **[bold value sentence]**\n> **What We Offer:**\n> [emoji] **[service]** *\n> [emoji] **[service]** *\n> ------------------------------\n> **Join:** 🔗 [invite]\n> [images]`,
  `# [NAME]\n[tagline]\n**[bold sentence]**\n## Offer\n[emoji] [svc] • [emoji] [svc]\n## Join\n🔗 [invite]\n[images as [Label](url)]`,
  `**# [NAME]** *"[motto]"*\n**[emoji] [hook]**\n- [emoji] [service]\n- [emoji] [service]\n[images as [Image N](url)]\n**🔗 Join:** [invite]`,
  `# [emoji] [NAME]\n> [hook]\n> **Services:** [svc] | [svc] | [svc]\n> 🔗 [invite]\n> [images]`,
  `# [NAME]\n**[one punchy sentence]**\n[emoji] [svc] • [emoji] [svc] • [emoji] [svc]\n🔗 [invite]`,
  `> ## [NAME]\n> *[motto]*\n> [hook]\n> ✅ [svc] ✅ [svc] ✅ [svc]\n> 🔗 [invite]\n> [images]`,
  `# [emoji][NAME][emoji]\n**[hook]**\n\`\`[svc]\`\` \`\`[svc]\`\` \`\`[svc]\`\`\n> 🔗 [invite]\n> [images]`,
  `## [NAME] — [motto]\n[hook]\n**Offering:** [svc], [svc], [svc]\n**Hiring:** [roles]\n🔗 [invite]\n[images]`
];

function sanitize(s) {
  return String(s||'').replace(/<[^>]*>/g,'').replace(/[^\x20-\x7E\n]/g,c=>c).slice(0,2000);
}

async function tryGroq(apiKey, prompt, model, seed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 22000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role:'system', content:`You are a Discord ad copywriter. Seed: ${seed}. Output ONLY the raw Discord ad. No backticks, no explanation, no preamble. Just the ad text.` },
          { role:'user', content: prompt }
        ],
        max_tokens: 700,
        temperature: 0.95,
        top_p: 0.9
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const d = await r.json();
    if(!r.ok) throw new Error(d?.error?.message || 'API error ' + r.status);
    const text = (d?.choices?.[0]?.message?.content||'').trim();
    if(!text) throw new Error('Empty response');
    return text;
  } catch(e) { clearTimeout(t); throw e; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method === 'GET') return res.status(200).json({ total: globalStats.total });
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || 'unknown';
  const now = Date.now();

  // IP rate limit
  const ipl = ipLimits.get(ip) || { count:0, reset: now + RATE_WINDOW };
  if(now > ipl.reset) { ipl.count=0; ipl.reset=now+RATE_WINDOW; }
  if(ipl.count >= IP_LIMIT) return res.status(429).json({ error:'Too many requests from this network.' });

  const body = req.body || {};
  const { prompt, userId, skipCache, serverType, tags, motto } = body;

  if(!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  // User rate limit
  if(userId && typeof userId === 'string') {
    const uid = userId.slice(0,36);
    const ul = userLimits.get(uid) || { count:0, reset: now+RATE_WINDOW };
    if(now > ul.reset) { ul.count=0; ul.reset=now+RATE_WINDOW; }
    if(ul.count >= USER_LIMIT) {
      const wait = Math.ceil((ul.reset-now)/3600000);
      return res.status(429).json({ error:`Daily limit reached. Resets in ${wait}h.` });
    }
    ul.count++;
    userLimits.set(uid, ul);
  }

  const clean = sanitize(prompt);
  const seed = Math.random().toString(36).slice(2,10) + Date.now().toString(36);
  const cacheKey = skipCache ? null : (clean.slice(0,150).toLowerCase() + (serverType||''));

  if(!skipCache && cacheKey) {
    const hit = cache.get(cacheKey);
    if(hit && now - hit.time < CACHE_TTL) {
      return res.status(200).json({ text: hit.text, cached: true, total: globalStats.total });
    }
  }

  const apiKey = process.env.GROQ_API_KEY;
  if(!apiKey) return res.status(500).json({ error: 'API not configured' });

  const fmt = FORMATS[Math.floor(Math.random() * FORMATS.length)];
  const srvCtx = SERVER_CONTEXT[serverType] || SERVER_CONTEXT.other;
  const tagStr = Array.isArray(tags) ? tags.map(t=>'#'+t).join(' ') : '';
  const mottoStr = motto ? `Motto: "${sanitize(motto)}"` : '';

  const fullPrompt = `Write a Discord server advertisement. MUST BE UNDER 1800 CHARACTERS TOTAL. UNIQUE SEED: ${seed}.

${clean}
Server context: ${srvCtx}
${tagStr ? 'Tags: ' + tagStr : ''}
${mottoStr}
Style: ${STYLE_PROMPTS[body.style] || STYLE_PROMPTS.bold}

FOLLOW THIS FORMAT EXACTLY:
${fmt}

RULES:
- Output ONLY the raw ad text, nothing else
- Under 1800 characters total
- Use Discord markdown (# headers, **bold**, > blockquotes, emojis)
- ALL image URLs at the very bottom
- Make it unique — this is seed ${seed}`;

  let lastErr = null;
  for(const model of MODELS) {
    try {
      const text = await tryGroq(apiKey, fullPrompt, model, seed);
      ipl.count++;
      ipLimits.set(ip, ipl);
      globalStats.total++;
      if(cacheKey) cache.set(cacheKey, { text, time: now });
      return res.status(200).json({ text, cached: false, total: globalStats.total });
    } catch(e) { lastErr = e; }
  }

  return res.status(500).json({ error: lastErr?.message || 'Generation failed. Try again.' });
}
