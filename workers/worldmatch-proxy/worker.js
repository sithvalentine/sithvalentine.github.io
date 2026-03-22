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
- Has known issues with racial/ethnic discrimination or hostility toward foreigners if the user marked racial acceptance as essential or important — consider the user's likely background based on their current country and factor in real-world experiences of expats of color in candidate destinations
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

## SPLIT-LIVING / SEASONAL MODE

If the user selected "Split time between two places (seasonal / snowbird)" as their living style:

- Instead of 5 standalone places, recommend **3 complementary pairs** — each pair is a "home base" + "seasonal escape" that work together
- For each pair, explain which months to spend where and why the two places complement each other
- The pair should solve the specific season they want to escape (e.g. if they hate cold winters, pair a northern city they love for spring/summer/fall with a warm winter destination)
- Consider practical factors: time zones for remote workers, flight connections between the two places, visa rules that allow seasonal stays (e.g. 90-day Schengen limit)

Use this modified output format for split-living mode:

## 🥇 #1 Pair — [CITY A], [COUNTRY A] + [CITY B], [COUNTRY B]
**Your seasonal rhythm:** [e.g. "April–October in City A, November–March in City B"]

**Why this pair works for you**
[3–4 sentences on why these two complement each other for THIS user]

**City A — Your [season] base: [CITY], [COUNTRY]**
[2–3 sentences on lifestyle, neighborhood, what makes it great for those months]

**City B — Your [season] escape: [CITY], [COUNTRY]**
[2–3 sentences on lifestyle, neighborhood, what makes it great for those months]

**The logistics**
[1–2 sentences on flights between the two, visa considerations, cost comparison]

**The honest trade-off**
[1–2 sentences]

**Best area to explore:** City A: [area] · City B: [area]
**Ideal for someone who:** [One punchy sentence]
**Match score:** [X/100]

[Repeat for pairs #2 and #3, with #3 as the wildcard pair]

Then include the summary table with all 6 places (3 pairs) and next steps.

If the user selected "Travel frequently — digital nomad / no fixed base", recommend 5 standalone places but emphasize digital nomad infrastructure, visa options, co-working spaces, and rotation potential between them.

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

    // Route based on path
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/email') {
      return handleEmail(request, env, origin);
    }

    // Default: generate report
    return handleReport(request, env, origin);
  },
};

// ── Generate report via Claude ──

async function handleReport(request, env, origin) {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string') {
      return corsResponse(origin, JSON.stringify({ error: 'Missing prompt' }), 400);
    }

    if (prompt.length > 10000) {
      return corsResponse(origin, JSON.stringify({ error: 'Prompt too long' }), 400);
    }

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
}

// ── Email report via Kit (ConvertKit) ──

const KIT_TAG_NAME = 'WorldMatch';

async function handleEmail(request, env, origin) {
  try {
    const body = await request.json();
    const { email, name, report } = body;

    if (!email || !report) {
      return corsResponse(origin, JSON.stringify({ error: 'Missing email or report' }), 400);
    }

    const kitApiKey = env.KIT_API_KEY;

    // Step 1: Add/update subscriber in Kit with tag
    const tagId = await getOrCreateTag(kitApiKey, KIT_TAG_NAME);
    await tagSubscriber(kitApiKey, tagId, email, name);

    // Step 2: Send report via Kit's broadcast (or use a transactional-style approach)
    // Kit doesn't have transactional email on free tier, so we'll create a
    // one-off broadcast to this subscriber using their API.
    // Alternative: Use Kit's custom fields to store the report and trigger an automation.
    //
    // Simplest approach: Store report in a custom field and trigger automation,
    // OR send via a simple email using Cloudflare's built-in MailChannels integration.

    // We'll use MailChannels (free for Cloudflare Workers) for the transactional email
    await sendReportEmail(env, email, name, report);

    return corsResponse(origin, JSON.stringify({ success: true }), 200);

  } catch (err) {
    console.error('Email handler error:', err);
    return corsResponse(origin, JSON.stringify({ error: 'Failed to send email' }), 500);
  }
}

