import pool from '../../config/db';
import { DbChatbotSession, LeadCreationResult } from './chatbotTypes';
import { TIME_SLOT_LABEL_MAP } from './longevixFlowConfig';
import { sendClinicBookingAlert } from '../emailService';

export class LeadService {
  /**
   * Derives a deterministic, unique booking reference linked to the session
   */
  public static getDeterministicBookingRef(sessionId: string): string {
    const cleanId = sessionId.replace(/-/g, '').toUpperCase();
    const part1 = cleanId.slice(0, 8);
    const part2 = cleanId.slice(8, 12);
    return `CON-CB-${part1}-${part2}`;
  }

  /**
   * Idempotently creates a lead in consultation_bookings and dispatches clinic notification email
   */
  public static async createLeadFromSession(
    session: DbChatbotSession
  ): Promise<LeadCreationResult> {
    const bookingReference = this.getDeterministicBookingRef(session.id);

    // 1. Idempotency Check: Verify if booking already exists for this session
    const existingCheckSql = `
      SELECT id, booking_reference, patient_name, phone, treatment_name, preferred_time_slot, status
      FROM consultation_bookings
      WHERE booking_reference = $1
      LIMIT 1;
    `;
    const existingRes = await pool.query(existingCheckSql, [bookingReference]);

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      console.log(`[LeadService] Lead already exists (idempotent no-op): ${bookingReference}`);
      return {
        created: false,
        bookingReference: existing.booking_reference,
        leadId: existing.id,
        patientName: existing.patient_name,
        phone: existing.phone,
        treatmentName: existing.treatment_name,
        preferredTimeSlot: existing.preferred_time_slot,
        status: existing.status,
      };
    }

    // 2. Prepare normalized lead data
    const patientName = session.patient_name || 'Valued Patient';
    const phone = session.patient_phone || session.sender_id;
    const preferredDate = new Date().toISOString().split('T')[0];
    const rawSlot = session.preferred_time_slot || 'Morning';
    const slotLabel = TIME_SLOT_LABEL_MAP[rawSlot] || rawSlot;
    const treatmentName = `Longevix6 - ${session.selected_service || 'Consultation'} (${
      session.selected_sub_service || 'Standard'
    })`;
    const primaryConcern = `Chatbot Lead (${session.channel.toUpperCase()}) | Preferred slot: ${rawSlot} | Session ID: ${session.id}`;
    const status = 'pending'; // Reflects unconfirmed callback lead request

    // 3. Persist into consultation_bookings
    const insertSql = `
      INSERT INTO consultation_bookings (
        booking_reference, patient_name, phone, preferred_date,
        preferred_time_slot, primary_concern, treatment_name, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, booking_reference, created_at;
    `;

    const insertRes = await pool.query(insertSql, [
      bookingReference,
      patientName,
      phone,
      preferredDate,
      slotLabel,
      primaryConcern,
      treatmentName,
      status,
    ]);

    const leadId = insertRes.rows[0].id;
    console.log(`[LeadService] Created consultation_bookings lead ${bookingReference} for ${patientName}`);

    // 4. Asynchronously dispatch clinic alert email (non-blocking)
    sendClinicBookingAlert({
      bookingReference,
      patientName,
      phone,
      preferredDate,
      preferredTimeSlot: slotLabel,
      treatmentName,
      primaryConcern,
    }).catch((err) => {
      console.error(`[LeadService] Failed to dispatch clinic booking alert email for ${bookingReference}:`, err);
    });

    return {
      created: true,
      bookingReference,
      leadId,
      patientName,
      phone,
      treatmentName,
      preferredTimeSlot: slotLabel,
      status,
    };
  }

  /**
   * Find existing lead associated with a session
   */
  public static async getLeadBySessionId(sessionId: string): Promise<any | null> {
    const bookingReference = this.getDeterministicBookingRef(sessionId);
    const res = await pool.query(
      `SELECT * FROM consultation_bookings WHERE booking_reference = $1 LIMIT 1;`,
      [bookingReference]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
  }
}
