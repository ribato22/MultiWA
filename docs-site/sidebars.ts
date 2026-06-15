import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/project-overview',
        'getting-started/requirements',
        'getting-started/quick-start',
      ],
    },
    {
      type: 'category',
      label: 'Guides & Examples',
      items: [
        'guides/examples',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/system-architecture',
        'architecture/database-design',
        'architecture/engine-abstraction',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/api-specification',
        'api/websocket-api',
        'api/webhook-events',
      ],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        'features/messaging',
        'features/groups',
        'features/automation',
      ],
    },
    {
      type: 'category',
      label: 'SDKs & Integrations',
      items: [
        'sdks/python-sdk',
        'sdks/php-sdk',
        'sdks/n8n-integration',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'operations/deployment-docker',
        'operations/development',
        'operations/configuration-reference',
        'operations/demo-mode',
        'operations/database-backup',
      ],
    },
  ],
};

export default sidebars;
