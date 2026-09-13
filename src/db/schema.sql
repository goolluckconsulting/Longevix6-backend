-- Longevix6 PostgreSQL Schema Definition

-- Enable UUID extension if supported
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  razorpay_order_id VARCHAR(100) UNIQUE,

  -- Idempotency key: SHA-256 of (email + sorted cart items + totalAmount).
  -- Ensures the same logical checkout never creates more than one pending Razorpay order.
  idempotency_key VARCHAR(64) UNIQUE,

  -- Customer Information
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  
  -- Shipping Address
  shipping_address_line1 TEXT NOT NULL,
  shipping_address_line2 TEXT,
  shipping_landmark VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  
  -- Financial Breakdown (in INR)
  subtotal NUMERIC(10, 2) NOT NULL,
  gst NUMERIC(10, 2) NOT NULL,
  shipping_charge NUMERIC(10, 2) DEFAULT 0.00,
  total_amount NUMERIC(10, 2) NOT NULL,
  
  -- Order Status: 'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'failed'
  status VARCHAR(50) DEFAULT 'pending',
  payment_status VARCHAR(50) DEFAULT 'unpaid',
  
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id VARCHAR(100) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Payments Table (Razorpay Records)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  razorpay_order_id VARCHAR(100) NOT NULL,
  razorpay_payment_id VARCHAR(100) UNIQUE NOT NULL,
  razorpay_signature VARCHAR(255),
  payment_method VARCHAR(50),
  amount NUMERIC(10, 2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  status VARCHAR(50) NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Consultation Bookings Table
CREATE TABLE IF NOT EXISTS consultation_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_reference VARCHAR(50) UNIQUE NOT NULL,
  patient_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  preferred_date DATE NOT NULL,
  preferred_time_slot VARCHAR(50) NOT NULL,
  primary_concern TEXT,
  treatment_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'confirmed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for high performance query lookups
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment_id ON payments(razorpay_payment_id);

-- 5. Blogs Table
CREATE TABLE IF NOT EXISTS blogs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  excerpt TEXT NOT NULL,
  content TEXT NOT NULL,
  featured_image TEXT,
  author_name VARCHAR(100) NOT NULL DEFAULT 'Dr. Ankita Gupta',
  author_role VARCHAR(100) DEFAULT 'Founder & Medical Director',
  author_avatar TEXT DEFAULT '/20260728054212879/1U8A1938.webp',
  category VARCHAR(100) NOT NULL DEFAULT 'Longevity',
  read_time_minutes INTEGER NOT NULL DEFAULT 5 CHECK (read_time_minutes > 0 AND read_time_minutes <= 120),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMP WITH TIME ZONE,
  meta_title VARCHAR(255),
  meta_description VARCHAR(500),
  canonical_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL DEFAULT 'Admin',
  role VARCHAR(50) NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Blog and Admin Indexes
CREATE INDEX IF NOT EXISTS idx_blogs_slug ON blogs(slug);
CREATE INDEX IF NOT EXISTS idx_blogs_status_published ON blogs(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blogs_category ON blogs(category);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- 7. Chatbot Sessions Table
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('mock', 'web', 'whatsapp', 'instagram')),
  sender_id VARCHAR(100) NOT NULL,
  current_step VARCHAR(50) NOT NULL DEFAULT 'start',
  selected_brand VARCHAR(50),
  selected_service VARCHAR(100),
  selected_sub_service VARCHAR(100),
  patient_name VARCHAR(255),
  patient_phone VARCHAR(20),
  preferred_time_slot VARCHAR(50),
  is_human_handoff BOOLEAN NOT NULL DEFAULT FALSE,
  handoff_at TIMESTAMP WITH TIME ZONE,
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_chatbot_sessions_channel_sender UNIQUE (channel, sender_id)
);

-- Chatbot Sessions Indexes
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_sender_id ON chatbot_sessions(sender_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_last_interaction ON chatbot_sessions(last_interaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_handoff ON chatbot_sessions(is_human_handoff, handoff_at DESC);

-- 8. Chatbot Processed Messages Table (Meta Inbound Deduplication)
CREATE TABLE IF NOT EXISTS chatbot_processed_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('whatsapp', 'instagram')),
  message_id VARCHAR(128) NOT NULL,
  sender_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_chatbot_processed_messages_channel_msg UNIQUE (channel, message_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_processed_messages_created ON chatbot_processed_messages(created_at DESC);

