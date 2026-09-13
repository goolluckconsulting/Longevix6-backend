import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import pool from '../config/db';

dotenv.config();

export async function seedAdminUser() {
  const email = (process.env.ADMIN_DEFAULT_EMAIL || 'admin@longevix6.com').toLowerCase().trim();
  const password = process.env.ADMIN_DEFAULT_PASSWORD || 'LongevixAdmin2026!Secure';
  const fullName = process.env.ADMIN_DEFAULT_NAME || 'Clinic Administrator';

  try {
    console.log(`Checking if admin user exists for ${email}...`);

    // 1. Check if admin user already exists
    const existingResult = await pool.query(
      'SELECT id, email, role, is_active FROM admin_users WHERE email = $1',
      [email]
    );

    if (existingResult.rows.length > 0) {
      console.log(`Admin user [${email}] already exists. Skipping seed.`);
      return existingResult.rows[0];
    }

    // 2. Hash password with bcrypt work factor 10
    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Idempotent insert
    const insertResult = await pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, 'admin', true)
       RETURNING id, email, full_name, role, is_active, created_at`,
      [email, passwordHash, fullName]
    );

    console.log(`Admin user seeded successfully with ID: ${insertResult.rows[0].id}`);
    console.log(`NOTE: Remember to remove ADMIN_DEFAULT_PASSWORD from production environment variables after initial seed.`);
    return insertResult.rows[0];
  } catch (error) {
    console.error('Error during admin seeding:', error);
    throw error;
  }
}

// Standalone execution
if (require.main === module) {
  seedAdminUser()
    .then(() => {
      console.log('Admin seeding process complete. Exiting.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Admin seeding failed:', err);
      process.exit(1);
    });
}
