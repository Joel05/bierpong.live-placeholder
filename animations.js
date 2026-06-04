(function () {
  'use strict';

  // ── Palette ───────────────────────────────────────────────────────────────
  const C = {
    table:     'rgba(109, 40, 217, 0.18)',
    tableEdge: 'rgba(139, 92, 246, 0.32)',
    cup:       'rgba(196, 181, 253, 0.28)',
    cupRim:    'rgba(196, 181, 253, 0.55)',
    player:    'rgba(139, 92, 246, 0.38)',
    ball:      'rgba(245, 243, 255, 0.88)',
    trail:     [139, 92, 246],
    ripple:    [196, 181, 253],
  };

  // ── Shared utils ──────────────────────────────────────────────────────────
  function setupCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W   = window.innerWidth;
    const H   = window.innerHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W, H };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  function quadBez(p0, cp, p1, t) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * cp.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * cp.y + t * t * p1.y,
    };
  }

  function rgba([r, g, b], a) { return `rgba(${r},${g},${b},${a})`; }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 1 — "The Match" (side-view game)
  // ══════════════════════════════════════════════════════════════════════════
  function animMatch() {
    let canvas, ctx, W, H, raf;
    let state       = 'idle';   // idle | throwing | hit
    let stateTimer  = 0;
    let throwFrom   = 'right';
    let ballT       = 0;        // 0 = at hand, 1 = at cup
    let throwOrigin = null;     // hand position at start of throw (fixed for ball arc)
    let targetCup   = null;
    let cups        = { left: [], right: [] };
    let ripples     = [];
    let prevTime    = null;

    const IDLE_MS  = 1100;
    const THROW_MS = 1500;
    const HIT_MS   = 500;

    // ── Cups ──────────────────────────────────────────────────────────────
    function buildCups() {
      for (const side of ['left', 'right']) {
        cups[side] = [];
        for (let row = 0; row < 4; row++)
          for (let col = 0; col <= row; col++)
            cups[side].push({ row, col, alive: true, opacity: 1 });
      }
    }

    function cupPos(side, cup) {
      const tY = H * 0.60;
      const tL = W * 0.22, tR = W * 0.78;
      const sp = clamp(W * 0.024, 12, 24);
      const cnt = cup.row + 1;
      const x = side === 'left'
        ? tL + 22 + (3 - cup.row) * sp
        : tR - 22 - (3 - cup.row) * sp;
      const y = tY - (cnt - 1) * sp * 0.85 / 2 + cup.col * sp * 0.85;
      return { x, y };
    }

    function aliveCups(side) { return cups[side].filter(c => c.alive); }

    // ── Table ─────────────────────────────────────────────────────────────
    function drawTable() {
      const tL = W * 0.22, tR = W * 0.78, tY = H * 0.60, tW = tR - tL;

      ctx.fillStyle = 'rgba(88, 28, 135, 0.22)';
      ctx.fillRect(tL, tY - 9, tW, 9);

      const g = ctx.createLinearGradient(0, tY, 0, tY + 14);
      g.addColorStop(0, 'rgba(88,28,135,0.28)');
      g.addColorStop(1, 'rgba(30,6,60,0.08)');
      ctx.fillStyle = g;
      ctx.fillRect(tL, tY, tW, 14);

      ctx.strokeStyle = 'rgba(167,139,250,0.50)';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(tL, tY - 9); ctx.lineTo(tR, tY - 9); ctx.stroke();

      ctx.strokeStyle = 'rgba(109,40,217,0.35)';
      ctx.lineWidth = 2.5;
      for (const lx of [tL + 20, tR - 20]) {
        ctx.beginPath(); ctx.moveTo(lx, tY + 14); ctx.lineTo(lx, tY + 14 + H * 0.09); ctx.stroke();
      }
    }

    // ── Cup ───────────────────────────────────────────────────────────────
    function drawCup(x, y, opacity) {
      const tW = 10, bW = 6, h = 13;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.moveTo(x - tW/2, y - h/2); ctx.lineTo(x + tW/2, y - h/2);
      ctx.lineTo(x + bW/2, y + h/2); ctx.lineTo(x - bW/2, y + h/2);
      ctx.closePath();
      ctx.fillStyle   = 'rgba(49,10,90,0.55)'; ctx.fill();
      ctx.strokeStyle = 'rgba(139,92,246,0.55)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - tW/2 - 1, y - h/2); ctx.lineTo(x + tW/2 + 1, y - h/2);
      ctx.strokeStyle = 'rgba(196,181,253,0.80)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }

    // ── Player ────────────────────────────────────────────────────────────
    // dir: +1 = left player (throws right), -1 = right player (throws left)
    // throwT: -1 = idle, 0..1 = throwing progress
    function drawPlayer(px, py, dir, throwT) {
      ctx.save();
      ctx.strokeStyle = C.player;
      ctx.fillStyle   = C.player;
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';

      // Head
      ctx.beginPath(); ctx.arc(px, py - 54, 11, 0, Math.PI * 2); ctx.fill();
      // Body
      ctx.beginPath(); ctx.moveTo(px, py - 43); ctx.lineTo(px, py - 8); ctx.stroke();
      // Legs
      ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px - 10, py + 28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px + 10, py + 28); ctx.stroke();
      // Off-side arm (hangs away from table)
      ctx.beginPath(); ctx.moveTo(px, py - 32); ctx.lineTo(px - dir * 18, py - 10); ctx.stroke();

      // Throwing arm: Cartesian lerp from wind-up (behind+up) to follow-through (forward+up)
      // This avoids the angle-through-zero problem that caused the arm to dip downward.
      let hx, hy;
      if (throwT < 0) {
        hx = px + dir * 10; hy = py - 10; // idle: hangs slightly toward table
      } else {
        const t = ease(throwT);
        hx = lerp(px - dir * 20, px + dir * 26, t); // behind → forward
        hy = lerp(py - 48,       py - 44,       t); // stays high throughout
      }
      ctx.beginPath(); ctx.moveTo(px, py - 32); ctx.lineTo(hx, hy); ctx.stroke();

      ctx.restore();
      return { hx, hy };
    }

    // ── Update ────────────────────────────────────────────────────────────
    function update(dt) {
      for (const side of ['left', 'right'])
        for (const c of cups[side])
          if (!c.alive && c.opacity > 0)
            c.opacity = Math.max(0, c.opacity - dt * 0.003);

      ripples = ripples.filter(r => r.opacity > 0);
      for (const r of ripples) { r.radius += dt * 0.08; r.opacity -= dt * 0.002; }

      stateTimer += dt;

      if (state === 'idle' && stateTimer >= IDLE_MS) {
        const toSide = throwFrom === 'left' ? 'right' : 'left';
        const alive  = aliveCups(toSide);
        targetCup = alive.length > 0 ? alive[Math.floor(Math.random() * alive.length)] : null;
        // Capture wind-up hand position before throw starts
        const throwerX = throwFrom === 'left' ? W * 0.11 : W * 0.89;
        const throwerY = H * 0.60;
        const throwerDir = throwFrom === 'left' ? 1 : -1;
        throwOrigin = { x: throwerX - throwerDir * 20, y: throwerY - 48 };
        state = 'throwing'; stateTimer = 0; ballT = 0;
      }

      if (state === 'throwing') {
        ballT = clamp(stateTimer / THROW_MS, 0, 1);
        if (ballT >= 1) {
          if (targetCup && targetCup.alive) {
            targetCup.alive = false;
            const toSide = throwFrom === 'left' ? 'right' : 'left';
            const p = cupPos(toSide, targetCup);
            ripples.push({ x: p.x, y: p.y, radius: 6, opacity: 0.75 });
          }
          const toSide = throwFrom === 'left' ? 'right' : 'left';
          if (aliveCups(toSide).length === 0) buildCups();
          throwFrom = throwFrom === 'left' ? 'right' : 'left';
          state = 'hit'; stateTimer = 0;
        }
      }

      if (state === 'hit' && stateTimer >= HIT_MS) {
        state = 'idle'; stateTimer = 0;
      }
    }

    // ── Draw ──────────────────────────────────────────────────────────────
    function draw() {
      ctx.clearRect(0, 0, W, H);
      drawTable();

      for (const side of ['left', 'right'])
        for (const c of cups[side])
          if (c.opacity > 0) { const p = cupPos(side, c); drawCup(p.x, p.y, c.opacity); }

      for (const r of ripples) {
        ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.ripple, r.opacity); ctx.lineWidth = 1.3; ctx.stroke();
      }

      const tY = H * 0.60;
      const lx = W * 0.11, rx = W * 0.89;

      const lT = (throwFrom === 'left'  && state === 'throwing') ? ballT : -1;
      const rT = (throwFrom === 'right' && state === 'throwing') ? ballT : -1;

      const { hx: lHx, hy: lHy } = drawPlayer(lx, tY, +1, lT);
      const { hx: rHx, hy: rHy } = drawPlayer(rx, tY, -1, rT);

      // Ball
      if (state === 'throwing' && targetCup) {
        const toSide = throwFrom === 'left' ? 'right' : 'left';
        const from   = throwOrigin || { x: throwFrom === 'left' ? lHx : rHx, y: throwFrom === 'left' ? lHy : rHy };
        const to     = cupPos(toSide, targetCup);
        const cp     = { x: W * 0.5, y: tY - H * 0.28 };
        const pos    = quadBez(from, cp, to, ease(ballT));

        ctx.save();
        ctx.shadowColor = 'rgba(196,181,253,0.6)'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = C.ball; ctx.fill();
        ctx.restore();
      }
    }

    function loop(ts) {
      raf = requestAnimationFrame(loop);
      const dt = prevTime ? Math.min(ts - prevTime, 50) : 16;
      prevTime = ts;
      update(dt);
      draw();
    }

    return {
      start(c) {
        canvas = c;
        ({ ctx, W, H } = setupCanvas(canvas));
        buildCups();
        window.addEventListener('resize', () => { ({ ctx, W, H } = setupCanvas(canvas)); });
        raf = requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 2 — "Cup Rain" (ambient drift)
  // ══════════════════════════════════════════════════════════════════════════
  function animRain() {
    let canvas, ctx, W, H, raf;
    let cups = [];
    let prevTime = null;
    const COUNT = 36;

    function makeCup(spread) {
      const scale = 0.42 + Math.random() * 0.78;
      const x     = Math.random() * (W || window.innerWidth);
      return {
        x,
        baseX:  x,
        y:      spread ? Math.random() * (H || window.innerHeight) : -(50 * scale + 30),
        vy:     38 + Math.random() * 52,
        scale,
        angle:  (Math.random() - 0.5) * 0.65,
        wPhase: Math.random() * Math.PI * 2,
        wAmp:   18 + Math.random() * 28,
        wFreq:  0.008 + Math.random() * 0.006,
        filled: Math.random() > 0.48,
        opacity: 0.10 + Math.random() * 0.22,
      };
    }

    function drawCupShape(cup) {
      const s    = cup.scale;
      const topW = 22 * s;
      const botW = 12 * s;
      const h    = 30 * s;

      ctx.save();
      ctx.translate(cup.x, cup.y);
      ctx.rotate(cup.angle);
      ctx.globalAlpha = cup.opacity;

      ctx.beginPath();
      ctx.moveTo(-topW / 2, -h / 2);
      ctx.lineTo( topW / 2, -h / 2);
      ctx.lineTo( botW / 2,  h / 2);
      ctx.lineTo(-botW / 2,  h / 2);
      ctx.closePath();

      if (cup.filled) {
        ctx.fillStyle = 'rgba(59, 7, 100, 0.55)';
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(139, 92, 246, 0.65)';
      ctx.lineWidth   = 1.1 / s;
      ctx.stroke();

      // Rim
      ctx.beginPath();
      ctx.moveTo(-topW / 2 - 2 / s, -h / 2);
      ctx.lineTo( topW / 2 + 2 / s, -h / 2);
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.5)';
      ctx.lineWidth   = 1.4 / s;
      ctx.stroke();

      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function init(spread) {
      cups = Array.from({ length: COUNT }, () => makeCup(spread));
    }

    function update(dt) {
      const s = dt / 1000;
      for (const cup of cups) {
        cup.y += cup.vy * s;
        cup.x  = cup.baseX + Math.sin(cup.y * cup.wFreq + cup.wPhase) * cup.wAmp;
        if (cup.y > H + 60 * cup.scale) {
          Object.assign(cup, makeCup(false));
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (const cup of cups) drawCupShape(cup);
    }

    function loop(ts) {
      raf = requestAnimationFrame(loop);
      const dt = prevTime ? Math.min(ts - prevTime, 50) : 16;
      prevTime = ts;
      update(dt);
      draw();
    }

    return {
      start(c) {
        canvas = c;
        ({ ctx, W, H } = setupCanvas(canvas));
        init(true);
        window.addEventListener('resize', () => {
          ({ ctx, W, H } = setupCanvas(canvas));
          init(true);
        });
        raf = requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 3 — "Multiball" (energetic trails)
  // ══════════════════════════════════════════════════════════════════════════
  function animMultiball() {
    let canvas, ctx, W, H, raf;
    let balls   = [];
    let targets = [];
    let ripples = [];
    let prevTime = null;
    const BALL_COUNT   = 6;
    const TARGET_COUNT = 12;
    const TRAIL_LEN    = 24;

    function makeTarget() {
      return {
        x:        W * (0.06 + Math.random() * 0.88),
        y:        H * (0.06 + Math.random() * 0.88),
        cooldown: 0,
      };
    }

    function makeBall(staggerT) {
      const fromLeft = Math.random() < 0.5;
      const x0 = fromLeft ? -10       : W + 10;
      const y0 = H * (0.12 + Math.random() * 0.76);
      const x1 = fromLeft ? W + 10    : -10;
      const y1 = H * (0.12 + Math.random() * 0.76);
      const cp = {
        x: W * (0.18 + Math.random() * 0.64),
        y: H * (0.04 + Math.random() * 0.38),
      };
      return {
        p0: { x: x0, y: y0 },
        cp,
        p1:    { x: x1, y: y1 },
        t:     staggerT ?? Math.random(),
        dur:   2200 + Math.random() * 2000,
        trail: [],
      };
    }

    function init() {
      targets = Array.from({ length: TARGET_COUNT }, makeTarget);
      balls   = Array.from({ length: BALL_COUNT },   () => makeBall(null));
    }

    function update(dt) {
      ripples = ripples.filter(r => r.opacity > 0);
      for (const r of ripples) {
        r.radius  += dt * 0.065;
        r.opacity -= dt * 0.0024;
      }

      for (const b of balls) {
        b.t += dt / b.dur;
        if (b.t >= 1) {
          Object.assign(b, makeBall(0));
          b.trail = [];
          continue;
        }

        const pos = quadBez(b.p0, b.cp, b.p1, ease(b.t));
        b.trail.push({ ...pos });
        if (b.trail.length > TRAIL_LEN) b.trail.shift();

        for (const tgt of targets) {
          tgt.cooldown = Math.max(0, tgt.cooldown - dt);
          if (tgt.cooldown > 0) continue;
          const dx = pos.x - tgt.x, dy = pos.y - tgt.y;
          if (dx * dx + dy * dy < 28 * 28) {
            ripples.push({ x: tgt.x, y: tgt.y, radius: 6, opacity: 0.72 });
            tgt.cooldown = 700;
          }
        }
      }
    }

    function drawTargetCup(tgt) {
      const w = 12, h = 18;
      ctx.save();
      ctx.translate(tgt.x, tgt.y);
      ctx.globalAlpha = 0.17;
      ctx.beginPath();
      ctx.moveTo(-w * 0.55, -h / 2);
      ctx.lineTo( w * 0.55, -h / 2);
      ctx.lineTo( w * 0.28,  h / 2);
      ctx.lineTo(-w * 0.28,  h / 2);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(139,92,246,1)';
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      for (const tgt of targets) drawTargetCup(tgt);

      for (const b of balls) {
        const len = b.trail.length;
        for (let i = 0; i < len - 1; i++) {
          const a = (i / len) * 0.52;
          const r = 1.5 + (i / len) * 4;
          ctx.beginPath();
          ctx.arc(b.trail[i].x, b.trail[i].y, r, 0, Math.PI * 2);
          ctx.fillStyle = rgba(C.trail, a);
          ctx.fill();
        }
        if (len > 0) {
          const head = b.trail[len - 1];
          ctx.beginPath();
          ctx.arc(head.x, head.y, 5.5, 0, Math.PI * 2);
          ctx.fillStyle = C.ball;
          ctx.fill();
        }
      }

      for (const r of ripples) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.ripple, r.opacity);
        ctx.lineWidth   = 1.3;
        ctx.stroke();
      }
    }

    function loop(ts) {
      raf = requestAnimationFrame(loop);
      const dt = prevTime ? Math.min(ts - prevTime, 50) : 16;
      prevTime = ts;
      update(dt);
      draw();
    }

    return {
      start(c) {
        canvas = c;
        ({ ctx, W, H } = setupCanvas(canvas));
        init();
        window.addEventListener('resize', () => {
          ({ ctx, W, H } = setupCanvas(canvas));
          init();
        });
        raf = requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 4 — "Bounce" (arcade billiards)
  // ══════════════════════════════════════════════════════════════════════════
  function animBounce() {
    let canvas, ctx, W, H, raf;
    let balls = [], cups = [], ripples = [];
    let prevTime = null;
    const TRAIL = 20;

    function buildCups() {
      cups = [];
      const sp = clamp(Math.min(W, H) * 0.065, 26, 48);
      for (const [cx, cy] of [[W * 0.27, H * 0.46], [W * 0.73, H * 0.46]]) {
        for (let r = 0; r < 4; r++)
          for (let c = 0; c <= r; c++)
            cups.push({ x: cx + (c - r / 2) * sp, y: cy - r * sp * 0.87,
                        alive: true, opacity: 1, glow: 0 });
      }
    }

    function spawnBall() {
      const angle = Math.PI * (0.22 + Math.random() * 0.56);
      const speed = clamp(W * 0.21, 160, 300);
      return {
        x: W * (0.25 + Math.random() * 0.5),
        y: H * 0.9,
        vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1),
        vy: -Math.sin(angle) * speed,
        trail: [],
        delay: Math.random() * 700,
      };
    }

    function update(dt) {
      const s = dt / 1000;
      ripples = ripples.filter(r => r.o > 0);
      for (const r of ripples) { r.ra += dt * 0.065; r.o -= dt * 0.002; }
      for (const c of cups) {
        if (!c.alive) c.opacity = Math.max(0, c.opacity - s * 1.6);
        c.glow = Math.max(0, c.glow - s * 3);
      }
      if (!cups.some(c => c.alive)) buildCups();

      for (const b of balls) {
        if (b.delay > 0) { b.delay -= dt; continue; }
        b.x += b.vx * s; b.y += b.vy * s;
        if (b.x < 7)   { b.x = 7;   b.vx =  Math.abs(b.vx); }
        if (b.x > W-7) { b.x = W-7; b.vx = -Math.abs(b.vx); }
        if (b.y < 7)   { b.y = 7;   b.vy =  Math.abs(b.vy); }
        if (b.y > H + 30) { Object.assign(b, spawnBall()); b.trail = []; continue; }
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > TRAIL) b.trail.shift();

        for (const c of cups) {
          if (!c.alive) continue;
          const dx = b.x - c.x, dy = b.y - c.y, d2 = dx * dx + dy * dy;
          if (d2 < 13 * 13) {
            c.alive = false; c.glow = 1;
            ripples.push({ x: c.x, y: c.y, ra: 5, o: 0.8 });
            const dot = (b.vx * dx + b.vy * dy) / d2;
            b.vx -= 2 * dot * dx; b.vy -= 2 * dot * dy;
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (const c of cups) {
        if (c.opacity <= 0) continue;
        ctx.save(); ctx.globalAlpha = c.opacity;
        const r = 10 + c.glow * 5;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(49,10,90,0.55)'; ctx.fill();
        ctx.strokeStyle = `rgba(139,92,246,${0.5 + c.glow * 0.5})`; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(c.x, c.y, r, Math.PI * 1.15, Math.PI * 1.85);
        ctx.strokeStyle = `rgba(196,181,253,${0.35 + c.glow * 0.5})`; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }
      for (const r of ripples) {
        ctx.beginPath(); ctx.arc(r.x, r.y, r.ra, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.ripple, r.o); ctx.lineWidth = 1.2; ctx.stroke();
      }
      for (const b of balls) {
        if (b.delay > 0) continue;
        const n = b.trail.length;
        for (let i = 0; i < n; i++) {
          ctx.beginPath(); ctx.arc(b.trail[i].x, b.trail[i].y, 1 + (i / n) * 3, 0, Math.PI * 2);
          ctx.fillStyle = rgba(C.trail, (i / n) * 0.42); ctx.fill();
        }
        ctx.save();
        ctx.shadowColor = 'rgba(196,181,253,0.7)'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = C.ball; ctx.fill();
        ctx.restore();
      }
    }

    function loop(ts) {
      raf = requestAnimationFrame(loop);
      const dt = prevTime ? Math.min(ts - prevTime, 50) : 16;
      prevTime = ts; update(dt); draw();
    }

    return {
      start(c) {
        canvas = c; ({ ctx, W, H } = setupCanvas(canvas));
        buildCups();
        balls = Array.from({ length: 3 }, spawnBall);
        window.addEventListener('resize', () => {
          ({ ctx, W, H } = setupCanvas(canvas));
          buildCups(); balls = Array.from({ length: 3 }, spawnBall);
        });
        raf = requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 5 — "Grid" (pulsing cup field)
  // ══════════════════════════════════════════════════════════════════════════
  function animGrid() {
    let canvas, ctx, W, H, raf;
    let t = 0, grid = [], balls = [], ripples = [];
    let prevTime = null, nextBall = 1200;
    const COLS = 9, ROWS = 7;

    function buildGrid() {
      grid = [];
      const px = W * 0.07, py = H * 0.09;
      const sx = (W - px * 2) / (COLS - 1), sy = (H - py * 2) / (ROWS - 1);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          grid.push({ x: px + c * sx, y: py + r * sy, phase: (r * COLS + c) * 0.42, hit: 0 });
    }

    function spawnBall() {
      const fromLeft = Math.random() < 0.5;
      const spd = clamp(W * 0.13, 90, 180);
      return {
        x: fromLeft ? -8 : W + 8,
        y: H * (0.12 + Math.random() * 0.76),
        vx: fromLeft ? spd : -spd,
        vy: (Math.random() - 0.5) * 70,
        trail: [], done: false,
      };
    }

    function update(dt) {
      t += dt * 0.001;
      nextBall -= dt;
      if (nextBall <= 0) { balls.push(spawnBall()); nextBall = 1600 + Math.random() * 1400; }
      ripples = ripples.filter(r => r.o > 0);
      for (const r of ripples) { r.ra += dt * 0.055; r.o -= dt * 0.0018; }
      for (const g of grid) g.hit = Math.max(0, g.hit - dt * 0.002);
      balls = balls.filter(b => !b.done);
      const s = dt / 1000;
      for (const b of balls) {
        b.x += b.vx * s; b.y += b.vy * s;
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 22) b.trail.shift();
        if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) { b.done = true; continue; }
        for (const g of grid) {
          const dx = b.x - g.x, dy = b.y - g.y;
          if (dx * dx + dy * dy < 18 * 18 && g.hit < 0.1) {
            g.hit = 1;
            ripples.push({ x: g.x, y: g.y, ra: 4, o: 0.65 });
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (const g of grid) {
        const pulse = (Math.sin(t * 2.1 + g.phase) + 1) * 0.5;
        const r = 5 + pulse * 2.5 + g.hit * 5;
        const alpha = 0.14 + pulse * 0.18 + g.hit * 0.45;
        ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(139,92,246,${alpha})`; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath(); ctx.arc(g.x, g.y, r * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(59,7,100,${0.22 + pulse * 0.22 + g.hit * 0.28})`; ctx.fill();
      }
      for (const r of ripples) {
        ctx.beginPath(); ctx.arc(r.x, r.y, r.ra, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.ripple, r.o); ctx.lineWidth = 1.1; ctx.stroke();
      }
      for (const b of balls) {
        const n = b.trail.length;
        for (let i = 0; i < n; i++) {
          ctx.beginPath(); ctx.arc(b.trail[i].x, b.trail[i].y, 1 + (i / n) * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = rgba(C.trail, (i / n) * 0.38); ctx.fill();
        }
        if (n > 0) {
          ctx.save();
          ctx.shadowColor = 'rgba(196,181,253,0.7)'; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = C.ball; ctx.fill();
          ctx.restore();
        }
      }
    }

    function loop(ts) {
      raf = requestAnimationFrame(loop);
      const dt = prevTime ? Math.min(ts - prevTime, 50) : 16;
      prevTime = ts; update(dt); draw();
    }

    return {
      start(c) {
        canvas = c; ({ ctx, W, H } = setupCanvas(canvas));
        buildGrid();
        window.addEventListener('resize', () => { ({ ctx, W, H } = setupCanvas(canvas)); buildGrid(); });
        raf = requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANIMATION 6 — "Orbit" (concentric cup rings)
  // ══════════════════════════════════════════════════════════════════════════
  function animOrbit() {
    let canvas, ctx, W, H, raf;
    let t = 0, rings = [], balls = [], ripples = [];
    let prevTime = null;
    const RING_COUNT = 4;

    function buildRings() {
      rings = [];
      const base = Math.min(W, H) * 0.1;
      const max  = Math.min(W, H) * 0.43;
      for (let i = 0; i < RING_COUNT; i++) {
        const r      = base + (max - base) * (i / (RING_COUNT - 1));
        const count  = 4 + i * 3;
        const speed  = (0.28 / (i + 1)) * (i % 2 === 0 ? 1 : -1);
        const cups   = Array.from({ length: count }, (_, j) => ({
          angle: (j / count) * Math.PI * 2,
          hit: 0,
        }));
        rings.push({ r, speed, offset: Math.random() * Math.PI * 2, cups });
      }
      balls = rings.map((ring, i) => ({
        ringIdx: i,
        angle:   Math.random() * Math.PI * 2,
        speed:   ring.speed * (2.1 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1),
        trail:   [],
        cx: 0, cy: 0,
      }));
    }

    function cupXY(ring, cup) {
      const a = cup.angle + ring.offset;
      return { x: W / 2 + Math.cos(a) * ring.r, y: H / 2 + Math.sin(a) * ring.r };
    }

    function update(dt) {
      t += dt * 0.001;
      ripples = ripples.filter(r => r.o > 0);
      for (const r of ripples) { r.ra += dt * 0.055; r.o -= dt * 0.0018; }
      for (const ring of rings) {
        ring.offset += ring.speed * dt * 0.001;
        for (const c of ring.cups) c.hit = Math.max(0, c.hit - dt * 0.002);
      }
      for (const b of balls) {
        b.angle += b.speed * dt * 0.001;
        const ring = rings[b.ringIdx];
        b.cx = W / 2 + Math.cos(b.angle) * ring.r;
        b.cy = H / 2 + Math.sin(b.angle) * ring.r;
        b.trail.push({ x: b.cx, y: b.cy });
        if (b.trail.length > 20) b.trail.shift();
        for (const c of ring.cups) {
          const { x, y } = cupXY(ring, c);
          const dx = b.cx - x, dy = b.cy - y;
          if (dx * dx + dy * dy < 11 * 11 && c.hit < 0.1) {
            c.hit = 1;
            ripples.push({ x, y, ra: 4, o: 0.65 });
          }
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      // Faint ring guides
      for (const ring of rings) {
        ctx.beginPath(); ctx.arc(W / 2, H / 2, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(109,40,217,0.07)'; ctx.lineWidth = 1; ctx.stroke();
      }
      // Cups
      for (const ring of rings) {
        for (const c of ring.cups) {
          const { x, y } = cupXY(ring, c);
          const r = 5.5 + c.hit * 5;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(139,92,246,${0.28 + c.hit * 0.5})`; ctx.lineWidth = 1.3; ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(59,7,100,${0.35 + c.hit * 0.3})`; ctx.fill();
        }
      }
      // Ripples
      for (const r of ripples) {
        ctx.beginPath(); ctx.arc(r.x, r.y, r.ra, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.ripple, r.o); ctx.lineWidth = 1.1; ctx.stroke();
      }
      // Balls + trails
      for (const b of balls) {
        const n = b.trail.length;
        for (let i = 0; i < n; i++) {
          ctx.beginPath(); ctx.arc(b.trail[i].x, b.trail[i].y, 1 + (i / n) * 3, 0, Math.PI * 2);
          ctx.fillStyle = rgba(C.trail, (i / n) * 0.38); ctx.fill();
        }
        ctx.save();
        ctx.shadowColor = 'rgba(196,181,253,0.7)'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(b.cx, b.cy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = C.ball; ctx.fill();
        ctx.restore();
      }
    }

    function loop(ts) {
      raf = requestAnimationFrame(loop);
      const dt = prevTime ? Math.min(ts - prevTime, 50) : 16;
      prevTime = ts; update(dt); draw();
    }

    return {
      start(c) {
        canvas = c; ({ ctx, W, H } = setupCanvas(canvas));
        buildRings();
        window.addEventListener('resize', () => { ({ ctx, W, H } = setupCanvas(canvas)); buildRings(); });
        raf = requestAnimationFrame(loop);
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────
  window.ANIMATIONS = [animMatch(), animRain(), animMultiball(), animBounce(), animGrid(), animOrbit()];
}());
