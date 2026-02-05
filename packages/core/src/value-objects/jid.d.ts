export type JidType = 'user' | 'group' | 'broadcast' | 'status';
export declare class Jid {
    private readonly value;
    private readonly type;
    constructor(jid: string);
    private detectType;
    toString(): string;
    getType(): JidType;
    getPhone(): string;
    isGroup(): boolean;
    isUser(): boolean;
    static fromPhone(phone: string): Jid;
    static fromGroup(groupId: string): Jid;
}
//# sourceMappingURL=jid.d.ts.map