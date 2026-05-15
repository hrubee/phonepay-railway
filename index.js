require('dotenv').config();
// Deployment Timestamp: 2026-05-15 17:33
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

// PhonePe Checkout v2 Config
const CLIENT_ID = (process.env.CLIENT_ID || '').replace(/['"]/g, '').trim();
const CLIENT_SECRET = (process.env.CLIENT_SECRET || '').replace(/['"]/g, '').trim();
const CLIENT_VERSION = (process.env.CLIENT_VERSION || '1').replace(/['"]/g, '').trim();
const MERCHANT_ID = (process.env.MERCHANT_ID || '').replace(/['"]/g, '').trim();

const PHONEPE_ENV = (process.env.PHONEPE_ENV || 'sandbox').replace(/['"]/g, '').trim().toLowerCase();
const IS_PRODUCTION = PHONEPE_ENV === 'production';

console.log(`[PhonePe v2] Running in ${IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX'} mode`);

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

    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Missing CLIENT_ID or CLIENT_SECRET');
    }

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', CLIENT_ID);
        params.append('client_secret', CLIENT_SECRET);
        params.append('client_version', CLIENT_VERSION);

        console.log(`Requesting token from: ${AUTH_URL}`);
        
        const response = await axios.post(AUTH_URL, params, {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
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
        const accessToken = await getAccessToken();

        const orderId = `O${Date.now()}`;
        
        // Clean mobile number (remove any non-digits, take last 10)
        const cleanMobile = mobileNumber ? mobileNumber.replace(/\D/g, '').slice(-10) : '';

        const payload = {
            merchantOrderId: orderId,
            amount: amount * 100, // paise
            paymentFlow: {
                type: 'PG_CHECKOUT',
                merchantUrls: {
                    redirectUrl: `https://counsel.soulhealingwithayessha.com/status/${orderId}`
                }
            },
            // Optional but good for tracking
            metaInfo: {
                mobileNumber: cleanMobile,
                userId: userId || `U${Date.now()}`
            }
        };

        console.log('Sending v2 Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(`${BASE_URL}/checkout/v2/pay`, payload, {
            headers: {
                'Authorization': `O-Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.success) {
            res.json({
                success: true,
                url: response.data.data.instrumentResponse.redirectInfo.url,
                orderId: orderId
            });
        } else {
            res.status(400).json({ success: false, message: response.data.message });
        }

    } catch (error) {
        console.error('Payment v2 Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Check Status (Checkout v2)
 */
app.get('/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const accessToken = await getAccessToken();

        const response = await axios.get(`${BASE_URL}/checkout/v2/order/${CLIENT_ID}/${orderId}`, {
            headers: {
                'Authorization': `O-Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.success && response.data.data.state === 'COMPLETED') {
            res.redirect(process.env.REDIRECT_URL);
        } else {
            res.send(`Payment State: ${response.data.data.state}. If success, you will be redirected shortly.`);
        }
    } catch (error) {
        console.error('Status Error:', error.message);
        res.status(500).send('Error checking status');
    }
});

/**
 * Webhook (Checkout v2)
 */
app.post('/callback', (req, res) => {
    try {
        console.log('Webhook Received:', JSON.stringify(req.body, null, 2));
        // Basic Auth check omitted for simplicity during debugging, but recommended later
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send('Error');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
