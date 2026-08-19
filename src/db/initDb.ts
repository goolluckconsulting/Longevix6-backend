import fs from 'fs';
import path from 'path';
import pool from '../config/db';

export async function initializeDatabase() {
  try {
    console.log('Initializing PostgreSQL database schema...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    await pool.query(schemaSql);
    console.log('PostgreSQL database schema initialized successfully!');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  }
}

// Run directly if executed as standalone script
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('Migration complete. Exiting.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
