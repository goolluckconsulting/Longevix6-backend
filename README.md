# Longevix6 — Backend API Engine

Node.js, Express, TypeScript, PostgreSQL, and Razorpay backend for Longevix6 Clinical Nutraceuticals platform.

---

## 🛠️ Tech Stack
- **Runtime**: Node.js (TypeScript)
- **Framework**: Express.js
- **Database**: PostgreSQL (`pg` connection pool)
- **Payments**: Razorpay Node SDK
- **Validation**: Zod
- **Security**: Helmet, CORS

---

## 📁 Directory Structure
```
Longevix6-backend/
├── src/
│   ├── config/
│   │   ├── db.ts           # PostgreSQL connection pool
│   │   └── razorpay.ts     # Razorpay SDK initialization
│   ├── controllers/
│   │   ├── orderController.ts    # Order creation + Price validation
│   │   └── paymentController.ts  # HMAC-SHA256 Payment verification
│   ├── db/
│   │   ├── schema.sql      # PostgreSQL tables (orders, items, payments)
│   │   └── initDb.ts       # Database migration runner
│   ├── routes/
│   │   ├── healthRoutes.ts # /api/health
│   │   ├── orderRoutes.ts  # /api/orders
│   │   └── paymentRoutes.ts# /api/payments
│   └── server.ts           # Main Express application
├── .env.example            # Environment template
├── package.json
└── tsconfig.json
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file from the template:
```bash
cp .env.example .env
```
Update your PostgreSQL credentials and Razorpay test keys in `.env`.

### 3. Initialize PostgreSQL Database
```bash
npm run db:init
```

### 4. Start Development Server
```bash
npm run dev
```
Server will start on `http://localhost:5000`.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check & DB connection status |
| `POST` | `/api/orders/create` | Calculate server-side total & create Razorpay order |
| `GET` | `/api/orders/:id` | Fetch order details by ID |
| `GET` | `/api/payments/key` | Fetch Razorpay Public Key for checkout |
| `POST` | `/api/payments/verify` | Verify Razorpay payment signature & save payment |

---

## 🔒 Security Best Practices
- **Never expose Razorpay Key Secret** to frontend.
- **Server-Side Pricing**: Prices are verified against backend catalogue to prevent client-side price tampering.
- **HMAC-SHA256**: All incoming Razorpay payments are cryptographically verified before marking orders as paid.
