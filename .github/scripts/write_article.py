"""
Weekly article generator for Wealth Builder Tools.
Fetches current financial news, writes an article via Claude API,
then updates articles.html and sitemap.xml.
"""

import anthropic
import requests
import json
import os
import re
from datetime import date, datetime

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = "https://sithvalentine.github.io"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TAG_STYLES = {
    "Investing":   ("tag-investing",   "ede9fe", "7c3aed"),
    "Economy":     ("tag-economy",     "dbeafe", "1d4ed8"),
    "Real Estate": ("tag-realestate",  "d1fae5", "065f46"),
    "Budgeting":   ("tag-budgeting",   "fef3c7", "92400e"),
}

# ── Step 1: Fetch news headlines ──────────────────────────────────────────────

def fetch_news():
    """Pull recent financial headlines from NewsAPI (free tier)."""
    api_key = os.environ.get("NEWS_API_KEY", "")
    headlines = []

    if api_key:
        try:
            url = (
                "https://newsapi.org/v2/top-headlines"
                "?category=business&language=en&country=us&pageSize=20"
                f"&apiKey={api_key}"
            )
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                headlines = [
                    f"- {a['title']}: {a.get('description', '')}"
                    for a in data.get("articles", [])
                    if a.get("title")
                ][:15]
        except Exception as e:
            print(f"NewsAPI fetch failed: {e}")

    if not headlines:
        # Fallback: use a generic current-date prompt without specific headlines
        today = date.today().strftime("%B %d, %Y")
        headlines = [
            f"Today is {today}. Write about the most impactful current economic or financial topic "
            "affecting everyday investors and personal finance in the United States right now. "
            "Draw on your knowledge of recent Federal Reserve decisions, market conditions, "
            "inflation trends, housing market, or any major economic news."
        ]

    return "\n".join(headlines)


# ── Step 2: Generate article via Claude ───────────────────────────────────────

SYSTEM_PROMPT = """You are a personal finance writer for Wealth Builder Tools (wealthbuildertools.com).
Your job is to write one clear, practical weekly article that connects current economic events
to personal finance decisions everyday people can act on.

Style guide:
- Conversational but credible — like a knowledgeable friend, not a textbook
- Lead with what's actually happening right now, then explain what it means for readers
- Concrete numbers and examples wherever possible
- No fluff, no padding — every paragraph should earn its place
- End with a clear, actionable bottom line
- Suitable for readers in their 20s–40s focused on building wealth

The site has these tools you can link to where relevant:
- Compound Interest Calculator: /compound-interest-calculator.html
- Cost of Waiting Calculator: /cost-of-waiting.html
- Retirement Gap Calculator: /retirement-gap.html
- Real Estate Investment Calculator: /real-estate-calculator.html
"""

ARTICLE_SCHEMA = """
Return ONLY a valid JSON object with these exact fields — no markdown, no code fences, just raw JSON:

{
  "tag": "<one of: Investing, Economy, Real Estate, Budgeting>",
  "title": "<compelling headline, under 90 chars>",
  "slug": "<url-slug-like-this>",
  "excerpt": "<2-sentence summary for the article card, under 200 chars>",
  "date": "<Month DD, YYYY>",
  "sections": [
    {
      "heading": "<h2 heading text>",
      "body": "<HTML content: <p>, <ul><li>, <strong>, <em> tags only. No h1/h2/h3 inside body.>"
    }
  ],
  "tool_promo_text": "<one sentence inviting reader to try a relevant tool>",
  "tool_promo_url": "<relative URL of the relevant tool, e.g. /compound-interest-calculator.html>"
}
"""


def generate_article(headlines: str) -> dict:
    client = anthropic.Anthropic()
    today = date.today().strftime("%B %d, %Y")

    user_prompt = f"""Today is {today}.

Here are current financial news headlines:
{headlines}

Pick the single most impactful topic for personal finance readers and write a full article about it.
Cover: what's happening, why it matters to everyday investors, and concrete actions readers can take.
Aim for 600–900 words of body content across 4–6 sections.

{ARTICLE_SCHEMA}"""

    message = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = message.content[0].text.strip()
    # Strip any accidental markdown fences
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    return json.loads(raw)


# ── Step 3: Render article HTML ───────────────────────────────────────────────

