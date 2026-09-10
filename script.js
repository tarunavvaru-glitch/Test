(() => {
"use strict";

// ===== DOM / Canvas =====
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const area = document.getElementById("gameArea");
const $ = id => document.getElementById(id);
const scoreEl=$("score"), highEl=$("highScore"), levelEl=$("level"), healthEl=$("healthBar"), healthText=$("healthText");
const threatEl=$("threat"), powerStatus=$("powerStatus");
const startScreen=$("startScreen"), pauseScreen=$("pauseScreen"), gameOverScreen=$("gameOverScreen");
const pauseBtn=$("pauseBtn");

let W=900,H=650,dpr=1,last=0,raf=0;
let state="menu",score=0,high=Number(localStorage.getItem("neonVoidHighScore")||0),level=1;
let spawnTimer=0,shootTimer=0,difficultyTimer=0,shake=0;
let keys={left:false,right:false,fire:false};
let bullets=[],enemies=[],particles=[],powerups=[],stars=[];
let audioCtx=null;

// ===== Audio: Web Audio API, no external files =====
function audio(){
  if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==="suspended") audioCtx.resume();
}
function tone(freq,dur,type="sine",vol=.035,slide=0){
  try{audio();const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(40,freq+slide),audioCtx.currentTime+dur);
    g.gain.setValueAtTime(vol,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);
    o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur);
  }catch(e){}
}
const sounds={
 shoot:()=>tone(560,.07,"square",.025,-260),
 hit:()=>tone(110,.11,"sawtooth",.035,120),
 power:()=>{tone(420,.1,"triangle",.04,300);setTimeout(()=>tone(720,.14,"triangle",.035,-100),60)},
 over:()=>{tone(280,.18,"sawtooth",.05,-170);setTimeout(()=>tone(120,.4,"sawtooth",.04,-60),130)}
};

// ===== Responsive canvas =====
function resize(){
  const r=area.getBoundingClientRect(); W=r.width;H=r.height;dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  if(player){player.y=H-62;player.x=Math.min(player.x,W-28)}
  stars=Array.from({length:Math.max(90,Math.floor(W*H/6000))},()=>({x:Math.random()*W,y:Math.random()*H,s:Math.random()*1.8+.2,v:Math.random()*20+8,a:Math.random()*.7+.15}));
}
addEventListener("resize",resize);

// ===== Entities =====
const player={x:450,y:580,w:32,h:42,speed:390,health:100,maxHealth:100,shield:0,rapid:0,double:0,inv:0,tilt:0,tiltTarget:0};
player.laser=0;

const weapons={
  rocket:{ammo:3,maxAmmo:3,reload:0,reloadTime:3200,cooldown:0,gap:700},
  cannon:{ammo:12,maxAmmo:12,reload:0,reloadTime:700,cooldown:0,gap:75}
};

function reset(){
  score=0;level=1;spawnTimer=0;shootTimer=0;difficultyTimer=0;shake=0;
  bullets=[];enemies=[];particles=[];powerups=[];player.x=W/2;player.y=H-62;player.health=100;player.shield=0;player.rapid=0;player.double=0;player.inv=0;player.laser=0;player.tilt=0;player.tiltTarget=0;
  for(const w of Object.values(weapons)){w.ammo=w.maxAmmo;w.reload=0;w.cooldown=0;}
  updateHud();
}
function addScore(n){
  score+=n*(player.double>0?2:1);
  const nl=1+Math.floor(score/700);
  if(nl>level){level=nl; burst(W/2,70,"#38f5ff",24);tone(180,.18,"square",.04,260)}
  updateHud();
}

