// MultiWA Admin - Login Page with 2FA Support
// apps/admin/src/app/auth/login/page.tsx

'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Check,
  ShieldCheck,
  AlertCircle,
  Loader2,
  ArrowLeft,
} from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 2FA state
  const [requires2FA, setRequires2FA] = useState(false);
  const [userId, setUserId] = useState('');
  const [totpDigits, setTotpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [verified, setVerified] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (requires2FA && !useBackupCode) {
      inputRefs.current[0]?.focus();
    }
  }, [requires2FA, useBackupCode]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || result.error?.message || 'Login failed');
      }

      const data = result.data || result;

      // Check if 2FA is required
      if (data.requires2FA) {
        setRequires2FA(true);
        setUserId(data.userId);
        setLoading(false);
        return;
      }

      // Store tokens and redirect
      if (data.accessToken || data.access_token) {
        localStorage.setItem('accessToken', data.accessToken || data.access_token);
        if (data.refreshToken || data.refresh_token) {
          localStorage.setItem('refreshToken', data.refreshToken || data.refresh_token);
        }
        if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
        window.location.href = '/dashboard';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    if (!/^[0-9]*$/.test(value)) return;

    const newDigits = [...totpDigits];

    // Handle paste of full code
    if (value.length > 1) {
      const digits = value.slice(0, 6).split('');
      digits.forEach((d, i) => { if (i < 6) newDigits[i] = d; });
      setTotpDigits(newDigits);
      const lastIndex = Math.min(digits.length, 5);
      inputRefs.current[lastIndex]?.focus();

      // Auto-submit if 6 digits pasted
      if (digits.length === 6) {
        setTimeout(() => handle2FAVerify(newDigits.join('')), 100);
      }
      return;
    }

    newDigits[index] = value;
    setTotpDigits(newDigits);

    // Auto-advance to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    const code = newDigits.join('');
    if (code.length === 6 && newDigits.every(d => d !== '')) {
      setTimeout(() => handle2FAVerify(code), 100);
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !totpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handle2FAVerify = async (codeOverride?: string) => {
    const code = codeOverride || (useBackupCode ? backupCode : totpDigits.join(''));
    if (!code || (!useBackupCode && code.length !== 6)) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/v1/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token: code }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || result.error?.message || 'Invalid verification code');
      }

      // Extract tokens - handle both wrapped {data: {accessToken...}} and direct {accessToken...}
      const data = result.data || result;
      const accessToken = data.accessToken || data.access_token;
      const refreshToken = data.refreshToken || data.refresh_token;
      const user = data.user;

      if (!accessToken) {
        console.error('2FA verify response:', JSON.stringify(result));
        throw new Error('Verification succeeded but no access token was returned. Please try logging in again.');
      }

      localStorage.setItem('accessToken', accessToken);
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
      if (user) localStorage.setItem('user', JSON.stringify(user));

      // Show success animation then redirect
      setVerified(true);
      setLoading(false);
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1200);
    } catch (err: any) {
      setError(err.message);
      // Reset digit inputs on error
      setTotpDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Subtle ambient glow — pure CSS, no library */}
      <div className="pointer-events-none absolute -top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/10 blur-3xl rounded-full" aria-hidden="true" />

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

          {verified ? (
            /* ========== Verified Success Screen ========== */
            <div className="py-8 text-center animate-fade-in">
              <div
                className="w-20 h-20 mx-auto mb-5 rounded-full bg-primary/15 border border-primary/30 text-primary flex items-center justify-center shadow-lg shadow-primary/20"
                style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
              >
                <Check className="w-10 h-10" aria-hidden="true" strokeWidth={3} />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">Verified</h2>
              <p className="text-muted-foreground text-sm">Redirecting to dashboard...</p>
              <div className="mt-4 flex justify-center">
                <Loader2 className="w-6 h-6 text-primary mw-spin" aria-hidden="true" />
              </div>
            </div>
          ) : requires2FA ? (
            /* ========== 2FA Verification Step ========== */
            <div className="animate-fade-in">
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/15 border border-primary/30 text-primary flex items-center justify-center">
                  <ShieldCheck className="w-8 h-8" aria-hidden="true" />
                </div>
                <h1 className="text-2xl font-bold text-foreground mb-2">
                  Two-Factor Authentication
                </h1>
                <p className="text-muted-foreground text-sm">
                  {useBackupCode
                    ? 'Enter one of your backup codes to verify your identity'
                    : 'Enter the 6-digit code from your authenticator app'}
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              {useBackupCode ? (
                /* Backup Code Input */
                <div className="space-y-5">
                  <div>
                    <label htmlFor="backup-code" className="block text-sm font-medium text-foreground mb-2">
                      Backup Code
                    </label>
                    <input
                      id="backup-code"
                      type="text"
                      value={backupCode}
                      onChange={e => setBackupCode(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-all font-mono text-center text-lg tracking-widest"
                      placeholder="XXXXXXXX"
                      autoFocus
                      aria-label="Backup code"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handle2FAVerify()}
                    disabled={loading || !backupCode}
                    className="w-full py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 mw-spin" aria-hidden="true" />
                        Verifying...
                      </span>
                    ) : 'Verify Backup Code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUseBackupCode(false); setBackupCode(''); setError(''); }}
                    className="w-full text-sm text-primary hover:text-primary/80 font-medium cursor-pointer"
                  >
                    Use authenticator app instead
                  </button>
                </div>
              ) : (
                /* TOTP 6-Digit Input */
                <div className="space-y-5">
                  <div className="flex justify-center gap-2.5">
                    {totpDigits.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => { inputRefs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={digit}
                        onChange={e => handleDigitChange(i, e.target.value)}
                        onKeyDown={e => handleDigitKeyDown(i, e)}
                        onPaste={e => {
                          e.preventDefault();
                          const paste = e.clipboardData.getData('text').replace(/\D/g, '');
                          handleDigitChange(0, paste);
                        }}
                        className="w-12 h-14 text-center text-xl font-bold rounded-xl border-2 border-border bg-secondary/40 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                        disabled={loading}
                        aria-label={`Digit ${i + 1} of 6`}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handle2FAVerify()}
                    disabled={loading || totpDigits.join('').length !== 6}
                    className="w-full py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 mw-spin" aria-hidden="true" />
                        Verifying...
                      </span>
                    ) : 'Verify'}
                  </button>

                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={() => { setUseBackupCode(true); setError(''); setTotpDigits(['', '', '', '', '', '']); }}
                      className="text-primary hover:text-primary/80 font-medium cursor-pointer"
                    >
                      Use backup code
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRequires2FA(false); setError(''); setTotpDigits(['', '', '', '', '', '']); setUserId(''); }}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      Back to login
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ========== Normal Login Form ========== */
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">
                Welcome back
              </h1>
              <p className="text-muted-foreground mb-8">
                Sign in to your account to continue
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
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                    Email address
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
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    name="password"
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-all"
                    placeholder="••••••••"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                    <span className="text-sm text-muted-foreground">Remember me</span>
                  </label>
                  <a href="#" className="text-sm text-primary hover:text-primary/80">
                    Forgot password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 mw-spin" aria-hidden="true" />
                      Signing in...
                    </span>
                  ) : 'Sign in'}
                </button>
              </form>
            </>
          )}
        </div>

        {!requires2FA && (
          <p className="text-center mt-6 text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href="/auth/register" className="text-primary hover:text-primary/80 font-medium">
              Create one
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