async function getOrCreateTag(apiKey, tagName) {
  // List existing tags (v3 API)
  const listRes = await fetch(`https://api.convertkit.com/v3/tags?api_key=${apiKey}`);

  if (listRes.ok) {
    const data = await listRes.json();
    const existing = data.tags?.find(t => t.name === tagName);
    if (existing) return existing.id;
  }

  // Create tag if it doesn't exist
  const createRes = await fetch('https://api.convertkit.com/v3/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      tag: { name: tagName },
    }),
  });

  if (!createRes.ok) {
    console.error('Failed to create Kit tag:', await createRes.text());
    throw new Error('Failed to create tag');
  }

  const tagData = await createRes.json();
  return tagData.id;
}

async function tagSubscriber(apiKey, tagId, email, name) {
  const res = await fetch(`https://api.convertkit.com/v3/tags/${tagId}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      email: email,
      first_name: name || '',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Kit tag subscriber error:', res.status, errText);
    // Don't throw — subscriber might already exist, still send email
  }
}

async function sendReportEmail(env, toEmail, toName, reportMarkdown) {
  const reportHtml = markdownToEmailHtml(reportMarkdown, toName);

  // Use Resend for transactional email delivery
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'WorldMatch <reports@9dimesproject.com>',
      to: [toEmail],
      subject: 'Your WorldMatch Report — Top 5 Places to Live',
      html: reportHtml,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Resend error:', res.status, errText);
    throw new Error('Email send failed');
  }
}

function markdownToEmailHtml(md, recipientName) {
  // Simple markdown → HTML for email
  let html = md
    // Headers
    .replace(/^# (.+)$/gm, '<h1 style="font-family:Georgia,serif;color:#1e1b4b;font-size:28px;margin-bottom:16px;">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="font-family:Georgia,serif;color:#1e1b4b;font-size:22px;margin-top:32px;margin-bottom:12px;border-bottom:2px solid #7c3aed;padding-bottom:8px;">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-family:Georgia,serif;color:#1e1b4b;font-size:18px;margin-top:20px;margin-bottom:8px;">$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #d6d3e8;margin:24px 0;">')
    // Table rows (simple)
    .replace(/\| (.+) \|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim()).map(c => `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${c.trim()}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    // Line breaks
    .replace(/\n\n/g, '</p><p style="font-family:Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#1e1b4b;margin-bottom:12px;">')
    .replace(/\n/g, '<br>');

  // Wrap tables
  html = html.replace(/<tr>/g, (match, offset) => {
    const before = html.substring(0, offset);
    if (!before.includes('<table') || before.lastIndexOf('</table>') > before.lastIndexOf('<table')) {
      return '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;"><tr>';
    }
    return match;
  });

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f0ff;font-family:'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-family:Georgia,serif;font-size:24px;color:#7c3aed;font-weight:700;">◈ WorldMatch</span>
    </div>
    <div style="background:#ffffff;border-radius:16px;padding:36px 32px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
      <p style="font-family:Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#1e1b4b;margin-bottom:12px;">
        Hi ${recipientName || 'there'},
      </p>
      <p style="font-family:Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#1e1b4b;margin-bottom:20px;">
        Here's your personalized WorldMatch report. Keep it for reference as you explore your next chapter.
      </p>
      <hr style="border:none;border-top:2px solid #7c3aed;margin:24px 0;">
      <p style="font-family:Segoe UI,sans-serif;font-size:15px;line-height:1.7;color:#1e1b4b;margin-bottom:12px;">
        ${html}
      </p>
    </div>
    <div style="text-align:center;margin-top:24px;font-size:12px;color:#6b7280;">
      <p>Powered by WorldMatch × Wealth Builder Tools</p>
      <p style="margin-top:4px;"><a href="https://sithvalentine.github.io" style="color:#7c3aed;text-decoration:none;">sithvalentine.github.io</a></p>
    </div>
  </div>
</body>
</html>`;
}

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
