import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'MultiWA',
  tagline: 'Open Source WhatsApp Business API Gateway',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://ribato22.github.io',
  baseUrl: '/MultiWA/docs/',

  organizationName: 'ribato22',
  projectName: 'MultiWA',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/ribato22/MultiWA/tree/main/docs-site/',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/multiwa-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'MultiWA',
      logo: {
        alt: 'MultiWA Logo',
        src: 'img/multiwa-logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/ribato22/MultiWA',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Quick Start',
              to: '/getting-started/quick-start',
            },
            {
              label: 'API Reference',
              to: '/api/api-specification',
            },
            {
              label: 'Docker Deployment',
              to: '/operations/deployment-docker',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/ribato22/MultiWA/discussions',
            },
            {
              label: 'Report a Bug',
              href: 'https://github.com/ribato22/MultiWA/issues/new',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/ribato22/MultiWA',
            },
            {
              label: 'Dev.to',
              href: 'https://dev.to/ribato/building-multiwa-an-open-source-self-hosted-whatsapp-api-gateway-2me1',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} MultiWA. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'python', 'php', 'yaml', 'docker'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
