"use strict";
// MultiWA Gateway SDK
// packages/sdk/src/index.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationClient = exports.WebhookClient = exports.BroadcastClient = exports.TemplateClient = exports.ConversationClient = exports.ContactClient = exports.MessageClient = exports.MultiWAClient = void 0;
var client_1 = require("./client");
Object.defineProperty(exports, "MultiWAClient", { enumerable: true, get: function () { return client_1.MultiWAClient; } });
var messages_1 = require("./clients/messages");
Object.defineProperty(exports, "MessageClient", { enumerable: true, get: function () { return messages_1.MessageClient; } });
var contacts_1 = require("./clients/contacts");
Object.defineProperty(exports, "ContactClient", { enumerable: true, get: function () { return contacts_1.ContactClient; } });
var conversations_1 = require("./clients/conversations");
Object.defineProperty(exports, "ConversationClient", { enumerable: true, get: function () { return conversations_1.ConversationClient; } });
var templates_1 = require("./clients/templates");
Object.defineProperty(exports, "TemplateClient", { enumerable: true, get: function () { return templates_1.TemplateClient; } });
var broadcast_1 = require("./clients/broadcast");
Object.defineProperty(exports, "BroadcastClient", { enumerable: true, get: function () { return broadcast_1.BroadcastClient; } });
var webhooks_1 = require("./clients/webhooks");
Object.defineProperty(exports, "WebhookClient", { enumerable: true, get: function () { return webhooks_1.WebhookClient; } });
var automation_1 = require("./clients/automation");
Object.defineProperty(exports, "AutomationClient", { enumerable: true, get: function () { return automation_1.AutomationClient; } });
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map