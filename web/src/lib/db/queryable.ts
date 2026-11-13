import type { QueryResultRow } from "pg";

export type SqlQueryable = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
};

export type SqlTransactionClient = SqlQueryable & {
  release(): void;
};

export type TransactionalSqlDatabase = SqlQueryable & {
  connect(): Promise<SqlTransactionClient>;
};
