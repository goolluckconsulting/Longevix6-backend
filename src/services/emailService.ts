import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || 'gastroclinic1234@gmail.com',
    pass: process.env.SMTP_PASS?.replace(/\s+/g, ''), // Strip spaces in Google app passwords
  },
});

export interface ConsultationEmailData {
  bookingReference: string;
  patientName: string;
  phone: string;
  email?: string;
  preferredDate: string;
  preferredTimeSlot: string;
  treatmentName: string;
  primaryConcern?: string;
}

/**
 * Convert user selected preferredDate (YYYY-MM-DD) and preferredTimeSlot to UTC timestamps
 */
export function parseToUtcDates(dateStr?: string, timeSlot?: string) {
  let targetDate = new Date();
  if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    targetDate = new Date(Date.UTC(y, m - 1, d));
  } else {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
  }

  let istHour = 11;
  let istMinute = 0;

  if (timeSlot) {
    if (timeSlot.includes('10:00')) { istHour = 10; istMinute = 0; }
    else if (timeSlot.includes('11:30')) { istHour = 11; istMinute = 30; }
    else if (timeSlot.includes('02:00')) { istHour = 14; istMinute = 0; }
    else if (timeSlot.includes('03:30')) { istHour = 15; istMinute = 30; }
    else if (timeSlot.includes('05:00')) { istHour = 17; istMinute = 0; }
    else if (timeSlot.includes('06:30')) { istHour = 18; istMinute = 30; }
  }

  const utcYear = targetDate.getUTCFullYear();
  const utcMonth = targetDate.getUTCMonth();
  const utcDay = targetDate.getUTCDate();

  // Convert IST (UTC+5:30) to UTC milliseconds
  const istDateMs = Date.UTC(utcYear, utcMonth, utcDay, istHour, istMinute) - 5.5 * 60 * 60 * 1000;
  const startDate = new Date(istDateMs);
  const endDate = new Date(istDateMs + 60 * 60 * 1000); // 1-hour consultation session

  const formatIcsDate = (d: Date) => {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  return {
    dtStart: formatIcsDate(startDate),
    dtEnd: formatIcsDate(endDate),
    startDate,
    endDate,
  };
}

/**
 * Generate standard RFC 5545 iCalendar (METHOD:REQUEST) payload for Dr. Ankita Gupta's Google Calendar Auto-Mapping
 */
export function generateICalendarEvent(data: ConsultationEmailData, doctorEmail: string): string {
  const { dtStart, dtEnd } = parseToUtcDates(data.preferredDate, data.preferredTimeSlot);
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const uid = `longevix-${data.bookingReference || Date.now()}@longevix.com`;
  const summary = `Longevix6 Consultation: ${data.treatmentName} - ${data.patientName}`;
  
  const description = `Clinical Consultation Appointment\\n\\n` +
    `• Booking Ref: ${data.bookingReference}\\n` +
    `• Patient Name: ${data.patientName}\\n` +
    `• Patient Phone: ${data.phone}\\n` +
    `• Patient Email: ${data.email || 'N/A'}\\n` +
    `• Procedure / Program: ${data.treatmentName}\\n` +
    `• Supervising Physician: Dr. Ankita Gupta (Gold Medalist M.D., DM)\\n` +
    `• Patient Concern: ${data.primaryConcern || 'General Clinical Consultation'}\\n\\n` +
    `Clinic Location: Longevix6 Wellness Clinic, Greater Kailash, South Delhi\\n` +
    `Clinic Contact: +91 87505 31869 / +91 99583 06817`;

  const location = `Longevix6 Wellness Clinic, Greater Kailash, South Delhi, Delhi 110048`;

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Longevix6 Clinic//Clinical Consultation Scheduling//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `ORGANIZER;CN=Longevix6 Clinic:mailto:gastroclinic1234@gmail.com`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Dr. Ankita Gupta:mailto:${doctorEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: Longevix6 Consultation with Dr. Ankita Gupta',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.filter(Boolean).join('\r\n');
}

/**
 * Send a warm, luxury Thank You & Confirmation email to the Patient (Clean HTML, No calendar attachments)
 */
