import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SearchResponseReference } from "@sanctions/domain";
import type { RawSearchResponse, SearchResponseRepository } from "./search-types.js";

export class FilesystemSearchResponseRepository implements SearchResponseRepository {
  constructor(private readonly rootDirectory: string) {}

  async store(input: {
    watchQueryId: string;
    response: RawSearchResponse;
    retrievedAt: string;
  }): Promise<SearchResponseReference> {
    const bytes = Buffer.from(input.response.body, "utf8");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const reference = `sha256/${contentHash.slice(0, 2)}/${contentHash}.xml`;
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
      contentType: input.response.contentType,
      sourceUri: input.response.sourceUri,
      retrievedAt: input.retrievedAt
    };
  }

  async read(reference: string): Promise<string> {
    if (path.isAbsolute(reference) || reference.includes("..")) {
      throw new Error("Search response reference must be immutable repository-relative path");
    }

    return readFile(path.join(this.rootDirectory, reference), "utf8");
  }
}

function isAlreadyExistsError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause && cause.code === "EEXIST";
}
