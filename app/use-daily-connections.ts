'use client';
import { useEffect, useRef, useState } from 'react';
import { readConnections, type ConnectionInput, type DailyConnection } from './daily-connections';
import { desktopAiSettingsChangedEvent } from './desktop-bridge';
const consentKey='lumior-daily-connections-consent-v1';
const preference='lumior-daily-connections-enabled-v1',cacheKey='lumior-daily-connections-cache-v1';
type Cache={scope:string;at:number;connections?:DailyConnection[]};
export function useDailyConnections(input:ConnectionInput,visible:boolean,paused:boolean) {
  const [enabled,setEnabled]=useState(false);
  const [intro,setIntro]=useState(false);
  const consent=useRef(false);
  const [access,setAccess]=useState('');
  const [revision,setRevision]=useState(0);
  const [working,setWorking]=useState(false);
  const [failed,setFailed]=useState(false);
  const [result,setResult]=useState<{scope:string;connections:DailyConnection[]}>();
  const cache=useRef<Cache | undefined>(undefined);
  const serialized=JSON.stringify(input),scope=access+'\n'+serialized;
  useEffect(()=>{
    const timer=setTimeout(()=>{try{
      const wasEnabled=localStorage.getItem(preference)==='true';
      consent.current=wasEnabled||localStorage.getItem(consentKey)==='true';
      setEnabled(wasEnabled);
      if(consent.current)localStorage.setItem(consentKey,'true');
      const stored=JSON.parse(localStorage.getItem(cacheKey)||'null') as Cache|null;
      if(stored && typeof stored.scope==='string' && Number.isFinite(stored.at) && stored.at<=Date.now())cache.current=stored;
    }catch{/* Optional local cache. */}},0);
    return()=>clearTimeout(timer);
  },[]);
  useEffect(()=>{
    if(!visible)return;
    let controller:AbortController|undefined;
    const check=()=>{
      controller?.abort();controller=new AbortController();const current=controller;
      setAccess('');
      void fetch('/api/daily-connections',{signal:current.signal}).then(async response=>{
        const data=await response.json() as {configured?:boolean;provider?:string;model?:string};if(!current.signal.aborted)setAccess(response.ok&&data.configured===true?`${data.provider}:${data.model}`:'');
      }).catch(()=>{if(!current.signal.aborted)setAccess('');});
    };
    check();window.addEventListener(desktopAiSettingsChangedEvent,check);
    return()=>{controller?.abort();window.removeEventListener(desktopAiSettingsChangedEvent,check);};
  },[visible]);
  useEffect(()=>{
    if(!visible||!enabled||!access||paused)return;
    const input=JSON.parse(serialized) as ConnectionInput;
    if(!input.captures.length||!input.boards.length)return;
    const previous=cache.current;
    if(previous?.scope===scope){
      try{setResult({scope,connections:readConnections(previous.connections,input)});setFailed(false);}catch{setFailed(true);}
      return;
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      // Remember the attempt before calling; errors and cancellation never auto-retry.
      const attempt:Cache={scope,at:Date.now()};cache.current=attempt;
      const save=()=>{try{localStorage.setItem(cacheKey,JSON.stringify(attempt));}catch{/* In-memory deduplication remains. */}};
      save();setWorking(true);setFailed(false);
      void fetch('/api/daily-connections',{method:'POST',headers:{'Content-Type':'application/json'},body:serialized,signal:controller.signal}).then(async response=>{
        if(!response.ok)throw new Error('Unavailable');
        const data=await response.json() as {connections?:unknown};const connections=readConnections(data.connections,input);
        if(controller.signal.aborted)return;
        attempt.connections=connections;save();setResult({scope,connections});
      }).catch(()=>{if(!controller.signal.aborted)setFailed(true);}).finally(()=>{if(!controller.signal.aborted)setWorking(false);});
    },Math.max(8000,60000-(Date.now()-(previous?.at||0))));
    return()=>{clearTimeout(timer);controller.abort();setWorking(false);};
  },[visible,enabled,access,paused,serialized,scope,revision]);
  const changeEnabled=(next:boolean)=>{setEnabled(next);try{localStorage.setItem(preference,String(next));}catch{/* Session preference still works. */}};
  const toggle=()=>{if(!enabled&&!consent.current){setIntro(true);return;}changeEnabled(!enabled);};
  const confirm=()=>{if(!access)return;consent.current=true;try{localStorage.setItem(consentKey,'true');}catch{/* Session consent remains. */}setIntro(false);changeEnabled(true);};
  const closeIntro=()=>setIntro(false);
  const retry=()=>{cache.current=undefined;setFailed(false);setRevision(value=>value+1);};
  return {configured:!!access,enabled,toggle,intro,confirm,closeIntro,retry,working,failed,connections:enabled&&access&&result?.scope===scope?result.connections:[]};
}
