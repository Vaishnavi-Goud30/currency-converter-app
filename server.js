require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const API_KEY = process.env.EXCHANGE_RATE_API_KEY;
const API_BASE_URL = 'https://api.exchangerate-api.com/v4/latest';

// Initialize cache (Standard: 600 seconds = 10 minutes)
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// Supported currencies (20+ major global currencies)
const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NZD',
  'MXN', 'SGD', 'HKD', 'NOK', 'KRW', 'TRY', 'RUB', 'INR', 'BRL', 'ZAR',
  'SAR', 'AED', 'THB', 'MYR', 'PHP', 'IDR'
];

// Get current exchange rates
app.get('/api/rates', async (req, res) => {
  try {
    const baseCurrency = (req.query.base || 'USD').toUpperCase();

    // Validate base currency
    if (!SUPPORTED_CURRENCIES.includes(baseCurrency)) {
      return res.status(400).json({
        error: 'Invalid base currency',
        supported: SUPPORTED_CURRENCIES
      });
    }

    // Check cache first
    const cacheKey = `rates_${baseCurrency}`;
    const cachedRates = cache.get(cacheKey);
    
    if (cachedRates) {
      return res.json({
        success: true,
        base: baseCurrency,
        rates: cachedRates,
        cached: true,
        timestamp: new Date()
      });
    }

    // Fetch from API
    const response = await axios.get(`${API_BASE_URL}/${baseCurrency}`, {
      timeout: 5000
    });

    const rates = response.data.rates;

    // Cache the rates
    cache.set(cacheKey, rates);

    res.json({
      success: true,
      base: baseCurrency,
      rates: rates,
      cached: false,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Error fetching rates:', error.message);

    // Try to return cached data if available
    const baseCurrency = (req.query.base || 'USD').toUpperCase();
    const cacheKey = `rates_${baseCurrency}`;
    const cachedRates = cache.get(cacheKey);

    if (cachedRates) {
      return res.json({
        success: true,
        base: baseCurrency,
        rates: cachedRates,
        cached: true,
        offline: true,
        message: 'Offline mode - using cached rates',
        timestamp: new Date()
      });
    }

    res.status(500).json({
      error: 'Failed to fetch exchange rates',
      message: error.message,
      offlineMode: false
    });
  }
});

// Convert amount between currencies
app.post('/api/convert', async (req, res) => {
  try {
    const { from, to, amount } = req.body;

    // Validate input
    if (!from || !to || amount === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: from, to, amount'
      });
    }

    const fromCurrency = from.toUpperCase();
    const toCurrency = to.toUpperCase();
    const convertAmount = parseFloat(amount);

    if (isNaN(convertAmount) || convertAmount < 0) {
      return res.status(400).json({
        error: 'Invalid amount. Must be a positive number.'
      });
    }

    if (!SUPPORTED_CURRENCIES.includes(fromCurrency) || !SUPPORTED_CURRENCIES.includes(toCurrency)) {
      return res.status(400).json({
        error: 'Invalid currency code',
        supported: SUPPORTED_CURRENCIES
      });
    }

    // Check cache
    const cacheKey = `rates_${fromCurrency}`;
    let rates = cache.get(cacheKey);

    // If not cached, fetch from API
    if (!rates) {
      const response = await axios.get(`${API_BASE_URL}/${fromCurrency}`, {
        timeout: 5000
      });
      rates = response.data.rates;
      cache.set(cacheKey, rates);
    }

    const exchangeRate = rates[toCurrency];
    if (!exchangeRate) {
      return res.status(400).json({
        error: 'Exchange rate not available for target currency'
      });
    }

    const convertedAmount = (convertAmount * exchangeRate).toFixed(2);

    res.json({
      success: true,
      from: fromCurrency,
      to: toCurrency,
      amount: convertAmount,
      convertedAmount: parseFloat(convertedAmount),
      exchangeRate: exchangeRate.toFixed(4),
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Conversion error:', error.message);
    res.status(500).json({
      error: 'Conversion failed',
      message: error.message
    });
  }
});

// Get all supported currencies
app.get('/api/currencies', (req, res) => {
  res.json({
    success: true,
    currencies: SUPPORTED_CURRENCIES,
    count: SUPPORTED_CURRENCIES.length
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Serve static React build files
app.use(express.static(path.join(__dirname, 'client/build')));

// Fallback to React app for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.listen(PORT, () => {
  console.log(`✅ Currency Converter Server running on http://localhost:${PORT}`);
  console.log(`📊 Supported currencies: ${SUPPORTED_CURRENCIES.length}`);
});
