import { Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../config/db';

export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // ── 1. Input validation ───────────────────────────────────────────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required payment verification parameters',
      });
    }

    // ── 2. Confirm key secret is configured ───────────────────────────────────
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('RAZORPAY_KEY_SECRET is not set — payment signature cannot be verified');
      return res.status(500).json({
        success: false,
        message: 'Payment gateway is not configured on the server.',
      });
    }

    // ── 3. HMAC-SHA256 Signature Verification ────────────────────────────────
    // This is the only accepted verification path.
    // Dev/test bypasses have been intentionally removed.
    // Use real Razorpay TEST MODE keys and the Razorpay test dashboard to
    // generate valid signatures during development.
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn(
        `[payment] Signature mismatch for order ${razorpay_order_id} / payment ${razorpay_payment_id}`,
      );
      return res.status(400).json({
        success: false,
        message: 'Payment signature verification failed',
      });
    }

    // ── 4. Persist to Database ────────────────────────────────────────────────
    // Idempotency is enforced at two layers:
    //
    //   a) UPDATE guard: only marks the order paid when payment_status is still
    //      'unpaid'. Already-paid, refunded, or cancelled orders are untouched.
    //      A repeated call simply affects 0 rows (logged, but not an error).
    //
    //   b) INSERT ON CONFLICT DO NOTHING: a duplicate razorpay_payment_id row
    //      is silently ignored, so repeated verify calls never create duplicate
    //      payment records.
    //
    // If pool.connect() itself throws (DB unavailable), it is re-thrown and
    // caught by the outer handler, which returns 500.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update order — guarded against overwriting already-resolved statuses
      const updateResult = await client.query<{ id: string; total_amount: string }>(
        `UPDATE orders
         SET    status         = 'paid',
                payment_status = 'paid',
                updated_at     = CURRENT_TIMESTAMP
         WHERE  razorpay_order_id = $1
           AND  payment_status NOT IN ('paid', 'refunded', 'cancelled')
         RETURNING id, total_amount`,
        [razorpay_order_id],
      );

      const orderId = updateResult.rows[0]?.id ?? null;
      const amount  = parseFloat(updateResult.rows[0]?.total_amount ?? '0');

      if (updateResult.rows.length === 0) {
        // Order was already paid (or refunded/cancelled) — this is a duplicate verify call.
        console.info(
          `[idempotency] Duplicate verify call — order ${razorpay_order_id} ` +
          `already in resolved state; payment ${razorpay_payment_id} ignored.`,
        );
      }

      // Insert payment record — ON CONFLICT DO NOTHING keeps this idempotent
      await client.query(
        `INSERT INTO payments (
           order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature,
           payment_method, amount, currency, status, raw_payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (razorpay_payment_id) DO NOTHING`,
        [
          orderId,
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          'online',
          amount,
          'INR',
          'captured',
          JSON.stringify(req.body),
        ],
      );

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr; // Re-throw → outer catch → 500
    } finally {
      client.release();
    }

    // Reached only when DB operations succeeded
    return res.json({
      success: true,
      message: 'Payment verified and captured successfully',
      data: {
        orderId:   razorpay_order_id,
        paymentId: razorpay_payment_id,
        status:    'paid',
      },
    });

  } catch (error: any) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({
      success: false,
      message: 'Payment verification failed. Please contact support if money was deducted.',
    });
  }
};
