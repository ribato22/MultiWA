"use strict";
// MultiWA Gateway Core - Phone Number Value Object
// packages/core/src/value-objects/phone-number.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneNumber = void 0;
class PhoneNumber {
    value;
    constructor(phone) {
        this.value = this.normalize(phone);
        if (!this.isValid()) {
            throw new Error(`Invalid phone number: ${phone}`);
        }
    }
    normalize(phone) {
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
    isValid() {
        // Basic validation: must be between 10 and 15 digits
        return this.value.length >= 10 && this.value.length <= 15;
    }
    toString() {
        return this.value;
    }
    toJid() {
        return `${this.value}@s.whatsapp.net`;
    }
    toFormatted() {
        return `+${this.value}`;
    }
    equals(other) {
        return this.value === other.value;
    }
}
exports.PhoneNumber = PhoneNumber;
//# sourceMappingURL=phone-number.js.map