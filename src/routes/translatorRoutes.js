const express = require('express');
const rateLimit = require('express-rate-limit');
const { translateText } = require('../controllers/translatorController');

const router = express.Router();

const translationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'طلبات ترجمة كتير في وقت قصير. حاول تاني بعد دقيقة.' },
});

router.post('/translate', translationLimiter, translateText);

module.exports = router;
