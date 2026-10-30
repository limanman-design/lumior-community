import { env } from 'cloudflare:workers';
import { aiSettingsFromEnv } from '@/lib/ai-providers';
import { createThesisService } from '@/lib/thesis/service';
const service = createThesisService(() => aiSettingsFromEnv(env as unknown as Record<string, string | undefined>));
export const GET = service.GET;
export const POST = service.POST;
