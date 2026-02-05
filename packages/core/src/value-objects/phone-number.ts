// MultiWA Gateway Core - Phone Number Value Object
// packages/core/src/value-objects/phone-number.ts

export class PhoneNumber {
  private readonly value: string;

  constructor(phone: string) {
    this.value = this.normalize(phone);
    if (!this.isValid()) {
      throw new Error(`Invalid phone number: ${phone}`);
    }
  }

  private normalize(phone: string): string {
    // Remove all non-numeric characters
    let normalized = phone.replace(/\D/g, '');
    
    // Handle Indonesian numbers
    if (normalized.startsWith('0')) {
      normalized = '62' + normalized.slice(1);
    }
    
    // Ensure it has country code
    if (!normalized.startsWith('62') && normalized.length <= 12) {
      normalized = '62' + normalized;
    }
    
    return normalized;
  }

  private isValid(): boolean {
    // Basic validation: must be between 10 and 15 digits
    return this.value.length >= 10 && this.value.length <= 15;
  }

  toString(): string {
    return this.value;
  }

  toJid(): string {
    return `${this.value}@s.whatsapp.net`;
  }

  toFormatted(): string {
    return `+${this.value}`;
  }

  equals(other: PhoneNumber): boolean {
    return this.value === other.value;
  }
}
