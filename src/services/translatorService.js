const path = require('node:path');

const TRANSLATION_MODELS = Object.freeze({
  'ar-en': 'Xenova/opus-mt-ar-en',
  'en-ar': 'Xenova/opus-mt-en-ar',
});

const MAX_PENDING_TRANSLATIONS = 32;
let transformersPromise = null;
let activeDirection = null;
let activePipelinePromise = null;
let requestQueue = Promise.resolve();
let pendingTranslations = 0;

async function getTransformers() {
  if (!transformersPromise) {
    transformersPromise = import('@huggingface/transformers').then((transformers) => {
      transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR
        ? path.resolve(process.env.TRANSFORMERS_CACHE_DIR)
        : path.resolve(process.cwd(), '.cache', 'transformers');
      return transformers;
    }).catch((error) => {
      transformersPromise = null;
      throw error;
    });
  }
  return transformersPromise;
}

async function getPipeline(direction) {
  if (activeDirection === direction && activePipelinePromise) return activePipelinePromise;

  if (activePipelinePromise) {
    const previousPipeline = await activePipelinePromise.catch(() => null);
    try { await previousPipeline?.dispose?.(); } catch { /* Continue even if the old runtime cannot be released. */ }
    activePipelinePromise = null;
    activeDirection = null;
  }

  const { pipeline } = await getTransformers();
  activeDirection = direction;
  activePipelinePromise = pipeline('translation', TRANSLATION_MODELS[direction], { dtype: 'q8' });
  try {
    return await activePipelinePromise;
  } catch (error) {
    activeDirection = null;
    activePipelinePromise = null;
    throw error;
  }
}

function splitIntoSentences(text, maxLength = 250) {
  const sentences = text.split(/(?<=[.!?؟。])\s+/u).filter(Boolean);
  const chunks = [];
  for (const sentence of sentences) {
    for (let start = 0; start < sentence.length; start += maxLength) {
      chunks.push(sentence.slice(start, start + maxLength).trim());
    }
  }
  return chunks.filter(Boolean);
}

function hasRepeatedOutput(text) {
  const tokens = text.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length < 8) return false;

  const seen = new Map();
  for (let size = 1; size <= 3; size += 1) {
    for (let start = 0; start <= tokens.length - size; start += 1) {
      const phrase = tokens.slice(start, start + size).join(' ');
      const count = (seen.get(phrase) || 0) + 1;
      seen.set(phrase, count);
      if (count >= 4) return true;
    }
  }
  return false;
}

function enqueueTranslation(operation) {
  if (pendingTranslations >= MAX_PENDING_TRANSLATIONS) {
    const error = new Error('خدمة الترجمة مشغولة حاليًا. حاول تاني بعد قليل.');
    error.status = 503;
    throw error;
  }

  pendingTranslations += 1;
  const result = requestQueue.then(operation, operation);
  requestQueue = result.catch(() => {});
  return result.finally(() => { pendingTranslations -= 1; });
}

async function translate(text, direction) {
  if (!TRANSLATION_MODELS[direction]) throw new Error('اتجاه الترجمة غير مدعوم.');

  return enqueueTranslation(async () => {
    const translator = await getPipeline(direction);
    const chunks = splitIntoSentences(text);
    const translatedChunks = [];
    for (const chunk of chunks) {
      const sourceWords = chunk.trim().split(/\s+/u).length;
      const prefix = direction === 'en-ar' ? '>>ara<< ' : '';
      const result = await translator(prefix + chunk, {
        max_new_tokens: Math.min(96, Math.max(12, sourceWords * 8)),
        num_beams: 4,
        no_repeat_ngram_size: 3,
      });
      const translated = String(result?.[0]?.translation_text || '').trim();
      // Never return decoder noise (symbols or looping phrases) as a
      // successful translation. Surface an error instead of displaying it.
      if (translated && (!/[\p{L}\p{N}]/u.test(translated) || hasRepeatedOutput(translated))) {
        const error = new Error('محرك الترجمة أعاد نتيجة غير صالحة. حاول مرة أخرى بعد قليل.');
        error.status = 502;
        throw error;
      }
      translatedChunks.push(translated);
    }
    return translatedChunks.join(' ').trim();
  });
}

module.exports = { translate, TRANSLATION_MODELS };
