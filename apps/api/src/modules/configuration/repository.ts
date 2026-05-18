import type { ConfiguredBaseAct, WatchQuery } from "@sanctions/domain";
import type { DatabaseExecutor } from "../persistence/postgres.js";

export interface ConfigurationRepository {
  listConfiguredBaseActs(): Promise<ConfiguredBaseAct[]>;
  listWatchQueries(): Promise<WatchQuery[]>;
  saveWatchQuery(watchQuery: WatchQuery): Promise<WatchQuery>;
  seedBaseline(input: { configuredBaseActs: ConfiguredBaseAct[]; watchQueries: WatchQuery[] }): Promise<void>;
  assertBaselinePresent(): Promise<void>;
}

export class BaselineConfigurationMissingError extends Error {
  constructor(message = "Baseline Configured Base Acts and Watch Queries are missing. Run the explicit seed command before starting the API.") {
    super(message);
    this.name = "BaselineConfigurationMissingError";
  }
}

export class InMemoryConfigurationRepository implements ConfigurationRepository {
  constructor(
    private readonly configuredBaseActs: ConfiguredBaseAct[],
    private readonly watchQueries: WatchQuery[]
  ) {}

  async listConfiguredBaseActs(): Promise<ConfiguredBaseAct[]> {
    return this.configuredBaseActs;
  }

  async listWatchQueries(): Promise<WatchQuery[]> {
    return this.watchQueries;
  }

  async saveWatchQuery(watchQuery: WatchQuery): Promise<WatchQuery> {
    const existingIndex = this.watchQueries.findIndex((item) => item.id === watchQuery.id);

    if (existingIndex >= 0) {
      this.watchQueries[existingIndex] = watchQuery;
      return watchQuery;
    }

    this.watchQueries.push(watchQuery);
    return watchQuery;
  }

  async seedBaseline(): Promise<void> {
    return undefined;
  }

  async assertBaselinePresent(): Promise<void> {
    if (this.configuredBaseActs.some((item) => item.isActive) && this.watchQueries.some((item) => item.isActive)) {
      return;
    }

    throw new BaselineConfigurationMissingError();
  }
}

export class PostgresConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async listConfiguredBaseActs(): Promise<ConfiguredBaseAct[]> {
    const result = await this.db.query<ConfiguredBaseActRow>(
      `select id, celex_id, label, is_active, created_at
       from configured_base_act
       order by created_at asc, id asc`
    );

    return result.rows.map(mapConfiguredBaseAct);
  }

  async listWatchQueries(): Promise<WatchQuery[]> {
    const result = await this.db.query<WatchQueryRow>(
      `select
         wq.id,
         wq.name,
         wq.source,
         wq.query_text,
         wq.feed_url,
         wq.is_active,
         wq.created_at,
         coalesce(array_agg(wqba.configured_base_act_id order by wqba.configured_base_act_id)
           filter (where wqba.configured_base_act_id is not null), array[]::text[]) as configured_base_act_ids
       from watch_query wq
       left join watch_query_base_act wqba on wqba.watch_query_id = wq.id
       group by wq.id
       order by wq.created_at asc, wq.id asc`
    );

    return result.rows.map(mapWatchQuery);
  }

  async saveWatchQuery(watchQuery: WatchQuery): Promise<WatchQuery> {
    const result = await this.db.query<WatchQueryRow>(
      `insert into watch_query (id, name, source, query_text, feed_url, is_active, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         name = excluded.name,
         source = excluded.source,
         query_text = excluded.query_text,
         feed_url = excluded.feed_url,
         is_active = excluded.is_active
       returning id, name, source, query_text, feed_url, is_active, created_at,
         array[]::text[] as configured_base_act_ids`,
      [
        watchQuery.id,
        watchQuery.name,
        watchQuery.source,
        watchQuery.queryText,
        watchQuery.feedUrl ?? null,
        watchQuery.isActive,
        watchQuery.createdAt
      ]
    );

    await this.db.query("delete from watch_query_base_act where watch_query_id = $1", [watchQuery.id]);

    for (const configuredBaseActId of watchQuery.configuredBaseActIds) {
      await this.db.query(
        `insert into watch_query_base_act (watch_query_id, configured_base_act_id)
         values ($1, $2)
         on conflict do nothing`,
        [watchQuery.id, configuredBaseActId]
      );
    }

    const saved = result.rows[0] ? mapWatchQuery(result.rows[0]) : watchQuery;
    return {
      ...saved,
      configuredBaseActIds: watchQuery.configuredBaseActIds
    };
  }

  async seedBaseline(input: { configuredBaseActs: ConfiguredBaseAct[]; watchQueries: WatchQuery[] }): Promise<void> {
    for (const baseAct of input.configuredBaseActs) {
      await this.db.query(
        `insert into configured_base_act (id, celex_id, label, is_active, created_at)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do nothing`,
        [baseAct.id, baseAct.celexId, baseAct.label, baseAct.isActive, baseAct.createdAt]
      );
    }

    for (const watchQuery of input.watchQueries) {
      await this.db.query(
        `insert into watch_query (id, name, source, query_text, feed_url, is_active, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           feed_url = coalesce(watch_query.feed_url, excluded.feed_url)`,
        [
          watchQuery.id,
          watchQuery.name,
          watchQuery.source,
          watchQuery.queryText,
          watchQuery.feedUrl ?? null,
          watchQuery.isActive,
          watchQuery.createdAt
        ]
      );

      for (const configuredBaseActId of watchQuery.configuredBaseActIds) {
        await this.db.query(
          `insert into watch_query_base_act (watch_query_id, configured_base_act_id)
           values ($1, $2)
           on conflict do nothing`,
          [watchQuery.id, configuredBaseActId]
        );
      }
    }
  }

  async assertBaselinePresent(): Promise<void> {
    try {
      const result = await this.db.query<{ active_base_acts: string; active_watch_queries: string }>(
        `select
           (select count(*) from configured_base_act where is_active) as active_base_acts,
           (select count(*) from watch_query where is_active) as active_watch_queries`
      );
      const row = result.rows[0];

      if (row && Number(row.active_base_acts) > 0 && Number(row.active_watch_queries) > 0) {
        return;
      }
    } catch (cause) {
      throw new Error(
        `PostgreSQL schema is missing or invalid. Run the explicit migration command before starting the API. ${
          cause instanceof Error ? cause.message : String(cause)
        }`
      );
    }

    throw new BaselineConfigurationMissingError();
  }
}

interface ConfiguredBaseActRow {
  id: string;
  celex_id: string;
  label: string;
  is_active: boolean;
  created_at: Date;
}

interface WatchQueryRow {
  id: string;
  name: string;
  source: "RSS" | "EURLEX_WS";
  query_text: string;
  feed_url: string | null;
  is_active: boolean;
  created_at: Date;
  configured_base_act_ids: string[];
}

function mapConfiguredBaseAct(row: ConfiguredBaseActRow): ConfiguredBaseAct {
  return {
    id: row.id,
    celexId: row.celex_id,
    label: row.label,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString()
  };
}

function mapWatchQuery(row: WatchQueryRow): WatchQuery {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    queryText: row.query_text,
    ...(row.feed_url ? { feedUrl: row.feed_url } : {}),
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    configuredBaseActIds: row.configured_base_act_ids
  };
}
