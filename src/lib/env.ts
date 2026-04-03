export function hasFeatherlessApiKey(): boolean {
  return Boolean(process.env.FEATHERLESS_API_KEY);
}

export function getFeatherlessApiKey(): string {
  return process.env.FEATHERLESS_API_KEY || "";
}
