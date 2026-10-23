import {fullName,availabilityLines,CAREERS_POSITIONS,CAREERS_HOURS,CAREERS_EXPERIENCE,CAREERS_ENGLISH} from './careers-model.js';

export async function createApplicationPdf(a,{location='—',photoBytes}={}){
 const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 let page,y;
 const clean=value=>Array.from(String(value??'—').normalize('NFC')).map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 const draw=(text,x,size=10,face=font)=>page.drawText(clean(text),{x,y,size,font:face,color:rgb(.16,.2,.14)});
 function newPage(){page=pdf.addPage([612,792]);y=750;draw('HOT DOOGY | Employment application',36,14,bold);y-=30;}
 function line(text,face=font){if(y<52)newPage();draw(text,36,10,face);y-=15;}
 function field(label,value){if(y<82)newPage();line(label,bold);for(const paragraph of clean(value||'—').split('\n')){let text='';for(const char of paragraph){if(font.widthOfTextAtSize(text+char,10)>540){line(text);text='';}text+=char;}line(text);}y-=9;}
 newPage();
 if(photoBytes){const photo=await pdf.embedJpg(photoBytes),scale=Math.min(96/photo.width,96/photo.height);page.drawImage(photo,{x:480,y:y-96,width:photo.width*scale,height:photo.height*scale});y-=110;}
 field('Candidate',fullName(a));field('Reference',a.reference);
 field('Submitted',a.created_at?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(a.created_at)):'—');
 field('Contact',[a.email,a.phone,[a.city,a.state].filter(Boolean).join(', ')].filter(Boolean).join('\n'));
 field('Position',CAREERS_POSITIONS[a.position]||a.position);field('Preferred location',location);
 field('Eligibility',`${a.at_least_16?'16+':'Under 16'} · ${a.work_authorized?'Work authorized':'Not work authorized'}`);
 field('Earliest start',a.earliest_start);field('Hours per week',CAREERS_HOURS[a.hours_per_week]);field('Availability',availabilityLines(a.availability).join('\n'));
 field('Work experience',CAREERS_EXPERIENCE[a.work_experience]);field('English',CAREERS_ENGLISH[a.english_proficiency]);field('Other languages',a.other_languages);
 field('About the candidate',a.pitch);field('Heard about us',a.referral_source);
 pdf.getPages().forEach((p,i)=>p.drawText(`${i+1} / ${pdf.getPageCount()}`,{x:540,y:24,size:8,font}));
 pdf.setTitle(`Employment application - ${fullName(a)}`);return pdf.save();
}
async function photoJpeg(url){
 const response=await fetch(url);if(!response.ok)throw Error('Photo unavailable');
 const image=await createImageBitmap(await response.blob());
 try{const canvas=document.createElement('canvas'),scale=Math.min(1,800/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw Error('Photo conversion failed');return blob.arrayBuffer();}finally{image.close();}
}
export async function downloadApplicationPdf(a,{location,files=[]}={}){
 const photo=files.find(f=>f.application_id===a.id&&f.kind==='selfie'&&f.mime_type.startsWith('image/'));
 const photoBytes=photo?await photoJpeg(`/api/hr/careers/${a.id}/files/${photo.id}?inline=1`):undefined;
 const bytes=await createApplicationPdf(a,{location,photoBytes});
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
 const link=document.createElement('a');link.href=url;link.download=`Hot-Doogy-Application-${String(a.reference||a.id).replace(/[^a-z0-9_-]/gi,'-')}.pdf`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
