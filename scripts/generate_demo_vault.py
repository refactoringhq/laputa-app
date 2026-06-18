#!/usr/bin/env python3
"""Generate a large synthetic vault for scale and performance checks.

Creates a realistic 2-year knowledge vault (Q1 2024 - Q4 2025) for a
fictional persona based on Luca Rossi, founder of Refactoring.

The curated `demo-vault-v2/` fixture is intentionally small and lives in git.
This script generates the larger corpus on demand outside that checked-in QA
fixture.

Usage:
  python3 scripts/generate_demo_vault.py
  python3 scripts/generate_demo_vault.py --output /tmp/demo-vault-large
"""

import argparse
import random
import shutil
from datetime import date, timedelta
from pathlib import Path

random.seed(42)

DEFAULT_VAULT = Path(__file__).resolve().parent.parent / "generated-fixtures" / "demo-vault-large"
VAULT = DEFAULT_VAULT
SUBDIRS = [
    "area", "responsibility", "measure", "target", "goal", "year",
    "quarter", "month", "project", "experiment", "procedure", "task",
    "person", "topic", "event", "evergreen", "note",
]
COUNTS: dict[str, int] = {}

# ── Quarter / month mappings ─────────────────────────────────────
QUARTER_SLUGS = ["24q1", "24q2", "24q3", "24q4", "25q1", "25q2", "25q3", "25q4"]
Q_YEAR = {q: ("2024" if q.startswith("24") else "2025") for q in QUARTER_SLUGS}
Q_LABEL = {
    "24q1": "Q1 2024", "24q2": "Q2 2024", "24q3": "Q3 2024", "24q4": "Q4 2024",
    "25q1": "Q1 2025", "25q2": "Q2 2025", "25q3": "Q3 2025", "25q4": "Q4 2025",
}
Q_MONTHS = {
    "24q1": ["2024-01", "2024-02", "2024-03"], "24q2": ["2024-04", "2024-05", "2024-06"],
    "24q3": ["2024-07", "2024-08", "2024-09"], "24q4": ["2024-10", "2024-11", "2024-12"],
    "25q1": ["2025-01", "2025-02", "2025-03"], "25q2": ["2025-04", "2025-05", "2025-06"],
    "25q3": ["2025-07", "2025-08", "2025-09"], "25q4": ["2025-10", "2025-11", "2025-12"],
}
Q_START = {
    "24q1": "2024-01-01", "24q2": "2024-04-01", "24q3": "2024-07-01", "24q4": "2024-10-01",
    "25q1": "2025-01-01", "25q2": "2025-04-01", "25q3": "2025-07-01", "25q4": "2025-10-01",
}
MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
MONTH_RATINGS = ["😄", "😄", "🤩", "😄", "😐", "🤩", "😄", "😄",
                 "🤩", "😄", "😐", "😄", "🤩", "😄", "😄", "🤩",
                 "😄", "😐", "🤩", "😄", "😄", "🤩", "😄", "😄"]

# Subscriber trajectory: (start, end) per quarter
SUB_TRAJ = {
    "24q1": (35000, 38000), "24q2": (38000, 42000),
    "24q3": (42000, 47000), "24q4": (47000, 53000),
    "25q1": (53000, 59000), "25q2": (59000, 66000),
    "25q3": (66000, 75000), "25q4": (75000, 85000),
}
# Revenue trajectory: monthly EUR at quarter end
REV_TRAJ = {
    "24q1": 8000, "24q2": 10000, "24q3": 12000, "24q4": 14000,
    "25q1": 15000, "25q2": 17000, "25q3": 19000, "25q4": 22000,
}

# ── Helpers ──────────────────────────────────────────────────────
_UNQUOTED = {
    "Open", "Done", "Draft", "Published", "Abandoned", "Behind",
    "Year", "Quarter", "Month", "Area", "Responsibility", "Measure",
    "Target", "Goal", "Project", "Experiment", "Procedure", "Task",
    "Person", "Topic", "Event", "Evergreen", "Note",
    "Weekly", "Bi-weekly", "Monthly", "Quarterly", "Daily",
}


def wl(slug: str) -> str:
    return f"[[{slug}]]"


def fm(fields: dict) -> str:
    lines = ["---"]
    for k, v in fields.items():
        if isinstance(v, list):
            inner = ", ".join(f'"{i}"' for i in v)
            lines.append(f"{k}: [{inner}]")
        elif isinstance(v, (int, float)):
            lines.append(f"{k}: {v}")
        elif isinstance(v, str) and v in _UNQUOTED:
            lines.append(f"{k}: {v}")
        else:
            lines.append(f'{k}: "{v}"')
    lines.append("---")
    return "\n".join(lines)


def write_md(subdir: str, slug: str, fields: dict, body: str):
    path = VAULT / subdir / f"{slug}.md"
    path.write_text(fm(fields) + "\n" + body.rstrip() + "\n", encoding="utf-8")
    COUNTS[subdir] = COUNTS.get(subdir, 0) + 1


def month_slug_to_q(ms: str) -> str:
    y, m = ms.split("-")
    qi = (int(m) - 1) // 3 + 1
    return f"{y[2:]}{'' if y == '2024' else ''}q{qi}" if y == "2024" else f"{y[2:]}q{qi}"


# ── AREAS ────────────────────────────────────────────────────────
# (slug, name, responsibility_slugs)
AREAS = [
    ("area-building", "Building", [
        "responsibility-grow-newsletter", "responsibility-sponsorships",
        "responsibility-content-production", "responsibility-podcast",
        "responsibility-team-management"]),
    ("area-health", "Health", ["responsibility-health-fitness"]),
    ("area-personal", "Personal", []),
    ("area-learning", "Learning", ["responsibility-learning"]),
    ("area-finance", "Finance", ["responsibility-personal-finance"]),
]

# ── RESPONSIBILITIES ─────────────────────────────────────────────
# (slug, name, area, measures, procedures, body)
RESPONSIBILITIES = [
    ("responsibility-grow-newsletter", "Grow Newsletter", "area-building",
     ["measure-subscribers", "measure-open-rate"],
     ["procedure-monthly-subscriber-metrics", "procedure-referral-program",
      "procedure-welcome-email-sequence", "procedure-seo-content-optimization"],
     "Growing the Refactoring newsletter subscriber base through organic content, SEO, referrals, and strategic partnerships.\n\n## KPIs\n- Subscribers: target 100k by end 2025\n- Open rate: maintain >45%"),
    ("responsibility-sponsorships", "Sponsorships", "area-building",
     ["measure-sponsorship-mrr", "measure-close-rate"],
     ["procedure-monthly-sponsor-report", "procedure-quarterly-sponsor-outreach",
      "procedure-sponsor-onboarding", "procedure-invoice-processing", "procedure-sponsor-renewal"],
     "Selling and managing sponsorships for Refactoring. Building long-term relationships with B2B tech companies.\n\n## KPIs\n- MRR: grow from €8k to €22k\n- Close rate: maintain >30%"),
    ("responsibility-content-production", "Content Production", "area-building",
     ["measure-articles-per-week", "measure-essay-quality-score"],
     ["procedure-weekly-newsletter", "procedure-monthly-pillar-planning",
      "procedure-social-media-scheduling", "procedure-newsletter-ab-testing",
      "procedure-content-calendar-review", "procedure-editorial-review",
      "procedure-evergreen-content-audit", "procedure-newsletter-metrics-weekly"],
     "Publishing weekly essays and newsletter editions. Maintaining high editorial quality while shipping consistently.\n\n## KPIs\n- Articles per week: 1 newsletter + 1 essay minimum\n- Quality score: reader feedback >4.5/5"),
    ("responsibility-podcast", "Podcast", "area-building",
     ["measure-podcast-downloads", "measure-podcast-episodes-per-month"],
     ["procedure-podcast-recording", "procedure-podcast-guest-outreach",
      "procedure-podcast-editing", "procedure-podcast-show-notes", "procedure-podcast-analytics"],
     "Running the Refactoring podcast — bi-weekly episodes with tech leaders on engineering culture, leadership, and building.\n\n## KPIs\n- Downloads per episode: target 5k+\n- Episodes per month: 2"),
    ("responsibility-team-management", "Team Management", "area-building",
     ["measure-team-nps", "measure-task-completion-rate"],
     ["procedure-weekly-team-sync", "procedure-biweekly-1on1-matteo",
      "procedure-biweekly-1on1-paco", "procedure-biweekly-1on1-sara",
      "procedure-quarterly-team-retro"],
     "Managing Matteo (partnerships), Paco (operations), and Sara (editor). Building a small but high-performing team.\n\n## KPIs\n- Team NPS: >8\n- Task completion rate: >85%"),
    ("responsibility-health-fitness", "Health & Fitness", "area-health",
     ["measure-resting-hr", "measure-cycling-km-per-month"],
     ["procedure-weekly-cycling-block", "procedure-gym-routine",
      "procedure-monthly-health-review", "procedure-race-preparation"],
     "Staying fit through cycling, gym, and good nutrition. Training for gran fondos and maintaining energy for work.\n\n## KPIs\n- Resting HR: <55 bpm\n- Cycling: 300+ km/month in season"),
    ("responsibility-personal-finance", "Personal Finance", "area-finance",
     ["measure-net-worth", "measure-savings-rate"],
     ["procedure-monthly-portfolio-review", "procedure-quarterly-financial-planning"],
     "Managing investments, savings, and financial planning. Building long-term wealth through index funds and diversification.\n\n## KPIs\n- Savings rate: >30% of income\n- Net worth: track monthly"),
    ("responsibility-learning", "Learning", "area-learning",
     ["measure-books-per-month", "measure-evergreen-notes-created"],
     ["procedure-weekly-reading-session", "procedure-evergreen-note-writing"],
     "Reading widely, studying deeply, and creating evergreen notes. Focused on non-fiction: business, technology, science, and self-improvement.\n\n## KPIs\n- Books per month: 2+\n- Evergreen notes: 3+ per month"),
]

# ── MEASURES ─────────────────────────────────────────────────────
# (slug, name, responsibility, unit)
MEASURES = [
    ("measure-subscribers", "Newsletter Subscribers", "responsibility-grow-newsletter", "subscribers"),
    ("measure-open-rate", "Newsletter Open Rate", "responsibility-grow-newsletter", "percent"),
    ("measure-sponsorship-mrr", "Sponsorship MRR", "responsibility-sponsorships", "EUR/month"),
    ("measure-close-rate", "Sponsorship Close Rate", "responsibility-sponsorships", "percent"),
    ("measure-articles-per-week", "Articles Per Week", "responsibility-content-production", "articles"),
    ("measure-essay-quality-score", "Essay Quality Score", "responsibility-content-production", "score (1-5)"),
    ("measure-podcast-downloads", "Podcast Downloads", "responsibility-podcast", "downloads/episode"),
    ("measure-podcast-episodes-per-month", "Podcast Episodes Per Month", "responsibility-podcast", "episodes"),
    ("measure-team-nps", "Team NPS", "responsibility-team-management", "score (1-10)"),
    ("measure-task-completion-rate", "Task Completion Rate", "responsibility-team-management", "percent"),
    ("measure-resting-hr", "Resting Heart Rate", "responsibility-health-fitness", "bpm"),
    ("measure-cycling-km-per-month", "Cycling Km Per Month", "responsibility-health-fitness", "km"),
    ("measure-net-worth", "Net Worth", "responsibility-personal-finance", "EUR"),
    ("measure-savings-rate", "Savings Rate", "responsibility-personal-finance", "percent"),
    ("measure-books-per-month", "Books Per Month", "responsibility-learning", "books"),
    ("measure-evergreen-notes-created", "Evergreen Notes Created", "responsibility-learning", "notes/month"),
]

