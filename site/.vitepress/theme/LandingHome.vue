<script setup lang="ts">
import { withBase } from "vitepress";

type FeatureIcon = "archive" | "pen" | "git" | "sparkle";
type DocsIcon = "rocket" | "network" | "workflow" | "refresh";

type FeatureCard = {
  title: string;
  image: string;
  alt: string;
};

type FeatureSection = {
  id?: string;
  icon: FeatureIcon;
  label: string;
  title: string;
  description: string;
  compact?: boolean;
  cards: FeatureCard[];
};

type DocsLink = {
  icon: DocsIcon;
  title: string;
  text: string;
  link: string;
};

const asset = (path: string) => withBase(`/landing/${path}`);
const route = (path: string) => withBase(path);

const featureSections: FeatureSection[] = [
  {
    id: "features",
    icon: "archive",
    label: "Architecture",
    title: "Just files on your disk",
    description:
      "Every note is a Markdown file with a YAML frontmatter. No database, no proprietary format. Read them with any editor, grep them from the terminal, version them with Git.",
    cards: [
      {
        title: "Plain Markdown on disk",
        image: "simply-files.png",
        alt: "Plain Markdown files",
      },
      {
        title: "YAML frontmatter for structure",
        image: "yaml frontmatter.png",
        alt: "YAML frontmatter",
      },
    ],
  },
  {
    icon: "pen",
    label: "Editor",
    title: "Writes richly, saves as Markdown",
    description:
      "Block-based editing with slash commands, wikilinks, raw Markdown, whiteboards, media previews, table navigation, and note width controls. Everything durable stays in vault files.",
    cards: [
      {
        title: "Rich block editor",
        image: "Block editor.png",
        alt: "Block editor",
      },
      {
        title: "[[Wikilinks]] with autocomplete",
        image: "wikilinks.png",
        alt: "Wikilinks",
      },
      {
        title: "Rich relationships as first-class citizen",
        image: "relationships.png",
        alt: "Relationships",
      },
    ],
  },
  {
    icon: "git",
    label: "Version control",
    title: "Fully integrated Git client",
    description:
      "Commit, push, and browse history from within the app. Every change tracked. Sync across devices with the same tool you already trust for code.",
    compact: true,
    cards: [
      {
        title: "Rich commit history, right in the app",
        image: "pulse.png",
        alt: "Commit history",
      },
      {
        title: "Navigable version history per single note",
        image: "git-history.png",
        alt: "Git history",
      },
      {
        title: "Track changes, commit and push",
        image: "track changes and push.png",
        alt: "Track changes",
      },
    ],
  },
  {
    icon: "sparkle",
    label: "AI",
    title: "Local agents and direct models",
    description:
      "Use CLI coding agents such as Claude Code, Codex, OpenCode, Pi, and Gemini when you want tool-backed editing. Use local or API model providers for chat over note context without vault-write tools.",
    cards: [
      {
        title: "Sidebar with custom sections",
        image: "Ai chat 3.png",
        alt: "AI chat integration",
      },
    ],
  },
];

const docsLinks: DocsLink[] = [
  {
    icon: "rocket",
    title: "Start with a vault",
    text: "Install Tolaria, open the Getting Started vault, and understand the first-launch flow.",
    link: "/start/install",
  },
  {
    icon: "network",
    title: "Understand the model",
    text: "Learn how notes, properties, types, relationships, custom views, Git, and AI fit together.",
    link: "/concepts/vaults",
  },
  {
    icon: "workflow",
    title: "Follow workflows",
    text: "Capture notes, organize the inbox, use wikilinks, create types, push changes, configure AI, and navigate long notes.",
    link: "/guides/capture-a-note",
  },
  {
    icon: "refresh",
    title: "Keep docs current",
    text: "Use the maintenance checklist when code changes affect commands, models, integrations, or platform behavior.",
    link: "/reference/docs-maintenance",
  },
];

const testimonials = [
  {
    name: "Gregor O.",
    role: "CTO",
    image: "gregor.webp",
    alt: "Gregor O.",
    quote:
      "Great newsletter for everyone interested in topics all the way from Software to People working well together! Luca is providing a LOT of value filled with actionable insights in a very easy to read way.",
  },
  {
    name: "Ananth R.",
    role: "Engineering Manager & O'Reilly Instructor",
    image: "ananth.webp",
    alt: "Ananth R.",
    quote:
      "Luca's newsletter is one of the best in the industry for software engineers and engineers leaders. I highly recommend to anyone who would like to build high performing engineering teams.",
  },
  {
    name: "Jordan C.",
    role: "Staff Engineer",
    image: "jordan.webp",
    alt: "Jordan C.",
    quote:
      "There's a reason Refactoring has over 100k subscribers. It's a newsletter you CANNOT miss as a software engineer. Follow the advice here and you will see huge wins throughout your career.",
  },
];
</script>