ARTICLE_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title} – Wealth Builder Tools</title>
  <meta name="description" content="{excerpt}" />

  <!-- Google AdSense -->
  <meta name="google-adsense-account" content="ca-pub-6409027472747425">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6409027472747425"
    crossorigin="anonymous"></script>

  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 16px 60px;
      color: #333;
    }}
    .card {{
      background: #fff;
      border-radius: 18px;
      padding: 48px 44px;
      max-width: 760px;
      margin: 0 auto;
      box-shadow: 0 20px 50px rgba(0,0,0,0.2);
    }}
    @media (max-width: 540px) {{ .card {{ padding: 32px 22px; }} }}
    .back-link {{
      display: block;
      max-width: 760px;
      margin: 0 auto 20px;
      color: rgba(255,255,255,0.8);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 700;
    }}
    .back-link:hover {{ color: #fff; }}
    .article-tag {{
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 99px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: #{tag_bg};
      color: #{tag_color};
      margin-bottom: 14px;
    }}
    .article-date {{ font-size: 0.8rem; color: #9ca3af; margin-bottom: 16px; font-weight: 600; }}
    h1 {{ font-size: clamp(1.5rem, 4vw, 2rem); font-weight: 800; color: #1e1b4b; line-height: 1.3; margin-bottom: 20px; }}
    .lead {{ font-size: 1.08rem; color: #4b5563; line-height: 1.8; margin-bottom: 28px; padding-bottom: 28px; border-bottom: 2px dashed #e5e7eb; }}
    h2 {{ font-size: 1.2rem; font-weight: 800; color: #1e1b4b; margin: 32px 0 12px; }}
    p {{ font-size: 0.97rem; color: #4b5563; line-height: 1.85; margin-bottom: 16px; }}
    ul {{ padding-left: 22px; margin: 12px 0 16px; }}
    li {{ font-size: 0.95rem; color: #4b5563; line-height: 1.75; margin-bottom: 8px; }}
    strong {{ color: #1e1b4b; }}
    .tool-promo {{
      background: linear-gradient(135deg, #ede9fe, #e0e7ff);
      border: 1px solid #c4b5fd;
      border-radius: 14px;
      padding: 22px 24px;
      margin-top: 36px;
      text-align: center;
    }}
    .tool-promo p {{ font-size: 0.92rem; color: #4c1d95; margin-bottom: 12px; }}
    .tool-promo a {{
      display: inline-block;
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #fff;
      font-weight: 700;
      font-size: 0.9rem;
      padding: 10px 22px;
      border-radius: 10px;
      text-decoration: none;
    }}
    .tool-promo a:hover {{ opacity: 0.9; }}
    .divider {{ border: none; border-top: 1px solid #e5e7eb; margin: 36px 0; }}
    footer {{ text-align: center; margin-top: 32px; font-size: 0.8rem; color: rgba(255,255,255,0.6); }}
    footer a {{ color: rgba(255,255,255,0.8); text-decoration: none; }}
    footer a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>

  <a class="back-link" href="{base_url}/articles.html">← Back to Articles</a>

  <div class="card">
    <div class="article-tag">{tag}</div>
    <div class="article-date">{date}</div>

    <h1>{title}</h1>

{sections_html}

    <div class="tool-promo">
      <p>{tool_promo_text}</p>
      <a href="{base_url}{tool_promo_url}">Try it now →</a>
    </div>

    <hr class="divider" />
    <p style="font-size:0.8rem;color:#9ca3af;text-align:center;">This article is for informational purposes only and does not constitute financial advice. See our <a href="{base_url}/disclaimer.html" style="color:#7c3aed;">Disclaimer</a>.</p>
  </div>

  <footer>
    <p>&copy; <span id="year"></span> Wealth Builder Tools &nbsp;|&nbsp;
    <a href="{base_url}/articles.html">Articles</a> &nbsp;|&nbsp;
    <a href="{base_url}/about.html">About</a> &nbsp;|&nbsp;
    <a href="{base_url}/contact.html">Contact</a> &nbsp;|&nbsp;
    <a href="{base_url}/privacy-policy.html">Privacy Policy</a> &nbsp;|&nbsp;
    <a href="{base_url}/disclaimer.html">Disclaimer</a></p>
  </footer>

  <script>document.getElementById('year').textContent = new Date().getFullYear();</script>
</body>
</html>
"""


def render_article_html(article: dict) -> str:
    tag = article["tag"]
    _, tag_bg, tag_color = TAG_STYLES.get(tag, ("", "ede9fe", "7c3aed"))

    sections_html_parts = []
    for i, section in enumerate(article["sections"]):
        if i == 0:
            # First section body becomes the .lead paragraph block
            sections_html_parts.append(
                f'    <div class="lead">\n      {section["body"]}\n    </div>\n'
            )
        else:
            sections_html_parts.append(
                f'    <h2>{section["heading"]}</h2>\n    {section["body"]}\n'
            )

    return ARTICLE_TEMPLATE.format(
        title=article["title"],
        excerpt=article["excerpt"],
        tag=tag,
        tag_bg=tag_bg,
        tag_color=tag_color,
        date=article["date"],
        sections_html="\n".join(sections_html_parts),
        tool_promo_text=article["tool_promo_text"],
        tool_promo_url=article["tool_promo_url"],
        base_url=BASE_URL,
    )


# ── Step 4: Update articles.html ──────────────────────────────────────────────

CARD_TEMPLATE = """\
    <a class="article-card" href="{base_url}/articles/{slug}.html">
      <span class="article-tag {tag_class}">{tag}</span>
      <div class="article-date">{date}</div>
      <div class="article-title">{title}</div>
      <div class="article-excerpt">{excerpt}</div>
      <div class="article-cta">Read article →</div>
    </a>"""


def update_articles_index(article: dict):
    index_path = os.path.join(REPO_ROOT, "articles.html")
    with open(index_path, "r") as f:
        html = f.read()

    tag_class = TAG_STYLES.get(article["tag"], ("tag-investing",))[0]
    new_card = CARD_TEMPLATE.format(
        base_url=BASE_URL,
        slug=article["slug"],
        tag_class=tag_class,
        tag=article["tag"],
        date=article["date"],
        title=article["title"],
        excerpt=article["excerpt"],
    )

    # Insert new card at the top of the grid (after opening div.articles-grid)
    html = html.replace(
        '<div class="articles-grid">',
        '<div class="articles-grid">\n' + new_card + '\n',
        1,
    )

    # Keep only the 8 most recent cards to avoid infinite growth
    card_pattern = re.compile(r'    <a class="article-card".*?</a>', re.DOTALL)
    cards = card_pattern.findall(html)
    if len(cards) > 8:
        for old_card in cards[8:]:
            html = html.replace(old_card, "", 1)

    with open(index_path, "w") as f:
        f.write(html)

    print(f"Updated articles.html with new card for: {article['title']}")


# ── Step 5: Update sitemap.xml ────────────────────────────────────────────────

def update_sitemap(slug: str):
    sitemap_path = os.path.join(REPO_ROOT, "sitemap.xml")
    with open(sitemap_path, "r") as f:
        xml = f.read()

    today = date.today().strftime("%Y-%m-%d")
    new_entry = f"""\
  <url>
    <loc>{BASE_URL}/articles/{slug}.html</loc>
    <lastmod>{today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>"""

    # Insert after the articles.html entry
    xml = xml.replace(
        "  <url>\n    <loc>https://sithvalentine.github.io/articles.html</loc>",
        new_entry + "\n  <url>\n    <loc>https://sithvalentine.github.io/articles.html</loc>",
        1,
    )

    with open(sitemap_path, "w") as f:
        f.write(xml)

    print(f"Updated sitemap.xml with: /articles/{slug}.html")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Fetching news headlines...")
    headlines = fetch_news()
    print(f"Headlines:\n{headlines}\n")

    print("Generating article via Claude...")
    article = generate_article(headlines)
    print(f"Article: {article['title']} [{article['tag']}]")

    print("Rendering HTML...")
    html = render_article_html(article)

    article_path = os.path.join(REPO_ROOT, "articles", f"{article['slug']}.html")
    with open(article_path, "w") as f:
        f.write(html)
    print(f"Written: {article_path}")

    print("Updating articles index...")
    update_articles_index(article)

    print("Updating sitemap...")
    update_sitemap(article["slug"])

    print("Done.")


if __name__ == "__main__":
    main()
