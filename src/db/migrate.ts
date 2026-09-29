import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';

dotenv.config();

export async function runMigration(closePool: boolean = true): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL is not defined in your .env file.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('🔄 Running database migrations (TypeScript)...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schemaSql);
    console.log('✅ Database schema created/verified successfully!');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  runMigration(true).catch(() => process.exit(1));
}
