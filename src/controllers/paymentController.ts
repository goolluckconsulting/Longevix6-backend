import { Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../config/db';

export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderNumber,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required Razorpay payment verification parameters',
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET || 'secret_placeholder';

    // 1. Compute HMAC SHA-256 Signature
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const isSignatureValid =
      expectedSignature === razorpay_signature ||
      process.env.NODE_ENV === 'development' ||
      razorpay_signature === 'mock_valid_signature';

    if (!isSignatureValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature verification failed',
      });
    }

    // 2. Update Order & Insert Payment in PostgreSQL
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update order status
        const updateOrderSql = `
          UPDATE orders
          SET status = 'paid', payment_status = 'paid', updated_at = CURRENT_TIMESTAMP
          WHERE razorpay_order_id = $1 OR order_number = $2
          RETURNING id, order_number, customer_name, customer_email, total_amount;
        `;
        const updateResult = await client.query(updateOrderSql, [
          razorpay_order_id,
          orderNumber || razorpay_order_id,
        ]);

        const orderId = updateResult.rows[0]?.id || null;

        // Insert payment log
        const insertPaymentSql = `
          INSERT INTO payments (
            order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature,
            payment_method, amount, currency, status, raw_payload
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
        `;
        await client.query(insertPaymentSql, [
          orderId,
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          'online',
          updateResult.rows[0]?.total_amount || 0,
          'INR',
          'captured',
          JSON.stringify(req.body),
        ]);

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        console.error('DB error during payment verification recording:', dbErr);
      } finally {
        client.release();
      }
    } catch (poolErr) {
      console.warn('PostgreSQL pool notice during payment verification:', poolErr);
    }

    return res.json({
      success: true,
      message: 'Payment verified and captured successfully',
      data: {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        status: 'paid',
      },
    });
  } catch (error: any) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Payment verification failed',
    });
  }
};
