// MultiWA Gateway Core - JID Value Object
// packages/core/src/value-objects/jid.ts

export type JidType = 'user' | 'group' | 'broadcast' | 'status';

export class Jid {
  private readonly value: string;
  private readonly type: JidType;

  constructor(jid: string) {
    this.value = jid;
    this.type = this.detectType(jid);
  }

  private detectType(jid: string): JidType {
    if (jid.endsWith('@g.us')) return 'group';
    if (jid.endsWith('@broadcast')) return 'broadcast';
    if (jid.includes('status')) return 'status';
    return 'user';
  }

  toString(): string {
    return this.value;
  }

  getType(): JidType {
    return this.type;
  }

  getPhone(): string {
    return this.value.split('@')[0];
  }

  isGroup(): boolean {
    return this.type === 'group';
  }

  isUser(): boolean {
    return this.type === 'user';
  }

  static fromPhone(phone: string): Jid {
    const normalized = phone.replace(/\D/g, '');
    return new Jid(`${normalized}@s.whatsapp.net`);
  }

  static fromGroup(groupId: string): Jid {
    return new Jid(`${groupId}@g.us`);
  }
}
