# 🌾 KrushiMitra Backend API

> **From Farm to Market, A Trustworthy Bridge**

Production-ready Node.js + Express + MongoDB backend for the KrushiMitra farmer-buyer marketplace.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 3. Start development server
npm run dev

# 4. Run tests
npm test
```

---

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/          # DB, Cloudinary, Stripe, Twilio, Firebase
│   ├── models/          # Mongoose schemas
│   ├── controllers/     # Business logic
│   ├── routes/          # Express routers
│   ├── middlewares/     # Auth, validation, error handling
│   ├── services/        # External APIs (Weather, Mandi, AI, Porter)
│   ├── sockets/         # Socket.io handlers
│   ├── validators/      # Joi schemas
│   ├── utils/           # JWT, helpers, logger, apiResponse
│   └── tests/           # Jest + Supertest
├── app.js             # Express app
└── server.js          # HTTP + Socket.io server
```

---

## 🔗 API Endpoints

### Base URL: `http://localhost:5000/api/v1`

| Module | Endpoints |
|--------|----------|
| **Auth** | `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/register`, `POST /auth/google`, `POST /auth/refresh-token`, `POST /auth/logout`, `GET /auth/profile`, `PUT /auth/profile` |
| **Crops** | `GET /crops`, `POST /crops`, `GET /crops/:id`, `PUT /crops/:id`, `DELETE /crops/:id`, `GET /crops/my/listings`, `GET /crops/ai-price`, `POST /crops/detect-quality` |
| **Offers** | `GET /offers`, `POST /offers`, `GET /offers/:id`, `PATCH /offers/:id` |
| **Contracts** | `GET /contracts`, `GET /contracts/:id`, `POST /contracts/:id/payment/initiate`, `POST /contracts/:id/payment/confirm`, `POST /contracts/:id/payment/release`, `POST /contracts/:id/dispute`, `GET /contracts/:id/delivery/track` |
| **Chats** | `GET /chats`, `POST /chats`, `GET /chats/:chatId/messages`, `POST /chats/:chatId/messages` |
| **Notifications** | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` |
| **Weather** | `GET /weather?lat=&lng=`, `GET /weather/city/:city` |
| **Mandi** | `GET /mandi`, `GET /mandi/:commodity/history`, `POST /mandi/sync` |
| **Reviews** | `GET /reviews/user/:userId`, `POST /reviews` |
| **Admin** | `GET /admin/dashboard`, `GET /admin/users`, `GET /admin/verifications`, `PATCH /admin/users/:userId/verify`, `PATCH /admin/users/:userId/ban`, `PATCH /admin/contracts/:contractId/dispute/resolve`, `POST /admin/broadcast` |

---

## 🛡️ Security Features

- ✅ JWT Access + Refresh Token rotation
- ✅ OTP-based phone authentication (Twilio)
- ✅ Google OAuth2
- ✅ Role-based access control (Farmer/Buyer/Admin)
- ✅ bcrypt password hashing
- ✅ Rate limiting (express-rate-limit)
- ✅ Input validation (Joi)
- ✅ MongoDB injection prevention (mongo-sanitize)
- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ Stripe Escrow payments
- ✅ File upload validation (Multer)

---

## 💬 Socket.io Events

### Client → Server
- `join_chat` - Join a chat room
- `leave_chat` - Leave a chat room
- `send_message` - Send a message
- `typing` / `stop_typing` - Typing indicators
- `message_read` - Mark message as read
- `update_location` - Update GPS location

### Server → Client
- `new_message` - New chat message
- `message_notification` - Unread message alert
- `new_offer` - New offer received
- `offer_accepted` / `offer_rejected` / `counter_offer` - Offer updates
- `payment_in_escrow` / `payment_released` - Payment events
- `notification` - System notification
- `user_online` / `user_offline` - Presence

---

## 🌐 External APIs

| Service | Purpose | Config Key |
|---------|---------|------------|
| **Twilio** | OTP + Voice/Video | `TWILIO_*` |
| **Stripe** | Escrow payments | `STRIPE_*` |
| **OpenWeather** | Weather insights | `OPENWEATHER_API_KEY` |
| **AGMARKNET** | Mandi prices | `AGMARKNET_API_KEY` |
| **Porter** | Logistics | `PORTER_API_KEY` |
| **Cloudinary** | Image storage | `CLOUDINARY_*` |
| **Firebase** | Push notifications | `FIREBASE_*` |
| **Google OAuth** | Social login | `GOOGLE_CLIENT_*` |

---

## 🚀 Deployment

### Railway / Render
```bash
# Set environment variables in dashboard
# Deploy with:
git push origin main
```

### MongoDB Atlas
```
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/krushimitra
```

---

## 🧪 Testing

```bash
npm test                    # Run all tests
npm test -- --coverage      # With coverage report
npm test auth.test.js       # Single file
```

---

*🌾 KrushiMitra - Empowering Indian Farmers*