function updateWeaponHud(){
  const r=$("rocketAmmo"),c=$("cannonAmmo"),rr=$("rocketReload"),cr=$("cannonReload"),ls=$("laserStatus");
  if(!r||!c)return;
  if(ls)ls.textContent=player.laser>0?"ACTIVE "+player.laser.toFixed(1)+"s":"OFF";
  r.textContent=weapons.rocket.ammo+"/"+weapons.rocket.maxAmmo;
  c.textContent=weapons.cannon.ammo+"/"+weapons.cannon.maxAmmo;
  rr.textContent=weapons.rocket.ammo<weapons.rocket.maxAmmo?"RECHARGING "+Math.ceil(weapons.rocket.reload/1000)+"s":"READY";
  cr.textContent=weapons.cannon.ammo<weapons.cannon.maxAmmo?"RECHARGING "+Math.ceil(weapons.cannon.reload/1000)+"s":"READY";
}

function updateHud(){
  scoreEl.textContent=String(score).padStart(6,"0");
  highEl.textContent=String(Math.max(high,score)).padStart(6,"0");
  levelEl.textContent=String(level).padStart(2,"0");threatEl.textContent=String(level).padStart(2,"0");
  const hp=Math.max(0,player.health);healthEl.style.width=hp+"%";healthText.textContent=Math.ceil(hp)+"%";
  powerStatus.innerHTML="";
  updateWeaponHud();
  [["SHIELD",player.shield],["RAPID FIRE",player.rapid],["DOUBLE SCORE",player.double]].forEach(([name,t])=>{
    if(t>0){const e=document.createElement("span");e.className="power-chip";e.textContent=name+" "+Math.ceil(t/1000)+"s";e.style.color=name==="SHIELD"?"#38f5ff":name==="RAPID FIRE"?"#ff3cac":"#a8ff60";powerStatus.appendChild(e)}
  });
}

// Enemy archetypes: scout, bruiser, splitter
const types=[
  {name:"scout",r:15,hp:1,speed:100,score:70,color:"#ff3cac",shoot:false},
  {name:"bruiser",r:22,hp:3,speed:62,score:150,color:"#8a5cff",shoot:true},
  {name:"splitter",r:18,hp:2,speed:82,score:110,color:"#ff9f43",shoot:true}
];
function spawnEnemy(){
  const roll=Math.random();
  const base=roll<.58?types[0]:roll<.83?types[2]:types[1];
  const e={...base,x:30+Math.random()*(W-60),y:-35-Math.random()*40,hp:base.hp+Math.floor(level/7),maxHp:base.hp+Math.floor(level/7),maxHp:base.hp+Math.floor(level/7),r:base.r,speed:base.speed*(1+level*.065),phase:Math.random()*7,rot:Math.random()*6.28};
  enemies.push(e);
}

function updateWeapons(dt){
  const ms=dt*1000;
  for(const w of Object.values(weapons)){
    w.cooldown=Math.max(0,w.cooldown-ms);
    if(w.ammo<w.maxAmmo){
      if(w.reload<=0)w.reload=w.reloadTime;
      w.reload-=ms;
      if(w.reload<=0){
        w.ammo++;
        if(w.ammo<w.maxAmmo)w.reload=w.reloadTime;
        else w.reload=0;
      }
    }else w.reload=0;
  }
}
function fireRocket(){
  if(state!=="playing")return;
  const w=weapons.rocket;
  if(w.ammo<=0||w.cooldown>0)return;
  w.ammo--;w.cooldown=w.gap;
  bullets.push({x:player.x,y:player.y-28,vx:0,vy:-390,r:8,damage:0,enemy:false,type:"rocket"});
  sounds.power();
}
function fireCannon(){
  if(state!=="playing")return;
  const w=weapons.cannon;
  if(w.ammo<=0||w.cooldown>0)return;
  w.ammo--;w.cooldown=w.gap;
  bullets.push({x:player.x,y:player.y-27,vx:0,vy:-560,r:6,damage:0,enemy:false,type:"cannon"});
  sounds.shoot();
}

