import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  type SupportedLocale,
  localizeMessageTree,
  resolveLocale,
  translateMessage,
} from '../observability/messages';

const supportedLocaleArbitrary = fc.constantFrom<SupportedLocale>(
  'en',
  'fr',
  'de',
);

describe('message localization properties', () => {
  it('resolveLocale chooses the supported locale with the highest quality value', () => {
    fc.assert(
      fc.property(
        supportedLocaleArbitrary,
        supportedLocaleArbitrary,
        fc.integer({ min: 51, max: 100 }),
        fc.integer({ min: 0, max: 50 }),
        (preferred, fallback, preferredQuality, fallbackQuality) => {
          fc.pre(preferred !== fallback);

          const header = [
            `${fallback};q=${fallbackQuality / 100}`,
            `${preferred};q=${preferredQuality / 100}`,
          ].join(', ');

          expect(resolveLocale(header)).toBe(preferred);
        },
      ),
    );
  });

  it('resolveLocale normalizes regional language tags', () => {
    fc.assert(
      fc.property(
        supportedLocaleArbitrary,
        fc.constantFrom('US', 'CA', 'CH', 'DE', 'FR'),
        (locale, region) => {
          expect(resolveLocale(`${locale}-${region}`)).toBe(locale);
        },
      ),
    );
  });

  it('resolveLocale falls back to the default locale when no supported candidate is present', () => {
    fc.assert(
      fc.property(fc.string(), (header) => {
        fc.pre(!/\b(?:en|fr|de)(?:-|;|,|\s|$)/i.test(header));

        expect(resolveLocale(header)).toBe(DEFAULT_LOCALE);
      }),
    );
  });

  it('translateMessage leaves unknown keys stable and formats known templates', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (suffix, details) => {
        const unknownKey = `property.unknown.${suffix}`;

        expect(translateMessage('en', unknownKey)).toBe(unknownKey);
        expect(
          translateMessage('en', 'http.parseError', { details }),
        ).toContain(details);
      }),
    );
  });

  it('localizeMessageTree localizes nested descriptors without mutating messageArgs', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (details, path) => {
        const messageArgs = { details };
        const tree = {
          error: {
            messageKey: 'http.parseError',
            messageArgs,
          },
          nested: [
            {
              messageKey: 'http.routeNotFound',
              messageArgs: { method: 'GET', path },
            },
          ],
        };

        const localized = localizeMessageTree(tree, 'en') as {
          error: { message: string; messageArgs: { details: string } };
          nested: Array<{ message: string }>;
        };

        expect(localized.error.message).toContain(details);
        expect(localized.error.messageArgs).toBe(messageArgs);
        expect(localized.nested[0]?.message).toContain(path);
        expect(tree.error).not.toHaveProperty('message');
      }),
    );
  });
});
