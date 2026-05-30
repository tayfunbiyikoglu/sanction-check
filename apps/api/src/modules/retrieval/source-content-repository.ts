import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import type { SourceContentReference } from "@sanctions/domain";
import type { SourceContentRepository, StorableOfficialContentType, StorableOfficialSourceContent } from "./types.js";

const extensionByContentType: Record<StorableOfficialContentType, string> = {
  "application/xml": "xml",
  "text/html": "html",
  "text/plain": "txt"
};

export class FilesystemSourceContentRepository implements SourceContentRepository {
  constructor(private readonly rootDirectory: string) {}

  async store(input: {
    candidateId: string;
    content: StorableOfficialSourceContent;
    retrievedAt: string;
  }): Promise<SourceContentReference> {
    const bytes = Buffer.from(input.content.body, "utf8");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const extension = extensionByContentType[input.content.contentType];
    const reference = `sha256/${contentHash.slice(0, 2)}/${contentHash}.${extension}`;
    const absolutePath = path.join(this.rootDirectory, reference);

    await mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      await writeFile(absolutePath, bytes, { flag: "wx" });
    } catch (cause) {
      if (!isAlreadyExistsError(cause)) {
        throw cause;
      }
    }

    return {
      reference,
      contentHash,
      contentLength: bytes.byteLength,
      contentType: input.content.contentType,
      language: "en",
      sourceUri: input.content.sourceUri,
      retrievedAt: input.retrievedAt
    };
  }

  async read(reference: string): Promise<string> {
    assertRepositoryRelativeReference(reference);

    return readFile(path.join(this.rootDirectory, reference), "utf8");
  }
}

export class AzureBlobSourceContentRepository implements SourceContentRepository {
  private readonly containerClient: AzureSourceContentContainerClient;
  private containerReady: Promise<void> | undefined;

  constructor(input: { connectionString: string; containerName: string } | { containerClient: AzureSourceContentContainerClient }) {
    this.containerClient = "containerClient" in input
      ? input.containerClient
      : BlobServiceClient.fromConnectionString(input.connectionString).getContainerClient(input.containerName);
  }

  async store(input: {
    candidateId: string;
    content: StorableOfficialSourceContent;
    retrievedAt: string;
  }): Promise<SourceContentReference> {
    const bytes = Buffer.from(input.content.body, "utf8");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const extension = extensionByContentType[input.content.contentType];
    const reference = `sha256/${contentHash.slice(0, 2)}/${contentHash}.${extension}`;
    const blobClient = this.containerClient.getBlockBlobClient(reference);

    await this.ensureContainer();

    try {
      await blobClient.uploadData(bytes, {
        blobHTTPHeaders: {
          blobContentType: input.content.contentType
        },
        conditions: {
          ifNoneMatch: "*"
        }
      });
    } catch (cause) {
      if (!isAzureBlobAlreadyExistsError(cause)) {
        throw cause;
      }
    }

    return {
      reference,
      contentHash,
      contentLength: bytes.byteLength,
      contentType: input.content.contentType,
      language: "en",
      sourceUri: input.content.sourceUri,
      retrievedAt: input.retrievedAt
    };
  }

  async read(reference: string): Promise<string> {
    assertRepositoryRelativeReference(reference);
    await this.ensureContainer();

    return (await this.containerClient.getBlobClient(reference).downloadToBuffer()).toString("utf8");
  }

  private async ensureContainer() {
    this.containerReady ??= this.containerClient.createIfNotExists().then(() => undefined);
    await this.containerReady;
  }
}

interface AzureSourceContentContainerClient {
  createIfNotExists(): Promise<unknown>;
  getBlockBlobClient(reference: string): {
    uploadData(bytes: Buffer, options: unknown): Promise<unknown>;
  };
  getBlobClient(reference: string): {
    downloadToBuffer(): Promise<Buffer>;
  };
}

export type SourceContentStorageMode = "local" | "azure";

export class SourceContentStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceContentStorageConfigurationError";
  }
}

export function buildSourceContentRepository(env: NodeJS.ProcessEnv = process.env): SourceContentRepository {
  const mode = parseSourceContentStorageMode(env.SOURCE_CONTENT_STORAGE_MODE);

  if (mode === "azure") {
    if (!env.AZURE_STORAGE_CONNECTION_STRING) {
      throw new SourceContentStorageConfigurationError(
        "AZURE_STORAGE_CONNECTION_STRING is required when SOURCE_CONTENT_STORAGE_MODE=azure"
      );
    }

    if (!env.AZURE_STORAGE_CONTAINER_NAME) {
      throw new SourceContentStorageConfigurationError(
        "AZURE_STORAGE_CONTAINER_NAME is required when SOURCE_CONTENT_STORAGE_MODE=azure"
      );
    }

    return new AzureBlobSourceContentRepository({
      connectionString: env.AZURE_STORAGE_CONNECTION_STRING,
      containerName: env.AZURE_STORAGE_CONTAINER_NAME
    });
  }

  return new FilesystemSourceContentRepository(resolveLocalSourceContentRoot(env));
}

export function resolveLocalSourceContentRoot(env: NodeJS.ProcessEnv = process.env) {
  const configuredRoot = env.SOURCE_CONTENT_STORAGE_DIR ?? env.SOURCE_CONTENT_ROOT;

  if (!configuredRoot) {
    return path.resolve(repoRootDirectory, "storage/source-content");
  }

  return path.isAbsolute(configuredRoot) ? configuredRoot : path.resolve(repoRootDirectory, configuredRoot);
}

const repoRootDirectory = path.resolve(import.meta.dirname, "../../../../..");

function parseSourceContentStorageMode(value: string | undefined): SourceContentStorageMode {
  if (!value || value === "local") {
    return "local";
  }

  if (value === "azure") {
    return "azure";
  }

  throw new SourceContentStorageConfigurationError(`Unsupported SOURCE_CONTENT_STORAGE_MODE: ${value}`);
}

function assertRepositoryRelativeReference(reference: string) {
  if (path.isAbsolute(reference) || reference.includes("..")) {
    throw new Error("Source content reference must be immutable repository-relative path");
  }
}

function isAlreadyExistsError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause && cause.code === "EEXIST";
}

function isAzureBlobAlreadyExistsError(cause: unknown) {
  return cause instanceof Error && "statusCode" in cause && cause.statusCode === 409;
}
