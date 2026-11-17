import {env} from 'cloudflare:workers';
import {createPdfTranslationService,sharedTranslationRegistry} from '@/lib/pdf-translation-service';
import {aiSettingsFromEnv} from '@/lib/ai-providers';
export const POST=createPdfTranslationService(()=>{
 const values=env as unknown as Record<string,string|undefined>;
 return aiSettingsFromEnv(values);
},fetch,sharedTranslationRegistry(),()=> (env as unknown as Record<string,string|undefined>).LUMIOR_LOCAL_TRANSLATION_CONFIG);