# ── TOPICS ───────────────────────────────────────────────────────
# (slug, name, description)
TOPICS = [
    ("topic-ai-ml", "AI & Machine Learning", "Notes and ideas about AI, LLMs, and machine learning applications in content and business."),
    ("topic-newsletter-growth", "Newsletter Growth", "Strategies, experiments, and learnings about growing an email newsletter audience."),
    ("topic-content-strategy", "Content Strategy", "How to plan, create, and distribute content that resonates with a technical audience."),
    ("topic-cycling-training", "Cycling Training", "Training plans, nutrition, gear, and race preparation for road cycling."),
    ("topic-personal-finance", "Personal Finance & Investing", "Index funds, portfolio allocation, savings strategies, and financial independence."),
    ("topic-b2b-marketing", "B2B Marketing", "Marketing strategies for reaching developers, engineering leaders, and technical decision-makers."),
    ("topic-developer-tools", "Developer Tools", "The landscape of developer tools, devex, and the business of selling to engineers."),
    ("topic-productivity-systems", "Productivity Systems", "Personal knowledge management, task systems, note-taking, and deep work practices."),
    ("topic-writing", "Writing", "The craft of writing clearly, consistently, and for a technical audience."),
    ("topic-podcasting", "Podcasting", "Production, guest selection, promotion, and monetization of a tech podcast."),
    ("topic-team-leadership", "Team Leadership", "Managing small teams, async work, 1:1s, feedback, and building culture remotely."),
    ("topic-mental-health", "Mental Health", "Stress management, work-life balance, and psychological wellbeing as a founder."),
    ("topic-nutrition", "Nutrition", "Eating well as an endurance athlete and knowledge worker. Meal prep, macros, and habits."),
    ("topic-italian-startups", "Italian Startup Ecosystem", "The state of tech startups in Italy — funding, talent, culture, and opportunities."),
    ("topic-open-source", "Open Source", "Contributing to and building on open-source software. Community, licensing, and sustainability."),
    ("topic-data-engineering", "Data Engineering", "Data pipelines, analytics infrastructure, and the modern data stack."),
    ("topic-product-management", "Product Management", "Product thinking, prioritization frameworks, and building what users need."),
    ("topic-saas-business", "SaaS Business Models", "Recurring revenue, churn, pricing, and the economics of software businesses."),
    ("topic-public-speaking", "Public Speaking", "Preparing talks, managing nerves, and communicating ideas on stage."),
    ("topic-music-guitar", "Music & Guitar", "Playing guitar, learning music theory, and the joy of making music."),
    ("topic-reading-books", "Reading & Books", "Book recommendations, reading strategies, and how to retain what you read."),
    ("topic-cooking", "Cooking", "Italian cooking, meal prep, and experimenting in the kitchen."),
    ("topic-travel", "Travel", "Trips, conferences abroad, and exploring new cities."),
    ("topic-running", "Running", "Casual running, trail running, and cross-training for cycling."),
    ("topic-sleep-recovery", "Sleep & Recovery", "Sleep hygiene, recovery protocols, and the science of rest."),
]

