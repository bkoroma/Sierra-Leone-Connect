import { qMatch, score, eligible, openers } from '../js/match.js';
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '');
let ok=0,bad=0; const t=(n,c,x='')=>{ if(c) ok++; else {bad++; console.log('✗',n,x);} };
const A = { kids_want:{m:0,a:[0,3],i:3}, faith_role:{m:0,a:[0,1],i:2}, move_home:{m:1,a:[0,1,2],i:1}, alcohol:{m:0,a:[0],i:3} };
const B = { kids_want:{m:0,a:[0],i:3}, faith_role:{m:1,a:[0,1],i:2}, move_home:{m:1,a:[1],i:2}, alcohol:{m:1,a:[0,1],i:1} };
const r = qMatch(A,B);
// A: possible 50+10+1+50=111, earned kids50 + faith10 + move1 + alcohol(B=1 not in [0]) 0 = 61 -> .5495
// B: possible 50+10+10+1=71, earned kids50 + faith10(A=0 in[0,1]) + move10 + alcohol1 = 71 -> 1
// sqrt(.5495)=.7413 - 1/4 = .4913 -> 49
t('formula', r.pct===49, JSON.stringify(r));
t('n', r.n===4);
t('agree', r.agree.length===2 && r.agree[0].id==='kids_want', JSON.stringify(r.agree));
t('no deal', !r.deal);
t('dealbreaker', qMatch({...A, alcohol:{m:0,a:[0],i:4}}, B).deal);
t('dealbreaker other side', qMatch(A, {...B, kids_want:{m:0,a:[1],i:4}}).deal);
t('symmetric', qMatch(A,B).pct===qMatch(B,A).pct);
t('<3 common → null', qMatch({kids_want:A.kids_want}, B).pct===null);
t('identical high', qMatch(A, Object.fromEntries(Object.entries(A).map(([k,v])=>[k,{...v}]))).pct===75);
t('unknown qid ignored', qMatch({zzz:{m:0,a:[0],i:3},...A}, {zzz:{m:1,a:[1],i:4},...B}).n===4);
const yr=new Date().getFullYear();
const P=o=>({id:Math.random()+'',dob:`${yr-30}-01-01`,gender:'man',intent:'serious',prefs:{seeking:['woman']},...o});
const me=P({answers:A}), her=P({gender:'woman',prefs:{seeking:['man']},answers:B});
t('dealbreaker excludes from deck', !eligible(me, {...her, answers:{...B, kids_want:{m:2,a:[2],i:4}}}));
const s=score(me,her); t('q blended + reason', s.q && s.reasons.some(x=>x.k==='q'), JSON.stringify(s.reasons));
const lo=score(me,{...her,answers:{kids_want:{m:2,a:[2],i:3},faith_role:{m:3,a:[3],i:3},move_home:{m:3,a:[3],i:3},alcohol:{m:2,a:[2],i:3}}});
t('bad answers lower score', lo.score < s.score, lo.score+' vs '+s.score);
t('precomputed q used', score(me,{...her,answers:undefined,q:{pct:99,n:20,agree:[],deal:false}}).score > s.score);
t('opener uses shared answer', openers(me,her)[0].includes('Do you want children?'), openers(me,her)[0]);
console.log(`${ok} passed, ${bad} failed`);
