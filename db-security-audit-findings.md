# Database Security Audit Findings

## Scope
- `backend/src/config/database.js`
- `backend/scripts/setupDatabaseIndexes.js`
- `backend/src/models/User.js`
- `backend/src/models/Crop.js`
- `backend/src/models/Offer.js`
- `backend/src/models/Contract.js`
- `backend/src/models/Chat.js`
- `backend/src/models/Notification.js`
- `backend/src/models/Review.js`
- `backend/src/models/Payment.js`
- `backend/src/models/MandiPrice.js`
- `backend/src/models/TokenBlacklist.js`
- `backend/src/services/transactionService.js`
- `backend/src/services/healthService.js`
- `backend/.env.example`
- `backend/src/middlewares/csrf.js`
- `backend/src/middlewares/rateLimiter.js`
- `backend/src/middlewares/endpointRateLimiters.js`
- `backend/src/middlewares/upload.js`
- `backend/src/middlewares/fileUpload.js`

## Findings

### 1) Duplicate/conflicting model definitions are present and likely loaded inconsistently
- **Files:** `backend/src/models/Chat.js`, `backend/src/models/Payment.js`, `backend/src/models/MandiPrice.js`
- **Severity:** High
- **Issue:** The provided source contents show multiple incompatible definitions for the same model names:
  - `Chat.js` appears once exporting a single `Chat` message-like document, and again exporting `{ Chat, Message }` with a different schema.
  - `Payment.js` appears once with flat Stripe fields and again with nested `stripe` object plus different enums/fields.
  - `MandiPrice.js` appears once using `arrivalDate` and once using `priceDate`.
  In Mongoose, loading divergent model contracts across controllers/services causes runtime field mismatches, broken queries, invalid populate paths, and index setup drift.
- **Why it matters:** This is a high-confidence correctness risk. Scripts such as `setupDatabaseIndexes.js` assume one schema contract, while service code may use another.
- **Recommended fix:** Ensure exactly one canonical definition exists per model file and one export contract per model name. Remove stale duplicate implementations and update all imports to match the final contract.
- **Proposed code-level change:** Consolidate each of:
  - `backend/src/models/Chat.js`
  - `backend/src/models/Payment.js`
  - `backend/src/models/MandiPrice.js`
  to a single schema/export only.

### 2) Transaction retry logic is broken and can recurse indefinitely with wrong retry state
- **File:** `backend/src/services/transactionService.js`
- **Severity:** High
- **Issue:** `executeTransaction()` initializes `let retries = 0;` on every invocation, then on retry calls `return executeTransaction(operation, { ...options, retries });`. That overwrites `options.retries` with the current retry count instead of decrementing or tracking attempts separately. On recursive calls, local `retries` resets to `0`, so the retry guard is logically incorrect and may under/over-retry unpredictably.
- **Recommended fix:** Track attempts in a separate parameter, or use a loop. Example:
  - add `attempt = 0` parameter
  - compare `attempt < options.retries`
  - recurse with `attempt + 1`
- **Proposed code-level change:** Refactor `executeTransaction` to `const executeTransaction = async (operation, options = { retries: 3, timeout: 30000 }, attempt = 0) => { ... if (attempt < options.retries && shouldRetry(error)) return executeTransaction(operation, options, attempt + 1); }`

### 3) Transaction helper references wrong paths and schema fields, likely causing runtime failures
- **File:** `backend/src/services/transactionService.js`
- **Severity:** High
- **Issue:**
  - Imports `const { generateContractId } = require('./helpers');` but helpers in this codebase are under `../utils/helpers`.
  - `transactionOfferAcceptance()` populates `offer.farmer`, but `Offer` schema only stores `crop`, `farmer`, `buyer`; that is fine, yet it also populates crop fields and later uses `offer.counterOffer?.price || offer.offeredPrice` while keeping `offer.totalAmount` unchanged, causing pricing inconsistency.
  - `transactionPaymentProcessing()` checks `contract.payment.status`, but `Contract` model uses nested `payment.status`; that part matches. It then creates `Payment` with `status: 'authorized', ...paymentData`, but current `Payment` schema variants require fields like `payer`, `payee`, and possibly `type`, so this likely fails validation.
  - It writes `contract.payment.stripePaymentIntentId = paymentData.paymentIntentId`, while one `Payment` schema variant stores Stripe under `stripe.paymentIntentId`.
- **Recommended fix:** Align helper import path, payment payload shape, and field names with the canonical model schemas. Add explicit validation before transaction steps.
- **Proposed code-level change:** Update helper import to `require('../utils/helpers')` and construct `Payment.create()` with all required fields from canonical `Payment` schema.

