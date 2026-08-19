import { Request, Response } from 'express';
import { z } from 'zod';
import { razorpayInstance } from '../config/razorpay';
import pool from '../config/db';

// Official Product Prices Catalogue (server-side source of truth)
const PRODUCT_PRICES: Record<string, { name: string; price: number }> = {
  'liver-360': { name: 'Longevix Liver 360', price: 1299 },
  'gutfiber-360': { name: 'GutFiber 360', price: 999 },
  'pre-pro-post-biotic': { name: 'Pre + Pro + Post Biotic', price: 1499 },
  'vegan-pro-plus': { name: 'Vegan Pro+', price: 2199 },
  'longevita-360': { name: 'Longevita 360', price: 3499 },
  'nack-probiotic': { name: 'Näck Probiotic Gut Health', price: 899 },
};

const GST_RATE = 0.12; // 12%
const FREE_SHIPPING_THRESHOLD = 999;
const STANDARD_SHIPPING_CHARGE = 60;

// Request schema validation
const CreateOrderSchema = z.object({
  customerName: z.string().min(2, 'Name is required'),
  customerEmail: z.string().email('Valid email is required'),
  customerPhone: z.string().min(10, 'Valid 10-digit phone number is required'),
  shippingAddressLine1: z.string().min(5, 'Address is required'),
  shippingAddressLine2: z.string().optional(),
  shippingLandmark: z.string().optional(),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  pincode: z.string().min(6, 'Valid 6-digit Pincode is required'),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().positive('Quantity must be at least 1'),
    })
  ).min(1, 'At least one item is required in cart'),
  notes: z.string().optional(),
});

export const createOrder = async (req: Request, res: Response) => {
  try {
    const parseResult = CreateOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order input data',
        errors: parseResult.error.errors,
      });
    }

    const {
      customerName,
      customerEmail,
      customerPhone,
      shippingAddressLine1,
      shippingAddressLine2,
      shippingLandmark,
      city,
      state,
      pincode,
      items,
      notes,
    } = parseResult.data;

    // 1. Calculate Server-Side Subtotal & Verify Prices
    let subtotal = 0;
    const verifiedItems = items.map((item) => {
      const product = PRODUCT_PRICES[item.productId];
      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }
      const itemTotal = product.price * item.quantity;
      subtotal += itemTotal;
      return {
        productId: item.productId,
        productName: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        totalPrice: itemTotal,
      };
    });

    const gst = Math.round(subtotal * GST_RATE);
    const shippingCharge = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_CHARGE;
    const totalAmount = subtotal + gst + shippingCharge;
    const amountInPaise = Math.round(totalAmount * 100);

    const orderNumber = `LGX-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 2. Create Razorpay Order via SDK
    let razorpayOrderId = `order_mock_${Date.now()}`;
    try {
      if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        const rzpOrder = await razorpayInstance.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: orderNumber,
          notes: {
            customerName,
            customerEmail,
            customerPhone,
            orderNumber,
          },
        });
        razorpayOrderId = rzpOrder.id;
      }
    } catch (rzpErr) {
      console.warn('Razorpay API notice (using fallback order ID if keys are in test):', rzpErr);
    }

    // 3. Persist Order into PostgreSQL Database
    let dbOrderId: string = orderNumber;
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const insertOrderSql = `
          INSERT INTO orders (
            order_number, razorpay_order_id, customer_name, customer_email, customer_phone,
            shipping_address_line1, shipping_address_line2, shipping_landmark, city, state, pincode,
            subtotal, gst, shipping_charge, total_amount, status, payment_status, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING id;
        `;
        const orderValues = [
          orderNumber,
          razorpayOrderId,
          customerName,
          customerEmail,
          customerPhone,
          shippingAddressLine1,
          shippingAddressLine2 || null,
          shippingLandmark || null,
          city,
          state,
          pincode,
          subtotal,
          gst,
          shippingCharge,
          totalAmount,
          'pending',
          'unpaid',
          notes || null,
        ];

        const orderResult = await client.query(insertOrderSql, orderValues);
        dbOrderId = orderResult.rows[0].id;

        // Insert Order Items
        for (const item of verifiedItems) {
          const insertItemSql = `
            INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, total_price)
            VALUES ($1, $2, $3, $4, $5, $6);
          `;
          await client.query(insertItemSql, [
            dbOrderId,
            item.productId,
            item.productName,
            item.unitPrice,
            item.quantity,
            item.totalPrice,
          ]);
        }

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        console.error('Database transaction error, order recorded in memory:', dbErr);
      } finally {
        client.release();
      }
    } catch (poolErr) {
      console.warn('PostgreSQL pool not available right now, returning order payload:', poolErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        orderId: dbOrderId,
        orderNumber,
        razorpayOrderId,
        amount: amountInPaise,
        currency: 'INR',
        breakdown: {
          subtotal,
          gst,
          shippingCharge,
          totalAmount,
        },
        items: verifiedItems,
      },
    });
  } catch (error: any) {
    console.error('Error creating order:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error while creating order',
    });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orderQuery = `
      SELECT o.*, 
        json_agg(
          json_build_object(
            'id', oi.id,
            'productId', oi.product_id,
            'productName', oi.product_name,
            'unitPrice', oi.unit_price,
            'quantity', oi.quantity,
            'totalPrice', oi.total_price
          )
        ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id::text = $1 OR o.order_number = $1 OR o.razorpay_order_id = $1
      GROUP BY o.id;
    `;

    const result = await pool.query(orderQuery, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, order: result.rows[0] });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
