// Solmar City — the game itself. An open-world crime game in the spirit of
// GTA 6, built from scratch in three.js: a procedural coastal city, on-foot
// and driving play, traffic, pedestrians, a wanted system with police,
// four story missions, pistol combat, a HUD with minimap, and a save.
// Everything here is original: the city, names, story, art and sound.
(function (global) {
  'use strict';
  var SC = global.SC;
  var U = SC.util;
  var A = SC.actors;
  var W = SC.world;

  // ---------- query params: ?shot=<name>&seed=<n> for screenshots ----------
  var QS = {};
  (global.location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var p = kv.split('=');
    QS[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });
  var SEED = parseInt(QS.seed || '1337', 10) || 1337;
  var SHOT = QS.shot || '';

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var canvas = $('game-canvas');
  var hud = $('hud'), cashEl = $('cash'), wantedEl = $('wanted');
  var healthBar = $('health-bar'), healthNum = $('health-num'), ammoEl = $('ammo');
  var objTitle = $('obj-title'), objText = $('obj-text');
  var minimap = $('minimap'), mctx = minimap.getContext('2d');
  var speedEl = $('speed'), carNameEl = $('carname'), hintEl = $('hint'), toastEl = $('toast');
  var heatGlow = $('heat-glow');
  var clockEl = $('clock');
  var crosshairEl = $('crosshair'), interactEl = $('interact');

  // ---------- three.js setup ----------
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
  renderer.setSize(global.innerWidth, global.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(62, global.innerWidth / global.innerHeight, 0.1, 1200);

  global.addEventListener('resize', function () {
    camera.aspect = global.innerWidth / global.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(global.innerWidth, global.innerHeight);
  });

  var rng = U.makeRng(SEED);
  var city = W.buildCity(scene, rng);
  var audio = new SC.audio.AudioEngine();
  // find the sun once here — updateCamera used to walk the whole scene
  // every frame just to find this one light
  var sunLight = null;
  scene.traverse(function (o) { if (o.isDirectionalLight) sunLight = o; });

  // ---------- game state ----------
  var SAVE_KEY = 'solmar-city-save-v1';
  var MISSION_COUNT = 10; // must match MISSIONS.length below (4 original + 3 + 3 new)
  var state = 'title'; // 'title' | 'playing' | 'paused' | 'gameover'
  var save = loadSave();
  var cash = save.cash;
  var missionsDone = save.completed.slice();
  var collectedPickups = save.pickups.slice(); // indices of cash bundles already grabbed
  var collectedStars = save.stars.slice(); // indices of gold stars already collected
  var ownedItems = save.owned; // shop purchases: comet car, smg, shotgun, armor
  var ammoCounts = save.ammo; // smg bullets + shotgun shells
  var maxHealth = ownedItems.armor ? 150 : 100;
  // resume at the first job not yet finished, so a reload never re-offers
  // a job the player already completed
  var missionIndex = missionsDone.indexOf(false);
  if (missionIndex < 0) missionIndex = MISSION_COUNT;
  var missionActive = null; // current mission runtime object
  var health = maxHealth;
  var wanted = 0;
  var wantedTimer = 0; // time since last crime
  var decayTimer = 0;
  var bestStars = save.bestStars || 0;
  var muted = false;
  var gameTime = 0;
  var lastDamageAt = -999;
  var toastTimer = 0;

  // ---------- player ----------
  var player = {
    x: 0, z: 20, y: 0, vy: 0, heading: 0, walkPhase: 0,
    onGround: true, inCar: null, speed: 0,
    person: A.makePerson(rng, { shirt: 0xf2c14e, pants: 0x2c3e50, skin: 0xc9996a, hair: 0x1a1a1a }),
  };
  scene.add(player.person.group);

  // camera orbit
  var camYaw = 0, camPitch = 0.32;

  // ---------- entities ----------
  var trafficCars = [];
  var parkedCars = [];
  var peds = [];
  var policeCars = [];
  var officers = [];
  var pickups = []; // gold cash bundles, 10 across the city
  var missionMarker = null; // THREE group for the beacon
  var tracers = [];
  // taxi side job: a fare waits at a cyan marker, the player drives them
  // across town for cash. 'off' | 'waiting' | 'active' | 'cooldown'.
  var taxi = { state: 'off', spawnTimer: 6, farePed: null, fareX: 0, fareZ: 0, destX: 0, destZ: 0, timer: 0, cooldown: 0, marker: null, lastFootToast: -999 };
  var smokePuffs = []; // damage smoke when health is low
  var lastSmokeAt = -999;
  var burstParts = []; // gold cash-burst particles on mission complete
  var stars = []; // 20 collectible gold stars across the city
  var ramps = []; // 3 stunt ramps: drive over one fast to catch air
  // New features: a bank robbery chain, purchasable safehouses, street
  // races, and NPC contacts who hand out small jobs.
  var ownedProperties = save.properties ? save.properties.slice() : [];
  var bankDone = !!save.bankDone;
  var npcJobsDone = save.npcJobs || 0;
  var bankJob = { active: false, step: 0, timer: 0, marker: null };
  var properties = [];
  var races = [];
  var activeRace = null;
  var npcTalkCooldown = 0;
  var airborne = 0, stuntRewardTimer = 0, carAirY = 0, carAirVy = 0;
  var rainActive = false, rainTimer = 0, rainNext = 120, rainRng = U.makeRng(SEED ^ 0x51a7);
  var rainCanvas = null, rainCtx = null, rainDrops = [];
  var starCountEl = null, stuntHudEl = null;
  var helicopter = null, helicopterLight = null, helicopterTarget = null, helicopterCone = null;
  // day/night: 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight. One full
  // day is 8 minutes of game time. Screenshots stay at sunny late morning.
  var dayPhase = 0.2;
  var DAY_LENGTH = 480;
  var sunDX = 120, sunDY = 192, sunDZ = 72;
  var skyDay = new THREE.Color(0x8ec9ee), skyDusk = new THREE.Color(0xff9a5a), skyNight = new THREE.Color(0x0a1626);
  var fogDay = new THREE.Color(0xcfe8f7), fogDusk = new THREE.Color(0xf7b06a), fogNight = new THREE.Color(0x0e1a26);
  var skyTmp = new THREE.Color(), fogTmp = new THREE.Color();
  // one reusable muzzle-flash light, lit for a few frames per shot
  var muzzleLight = new THREE.PointLight(0xffd23f, 0, 12);
  scene.add(muzzleLight);
  var muzzleLife = 0;
  // camera shake from hard crashes, decays over ~half a second
  var shake = 0;

  function spawnTrafficCar(x, z, heading) {
    var type = A.pickCarType(rng);
    var model = A.makeCar(rng, undefined, false, type);
    var car = A.makeCarState(x, z, heading, 'traffic', type);
    car.model = model;
    scene.add(model.group);
    trafficCars.push(car);
    return car;
  }

  function spawnParkedCar(spot, color) {
    var type = A.pickCarType(rng);
    var model = A.makeCar(rng, color, false, type);
    var car = A.makeCarState(spot.x, spot.z, spot.angle, 'parked', type);
    car.model = model;
    scene.add(model.group);
    A.syncCarModel(car);
    parkedCars.push(car);
    return car;
  }

  function spawnPoliceCar(x, z) {
    var model = A.makeCar(rng, undefined, true, 'sedan');
    var car = A.makeCarState(x, z, 0, 'police', 'sedan');
    car.model = model;
    car.hp = 5;
    scene.add(model.group);
    policeCars.push(car);
    return car;
  }

  // ---------- police roadblocks ----------
  // At 3+ stars the police set up roadblocks: two cruisers parked across
  // the road the player is driving along, ~55 units ahead, facing the
  // oncoming player. They are real police cars, so they collide, can be
  // shot, and show on the minimap — but they never chase.
  var roadblockCooldown = 20;
  function spawnRoadblock() {
    var fx, fz;
    if (player.inCar) { fx = Math.sin(player.inCar.angle); fz = Math.cos(player.inCar.angle); }
    else { fx = Math.sin(player.angle); fz = Math.cos(player.angle); }
    var eastWest = Math.abs(fx) > Math.abs(fz);
    var dir = eastWest ? (fx > 0 ? 1 : -1) : (fz > 0 ? 1 : -1);
    var cross = eastWest ? player.z : player.x;
    var line = city.roadLines.reduce(function (best, l) {
      return Math.abs(l - cross) < Math.abs(best - cross) ? l : best;
    }, city.roadLines[0]);
    var along = eastWest ? player.x : player.z;
    along = U.clamp(along + dir * 55, -city.half + 20, city.half - 20);
    var face = eastWest ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    for (var i = 0; i < 2; i++) {
      var off = (i === 0 ? -3.6 : 3.6);
      var cx = eastWest ? along : line + off;
      var cz = eastWest ? line + off : along;
      var car = spawnPoliceCar(cx, cz);
      car.roadblock = true;
      car.roadblockTimer = 30;
      car.angle = face + Math.PI; // face the oncoming player
      car.heading = car.angle;
      car.speed = 0;
      A.syncCarModel(car);
    }
    showToast('POLICE ROADBLOCK AHEAD!');
    audio.blip('alarm');
  }

  function spawnOfficer(x, z) {
    var person = A.makePerson(rng, { shirt: 0x1c2733, pants: 0x1c2733, skin: rng.pick([0xc9996a, 0x8a5a34, 0xe8b98a]), hat: 0x1c2733 });
    var off = { x: x, z: z, heading: 0, person: person, walkPhase: 0, hp: 2, shootTimer: rng.range(0.5, 1.5) };
    person.group.position.set(x, 0, z);
    scene.add(person.group);
    officers.push(off);
    return off;
  }

  function spawnPed(x, z) {
    var ped = A.makePed(rng, x, z);
    scene.add(ped.person.group);
    peds.push(ped);
    return ped;
  }

  // A spinning gold cash bundle. Already-grabbed ones (from the save) start hidden.
  function spawnPickup(x, z, idx) {
    var mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7),
      new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400 }));
    mesh.position.set(x, 1, z);
    mesh.castShadow = true;
    scene.add(mesh);
    var taken = collectedPickups.indexOf(idx) >= 0;
    mesh.visible = !taken;
    pickups.push({ x: x, z: z, mesh: mesh, taken: taken, index: idx, phase: rng.range(0, 6) });
    return mesh;
  }

  // ---------- stunt ramps, collectible stars, weather and police helicopter ----------
  // Three orange stunt ramps around town. Hit one fast in a car and you
  // catch air; every half second airborne pays $25.
  function makeStuntRamps() {
    var specs = [
      { x: -60, z: 40, angle: 25 },
      { x: 30, z: -80, angle: 25 },
      { x: 90, z: 60, angle: 25 },
    ];
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      var group = new THREE.Group();
      var ramp = new THREE.Mesh(
        new THREE.BoxGeometry(6, 1.1, 10),
        new THREE.MeshLambertMaterial({ color: 0xe87932, emissive: 0x351306 }));
      ramp.position.y = 0.55;
      ramp.rotation.x = -s.angle * Math.PI / 180;
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      group.add(ramp);
      var stripe = new THREE.Mesh(
        new THREE.BoxGeometry(5.4, 0.08, 1),
        new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      stripe.position.set(0, 1.12, -3.5);
      group.add(stripe);
      group.position.set(s.x, 0, s.z);
      group.rotation.y = s.angle * Math.PI / 180;
      scene.add(group);
      ramps.push({ x: s.x, z: s.z, angle: s.angle, group: group, cooldown: 0 });
    }
  }

  // A 3D extruded five-point star, built once and shared by all 20 stars.
  function makeStarGeometry() {
    var shape = new THREE.Shape();
    for (var i = 0; i < 10; i++) {
      var a = Math.PI / 2 + i * Math.PI / 5;
      var r = i % 2 === 0 ? 0.95 : 0.42;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.06, bevelThickness: 0.06 });
  }

  // 20 gold stars hidden around the city on sidewalk spots. Positions come
  // from their own seeded RNG stream, so they never move between runs.
  function makeStars() {
    var starRng = U.makeRng(SEED ^ 0x57a2);
    var geo = makeStarGeometry();
    for (var i = 0; i < 20; i++) {
      var sp = city.pedSpawns[starRng.int(0, city.pedSpawns.length - 1)];
      var x = sp.x + starRng.range(-5, 5);
      var z = sp.z + starRng.range(-5, 5);
      var resolved = W.resolveCollision(city, x, z, 0.8);
      var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffd21f, emissive: 0x775000 }));
      mesh.position.set(resolved.x, 1.35, resolved.z);
      mesh.castShadow = true;
      mesh.rotation.x = -0.12;
      scene.add(mesh);
      var taken = collectedStars.indexOf(i) >= 0;
      mesh.visible = !taken;
      stars.push({ x: resolved.x, z: resolved.z, mesh: mesh, taken: taken, index: i, phase: starRng.range(0, 6) });
    }
    starCountEl = document.createElement('div');
    starCountEl.id = 'star-count';
    starCountEl.style.cssText = 'position:fixed;top:86px;right:16px;color:#ffe36b;font:bold 16px Trebuchet MS,Verdana,sans-serif;text-shadow:0 1px 4px #000;z-index:6;pointer-events:none';
    document.body.appendChild(starCountEl);
    stuntHudEl = document.createElement('div');
    stuntHudEl.id = 'stunt-airtime';
    stuntHudEl.style.cssText = 'position:fixed;top:112px;right:16px;color:#fff;font:bold 15px Trebuchet MS,Verdana,sans-serif;text-shadow:0 1px 4px #000;z-index:6;pointer-events:none;display:none';
    document.body.appendChild(stuntHudEl);
    updateStarHud();
  }

  function updateStarHud() {
    var count = collectedStars.length;
    if (starCountEl) starCountEl.textContent = '★ STARS ' + count + '/20';
  }

  function updateStars(dt) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (s.taken) continue;
      s.mesh.rotation.y += dt * 1.8;
      s.mesh.position.y = 1.35 + Math.sin(gameTime * 2.5 + s.phase) * 0.22;
      if (U.dist2(player.x, player.z, s.x, s.z) < 4) {
        s.taken = true;
        s.mesh.visible = false;
        collectedStars.push(s.index);
        cash += 50;
        audio.blip('pickup');
        if (collectedStars.length >= 20) {
          cash += 500;
          showToast('ALL 20 STARS! BONUS +$500');
        } else {
          showToast('GOLD STAR  +$50  (' + collectedStars.length + '/20)');
        }
        updateStarHud();
        writeSave();
      }
    }
  }

  // Stunt jumps: drive over a ramp faster than 25 and the car goes
  // airborne on a fixed-arc jump. Every half second in the air pays $25.
  function updateRamps(dt) {
    if (!player.inCar) return;
    var car = player.inCar;
    for (var i = 0; i < ramps.length; i++) {
      var r = ramps[i];
      if (r.cooldown > 0) r.cooldown = Math.max(0, r.cooldown - dt);
      if (r.cooldown <= 0 && carAirY <= 0.01 && Math.abs(car.speed) > 25 &&
          U.dist2(car.x, car.z, r.x, r.z) < 42) {
        carAirVy = 9.5;
        carAirY = 0.08;
        airborne = 0;
        stuntRewardTimer = 0;
        r.cooldown = 2.5;
        showToast('STUNT JUMP!');
        break;
      }
    }
    if (carAirY > 0 || carAirVy > 0) {
      if (stuntHudEl) {
        stuntHudEl.style.display = 'block';
        stuntHudEl.textContent = 'AIR TIME  ' + airborne.toFixed(1) + 's';
      }
      carAirVy -= 18 * dt;
      carAirY += carAirVy * dt;
      airborne += dt;
      stuntRewardTimer += dt;
      while (stuntRewardTimer >= 0.5) {
        stuntRewardTimer -= 0.5;
        cash += 25;
        updateHud(0);
      }
      if (carAirY <= 0) {
        carAirY = 0;
        carAirVy = 0;
        car.model.group.position.y = 0;
        showToast('STUNT LANDED  +' + Math.floor(airborne * 2) * 25 + '$');
        airborne = 0;
        if (stuntHudEl) stuntHudEl.style.display = 'none';
      }
      car.model.group.position.y = carAirY;
    }
  }

  // Rain: a 2D canvas overlay of falling streaks, driven by its own seeded
  // RNG stream. Screenshots never see rain (createRainLayer skips SHOT
  // mode), and live play gets a 30-second shower every ~2 minutes.
  function createRainLayer() {
    if (SHOT) return;
    rainCanvas = document.createElement('canvas');
    rainCanvas.id = 'rain-layer';
    rainCanvas.width = global.innerWidth;
    rainCanvas.height = global.innerHeight;
    rainCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;display:none';
    document.body.appendChild(rainCanvas);
    rainCtx = rainCanvas.getContext('2d');
    for (var i = 0; i < 150; i++) rainDrops.push({
      x: rainRng.range(0, rainCanvas.width), y: rainRng.range(0, rainCanvas.height),
      length: rainRng.range(8, 22), speed: rainRng.range(500, 900)
    });
    global.addEventListener('resize', function () {
      if (!rainCanvas) return;
      rainCanvas.width = global.innerWidth;
      rainCanvas.height = global.innerHeight;
    });
  }

  function updateWeather(dt) {
    if (SHOT || !rainCanvas) return;
    if (rainActive) {
      rainTimer -= dt;
      if (rainTimer <= 0) {
        rainActive = false;
        rainNext = rainRng.range(110, 130);
        rainCanvas.style.display = 'none';
        showToast('THE RAIN HAS CLEARED');
      }
    } else {
      rainNext -= dt;
      if (rainNext <= 0) {
        rainActive = true;
        rainTimer = 30;
        rainCanvas.style.display = 'block';
        showToast('RAIN INCOMING');
      }
    }
    if (!rainActive) return;
    rainCtx.clearRect(0, 0, rainCanvas.width, rainCanvas.height);
    rainCtx.strokeStyle = 'rgba(190,220,255,0.48)';
    rainCtx.lineWidth = 1;
    rainCtx.beginPath();
    for (var i = 0; i < rainDrops.length; i++) {
      var d = rainDrops[i];
      d.y += d.speed * dt;
      d.x -= d.speed * dt * 0.12;
      if (d.y > rainCanvas.height + d.length) {
        d.y = -d.length;
        d.x = rainRng.range(0, rainCanvas.width);
      }
      if (d.x < -10) d.x = rainCanvas.width + 10;
      rainCtx.moveTo(d.x, d.y);
      rainCtx.lineTo(d.x - 3, d.y + d.length);
    }
    rainCtx.stroke();
  }

  // Police helicopter: appears at 4+ stars, circles the player with a
  // searchlight cone, and leaves once the heat drops below 3.
  function createPoliceHelicopter() {
    var group = new THREE.Group();
    var dark = new THREE.MeshLambertMaterial({ color: 0x263747 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.5, 2.1), dark);
    group.add(body);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.8), new THREE.MeshLambertMaterial({ color: 0x91b9c9 }));
    nose.position.z = 1.65;
    group.add(nose);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 5.2), dark);
    tail.position.z = -3.2;
    group.add(tail);
    var rotor = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 9), new THREE.MeshBasicMaterial({ color: 0x111820 }));
    rotor.position.y = 1.05;
    group.add(rotor);
    var rotor2 = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.35), rotor.material);
    rotor2.position.y = 1.05;
    group.add(rotor2);
    helicopterLight = new THREE.SpotLight(0xfff2c0, 5, 75, Math.PI / 5, 0.45, 1);
    helicopterLight.position.set(0, -0.5, 0.5);
    group.add(helicopterLight);
    helicopterTarget = new THREE.Object3D();
    scene.add(helicopterTarget);
    helicopterLight.target = helicopterTarget;
    // a visible searchlight cone from the helicopter down to the player:
    // the camera looks down at the street, so the helicopter itself is
    // usually out of frame — the sweeping cone is how you see it coming
    helicopterCone = new THREE.Mesh(
      new THREE.ConeGeometry(7, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    helicopterCone.visible = false;
    scene.add(helicopterCone);
    group.visible = false;
    scene.add(group);
    helicopter = { group: group, rotor: rotor, rotor2: rotor2, angle: 0 };
  }

  function updatePoliceHelicopter(dt) {
    if (!helicopter) return;
    if (wanted >= 4) {
      helicopter.group.visible = true;
      helicopter.angle += dt * 0.32;
      var hx = player.x + Math.cos(helicopter.angle) * 24;
      var hz = player.z + Math.sin(helicopter.angle) * 24;
      var hy = 26 + Math.sin(gameTime * 1.8) * 1.5;
      helicopter.group.position.set(hx, hy, hz);
      helicopter.group.lookAt(player.x, 0, player.z);
      helicopter.rotor.rotation.y += dt * 22;
      helicopter.rotor2.rotation.y -= dt * 22;
      helicopterTarget.position.set(player.x, 0, player.z);
      // aim the searchlight cone from the helicopter down at the player:
      // the cone is 1 unit tall with its apex up, so stretch it to the
      // helicopter-player distance and tilt it along that line
      if (helicopterCone) {
        var dx = hx - player.x, dy = hy, dz = hz - player.z;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        helicopterCone.visible = true;
        helicopterCone.position.set((hx + player.x) / 2, hy / 2, (hz + player.z) / 2);
        helicopterCone.scale.set(1, dist, 1);
        helicopterCone.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(dx / dist, dy / dist, dz / dist));
      }
    } else if (wanted < 3) {
      helicopter.group.visible = false;
      if (helicopterCone) helicopterCone.visible = false;
    }
  }

  // Populate the world.
  function populate() {
    makeStuntRamps();
    makeStars();
    createRainLayer();
    createPoliceHelicopter();
    // the player's own Comet GT, if they bought one at Mara's Garage
    if (ownedItems.comet) spawnOwnedComet();
    // traffic
    for (var i = 0; i < 14; i++) {
      var line = rng.pick(city.roadLines);
      var along = rng.range(-city.half + 15, city.half - 15);
      var horiz = rng.chance(0.5);
      var heading = horiz ? (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (rng.chance(0.5) ? 0 : Math.PI);
      spawnTrafficCar(horiz ? along : line, horiz ? line : along, heading);
    }
    // parked cars (subset of spots)
    var spots = city.parkedSpots.slice();
    for (var s = 0; s < spots.length; s++) {
      if (rng.chance(0.55)) spawnParkedCar(spots[s]);
    }
    // pedestrians
    for (var p = 0; p < 26; p++) {
      var sp = rng.pick(city.pedSpawns);
      spawnPed(sp.x + rng.range(-10, 10), sp.z + rng.range(-10, 10));
    }
    // cash pickups: 10 gold bundles on sidewalks around the city
    for (var pk = 0; pk < 10; pk++) {
      var psp = rng.pick(city.pedSpawns);
      var px = psp.x + rng.range(-8, 8);
      var pz = psp.z + rng.range(-8, 8);
      var pres = W.resolveCollision(city, px, pz, 1);
      spawnPickup(pres.x, pres.z, pk);
    }
  }

  // ---------- save / load ----------
  // completed[] is one entry per mission (MISSION_COUNT = 7 now); older
  // saves carry 4 and are padded with false, so returning players keep
  // their progress.
  function emptyCompleted() {
    var arr = [];
    for (var i = 0; i < MISSION_COUNT; i++) arr.push(false);
    return arr;
  }
  function loadSave() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        var comp = emptyCompleted();
        if (Array.isArray(d.completed)) {
          for (var i = 0; i < Math.min(d.completed.length, comp.length); i++) comp[i] = !!d.completed[i];
        }
        return {
          cash: typeof d.cash === 'number' && isFinite(d.cash) ? Math.max(0, d.cash) : 250,
          completed: comp,
          bestStars: U.clamp(Math.floor(Number(d.bestStars) || 0), 0, 5),
          pickups: Array.isArray(d.pickups) ? d.pickups.slice() : [],
          stars: Array.isArray(d.stars) ? d.stars.slice() : [],
          properties: Array.isArray(d.properties) ? d.properties.slice() : [],
          bankDone: !!d.bankDone,
          npcJobs: Math.max(0, Math.floor(Number(d.npcJobs) || 0)),
          owned: {
            comet: !!(d.owned && d.owned.comet),
            smg: !!(d.owned && d.owned.smg),
            shotgun: !!(d.owned && d.owned.shotgun),
            armor: !!(d.owned && d.owned.armor),
          },
          ammo: {
            smg: d.ammo ? Math.max(0, Math.floor(Number(d.ammo.smg) || 0)) : 0,
            shotgun: d.ammo ? Math.max(0, Math.floor(Number(d.ammo.shotgun) || 0)) : 0,
          },
        };
      }
    } catch (e) {}
    return { cash: 250, completed: emptyCompleted(), bestStars: 0, pickups: [], stars: [],
      properties: [], bankDone: false, npcJobs: 0,
      owned: { comet: false, smg: false, shotgun: false, armor: false }, ammo: { smg: 0, shotgun: 0 } };
  }
  function writeSave() {
    try {
      global.localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: cash, completed: missionsDone, bestStars: bestStars,
        pickups: collectedPickups, stars: collectedStars,
        owned: ownedItems, ammo: ammoCounts,
        properties: ownedProperties, bankDone: bankDone, npcJobs: npcJobsDone,
      }));
    } catch (e) {}
  }

  // ---------- bank job, safehouses, races, NPC contacts ----------

  // A free-standing objective marker: a glowing disc on the ground with a
  // light beam above it, in any colour. Unlike the mission marker this one
  // is placed by coordinates, not by a mission step.
  function featureMarker(x, z, color, size) {
    var group = new THREE.Group();
    var disc = new THREE.Mesh(new THREE.CylinderGeometry(size || 3, size || 3, 0.28, 20),
      new THREE.MeshLambertMaterial({ color: color, emissive: color, transparent: true, opacity: 0.72 }));
    disc.position.y = 0.2; group.add(disc);
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.3, 18, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 9; group.add(beam);
    group.position.set(x, 0, z); scene.add(group); return group;
  }

  // Drop any in-progress bank job or race (mission complete/fail, busted,
  // wasted, retry, new game). The bank job is one-shot, so ending it just
  // ends it; a race can be started again at its start marker.
  function clearFeatureJobs() {
    if (bankJob.marker) { scene.remove(bankJob.marker); bankJob.marker = null; }
    bankJob.active = false;
    if (activeRace && activeRace.marker) { scene.remove(activeRace.marker); }
    activeRace = null;
  }

  // ---------- FEATURE 1: three-stage bank robbery ----------
  // Step 1: scout the bank at the city centre. Step 2: grab the cash at
  // (54, 0) — the alarm goes off and the cops come. Step 3: lose all
  // wanted stars and reach the safehouse at (-162, 162). Pays $3,000.
  function startBankJob() {
    if (bankDone || bankJob.active) return;
    bankJob.active = true; bankJob.step = 0; bankJob.timer = 0;
    if (bankJob.marker) scene.remove(bankJob.marker);
    bankJob.marker = featureMarker(0, 0, 0x38d9ff, 3.5);
    setObjective('BANK JOB  •  $3,000', 'STEP 1/3: Scout the Solmar National Bank. Reach the blue marker.');
    showToast('BANK JOB AVAILABLE — SCOUT THE BANK');
  }
  function advanceBankJob() {
    if (!bankJob.active) return;
    bankJob.step++;
    if (bankJob.marker) scene.remove(bankJob.marker);
    bankJob.marker = null;
    if (bankJob.step === 1) {
      bankJob.marker = featureMarker(54, 0, 0xffd23f, 3.5);
      setObjective('BANK ROBBERY  •  $3,000', 'STEP 2/3: Enter the bank and grab the cash. Press E at the marker.');
      addWanted(2, 'BANK ALARM TRIGGERED');
      showToast('ALARM! GET THE CASH AND RUN!');
    } else if (bankJob.step === 2) {
      bankJob.marker = featureMarker(-162, 162, 0x38d9ff, 3.5);
      setObjective('BANK ESCAPE  •  $3,000', 'STEP 3/3: Escape the police and reach the safehouse. Lose all wanted stars.');
      showToast('CASH SECURED — LOSE THE COPS!');
    } else {
      bankJob.active = false; bankDone = true; cash += 3000;
      if (bankJob.marker) scene.remove(bankJob.marker);
      bankJob.marker = null; showToast('BANK JOB COMPLETE  +$3,000');
      audio.blip('mission'); writeSave(); updateObjectiveText();
    }
  }
  function updateBankJob(dt) {
    if (!bankJob.active) return;
    if (bankJob.step === 2 && wanted === 0 && U.dist2(player.x, player.z, -162, 162) < 12 * 12) advanceBankJob();
  }

  // ---------- FEATURE 2: three purchasable safehouses ----------
  // A house on the sand east of the boardwalk. Buying one heals the player
  // and changes their shirt colour; an owned house also works as a garage
  // for the shop-bought Comet GT (one spawns beside the house if none is
  // nearby). Owned houses show green on the map, for-sale ones purple.
  var OUTFIT_COLORS = [0x37b24d, 0x0984e3, 0x9b59b6];
  function createProperties() {
    var defs = [
      { x: city.propertySpots[0].x, z: city.propertySpots[0].z, price: 1000, name: 'SEASIDE FLAT', color: 0x54d6a2 },
      { x: city.propertySpots[1].x, z: city.propertySpots[1].z, price: 2500, name: 'PALMS VILLA', color: 0x63a9ff },
      { x: city.propertySpots[2].x, z: city.propertySpots[2].z, price: 5000, name: 'HILLTOP ESTATE', color: 0xd6a2ff }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i], owned = ownedProperties.indexOf(i) >= 0;
      var marker = featureMarker(d.x, d.z, owned ? 0x43e68b : d.color, 3.2);
      var sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 0.18),
        new THREE.MeshLambertMaterial({ color: owned ? 0x26734d : 0x26384a }));
      sign.position.set(d.x, 1.5, d.z - 3.4); scene.add(sign);
      properties.push({ x: d.x, z: d.z, price: d.price, name: d.name, color: d.color, marker: marker, sign: sign, index: i });
    }
  }
  function interactProperty() {
    if (player.inCar) return false;
    for (var i = 0; i < properties.length; i++) {
      var p = properties[i];
      if (U.dist2(player.x, player.z, p.x, p.z) < 8 * 8) {
        var owned = ownedProperties.indexOf(p.index) >= 0;
        if (!owned) {
          if (cash < p.price) { showToast('NOT ENOUGH CASH — $' + p.price + ' REQUIRED'); return true; }
          cash -= p.price; ownedProperties.push(p.index);
          p.marker.traverse(function (o) { if (o.material && o.material.color) o.material.color.setHex(0x43e68b); });
          p.sign.material.color.setHex(0x26734d);
          showToast(p.name + ' PURCHASED'); writeSave();
        } else {
          health = maxHealth; updateHealthHud();
          player.person.group.children[0].material.color.setHex(OUTFIT_COLORS[p.index]);
          // Owned home doubles as a save point, wardrobe and personal-car
          // garage: park the shop-bought Comet GT beside it if none is near.
          if (!player.inCar && ownedItems.comet) {
            var near = nearestCar(7);
            if (!near) {
              var model = A.makeCar(rng, OUTFIT_COLORS[p.index], false, 'sport');
              var car = A.makeCarState(p.x + 5, p.z, 0, 'parked', 'sport');
              car.model = model; car.owned = true; scene.add(model.group); A.syncCarModel(car); parkedCars.push(car);
            }
          }
          showToast(p.name + ' — HEALTH RESTORED / OUTFIT CHANGED');
          writeSave();
        }
        updateHud(0); return true;
      }
    }
    return false;
  }

  // ---------- FEATURE 3: three eight-checkpoint street races ----------
  // Drive through 8 rings in order within 90 seconds. Finish fast for a
  // better rank: under 55s pays $800, under 72s pays $450, otherwise $200.
  // You must be in a car to pass a checkpoint.
  function createRaces() {
    var routes = [
      { name: 'DOWNTOWN SPRINT', points: [[-108,-108],[-54,-108],[0,-108],[54,-54],[108,0],[108,54],[54,108],[0,108]] },
      { name: 'COASTLINE RUN', points: [[162,-108],[162,-54],[162,0],[162,54],[108,108],[54,108],[0,54],[-54,54]] },
      { name: 'MIDTOWN CIRCUIT', points: [[-108,108],[-108,54],[-54,0],[0,0],[54,0],[108,-54],[54,-108],[0,-108]] }
    ];
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i]; races.push({ name: r.name, points: r.points, start: featureMarker(r.points[0][0], r.points[0][1], 0xff8b35, 2.8) });
    }
  }
  function beginRace(index) {
    if (activeRace) return;
    activeRace = { index: index, checkpoint: 0, timer: 90, elapsed: 0, marker: featureMarker(races[index].points[0][0], races[index].points[0][1], 0xffd23f, 3.4) };
    activeRace.marker.visible = false;
    setObjective(races[index].name, 'CHECKPOINT 1/8 — 90 seconds. Get in a car and drive through the rings.');
    showToast('RACE STARTED — 90 SECONDS!');
  }
  function updateRace(dt) {
    if (!activeRace) return;
    activeRace.timer -= dt; activeRace.elapsed += dt;
    if (activeRace.timer <= 0) {
      scene.remove(activeRace.marker); activeRace = null; showToast('RACE FAILED — TIME UP'); updateObjectiveText(); return;
    }
    var pt = races[activeRace.index].points[activeRace.checkpoint];
    if (!player.inCar) { objText.textContent = 'GET IN A CAR — CHECKPOINT ' + (activeRace.checkpoint + 1) + '/8  [' + Math.ceil(activeRace.timer) + 's]'; return; }
    if (U.dist2(player.x, player.z, pt[0], pt[1]) < 7 * 7) {
      activeRace.checkpoint++;
      if (activeRace.checkpoint >= 8) {
        var t = activeRace.elapsed, rank = t < 55 ? 1 : (t < 72 ? 2 : 3);
        var reward = rank === 1 ? 800 : (rank === 2 ? 450 : 200);
        cash += reward; scene.remove(activeRace.marker); activeRace = null;
        showToast('RACE FINISHED — ' + (rank === 1 ? '1ST' : (rank === 2 ? '2ND' : '3RD')) + '  +$' + reward);
        writeSave(); updateObjectiveText(); return;
      }
      pt = races[activeRace.index].points[activeRace.checkpoint];
      scene.remove(activeRace.marker);
      activeRace.marker = featureMarker(pt[0], pt[1], 0xffd23f, 3.4);
      setObjective(races[activeRace.index].name, 'CHECKPOINT ' + (activeRace.checkpoint + 1) + '/8  [' + Math.ceil(activeRace.timer) + 's]');
    } else {
      objText.textContent = 'CHECKPOINT ' + (activeRace.checkpoint + 1) + '/8  [' + Math.ceil(activeRace.timer) + 's]';
    }
  }

  // ---------- FEATURE 4: NPC contacts ----------
  // Talk to a local (E, on foot). Each pedestrian has a fixed contact type
  // from the seeded RNG: small talk, a generous stranger (+$100 once), a
  // delivery errand to the pier (+$250), a snitch who calls the police (+1
  // wanted), or a street tip (+$50 once).
  function interactNpc() {
    if (player.inCar) return false;
    if (npcTalkCooldown > 0) return false;
    var nearest = null, best = 6.5 * 6.5;
    for (var i = 0; i < peds.length; i++) {
      var ped = peds[i];
      if (!ped.dead && ped !== taxi.farePed) {
        var d = U.dist2(player.x, player.z, ped.x, ped.z);
        if (d < best) { best = d; nearest = ped; }
      }
    }
    if (!nearest) return false;
    npcTalkCooldown = 1.2;
    var type = nearest.contactType || 0;
    if (type === 0) {
      showToast('LOCAL: "Nice weather in Solmar, huh?"'); nearest.interacted = true;
    } else if (type === 1) {
      if (!nearest.interacted) { nearest.interacted = true; cash += 100; npcJobsDone++; showToast('KIND STRANGER GAVE YOU $100'); writeSave(); }
      else showToast('LOCAL: "Good luck out there."');
    } else if (type === 2) {
      if (!nearest.interacted) {
        nearest.interacted = true; showToast('DELIVERY REQUEST: TAKE A QUICK WALK TO THE PIER');
        // Short side task: reaching the pier after accepting pays $250.
        nearest.sideTask = true;
      } else showToast('LOCAL: "Thanks for the help."');
    } else if (type === 3) {
      showToast('LOCAL CALLED THE POLICE!'); addWanted(1, 'WITNESS REPORTED YOU');
      nearest.flee = 3; nearest.interacted = true;
    } else {
      if (!nearest.interacted) { nearest.interacted = true; cash += 50; npcJobsDone++; showToast('STREET TIP: +$50'); writeSave(); }
      else showToast('LOCAL: "That is all I have."');
    }
    return true;
  }
  function updateNpcTasks(dt) {
    if (npcTalkCooldown > 0) npcTalkCooldown = Math.max(0, npcTalkCooldown - dt);
    for (var i = 0; i < peds.length; i++) {
      var ped = peds[i];
      if (ped.sideTask && U.dist2(player.x, player.z, 205, 40) < 10 * 10) {
        ped.sideTask = false; cash += 250; npcJobsDone++; showToast('NPC DELIVERY COMPLETE  +$250'); writeSave();
      }
    }
  }

  // One E press for all four new features, in priority order: a safehouse,
  // then the bank job (advance a step, or start it), then races (E does
  // nothing while a race is running, so it cannot be restarted by accident),
  // then talking to the nearest local.
  function interactNewFeatures() {
    if (player.inCar) return false;
    if (interactProperty()) return true;
    if (bankJob.active) {
      var bx = bankJob.step === 2 ? -162 : (bankJob.step === 1 ? 54 : 0), bz = bankJob.step === 2 ? 162 : 0;
      if (U.dist2(player.x, player.z, bx, bz) < 9 * 9) { advanceBankJob(); return true; }
    } else if (!bankDone && U.dist2(player.x, player.z, 0, 0) < 10 * 10) { startBankJob(); return true; }
    if (activeRace) return true;
    for (var r = 0; r < races.length; r++) {
      var rp = races[r].points[0];
      if (U.dist2(player.x, player.z, rp[0], rp[1]) < 9 * 9) { beginRace(r); return true; }
    }
    return interactNpc();
  }

  // ---------- input ----------
  var keys = {};
  var mouseDX = 0, mouseDY = 0, mouseDown = false;
  global.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'KeyM') { toggleMute(); }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      else if (state === 'shop') closeShop();
    }
    if (e.code === 'KeyE') tryInteract();
    if (e.code === 'KeyH') serviceCar();
    if (e.code === 'Digit1') switchWeapon('pistol');
    if (e.code === 'Digit2') switchWeapon('smg');
    if (e.code === 'Digit3') switchWeapon('shotgun');
    if (e.code === 'KeyQ') cycleWeapon();
    if (e.code === 'Space') e.preventDefault();
  });
  global.addEventListener('keyup', function (e) { keys[e.code] = false; });
  global.addEventListener('blur', function () { keys = {}; mouseDown = false; });
  canvas.addEventListener('mousedown', function (e) {
    if (state !== 'playing') return;
    mouseDown = true;
    if (document.pointerLockElement !== canvas) {
      // first click grabs the mouse; it is not a shot
      try { canvas.requestPointerLock(); } catch (err) {}
      return;
    }
    if (!player.inCar) shoot();
  });
  global.addEventListener('mouseup', function () { mouseDown = false; });
  document.addEventListener('pointerlockchange', function () {
    // pointer lock lost while playing: keep playing, mouse-look just pauses
  });
  global.addEventListener('mousemove', function (e) {
    if (document.pointerLockElement === canvas) {
      mouseDX += e.movementX || 0;
      mouseDY += e.movementY || 0;
    } else if (mouseDown && state === 'playing') {
      mouseDX += e.movementX || 0;
      mouseDY += e.movementY || 0;
    }
  });

  function toggleMute() {
    muted = !muted;
    audio.setMuted(muted);
    showToast(muted ? 'SOUND OFF' : 'SOUND ON');
  }

  // ---------- missions ----------
  var MISSIONS = [
    {
      id: 0, name: 'THE PICKUP', reward: 500,
      brief: "Mara needs a package from the alley behind the Palms Hotel. Walk into the yellow marker to grab it, then bring it back to her garage.",
      steps: [
        { type: 'goto', label: 'Pick up the package at the alley marker', x: -27, z: -81, radius: 4 },
        { type: 'goto', label: 'Deliver the package to Mara\'s garage', x: 27, z: 27, radius: 5 },
      ],
    },
    {
      id: 1, name: 'HOT WHEELS', reward: 800,
      brief: "A cherry-red Comet GT is parked down by the beach. Steal it and bring it to the chop shop on the north side. The owner will not be pleased — the cops might notice.",
      steps: [
        { type: 'steal', label: 'Steal the red Comet GT at the beach', x: 176, z: 40, radius: 5, carColor: 0xd63031 },
        { type: 'deliver', label: 'Deliver the Comet GT to the chop shop', x: -81, z: -135, radius: 6 },
      ],
    },
    {
      id: 2, name: 'RUSH HOUR', reward: 1200,
      brief: "A client needs a case delivered across town — fast. Grab the case at the plaza, then get it to the east docks in 90 seconds. Traffic is not your friend.",
      timeLimit: 90,
      steps: [
        { type: 'goto', label: 'Grab the case at the plaza', x: 27, z: -27, radius: 4 },
        { type: 'goto', label: 'Deliver the case to the east docks — 90 seconds!', x: 162, z: 108, radius: 5 },
      ],
    },
    {
      id: 3, name: 'HEAT WAVE', reward: 2000,
      brief: "The last job went loud. You are at 3 stars and every cop in Solmar is coming. Survive 60 seconds without getting busted or wasted, and Mara pays double.",
      timeLimit: 60, forceWanted: 3,
      steps: [
        { type: 'survive', label: 'Survive the heat for 60 seconds!', x: 27, z: 27, radius: 0 },
      ],
    },
    {
      id: 4, name: 'CROSS-TOWN EXPRESS', reward: 900,
      brief: "Mara's client wants a package moved across town — west side to north-east — in 75 seconds. No excuses, no traffic jams. Drive like you mean it.",
      timeLimit: 75,
      steps: [
        { type: 'goto', label: 'Grab the package at the west corner', x: -108, z: 135, radius: 4 },
        { type: 'goto', label: 'Deliver it to the north-east corner — 75 seconds!', x: 135, z: -108, radius: 5 },
      ],
    },
    {
      id: 5, name: 'GHOST RUN', reward: 1400,
      brief: "A package is waiting at the north plaza, but the block is watched. Slip in, grab it, and get it back to Mara's garage — if the cops notice you, the job is blown.",
      steps: [
        { type: 'ghost', label: 'Grab the package at the north plaza — stay clean (0★)!', x: 27, z: -135, radius: 4 },
        { type: 'goto', label: 'Deliver the package to Mara\'s garage', x: 27, z: 27, radius: 5 },
      ],
    },
    {
      id: 6, name: 'THE BIG ONE', reward: 2500,
      brief: "The finale. A one-of-one gold Comet GT is parked by the stadium, and Mara has a buyer with deep pockets. Steal it, shake the 2-star heat, and bring it home to the garage.",
      forceWanted: 2,
      steps: [
        { type: 'steal', label: 'Steal the gold Comet GT by the stadium', x: 108, z: 135, radius: 5, carColor: 0xffd23f, carType: 'sport' },
        { type: 'deliver', label: 'Deliver the gold Comet GT to Mara\'s garage', x: 27, z: 27, radius: 6 },
      ],
    },
    {
      id: 7, name: 'THE GETAWAY', reward: 1800,
      brief: "A three-part heist. Lift a Comet GT off the boardwalk, drop it at the chop shop — then get yourself back to Mara's garage while the heat is still on. The cops will be looking for you.",
      forceWanted: 2,
      steps: [
        { type: 'steal', label: 'Steal the Comet GT on the boardwalk', x: 162, z: -27, radius: 5, carColor: 0x0984e3, carType: 'sport' },
        { type: 'deliver', label: 'Deliver it to the chop shop', x: -81, z: -135, radius: 6 },
        { type: 'goto', label: 'Lay low at Mara\'s garage', x: 27, z: 27, radius: 5 },
      ],
    },
    {
      id: 8, name: 'RING RUNNER', reward: 1600,
      brief: "Mara's client wants a show. Drive through all five gold rings across town in 120 seconds — in order, no shortcuts. A Comet GT helps, but any car will do.",
      timeLimit: 120,
      steps: [
        { type: 'ring', label: 'Ring 1/5 — downtown', x: -108, z: -108, radius: 6, angle: 0 },
        { type: 'ring', label: 'Ring 2/5 — north side', x: 0, z: -108, radius: 6, angle: Math.PI / 2 },
        { type: 'ring', label: 'Ring 3/5 — east side', x: 108, z: -54, radius: 6, angle: 0 },
        { type: 'ring', label: 'Ring 4/5 — south-east', x: 108, z: 54, radius: 6, angle: Math.PI / 2 },
        { type: 'ring', label: 'Ring 5/5 — the pier road', x: 54, z: 108, radius: 6, angle: 0 },
      ],
    },
    {
      id: 9, name: 'VIP ESCORT', reward: 2200,
      brief: "Mara's VIP is hiding at the Palms Hotel and needs to get to the pier — quietly. Pick them up in a car, and someone will tip off the cops the moment you roll. Get the VIP to the pier in 120 seconds, and don't get busted.",
      timeLimit: 120,
      steps: [
        { type: 'escort', label: 'Pick up the VIP at the Palms Hotel — bring a car', x: -81, z: -81, radius: 5 },
        { type: 'deliver-vip', label: 'Get the VIP to the pier — 120 seconds!', x: 205, z: 40, radius: 7 },
      ],
    },
  ];

  function startMission(idx) {
    var m = MISSIONS[idx];
    cancelTaxi(); // a story job takes priority over a fare
    missionActive = { def: m, step: 0, timer: m.timeLimit || 0, done: false };
    if (m.forceWanted) setWanted(m.forceWanted);
    setObjective(m.name, m.brief);
    showToast('NEW JOB: ' + m.name);
    audio.blip('mission');
    placeMarker();
    updateObjectiveText();
  }

  function placeMarker() {
    removeMarker();
    if (!missionActive) return;
    var step = missionActive.def.steps[missionActive.step];
    if (!step || step.type === 'survive') return;
    var g = new THREE.Group();
    if (step.type === 'ring') {
      // a checkpoint ring: a big gold torus standing on the road, plus a
      // ground disc so it reads as a target from a distance
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.2, 0.35, 10, 24),
        new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400 }));
      ring.position.y = 3.2;
      g.add(ring);
      var disc = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 2.6, 0.3, 20),
        new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400, transparent: true, opacity: 0.6 }));
      disc.position.y = 0.2;
      g.add(disc);
      g.position.set(step.x, 0, step.z);
      g.rotation.y = step.angle || 0;
      scene.add(g);
      missionMarker = g;
      return;
    }
    var cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 0.4, 24),
      new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400, transparent: true, opacity: 0.75 }));
    cyl.position.y = 0.25;
    g.add(cyl);
    var beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.6, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 13;
    g.add(beam);
    g.position.set(step.x, 0, step.z);
    scene.add(g);
    missionMarker = g;
    // mission 2 / 6: the car to steal (a sports car for the big jobs)
    if (step.type === 'steal' && !missionActive.stealCar) {
      // reuse an existing mission car if one is still parked in the city
      // (e.g. left behind after a failed job) instead of spawning a second
      var existing = null;
      for (var i = 0; i < parkedCars.length; i++) {
        if (parkedCars[i].missionCar && !parkedCars[i].disabled) { existing = parkedCars[i]; break; }
      }
      if (existing) {
        existing.x = step.x; existing.z = step.z;
        existing.heading = Math.PI / 2; existing.speed = 0;
        existing.kind = 'parked';
        // recolor to this job's car (the red Comet GT vs the gold one)
        existing.model.bodyMat.color.setHex(step.carColor || 0xd63031);
        A.syncCarModel(existing);
        missionActive.stealCar = existing;
      } else {
        var model = A.makeCar(rng, step.carColor || 0xd63031, false, step.carType || 'sport');
        var car = A.makeCarState(step.x, step.z, Math.PI / 2, 'parked', step.carType || 'sport');
        car.model = model; car.missionCar = true;
        scene.add(model.group);
        A.syncCarModel(car);
        parkedCars.push(car);
        missionActive.stealCar = car;
      }
    }
    // VIP escort: a well-dressed figure waits at the marker. They stand
    // still until the player arrives in a car — they are not part of the
    // wandering crowd, so they cannot be run over or shot by accident.
    if (step.type === 'escort' && !missionActive.vipPed) {
      var vip = A.makePerson(rng, { shirt: 0xffd23f, pants: 0x1c2733, skin: 0xe8b98a, hair: 0x8a5a34 });
      vip.group.position.set(step.x, 0, step.z);
      scene.add(vip.group);
      missionActive.vipPed = { x: step.x, z: step.z, person: vip, heading: 0, walkPhase: 0 };
    }
  }

  function removeMarker() {
    if (missionMarker) { scene.remove(missionMarker); missionMarker = null; }
  }

  function setObjective(title, text) {
    objTitle.textContent = title;
    objText.textContent = text;
  }

  function updateObjectiveText() {
    if (taxi.state === 'active') {
      setObjective('TAXI FARE  •  $200' + (taxi.timer > 20 ? ' (+$100 tip if fast)' : ''),
        'Deliver the passenger to the cyan marker  [' + Math.ceil(taxi.timer) + 's]');
      return;
    }
    if (!missionActive) {
      if (missionIndex >= MISSIONS.length) {
        setObjective('STORY COMPLETE', 'You finished all of Mara\'s jobs. Solmar City is yours — free roam, earn cash, and stay out of trouble.');
      } else {
        setObjective('NEXT JOB: ' + MISSIONS[missionIndex].name, 'Drive or walk to the yellow marker to start. ($' + MISSIONS[missionIndex].reward + ')');
      }
      return;
    }
    var step = missionActive.def.steps[missionActive.step];
    if (!step) return;
    var label = step.label;
    if (missionActive.timer > 0) label += '  [' + Math.ceil(missionActive.timer) + 's]';
    objText.textContent = label;
    objTitle.textContent = missionActive.def.name + '  •  $' + missionActive.def.reward;
  }

  function completeStep() {
    var m = missionActive;
    audio.blip('pickup');
    m.step++;
    if (m.step >= m.def.steps.length) {
      completeMission();
    } else {
      showToast('OBJECTIVE DONE');
      placeMarker();
      updateObjectiveText();
    }
  }

  // ---------- celebration + damage effects ----------
  // Gold cash burst on mission complete: fixed-angle velocities (golden
  // angle), so the burst is identical on every run.
  function spawnCashBurst(x, z) {
    for (var i = 0; i < 14; i++) {
      var a = i * 2.399963; // golden angle
      var mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.1, 0.22),
        new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400 }));
      mesh.position.set(x, 1.2, z);
      scene.add(mesh);
      burstParts.push({
        mesh: mesh, life: 0.9,
        vx: Math.cos(a) * (3 + (i % 4)), vy: 4 + (i % 3) * 1.5,
        vz: Math.sin(a) * (3 + (i % 4)),
      });
    }
  }
  function updateBurst(dt) {
    for (var i = burstParts.length - 1; i >= 0; i--) {
      var p = burstParts[i];
      p.life -= dt;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        burstParts.splice(i, 1);
        continue;
      }
      p.vy -= 14 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.1) { p.mesh.position.y = 0.1; p.vy = 0; p.vx *= 0.9; p.vz *= 0.9; }
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 8;
    }
  }
  // Damage smoke: when the player's health is low, dark puffs rise from
  // their position. Spawned on a game-time clock and drifted with sines, so
  // no unseeded randomness touches it.
  function updateSmoke(dt) {
    if (health < 35 && state === 'playing' && gameTime - lastSmokeAt > 0.22) {
      lastSmokeAt = gameTime;
      var mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55 }));
      mesh.position.set(player.x, 1.2, player.z);
      scene.add(mesh);
      smokePuffs.push({ mesh: mesh, life: 1.2, seed: gameTime * 7 });
    }
    // a battered car smokes from the hood until it is serviced
    if (player.inCar && player.inCar.cond !== undefined && player.inCar.cond < 35
      && state === 'playing' && gameTime - lastSmokeAt > 0.22) {
      lastSmokeAt = gameTime;
      var cmesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55 }));
      cmesh.position.set(player.inCar.x, 1.4, player.inCar.z);
      scene.add(cmesh);
      smokePuffs.push({ mesh: cmesh, life: 1.2, seed: gameTime * 7 + 3 });
    }
    for (var i = smokePuffs.length - 1; i >= 0; i--) {
      var s = smokePuffs[i];
      s.life -= dt;
      if (s.life <= 0) {
        scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        smokePuffs.splice(i, 1);
        continue;
      }
      s.mesh.position.y += dt * 1.6;
      s.mesh.position.x += Math.sin(gameTime * 3 + s.seed) * dt * 0.8;
      s.mesh.position.z += Math.cos(gameTime * 2.3 + s.seed) * dt * 0.8;
      s.mesh.material.opacity = 0.55 * (s.life / 1.2);
      var sc = 0.5 + (1.2 - s.life) * 0.9;
      s.mesh.scale.set(sc, sc, sc);
    }
  }

  function completeMission() {
    var m = missionActive;
    cash += m.def.reward;
    missionsDone[m.def.id] = true;
    missionIndex = Math.max(missionIndex, m.def.id + 1);
    if (m.vipPed) { scene.remove(m.vipPed.person.group); m.vipPed = null; }
    missionActive = null;
    clearFeatureJobs();
    removeMarker();
    spawnCashBurst(player.x, player.z); // gold burst where you stand
    showToast('JOB COMPLETE  +$' + m.def.reward);
    audio.blip('mission');
    writeSave();
    updateObjectiveText();
    if (missionIndex >= MISSIONS.length) {
      setObjective('STORY COMPLETE', 'All ten jobs done. Solmar City is yours now.');
    }
  }

  function failMission(reason) {
    if (!missionActive) return;
    showToast('JOB FAILED: ' + reason);
    var idx = missionActive.def.id;
    if (missionActive.vipPed) { scene.remove(missionActive.vipPed.person.group); missionActive.vipPed = null; }
    missionActive = null;
    clearFeatureJobs();
    removeMarker();
    // retry: mission stays available
    missionIndex = Math.min(missionIndex, idx);
    updateObjectiveText();
  }

  function tryInteract() {
    if (state !== 'playing') return;
    // 1) enter/exit car
    if (player.inCar) {
      exitCar();
      return;
    }
    // new features (safehouses, bank job, races, NPCs) take priority over
    // cars: they are fixed points the player walks to on purpose
    if (interactNewFeatures()) { updateInteractPrompt(); return; }
    var car = nearestCar(4.6);
    if (car) {
      enterCar(car);
      return;
    }
    // 2) mission step trigger (walk-in is automatic; E also works near a marker)
    if (missionActive) {
      var step = missionActive.def.steps[missionActive.step];
      if (step && step.type !== 'survive' && step.type !== 'steal') {
        var d2 = U.dist2(player.x, player.z, step.x, step.z);
        if (d2 < step.radius * step.radius) completeStep();
      }
    }
    // 3) Mara's Garage shop, at the garage's east door (47, 27) — the spot
    // is clear of buildings in every seed, unlike the block center
    if (U.dist2(player.x, player.z, 47, 27) < 49) {
      openShop();
      return;
    }
  }

  // ---------- wanted ----------
  function setWanted(n) {
    wanted = U.clamp(n, 0, 5);
    if (wanted > bestStars) { bestStars = wanted; writeSave(); }
    wantedTimer = 0;
    updateWantedHud();
    audio.setSiren(wanted > 0);
  }
  function addWanted(n, reason) {
    if (wanted >= 5) return;
    setWanted(wanted + n);
    if (reason) showToast(reason + '  •  WANTED ' + wanted + '★');
  }
  function updateWantedHud() {
    var s = '';
    for (var i = 0; i < 5; i++) {
      s += i < wanted ? '★' : '<span class="star-off">☆</span>';
    }
    wantedEl.innerHTML = s;
    // heat glow: the screen edges burn red as the heat rises — faint at 1-2
    // stars, strong at 3+ (a pure CSS overlay, no per-frame cost)
    if (heatGlow) {
      heatGlow.style.opacity = wanted >= 3 ? Math.min(0.9, 0.3 + wanted * 0.12)
        : (wanted > 0 ? 0.12 : 0);
    }
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.style.opacity = 1;
    toastTimer = 2.6;
  }

  // ---------- cars: enter / exit / steal ----------
  function allCars() {
    return parkedCars.concat(trafficCars, policeCars);
  }
  function nearestCar(maxDist) {
    var best = null, bd = maxDist * maxDist;
    var cars = allCars();
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c.disabled) continue;
      var d2 = U.dist2(player.x, player.z, c.x, c.z);
      if (d2 < bd) { bd = d2; best = c; }
    }
    return best;
  }

  // silent: screenshots drive the car without it counting as a theft
  function enterCar(car, silent) {
    var prevKind = car.kind;
    car.prevKind = prevKind;
    player.inCar = car;
    car.kind = 'player';
    player.person.group.visible = false;
    if (!silent) {
      if (car.owned) {
        showToast('YOUR COMET GT');
      } else if (car.missionCar) {
        if (car.stolen !== true) {
          car.stolen = true;
          showToast('YOU STOLE THE COMET GT!');
          addWanted(1, 'GRAND THEFT AUTO');
        }
      } else if ((prevKind === 'parked' || prevKind === 'traffic') && car.stolen !== true) {
        // stealing any car the player does not own is a crime, once per car
        car.stolen = true;
        addWanted(1, 'GRAND THEFT AUTO');
      }
    }
    audio.blip('click');
    // remove from traffic list so it stops AI-driving
    var ti = trafficCars.indexOf(car);
    if (ti >= 0) trafficCars.splice(ti, 1);
    updateInteractPrompt();
  }

  function exitCar() {
    var car = player.inCar;
    if (!car) return;
    player.inCar = null;
    // go back to what the car was before the player took it: a parked car
    // stays parked, a traffic car rejoins traffic (never in both lists)
    car.kind = car.prevKind || 'traffic';
    if (car.kind === 'traffic' && trafficCars.indexOf(car) < 0) trafficCars.push(car);
    // step out to the side
    var sx = car.x + Math.cos(car.heading) * 2.4;
    var sz = car.z - Math.sin(car.heading) * 2.4;
    var res = W.resolveCollision(city, sx, sz, 0.6);
    player.x = res.x; player.z = res.z; player.y = 0; player.vy = 0;
    player.heading = car.heading;
    player.person.group.visible = true;
    audio.setEngine(0, false);
    updateInteractPrompt();
  }

  function updateInteractPrompt() {
    if (state !== 'playing') { interactEl.classList.add('hidden'); return; }
    if (player.inCar) {
      if (nearGasPump(7) && (player.inCar.cond === undefined || player.inCar.cond < 100)) {
        interactEl.textContent = 'Press H to service the car — $50';
        interactEl.classList.remove('hidden');
        return;
      }
      interactEl.textContent = 'Press E to exit car';
      interactEl.classList.remove('hidden');
      return;
    }
    // new features, same priority as the E press: a race in progress shows
    // its checkpoint, then safehouses, the bank job, race starts, and locals
    if (activeRace) {
      interactEl.textContent = 'RACE: CHECKPOINT ' + (activeRace.checkpoint + 1) + '/8';
      interactEl.classList.remove('hidden');
      return;
    }
    for (var pi = 0; pi < properties.length; pi++) {
      if (U.dist2(player.x, player.z, properties[pi].x, properties[pi].z) < 8 * 8) {
        var own = ownedProperties.indexOf(properties[pi].index) >= 0;
        interactEl.textContent = own ? 'Press E to rest / change outfit' : 'Press E to buy ' + properties[pi].name + ' ($' + properties[pi].price + ')';
        interactEl.classList.remove('hidden');
        return;
      }
    }
    if (!bankDone && !bankJob.active && U.dist2(player.x, player.z, 0, 0) < 10 * 10) {
      interactEl.textContent = 'Press E to start the bank job';
      interactEl.classList.remove('hidden');
      return;
    }
    if (bankJob.active) {
      var bx = bankJob.step === 0 ? 0 : (bankJob.step === 1 ? 54 : -162);
      var bz = bankJob.step === 0 ? 0 : (bankJob.step === 1 ? 0 : 162);
      if (U.dist2(player.x, player.z, bx, bz) < 9 * 9) {
        interactEl.textContent = 'Press E to ' + (bankJob.step === 0 ? 'scout the bank' : (bankJob.step === 1 ? 'grab the bank cash' : 'escape'));
        interactEl.classList.remove('hidden');
        return;
      }
    }
    if (!activeRace) {
      for (var ri = 0; ri < races.length; ri++) {
        var rp = races[ri].points[0];
        if (U.dist2(player.x, player.z, rp[0], rp[1]) < 9 * 9) {
          interactEl.textContent = 'Press E to start ' + races[ri].name;
          interactEl.classList.remove('hidden');
          return;
        }
      }
    }
    for (var ni = 0; ni < peds.length; ni++) {
      if (!peds[ni].dead && peds[ni] !== taxi.farePed && U.dist2(player.x, player.z, peds[ni].x, peds[ni].z) < 6.5 * 6.5) {
        interactEl.textContent = 'Press E to talk to a local';
        interactEl.classList.remove('hidden');
        return;
      }
    }
    var car = nearestCar(4.6);
    if (car) {
      var typeName = car.missionCar ? 'the Comet GT'
        : (car.owned ? 'your Comet GT'
        : (car.carType && A.CAR_TYPES[car.carType] ? 'the ' + A.CAR_TYPES[car.carType].name : 'car'));
      interactEl.textContent = car.owned ? 'Press E to drive your Comet GT' : 'Press E to steal ' + typeName;
      interactEl.classList.remove('hidden');
      return;
    }
    if (U.dist2(player.x, player.z, 47, 27) < 49) {
      interactEl.textContent = 'Press E to open Mara\'s Garage';
      interactEl.classList.remove('hidden');
      return;
    }
    interactEl.classList.add('hidden');
  }

  // ---------- combat ----------
  var raycaster = new THREE.Raycaster();
  var lastShotAt = -999;

  // Weapons: pistol (infinite ammo), SMG (fast, ammo-limited), shotgun
  // (slow, 5-pellet spread, short range). Switch with 1/2/3 or Q. The
  // pistol is free; the SMG and shotgun are bought at Mara's Garage.
  var WEAPONS = {
    pistol: { name: 'PISTOL', rate: 0.28, damage: 1, range: 120, spread: 0, pellets: 1, ammo: null },
    smg: { name: 'SMG', rate: 0.09, damage: 1, range: 80, spread: 0.02, pellets: 1, ammo: 'smg' },
    shotgun: { name: 'SHOTGUN', rate: 0.8, damage: 1, range: 42, spread: 0.05, pellets: 5, ammo: 'shotgun' },
  };
  var currentWeapon = 'pistol';

  function updateAmmoHud() {
    var w = WEAPONS[currentWeapon];
    if (!w) return;
    ammoEl.textContent = w.name + '  ' + (w.ammo === null ? '∞' : ammoCounts[w.ammo]);
  }

  function switchWeapon(name) {
    if (!WEAPONS[name]) return;
    if (name !== 'pistol' && !ownedItems[name]) {
      showToast('YOU DON\'T OWN A ' + WEAPONS[name].name + ' — BUY ONE AT MARA\'S GARAGE');
      return;
    }
    currentWeapon = name;
    updateAmmoHud();
    showToast(WEAPONS[name].name + ' EQUIPPED');
    audio.blip('click');
  }

  function cycleWeapon() {
    var order = ['pistol', 'smg', 'shotgun'];
    var owned = order.filter(function (n) { return n === 'pistol' || ownedItems[n]; });
    if (owned.length < 2) { showToast('ONLY THE PISTOL — BUY MORE GUNS AT MARA\'S GARAGE'); return; }
    var idx = owned.indexOf(currentWeapon);
    switchWeapon(owned[(idx + 1) % owned.length]);
  }

  // ---------- Mara's Garage shop ----------
  // Cash finally has a purpose: a car, guns, ammo, armor and repairs, all
  // bought at the garage's east door (47, 27). Purchases persist in the save.
  var SHOP_ITEMS = [
    { id: 'comet', name: 'COMET GT', price: 1500, once: true },
    { id: 'smg', name: 'SMG', price: 800, once: true },
    { id: 'shotgun', name: 'SHOTGUN', price: 1200, once: true },
    { id: 'smg-ammo', name: 'SMG AMMO ×120', price: 200 },
    { id: 'shotgun-ammo', name: 'SHOTGUN SHELLS ×24', price: 200 },
    { id: 'armor', name: 'BODY ARMOR', price: 500, once: true },
    { id: 'repair', name: 'FULL REPAIR', price: 150 },
  ];
  var shopOpen = false;

  function openShop() {
    if (state !== 'playing') return;
    state = 'shop';
    shopOpen = true;
    refreshShop();
    $('shop-screen').classList.remove('hidden');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    audio.setEngine(0, false);
  }
  function closeShop() {
    $('shop-screen').classList.add('hidden');
    shopOpen = false;
    state = 'playing';
  }
  function refreshShop() {
    $('shop-cash').textContent = '$' + cash.toLocaleString('en-US');
    var btns = document.querySelectorAll('#shop-screen [data-item]');
    for (var i = 0; i < btns.length; i++) {
      var id = btns[i].getAttribute('data-item');
      var item = null;
      for (var j = 0; j < SHOP_ITEMS.length; j++) if (SHOP_ITEMS[j].id === id) item = SHOP_ITEMS[j];
      if (!item) continue;
      var owned = item.once && ownedItems[id];
      btns[i].disabled = owned || cash < item.price;
      btns[i].textContent = owned ? 'OWNED' : 'BUY — $' + item.price;
    }
  }
  function buyItem(id) {
    var item = null;
    for (var i = 0; i < SHOP_ITEMS.length; i++) if (SHOP_ITEMS[i].id === id) item = SHOP_ITEMS[i];
    if (!item) return;
    if (item.once && ownedItems[id]) return;
    if (cash < item.price) { showToast('NOT ENOUGH CASH'); audio.blip('click'); return; }
    cash -= item.price;
    if (id === 'comet') { ownedItems.comet = true; spawnOwnedComet(); }
    else if (id === 'smg') { ownedItems.smg = true; ammoCounts.smg += 60; switchWeapon('smg'); }
    else if (id === 'shotgun') { ownedItems.shotgun = true; ammoCounts.shotgun += 12; switchWeapon('shotgun'); }
    else if (id === 'smg-ammo') { ammoCounts.smg += 120; }
    else if (id === 'shotgun-ammo') { ammoCounts.shotgun += 24; }
    else if (id === 'armor') { ownedItems.armor = true; maxHealth = 150; health = maxHealth; updateHealthHud(); }
    else if (id === 'repair') { health = maxHealth; updateHealthHud(); }
    writeSave();
    updateAmmoHud();
    refreshShop();
    audio.blip('mission');
    showToast('BOUGHT: ' + item.name);
  }
  // The player's own gold Comet GT, parked by the garage. Entering it is
  // never a crime — it is parked on the road edge, clear of any building.
  function spawnOwnedComet() {
    var model = A.makeCar(rng, 0xffd23f, false, 'sport');
    var car = A.makeCarState(57.8, 27, Math.PI / 2, 'parked', 'sport');
    car.model = model; car.owned = true;
    scene.add(model.group);
    A.syncCarModel(car);
    parkedCars.push(car);
    return car;
  }

  function shoot() {
    if (state !== 'playing' || player.inCar) return;
    var w = WEAPONS[currentWeapon];
    var now = gameTime;
    if (now - lastShotAt < w.rate) return;
    if (w.ammo !== null) {
      if (ammoCounts[w.ammo] <= 0) {
        showToast(w.name + ' IS OUT OF AMMO — BUY MORE AT MARA\'S GARAGE');
        lastShotAt = now;
        return;
      }
      ammoCounts[w.ammo] -= 1;
      writeSave();
    }
    lastShotAt = now;
    audio.blip(currentWeapon === 'shotgun' ? 'shotgun' : 'shot');
    updateAmmoHud();
    // one ray per pellet, fanned out by the weapon's spread
    var offsets = w.pellets === 1 ? [0] : [-0.05, -0.025, 0, 0.025, 0.05];
    for (var p = 0; p < w.pellets; p++) firePellet(w, offsets[p]);
    // muzzle flash at the gun
    var start = new THREE.Vector3();
    player.person.group.getWorldPosition(start);
    start.y += 1.3;
    muzzleLight.position.copy(start);
    muzzleLight.intensity = 3;
    muzzleLife = 0.06;
    addWanted(0); // shooting counts as a crime only if it hits someone or is seen; keep simple: +1 if police near
    if (wanted === 0 && policeCars.length > 0) setWanted(1);
    else if (wanted === 0) { /* firing in public still draws attention */ setWanted(1); }
  }

  // One pellet: a ray from the camera with a horizontal screen offset,
  // hitting the closest target. Damage and wanted use the weapon's stats.
  function firePellet(w, offX) {
    raycaster.setFromCamera({ x: offX, y: 0 }, camera);
    raycaster.far = w.range;
    var targets = [];
    for (var i = 0; i < peds.length; i++) {
      if (!peds[i].dead) targets.push({ obj: peds[i].person.group, kind: 'ped', ref: peds[i] });
    }
    for (var j = 0; j < officers.length; j++) {
      if (!officers[j].dead) targets.push({ obj: officers[j].person.group, kind: 'officer', ref: officers[j] });
    }
    for (var k = 0; k < policeCars.length; k++) {
      if (!policeCars[k].disabled) targets.push({ obj: policeCars[k].model.group, kind: 'policecar', ref: policeCars[k] });
    }
    for (var m = 0; m < trafficCars.length; m++) targets.push({ obj: trafficCars[m].model.group, kind: 'car', ref: trafficCars[m] });
    for (var n = 0; n < parkedCars.length; n++) {
      if (!parkedCars[n].disabled) targets.push({ obj: parkedCars[n].model.group, kind: 'car', ref: parkedCars[n] });
    }
    var meshes = [];
    var map = [];
    for (var t = 0; t < targets.length; t++) {
      targets[t].obj.traverse(function (o) { if (o.isMesh) { meshes.push(o); map.push(targets[t]); } });
    }
    var hits = raycaster.intersectObjects(meshes, false);
    var endPoint = null;
    if (hits.length > 0) {
      var hit = hits[0];
      var idx = meshes.indexOf(hit.object);
      var target = map[idx];
      endPoint = hit.point;
      if (target.kind === 'ped') {
        killPed(target.ref, true);
      } else if (target.kind === 'officer') {
        target.ref.hp -= w.damage;
        if (target.ref.hp <= 0) killOfficer(target.ref);
        else addWanted(1, 'ASSAULT ON AN OFFICER');
      } else if (target.kind === 'policecar') {
        target.ref.hp -= w.damage;
        addWanted(1, 'DAMAGED A POLICE CRUISER');
        if (target.ref.hp <= 0) disablePoliceCar(target.ref);
      }
      // scare nearby peds
      scarePeds(player.x, player.z);
    } else {
      endPoint = raycaster.ray.at(w.range * 0.7, new THREE.Vector3());
    }
    // tracer line from the gun to the hit point
    var start = new THREE.Vector3();
    player.person.group.getWorldPosition(start);
    start.y += 1.3;
    var geo = new THREE.BufferGeometry().setFromPoints([start, endPoint]);
    var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9 }));
    scene.add(line);
    tracers.push({ line: line, life: 0.09 });
  }

  function killPed(ped, byPlayer) {
    if (ped.dead) return;
    ped.dead = true;
    ped.person.group.rotation.x = -Math.PI / 2;
    ped.person.group.position.y = 0.3;
    ped.deadTimer = 2.5;
    if (ped === taxi.farePed) {
      // shooting your fare ends the ride (the ped still dies normally and
      // the ped loop removes/respawns them — do not splice here)
      taxi.farePed = null;
      removeTaxiMarker();
      taxi.state = 'off';
      taxi.spawnTimer = 10;
      showToast('YOUR FARE IS GONE');
    }
    if (byPlayer) addWanted(1, 'PEDESTRIAN DOWN');
    scarePeds(ped.x, ped.z);
  }

  function killOfficer(off) {
    if (off.dead) return;
    off.dead = true;
    off.person.group.rotation.x = -Math.PI / 2;
    off.person.group.position.y = 0.3;
    off.deadTimer = 3;
    addWanted(2, 'OFFICER DOWN');
  }

  function disablePoliceCar(car) {
    car.disabled = true;
    car.speed = 0;
    // smoke: tint the cabin dark
    car.model.bodyMat.color.setHex(0x333333);
    addWanted(0);
  }

  function scarePeds(x, z) {
    for (var i = 0; i < peds.length; i++) {
      if (!peds[i].dead && U.dist2(peds[i].x, peds[i].z, x, z) < 1600) peds[i].flee = 2.5;
    }
  }

  // ---------- police management ----------
  function policeTargets() {
    var wantCars = wanted >= 1 ? Math.min(wanted + 1, 5) : 0;
    var wantOfficers = wanted >= 2 ? Math.min(wanted - 1, 3) : 0;
    return { cars: wantCars, officers: wantOfficers };
  }

  function spawnPoliceNear() {
    // spawn on a road ~55-80 units from the player
    var angle = rng.range(0, Math.PI * 2);
    var d = rng.range(55, 80);
    var x = player.x + Math.sin(angle) * d;
    var z = player.z + Math.cos(angle) * d;
    var line = city.roadLines.reduce(function (best, l) {
      return Math.abs(l - x) < Math.abs(best - x) ? l : best;
    }, city.roadLines[0]);
    x = line;
    x = U.clamp(x, -city.half + 5, city.half + 5);
    z = U.clamp(z, -city.half + 5, city.half + 5);
    return spawnPoliceCar(x, z);
  }

  function updatePolice(dt) {
    var t = policeTargets();
    // spawn cars
    var liveCars = policeCars.filter(function (c) { return !c.disabled; }).length;
    if (liveCars < t.cars) spawnPoliceNear();
    // roadblocks at 3+ stars, one at a time, every 25-40s
    roadblockCooldown -= dt;
    if (wanted >= 3 && roadblockCooldown <= 0) {
      var liveBlocks = policeCars.filter(function (c) { return c.roadblock && !c.disabled; }).length;
      if (liveBlocks < 2) spawnRoadblock();
      roadblockCooldown = rng.range(25, 40);
    }
    // despawn far / disabled cars when wanted is 0
    for (var i = policeCars.length - 1; i >= 0; i--) {
      var c = policeCars[i];
      var d2 = U.dist2(c.x, c.z, player.x, player.z);
      if (c.roadblock) {
        c.roadblockTimer -= dt;
        if (c.roadblockTimer <= 0 || wanted === 0) {
          scene.remove(c.model.group);
          policeCars.splice(i, 1);
          continue;
        }
      }
      if ((wanted === 0 && d2 > 120 * 120) || (c.disabled && c.deadTimer !== undefined && c.deadTimer <= 0)) {
        scene.remove(c.model.group);
        policeCars.splice(i, 1);
      } else if (c.disabled) {
        if (c.deadTimer === undefined) c.deadTimer = 8;
        c.deadTimer -= dt;
      }
    }
    // officers: spawn near the player on foot
    var liveOff = officers.filter(function (o) { return !o.dead; }).length;
    if (liveOff < t.officers && !player.inCar) {
      var a = rng.range(0, Math.PI * 2);
      spawnOfficer(player.x + Math.sin(a) * 30, player.z + Math.cos(a) * 30);
    }
    for (var j = officers.length - 1; j >= 0; j--) {
      var o = officers[j];
      if (o.dead) {
        o.deadTimer -= dt;
        if (o.deadTimer <= 0) { scene.remove(o.person.group); officers.splice(j, 1); }
        continue;
      }
      if (wanted === 0) { scene.remove(o.person.group); officers.splice(j, 1); continue; }
      // chase the player on foot
      var dx = player.x - o.x, dz = player.z - o.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1.7 && !player.inCar && Math.abs(player.speed || 0) < 3) {
        gameOver('busted');
        return;
      }
      var want = Math.atan2(dx, dz);
      o.heading = U.lerpAngle(o.heading, want, U.clamp(dt * 5, 0, 1));
      var spd = dist > 8 ? 5.4 : 4.6;
      o.x += Math.sin(o.heading) * spd * dt;
      o.z += Math.cos(o.heading) * spd * dt;
      var res = W.resolveCollision(city, o.x, o.z, 0.5);
      o.x = res.x; o.z = res.z;
      o.walkPhase += dt * spd * 3.2;
      A.animateWalk(o.person, o.walkPhase, 0.6);
      o.person.group.position.set(o.x, 0, o.z);
      o.person.group.rotation.y = o.heading;
      // shoot at the player when close and in line of sight
      o.shootTimer -= dt;
      if (o.shootTimer <= 0 && dist < 26 && dist > 4) {
        o.shootTimer = rng.range(1.2, 2.2);
        damagePlayer(rng.range(4, 9), 'shot');
        audio.blip('shot');
      }
    }
    // police cars chase (roadblock cars stay parked where they were set up)
    for (var k = 0; k < policeCars.length; k++) {
      var pc = policeCars[k];
      if (pc.disabled || pc.roadblock) continue;
      A.policeThink(pc, player.x, player.z, dt);
      var res2 = W.resolveCollision(city, pc.x, pc.z, 1.4);
      if (res2.hit) {
        // bounce off buildings: kill speed, turn a little
        pc.speed *= 0.4;
        pc.heading += 0.5;
      }
      pc.x = res2.x; pc.z = res2.z;
      A.syncCarModel(pc);
      // ram the player's car
      if (player.inCar) {
        var d2p = U.dist2(pc.x, pc.z, player.inCar.x, player.inCar.z);
        if (d2p < 7.5) {
          damagePlayer(4 * dt * 10, 'ram');
          player.inCar.speed *= 0.985;
          if (rng.chance(0.02)) audio.blip('crash');
        }
      }
    }
    // flashing light bars
    var flash = Math.floor(gameTime * 4) % 2 === 0;
    for (var f = 0; f < policeCars.length; f++) {
      var grp = policeCars[f].model.group;
      var lr = grp.getObjectByName('lightR'), lb = grp.getObjectByName('lightB');
      if (lr) lr.material.emissive.setHex(flash ? 0xaa0000 : 0x220000);
      if (lb) lb.material.emissive.setHex(flash ? 0x000022 : 0x0022aa);
    }
  }

  function damagePlayer(amount, kind) {
    if (state !== 'playing') return;
    health -= amount;
    lastDamageAt = gameTime;
    if (health <= 0) {
      health = 0;
      gameOver('wasted');
    }
    updateHealthHud();
  }

  function updateHealthHud() {
    healthBar.style.width = Math.max(0, health / maxHealth * 100) + '%';
    healthNum.textContent = Math.ceil(health);
    healthBar.style.background = health > 50
      ? 'linear-gradient(90deg,#37e05a,#a5f04a)'
      : (health > 25 ? 'linear-gradient(90deg,#ffb52e,#ffd23f)' : 'linear-gradient(90deg,#ff5a5a,#ff8a5a)');
  }

  // ---------- player update ----------
  function updatePlayer(dt) {
    // camera orbit from mouse
    camYaw -= mouseDX * 0.0032;
    camPitch = U.clamp(camPitch + mouseDY * 0.0028, -0.15, 1.1);
    mouseDX = 0; mouseDY = 0;

    var car = player.inCar;
    if (car) {
      var throttle = 0, steer = 0;
      if (keys['KeyW'] || keys['ArrowUp']) throttle = 1;
      if (keys['KeyS'] || keys['ArrowDown']) throttle = -1;
      if (keys['KeyA'] || keys['ArrowLeft']) steer = -1;
      if (keys['KeyD'] || keys['ArrowRight']) steer = 1;
      var handbrake = !!keys['Space'];
      if (handbrake) { // handbrake: hard slowdown, drift turn in driveStep
        car.speed *= Math.max(0, 1 - 3.2 * dt);
      }
      // gentler steering at speed so the car is not twitchy on straights;
      // a sports car stays sharper at speed than a van
      var topSpd = car.topSpeed || 36;
      // a battered car loses top speed until it is serviced
      if (car.cond !== undefined && car.cond < 50) topSpd *= 0.6 + car.cond / 125;
      // rain makes the roads slick: steering is sharper, so the car feels
      // looser in the wet
      if (rainActive) steer *= 1.2;
      steer *= 1 - 0.25 * Math.min(Math.abs(car.speed) / topSpd, 1);
      A.driveStep(car, throttle, steer, dt, topSpd, handbrake);
      car.steer = steer;
      var res = W.resolveCollision(city, car.x, car.z, 1.5);
      if (res.hit) {
        var impact = Math.abs(car.speed);
        if (impact > 12) {
          if (rng.chance(0.5)) audio.blip('crash');
          if (impact > 20) damagePlayer(impact * 0.25, 'crash');
          shake = Math.min(0.6, 0.2 + impact * 0.015);
          // hard hits dent the car: condition drops, and a battered car
          // loses top speed and smokes until it is serviced at the gas
          // station (press H near a pump, $50)
          if (car.cond === undefined) car.cond = 100;
          car.cond = Math.max(0, car.cond - impact * 0.5);
        }
        car.speed *= 0.45;
        car.heading += (rng.chance(0.5) ? 1 : -1) * 0.35;
      }
      car.x = res.x; car.z = res.z;
      // gentle car-vs-car push
      pushCarsApart(car);
      A.syncCarModel(car);
      player.x = car.x; player.z = car.z;
      player.heading = car.heading;
      audio.setEngine(Math.abs(car.speed) / topSpd, true);
      speedEl.classList.remove('hidden');
      speedEl.innerHTML = Math.round(Math.abs(car.speed) * 2.2) + ' <small>mph</small>';
      carNameEl.textContent = car.missionCar ? 'COMET GT'
        : (car.carType && A.CAR_TYPES[car.carType] ? A.CAR_TYPES[car.carType].name.toUpperCase() : '');
      carNameEl.classList.remove('hidden');
      crosshairEl.classList.add('hidden');
    } else {
      audio.setEngine(0, false);
      speedEl.classList.add('hidden');
      carNameEl.classList.add('hidden');
      crosshairEl.classList.remove('hidden');
      // move relative to camera yaw
      var fwd = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
      var right = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
      var mx = 0, mz = 0;
      if (keys['KeyW'] || keys['ArrowUp']) { mx += fwd.x; mz += fwd.z; }
      if (keys['KeyS'] || keys['ArrowDown']) { mx -= fwd.x; mz -= fwd.z; }
      if (keys['KeyA'] || keys['ArrowLeft']) { mx -= right.x; mz -= right.z; }
      if (keys['KeyD'] || keys['ArrowRight']) { mx += right.x; mz += right.z; }
      var len = Math.sqrt(mx * mx + mz * mz);
      var sprint = keys['ShiftLeft'] || keys['ShiftRight'];
      var spd = sprint ? 8.6 : 5.2;
      if (len > 0) {
        mx /= len; mz /= len;
        player.x += mx * spd * dt;
        player.z += mz * spd * dt;
        player.heading = Math.atan2(mx, mz);
        player.walkPhase += dt * spd * 2.4;
        player.speed = spd;
      } else {
        player.speed = 0;
      }
      // jump
      if (keys['Space'] && player.onGround) {
        player.vy = 7.5; player.onGround = false;
      }
      if (!player.onGround) {
        player.vy -= 22 * dt;
        player.y += player.vy * dt;
        if (player.y <= 0) { player.y = 0; player.vy = 0; player.onGround = true; }
      }
      var res2 = W.resolveCollision(city, player.x, player.z, 0.55);
      player.x = res2.x; player.z = res2.z;
      // running into a pedestrian knocks them (and is a crime) — never the
      // waiting fare, who just stands at the marker
      for (var i = 0; i < peds.length; i++) {
        var ped = peds[i];
        if (!ped.dead && ped !== taxi.farePed && U.dist2(player.x, player.z, ped.x, ped.z) < 1.1 && player.speed > 4) {
          killPed(ped, true);
        }
      }
      A.animateWalk(player.person, player.walkPhase, len > 0 ? (sprint ? 0.75 : 0.5) : 0);
      player.person.group.position.set(player.x, player.y, player.z);
      player.person.group.rotation.y = player.heading;
    }
    updateInteractPrompt();
  }

  function pushCarsApart(car) {
    var all = allCars();
    for (var i = 0; i < all.length; i++) {
      var o = all[i];
      if (o === car || o.disabled) continue;
      var dx = car.x - o.x, dz = car.z - o.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < 12.5 && d2 > 0.001) {
        var d = Math.sqrt(d2);
        var push = (3.55 - d) * 0.5;
        car.x += (dx / d) * push; car.z += (dz / d) * push;
        if (o.kind === 'traffic' || o.kind === 'parked') {
          o.x -= (dx / d) * push; o.z -= (dz / d) * push;
          A.syncCarModel(o);
        }
      }
    }
  }

  // ---------- traffic + peds update ----------
  function updateTraffic(dt) {
    for (var i = 0; i < trafficCars.length; i++) {
      var c = trafficCars[i];
      A.trafficThink(c, city, rng, dt);
      var res = W.resolveCollision(city, c.x, c.z, 1.4);
      if (res.hit) { c.speed *= 0.3; c.heading += Math.PI / 2; }
      c.x = res.x; c.z = res.z;
      A.syncCarModel(c);
    }
    // peds
    for (var j = 0; j < peds.length; j++) {
      var ped = peds[j];
      if (ped.dead) {
        ped.deadTimer -= dt;
        if (ped.deadTimer <= 0) {
          scene.remove(ped.person.group);
          peds.splice(j, 1); j--;
          // respawn a fresh pedestrian elsewhere
          var sp = rng.pick(city.pedSpawns);
          spawnPed(sp.x, sp.z);
        }
        continue;
      }
      if (ped === taxi.farePed) {
        // the fare waits at the cyan marker: stand still, do not wander,
        // and cannot be run over by the player's car
        ped.person.group.position.set(ped.x, 0, ped.z);
        continue;
      }
      var threat = null;
      if (player.inCar && Math.abs(player.inCar.speed) > 8) threat = { x: player.x, z: player.z };
      else if (!player.inCar) threat = { x: player.x, z: player.z };
      A.pedThink(ped, city, rng, dt, threat);
      // car hitting a pedestrian
      if (player.inCar && ped !== taxi.farePed) {
        var d2 = U.dist2(ped.x, ped.z, player.inCar.x, player.inCar.z);
        if (d2 < 4.2 && Math.abs(player.inCar.speed) > 4) {
          killPed(ped, true);
          player.inCar.speed *= 0.92;
          audio.blip('crash');
        }
      }
    }
  }

  // ---------- cash pickups ----------
  function updatePickups(dt) {
    for (var i = 0; i < pickups.length; i++) {
      var p = pickups[i];
      if (p.taken) continue;
      // spin + bob so they catch the eye
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.position.y = 1 + Math.sin(gameTime * 3 + p.phase) * 0.25;
      // walk or drive over one to grab it
      if (U.dist2(player.x, player.z, p.x, p.z) < 6.25) {
        p.taken = true;
        p.mesh.visible = false;
        collectedPickups.push(p.index);
        cash += 25;
        audio.blip('pickup');
        showToast('CASH PICKUP  +$25');
        writeSave();
      }
    }
  }

  // ---------- taxi side job ----------
  // A fare waits at a cyan marker. Drive up in a car to pick them up, then
  // get them to the destination before the clock runs out. $200 a ride,
  // +$100 tip if you are fast. Fares only appear while no story mission is
  // running, and a mission starting cancels an open fare.
  function placeTaxiMarker(x, z) {
    removeTaxiMarker();
    var g = new THREE.Group();
    var cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 0.3, 20),
      new THREE.MeshLambertMaterial({ color: 0x7fd4ff, emissive: 0x114455, transparent: true, opacity: 0.8 }));
    cyl.position.y = 0.2;
    g.add(cyl);
    var beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 1.2, 20, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 10;
    g.add(beam);
    g.position.set(x, 0, z);
    scene.add(g);
    taxi.marker = g;
  }
  function removeTaxiMarker() {
    if (taxi.marker) { scene.remove(taxi.marker); taxi.marker = null; }
  }
  function spawnFare() {
    var sp = rng.pick(city.pedSpawns);
    var res = W.resolveCollision(city, sp.x + rng.range(-6, 6), sp.z + rng.range(-6, 6), 0.6);
    var ped = spawnPed(res.x, res.z);
    taxi.farePed = ped;
    taxi.fareX = ped.x; taxi.fareZ = ped.z;
    taxi.state = 'waiting';
    placeTaxiMarker(ped.x, ped.z);
    showToast('TAXI FARE WAITING — drive to the cyan marker');
  }
  function cancelTaxi() {
    if (taxi.farePed) {
      var idx = peds.indexOf(taxi.farePed);
      if (idx >= 0) { scene.remove(taxi.farePed.person.group); peds.splice(idx, 1); }
      taxi.farePed = null;
    }
    removeTaxiMarker();
    taxi.state = 'off';
    taxi.spawnTimer = 10;
    // the fare is gone (bailed, delivered, or timed out): a fresh
    // pedestrian spawns elsewhere so the crowd count stays constant
    var sp = rng.pick(city.pedSpawns);
    spawnPed(sp.x, sp.z);
  }
  function updateTaxi(dt) {
    if (taxi.state === 'off') {
      if (!missionActive) {
        taxi.spawnTimer -= dt;
        if (taxi.spawnTimer <= 0) spawnFare();
      }
      return;
    }
    if (taxi.state === 'waiting') {
      if (missionActive) { cancelTaxi(); return; }
      if (!taxi.farePed) { taxi.state = 'off'; taxi.spawnTimer = 6; return; }
      var d2 = U.dist2(player.x, player.z, taxi.farePed.x, taxi.farePed.z);
      if (d2 < 16) {
        if (player.inCar) {
          // pick a destination far from the pickup, then start the clock
          var dest = null;
          for (var t = 0; t < 10; t++) {
            var cand = rng.pick(city.pedSpawns);
            if (U.dist2(cand.x, cand.z, taxi.farePed.x, taxi.farePed.z) > 90 * 90) { dest = cand; break; }
          }
          if (!dest) dest = rng.pick(city.pedSpawns);
          taxi.destX = dest.x; taxi.destZ = dest.z;
          taxi.timer = 75;
          taxi.state = 'active';
          // the fare is on board: take the ped out of the scene entirely
          // (they are now "in" the car) — otherwise a frozen figure would
          // linger at the pickup spot for the whole ride
          scene.remove(taxi.farePed.person.group);
          var idx = peds.indexOf(taxi.farePed);
          if (idx >= 0) peds.splice(idx, 1);
          taxi.farePed = null;
          placeTaxiMarker(taxi.destX, taxi.destZ);
          showToast('FARE ON BOARD — 75 SECONDS!');
          audio.blip('pickup');
          updateObjectiveText();
        } else if (d2 < 6.25 && gameTime - taxi.lastFootToast > 5) {
          taxi.lastFootToast = gameTime;
          showToast('THE FARE NEEDS A CAR — COME BACK IN A VEHICLE');
        }
      }
      return;
    }
    if (taxi.state === 'active') {
      if (missionActive) { cancelTaxi(); return; }
      taxi.timer -= dt;
      if (taxi.timer <= 0) {
        showToast('FARE LOST — THE PASSENGER WALKED AWAY');
        cancelTaxi();
        return;
      }
      var d2d = U.dist2(player.x, player.z, taxi.destX, taxi.destZ);
      if (d2d < 25) {
        var tip = taxi.timer > 20 ? 100 : 0;
        cash += 200 + tip;
        showToast('FARE COMPLETE  +$' + (200 + tip) + (tip ? ' (TIP!)' : ''));
        audio.blip('mission');
        cancelTaxi();
        taxi.state = 'cooldown';
        taxi.cooldown = 8;
        writeSave();
        updateObjectiveText();
      }
      return;
    }
    if (taxi.state === 'cooldown') {
      taxi.cooldown -= dt;
      if (taxi.cooldown <= 0) { taxi.state = 'off'; taxi.spawnTimer = 4; }
    }
  }

  // ---------- missions update ----------
  function updateMissions(dt) {
    if (!missionActive) {
      // auto-start the next mission when the player reaches its start marker
      if (missionIndex < MISSIONS.length) {
        var next = MISSIONS[missionIndex];
        var start = next.steps[0];
        var d2 = U.dist2(player.x, player.z, start.x, start.z);
        if (d2 < 14 * 14) {
          startMission(missionIndex);
        } else {
          // show a faint marker for the next job's start
          if (!missionMarker) {
            var g = new THREE.Group();
            var cyl = new THREE.Mesh(
              new THREE.CylinderGeometry(2.4, 2.4, 0.3, 20),
              new THREE.MeshLambertMaterial({ color: 0x7fd4ff, emissive: 0x114455, transparent: true, opacity: 0.7 }));
            cyl.position.y = 0.2;
            g.add(cyl);
            g.position.set(start.x, 0, start.z);
            scene.add(g);
            missionMarker = g;
          }
        }
      }
      return;
    }
    var m = missionActive;
    var step = m.def.steps[m.step];
    if (m.timer > 0) {
      m.timer -= dt;
      if (m.timer <= 0) {
        // a survive job ends when the clock does — living through the heat
        // IS the win; a delivery job fails when its clock runs out
        if (step && step.type === 'survive') completeMission();
        else failMission('time ran out');
        return;
      }
    }
    if (!step) return;
    if (step.type === 'goto') {
      var d2g = U.dist2(player.x, player.z, step.x, step.z);
      if (d2g < step.radius * step.radius) completeStep();
    } else if (step.type === 'ghost') {
      // stealth pickup: arriving clean completes it; arriving with any
      // wanted stars blows the job
      var d2h = U.dist2(player.x, player.z, step.x, step.z);
      if (d2h < step.radius * step.radius) {
        if (wanted > 0) failMission('you were spotted');
        else completeStep();
      }
    } else if (step.type === 'steal') {
      // complete when the player is driving the mission car
      if (player.inCar && player.inCar.missionCar) {
        // now the deliver step takes over
        m.step++;
        placeMarker();
        updateObjectiveText();
        showToast('GOT IT — NOW DELIVER IT');
      }
    } else if (step.type === 'deliver') {
      if (player.inCar && player.inCar.missionCar) {
        var d2d = U.dist2(player.x, player.z, step.x, step.z);
        if (d2d < step.radius * step.radius) {
          // hand the car over: remove it, complete the mission
          var car = player.inCar;
          player.inCar = null;
          player.person.group.visible = true;
          scene.remove(car.model.group);
          var pi = parkedCars.indexOf(car);
          if (pi >= 0) parkedCars.splice(pi, 1);
          audio.setEngine(0, false);
          completeStep();
        }
      }
    } else if (step.type === 'ring') {
      // stunt course: drive (or run) through the gold ring
      var d2r = U.dist2(player.x, player.z, step.x, step.z);
      if (d2r < step.radius * step.radius) completeStep();
    } else if (step.type === 'escort') {
      // VIP pickup: the VIP only boards if the player arrives in a car
      var d2e = U.dist2(player.x, player.z, step.x, step.z);
      if (d2e < step.radius * step.radius) {
        if (!player.inCar) {
          if (gameTime - (m.lastEscortToast || -999) > 5) {
            m.lastEscortToast = gameTime;
            showToast('THE VIP NEEDS A CAR — COME BACK IN A VEHICLE');
          }
        } else {
          if (m.vipPed) {
            scene.remove(m.vipPed.person.group);
            m.vipPed = null;
          }
          addWanted(1, 'SOMEONE TIPPED OFF THE COPS');
          showToast('VIP ON BOARD — GET TO THE PIER!');
          completeStep();
        }
      }
    } else if (step.type === 'deliver-vip') {
      // the VIP rides with the player: delivery only counts while driving
      if (player.inCar) {
        var d2v = U.dist2(player.x, player.z, step.x, step.z);
        if (d2v < step.radius * step.radius) completeStep();
      }
    } else if (step.type === 'survive') {
      // survive while wanted; if wanted hits 0 the heat is off
      if (wanted === 0) {
        completeMission();
      }
    }
    updateObjectiveText();
  }

  // ---------- wanted decay ----------
  function updateWanted(dt) {
    if (wanted === 0) return;
    wantedTimer += dt;
    var nearPolice = false;
    for (var i = 0; i < policeCars.length; i++) {
      if (U.dist2(policeCars[i].x, policeCars[i].z, player.x, player.z) < 45 * 45) { nearPolice = true; break; }
    }
    if (!nearPolice) {
      for (var j = 0; j < officers.length; j++) {
        if (U.dist2(officers[j].x, officers[j].z, player.x, player.z) < 30 * 30) { nearPolice = true; break; }
      }
    }
    if (wantedTimer > 16 && !nearPolice) {
      decayTimer += dt;
      if (decayTimer > 5) {
        decayTimer = 0;
        setWanted(wanted - 1);
        if (wanted > 0) showToast('HEAT DYING DOWN… ' + wanted + '★');
        else showToast('YOU LOST THEM');
      }
    }
  }

  // ---------- camera ----------
  function updateCamera(dt) {
    var target, dist, height, lookY;
    if (player.inCar) {
      var car = player.inCar;
      target = { x: car.x, z: car.z };
      dist = 10.5; height = 4.4; lookY = 1.4;
      // camera follows behind the car, lerped toward the car's heading
      var wantYaw = car.heading + Math.PI;
      camYaw = U.lerpAngle(camYaw, wantYaw, U.clamp(dt * 1.4, 0, 1));
      camPitch = U.lerp(camPitch, 0.3, U.clamp(dt * 2, 0, 1));
    } else {
      target = { x: player.x, z: player.z };
      dist = 6.5; height = 2.6; lookY = 1.5;
    }
    var cx = target.x + Math.sin(camYaw) * Math.cos(camPitch) * dist;
    var cz = target.z + Math.cos(camYaw) * Math.cos(camPitch) * dist;
    var cy = height + Math.sin(camPitch) * dist * 0.9;
    // keep the camera out of buildings
    var hit = W.hitsBuilding(city, cx, cz, 0.6);
    if (hit) {
      cx = target.x + Math.sin(camYaw) * 2.2;
      cz = target.z + Math.cos(camYaw) * 2.2;
      cy = height + 1.2;
    }
    camera.position.set(cx, Math.max(cy, 1.2), cz);
    // crash shake: a deterministic wobble from game time, never Math.random,
    // so screenshot runs stay reproducible
    if (shake > 0.001) {
      camera.position.x += Math.sin(gameTime * 97.3) * shake;
      camera.position.y += Math.sin(gameTime * 113.1 + 1.7) * shake * 0.7;
    }
    camera.lookAt(target.x, lookY + (player.y || 0), target.z);
    // sun shadow follows the player
    if (sunLight) {
      sunLight.position.set(target.x + sunDX, sunDY, target.z + sunDZ);
      sunLight.target.position.set(target.x, 0, target.z);
      sunLight.target.updateMatrixWorld();
    }
  }

  // Day/night cycle: the sun orbits on game time, the sky, fog and light
  // levels follow it, and the streetlamps switch on at night. Rain dims
  // everything further. Screenshots always stay at sunny late morning:
  // the phase does not advance in SHOT mode.
  function updateDayNight(dt) {
    if (!SHOT) dayPhase = (dayPhase + dt / DAY_LENGTH) % 1;
    var a = dayPhase * Math.PI * 2;
    var elev = Math.sin(a); // -1..1, above 0 during the day
    sunDX = 120;
    sunDY = Math.max(25, 30 + elev * 170);
    sunDZ = 60 + Math.cos(a) * 40;
    var dayness = U.clamp(elev * 2.2, 0, 1); // 1 at noon, 0 at night
    var duskness = U.clamp(1 - Math.abs(elev) * 3, 0, 1) * (elev > -0.15 ? 1 : 0);
    skyTmp.copy(skyNight).lerp(skyDay, dayness);
    if (duskness > 0) skyTmp.lerp(skyDusk, duskness * 0.7);
    scene.background.copy(skyTmp);
    if (city.skyMat) city.skyMat.color.copy(skyTmp);
    fogTmp.copy(fogNight).lerp(fogDay, dayness);
    if (duskness > 0) fogTmp.lerp(fogDusk, duskness * 0.7);
    scene.fog.color.copy(fogTmp);
    var lightScale = rainActive ? 0.7 : 1;
    if (sunLight) sunLight.intensity = (0.25 + dayness * 2.15) * lightScale;
    if (city.hemi) city.hemi.intensity = (0.35 + dayness * 0.7) * lightScale;
    if (city.lampMat) city.lampMat.emissive.setHex(dayness > 0.5 ? 0xaa8833 : 0xffd76a);
  }

  function updateClockHud() {
    var mins = Math.floor(((6 + dayPhase * 24) % 24) * 60);
    var h = Math.floor(mins / 60), m = mins % 60;
    var elev = Math.sin(dayPhase * Math.PI * 2);
    var label = elev > 0.15 ? 'DAY' : (elev < -0.15 ? 'NIGHT' : 'DUSK');
    clockEl.textContent = label + ' ' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // ---------- gas station service ----------
  // Park by a pump at the (135,-81) station and press H: $50 restores the
  // car to full condition. A battered car (condition under 50) loses top
  // speed and smokes, so servicing is worth the cash.
  function nearGasPump(range) {
    if (!city.gasPumps) return false;
    for (var i = 0; i < city.gasPumps.length; i++) {
      if (U.dist2(player.x, player.z, city.gasPumps[i].x, city.gasPumps[i].z) < range * range) return true;
    }
    return false;
  }
  function serviceCar() {
    if (!player.inCar || !nearGasPump(7)) return;
    var car = player.inCar;
    var cond = car.cond === undefined ? 100 : car.cond;
    if (cond >= 100) { showToast('ALREADY IN TOP SHAPE'); return; }
    if (cash < 50) { showToast('NOT ENOUGH CASH — SERVICE COSTS $50'); audio.blip('click'); return; }
    cash -= 50;
    car.cond = 100;
    writeSave();
    audio.blip('mission');
    showToast('SERVICED — GOOD AS NEW  -$50');
  }

  // ---------- HUD + minimap ----------
  function updateHud(dt) {
    cashEl.textContent = '$' + cash.toLocaleString('en-US');
    updateClockHud();
    if (toastTimer > 0) {
      toastTimer = Math.max(0, toastTimer - dt);
      if (toastTimer <= 0) toastEl.style.opacity = 0;
    }
  }

  function drawMinimap() {
    var S = 200, half = city.half;
    var minX = -half - 8, maxX = half + 48, minZ = -half - 8, maxZ = half + 8;
    function mx(x) { return ((x - minX) / (maxX - minX)) * S; }
    function mz(z) { return ((z - minZ) / (maxZ - minZ)) * S; }
    mctx.fillStyle = '#0e1a26';
    mctx.fillRect(0, 0, S, S);
    // ocean + sand (east)
    mctx.fillStyle = '#1e7fa8';
    mctx.fillRect(mx(half + 46), 0, S - mx(half + 46), S);
    mctx.fillStyle = '#c9b078';
    mctx.fillRect(mx(half), 0, mx(half + 46) - mx(half), S);
    // roads
    mctx.strokeStyle = '#4a5058';
    mctx.lineWidth = 5;
    for (var i = 0; i < city.roadLines.length; i++) {
      var l = city.roadLines[i];
      mctx.beginPath(); mctx.moveTo(mx(l), mz(-half)); mctx.lineTo(mx(l), mz(half)); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(mx(-half), mz(l)); mctx.lineTo(mx(half), mz(l)); mctx.stroke();
    }
    // buildings (light dots)
    mctx.fillStyle = 'rgba(200,210,220,0.5)';
    for (var b = 0; b < city.buildings.length; b++) {
      var bb = city.buildings[b];
      mctx.fillRect(mx(bb.minX), mz(bb.minZ), Math.max(2, mx(bb.maxX) - mx(bb.minX)), Math.max(2, mz(bb.maxZ) - mz(bb.minZ)));
    }
    // mission marker
    var step = missionActive ? missionActive.def.steps[missionActive.step] : null;
    if (step && step.type !== 'survive') {
      var pulse = 5 + Math.sin(gameTime * 5) * 2;
      mctx.fillStyle = '#ffd23f';
      mctx.beginPath(); mctx.arc(mx(step.x), mz(step.z), pulse, 0, Math.PI * 2); mctx.fill();
      mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5;
      mctx.beginPath(); mctx.arc(mx(step.x), mz(step.z), pulse + 3, 0, Math.PI * 2); mctx.stroke();
    } else if (!missionActive && missionIndex < MISSIONS.length) {
      var s0 = MISSIONS[missionIndex].steps[0];
      mctx.fillStyle = '#7fd4ff';
      mctx.beginPath(); mctx.arc(mx(s0.x), mz(s0.z), 4, 0, Math.PI * 2); mctx.fill();
    }
    // stunt ramps: orange triangle markers
    mctx.fillStyle = '#ff8a32';
    for (var ri = 0; ri < ramps.length; ri++) {
      var rp = ramps[ri];
      var rx = mx(rp.x), rz = mz(rp.z);
      mctx.beginPath();
      mctx.moveTo(rx, rz - 5);
      mctx.lineTo(rx - 4.5, rz + 3.5);
      mctx.lineTo(rx + 4.5, rz + 3.5);
      mctx.closePath();
      mctx.fill();
    }
    // Mara's Garage shop (green $ at the garage's east door)
    mctx.fillStyle = '#7dff9a';
    mctx.font = 'bold 13px sans-serif';
    mctx.fillText('$', mx(47) - 4, mz(27) + 5);
    // gas station (orange G at the east lot)
    mctx.fillStyle = '#ff9f43';
    mctx.fillText('G', mx(135) - 4, mz(-81) + 5);
    // cash pickups (gold dots)
    mctx.fillStyle = '#ffd23f';
    for (var pi = 0; pi < pickups.length; pi++) {
      if (pickups[pi].taken) continue;
      mctx.beginPath(); mctx.arc(mx(pickups[pi].x), mz(pickups[pi].z), 2.5, 0, Math.PI * 2); mctx.fill();
    }
    // taxi fare (cyan dot) or destination while a fare is running
    if (taxi.state === 'waiting' && taxi.farePed) {
      mctx.fillStyle = '#7fd4ff';
      mctx.beginPath(); mctx.arc(mx(taxi.farePed.x), mz(taxi.farePed.z), 4, 0, Math.PI * 2); mctx.fill();
    } else if (taxi.state === 'active') {
      mctx.fillStyle = '#7fd4ff';
      mctx.beginPath(); mctx.arc(mx(taxi.destX), mz(taxi.destZ), 4, 0, Math.PI * 2); mctx.fill();
    }
    // traffic + parked cars
    mctx.fillStyle = '#e8e8e8';
    var all = allCars();
    for (var c = 0; c < all.length; c++) {
      mctx.fillRect(mx(all[c].x) - 1.5, mz(all[c].z) - 1.5, 3, 3);
    }
    // police (flashing)
    var flash = Math.floor(gameTime * 4) % 2 === 0;
    mctx.fillStyle = flash ? '#ff4444' : '#4488ff';
    for (var p = 0; p < policeCars.length; p++) {
      mctx.beginPath(); mctx.arc(mx(policeCars[p].x), mz(policeCars[p].z), 3.5, 0, Math.PI * 2); mctx.fill();
    }
    for (var o = 0; o < officers.length; o++) {
      mctx.fillRect(mx(officers[o].x) - 2, mz(officers[o].z) - 2, 4, 4);
    }
    // police helicopter (white H) when it is up
    if (helicopter && helicopter.group.visible) {
      mctx.fillStyle = '#ffffff';
      mctx.font = 'bold 11px sans-serif';
      mctx.fillText('H', mx(helicopter.group.position.x) - 4, mz(helicopter.group.position.z) + 4);
    }
    // safehouses (green when owned, purple when for sale)
    for (var hp = 0; hp < properties.length; hp++) {
      mctx.fillStyle = ownedProperties.indexOf(properties[hp].index) >= 0 ? '#43e68b' : '#b88cff';
      mctx.fillRect(mx(properties[hp].x) - 3, mz(properties[hp].z) - 3, 6, 6);
    }
    // bank job target (cyan)
    if (!bankDone) {
      var bankX = bankJob.active && bankJob.step === 2 ? -162 : (bankJob.active && bankJob.step === 1 ? 54 : 0);
      var bankZ = bankJob.active && bankJob.step === 2 ? 162 : 0;
      mctx.fillStyle = '#38d9ff';
      mctx.fillRect(mx(bankX) - 3, mz(bankZ) - 3, 6, 6);
    }
    // active race checkpoint (orange)
    if (activeRace) {
      var racePoint = races[activeRace.index].points[activeRace.checkpoint];
      mctx.fillStyle = '#ff8b35';
      mctx.beginPath(); mctx.arc(mx(racePoint[0]), mz(racePoint[1]), 5, 0, Math.PI * 2); mctx.fill();
    }
    // player arrow
    var px = mx(player.x), pz = mz(player.z);
    mctx.save();
    mctx.translate(px, pz);
    mctx.rotate(Math.atan2(Math.sin(player.heading), Math.cos(player.heading)) * -1 + Math.PI);
    mctx.fillStyle = '#ffffff';
    mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(-5, 6); mctx.closePath(); mctx.fill();
    mctx.restore();
  }

  // ---------- game flow ----------
  function startGame(fresh) {
    if (fresh) {
      // starting a new game while sitting in a car: give the car back to
      // the city first (a mission car stays parked so it can be stolen
      // again, any other car returns to what it was, deduped)
      if (player.inCar) {
        var abandonedCar = player.inCar;
        abandonedCar.kind = abandonedCar.missionCar ? 'parked' : (abandonedCar.prevKind || 'traffic');
        abandonedCar.prevKind = null;
        if (abandonedCar.kind === 'traffic' && trafficCars.indexOf(abandonedCar) < 0) trafficCars.push(abandonedCar);
        player.inCar = null;
        player.person.group.visible = true;
      }
      cash = 250; missionsDone = emptyCompleted();
      missionIndex = 0; missionActive = null; health = maxHealth;
      collectedPickups = [];
      // new-game reset for the ported features: no houses, bank job
      // available again, NPC job count back to zero, markers back to
      // their for-sale colours
      ownedProperties = []; bankDone = false; npcJobsDone = 0;
      clearFeatureJobs();
      for (var hp0 = 0; hp0 < properties.length; hp0++) {
        var prop0 = properties[hp0];
        prop0.marker.traverse(function (o) { if (o.material && o.material.color) o.material.color.setHex(prop0.color); });
        prop0.sign.material.color.setHex(0x26384a);
      }
      for (var pi = 0; pi < pickups.length; pi++) {
        pickups[pi].taken = false;
        pickups[pi].mesh.visible = true;
      }
      setWanted(0);
      writeSave();
    }
    $('start-screen').classList.add('hidden');
    $('gameover-screen').classList.add('hidden');
    $('pause-screen').classList.add('hidden');
    hud.classList.remove('hidden');
    state = 'playing';
    updateHealthHud();
    updateWantedHud();
    updateAmmoHud();
    updateObjectiveText();
    audio.ensure();
    audio.startMusic();
    if (missionIndex < MISSIONS.length && !missionActive) {
      // the first marker is already placed by updateMissions
    }
  }

  function pauseGame() {
    state = 'paused';
    $('pause-screen').classList.remove('hidden');
    audio.setEngine(0, false);
    audio.setSiren(false);
  }

  function resumeGame() {
    state = 'playing';
    $('pause-screen').classList.add('hidden');
    audio.setSiren(wanted > 0);
  }

  function gameOver(kind) {
    if (state !== 'playing') return;
    state = 'gameover';
    if (bankJob.active) { showToast('BANK JOB FAILED — ' + (kind === 'busted' ? 'BUSTED' : 'WASTED')); }
    clearFeatureJobs();
    audio.blip('arrest');
    audio.setEngine(0, false);
    audio.setSiren(false);
    audio.stopMusic();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    $('gameover-title').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
    $('gameover-text').textContent = kind === 'busted'
      ? 'The Solmar PD caught up with you. Mara is not happy.'
      : 'Solmar City got the better of you this time.';
    $('gameover-screen').classList.remove('hidden');
    hud.classList.add('hidden');
  }

  function quitToTitle() {
    state = 'title';
    $('pause-screen').classList.add('hidden');
    $('gameover-screen').classList.add('hidden');
    $('start-screen').classList.remove('hidden');
    hud.classList.add('hidden');
    audio.setEngine(0, false);
    audio.setSiren(false);
    audio.stopMusic();
    refreshTitleSaveNote();
  }

  function refreshTitleSaveNote() {
    var done = missionsDone.filter(Boolean).length;
    $('save-note').textContent = 'Saved: $' + cash.toLocaleString('en-US') + '  •  ' + done + '/' + MISSION_COUNT + ' jobs done' + (bestStars ? '  •  best heat ' + bestStars + '★' : '');
    $('continue-btn').style.display = save.cash !== 250 || done > 0 ? '' : 'none';
  }

  $('start-btn').addEventListener('click', function () { startGame(false); });
  $('newgame-btn').addEventListener('click', function () { startGame(true); });
  $('continue-btn').addEventListener('click', function () { startGame(false); });
  $('resume-btn').addEventListener('click', resumeGame);
  $('quit-btn').addEventListener('click', quitToTitle);
  $('retry-btn').addEventListener('click', function () {
    // retry: keep cash and missions, restore health, clear wanted, respawn
    health = maxHealth;
    setWanted(0);
    if (missionActive && missionActive.vipPed) { scene.remove(missionActive.vipPed.person.group); missionActive.vipPed = null; }
    missionActive = null;
    clearFeatureJobs();
    removeMarker();
    // clear police
    for (var i = policeCars.length - 1; i >= 0; i--) { scene.remove(policeCars[i].model.group); policeCars.splice(i, 1); }
    for (var j = officers.length - 1; j >= 0; j--) { scene.remove(officers[j].person.group); officers.splice(j, 1); }
    if (player.inCar) { player.inCar = null; player.person.group.visible = true; }
    player.x = 0; player.z = 20; player.y = 0; player.vy = 0; player.heading = 0;
    player.person.group.position.set(0, 0, 20);
    updateHealthHud();
    updateObjectiveText();
    startGame(false);
  });
  $('title-btn').addEventListener('click', quitToTitle);
  $('shop-close').addEventListener('click', closeShop);
  // shop buy buttons: each carries its item id in data-item
  var shopBtns = document.querySelectorAll('#shop-screen [data-item]');
  for (var sb = 0; sb < shopBtns.length; sb++) {
    (function (btn) {
      btn.addEventListener('click', function () { buyItem(btn.getAttribute('data-item')); });
    })(shopBtns[sb]);
  }

  // ---------- main loop ----------
  var lastT = performance.now();
  var shotFrames = 0;
  var shotReady = false;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    if (SHOT) dt = 1 / 60; // fixed step for reproducible screenshots
    if (state === 'playing') {
      gameTime += dt;
      // health regen after 10s without damage
      if (gameTime - lastDamageAt > 10 && health < maxHealth) {
        health = Math.min(maxHealth, health + 4 * dt);
        updateHealthHud();
      }
      updatePlayer(dt);
      updateTraffic(dt);
      updatePolice(dt);
      // missions and wanted only advance while actually playing: the police
      // step above can end the run (busted/wasted), and a mission must not
      // complete or fail on the game-over screen
      if (state === 'playing') {
        updateMissions(dt);
        updateWanted(dt);
        updateBankJob(dt);
        updateRace(dt);
        updateNpcTasks(dt);
      }
      updateTaxi(dt);
      updatePickups(dt);
      updateRamps(dt);
      updateWeather(dt);
      updatePoliceHelicopter(dt);
      updateStars(dt);
      updateDayNight(dt);
      updateCamera(dt);
      updateHud(dt);
      drawMinimap();
      // muzzle flash + crash shake decay
      if (muzzleLife > 0) {
        muzzleLife -= dt;
        muzzleLight.intensity = muzzleLife > 0 ? 3 * (muzzleLife / 0.06) : 0;
      }
      if (shake > 0) shake = Math.max(0, shake - dt * 1.8);
      updateBurst(dt);
      updateSmoke(dt);
      // tracers fade
      for (var i = tracers.length - 1; i >= 0; i--) {
        tracers[i].life -= dt;
        if (tracers[i].life <= 0) {
          scene.remove(tracers[i].line);
          tracers[i].line.geometry.dispose();
          tracers.splice(i, 1);
        }
      }
      // mission marker spin/pulse
      if (missionMarker) missionMarker.rotation.y += dt * 0.8;
    }
    renderer.render(scene, camera);
    if (SHOT && !shotReady) {
      shotFrames++;
      if (shotFrames >= 90) {
        shotReady = true;
        global.window.__shotReady = true;
      }
    }
  }

  // ---------- boot ----------
  populate();
  createProperties();
  createRaces();
  refreshTitleSaveNote();
  updateHealthHud();
  updateWantedHud();
  updateObjectiveText();
  // Idle camera orbit behind the title screen.
  camera.position.set(40, 26, 120);
  camera.lookAt(0, 8, 0);

  if (SHOT) setupShot();

  function setupShot() {
    // Deterministic screenshot scenarios. The game auto-starts; after 90
    // fixed steps window.__shotReady is set by the loop.
    hud.classList.remove('hidden');
    $('start-screen').classList.add('hidden');
    state = 'playing';
    audio.ensure();
    if (SHOT === 'start') {
      // title screen over the city
      hud.classList.add('hidden');
      $('start-screen').classList.remove('hidden');
      state = 'title';
      return;
    }
    if (SHOT === 'foot') {
      // stand on the central road (x=0) so no building can block the camera;
      // the old block-center spot ended up behind a wall after the city
      // layout changed
      player.x = 0; player.z = -27; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      // a few pedestrians on the sidewalks in frame
      spawnPed(-9, -30); spawnPed(9, -24); spawnPed(-9, -35);
      return;
    }
    if (SHOT === 'drive') {
      var spot = { x: 54, z: -20, angle: 0 };
      var car = spawnParkedCar(spot, 0xfdcb6e);
      enterCar(car, true); // staged shot, not a theft
      car.speed = 16;
      camYaw = Math.PI; camPitch = 0.28;
      return;
    }
    if (SHOT === 'chase') {
      var spot2 = { x: 0, z: -40, angle: 0 };
      var car2 = spawnParkedCar(spot2, 0xd63031);
      enterCar(car2, true); // staged shot; wanted is set explicitly below
      car2.speed = 22;
      setWanted(3);
      spawnPoliceCar(-8, -70);
      spawnPoliceCar(10, -75);
      spawnPoliceCar(0, -95);
      camYaw = Math.PI; camPitch = 0.28;
      return;
    }
    if (SHOT === 'mission') {
      startMission(0);
      // stand on the road intersection north-west of the marker and look
      // south-east at it: street + park + marker beam in frame, not grass
      player.x = -54; player.z = -108; player.heading = Math.PI / 4;
      camYaw = -Math.PI * 0.75; camPitch = 0.3;
      return;
    }
    // extra shot modes for verifying the new content (not in shots.json):
    // m4/m5/m6 start the new missions, taxi spawns a fare and picks it up
    if (SHOT === 'm4') {
      startMission(4);
      player.x = -90; player.z = 120; player.heading = Math.PI * 0.5;
      camYaw = Math.PI * 0.5; camPitch = 0.3;
      return;
    }
    if (SHOT === 'm5') {
      startMission(5);
      player.x = 27; player.z = -120; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'm6') {
      startMission(6);
      player.x = 90; player.z = 135; player.heading = Math.PI * 0.5;
      camYaw = Math.PI * 0.5; camPitch = 0.3;
      return;
    }
    if (SHOT === 'taxi') {
      spawnFare();
      var tcar = spawnParkedCar({ x: taxi.fareX + 2, z: taxi.fareZ + 2, angle: 0 }, 0xfdcb6e);
      enterCar(tcar, true); // staged: the fare starts on the first update
      camYaw = Math.PI * 0.75; camPitch = 0.3;
      return;
    }
    if (SHOT === 'hurt') {
      // verification only: low health (damage smoke) + 3-star heat (glow)
      health = 20;
      updateHealthHud();
      setWanted(3);
      player.x = 0; player.z = 20; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'm7') {
      startMission(7);
      player.x = 150; player.z = -27; player.heading = Math.PI / 2;
      camYaw = -Math.PI / 2; camPitch = 0.3;
      return;
    }
    if (SHOT === 'm8') {
      startMission(8);
      // start on the road south of ring 1, driving north toward it — the
      // streetlight pole at the intersection corner is off to the side
      var rcar = spawnParkedCar({ x: -108, z: -88, angle: Math.PI }, 0xfdcb6e);
      enterCar(rcar, true);
      rcar.speed = 14;
      camYaw = Math.PI; camPitch = 0.28;
      return;
    }
    if (SHOT === 'm9') {
      startMission(9);
      var vcar = spawnParkedCar({ x: -75, z: -75, angle: 0 }, 0x0984e3);
      enterCar(vcar, true);
      camYaw = Math.PI * 0.75; camPitch = 0.3;
      return;
    }
    if (SHOT === 'shop') {
      // verification only: stand at Mara's Garage door with a fat wallet
      // and open the shop so the panel is in frame
      cash = 5000;
      player.x = 47; player.z = 27; player.heading = Math.PI / 2;
      camYaw = Math.PI / 2; camPitch = 0.3;
      openShop();
      return;
    }
    if (SHOT === 'heli') {
      // verification only: 4-star heat so the police helicopter spawns
      setWanted(4);
      player.x = 0; player.z = 20; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.35;
      return;
    }
    if (SHOT === 'gas') {
      // verification only: a battered car parked by the gas pumps, ready
      // to be serviced — shows the H prompt and the damage smoke. The car
      // faces the pumps from the south so the canopy stays out of the shot.
      var gcar = spawnParkedCar({ x: 130, z: -62, angle: Math.PI }, 0x0984e3);
      gcar.cond = 20;
      enterCar(gcar, true);
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'night') {
      // verification only: midnight — streetlamps on, sky dark
      dayPhase = 0.75;
      player.x = 0; player.z = -27; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'downtown') {
      // verification only: the new downtown towers on the west edge.
      // The player faces west toward the towers; the camera sits east of
      // them (camYaw = heading + PI) so the towers are in frame.
      player.x = -100; player.z = 54; player.heading = -Math.PI / 2;
      camYaw = Math.PI / 2; camPitch = 0.32;
      return;
    }
    if (SHOT === 'block') {
      // verification only: 3-star heat with the roadblock timer already
      // expired, so a roadblock is set up on the road ahead
      setWanted(3);
      roadblockCooldown = 0;
      var bcar = spawnParkedCar({ x: 0, z: -20, angle: 0 }, 0xfdcb6e);
      enterCar(bcar, true);
      bcar.speed = 18;
      camYaw = Math.PI; camPitch = 0.28;
      return;
    }
    // verification modes for the ported features (not in shots.json):
    // bank stages the player at the bank start, bank2 at the escape point
    // with step 2 already running, prop at PALMS VILLA with a fat wallet,
    // race at the DOWNTOWN SPRINT start, npc with a local right beside the
    // player. The E press itself is driven from the CDP test.
    if (SHOT === 'bank') {
      player.x = 0; player.z = 0; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'bank2') {
      bankJob.active = true; bankJob.step = 2;
      bankJob.marker = featureMarker(-162, 162, 0x38d9ff, 3.5);
      setObjective('BANK ESCAPE  •  $3,000', 'STEP 3/3: Escape the police and reach the safehouse. Lose all wanted stars.');
      setWanted(0);
      player.x = -162; player.z = 162; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'prop') {
      cash = 5000;
      player.x = 190; player.z = 6; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'race') {
      player.x = -108; player.z = -108; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'npc') {
      spawnPed(0, 17);
      player.x = 0; player.z = 20; player.heading = Math.PI;
      camYaw = 0; camPitch = 0.3;
      return;
    }
    if (SHOT === 'race2') {
      // verification only: race already running, player in a car sitting on
      // checkpoint 1 — the loop should advance to checkpoint 2 by itself
      beginRace(0);
      var rcar = spawnParkedCar({ x: -108, z: -108, angle: 0 }, 0xfdcb6e);
      enterCar(rcar, true);
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
    if (SHOT === 'npc2') {
      // verification only: a local already gave the player the pier
      // delivery errand, and the player is standing at the pier
      var np = spawnPed(0, 17);
      np.sideTask = true;
      player.x = 205; player.z = 40; player.heading = 0;
      camYaw = Math.PI; camPitch = 0.3;
      return;
    }
  }

  requestAnimationFrame(frame);
})(typeof window !== 'undefined' ? window : globalThis);
