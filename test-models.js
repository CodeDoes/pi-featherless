const API_KEY = process.env.FEATHERLESS_API_KEY;
if (!API_KEY) { console.error('Set FEATHERLESS_API_KEY'); process.exit(1); }
const OpenAI = require('openai');
const client = new OpenAI({ apiKey: API_KEY, baseURL: 'https://api.featherless.ai/v1' });
const MODELS = [ "DreamFast/gemma-3-12b-it-heretic-v2", "Sabomako/gemma-3-12b-it-heretic", "Lightricks/gemma-3-12b-it-qat-q4_0-unquantized", "Trendyol/Trendyol-LLM-Asure-12B", "nvidia/Nemotron-Terminal-14B", "farbodtavakkoli/OTel-LLM-14B-IT", "DavidAU/gemma-3-12b-it-vl-GLM-4.7-Flash-Heretic-Uncensored-Thinking", "DreamFast/gemma-3-12b-it-heretic", "TheDrummer/Rocinante-X-12B-v1", "DavidAU/Mistral-Nemo-2407-12B-Thinking-Claude-Gemini-GPT5.2-Uncensored-HERETIC", "McGill-NLP/AfriqueQwen-14B", "TeichAI/Qwen3-14B-Claude-4.5-Opus-High-Reasoning-Distill", "p-e-w/gemma-3-12b-it-heretic-v2" ];
const TOOLS = [{ type: 'function', function: { name: 'bash', description: 'Execute bash', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }];
async function testModel(modelId) {
  try { await client.chat.completions.create({ model: modelId, messages: [{ role: 'user', content: 'test' }], max_tokens: 10 }); } catch (e) {
    if (e.status === 404 || e.status === 401 || (e.message && (e.message.includes('gated') || e.message.includes('not available')))) return { model: modelId, status: 'unavailable', reason: (e.message || e).toString().slice(0, 80) };
    if (e.message && e.message.includes('completion service')) return { model: modelId, status: 'error', reason: 'service error' };
    return { model: modelId, status: 'error', reason: (e.message || e).toString().slice(0, 80) };
  }
  try {
    const res = await client.chat.completions.create({ model: modelId, messages: [{ role: 'user', content: 'Run: echo hello' }], tools: TOOLS, max_tokens: 150, temperature: 0.7 });
    const msg = res.choices[0].message; const toolCalls = msg.tool_calls;
    if (toolCalls && toolCalls.length > 0) return { model: modelId, status: 'native', tool_count: toolCalls.length };
    const content = msg.content || '';
    if (content.includes('<function>') || content.includes('