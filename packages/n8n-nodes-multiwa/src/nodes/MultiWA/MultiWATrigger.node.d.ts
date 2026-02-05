import { IHookFunctions, IWebhookFunctions, INodeType, INodeTypeDescription, IWebhookResponseData } from 'n8n-workflow';
export declare class MultiWATrigger implements INodeType {
    description: INodeTypeDescription;
    webhook(this: IWebhookFunctions): Promise<IWebhookResponseData>;
    webhookMethods: {
        default: {
            checkExists(this: IHookFunctions): Promise<boolean>;
            create(this: IHookFunctions): Promise<boolean>;
            delete(this: IHookFunctions): Promise<boolean>;
        };
    };
}
//# sourceMappingURL=MultiWATrigger.node.d.ts.map