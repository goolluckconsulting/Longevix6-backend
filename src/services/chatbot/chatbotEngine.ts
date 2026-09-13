import pool from '../../config/db';
import {
  ChatbotChannel,
  ChatbotStep,
  ChatbotReply,
  ChatbotButton,
  DbChatbotSession,
  IncomingMessagePayload,
} from './chatbotTypes';
import {
  TRIGGER_WORDS,
  FLOW_MESSAGES,
  BUTTON_SETS,
} from './longevixFlowConfig';

export class ChatbotEngine {
  /**
   * Helper to format standardized ChatbotReply objects
   */
  private static formatReply(
    text: string,
    currentStep: ChatbotStep,
    session: DbChatbotSession,
    buttons?: ChatbotButton[],
    isHumanHandoff: boolean = false,
    justCompleted: boolean = false
  ): ChatbotReply {
    return {
      text,
      uiType: buttons && buttons.length > 0 ? 'buttons' : 'text',
      buttons,
      currentStep,
      isHumanHandoff,
      justCompleted,
      session,
      sessionData: this.extractSessionData(session),
    };
  }

  /**
   * Get existing session or create a new initial session in PostgreSQL (concurrency-safe)
   */
  public static async getOrCreateSession(
    channel: ChatbotChannel,
    senderId: string
  ): Promise<DbChatbotSession> {
    const upsertSql = `
      INSERT INTO chatbot_sessions (
        channel,
        sender_id,
        current_step,
        is_human_handoff,
        last_interaction_at
      )
      VALUES ($1, $2, 'start', FALSE, NOW())
      ON CONFLICT (channel, sender_id)
      DO UPDATE SET
        last_interaction_at = CASE
          WHEN chatbot_sessions.last_interaction_at < NOW() - INTERVAL '24 hours'
            THEN chatbot_sessions.last_interaction_at
          ELSE NOW()
        END
      RETURNING *;
    `;
    const res = await pool.query(upsertSql, [channel, senderId]);
    return res.rows[0] as DbChatbotSession;
  }

  /**
   * Reset session back to brand_select / start
   */
  public static async resetSession(
    channel: ChatbotChannel,
    senderId: string
  ): Promise<DbChatbotSession> {
    const updateSql = `
      UPDATE chatbot_sessions
      SET
        current_step = 'brand_select',
        selected_brand = NULL,
        selected_service = NULL,
        selected_sub_service = NULL,
        patient_name = NULL,
        patient_phone = NULL,
        preferred_time_slot = NULL,
        is_human_handoff = FALSE,
        handoff_at = NULL,
        last_interaction_at = NOW(),
        updated_at = NOW()
      WHERE channel = $1 AND sender_id = $2
      RETURNING *;
    `;
    const res = await pool.query(updateSql, [channel, senderId]);
    if (res.rows.length === 0) {
      return this.getOrCreateSession(channel, senderId);
    }
    return res.rows[0] as DbChatbotSession;
  }

