(function (global) {
  'use strict';
  var SC = global.SC, U = SC.util;
  var SKIN = [0xc9996a, 0x8a5a34, 0xe8b98a, 0x6b4423];
  var SHIRT = [0x2e86de, 0xe05a5a, 0x37b24d, 0xf2c14e, 0x9b59b6, 0x20c997, 0xfd7e14, 0xe9ecef];
  var PANTS = [0x2c3e50, 0x495057, 0x5d4037, 0x1b2a4a];
  var CAR_COLORS = [0xd63031, 0x0984e3, 0xfdcb6e, 0x00b894, 0x6c5ce7, 0xe17055, 0x2d3436, 0xdfe6e9, 0x00cec9, 0xe84393];
  var CAR_TYPES = {
    sedan: { name: 'Sedan', topSpeed: 34, accel: 14, bodyH: 0.62, bodyW: 2.0, bodyL: 4.3, cabinH: 0.55, cabinY: 1.18 },
    sport: { name: 'Comet GT', topSpeed: 44, accel: 18, bodyH: 0.5, bodyW: 2.1, bodyL: 4.5, cabinH: 0.45, cabinY: 1.08, spoiler: true },
    van: { name: 'Hauler Van', topSpeed: 26, accel: 10, bodyH: 1.0, bodyW: 2.1, bodyL: 4.6, cabinH: 0.7, cabinY: 1.45 },
  };
  function pickCarType(rng) {
    var r = rng.next();
    if (r < 0.68) return 'sedan';
    if (r < 0.88) return 'van';
    return 'sport';
  }
  function lm(c) { return new THREE.MeshLambertMaterial({ color: c }); }
  function pm(c, s, sp2) { return new THREE.MeshPhongMaterial({ color: c, shininess: s, specular: sp2 }); }
  function bx(g, w, h, d, m, x, y, z, sh) {
    var q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    q.position.set(x, y, z); if (sh) q.castShadow = true; g.add(q); return q;
  }
  function sph(g, r, w, h, m, x, y, z, sh) {
    var q = new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
    q.position.set(x, y, z); if (sh) q.castShadow = true; g.add(q); return q;
  }
  function cyl(g, rt, rb, h, s, m, x, y, z, sh) {
    var q = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m);
    q.position.set(x, y, z); if (sh) q.castShadow = true; g.add(q); return q;
  }
  function makePerson(rng, opts) {
    opts = opts || {};
    var skin = opts.skin !== undefined ? opts.skin : rng.pick(SKIN);
    var shirt = opts.shirt !== undefined ? opts.shirt : rng.pick(SHIRT);
    var pants = opts.pants !== undefined ? opts.pants : rng.pick(PANTS);
    var g = new THREE.Group();
    var mat = function (c) { return lm(c); };
    var torso = bx(g, 0.62, 0.72, 0.34, mat(shirt), 0, 1.05, 0, true);
    if (opts.jacket) bx(g, 0.66, 0.6, 0.38, mat(opts.jacket), 0, 1.08, 0, true);
    var head = sph(g, 0.24, 10, 8, mat(skin), 0, 1.66, 0, true);
    var eyeG = new THREE.SphereGeometry(0.055, 6, 5), eyeM = mat(0x141414);
    var eL = new THREE.Mesh(eyeG, eyeM); eL.position.set(-0.09, 1.68, 0.21); g.add(eL);
    var eR = eL.clone(); eR.position.x = 0.09; g.add(eR);
    var hair = sph(g, 0.25, 10, 6, mat(opts.hair !== undefined ? opts.hair : 0x1a1a1a), 0, 1.78, 0);
    hair.scale.y = 0.55;
    var legL = bx(g, 0.24, 0.72, 0.26, mat(pants), -0.16, 0.36, 0, true);
    var legR = legL.clone(); legR.position.x = 0.16; g.add(legR);
    var armL = bx(g, 0.18, 0.62, 0.2, mat(shirt), -0.42, 1.05, 0, true);
    var armR = armL.clone(); armR.position.x = 0.42; g.add(armR);
    if (opts.hat) cyl(g, 0.3, 0.32, 0.1, 10, mat(opts.hat), 0, 1.98, 0);
    if (opts.hat && opts.badge) cyl(g, 0.31, 0.31, 0.05, 10, mat(0xffd23f), 0, 1.93, 0);
    if (opts.badge) bx(g, 0.12, 0.12, 0.03, mat(0xffd23f), -0.18, 1.28, 0.19);
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR, head: head };
  }
  function animateWalk(person, phase, amount) {
    var s = Math.sin(phase) * amount;
    person.legL.rotation.x = s; person.legR.rotation.x = -s;
    person.armL.rotation.x = -s * 0.8; person.armR.rotation.x = s * 0.8;
  }
  var HUB_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10);
  var HUB_MAT = lm(0xb8bec6);
  var BUMP_MAT = lm(0x222222);
  function makeCar(rng, color, isPolice, type) {
    var g = new THREE.Group();
    var t = CAR_TYPES[type] || CAR_TYPES.sedan;
    var bodyColor = isPolice ? 0x1c2733 : (color !== undefined ? color : rng.pick(CAR_COLORS));
    var bodyMat = pm(bodyColor, 70, 0x333333);
    bx(g, t.bodyW, t.bodyH, t.bodyL, bodyMat, 0, 0.35 + t.bodyH / 2, 0, true);
    bx(g, 1.7, t.cabinH, 2.1, pm(isPolice ? 0x1c2733 : 0x18242e, 90, 0x557788), 0, t.cabinY, -0.25, true);
    bx(g, 1.66, 0.4, 0.08, new THREE.MeshLambertMaterial({ color: 0x9fd8ef, emissive: 0x223344 }), 0, t.cabinY - 0.03, 0.85);
    if (t.spoiler) bx(g, 1.9, 0.08, 0.4, lm(0x1c2733), 0, 1.15, -2.1);
    if (type === 'van') {
      bx(g, 1.5, 0.35, 2.4, lm(bodyColor), 0, t.cabinY + t.cabinH / 2 + 0.15, -0.3, true);
      bx(g, 1.5, 0.5, 0.06, lm(0x18242e), 0, t.cabinY, -1.32);
    }
    for (var bi = 0; bi < 2; bi++) {
      var bz = bi ? 1 : -1;
      bx(g, t.bodyW + 0.06, 0.18, 0.22, BUMP_MAT, 0, 0.32, bz * (t.bodyL / 2 - 0.02));
    }
    bx(g, 0.9, 0.14, 0.06, BUMP_MAT, 0, 0.62, t.bodyL / 2 + 0.01);
    var hl = new THREE.MeshLambertMaterial({ color: 0xfff6c0, emissive: 0x888844 });
    var tl = new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0x661111 });
    for (var i = 0; i < 2; i++) {
      var hx = i ? 0.7 : -0.7;
      bx(g, 0.42, 0.16, 0.08, hl, hx, 0.66, t.bodyL / 2 + 0.01);
      bx(g, 0.42, 0.16, 0.08, tl, hx, 0.66, -t.bodyL / 2 - 0.01);
      bx(g, 0.2, 0.1, 0.06, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0x777744 }), hx, 0.42, t.bodyL / 2 + 0.01);
    }
    bx(g, 1.5, 0.1, 0.06, new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0x550000 }), 0, 0.86, -t.bodyL / 2 - 0.01);
    if (isPolice) {
      bx(g, 1.2, 0.18, 0.4, lm(0x222222), 0, 1.52, -0.25);
      var lr = bx(g, 0.5, 0.16, 0.42, new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa0000 }), -0.32, 1.62, -0.25);
      lr.name = 'lightR';
      var lb = bx(g, 0.5, 0.16, 0.42, new THREE.MeshLambertMaterial({ color: 0x2244ff, emissive: 0x0022aa }), 0.32, 1.62, -0.25);
      lb.name = 'lightB';
      bx(g, 2.04, 0.3, 2.6, lm(0xf1f2f6), 0, 0.62, 0);
    }
    var wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
    var wheelMat = lm(0x141414);
    var wheels = [];
    var wpos = [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]];
    for (var w = 0; w < 4; w++) {
      var wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wpos[w][0], 0.36, wpos[w][1]);
      wheel.castShadow = true;
      var hub = new THREE.Mesh(HUB_GEO, HUB_MAT);
      hub.position.y = wpos[w][0] > 0 ? -0.15 : 0.15;
      wheel.add(hub);
      g.add(wheel);
      wheels.push(wheel);
    }
    var mirrorMat = lm(0x333333);
    var mirrorY = 0.35 + t.bodyH + 0.08, mirrorX = t.bodyW / 2 + 0.05;
    var ml = bx(g, 0.12, 0.18, 0.08, mirrorMat, -mirrorX, mirrorY, 0.4);
    var mr = ml.clone(); mr.position.x = mirrorX; g.add(mr);
    return { group: g, wheels: wheels, bodyMat: bodyMat };
  }
  function makeCarState(x, z, heading, kind, type) {
    var t = CAR_TYPES[type] || CAR_TYPES.sedan;
    return {
      x: x, z: z, heading: heading, speed: 0, kind: kind || 'traffic',
      carType: type || 'sedan', topSpeed: t.topSpeed, accel: t.accel,
      steer: 0, targetSpeed: 0, stuck: 0, model: null,
    };
  }
  function driveStep(car, throttle, steer, dt, maxSpeed, handbrake) {
    var accel = car.accel || (throttle >= 0 ? 14 : 22);
    var ms = car.topSpeed || maxSpeed || 34;
    if (car.kind === 'player') {
      if (throttle > 0) accel *= 1 - 0.35 * Math.min(1, Math.abs(car.speed) / ms);
      if (throttle < 0 && car.speed > 0) car.speed = Math.max(0, car.speed - 12 * dt);
    }
    car.speed += throttle * accel * dt;
    if (throttle === 0) {
      car.speed -= car.speed * 1.1 * dt;
      if (Math.abs(car.speed) < 0.1) car.speed = 0;
    }
    if (handbrake && Math.abs(car.speed) > 6) car.speed -= car.speed * 0.9 * dt;
    if (car.speed > ms) car.speed = ms;
    if (car.speed < -10) car.speed = -10;
    var spd = Math.abs(car.speed);
    var turnRate = 1.9 * (spd / (spd + 6));
    if (handbrake && spd > 6) turnRate *= 1.55;
    car.heading += steer * turnRate * dt * (car.speed >= 0 ? 1 : -1);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    if (car.kind === 'player' && spd > 20 && Math.abs(steer) > 0.7 && !handbrake) {
      var sl = spd * Math.abs(steer) * 0.04 * dt;
      var sgn = steer > 0 ? -1 : 1;
      car.x += Math.cos(car.heading) * sgn * sl;
      car.z += -Math.sin(car.heading) * sgn * sl;
    }
  }
  function syncCarModel(car) {
    if (!car.model) return;
    car.model.group.position.set(car.x, 0, car.z);
    car.model.group.rotation.y = car.heading;
    var spin = car.speed * 0.016 * 2.5;
    for (var i = 0; i < 4; i++) car.model.wheels[i].rotation.x += spin;
    car.model.wheels[0].rotation.y = car.steer * 0.4;
    car.model.wheels[1].rotation.y = car.steer * 0.4;
  }
  function trafficThink(car, city, rng, dt) {
    var lines = city.roadLines, half = city.half;
    var alongX = Math.abs(Math.sin(car.heading)) > 0.7;
    var pos = alongX ? car.z : car.x;
    var nearest = lines[0], nd = 1e9;
    for (var i = 0; i < lines.length; i++) {
      var d = Math.abs(lines[i] - pos);
      if (d < nd) { nd = d; nearest = lines[i]; }
    }
    var targetHeading, dir = alongX ? Math.sign(Math.sin(car.heading)) : Math.sign(Math.cos(car.heading));
    if (alongX) {
      targetHeading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      var dz = nearest - car.z;
      targetHeading += U.clamp(dz * 0.03, -0.5, 0.5) * (dir > 0 ? 1 : -1);
    } else {
      targetHeading = dir > 0 ? 0 : Math.PI;
      var dx = nearest - car.x;
      targetHeading += U.clamp(dx * 0.03, -0.5, 0.5) * (dir > 0 ? -1 : 1);
    }
    car.steer = U.clamp(U.angleDiff(car.heading, targetHeading) * 1.4, -1, 1);
    car.targetSpeed = 11 + Math.sin(car.x * 0.01 + car.z * 0.013) * 2;
    var nearInter = false;
    for (var j = 0; j < lines.length; j++) {
      if (Math.abs(lines[j] - car.x) < 9 && Math.abs(lines[j] - car.z) < 9) { nearInter = true; break; }
    }
    if (nearInter && rng.chance(0.004)) car.targetSpeed = 4;
    if (nearInter && rng.chance(0.006)) car.heading += (rng.chance(0.5) ? 1 : -1) * Math.PI / 2;
    if (Math.abs(car.x) > half - 4 || Math.abs(car.z) > half - 4) {
      car.heading += Math.PI;
      car.x = U.clamp(car.x, -half + 8, half + 8);
      car.z = U.clamp(car.z, -half + 8, half + 8);
    }
    driveStep(car, car.speed < car.targetSpeed ? 0.8 : 0, car.steer, dt, 16);
  }
  function policeThink(car, px, pz, dt) {
    var dx = px - car.x, dz = pz - car.z;
    var want = Math.atan2(dx, dz);
    var diff = U.angleDiff(car.heading, want);
    car.steer = U.clamp(diff * 1.6, -1, 1);
    var dist = Math.sqrt(dx * dx + dz * dz);
    car.targetSpeed = dist > 60 ? 33 : (dist > 12 ? 28 : 16);
    driveStep(car, car.speed < car.targetSpeed ? 1 : 0, car.steer, dt, 35);
  }
  function makePed(rng, x, z) {
    var person = makePerson(rng, {});
    var ped = {
      x: x, z: z, heading: rng.range(0, Math.PI * 2),
      speed: rng.range(1.1, 2.0), person: person,
      walkPhase: rng.range(0, 6), flee: 0, tx: x, tz: z,
      retarget: rng.range(0, 4),
      contactType: rng.int(0, 4), interacted: false,
    };
    person.group.position.set(x, 0, z);
    return ped;
  }
  function pedThink(ped, city, rng, dt, threat) {
    ped.retarget -= dt;
    var fleeing = ped.flee > 0;
    if (threat && U.dist2(ped.x, ped.z, threat.x, threat.z) < 900) { ped.flee = 2.5; fleeing = true; }
    if (ped.flee > 0) ped.flee -= dt;
    if (ped.retarget <= 0 || U.dist2(ped.x, ped.z, ped.tx, ped.tz) < 4) {
      ped.retarget = rng.range(3, 7);
      if (fleeing && threat) {
        var a = Math.atan2(ped.x - threat.x, ped.z - threat.z) + rng.range(-0.5, 0.5);
        ped.tx = ped.x + Math.sin(a) * 30;
        ped.tz = ped.z + Math.cos(a) * 30;
      } else {
        var sp = rng.pick(city.pedSpawns);
        ped.tx = sp.x + rng.range(-8, 8);
        ped.tz = sp.z + rng.range(-8, 8);
      }
    }
    var dx = ped.tx - ped.x, dz = ped.tz - ped.z;
    var want = Math.atan2(dx, dz);
    ped.heading = U.lerpAngle(ped.heading, want, U.clamp(dt * 4, 0, 1));
    var spd = fleeing ? 5.2 : ped.speed;
    ped.x += Math.sin(ped.heading) * spd * dt;
    ped.z += Math.cos(ped.heading) * spd * dt;
    var res = SC.world.resolveCollision(city, ped.x, ped.z, 0.5);
    ped.x = res.x; ped.z = res.z;
    ped.walkPhase += dt * spd * 3.2;
    animateWalk(ped.person, ped.walkPhase, fleeing ? 0.7 : 0.45);
    ped.person.group.position.set(ped.x, 0, ped.z);
    ped.person.group.rotation.y = ped.heading;
  }
  SC.actors = {
    makePerson: makePerson, animateWalk: animateWalk, makeCar: makeCar,
    makeCarState: makeCarState, driveStep: driveStep, syncCarModel: syncCarModel,
    trafficThink: trafficThink, policeThink: policeThink,
    makePed: makePed, pedThink: pedThink, CAR_COLORS: CAR_COLORS,
    CAR_TYPES: CAR_TYPES, pickCarType: pickCarType,
  };
})(typeof window !== 'undefined' ? window : globalThis);
