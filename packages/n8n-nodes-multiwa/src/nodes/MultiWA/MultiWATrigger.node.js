"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiWATrigger = void 0;
class MultiWATrigger {
    description = {
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
    async webhook() {
        const req = this.getRequestObject();
        const body = req.body;
        const selectedEvent = this.getNodeParameter('event');
        const profileId = this.getNodeParameter('profileId', '');
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
            async checkExists() {
                // For now, we don't auto-register webhooks
                // User needs to manually configure webhook URL in MultiWA
                return true;
            },
            async create() {
                // Webhook creation is manual
                return true;
            },
            async delete() {
                // Webhook deletion is manual
                return true;
            },
        },
    };
}
exports.MultiWATrigger = MultiWATrigger;
//# sourceMappingURL=MultiWATrigger.node.js.map