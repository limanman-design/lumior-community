import { env } from "cloudflare:workers";
import { createAiService } from "@/lib/ai-service";
import { aiSettingsFromEnv } from "@/lib/ai-providers";

const service = createAiService(() => {
  const values = env as unknown as Record<string, string | undefined>;
  return aiSettingsFromEnv(values);
});

export const GET = service.GET;
export const POST = service.POST;
