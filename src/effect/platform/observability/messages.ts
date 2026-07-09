import { Effect } from 'effect';

import {
  type MessageKey,
  deCatalog,
  enCatalog,
  frCatalog,
} from '../catalogs/index';
import { type LogProperties } from '../catalogs/log-properties';

export const SUPPORTED_LOCALES = ['en', 'fr', 'de'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export type MessageArgs = Partial<LogProperties>;

export type AnyMessageKey = MessageKey | (string & {});

export type LogPayload = Partial<LogProperties> & {
  readonly messageKey: AnyMessageKey;
  readonly messageArgs?: MessageArgs;
};

export const messageCatalogs = {
  en: enCatalog,
  fr: frCatalog,
  de: deCatalog,
} satisfies Record<SupportedLocale, Record<MessageKey, string>>;

export interface TranslatableMessageDescriptor {
  readonly messageKey: AnyMessageKey;
  readonly messageArgs?: MessageArgs;
}

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const formatMessageValue = (value: string | number): string => String(value);

const formatMessageTemplate = (template: string, messageArgs?: MessageArgs) => {
  if (!messageArgs) {
    return template;
  }

  const args = messageArgs as Record<string, string | number | undefined>;
  return template.replace(/{(\w+)}/g, (_match, key: string) => {
    const value = args[key];
    if (value === undefined) {
      return `{${key}}`;
    }

    return formatMessageValue(value);
  });
};

const normalizeLocale = (value: string): SupportedLocale | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') {
    return undefined;
  }

  if (normalized === '*') {
    return DEFAULT_LOCALE;
  }

  const language = normalized.split('-')[0];
  if (language === 'en' || language === 'fr' || language === 'de') {
    return language;
  }

  return undefined;
};

export const resolveLocale = (
  acceptLanguageHeader?: string | null,
): SupportedLocale => {
  if (!acceptLanguageHeader) {
    return DEFAULT_LOCALE;
  }

  const candidates = acceptLanguageHeader
    .split(',')
    .map((token) => {
      const [tag, ...params] = token.trim().split(';');
      const qualityParam = params.find((part) => part.trim().startsWith('q='));
      const quality = qualityParam
        ? Number.parseFloat(qualityParam.trim().slice(2))
        : 1;

      return {
        locale: normalizeLocale(tag ?? ''),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter(
      (candidate): candidate is { locale: SupportedLocale; quality: number } =>
        candidate.locale !== undefined,
    )
    .sort((left, right) => right.quality - left.quality);

  return candidates[0]?.locale ?? DEFAULT_LOCALE;
};

export const translateMessage = (
  locale: SupportedLocale,
  messageKey: AnyMessageKey,
  messageArgs?: MessageArgs,
): string => {
  const localizedCatalog = messageCatalogs[locale] as Record<string, string>;
  const englishCatalog = messageCatalogs.en as Record<string, string>;
  const template =
    localizedCatalog[messageKey] ??
    englishCatalog[messageKey] ??
    String(messageKey);

  return formatMessageTemplate(template, messageArgs);
};

export const makeMessageResponse = (
  messageKey: AnyMessageKey,
  messageArgs?: MessageArgs,
): TranslatableMessageDescriptor => ({
  messageKey,
  ...(messageArgs ? { messageArgs } : {}),
});

const hasMessageKey = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & TranslatableMessageDescriptor =>
  typeof value.messageKey === 'string';

export const localizeMessageTree = (
  value: unknown,
  locale: SupportedLocale,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => localizeMessageTree(item, locale));
  }

  if (!isUnknownRecord(value) || value instanceof Date) {
    return value;
  }

  const localizedEntries = Object.entries(value).map(([key, entry]) => [
    key,
    key === 'messageArgs' ? entry : localizeMessageTree(entry, locale),
  ]);

  const localized = Object.fromEntries(localizedEntries) as Record<
    string,
    unknown
  >;

  if (!hasMessageKey(localized)) {
    return localized;
  }

  const messageArgs = isUnknownRecord(localized.messageArgs)
    ? localized.messageArgs
    : undefined;

  return {
    ...localized,
    ...(messageArgs ? { messageArgs } : {}),
    message: translateMessage(locale, localized.messageKey, messageArgs),
  } satisfies Record<string, unknown>;
};

class Logger {
  private readonly scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  private logWithKey(
    level: 'info' | 'warn' | 'error' | 'debug',
    messageKey: string,
    args?: MessageArgs,
  ): Effect.Effect<void> {
    const payload: LogPayload = {
      messageKey: `${this.scope}.${messageKey}`,
      ...(args ? { messageArgs: args } : {}),
    };

    switch (level) {
      case 'error':
        return Effect.logError(payload);
      case 'warn':
        return Effect.logWarning(payload);
      case 'debug':
        return Effect.logDebug(payload);
      default:
        return Effect.log(payload);
    }
  }

  info(messageKey: string, args?: MessageArgs): Effect.Effect<void> {
    return this.logWithKey('info', messageKey, args);
  }

  warn(messageKey: string, args?: MessageArgs): Effect.Effect<void> {
    return this.logWithKey('warn', messageKey, args);
  }

  error(messageKey: string, args?: MessageArgs): Effect.Effect<void> {
    return this.logWithKey('error', messageKey, args);
  }

  debug(messageKey: string, args?: MessageArgs): Effect.Effect<void> {
    return this.logWithKey('debug', messageKey, args);
  }

  log(messageKey: string, args?: MessageArgs): Effect.Effect<void> {
    return this.logWithKey('info', messageKey, args);
  }
}

export const createLogger = (scope: string): Logger => new Logger(scope);
