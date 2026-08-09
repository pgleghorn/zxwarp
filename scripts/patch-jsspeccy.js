/**
 * Patch vendored JSSpeccy build:
 * - expose pause/start/reset on the public API
 * - add getSnapshot message to the worker (for browser save slots)
 * - remap keys: Alt=Symbol Shift, Tab=Extended, Home=Edit (Caps+1)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendor = join(__dirname, '..', 'vendor', 'jsspeccy');

function patchMain(src) {
  let out = src;
  const needle =
    'loadSnapshotFromStruct:e=>{a.loadSnapshot(e)},onReady:e=>{a.isReady?e():a.onReadyHandlers.push(e)},exit:()=>{a.exit(),l.unload()}';
  const replacement =
    'loadSnapshotFromStruct:e=>{a.loadSnapshot(e)},pause:()=>{a.pause()},start:()=>{a.start()},reset:()=>{a.reset()},onReady:e=>{a.isReady?e():a.onReadyHandlers.push(e)},exit:()=>{a.exit(),l.unload()}';
  if (out.includes(needle)) {
    out = out.replace(needle, replacement);
  } else if (!out.includes('pause:()=>{a.pause()}')) {
    throw new Error('jsspeccy.js: public API patch point not found');
  }

  // Shift(16)=Caps already; keep Ctrl(17)=Symbol; add Alt(18)=Symbol, Tab(9)=Ext, Home(36)=Edit
  const keyNeedle = '17:Br.SYMBOL_SHIFT,32:Br.BREAK_SPACE,8:Ir(Br.ZERO)';
  const keyReplacement =
    '17:Br.SYMBOL_SHIFT,18:Br.SYMBOL_SHIFT,9:{row:0,mask:0,caps:!0,sym:!0},36:Ir(Br.ONE),32:Br.BREAK_SPACE,8:Ir(Br.ZERO)';
  if (out.includes(keyNeedle)) {
    out = out.replace(keyNeedle, keyReplacement);
  } else if (!out.includes('18:Br.SYMBOL_SHIFT')) {
    throw new Error('jsspeccy.js: keyboard map patch point not found');
  }

  return out;
}

function patchWorker(src) {
  if (src.includes('case"getSnapshot"')) return src;

  // Track machine type whenever it changes
  const setMachineCase = 'case"setMachineType":o.setMachineType(e.data.type);break;';
  if (!src.includes(setMachineCase)) {
    throw new Error('jsspeccy-worker.js: setMachineType case not found');
  }
  let out = src.replace(
    'let o=null,l=null,c=null,h=null,u=null,d=null,g=!1,p=null,k=!1;',
    'let o=null,l=null,c=null,h=null,u=null,d=null,g=!1,p=null,k=!1,mType=48;'
  );
  out = out.replace(
    setMachineCase,
    'case"setMachineType":mType=e.data.type,o.setMachineType(e.data.type);break;'
  );

  // Keep mType in sync when loading snapshots
  out = out.replace(
    'loadSnapshot":(e=>{o.setMachineType(e.model);',
    'loadSnapshot":(e=>{mType=e.model,o.setMachineType(e.model);'
  );

  const insertBefore = 'case"setTapeTraps":o.setTapeTraps(e.data.value);break;';
  if (!out.includes(insertBefore)) {
    throw new Error('jsspeccy-worker.js: setTapeTraps case not found');
  }

  const getSnapshotCase =
    'case"getSnapshot":{const eId=e.data.id,regs=["AF","BC","DE","HL","AF_","BC_","DE_","HL_","IX","IY","SP","IR"],registers={};regs.forEach((n,i)=>{registers[n]=u[i]});registers.PC=o.getPC();registers.iff1=!!o.getIFF1();registers.iff2=!!o.getIFF2();registers.im=o.getIM();const pages=48===mType?[5,2,0]:[0,1,2,3,4,5,6,7],memoryPages={};for(const page of pages){memoryPages[page]=c.slice(o.MACHINE_MEMORY+16384*page,o.MACHINE_MEMORY+16384*page+16384)}const borderColour=o.readPort(254)&7,pagingFlags=48===mType?0:o.readPort(32765)&255;postMessage({message:"snapshot",id:eId,snapshot:{model:mType,registers,ulaState:{borderColour,pagingFlags},memoryPages,tstates:o.getTStates(),halted:!!o.getHalted()}});break;}';

  out = out.replace(insertBefore, getSnapshotCase + insertBefore);
  return out;
}

function main() {
  const mainPath = join(vendor, 'jsspeccy.js');
  const workerPath = join(vendor, 'jsspeccy-worker.js');
  writeFileSync(mainPath, patchMain(readFileSync(mainPath, 'utf8')));
  writeFileSync(workerPath, patchWorker(readFileSync(workerPath, 'utf8')));
  console.log('Patched JSSpeccy vendor build (pause/start/reset + getSnapshot)');
}

main();
