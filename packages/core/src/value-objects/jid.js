"use strict";
// MultiWA Gateway Core - JID Value Object
// packages/core/src/value-objects/jid.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.Jid = void 0;
class Jid {
    value;
    type;
    constructor(jid) {
        this.value = jid;
        this.type = this.detectType(jid);
    }
    detectType(jid) {
        if (jid.endsWith('@g.us'))
            return 'group';
        if (jid.endsWith('@broadcast'))
            return 'broadcast';
        if (jid.includes('status'))
            return 'status';
        return 'user';
    }
    toString() {
        return this.value;
    }
    getType() {
        return this.type;
    }
    getPhone() {
        return this.value.split('@')[0];
    }
    isGroup() {
        return this.type === 'group';
    }
    isUser() {
        return this.type === 'user';
    }
    static fromPhone(phone) {
        const normalized = phone.replace(/\D/g, '');
        return new Jid(`${normalized}@s.whatsapp.net`);
    }
    static fromGroup(groupId) {
        return new Jid(`${groupId}@g.us`);
    }
}
exports.Jid = Jid;
//# sourceMappingURL=jid.js.map