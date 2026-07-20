import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function Feature({emoji, title, description}: {emoji: string; title: string; description: string}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center" style={{fontSize: '3rem'}}>
        {emoji}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

const features = [
  {
    emoji: '📱',
    title: 'Multi-Session',
    description: 'Connect unlimited WhatsApp accounts through a single unified API. Each session runs independently with its own QR code authentication.',
  },
  {
    emoji: '🔌',
    title: 'Pluggable Engines',
    description: 'Per-profile engine selection: whatsapp-web.js (default) or the experimental Baileys adapter. Swap without rewriting your application code.',
  },
  {
    emoji: '🤖',
    title: 'AI & Automation',
    description: 'Visual drag-and-drop flow builder for automations. AI-powered auto-replies using OpenAI or Google AI knowledge base.',
  },
  {
    emoji: '🛡️',
    title: 'Enterprise-Ready',
    description: 'JWT authentication, API key management, webhooks, rate limiting, encryption at rest, and GDPR compliance built in.',
  },
  {
    emoji: '🐳',
    title: 'Docker Native',
    description: 'Production-ready Docker Compose setup with health checks. Clone, configure, and deploy in minutes.',
  },
  {
    emoji: '📦',
    title: 'Official SDKs',
    description: 'Ready-to-use SDKs for TypeScript, Python, and PHP. Plus n8n integration for no-code workflows.',
  },
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p style={{fontSize: '1.1rem', opacity: 0.9}}>
          Multi-engine • Self-hosted • Enterprise-ready
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/getting-started/quick-start">
            Get Started →
          </Link>
          <Link
            className="button button--outline button--lg"
            style={{marginLeft: '1rem', color: 'white', borderColor: 'white'}}
            href="https://github.com/ribato22/MultiWA">
            GitHub ⭐
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Open Source WhatsApp API Gateway"
      description="MultiWA is a fully self-hosted, open-source WhatsApp API gateway. Connect multiple WhatsApp numbers through a single unified API.">
      <HomepageHeader />
      <main>
        <section style={{padding: '4rem 0'}}>
          <div className="container">
            <div className="row">
              {features.map((feature, idx) => (
                <Feature key={idx} {...feature} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
