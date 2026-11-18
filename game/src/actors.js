// Actors for Solmar City: the player, cars (player / traffic / police),
// pedestrians and police officers. All models are built from boxes and
// cylinders with a small palette, and every actor is a plain object the
// game loop updates.
(function (global) {
  'use strict';
  var SC = global.SC;
  var U = SC.util;

  var SKIN = [0xc9996a, 0x8a5a34, 0xe8b98a, 0x6b4423];
  var SHIRT = [0x2e86de, 0xe05a5a, 0x37b24d, 0xf2c14e, 0x9b59b6, 0x20c997, 0xfd7e14, 0xe9ecef];
  var PANTS = [0x2c3e50, 0x495057, 0x5d4037, 0x1b2a4a];
  var CAR_COLORS = [0xd63031, 0x0984e3, 0xfdcb6e, 0x00b894, 0x6c5ce7, 0xe17055, 0x2d3436, 0xdfe6e9, 0x00cec9, 0xe84393];

  // Three distinct car types. A sports car is fast but light, a van is slow
  // and heavy, a sedan sits in the middle. Top speed / acceleration are
  // read by driveStep from the car's own state, so every car type feels
  // different to drive — and to outrun.
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

  // ---- a simple blocky person. Returns {group, legL, legR, armL, armR, head}.
  function makePerson(rng, opts) {
    opts = opts || {};
    var skin = opts.skin !== undefined ? opts.skin : rng.pick(SKIN);
    var shirt = opts.shirt !== undefined ? opts.shirt : rng.pick(SHIRT);
    var pants = opts.pants !== undefined ? opts.pants : rng.pick(PANTS);
    var g = new THREE.Group();
    var mat = function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat(shirt));
    torso.position.y = 1.05; torso.castShadow = true;
    g.add(torso);
    // jacket: a darker open-front layer over the shirt, so a jacketed
    // character (Danny's gold jacket) reads at a glance; plain peds skip it
    if (opts.jacket) {
      var jk = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.6, 0.38), mat(opts.jacket));
      jk.position.y = 1.08; jk.castShadow = true; g.add(jk);
    }
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(skin));
    head.position.y = 1.66; head.castShadow = true;
    g.add(head);
    // eyes: two dark beads on the face (+z is forward)
    var eyeG = new THREE.SphereGeometry(0.055, 6, 5), eyeM = mat(0x141414);
    var eL = new THREE.Mesh(eyeG, eyeM); eL.position.set(-0.09, 1.68, 0.21); g.add(eL);
    var eR = eL.clone(); eR.position.x = 0.09; g.add(eR);
    // hair cap: a flattened dome on top of the head
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 6), mat(opts.hair !== undefined ? opts.hair : 0x1a1a1a));
    hair.scale.y = 0.55; hair.position.y = 1.78;
    g.add(hair);
    var legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), mat(pants));
    legL.position.set(-0.16, 0.36, 0); legL.castShadow = true;
    g.add(legL);
    var legR = legL.clone(); legR.position.x = 0.16; g.add(legR);
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), mat(shirt));
    armL.position.set(-0.42, 1.05, 0); armL.castShadow = true;
    g.add(armL);
    var armR = armL.clone(); armR.position.x = 0.42; g.add(armR);
    if (opts.hat) {
      var hat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.1, 10), mat(opts.hat));
      hat.position.y = 1.98; g.add(hat);
    }
    // police badge: a gold dot on the chest, so officers read as police
    if (opts.badge) {
      var badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.03), mat(0xffd23f));
      badge.position.set(-0.18, 1.28, 0.19); g.add(badge);
    }
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR, head: head };
  }

  function animateWalk(person, phase, amount) {
    var s = Math.sin(phase) * amount;
    person.legL.rotation.x = s;
    person.legR.rotation.x = -s;
    person.armL.rotation.x = -s * 0.8;
    person.armR.rotation.x = s * 0.8;
  }

  // Shared car trim so every car doesn't allocate its own: hubcap discs,
  // bumper bars and grille strips.
  var HUB_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10);
  var HUB_MAT = new THREE.MeshLambertMaterial({ color: 0xb8bec6 });
  var BUMP_MAT = new THREE.MeshLambertMaterial({ color: 0x222222 });

  // ---- a car. Returns {group, wheels:[4], bodyMat}. Police cars get a light bar.
  // type: 'sedan' | 'sport' | 'van' — each shapes the body differently.
  function makeCar(rng, color, isPolice, type) {
    var g = new THREE.Group();
    var t = CAR_TYPES[type] || CAR_TYPES.sedan;
    var bodyColor = isPolice ? 0x1c2733 : (color !== undefined ? color : rng.pick(CAR_COLORS));
    var bodyMat = new THREE.MeshPhongMaterial({ color: bodyColor, shininess: 70, specular: 0x333333 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(t.bodyW, t.bodyH, t.bodyL), bodyMat);
    body.position.y = 0.35 + t.bodyH / 2; body.castShadow = true;
    g.add(body);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, t.cabinH, 2.1),
      new THREE.MeshPhongMaterial({ color: isPolice ? 0x1c2733 : 0x18242e, shininess: 90, specular: 0x557788 }));
    cabin.position.set(0, t.cabinY, -0.25); cabin.castShadow = true;
    g.add(cabin);
    // windshield tint
    var glass = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.4, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x9fd8ef, emissive: 0x223344 }));
    glass.position.set(0, t.cabinY - 0.03, 0.85);
    g.add(glass);
    // a sports car gets a rear spoiler; a van gets a roof box
    if (t.spoiler) {
      var spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.4),
        new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
      spoiler.position.set(0, 1.15, -2.1);
      g.add(spoiler);
    }
    if (type === 'van') {
      var roofBox = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 2.4),
        new THREE.MeshLambertMaterial({ color: bodyColor }));
      roofBox.position.set(0, t.cabinY + t.cabinH / 2 + 0.15, -0.3);
      roofBox.castShadow = true;
      g.add(roofBox);
      // dark rear window so the van's back is not one flat slab
      var rw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.06), new THREE.MeshLambertMaterial({ color: 0x18242e }));
      rw.position.set(0, t.cabinY, -1.32); g.add(rw);
    }
    // bumpers + grille: the front/rear bars that make a box read as a car
    for (var bi = 0; bi < 2; bi++) {
      var bz = bi ? 1 : -1;
      var bump = new THREE.Mesh(new THREE.BoxGeometry(t.bodyW + 0.06, 0.18, 0.22), BUMP_MAT);
      bump.position.set(0, 0.32, bz * (t.bodyL / 2 - 0.02)); g.add(bump);
    }
    var grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.06), BUMP_MAT);
    grille.position.set(0, 0.62, t.bodyL / 2 + 0.01); g.add(grille);
    // headlights / taillights
    var hl = new THREE.MeshLambertMaterial({ color: 0xfff6c0, emissive: 0x888844 });
    var tl = new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0x661111 });
    var positions = [[-0.7, 2.12], [0.7, 2.12]];
    for (var i = 0; i < 2; i++) {
      var h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), hl);
      h.position.set(positions[i][0], 0.66, positions[i][1]);
      g.add(h);
      var t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), tl);
      t.position.set(positions[i][0], 0.66, -2.12);
      g.add(t);
    }
    if (isPolice) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.4),
        new THREE.MeshLambertMaterial({ color: 0x222222 }));
      bar.position.set(0, 1.52, -0.25);
      g.add(bar);
      var r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.42),
        new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa0000 }));
      r.position.set(-0.32, 1.62, -0.25); r.name = 'lightR';
      g.add(r);
      var b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.42),
        new THREE.MeshLambertMaterial({ color: 0x2244ff, emissive: 0x0022aa }));
      b.position.set(0.32, 1.62, -0.25); b.name = 'lightB';
      g.add(b);
      // white doors stripe
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.3, 2.6),
        new THREE.MeshLambertMaterial({ color: 0xf1f2f6 }));
      stripe.position.set(0, 0.62, 0);
      g.add(stripe);
    }
    var wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
    var wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
    var wheels = [];
    var wpos = [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]];
    for (var w = 0; w < 4; w++) {
      var wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wpos[w][0], 0.36, wpos[w][1]);
      wheel.castShadow = true;
      // hubcap disc on the wheel's outer face (a child, so it steers and
      // spins with the wheel); local +Y maps to world -X after the z-turn,
      // so the sign flips per side
      var hub = new THREE.Mesh(HUB_GEO, HUB_MAT);
      hub.position.y = wpos[w][0] > 0 ? -0.15 : 0.15;
      wheel.add(hub);
      g.add(wheel);
      wheels.push(wheel);
    }
    // side mirrors: two small dark boxes just outside the body, sitting
    // just above the beltline (height adapts to the car type)
    var mirrorMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    var mirrorY = 0.35 + t.bodyH + 0.08;
    var mirrorX = t.bodyW / 2 + 0.05;
    var ml = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.08), mirrorMat);
    ml.position.set(-mirrorX, mirrorY, 0.4);
    g.add(ml);
    var mr = ml.clone(); mr.position.x = mirrorX; g.add(mr);
    return { group: g, wheels: wheels, bodyMat: bodyMat };
  }

  // ---- car physics + AI shared by player-driven, traffic and police cars.
  function makeCarState(x, z, heading, kind, type) {
    var t = CAR_TYPES[type] || CAR_TYPES.sedan;
    return {
      x: x, z: z, heading: heading, speed: 0,
      kind: kind || 'traffic', // 'player' | 'traffic' | 'police'
      carType: type || 'sedan',
      topSpeed: t.topSpeed,
      accel: t.accel,
      steer: 0, // -1..1
      targetSpeed: 0,
      stuck: 0,
      model: null,
    };
  }

  // Arcade drive step. throttle -1..1, steer -1..1, dt seconds.
  // handbrake (optional): while held at speed the car rotates harder and
  // scrubs speed, so a handbrake turn feels like a slide, not a stop.
  // A car's own topSpeed / accel win over the passed-in maxSpeed.
  function driveStep(car, throttle, steer, dt, maxSpeed, handbrake) {
    var accel = car.accel || (throttle >= 0 ? 14 : 22);
    car.speed += throttle * accel * dt;
    if (throttle === 0) {
      // rolling friction
      car.speed -= car.speed * 1.1 * dt;
      if (Math.abs(car.speed) < 0.1) car.speed = 0;
    }
    if (handbrake && Math.abs(car.speed) > 6) {
      // extra drag + a sharper turn while sliding
      car.speed -= car.speed * 0.9 * dt;
    }
    var ms = car.topSpeed || maxSpeed || 34;
    if (car.speed > ms) car.speed = ms;
    if (car.speed < -10) car.speed = -10;
    var spd = Math.abs(car.speed);
    var turnRate = 1.9 * (spd / (spd + 6));
    if (handbrake && spd > 6) turnRate *= 1.55;
    car.heading += steer * turnRate * dt * (car.speed >= 0 ? 1 : -1);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
  }

  function syncCarModel(car) {
    if (!car.model) return;
    car.model.group.position.set(car.x, 0, car.z);
    car.model.group.rotation.y = car.heading;
    var spin = car.speed * 0.016 * 2.5;
    for (var i = 0; i < 4; i++) car.model.wheels[i].rotation.x += spin;
    // front wheels steer visually
    car.model.wheels[0].rotation.y = car.steer * 0.4;
    car.model.wheels[1].rotation.y = car.steer * 0.4;
  }

  // ---- traffic AI: follow road lines, turn at intersections.
  function trafficThink(car, city, rng, dt) {
    // Find nearest road line in the car's current axis.
    var lines = city.roadLines;
    var half = city.half;
    var alongX = Math.abs(Math.sin(car.heading)) > 0.7; // mostly moving along X
    var pos = alongX ? car.z : car.x;
    var nearest = lines[0], nd = 1e9;
    for (var i = 0; i < lines.length; i++) {
      var d = Math.abs(lines[i] - pos);
      if (d < nd) { nd = d; nearest = lines[i]; }
    }
    // Steer back toward the lane center.
    var targetHeading;
    var dir = alongX ? Math.sign(Math.sin(car.heading)) : Math.sign(Math.cos(car.heading));
    if (alongX) {
      targetHeading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      // pull z toward the lane
      var dz = nearest - car.z;
      targetHeading += U.clamp(dz * 0.03, -0.5, 0.5) * (dir > 0 ? 1 : -1);
    } else {
      targetHeading = dir > 0 ? 0 : Math.PI;
      var dx = nearest - car.x;
      targetHeading += U.clamp(dx * 0.03, -0.5, 0.5) * (dir > 0 ? -1 : 1);
    }
    car.steer = U.clamp(U.angleDiff(car.heading, targetHeading) * 1.4, -1, 1);
    car.targetSpeed = 11 + Math.sin(car.x * 0.01 + car.z * 0.013) * 2;
    // Slow near intersections to look like real traffic.
    var nearInter = false;
    for (var j = 0; j < lines.length; j++) {
      if (Math.abs(lines[j] - car.x) < 9 && Math.abs(lines[j] - car.z) < 9) { nearInter = true; break; }
    }
    if (nearInter && rng.chance(0.004)) car.targetSpeed = 4;
    // Randomly turn at an intersection.
    if (nearInter && rng.chance(0.006)) {
      car.heading += (rng.chance(0.5) ? 1 : -1) * Math.PI / 2;
    }
    // Keep inside the city.
    if (Math.abs(car.x) > half - 4 || Math.abs(car.z) > half - 4) {
      car.heading += Math.PI;
      car.x = U.clamp(car.x, -half + 8, half + 8);
      car.z = U.clamp(car.z, -half + 8, half + 8);
    }
    var throttle = car.speed < car.targetSpeed ? 0.8 : 0;
    driveStep(car, throttle, car.steer, dt, 16);
  }

  // ---- police chase AI: steer straight at the player. Police are quick
  // off the line but top out just below the player's best speed, so a clean
  // straight run can lose them — weaving through the city is the escape.
  function policeThink(car, px, pz, dt) {
    var dx = px - car.x, dz = pz - car.z;
    var want = Math.atan2(dx, dz);
    var diff = U.angleDiff(car.heading, want);
    car.steer = U.clamp(diff * 1.6, -1, 1);
    var dist = Math.sqrt(dx * dx + dz * dz);
    car.targetSpeed = dist > 60 ? 33 : (dist > 12 ? 28 : 16);
    var throttle = car.speed < car.targetSpeed ? 1 : 0;
    driveStep(car, throttle, car.steer, dt, 35);
    // Ram slowdown on hard contact is handled by the game (collision).
  }

  // ---- pedestrian: wanders sidewalks, flees when scared.
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
    if (threat && U.dist2(ped.x, ped.z, threat.x, threat.z) < 900) {
      ped.flee = 2.5;
      fleeing = true;
    }
    if (ped.flee > 0) ped.flee -= dt;
    if (ped.retarget <= 0 || U.dist2(ped.x, ped.z, ped.tx, ped.tz) < 4) {
      ped.retarget = rng.range(3, 7);
      if (fleeing && threat) {
        // run away from the threat
        var a = Math.atan2(ped.x - threat.x, ped.z - threat.z) + rng.range(-0.5, 0.5);
        ped.tx = ped.x + Math.sin(a) * 30;
        ped.tz = ped.z + Math.cos(a) * 30;
      } else {
        // wander to a nearby sidewalk point
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
