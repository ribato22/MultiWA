"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiWAApi = void 0;
class MultiWAApi {
    name = 'multiWAApi';
    displayName = 'MultiWA API';
    documentationUrl = 'https://docs.multiwa.io';
    properties = [
        {
            displayName: 'API URL',
            name: 'apiUrl',
            type: 'string',
            default: 'https://your-instance.com/api',
            placeholder: 'https://your-multiwa-instance.com/api',
            description: 'The URL of your MultiWA API instance',
            required: true,
        },
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            description: 'Your MultiWA API key',
            required: true,
        },
        {
            displayName: 'Default Profile ID',
            name: 'defaultProfileId',
            type: 'string',
            default: '',
            description: 'Default WhatsApp profile ID to use (optional)',
        },
    ];
}
exports.MultiWAApi = MultiWAApi;
//# sourceMappingURL=MultiWAApi.credentials.js.map