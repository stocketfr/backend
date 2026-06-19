import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Context, Data, Effect, Layer } from 'effect';

export class StorageConfigurationError extends Data.TaggedError(
  'StorageConfigurationError',
)<{
  readonly variable: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class StorageError extends Data.TaggedError('StorageError')<{
  readonly action: string;
  readonly key?: string;
  readonly cause?: unknown;
}> {}

export class StorageObjectNotFound extends Data.TaggedError(
  'StorageObjectNotFound',
)<{
  readonly key: string;
  readonly cause?: unknown;
}> {}

export interface StoredObject {
  readonly key: string;
  readonly bytes: Uint8Array;
}

export interface PutObjectOptions {
  readonly contentType?: string;
}

export interface StorageAdapter {
  readonly putObject: (
    key: string,
    bytes: Uint8Array,
    options?: PutObjectOptions,
  ) => Effect.Effect<void, StorageError>;
  readonly getObject: (
    key: string,
  ) => Effect.Effect<StoredObject, StorageError | StorageObjectNotFound>;
  readonly deleteObject: (key: string) => Effect.Effect<void, StorageError>;
  readonly deletePrefix: (prefix: string) => Effect.Effect<void, StorageError>;
}

export const StorageAdapter = Context.GenericTag<StorageAdapter>(
  '@stocket/effect/platform/StorageAdapter',
);

interface S3StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
}

const requiredEnv = (name: string) =>
  Effect.gen(function* () {
    const value = process.env[name]?.trim();
    if (!value) {
      return yield* Effect.fail(
        new StorageConfigurationError({
          variable: name,
          message: `${name} is required for object storage`,
        }),
      );
    }
    return value;
  });

const parseEndpoint = (value: string) =>
  Effect.try({
    try: () => new URL(value).toString(),
    catch: (cause) =>
      new StorageConfigurationError({
        variable: 'S3_ENDPOINT',
        message: 'S3_ENDPOINT must be a valid URL',
        cause,
      }),
  });

const parseBoolean = (name: string, value: string) => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return Effect.succeed(true);
  }
  if (normalized === 'false' || normalized === '0') {
    return Effect.succeed(false);
  }
  return Effect.fail(
    new StorageConfigurationError({
      variable: name,
      message: `${name} must be true, false, 1, or 0`,
    }),
  );
};

const loadS3StorageConfig: Effect.Effect<
  S3StorageConfig,
  StorageConfigurationError
> = Effect.gen(function* () {
  const endpoint = yield* requiredEnv('S3_ENDPOINT').pipe(
    Effect.flatMap(parseEndpoint),
  );
  const region = yield* requiredEnv('S3_REGION');
  const accessKeyId = yield* requiredEnv('S3_ACCESS_KEY_ID');
  const secretAccessKey = yield* requiredEnv('S3_SECRET_ACCESS_KEY');
  const bucket = yield* requiredEnv('S3_BUCKET');
  const forcePathStyle = yield* requiredEnv('S3_FORCE_PATH_STYLE').pipe(
    Effect.flatMap((value) => parseBoolean('S3_FORCE_PATH_STYLE', value)),
  );

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
    forcePathStyle,
  };
});

const isStorageNotFound = (cause: unknown): boolean =>
  cause instanceof StorageObjectNotFound ||
  cause instanceof NoSuchKey ||
  (cause instanceof S3ServiceException &&
    cause.$metadata.httpStatusCode === 404);

const makeS3Client = (config: S3StorageConfig) =>
  new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

const verifyBucket = (client: S3Client, bucket: string) =>
  Effect.tryPromise({
    try: () => client.send(new HeadBucketCommand({ Bucket: bucket })),
    catch: (cause) =>
      new StorageConfigurationError({
        variable: 'S3_BUCKET',
        message: `S3_BUCKET "${bucket}" must exist and be accessible`,
        cause,
      }),
  }).pipe(Effect.asVoid);

