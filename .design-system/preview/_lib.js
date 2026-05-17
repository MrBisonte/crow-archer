/* CROW ARCHER — shared Canvas draw library.
   The exact functions a developer would translate the entity specs into.
   Used by every preview card and by ui_kits/game/index.html. */

(function (global) {
  'use strict';

  // ----- palette (mirrors colors_and_type.css) -----
  const C = {
    phosphor:   '#39FF14',
    phosphorDim:'#28B30E',
    ink0:       '#0A0F0A',
    ink1:       '#121A12',
    ink2:       '#1A2A1A',
    ink3:       '#243424',
    redHot:     '#FF1F1F',
    redDeep:    '#8A1010',
    redBlood:   '#5A0808',
    amber:      '#FFB400',
    cyanRic:    '#39E0FF',
    cyanLight:  '#7AF0FF',
    cyanDim:    '#1B7A8A',
    orange:     '#FF7A1F',
    orangeDeep: '#B23A00',
    arrowShaft: '#D4A832',
    arrowHead:  '#F0C830',
    arrowFletch:'#A07828',
    playerBody: '#3A5F88',
    playerSkin: '#D9B98A',
    playerHat:  '#0E1410',
    playerCloak:'#0E1410',
    woodHandle: '#8A6028',
    woodHi:     '#B58A4A',
    tine:       '#C8C8C8',
    white:      '#FFFFFF',
    treeTrunk:  '#5B3A1F',
    treeCanopy1:'#2C5A22',
    treeCanopy2:'#1F4A19',
    treeCanopy3:'#3F7A2C',
    rock:       '#5C5C5C',
    rockShade:  '#3F3F3F',
    water1:     '#173A78',
    water2:     '#2A66B0',
    shadow:     'rgba(0,0,0,0.45)',
  };

  // ----- helpers -----
  function reset(ctx) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
  }
  function glow(ctx, color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }
  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ----- background tile painters -----
  function drawGroundTile(ctx, x, y) {
    ctx.fillStyle = C.ink2;
    ctx.fillRect(x, y, 32, 32);
    // 1-in-16 chance per pixel-of-8 to place a speckle (deterministic from coord)
    for (let i = 0; i < 4; i++) {
      const px = x + ((x * 31 + y * 17 + i * 53) % 28);
      const py = y + ((x * 13 + y * 41 + i * 29) % 28);
      if ((px ^ py ^ i) % 7 === 0) {
        ctx.fillStyle = C.ink3;
        ctx.fillRect(px, py, 2, 2);
      }
    }
  }

  // ----- ENTITIES -----

  // 01. PLAYER
  // opts: aimAngle, bowCharge (0..1), walkPhase, cloakSway, moving, entityPhase
  function drawPlayer(ctx, x, y, opts) {
    const { aimAngle = 0, bowCharge = 0, walkPhase = 0, cloakSway = 0, moving = false } = opts || {};
    const bobY = moving ? Math.sin(walkPhase * 2) * 0.6 : 0;
    ctx.save();
    ctx.translate(x, y + bobY);

    // 1. ground shadow
    reset(ctx);
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 9 - bobY, 9, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. cloak (bezier cape, anchored at shoulders)
    reset(ctx);
    const cloakOff = 1.5 * Math.sin(walkPhase + cloakSway);
    ctx.fillStyle = C.playerCloak;
    ctx.strokeStyle = C.phosphor;
    ctx.lineWidth = 1;
    glow(ctx, C.phosphor, 3);
    ctx.beginPath();
    ctx.moveTo(-5, -3);
    ctx.bezierCurveTo(-9, 0, -8, 6, -7, 7 + cloakOff);
    ctx.lineTo(7, 7 - cloakOff);
    ctx.bezierCurveTo(8, 6, 9, 0, 5, -3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    reset(ctx);

    // 3. body
    ctx.fillStyle = C.playerBody;
    ctx.fillRect(-5, -3, 10, 11);
    ctx.fillStyle = C.playerHat;
    ctx.fillRect(-5, 3, 10, 1);

    // 4. head
    ctx.fillStyle = C.playerSkin;
    ctx.beginPath();
    ctx.arc(0, -8, 5, 0, Math.PI * 2);
    ctx.fill();

    // 5. hat
    ctx.fillStyle = C.playerHat;
    ctx.fillRect(-5, -13, 10, 3);
    ctx.fillRect(-6, -10, 12, 1);

    // 6,7,8,9. bow arm + bow + bowstring + charge
    const grip = { x: Math.cos(aimAngle) * 8, y: Math.sin(aimAngle) * 8 };
    // bow arm
    ctx.strokeStyle = C.playerSkin;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(grip.x, grip.y);
    ctx.stroke();
    // bow
    ctx.strokeStyle = C.woodHandle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(grip.x, grip.y, 7, aimAngle - Math.PI / 2, aimAngle + Math.PI / 2);
    ctx.stroke();
    // bowstring
    const nockDist = 3 + 2 * bowCharge;
    const nock = {
      x: grip.x - Math.cos(aimAngle) * nockDist,
      y: grip.y - Math.sin(aimAngle) * nockDist,
    };
    const bowTop = {
      x: grip.x + Math.cos(aimAngle - Math.PI / 2) * 7,
      y: grip.y + Math.sin(aimAngle - Math.PI / 2) * 7,
    };
    const bowBot = {
      x: grip.x + Math.cos(aimAngle + Math.PI / 2) * 7,
      y: grip.y + Math.sin(aimAngle + Math.PI / 2) * 7,
    };
    glow(ctx, C.phosphor, 4 + 8 * bowCharge);
    ctx.strokeStyle = C.phosphor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bowTop.x, bowTop.y);
    ctx.lineTo(nock.x, nock.y);
    ctx.lineTo(bowBot.x, bowBot.y);
    ctx.stroke();
    // charge glow
    if (bowCharge > 0.6) {
      ctx.fillStyle = C.phosphor;
      ctx.globalAlpha = bowCharge;
      glow(ctx, C.phosphor, 12);
      ctx.beginPath();
      ctx.arc(grip.x, grip.y, 2 + 2 * bowCharge, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    reset(ctx);
    ctx.restore();
  }

  // 02. CROW (normal)
  // opts: wingPhase, entityPhase, facing (-1 left, +1 right)
  function drawCrow(ctx, x, y, opts) {
    const { wingPhase = 0, entityPhase = 0, facing = -1, loopT = 0 } = opts || {};
    const bobY = 0.8 * Math.sin(loopT * 3 + entityPhase);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing < 0 ? 1 : -1, 1);

    // shadow
    reset(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 7, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = '#0A0A0A';
    ctx.beginPath();
    ctx.ellipse(0, bobY, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1F1F1F';
    ctx.lineWidth = 1;
    ctx.stroke();

    // tail
    ctx.fillStyle = '#0A0A0A';
    ctx.beginPath();
    ctx.moveTo(6, bobY + 1);
    ctx.lineTo(11, bobY - 2);
    ctx.lineTo(11, bobY + 4);
    ctx.closePath();
    ctx.fill();

    // far wing (left of body in unflipped coords)
    const wRotA = -0.4 + 0.5 * Math.sin(wingPhase);
    const wYA = -2 + 3 * Math.sin(wingPhase);
    ctx.save();
    ctx.translate(-3, bobY + wYA);
    ctx.rotate(wRotA);
    ctx.fillStyle = '#0A0A0A';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1F1F1F';
    ctx.stroke();
    ctx.restore();

    // near wing
    const wRotB = 0.4 - 0.5 * Math.sin(wingPhase);
    const wYB = -2 - 3 * Math.sin(wingPhase);
    ctx.save();
    ctx.translate(3, bobY + wYB);
    ctx.rotate(wRotB);
    ctx.fillStyle = '#0A0A0A';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1F1F1F';
    ctx.stroke();
    ctx.restore();

    // beak
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.moveTo(-9, bobY - 0.5);
    ctx.lineTo(-13, bobY);
    ctx.lineTo(-9, bobY + 1.5);
    ctx.closePath();
    ctx.fill();

    // eye
    glow(ctx, C.amber, 3);
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.arc(-6, bobY - 1.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);
    // eye glint
    ctx.fillStyle = C.redHot;
    ctx.fillRect(-6.5, bobY - 2, 1, 1);

    ctx.restore();
  }

  // 03. CROW (white)
  function drawCrowWhite(ctx, x, y, opts) {
    const { wingPhase = 0, entityPhase = 0, facing = -1, loopT = 0 } = opts || {};
    const bobY = 1.2 * Math.sin(loopT * 3 + entityPhase);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing < 0 ? 1 : -1, 1);

    // shadow
    reset(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 7, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    glow(ctx, C.white, 6);
    ctx.fillStyle = '#E8E8E8';
    ctx.beginPath();
    ctx.ellipse(0, bobY, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.stroke();

    // tail
    ctx.fillStyle = '#E8E8E8';
    ctx.beginPath();
    ctx.moveTo(6, bobY + 1);
    ctx.lineTo(11, bobY - 2);
    ctx.lineTo(11, bobY + 4);
    ctx.closePath();
    ctx.fill();

    // wings
    const drawWing = (sx, yo, rot) => {
      ctx.save();
      ctx.translate(sx, bobY + yo);
      ctx.rotate(rot);
      ctx.fillStyle = '#E8E8E8';
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.restore();
    };
    drawWing(-3, -2 + 3 * Math.sin(wingPhase), -0.4 + 0.5 * Math.sin(wingPhase));
    drawWing(3, -2 - 3 * Math.sin(wingPhase), 0.4 - 0.5 * Math.sin(wingPhase));

    // beak
    ctx.fillStyle = C.redHot;
    ctx.beginPath();
    ctx.moveTo(-9, bobY - 0.5);
    ctx.lineTo(-13, bobY);
    ctx.lineTo(-9, bobY + 1.5);
    ctx.closePath();
    ctx.fill();

    // eye
    glow(ctx, C.redHot, 4 + 2 * Math.sin(loopT * 4 + entityPhase));
    ctx.fillStyle = C.redHot;
    ctx.beginPath();
    ctx.arc(-6, bobY - 1.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);
    ctx.fillStyle = C.white;
    ctx.fillRect(-6.5, bobY - 2, 1, 1);

    ctx.restore();
  }

  // 04. CROW (aggro) — drawn ON TOP of a normal crow.
  // Two cues: pulse ring + eye flare. (Speed trail removed in v2 — was too noisy.)
  function drawAggroOverlay(ctx, x, y, opts) {
    const { loopT = 0 } = opts || {};
    const pulsePhase = loopT * 6;

    // eye flare overrides the crow's glint
    reset(ctx);
    glow(ctx, C.redHot, 5);
    ctx.fillStyle = C.redHot;
    ctx.fillRect(x - 7, y - 3, 2, 2);
    reset(ctx);

    // pulse ring
    const ringR = 10 + 3 * Math.sin(pulsePhase);
    const sin2 = Math.sin(pulsePhase);
    const ringAlpha = 0.55 - 0.4 * sin2 * sin2;
    glow(ctx, C.redHot, 8 + 4 * Math.sin(pulsePhase));
    ctx.strokeStyle = `rgba(255,31,31, ${ringAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    reset(ctx);
  }

  // 05. BOSS (v2 — bigger and more imposing)
  function drawBoss(ctx, x, y, opts) {
    const { wingPhase = 0, entityPhase = 0, loopT = 0, facing = -1 } = opts || {};
    const bobY = 2.4 * Math.sin(loopT * 1.5 + entityPhase);
    const bossPulse = 0.5 + 0.5 * Math.sin(loopT * 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing < 0 ? 1 : -1, 1);

    // shadow (bigger)
    reset(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.ellipse(0, 22, 32, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // corona (bigger)
    glow(ctx, C.redHot, 24 + 10 * bossPulse);
    ctx.fillStyle = `rgba(255,31,31, ${0.18 + 0.12 * bossPulse})`;
    ctx.beginPath();
    ctx.arc(0, bobY, 38 + 5 * bossPulse, 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);

    // far wing (bigger)
    ctx.save();
    ctx.translate(4, bobY - 2 + 5 * Math.sin(wingPhase));
    ctx.rotate(0.3 + 0.4 * Math.sin(wingPhase));
    ctx.fillStyle = C.redBlood;
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0A0A0A';
    ctx.lineWidth = 1.5;
    for (const frac of [0.20, 0.40, 0.55, 0.70, 0.85]) {
      const tx = -28 + frac * 56;
      ctx.beginPath();
      ctx.moveTo(tx, 6);
      ctx.lineTo(tx + 2, 12);
      ctx.stroke();
    }
    ctx.restore();

    // body (bigger)
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.ellipse(0, bobY, 28, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // body highlight
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.ellipse(-5, bobY - 4, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // crown spikes (5 instead of 3, rhythmic heights)
    ctx.fillStyle = '#0A0A0A';
    ctx.strokeStyle = C.redBlood;
    ctx.lineWidth = 1;
    const spikes = [
      {x: -24, h: 5},
      {x: -19, h: 8},
      {x: -14, h: 11},
      {x: -9,  h: 8},
      {x: -4,  h: 5},
    ];
    for (const s of spikes) {
      ctx.beginPath();
      ctx.moveTo(s.x - 2.5, bobY - 8);
      ctx.lineTo(s.x, bobY - 8 - s.h);
      ctx.lineTo(s.x + 2.5, bobY - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // beak (bigger)
    ctx.fillStyle = '#3A0606';
    ctx.beginPath();
    ctx.moveTo(-26, bobY - 1);
    ctx.lineTo(-38, bobY);
    ctx.lineTo(-26, bobY + 5);
    ctx.closePath();
    ctx.fill();

    // eyes (bigger)
    const eyeBlur = 10 + 5 * Math.sin(loopT * 8);
    glow(ctx, C.redHot, eyeBlur);
    ctx.fillStyle = C.redHot;
    ctx.beginPath();
    ctx.arc(-21, bobY - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-21, bobY + 3, 5, 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);
    // eye cores
    ctx.fillStyle = C.amber;
    ctx.fillRect(-21.5, bobY - 4.5, 1, 1);
    ctx.fillRect(-21.5, bobY + 2.5, 1, 1);

    // near wing (bigger)
    ctx.save();
    ctx.translate(4, bobY + 2 - 5 * Math.sin(wingPhase));
    ctx.rotate(-(0.3 + 0.4 * Math.sin(wingPhase + Math.PI)));
    ctx.fillStyle = C.redDeep;
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0A0A0A';
    ctx.lineWidth = 1.5;
    for (const frac of [0.20, 0.40, 0.55, 0.70, 0.85]) {
      const tx = -28 + frac * 56;
      ctx.beginPath();
      ctx.moveTo(tx, -6);
      ctx.lineTo(tx + 2, -12);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }

  // 06. ARROW (normal)
  function drawArrow(ctx, x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    reset(ctx);
    ctx.fillStyle = C.arrowShaft;
    ctx.fillRect(-10, -0.5, 21, 1);
    glow(ctx, C.arrowHead, 4);
    ctx.fillStyle = C.arrowHead;
    ctx.beginPath();
    ctx.moveTo(11, -2);
    ctx.lineTo(15, 0);
    ctx.lineTo(11, 2);
    ctx.closePath();
    ctx.fill();
    reset(ctx);
    ctx.strokeStyle = C.arrowFletch;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, -2); ctx.lineTo(-7, 0);
    ctx.moveTo(-10, 2);  ctx.lineTo(-7, 0);
    ctx.stroke();
    ctx.restore();
  }

  // 07. ARROW (ricochet)
  function drawArrowRicochet(ctx, x, y, angle, opts) {
    const { trailHistory = [], bouncesLeft = 3 } = opts || {};
    // trail (drawn at world positions, not entity-local)
    reset(ctx);
    for (let i = 0; i < trailHistory.length; i++) {
      const t = trailHistory[i];
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle || angle);
      ctx.fillStyle = `rgba(57,224,255, ${0.5 - i * 0.08})`;
      ctx.fillRect(-10, -0.5, 21, 1);
      ctx.restore();
    }
    // main arrow
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    glow(ctx, C.cyanRic, 4);
    ctx.fillStyle = C.cyanRic;
    ctx.fillRect(-10, -0.5, 21, 1);
    glow(ctx, C.cyanRic, 6);
    ctx.fillStyle = C.cyanLight;
    ctx.beginPath();
    ctx.moveTo(11, -2);
    ctx.lineTo(15, 0);
    ctx.lineTo(11, 2);
    ctx.closePath();
    ctx.fill();
    reset(ctx);
    ctx.strokeStyle = C.cyanDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, -2); ctx.lineTo(-7, 0);
    ctx.moveTo(-10, 2);  ctx.lineTo(-7, 0);
    ctx.stroke();
    // bounce pips
    ctx.fillStyle = C.white;
    for (let i = 0; i < bouncesLeft; i++) {
      ctx.fillRect(2 + i * 2, -3, 1, 1);
    }
    ctx.restore();
  }

  // 08. ARROW (fire)
  function drawArrowFire(ctx, x, y, angle, opts) {
    const { loopT = 0, fireSeed = 0 } = opts || {};
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    reset(ctx);
    // rear flame outer
    glow(ctx, C.orange, 10 + 4 * Math.sin(loopT * 10 + fireSeed));
    ctx.fillStyle = C.orange;
    ctx.beginPath();
    ctx.ellipse(-12 - 2 * Math.sin(loopT * 10), 0,
                4 + Math.sin(loopT * 14 + fireSeed), 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // rear flame inner
    glow(ctx, C.amber, 6);
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.ellipse(-11, 0, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);
    // shaft
    glow(ctx, C.orange, 6);
    ctx.fillStyle = C.orange;
    ctx.fillRect(-10, -0.5, 21, 1);
    // head
    glow(ctx, C.amber, 8 + 3 * Math.sin(loopT * 12 + fireSeed));
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.moveTo(11, -2);
    ctx.lineTo(15, 0);
    ctx.lineTo(11, 2);
    ctx.closePath();
    ctx.fill();
    reset(ctx);
    ctx.strokeStyle = C.orangeDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, -2); ctx.lineTo(-7, 0);
    ctx.moveTo(-10, 2);  ctx.lineTo(-7, 0);
    ctx.stroke();
    ctx.restore();
  }

  // 09. DYNAMITE (v2 — body grown to 24x8 so the TNT stencil is legible)
  function drawDynamite(ctx, x, y, opts) {
    const { fuseT = 2.5, fuseTotal = 3, bobPhase = 0, loopT = 0 } = opts || {};
    const sparkPhase = loopT * 18;
    const bob = 1.5 * Math.sin(loopT * 4 + bobPhase);
    const burntFrac = 1 - fuseT / fuseTotal;

    ctx.save();
    ctx.translate(x, y + bob);

    // shadow (wider for grown body)
    reset(ctx);
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 7 - bob, 13, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // body 24x8
    ctx.fillStyle = C.redHot;
    ctx.fillRect(-12, -4, 24, 8);
    ctx.fillStyle = C.redDeep;
    ctx.fillRect(-12, 0, 24, 4);
    ctx.fillStyle = C.redBlood;
    ctx.fillRect(-12, -4, 1, 8);
    ctx.fillRect(11, -4, 1, 8);

    // label 14x6 — dark background with phosphor border so the stencil reads
    ctx.fillStyle = '#F0F0F0';
    ctx.fillRect(-7, -3, 14, 6);
    ctx.fillStyle = '#0A0A0A';
    ctx.font = 'bold 6px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 0, 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // wick
    const wickStart = { x: 11, y: -4 };
    const wickEnd = { x: 17, y: -10 };
    const cap = Math.min(0.8, burntFrac);
    ctx.strokeStyle = C.woodHandle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wickStart.x, wickStart.y);
    ctx.quadraticCurveTo(14, -9, wickEnd.x, wickEnd.y);
    ctx.stroke();
    if (cap > 0) {
      ctx.strokeStyle = '#3A2A1A';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(wickStart.x, wickStart.y);
      ctx.quadraticCurveTo(
        wickStart.x + (14 - wickStart.x) * cap,
        wickStart.y + (-9 - wickStart.y) * cap,
        wickStart.x + (wickEnd.x - wickStart.x) * cap,
        wickStart.y + (wickEnd.y - wickStart.y) * cap
      );
      ctx.stroke();
    }

    // spark halo
    reset(ctx);
    ctx.fillStyle = 'rgba(255, 180, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(17, -10, 3 + Math.sin(sparkPhase), 0, Math.PI * 2);
    ctx.fill();
    glow(ctx, C.amber, 6 + 4 * Math.sin(sparkPhase));
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.arc(17, -10, 1.5 + 0.5 * Math.sin(sparkPhase), 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);

    // countdown text
    const sec = Math.max(0, Math.ceil(fuseT));
    let txtColor = C.redHot, blur = 4;
    if (fuseT <= 0.5) { txtColor = C.white; blur = 16; }
    else if (fuseT <= 1.0) { txtColor = C.amber; blur = 8; }
    glow(ctx, txtColor, blur);
    ctx.fillStyle = txtColor;
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(sec), 0, -12);
    reset(ctx);
    ctx.restore();
  }

  // 10. PICKUP (ricochet)
  function drawPickupRicochet(ctx, x, y, opts) {
    const { loopT = 0, bobPhase = 0 } = opts || {};
    const blinkPhase = loopT * 4 + bobPhase;
    const bobY = -2 + Math.sin(loopT * 3 + bobPhase) * 2;
    ctx.save();
    ctx.translate(x, y);

    // shadow
    reset(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 8, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // halo
    glow(ctx, C.cyanRic, 12);
    ctx.fillStyle = `rgba(57,224,255, ${0.25 + 0.15 * Math.sin(blinkPhase)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + Math.sin(blinkPhase), 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);

    ctx.translate(0, bobY);
    const sin2 = Math.sin(blinkPhase);
    const alpha = 0.5 + 0.5 * sin2 * sin2;
    glow(ctx, C.cyanRic, 6 + 4 * Math.sin(blinkPhase));
    ctx.fillStyle = `rgba(57,224,255,${alpha})`;
    ctx.fillRect(-7, -0.5, 14, 1);
    ctx.fillStyle = C.cyanLight;
    ctx.beginPath();
    ctx.moveTo(7, -2);
    ctx.lineTo(11, 0);
    ctx.lineTo(7, 2);
    ctx.closePath();
    ctx.fill();
    reset(ctx);
    ctx.fillStyle = C.white;
    ctx.fillRect(-2, -3, 1, 1);
    ctx.fillRect(0, -3, 1, 1);
    ctx.fillRect(2, -3, 1, 1);
    ctx.restore();
  }

  // 11. PICKUP (fire)
  function drawPickupFire(ctx, x, y, opts) {
    const { loopT = 0, bobPhase = 0 } = opts || {};
    const flamePhase = loopT * 10 + bobPhase;
    const bobY = -2 + Math.sin(loopT * 3 + bobPhase) * 2;
    ctx.save();
    ctx.translate(x, y);

    reset(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 8, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    glow(ctx, C.orange, 14);
    ctx.fillStyle = `rgba(255,122,31, ${0.30 + 0.15 * Math.sin(flamePhase * 0.4)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 11 + Math.sin(flamePhase * 0.4), 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);

    ctx.translate(0, bobY);
    // flame
    glow(ctx, C.orange, 12 + 4 * Math.sin(flamePhase));
    ctx.fillStyle = C.orange;
    ctx.beginPath();
    ctx.ellipse(-9, 0, 3 + Math.sin(flamePhase), 4 + 0.5 * Math.sin(flamePhase * 1.3), 0, 0, Math.PI * 2);
    ctx.fill();
    glow(ctx, C.amber, 6);
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.ellipse(-9, 0, 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.arc(-9, 0, 0.8 + 0.4 * Math.sin(flamePhase * 2), 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);
    // shaft
    glow(ctx, C.orange, 6);
    ctx.fillStyle = C.orange;
    ctx.fillRect(-7, -0.5, 14, 1);
    glow(ctx, C.amber, 6);
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.moveTo(7, -2);
    ctx.lineTo(11, 0);
    ctx.lineTo(7, 2);
    ctx.closePath();
    ctx.fill();
    reset(ctx);
    ctx.restore();
  }

  // 12. FIRE PATCH
  function drawFirePatch(ctx, x, y, opts) {
    const { loopT = 0, patchPhase = 0, lifeT = 4 } = opts || {};
    const rOuter = 16 + 3 * Math.sin(loopT * 5 + patchPhase);
    const rInner = 6 + 1.5 * Math.sin(loopT * 8 + patchPhase);
    const alpha = Math.max(0, Math.min(1, lifeT / 1.0));
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    glow(ctx, C.orange, 14 + 4 * Math.sin(loopT * 6 + patchPhase));
    const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, rOuter);
    grd.addColorStop(0, C.amber);
    grd.addColorStop(0.4, C.orange);
    grd.addColorStop(0.8, 'rgba(178,58,0,0.5)');
    grd.addColorStop(1, 'rgba(178,58,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, rOuter, 0, Math.PI * 2);
    ctx.fill();
    glow(ctx, C.orange, 8);
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.arc(0, 0, rInner, 0, Math.PI * 2);
    ctx.fill();
    reset(ctx);
    ctx.restore();
  }

  // 13. PITCHFORK — opts: swingT (0..0.36+), swingAngle, anchorX, anchorY, loopT
  function drawPitchfork(ctx, ax, ay, opts) {
    const { swingT = 0, swingAngle = 0, loopT = 0 } = opts || {};
    const WINDUP = 0.12, STRIKE = 0.18, RECOVER = 0.36;
    if (swingT < 0 || swingT >= RECOVER) return;
    let off;
    if (swingT < WINDUP) {
      off = lerp(0, -0.9, smoothstep(0, WINDUP, swingT));
    } else if (swingT < STRIKE) {
      off = lerp(-0.9, 0.6, (swingT - WINDUP) / (STRIKE - WINDUP));
    } else {
      off = lerp(0.6, 0, (swingT - STRIKE) / (RECOVER - STRIKE));
    }
    const angle = swingAngle + off;
    const isStrike = swingT >= WINDUP && swingT < STRIKE;

    ctx.save();
    ctx.translate(ax + Math.cos(swingAngle) * 8, ay + Math.sin(swingAngle) * 8);
    ctx.rotate(angle);
    reset(ctx);

    // impact arc (drawn first, behind)
    if (isStrike) {
      const t = (swingT - WINDUP) / (STRIKE - WINDUP);
      const a = 1 - t;
      const grd = ctx.createLinearGradient(0, 0, 38, 0);
      grd.addColorStop(0, `rgba(255,255,255,${0.6 * a})`);
      grd.addColorStop(1, 'rgba(57,255,20,0)');
      ctx.strokeStyle = grd;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 38, -0.4, 0.4);
      ctx.stroke();
    }

    // handle
    ctx.strokeStyle = C.woodHandle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(28, 0);
    ctx.stroke();
    // handle highlight
    ctx.strokeStyle = C.woodHi;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(2, -0.5);
    ctx.lineTo(26, -0.5);
    ctx.stroke();
    // crossbar
    ctx.strokeStyle = C.tine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(28, -5); ctx.lineTo(28, 5);
    ctx.stroke();
    // tines
    for (const ty of [-5, 0, 5]) {
      ctx.beginPath();
      ctx.moveTo(28, ty);
      ctx.lineTo(36, ty);
      ctx.stroke();
    }
    // glints
    if (isStrike) {
      glow(ctx, C.white, 12 + 8 * Math.sin(loopT * 20));
      ctx.fillStyle = C.white;
      for (const ty of [-5, 0, 5]) ctx.fillRect(35.5, ty - 0.5, 1, 1);
      reset(ctx);
    }
    ctx.restore();
  }

  // ----- TILES (already exist in the live game; included for completeness in cards) -----
  function drawRockTile(ctx, x, y) {
    ctx.fillStyle = C.ink2;
    ctx.fillRect(x, y, 32, 32);
    ctx.fillStyle = C.rockShade;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 24);
    ctx.lineTo(x + 8, y + 8);
    ctx.lineTo(x + 18, y + 4);
    ctx.lineTo(x + 28, y + 12);
    ctx.lineTo(x + 26, y + 26);
    ctx.lineTo(x + 14, y + 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.rock;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 22);
    ctx.lineTo(x + 10, y + 10);
    ctx.lineTo(x + 18, y + 6);
    ctx.lineTo(x + 26, y + 14);
    ctx.lineTo(x + 22, y + 24);
    ctx.lineTo(x + 14, y + 26);
    ctx.closePath();
    ctx.fill();
  }
  function drawWaterTile(ctx, x, y, loopT) {
    ctx.fillStyle = C.water1;
    ctx.fillRect(x, y, 32, 32);
    ctx.strokeStyle = C.water2;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const yo = y + 8 + i * 10 + Math.sin(loopT * 2 + i + x * 0.1) * 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 2, yo);
      ctx.lineTo(x + 30, yo);
      ctx.stroke();
    }
  }
  function drawTreeTile(ctx, x, y, loopT) {
    ctx.fillStyle = C.ink2;
    ctx.fillRect(x, y, 32, 32);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(x + 16, y + 26, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // trunk
    ctx.fillStyle = C.treeTrunk;
    ctx.fillRect(x + 14, y + 16, 4, 10);
    // canopy
    ctx.fillStyle = C.treeCanopy2;
    ctx.beginPath();
    ctx.arc(x + 16, y + 14, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.treeCanopy1;
    ctx.beginPath();
    ctx.arc(x + 14, y + 11, 9, 0, Math.PI * 2);
    ctx.fill();
    // flicker highlight
    ctx.fillStyle = C.treeCanopy3;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(loopT * 2 + x);
    ctx.beginPath();
    ctx.arc(x + 12, y + 9, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ----- PARTICLE SYSTEM -----
  class Particles {
    constructor(cap = 200) { this.list = []; this.cap = cap; }
    burst(x, y, opts) {
      const {
        shape = 'circle',
        shapeMix = null,            // [[shape, prob], ...]
        colors = ['#FFFFFF'],
        count = 12,
        speedMin = 50, speedMax = 120,
        decay = 1.5,
        sizeMin = 1.5, sizeMax = 3,
        gravity = 0,
        damping = 0,
        shadowBlur = 0,
        shadowColor = null,
        forceColor = null,          // forced color for the LAST particle
        angleBias = null,           // {angle, spread} restricts emission direction
        ringTight = false,          // evenly distributed angles
      } = opts || {};
      for (let i = 0; i < count; i++) {
        let theta;
        if (ringTight) theta = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
        else if (angleBias) theta = angleBias.angle + (Math.random() - 0.5) * angleBias.spread;
        else theta = Math.random() * Math.PI * 2;
        const sp = speedMin + Math.random() * (speedMax - speedMin);
        const colorIdx = Math.floor(Math.random() * colors.length);
        let s = shape;
        if (shapeMix) {
          const r = Math.random();
          let acc = 0;
          for (const [sh, pr] of shapeMix) {
            acc += pr;
            if (r < acc) { s = sh; break; }
          }
        }
        this.list.push({
          x, y,
          vx: Math.cos(theta) * sp,
          vy: Math.sin(theta) * sp,
          shape: s,
          color: (i === count - 1 && forceColor) ? forceColor : colors[colorIdx],
          alpha: 1,
          decay,
          gravity,
          damping,
          shadowBlur,
          shadowColor: shadowColor || colors[colorIdx],
          r: sizeMin + Math.random() * (sizeMax - sizeMin),
          len: sizeMax,
        });
      }
      // cap
      if (this.list.length > this.cap) this.list.splice(0, this.list.length - this.cap);
    }
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.gravity || 0) * dt;
        if (p.damping) {
          p.vx *= 1 - p.damping * dt;
          p.vy *= 1 - p.damping * dt;
        }
        p.alpha -= p.decay * dt;
        if (p.alpha <= 0) this.list.splice(i, 1);
      }
    }
    draw(ctx) {
      for (const p of this.list) {
        ctx.globalAlpha = Math.max(0, p.alpha);
        if (p.shadowBlur) {
          ctx.shadowBlur = p.shadowBlur;
          ctx.shadowColor = p.shadowColor;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        if (p.shape === 'spark') {
          const m = Math.hypot(p.vx, p.vy) || 1;
          const len = 5;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - (p.vx / m) * len, p.y - (p.vy / m) * len);
          ctx.stroke();
        } else if (p.shape === 'line') {
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 3, p.y + 3);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  }

  // ----- POST: scanlines + vignette + scan sweep -----
  function postProcess(ctx, w, h, loopT) {
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
    // scan sweep
    const sweepY = (loopT / 6) % 1 * (h + 80) - 80;
    const grd = ctx.createLinearGradient(0, sweepY, 0, sweepY + 80);
    grd.addColorStop(0, 'rgba(57,255,20,0)');
    grd.addColorStop(0.5, 'rgba(57,255,20,0.04)');
    grd.addColorStop(1, 'rgba(57,255,20,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, sweepY, w, 80);
    // vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  // ----- card runner: rAF loop with shared time -----
  function runCard(canvas, drawFn, opts) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    let lastT = performance.now() / 1000;
    const startT = lastT;
    function frame() {
      const now = performance.now() / 1000;
      const dt = Math.min(now - lastT, 0.05);
      lastT = now;
      const loopT = now - startT;
      ctx.fillStyle = C.ink0;
      ctx.fillRect(0, 0, w, h);
      drawFn(ctx, { loopT, dt, w, h });
      if (!opts || opts.post !== false) postProcess(ctx, w, h, loopT);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  global.CrowArcher = {
    C, reset, glow, smoothstep, lerp,
    drawGroundTile, drawRockTile, drawWaterTile, drawTreeTile,
    drawPlayer, drawCrow, drawCrowWhite, drawAggroOverlay, drawBoss,
    drawArrow, drawArrowRicochet, drawArrowFire,
    drawDynamite, drawPickupRicochet, drawPickupFire, drawFirePatch,
    drawPitchfork,
    Particles, postProcess, runCard,
  };
})(window);
