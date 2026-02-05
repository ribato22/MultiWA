// MultiWA Admin - Login Page with 2FA Support
// apps/admin/src/app/auth/login/page.tsx

'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-green-50 dark:from-gray-950 dark:via-gray-900 dark:to-emerald-950 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden">
              <Image src="/logo.png" alt="MultiWA" width={48} height={48} className="object-contain" />
            </div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              MultiWA
            </span>
          </Link>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-800/50 rounded-3xl p-8 shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800">
          
          {verified ? (
            /* ========== Verified Success Screen ========== */
            <div className="py-8 text-center animate-fade-in">
              <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30" style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Verified!</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Redirecting to dashboard...</p>
              <div className="mt-4 flex justify-center">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          ) : requires2FA ? (
            /* ========== 2FA Verification Step ========== */
            <div className="animate-fade-in">
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-100 to-green-100 dark:from-emerald-900/30 dark:to-green-900/30 flex items-center justify-center">
                  <svg className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Two-Factor Authentication
                </h1>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  {useBackupCode 
                    ? 'Enter one of your backup codes to verify your identity' 
                    : 'Enter the 6-digit code from your authenticator app'}
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                  {error}
                </div>
              )}

              {useBackupCode ? (
                /* Backup Code Input */
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Backup Code
                    </label>
                    <input
                      type="text"
                      value={backupCode}
                      onChange={e => setBackupCode(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all font-mono text-center text-lg tracking-widest"
                      placeholder="XXXXXXXX"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={() => handle2FAVerify()}
                    disabled={loading || !backupCode}
                    className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        Verifying...
                      </span>
                    ) : 'Verify Backup Code'}
                  </button>
                  <button
                    onClick={() => { setUseBackupCode(false); setBackupCode(''); setError(''); }}
                    className="w-full text-sm text-emerald-600 hover:text-emerald-700 font-medium"
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
                        className="w-12 h-14 text-center text-xl font-bold rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none"
                        disabled={loading}
                      />
                    ))}
                  </div>
                  
                  <button
                    onClick={() => handle2FAVerify()}
                    disabled={loading || totpDigits.join('').length !== 6}
                    className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        Verifying...
                      </span>
                    ) : 'Verify'}
                  </button>

                  <div className="flex items-center justify-between text-sm">
                    <button
                      onClick={() => { setUseBackupCode(true); setError(''); setTotpDigits(['', '', '', '', '', '']); }}
                      className="text-emerald-600 hover:text-emerald-700 font-medium"
                    >
                      Use backup code
                    </button>
                    <button
                      onClick={() => { setRequires2FA(false); setError(''); setTotpDigits(['', '', '', '', '', '']); setUserId(''); }}
                      className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      ← Back to login
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ========== Normal Login Form ========== */
            <>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Welcome back
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mb-8">
                Sign in to your account to continue
              </p>

              {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Email address
                  </label>
                  <input
                    type="email"
                    name="email"
                    required
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    placeholder="you@company.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    name="password"
                    required
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    placeholder="••••••••"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Remember me</span>
                  </label>
                  <a href="#" className="text-sm text-emerald-600 hover:text-emerald-700">
                    Forgot password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      Signing in...
                    </span>
                  ) : 'Sign in'}
                </button>
              </form>
            </>
          )}
        </div>

        {!requires2FA && (
          <p className="text-center mt-6 text-gray-600 dark:text-gray-400">
            Don&apos;t have an account?{' '}
            <Link href="/auth/register" className="text-emerald-600 hover:text-emerald-700 font-medium">
              Create one
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
