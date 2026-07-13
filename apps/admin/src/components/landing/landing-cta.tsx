'use client';

import Link from 'next/link';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { useI18n } from '@/lib/i18n/provider';

export function LandingCta() {
  const { t } = useI18n();

  return (
    <section className="landing-section" style={{ paddingBlock: '4rem' }}>
      <Banner
        status="success"
        container="card"
        title={t('landing.cta.title')}
        description={t('landing.cta.subtitle')}
        endContent={
          <Link href="/auth/register" style={{ textDecoration: 'none' }}>
            <Button label={t('landing.cta.button')} variant="primary" />
          </Link>
        }
      />
    </section>
  );
}
