import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerQuotasCommand } from "./command";
import { registerSubIntegration } from "./sub-integration";

export default async function (pi: ExtensionAPI) {
  const storedCredentials = (pi as any).auth?.credentials?.["featherless"];
  if (!storedCredentials) {
    return;
  }

  registerQuotasCommand(pi);
  registerSubIntegration(pi, storedCredentials.access);
}
