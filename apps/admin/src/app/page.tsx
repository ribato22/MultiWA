// MultiWA Admin - Landing Page
// apps/admin/src/app/page.tsx

import Link from 'next/link';
import Image from 'next/image';
import {
  Plug,
  Megaphone,
  Bot,
  Building2,
  Webhook as WebhookIcon,
  BarChart3,
  Github,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';

type Feature = { Icon: LucideIcon; tone: string; title: string; description: string };

const features: Feature[] = [
  {
    Icon: Plug,
    tone: 'text-primary',
    title: 'Multi-Engine',
    description: 'Choose between whatsapp-web.js (stable) or Baileys (performance) per profile.',
  },
  {
    Icon: Megaphone,
    tone: 'text-violet-300',
    title: 'Broadcast',
    description: 'Send bulk messages with scheduling, rate limiting, and smart delays.',
  },
  {
    Icon: Bot,
    tone: 'text-sky-300',
    title: 'Automation',
    description: 'Rule-based autoreplies, keyword triggers, and AI bot integration.',
  },
  {
    Icon: Building2,
    tone: 'text-amber-300',
    title: 'Multi-Tenant',
    description: 'Organizations, workspaces, and RBAC for enterprise deployments.',
  },
  {
    Icon: WebhookIcon,
    tone: 'text-rose-300',
    title: 'Webhooks',
    description: 'Real-time event delivery with HMAC signing and retry logic.',
  },
  {
    Icon: BarChart3,
    tone: 'text-orange-300',
    title: 'Analytics',
    description: 'Message stats, broadcast reports, and automation performance.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Ambient glows — pure CSS */}
      <div
        className="pointer-events-none absolute -top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 blur-3xl rounded-full"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-1/2 -right-32 w-[400px] h-[400px] bg-sky-500/5 blur-3xl rounded-full"
        aria-hidden="true"
      />

      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-card ring-1 ring-border flex items-center justify-center overflow-hidden">
              <Image src="/logo.png" alt="MultiWA" width={40} height={40} className="object-contain" />
            </div>
            <span className="text-xl font-bold text-foreground tracking-tight">
              MultiWA
            </span>
          </Link>
          <nav className="flex items-center gap-3" aria-label="Primary">
            <Link
              href="/auth/login"
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg"
            >
              Login
            </Link>
            <Link
              href="/auth/register"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
            >
              Get Started
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="pt-24 relative z-10">
        <section className="container mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary text-sm font-medium mb-8">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            Open Source · Self-Hosted · Multi-Engine
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 text-foreground">
            WhatsApp Gateway
            <br />
            <span className="text-primary">for Everyone</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            The most complete open-source WhatsApp Business API gateway.
            Multi-engine support, broadcast, automation, and enterprise-ready features.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/auth/register"
              className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground font-semibold rounded-2xl hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/25 transform hover:-translate-y-0.5 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
            >
              Start Free Trial
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </Link>
            <a
              href="https://github.com/ribato22/MultiWA"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 bg-card text-foreground font-semibold rounded-2xl border border-border hover:border-primary/40 hover:shadow-lg transform hover:-translate-y-0.5 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Github className="w-5 h-5" aria-hidden="true" />
              View on GitHub
            </a>
          </div>
        </section>

        {/* Features Grid */}
        <section className="container mx-auto px-6 py-20">
          <div className="grid md:grid-cols-3 gap-6">
            {features.map((feature, i) => {
              const Icon = feature.Icon;
              return (
                <div
                  key={i}
                  className="group p-8 rounded-3xl bg-card border border-border hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all"
                >
                  <div
                    className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/60 ring-1 ring-border ${feature.tone}`}
                  >
                    <Icon className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-foreground group-hover:text-primary transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border relative z-10">
        <div className="container mx-auto px-6 py-8 text-center text-sm text-muted-foreground">
          <p>© 2026 MultiWA. Open Source under MIT License.</p>
        </div>
      </footer>
    </div>
  );
}
