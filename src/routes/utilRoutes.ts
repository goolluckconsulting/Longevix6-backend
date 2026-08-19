import { Router, Request, Response } from 'express';
import pool from '../config/db';
import { sendPatientConfirmationEmail, sendClinicBookingAlert } from '../services/emailService';

const router = Router();

// Approximate Pincode State & City mapper for major Indian postal circles
const PINCODE_PREFIX_MAP: Record<string, { state: string; city: string }> = {
  '11': { state: 'Delhi', city: 'New Delhi' },
  '12': { state: 'Haryana', city: 'Gurugram / Faridabad' },
  '13': { state: 'Haryana', city: 'Ambala / Karnal' },
  '14': { state: 'Punjab', city: 'Ludhiana / Jalandhar' },
  '15': { state: 'Punjab', city: 'Bathinda / Firozpur' },
  '16': { state: 'Punjab / Chandigarh', city: 'Chandigarh' },
  '17': { state: 'Himachal Pradesh', city: 'Shimla / Solan' },
  '18': { state: 'Jammu & Kashmir', city: 'Jammu' },
  '19': { state: 'Jammu & Kashmir', city: 'Srinagar' },
  '20': { state: 'Uttar Pradesh', city: 'Noida / Ghaziabad' },
  '21': { state: 'Uttar Pradesh', city: 'Kanpur / Prayagraj' },
  '22': { state: 'Uttar Pradesh', city: 'Lucknow / Varanasi' },
  '24': { state: 'Uttarakhand', city: 'Dehradun / Haridwar' },
  '25': { state: 'Uttar Pradesh', city: 'Meerut' },
  '26': { state: 'Uttarakhand', city: 'Haldwani' },
  '28': { state: 'Uttar Pradesh', city: 'Agra' },
  '30': { state: 'Rajasthan', city: 'Jaipur' },
  '31': { state: 'Rajasthan', city: 'Udaipur' },
  '32': { state: 'Rajasthan', city: 'Kota' },
  '33': { state: 'Rajasthan', city: 'Bikaner' },
  '34': { state: 'Rajasthan', city: 'Jodhpur' },
  '36': { state: 'Gujarat', city: 'Rajkot' },
  '38': { state: 'Gujarat', city: 'Ahmedabad' },
  '39': { state: 'Gujarat', city: 'Surat / Vadodara' },
  '40': { state: 'Maharashtra', city: 'Mumbai' },
  '41': { state: 'Maharashtra', city: 'Pune' },
  '42': { state: 'Maharashtra', city: 'Nashik' },
  '43': { state: 'Maharashtra', city: 'Chhatrapati Sambhaji Nagar' },
  '44': { state: 'Maharashtra', city: 'Nagpur' },
  '45': { state: 'Madhya Pradesh', city: 'Indore' },
  '46': { state: 'Madhya Pradesh', city: 'Bhopal' },
  '47': { state: 'Madhya Pradesh', city: 'Gwalior' },
  '48': { state: 'Madhya Pradesh', city: 'Jabalpur' },
  '49': { state: 'Chhattisgarh', city: 'Raipur' },
  '50': { state: 'Telangana', city: 'Hyderabad' },
  '51': { state: 'Andhra Pradesh', city: 'Tirupati / Kurnool' },
  '52': { state: 'Andhra Pradesh', city: 'Vijayawada' },
  '53': { state: 'Andhra Pradesh', city: 'Visakhapatnam' },
  '56': { state: 'Karnataka', city: 'Bengaluru' },
  '57': { state: 'Karnataka', city: 'Mangaluru / Mysuru' },
  '58': { state: 'Karnataka', city: 'Hubballi-Dharwad' },
  '59': { state: 'Karnataka', city: 'Belagavi' },
  '60': { state: 'Tamil Nadu', city: 'Chennai' },
  '61': { state: 'Tamil Nadu', city: 'Tiruchirappalli' },
  '62': { state: 'Tamil Nadu', city: 'Madurai' },
  '63': { state: 'Tamil Nadu', city: 'Salem / Vellore' },
  '64': { state: 'Tamil Nadu', city: 'Coimbatore' },
  '67': { state: 'Kerala', city: 'Kozhikode' },
  '68': { state: 'Kerala', city: 'Kochi' },
  '69': { state: 'Kerala', city: 'Thiruvananthapuram' },
  '70': { state: 'West Bengal', city: 'Kolkata' },
  '71': { state: 'West Bengal', city: 'Howrah' },
  '72': { state: 'West Bengal', city: 'Midnapore' },
  '73': { state: 'West Bengal', city: 'Siliguri' },
  '75': { state: 'Odisha', city: 'Bhubaneswar' },
  '76': { state: 'Odisha', city: 'Cuttack / Berhampur' },
  '77': { state: 'Odisha', city: 'Rourkela' },
  '78': { state: 'Assam', city: 'Guwahati' },
  '79': { state: 'North East', city: 'Shillong / Imphal' },
  '80': { state: 'Bihar', city: 'Patna' },
  '81': { state: 'Bihar', city: 'Bhagalpur' },
  '82': { state: 'Bihar', city: 'Gaya' },
  '83': { state: 'Jharkhand', city: 'Ranchi / Jamshedpur' },
  '84': { state: 'Bihar', city: 'Muzaffarpur' },
};

