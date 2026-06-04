(function () {
  'use strict';

  // ── Palette ───────────────────────────────────────────────────────────────
  const C = {
    player: 'rgba(139, 92, 246, 0.38)',
    ball:   'rgba(245, 243, 255, 0.92)',
    trail:  [139, 92, 246],
    ripple: [196, 181, 253],
    beer:   [200, 130, 30],   // amber beer
    foam:   [255, 245, 215],  // cream foam
  };

  // ── Shared utils ──────────────────────────────────────────────────────────
  function setupCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width  = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W, H };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
  function quadBez(p0, cp, p1, t) {
    const u = 1 - t;
    return { x: u*u*p0.x+2*u*t*cp.x+t*t*p1.x, y: u*u*p0.y+2*u*t*cp.y+t*t*p1.y };
  }
  function rgba([r,g,b], a) { return `rgba(${r},${g},${b},${a})`; }

  // ── Cup: side view (trapezoid with amber beer fill) ───────────────────────
  function drawCupSide(ctx, x, y, size, opacity, fill=0.65, glow=0) {
    const tW=size, bW=size*0.62, h=size*1.5;
    ctx.save(); ctx.globalAlpha=opacity;
    // Body
    ctx.beginPath();
    ctx.moveTo(x-tW/2,y-h/2); ctx.lineTo(x+tW/2,y-h/2);
    ctx.lineTo(x+bW/2,y+h/2); ctx.lineTo(x-bW/2,y+h/2);
    ctx.closePath();
    ctx.fillStyle='rgba(30,6,60,0.65)'; ctx.fill();
    // Beer fill
    if (fill > 0) {
      ctx.save(); ctx.clip();
      const fy = y - h/2 + h*(1-fill);
      ctx.fillStyle=rgba(C.beer, 0.38); ctx.fillRect(x-tW, fy+4, tW*2, h);
      ctx.fillStyle=rgba(C.foam, 0.28); ctx.fillRect(x-tW, fy, tW*2, 5);
      ctx.restore();
    }
    // Outline
    ctx.strokeStyle=`rgba(139,92,246,${0.55+glow*0.45})`; ctx.lineWidth=1.2; ctx.stroke();
    // Rim highlight
    ctx.beginPath();
    ctx.moveTo(x-tW/2-1.5,y-h/2); ctx.lineTo(x+tW/2+1.5,y-h/2);
    ctx.strokeStyle=`rgba(196,181,253,${0.75+glow*0.25})`; ctx.lineWidth=1.8; ctx.stroke();
    ctx.restore();
  }

  // ── Cup: top-down view (ring with amber beer surface) ─────────────────────
  function drawCupTop(ctx, x, y, r, opacity, glow=0) {
    ctx.save(); ctx.globalAlpha=opacity;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle='rgba(30,6,60,0.55)'; ctx.fill();
    ctx.strokeStyle=`rgba(139,92,246,${0.45+glow*0.55})`; ctx.lineWidth=1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(x,y,r*0.68,0,Math.PI*2);
    ctx.fillStyle=rgba(C.beer, 0.30+glow*0.18); ctx.fill();
    ctx.beginPath(); ctx.arc(x,y-r*0.15,r*0.35,0,Math.PI*2);
    ctx.fillStyle=rgba(C.foam, 0.14+glow*0.1); ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,r,Math.PI*1.1,Math.PI*1.9);
    ctx.strokeStyle=`rgba(196,181,253,${0.35+glow*0.3})`; ctx.lineWidth=1.8; ctx.stroke();
    ctx.restore();
  }

  // ── Beer splash particles ─────────────────────────────────────────────────
  function makeSplash(x, y, n=10) {
    return Array.from({length:n}, ()=>({
      x, y,
      vx:(Math.random()-0.5)*160,
      vy:-(30+Math.random()*120),
      life:1.0, r:1.5+Math.random()*2.5,
    }));
  }
  function tickSplash(sp, dt) {
    const s=dt/1000;
    for (const p of sp) { p.x+=p.vx*s; p.y+=p.vy*s; p.vy+=210*s; p.life-=s*2.0; }
    return sp.filter(p=>p.life>0);
  }
  function drawSplash(ctx, sp) {
    for (const p of sp) {
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r*p.life,0,Math.PI*2);
      ctx.fillStyle=rgba(C.beer, p.life*0.75); ctx.fill();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 1 — "The Match" (side-view game)
  // ══════════════════════════════════════════════════════════════════════════
  function animMatch() {
    let canvas, ctx, W, H, raf;
    let state='idle', stateTimer=0, throwFrom='right', ballT=0;
    let throwOrigin=null, targetCup=null;
    let cups={ left:[], right:[] };
    let splash=[], prevTime=null;

    const IDLE_MS=1100, THROW_MS=1500, HIT_MS=500;

    function buildCups() {
      for (const side of ['left','right']) {
        cups[side]=[];
        for (let row=0;row<4;row++)
          for (let col=0;col<=row;col++)
            cups[side].push({row,col,alive:true,opacity:1});
      }
    }

    function cupPos(side, cup) {
      const tY=H*0.60, tL=W*0.22, tR=W*0.78;
      const sp=clamp(W*0.024,12,24), cnt=cup.row+1;
      const x=side==='left' ? tL+22+(3-cup.row)*sp : tR-22-(3-cup.row)*sp;
      const y=tY-(cnt-1)*sp*0.85/2+cup.col*sp*0.85;
      return {x,y};
    }

    function aliveCups(side) { return cups[side].filter(c=>c.alive); }

    function drawTable() {
      const tL=W*0.22, tR=W*0.78, tY=H*0.60, tW=tR-tL;
      ctx.fillStyle='rgba(88,28,135,0.22)'; ctx.fillRect(tL,tY-9,tW,9);
      const g=ctx.createLinearGradient(0,tY,0,tY+14);
      g.addColorStop(0,'rgba(88,28,135,0.28)'); g.addColorStop(1,'rgba(30,6,60,0.08)');
      ctx.fillStyle=g; ctx.fillRect(tL,tY,tW,14);
      ctx.strokeStyle='rgba(167,139,250,0.50)'; ctx.lineWidth=1.8;
      ctx.beginPath(); ctx.moveTo(tL,tY-9); ctx.lineTo(tR,tY-9); ctx.stroke();
      ctx.strokeStyle='rgba(109,40,217,0.35)'; ctx.lineWidth=2.5;
      for (const lx of [tL+20,tR-20]) {
        ctx.beginPath(); ctx.moveTo(lx,tY+14); ctx.lineTo(lx,tY+14+H*0.09); ctx.stroke();
      }
    }

    function drawPlayer(px, py, dir, throwT) {
      ctx.save();
      ctx.strokeStyle=C.player; ctx.fillStyle=C.player;
      ctx.lineWidth=2.5; ctx.lineCap='round';
      ctx.beginPath(); ctx.arc(px,py-54,11,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px,py-43); ctx.lineTo(px,py-8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px,py-8); ctx.lineTo(px-10,py+28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px,py-8); ctx.lineTo(px+10,py+28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px,py-32); ctx.lineTo(px-dir*18,py-10); ctx.stroke();
      let hx, hy;
      if (throwT < 0) { hx=px+dir*10; hy=py-10; }
      else {
        const t=ease(throwT);
        hx=lerp(px-dir*20,px+dir*26,t); hy=lerp(py-48,py-44,t);
      }
      ctx.beginPath(); ctx.moveTo(px,py-32); ctx.lineTo(hx,hy); ctx.stroke();
      ctx.restore();
      return {hx,hy};
    }

    function update(dt) {
      splash=tickSplash(splash,dt);
      for (const side of ['left','right'])
        for (const c of cups[side])
          if (!c.alive && c.opacity>0) c.opacity=Math.max(0,c.opacity-dt*0.003);
      stateTimer+=dt;
      if (state==='idle' && stateTimer>=IDLE_MS) {
        const toSide=throwFrom==='left'?'right':'left';
        const alive=aliveCups(toSide);
        targetCup=alive.length>0?alive[Math.floor(Math.random()*alive.length)]:null;
        const throwerX=throwFrom==='left'?W*0.11:W*0.89;
        const throwerDir=throwFrom==='left'?1:-1;
        throwOrigin={x:throwerX-throwerDir*20,y:H*0.60-48};
        state='throwing'; stateTimer=0; ballT=0;
      }
      if (state==='throwing') {
        ballT=clamp(stateTimer/THROW_MS,0,1);
        if (ballT>=1) {
          if (targetCup&&targetCup.alive) {
            targetCup.alive=false;
            const p=cupPos(throwFrom==='left'?'right':'left',targetCup);
            splash.push(...makeSplash(p.x,p.y));
          }
          const toSide=throwFrom==='left'?'right':'left';
          if (aliveCups(toSide).length===0) buildCups();
          throwFrom=throwFrom==='left'?'right':'left';
          state='hit'; stateTimer=0;
        }
      }
      if (state==='hit'&&stateTimer>=HIT_MS) { state='idle'; stateTimer=0; }
    }

    function draw() {
      ctx.clearRect(0,0,W,H);
      drawTable();
      const cupSize=clamp(W*0.018,10,16);
      for (const side of ['left','right'])
        for (const c of cups[side])
          if (c.opacity>0) { const p=cupPos(side,c); drawCupSide(ctx,p.x,p.y,cupSize,c.opacity); }
      drawSplash(ctx,splash);
      const tY=H*0.60, lx=W*0.11, rx=W*0.89;
      const lT=(throwFrom==='left'&&state==='throwing')?ballT:-1;
      const rT=(throwFrom==='right'&&state==='throwing')?ballT:-1;
      const {hx:lHx,hy:lHy}=drawPlayer(lx,tY,+1,lT);
      const {hx:rHx,hy:rHy}=drawPlayer(rx,tY,-1,rT);
      if (state==='throwing'&&targetCup) {
        const toSide=throwFrom==='left'?'right':'left';
        const from=throwOrigin||{x:throwFrom==='left'?lHx:rHx,y:throwFrom==='left'?lHy:rHy};
        const to=cupPos(toSide,targetCup);
        const cp={x:W*0.5,y:tY-H*0.28};
        const pos=quadBez(from,cp,to,ease(ballT));
        ctx.save();
        ctx.shadowColor='rgba(196,181,253,0.6)'; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.arc(pos.x,pos.y,5,0,Math.PI*2);
        ctx.fillStyle=C.ball; ctx.fill();
        ctx.restore();
      }
    }

    function loop(ts) {
      raf=requestAnimationFrame(loop);
      const dt=prevTime?Math.min(ts-prevTime,50):16;
      prevTime=ts; update(dt); draw();
    }
    return {
      start(c) {
        canvas=c; ({ctx,W,H}=setupCanvas(canvas)); buildCups();
        window.addEventListener('resize',()=>({ctx,W,H}=setupCanvas(canvas)));
        raf=requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 2 — "Cup Rain" (cups + balls drifting down)
  // ══════════════════════════════════════════════════════════════════════════
  function animRain() {
    let canvas, ctx, W, H, raf;
    let items=[], prevTime=null;
    const COUNT=38;

    function makeItem(spread, forceBall) {
      const isBall = forceBall || Math.random() < 0.22;
      const scale  = 0.38 + Math.random() * 0.82;
      const x      = Math.random() * (W||window.innerWidth);
      return {
        isBall,
        x, baseX:x,
        y: spread ? Math.random()*(H||window.innerHeight) : -(60*scale+30),
        vy:  isBall ? 55+Math.random()*70 : 35+Math.random()*55,
        scale,
        angle: isBall ? 0 : (Math.random()-0.5)*0.7,
        wPhase:Math.random()*Math.PI*2,
        wAmp:  16+Math.random()*30,
        wFreq: 0.007+Math.random()*0.007,
        opacity:0.09+Math.random()*0.24,
      };
    }

    function init(spread) {
      items=Array.from({length:COUNT},(_,i)=>makeItem(spread, i<Math.round(COUNT*0.22)));
    }

    function update(dt) {
      const s=dt/1000;
      for (const it of items) {
        it.y+=it.vy*s;
        it.x=it.baseX+Math.sin(it.y*it.wFreq+it.wPhase)*it.wAmp;
        if (it.y>H+70*it.scale) Object.assign(it,makeItem(false));
      }
    }

    function draw() {
      ctx.clearRect(0,0,W,H);
      for (const it of items) {
        const s=it.scale;
        ctx.save(); ctx.translate(it.x,it.y); ctx.rotate(it.angle); ctx.globalAlpha=it.opacity;
        if (it.isBall) {
          // Ping-pong ball
          ctx.beginPath(); ctx.arc(0,0,9*s,0,Math.PI*2);
          ctx.fillStyle='rgba(245,243,255,0.85)'; ctx.fill();
          ctx.strokeStyle='rgba(196,181,253,0.4)'; ctx.lineWidth=1; ctx.stroke();
          // Seam line
          ctx.beginPath(); ctx.ellipse(0,0,9*s,4*s,0,0,Math.PI*2);
          ctx.strokeStyle='rgba(139,92,246,0.3)'; ctx.lineWidth=0.8; ctx.stroke();
        } else {
          // Side-view cup with beer fill
          const tW=22*s, bW=13*s, h=30*s;
          ctx.beginPath();
          ctx.moveTo(-tW/2,-h/2); ctx.lineTo(tW/2,-h/2);
          ctx.lineTo(bW/2,h/2);   ctx.lineTo(-bW/2,h/2);
          ctx.closePath();
          ctx.fillStyle='rgba(30,6,60,0.6)'; ctx.fill();
          // Beer fill clip
          ctx.save(); ctx.clip();
          ctx.fillStyle=rgba(C.beer,0.35); ctx.fillRect(-tW,-h*0.1,tW*2,h);
          ctx.fillStyle=rgba(C.foam,0.25); ctx.fillRect(-tW,-h*0.1,tW*2,5*s);
          ctx.restore();
          ctx.strokeStyle='rgba(139,92,246,0.6)'; ctx.lineWidth=1.1/s; ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-tW/2-2/s,-h/2); ctx.lineTo(tW/2+2/s,-h/2);
          ctx.strokeStyle='rgba(196,181,253,0.55)'; ctx.lineWidth=1.5/s; ctx.stroke();
        }
        ctx.restore(); ctx.globalAlpha=1;
      }
    }

    function loop(ts) {
      raf=requestAnimationFrame(loop);
      const dt=prevTime?Math.min(ts-prevTime,50):16;
      prevTime=ts; update(dt); draw();
    }
    return {
      start(c) {
        canvas=c; ({ctx,W,H}=setupCanvas(canvas)); init(true);
        window.addEventListener('resize',()=>{ ({ctx,W,H}=setupCanvas(canvas)); init(true); });
        raf=requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 3 — "Multiball" (balls fly to side-view cup targets)
  // ══════════════════════════════════════════════════════════════════════════
  function animMultiball() {
    let canvas, ctx, W, H, raf;
    let balls=[], targets=[], splash=[], prevTime=null;
    const BALL_COUNT=6, TARGET_COUNT=12, TRAIL_LEN=24;

    function makeTarget() {
      return { x:W*(0.06+Math.random()*0.88), y:H*(0.08+Math.random()*0.84), cooldown:0, hit:0 };
    }
    function makeBall(staggerT) {
      const fromLeft=Math.random()<0.5;
      return {
        p0:{x:fromLeft?-10:W+10, y:H*(0.12+Math.random()*0.76)},
        cp:{x:W*(0.18+Math.random()*0.64), y:H*(0.04+Math.random()*0.38)},
        p1:{x:fromLeft?W+10:-10, y:H*(0.12+Math.random()*0.76)},
        t:staggerT??Math.random(), dur:2200+Math.random()*2000, trail:[],
      };
    }
    function init() {
      targets=Array.from({length:TARGET_COUNT},makeTarget);
      balls=Array.from({length:BALL_COUNT},()=>makeBall(null));
    }

    function update(dt) {
      splash=tickSplash(splash,dt);
      for (const t of targets) { t.cooldown=Math.max(0,t.cooldown-dt); t.hit=Math.max(0,t.hit-dt*0.002); }
      for (const b of balls) {
        b.t+=dt/b.dur;
        if (b.t>=1) { Object.assign(b,makeBall(0)); b.trail=[]; continue; }
        const pos=quadBez(b.p0,b.cp,b.p1,ease(b.t));
        b.trail.push({...pos});
        if (b.trail.length>TRAIL_LEN) b.trail.shift();
        for (const tgt of targets) {
          if (tgt.cooldown>0) continue;
          const dx=pos.x-tgt.x, dy=pos.y-tgt.y;
          if (dx*dx+dy*dy<28*28) {
            splash.push(...makeSplash(tgt.x,tgt.y,7));
            tgt.hit=1; tgt.cooldown=700;
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0,0,W,H);
      const cupSize=clamp(Math.min(W,H)*0.022,12,20);
      for (const tgt of targets) drawCupSide(ctx,tgt.x,tgt.y,cupSize,0.22,0.65,tgt.hit*0.6);
      drawSplash(ctx,splash);
      for (const b of balls) {
        const len=b.trail.length;
        for (let i=0;i<len-1;i++) {
          ctx.beginPath(); ctx.arc(b.trail[i].x,b.trail[i].y,1.5+(i/len)*4,0,Math.PI*2);
          ctx.fillStyle=rgba(C.trail,(i/len)*0.52); ctx.fill();
        }
        if (len>0) {
          const h=b.trail[len-1];
          ctx.save(); ctx.shadowColor='rgba(196,181,253,0.6)'; ctx.shadowBlur=8;
          ctx.beginPath(); ctx.arc(h.x,h.y,5.5,0,Math.PI*2);
          ctx.fillStyle=C.ball; ctx.fill(); ctx.restore();
        }
      }
    }

    function loop(ts) {
      raf=requestAnimationFrame(loop);
      const dt=prevTime?Math.min(ts-prevTime,50):16;
      prevTime=ts; update(dt); draw();
    }
    return {
      start(c) {
        canvas=c; ({ctx,W,H}=setupCanvas(canvas)); init();
        window.addEventListener('resize',()=>{ ({ctx,W,H}=setupCanvas(canvas)); init(); });
        raf=requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 4 — "Bounce" (balls vs beer-pong triangle formations)
  // ══════════════════════════════════════════════════════════════════════════
  function animBounce() {
    let canvas, ctx, W, H, raf;
    let balls=[], cups=[], splash=[], prevTime=null;
    const TRAIL=20;

    // Build two proper beer-pong triangles (4-3-2-1) pointing inward
    function buildCups() {
      cups=[];
      const sp=clamp(Math.min(W,H)*0.068,28,52);
      const cy=H*0.46;
      const rows=[4,3,2,1];
      // Left triangle: 4-cup column leftmost, 1-cup column rightmost (points right)
      const lBase=W*0.13;
      for (let col=0;col<4;col++) {
        const count=rows[col];
        for (let r=0;r<count;r++)
          cups.push({x:lBase+col*sp, y:cy+(r-(count-1)/2)*sp, alive:true, opacity:1, glow:0});
      }
      // Right triangle: mirror (points left)
      const rBase=W*0.87;
      for (let col=0;col<4;col++) {
        const count=rows[col];
        for (let r=0;r<count;r++)
          cups.push({x:rBase-col*sp, y:cy+(r-(count-1)/2)*sp, alive:true, opacity:1, glow:0});
      }
    }

    function spawnBall() {
      const angle=Math.PI*(0.22+Math.random()*0.56);
      const speed=clamp(W*0.21,160,310);
      return {
        x:W*(0.25+Math.random()*0.5), y:H*0.9,
        vx:Math.cos(angle)*speed*(Math.random()<0.5?1:-1),
        vy:-Math.sin(angle)*speed,
        trail:[], delay:Math.random()*700,
      };
    }

    function update(dt) {
      const s=dt/1000;
      splash=tickSplash(splash,dt);
      for (const c of cups) {
        if (!c.alive) c.opacity=Math.max(0,c.opacity-s*1.6);
        c.glow=Math.max(0,c.glow-s*3);
      }
      if (!cups.some(c=>c.alive)) buildCups();
      for (const b of balls) {
        if (b.delay>0) { b.delay-=dt; continue; }
        b.x+=b.vx*s; b.y+=b.vy*s;
        if (b.x<7)   { b.x=7;   b.vx= Math.abs(b.vx); }
        if (b.x>W-7) { b.x=W-7; b.vx=-Math.abs(b.vx); }
        if (b.y<7)   { b.y=7;   b.vy= Math.abs(b.vy); }
        if (b.y>H+30) { Object.assign(b,spawnBall()); b.trail=[]; continue; }
        b.trail.push({x:b.x,y:b.y});
        if (b.trail.length>TRAIL) b.trail.shift();
        for (const c of cups) {
          if (!c.alive) continue;
          const dx=b.x-c.x, dy=b.y-c.y, d2=dx*dx+dy*dy;
          if (d2<14*14) {
            c.alive=false; c.glow=1;
            splash.push(...makeSplash(c.x,c.y));
            const dot=(b.vx*dx+b.vy*dy)/d2;
            b.vx-=2*dot*dx; b.vy-=2*dot*dy;
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0,0,W,H);
      const sz=clamp(Math.min(W,H)*0.038,18,32);
      for (const c of cups) {
        if (c.opacity<=0) continue;
        drawCupSide(ctx,c.x,c.y,sz,c.opacity,0.65,c.glow);
      }
      drawSplash(ctx,splash);
      for (const b of balls) {
        if (b.delay>0) continue;
        const n=b.trail.length;
        for (let i=0;i<n;i++) {
          ctx.beginPath(); ctx.arc(b.trail[i].x,b.trail[i].y,1+(i/n)*3,0,Math.PI*2);
          ctx.fillStyle=rgba(C.trail,(i/n)*0.42); ctx.fill();
        }
        ctx.save(); ctx.shadowColor='rgba(196,181,253,0.7)'; ctx.shadowBlur=12;
        ctx.beginPath(); ctx.arc(b.x,b.y,5,0,Math.PI*2);
        ctx.fillStyle=C.ball; ctx.fill(); ctx.restore();
      }
    }

    function loop(ts) {
      raf=requestAnimationFrame(loop);
      const dt=prevTime?Math.min(ts-prevTime,50):16;
      prevTime=ts; update(dt); draw();
    }
    return {
      start(c) {
        canvas=c; ({ctx,W,H}=setupCanvas(canvas));
        buildCups(); balls=Array.from({length:3},spawnBall);
        window.addEventListener('resize',()=>{
          ({ctx,W,H}=setupCanvas(canvas));
          buildCups(); balls=Array.from({length:3},spawnBall);
        });
        raf=requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 5 — "Grid" (top-down cup field with beer fills)
  // ══════════════════════════════════════════════════════════════════════════
  function animGrid() {
    let canvas, ctx, W, H, raf;
    let t=0, grid=[], balls=[], splash=[], prevTime=null, nextBall=1200;
    const COLS=9, ROWS=7;

    function buildGrid() {
      grid=[];
      const px=W*0.07, py=H*0.09;
      const sx=(W-px*2)/(COLS-1), sy=(H-py*2)/(ROWS-1);
      for (let r=0;r<ROWS;r++)
        for (let c=0;c<COLS;c++)
          grid.push({x:px+c*sx, y:py+r*sy, phase:(r*COLS+c)*0.42, hit:0});
    }

    function spawnBall() {
      const fromLeft=Math.random()<0.5;
      const spd=clamp(W*0.13,90,180);
      return {
        x:fromLeft?-8:W+8, y:H*(0.12+Math.random()*0.76),
        vx:fromLeft?spd:-spd, vy:(Math.random()-0.5)*70,
        trail:[], done:false,
      };
    }

    function update(dt) {
      t+=dt*0.001;
      nextBall-=dt;
      if (nextBall<=0) { balls.push(spawnBall()); nextBall=1600+Math.random()*1400; }
      splash=tickSplash(splash,dt);
      for (const g of grid) g.hit=Math.max(0,g.hit-dt*0.002);
      balls=balls.filter(b=>!b.done);
      const s=dt/1000;
      for (const b of balls) {
        b.x+=b.vx*s; b.y+=b.vy*s;
        b.trail.push({x:b.x,y:b.y});
        if (b.trail.length>22) b.trail.shift();
        if (b.x<-40||b.x>W+40||b.y<-40||b.y>H+40) { b.done=true; continue; }
        for (const g of grid) {
          const dx=b.x-g.x, dy=b.y-g.y;
          if (dx*dx+dy*dy<18*18 && g.hit<0.1) {
            g.hit=1; splash.push(...makeSplash(g.x,g.y,6));
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0,0,W,H);
      const cupR=clamp(Math.min(W,H)*0.018,7,14);
      for (const g of grid) {
        const pulse=(Math.sin(t*2.1+g.phase)+1)*0.5;
        drawCupTop(ctx,g.x,g.y,cupR+pulse*2.5,0.18+pulse*0.18,g.hit);
      }
      drawSplash(ctx,splash);
      for (const b of balls) {
        const n=b.trail.length;
        for (let i=0;i<n;i++) {
          ctx.beginPath(); ctx.arc(b.trail[i].x,b.trail[i].y,1+(i/n)*3.5,0,Math.PI*2);
          ctx.fillStyle=rgba(C.trail,(i/n)*0.38); ctx.fill();
        }
        if (n>0) {
          ctx.save(); ctx.shadowColor='rgba(196,181,253,0.7)'; ctx.shadowBlur=10;
          ctx.beginPath(); ctx.arc(b.x,b.y,4.5,0,Math.PI*2);
          ctx.fillStyle=C.ball; ctx.fill(); ctx.restore();
        }
      }
    }

    function loop(ts) {
      raf=requestAnimationFrame(loop);
      const dt=prevTime?Math.min(ts-prevTime,50):16;
      prevTime=ts; update(dt); draw();
    }
    return {
      start(c) {
        canvas=c; ({ctx,W,H}=setupCanvas(canvas)); buildGrid();
        window.addEventListener('resize',()=>{ ({ctx,W,H}=setupCanvas(canvas)); buildGrid(); });
        raf=requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 6 — "Orbit" (top-down table, cup rings with beer fills)
  // ══════════════════════════════════════════════════════════════════════════
  function animOrbit() {
    let canvas, ctx, W, H, raf;
    let t=0, rings=[], balls=[], splash=[], prevTime=null;
    const RING_COUNT=4;

    function buildRings() {
      rings=[];
      const base=Math.min(W,H)*0.1, max=Math.min(W,H)*0.43;
      for (let i=0;i<RING_COUNT;i++) {
        const r=base+(max-base)*(i/(RING_COUNT-1));
        const count=4+i*3;
        const speed=(0.28/(i+1))*(i%2===0?1:-1);
        rings.push({
          r, speed, offset:Math.random()*Math.PI*2,
          cups:Array.from({length:count},(_,j)=>({angle:(j/count)*Math.PI*2, hit:0})),
        });
      }
      balls=rings.map((ring,i)=>({
        ringIdx:i,
        angle:Math.random()*Math.PI*2,
        speed:ring.speed*(2.1+Math.random()*0.8)*(Math.random()<0.5?1:-1),
        trail:[], cx:0, cy:0,
      }));
    }

    function cupXY(ring, cup) {
      const a=cup.angle+ring.offset;
      return {x:W/2+Math.cos(a)*ring.r, y:H/2+Math.sin(a)*ring.r};
    }

    function update(dt) {
      t+=dt*0.001;
      splash=tickSplash(splash,dt);
      for (const ring of rings) {
        ring.offset+=ring.speed*dt*0.001;
        for (const c of ring.cups) c.hit=Math.max(0,c.hit-dt*0.002);
      }
      for (const b of balls) {
        b.angle+=b.speed*dt*0.001;
        const ring=rings[b.ringIdx];
        b.cx=W/2+Math.cos(b.angle)*ring.r;
        b.cy=H/2+Math.sin(b.angle)*ring.r;
        b.trail.push({x:b.cx,y:b.cy});
        if (b.trail.length>20) b.trail.shift();
        for (const c of ring.cups) {
          const {x,y}=cupXY(ring,c);
          const dx=b.cx-x, dy=b.cy-y;
          if (dx*dx+dy*dy<11*11 && c.hit<0.1) {
            c.hit=1; splash.push(...makeSplash(x,y,6));
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0,0,W,H);

      // Faint table surface
      ctx.save();
      ctx.strokeStyle='rgba(109,40,217,0.1)'; ctx.lineWidth=1;
      const tR=Math.min(W,H)*0.46;
      ctx.beginPath(); ctx.ellipse(W/2,H/2,tR,tR*0.35,0,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle='rgba(109,40,217,0.06)';
      ctx.beginPath(); ctx.moveTo(W/2,H/2-tR*0.35); ctx.lineTo(W/2,H/2+tR*0.35); ctx.stroke();
      ctx.restore();

      // Ring guides
      for (const ring of rings) {
        ctx.beginPath(); ctx.arc(W/2,H/2,ring.r,0,Math.PI*2);
        ctx.strokeStyle='rgba(109,40,217,0.07)'; ctx.lineWidth=1; ctx.stroke();
      }

      // Cups (top-down with beer fill)
      const cupR=clamp(Math.min(W,H)*0.022,6,10);
      for (const ring of rings)
        for (const c of ring.cups) {
          const {x,y}=cupXY(ring,c);
          drawCupTop(ctx,x,y,cupR,0.7,c.hit);
        }

      drawSplash(ctx,splash);

      // Balls + trails
      for (const b of balls) {
        const n=b.trail.length;
        for (let i=0;i<n;i++) {
          ctx.beginPath(); ctx.arc(b.trail[i].x,b.trail[i].y,1+(i/n)*3,0,Math.PI*2);
          ctx.fillStyle=rgba(C.trail,(i/n)*0.38); ctx.fill();
        }
        ctx.save(); ctx.shadowColor='rgba(196,181,253,0.7)'; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.arc(b.cx,b.cy,4.5,0,Math.PI*2);
        ctx.fillStyle=C.ball; ctx.fill(); ctx.restore();
      }
    }

    function loop(ts) {
      raf=requestAnimationFrame(loop);
      const dt=prevTime?Math.min(ts-prevTime,50):16;
      prevTime=ts; update(dt); draw();
    }
    return {
      start(c) {
        canvas=c; ({ctx,W,H}=setupCanvas(canvas)); buildRings();
        window.addEventListener('resize',()=>{ ({ctx,W,H}=setupCanvas(canvas)); buildRings(); });
        raf=requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────
  window.ANIMATIONS = [animMatch(), animRain(), animMultiball(), animBounce(), animGrid(), animOrbit()];
}());
