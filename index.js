require('dotenv').config();
// Deployment Timestamp: 2026-05-15 19:10
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
 * Fetch OAuth Access Token
 */
async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry - 60000) {
        return cachedToken;
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
        console.log(`Token obtained successfully. Expires in ${response.data.expires_in}s`);
        return cachedToken;
    } catch (error) {
        console.error('OAuth Token Error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to obtain PhonePe O-Bearer token');
    }
}

/**
 * Initiate Payment (V2 Standard OAuth Flow)
 */
app.post('/pay', async (req, res) => {
    try {
        const { amount, mobileNumber, userId } = req.body;
        const accessToken = await getAccessToken();

        const orderId = `MT${Date.now()}${Math.floor(Math.random() * 100)}`; // 18+ characters
        const cleanMobile = mobileNumber ? mobileNumber.replace(/\D/g, '').slice(-10) : '';

        const amountInt = parseInt(amount, 10);
        if (!amountInt || isNaN(amountInt)) {
            return res.status(400).json({ success: false, message: 'Invalid amount' });
        }

        const payload = {
            merchantId: MERCHANT_ID,
            merchantOrderId: orderId,
            amount: amountInt * 100, // convert to paise (integer)
            paymentFlow: {
                type: 'PG_CHECKOUT',
                merchantUrls: {
                    redirectUrl: `https://counsel.soulhealingwithayessha.com/status/${orderId}`
                }
            },
            metaInfo: {
                mobileNumber: cleanMobile,
                merchantUserId: userId || `U${Date.now()}`
            }
        };

        const payUrl = `${BASE_URL}/checkout/v2/pay`;
        console.log(`Initiating v2 Payment at: ${payUrl} for ID: ${orderId}`);

        const response = await axios.post(payUrl, payload, {
            headers: {
                'Authorization': `O-Bearer ${accessToken}`,
                'X-MERCHANT-ID': MERCHANT_ID,
                'X-CLIENT-ID': CLIENT_ID,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        if (response.data.redirectUrl || response.data.state === 'PENDING' || response.data.success) {
            // In v2, the redirect URL is often directly in the root of response.data
            const redirectUrl = response.data.redirectUrl || 
                               (response.data.data && response.data.data.redirectUrl) ||
                               (response.data.data && response.data.data.instrumentResponse && 
                                response.data.data.instrumentResponse.redirectInfo && 
                                response.data.data.instrumentResponse.redirectInfo.url);

            if (!redirectUrl) {
                console.error('No redirect URL found in success response:', response.data);
                return res.status(400).json({ success: false, message: 'Payment link missing' });
            }

            res.json({
                success: true,
                url: redirectUrl,
                orderId: orderId
            });
        } else {
            console.error('PhonePe Response (Non-Success):', JSON.stringify(response.data, null, 2));
            res.status(400).json({ success: false, message: response.data.message || 'Payment initiation failed', debug: response.data });
        }

    } catch (error) {
        if (error.response) {
            // PhonePe returned an error response
            console.error('PhonePe HTTP Error Status:', error.response.status);
            console.error('PhonePe HTTP Error Body:', JSON.stringify(error.response.data, null, 2));
            res.status(500).json({ 
                success: false, 
                message: error.response.data?.message || `PhonePe Error ${error.response.status}`,
                debug: error.response.data
            });
        } else {
            console.error('Network/Other Error:', error.message);
            res.status(500).json({ success: false, message: error.message || 'Payment Initialization Failed' });
        }
    }
});

/**
 * Check Status
 */
app.get('/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const accessToken = await getAccessToken();

        const response = await axios.get(`${BASE_URL}/checkout/v2/order/${MERCHANT_ID}/${orderId}`, {
            headers: {
                'Authorization': `O-Bearer ${accessToken}`,
                'X-MERCHANT-ID': MERCHANT_ID,
                'X-CLIENT-ID': CLIENT_ID, // CONSISTENCY
                'Accept': 'application/json'
            }
        });

        if (response.data.success && response.data.data.state === 'COMPLETED') {
            res.redirect(process.env.REDIRECT_URL);
        } else {
            res.send(`Payment Status: ${response.data.data.state}. If paid, you will be redirected shortly.`);
        }
    } catch (error) {
        console.error('Status Error:', error.message);
        res.status(500).send('Error checking status');
    }
});

/**
 * Webhook Callback
 */
app.post('/callback', (req, res) => {
    console.log('Webhook Received:', JSON.stringify(req.body, null, 2));
    res.status(200).send('OK');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