const makeS3StorageAdapter = (
  client: S3Client,
  bucket: string,
): StorageAdapter => {
  const putObject = (
    key: string,
    bytes: Uint8Array,
    options?: PutObjectOptions,
  ) =>
    Effect.tryPromise({
      try: () =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: Buffer.from(bytes),
            ContentType: options?.contentType,
          }),
        ),
      catch: (cause) => new StorageError({ action: 'putObject', key, cause }),
    }).pipe(Effect.asVoid);

  const getObject = (key: string) =>
    Effect.tryPromise({
      try: async () => {
        const response = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (!response.Body) {
          throw new StorageObjectNotFound({ key });
        }
        const bytes = await response.Body.transformToByteArray();
        return { key, bytes };
      },
      catch: (cause) =>
        isStorageNotFound(cause)
          ? new StorageObjectNotFound({ key, cause })
          : new StorageError({ action: 'getObject', key, cause }),
    });

  const deleteObject = (key: string) =>
    Effect.tryPromise({
      try: () =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      catch: (cause) =>
        new StorageError({ action: 'deleteObject', key, cause }),
    }).pipe(Effect.asVoid);

  const deletePrefix = (prefix: string) =>
    Effect.gen(function* () {
      let continuationToken: string | undefined;

      do {
        const listed = yield* Effect.tryPromise({
          try: () =>
            client.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
              }),
            ),
          catch: (cause) =>
            new StorageError({ action: 'listObjects', key: prefix, cause }),
        });

        const objects =
          listed.Contents?.flatMap((object) =>
            object.Key ? [{ Key: object.Key }] : [],
          ) ?? [];

        if (objects.length > 0) {
          yield* Effect.tryPromise({
            try: () =>
              client.send(
                new DeleteObjectsCommand({
                  Bucket: bucket,
                  Delete: { Objects: objects, Quiet: true },
                }),
              ),
            catch: (cause) =>
              new StorageError({
                action: 'deleteObjects',
                key: prefix,
                cause,
              }),
          }).pipe(Effect.asVoid);
        }

        continuationToken = listed.IsTruncated
          ? listed.NextContinuationToken
          : undefined;
      } while (continuationToken);
    });

  return { putObject, getObject, deleteObject, deletePrefix };
};

export const storageLayer = Layer.scoped(
  StorageAdapter,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const config = yield* loadS3StorageConfig;
      const client = makeS3Client(config);
      return { client, bucket: config.bucket };
    }),
    ({ client }) => Effect.sync(() => client.destroy()),
  ).pipe(
    Effect.tap(({ client, bucket }) => verifyBucket(client, bucket)),
    Effect.map(({ client, bucket }) => makeS3StorageAdapter(client, bucket)),
  ),
);

export interface InMemoryStorageAdapter extends StorageAdapter {
  readonly store: Map<string, Buffer>;
  readonly reset: () => void;
}

export const makeInMemoryStorageAdapter = (
  seed: Readonly<Record<string, Uint8Array>> = {},
): InMemoryStorageAdapter => {
  const store = new Map<string, Buffer>();

  for (const [key, bytes] of Object.entries(seed)) {
    store.set(key, Buffer.from(bytes));
  }

  const putObject = (key: string, bytes: Uint8Array) =>
    Effect.sync(() => {
      store.set(key, Buffer.from(bytes));
    });

  const getObject = (key: string) => {
    const bytes = store.get(key);
    return bytes
      ? Effect.succeed({ key, bytes: Buffer.from(bytes) })
      : Effect.fail(new StorageObjectNotFound({ key }));
  };

  const deleteObject = (key: string) =>
    Effect.sync(() => {
      store.delete(key);
    });

  const deletePrefix = (prefix: string) =>
    Effect.sync(() => {
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          store.delete(key);
        }
      }
    });

  return {
    store,
    reset: () => store.clear(),
    putObject,
    getObject,
    deleteObject,
    deletePrefix,
  };
};

export const makeInMemoryStorageAdapterLayer = (
  seed: Readonly<Record<string, Uint8Array>> = {},
): {
  readonly adapter: InMemoryStorageAdapter;
  readonly layer: Layer.Layer<StorageAdapter>;
} => {
  const adapter = makeInMemoryStorageAdapter(seed);
  return {
    adapter,
    layer: Layer.succeed(StorageAdapter, adapter),
  };
};
