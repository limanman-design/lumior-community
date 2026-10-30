import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pdfLayoutPort} from '../lib/pdf-layout-port.mjs';
import {pdfLayoutPython,stopPdfLayoutProcess} from './pdf-layout-runtime.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),python=pdfLayoutPython(root);
const port=pdfLayoutPort(process.env.LUMIOR_PDF_LAYOUT_PORT);
let layout;
async function available(){try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)});return response.ok&&(await response.json()).engine==='BabelDOC';}catch{return false;}}
if(!await available()){
 if(existsSync(python)){
  layout=spawn(python,['scripts/pdf-layout-service.py','--python',python,'--cache','.cache-pdf-layout','--work-root','output/pdf/layout-jobs','--port',String(port)],{cwd:root,stdio:'inherit',windowsHide:true});
  layout.on('error',()=>console.error('原版式服务启动失败，仍可使用普通翻译。'));
  for(let attempt=0;attempt<30&&!await available();attempt++){if(layout.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,200));}
  if(!await available())console.error('原版式服务未就绪，仍可使用普通翻译。');
 }else console.info('原版式运行环境未安装，仍可使用普通翻译。安装说明见 docs/PDF-LAYOUT-INTEGRATION.md。');
}
const web=spawn(process.execPath,['node_modules/vinext/dist/cli.js','dev',...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
const stop=()=>{if(web.exitCode===null)web.kill('SIGTERM');stopPdfLayoutProcess(layout);};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
web.once('error',()=>{stop();process.exitCode=1;});
web.once('exit',(code)=>{stopPdfLayoutProcess(layout);process.exitCode=code??0;});
