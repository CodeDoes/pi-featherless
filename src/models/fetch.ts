#!/usr/bin/env node
/**
 * Tools to sync models from Featherless API
 */

const BASE_URL = "https://api.featherless.ai/v1";

/**
 * Fetch the models JSON from Featherless API.
 */
export async function fetchModelsJson(): Promise<string> {
    const response = await fetch(`${BASE_URL}/models`, {
        credentials: "include",
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Priority": "u=0, i",
            "Pragma": "no-cache",
            "Cache-Control": "no-cache",
        },
        method: "GET",
        mode: "cors",
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return JSON.stringify(data, null, 2) + '\n';
}