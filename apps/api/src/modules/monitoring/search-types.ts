import type { SearchResponseReference, WatchQuery } from "@sanctions/domain";
import type { DiscoveryTrigger } from "./service.js";

export interface MonitorWindow {
  startedAt: string;
  finishedAt: string;
}

export interface RawSearchResponse {
  contentType: "application/xml";
  sourceUri: string;
  body: string;
}

export interface SearchResponseRepository {
  store(input: {
    watchQueryId: string;
    response: RawSearchResponse;
    retrievedAt: string;
  }): Promise<SearchResponseReference>;
  read(reference: string): Promise<string>;
}

export interface EurLexSearchAdapter {
  search(input: {
    watchQuery: WatchQuery;
    monitorWindow: MonitorWindow;
  }): Promise<{
    rawResponse: RawSearchResponse;
    triggers: DiscoveryTrigger[];
    errors: string[];
  }>;
}
