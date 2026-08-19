import { Router } from 'express';
import { verifyPayment } from '../controllers/paymentController';
import { getRazorpayKeyId } from '../config/razorpay';

const router = Router();

// Public key retrieval endpoint for frontend checkout modal
router.get('/key', (req, res) => {
  return res.json({ key: getRazorpayKeyId() });
});

// Signature verification
router.post('/verify', verifyPayment);

export default router;
