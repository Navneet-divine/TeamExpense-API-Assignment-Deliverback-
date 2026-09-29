import dotenv from 'dotenv';
import { Pool, QueryResult, QueryResultRow, PoolClient } from 'pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

const isCloudOrSsl =
  connectionString &&
  (connectionString.includes('sslmode=require') ||
    connectionString.includes('neon.tech') ||
    connectionString.includes('supabase.co') ||
    connectionString.includes('render.com') ||
    connectionString.includes('amazonaws.com'));

export const pool = new Pool({
  connectionString,
  ssl: isCloudOrSsl ? { rejectUnauthorized: false } : false
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

export const query = <T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => {
  return pool.query<T>(text, params);
};

export const getClient = (): Promise<PoolClient> => {
  return pool.connect();
};