# ── PERSONS ──────────────────────────────────────────────────────
# (slug, name, tier, tags, bio)
PERSONS = [
    # Self
    ("person-luca-rossi", "Luca Rossi", "1st 🥇", ["Self"],
     "Founder of Refactoring, a B2B tech newsletter and podcast. Based in Milan. Cyclist, guitarist, reader."),
    # Team
    ("person-matteo-cellini", "Matteo Cellini", "1st 🥇", ["Team"],
     "Head of Partnerships at Refactoring. Joined in 2022. Manages sponsor relationships and revenue growth."),
    ("person-paco-furiani", "Paco Furiani", "1st 🥇", ["Team"],
     "Head of Operations at Refactoring. Keeps everything running — billing, tools, workflows, and logistics."),
    ("person-sara-ricci", "Sara Ricci", "1st 🥇", ["Team"],
     "Editor at Refactoring. Hired in Q2 2024. Sharp eye for structure and clarity in technical writing."),
    ("person-marco-bianchi", "Marco Bianchi", "2nd 🥈", ["Team"],
     "Freelance developer. Helps with the Refactoring website, landing pages, and tooling."),
    # Partner
    ("person-giulia-marchetti", "Giulia Marchetti", "1st 🥇", ["Personal"],
     "Luca's girlfriend. Met in early 2024. Works as a UX researcher at a Milan fintech. Loves hiking and contemporary art."),
    # Family
    ("person-elena-rossi", "Elena Rossi", "1st 🥇", ["Family"],
     "Luca's sister. Lives in Rome. Works in publishing. They talk every week."),
    ("person-roberto-rossi", "Roberto Rossi", "1st 🥇", ["Family"],
     "Luca's father. Retired engineer. Lives near Lake Como. Passionate about woodworking."),
    ("person-maria-colombo", "Maria Colombo", "1st 🥇", ["Family"],
     "Luca's mother. Retired teacher. Lives near Lake Como. Amazing cook — Luca's pasta recipes come from her."),
    ("person-antonio-marchetti", "Antonio Marchetti", "2nd 🥈", ["Family"],
     "Giulia's brother. Architect based in Turin. They see each other at family gatherings."),
    ("person-nonna-lucia", "Nonna Lucia", "1st 🥇", ["Family"],
     "Luca's grandmother. 87 years old, lives in Lecco. Luca visits her monthly. Best risotto in Lombardy."),
    # Friends
    ("person-davide-conti", "Davide Conti", "2nd 🥈", ["Friend"],
     "College friend, software engineer at a Milan startup. They grab dinner regularly and talk tech."),
    ("person-alessandro-ferrari", "Alessandro Ferrari", "2nd 🥈", ["Friend"],
     "Cycling buddy. They ride together on weekends and do gran fondos together."),
    ("person-chiara-romano", "Chiara Romano", "2nd 🥈", ["Friend"],
     "UX designer at a design agency. Met through the Milan tech scene. Great conversations about product."),
    ("person-federico-moretti", "Federico Moretti", "2nd 🥈", ["Friend"],
     "Startup founder, runs a small devtools company. They swap founder war stories over aperitivo."),
    ("person-valentina-rizzo", "Valentina Rizzo", "2nd 🥈", ["Friend"],
     "Journalist covering Italian tech. Occasionally writes about Refactoring. Good source for ecosystem news."),
    ("person-andrea-colombo", "Andrea Colombo", "2nd 🥈", ["Friend"],
     "Works in finance. Luca's go-to person for investment discussions and portfolio sanity checks."),
    ("person-silvia-mancini", "Silvia Mancini", "3rd 🥉", ["Friend"],
     "Doctor, friend from university. They catch up every few months. Good grounding influence."),
    ("person-tommaso-greco", "Tommaso Greco", "2nd 🥈", ["Friend"],
     "Musician and music teacher. They jam together occasionally — Luca on guitar, Tommaso on keys."),
    ("person-elisa-barbieri", "Elisa Barbieri", "3rd 🥉", ["Friend"],
     "High school teacher, old friend. They meet at group dinners in Milan."),
    ("person-gianluca-esposito", "Gianluca Esposito", "2nd 🥈", ["Friend"],
     "Chef, runs a small restaurant in Navigli. Luca's favourite place for a weeknight dinner."),
    ("person-francesca-marino", "Francesca Marino", "3rd 🥉", ["Friend"],
     "Photographer. Took the photos for the Refactoring website and brand."),
    ("person-lorenzo-galli", "Lorenzo Galli", "3rd 🥉", ["Friend"],
     "Lawyer, handles Refactoring's contracts. Efficient and straightforward."),
    ("person-marta-pellegrini", "Marta Pellegrini", "3rd 🥉", ["Friend"],
     "Friend from the gym. Personal trainer by profession. Helped Luca design his strength program."),
    ("person-nicola-fabbri", "Nicola Fabbri", "3rd 🥉", ["Friend"],
     "Neighbor, retired university professor (philosophy). Great conversations on the terrace."),
    ("person-giulia-conti", "Giulia Conti", "3rd 🥉", ["Friend"],
     "Giulia Marchetti's best friend. They often hang out as a group on weekends."),
    ("person-stefano-villa", "Stefano Villa", "3rd 🥉", ["Friend"],
     "Old colleague from Luca's pre-Refactoring days. Now a VP Eng at a Milan scale-up."),
    ("person-anna-fontana", "Anna Fontana", "3rd 🥉", ["Friend"],
     "Runs a yoga studio near Luca's apartment. Giulia introduced them."),
    ("person-mattia-de-luca", "Mattia De Luca", "3rd 🥉", ["Friend"],
     "Davide's roommate. Data engineer. They sometimes all go out together."),
    # Podcast guests (30)
    ("person-marcus-weber", "Marcus Weber", "3rd 🥉", ["Podcast Guest"],
     "Software architect, author of 'Scaling Teams'. Episode on engineering culture."),
    ("person-elena-konstantinou", "Elena Konstantinou", "3rd 🥉", ["Podcast Guest"],
     "VP Engineering at a European fintech unicorn. Episode on scaling engineering orgs."),
    ("person-raj-patel", "Raj Patel", "3rd 🥉", ["Podcast Guest"],
     "Founder of DevToolsCo. Episode on building developer tools."),
    ("person-anna-lindberg", "Anna Lindberg", "3rd 🥉", ["Podcast Guest"],
     "Product lead at a Nordic fintech. Episode on product-led growth."),
    ("person-yusuf-osman", "Yusuf Osman", "3rd 🥉", ["Podcast Guest"],
     "Staff engineer, distributed systems. Episode on system design at scale."),
    ("person-clara-dupont", "Clara Dupont", "3rd 🥉", ["Podcast Guest"],
     "CTO of a French SaaS startup. Episode on technical leadership."),
    ("person-hiroshi-tanaka", "Hiroshi Tanaka", "3rd 🥉", ["Podcast Guest"],
     "Principal engineer, observability. Episode on debugging production systems."),
    ("person-priya-sharma", "Priya Sharma", "3rd 🥉", ["Podcast Guest"],
     "Engineering manager, growth team. Episode on experimentation culture."),
    ("person-diego-santos", "Diego Santos", "3rd 🥉", ["Podcast Guest"],
     "Founder of a LatAm developer platform. Episode on global dev communities."),
    ("person-katja-mueller", "Katja Mueller", "3rd 🥉", ["Podcast Guest"],
     "VP Engineering, German enterprise. Episode on legacy modernization."),
    ("person-paolo-bergamo", "Paolo Bergamo", "3rd 🥉", ["Podcast Guest"],
     "CTO of an Italian edtech. Episode on building tech in Italy."),
    ("person-marco-cecconi", "Marco Cecconi", "3rd 🥉", ["Podcast Guest"],
     "Engineering director, gaming. Episode on high-performance engineering teams."),
    ("person-francesca-deluca", "Francesca De Luca", "3rd 🥉", ["Podcast Guest"],
     "Product lead, fintech Milan. Episode on product management in regulated industries."),
    ("person-massimo-artusi", "Massimo Artusi", "3rd 🥉", ["Podcast Guest"],
     "Open source community leader. Episode on sustainability in OSS."),
    ("person-simone-bianchi", "Simone Bianchi", "3rd 🥉", ["Podcast Guest"],
     "Platform architect. Episode on internal developer platforms."),
    ("person-nina-petersen", "Nina Petersen", "3rd 🥉", ["Podcast Guest"],
     "AI researcher, Copenhagen. Episode on practical AI in production."),
    ("person-tom-richardson", "Tom Richardson", "3rd 🥉", ["Podcast Guest"],
     "CEO of a developer tools startup. Episode on founder-led sales."),
    ("person-natalie-chang", "Natalie Chang", "3rd 🥉", ["Podcast Guest"],
     "Investor, deep tech. Episode on what VCs look for in B2B SaaS."),
    ("person-sarah-oconnor", "Sarah O'Connor", "3rd 🥉", ["Podcast Guest"],
     "Engineering director. Episode on engineering career ladders."),
    ("person-adeel-khan", "Adeel Khan", "3rd 🥉", ["Podcast Guest"],
     "Staff engineer, ML platform. Episode on ML infrastructure."),
    ("person-alberto-ferro", "Alberto Ferro", "3rd 🥉", ["Podcast Guest"],
     "Author on software craftsmanship. Episode on code quality and testing."),
    ("person-matteo-gentile", "Matteo Gentile", "3rd 🥉", ["Podcast Guest"],
     "Node.js contributor. Episode on open-source contributions."),
    ("person-piergiorgio-conte", "Piergiorgio Conte", "3rd 🥉", ["Podcast Guest"],
     "CTO, Italian enterprise software. Episode on digital transformation."),
    ("person-lucia-martinez", "Lucia Martinez", "3rd 🥉", ["Podcast Guest"],
     "Tech journalist, Madrid. Episode on covering the European tech scene."),
    ("person-james-murphy", "James Murphy", "3rd 🥉", ["Podcast Guest"],
     "Founder, bootstrapped SaaS. Episode on bootstrapping vs. VC funding."),
    ("person-david-eriksson", "David Eriksson", "3rd 🥉", ["Podcast Guest"],
     "CTO, Stockholm startup. Episode on remote-first engineering."),
    ("person-patrick-nguyen", "Patrick Nguyen", "3rd 🥉", ["Podcast Guest"],
     "CEO, API platform. Episode on API-first business models."),
    ("person-emilia-hoffmann", "Emilia Hoffmann", "3rd 🥉", ["Podcast Guest"],
     "AI startup founder, Berlin. Episode on AI product-market fit."),
    ("person-benedetta-vitali", "Benedetta Vitali", "3rd 🥉", ["Podcast Guest"],
     "Startup founder, Italy. Episode on building a startup in southern Europe."),
    ("person-andrea-provaglio", "Andrea Provaglio", "3rd 🥉", ["Podcast Guest"],
     "Agile coach and author. Episode on agile beyond the buzzwords."),
    # Sponsors / partner contacts (15)
    ("person-james-mitchell", "James Mitchell", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Linear. Runs their developer marketing."),
    ("person-anna-kowalski", "Anna Kowalski", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Vercel. Manages newsletter sponsorship programs."),
    ("person-thomas-mueller", "Thomas Mueller", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Datadog. Focused on developer audience reach."),
    ("person-lisa-chen", "Lisa Chen", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Notion. Runs B2B content partnerships."),
    ("person-michael-brown", "Michael Brown", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at GitHub. Developer relations and sponsorships."),
    ("person-sophie-laurent", "Sophie Laurent", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Figma. Design and developer marketing."),
    ("person-kenji-tanaka", "Kenji Tanaka", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Supabase. Growth and partnerships."),
    ("person-rachel-green", "Rachel Green", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Retool. Developer content sponsorships."),
    ("person-carlos-mendez", "Carlos Mendez", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at PlanetScale. Database and developer marketing."),
    ("person-emma-wilson", "Emma Wilson", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Clerk. Auth and identity marketing."),
    ("person-peter-schmidt", "Peter Schmidt", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Raycast. Productivity tools marketing."),
    ("person-yuki-sato", "Yuki Sato", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Fly.io. Infrastructure marketing."),
    ("person-olivia-martinez", "Olivia Martinez", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Lemon Squeezy. Creator economy partnerships."),
    ("person-henrik-johansson", "Henrik Johansson", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at PostHog. Product analytics and developer marketing."),
    ("person-david-kim", "David Kim", "3rd 🥉", ["Sponsor"],
     "Sponsor contact at Railway. Cloud platform partnerships."),
]

TEAM_SLUGS = ["person-matteo-cellini", "person-paco-furiani", "person-sara-ricci"]
SPONSOR_PERSONS = [p[0] for p in PERSONS if "Sponsor" in p[3]]
PODCAST_GUESTS = [p[0] for p in PERSONS if "Podcast Guest" in p[3]]
FRIEND_SLUGS = [p[0] for p in PERSONS if "Friend" in p[3]]
FAMILY_SLUGS = [p[0] for p in PERSONS if "Family" in p[3]]
PERSONAL_CONTACTS = FRIEND_SLUGS + FAMILY_SLUGS + ["person-giulia-marchetti"]

PERSONAL_CONTACTS = FRIEND_SLUGS + FAMILY_SLUGS + ["person-giulia-marchetti"]

# ── PROJECTS ─────────────────────────────────────────────────────
# (slug, title, quarter, responsibility, status, body)
PROJECTS = [
    ("24q1-launch-sponsorship-packages","Launch Sponsorship Packages","24q1","responsibility-sponsorships","Done","Define and launch the first structured sponsorship tiers. Create media kit and pricing deck."),
    ("24q1-redesign-newsletter-template","Redesign Newsletter Template","24q1","responsibility-content-production","Done","Redesign the Refactoring email layout for better readability and visual hierarchy."),
    ("24q1-plan-cycling-season","Plan 2024 Cycling Season","24q1","responsibility-health-fitness","Done","Plan races, training blocks, and equipment upgrades for the 2024 cycling season."),
    ("24q1-set-investing-framework","Set Up Investing Framework","24q1","responsibility-personal-finance","Done","Define a personal investment policy statement and set up automated monthly contributions to index funds."),
    ("24q1-podcast-season-1","Podcast Season 1 Launch","24q1","responsibility-podcast","Done","Launch the Refactoring podcast with 6 episodes recorded in advance. Focus: engineering culture."),
    ("24q2-hire-editor","Hire Editor (Sara)","24q2","responsibility-team-management","Done","Hire a part-time editor to raise newsletter quality and free up writing time."),
    ("24q2-build-podcast-landing-page","Build Podcast Landing Page","24q2","responsibility-podcast","Done","Create a dedicated landing page for the Refactoring podcast with episode archive and subscribe CTA."),
    ("24q2-10-pillar-articles","Write 10 Pillar Articles","24q2","responsibility-content-production","Done","Write 10 in-depth articles targeting high-traffic SEO terms in the developer/engineering space."),
    ("24q2-spring-gran-fondo","Spring Gran Fondo 2024","24q2","responsibility-health-fitness","Done","Train for and complete the Granfondo di Varese — 130km route, 2200m elevation."),
    ("24q2-sponsor-crm","Set Up Sponsor CRM","24q2","responsibility-sponsorships","Done","Build an Airtable CRM to track sponsor outreach, deal status, invoices, and renewal dates."),
    ("24q3-premium-tier","Launch Premium Newsletter Tier","24q3","responsibility-grow-newsletter","Abandoned","Experiment with a paid tier. Abandoned after 6 weeks due to low conversion."),
    ("24q3-codemotion-talk","Speak at Codemotion Milan","24q3","responsibility-content-production","Done","Prepare and deliver a 30-min talk on newsletter growth for technical founders."),
    ("24q3-summer-reading-sprint","Summer Reading Sprint","24q3","responsibility-learning","Done","Read 6 books in July-August. Topics: history, business, and philosophy of science."),
    ("24q3-podcast-season-2","Podcast Season 2","24q3","responsibility-podcast","Done","Record and release 8 episodes focused on engineering leadership and org design."),
    ("24q3-new-sponsor-verticals","Expand Sponsor Verticals","24q3","responsibility-sponsorships","Done","Target cloud infra, devtools, and AI/ML companies as new sponsor categories."),
    ("24q4-annual-review-process","Team Annual Review","24q4","responsibility-team-management","Done","Design and run the first structured annual review for Matteo, Paco, and Sara."),
    ("24q4-sponsor-dashboard","Build Sponsor Dashboard","24q4","responsibility-sponsorships","Done","Build an Airtable dashboard giving sponsors real-time click and performance data."),
    ("24q4-laputa-start","Start Laputa App Project","24q4","responsibility-learning","Done","Begin building Laputa — a custom Tauri desktop app for managing the personal knowledge vault."),
    ("24q4-black-friday-campaign","Black Friday Newsletter Campaign","24q4","responsibility-grow-newsletter","Done","Run a curated Black Friday campaign with tool recommendations. +1200 subscribers in 3 days."),
    ("24q4-cycling-year-review","Cycling Year in Review 2024","24q4","responsibility-health-fitness","Done","Review the 2024 cycling season and plan 2025: races, training peaks, and gear."),
    ("25q1-laputa-v1","Laputa App V1","25q1","responsibility-learning","Done","Ship the first working version of Laputa with 4-panel layout, inspector, and quick open."),
    ("25q1-newsletter-seo-sprint","Newsletter SEO Sprint","25q1","responsibility-grow-newsletter","Done","30-day SEO sprint: 5 high-traffic articles + internal linking overhaul."),
    ("25q1-strength-program","New Strength Program","25q1","responsibility-health-fitness","Done","Start a 12-week strength program to complement cycling and prevent injury."),
    ("25q1-rate-increase","Increase Sponsorship Rates Q2","25q1","responsibility-sponsorships","Done","Raise ad rates by 25% for Q2 based on audience growth and click-through data."),
    ("25q1-referral-program","Newsletter Referral Program","25q1","responsibility-grow-newsletter","Done","Launch a referral program rewarding subscribers who bring in new readers."),
    ("25q2-reach-70k","Reach 70k Subscribers","25q2","responsibility-grow-newsletter","Done","Growth sprint to 70k: referral push + partnership with 3 complementary newsletters."),
    ("25q2-podcast-season-3","Podcast Season 3","25q2","responsibility-podcast","Done","10 episodes on building in public, founder journeys, and product-led growth."),
    ("25q2-team-retreat","Team Retreat Milan","25q2","responsibility-team-management","Done","First in-person team retreat: 2 days of strategy, workshops, and dinner."),
    ("25q2-laputa-v2","Laputa App V2","25q2","responsibility-learning","Done","V2 with BlockNote editor, wiki-links autocomplete, and redesigned theme system."),
    ("25q2-dolomites-trip","Cycling Trip: Dolomites","25q2","responsibility-health-fitness","Done","5-day cycling trip with Alessandro. Stelvio + Mortirolo. 650km total."),
    ("25q3-ebook","Write Newsletter Growth E-book","25q3","responsibility-content-production","Done","15,000-word e-book on newsletter growth for technical founders. Free lead magnet."),
    ("25q3-community-launch","Launch Refactoring Community","25q3","responsibility-grow-newsletter","Open","Private Discord for premium subscribers. Still in soft launch."),
    ("25q3-podcast-season-4","Podcast Season 4","25q3","responsibility-podcast","Open","Theme: AI and the changing face of software engineering. 8 episodes planned."),
    ("25q3-leaddev-london","LeadDev London 2025","25q3","responsibility-content-production","Done","Attend LeadDev London: meet guests, write post-conference piece, speak on a panel."),
    ("25q3-peak-training","Summer Cycling Peak Training","25q3","responsibility-health-fitness","Done","Peak training block for September gran fondo. Hit 420km in August."),
    ("25q4-year-review-2025","2025 Annual Review","25q4","responsibility-team-management","Open","Full 2025 retrospective for team and personal year review."),
    ("25q4-reach-85k","Reach 85k Subscribers","25q4","responsibility-grow-newsletter","Open","Year-end push through partnerships and referral program expansion."),
    ("25q4-2026-sponsors","2026 Sponsorship Pipeline","25q4","responsibility-sponsorships","Open","Pre-sell Q1-Q2 2026 sponsorships. Target: 80% sold before Dec 31."),
    ("25q4-laputa-v3","Laputa App V3","25q4","responsibility-learning","Open","V3: mobile sync, AI note linking, and quick capture from menu bar."),
    ("25q4-financial-review","2025 Financial Review","25q4","responsibility-personal-finance","Open","Annual review: savings rate, portfolio performance, 2026 targets."),
]

# ── EXPERIMENTS ───────────────────────────────────────────────────
EXPERIMENTS = [
    ("24q2-video-format-test","Video Format Experiment","24q2","Abandoned","Tried a short-form video series explaining technical concepts. Dropped after 3 videos — too time-intensive for the return."),
    ("24q2-stock-screener","Vibe-coding a Stock Screener","24q2","Done","Built a stock screener in Python over a weekend to test EMA bounce strategies on US equities."),
    ("24q3-morning-journaling","Morning Journaling Habit","24q3","Done","Tried daily morning journaling for 8 weeks. Mixed results — useful in stressful periods, harder to maintain when calm."),
    ("24q4-linkedin-crossposting","LinkedIn Cross-posting Experiment","24q4","Done","Repurposed newsletter essays on LinkedIn for 6 weeks. +800 followers, modest referral traffic."),
    ("25q1-paid-newsletter-trial","Paid Newsletter Trial","25q1","Abandoned","Tested a Substack-style paid tier. Conversion too low to justify the overhead."),
    ("25q3-discord-community-soft","Discord Community Soft Launch","25q3","Open","Soft-launched the Refactoring community with 50 beta subscribers. Still iterating on engagement."),
]

# ── GOALS ─────────────────────────────────────────────────────────
GOALS = [
    ("2024-reach-50k-subscribers","Reach 50k Subscribers","2024","Done","End 2024 with 50,000+ newsletter subscribers. Achieved 53,000 by December."),
    ("2024-double-revenue","Double Sponsorship Revenue","2024","Done","Grow MRR from €7k to €14k+ through better packages and more sponsors."),
    ("2024-complete-two-gran-fondos","Complete Two Gran Fondos","2024","Done","Finish at least two gran fondos in the 2024 cycling season."),
    ("2024-read-24-books","Read 24 Books in 2024","2024","Behind","Target: 2 books/month. Actual: 18. Good effort, missed the target."),
    ("2024-launch-podcast","Launch Refactoring Podcast","2024","Done","Launch and sustain the podcast through at least 2 seasons."),
    ("2025-reach-85k-subscribers","Reach 85k Subscribers","2025","Open","End 2025 with 85,000+ subscribers. On track at 75k in Q3."),
    ("2025-reach-22k-mrr","Reach €22k MRR","2025","Open","Grow sponsorship revenue to €22k/month by end of year."),
    ("2025-ship-laputa","Ship Laputa App","2025","Done","Build and use Laputa v1 as my daily knowledge management tool."),
    ("2025-ride-stelvio","Ride the Stelvio Pass","2025","Done","Complete a full ascent of the Stelvio — bucket list cycling goal."),
    ("2025-read-20-books","Read 20 Books in 2025","2025","Open","Target: 20 books. At 14 in Q3. Achievable."),
]

# ── EVERGREEN TOPICS AND BODIES ───────────────────────────────────
EVERGREENS = [
    ("the-compound-effect-in-knowledge-work","The Compound Effect in Knowledge Work",["topic-productivity-systems","topic-writing"],
     "Small, consistent intellectual investments compound dramatically over time. A newsletter writer who publishes 50 essays a year builds an insurmountable lead over one who publishes 10 — not just in volume, but in clarity of thought, audience trust, and SEO authority.\n\nThe key insight is that the compounding happens in the *system*, not in any single piece. Each essay trains your thinking, attracts new readers, and creates internal links for future pieces. After 200 essays, you're not writing 200 times better — but you are writing with the advantage of 200 previous attempts behind you.\n\nThis is why consistency beats intensity. A newsletter sent every Monday for 3 years is more valuable than 50 brilliant newsletters sent sporadically."),
    ("newsletter-growth-is-about-trust","Newsletter Growth Is About Trust",["topic-newsletter-growth","topic-content-strategy"],
     "The metric that actually predicts newsletter growth isn't subscriber count, open rate, or even click rate — it's whether readers feel like the author is genuinely on their side.\n\nTrust compounds. A reader who opens 40 consecutive newsletters before clicking anything is still more valuable than a subscriber who clicks on issue #1 and unsubscribes on issue #3. Long-term readers become advocates, paying customers, and referral sources.\n\nThe implication: optimize for retention before acquisition. A 60% open rate with 1,000 subscribers will grow faster than a 20% open rate with 5,000."),
    ("small-teams-scale-through-systems","Small Teams Scale Through Systems, Not Headcount",["topic-team-leadership","topic-saas-business"],
     "The instinct when workload grows is to hire. But hiring is slow, expensive, and introduces coordination overhead. The better first move is almost always to systematize.\n\nA team of 3 with good systems — documented processes, clear ownership, async-first communication — can often outperform a team of 10 without them. The difference is decision latency and context overhead.\n\nThis is especially true in content businesses, where the core work is creative and can't easily be parallelized. Better to double the quality of what 3 people produce than to dilute quality by hiring 3 more."),
    ("training-load-and-knowledge-work","Training Load and Knowledge Work",["topic-cycling-training","topic-productivity-systems"],
     "Endurance athletes understand that adaptation happens during recovery, not during training. You get stronger by stressing the system, then allowing it to rebuild stronger. Skip recovery and you get injured or overtrained.\n\nKnowledge work follows the same principle. Deep focus creates cognitive load — stress on your attention system. Without recovery (sleep, walks, boredom), you don't consolidate learning, and creativity degrades.\n\nThe best writers, programmers, and thinkers I know are obsessive about protecting recovery. Not because they're lazy, but because they understand the adaptation model."),
    ("b2b-content-is-trust-not-traffic","B2B Content Is About Trust, Not Traffic",["topic-b2b-marketing","topic-content-strategy"],
     "The classic content marketing mistake in B2B is optimizing for pageviews. But in B2B software, the buying cycle is long, the decision-makers are sophisticated, and the research is deep.\n\nWhat actually moves enterprise deals is trust built over months or years of consistent, genuinely useful content. A VP Engineering who has read your newsletter for 18 months before their budget cycle starts is a fundamentally different prospect than one who found you via Google last week.\n\nThis is why the ROI of B2B content is almost always underestimated when measured on short time horizons."),
    ("index-funds-and-intellectual-humility","Index Funds as an Act of Intellectual Humility",["topic-personal-finance"],
     "Choosing index funds over stock picking isn't financial laziness — it's a philosophical position about knowledge and markets.\n\nThe efficient market hypothesis, imperfect as it is, says that publicly available information is already priced in. When I buy a stock because I think it's undervalued, I'm saying I know something the combined intelligence of millions of market participants, with full access to company data and professional analysis tools, has missed.\n\nIndex funds are the humble answer: I don't know which stocks will outperform, so I'll own all of them. The humility is the strategy."),
    ("the-two-types-of-hard","The Two Types of Hard",["topic-productivity-systems","topic-mental-health"],
     "There are two kinds of difficulty in creative work. The first is the hard of skill — you literally don't know how to do the thing yet. The second is the hard of resistance — you know how, but starting feels uncomfortable.\n\nMistaking one for the other is dangerous. If you think resistance is skill gap, you'll spend time learning when you should be shipping. If you think skill gap is resistance, you'll force output when you actually need to learn.\n\nThe tell: skill-gap hard gets easier with study and practice. Resistance hard gets easier with starting. Both are real; neither should be romanticized."),
    ("podcasting-is-relationship-building","Podcasting Is Relationship Building at Scale",["topic-podcasting","topic-b2b-marketing"],
     "A podcast guest who has a good experience will often become an advocate for your brand in ways that are hard to manufacture any other way. They share the episode with their audience, mention it in talks, and remember you warmly when your paths cross again.\n\nThe distribution value of a podcast episode is real but often secondary to the relationship value. Some of Refactoring's best sponsor introductions came from guests who had been on the show and recommended us to a contact.\n\nThis reframes how to think about guest selection. The right question isn't just 'who has the biggest audience?' but 'who do I want a real relationship with?'"),
    ("writing-for-clarity-vs-writing-for-credit","Writing for Clarity vs. Writing for Credit",["topic-writing"],
     "There are two failure modes in technical writing. The first is jargon-as-camouflage: using complexity to signal expertise, so the reader can't tell if you actually know what you're talking about. The second is oversimplification-as-humility: stripping out necessary nuance to seem accessible.\n\nClarity is harder than either. It requires understanding a topic well enough to choose exactly which complexity to preserve and which to discard — and being honest about which parts you don't fully understand yourself.\n\nThe best technical writers I've read are ruthlessly honest about the limits of their knowledge. This is what earns trust."),
    ("on-founder-energy-management","On Founder Energy Management",["topic-mental-health","topic-productivity-systems"],
     "Most advice about founder productivity focuses on time management. But time is a renewable resource — you get 24 hours every day. Energy isn't.\n\nThe founders I know who sustain high output for years are almost universally careful about energy: they protect sleep, have physical activity habits, and are selective about which meetings they take. Not because they're less dedicated, but because they've learned that a fresh 4-hour work block produces more than a tired 10-hour one.\n\nThis isn't about self-care as a trend. It's about treating yourself as the primary asset in your company and investing accordingly."),
    ("the-sponsorship-relationship","The Sponsor Relationship Is a Long Game",["topic-saas-business","topic-b2b-marketing"],
     "Most newsletters treat sponsors transactionally: one slot, one check, move on. The newsletters that build lasting sponsor revenue think differently.\n\nA sponsor who tries your audience once and gets good results will come back. A sponsor who tries once and gets mediocre results will not — regardless of whether the ROI was there. The relationship matters as much as the numbers.\n\nThis means investing in sponsor success even beyond what's contractually required. Proactive reporting, creative suggestions, introductions to relevant readers. The goal is for the sponsor to feel like a partner, not a customer."),
    ("knowledge-management-is-not-filing","Knowledge Management Is Not Filing",["topic-productivity-systems","topic-reading-books"],
     "The dominant metaphor for personal knowledge management is the filing cabinet: put things in labeled folders, retrieve when needed. This metaphor is mostly wrong.\n\nKnowledge becomes useful through connection, not storage. An idea you've filed carefully but never connected to your other ideas is almost as useless as an idea you forgot.\n\nThe goal of a note-taking system should be to maximize the probability of unexpected connections — serendipitous collisions between ideas from different domains. This is why spatial proximity (notes near related notes) and links matter more than tags or folders."),
    ("cycling-teaches-patience","Cycling Teaches Patience",["topic-cycling-training"],
     "Road cycling has a specific kind of suffering that's worth reflecting on. You can't sprint a 4-hour gran fondo. If you go out too hard in hour one, you pay for it in hour three. The only strategy is to hold your power steady and let the race come to you.\n\nThis is completely unlike how most knowledge workers operate. We're trained to sprint — to push hard when motivated, coast when not. But sustainable high output looks more like cycling: consistent effort, below maximum, sustained over long periods.\n\nThe athletes who finish best in long races are rarely the ones who looked strongest at the start."),
    ("open-source-as-marketing","Open Source as Marketing",["topic-open-source","topic-developer-tools"],
     "The most successful developer tools companies have figured out something the traditional software industry took decades to learn: giving your software away isn't charity, it's distribution.\n\nHashiCorp, Elastic, Redis — all built massive developer adoption through open-source and monetized through enterprise features, support, and cloud hosting. The open-source version is a top-of-funnel lead generation engine.\n\nFor developer tools, open source has become so effective that a closed-source tool now carries an implicit trust deficit it has to overcome."),
    ("newsletter-subject-lines","Newsletter Subject Lines Are User Experience",["topic-newsletter-growth","topic-writing"],
     "A subject line isn't marketing copy — it's the first screen of your product. It sets expectations, attracts the right readers, and repels the wrong ones.\n\nThe biggest mistake I see in newsletter subject lines is optimizing for opens over fit. Clickbait subject lines improve short-term open rates and hurt long-term engagement. Readers who open expecting one thing and find another don't become loyal readers.\n\nThe best subject lines I've used are boring but accurate. They tell you exactly what you're going to read. High-fit readers open, low-fit readers skip, and the engaged list that results is worth more than the inflated raw number."),
    ("recovery-week-in-training","The Importance of Recovery Weeks",["topic-cycling-training","topic-sleep-recovery"],
     "Every serious cycling training plan includes a recovery week every 3-4 weeks: significantly reduced volume, same intensity. This isn't optional.\n\nWithout recovery weeks, training stress accumulates until the athlete either gets sick, injured, or simply stops improving. The body adapts during recovery, not during training. Training is just the stimulus.\n\nI've made the mistake of skipping recovery weeks when training was going well — 'why back off if I feel strong?' Invariably, the 5th or 6th week of consecutive load is when something breaks. Respect the cycle."),
    ("the-real-job-of-a-newsletter","The Real Job of a Newsletter",["topic-content-strategy","topic-newsletter-growth"],
     "People subscribe to newsletters for different reasons: to learn, to stay informed, to feel part of a community, to be entertained, to have a trusted filter. But they stay subscribed for one reason: the newsletter reliably delivers on the implicit promise it made when they subscribed.\n\nThe biggest growth lever for any newsletter isn't content, distribution, or growth hacks — it's understanding the real job the reader is hiring the newsletter to do, and doing that job consistently well.\n\nFor Refactoring, the job is: 'help me think more clearly about engineering, leadership, and building software at scale, without taking too much of my time.'"),
    ("ai-wont-replace-thinking","AI Won't Replace Thinking — It Will Raise the Bar",["topic-ai-ml","topic-writing"],
     "The first generation of AI writing tools made it possible to produce content without thinking. The next generation is making it impossible to compete without thinking — deeply.\n\nWhen everyone can generate serviceable prose in seconds, the competitive advantage shifts to the things AI can't replicate: genuine expertise, authentic perspective, earned trust, and original insight. Surface-level content becomes worthless. Depth becomes more valuable.\n\nFor writers with real knowledge and real opinions, this is good news. For those who were providing formatting around thin ideas, the reckoning is here."),
    ("on-consistency-in-creative-work","On Consistency in Creative Work",["topic-writing","topic-productivity-systems"],
     "The most counterintuitive lesson from 5 years of publishing weekly: the newsletters I agonized over for days are not consistently better than the ones I wrote in 3 hours.\n\nWhat does correlate with quality is freshness of thinking — whether I'm saying something I actually believe and find interesting, rather than something I think I should say.\n\nConsistency forces this freshness. When you have to ship every week, you can't hide behind a blank page. You develop a practice of noticing: what actually caught my attention this week? What made me change my mind? That noticing becomes the raw material."),
    ("why-b2b-newsletters-work","Why B2B Newsletters Work",["topic-newsletter-growth","topic-b2b-marketing"],
     "B2B newsletters occupy a unique position in the attention economy: they're invited into the inbox, not pushed. The reader actively chose to receive them. This opt-in dynamic is unlike almost every other marketing channel.\n\nThe implication: the conversion funnel is inverted compared to advertising. You don't need to interrupt; you need to deserve the slot. Readers who find a B2B newsletter worth reading self-select as high-intent. They're not casual browsers; they're professionals investing time in staying current.\n\nThis is why the economics of a B2B newsletter sponsor can be so attractive. You're not renting attention; you're being introduced to a curated audience that has already demonstrated professional intent."),
    ("investing-in-yourself-vs-markets","Investing in Yourself vs. Markets",["topic-personal-finance"],
     "The standard personal finance advice is to maximize your savings rate and invest in index funds. This is correct for most people. But there's a prior question for founders and early-career professionals: what's the expected return on investing in yourself versus the market?\n\nIf a €5,000 course or coaching program increases your earning power by €10,000/year, that's a 200% annual return — far above market rates. The window for these investments narrows as your career matures.\n\nIndex funds are the right answer when skill development opportunities are exhausted. Most founders and ambitious professionals haven't reached that point yet."),
    ("what-makes-a-good-podcast-guest","What Makes a Good Podcast Guest",["topic-podcasting"],
     "The best podcast guests are not the most famous or the most accomplished. They're the most specific.\n\nA guest who can speak from direct experience about one particular problem — how they restructured their engineering team after a disastrous product launch, exactly what they changed in their hiring process after a bad hire — is far more valuable than a guest who can speak generally about leadership at scale.\n\nThis has changed how I approach guest outreach. Instead of starting with 'who is impressive?', I start with 'what specific thing happened to this person that would be genuinely useful to our listeners?'"),
    ("sleeping-more-is-a-superpower","Sleeping More Is a Competitive Advantage",["topic-sleep-recovery","topic-mental-health"],
     "The tech industry glorifies sleep deprivation. 'Sleep when you're dead.' '80-hour weeks.' These are cultural artifacts from an era when we didn't understand what sleep deprivation does to cognitive performance.\n\nSleep-deprived people are bad at judging their own impairment. They think they're functioning at 80% when they're actually at 50%. They make more errors, have worse judgment, and are less creative — and they don't know it.\n\nConsistently sleeping 7-8 hours doesn't make you less productive. It makes you more productive per hour, with better judgment and lower error rates. The math nearly always works out."),
    ("the-saas-metric-that-matters","The SaaS Metric That Actually Matters",["topic-saas-business"],
     "Everyone talks about MRR, ARR, and churn rate. These are important. But the metric that actually tells you whether your business is healthy is net revenue retention (NRR) — the percentage of revenue from last year's customers you're retaining this year, including expansions.\n\nNRR > 100% means your existing customers are spending more than they were. This is the signature of product-market fit: customers who stay and spend more because the product keeps improving and becoming more embedded in their workflows.\n\nA business with 80% NRR is structurally fragile. A business with 120% NRR is almost impossible to kill."),
    ("italian-startup-ecosystem-observations","Observations on the Italian Startup Ecosystem",["topic-italian-startups"],
     "Italy produces exceptional technical talent — some of the best engineers in Europe come from Politecnico di Milano and La Sapienza. But the startup ecosystem is immature in specific ways that are interesting to understand.\n\nThe first is risk appetite. Italian professional culture, shaped partly by the importance of stable employment and family obligations, is less tolerant of career risk than US or UK equivalents. This makes recruiting for equity difficult and exit timelines different.\n\nThe second is capital infrastructure. The VC ecosystem is smaller and more conservative than Northern Europe. The best Italian founders often move to Berlin, London, or Amsterdam to raise Series A — not because Italy is bad, but because the capital isn't there yet."),
    ("reading-more-by-reading-better","Read More by Reading Better",["topic-reading-books"],
     "The bottleneck in most people's reading isn't speed — it's selection and retention. They read too many books they don't finish and retain too little of what they do.\n\nThree things have improved my reading dramatically:\n\n1. **Permission to stop.** If a book hasn't earned its next chapter by page 50, I stop. Life is too short for dutiful reading.\n\n2. **Writing after reading.** I write a brief note — what was the core claim? Do I believe it? What does it connect to? This takes 20 minutes and dramatically improves retention.\n\n3. **Re-reading deliberately.** I re-read a handful of books every year that have proven worth re-reading. Each time I find something new."),
]

# ── READING NOTES ─────────────────────────────────────────────────
NOTES = [
    ("note-on-writing-well","On Writing Well","William Zinsser","topic-writing","https://example.com/writing-well","Classic guide to clear, non-fiction writing. Core insight: clutter is the disease of American writing. Surgery is the cure. Every word must earn its place."),
    ("note-never-split-difference","Never Split the Difference","Chris Voss","topic-b2b-marketing","https://example.com/never-split","FBI negotiation techniques applied to everyday situations. Key: mirroring, labeling emotions, and calibrated questions. Changed how I run sponsor negotiations."),
    ("note-thinking-fast-and-slow","Thinking, Fast and Slow","Daniel Kahneman","topic-productivity-systems","https://example.com/thinking","System 1 (fast, intuitive) vs System 2 (slow, deliberate) thinking. The biases section is essential — anchoring, availability heuristic, loss aversion."),
    ("note-building-a-second-brain","Building a Second Brain","Tiago Forte","topic-productivity-systems","https://example.com/second-brain","CODE framework: Capture, Organize, Distill, Express. Useful scaffold but I disagree with the heavy emphasis on 'projects' as the organizing principle."),
    ("note-zero-to-one","Zero to One","Peter Thiel","topic-saas-business","https://example.com/zero-to-one","Secrets are the basis of unique businesses. The competition is for losers framing. Useful contrarian lens even where I disagree."),
    ("note-atomic-habits","Atomic Habits","James Clear","topic-productivity-systems","https://example.com/atomic-habits","Systems over goals. Identity-based habits. The 2-minute rule for building habits. Implementation intentions. Applied to morning reading habit and cycling training consistency."),
    ("note-the-hard-thing-about-hard-things","The Hard Thing About Hard Things","Ben Horowitz","topic-team-leadership","https://example.com/hard-things","Honest account of the unglamorous parts of running a company. The 'struggle' chapter is the best thing written about what being a founder actually feels like."),
    ("note-show-your-work","Show Your Work","Austin Kleon","topic-writing","https://example.com/show-your-work","Share your process, not just the output. Build an audience by being a learner in public. Short, actionable, useful for anyone who creates."),
    ("note-deep-work","Deep Work","Cal Newport","topic-productivity-systems","https://example.com/deep-work","The ability to focus without distraction is rare and valuable. Shallow work is easy to replicate. Deep work is the skill of the 21st century. Applies to writing and coding especially."),
    ("note-essentialism","Essentialism","Greg McKeown","topic-productivity-systems","https://example.com/essentialism","Less but better. The disciplined pursuit of less. Useful antidote to the 'more is more' founder mindset. Helped me say no to more things."),
    ("note-the-lean-startup","The Lean Startup","Eric Ries","topic-saas-business","https://example.com/lean-startup","Build-measure-learn loop. Validated learning. Minimum viable product. Foundational for product thinking even if the terminology is overused."),
    ("note-grit","Grit","Angela Duckworth","topic-mental-health","https://example.com/grit","Passion and perseverance over talent. Long-term goal commitment is the differentiator. Useful framework for understanding why some cyclists improve and others plateau."),
    ("note-the-art-of-learning","The Art of Learning","Josh Waitzkin","topic-productivity-systems","https://example.com/art-of-learning","Learning curves, chunking, investment in loss. Waitzkin's description of how he learns new skills is the most useful thing I've read on deliberate practice."),
    ("note-good-strategy-bad-strategy","Good Strategy Bad Strategy","Richard Rumelt","topic-saas-business","https://example.com/good-strategy","Strategy is diagnosis + guiding policy + coherent actions. Most 'strategy' is just goals dressed up as strategy. The kernel model is genuinely useful."),
    ("note-range","Range","David Epstein","topic-reading-books","https://example.com/range","Generalists often outperform specialists in complex, unpredictable environments. The winding path to expertise is underrated. Good counter to the 10,000-hour rule absolutism."),
    ("note-the-courage-to-be-disliked","The Courage to Be Disliked","Kishimi & Koga","topic-mental-health","https://example.com/courage","Adlerian psychology in Socratic dialogue form. Task separation: focus only on your own tasks, not others' responses. Changed how I think about negative feedback."),
    ("note-how-minds-change","How Minds Change","David McRaney","topic-productivity-systems","https://example.com/how-minds-change","The science of belief change. Deep canvassing, motivational interviewing, SIFT. Useful for anyone trying to communicate with people who disagree."),
    ("note-on-the-shortness-of-life","On the Shortness of Life","Seneca","topic-mental-health","https://example.com/shortness","Life is not short — we waste it. The Stoic framing of time as the only truly scarce resource. Annual re-read for me."),
    ("note-the-innovators-dilemma","The Innovator's Dilemma","Clayton Christensen","topic-saas-business","https://example.com/innovators-dilemma","Disruptive vs sustaining innovation. Established companies fail not from incompetence but from rational decisions that work against them when the market shifts."),
    ("note-man-search-for-meaning","Man's Search for Meaning","Viktor Frankl","topic-mental-health","https://example.com/frankl","Logotherapy: meaning as the primary human motivation. The experience of finding meaning even in extreme suffering. Changed how I think about difficulty."),
    ("note-the-willpower-instinct","The Willpower Instinct","Kelly McGonigal","topic-mental-health","https://example.com/willpower","Willpower is a physiological resource that depletes. The stress response undermines it. Mindfulness and 'pause and plan' response to strengthen it. Applied to diet and training adherence."),
    ("note-makers-schedule-managers","Maker's Schedule Manager's Schedule","Paul Graham","topic-productivity-systems","https://example.com/makers-schedule","Makers need long uninterrupted blocks. Managers live in 1-hour chunks. Meetings are cheap for managers, expensive for makers. Shaped how I structure my week."),
    ("note-thinking-in-bets","Thinking in Bets","Annie Duke","topic-personal-finance","https://example.com/thinking-bets","Resulting: judging decisions by outcomes is a mistake. Good decisions have bad outcomes. Bad decisions have good outcomes. Luck matters. Separate decision quality from outcome quality."),
    ("note-the-mom-test","The Mom Test","Rob Fitzpatrick","topic-saas-business","https://example.com/mom-test","How to talk to customers without them lying to you. Ask about their life, not your idea. Past behavior over future intentions. Essential for anyone doing user research."),
    ("note-radical-candor","Radical Candor","Kim Scott","topic-team-leadership","https://example.com/radical-candor","Care personally, challenge directly. Ruinous empathy is the most common management failure mode. Framework for feedback conversations with Matteo, Paco, Sara."),
    ("note-the-obstacle-is-the-way","The Obstacle Is the Way","Ryan Holiday","topic-mental-health","https://example.com/obstacle","Stoic philosophy applied to adversity. The obstacle itself is the path forward. Useful mental frame for dealing with difficult periods."),
    ("note-so-good-they-cant-ignore","So Good They Can't Ignore You","Cal Newport","topic-productivity-systems","https://example.com/so-good","Career capital theory: rare and valuable skills create rare and valuable careers. 'Follow your passion' is bad advice. Deliberate practice is the path."),
    ("note-traffic-secrets","Traffic Secrets","Russell Brunson","topic-newsletter-growth","https://example.com/traffic","Dream customer avatar, hook-story-offer framework, finding where attention lives. Useful for thinking about top-of-funnel newsletter growth."),
    ("note-the-effective-executive","The Effective Executive","Peter Drucker","topic-team-leadership","https://example.com/effective-executive","What effective executives actually do: manage time, focus on contribution, exploit strengths. Timeless despite being from 1967. Annual re-read."),
    ("note-born-to-run","Born to Run","Christopher McDougall","topic-running","https://example.com/born-to-run","The Tarahumara ultrarunners and the barefoot running movement. Made me think differently about natural movement patterns."),
]


def reset_vault():
    COUNTS.clear()
    if VAULT.exists():
        shutil.rmtree(VAULT)
    for sub in SUBDIRS:
        (VAULT / sub).mkdir(parents=True, exist_ok=True)


def generate_years():
    for year in ["2024", "2025"]:
        quarters = [q for q in QUARTER_SLUGS if q.startswith(year[2:])]
        write_md("year", year, {
            "aliases": [year],
            "Is A": "Year",
            "Created at": f"{year}-01-01",
            "Has": [wl(q) for q in quarters],
        }, f"# {year}\nAnother year of building Refactoring, shipping content, and growing the audience. Review written in December.")


def generate_quarters():
    for q in QUARTER_SLUGS:
        projects_in_q = [p[0] for p in PROJECTS if p[2] == q]
        write_md("quarter", q, {
            "aliases": [Q_LABEL[q]],
            "Is A": "Quarter",
            "Created at": Q_START[q],
            "Belongs to": wl(Q_YEAR[q]),
            "Has": [wl(p) for p in projects_in_q],
            "Status": "Done" if q < "25q4" else "Open",
        }, f"# {Q_LABEL[q]}\nQuarterly review for {Q_LABEL[q]}. See projects and targets below.")


def generate_months():
    rating_cycle = ["😄", "🤩", "😄", "😄", "😐", "🤩", "😄", "🤩", "😄", "😐", "😄", "😄"]
    month_tones = ["difficult", "solid", "great", "mixed"]
    month_idx = 0

    for q in QUARTER_SLUGS:
        for month_slug in Q_MONTHS[q]:
            year, month = month_slug.split("-")
            month_name = MONTH_NAMES[int(month)]
            rating = rating_cycle[month_idx % len(rating_cycle)]
            tone = month_tones[month_idx % len(month_tones)]
            write_md("month", month_slug, {
                "aliases": [f"{month_name} {year}"],
                "Is A": "Month",
                "Created at": f"{month_slug}-28",
                "Belongs to": wl(q),
                "Rating": rating,
            }, f"# {month_name} {year}\nMonthly review. A {tone} month overall.")
            month_idx += 1


def generate_areas():
    for slug, name, responsibility_slugs in AREAS:
        write_md("area", slug, {
            "aliases": [name],
            "Is A": "Area",
            "Has": [wl(resp) for resp in responsibility_slugs],
        }, f"# {name}\nOne of the core life/work areas.")


def generate_responsibilities():
    for slug, name, area, measures, procedures, body in RESPONSIBILITIES:
        write_md("responsibility", slug, {
            "aliases": [name],
            "Is A": "Responsibility",
            "Belongs to": wl(area),
            "Has Measures": [wl(measure) for measure in measures],
            "Has Procedures": [wl(proc) for proc in procedures],
            "Status": "Open",
        }, f"# {name}\n{body}")


def generate_measures():
    for slug, name, responsibility, unit in MEASURES:
        write_md("measure", slug, {
            "aliases": [name],
            "Is A": "Measure",
            "Belongs to": wl(responsibility),
            "Unit": unit,
        }, f"# {name}\nTracked monthly via spreadsheet. Unit: {unit}.")


def generate_targets():
    open_quarters = {"25q3", "25q4"}

    for quarter in QUARTER_SLUGS:
        _, subscribers_goal = SUB_TRAJ[quarter]
        revenue_goal = REV_TRAJ[quarter]
        quarter_status = "Open" if quarter in open_quarters else "Done"

        actual_subscribers = random.randint(subscribers_goal - 800, subscribers_goal + 500)
        subscribers_status = "Done" if actual_subscribers >= subscribers_goal else "Behind"
        write_md("target", f"target-subscribers-{quarter}", {
            "aliases": [f"Subscribers {Q_LABEL[quarter]}"],
            "Is A": "Target",
            "Belongs to": wl(quarter),
            "Measure": wl("measure-subscribers"),
            "Goal value": subscribers_goal,
            "Actual value": actual_subscribers if quarter not in open_quarters else None,
            "Status": quarter_status if quarter in open_quarters else subscribers_status,
        }, f"# Subscribers Target {Q_LABEL[quarter]}\nTarget: {subscribers_goal:,} subscribers by end of quarter.")

        actual_revenue = random.randint(int(revenue_goal * 0.9), int(revenue_goal * 1.15))
        revenue_status = "Done" if actual_revenue >= revenue_goal else "Behind"
        write_md("target", f"target-revenue-{quarter}", {
            "aliases": [f"Revenue {Q_LABEL[quarter]}"],
            "Is A": "Target",
            "Belongs to": wl(quarter),
            "Measure": wl("measure-sponsorship-mrr"),
            "Goal value": revenue_goal,
            "Actual value": actual_revenue if quarter not in open_quarters else None,
            "Status": quarter_status if quarter in open_quarters else revenue_status,
        }, f"# Revenue Target {Q_LABEL[quarter]}\nTarget: €{revenue_goal:,}/month MRR by end of quarter.")

        hr_goal = 54 - QUARTER_SLUGS.index(quarter) // 2
        actual_hr = random.randint(hr_goal - 2, hr_goal + 3)
        hr_status = "Done" if actual_hr <= hr_goal else "Behind"
        write_md("target", f"target-resting-hr-{quarter}", {
            "aliases": [f"Resting HR {Q_LABEL[quarter]}"],
            "Is A": "Target",
            "Belongs to": wl(quarter),
            "Measure": wl("measure-resting-hr"),
            "Goal value": hr_goal,
            "Actual value": actual_hr if quarter not in open_quarters else None,
            "Status": quarter_status if quarter in open_quarters else hr_status,
        }, f"# Resting HR Target {Q_LABEL[quarter]}\nTarget: resting HR < {hr_goal} bpm.")

        actual_books = random.randint(4, 7) if quarter not in open_quarters else None
        write_md("target", f"target-books-{quarter}", {
            "aliases": [f"Books {Q_LABEL[quarter]}"],
            "Is A": "Target",
            "Belongs to": wl(quarter),
            "Measure": wl("measure-books-per-month"),
            "Goal value": 6,
            "Actual value": actual_books,
            "Status": quarter_status,
        }, f"# Books Target {Q_LABEL[quarter]}\nTarget: 6 books in the quarter (2/month).")


def generate_goals():
    for slug, name, year, status, body in GOALS:
        write_md("goal", slug, {
            "aliases": [name],
            "Is A": "Goal",
            "Belongs to": wl(year),
            "Status": status,
        }, f"# {name}\n{body}")


def generate_projects():
    for slug, title, quarter, responsibility, status, body in PROJECTS:
        write_md("project", slug, {
            "aliases": [title],
            "Is A": "Project",
            "Belongs to": wl(quarter),
            "Advances": wl(responsibility),
            "Status": status,
            "Owner": wl("person-luca-rossi"),
        }, f"# {title}\n{body}")


def generate_experiments():
    for slug, title, quarter, status, body in EXPERIMENTS:
        write_md("experiment", slug, {
            "aliases": [title],
            "Is A": "Experiment",
            "Belongs to": wl(quarter),
            "Status": status,
            "Owner": wl("person-luca-rossi"),
        }, f"# {title}\n{body}")


def build_procedure_map():
    return {
        "procedure-weekly-newsletter": ("Weekly Newsletter", "responsibility-content-production", "Weekly", "Draft, edit, and publish the weekly Refactoring newsletter. Includes essay writing, curated links, and sponsor block."),
        "procedure-monthly-subscriber-metrics": ("Monthly Subscriber Metrics Review", "responsibility-grow-newsletter", "Monthly", "Review subscriber growth, churn, open rates, and click rates. Update the tracking spreadsheet."),
        "procedure-referral-program": ("Referral Program Management", "responsibility-grow-newsletter", "Weekly", "Check referral program performance. Reward top referrers. A/B test referral copy."),
        "procedure-welcome-email-sequence": ("Welcome Email Sequence Review", "responsibility-grow-newsletter", "Monthly", "Review and update the onboarding email sequence for new subscribers."),
        "procedure-seo-content-optimization": ("SEO Content Optimization", "responsibility-grow-newsletter", "Monthly", "Update existing articles with new keywords, internal links, and improved structure."),
        "procedure-monthly-sponsor-report": ("Monthly Sponsor Report", "responsibility-sponsorships", "Monthly", "Prepare and send monthly performance reports to active sponsors. Include clicks, opens, and feedback."),
        "procedure-quarterly-sponsor-outreach": ("Quarterly Sponsor Outreach", "responsibility-sponsorships", "Quarterly", "Identify and contact 20+ potential sponsors each quarter. Use Airtable to track pipeline."),
        "procedure-sponsor-onboarding": ("Sponsor Onboarding", "responsibility-sponsorships", "As needed", "Onboard new sponsors: brief, creative review, scheduling, and invoice."),
        "procedure-invoice-processing": ("Invoice Processing", "responsibility-sponsorships", "Monthly", "Send invoices to sponsors and follow up on outstanding payments."),
        "procedure-sponsor-renewal": ("Sponsor Renewal Process", "responsibility-sponsorships", "Quarterly", "Review upcoming sponsor contract expirations and initiate renewal conversations."),
        "procedure-monthly-pillar-planning": ("Monthly Content Planning", "responsibility-content-production", "Monthly", "Plan the next month's newsletter topics, essays, and pillar article schedule."),
        "procedure-social-media-scheduling": ("Social Media Scheduling", "responsibility-content-production", "Weekly", "Schedule LinkedIn and Twitter posts repurposing newsletter content."),
        "procedure-newsletter-ab-testing": ("Newsletter A/B Testing", "responsibility-content-production", "Bi-weekly", "Run subject line and content A/B tests. Analyze results and document learnings."),
        "procedure-content-calendar-review": ("Content Calendar Review", "responsibility-content-production", "Weekly", "Review and update the content calendar. Ensure 4-week runway of planned topics."),
        "procedure-editorial-review": ("Editorial Review", "responsibility-content-production", "Weekly", "Review Sara's editing suggestions. Give feedback and approve final drafts."),
        "procedure-evergreen-content-audit": ("Evergreen Content Audit", "responsibility-content-production", "Quarterly", "Audit existing evergreen articles for accuracy, updated links, and improvement opportunities."),
        "procedure-newsletter-metrics-weekly": ("Weekly Newsletter Metrics", "responsibility-content-production", "Weekly", "Review open rate, click rate, and unsubscribes for the latest newsletter edition."),
        "procedure-podcast-recording": ("Podcast Recording", "responsibility-podcast", "Bi-weekly", "Record bi-weekly podcast episode. Prep call with guest, record 60-90 min, send for editing."),
        "procedure-podcast-guest-outreach": ("Podcast Guest Outreach", "responsibility-podcast", "Monthly", "Identify and contact 5 potential guests. Maintain a 3-month booking horizon."),
        "procedure-podcast-editing": ("Podcast Editing Review", "responsibility-podcast", "Bi-weekly", "Review Paco's edit of the latest episode. Approve or request changes."),
        "procedure-podcast-show-notes": ("Podcast Show Notes", "responsibility-podcast", "Bi-weekly", "Write show notes and episode summary for the Refactoring website and newsletter."),
        "procedure-podcast-analytics": ("Podcast Analytics Review", "responsibility-podcast", "Monthly", "Review download numbers, listener retention, and episode performance by topic."),
        "procedure-weekly-team-sync": ("Weekly Team Sync", "responsibility-team-management", "Weekly", "Monday 10am team sync. Agenda: blockers, priorities, coordination."),
        "procedure-biweekly-1on1-matteo": ("1:1 with Matteo", "responsibility-team-management", "Bi-weekly", "Bi-weekly 1:1 with Matteo. Cover: sponsor pipeline, blockers, personal growth, feedback."),
        "procedure-biweekly-1on1-paco": ("1:1 with Paco", "responsibility-team-management", "Bi-weekly", "Bi-weekly 1:1 with Paco. Cover: operations updates, tooling, process improvements, feedback."),
        "procedure-biweekly-1on1-sara": ("1:1 with Sara", "responsibility-team-management", "Bi-weekly", "Bi-weekly 1:1 with Sara. Cover: content quality, workload, professional development, feedback."),
        "procedure-quarterly-team-retro": ("Quarterly Team Retrospective", "responsibility-team-management", "Quarterly", "End-of-quarter team retrospective: what went well, what didn't, what to change."),
        "procedure-weekly-cycling-block": ("Weekly Cycling Training Block", "responsibility-health-fitness", "Weekly", "3 rides per week: Tuesday (intervals), Thursday (endurance), Saturday (long ride)."),
        "procedure-gym-routine": ("Gym Strength Routine", "responsibility-health-fitness", "Weekly", "2x/week gym: Monday and Wednesday. Compound lifts + core work."),
        "procedure-monthly-health-review": ("Monthly Health Review", "responsibility-health-fitness", "Monthly", "Track resting HR, weight, HRV, sleep quality. Adjust training load if needed."),
        "procedure-race-preparation": ("Race Preparation", "responsibility-health-fitness", "As needed", "1-week taper before a gran fondo: reduce volume, maintain intensity, focus on nutrition and sleep."),
        "procedure-monthly-portfolio-review": ("Monthly Portfolio Review", "responsibility-personal-finance", "Monthly", "Review investment portfolio performance. Rebalance if drift > 5%. Track savings rate."),
        "procedure-quarterly-financial-planning": ("Quarterly Financial Planning", "responsibility-personal-finance", "Quarterly", "Quarterly financial review: income, expenses, savings rate, and progress toward net worth target."),
        "procedure-weekly-reading-session": ("Weekly Reading Session", "responsibility-learning", "Weekly", "Sunday morning: 2-3 hours of focused reading. No phone, coffee, and a good book."),
        "procedure-evergreen-note-writing": ("Evergreen Note Writing", "responsibility-learning", "Weekly", "Write 1-2 evergreen notes per week from recent reading, conversations, or observations."),
    }


def generate_procedures():
    for proc_slug, (proc_name, responsibility, cadence, body) in build_procedure_map().items():
        write_md("procedure", proc_slug, {
            "aliases": [proc_name],
            "Is A": "Procedure",
            "Belongs to": wl(responsibility),
            "Cadence": cadence,
            "Owner": wl("person-luca-rossi"),
        }, f"# {proc_name}\n{body}")


def build_task_templates():
    return [
        ("Write Q{q} retrospective", "24q1", "Done"),
        ("Update website About page", "24q1", "Done"),
        ("Fix broken links in newsletter archive", "24q1", "Done"),
        ("Set up new analytics dashboard", "24q2", "Done"),
        ("Create sponsor media kit PDF", "24q2", "Done"),
        ("Update editorial guidelines for Sara", "24q2", "Done"),
        ("Research gran fondo training plans", "24q2", "Done"),
        ("Write podcast pitch template", "24q3", "Done"),
        ("Review and update pricing page", "24q3", "Done"),
        ("Archive Q2 sponsor contracts", "24q3", "Done"),
        ("Create onboarding checklist for new subscribers", "24q3", "Done"),
        ("Set up automated welcome sequence", "24q4", "Done"),
        ("Prepare Q4 sponsor renewal emails", "24q4", "Done"),
        ("Write 2024 annual review post", "24q4", "Done"),
        ("Update team role descriptions", "24q4", "Done"),
        ("Create content library for repurposing", "24q4", "Done"),
        ("Set up new Airtable base for 2025 sponsors", "25q1", "Done"),
        ("Review and update newsletter footer", "25q1", "Done"),
        ("Write referral program landing page copy", "25q1", "Done"),
        ("Research new podcast guest categories", "25q1", "Done"),
        ("Update cycling training plan for spring", "25q1", "Done"),
        ("Create Q2 sponsor pitch deck", "25q1", "Done"),
        ("Archive 2024 financial records", "25q1", "Done"),
        ("Migrate newsletter archive to new template", "25q2", "Done"),
        ("Write e-book outline", "25q2", "Done"),
        ("Set up community Discord structure", "25q2", "Done"),
        ("Research LeadDev London conference", "25q2", "Done"),
        ("Update podcast description and tags", "25q2", "Done"),
        ("Review team compensation packages", "25q2", "Done"),
        ("Create sponsor case studies", "25q3", "Done"),
        ("Write e-book first draft (ch 1-5)", "25q3", "Done"),
        ("Plan London trip logistics", "25q3", "Done"),
        ("Update website with new subscriber milestone", "25q3", "Done"),
        ("Prepare Q4 content calendar", "25q3", "Done"),
        ("Review portfolio allocation Q3", "25q3", "Done"),
        ("Write 2026 sponsorship prospectus", "25q4", "Open"),
        ("Plan 2026 editorial calendar", "25q4", "Open"),
        ("Update team handbook", "25q4", "Open"),
        ("Book travel for January conferences", "25q4", "Open"),
        ("Write end-of-year letter to subscribers", "25q4", "Open"),
        ("Review and renew tool subscriptions", "25q4", "Open"),
        ("Archive 2025 sponsor contracts", "25q4", "Open"),
        ("Set up 2026 tracking spreadsheets", "25q4", "Open"),
        ("Update podcast listing on all platforms", "25q4", "Open"),
        ("Write Q4 retrospective", "25q4", "Open"),
    ]


def generate_tasks():
    for index, (title, quarter, status) in enumerate(build_task_templates(), start=1):
        rendered_title = title.replace("{q}", quarter.upper())
        write_md("task", f"task-{quarter}-{index:02d}", {
            "aliases": [rendered_title],
            "Is A": "Task",
            "Belongs to": wl(quarter),
            "Status": status,
            "Owner": wl("person-luca-rossi"),
        }, f"# {rendered_title}\n")


def generate_people():
    for slug, name, tier, tags, bio in PERSONS:
        write_md("person", slug, {
            "aliases": [name],
            "Is A": "Person",
            "Tier": tier,
            "Tags": tags,
        }, f"# {name}\n{bio}")


def generate_topics():
    for slug, name, description in TOPICS:
        write_md("topic", slug, {
            "aliases": [name],
            "Is A": "Topic",
        }, f"# {name}\n{description}")


def quarter_label_for_date(current_date: date) -> str:
    if current_date.month < 4:
        return "1"
    if current_date.month < 7:
        return "2"
    if current_date.month < 10:
        return "3"
    return "4"


def person_name(slug: str) -> str:
    return next((person[1] for person in PERSONS if person[0] == slug), slug)


def in_biweekly_window(current_date: date, start_date: date) -> bool:
    return (current_date - start_date).days % 14 < 7


def write_event(
    slug_prefix: str,
    title: str,
    current_date: date,
    tags: list[str],
    body: str,
    related: list[str] | None = None,
):
    day_slug = current_date.isoformat()
    fields = {
        "aliases": [f"{title} — {day_slug}"],
        "Is A": "Event",
        "Date": day_slug,
        "Belongs to": wl(current_date.strftime("%Y-%m")),
    }
    if related is not None:
        fields["Related to"] = related
    fields["Tags"] = tags
    write_md("event", f"{slug_prefix}-{day_slug}", fields, f"# {title} — {day_slug}\n{body}")


def generate_team_sync_event(current_date: date) -> int:
    team = [wl("person-matteo-cellini"), wl("person-paco-furiani")]
    if current_date >= date(2024, 4, 1):
        team.append(wl("person-sara-ricci"))
    write_event(
        "event-team-sync",
        "Team sync",
        current_date,
        ["Work"],
        "Weekly Monday team alignment. Covered priorities, blockers, and sponsor updates.",
        team,
    )
    return 1


def generate_cycling_interval_event(current_date: date) -> int:
    write_event(
        "event-cycling",
        "Cycling intervals",
        current_date,
        ["Health", "Sport"],
        "60-min interval session. 4x8min at threshold power.",
        [wl("person-luca-rossi")],
    )
    return 1


def generate_wednesday_event(current_date: date) -> int:
    if in_biweekly_window(current_date, date(2024, 1, 3)):
        write_event(
            "event-gym",
            "Gym",
            current_date,
            ["Health"],
            "Strength training. Squat, deadlift, pull-ups. 75 minutes.",
        )
        return 1

    quarter_label = quarter_label_for_date(current_date)
    write_event(
        "event-1on1-matteo",
        "1:1 Matteo",
        current_date,
        ["Work"],
        f"Bi-weekly 1:1. Covered sponsor pipeline and Q{quarter_label} priorities.",
        [wl("person-matteo-cellini")],
    )
    return 1


def generate_cycling_endurance_event(current_date: date) -> int:
    write_event(
        "event-cycling-endurance",
        "Cycling endurance",
        current_date,
        ["Health", "Sport"],
        "90-min endurance ride at zone 2. Avg HR 135.",
    )
    return 1


def generate_friday_workout_or_sponsor_event(current_date: date) -> int:
    if in_biweekly_window(current_date, date(2024, 1, 5)):
        sponsor = random.choice(SPONSOR_PERSONS)
        write_event(
            "event-sponsor-call",
            "Sponsor call",
            current_date,
            ["Work"],
            "Sponsor discovery/renewal call. Discussed placement and campaign goals.",
            [wl(sponsor)],
        )
        return 1

    write_event(
        "event-gym-fri",
        "Gym",
        current_date,
        ["Health"],
        "Strength session. Bench press, rows, overhead press. Core work.",
    )
    return 1


def generate_long_ride_event(current_date: date) -> int:
    relations = [wl("person-luca-rossi")]
    ride_note = "Solo long ride."
    if random.random() < 0.4:
        relations = [wl("person-luca-rossi"), wl("person-alessandro-ferrari")]
        ride_note = "Long ride with Alessandro."
    distance = random.randint(80, 130)
    elevation = random.randint(800, 2000)
    write_event(
        "event-long-ride",
        "Long ride",
        current_date,
        ["Health", "Sport"],
        f"{ride_note} {distance}km, {elevation}m elevation.",
        relations,
    )
    return 1


def generate_sunday_event(current_date: date) -> int:
    if in_biweekly_window(current_date, date(2024, 1, 7)):
        write_event(
            "event-reading",
            "Reading session",
            current_date,
            ["Learning"],
            "Sunday morning reading block. 2 hours with coffee.",
        )
        return 1

    write_event(
        "event-family-call",
        "Family call",
        current_date,
        ["Personal", "Family"],
        "Sunday family call with Elena and parents.",
        [wl("person-elena-rossi"), wl("person-roberto-rossi")],
    )
    return 1


WEEKDAY_EVENT_GENERATORS = {
    0: generate_team_sync_event,
    1: generate_cycling_interval_event,
    2: generate_wednesday_event,
    3: generate_cycling_endurance_event,
    4: generate_friday_workout_or_sponsor_event,
    5: generate_long_ride_event,
    6: generate_sunday_event,
}


def generate_regular_weekday_event(current_date: date) -> int:
    return WEEKDAY_EVENT_GENERATORS[current_date.weekday()](current_date)


def generate_monthly_paco_event(current_date: date) -> int:
    if current_date.weekday() != 3 or current_date.day > 7:
        return 0
    write_event(
        "event-1on1-paco",
        "1:1 Paco",
        current_date,
        ["Work"],
        "Monthly 1:1. Operations review, tooling updates, and process improvements.",
        [wl("person-paco-furiani")],
    )
    return 1


def generate_nonna_visit_event(current_date: date) -> int:
    if current_date.weekday() != 6 or current_date.day < 24:
        return 0
    write_event(
        "event-nonna-visit",
        "Visita dalla Nonna",
        current_date,
        ["Personal", "Family"],
        "Visita mensile alla nonna a Lecco. Pranzo con risotto.",
        [wl("person-nonna-lucia")],
    )
    return 1


def generate_podcast_recording_event(current_date: date) -> int:
    if current_date.weekday() != 3 or current_date < date(2024, 2, 1):
        return 0
    if not in_biweekly_window(current_date, date(2024, 2, 1)):
        return 0

    guest = random.choice(PODCAST_GUESTS)
    write_event(
        "event-podcast-rec",
        "Podcast recording",
        current_date,
        ["Work", "Podcast"],
        f"Recorded episode with {person_name(guest)}. Great conversation.",
        [wl(guest)],
    )
    return 1


def generate_dinner_event(current_date: date) -> int:
    if current_date.weekday() != 4 or random.random() >= 0.5:
        return 0

    friend = random.choice(FRIEND_SLUGS + ["person-giulia-marchetti"])
    write_event(
        "event-dinner",
        "Dinner",
        current_date,
        ["Personal"],
        f"Evening dinner with {person_name(friend)}.",
        [wl(friend)],
    )
    return 1


def generate_extra_events(current_date: date) -> int:
    return (
        generate_monthly_paco_event(current_date)
        + generate_nonna_visit_event(current_date)
        + generate_podcast_recording_event(current_date)
        + generate_dinner_event(current_date)
    )


def generate_events():
    current_date = date(2024, 1, 1)
    end_date = date(2025, 12, 31)
    event_count = 0

    while current_date <= end_date and event_count < 650:
        event_count += generate_regular_weekday_event(current_date)
        event_count += generate_extra_events(current_date)
        current_date += timedelta(days=1)


def generate_evergreens():
    for slug, title, topics, body in EVERGREENS:
        write_md("evergreen", slug, {
            "aliases": [title],
            "Is A": "Evergreen",
            "Topics": [wl(topic) for topic in topics],
            "Status": "Published",
        }, f"# {title}\n{body}")


def generate_notes():
    for slug, title, author, topic, url, body in NOTES:
        write_md("note", slug, {
            "aliases": [title],
            "Is A": "Note",
            "Author": author,
            "Topics": [wl(topic)],
            "URL": url,
        }, f"# {title}\n*{author}*\n\n{body}")


def print_summary():
    total = sum(COUNTS.values())
    print(f"\n✅ Large fixture generated at: {VAULT}\n")
    print(f"{'Type':<25} {'Count':>6}")
    print("-" * 33)
    for note_type, count in sorted(COUNTS.items()):
        print(f"{note_type:<25} {count:>6}")
    print("-" * 33)
    print(f"{'TOTAL':<25} {total:>6}")


def generate_all(output_path: Path | None = None):
    global VAULT

    if output_path is not None:
        VAULT = output_path

    random.seed(42)
    reset_vault()

    steps = [
        generate_years,
        generate_quarters,
        generate_months,
        generate_areas,
        generate_responsibilities,
        generate_measures,
        generate_targets,
        generate_goals,
        generate_projects,
        generate_experiments,
        generate_procedures,
        generate_tasks,
        generate_people,
        generate_topics,
        generate_events,
        generate_evergreens,
        generate_notes,
    ]
    for step in steps:
        step()

    print_summary()


def parse_args():
    parser = argparse.ArgumentParser(description="Generate the large synthetic Tolaria fixture.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_VAULT,
        help=f"Output directory for the generated vault (default: {DEFAULT_VAULT})",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    generate_all(args.output.resolve())
