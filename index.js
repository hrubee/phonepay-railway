require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// PhonePe Standard Checkout Config
const MERCHANT_ID = process.env.MERCHANT_ID;
const SALT_KEY = process.env.SALT_KEY;
const SALT_INDEX = process.env.SALT_INDEX || '1';
const PHONEPE_ENV = (process.env.PHONEPE_ENV || 'sandbox').trim().toLowerCase();
const IS_PRODUCTION = PHONEPE_ENV === 'production';

console.log(`[PhonePe Standard] Running in ${IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX'} mode`);

const BASE_URL = IS_PRODUCTION 
    ? 'https://api.phonepe.com/apis/hermes' 
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

/**
 * Generate X-VERIFY checksum for PhonePe
 */
function generateChecksum(payload, endpoint) {
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const stringToHash = base64Payload + endpoint + SALT_KEY;
    const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
    return `${sha256}###${SALT_INDEX}`;
}

/**
 * Initiate Payment (Standard Checkout)
 */
app.post('/pay', async (req, res) => {
    try {
        const { amount, mobileNumber, userId } = req.body;
        
        if (!MERCHANT_ID || !SALT_KEY) {
            return res.status(500).json({ error: 'Merchant credentials missing' });
        }

        const merchantTransactionId = `T${Date.now()}`;
        
        // Construct Payload
        const payload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: merchantTransactionId,
            merchantUserId: userId || `U${Date.now()}`,
            amount: amount * 100, // PhonePe expects amount in paise
            redirectUrl: `https://${req.get('host')}/status/${merchantTransactionId}`,
            redirectMode: 'REDIRECT',
            callbackUrl: process.env.CALLBACK_URL,
            mobileNumber: mobileNumber,
            paymentInstrument: {
                type: 'PAY_PAGE'
            }
        };

        const endpoint = '/pg/v1/pay';
        const xVerify = generateChecksum(payload, endpoint);
        const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');

        console.log(`Initiating payment for ${amount} INR...`);

        const response = await axios.post(`${BASE_URL}${endpoint}`, 
            { request: base64Payload },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-VERIFY': xVerify,
                    'accept': 'application/json'
                }
            }
        );

        if (response.data.success) {
            // Redirect URL is in response.data.data.instrumentResponse.redirectInfo.url
            res.json({
                success: true,
                url: response.data.data.instrumentResponse.redirectInfo.url,
                orderId: merchantTransactionId
            });
        } else {
            res.status(400).json({ success: false, message: response.data.message });
        }

    } catch (error) {
        console.error('Payment Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

/**
 * Check Payment Status
 */
app.get('/status/:txnId', async (req, res) => {
    try {
        const { txnId } = req.params;
        const endpoint = `/pg/v1/status/${MERCHANT_ID}/${txnId}`;
        
        // Checksum for status: SHA256(endpoint + saltKey) + "###" + saltIndex
        const stringToHash = endpoint + SALT_KEY;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const xVerify = `${sha256}###${SALT_INDEX}`;

        const response = await axios.get(`${BASE_URL}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': xVerify,
                'X-MERCHANT-ID': MERCHANT_ID,
                'accept': 'application/json'
            }
        });

        if (response.data.success && response.data.code === 'PAYMENT_SUCCESS') {
            // Success! Redirect to GoHighLevel
            res.redirect(process.env.REDIRECT_URL);
        } else {
            // Handle failure (stay on success page or show error)
            res.send('Payment Pending or Failed. Please check again.');
        }
    } catch (error) {
        console.error('Status Check Error:', error.message);
        res.status(500).send('Error checking payment status');
    }
});

/**
 * Callback/Webhook endpoint (Standard Checkout)
 */
app.post('/callback', (req, res) => {
    try {
        // PhonePe sends base64 encoded response in body.response
        const base64Response = req.body.response;
        if (!base64Response) return res.status(400).send('Missing response');

        const decodedResponse = JSON.parse(Buffer.from(base64Response, 'base64').toString());
        console.log('Webhook Received:', JSON.stringify(decodedResponse, null, 2));

        if (decodedResponse.success && decodedResponse.code === 'PAYMENT_SUCCESS') {
            console.log('Payment Verified for Transaction:', decodedResponse.data.merchantTransactionId);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Callback Error:', error.message);
        res.status(500).send('Error');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
