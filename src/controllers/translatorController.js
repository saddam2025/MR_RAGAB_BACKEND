const MAX_TRANSLATION_CHARS = 500;
const VALID_DIRECTIONS = new Set(['ar-en', 'en-ar']);

const translateText = async (req, res, next) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const direction = req.body?.direction;

  if (!text) return res.status(400).json({ message: 'اكتب كلمة أو جملة للترجمة.' });
  if (text.length > MAX_TRANSLATION_CHARS) {
    return res.status(400).json({ message: `الحد الأقصى للنص ${MAX_TRANSLATION_CHARS} حرفًا.` });
  }
  if (!VALID_DIRECTIONS.has(direction)) {
    return res.status(400).json({ message: 'اتجاه الترجمة غير مدعوم.' });
  }

  try {
    const { translate } = require('../services/translatorService');
    const translation = await translate(text, direction);
    return res.json({ translation });
  } catch (error) {
    if (error.status === 503) return res.status(503).json({ message: error.message });
    return next(error);
  }
};

module.exports = { translateText };
