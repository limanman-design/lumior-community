export type InspirationFrequency='daily'|'weekly'|'monthly'|'manual';
export function inspirationPeriod(f:InspirationFrequency,now=new Date()){
 if(f==='manual')return 'manual';
 const d=new Date(now);if(d.getHours()<8)d.setDate(d.getDate()-1);
 if(f==='weekly')d.setDate(d.getDate()-(d.getDay()+6)%7);
 if(f==='monthly')d.setDate(1);
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