function shoot(){
  if(state!=="playing")return;
  const cd=player.rapid>0?95:240;
  if(shootTimer>0)return;
  shootTimer=cd;
  // Player bullets travel UP the screen (negative Y velocity).
  bullets.push({
    x: player.x,
    y: player.y - player.h / 2 - 6,
    vx: 0,
    vy: -720,
    r: 4,
    damage: 1,
    enemy: false
  });
  sounds.shoot();
}
function enemyShoot(e){
  // Enemy bullets travel DOWN the screen (positive Y velocity).
  bullets.push({
    enemy: true,
    x: e.x,
    y: e.y + e.r + 5,
    vx: 0,
    vy: 180 + level * 6,
    r: 5,
    damage: 12
  });
}

// ===== FX =====
function burst(x,y,color,count=14){
  for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=Math.random()*150+40;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:Math.random()*.45+.3,max:.8,r:Math.random()*3+1,color});
  }
}
function powerDrop(e){
  if(Math.random()<.12){const kinds=["rapid","shield","double"];const type=kinds[Math.floor(Math.random()*kinds.length)];
    powerups.push({x:e.x,y:e.y,r:11,type,vy:75+level*2,spin:0});
  }
}

// ===== Collision =====
function hit(a,b){const dx=a.x-b.x,dy=a.y-b.y,rr=(a.r||8)+(b.r||8);return dx*dx+dy*dy<rr*rr}
function damage(amount){
  if(player.inv>0)return;
  if(player.shield>0){player.shield=Math.max(0,player.shield-amount*70);burst(player.x,player.y,"#38f5ff",5);return}
  player.health=Math.max(0,player.health-amount);player.inv=500;shake=8;sounds.hit();updateHud();
  if(player.health<=0) endGame();
}
function killEnemy(i){
  const e=enemies[i];addScore(e.score);burst(e.x,e.y,e.color,18);sounds.hit();powerDrop(e);
  if(e.name==="splitter"&&level>=3){
    for(let k=0;k<2;k++)enemies.push({name:"scout",r:9,hp:1,maxHp:1,x:e.x+(k?10:-10),y:e.y,speed:e.speed*1.5,score:30,color:"#ffcf4a",phase:0,rot:0});
  }
  enemies.splice(i,1);
}

// ===== Game update =====

function laserHits(){
  if(player.laser<=0)return;
  // A continuous energy beam centered on the ship instantly destroys enemies it touches.
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(Math.abs(e.x-player.x)<e.r+8 && e.y<player.y+8){
      burst(e.x,e.y,"#ffec55",18);
      killEnemy(i);
    }
  }
}

