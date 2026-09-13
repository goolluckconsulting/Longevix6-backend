import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { razorpayInstance } from '../config/razorpay';
import pool from '../config/db';

// ── Server-side product catalogue (source of truth for prices) ──────────────
// IDs MUST exactly match the `id` field in frontend's ProductsSection.tsx.
// Prices MUST exactly match the `price` field in ProductsSection.tsx.
const PRODUCT_PRICES: Record<string, { name: string; price: number }> = {
  'pre-pro-post-biotic':   { name: 'Pre, Pro & Postbiotic Gut Formula',       price: 1499 },
  'gut-fiber':             { name: 'Gut Fiber',                                price: 999  },
  'fatty-liver-support':   { name: 'Fatty Liver Support',                      price: 1299 },
  'longevity-smart-pills': { name: 'Longevity Smart Pills',                    price: 3499 },
  'clean-vegan-protein':   { name: 'Clean Vegan Protein',                      price: 2199 },
  'complete-womens-health':{ name: "Complete Women's Health Supplement",       price: 1199 },
};


const GST_RATE                = 0.12;
const FREE_SHIPPING_THRESHOLD = 999;
const STANDARD_SHIPPING_CHARGE = 60;

// ── Zod validation schema ────────────────────────────────────────────────────
const CreateOrderSchema = z.object({
  customerName:           z.string().min(2,  'Name is required'),
  customerEmail:          z.string().email(  'Valid email is required'),
  customerPhone:          z.string().min(10, 'Valid 10-digit phone number is required'),
  shippingAddressLine1:   z.string().min(5,  'Address is required'),
  shippingAddressLine2:   z.string().optional(),
  shippingLandmark:       z.string().optional(),
  city:                   z.string().min(2,  'City is required'),
  state:                  z.string().min(2,  'State is required'),
  pincode:                z.string().min(6,  'Valid 6-digit Pincode is required'),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity:  z.number().int().positive('Quantity must be at least 1'),
    }),
  ).min(1, 'At least one item is required in cart'),
  notes: z.string().optional(),
});

// ── Idempotency key generator ────────────────────────────────────────────────
/**
 * Produces a deterministic SHA-256 hex string from the logical checkout
 * identity: customer email + sorted cart items + server-computed total amount.
 *
 * The same customer submitting the same cart for the same amount will always
 * produce the same key, allowing the backend to detect and short-circuit
 * duplicate order-creation requests without hitting Razorpay again.
 */
