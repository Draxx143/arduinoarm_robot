const fs=require("fs");
// هسته‌ی FW/Kin از فایل واقعی GUI
const core=new Function(fs.readFileSync("gui/js/firmware.js","utf8")+"\nreturn {FW,Kin};")();
const {FW,Kin}=core;
// توابع goto عیناً از app.js بیرون کشیده می‌شوند (بدون کپی دستی)
const src=fs.readFileSync("gui/js/app.js","utf8");
const names=["gotoGeom","gotoMinReach","gotoCheck","gotoNearest"];
const fns=names.map(n=>{
  const i=src.indexOf("function "+n+"(");
  if(i<0) throw new Error("تابع "+n+" پیدا نشد");
  let d=0,j=src.indexOf("{",i);
  for(let k=j;k<src.length;k++){ if(src[k]==="{")d++; else if(src[k]==="}"){d--; if(!d){return src.slice(i,k+1);} } }
}).join("\n");
const $=id=>({value:"0"}), toast=()=>{};
const goto=new Function("FW","Kin","$","toast",fns+"\nreturn {gotoGeom,gotoMinReach,gotoCheck,gotoNearest};")(FW,Kin,$,toast);
const g=goto.gotoGeom(), lo=Math.max(g.min,goto.gotoMinReach());
console.log(`L1=${g.L1} ساعد مؤثر=${g.L2e} بیشترین امتداد=${g.max} حداقل مفید=${lo.toFixed(1)}`);
console.log(`محدوده‌ی J3 = 0..${FW.AXES[2].max}°   J5 zeroOffset=${FW.AXES[4].zeroOffsetDeg}°\n`);
const pts=[[230,0,60],[210,0,30],[245,20,10],[150,0,80],[60,0,20],[250,0,0],[260,0,0]];
let fails=0;
for(const [x,y,z] of pts){
  const r=goto.gotoCheck({x,y,z});
  const ang=r.ang?r.ang.map(d=>d.toFixed(1)).join(","):"-";
  console.log(`  (${x},${y},${z}) L=${r.L.toFixed(0)} -> ${r.ok?"✔ OK":"✖ "+r.why}  [${ang}]`);
  if(r.ang&&r.ang.some(v=>!isFinite(v))){console.log("    !! nan/inf پیدا شد");fails++;}
  if(r.ok){ // باید با fk برگردد
    const p=Kin.fk(r.ang);
    const err=Math.hypot(p.x-x,p.y-y,p.z-z);
    console.log(`    fk round-trip خطا = ${err.toFixed(2)} mm`);
    if(err>1.0){console.log("    !! رفت‌وبرگشت IK/FK یکی نیست");fails++;}
  }
}
// «نزدیک‌ترین نقطه» باید هدفِ غیرممکن را قابل‌دسترس کند
for(const [x,y,z] of [[150,0,80],[60,0,20],[300,0,0]]){
  const n=goto.gotoNearest({x,y,z});
  const r=goto.gotoCheck(n);
  console.log(`  نزدیک‌ترین برای (${x},${y},${z}) -> (${n.x.toFixed(1)},${n.y.toFixed(1)},${n.z.toFixed(1)})  ${r.ok?"✔":"✖ "+r.why}`);
  if(!r.ok) fails++;
}
console.log(fails?`\n${fails} خطا`:"\nهمه‌ی بررسی‌ها پاس ✓");
process.exit(fails?1:0);
