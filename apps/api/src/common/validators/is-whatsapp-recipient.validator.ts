// MultiWA Gateway - IsWhatsAppRecipient class-validator decorator
// apps/api/src/common/validators/is-whatsapp-recipient.validator.ts
//
// Thin class-validator wrapper over the shared core predicate isWhatsAppRecipient.
// The actual accept/reject logic lives in @multiwa/core so the DTO gate and the
// normalizeJid guards (apps/api + apps/worker) share one source of truth.

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isWhatsAppRecipient } from '@multiwa/core';

@ValidatorConstraint({ name: 'isWhatsAppRecipient', async: false })
export class IsWhatsAppRecipientConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isWhatsAppRecipient(value);
  }

  defaultMessage(): string {
    return (
      '$property must be a WhatsApp phone number (7-15 digits, separators allowed) ' +
      'or a JID ending in @s.whatsapp.net, @c.us, @g.us, @lid, @broadcast, or @newsletter'
    );
  }
}

export function IsWhatsAppRecipient(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsWhatsAppRecipientConstraint,
    });
  };
}