function update(dt){
  if(state!=="playing")return;
  const ms=dt*1000;
  updateWeapons(dt);
  player.laser=Math.max(0,player.laser-dt);
  player.inv=Math.max(0,player.inv-ms);player.shield=Math.max(0,player.shield-ms);player.rapid=Math.max(0,player.rapid-ms);player.double=Math.max(0,player.double-ms);
  shootTimer=Math.max(0,shootTimer-ms);
  if(keys.left)player.x-=player.speed*dt;if(keys.right)player.x+=player.speed*dt;
  player.x=Math.max(25,Math.min(W-25,player.x));
  player.tiltTarget=keys.left?-0.24:keys.right?0.24:0;
  player.tilt+=(player.tiltTarget-player.tilt)*Math.min(1,dt*11);
  laserHits();
  if(keys.fire)shoot();

  spawnTimer-=ms;
  const interval=Math.max(230,900-level*45);
  if(spawnTimer<=0){spawnEnemy();spawnTimer=interval*(.75+Math.random()*.5)}
  difficultyTimer+=ms;

  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];
    b.x += (b.vx || 0) * dt;
    b.y += b.vy * dt;
    if(b.y<-30||b.y>H+30){bullets.splice(i,1);continue}
    if(!b.enemy){
      let removed=false;
      for(let j=enemies.length-1;j>=0;j--){if(hit(b,enemies[j])){
          const e=enemies[j];
          const dmg=b.type==="rocket"?Math.max(1,Math.ceil(e.maxHp*0.5)):b.type==="cannon"?Math.max(1,Math.ceil(e.maxHp*0.18)):b.damage;
          e.hp-=dmg;
          burst(b.x,b.y,b.type==="rocket"?"#ff9f43":e.color,b.type==="rocket"?15:5);
          if(b.type==="rocket"){
            // Rocket blast also lightly damages nearby enemies.
            for(let k=enemies.length-1;k>=0;k--){
              if(k===j)continue;
              const n=enemies[k],dx=n.x-b.x,dy=n.y-b.y;
              if(dx*dx+dy*dy<44*44){n.hp-=Math.max(1,Math.ceil(n.maxHp*0.16));if(n.hp<=0)killEnemy(k);}
            }
          }
          bullets.splice(i,1);removed=true;
          if(e.hp<=0)killEnemy(j);
          break
        }}
      if(removed)continue;
    }else if(hit(b,player)){bullets.splice(i,1);damage(b.damage)}
  }
  for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];e.y+=e.speed*dt;e.phase+=dt*3;e.rot+=dt;
    if(e.shoot){
      const bulletSpeed=105+level*4;
      if(e.shoot===2){
        bullets.push({x:e.x-e.r*.48,y:e.y+e.r,vx:-32,vy:bulletSpeed,r:5,r:3.5,damage:e.name==="gunship"?15:10,enemy:true,type:"enemy",life:1.35});
        bullets.push({x:e.x+e.r*.48,y:e.y+e.r,vx:32,vy:bulletSpeed,r:5,damage:e.name==="gunship"?15:10,enemy:true,type:"enemy"});
      }else{
        bullets.push({x:e.x,y:e.y+e.r,vx:0,vy:bulletSpeed,r:5,r:3.5,damage:e.name==="bruiser"?16:11,enemy:true,type:"enemy",life:1.35});
      }
    }
    if(hit(e,player)){enemies.splice(i,1);burst(e.x,e.y,e.color,16);damage(25)}
  }
  for(let i=powerups.length-1;i>=0;i--){const p=powerups[i];p.y+=p.vy*dt;p.spin+=dt*4;
    if(p.y>H+30){powerups.splice(i,1);continue}
    if(hit(p,player)){if(p.type==="rapid")player.rapid=9000;if(p.type==="shield")player.shield=12000;if(p.type==="double")player.double=10000;
      addScore(25);burst(p.x,p.y,"#a8ff60",14);sounds.power();powerups.splice(i,1);updateHud()}
      if(p.type==="laser")player.laser=10;
      if(p.type==="health"){player.health=player.maxHealth||100;player.inv=650;burst(player.x,player.y,"#62ff8a",20);sounds.power();}
  }
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.96;p.vy*=.96;p.life-=dt;if(p.life<=0)particles.splice(i,1)}
  for(const s of stars){s.y+=s.v*dt*(1+level*.05);if(s.y>H){s.y=0;s.x=Math.random()*W}}
  shake*=.9;updateHud();
}

