import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/**
 * Limits a string by its UTF-8 size instead of its character count.
 * bcrypt ignores everything after 72 bytes, and one Vietnamese character can take 3 bytes.
 */
export function MaxByteLength(max: number, options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'maxByteLength',
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [max],
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
      },
    });
  };
}
