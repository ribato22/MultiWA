// MultiWA Admin - the landing page's sign-up link
// apps/admin/src/components/sign-up-link.tsx

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';

// Registration closes after the server's first user: until the server says it is open, the link signs in instead.
export function SignUpLink({ label, className, iconClassName }: { label: string; className: string; iconClassName: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.registration().then((res) => setOpen(res.data?.open === true));
  }, []);

  return (
    <Link href={open ? '/auth/register' : '/auth/login'} className={className}>
      {open ? label : 'Sign in'}
      <ArrowRight className={iconClassName} aria-hidden="true" />
    </Link>
  );
}
