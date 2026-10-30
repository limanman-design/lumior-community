import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {pdfLayoutPython,stopPdfLayoutProcess} from '../scripts/pdf-layout-runtime.mjs';

test('layout virtualenv executable follows the platform layout',()=>{
 const root=resolve('isolated development folder');
 assert.equal(pdfLayoutPython(root,'win32'),resolve(root,'.venv-pdf-layout/Scripts/python.exe'));
 for(const platform of ['darwin','linux'])assert.equal(pdfLayoutPython(root,platform),resolve(root,'.venv-pdf-layout/bin/python'));
});

test('Windows layout service shutdown terminates the full tree before the parent',()=>{
 const calls=[],signals=[];
 const child={pid:12345,exitCode:null,kill:signal=>signals.push(signal)};
 stopPdfLayoutProcess(child,{platform:'win32',spawnProcess:(...args)=>{calls.push(args);return new EventEmitter();}});
 assert.match(calls[0][0],/\\System32\\taskkill\.exe$/);
 assert.deepEqual(calls[0][1],['/PID','12345','/T','/F']);
 assert.equal(calls[0][2].windowsHide,true);
 assert.deepEqual(signals,[]);
});

test('Unix layout service shutdown gives Python a chance to clean its child groups',()=>{
 const signals=[],child={pid:12345,exitCode:null,kill:signal=>signals.push(signal)};
 stopPdfLayoutProcess(child,{platform:'darwin'});
 assert.deepEqual(signals,['SIGTERM']);
 child.exitCode=0;
 stopPdfLayoutProcess(child,{platform:'darwin'});
 stopPdfLayoutProcess(undefined,{platform:'darwin'});
 assert.deepEqual(signals,['SIGTERM']);
});