### 4) Offer acceptance transaction is race-prone and can oversell inventory
- **File:** `backend/src/services/transactionService.js`
- **Severity:** High
- **Issue:** The service reads `offer.crop.availableQuantity`, validates in memory, then separately decrements with `Crop.findByIdAndUpdate(... { $inc: { availableQuantity: -offer.quantity } })`. There is no conditional update guaranteeing `availableQuantity >= offer.quantity` at write time. Concurrent accepted offers can pass the pre-check and over-decrement stock.
- **Recommended fix:** Use a conditional atomic update inside the transaction:
  - query by `_id` and `availableQuantity: { $gte: offer.quantity }`
  - decrement in one statement
  - verify matched document
- **Proposed code-level change:** Replace unconditional `findByIdAndUpdate` with `findOneAndUpdate({ _id: offer.crop._id, availableQuantity: { $gte: offer.quantity } }, { $inc: { availableQuantity: -offer.quantity } }, { session, new: true })` and throw if null.

### 5) Contract creation path can produce duplicate `contractId` values under contention
- **Files:** `backend/src/models/Contract.js`, `backend/src/services/transactionService.js`
- **Severity:** Medium
- **Issue:** `contractId` is generated in two places:
  - model pre-save hook
  - `transactionOfferAcceptance()` before create
  If `generateContractId()` is time/random based but not collision-safe, a unique-index violation may occur under load. Duplicate generation in two layers also obscures source of truth.
- **Recommended fix:** Generate `contractId` in exactly one place, ideally schema pre-validation/pre-save, and handle duplicate key retries if needed.

### 6) `Crop` geospatial field lacks coordinate validation and defaults permit invalid data
- **Files:** `backend/src/models/Crop.js`, `backend/src/models/User.js`
- **Severity:** Medium
- **Issue:**
  - `Crop.location.coordinates` is required but not length/range validated.
  - `User.location.coordinates` defaults to `[0, 0]`, which creates misleading geo records near the Gulf of Guinea and pollutes location queries/indexes.
- **Recommended fix:** Add custom validators:
  - array length exactly 2
  - longitude between `-180` and `180`
  - latitude between `-90` and `90`
  For `User`, remove default `[0,0]` and leave coordinates absent unless explicitly set.

### 7) `Crop.availableQuantity` can become inconsistent on updates
- **File:** `backend/src/models/Crop.js`
- **Severity:** Medium
- **Issue:** Pre-save hook sets `availableQuantity = quantity` only on new documents. If a crop is created through update operators or quantity changes later, `availableQuantity` can drift or remain undefined.
- **Recommended fix:** Set a default of `quantity` on create via application logic or pre-validate hook, and define update rules preventing `availableQuantity > quantity` or negative values. Consider `min: 0` on `availableQuantity`.

### 8) `Offer` lacks integrity constraints that prevent invalid self-dealing and duplicates
- **File:** `backend/src/models/Offer.js`
- **Severity:** Medium
- **Issue:**
  - No schema validation prevents `buyer` and `farmer` being the same user.
  - No unique/compound index prevents multiple active pending offers from the same buyer on the same crop if business rules disallow it.
  - `totalAmount` is required even though it is derived, which makes update paths fragile.
- **Recommended fix:** Add schema validator rejecting identical `buyer` and `farmer`; consider a partial unique index like `{ crop: 1, buyer: 1, status: 1 }` for active statuses if the business rule allows only one active offer; compute `totalAmount` in middleware and remove `required: true`.

### 9) `Review` indexes in the index setup script do not match the actual schema
- **Files:** `backend/src/models/Review.js`, `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** High
- **Issue:** The script creates indexes on `targetType` and `targetId`, but the actual model fields are `reviewer`, `reviewee`, and `contract`. Those script-defined indexes are dead weight and indicate schema drift.
- **Recommended fix:** Update `setupDatabaseIndexes.js` to reflect the actual `Review` schema:
  - `{ reviewee: 1, createdAt: -1 }`
  - `{ reviewer: 1 }`
  - `{ contract: 1 }`
  - `{ reviewer: 1, contract: 1 }` unique

### 10) `Notification` indexes in the index setup script target the wrong field name
- **Files:** `backend/src/models/Notification.js`, `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** High
- **Issue:** The schema uses `recipient`, but the script defines indexes on `user`. Those indexes will not support actual notification queries and may create unnecessary indexes on a non-existent field.
- **Recommended fix:** Replace all `user` references in the `Notification` section of `setupDatabaseIndexes.js` with `recipient`.

