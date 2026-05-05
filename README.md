# 🌾 KrushiMitra Backend

> **Empowering Farmers, Enabling Transparent Trade, and Revolutionizing the Agricultural Ecosystem.**

KrushiMitra is a production-ready, feature-rich backend system designed to bridge the gap between farmers and buyers. It facilitates transparent crop trading, secure escrow payments, AI-powered price intelligence, and seamless logistics integration.

---

## 🌟 Vision & Mission
Our mission is to eliminate middlemen and empower Indian farmers with direct market access, real-time data insights, and financial security through technology.

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Core** | Node.js (v18+) | Runtime environment |
| **Framework** | Express.js | Web application framework |
| **Database** | MongoDB + Mongoose | NoSQL database for flexible data modeling |
| **Caching/Queue** | Redis + BullMQ | Background jobs, rate limiting, and real-time state |
| **Real-time** | Socket.io | Bi-directional communication for Chat & Notifications |
| **AI/ML** | Google Gemini (GenAI) | Price recommendations & Quality analysis |
| **Payments** | Stripe & Razorpay | Secure Escrow and Payout systems |
| **Logistics** | Porter & Blackbuck | Delivery tracking and logistics integration |
| **Auth** | JWT + Google OAuth | Secure multi-role authentication |
| **Communications** | Twilio (OTP) & Firebase (FCM) | Notifications and identity verification |
| **Storage** | Cloudinary | Cloud-based image and document storage |

---

## 📂 Project Architecture

The backend follows a modular, service-oriented architecture designed for scalability and maintainability.

```text
backend/
├── src/
│   ├── config/          # Centralized configuration (DB, Cloudinary, Firebase, etc.)
│   ├── controllers/     # Orchestrates business logic and handles HTTP requests
│   ├── models/          # Mongoose schemas for data persistence
│   ├── routes/          # Express route definitions (API v1)
│   ├── middlewares/     # Auth, Role-based access, Rate limiting, Error handling
│   ├── services/        # Third-party integrations (Weather, AI, Mandi, Payments)
│   ├── sockets/         # Socket.io event handlers for real-time features
│   ├── workers/         # Background job processors (BullMQ)
│   ├── utils/           # Shared helpers (Logger, Response helpers, JWT)
│   ├── validators/      # Joi/Express-validator schemas
│   └── tests/           # Unit and Integration tests (Jest)
├── app.js               # Express application configuration
└── server.js            # Entry point: HTTP & Socket.io server initialization
```

---

## ✨ Key Features

### 🔐 1. Identity & Access Management
- **Multi-Role Support**: Tailored experiences for Farmers, Buyers, and Admins.
- **Secure Onboarding**: OTP-based phone verification via Twilio and Google Social Login.
- **KYC Verification**: Managed administrative flow for verifying farmer/buyer identities.

### 🚜 2. Farmer Marketplace
- **Crop Listings**: Rich crop listings with quality grading and high-res image support.
- **AI Price Engine**: Intelligent price recommendations based on real-time Mandi (Agmarknet) trends and seasonality.
- **Quality Detection**: AI-assisted crop quality assessment from uploaded images.

### 💰 3. Secure Financial Ecosystem
- **Escrow Payments**: Funds are held securely in escrow (Stripe/Razorpay) until delivery is confirmed.
- **Payout Management**: Automated and manual payout systems for sellers.
- **Dispute Resolution**: Integrated system for handling trade disputes via Admin intervention.

### 🚚 4. Logistics & Supply Chain
- **Delivery Integration**: Integrated with Porter and Blackbuck for seamless transport booking.
- **Real-time Tracking**: Live GPS tracking of crop shipments via ULIP and Porter APIs.
- **Automated Workflows**: Background workers handle delivery state transitions and status sync.

### 💬 5. Real-time Communication
- **Bilingual Chat**: Real-time chat between farmers and buyers with typing indicators.
- **Instant Notifications**: Push notifications (FCM) and SMS/WhatsApp alerts (Twilio).
- **Presence Tracking**: Online/Offline status indicators for better engagement.

### 📊 6. Administrative Dashboard
- **Analytics Hub**: Real-time stats on trade volume, user growth, and revenue.
- **Broadcast System**: Send system-wide announcements to all users.
- **Maintenance Mode**: Toggle platform accessibility for maintenance.

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js (v18.x or higher)
- MongoDB (Local or Atlas)
- Redis Server (Local or Cloud)

### Step-by-Step Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Avira-Tech/KrushiMitra.git
   cd backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Configuration**:
   Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   *Fill in your API keys for Cloudinary, Stripe, Razorpay, Twilio, etc.*

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. **Run tests**:
   ```bash
   npm test
   ```

---

## 🛡️ Security & Performance

- **Rate Limiting**: Protection against Brute-force and DDoS via Redis-backed rate limiters.
- **Data Sanitization**: Prevents NoSQL injection (mongo-sanitize) and XSS attacks (xss-clean).
- **Secure Headers**: Implements `helmet` for production-grade HTTP security headers.
- **Logging**: Production-grade logging with `Winston`, including correlation IDs for request tracking.
- **Compression**: Gzip compression enabled for faster payload delivery.

---

## 🔗 API Documentation Summary

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/auth` | `POST` | User registration, login, and OTP verification |
| `/api/v1/crops` | `GET/POST` | Marketplace management and AI price insights |
| `/api/v1/offers` | `POST/PATCH`| Negotiating and accepting trade offers |
| `/api/v1/payments`| `POST` | Payment initiation and Webhook processing |
| `/api/v1/mandi` | `GET` | Real-time commodity prices across India |
| `/api/v1/weather` | `GET` | Location-based weather alerts for farmers |

---

## 📈 Monitoring & Maintenance

- **Health Checks**: Access `/health` for real-time status of DB, Redis, and external services.
- **Logs**: Located in the `/logs` directory (rotating logs).
- **Admin**: Comprehensive admin controllers for user and trade management.

---

*🌾 KrushiMitra - Bridging the distance from Farm to Fork.*
