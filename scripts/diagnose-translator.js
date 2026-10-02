const path = require('node:path');

const TESTS = [
  'Problem',
  'Time',
  'Good morning',
  'football',
  'How are you?',
  'I love learning English.',
  'The teacher is in the classroom.',
];

const PREFIXES = ['', '>>ara<< ', '>>arz<< '];
const DTYPES = ['q8', 'fp32'];
const OPTION_SETS = {
  basic: (n) => ({ max_new_tokens: n, num_beams: 4 }),
  noRepeat: (n) => ({ max_new_tokens: n, num_beams: 4, no_repeat_ngram_size: 3 }),
  current: (n) => ({ max_new_tokens: n, num_beams: 4, no_repeat_ngram_size: 3, repetition_penalty: 1.2 }),
};

(async () => {
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR
    ? path.resolve(process.env.TRANSFORMERS_CACHE_DIR)
    : path.resolve(process.cwd(), '.cache', 'transformers');

  for (const dtype of DTYPES) {
    console.log(`\n===== dtype: ${dtype} =====`);
    const translator = await transformers.pipeline('translation', 'Xenova/opus-mt-en-ar', { dtype });

    if (dtype === DTYPES[0]) {
      const ids = translator.tokenizer.encode('>>ara<<');
      console.log('tokens for >>ara<< :', ids, translator.tokenizer.convert_ids_to_tokens(ids));
    }

    for (const text of TESTS) {
      const words = text.split(/\s+/).length;
      const maxTokens = Math.min(96, Math.max(12, words * 8));
      for (const prefix of PREFIXES) {
        for (const [name, build] of Object.entries(OPTION_SETS)) {
          try {
            const out = await translator(prefix + text, build(maxTokens));
            const result = String(out?.[0]?.translation_text || '').slice(0, 120);
            console.log(`[${dtype}] prefix="${prefix.trim()}" opts=${name} | "${text}" => ${result}`);
          } catch (e) {
            console.log(`[${dtype}] prefix="${prefix.trim()}" opts=${name} | "${text}" => ERROR ${e.message}`);
          }
        }
      }
    }
    await translator.dispose?.();
  }
})();