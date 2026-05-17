/* CROW ARCHER — UI Kit game loop.
   Wires the spec library into a playable demonstration. */

(function () {
  'use strict';
  const A = window.CrowArcher;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const W = 800, H = 544;
  const HUD_H = 32;
  const WORLD_Y = HUD_H;
  const TS = 32;
  const GW = 25, GH = 16;

  // ---------- TILEMAP ----------
  const TILE = { EMPTY: 0, ROCK: 1, WATER: 2, TREE: 3 };
  const map = new Array(GW * GH);
  function tileAt(gx, gy) { return map[gy * GW + gx]; }
  function setTile(gx, gy, t) { map[gy * GW + gx] = t; }
  // seeded map (deterministic-ish from coords)
  function buildMap() {
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) setTile(x, y, TILE.EMPTY);
    // a pond
    for (const [x, y] of [[3,8],[4,8],[3,9],[4,9],[5,9],[4,10],[5,10],[2,9]]) setTile(x, y, TILE.WATER);
    // rocks scattered
    for (const [x, y] of [[9,3],[15,5],[20,4],[18,11],[8,12],[22,9],[12,14],[2,3],[13,8],[19,13]]) setTile(x, y, TILE.ROCK);
    // trees
    for (const [x, y] of [[1,5],[6,2],[7,3],[10,1],[14,2],[17,3],[22,1],[23,2],[1,13],[6,14],[10,11],[16,8],[11,5],[20,7],[24,12]]) setTile(x, y, TILE.TREE);
  }
  buildMap();

  function drawTilemap(loopT) {
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const t = tileAt(x, y);
        const px = x * TS;
        const py = WORLD_Y + y * TS;
        if (t === TILE.EMPTY) A.drawGroundTile(ctx, px, py);
        else if (t === TILE.ROCK) A.drawRockTile(ctx, px, py);
        else if (t === TILE.WATER) A.drawWaterTile(ctx, px, py, loopT);
        else if (t === TILE.TREE) {
          A.drawGroundTile(ctx, px, py);
          A.drawTreeTile(ctx, px, py, loopT);
        }
      }
    }
  }
  function isWater(x, y) {
    const gx = Math.floor(x / TS), gy = Math.floor((y - WORLD_Y) / TS);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return false;
    return tileAt(gx, gy) === TILE.WATER;
  }
  function isSolid(x, y) {
    const gx = Math.floor(x / TS), gy = Math.floor((y - WORLD_Y) / TS);
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return true;
    const t = tileAt(gx, gy);
    return t === TILE.ROCK || t === TILE.WATER || t === TILE.TREE;
  }

  // ---------- STATE ----------
  const keys = new Set();
  const mouse = { x: W / 2, y: H / 2, down: false };
  let bowCharge = 0;
  let chargeStart = 0;
  let walkPhase = 0;
  let player = {
    x: 400, y: 280,
    speed: 110,
    hp: 4, hpMax: 5,
    arrowMode: 'normal', // normal | ricochet | fire
    arrowsRic: 8,
    arrowsFire: 5,
    dynamite: 3,
    score: 1240,
    wave: 4,
    hitFlash: 0,
  };
  let bossActive = false;
  let incoming = 0; // banner countdown

  const crows = [];
  const arrows = [];
  const dyns = [];
  const pickups = [];
  const firePatches = [];
  let pitchfork = null;
  const ps = new A.Particles(200);
  let fireTrailEmit = 0;
  let emberEmit = 0;

  function spawnCrow(opts) {
    const c = {
      x: Math.random() * W,
      y: WORLD_Y + 40 + Math.random() * 100,
      vx: 0, vy: 0,
      facing: -1,
      wingPhase: Math.random() * Math.PI * 2,
      entityPhase: Math.random() * Math.PI * 2,
      target: null,
      aggro: false,
      aggroT: 0,
      white: false,
      dead: false,
      ...opts,
    };
    crows.push(c);
    return c;
  }
  function spawnPickup(type, x, y) {
    pickups.push({ type, x, y, bobPhase: Math.random() * Math.PI * 2, taken: false });
  }
  function resetWave() {
    crows.length = 0;
    for (let i = 0; i < 6; i++) spawnCrow();
    spawnCrow({ white: true });
    spawnCrow({ white: true });
    pickups.length = 0;
    spawnPickup('ricochet', 6 * TS + 16, WORLD_Y + 4 * TS + 16);
    spawnPickup('fire',     17 * TS + 16, WORLD_Y + 7 * TS + 16);
    bossActive = false;
  }
  resetWave();

  // ---------- INPUT ----------
  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key === ' ') swing();
    if (e.key.toLowerCase() === 'e') dropDynamite();
    if (e.key === '1') player.arrowMode = 'normal';
    if (e.key === '2') player.arrowMode = 'ricochet';
    if (e.key === '3') player.arrowMode = 'fire';
    if (e.key.toLowerCase() === 'b') { bossActive = !bossActive; if (bossActive) { incoming = 1.4; spawnBoss(); } else removeBoss(); }
    if (e.key.toLowerCase() === 'h') player.hp = (player.hp <= 1 ? player.hpMax : Math.max(1, player.hp - 1));
    if (e.key.toLowerCase() === 'k') killRandomCrow();
    if (e.key.toLowerCase() === 'r') { player.hp = player.hpMax; resetWave(); }
    if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (W / r.width);
    mouse.y = (e.clientY - r.top) * (H / r.height);
  });
  canvas.addEventListener('mousedown', () => { mouse.down = true; chargeStart = performance.now() / 1000; });
  canvas.addEventListener('mouseup', () => {
    if (mouse.down) fireArrow();
    mouse.down = false;
    bowCharge = 0;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function aimAngle() { return Math.atan2(mouse.y - player.y, mouse.x - player.x); }

  function fireArrow() {
    const ang = aimAngle();
    const sp = 360 + 240 * bowCharge;
    const base = {
      x: player.x + Math.cos(ang) * 12,
      y: player.y + Math.sin(ang) * 12,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      angle: ang,
      life: 2.0,
      type: 'normal',
    };
    if (player.arrowMode === 'ricochet' && player.arrowsRic > 0) {
      arrows.push({ ...base, type: 'ricochet', trailHistory: [], bouncesLeft: 3 });
      player.arrowsRic--;
    } else if (player.arrowMode === 'fire' && player.arrowsFire > 0) {
      arrows.push({ ...base, type: 'fire', fireSeed: Math.random() * 1000 });
      player.arrowsFire--;
    } else {
      arrows.push(base);
    }
    bowCharge = 0;
  }

  function swing() {
    if (pitchfork) return;
    pitchfork = { swingT: 0, swingAngle: aimAngle(), sparked: false };
  }

  function dropDynamite() {
    if (player.dynamite <= 0) return;
    player.dynamite--;
    const ang = aimAngle();
    dyns.push({
      x: player.x + Math.cos(ang) * 40,
      y: player.y + Math.sin(ang) * 40,
      fuseT: 3.0, fuseTotal: 3.0,
      bobPhase: Math.random() * Math.PI * 2,
    });
  }

  let boss = null;
  function spawnBoss() {
    boss = {
      x: -60, y: WORLD_Y + 6 * TS,
      vx: 60, vy: 0,
      wingPhase: 0, entityPhase: Math.random() * Math.PI * 2,
      facing: -1,
      hp: 30,
    };
  }
  function removeBoss() {
    if (boss) {
      // 3-wave death burst
      ps.burst(boss.x, boss.y, {
        shape: 'circle', colors: ['#050505','#1A1A1A','#3A3A3A','#5A0808'],
        count: 32, speedMin: 60, speedMax: 200, decay: 1.0, gravity: 30, damping: 0.4,
        sizeMin: 2, sizeMax: 4,
      });
      setTimeout(() => boss && ps.burst(boss.x, boss.y, {
        shape: 'spark', colors: ['#FF1F1F','#8A1010','#FFB400'],
        count: 18, speedMin: 120, speedMax: 280, decay: 1.4, shadowBlur: 6,
      }), 80);
      setTimeout(() => boss && ps.burst(boss.x, boss.y, {
        shape: 'circle', colors: ['#FFB400','#FFFFFF','#FF7A1F'],
        count: 8, speedMin: 30, speedMax: 80, decay: 0.9, sizeMin: 3, sizeMax: 6,
        shadowBlur: 16, shadowColor: '#FFB400',
      }), 160);
      setTimeout(() => { boss = null; bossActive = false; }, 400);
    }
  }
  function killRandomCrow() {
    const alive = crows.filter(c => !c.dead);
    if (!alive.length) return;
    const c = alive[Math.floor(Math.random() * alive.length)];
    killCrow(c);
  }
  function killCrow(c) {
    if (c.dead) return;
    c.dead = true;
    ps.burst(c.x, c.y, {
      shapeMix: [['circle', 0.8], ['spark', 0.2]],
      colors: ['#0A0A0A','#1F1F1F','#3A3A3A','#FFB400'],
      count: 14,
      speedMin: 40, speedMax: 120,
      decay: 1.8,
      damping: 0.6,
      shadowBlur: 4,
      forceColor: '#FFB400',
    });
    player.score += c.white ? 25 : 10;
    // periodically respawn
    setTimeout(() => {
      const idx = crows.indexOf(c);
      if (idx >= 0) crows.splice(idx, 1);
      if (crows.length < 8) spawnCrow({ white: Math.random() < 0.2 });
    }, 600);
  }
  function explode(x, y) {
    // ground / water?
    if (isWater(x, y)) {
      ps.burst(x, y, {
        shapeMix: [['spark', 0.7], ['circle', 0.3]],
        colors: ['#2A66B0','#5A92D8','#A0C8F0','#FFFFFF'],
        count: 22,
        speedMin: 120, speedMax: 260,
        decay: 1.6, gravity: 380,
        shadowBlur: 4,
      });
      // bias upward
      for (const p of ps.list.slice(-22)) p.vy = -Math.abs(p.vy) * 1.6;
      return;
    }
    // 3-wave
    ps.burst(x, y, {
      shape: 'circle', colors: ['#FFFFFF','#FFB400'],
      count: 12, speedMin: 200, speedMax: 360, decay: 4.0,
      sizeMin: 2, sizeMax: 5, shadowBlur: 16, shadowColor: '#FFFFFF',
    });
    setTimeout(() => ps.burst(x, y, {
      shape: 'circle', colors: ['#FF7A1F','#FF1F1F','#FFB400','#8A1010'],
      count: 36, speedMin: 120, speedMax: 260, decay: 1.2, damping: 0.5,
      sizeMin: 2.5, sizeMax: 5, shadowBlur: 10, shadowColor: '#FF7A1F',
    }), 30);
    setTimeout(() => ps.burst(x, y, {
      shape: 'circle', colors: ['#3A3A3A','#1A1A1A','#5C5C5C'],
      count: 12, speedMin: 30, speedMax: 80, decay: 0.5, gravity: -10,
      sizeMin: 4, sizeMax: 7,
    }), 120);
    firePatches.push({ x, y, lifeT: 3.5, lifeTotal: 4, patchPhase: Math.random() * Math.PI * 2 });
    // kill nearby crows
    for (const c of crows) {
      if (!c.dead && Math.hypot(c.x - x, c.y - y) < 60) killCrow(c);
    }
    // screen shake
    shakeAmt = 6;
  }

  let shakeAmt = 0;

  // ---------- UPDATE ----------
  function update(dt, loopT) {
    // player walk
    let mx = 0, my = 0;
    if (keys.has('a')) mx -= 1;
    if (keys.has('d')) mx += 1;
    if (keys.has('w')) my -= 1;
    if (keys.has('s')) my += 1;
    const moving = (mx || my);
    if (moving) {
      const m = Math.hypot(mx, my) || 1;
      mx /= m; my /= m;
      const nx = player.x + mx * player.speed * dt;
      const ny = player.y + my * player.speed * dt;
      if (!isSolid(nx, player.y)) player.x = nx;
      if (!isSolid(player.x, ny)) player.y = ny;
      walkPhase += 8 * dt;
    }
    player.x = Math.max(12, Math.min(W - 12, player.x));
    player.y = Math.max(WORLD_Y + 12, Math.min(H - 12, player.y));

    // bow charge
    if (mouse.down) bowCharge = Math.min(1, (performance.now() / 1000 - chargeStart) / 0.6);

    // crows
    for (const c of crows) {
      if (c.dead) continue;
      c.wingPhase += (c.white ? 14 : 12) * dt;
      // wander toward player slowly
      const dx = player.x - c.x, dy = player.y - c.y;
      const dist = Math.hypot(dx, dy);
      const close = dist < 220;
      c.aggro = close;
      if (c.aggro) c.aggroT += dt;
      else c.aggroT = 0;
      const sp = c.aggro ? 90 : 35;
      const target = c.aggro ? { dx, dy, dist } : { dx: Math.cos(c.entityPhase + loopT * 0.2), dy: Math.sin(c.entityPhase + loopT * 0.2), dist: 1 };
      c.vx = (target.dx / Math.max(1, target.dist)) * sp;
      c.vy = (target.dy / Math.max(1, target.dist)) * sp;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.facing = c.vx < 0 ? -1 : 1;
    }

    // boss
    if (boss) {
      boss.wingPhase += 5 * dt;
      // drift toward right, then left, etc
      boss.x += boss.vx * dt;
      boss.y = WORLD_Y + 6 * TS + Math.sin(loopT * 0.5) * 30;
      if (boss.x > W + 60) boss.vx = -60;
      if (boss.x < -60) boss.vx = 60;
      boss.facing = boss.vx < 0 ? -1 : 1;
    }

    // arrows
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      // trail history for ricochet
      if (a.type === 'ricochet') {
        a.trailHistory.unshift({ x: a.x, y: a.y, angle: a.angle });
        if (a.trailHistory.length > 6) a.trailHistory.length = 6;
      }
      // fire trail emit
      if (a.type === 'fire') {
        fireTrailEmit += dt;
        while (fireTrailEmit > 0.03) {
          ps.burst(a.x, a.y, {
            shape: 'circle',
            colors: ['#FF7A1F','#FFB400','#FFFFFF'],
            count: 1,
            speedMin: 0, speedMax: 20,
            decay: 3.0, sizeMin: 1.5, sizeMax: 2.5,
            gravity: -40, shadowBlur: 8,
          });
          fireTrailEmit -= 0.03;
        }
      }
      const prevX = a.x, prevY = a.y;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.angle = Math.atan2(a.vy, a.vx);
      a.life -= dt;
      // collide with walls
      const oob = (a.x < 0 || a.x > W || a.y < WORLD_Y || a.y > H);
      const hitSolid = !oob && isSolid(a.x, a.y);
      if (oob || hitSolid) {
        if (a.type === 'ricochet' && !oob && a.bouncesLeft > 0) {
          // crude axis-based bounce
          a.bouncesLeft--;
          a.x = prevX; a.y = prevY;
          // attempt: flip x or y velocity component
          if (isSolid(a.x + a.vx * dt, a.y)) a.vx = -a.vx;
          else a.vy = -a.vy;
        } else {
          if (a.type === 'fire') firePatches.push({ x: a.x, y: a.y, lifeT: 3, lifeTotal: 4, patchPhase: Math.random() * Math.PI * 2 });
          arrows.splice(i, 1);
          continue;
        }
      }
      if (a.life <= 0) { arrows.splice(i, 1); continue; }
      // hit crow?
      for (const c of crows) {
        if (c.dead) continue;
        if (Math.hypot(c.x - a.x, c.y - a.y) < 10) {
          killCrow(c);
          if (a.type !== 'ricochet' || a.bouncesLeft <= 0) {
            if (a.type === 'fire') firePatches.push({ x: a.x, y: a.y, lifeT: 3, lifeTotal: 4, patchPhase: Math.random() * Math.PI * 2 });
            arrows.splice(i, 1);
            break;
          }
        }
      }
    }

    // dynamites
    for (let i = dyns.length - 1; i >= 0; i--) {
      const d = dyns[i];
      d.fuseT -= dt;
      if (d.fuseT <= 0) {
        explode(d.x, d.y);
        dyns.splice(i, 1);
      }
    }

    // pickups — collect by walking over
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (Math.hypot(p.x - player.x, p.y - player.y) < 16) {
        if (p.type === 'ricochet') {
          player.arrowsRic += 6;
          ps.burst(p.x, p.y, {
            shape: 'spark', colors: ['#39E0FF','#7AF0FF','#FFFFFF'],
            count: 12, speedMin: 80, speedMax: 160, decay: 2.2,
            ringTight: true, shadowBlur: 6,
          });
        } else {
          player.arrowsFire += 4;
          ps.burst(p.x, p.y, {
            shapeMix: [['circle', 0.6], ['spark', 0.4]],
            colors: ['#FFB400','#FF7A1F','#FFFFFF','#B23A00'],
            count: 16, speedMin: 50, speedMax: 140, decay: 1.6,
            gravity: -20, shadowBlur: 8,
          });
        }
        pickups.splice(i, 1);
        // respawn after 6s
        const type = p.type;
        setTimeout(() => spawnPickup(type, 60 + Math.random() * (W - 120), WORLD_Y + 60 + Math.random() * (H - WORLD_Y - 120)), 6000);
      }
    }

    // fire patches — ember emission + lifetime
    emberEmit += dt;
    while (emberEmit > 1 / 8) {
      for (const fp of firePatches) {
        if (fp.lifeT <= 0) continue;
        const ax = fp.x + (Math.random() - 0.5) * 20;
        const ay = fp.y + (Math.random() - 0.5) * 10;
        ps.burst(ax, ay, {
          shape: 'spark',
          colors: ['#FFB400','#FF7A1F','#FFFFFF'],
          count: 1,
          speedMin: 20, speedMax: 60,
          decay: 1.5, gravity: -80, shadowBlur: 6,
        });
      }
      emberEmit -= 1 / 8;
    }
    for (let i = firePatches.length - 1; i >= 0; i--) {
      firePatches[i].lifeT -= dt;
      if (firePatches[i].lifeT <= -1) firePatches.splice(i, 1);
    }

    // pitchfork
    if (pitchfork) {
      pitchfork.swingT += dt;
      const WINDUP = 0.12, STRIKE = 0.18;
      if (!pitchfork.sparked && pitchfork.swingT >= WINDUP) {
        pitchfork.sparked = true;
        // emit sparks at tine positions
        const a = pitchfork.swingAngle;
        for (const ty of [-5, 0, 5]) {
          const tipX = player.x + Math.cos(a) * 8 + Math.cos(a) * 36 - Math.sin(a) * ty;
          const tipY = player.y + Math.sin(a) * 8 + Math.sin(a) * 36 + Math.cos(a) * ty;
          ps.burst(tipX, tipY, {
            shape: 'spark',
            colors: ['#FFFFFF','#39FF14','#D9D9D9'],
            count: 4, speedMin: 90, speedMax: 160, decay: 3.0,
            gravity: 60, damping: 0.8,
            angleBias: { angle: a, spread: 0.8 },
            shadowBlur: 6,
          });
        }
        // hit crows in arc
        for (const c of crows) {
          if (c.dead) continue;
          const dx = c.x - player.x, dy = c.y - player.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 44) {
            const an = Math.atan2(dy, dx);
            let diff = ((an - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            if (Math.abs(diff) < 0.6) killCrow(c);
          }
        }
      }
      if (pitchfork.swingT >= 0.36) pitchfork = null;
    }

    // particles
    ps.update(dt);

    // incoming banner timer
    if (incoming > 0) incoming -= dt;

    // shake decay
    shakeAmt *= 0.85;
  }

  // ---------- DRAW ----------
  function drawWorld(loopT) {
    // tilemap
    drawTilemap(loopT);

    // ground-level fire patches (under entities)
    for (const fp of firePatches) A.drawFirePatch(ctx, fp.x, fp.y, { loopT, patchPhase: fp.patchPhase, lifeT: fp.lifeT });

    // pickups
    for (const p of pickups) {
      if (p.type === 'ricochet') A.drawPickupRicochet(ctx, p.x, p.y, { loopT, bobPhase: p.bobPhase });
      else A.drawPickupFire(ctx, p.x, p.y, { loopT, bobPhase: p.bobPhase });
    }

    // dynamites
    for (const d of dyns) A.drawDynamite(ctx, d.x, d.y, { fuseT: d.fuseT, fuseTotal: d.fuseTotal, bobPhase: d.bobPhase, loopT });

    // crows
    for (const c of crows) {
      if (c.dead) continue;
      if (c.white) A.drawCrowWhite(ctx, c.x, c.y, { wingPhase: c.wingPhase, entityPhase: c.entityPhase, loopT, facing: c.facing });
      else A.drawCrow(ctx, c.x, c.y, { wingPhase: c.wingPhase, entityPhase: c.entityPhase, loopT, facing: c.facing });
      if (c.aggro) A.drawAggroOverlay(ctx, c.x, c.y, { vx: c.vx, vy: c.vy, loopT });
    }

    // boss
    if (boss) A.drawBoss(ctx, boss.x, boss.y, { wingPhase: boss.wingPhase, entityPhase: boss.entityPhase, loopT, facing: boss.facing });

    // player
    const ang = aimAngle();
    A.drawPlayer(ctx, player.x, player.y, {
      aimAngle: ang,
      bowCharge,
      walkPhase,
      cloakSway: 0.15 * Math.sin(loopT * 2.2),
      moving: keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d'),
    });
    if (pitchfork) A.drawPitchfork(ctx, player.x, player.y, { swingT: pitchfork.swingT, swingAngle: pitchfork.swingAngle, loopT });

    // arrows
    for (const a of arrows) {
      if (a.type === 'ricochet') A.drawArrowRicochet(ctx, a.x, a.y, a.angle, { trailHistory: a.trailHistory.slice(1), bouncesLeft: a.bouncesLeft });
      else if (a.type === 'fire') A.drawArrowFire(ctx, a.x, a.y, a.angle, { loopT, fireSeed: a.fireSeed });
      else A.drawArrow(ctx, a.x, a.y, a.angle);
    }

    // particles
    ps.draw(ctx);
  }

  function drawHud(loopT) {
    // HUD bg
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, HUD_H);
    // phosphor separator
    ctx.strokeStyle = '#39FF14';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#39FF14';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(0, HUD_H - 0.5); ctx.lineTo(W, HUD_H - 0.5);
    ctx.stroke();

    ctx.font = '12px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.shadowBlur = 4;

    // HP with low-HP pulse
    let hpColor = '#39FF14', hpGlow = '#39FF14';
    if (player.hp <= 1) {
      const pulse = 0.6 + 0.4 * Math.sin(loopT * 6);
      hpColor = `rgba(255,31,31, ${pulse})`;
      hpGlow = '#FF1F1F';
    } else if (player.hp <= 2) {
      hpColor = '#FFB400'; hpGlow = '#FFB400';
    }
    ctx.fillStyle = hpColor;
    ctx.shadowColor = hpGlow;
    ctx.fillText(`HP ${String(player.hp).padStart(2, '0')}/${String(player.hpMax).padStart(2, '0')}`, 12, HUD_H / 2);

    ctx.fillStyle = '#39FF14';
    ctx.shadowColor = '#39FF14';
    const arrowCount = player.arrowMode === 'ricochet' ? player.arrowsRic :
                       player.arrowMode === 'fire' ? player.arrowsFire : 99;
    ctx.fillText(`ARROWS x${String(arrowCount).padStart(2, '0')}`, 110, HUD_H / 2);
    ctx.fillText(`WAVE ${String(player.wave).padStart(2, '0')}`, 240, HUD_H / 2);
    ctx.fillText(`SCORE ${String(player.score).padStart(5, '0')}`, 330, HUD_H / 2);
    ctx.fillText(`TNT x${player.dynamite}`, 470, HUD_H / 2);

    // mode badge
    ctx.strokeStyle = '#39FF14';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.strokeRect(560.5, 8.5, 230, 16);
    ctx.shadowBlur = 4;
    const mode = player.arrowMode.toUpperCase();
    const modeColor = player.arrowMode === 'fire' ? '#FF7A1F' :
                      player.arrowMode === 'ricochet' ? '#39E0FF' : '#39FF14';
    ctx.fillStyle = modeColor;
    ctx.shadowColor = modeColor;
    ctx.fillText(`MODE [ ${mode} ]   1 / 2 / 3`, 568, HUD_H / 2);
    ctx.shadowBlur = 0;

    // INCOMING banner
    if (incoming > 0) {
      const flash = 4 + 6 * Math.abs(Math.sin(loopT * 8));
      ctx.fillStyle = '#FF1F1F';
      ctx.shadowColor = '#FF1F1F';
      ctx.shadowBlur = flash;
      ctx.font = 'bold 24px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(bossActive ? 'BOSS APPROACHING' : 'INCOMING', W / 2, HUD_H + 80);
      ctx.shadowBlur = 0;
    }
  }

  // ---------- AUTO-DEMO ORCHESTRATOR ----------
  // Continuously spawns every concept so the kit shows the full system on its own.
  // User input takes precedence (any keypress/click suspends the demo for 6s).
  let demoIdle = 0;
  let lastInputT = 0;
  function noteInput() { lastInputT = performance.now() / 1000; }
  window.addEventListener('keydown', noteInput);
  canvas.addEventListener('mousedown', noteInput);
  canvas.addEventListener('mousemove', () => { /* don't count mouse-move */ });

  const demo = {
    nextRic: 1.5,
    nextFire: 3.0,
    nextDyn: 4.5,
    nextBoss: 10.0,
    nextPatch: 6.0,
    bossUp: false,
  };

  // pre-seed: place a single fire patch and a fused dynamite right at start so the kit shows them immediately
  firePatches.push({ x: 6 * TS + 16, y: WORLD_Y + 10 * TS + 16, lifeT: 8, lifeTotal: 8, patchPhase: 0 });
  dyns.push({ x: 15 * TS + 16, y: WORLD_Y + 9 * TS + 16, fuseT: 2.6, fuseTotal: 3.0, bobPhase: 0 });
  // Lower the player's TNT count to compensate (kit, not gameplay)
  player.dynamite = 2;
  // Pre-seed the boss on stage so first-render captures it
  spawnBoss();
  boss.x = 540; boss.y = WORLD_Y + 5 * TS;

  function runDemo(dt, loopT) {
    const now = performance.now() / 1000;
    if (now - lastInputT < 6) return; // user is playing
    demoIdle += dt;

    // Auto-aim: rotate the player's aim slowly so demo arrows fan out
    const autoAng = loopT * 0.4;
    const fauxMouse = {
      x: player.x + Math.cos(autoAng) * 120,
      y: player.y + Math.sin(autoAng) * 120,
    };
    mouse.x = fauxMouse.x;
    mouse.y = fauxMouse.y;

    // Ricochet arrow on a loop — fires from off-screen so the kit shows the trail
    demo.nextRic -= dt;
    if (demo.nextRic <= 0) {
      demo.nextRic = 2.8;
      const angle = -Math.PI * 0.15 + (Math.random() - 0.5) * 0.4;
      const sp = 420;
      arrows.push({
        x: 30, y: WORLD_Y + 80 + Math.random() * 200,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp,
        angle, life: 3.0,
        type: 'ricochet',
        trailHistory: [],
        bouncesLeft: 3,
      });
    }

    // Fire arrow on a loop
    demo.nextFire -= dt;
    if (demo.nextFire <= 0) {
      demo.nextFire = 3.4;
      const angle = Math.PI - 0.2 + (Math.random() - 0.5) * 0.3;
      const sp = 360;
      arrows.push({
        x: W - 30, y: WORLD_Y + 60 + Math.random() * 220,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp,
        angle, life: 3.0,
        type: 'fire',
        fireSeed: Math.random() * 1000,
      });
    }

    // Drop dynamite somewhere harmless
    demo.nextDyn -= dt;
    if (demo.nextDyn <= 0) {
      demo.nextDyn = 6.5;
      // find an empty tile
      let tx, ty, tries = 0;
      do {
        tx = 2 + Math.floor(Math.random() * (GW - 4));
        ty = 2 + Math.floor(Math.random() * (GH - 4));
      } while (tileAt(tx, ty) !== TILE.EMPTY && ++tries < 30);
      dyns.push({
        x: tx * TS + 16,
        y: WORLD_Y + ty * TS + 16,
        fuseT: 3.0, fuseTotal: 3.0,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }

    // Boss appears on a longer cadence
    demo.nextBoss -= dt;
    if (demo.nextBoss <= 0) {
      if (!boss) { spawnBoss(); incoming = 1.4; demo.bossUp = true; demo.nextBoss = 12; }
      else { removeBoss(); demo.bossUp = false; demo.nextBoss = 8; }
    }

    // Spare fire patch out near a tree row
    demo.nextPatch -= dt;
    if (demo.nextPatch <= 0) {
      demo.nextPatch = 7;
      firePatches.push({
        x: 80 + Math.random() * (W - 160),
        y: WORLD_Y + 60 + Math.random() * (H - WORLD_Y - 120),
        lifeT: 3.5, lifeTotal: 4,
        patchPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  // ---------- LOOP ----------
  let lastT = performance.now() / 1000;
  const startT = lastT;

  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - lastT, 0.05);
    lastT = now;
    const loopT = now - startT;

    update(dt, loopT);
    runDemo(dt, loopT);

    // clear with void
    ctx.fillStyle = '#0A0F0A';
    ctx.fillRect(0, 0, W, H);

    // shake
    const sx = (Math.random() - 0.5) * shakeAmt;
    const sy = (Math.random() - 0.5) * shakeAmt;
    ctx.save();
    ctx.translate(sx, sy);

    drawWorld(loopT);

    ctx.restore();

    drawHud(loopT);

    // CRT post
    A.postProcess(ctx, W, H, loopT);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
