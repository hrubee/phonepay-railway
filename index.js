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
const GHL_WEBHOOK_URL = (process.env.GHL_WEBHOOK_URL || 'https://services.leadconnectorhq.com/hooks/XFzztkrNXWJ5DBXeVZIZ/webhook-trigger/e8cfd0ec-71d6-4bcc-92f4-ba723bb573ff').replace(/['"]/g, '').trim();
const SUCCESS_REDIRECT_URL = (process.env.REDIRECT_URL || 'https://api.leadconnectorhq.com/widget/booking/JQluA6Wuu6YhqojWYNtK').replace(/['"]/g, '').trim();

const PRODUCTS = {
    consultation: {
        id: 'consultation',
        service: 'Soul Healing Consultation',
        amount: 8000
    },
    'relationship-guide': {
        id: 'relationship-guide',
        service: 'Relationship Guide',
        amount: 200
    },
    'alchemy-course': {
        id: 'alchemy-course',
        service: 'Alchemy Course',
        amount: 2000
    }
};

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
const orders = new Map();

app.get('/relationship-guide', (req, res) => {
    res.sendFile(`${__dirname}/public/index.html`);
});

app.get('/alchemy-course', (req, res) => {
    res.sendFile(`${__dirname}/public/index.html`);
});

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

async function sendGhlPaymentWebhook(orderId, statusData) {
    const order = orders.get(orderId);

    if (!order) {
        console.warn(`No local order details found for ${orderId}; skipping GHL webhook`);
        return;
    }

    if (order.ghlWebhookSent) {
        console.log(`GHL webhook already sent for ${orderId}`);
        return;
    }

    const payload = {
        event: 'payment_success',
        payment_status: 'success',
        source: 'PhonePe',
        product_id: order.productId,
        service: order.service,
        order_id: orderId,
        amount: order.amount,
        amount_paise: order.amount * 100,
        name: order.name,
        email: order.email,
        phone: order.phone,
        phonepe_status: statusData?.data?.state || 'COMPLETED',
        phonepe_transaction_id: statusData?.data?.transactionId || null,
        created_at: order.createdAt,
        paid_at: new Date().toISOString()
    };

    await axios.post(GHL_WEBHOOK_URL, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        timeout: 10000
    });

    order.ghlWebhookSent = true;
    orders.set(orderId, order);
    console.log(`GHL payment webhook sent for ${orderId}`);
}

/**
 * Initiate Payment (V2 Standard OAuth Flow)
 */
app.post('/pay', async (req, res) => {
    try {
        const { productId, name, email, mobileNumber, userId } = req.body;

        const orderId = `MT${Date.now()}${Math.floor(Math.random() * 100)}`; // 18+ characters
        const cleanMobile = mobileNumber ? mobileNumber.replace(/\D/g, '').slice(-10) : '';
        const cleanName = (name || '').trim();
        const cleanEmail = (email || '').trim().toLowerCase();
        const requestedProductId = productId || 'consultation';
        const product = PRODUCTS[requestedProductId];

        if (!product) {
            return res.status(400).json({ success: false, message: 'Invalid product' });
        }

        if (!cleanName) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ success: false, message: 'Valid email is required' });
        }

        if (cleanMobile.length !== 10) {
            return res.status(400).json({ success: false, message: 'Valid 10 digit phone number is required' });
        }

        orders.set(orderId, {
            productId: product.id,
            service: product.service,
            amount: product.amount,
            name: cleanName,
            email: cleanEmail,
            phone: cleanMobile,
            userId: userId || `U${Date.now()}`,
            ghlWebhookSent: false,
            createdAt: new Date().toISOString()
        });

        const accessToken = await getAccessToken();

        const payload = {
            merchantId: MERCHANT_ID,
            merchantOrderId: orderId,
            amount: product.amount * 100, // convert to paise (integer)
            paymentFlow: {
                type: 'PG_CHECKOUT',
                merchantUrls: {
                    redirectUrl: `https://counsel.soulhealingwithayessha.com/status/${orderId}`
                }
            },
            metaInfo: {
                mobileNumber: cleanMobile,
                merchantUserId: orders.get(orderId).userId,
                customerName: cleanName,
                customerEmail: cleanEmail,
                productId: product.id,
                service: product.service
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
            try {
                await sendGhlPaymentWebhook(orderId, response.data);
            } catch (webhookError) {
                console.error('GHL Webhook Error:', webhookError.response ? webhookError.response.data : webhookError.message);
            }

            res.redirect(SUCCESS_REDIRECT_URL);
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