router.get('/pincode/:pincode', async (req: Request, res: Response) => {
  const { pincode } = req.params;

  if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ success: false, message: 'Invalid 6-digit Pincode' });
  }

  const prefix = pincode.substring(0, 2);
  const matched = PINCODE_PREFIX_MAP[prefix];

  if (matched) {
    return res.json({
      success: true,
      pincode,
      city: matched.city,
      state: matched.state,
      country: 'India',
      serviceable: true,
      estimatedDays: '3–5 business days',
    });
  }

  return res.json({
    success: true,
    pincode,
    city: '',
    state: '',
    country: 'India',
    serviceable: true,
    estimatedDays: '3–5 business days',
  });
});

// Consultation Booking API (saves directly into PostgreSQL consultation_bookings table)
router.post('/consultations/book', async (req: Request, res: Response) => {
  try {
    const {
      patientName,
      phone,
      email,
      preferredDate,
      preferredTimeSlot,
      primaryConcern,
      treatmentName,
    } = req.body;

    if (!patientName || !phone) {
      return res.status(400).json({ success: false, message: 'Patient name and phone number are required' });
    }

    const bookingRef = `CON-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const insertSql = `
      INSERT INTO consultation_bookings (
        booking_reference, patient_name, phone, email, preferred_date,
        preferred_time_slot, primary_concern, treatment_name, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, booking_reference, created_at;
    `;

    const result = await pool.query(insertSql, [
      bookingRef,
      patientName,
      phone,
      email || null,
      preferredDate || new Date().toISOString().split('T')[0],
      preferredTimeSlot || 'Morning (10:00 AM - 01:00 PM)',
      primaryConcern || null,
      treatmentName || 'General Clinical Consultation',
      'confirmed',
    ]);

    const bookingData = {
      bookingReference: bookingRef,
      patientName,
      phone,
      email: email || undefined,
      preferredDate: preferredDate || new Date().toISOString().split('T')[0],
      preferredTimeSlot: preferredTimeSlot || 'Morning (10:00 AM - 01:00 PM)',
      treatmentName: treatmentName || 'General Clinical Consultation',
      primaryConcern: primaryConcern || undefined,
    };

    // Asynchronously dispatch emails without blocking API response
    sendPatientConfirmationEmail(bookingData).catch((err) =>
      console.error('[BookingRoute] Patient email dispatch error:', err)
    );
    sendClinicBookingAlert(bookingData).catch((err) =>
      console.error('[BookingRoute] Clinic alert email dispatch error:', err)
    );

    return res.status(201).json({
      success: true,
      message: 'Clinical consultation scheduled successfully',
      data: {
        bookingId: result.rows[0].id,
        bookingReference: bookingRef,
      },
    });
  } catch (error: any) {
    console.error('Error booking consultation:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
