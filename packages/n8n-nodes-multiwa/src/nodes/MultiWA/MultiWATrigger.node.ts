import {
  IHookFunctions,
  IWebhookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookResponseData,
} from 'n8n-workflow';

export class MultiWATrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'MultiWA Trigger',
    name: 'multiWATrigger',
    icon: 'file:multiwa.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["event"]}}',
    description: 'Triggers when WhatsApp events occur',
    defaults: {
      name: 'MultiWA Trigger',
    },
    inputs: [],
    outputs: ['main'],
    credentials: [
      {
        name: 'multiWAApi',
        required: true,
      },
    ],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        options: [
          {
            name: 'Message Received',
            value: 'message.received',
            description: 'Triggers when a new message is received',
          },
          {
            name: 'Message Sent',
            value: 'message.sent',
            description: 'Triggers when a message is sent',
          },
          {
            name: 'Message Delivered',
            value: 'message.delivered',
            description: 'Triggers when a message is delivered',
          },
          {
            name: 'Message Read',
            value: 'message.read',
            description: 'Triggers when a message is read',
          },
          {
            name: 'Connection Changed',
            value: 'connection.changed',
            description: 'Triggers when WhatsApp connection status changes',
          },
          {
            name: 'All Events',
            value: '*',
            description: 'Triggers on any event',
          },
        ],
        default: 'message.received',
        required: true,
      },
      {
        displayName: 'Profile ID',
        name: 'profileId',
        type: 'string',
        default: '',
        description: 'Filter events by profile ID (leave empty for all profiles)',
      },
    ],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const body = req.body;

    const selectedEvent = this.getNodeParameter('event') as string;
    const profileId = this.getNodeParameter('profileId', '') as string;

    // Filter by event type
    if (selectedEvent !== '*' && body.event !== selectedEvent) {
      return {
        noWebhookResponse: true,
      };
    }

    // Filter by profile ID if specified
    if (profileId && body.profileId !== profileId) {
      return {
        noWebhookResponse: true,
      };
    }

    return {
      workflowData: [
        [
          {
            json: body,
          },
        ],
      ],
    };
  }

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        // For now, we don't auto-register webhooks
        // User needs to manually configure webhook URL in MultiWA
        return true;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        // Webhook creation is manual
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        // Webhook deletion is manual
        return true;
      },
    },
  };
}
