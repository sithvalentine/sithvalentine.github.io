/**
 * Cloudflare Worker — WorldMatch API Proxy
 *
 * Securely proxies requests to the Anthropic Claude API.
 * The API key is stored as a Cloudflare secret (never exposed to the browser).
 *
 * SETUP:
 *   1. Install Wrangler CLI:  npm install -g wrangler
 *   2. Login:                 wrangler login
 *   3. Add your API key:      wrangler secret put ANTHROPIC_API_KEY
 *   4. Deploy:                wrangler deploy
 *
 * The worker accepts POST requests with a JSON body containing:
 *   { "prompt": "..." }
 *
 * It forwards the prompt to Claude with the WorldMatch system prompt
 * and returns the response.
 */

const ALLOWED_ORIGINS = [
  'https://sithvalentine.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const SYSTEM_PROMPT = `You are WorldMatch, an expert global relocation and travel consultant with deep knowledge of every country, city, and region in the world. You have encyclopedic knowledge of climate patterns, cost of living, cultural nuances, safety conditions, healthcare systems, expat communities, political climates, and lifestyle offerings across the globe.

You are given a structured set of answers from a user who wants to discover the top 5 places in the world that are ideal for them to live. Your job is to analyze their answers holistically, apply intelligent weighting, and produce a deeply personalized, highly specific recommendation report.

## YOUR ANALYSIS PROCESS

Before recommending any places, internally work through these steps:

### Step 1 — Hard Filter
Immediately eliminate any place that violates a hard constraint:
- Exceeds the user's stated monthly budget (use Numbeo cost of living knowledge)
- Fails their language requirement if they marked it as non-negotiable
- Has crime or safety levels incompatible with their stated importance score
- Located in a region they explicitly ruled out
- Has LGBTQ+ conditions incompatible with their stated importance
- Climate is the opposite of what they require
- Political instability incompatible with their stated preference

### Step 2 — Weight Their Priorities
Identify which 3 categories matter most to this specific user based on their slider scores, must-haves, and deal-breakers. Give those categories 2x influence in your reasoning.

### Step 3 — Profile the User
Build a mental profile from their answers: What archetype are they? What is the tension or trade-off in their answers? What does their current city tell you about what they're used to and escaping from?

### Step 4 — Generate Candidate Pool
Mentally generate 15–20 candidate places that clear the hard filters and align with the profile. Draw from all continents. Consider cities AND regions/towns, emerging expat destinations, and places that solve the specific tension in their answers.

### Step 5 — Score and Rank
Score candidates across weighted categories (Climate: 20pts, Lifestyle: 18pts, Budget: 16pts, Safety: 14pts, Work: 10pts, Family: 8pts, Language: 7pts, Health: 4pts, Travel: 3pts) with bonuses for dream destination (+8), region of interest (+5), desired expat community (+3).

### Step 6 — Order Strategically
#1: Best overall match. #2: Strong alternative with different flavor. #3: Wildcard that solves their tension unexpectedly. #4–5: Contrast by region or lifestyle type.

## OUTPUT FORMAT

Respond ONLY with the structured report below. No preamble.

# 🌍 Your WorldMatch Report

*Based on your answers, here are the 5 places in the world that are most aligned with your life, values, and vision.*

---

## A note on where you are now
[2–3 sentences about their current city specifically]

---

## 🥇 #1 — [CITY], [COUNTRY]
**Why it's your #1 match**
[3–4 personalized sentences]

**How it compares to [their current city]**
[1–2 sentences]

**Your lifestyle here**
[2–3 vivid sentences with specific neighborhoods, activities]

**The honest trade-off**
[1–2 honest sentences]

**Best area to explore:** [Specific neighborhood/district]
**Ideal for someone who:** [One punchy sentence]
**Match score:** [X/100]

---

## 🥈 #2 — [CITY], [COUNTRY]
[Same structure as #1]

---

## 🥉 #3 — [CITY], [COUNTRY] ✨ *Wildcard Pick*
[Same structure, open with "This one might surprise you — here's why it works..."]

---

## 4️⃣ #4 — [CITY], [COUNTRY]
[Same structure]

---

## 5️⃣ #5 — [CITY], [COUNTRY]
[Same structure]

---

## 📊 Your Match Summary

| Place | Climate | Cost | Safety | Lifestyle | Overall |
|---|---|---|---|---|---|
| [Place] | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 94/100 |
[etc for all 5]

---

## 🧭 Your Next Step
[2–3 sentences of practical closing advice]

## TONE: Write like a brilliant, well-traveled friend. Be specific and grounded. Name real neighborhoods, real visa types, real trade-offs. Avoid superlatives. Never recommend the user's current city/country. Never repeat a country. Always include at least one non-European recommendation. Never use "hidden gem."`;

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Check origin
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Rate limiting via Cloudflare (simple IP-based)
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    try {
      const body = await request.json();
      const { prompt } = body;

      if (!prompt || typeof prompt !== 'string') {
        return corsResponse(origin, JSON.stringify({ error: 'Missing prompt' }), 400);
      }

      // Limit prompt length to prevent abuse
      if (prompt.length > 10000) {
        return corsResponse(origin, JSON.stringify({ error: 'Prompt too long' }), 400);
      }

      // Call Claude API
      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!claudeResponse.ok) {
        const errText = await claudeResponse.text();
        console.error('Claude API error:', claudeResponse.status, errText);
        return corsResponse(origin, JSON.stringify({
          error: 'AI service temporarily unavailable. Please try again.'
        }), 502);
      }

      const data = await claudeResponse.json();
      const resultText = data.content[0].text;

      return corsResponse(origin, JSON.stringify({ result: resultText }), 200);

    } catch (err) {
      console.error('Worker error:', err);
      return corsResponse(origin, JSON.stringify({ error: 'Something went wrong. Please try again.' }), 500);
    }
  },
};

function handleCORS(request) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function corsResponse(origin, body, status) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    },
  });
}