### 11) `Contract` indexes in the index setup script target a non-existent nested field
- **Files:** `backend/src/models/Contract.js`, `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** High
- **Issue:** The script indexes `'paymentStatus.status'`, but the schema path is `'payment.status'`.
- **Recommended fix:** Change the index definition to `{ 'payment.status': 1 }`.

### 12) `Payment` indexes in the index setup script do not match either visible schema
- **Files:** `backend/src/models/Payment.js`, `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** High
- **Issue:** The script indexes `relatedEntity` and `transactionRef`, but neither appears in the provided `Payment` schemas. One schema uses `stripePaymentIntentId`, another uses `stripe.paymentIntentId`, and one has `receiptId`.
- **Recommended fix:** After choosing the canonical `Payment` schema, update script indexes accordingly and remove non-existent fields.

### 13) `MandiPrice` indexes in the index setup script do not match the model field names
- **Files:** `backend/src/models/MandiPrice.js`, `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** High
- **Issue:** The script indexes `date`, but the model variants use `arrivalDate` or `priceDate`. This means the script misses critical sort/filter indexes for market-price history.
- **Recommended fix:** Choose one canonical date field name and align both model and index script to it.

### 14) `setupDatabaseIndexes.js` manually creates indexes already declared in schemas, increasing drift risk
- **File:** `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** Medium
- **Issue:** The script duplicates many schema-defined indexes instead of relying on Mongoose schema definitions or a single source of truth. This is exactly why the script has drifted from several models.
- **Recommended fix:** Prefer declaring indexes in schemas and running `Model.syncIndexes()` / `Model.createIndexes()` per model. If a script is kept, derive from schema metadata or keep it minimal for environment-specific maintenance only.

