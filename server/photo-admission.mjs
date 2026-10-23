// Bound the entire thumbnail request, including live authorization queries.
// Saves/login/workspace reads never enter this queue. No authorization is cached.
export function createPhotoAdmission(limit=2,maxQueue=128){
 let active=0;const queue=[];
 function drain(){
  while(active<limit&&queue.length){
   const entry=queue.shift();entry.res.off('close',entry.cancel);
   if(entry.res.destroyed){entry.resolve(null);continue;}
   active++;let released=false;
   entry.resolve(()=>{if(released)return;released=true;active--;drain();});
  }
 }
 return res=>new Promise((resolve,reject)=>{
  if(res.destroyed){resolve(null);return;}
  if(queue.length>=maxQueue){reject(Object.assign(Error('Photos are busy. Try again shortly.'),{status:503}));return;}
  const entry={res,resolve};
  entry.cancel=()=>{const index=queue.indexOf(entry);if(index>=0)queue.splice(index,1);resolve(null);};
  res.once('close',entry.cancel);queue.push(entry);drain();
 });
}
