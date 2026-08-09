/**
 * Patch vendored JSSpeccy build:
 * - expose pause/start/reset on the public API
 * - add getSnapshot / pokeMemory / peekMemory worker messages
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

function ensureMachineTypeTracking(src) {
  let out = src;
  if (!out.includes('mType=48') && !out.includes(',mType=48;')) {
    const decl = 'let o=null,l=null,c=null,h=null,u=null,d=null,g=!1,p=null,k=!1;';
    if (!out.includes(decl)) throw new Error('jsspeccy-worker.js: decl not found');
    out = out.replace(decl, 'let o=null,l=null,c=null,h=null,u=null,d=null,g=!1,p=null,k=!1,mType=48;');
  }

  const setMachineCase = 'case"setMachineType":o.setMachineType(e.data.type);break;';
  if (out.includes(setMachineCase)) {
    out = out.replace(
      setMachineCase,
      'case"setMachineType":mType=e.data.type,o.setMachineType(e.data.type);break;'
    );
  }

  const loadSnap = 'loadSnapshot":(e=>{o.setMachineType(e.model);';
  if (out.includes(loadSnap)) {
    out = out.replace(loadSnap, 'loadSnapshot":(e=>{mType=e.model,o.setMachineType(e.model);');
  }
  return out;
}

function patchWorker(src) {
  let out = ensureMachineTypeTracking(src);

  const insertBefore = 'case"setTapeTraps":o.setTapeTraps(e.data.value);break;';
  if (!out.includes(insertBefore)) {
    throw new Error('jsspeccy-worker.js: setTapeTraps case not found');
  }

  if (!out.includes('case"getSnapshot"')) {
    const getSnapshotCase =
      'case"getSnapshot":{const eId=e.data.id,regs=["AF","BC","DE","HL","AF_","BC_","DE_","HL_","IX","IY","SP","IR"],registers={};regs.forEach((n,i)=>{registers[n]=u[i]});registers.PC=o.getPC();registers.iff1=!!o.getIFF1();registers.iff2=!!o.getIFF2();registers.im=o.getIM();const pages=48===mType?[5,2,0]:[0,1,2,3,4,5,6,7],memoryPages={};for(const page of pages){memoryPages[page]=c.slice(o.MACHINE_MEMORY+16384*page,o.MACHINE_MEMORY+16384*page+16384)}const borderColour=o.readPort(254)&7,pagingFlags=48===mType?0:o.readPort(32765)&255;postMessage({message:"snapshot",id:eId,snapshot:{model:mType,registers,ulaState:{borderColour,pagingFlags},memoryPages,tstates:o.getTStates(),halted:!!o.getHalted()}});break;}';
    out = out.replace(insertBefore, getSnapshotCase + insertBefore);
  }

  if (!out.includes('case"pokeMemory"')) {
    // bank bit3 set (8) = ignore bank / use Z80 address map via o.poke
    // otherwise write into absolute RAM page (0-7)
    const pokeCases =
      'case"pokeMemory":{const eId=e.data.id,bank=e.data.bank|0,addr=e.data.address&65535,val=e.data.value&255;const pageOf=a=>{const hi=a>>>14;if(48===mType)return hi===1?5:hi===2?2:hi===3?0:5;if(hi===1)return 5;if(hi===2)return 2;if(hi===3)return o.readPort(32765)&7;return 5};let page,off;if(bank&8){page=pageOf(addr);off=addr&16383}else{page=bank&7;off=addr&16383}const prev=c[o.MACHINE_MEMORY+page*16384+off]&255;if(bank&8)o.poke(addr,val);else c[o.MACHINE_MEMORY+page*16384+off]=val;postMessage({message:"pokeMemoryResult",id:eId,previous:prev});break;}case"peekMemory":{const eId=e.data.id,bank=e.data.bank|0,addr=e.data.address&65535;const pageOf=a=>{const hi=a>>>14;if(48===mType)return hi===1?5:hi===2?2:hi===3?0:5;if(hi===1)return 5;if(hi===2)return 2;if(hi===3)return o.readPort(32765)&7;return 5};let page,off;if(bank&8){page=pageOf(addr);off=addr&16383}else{page=bank&7;off=addr&16383}postMessage({message:"peekMemoryResult",id:eId,value:c[o.MACHINE_MEMORY+page*16384+off]&255});break;}';

    out = out.replace(insertBefore, pokeCases + insertBefore);
  }

  return out;
}

function main() {
  const mainPath = join(vendor, 'jsspeccy.js');
  const workerPath = join(vendor, 'jsspeccy-worker.js');
  writeFileSync(mainPath, patchMain(readFileSync(mainPath, 'utf8')));
  writeFileSync(workerPath, patchWorker(readFileSync(workerPath, 'utf8')));
  console.log('Patched JSSpeccy vendor build (pause/start/reset + getSnapshot + poke/peek)');
}

main();
