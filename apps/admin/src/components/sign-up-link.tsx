// MultiWA Admin - the landing page's sign-up link
// apps/admin/src/components/sign-up-link.tsx

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';

// Registration closes after the server's first user: until the server says it is open, the link signs in instead,
// or is left out where a sign-in link already sits beside it.
export function SignUpLink({ label, className, iconClassName, hideWhenClosed }: {
  label: string;
  className: string;
  iconClassName: string;
  hideWhenClosed?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.registration().then((res) => setOpen(res.data?.open === true));
  }, []);

  if (!open && hideWhenClosed) return null;
  return (
    <Link href={open ? '/auth/register' : '/auth/login'} className={className}>
      {open ? label : 'Sign in'}
      <ArrowRight className={iconClassName} aria-hidden="true" />
    </Link>
  );
}