export const sendPatientConfirmationEmail = async (data: ConsultationEmailData) => {
  if (!data.email) {
    console.log('[EmailService] No patient email provided. Skipping patient email.');
    return;
  }

  const fromAddress = process.env.SMTP_FROM || `"Longevix6 Wellness Clinic" <gastroclinic1234@gmail.com>`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thank You - Consultation Confirmed</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f0e8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .wrapper { max-width: 600px; margin: 24px auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2dbcf; box-shadow: 0 10px 25px rgba(0,0,0,0.06); }
    .header { background-color: #0b0f17; padding: 36px 30px; text-align: center; border-bottom: 3px solid #c59b6c; }
    .badge { display: inline-block; padding: 4px 14px; border-radius: 999px; background-color: #1e293b; border: 1px solid #c59b6c; color: #e0a96d; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px; }
    .title { color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 6px 0; }
    .subtitle { color: #94a3b8; font-size: 13px; margin: 0; font-weight: 400; }
    .content { padding: 32px 30px; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
    .lead-text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .card { background-color: #faf8f5; border: 1px solid #e5dfd3; border-radius: 16px; padding: 20px; margin-bottom: 24px; }
    .ref-badge { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #dcd5c7; padding-bottom: 12px; margin-bottom: 14px; }
    .ref-label { font-size: 10px; font-weight: 800; color: #64748b; letter-spacing: 1.5px; text-transform: uppercase; }
    .ref-val { font-size: 14px; font-weight: 800; color: #b58253; font-family: monospace; }
    .detail-row { display: table; width: 100%; margin-bottom: 10px; font-size: 13px; }
    .detail-label { display: table-cell; width: 38%; color: #64748b; font-weight: 600; }
    .detail-val { display: table-cell; color: #0f172a; font-weight: 700; }
    .doctor-box { background: linear-gradient(135deg, #111827 0%, #1e293b 100%); color: #ffffff; border-radius: 14px; padding: 18px; margin-bottom: 24px; border-left: 4px solid #c59b6c; }
    .doctor-title { font-size: 11px; font-weight: 800; color: #e0a96d; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }
    .doctor-name { font-size: 16px; font-weight: 700; margin: 0 0 2px 0; color: #ffffff; }
    .doctor-creds { font-size: 12px; color: #94a3b8; margin: 0; }
    .location-box { font-size: 12px; color: #64748b; background-color: #f1f5f9; padding: 14px; border-radius: 12px; margin-bottom: 24px; }
    .footer { background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; }
    .btn { display: inline-block; background: linear-gradient(135deg, #c59b6c 0%, #b58253 100%); color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 12px 28px; border-radius: 12px; text-transform: uppercase; letter-spacing: 1px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="badge">✦ Longevix6 Clinic ✦</div>
      <h1 class="title">Thank You for Scheduling</h1>
      <p class="subtitle">Your appointment has been registered with Dr. Ankita Gupta</p>
    </div>

    <div class="content">
      <div class="greeting">Dear ${data.patientName},</div>
      <p class="lead-text">
        Thank you for choosing <strong>Longevix6 Wellness &amp; Longevity Clinic</strong>. We have successfully registered your clinical consultation. Our medical concierge team is preparing for your evaluation.
      </p>

      <div class="card">
        <div class="ref-badge">
          <span class="ref-label">Booking Reference</span>
          <span class="ref-val">${data.bookingReference}</span>
        </div>

        <div class="detail-row">
          <span class="detail-label">Procedure / Program:</span>
          <span class="detail-val">${data.treatmentName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Scheduled Date:</span>
          <span class="detail-val">${data.preferredDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Time Slot:</span>
          <span class="detail-val">${data.preferredTimeSlot}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Registered Phone:</span>
          <span class="detail-val">${data.phone}</span>
        </div>
        ${
          data.primaryConcern
            ? `<div class="detail-row">
                <span class="detail-label">Primary Concern:</span>
                <span class="detail-val">${data.primaryConcern}</span>
              </div>`
            : ''
        }
      </div>

      <div class="doctor-box">
        <div class="doctor-title">Super-Specialist Clinical Leadership</div>
        <div class="doctor-name">Dr. Ankita Gupta</div>
        <div class="doctor-creds">M.D., DM Gastroenterology · Gold Medalist · Featured in Forbes India List</div>
      </div>

      <div class="location-box">
        <strong>📍 Clinic Location:</strong> Longevix6 Wellness Clinic, Greater Kailash, South Delhi, Delhi 110048<br>
        <strong>📞 Helpline / WhatsApp:</strong> +91 87505 31869<br>
        <strong>🕒 Clinic Timings:</strong> Monday – Saturday: 10:00 AM – 07:30 PM
      </div>

      <div style="text-align: center; margin-top: 10px;">
        <a href="https://wa.me/918750531869?text=Hi%20Longevix6%2C%20my%20booking%20reference%20is%20${encodeURIComponent(data.bookingReference)}" class="btn">
          Connect with Clinic on WhatsApp
        </a>
      </div>
    </div>

    <div class="footer">
      © ${new Date().getFullYear()} Longevix6 Wellness &amp; Longevity Clinic. All rights reserved.<br>
      Thank you for trusting Longevix6 with your wellness journey.
    </div>
  </div>
</body>
</html>
  `;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: data.email,
      subject: `Thank You: Consultation Scheduled for ${data.treatmentName} (Ref: ${data.bookingReference}) - Longevix6`,
      html: htmlContent,
    });
    console.log('[EmailService] Patient thank you email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('[EmailService] Failed to send patient email:', error);
  }
};

/**
 * Send an Instant Alert email to Dr. Ankita Gupta (drankitagupta83@gmail.com) with Google Calendar Auto-Mapping Event
 */
export const sendClinicBookingAlert = async (data: ConsultationEmailData) => {
  const doctorEmail = process.env.CLINIC_NOTIFICATION_EMAIL || 'drankitagupta83@gmail.com';
  const fromAddress = process.env.SMTP_FROM || `"Longevix6 Booking System" <gastroclinic1234@gmail.com>`;
  const icsContent = generateICalendarEvent(data, doctorEmail);
  const { dtStart, dtEnd } = parseToUtcDates(data.preferredDate, data.preferredTimeSlot);

  const googleCalDirectUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    `Longevix6 Consultation: ${data.treatmentName} - ${data.patientName}`
  )}&dates=${dtStart}/${dtEnd}&details=${encodeURIComponent(
    `Clinical consultation for ${data.treatmentName}.\nBooking Ref: ${data.bookingReference}\nPatient: ${data.patientName}\nPhone: ${data.phone}\nEmail: ${data.email || 'N/A'}\nNotes: ${data.primaryConcern || 'N/A'}`
  )}&location=${encodeURIComponent('Longevix6 Wellness Clinic, Greater Kailash, South Delhi')}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: sans-serif; background-color: #f8fafc; color: #0f172a; padding: 20px; }
    .box { max-width: 580px; margin: auto; background: white; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0; }
    .badge { background: #b58253; color: white; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .key { color: #64748b; font-weight: 600; width: 40%; }
    .val { color: #0f172a; font-weight: 700; }
    .cal-btn { display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="box">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h2 style="margin: 0; font-size: 18px; color: #0f172a;">🔔 New Consultation Booked!</h2>
      <span class="badge">${data.bookingReference}</span>
    </div>
    
    <table>
      <tr>
        <td class="key">Patient Name:</td>
        <td class="val">${data.patientName}</td>
      </tr>
      <tr>
        <td class="key">Phone Number:</td>
        <td class="val"><a href="tel:${data.phone}">${data.phone}</a> (<a href="https://wa.me/${data.phone.replace(/[^0-9]/g, '')}">WhatsApp</a>)</td>
      </tr>
      <tr>
        <td class="key">Email:</td>
        <td class="val">${data.email || 'N/A'}</td>
      </tr>
      <tr>
        <td class="key">Requested Procedure:</td>
        <td class="val">${data.treatmentName}</td>
      </tr>
      <tr>
        <td class="key">Scheduled Date:</td>
        <td class="val"><strong>${data.preferredDate}</strong></td>
      </tr>
      <tr>
        <td class="key">Time Slot:</td>
        <td class="val"><strong>${data.preferredTimeSlot}</strong></td>
      </tr>
      ${
        data.primaryConcern
          ? `<tr>
              <td class="key">Patient Concern / Note:</td>
              <td class="val">${data.primaryConcern}</td>
            </tr>`
          : ''
      }
    </table>

    <div style="text-align: center; margin-top: 18px;">
      <a href="${googleCalDirectUrl}" target="_blank" class="cal-btn">
        📅 Open in Dr. Ankita's Google Calendar
      </a>
    </div>

    <div style="margin-top: 20px; font-size: 11px; color: #64748b; text-align: center;">
      This lead has been saved to the PostgreSQL database table <code>consultation_bookings</code> and mapped into Google Calendar for <strong>${doctorEmail}</strong>.
    </div>
  </div>
</body>
</html>
  `;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: doctorEmail,
      subject: `📅 [NEW APPOINTMENT] ${data.patientName} - ${data.treatmentName} (${data.preferredDate} @ ${data.preferredTimeSlot})`,
      html: htmlContent,
      icalEvent: {
        filename: 'doctor-appointment-invite.ics',
        method: 'REQUEST',
        content: icsContent,
      },
      alternatives: [
        {
          contentType: 'text/calendar; charset="utf-8"; method=REQUEST',
          content: icsContent,
        },
      ],
    });
    console.log(`[EmailService] Doctor booking alert & Calendar event sent to ${doctorEmail}:`, info.messageId);
    return info;
  } catch (error) {
    console.error('[EmailService] Failed to send doctor alert email:', error);
  }
};
