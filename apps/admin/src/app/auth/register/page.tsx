// MultiWA Admin - Register Page
// apps/admin/src/app/auth/register/page.tsx

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, UserPlus } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';

export default function RegisterPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      organizationName: formData.get('organizationName') as string,
    };

    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || t('auth.register.error'));
      }

      // Store tokens and redirect
      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('refreshToken', result.refreshToken);
      localStorage.setItem('user', JSON.stringify(result.user));

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Subtle ambient glow */}
      <div
        className="pointer-events-none absolute -top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/10 blur-3xl rounded-full"
        aria-hidden="true"
      />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden ring-1 ring-border bg-card">
              <Image src="/logo.png" alt="MultiWA" width={48} height={48} className="object-contain" />
            </div>
            <span className="text-2xl font-bold text-foreground tracking-tight">
              MultiWA
            </span>
          </Link>
        </div>

        {/* Card */}
        <div className="bg-card rounded-3xl p-8 shadow-2xl shadow-black/40 border border-border">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t('auth.register.title')}
          </h1>
          <p className="text-muted-foreground mb-8">
            {t('auth.register.subtitle')}
          </p>

          {error && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="organizationName" className="block text-sm font-medium text-foreground mb-2">
                {t('auth.register.orgName')}
              </label>
              <input
                id="organizationName"
                type="text"
                name="organizationName"
                required
                autoComplete="organization"
                className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-all"
                placeholder="My Company"
              />
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
                {t('auth.register.fullName')}
              </label>
              <input
                id="name"
                type="text"
                name="name"
                required
                autoComplete="name"
                className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-all"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                {t('auth.register.email')}
              </label>
              <input
                id="email"
                type="email"
                name="email"
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-all"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
                {t('auth.register.password')}
              </label>
              <input
                id="password"
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-all"
                placeholder="••••••••"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('auth.register.passwordHint')}
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 mw-spin" aria-hidden="true" />
                  {t('auth.register.creatingAccount')}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <UserPlus className="w-5 h-5" aria-hidden="true" />
                  {t('auth.register.createAccount')}
                </span>
              )}
            </button>

            <p className="text-xs text-center text-muted-foreground">
              {t('auth.register.terms')}{' '}
              <a href="#" className="text-primary hover:underline">{t('auth.register.termsLink')}</a> {t('auth.register.and')}{' '}
              <a href="#" className="text-primary hover:underline">{t('auth.register.privacyLink')}</a>
            </p>
          </form>
        </div>

        <p className="text-center mt-6 text-muted-foreground">
          {t('auth.register.haveAccount')}{' '}
          <Link href="/auth/login" className="text-primary hover:text-primary/80 font-medium">
            {t('auth.register.signIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
