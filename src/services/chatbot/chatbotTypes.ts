export type ChatbotChannel = 'mock' | 'web' | 'whatsapp' | 'instagram';

export type ChatbotStep =
  | 'start'
  | 'brand_select'
  | 'longevix_services'
  | 'weight_management_plans'
  | 'iv_drips_menu'
  | 'sculpting_category'
  | 'sculpting_face_area'
  | 'sculpting_body_area'
  | 'intimate_wellness'
  | 'ask_name'
  | 'ask_phone'
  | 'ask_slot'
  | 'completed';

export interface ChatbotButton {
  id: string;
  title: string;
}

export interface ChatbotReply {
  text: string;
  uiType: 'buttons' | 'text';
  buttons?: ChatbotButton[];
  currentStep: ChatbotStep;
  isHumanHandoff: boolean;
  justCompleted?: boolean;
  session?: DbChatbotSession;
  sessionData?: {
    brand?: string | null;
    service?: string | null;
    subService?: string | null;
    patientName?: string | null;
    patientPhone?: string | null;
    preferredTimeSlot?: string | null;
  };
}

export interface LeadCreationResult {
  created: boolean;
  bookingReference: string;
  leadId: string;
  patientName: string;
  phone: string;
  treatmentName: string;
  preferredTimeSlot: string;
  status: string;
}

export interface IncomingMessagePayload {
  channel: ChatbotChannel;
  senderId: string;
  text?: string;
  buttonPayload?: string;
}

export interface DbChatbotSession {
  id: string;
  channel: ChatbotChannel;
  sender_id: string;
  current_step: ChatbotStep;
  selected_brand: string | null;
  selected_service: string | null;
  selected_sub_service: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  preferred_time_slot: string | null;
  is_human_handoff: boolean;
  handoff_at: Date | null;
  last_interaction_at: Date;
  created_at: Date;
  updated_at: Date;
}
