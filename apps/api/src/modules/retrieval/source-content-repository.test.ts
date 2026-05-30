import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AzureBlobSourceContentRepository,
  FilesystemSourceContentRepository,
  SourceContentStorageConfigurationError,
  buildSourceContentRepository,
  resolveLocalSourceContentRoot
} from "./source-content-repository.js";

describe("source content repository configuration", () => {
  it("uses local filesystem storage by default", () => {
    expect(buildSourceContentRepository({})).toBeInstanceOf(FilesystemSourceContentRepository);
  });

  it("keeps SOURCE_CONTENT_STORAGE_DIR compatible with existing tests and local config", () => {
    expect(resolveLocalSourceContentRoot({ SOURCE_CONTENT_STORAGE_DIR: "/tmp/source-content" })).toBe(
      "/tmp/source-content"
    );
  });

  it("supports SOURCE_CONTENT_ROOT relative to the repository root", () => {
    expect(resolveLocalSourceContentRoot({ SOURCE_CONTENT_ROOT: "storage/source-content" })).toMatch(
      /storage\/source-content$/
    );
  });

  it("requires Azure connection settings when Azure storage is selected", () => {
    expect(() => buildSourceContentRepository({ SOURCE_CONTENT_STORAGE_MODE: "azure" })).toThrow(
      SourceContentStorageConfigurationError
    );
  });

  it("builds Azure Blob storage when configured", () => {
    expect(
      buildSourceContentRepository({
        SOURCE_CONTENT_STORAGE_MODE: "azure",
        AZURE_STORAGE_CONNECTION_STRING:
          "DefaultEndpointsProtocol=https;AccountName=example;AccountKey=ZmFrZQ==;EndpointSuffix=core.windows.net",
        AZURE_STORAGE_CONTAINER_NAME: "source-content"
      })
    ).toBeInstanceOf(AzureBlobSourceContentRepository);
  });
});

describe("filesystem source content repository", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("stores source content by immutable hash reference and reads it back", async () => {
    root = await mkdtemp(path.join(tmpdir(), "source-content-repository-"));
    const repository = new FilesystemSourceContentRepository(root);

    const reference = await repository.store({
      candidateId: "candidate-1",
      retrievedAt: "2026-05-30T00:00:00.000Z",
      content: {
        language: "en",
        contentType: "text/plain",
        sourceUri: "cellar:test",
        body: "Official content"
      }
    });

    expect(reference.reference).toMatch(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.txt$/);
    await expect(repository.read(reference.reference)).resolves.toBe("Official content");
  });
});

describe("Azure Blob source content repository", () => {
  it("creates the configured container before storing source content", async () => {
    const uploadData = vi.fn(async () => undefined);
    const createIfNotExists = vi.fn(async () => undefined);
    const repository = new AzureBlobSourceContentRepository({
      containerClient: {
        createIfNotExists,
        getBlockBlobClient: () => ({
          uploadData
        }),
        getBlobClient: () => ({
          downloadToBuffer: async () => Buffer.from("")
        })
      }
    });

    await repository.store({
      candidateId: "candidate-1",
      retrievedAt: "2026-05-30T00:00:00.000Z",
      content: {
        language: "en",
        contentType: "text/plain",
        sourceUri: "cellar:test",
        body: "Official content"
      }
    });

    expect(createIfNotExists).toHaveBeenCalledTimes(1);
    expect(uploadData).toHaveBeenCalledTimes(1);
  });
});
