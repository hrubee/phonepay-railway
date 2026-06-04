# PhonePe Payment Gateway Bridge (Railway Ready)

This project is a ready-to-deploy Node.js service that integrates the PhonePe Payment Gateway.

## Getting Started

### 1. Local Setup
1. Clone this repository.
2. Run `npm install`.
3. Create a `.env` file (see `.env.example`).
4. Run `npm start`.

### 2. Railway Deployment
1. Connect your GitHub repository to [Railway](https://railway.app/).
2. Add the following Environment Variables in Railway:
   - `MERCHANT_ID`: Your PhonePe Merchant ID.
   - `SALT_KEY`: Your PhonePe Salt Key.
   - `SALT_INDEX`: Your Salt Index (usually 1).
   - `REDIRECT_URL`: `https://api.leadconnectorhq.com/widget/booking/JQluA6Wuu6YhqojWYNtK`
   - `CALLBACK_URL`: `https://counsel.soulhealingwithayessha.com/callback`
   - `PHONEPE_ENV`: `production` (or `sandbox` for testing)
   - `META_PIXEL_ID`: Your Meta Pixel ID (also hardcoded in `public/index.html` for the page pixel).
   - `META_CAPI_ACCESS_TOKEN`: Conversions API token (Events Manager → Settings → Conversions API). **Secret — Railway only.**
   - `META_GRAPH_VERSION` (optional): Graph API version, defaults to `v21.0`.
   - `META_TEST_EVENT_CODE` (optional): set ONLY while testing in Events Manager → Test Events; **remove for live**.
   - `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD`: must match the webhook credentials set in the PhonePe dashboard (see below).
3. Railway will automatically detect the `Procfile` and `package.json` and deploy.

### 3. Moving to Production
To move from testing (sandbox) to Production:
1. Set the `PHONEPE_ENV` environment variable to `production` in Railway.
2. Ensure your `CLIENT_ID`, `CLIENT_SECRET`, and `MERCHANT_ID` are set to your live production credentials.
3. The server will automatically switch to the production API endpoints.

## API Endpoints
- `POST /pay`: Initiates a payment. Returns a JSON with `url`.
- `POST /callback`: Handles the redirect and webhook from PhonePe.
- `GET /status/:transactionId`: Checks the current status of a transaction.

## Integration with GoHighLevel (GHL)
This bridge is designed to work as a **Custom Payment Provider** in GHL:
1. Create a Custom Payment Provider in GHL.
2. Set the **Checkout URL** to your Railway URL + `/pay`.
3. GHL will send payment details to your `/pay` endpoint.
4. Your server will redirect the user to PhonePe.
5. Once paid, PhonePe redirects back to your `/callback`, which can then notify GHL of the success.

## Meta Pixel & Conversions API (Purchase tracking)
A `Purchase` event is sent when a payment is confirmed `COMPLETED`, via **two deduplicated paths**:
- **Browser Pixel** — fires on the `/status` success page (`fbq('track','Purchase', …, { eventID: orderId })`).
- **Conversions API (server-side)** — sent from `index.js` to the Graph API with hashed email/phone/name + IP/UA/`_fbp`.

Both use `event_id = orderId`, so Meta automatically deduplicates them. The base `PageView` pixel also runs on the checkout page (`public/index.html`) and the `/status` page.

**Verify it works:** Events Manager → **Test Events**, set `META_TEST_EVENT_CODE` temporarily, complete a ₹1 test purchase (promo `AYESSHA1` on consultation), confirm a single deduplicated `Purchase` appears, then **remove `META_TEST_EVENT_CODE`**.

## PhonePe Webhook (server-to-server)
So the purchase is captured even if the buyer closes the tab before returning, `POST /callback` also fires GHL + Meta. To enable:
1. In the **PhonePe Business dashboard → Developer Settings → Webhooks**, add the URL `https://counsel.soulhealingwithayessha.com/callback` with a **username** and **password**.
2. Set `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD` in Railway to the **same** values.
3. The server validates each webhook's `Authorization: SHA256(username:password)` header and ignores anything that doesn't match. If these vars are unset, `/callback` acknowledges but takes no action (so it's never an open, spoofable endpoint).

Duplicate firing across `/status` and `/callback` is prevented by per-order `ghlWebhookSent` / `metaEventSent` flags plus Meta's `event_id` dedup.

> **Note:** Order state is held in memory (`orders` Map). A redeploy/restart clears it, so an event arriving after a restart for an order created before it will be skipped (no local order data). Persisting orders (e.g. Redis/DB) would close that gap.

## Testing with UAT
The project comes pre-configured with PhonePe UAT credentials. You can test the flow immediately by running the app and clicking "Pay Now" on the homepage.