<template>
  <main class="tolaria-landing">
    <section class="landing-container hero-section">
      <h1>A second brain for the AI era. Free forever.</h1>
      <p class="hero-lede">
        Organize your notes as Markdown files, with native relationships, Git,
        local agents, and direct AI model providers.
      </p>
      <div class="hero-actions">
        <a
          class="landing-button primary"
          href="https://tolaria.md/download/"
          target="_self"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          Download Tolaria
        </a>
        <a class="landing-button secondary" href="https://github.com/refactoringhq/tolaria">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.6-1.2-3.6.2-1.1.2-2.3-.1-3.4 0 0-1 0-3.3 1.2a11.5 11.5 0 0 0-6 0C7 2 6 2 6 2c-.3 1.1-.3 2.3-.1 3.4A5 5 0 0 0 4.7 9c0 3.5 3 5.5 6 5.5a4.8 4.8 0 0 0-1 3.5v4"
            />
            <path d="M9 18c-4.5 2-5-2-7-2" />
          </svg>
          Check on GitHub
        </a>
        <a class="landing-button secondary" :href="route('/start/install')">Read the docs</a>
      </div>
      <p class="hero-note">Open source, free forever, no account required</p>
    </section>

    <section class="landing-container hero-screenshot">
      <div
        class="screenshot-field"
        :style="{ backgroundImage: `url(${asset('les-saintes.jpg')})` }"
      >
        <div class="screenshot-frame">
          <img
            class="screenshot-image light"
            :src="asset('tolaria-screenshot.png')"
            alt="Tolaria app in light mode"
            draggable="false"
          />
          <img
            class="screenshot-image dark"
            :src="asset('tolaria-screenshot-dark.png')"
            alt="Tolaria app in dark mode"
            draggable="false"
          />
        </div>
      </div>
    </section>

    <section
      v-for="section in featureSections"
      :id="section.id"
      :key="section.title"
      class="landing-container feature-section"
    >
      <div class="section-heading">
        <span class="section-label">
          <svg v-if="section.icon === 'archive'" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="22" x2="2" y1="12" y2="12" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
          <svg v-else-if="section.icon === 'pen'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          </svg>
          <svg v-else-if="section.icon === 'git'" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="6" x2="6" y1="3" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <svg v-else viewBox="0 0 256 256" aria-hidden="true" class="filled-icon">
            <path d="M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19.05,51.56a15.92,15.92,0,0,1-29.88,0L78,178,26.42,158.94a15.92,15.92,0,0,1,0-29.88L78,110l19.05-51.56a15.92,15.92,0,0,1,29.88,0L146,110l51.56,19.05A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z" />
          </svg>
          {{ section.label }}
        </span>
        <h2>{{ section.title }}</h2>
        <p>{{ section.description }}</p>
      </div>
      <div
        class="feature-grid"
        :class="{
          'two-card-grid': section.cards.length === 2,
          'single-card': section.cards.length === 1,
          compact: section.compact,
        }"
      >
        <article v-for="card in section.cards" :key="card.title" class="feature-card">
          <div class="feature-card-title">
            <p>{{ card.title }}</p>
          </div>
          <div class="feature-image">
            <img :src="asset(card.image)" :alt="card.alt" />
          </div>
        </article>
      </div>
    </section>

    <section id="docs" class="docs-band">
      <div class="landing-container docs-inner">
        <div class="section-heading compact">
          <span class="section-label">Documentation</span>
          <h2>Learn the app the way it is built</h2>
          <p>
            The docs sit in the app repo so product behavior, architecture, and
            user-facing guidance can evolve together.
          </p>
        </div>
        <div class="docs-grid">
          <a
            v-for="link in docsLinks"
            :key="link.title"
            class="docs-card"
            :href="route(link.link)"
          >
            <span class="docs-icon">
              <svg v-if="link.icon === 'rocket'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 16.5c-1 1-1.5 2.7-1.5 4.5 1.8 0 3.5-.5 4.5-1.5" />
                <path d="M9 15 15 9" />
                <path d="M15 4.5c2-.7 4-.8 6-.5.3 2 .2 4-.5 6L15 15l-6-6z" />
                <path d="M9 15H5l4-6v6z" />
                <path d="M15 9v6l-6 4v-4" />
              </svg>
              <svg v-else-if="link.icon === 'network'" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="12" cy="18" r="3" />
                <path d="M8.6 7.6 10.8 15" />
                <path d="M15.4 7.6 13.2 15" />
                <path d="M9 6h6" />
              </svg>
              <svg v-else-if="link.icon === 'workflow'" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="6" height="6" rx="1.5" />
                <rect x="15" y="14" width="6" height="6" rx="1.5" />
                <path d="M9 7h3a3 3 0 0 1 3 3v4" />
                <path d="m12 11 3 3 3-3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </span>
            <h3>{{ link.title }}</h3>
            <p>{{ link.text }}</p>
          </a>
        </div>
      </div>
    </section>

    <section id="about" class="about-section">
      <div class="landing-container">
        <div class="section-heading">
          <span class="section-label">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
            </svg>
            Made with Love
          </span>
          <h2>Built by Luca, for Luca</h2>
          <p>
            Tolaria is the product of the learnings from 5 years of full-time
            content creation. I published 300+ articles and organized my
            knowledge into 9000+ notes.
          </p>
        </div>

        <div class="author-card">
          <div class="author-image">
            <img :src="asset('Luca hello.jpeg')" alt="Luca" />
          </div>
          <div class="author-copy">
            <div class="author-heading">
              <h3>Hey, I am Luca &#x1F44B;</h3>
              <p>
                Founder & Author of
                <a href="https://refactoring.fm">Refactoring</a>
              </p>
            </div>
            <p>
              Tolaria is born from 5 years of full-time writing at Refactoring,
              during which I have written 300+ articles about software
              engineering and developer productivity. Along the way, I amassed
              9000+ notes on my Notion workspace, learned a lot about knowledge
              management, productivity, and, more recently, on working well with
              AI on docs. None of the existing tools matched what I wanted, so I
              built one myself.
            </p>
            <div class="author-stats">
              <div>
                <strong>5 years</strong>
                <span>full-time writing</span>
              </div>
              <div>
                <strong>300+</strong>
                <span>articles published</span>
              </div>
              <div>
                <strong>170,000+</strong>
                <span>newsletter subscribers</span>
              </div>
            </div>
          </div>
        </div>

        <div class="testimonial-grid">
          <article v-for="testimonial in testimonials" :key="testimonial.name">
            <p>"{{ testimonial.quote }}"</p>
            <div class="testimonial-person">
              <img :src="asset(testimonial.image)" :alt="testimonial.alt" />
              <div>
                <strong>{{ testimonial.name }}</strong>
                <span>{{ testimonial.role }}</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="final-cta">
      <div class="landing-container final-cta-inner">
        <h2>Stay in the loop.</h2>
        <p>
          Subscribe to the Refactoring newsletter for updates on Tolaria, new
          features, and behind-the-scenes of building in public.
        </p>
        <a class="landing-button primary" href="https://refactoring.fm">
          Subscribe to Refactoring
        </a>
        <span>170,000+ engineers already subscribed</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.tolaria-landing {
  --landing-bg: var(--tolaria-bg);
  --landing-surface: var(--tolaria-surface);
  --landing-dark: #1a1a18;
  --landing-text: var(--tolaria-text);
  --landing-muted: var(--tolaria-text-secondary);
  --landing-tertiary: var(--tolaria-text-muted);
  --landing-border: var(--tolaria-border);
  --landing-subtle: var(--tolaria-surface-muted);
  --landing-blue: #155dff;
  --landing-blue-hover: #4a5ad6;
  --landing-accent: var(--landing-blue);
  --landing-blue-soft: var(--tolaria-blue-soft);
  --landing-blue-border: color-mix(in srgb, var(--landing-accent) 20%, transparent);
  --landing-page-width: 1280px;
  color: var(--landing-text);
  background: var(--landing-bg);
}