  /**
   * Update session state and fields in PostgreSQL
   */
  public static async updateSession(
    id: string,
    updates: Partial<DbChatbotSession>
  ): Promise<DbChatbotSession> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }

    fields.push(`last_interaction_at = NOW()`);
    fields.push(`updated_at = NOW()`);

    values.push(id);
    const sql = `
      UPDATE chatbot_sessions
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *;
    `;

    const res = await pool.query(sql, values);
    return res.rows[0] as DbChatbotSession;
  }

  /**
   * Process an incoming message and return normalized bot reply
   */
  public static async processMessage(
    payload: IncomingMessagePayload
  ): Promise<ChatbotReply> {
    const { channel, senderId, text = '', buttonPayload = '' } = payload;
    const cleanText = text.trim();
    const lowerText = cleanText.toLowerCase();
    const cleanPayload = buttonPayload.trim().toLowerCase();

    // 1. Fetch or initialize session
    let session = await this.getOrCreateSession(channel, senderId);

    // 2. Check 24-hour session timeout (window expired)
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const sessionAge = Date.now() - new Date(session.last_interaction_at).getTime();
    if (session.current_step !== 'start' && sessionAge > TWENTY_FOUR_HOURS_MS) {
      console.log(`[ChatbotEngine] Session timed out (>24h) for ${channel}/${senderId}. Resetting.`);
      session = await this.resetSession(channel, senderId);
      return this.formatReply(
        FLOW_MESSAGES.GREETING,
        'brand_select',
        session,
        BUTTON_SETS.BRAND_SELECT
      );
    }

    // 3. Check for global trigger / reset words
    const isTrigger =
      cleanPayload === 'btn_restart' ||
      cleanPayload === 'restart' ||
      TRIGGER_WORDS.some(
        (word) => lowerText === word || lowerText.startsWith(word + ' ')
      );

    if (isTrigger) {
      session = await this.resetSession(channel, senderId);
      return this.formatReply(
        FLOW_MESSAGES.GREETING,
        'brand_select',
        session,
        BUTTON_SETS.BRAND_SELECT
      );
    }

    // 4. If currently in human handoff and not restarting, mute bot auto-replies
    if (session.is_human_handoff) {
      const updated = await this.updateSession(session.id, {});
      return this.formatReply(
        FLOW_MESSAGES.HUMAN_HANDOFF_ACTIVE,
        session.current_step,
        updated,
        undefined,
        true
      );
    }

    // 5. State Machine routing based on current_step
    switch (session.current_step) {
      case 'start':
      case 'brand_select':
        return this.handleBrandSelect(session, cleanPayload, lowerText);

      case 'longevix_services':
        return this.handleLongevixServices(session, cleanPayload, lowerText);

      case 'weight_management_plans':
        return this.handleWeightPlans(session, cleanPayload, lowerText);

      case 'iv_drips_menu':
        return this.handleIvDrips(session, cleanPayload, lowerText);

      case 'sculpting_category':
        return this.handleSculptingCategory(session, cleanPayload, lowerText);

      case 'sculpting_face_area':
        return this.handleSculptingFaceArea(session, cleanPayload, lowerText);

      case 'sculpting_body_area':
        return this.handleSculptingBodyArea(session, cleanPayload, lowerText);

      case 'intimate_wellness':
        return this.handleIntimateWellness(session, cleanPayload, lowerText);

      case 'ask_name':
        return this.handleAskName(session, cleanText);

      case 'ask_phone':
        return this.handleAskPhone(session, cleanText, cleanPayload);

      case 'ask_slot':
        return this.handleAskSlot(session, cleanPayload, lowerText);

      case 'completed':
        return this.formatReply(
          FLOW_MESSAGES.HUMAN_HANDOFF_ACTIVE,
          'completed',
          session,
          undefined,
          true
        );

      default:
        session = await this.resetSession(channel, senderId);
        return this.formatReply(
          FLOW_MESSAGES.GREETING,
          'brand_select',
          session,
          BUTTON_SETS.BRAND_SELECT
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Step Handlers
  // ---------------------------------------------------------------------------

  private static async handleBrandSelect(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    if (payload === 'btn_glec' || text.includes('glec') || text === '1') {
      const updated = await this.updateSession(session.id, {
        selected_brand: 'glec',
        current_step: 'brand_select',
      });
      return this.formatReply(
        FLOW_MESSAGES.GLEC_NOTICE,
        'brand_select',
        updated,
        BUTTON_SETS.GLEC_REDIRECT
      );
    }

    if (
      payload === 'btn_longevix' ||
      text.includes('longevix') ||
      text === '2'
    ) {
      const updated = await this.updateSession(session.id, {
        selected_brand: 'longevix6',
        current_step: 'longevix_services',
      });
      return this.formatReply(
        FLOW_MESSAGES.LONGEVIX_MAIN_MENU,
        'longevix_services',
        updated,
        BUTTON_SETS.LONGEVIX_SERVICES
      );
    }

    return this.formatReply(
      FLOW_MESSAGES.GREETING,
      'brand_select',
      session,
      BUTTON_SETS.BRAND_SELECT
    );
  }

  private static async handleLongevixServices(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    // 1. Weight Management
    if (
      payload === 'btn_weight' ||
      text.includes('weight') ||
      text === '1'
    ) {
      const updated = await this.updateSession(session.id, {
        selected_service: 'Weight Management',
        current_step: 'weight_management_plans',
      });
      return this.formatReply(
        FLOW_MESSAGES.WEIGHT_MENU,
        'weight_management_plans',
        updated,
        BUTTON_SETS.WEIGHT_PLANS
      );
    }

    // 2. IV Drips
    if (
      payload === 'btn_iv_drips' ||
      text.includes('iv') ||
      text.includes('drip') ||
      text === '2'
    ) {
      const updated = await this.updateSession(session.id, {
        selected_service: 'IV Drips',
        current_step: 'iv_drips_menu',
      });
      return this.formatReply(
        FLOW_MESSAGES.IV_DRIPS_MENU,
        'iv_drips_menu',
        updated,
        BUTTON_SETS.IV_DRIPS
      );
    }

    // 3. Body & Face Sculpting
    if (
      payload === 'btn_sculpting' ||
      text.includes('sculpt') ||
      text.includes('face') ||
      text.includes('body') ||
      text === '3'
    ) {
      const updated = await this.updateSession(session.id, {
        selected_service: 'Body & Face Sculpting',
        current_step: 'sculpting_category',
      });
      return this.formatReply(
        FLOW_MESSAGES.SCULPTING_MAIN_MENU,
        'sculpting_category',
        updated,
        BUTTON_SETS.SCULPTING_CATEGORIES
      );
    }

    // 4. Intimate Wellness
    if (
      payload === 'btn_intimate' ||
      text.includes('intimate') ||
      text.includes('pelvic') ||
      text === '4'
    ) {
      const updated = await this.updateSession(session.id, {
        selected_service: 'Intimate Wellness',
        current_step: 'intimate_wellness',
      });
      return this.formatReply(
        FLOW_MESSAGES.INTIMATE_WELLNESS_MENU,
        'intimate_wellness',
        updated,
        BUTTON_SETS.INTIMATE_WELLNESS
      );
    }

    return this.formatReply(
      FLOW_MESSAGES.INVALID_SELECTION,
      'longevix_services',
      session,
      BUTTON_SETS.LONGEVIX_SERVICES
    );
  }

  private static async handleWeightPlans(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    let chosenPlan: string | null = null;
    if (payload === 'btn_plan_1m' || text.includes('1 month') || text === '1') {
      chosenPlan = '1 Month Plan';
    } else if (payload === 'btn_plan_2m' || text.includes('2 month') || text === '2') {
      chosenPlan = '2 Month Plan';
    } else if (payload === 'btn_plan_3m' || text.includes('3 month') || text === '3') {
      chosenPlan = '3 Month Plan';
    }

    if (!chosenPlan) {
      return this.formatReply(
        FLOW_MESSAGES.INVALID_SELECTION,
        'weight_management_plans',
        session,
        BUTTON_SETS.WEIGHT_PLANS
      );
    }

    const updated = await this.updateSession(session.id, {
      selected_sub_service: chosenPlan,
      current_step: 'ask_name',
    });

    return this.formatReply(FLOW_MESSAGES.ASK_NAME, 'ask_name', updated);
  }

  private static async handleIvDrips(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    let chosenDrip: string | null = null;
    if (payload === 'btn_drip_myers' || text.includes('myers') || text === '1') {
      chosenDrip = "Myers' Cocktail";
    } else if (
      payload === 'btn_drip_gut_liver' ||
      text.includes('gut') ||
      text.includes('liver') ||
      text.includes('detox') ||
      text === '2'
    ) {
      chosenDrip = 'Gut & Liver Detox';
    }

    if (!chosenDrip) {
      return this.formatReply(
        FLOW_MESSAGES.INVALID_SELECTION,
        'iv_drips_menu',
        session,
        BUTTON_SETS.IV_DRIPS
      );
    }

    const updated = await this.updateSession(session.id, {
      selected_sub_service: chosenDrip,
      current_step: 'ask_name',
    });

    return this.formatReply(FLOW_MESSAGES.ASK_NAME, 'ask_name', updated);
  }

  private static async handleSculptingCategory(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    if (payload === 'btn_sculpt_face' || text.includes('face') || text === '1') {
      const updated = await this.updateSession(session.id, {
        current_step: 'sculpting_face_area',
      });
      return this.formatReply(
        FLOW_MESSAGES.SCULPTING_FACE_MENU,
        'sculpting_face_area',
        updated,
        BUTTON_SETS.SCULPTING_FACE_AREAS
      );
    }

    if (payload === 'btn_sculpt_body' || text.includes('body') || text === '2') {
      const updated = await this.updateSession(session.id, {
        current_step: 'sculpting_body_area',
      });
      return this.formatReply(
        FLOW_MESSAGES.SCULPTING_BODY_MENU,
        'sculpting_body_area',
        updated,
        BUTTON_SETS.SCULPTING_BODY_AREAS
      );
    }

    return this.formatReply(
      FLOW_MESSAGES.INVALID_SELECTION,
      'sculpting_category',
      session,
      BUTTON_SETS.SCULPTING_CATEGORIES
    );
  }

  private static async handleSculptingFaceArea(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    let chosenArea: string | null = null;
    if (payload === 'btn_face_upper' || text.includes('upper') || text === '1') {
      chosenArea = 'Upper Face';
    } else if (payload === 'btn_face_lower' || text.includes('lower') || text === '2') {
      chosenArea = 'Lower Face';
    } else if (payload === 'btn_face_full' || text.includes('full') || text === '3') {
      chosenArea = 'Full Face';
    }

    if (!chosenArea) {
      return this.formatReply(
        FLOW_MESSAGES.INVALID_SELECTION,
        'sculpting_face_area',
        session,
        BUTTON_SETS.SCULPTING_FACE_AREAS
      );
    }

    const updated = await this.updateSession(session.id, {
      selected_sub_service: `Face (${chosenArea})`,
      current_step: 'ask_name',
    });

    return this.formatReply(FLOW_MESSAGES.ASK_NAME, 'ask_name', updated);
  }

  private static async handleSculptingBodyArea(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    let chosenArea: string | null = null;
    if (
      payload === 'btn_body_abdomen' ||
      text.includes('abdomen') ||
      text.includes('belly') ||
      text === '1'
    ) {
      chosenArea = 'Whole Abdomen';
    } else if (payload === 'btn_body_thighs' || text.includes('thigh') || text === '2') {
      chosenArea = 'Thighs';
    } else if (payload === 'btn_body_arms' || text.includes('arm') || text === '3') {
      chosenArea = 'Arms';
    }

    if (!chosenArea) {
      return this.formatReply(
        FLOW_MESSAGES.INVALID_SELECTION,
        'sculpting_body_area',
        session,
        BUTTON_SETS.SCULPTING_BODY_AREAS
      );
    }

    const updated = await this.updateSession(session.id, {
      selected_sub_service: `Body (${chosenArea})`,
      current_step: 'ask_name',
    });

    return this.formatReply(FLOW_MESSAGES.ASK_NAME, 'ask_name', updated);
  }

  private static async handleIntimateWellness(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    if (
      payload === 'btn_intimate_pelvic_ems' ||
      text.includes('pelvic') ||
      text.includes('ems') ||
      text === '1'
    ) {
      const updated = await this.updateSession(session.id, {
        selected_sub_service: 'Pelvic EMS',
        current_step: 'ask_name',
      });
      return this.formatReply(FLOW_MESSAGES.ASK_NAME, 'ask_name', updated);
    }

    return this.formatReply(
      FLOW_MESSAGES.INVALID_SELECTION,
      'intimate_wellness',
      session,
      BUTTON_SETS.INTIMATE_WELLNESS
    );
  }

  private static async handleAskName(
    session: DbChatbotSession,
    rawName: string
  ): Promise<ChatbotReply> {
    const trimmed = rawName.trim();
    if (!trimmed || trimmed.length < 2 || !/[a-zA-Z]/.test(trimmed)) {
      return this.formatReply(FLOW_MESSAGES.INVALID_NAME, 'ask_name', session);
    }

    const updated = await this.updateSession(session.id, {
      patient_name: trimmed,
      current_step: 'ask_phone',
    });

    const cleanSenderDigits = session.sender_id.replace(/\D/g, '');
    const isSenderPhone = cleanSenderDigits.length >= 10;
    const buttons = isSenderPhone
      ? [
          {
            id: `btn_phone_${cleanSenderDigits.slice(-10)}`,
            title: `Use ${cleanSenderDigits.slice(-10)}`,
          },
        ]
      : undefined;

    return this.formatReply(FLOW_MESSAGES.ASK_PHONE, 'ask_phone', updated, buttons);
  }

  private static async handleAskPhone(
    session: DbChatbotSession,
    rawText: string,
    payload: string
  ): Promise<ChatbotReply> {
    let candidatePhone = '';

    if (payload.startsWith('btn_phone_')) {
      candidatePhone = payload.replace('btn_phone_', '');
    } else {
      candidatePhone = rawText.replace(/\D/g, '');
    }

    if (candidatePhone.length >= 10) {
      candidatePhone = candidatePhone.slice(-10);
    }

    if (candidatePhone.length !== 10 || !/^[6-9]\d{9}$/.test(candidatePhone)) {
      return this.formatReply(FLOW_MESSAGES.INVALID_PHONE, 'ask_phone', session);
    }

    const updated = await this.updateSession(session.id, {
      patient_phone: candidatePhone,
      current_step: 'ask_slot',
    });

    return this.formatReply(
      FLOW_MESSAGES.ASK_SLOT,
      'ask_slot',
      updated,
      BUTTON_SETS.CALLBACK_SLOTS
    );
  }

  private static async handleAskSlot(
    session: DbChatbotSession,
    payload: string,
    text: string
  ): Promise<ChatbotReply> {
    let chosenSlot: string | null = null;

    if (payload === 'btn_slot_morning' || text.includes('morning') || text === '1') {
      chosenSlot = 'Morning';
    } else if (
      payload === 'btn_slot_afternoon' ||
      text.includes('afternoon') ||
      text === '2'
    ) {
      chosenSlot = 'Afternoon';
    } else if (
      payload === 'btn_slot_evening' ||
      text.includes('evening') ||
      text === '3'
    ) {
      chosenSlot = 'Evening';
    }

    if (!chosenSlot) {
      return this.formatReply(
        FLOW_MESSAGES.INVALID_SELECTION,
        'ask_slot',
        session,
        BUTTON_SETS.CALLBACK_SLOTS
      );
    }

    // Update session to completed & assign to human handoff
    const updated = await this.updateSession(session.id, {
      preferred_time_slot: chosenSlot,
      current_step: 'completed',
      is_human_handoff: true,
      handoff_at: new Date(),
    });

    return this.formatReply(
      FLOW_MESSAGES.CLOSING_MESSAGE,
      'completed',
      updated,
      undefined,
      true,
      true // justCompleted = true
    );
  }

  private static extractSessionData(session: DbChatbotSession) {
    return {
      brand: session.selected_brand,
      service: session.selected_service,
      subService: session.selected_sub_service,
      patientName: session.patient_name,
      patientPhone: session.patient_phone,
      preferredTimeSlot: session.preferred_time_slot,
    };
  }
}
