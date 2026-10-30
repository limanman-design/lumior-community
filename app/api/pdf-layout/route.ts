import {env} from 'cloudflare:workers';
import {createPdfLayoutProxy} from '@/lib/pdf-layout-proxy';
const values=env as unknown as Record<string,string|undefined>;
const proxy=createPdfLayoutProxy(fetch,{port:values.LUMIOR_PDF_LAYOUT_PORT});
export const GET=proxy;
export const POST=proxy;
