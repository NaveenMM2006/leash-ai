import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import ws from 'ws';
import { PrismaClient } from './generated/prisma/client.js';

export type Database = PrismaClient;

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

neonConfig.webSocketConstructor = ws;

/**
 * Creates a Prisma client. A `?schema=` parameter on the URL (as understood by
 * the Prisma CLI) is honoured for generated queries *and* raw SQL, by setting
 * the connection's search_path. Integration tests use this to run in an
 * isolated, throwaway schema.
 */
export function createDatabase(databaseUrl: string): Database {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('schema');
  url.searchParams.delete('schema');

  const isNeon = url.hostname.includes('neon.tech') || process.env.DATABASE_DRIVER === 'neon';

  if (schema === null) {
    const adapter = isNeon
      ? new PrismaNeon({ connectionString: url.toString() })
      : new PrismaPg({ connectionString: url.toString() });
    return new PrismaClient({ adapter });
  }

  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid schema name in DATABASE_URL: ${schema}`);
  const adapter = isNeon
    ? new PrismaNeon({ connectionString: url.toString() }, { schema })
    : new PrismaPg(
        { connectionString: url.toString(), options: `-c search_path=${schema}` },
        { schema },
      );
  return new PrismaClient({ adapter });
}

/** Minimal capability the HTTP layer needs for readiness checks. */
export interface DatabaseProbe {
  ping(): Promise<void>;
}

export function databaseProbe(db: Database): DatabaseProbe {
  return {
    async ping() {
      await db.$queryRaw`SELECT 1`;
    },
  };
}
