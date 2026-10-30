import {spawn} from 'node:child_process';
import {resolve,win32} from 'node:path';

export function pdfLayoutPython(root,platform=process.platform){
 return resolve(root,'.venv-pdf-layout',platform==='win32'?'Scripts/python.exe':'bin/python');
}

export function stopPdfLayoutProcess(child,{platform=process.platform,spawnProcess=spawn}={}){
 if(!child?.pid||child.exitCode!==null)return;
 if(platform==='win32'){
  const command=win32.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
  const killer=spawnProcess(command,['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
  killer.once('error',()=>console.error('原版式服务进程回收失败。'));
  return;
 }
 child.kill('SIGTERM');
}