// ===== Rendering =====
function glow(color,blur=14){ctx.shadowColor=color;ctx.shadowBlur=blur}
function drawShip(){
  if(player.inv>0&&Math.floor(player.inv/70)%2===0)return;
  ctx.save();ctx.translate(player.x,player.y);ctx.rotate(player.tilt);
  if(player.laser>0){
    const pulse=1+Math.sin(performance.now()/55)*.18;
    ctx.save();
    ctx.globalCompositeOperation="lighter";
    ctx.shadowBlur=28;ctx.shadowColor="#ffef55";
    ctx.strokeStyle="#fffbd0";ctx.lineWidth=9*pulse;
    ctx.beginPath();ctx.moveTo(0,-26);ctx.lineTo(0,-H);ctx.stroke();
    ctx.shadowBlur=12;ctx.strokeStyle="#fff36b";ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(0,-26);ctx.lineTo(0,-H);ctx.stroke();
    ctx.restore();
  }

  const t=performance.now()/120;
  const flame=28+Math.sin(t)*7;

  // Engine trails
  ctx.globalAlpha=.85;ctx.fillStyle="#ff3cac";glow("#ff3cac",18);
  ctx.beginPath();ctx.moveTo(-9,18);ctx.lineTo(-4,flame+7);ctx.lineTo(0,18);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(9,18);ctx.lineTo(4,flame+7);ctx.lineTo(0,18);ctx.closePath();ctx.fill();
  ctx.globalAlpha=1;

  // Main hull
  ctx.beginPath();ctx.moveTo(0,-27);ctx.lineTo(19,19);ctx.lineTo(7,15);ctx.lineTo(0,25);ctx.lineTo(-7,15);ctx.lineTo(-19,19);ctx.closePath();
  ctx.fillStyle="#0b1730";ctx.strokeStyle="#55e7ff";ctx.lineWidth=2.2;glow("#55e7ff",16);ctx.fill();ctx.stroke();

  // Wings
  ctx.beginPath();ctx.moveTo(-13,5);ctx.lineTo(-28,17);ctx.lineTo(-13,14);ctx.closePath();
  ctx.moveTo(13,5);ctx.lineTo(28,17);ctx.lineTo(13,14);ctx.closePath();
  ctx.fillStyle="#142a4a";ctx.strokeStyle="#8a5cff";glow("#8a5cff",10);ctx.fill();ctx.stroke();

  // Cockpit pulse
  ctx.beginPath();ctx.ellipse(0,-9,8,13,0,0,Math.PI*2);
  ctx.fillStyle="#9ff8ff";glow("#9ff8ff",18);ctx.fill();
  ctx.fillStyle="#8a5cff";ctx.beginPath();ctx.arc(0,-9,4+Math.sin(t)*1,0,Math.PI*2);ctx.fill();

  // Weapon ports
  ctx.fillStyle="#ffcf4a";glow("#ffcf4a",9);ctx.fillRect(-12,14,5,3);ctx.fillRect(7,14,5,3);

  if(player.shield>0){ctx.beginPath();ctx.arc(0,0,31+Math.sin(t*.7)*2,0,Math.PI*2);ctx.strokeStyle="#38f5ff";ctx.lineWidth=2;glow("#38f5ff",20);ctx.stroke()}
  ctx.restore();
}
function drawEnemy(e){
  const now=performance.now()/1000;
  const bob=Math.sin(now*2.4+e.phase)*2.5;
  const bank=Math.sin(now*1.7+e.phase)*0.10;
  const pulse=1+Math.sin(now*4+e.phase)*0.055;

  ctx.save();
  ctx.translate(e.x,e.y+bob);
  ctx.rotate(e.rot+bank);
  ctx.scale(pulse,pulse);

  // Animated engine exhaust.
  const flame=7+Math.sin(now*12+e.phase)*3;
  ctx.globalCompositeOperation="lighter";
  ctx.shadowBlur=14;ctx.shadowColor=e.color;
  ctx.fillStyle=e.color;
  ctx.globalAlpha=.75;
  ctx.beginPath();
  ctx.moveTo(-e.r*.38,e.r*.42);
  ctx.lineTo(-e.r*.18,e.r*.42+flame);
  ctx.lineTo(0,e.r*.48);
  ctx.closePath();ctx.fill();
  ctx.beginPath();
  ctx.moveTo(e.r*.38,e.r*.42);
  ctx.lineTo(e.r*.18,e.r*.42+flame);
  ctx.lineTo(0,e.r*.48);
  ctx.closePath();ctx.fill();
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation="source-over";

  glow(e.color,18);
  ctx.strokeStyle=e.color;
  ctx.lineWidth=2;
  ctx.fillStyle="rgba(7,12,27,.96)";

  if(e.name==="scout"){
    ctx.beginPath();
    ctx.moveTo(0,-e.r);
    ctx.lineTo(e.r*.95,e.r*.62);
    ctx.lineTo(e.r*.30,e.r*.43);
    ctx.lineTo(0,e.r);
    ctx.lineTo(-e.r*.30,e.r*.43);
    ctx.lineTo(-e.r*.95,e.r*.62);
    ctx.closePath();
  }else if(e.name==="bruiser"){
    ctx.beginPath();
    for(let i=0;i<8;i++){
      const a=-Math.PI/2+i*Math.PI/4;
      const rr=i%2?e.r*.70:e.r;
      const px=Math.cos(a)*rr,py=Math.sin(a)*rr;
      i?ctx.lineTo(px,py):ctx.moveTo(px,py);
    }
    ctx.closePath();
  }else if(e.name==="duo"){
    ctx.beginPath();
    ctx.moveTo(0,-e.r);
    ctx.lineTo(e.r*.92,-e.r*.15);
    ctx.lineTo(e.r*.62,e.r);
    ctx.lineTo(0,e.r*.48);
    ctx.lineTo(-e.r*.62,e.r);
    ctx.lineTo(-e.r*.92,-e.r*.15);
    ctx.closePath();
  }else if(e.name==="gunship"){
    ctx.beginPath();
    ctx.moveTo(-e.r*.85,-e.r*.25);
    ctx.lineTo(-e.r*.25,-e.r);
    ctx.lineTo(e.r*.55,-e.r*.72);
    ctx.lineTo(e.r,e.r*.12);
    ctx.lineTo(e.r*.52,e.r*.82);
    ctx.lineTo(-e.r*.52,e.r*.82);
    ctx.lineTo(-e.r,e.r*.12);
    ctx.closePath();
  }else{
    ctx.beginPath();
    ctx.moveTo(0,-e.r);
    ctx.lineTo(e.r,e.r*.7);
    ctx.lineTo(0,e.r*.38);
    ctx.lineTo(-e.r,e.r*.7);
    ctx.closePath();
  }

  ctx.fill();
  ctx.stroke();

  // Animated central reactor.
  const reactor=3+Math.sin(now*7+e.phase)*1.1;
  ctx.fillStyle="#fff";
  glow("#fff",10);
  ctx.beginPath();ctx.arc(0,0,reactor,0,Math.PI*2);ctx.fill();

  // Weapon muzzle lights on double-shooter enemies.
  if(e.shoot===2){
    const muzzle=2.5+Math.sin(now*9+e.phase)*1.5;
    ctx.fillStyle="#ffcf4a";
    glow("#ffcf4a",10);
    ctx.beginPath();ctx.arc(-e.r*.48,e.r*.40,muzzle,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(e.r*.48,e.r*.40,muzzle,0,Math.PI*2);ctx.fill();
  }

  ctx.restore();

  // Health bar.
  if(e.hp<e.maxHp){
    ctx.fillStyle="#18233a";
    ctx.fillRect(e.x-e.r,e.y-e.r-10,e.r*2,3);
    ctx.fillStyle=e.color;
    ctx.fillRect(e.x-e.r,e.y-e.r-10,e.r*2*Math.max(0,e.hp/e.maxHp),3);
  }
}
function drawPower(p){
  const c=p.type==="rapid"?"#ff3cac":p.type==="shield"?"#38f5ff":"#a8ff60";
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.spin);ctx.strokeStyle=c;ctx.lineWidth=2;glow(c,15);ctx.strokeRect(-9,-9,18,18);
  ctx.fillStyle=c;ctx.font="bold 11px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(p.type==="rapid"?"R":p.type==="shield"?"S":"2",0,0);ctx.restore();
}
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.save();if(shake>0)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
  // starfield
  for(const s of stars){ctx.fillStyle=`rgba(210,240,255,${s.a})`;ctx.fillRect(s.x,s.y,s.s,s.s)}
  // distant grid / horizon
  ctx.strokeStyle="rgba(56,245,255,.035)";ctx.lineWidth=1;
  for(let y=H*.15;y<H;y+=55){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
  for(let x=0;x<W;x+=70){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
  for(const p of powerups)drawPower(p);
  for(const b of bullets){
    ctx.beginPath();
    if(b.enemy){
      // Enemy projectile points downward.
      ctx.moveTo(b.x,b.y-10);
      ctx.lineTo(b.x,b.y+4);
    }else{
      // Player projectile points upward.
      ctx.moveTo(b.x,b.y+10);
      ctx.lineTo(b.x,b.y-7);
    }
    ctx.strokeStyle=b.enemy?"#ff557d":"#38f5ff";
    ctx.lineWidth=b.enemy?3:3;
    glow(b.enemy?"#ff557d":"#38f5ff",12);
    ctx.stroke();
  }
  for(const e of enemies)drawEnemy(e);drawShip();
  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;glow(p.color,8);ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1}
  ctx.restore();
}

