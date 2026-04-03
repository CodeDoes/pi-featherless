import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hasFeatherlessApiKey } from "../../lib/env";
import { registerQuotasCommand } from "./command";
import { registerSubIntegration } from "./sub-integration";

export default async function (pi: ExtensionAPI) {
  if (!hasFeatherlessApiKey()) {
    return;
  }

  registerQuotasCommand(pi);
  registerSubIntegration(pi);
}