function generateIdempotencyKey(
  customerEmail: string,
  items: Array<{ productId: string; quantity: number }>,
  totalAmount: number,
): string {
  const normalized = {
    email: customerEmail.toLowerCase().trim(),
    // Sort by productId so item order in the array does not affect the key
    items: [...items]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map(i => ({ id: i.productId, qty: i.quantity })),
    amount: totalAmount,
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

// ── Row shape returned from order queries ────────────────────────────────────
interface OrderRow {
  id: string;
  order_number: string;
  razorpay_order_id: string;
  subtotal: string;
  gst: string;
  shipping_charge: string;
  total_amount: string;
}

// ── createOrder ──────────────────────────────────────────────────────────────
export const createOrder = async (req: Request, res: Response) => {
  try {
    // 1. Validate request body
    const parseResult = CreateOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order input data',
        errors: parseResult.error.errors,
      });
    }

    const {
      customerName, customerEmail, customerPhone,
      shippingAddressLine1, shippingAddressLine2, shippingLandmark,
      city, state, pincode, items, notes,
    } = parseResult.data;

    // 2. Server-side price calculation (cart total cannot be trusted from client)
    let subtotal = 0;
    const verifiedItems = items.map((item) => {
      const product = PRODUCT_PRICES[item.productId];
      if (!product) throw new Error(`Product not found: ${item.productId}`);
      const itemTotal = product.price * item.quantity;
      subtotal += itemTotal;
      return {
        productId:   item.productId,
        productName: product.name,
        unitPrice:   product.price,
        quantity:    item.quantity,
        totalPrice:  itemTotal,
      };
    });

    const gst            = Math.round(subtotal * GST_RATE);
    const shippingCharge = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_CHARGE;
    const totalAmount    = subtotal + gst + shippingCharge;
    const amountInPaise  = Math.round(totalAmount * 100);

    // 3. Generate deterministic idempotency key
    const idempotencyKey = generateIdempotencyKey(customerEmail, items, totalAmount);

    // 4. Idempotency guard — return existing pending order if one already exists
    //    This covers: double-clicks, frontend retries, and mobile back-button re-submits.
    const existingCheck = await pool.query<OrderRow>(
      `SELECT id, order_number, razorpay_order_id, subtotal, gst, shipping_charge, total_amount
       FROM   orders
       WHERE  idempotency_key = $1
         AND  payment_status  = 'unpaid'
       LIMIT  1`,
      [idempotencyKey],
    );

    if (existingCheck.rows.length > 0) {
      const o = existingCheck.rows[0];
      console.info(
        `[idempotency] Returning existing pending order ${o.order_number} ` +
        `(key prefix: ${idempotencyKey.slice(0, 12)}…)`,
      );
      return res.status(200).json({
        success: true,
        message: 'Existing pending order returned',
        data: {
          orderId:        o.id,
          orderNumber:    o.order_number,
          razorpayOrderId: o.razorpay_order_id,
          amount:         Math.round(parseFloat(o.total_amount) * 100),
          currency:       'INR',
          breakdown: {
            subtotal:      parseFloat(o.subtotal),
            gst:           parseFloat(o.gst),
            shippingCharge: parseFloat(o.shipping_charge),
            totalAmount:   parseFloat(o.total_amount),
          },
          items: verifiedItems,
        },
      });
    }

    // 5. Create Razorpay order — only reached for genuinely new requests
    const orderNumber = `LGX-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
    let razorpayOrderId: string;

    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      try {
        const rzpOrder = await razorpayInstance.orders.create({
          amount:   amountInPaise,
          currency: 'INR',
          receipt:  orderNumber,
          notes: { customerName, customerEmail, customerPhone, orderNumber },
        });
        razorpayOrderId = rzpOrder.id;
      } catch (rzpErr: any) {
        console.error('Razorpay order creation failed:', rzpErr?.message ?? rzpErr);
        return res.status(502).json({
          success: false,
          message: 'Payment gateway is temporarily unavailable. Please try again in a moment.',
        });
      }
    } else {
      // Keys not configured — local dev without a Razorpay account
      console.warn(
        '[dev] Razorpay keys not set — using mock order ID. ' +
        'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET for real payments.',
      );
      razorpayOrderId = `order_mock_${Date.now()}`;
    }

    // 6. Persist to PostgreSQL
    //    ON CONFLICT (idempotency_key) DO NOTHING handles the concurrent-race edge case:
    //    if two identical requests both passed step 4 simultaneously, only one INSERT
    //    wins. The loser detects zero rows returned and fetches the winner's row.
    const client = await pool.connect();
    let responseData: {
      orderId: string;
      orderNumber: string;
      razorpayOrderId: string;
      amount: number;
      currency: string;
      breakdown: { subtotal: number; gst: number; shippingCharge: number; totalAmount: number };
      items: typeof verifiedItems;
    };

    try {
      await client.query('BEGIN');

      const insertResult = await client.query<OrderRow>(
        `INSERT INTO orders (
           order_number, razorpay_order_id, idempotency_key,
           customer_name, customer_email, customer_phone,
           shipping_address_line1, shipping_address_line2, shipping_landmark,
           city, state, pincode,
           subtotal, gst, shipping_charge, total_amount,
           status, payment_status, notes
         ) VALUES (
           $1,  $2,  $3,  $4,  $5,  $6,  $7,
           $8,  $9,  $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19
         )
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, order_number, razorpay_order_id,
                   subtotal, gst, shipping_charge, total_amount`,
        [
          orderNumber, razorpayOrderId, idempotencyKey,
          customerName, customerEmail, customerPhone,
          shippingAddressLine1, shippingAddressLine2 ?? null, shippingLandmark ?? null,
          city, state, pincode,
          subtotal, gst, shippingCharge, totalAmount,
          'pending', 'unpaid', notes ?? null,
        ],
      );

      if (insertResult.rows.length === 0) {
        // Race condition: another concurrent request won the insert.
        // Fetch and return that winner's order so the frontend uses a consistent Razorpay order ID.
        console.info(
          `[idempotency] Race detected — returning concurrent order for key ${idempotencyKey.slice(0, 12)}…`,
        );
        const raceRow = await client.query<OrderRow>(
          `SELECT id, order_number, razorpay_order_id, subtotal, gst, shipping_charge, total_amount
           FROM   orders
           WHERE  idempotency_key = $1`,
          [idempotencyKey],
        );
        await client.query('COMMIT');

        const r = raceRow.rows[0];
        responseData = {
          orderId:        r.id,
          orderNumber:    r.order_number,
          razorpayOrderId: r.razorpay_order_id,
          amount:         Math.round(parseFloat(r.total_amount) * 100),
          currency:       'INR',
          breakdown: {
            subtotal:      parseFloat(r.subtotal),
            gst:           parseFloat(r.gst),
            shippingCharge: parseFloat(r.shipping_charge),
            totalAmount:   parseFloat(r.total_amount),
          },
          items: verifiedItems,
        };
      } else {
        // Happy path: new order inserted — now insert the line items
        const newRow      = insertResult.rows[0];
        const newOrderDbId = newRow.id;

        for (const item of verifiedItems) {
          await client.query(
            `INSERT INTO order_items
               (order_id, product_id, product_name, unit_price, quantity, total_price)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [newOrderDbId, item.productId, item.productName,
             item.unitPrice, item.quantity, item.totalPrice],
          );
        }

        await client.query('COMMIT');

        responseData = {
          orderId:        newOrderDbId,
          orderNumber,
          razorpayOrderId,
          amount:         amountInPaise,
          currency:       'INR',
          breakdown:      { subtotal, gst, shippingCharge, totalAmount },
          items:          verifiedItems,
        };
      }
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr; // Re-throw → outer catch → 500
    } finally {
      client.release();
    }

    return res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: responseData,
    });

  } catch (error: any) {
    console.error('Error creating order:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error while creating order',
    });
  }
};

// ── getOrderById ─────────────────────────────────────────────────────────────
export const getOrderById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT o.*,
         json_agg(
           json_build_object(
             'id',          oi.id,
             'productId',   oi.product_id,
             'productName', oi.product_name,
             'unitPrice',   oi.unit_price,
             'quantity',    oi.quantity,
             'totalPrice',  oi.total_price
           )
         ) AS items
       FROM  orders o
       LEFT  JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id::text = $1
          OR o.order_number      = $1
          OR o.razorpay_order_id = $1
       GROUP BY o.id`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    return res.json({ success: true, order: result.rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
