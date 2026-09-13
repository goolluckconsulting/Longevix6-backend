import { ChatbotButton } from './chatbotTypes';

export const TRIGGER_WORDS = [
  'hi',
  'hello',
  'hey',
  'menu',
  'start',
  'restart',
  'namaste',
  'help',
];

export const FLOW_MESSAGES = {
  GREETING: 'Welcome to GLEC / Longevix6 AI Assistant.\nHow can I help you today?',
  GLEC_NOTICE:
    'You have selected GLEC Services.\n\nFor GLEC gastroenterology consultations & diagnostic procedures, please visit https://glec.in or contact the GLEC desk at +91 98111 23456.\n\nTo explore Longevix6 Longevity & Wellness services, choose below or type "Menu".',
  LONGEVIX_MAIN_MENU:
    "Welcome to India's No. 1 Wellness & Longevity Clinic.\nPlease choose:",
  WEIGHT_MENU: 'Please select your preferred Weight Management plan:',
  IV_DRIPS_MENU: 'Please choose your IV Drip therapy:',
  SCULPTING_MAIN_MENU: 'Please select a sculpting category:',
  SCULPTING_FACE_MENU: 'Please select the facial treatment area:',
  SCULPTING_BODY_MENU: 'Please select the body treatment area:',
  INTIMATE_WELLNESS_MENU: 'Please select your Intimate Wellness treatment:',
  ASK_NAME: '1. May I have your full name?',
  ASK_PHONE: "2. What's the best number to reach you? (Optional confirmation)",
  ASK_SLOT: '3. When would you prefer a callback?',
  CLOSING_MESSAGE: 'Thank you! Our team will call you shortly.',
  HUMAN_HANDOFF_ACTIVE:
    'You are currently connected with our patient care team. A representative will attend to you shortly.\n\n(Type "Menu" or "Restart" at any time to begin a new inquiry)',
  INVALID_NAME: 'Please provide a valid full name (at least 2 characters).',
  INVALID_PHONE:
    'Please provide a valid 10-digit mobile number (e.g., 9876543210).',
  INVALID_SELECTION:
    'Sorry, I didn\'t understand that choice. Please tap one of the options below or type "Menu" to start over.',
};

export const BUTTON_SETS: Record<string, ChatbotButton[]> = {
  BRAND_SELECT: [
    { id: 'btn_glec', title: 'GLEC Services' },
    { id: 'btn_longevix', title: 'Longevix6 Services' },
  ],
  GLEC_REDIRECT: [
    { id: 'btn_longevix', title: 'Longevix6 Services' },
    { id: 'btn_restart', title: 'Main Menu' },
  ],
  LONGEVIX_SERVICES: [
    { id: 'btn_weight', title: 'Weight Management' },
    { id: 'btn_iv_drips', title: 'IV Drips' },
    { id: 'btn_sculpting', title: 'Body & Face Sculpting' },
    { id: 'btn_intimate', title: 'Intimate Wellness' },
  ],
  WEIGHT_PLANS: [
    { id: 'btn_plan_1m', title: '1 Month Plan' },
    { id: 'btn_plan_2m', title: '2 Month Plan' },
    { id: 'btn_plan_3m', title: '3 Month Plan' },
  ],
  IV_DRIPS: [
    { id: 'btn_drip_myers', title: "Myers' Cocktail" },
    { id: 'btn_drip_gut_liver', title: 'Gut & Liver Detox' },
  ],
  SCULPTING_CATEGORIES: [
    { id: 'btn_sculpt_face', title: 'Face' },
    { id: 'btn_sculpt_body', title: 'Body' },
  ],
  SCULPTING_FACE_AREAS: [
    { id: 'btn_face_upper', title: 'Upper Face' },
    { id: 'btn_face_lower', title: 'Lower Face' },
    { id: 'btn_face_full', title: 'Full Face' },
  ],
  SCULPTING_BODY_AREAS: [
    { id: 'btn_body_abdomen', title: 'Whole Abdomen' },
    { id: 'btn_body_thighs', title: 'Thighs' },
    { id: 'btn_body_arms', title: 'Arms' },
  ],
  INTIMATE_WELLNESS: [
    { id: 'btn_intimate_pelvic_ems', title: 'Pelvic EMS' },
  ],
  CALLBACK_SLOTS: [
    { id: 'btn_slot_morning', title: 'Morning' },
    { id: 'btn_slot_afternoon', title: 'Afternoon' },
    { id: 'btn_slot_evening', title: 'Evening' },
  ],
};

export const TIME_SLOT_LABEL_MAP: Record<string, string> = {
  Morning: 'Morning (10:00 AM - 01:00 PM)',
  Afternoon: 'Afternoon (02:00 PM - 05:00 PM)',
  Evening: 'Evening (05:00 PM - 08:00 PM)',
};