// ===== Loop / state =====
function frame(t){const dt=Math.min(.033,(t-last)/1000||0);last=t;update(dt);draw();raf=requestAnimationFrame(frame)}
function start(){
  audio();reset();state="playing";startScreen.classList.remove("active");pauseScreen.classList.remove("active");gameOverScreen.classList.remove("active");pauseBtn.disabled=false;pauseBtn.textContent="Ⅱ";
}
function togglePause(){
  if(state==="playing"){state="paused";pauseScreen.classList.add("active");pauseBtn.textContent="▶"}
  else if(state==="paused"){state="playing";pauseScreen.classList.remove("active");pauseBtn.textContent="Ⅱ"}
}
function endGame(){
  state="over";pauseBtn.disabled=true;sounds.over();burst(player.x,player.y,"#ff3cac",35);
  if(score>high){high=score;localStorage.setItem("neonVoidHighScore",high);$("recordMsg").textContent="NEW HIGH SCORE // SECTOR CLEARED"}
  else $("recordMsg").textContent="MISSION COMPLETE // BEST: "+String(high).padStart(6,"0");
  $("finalScore").textContent=String(score).padStart(6,"0");highEl.textContent=String(high).padStart(6,"0");gameOverScreen.classList.add("active");
}
$("startBtn").onclick=start;$("againBtn").onclick=start;$("pauseBtn").onclick=togglePause;$("resumeBtn").onclick=togglePause;$("restartBtn").onclick=start;

