import type { Logger as DrizzleLogger } from 'drizzle-orm/logger';
import { HashMap, Layer, Logger, LogLevel, Cause } from 'effect';

import type { MessageArgs } from './messages';

const MAX_FIELD_LENGTH = 120;
const MAX_SQL_LENGTH = 220;
const UUID_SEGMENT_LENGTH = 8;

type SqlLogMode = 'off' | 'summary' | 'full';

type LogRecord = Record<string, unknown> & {
  readonly messageKey?: string;
  readonly messageArgs?: MessageArgs;
};

const LOG_LEVELS = {
  trace: LogLevel.Trace,
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warn: LogLevel.Warning,
  warning: LogLevel.Warning,
  error: LogLevel.Error,
  fatal: LogLevel.Fatal,
  none: LogLevel.None,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

const formatTimestamp = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;

const formatLevel = (label: string) => {
  switch (label.toUpperCase()) {
    case 'WARNING':
      return 'WARN';
    default:
      return label.toUpperCase();
  }
};

const truncate = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '-';
  }

  if (typeof value === 'string') {
    return truncate(value.replace(/\s+/g, ' '), MAX_FIELD_LENGTH);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Error) {
    return `${value.name}:${truncate(value.message, MAX_FIELD_LENGTH)}`;
  }

  if (isRecord(value) && typeof value._tag === 'string') {
    return String(value._tag);
  }

  try {
    return truncate(JSON.stringify(value), MAX_FIELD_LENGTH);
  } catch {
    if (typeof value === 'object') {
      return truncate(Object.prototype.toString.call(value), MAX_FIELD_LENGTH);
    }

    if (typeof value === 'symbol') {
      return truncate(value.toString(), MAX_FIELD_LENGTH);
    }

    if (typeof value === 'function') {
      return truncate(
        `[function ${value.name || 'anonymous'}]`,
        MAX_FIELD_LENGTH,
      );
    }

    if (typeof value === 'bigint') {
      return `${value}n`;
    }

    return '-';
  }
};

const formatRequestId = (requestId: unknown) => {
  if (typeof requestId !== 'string' || requestId.length === 0) {
    return '-';
  }

  return requestId.slice(0, UUID_SEGMENT_LENGTH);
};

const formatDuration = (duration: unknown) => {
  if (typeof duration === 'number') {
    return `${duration}ms`;
  }

  if (typeof duration === 'string') {
    return duration;
  }

  return '-';
};

const detectPlatform = (userAgent: string) => {
  if (userAgent.includes('Linux')) return 'linux';
  if (userAgent.includes('Windows')) return 'windows';
  if (userAgent.includes('Macintosh')) return 'mac';
  if (userAgent.includes('Android')) return 'android';
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'ios';
  return undefined;
};

const detectBrowser = (userAgent: string) => {
  const candidates: [string, RegExp][] = [
    ['edge', /Edg\/([\d.]+)/],
    ['chrome', /Chrome\/([\d.]+)/],
    ['firefox', /Firefox\/([\d.]+)/],
    ['safari', /Version\/([\d.]+).*Safari/],
    ['node', /^node$/],
    ['curl', /curl\/([\d.]+)/i],
  ];

  for (const [name, pattern] of candidates) {
    const match = userAgent.match(pattern);
    if (match) {
      return match[1] ? `${name}/${match[1]}` : name;
    }
  }

  return undefined;
};

const formatUserAgent = (userAgent: unknown) => {
  if (
    typeof userAgent !== 'string' ||
    userAgent.length === 0 ||
    userAgent === 'unknown'
  ) {
    return undefined;
  }

  if (userAgent === 'node') {
    return 'node';
  }

  const browser = detectBrowser(userAgent);
  const platform = detectPlatform(userAgent);

  if (browser && platform) {
    return `${browser}/${platform}`;
  }

  return browser ?? truncate(userAgent, 36);
};

const formatFields = (record: LogRecord, hiddenKeys: string[] = []) => {
  const hidden = new Set(['messageKey', 'messageArgs', ...hiddenKeys]);
  const parts: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (hidden.has(key) || value === undefined) {
      continue;
    }

    parts.push(`${key}=${stringifyValue(value)}`);
  }

  if (record.messageArgs && Object.keys(record.messageArgs).length > 0) {
    parts.push(`args=${stringifyValue(record.messageArgs)}`);
  }

  return parts;
};

const formatHttpRequest = (record: LogRecord) => {
  const parts = [
    String(record.messageKey),
    stringifyValue(record.method),
    stringifyValue(record.path),
    stringifyValue(record.statusCode),
    formatDuration(record.durationMs ?? record.duration),
    `rid=${formatRequestId(record.requestId)}`,
    `tid=${stringifyValue(record.tenantId)}`,
  ];

  const userAgent = formatUserAgent(record.userAgent);
  if (userAgent) {
    parts.push(`ua=${userAgent}`);
  }

  return parts.join(' ');
};

const formatHttpServerError = (record: LogRecord) =>
  [
    String(record.messageKey),
    `status=${stringifyValue(record.statusCode)}`,
    `path=${stringifyValue(record.path)}`,
    `error=${stringifyValue(record.error)}`,
  ].join(' ');

