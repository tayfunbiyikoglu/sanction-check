import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
    if (path.isAbsolute(reference) || reference.includes("..")) {
      throw new Error("Source content reference must be immutable repository-relative path");
    }

    return readFile(path.join(this.rootDirectory, reference), "utf8");
  }
}

function isAlreadyExistsError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause && cause.code === "EEXIST";
}
