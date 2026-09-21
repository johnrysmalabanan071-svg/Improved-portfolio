export const options = {
 projectType:['Lead response','Operations','AI assistant','Not sure yet'],
 role:['Business owner','Agency / consultant','Team member','Recruiter / hiring manager','Other'],
 frequency:['Every day','Several times a week','Weekly / monthly','New process'],
 budget:['Under $500','$500–$1,500','$1,500–$5,000','$5,000+','Need guidance'],
 timeline:['As soon as possible','Within a month','In 1–3 months','Just exploring']
};
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export function validate(input) {
 if(!input || typeof input!=='object' || Array.isArray(input))throw new HttpError(400,'Please send a valid project brief.');
 const clean={};
 for(const [key,min,max] of [['name',2,100],['email',3,254],['company',0,150],['challenge',20,2000],['tools',0,300]]){
  const value=input[key]??'';
  if(typeof value!=='string')throw new HttpError(400,`Please check the ${key} field.`);
  clean[key]=value.trim();
  if(clean[key].length<min||clean[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw new HttpError(400,`Please check the ${key} field.`);
 }
 clean.email=clean.email.toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email))throw new HttpError(400,'Please enter a valid email address.');
 for(const [field,allowed] of Object.entries(options)){if(!allowed.includes(input[field]))throw new HttpError(400,`Please choose a valid ${field}.`);clean[field]=input[field];}
 if(input.consent!==true)throw new HttpError(400,'Please agree to the use of your details for this inquiry.');
 if(typeof input.submissionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.submissionId))throw new HttpError(400,'Please refresh the page and try again.');
 clean.consent=true;clean.submissionId=input.submissionId.toLowerCase();
 return clean;
}
export function qualify(lead) {
 // Readiness helps organize follow-up. It never rejects a valid inquiry.
 let score=0;const reasons=[];
 if(lead.projectType!=='Not sure yet'){score+=30;reasons.push('Defined project area');}
 if(['Every day','Several times a week'].includes(lead.frequency)){score+=20;reasons.push('Recurring process');}
 if(['$1,500–$5,000','$5,000+'].includes(lead.budget)){score+=25;reasons.push('Implementation budget indicated');}
 if(['As soon as possible','Within a month'].includes(lead.timeline)){score+=25;reasons.push('Active timeline');}
 return {score,route:lead.role==='Recruiter / hiring manager'?'Career inquiry':score>=70?'Project discovery':'Scoping conversation',reason:reasons.join('; ')||'Needs discovery to define scope'};
}
