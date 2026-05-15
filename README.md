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
   - `CLIENT_ID`: Your PhonePe Client ID.
   - `CLIENT_SECRET`: Your PhonePe Client Secret.
   - `MERCHANT_ID`: Your PhonePe Merchant ID.
   - `REDIRECT_URL`: `https://pay.soulhealingwithayessha.com/callback`
   - `CALLBACK_URL`: `https://pay.soulhealingwithayessha.com/callback`
   - `PHONEPE_ENV`: `production` (or `sandbox` for testing)
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

## Testing with UAT
The project comes pre-configured with PhonePe UAT credentials. You can test the flow immediately by running the app and clicking "Pay Now" on the homepage.