// ===== Keyboard + mobile =====
addEventListener("keydown",e=>{
  if(["ArrowLeft","ArrowRight","Space"].includes(e.code))e.preventDefault();
  if(e.code==="ArrowLeft"||e.code==="KeyA")keys.left=true;
  if(e.code==="ArrowRight"||e.code==="KeyD")keys.right=true;
  if(e.code==="Space"){keys.fire=true;if(state==="menu")start()}
  if(e.code==="KeyR"&&!e.repeat)fireRocket();
  if(e.code==="KeyC"&&!e.repeat)fireCannon();
  if(e.code==="KeyP"&&!e.repeat)togglePause();
});
addEventListener("keyup",e=>{
  if(e.code==="ArrowLeft"||e.code==="KeyA")keys.left=false;
  if(e.code==="ArrowRight"||e.code==="KeyD")keys.right=false;
  if(e.code==="Space")keys.fire=false;
});
function bindTouch(id,key){
  const el=$(id);const on=e=>{e.preventDefault();audio();keys[key]=true};const off=e=>{e.preventDefault();keys[key]=false};
  el.addEventListener("pointerdown",on);el.addEventListener("pointerup",off);el.addEventListener("pointercancel",off);el.addEventListener("pointerleave",off);
}
bindTouch("leftTouch","left");bindTouch("rightTouch","right");bindTouch("fireTouch","fire");
$("rocketTouch")?.addEventListener("pointerdown",e=>{e.preventDefault();audio();fireRocket()});
$("cannonTouch")?.addEventListener("pointerdown",e=>{e.preventDefault();audio();fireCannon()});

resize();highEl.textContent=String(high).padStart(6,"0");updateHud();raf=requestAnimationFrame(frame);
})();

const rocketBtn = document.getElementById("rocketBtn");
const cannonBtn = document.getElementById("cannonBtn");
if (rocketBtn) rocketBtn.addEventListener("pointerdown", e => { e.preventDefault(); fireRocket(); });
if (cannonBtn) cannonBtn.addEventListener("pointerdown", e => { e.preventDefault(); fireCannon(); });
