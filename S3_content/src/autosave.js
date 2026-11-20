/** Command counting is persisted with the run; followers never call this. */
export function recordAutosaveStep(state) {
  state.run ||= {};
  const count=Math.max(0,Number(state.run.autosaveSteps)||0)+1;
  state.run.autosaveSteps=count % 100;
  return count>=100;
}

/** Serialize writes and coalesce queued snapshots; failed writes remain retryable. */
export function createAutosaveCoordinator({canSave,getSnapshot,write,onError=()=>{},onSaved=()=>{}}) {
  let pending=null,running=null;
  async function drain() {
    while(pending) {
      const snapshot=pending;pending=null;
      try {const result=await write(snapshot);onSaved(result);}
      catch(error){if(!pending)pending=snapshot;onError(error);return false;}
    }
    return true;
  }
  return {
    request(reason, snapshot = undefined) {
      if(!canSave())return Promise.resolve(false);
      pending=snapshot===undefined?getSnapshot(reason):snapshot;
      if(!running)running=Promise.resolve().then(drain).finally(()=>{running=null;});
      return running;
    }
  };
}