.landing-container {
  width: min(100%, var(--landing-page-width));
  margin: 0 auto;
  padding-right: 20px;
  padding-left: 20px;
}

.hero-section {
  padding-top: 40px;
  padding-bottom: 52px;
}

.hero-section h1 {
  max-width: 760px;
  margin: 0;
  color: var(--landing-text);
  font-size: 28px;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.2;
}

.hero-lede {
  max-width: 900px;
  margin: 12px 0 0;
  color: var(--landing-muted);
  font-size: 20px;
  letter-spacing: 0;
  line-height: 1.4;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 24px;
}

.landing-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 12px 24px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--landing-text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0;
  text-decoration: none;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}

.landing-button svg {
  width: 20px;
  height: 20px;
  margin-right: 8px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.landing-button.primary {
  color: #fff;
  background: var(--landing-blue);
}

.landing-button.primary:hover {
  color: #fff;
  background: var(--landing-blue-hover);
}

.landing-button.secondary {
  border-color: var(--landing-border);
  background: var(--landing-surface);
}

.landing-button.secondary:hover {
  color: var(--landing-blue);
  border-color: rgba(21, 93, 255, 0.3);
}

.hero-note {
  margin: 16px 0 0;
  color: var(--landing-tertiary);
  font-size: 14px;
}

.hero-screenshot {
  padding-bottom: 56px;
}

.screenshot-field {
  overflow: hidden;
  padding: 24px 16px 16px;
  border-radius: 12px;
  background-position: center;
  background-size: cover;
}

.screenshot-frame {
  position: relative;
  width: min(100%, 1160px);
  margin: 0 auto;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 12px 48px -4px rgba(0, 0, 0, 0.3);
  user-select: none;
}

.screenshot-image {
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
}

.screenshot-image.dark {
  display: none;
}

.feature-section {
  padding-top: 56px;
}

.feature-section:last-of-type {
  padding-bottom: 72px;
}

.section-heading {
  max-width: 980px;
  margin-bottom: 32px;
  padding-left: 4px;
}

.section-heading.compact {
  margin-bottom: 0;
}

.section-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  color: var(--landing-accent);
  background: var(--landing-blue-soft);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
}

