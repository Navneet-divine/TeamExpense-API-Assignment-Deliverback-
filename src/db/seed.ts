import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db';

dotenv.config();

export async function runSeed(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL is not defined in your .env file.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('🌱 Starting database seeding...');

    // 0. Ensure schema exists first
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schemaSql);

    await client.query('BEGIN');

    // Clean existing data cleanly
    await client.query('TRUNCATE TABLE comments, expenses, users, companies RESTART IDENTITY CASCADE');

    const defaultPassword = 'Password123!';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // 1. Insert Companies (Exactly 2)
    const comp1Res = await client.query(
      `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
      ['Deliverback']
    );
    const comp1Id = comp1Res.rows[0].id;

    const comp2Res = await client.query(
      `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
      ['Loopcv']
    );
    const comp2Id = comp2Res.rows[0].id;

    // 2. Insert Users for Deliverback (1 Manager & 2 Employees)
    await client.query(
      `INSERT INTO users (company_id, email, password, full_name, role, total_reimbursed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [comp1Id, 'george@deliverback.com', hashedPassword, 'George Avgenakis', 'manager', 0.00]
    );

    const aliceRes = await client.query(
      `INSERT INTO users (company_id, email, password, full_name, role, total_reimbursed)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [comp1Id, 'alice@deliverback.com', hashedPassword, 'Alice Jenkins', 'employee', 450.00]
    );
    const aliceId = aliceRes.rows[0].id;

    const bobRes = await client.query(
      `INSERT INTO users (company_id, email, password, full_name, role, total_reimbursed)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [comp1Id, 'bob@deliverback.com', hashedPassword, 'Bob Williams', 'employee', 0.00]
    );
    const bobId = bobRes.rows[0].id;

    // 3. Insert Users for Loopcv (1 Manager & 2 Employees)
    await client.query(
      `INSERT INTO users (company_id, email, password, full_name, role, total_reimbursed)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [comp2Id, 'lucas@loopcv.com', hashedPassword, 'Lucas Simopoulos', 'manager', 0.00]
    );

    const charlieRes = await client.query(
      `INSERT INTO users (company_id, email, password, full_name, role, total_reimbursed)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [comp2Id, 'charlie@loopcv.com', hashedPassword, 'Charlie Smith', 'employee', 42.50]
    );
    const charlieId = charlieRes.rows[0].id;

    const davidRes = await client.query(
      `INSERT INTO users (company_id, email, password, full_name, role, total_reimbursed)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [comp2Id, 'david@loopcv.com', hashedPassword, 'David Evans', 'employee', 0.00]
    );
    const davidId = davidRes.rows[0].id;

    // 4. Insert Expenses for Deliverback
    await client.query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comp1Id, aliceId, 'Client Dinner in Downtown', 120.50, 'USD', 'Meals', 'pending']
    );

    await client.query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comp1Id, aliceId, 'Flight to Tech Conference', 450.00, 'USD', 'Travel', 'approved']
    );

    await client.query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comp1Id, bobId, 'GitHub Copilot License', 35.00, 'USD', 'Software', 'pending']
    );

    await client.query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comp1Id, bobId, 'Ergonomic Desk Chair', 220.00, 'USD', 'Office Supplies', 'rejected']
    );

    // 5. Insert Expenses for Loopcv
    await client.query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comp2Id, charlieId, 'Team Lunch Celebration', 85.20, 'EUR', 'Meals', 'pending']
    );

    await client.query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comp2Id, charlieId, 'Taxi to Logistics Hub', 42.50, 'EUR', 'Travel', 'approved']
    );

    await client.query(
      `INSERT INTO expenses (company_id, user_id, title, amount, currency, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comp2Id, davidId, 'Dell UltraSharp Monitor', 320.00, 'USD', 'Hardware', 'pending']
    );

    await client.query('COMMIT');
    console.log('✅ Database seeded successfully!');
    console.log('----------------------------------------------------');
    console.log('Seed Accounts Created (Password for all: Password123!):');
    console.log('🏢 Deliverback:');
    console.log('  Manager:  george@deliverback.com (George Avgenakis)');
    console.log('  Employee: alice@deliverback.com (Alice Jenkins)');
    console.log('  Employee: bob@deliverback.com (Bob Williams)');
    console.log('🏢 Loopcv:');
    console.log('  Manager:  lucas@loopcv.com (Lucas Simopoulos)');
    console.log('  Employee: charlie@loopcv.com (Charlie Smith)');
    console.log('  Employee: david@loopcv.com (David Evans)');
    console.log('----------------------------------------------------');
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runSeed();
}
