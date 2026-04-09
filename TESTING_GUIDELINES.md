# How to Test Tool Calling Models on Featherless

## 1. Prerequisites
- `FEATHERLESS_API_KEY` in `.env` or environment
- Access to models (some are gated)
- Project setup: `pnpm install`

## 2. Basic Connectivity Test
First verify the model is deployed and reachable:
```bash
curl -s -X POST "https://api.featherless.ai/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"Hello"}],"max_tokens":20}' | head -50
```
- 200 OK with response → model exists
- 500/404 → not deployed or no access

## 3. Tool Calling Format Detection

Test with a simple tool call request:
```bash
curl -s -X POST "https://api.featherless.ai/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID",
    "messages": [{"role":"user","content":"Run: echo hello"}],
    "tools": [{"type":"function","function":{"name":"bash","description":"Run bash","parameters":{"type":"object","properties":{"command":{"type":"string"}}},"required":["command"]}}],
    "max_tokens": 150,
    "temperature": 0.7
  }' | python3 -c "import json,sys; d=json.load(sys.stdin); msg=d['choices'][0]['message']; print('tool_calls:', msg.get('tool_calls')); print('content:', msg.get('content','')[:200])"
```

**Check response:**
- `tool_calls` array present → native format ✅
- Content contains `<function>` → add to `MODELS_NEED_TOOL_CALL_PARSING`
- Content contains `