import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerTokenizeCommand } from "./command";

export default async function (pi: ExtensionAPI) {
  const storedCredentials = (pi as any).auth?.credentials?.["featherless"];
  if (!storedCredentials) {
    return;
  }

  registerTokenizeCommand(pi, storedCredentials.access);
}