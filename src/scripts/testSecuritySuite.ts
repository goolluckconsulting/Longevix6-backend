import jwt from 'jsonwebtoken';
import pool from '../config/db';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'longevix6_local_dev_jwt_secret_key_minimum_64_characters_long_for_security_testing_purpose';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, details?: string) {
  results.push({
    name,
    passed: condition,
    details: condition ? undefined : details || 'Assertion failed',
  });
  const status = condition ? '✓ PASS' : '✗ FAIL';
  console.log(`${status}: ${name}${details && !condition ? ` (${details})` : ''}`);
}

async function runSecuritySuite() {
  console.log('====================================================');
  console.log('  STARTING SECURITY & REGRESSION VERIFICATION SUITE ');
  console.log('====================================================\n');

  const baseUrl = 'http://localhost:5000';

  try {
    // ----------------------------------------------------
    // TEST 1: Health & Existing Core Routes
    // ----------------------------------------------------
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200 && healthJson.status === 'healthy', 'GET /api/health returns 200 healthy');

    const keyRes = await fetch(`${baseUrl}/api/payments/key`);
    const keyJson = await keyRes.json();
    assert(keyRes.status === 200 && typeof keyJson.key === 'string', 'GET /api/payments/key is functional and intact');

    // ----------------------------------------------------
    // TEST 2: Missing Admin Cookie -> 401
    // ----------------------------------------------------
    const noCookieRes = await fetch(`${baseUrl}/api/admin/auth/me`);
    assert(noCookieRes.status === 401, 'Missing admin cookie returns 401 Unauthorized');

    const noCookieBlogsRes = await fetch(`${baseUrl}/api/admin/blogs`);
    assert(noCookieBlogsRes.status === 401, 'Missing admin cookie on /admin/blogs returns 401 Unauthorized');

    // ----------------------------------------------------
    // TEST 3: Invalid & Expired JWT Tokens -> 401
    // ----------------------------------------------------
    const invalidJwtRes = await fetch(`${baseUrl}/api/admin/auth/me`, {
      headers: { Cookie: 'longevix_admin_token=invalid.garbage.token' },
    });
    assert(invalidJwtRes.status === 401, 'Invalid/tampered JWT returns 401 Unauthorized');

    // Expired JWT (issued 10 hours ago, 8h max age)
    const expiredToken = jwt.sign(
      { sub: '00000000-0000-0000-0000-000000000000', email: 'admin@longevix6.com', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const expiredJwtRes = await fetch(`${baseUrl}/api/admin/auth/me`, {
      headers: { Cookie: `longevix_admin_token=${expiredToken}` },
    });
    assert(expiredJwtRes.status === 401, 'Expired JWT returns 401 Unauthorized');

    // ----------------------------------------------------
    // TEST 4: Invalid Login Returns Generic 401 (No Enumeration)
    // ----------------------------------------------------
    const badLoginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@longevix6.com', password: 'WrongPassword123!' }),
    });
    const badLoginJson = await badLoginRes.json();
    assert(
      badLoginRes.status === 401 && badLoginJson.message === 'Invalid email or password.',
      'Unknown email returns generic 401 without revealing account existence'
    );

    const badPassRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@longevix6.com', password: 'IncorrectPassword' }),
    });
    const badPassJson = await badPassRes.json();
    assert(
      badPassRes.status === 401 && badPassJson.message === 'Invalid email or password.',
      'Wrong password returns identical generic 401 response'
    );

    // ----------------------------------------------------
    // TEST 5: Valid Login Sets HttpOnly Cookie & Never Exposes Password or JWT in JSON
    // ----------------------------------------------------
    const validLoginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@longevix6.com', password: 'LongevixAdmin2026!Secure' }),
    });
    const setCookieHeader = validLoginRes.headers.get('set-cookie') || '';
    const loginJson = await validLoginRes.json();

    assert(validLoginRes.status === 200, 'Valid admin credentials return 200 OK');
    assert(setCookieHeader.includes('HttpOnly'), 'Cookie header contains HttpOnly flag');
    assert(setCookieHeader.includes('SameSite=Lax'), 'Cookie header contains SameSite=Lax flag');
    assert(setCookieHeader.includes('longevix_admin_token='), 'Cookie sets longevix_admin_token');
    assert(!loginJson.token && !loginJson.jwt, 'JWT is NEVER returned in response JSON body');
    assert(!loginJson.password_hash && !loginJson.data?.password_hash, 'password_hash is NEVER returned');

    // Extract cookie for authenticated admin tests
    const adminCookieMatch = setCookieHeader.match(/longevix_admin_token=([^;]+)/);
    const adminCookie = adminCookieMatch ? adminCookieMatch[0] : '';

    // ----------------------------------------------------
    // TEST 6: Authenticated /me endpoint
    // ----------------------------------------------------
    const meRes = await fetch(`${baseUrl}/api/admin/auth/me`, {
      headers: { Cookie: adminCookie },
    });
    const meJson = await meRes.json();
    assert(meRes.status === 200 && meJson.data.role === 'admin', 'GET /api/admin/auth/me returns valid admin profile');
    assert(!meJson.data.password_hash, 'GET /me does not leak password_hash');

    // ----------------------------------------------------
    // TEST 7: Inactive Admin -> 403 Forbidden
    // ----------------------------------------------------
    // Create temporary inactive admin
    const inactiveUserRes = await pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ('inactive_test@longevix6.com', 'dummy_hash', 'Inactive User', 'admin', false)
       RETURNING id`
    );
    const inactiveId = inactiveUserRes.rows[0].id;
    const inactiveToken = jwt.sign(
      { sub: inactiveId, email: 'inactive_test@longevix6.com', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const inactiveReqRes = await fetch(`${baseUrl}/api/admin/auth/me`, {
      headers: { Cookie: `longevix_admin_token=${inactiveToken}` },
    });
    assert(inactiveReqRes.status === 403, 'Inactive admin account returns 403 Forbidden');
    await pool.query('DELETE FROM admin_users WHERE id = $1', [inactiveId]);

    // ----------------------------------------------------
    // TEST 8: CSRF Origin Validation on State-Changing Admin Routes
    // ----------------------------------------------------
    const badOriginRes = await fetch(`${baseUrl}/api/admin/blogs`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'https://evil-attacker-site.com',
      },
      body: JSON.stringify({
        title: 'Attacker Post',
        excerpt: 'Malicious test',
        content: 'Evil content',
      }),
    });
    assert(badOriginRes.status === 403, 'Unauthorized Origin on POST /api/admin/blogs returns 403 Forbidden');

    const nullOriginRes = await fetch(`${baseUrl}/api/admin/blogs`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'null',
      },
      body: JSON.stringify({
        title: 'Null Origin Post',
        excerpt: 'Malicious test',
        content: 'Evil content',
      }),
    });
    assert(nullOriginRes.status === 403, 'Origin "null" on POST /api/admin/blogs returns 403 Forbidden');

    // ----------------------------------------------------
    // TEST 9: Public Blog Isolation (Draft & Archived Hidden)
    // ----------------------------------------------------
    // Create draft post via admin
    const createDraftRes = await fetch(`${baseUrl}/api/admin/blogs`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({
        title: 'Secret Draft Article for Internal Eyes',
        slug: 'secret-internal-draft-slug',
        excerpt: 'This excerpt should never appear publicly while drafted.',
        content: 'Confidential clinical data.',
        status: 'draft',
      }),
    });
    const draftJson = await createDraftRes.json();
    assert(createDraftRes.status === 201, 'Admin can create draft blog post');
    const draftId = draftJson.data.id;

    // Verify public listing does NOT show draft
    const publicListRes = await fetch(`${baseUrl}/api/blogs`);
    const publicListJson = await publicListRes.json();
    const hasDraftInList = publicListJson.data.some(
      (b: any) => b.slug === 'secret-internal-draft-slug' || b.id === draftId
    );
    assert(!hasDraftInList, 'Public GET /api/blogs NEVER returns draft articles');

    // Verify public slug lookup returns 404 for draft
    const publicSlugRes = await fetch(`${baseUrl}/api/blogs/secret-internal-draft-slug`);
    assert(publicSlugRes.status === 404, 'Public GET /api/blogs/:draft-slug returns generic 404 Not Found');

    // ----------------------------------------------------
    // TEST 10: Duplicate Slug Protection -> 409 Conflict
    // ----------------------------------------------------
    const duplicateSlugRes = await fetch(`${baseUrl}/api/admin/blogs`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({
        title: 'Duplicate Slug Test',
        slug: 'secret-internal-draft-slug', // same as existing
        excerpt: 'Test',
        content: 'Test content',
      }),
    });
    assert(duplicateSlugRes.status === 409, 'Duplicate slug returns 409 Conflict');

    // ----------------------------------------------------
    // TEST 11: Invalid UUID format on admin route -> 400 Bad Request
    // ----------------------------------------------------
    const badUuidRes = await fetch(`${baseUrl}/api/admin/blogs/invalid-uuid-format-12345`, {
      headers: { Cookie: adminCookie },
    });
    assert(badUuidRes.status === 400, 'Invalid UUID parameter returns 400 Bad Request');

    // ----------------------------------------------------
    // TEST 12: Publish Blog & Verify Public Visibility
    // ----------------------------------------------------
    const publishRes = await fetch(`${baseUrl}/api/admin/blogs/${draftId}/status`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ status: 'published' }),
    });
    assert(publishRes.status === 200, 'Admin can publish blog post');

    const publishedSlugRes = await fetch(`${baseUrl}/api/blogs/secret-internal-draft-slug`);
    const publishedJson = await publishedSlugRes.json();
    assert(
      publishedSlugRes.status === 200 && publishedJson.data.title === 'Secret Draft Article for Internal Eyes',
      'Published article is now accessible via public GET /api/blogs/:slug'
    );

    // ----------------------------------------------------
    // TEST 13: Soft Archive Blog & Verify Immediate Public Concealment
    // ----------------------------------------------------
    const archiveRes = await fetch(`${baseUrl}/api/admin/blogs/${draftId}`, {
      method: 'DELETE',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
    });
    assert(archiveRes.status === 200, 'Admin can archive blog post');

    const archivedPublicRes = await fetch(`${baseUrl}/api/blogs/secret-internal-draft-slug`);
    assert(archivedPublicRes.status === 404, 'Archived blog post immediately disappears from public view (404)');

    // Clean up test blog
    await pool.query('DELETE FROM blogs WHERE id = $1', [draftId]);

    // ----------------------------------------------------
    // TEST 14: Upload Security - Magic-Byte & MIME Validation
    // ----------------------------------------------------
    // Upload without auth -> 401
    const unauthUploadRes = await fetch(`${baseUrl}/api/admin/upload`, {
      method: 'POST',
    });
    assert(unauthUploadRes.status === 401, 'Unauthenticated upload rejected with 401 Unauthorized');

    // Upload with fake MIME (text pretending to be image/jpeg)
    const fakeFormData = new FormData();
    const fakeFile = new Blob(['This is plain text pretending to be a JPG image file'], {
      type: 'image/jpeg',
    });
    fakeFormData.append('image', fakeFile, 'fake.jpg');

    const fakeUploadRes = await fetch(`${baseUrl}/api/admin/upload`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
      body: fakeFormData,
    });
    const fakeUploadJson = await fakeUploadRes.json();
    assert(
      fakeUploadRes.status === 400 && fakeUploadJson.message.includes('magic-byte'),
      'Fake MIME/magic-byte mismatch rejected with 400 Bad Request'
    );

    // Upload disallowed MIME (e.g. application/pdf)
    const pdfFormData = new FormData();
    const pdfBlob = new Blob(['%PDF-1.4 dummy pdf'], { type: 'application/pdf' });
    pdfFormData.append('image', pdfBlob, 'document.pdf');

    const pdfUploadRes = await fetch(`${baseUrl}/api/admin/upload`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
      body: pdfFormData,
    });
    assert(pdfUploadRes.status === 400, 'Non-whitelisted MIME type (PDF) rejected with 400 Bad Request');

    // Upload valid binary image (valid 1x1 transparent PNG: 89 50 4E 47 0D 0A 1A 0A ...)
    const validPngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    const validFormData = new FormData();
    const validBlob = new Blob([validPngBuffer], { type: 'image/png' });
    validFormData.append('image', validBlob, 'test-pixel.png');

    const validUploadRes = await fetch(`${baseUrl}/api/admin/upload`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:5173',
      },
      body: validFormData,
    });
    const validUploadJson = await validUploadRes.json();
    assert(
      validUploadRes.status === 200 && typeof validUploadJson.url === 'string',
      'Valid binary PNG image with matching magic bytes uploaded successfully'
    );

    // ----------------------------------------------------
    // TEST 15: Database Table Integrity & Regression
    // ----------------------------------------------------
    const ordersTable = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'"
    );
    assert(ordersTable.rows.length >= 16, 'Table "orders" schema is completely intact');

    const paymentsTable = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'payments'"
    );
    assert(paymentsTable.rows.length >= 10, 'Table "payments" schema is completely intact');

    const bookingsTable = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'consultation_bookings'"
    );
    assert(bookingsTable.rows.length >= 10, 'Table "consultation_bookings" schema is completely intact');

    console.log('\n====================================================');
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;
    console.log(`  VERIFICATION RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('====================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test suite runtime error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSecuritySuite();
