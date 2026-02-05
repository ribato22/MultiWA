import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';

export class MultiWA implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'MultiWA',
    name: 'multiWA',
    icon: 'file:multiwa.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Send WhatsApp messages via MultiWA',
    defaults: {
      name: 'MultiWA',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'multiWAApi',
        required: true,
      },
    ],
    properties: [
      // Operation Selection
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Send Text',
            value: 'sendText',
            description: 'Send a text message',
            action: 'Send text message',
          },
          {
            name: 'Send Image',
            value: 'sendImage',
            description: 'Send an image message',
            action: 'Send image message',
          },
          {
            name: 'Send Video',
            value: 'sendVideo',
            description: 'Send a video message',
            action: 'Send video message',
          },
          {
            name: 'Send Document',
            value: 'sendDocument',
            description: 'Send a document/file',
            action: 'Send document',
          },
          {
            name: 'Send Location',
            value: 'sendLocation',
            description: 'Send a location',
            action: 'Send location',
          },
          {
            name: 'Send Contact',
            value: 'sendContact',
            description: 'Send a contact card',
            action: 'Send contact card',
          },
          {
            name: 'Send Poll',
            value: 'sendPoll',
            description: 'Send an interactive poll',
            action: 'Send poll',
          },
        ],
        default: 'sendText',
      },
      
      // Common Fields
      {
        displayName: 'Profile ID',
        name: 'profileId',
        type: 'string',
        default: '',
        required: true,
        description: 'WhatsApp profile ID to send from',
      },
      {
        displayName: 'To',
        name: 'to',
        type: 'string',
        default: '',
        required: true,
        description: 'Recipient phone number (with country code, e.g., 6281234567890)',
      },
      
      // Text Message Fields
      {
        displayName: 'Text',
        name: 'text',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: {
            operation: ['sendText'],
          },
        },
        description: 'The text message to send',
      },
      
      // Image Fields
      {
        displayName: 'Image URL',
        name: 'imageUrl',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendImage'],
          },
        },
        description: 'URL of the image to send',
      },
      {
        displayName: 'Caption',
        name: 'caption',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendImage', 'sendVideo'],
          },
        },
        description: 'Caption for the media',
      },
      
      // Video Fields
      {
        displayName: 'Video URL',
        name: 'videoUrl',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendVideo'],
          },
        },
        description: 'URL of the video to send',
      },
      
      // Document Fields
      {
        displayName: 'Document URL',
        name: 'documentUrl',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendDocument'],
          },
        },
        description: 'URL of the document to send',
      },
      {
        displayName: 'Filename',
        name: 'filename',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendDocument'],
          },
        },
        description: 'Filename for the document',
      },
      
      // Location Fields
      {
        displayName: 'Latitude',
        name: 'latitude',
        type: 'number',
        default: 0,
        displayOptions: {
          show: {
            operation: ['sendLocation'],
          },
        },
        description: 'Latitude of the location',
      },
      {
        displayName: 'Longitude',
        name: 'longitude',
        type: 'number',
        default: 0,
        displayOptions: {
          show: {
            operation: ['sendLocation'],
          },
        },
        description: 'Longitude of the location',
      },
      {
        displayName: 'Location Name',
        name: 'locationName',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendLocation'],
          },
        },
        description: 'Name of the location',
      },
      
      // Contact Fields
      {
        displayName: 'Contact Name',
        name: 'contactName',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendContact'],
          },
        },
        description: 'Name of the contact to send',
      },
      {
        displayName: 'Contact Phone',
        name: 'contactPhone',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendContact'],
          },
        },
        description: 'Phone number of the contact',
      },
      
      // Poll Fields
      {
        displayName: 'Question',
        name: 'question',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendPoll'],
          },
        },
        description: 'Poll question',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['sendPoll'],
          },
        },
        description: 'Poll options (comma-separated)',
      },
      {
        displayName: 'Allow Multiple Answers',
        name: 'allowMultipleAnswers',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: {
            operation: ['sendPoll'],
          },
        },
        description: 'Whether to allow multiple answer selections',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('multiWAApi');
    const apiUrl = credentials.apiUrl as string;
    const apiKey = credentials.apiKey as string;

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as string;
        const profileId = this.getNodeParameter('profileId', i) as string;
        const to = this.getNodeParameter('to', i) as string;

        let endpoint: string;
        let body: Record<string, unknown> = { profileId, to };

        switch (operation) {
          case 'sendText':
            endpoint = '/messages/text';
            body.text = this.getNodeParameter('text', i) as string;
            break;

          case 'sendImage':
            endpoint = '/messages/image';
            body.url = this.getNodeParameter('imageUrl', i) as string;
            body.caption = this.getNodeParameter('caption', i, '') as string;
            break;

          case 'sendVideo':
            endpoint = '/messages/video';
            body.url = this.getNodeParameter('videoUrl', i) as string;
            body.caption = this.getNodeParameter('caption', i, '') as string;
            break;

          case 'sendDocument':
            endpoint = '/messages/document';
            body.url = this.getNodeParameter('documentUrl', i) as string;
            body.filename = this.getNodeParameter('filename', i) as string;
            break;

          case 'sendLocation':
            endpoint = '/messages/location';
            body.latitude = this.getNodeParameter('latitude', i) as number;
            body.longitude = this.getNodeParameter('longitude', i) as number;
            body.name = this.getNodeParameter('locationName', i, '') as string;
            break;

          case 'sendContact':
            endpoint = '/messages/contact';
            body.contacts = [{
              name: this.getNodeParameter('contactName', i) as string,
              phone: this.getNodeParameter('contactPhone', i) as string,
            }];
            break;

          case 'sendPoll':
            endpoint = '/messages/poll';
            body.question = this.getNodeParameter('question', i) as string;
            body.options = (this.getNodeParameter('options', i) as unknown as string).split(',').map(o => o.trim());
            body.allowMultipleAnswers = this.getNodeParameter('allowMultipleAnswers', i) as boolean;
            break;

          default:
            throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
        }

        const response = await this.helpers.request({
          method: 'POST',
          uri: `${apiUrl}${endpoint}`,
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body,
          json: true,
        });

        returnData.push({
          json: response,
          pairedItem: { item: i },
        });

      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: (error as any).message },
            pairedItem: { item: i },
          });
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}
