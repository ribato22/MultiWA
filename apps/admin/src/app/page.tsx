// MultiWA Admin - Landing Page
// apps/admin/src/app/page.tsx

import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-green-50 dark:from-gray-950 dark:via-gray-900 dark:to-emerald-950">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 glass border-b border-white/20">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
              MultiWA
            </span>
          </div>
          <nav className="flex items-center gap-4">
            <Link 
              href="/auth/login" 
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors"
            >
              Login
            </Link>
            <Link 
              href="/auth/register"
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-medium rounded-xl hover:shadow-lg hover:shadow-emerald-500/25 transition-all"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="pt-24">
        <section className="container mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium mb-8">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Open Source • Self-Hosted • Multi-Engine
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
            <span className="bg-gradient-to-r from-gray-900 via-emerald-700 to-green-700 dark:from-white dark:via-emerald-400 dark:to-green-400 bg-clip-text text-transparent">
              WhatsApp Gateway
            </span>
            <br />
            <span className="text-gray-900 dark:text-white">for Everyone</span>
          </h1>
          
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-12">
            The most complete open-source WhatsApp Business API gateway. 
            Multi-engine support, broadcast, automation, and enterprise-ready features.
          </p>
          
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/auth/register"
              className="px-8 py-4 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-2xl hover:shadow-xl hover:shadow-emerald-500/25 transform hover:-translate-y-1 transition-all"
            >
              Start Free Trial
            </Link>
            <a
              href="https://github.com/ribato22/MultiWA"
              target="_blank"
              className="px-8 py-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-semibold rounded-2xl border border-gray-200 dark:border-gray-700 hover:shadow-lg transform hover:-translate-y-1 transition-all flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              View on GitHub
            </a>
          </div>
        </section>

        {/* Features Grid */}
        <section className="container mx-auto px-6 py-20">
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: '🔌',
                title: 'Multi-Engine',
                description: 'Choose between whatsapp-web.js (stable) or Baileys (performance) per profile.',
              },
              {
                icon: '📢',
                title: 'Broadcast',
                description: 'Send bulk messages with scheduling, rate limiting, and smart delays.',
              },
              {
                icon: '🤖',
                title: 'Automation',
                description: 'Rule-based autoreplies, keyword triggers, and AI bot integration.',
              },
              {
                icon: '🏢',
                title: 'Multi-Tenant',
                description: 'Organizations, workspaces, and RBAC for enterprise deployments.',
              },
              {
                icon: '🔗',
                title: 'Webhooks',
                description: 'Real-time event delivery with HMAC signing and retry logic.',
              },
              {
                icon: '📊',
                title: 'Analytics',
                description: 'Message stats, broadcast reports, and automation performance.',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="group p-8 rounded-3xl bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 hover:shadow-xl hover:shadow-emerald-500/5 hover:border-emerald-200 dark:hover:border-emerald-800 transition-all"
              >
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
                  {feature.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 dark:border-gray-800">
        <div className="container mx-auto px-6 py-8 text-center text-sm text-gray-500">
          <p>© 2026 MultiWA. Open Source under MIT License.</p>
        </div>
      </footer>
    </div>
  );
}
