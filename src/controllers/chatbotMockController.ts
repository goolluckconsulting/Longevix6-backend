import { Request, Response } from 'express';
import { ChatbotEngine } from '../services/chatbot/chatbotEngine';
import { LeadService } from '../services/chatbot/leadService';
import { ChatbotChannel } from '../services/chatbot/chatbotTypes';
import pool from '../config/db';

export class ChatbotMockController {
  /**
   * Reusable helper to mask patient phone numbers for mock inspection response
   * e.g. 9876543210 -> XXXXXX3210
   */
  public static maskPhone(phone?: string | null): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return 'XXXX';
    const last4 = digits.slice(-4);
    const maskLen = Math.max(digits.length - 4, 6);
    return 'X'.repeat(maskLen) + last4;
  }

  /**
   * Middleware/guard to ensure simulator is only accessible in safe environments
   * (development, test, or when explicitly enabled via ENABLE_CHATBOT_MOCK=true)
   */
  private static isSimulatorAllowed(): boolean {
    return (
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test' ||
      process.env.ENABLE_CHATBOT_MOCK === 'true'
    );
  }

  /**
   * POST /api/chatbot/mock/message
   */
  public static async handleMessage(req: Request, res: Response) {
    if (!ChatbotMockController.isSimulatorAllowed()) {
      return res.status(403).json({
        success: false,
        message: 'Mock simulator endpoint is disabled in production',
      });
    }

    try {
      const {
        senderId,
        channel = 'mock',
        text = '',
        buttonPayload = null,
      } = req.body;

      if (!senderId || typeof senderId !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Valid "senderId" is required',
        });
      }

      const validChannels: ChatbotChannel[] = ['mock', 'whatsapp', 'instagram'];
      const targetChannel: ChatbotChannel = validChannels.includes(channel)
        ? channel
        : 'mock';

      // 1. Process message through pure FSM engine
      const reply = await ChatbotEngine.processMessage({
        channel: targetChannel,
        senderId: senderId.trim(),
        text: typeof text === 'string' ? text : '',
        buttonPayload: buttonPayload ? String(buttonPayload) : '',
      });

      // 2. Phase 4 Lead Integration: If callback slot was selected on this turn, persist lead
      let leadInfo = null;
      if (reply.justCompleted && reply.session) {
        try {
          leadInfo = await LeadService.createLeadFromSession(reply.session);
        } catch (leadErr) {
          console.error('[ChatbotMockController] Error during lead creation:', leadErr);
        }
      } else if (reply.session?.id && reply.currentStep === 'completed') {
        // If already completed in past turn, look up existing lead
        const existingLead = await LeadService.getLeadBySessionId(reply.session.id);
        if (existingLead) {
          leadInfo = {
            created: false,
            bookingReference: existingLead.booking_reference,
            leadId: existingLead.id,
            patientName: existingLead.patient_name,
            phone: existingLead.phone,
            treatmentName: existingLead.treatment_name,
            preferredTimeSlot: existingLead.preferred_time_slot,
            status: existingLead.status,
          };
        }
      }

      // 3. Return normalized response
      return res.json({
        success: true,
        data: {
          channel: targetChannel,
          senderId: senderId.trim(),
          currentStep: reply.currentStep,
          text: reply.text,
          uiType: reply.uiType,
          buttons: reply.buttons || [],
          isHumanHandoff: reply.isHumanHandoff,
          session: reply.sessionData,
          lead: leadInfo,
        },
      });
    } catch (error: any) {
      console.error('[ChatbotMockController] Error processing mock message:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal error processing message',
      });
    }
  }

  /**
   * GET /api/chatbot/mock/session/:channel/:senderId
   * or GET /api/chatbot/mock/session/:senderId
   */
  public static async getSession(req: Request, res: Response) {
    if (!ChatbotMockController.isSimulatorAllowed()) {
      return res.status(403).json({
        success: false,
        message: 'Mock simulator endpoint is disabled in production',
      });
    }

    try {
      const channel = (req.params.channel || 'mock') as ChatbotChannel;
      const senderId = req.params.senderId;

      if (!senderId) {
        return res.status(400).json({
          success: false,
          message: 'senderId is required',
        });
      }

      const sessionRes = await pool.query(
        `SELECT id, channel, sender_id, current_step, selected_brand, selected_service,
                selected_sub_service, patient_name, patient_phone, preferred_time_slot,
                is_human_handoff, handoff_at, last_interaction_at, created_at, updated_at
         FROM chatbot_sessions
         WHERE channel = $1 AND sender_id = $2
         LIMIT 1;`,
        [channel, senderId]
      );

      if (sessionRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Chatbot session not found for specified channel and senderId',
        });
      }

      const session = sessionRes.rows[0];
      const lead = await LeadService.getLeadBySessionId(session.id);

      return res.json({
        success: true,
        data: {
          session: {
            ...session,
            patient_phone: ChatbotMockController.maskPhone(session.patient_phone),
          },
          lead: lead
            ? {
                bookingReference: lead.booking_reference,
                patientName: lead.patient_name,
                phone: ChatbotMockController.maskPhone(lead.phone),
                preferredDate: lead.preferred_date,
                preferredTimeSlot: lead.preferred_time_slot,
                treatmentName: lead.treatment_name,
                status: lead.status,
                createdAt: lead.created_at,
              }
            : null,
        },
      });
    } catch (error: any) {
      console.error('[ChatbotMockController] Error retrieving session:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal error processing message',
      });
    }
  }

  /**
   * POST /api/chatbot/mock/reset
   */
  public static async resetSession(req: Request, res: Response) {
    if (!ChatbotMockController.isSimulatorAllowed()) {
      return res.status(403).json({
        success: false,
        message: 'Mock simulator endpoint is disabled in production',
      });
    }

    try {
      const { senderId, channel = 'mock' } = req.body;

      if (!senderId) {
        return res.status(400).json({
          success: false,
          message: 'senderId is required to reset session',
        });
      }

      const session = await ChatbotEngine.resetSession(channel, senderId);

      return res.json({
        success: true,
        message: 'Chatbot session reset successfully',
        data: {
          channel: session.channel,
          senderId: session.sender_id,
          currentStep: session.current_step,
          isHumanHandoff: session.is_human_handoff,
        },
      });
    } catch (error: any) {
      console.error('[ChatbotMockController] Error resetting session:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal error processing message',
      });
    }
  }
}