### 15) `setupDatabaseIndexes.js` does not specify unique/sparse/text/TTL options for many indexes it comments as unique or special
- **File:** `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** Medium
- **Issue:** Several comments say "Unique indexes", but the script only passes bare field specs like `{ email: 1 }`, not `{ unique: true, sparse: true }`. That means the script behavior does not match comments or schema guarantees.
- **Recommended fix:** Use explicit `{ key, options }` definitions, e.g. `{ key: { email: 1 }, options: { unique: true, sparse: true } }`, then call `createIndex(key, options)`.

### 16) `connectDB` attaches global process and connection listeners on every successful call
- **File:** `backend/src/config/database.js`
- **Severity:** Medium
- **Issue:** If `connectDB()` is invoked more than once in tests, workers, or hot-reload scenarios, it will register duplicate `mongoose.connection.on(...)` and `process.on('SIGINT', ...)` handlers.
- **Recommended fix:** Register listeners once at module scope or guard with a boolean flag.

### 17) `connectDB` exits the process from library code, reducing resiliency and testability
- **File:** `backend/src/config/database.js`
- **Severity:** Medium
- **Issue:** On final failure the function calls `process.exit(1)`. As a config/helper module, this makes graceful shutdown, unit testing, and worker recovery harder.
- **Recommended fix:** Throw the error and let the server bootstrap decide whether to exit.

### 18) Database connection options include deprecated Mongoose flags
- **Files:** `backend/src/config/database.js`, `backend/scripts/setupDatabaseIndexes.js`
- **Severity:** Low
- **Issue:** `useNewUrlParser` and `useUnifiedTopology` are deprecated/no-op in Mongoose 8. Keeping them is not fatal but signals outdated connection handling.
- **Recommended fix:** Remove deprecated flags and consider adding `autoIndex: false` in production if indexes are managed separately.

### 19) Health service may throw when DB is disconnected before entering the intended error path
- **File:** `backend/src/services/healthService.js`
- **Severity:** Medium
- **Issue:** `mongoose.connection.db.admin()` assumes `db` exists. If there is no active connection object yet, this access can fail unexpectedly. The `try/catch` helps, but the service does not report connection readyState, pool details, or ping latency.
- **Recommended fix:** Check `mongoose.connection.readyState` first; if not connected, mark degraded without calling `db.admin()`. Optionally measure ping latency with timestamps.

### 20) CSRF implementation is not stateful and is incompatible with many mobile/API clients
- **File:** `backend/src/middlewares/csrf.js`
- **Severity:** High
- **Issue:** The middleware generates a token on every GET and sends it back, but does not bind it to a server-side session, signed cookie, or JWT claim. Validation only checks token presence and hex format. Any attacker/client can mint any 64-char hex string and pass validation. This gives a false sense of protection.
- **Mobile compatibility implication:** Native mobile clients using bearer tokens usually do not need CSRF at all unless cookies are used. Enforcing this header for all state-changing API calls adds friction and breaks clients that do not first fetch a GET token.
- **Recommended fix:** If the API is bearer-token based for mobile/web SPA, disable CSRF for Authorization-header authenticated JSON APIs and rely on CORS + no-cookie auth. If cookie auth is used, implement proper double-submit cookie or session-backed CSRF validation.

### 21) Rate limiters use IP-only keys by default, which can punish many mobile users behind carrier NAT
- **Files:** `backend/src/middlewares/rateLimiter.js`, `backend/src/middlewares/endpointRateLimiters.js`
- **Severity:** Medium
- **Issue:** IP-based limits are fragile for mobile networks, shared Wi‑Fi, and proxies. Large groups of legitimate users can be throttled together.
- **Recommended fix:** For authenticated endpoints, prefer `req.user.id`; for OTP/auth, combine normalized principal identifiers with IP. Also ensure Express `trust proxy` is configured correctly upstream.

### 22) Upload middleware variants are inconsistent and one has weak MIME validation
- **Files:** `backend/src/middlewares/upload.js`, `backend/src/middlewares/fileUpload.js`
- **Severity:** Medium
- **Issue:**
  - There are multiple upload middleware implementations with different limits and validation depth.
  - `upload.js` uses regex against `file.mimetype`, which is weak and conflates file extension and MIME checks.
  - One variant imports `cloudinary` but never uses it.
- **Recommended fix:** Standardize on the stricter `fileUpload.js` approach with magic-byte validation and image parsing, then remove the weaker duplicate middleware to avoid inconsistent route behavior.

### 23) `User` schema stores refresh token directly, creating unnecessary database compromise impact
- **File:** `backend/src/models/User.js`
- **Severity:** Medium
- **Issue:** `refreshToken` appears to be stored plaintext (though `select: false`). If the DB is leaked, valid refresh tokens may be reusable.
- **Recommended fix:** Store a hash of the refresh token or use rotation with token family identifiers. Clear old tokens on rotation/logout.

### 24) Sensitive/high-churn token fields are unindexed or insufficiently modeled for scale
- **Files:** `backend/src/models/User.js`, `backend/src/models/TokenBlacklist.js`
- **Severity:** Low
- **Issue:** `fcmToken` and `googleId` are plain strings without uniqueness/indexing decisions. `TokenBlacklist` stores entire token strings, which can be large and cause index bloat.
- **Recommended fix:** Consider indexing `googleId` if used for login lookup; for blacklist, store a hash/jti claim instead of full token text.

### 25) `TokenBlacklistService.revokeAllForUser()` logic does not actually revoke all active tokens
- **File:** `backend/src/models/TokenBlacklist.js`
- **Severity:** Medium
- **Issue:** It queries existing blacklist documents for the user and then updates them, but cannot revoke tokens that are not already in the blacklist. The method name overpromises and may create a security gap during incidents.
- **Recommended fix:** Rename the method to reflect behavior, or implement token versioning / user `tokenIssuedAfter` invalidation strategy checked during JWT verification.

### 26) Environment example encourages insecure secret handling and exposes misleading production defaults
- **File:** `backend/.env.example`
- **Severity:** Low
- **Issue:**
  - Includes highly sensitive variable examples inline for AWS/Firebase/Stripe/Twilio, which is common but should be clearly fake.
  - `ADMIN_PASSWORD=change_this_secure_password` is too weak even as an example.
  - `CLIENT_URL` / `CORS_ORIGINS` contain Expo/local development assumptions only; no explicit note that native mobile apps may send no Origin header.
- **Recommended fix:** Strengthen comments:
  - require secrets manager in production
  - note that native mobile requests may omit `Origin`
  - avoid default admin password examples that resemble usable passwords

## Priority Fix Order
1. Resolve duplicate/conflicting model definitions in `Chat.js`, `Payment.js`, and `MandiPrice.js`.
2. Align `setupDatabaseIndexes.js` with actual schema field names and options.
3. Fix `transactionService.js` retry logic and atomic crop decrement.
4. Replace pseudo-CSRF with a strategy appropriate for bearer-token APIs.
5. Add coordinate/object integrity validation in `User.js` and `Crop.js`.
6. Standardize on one secure upload middleware.

## Notes for parent/other agents
- The most serious cross-cutting issue is **schema/index drift**: model files and the index setup script disagree on multiple field names.
- The provided reads showed **incompatible duplicate contents** for `Chat.js`, `Payment.js`, and `MandiPrice.js`; this should be verified in the working tree/history because it strongly suggests merge drift or alternate branches copied into the same path.