.section-label svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.section-label .filled-icon,
.section-label .filled-icon path,
.about-section .section-label svg {
  fill: currentColor;
  stroke: none;
}

.section-heading h2,
.final-cta h2 {
  margin: 12px 0 0;
  color: var(--landing-text);
  font-size: 24px;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.12;
}

.section-heading p,
.final-cta p {
  max-width: 960px;
  margin: 12px 0 0;
  color: var(--landing-muted);
  font-size: 18px;
  letter-spacing: 0;
  line-height: 1.55;
}

.feature-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.feature-card {
  display: flex;
  height: 260px;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--landing-blue-border);
  border-radius: 12px;
  background: var(--landing-blue-soft);
}

.feature-card-title {
  padding: 16px 16px 10px;
}

.feature-card-title p {
  margin: 0;
  color: var(--landing-accent);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.3;
}

.feature-image {
  overflow: hidden;
  flex: 1;
  margin: 0 16px;
  border: 1px solid var(--landing-blue-border);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: #fff;
}

.feature-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}

.feature-grid.single-card .feature-card {
  height: auto;
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
}

.feature-grid.single-card .feature-image img {
  height: auto;
}

.docs-band {
  padding: 72px 0;
  border-top: 1px solid var(--landing-border);
  border-bottom: 1px solid var(--landing-border);
  background: var(--landing-surface);
}

.docs-inner {
  display: grid;
  grid-template-columns: 1fr;
  gap: 32px;
}

.docs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.docs-card {
  min-height: 196px;
  padding: 22px;
  border: 1px solid var(--landing-border);
  border-radius: 8px;
  color: var(--landing-text);
  background: var(--landing-bg);
  text-decoration: none;
}

.docs-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-bottom: 24px;
  border-radius: 8px;
  color: var(--landing-accent);
  background: var(--landing-blue-soft);
}

.docs-icon svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.docs-card h3 {
  margin: 0;
  color: var(--landing-text);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0;
}

.docs-card p {
  margin: 10px 0 0;
  color: var(--landing-muted);
  font-size: 15px;
  line-height: 1.5;
}

.about-section {
  padding: 56px 0;
  border-top: 1px solid var(--landing-border);
  background: var(--landing-surface);
}

.author-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  margin-bottom: 32px;
  border: 1px solid var(--landing-border);
  border-radius: 12px;
  background: var(--landing-bg);
}

.author-image {
  width: 100%;
  height: 280px;
  overflow: hidden;
  border-radius: 8px;
}

.author-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.author-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  padding: 16px 8px;
}

.author-heading {
  margin-bottom: 16px;
}

.author-heading h3 {
  margin: 0;
  color: var(--landing-text);
  font-size: 24px;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.15;
}

.author-heading p {
  margin: 4px 0 0;
  color: var(--landing-accent);
  font-size: 16px;
  font-weight: 650;
}

.author-heading a {
  color: inherit;
  text-decoration: underline;
}

.author-copy > p {
  margin: 0;
  color: var(--landing-muted);
  font-size: 16px;
  letter-spacing: 0;
  line-height: 1.5;
}

