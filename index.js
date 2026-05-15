require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// PhonePe V2 Config
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const CLIENT_VERSION = process.env.CLIENT_VERSION || 'v1';
const MERCHANT_ID = process.env.MERCHANT_ID;

const PHONEPE_ENV = (process.env.PHONEPE_ENV || 'sandbox').trim().toLowerCase();
const IS_PRODUCTION = PHONEPE_ENV === 'production';

console.log(`[PhonePe] Running in ${IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX'} mode`);

const BASE_URL = IS_PRODUCTION 
    ? 'https://api.phonepe.com/apis/pg' 
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

const AUTH_URL = IS_PRODUCTION
    ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox/identity-manager/v1/oauth/token';

// Token Cache
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Fetch OAuth Access Token (O-Bearer)
 */
async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry - 60000) {
        return cachedToken;
    }

    if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID' || !CLIENT_SECRET || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
        console.error('CRITICAL: PhonePe Credentials are missing or using placeholders!');
        console.error('Check your Railway Variables tab.');
        throw new Error('Missing Credentials');
    }

    try {
        const params = new URLSearchParams();
        params.append('client_id', CLIENT_ID);
        params.append('client_version', CLIENT_VERSION);
        params.append('client_secret', CLIENT_SECRET);
        params.append('grant_type', 'client_credentials');

        console.log(`OAuth Request to: ${AUTH_URL}`);
        
        const response = await axios.post(AUTH_URL, params, {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        cachedToken = response.data.access_token;
        tokenExpiry = Date.now() + (response.data.expires_in * 1000);
        return cachedToken;
    } catch (error) {
        if (error.response) {
            console.error('OAuth Token Detailed Error:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('OAuth Token Error:', error.message);
        }
        throw new Error('Failed to obtain PhonePe O-Bearer token');
    }
}

/**
 * Initiate Payment (Checkout v2)
 */
app.post('/pay', async (req, res) => {
    try {
        const { amount, mobileNumber, userId } = req.body;
        const merchantOrderId = 'ORD' + Date.now();
        const token = await getAccessToken();

        // PhonePe Checkout v2 Payload
        const data = {
            merchantOrderId: merchantOrderId,
            amount: amount * 100, // in paise
            expireAfter: 1200, // 20 mins
            paymentFlow: {
                type: 'PG_CHECKOUT',
                merchantUrls: {
                    redirectUrl: process.env.REDIRECT_URL || `http://localhost:${PORT}/callback`,
                }
            },
            metaInfo: {
                udf1: userId || 'anonymous',
                udf2: mobileNumber || 'not_provided'
            }
        };

        const response = await axios.post(`${BASE_URL}/checkout/v2/pay`, data, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `O-Bearer ${token}`
            }
        });

        // Checkout v2 returns a redirect URL directly
        const redirectUrl = response.data.redirectUrl || response.data.data?.redirectUrl;
        res.json({ success: true, url: redirectUrl, orderId: merchantOrderId });

    } catch (error) {
        console.error('Payment v2 Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Payment initiation failed', 
            error: error.response ? error.response.data : error.message 
        });
    }
});

/**
 * Callback/Webhook endpoint (Checkout v2)
 */
app.post('/callback', (req, res) => {
    try {
        // Verify Basic Auth
        const authHeader = req.headers.authorization;
        if (process.env.WEBHOOK_USER && process.env.WEBHOOK_PASS) {
            const expectedAuth = 'Basic ' + Buffer.from(process.env.WEBHOOK_USER + ':' + process.env.WEBHOOK_PASS).toString('base64');
            if (authHeader !== expectedAuth) {
                console.warn('Unauthorized Webhook Attempt detected!');
                return res.status(401).send('Unauthorized');
            }
        }

        console.log('Payment Callback Received (v2):', JSON.stringify(req.body, null, 2));
        
        // In v2, PhonePe sends a JSON body with event and payload
        const { event, payload } = req.body;
        
        const isSuccess = event === 'checkout.order.completed' || 
                         event === 'pg.order.completed' || 
                         event === 'paylink.order.completed';

        if (isSuccess && payload.state === 'COMPLETED') {
            console.log('Payment Successful for Order:', payload.merchantOrderId || payload.merchantTransactionId);
            // Business logic here (e.g. update DB, fulfill order)
            return res.status(200).send('OK');
        }

        console.log('Processed event:', event, 'State:', payload?.state);
        // Always return 200 to acknowledge receipt
        res.status(200).send('OK');

    } catch (error) {
        console.error('Callback Error:', error.message);
        res.status(500).send('Error');
    }
});

/**
 * Check Order Status (Checkout v2)
 */
app.get('/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const token = await getAccessToken();

        const response = await axios.get(`${BASE_URL}/checkout/v2/order/${orderId}/status`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `O-Bearer ${token}`
            }
        });

        res.json(response.data);

    } catch (error) {
        console.error('Status v2 Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Status check failed' });
    }
});

app.get('/', (req, res) => {
    res.send('PhonePe Checkout v2 Service Running');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
