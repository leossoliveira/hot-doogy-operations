// A save with an unknown outcome retains the exact command, including its ID.
// Definitive rejections allow corrected input; a retry never silently changes it.
export function createSaveAttempt(){
 let pending;
 return {
  get pending(){return pending;},
  async run(build,save){pending??=build();try{const result=await save(pending);pending=null;return result;}catch(error){if(error.rejected||[400,401,403,409,422].includes(error.status))pending=null;throw error;}}
 };
}