.author-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-top: 24px;
}

.author-stats strong {
  display: block;
  color: var(--landing-text);
  font-size: 20px;
  font-weight: 750;
  line-height: 1;
}

.author-stats span {
  display: block;
  margin-top: 4px;
  color: var(--landing-tertiary);
  font-size: 13px;
}

.testimonial-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.testimonial-grid article {
  padding: 20px;
  border: 1px solid var(--landing-border);
  border-radius: 12px;
  background: var(--landing-bg);
}

.testimonial-grid article > p {
  margin: 0 0 16px;
  color: var(--landing-text);
  font-size: 14px;
  line-height: 1.55;
}

.testimonial-person {
  display: flex;
  align-items: center;
  gap: 12px;
}

.testimonial-person img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.testimonial-person strong,
.testimonial-person span {
  display: block;
}

.testimonial-person strong {
  color: var(--landing-text);
  font-size: 14px;
  font-weight: 700;
}

.testimonial-person span {
  color: var(--landing-tertiary);
  font-size: 13px;
}

.final-cta {
  padding: 64px 0;
  background: var(--landing-dark);
}

.final-cta-inner {
  display: flex;
  align-items: center;
  flex-direction: column;
  text-align: center;
}

.final-cta h2 {
  color: #f7f7f4;
  font-size: 30px;
}

.final-cta p {
  max-width: 720px;
  color: #a0a098;
  font-size: 16px;
}

.final-cta .landing-button {
  width: auto;
  margin-top: 20px;
}

.final-cta span {
  margin-top: 20px;
  color: #a0a098;
  font-size: 13px;
}

@media (min-width: 640px) {
  .hero-actions {
    align-items: center;
    flex-direction: row;
  }

  .landing-button {
    width: auto;
  }
}

@media (min-width: 768px) {
  .landing-container {
    padding-right: 40px;
    padding-left: 40px;
  }

  .hero-section {
    padding-top: 64px;
    padding-bottom: 84px;
  }

  .hero-section h1 {
    max-width: 960px;
    font-size: 36px;
  }

  .hero-lede {
    max-width: 820px;
    font-size: 24px;
  }

  .hero-note {
    font-size: 14px;
  }

  .landing-button {
    min-height: 42px;
    padding: 10px 20px;
    font-size: 14px;
  }

  .landing-button svg {
    width: 18px;
    height: 18px;
  }

  .screenshot-field {
    padding: 56px 48px 40px;
    border-radius: 16px;
  }

  .feature-section {
    padding-top: 80px;
  }

  .feature-section:last-of-type {
    padding-bottom: 80px;
  }

  .section-heading {
    margin-bottom: 40px;
    padding-left: 8px;
  }

  .section-heading h2 {
    font-size: 36px;
  }

  .section-heading p {
    font-size: 24px;
  }

  .feature-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .feature-grid.two-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .feature-grid.single-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .feature-card {
    height: 380px;
  }

  .feature-grid.compact .feature-card {
    height: 360px;
  }

  .feature-card-title {
    padding: 20px 20px 12px;
  }

  .feature-image {
    margin-right: 20px;
    margin-left: 20px;
  }

  .docs-inner {
    grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr);
    gap: 40px;
  }

  .docs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .about-section {
    padding: 80px 0;
  }

  .author-card {
    flex-direction: row;
    gap: 20px;
    padding: 20px;
    margin-bottom: 48px;
  }

  .author-image {
    width: 360px;
    height: 420px;
    flex-shrink: 0;
  }

  .author-copy {
    padding: 40px 48px;
  }

  .author-heading h3 {
    font-size: 28px;
  }

  .author-heading p,
  .author-copy > p {
    font-size: 18px;
  }

  .author-stats {
    gap: 32px;
    margin-top: 32px;
  }

  .author-stats strong {
    font-size: 24px;
  }

  .testimonial-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  .testimonial-grid article {
    padding: 28px;
  }

  .testimonial-grid article > p {
    font-size: 15px;
  }

  .final-cta {
    padding: 96px 0;
  }

  .final-cta h2 {
    font-size: 48px;
  }

  .final-cta p {
    font-size: 20px;
  }
}
</style>

<style>
.dark .tolaria-landing {
  --landing-accent: #9bbeff;
  --landing-blue-soft: rgba(120, 164, 255, 0.24);
  --landing-blue-border: rgba(120, 164, 255, 0.38);
}

.dark .tolaria-landing .screenshot-image.light {
  display: none;
}

.dark .tolaria-landing .screenshot-image.dark {
  display: block;
}
</style>