const formatDbQuery = (record: LogRecord) => {
  const parts = [String(record.messageKey)];

  if (record.operation !== undefined) {
    parts.push(`op=${stringifyValue(record.operation)}`);
  }

  if (record.table !== undefined) {
    parts.push(`table=${stringifyValue(record.table)}`);
  }

  if (record.paramCount !== undefined) {
    parts.push(`params=${stringifyValue(record.paramCount)}`);
  }

  if (record.sql !== undefined) {
    parts.push(`sql=${JSON.stringify(stringifyValue(record.sql))}`);
  }

  return parts.join(' ');
};

const formatKeyedRecord = (record: LogRecord) => {
  switch (record.messageKey) {
    case 'http.request':
      return formatHttpRequest(record);
    case 'http.serverError':
      return formatHttpServerError(record);
    case 'db.query':
      return formatDbQuery(record);
    default: {
      const parts = [String(record.messageKey), ...formatFields(record)];
      return parts.join(' ');
    }
  }
};

const formatMessage = (message: unknown): string => {
  if (Array.isArray(message)) {
    return message.map(formatMessage).join(' | ');
  }

  if (isRecord(message) && typeof message.messageKey === 'string') {
    return formatKeyedRecord(message);
  }

  return stringifyValue(message);
};

const formatCause = (cause: Cause.Cause<unknown>) => {
  if (Cause.isEmptyType(cause)) {
    return undefined;
  }

  const rendered = Cause.pretty(cause, { renderErrorCause: true })
    .split('\n')[0]
    ?.trim();

  return rendered ? `cause=${truncate(rendered, MAX_FIELD_LENGTH)}` : undefined;
};

const formatAnnotations = (annotations: HashMap.HashMap<string, unknown>) => {
  const parts: string[] = [];
  for (const [key, value] of annotations) {
    parts.push(`${key}=${stringifyValue(value)}`);
  }
  return parts;
};

const formatStructuredLogLine = ({
  annotations,
  cause,
  date,
  level,
  message,
}: {
  readonly annotations?: HashMap.HashMap<string, unknown>;
  readonly cause?: Cause.Cause<unknown>;
  readonly date: Date;
  readonly level: string;
  readonly message: unknown;
}) => {
  const parts = [
    formatTimestamp(date),
    formatLevel(level),
    formatMessage(message),
  ];

  if (annotations && HashMap.size(annotations) > 0) {
    parts.push(...formatAnnotations(annotations));
  }

  if (cause) {
    const causePart = formatCause(cause);
    if (causePart) {
      parts.push(causePart);
    }
  }

  return parts.join(' ');
};

const appConsoleLogger = Logger.withLeveledConsole(
  Logger.make(({ annotations, cause, date, logLevel, message }) => {
    return formatStructuredLogLine({
      annotations,
      cause,
      date,
      level: logLevel.label,
      message,
    });
  }),
);

const resolveLogLevel = () => {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  return value && value in LOG_LEVELS
    ? LOG_LEVELS[value as keyof typeof LOG_LEVELS]
    : LogLevel.Info;
};

const resolveSqlLogMode = (): SqlLogMode => {
  const value = process.env.LOG_SQL?.trim().toLowerCase();

  if (value === 'summary' || value === 'full') {
    return value;
  }

  return 'off';
};

const normalizeSql = (query: string) => query.replace(/\s+/g, ' ').trim();

const extractSqlOperation = (query: string) => {
  const operation = normalizeSql(query).split(' ', 1)[0];
  return operation ? operation.toUpperCase() : 'QUERY';
};

const extractSqlTable = (query: string) => {
  const normalized = normalizeSql(query);
  const patterns = [
    /\bfrom\s+"?([\w.-]+)"?/i,
    /\binto\s+"?([\w.-]+)"?/i,
    /\bupdate\s+"?([\w.-]+)"?/i,
    /\bdelete\s+from\s+"?([\w.-]+)"?/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/^.*\./, '');
    }
  }

  return undefined;
};

const makeSqlLogRecord = (
  query: string,
  params: unknown[],
  mode: Exclude<SqlLogMode, 'off'>,
) => {
  const normalizedQuery = normalizeSql(query);
  const table = extractSqlTable(normalizedQuery);
  return {
    messageKey: 'db.query',
    operation: extractSqlOperation(normalizedQuery),
    ...(table ? { table } : {}),
    paramCount: params.length,
    ...(mode === 'full'
      ? { sql: truncate(normalizedQuery, MAX_SQL_LENGTH) }
      : {}),
  } satisfies LogRecord;
};

export const runtimeLoggingLayer = Layer.mergeAll(
  Logger.replace(Logger.defaultLogger, appConsoleLogger),
  Logger.minimumLogLevel(resolveLogLevel()),
);

export const makeDrizzleLogger = (): DrizzleLogger | undefined => {
  const mode = resolveSqlLogMode();

  if (mode === 'off') {
    return undefined;
  }

  return {
    logQuery(query, params) {
      console.info(
        formatStructuredLogLine({
          date: new Date(),
          level: 'DEBUG',
          message: makeSqlLogRecord(query, params, mode),
        }),
      );
    },
  };
};
