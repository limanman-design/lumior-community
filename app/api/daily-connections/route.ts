import { env } from 'cloudflare:workers';
import { aiSettingsFromEnv } from '@/lib/ai-providers';
import { createDailyConnectionsService } from '@/lib/daily-connections-service';
const service=createDailyConnectionsService(()=>aiSettingsFromEnv(env as unknown as Record<string,string|undefined>));
export const GET=(request:Request)=>service.GET(request);
export const POST=(request:Request)=>service.POST(request);
