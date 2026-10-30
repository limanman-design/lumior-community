import { env } from 'cloudflare:workers';
import { aiSettingsFromEnv } from '@/lib/ai-providers';
import { createAiTrialStatusService } from '@/lib/ai-trial';

export const GET = createAiTrialStatusService(() => aiSettingsFromEnv(env as unknown as Record<string, string | undefined>));
