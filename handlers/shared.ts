export const BASE_URL = "https://api.featherless.ai/v1";
export const PROVIDER = "featherless-ai";

export async function getApiKey(ctx: any): Promise<string | undefined> {
    if (ctx.modelRegistry) {
        const key = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
        if (key) return key;
    }
    return process.env.FEATHERLESS_API_KEY;
}
