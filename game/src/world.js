// Procedural Solmar City: a sun-soaked coastal grid town. Everything is built
// from boxes, cylinders and planes with a seeded RNG, so the same seed always
// builds the same city. Exports the collision boxes, road lines, spawn points
// and parked-car spots the rest of the game uses.
(function (global) {
  'use strict';
  var SC = global.SC;
  var U = SC.util;

  var BLOCK = 40, ROAD = 14, PITCH = BLOCK + ROAD, N = 6;
  var HALF = (N * BLOCK + (N + 1) * ROAD) / 2; // 169

  function roadLines() {
    var lines = [];
    for (var k = 0; k <= N; k++) lines.push(-HALF + ROAD / 2 + k * PITCH);
    return lines;
  }

  // A canvas texture with a grid of lit windows, tinted per building.
  function facadeTexture(baseColor, litColor, rng) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = baseColor; g.fillRect(0, 0, 128, 256);
    // faint vertical stripes so the facade reads as modern cladding
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (var s = 0; s < 128; s += 16) g.fillRect(s, 0, 2, 256);
    var cols = 5, rows = 10;
    for (var r = 0; r < rows; r++) {
      for (var col = 0; col < cols; col++) {
        var lit = rng.chance(0.45);
        g.fillStyle = lit ? litColor : 'rgba(20,30,45,0.55)';
        g.fillRect(8 + col * 24, 10 + r * 24, 15, 16);
        // thin dark frame around each window
        g.strokeStyle = 'rgba(0,0,0,0.25)';
        g.strokeRect(8 + col * 24, 10 + r * 24, 15, 16);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildCity(scene, rng) {
    var buildings = [];   // {minX,maxX,minZ,maxZ} collision boxes
    var parkedSpots = []; // {x,z,angle} places a parked car can sit
    var pedSpawns = [];   // sidewalk points for pedestrians
    var roadLinesArr = roadLines();

    // --- lighting: bright sun + warm sky ---
    var hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8a6a, 1.05);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff5e0, 2.4);
    sun.position.set(120, 180, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
    sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);
    scene.fog = new THREE.Fog(0xcfe8f7, 260, 620);
    scene.background = new THREE.Color(0x8ec9ee);
    // sky dome: a big inside-out sphere so the horizon reads as sky, never
    // as void. No fog on it, and it eats no seeded draws.
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7ec8ee, side: THREE.BackSide, fog: false }));
    scene.add(sky);

    // --- ground: city base, sand beach, ocean ---
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 320, HALF * 2 + 320),
      new THREE.MeshLambertMaterial({ color: 0x9aa78a }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(60, -0.05, 0);
    ground.receiveShadow = true;
    scene.add(ground);

    var sand = new THREE.Mesh(
      new THREE.PlaneGeometry(46, HALF * 2 + 40),
      new THREE.MeshLambertMaterial({ color: 0xe8d49a }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(HALF + 23, 0.0, 0);
    sand.receiveShadow = true;
    scene.add(sand);

    var ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(300, HALF * 2 + 200),
      new THREE.MeshLambertMaterial({ color: 0x1e7fa8 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(HALF + 46 + 150, -0.35, 0);
    scene.add(ocean);

    // --- roads + sidewalks ---
    var roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
    var sideMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a4 });
    var dashMat = new THREE.MeshLambertMaterial({ color: 0xf5e9c8 });
    for (var i = 0; i < roadLinesArr.length; i++) {
      var c0 = roadLinesArr[i];
      // vertical road
      var rv = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, HALF * 2), roadMat);
      rv.rotation.x = -Math.PI / 2; rv.position.set(c0, 0.02, 0); rv.receiveShadow = true;
      scene.add(rv);
      // horizontal road
      var rh = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, ROAD), roadMat);
      rh.rotation.x = -Math.PI / 2; rh.position.set(0, 0.02, c0); rh.receiveShadow = true;
      scene.add(rh);
      // dashes along the road centerline
      for (var d = -HALF + 8; d < HALF - 4; d += 12) {
        var dash = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 4), dashMat);
        dash.position.set(c0, 0.05, d);
        scene.add(dash);
        var dash2 = new THREE.Mesh(new THREE.BoxGeometry(4, 0.06, 0.7), dashMat);
        dash2.position.set(d, 0.05, c0);
        scene.add(dash2);
      }
    }
    // sidewalk strips around each block
    for (var bx = 0; bx < N; bx++) {
      for (var bz = 0; bz < N; bz++) {
        var bcx = -HALF + ROAD + BLOCK / 2 + bx * PITCH;
        var bcz = -HALF + ROAD + BLOCK / 2 + bz * PITCH;
        var sw = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 4, BLOCK + 4), sideMat);
        sw.rotation.x = -Math.PI / 2; sw.position.set(bcx, 0.03, bcz); sw.receiveShadow = true;
        scene.add(sw);
      }
    }

    // --- buildings, parks, parking lots ---
    var palette = ['#f2e3c6', '#f6c9a8', '#a8d8d0', '#f2f0e4', '#e8a798', '#c9d6e8', '#f7e8b0', '#d8c2e8'];
    // the eastern column (bx 5) is the boardwalk district: brighter, louder
    // colours, closer to the beach
    var boardwalkPalette = ['#ff9f9f', '#ffd166', '#7fd4ff', '#ff7fb0', '#a8e6a1', '#ffb86b', '#c9a7ff', '#fff3b0'];
    var litPalette = ['#ffd76a', '#9fd8ff', '#fff2b0'];
    var roofPalette = [0x6b5d4f, 0x7a6a58, 0x5d6b7a, 0x8a5a4a, 0x4a5d3a];
    // rooftop clutter: shared AC boxes + water tanks, placed from their own
    // fixed stream so the main RNG (city layout) is untouched
    var roofRng = U.makeRng(777);
    var acG = new THREE.BoxGeometry(1.6, 0.8, 1.6), acM = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
    var tkG = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 8), tkM = new THREE.MeshLambertMaterial({ color: 0x7a6a58 });
    var parkBlocks = 0;
    for (var bx2 = 0; bx2 < N; bx2++) {
      for (var bz2 = 0; bz2 < N; bz2++) {
        var bcx2 = -HALF + ROAD + BLOCK / 2 + bx2 * PITCH;
        var bcz2 = -HALF + ROAD + BLOCK / 2 + bz2 * PITCH;
        var roll = rng.next();
        if (bx2 === 4 && bz2 === 5) {
          // Solmar Stadium: a big open-air bowl on the south-east side, with
          // a green pitch, floodlights and a ticket box. Second landmark.
          var scx = bcx2, scz = bcz2;
          var bowl = new THREE.Mesh(new THREE.CylinderGeometry(17, 18, 11, 20),
            new THREE.MeshLambertMaterial({ color: 0xe8e2d4 }));
          bowl.position.set(scx, 5.5, scz);
          bowl.castShadow = true; bowl.receiveShadow = true;
          scene.add(bowl);
          var pitch = new THREE.Mesh(new THREE.CylinderGeometry(13.5, 13.5, 0.6, 20),
            new THREE.MeshLambertMaterial({ color: 0x3f9e4d }));
          pitch.position.set(scx, 11, scz);
          scene.add(pitch);
          var rim = new THREE.Mesh(new THREE.TorusGeometry(17.2, 0.7, 8, 24),
            new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400 }));
          rim.rotation.x = Math.PI / 2;
          rim.position.set(scx, 11.2, scz);
          scene.add(rim);
          // four floodlight poles around the bowl
          for (var fl = 0; fl < 4; fl++) {
            var fa = fl * Math.PI / 2 + Math.PI / 4;
            var fx = scx + Math.cos(fa) * 20, fz = scz + Math.sin(fa) * 20;
            var fpole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 15, 6),
              new THREE.MeshLambertMaterial({ color: 0x2c313a }));
            fpole.position.set(fx, 7.5, fz);
            scene.add(fpole);
            var flamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 0.4),
              new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xaa8833 }));
            flamp.position.set(fx, 15.2, fz);
            flamp.rotation.y = -fa;
            scene.add(flamp);
          }
          buildings.push({ minX: scx - 18.4, maxX: scx + 18.4, minZ: scz - 18.4, maxZ: scz + 18.4 });
          pedSpawns.push({ x: scx + 20, z: scz });
          continue;
        }
        if (bx2 === 1 && bz2 === 4) {
          // Solmar Tower: the city's landmark — a tall glass spire with a
          // rooftop beacon, visible from anywhere in town.
          var tw = 26, th = 68, td = 26;
          var ttex = facadeTexture('#2e6f8e', '#ffd76a', rng);
          var tower = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td),
            new THREE.MeshPhongMaterial({ map: ttex, shininess: 90, specular: 0x99bbcc }));
          tower.position.set(bcx2, th / 2, bcz2);
          tower.castShadow = true; tower.receiveShadow = true;
          scene.add(tower);
          var band = new THREE.Mesh(new THREE.BoxGeometry(tw + 1, 2, td + 1),
            new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400 }));
          band.position.set(bcx2, th - 6, bcz2);
          scene.add(band);
          var spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 12, 6),
            new THREE.MeshLambertMaterial({ color: 0x2c313a }));
          spire.position.set(bcx2, th + 6, bcz2);
          scene.add(spire);
          var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8),
            new THREE.MeshLambertMaterial({ color: 0xff4444, emissive: 0xcc0000 }));
          beacon.position.set(bcx2, th + 12.5, bcz2);
          scene.add(beacon);
          var troof = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.6, 0.5, td + 0.6),
            new THREE.MeshLambertMaterial({ color: 0x2c313a }));
          troof.position.set(bcx2, th + 0.25, bcz2);
          scene.add(troof);
          buildings.push({ minX: bcx2 - tw / 2 - 0.4, maxX: bcx2 + tw / 2 + 0.4, minZ: bcz2 - td / 2 - 0.4, maxZ: bcz2 + td / 2 + 0.4 });
          pedSpawns.push({ x: bcx2 + 18, z: bcz2 });
          continue;
        }
        if (roll < 0.14 && parkBlocks < 5) {
          // park: grass + palms + a bench + a gold statue on a plinth
          parkBlocks++;
          var grass = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 2, BLOCK - 2),
            new THREE.MeshLambertMaterial({ color: 0x5da24a }));
          grass.rotation.x = -Math.PI / 2; grass.position.set(bcx2, 0.06, bcz2);
          grass.receiveShadow = true;
          scene.add(grass);
          var nPalms = rng.int(3, 5);
          for (var p = 0; p < nPalms; p++) {
            addPalm(scene, bcx2 + rng.range(-14, 14), bcz2 + rng.range(-14, 14), rng);
          }
          // statue: stone plinth + a golden figure, tucked in the far
          // corner of the park (never the block center — a mission marker
          // can sit there) so it never eats a seeded draw or blocks a job
          var plinth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.4),
            new THREE.MeshLambertMaterial({ color: 0x9a938a }));
          plinth.position.set(bcx2 - 10, 0.6, bcz2 + 10);
          plinth.castShadow = true;
          scene.add(plinth);
          var figure = new THREE.Mesh(new THREE.OctahedronGeometry(1.1),
            new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400 }));
          figure.position.set(bcx2 - 10, 2.4, bcz2 + 10);
          figure.castShadow = true;
          scene.add(figure);
          // a wooden bench off to one side, fixed offset (no seeded draw)
          addBench(scene, bcx2 + 10, bcz2 - 10);
          buildings.push({ minX: bcx2 - 11.2, maxX: bcx2 - 8.8, minZ: bcz2 + 8.8, maxZ: bcz2 + 11.2 });
          pedSpawns.push({ x: bcx2, z: bcz2 });
          continue;
        }
        if (roll < 0.24) {
          // parking lot with parked cars
          var lot = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 2, BLOCK - 2),
            new THREE.MeshLambertMaterial({ color: 0x55585e }));
          lot.rotation.x = -Math.PI / 2; lot.position.set(bcx2, 0.06, bcz2);
          lot.receiveShadow = true;
          scene.add(lot);
          var nCars = rng.int(3, 5);
          for (var c = 0; c < nCars; c++) {
            parkedSpots.push({
              x: bcx2 + rng.range(-13, 13),
              z: bcz2 + rng.range(-13, 13),
              angle: rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]),
            });
          }
          continue;
        }
        // buildings: 1 big or 2 small
        var nB = rng.chance(0.5) ? 1 : 2;
        for (var b = 0; b < nB; b++) {
          var w = nB === 1 ? rng.range(24, 32) : rng.range(13, 18);
          var d = nB === 1 ? rng.range(24, 32) : rng.range(13, 18);
          var h = rng.range(10, 42);
          var ox = nB === 1 ? 0 : (b === 0 ? -9 : 9);
          var oz = nB === 1 ? 0 : (b === 0 ? -9 : 9);
          var cx = bcx2 + ox, cz = bcz2 + oz;
          // boardwalk district (eastern column) gets the loud palette
          var color = rng.pick(bx2 === 5 ? boardwalkPalette : palette);
          var tex = facadeTexture(color, rng.pick(litPalette), rng);
          var mat = new THREE.MeshLambertMaterial({ map: tex });
          var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          mesh.position.set(cx, h / 2, cz);
          mesh.castShadow = true; mesh.receiveShadow = true;
          scene.add(mesh);
          // flat roof cap, tinted so the skyline is not one brown
          var roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
            new THREE.MeshLambertMaterial({ color: rng.pick(roofPalette) }));
          roof.position.set(cx, h + 0.25, cz);
          scene.add(roof);
          // rooftop clutter: an AC box on every roof, a water tank on tall ones
          var ac = new THREE.Mesh(acG, acM);
          ac.position.set(cx + roofRng.range(-w / 4, w / 4), h + 0.9, cz + roofRng.range(-d / 4, d / 4));
          scene.add(ac);
          if (h > 22) {
            var tk = new THREE.Mesh(tkG, tkM);
            tk.position.set(cx - w / 4, h + 1.6, cz - d / 4);
            scene.add(tk);
          }
          // dark ground-floor plinth so the building sits on the sidewalk
          var base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 1.4, d + 0.3),
            new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
          base.position.set(cx, 0.7, cz);
          scene.add(base);
          buildings.push({ minX: cx - w / 2 - 0.4, maxX: cx + w / 2 + 0.4, minZ: cz - d / 2 - 0.4, maxZ: cz + d / 2 + 0.4 });
        }
        // a couple of parked cars on the block edge
        if (rng.chance(0.6)) {
          parkedSpots.push({ x: bcx2 + 18, z: bcz2 + rng.range(-10, 10), angle: Math.PI / 2 });
        }
      }
    }

    // --- downtown district, gas station and street vendors ---
    // A third district feel, built AFTER the block loop so the main RNG
    // stream is untouched: the two west-edge blocks (-135,27) and (-135,81)
    // are a parking lot or a park in every seed, so towers there never
    // clash with the loop's buildings. Each tower is still collision-
    // checked before it is built (seed-proof), and parked-car spots inside
    // a tower footprint or under the gas canopy are dropped so no car
    // spawns inside a wall. Tower heights and glass tints come from a
    // separate fixed stream, so the district never moves between runs.
    var dtRng = U.makeRng(20261118);
    var towerBoxes = [];
    var downtownBlocks = [[-135, 27], [-135, 81]];
    for (var db = 0; db < downtownBlocks.length; db++) {
      var dcx = downtownBlocks[db][0], dcz = downtownBlocks[db][1];
      var towerSpots = [[12, -12], [12, 12]];
      for (var ts = 0; ts < towerSpots.length; ts++) {
        var tx = dcx + towerSpots[ts][0], tz = dcz + towerSpots[ts][1];
        // footprint check: center + 4 corners must be clear of buildings
        var blocked = false;
        var probe = [[0, 0], [-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5], [7.5, 7.5]];
        for (var pr = 0; pr < probe.length; pr++) {
          if (hitsBuilding({ buildings: buildings }, tx + probe[pr][0], tz + probe[pr][1], 0)) { blocked = true; break; }
        }
        if (blocked) continue;
        var th = dtRng.range(45, 70);
        var glass = dtRng.pick(['#3a7ca8', '#2e6f8e', '#4a8ab0', '#5b7fa6']);
        var gtex = facadeTexture(glass, '#ffe9a0', dtRng);
        var tower = new THREE.Mesh(new THREE.BoxGeometry(15, th, 15),
          new THREE.MeshPhongMaterial({ map: gtex, shininess: 90, specular: 0x99bbcc }));
        tower.position.set(tx, th / 2, tz);
        tower.castShadow = true; tower.receiveShadow = true;
        scene.add(tower);
        var tcap = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.6, 15.6),
          new THREE.MeshLambertMaterial({ color: 0x2c313a }));
        tcap.position.set(tx, th + 0.3, tz);
        scene.add(tcap);
        if (ts === 0) {
          // a spire on the taller tower of each pair, like the Tower's
          var spire2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.8, 8, 6),
            new THREE.MeshLambertMaterial({ color: 0x2c313a }));
          spire2.position.set(tx, th + 4.6, tz);
          scene.add(spire2);
          var tip = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6),
            new THREE.MeshLambertMaterial({ color: 0xff4444, emissive: 0xcc0000 }));
          tip.position.set(tx, th + 8.8, tz);
          scene.add(tip);
        }
        var tb = { minX: tx - 7.5, maxX: tx + 7.5, minZ: tz - 7.5, maxZ: tz + 7.5 };
        buildings.push(tb);
        towerBoxes.push(tb);
        pedSpawns.push({ x: tx - 11, z: tz + 11 });
      }
      // a couple of palms between the towers, fixed offsets (no draws)
      addPalm(scene, dcx - 8, dcz, dtRng);
      addPalm(scene, dcx - 8, dcz + 6, dtRng);
    }
    // Gas station on the (135,-81) lot — a parking lot in every seed.
    // Canopy on four poles, two pumps just south of the canopy (so a car
    // parked at a pump sits clear of the roof and the camera can see it),
    // a tall FUEL sign. The pumps are where the car-service interaction
    // happens (see game.js).
    var gasPumps = [{ x: 130, z: -68 }, { x: 140, z: -68 }];
    var canopy = new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 14),
      new THREE.MeshLambertMaterial({ color: 0xd63031 }));
    canopy.position.set(135, 5.4, -78);
    canopy.castShadow = true;
    scene.add(canopy);
    var fascia = new THREE.Mesh(new THREE.BoxGeometry(22.4, 0.5, 14.4),
      new THREE.MeshLambertMaterial({ color: 0xffffff }));
    fascia.position.set(135, 5.0, -78);
    scene.add(fascia);
    var poleMat2 = new THREE.MeshLambertMaterial({ color: 0x2c313a });
    var poleSpots = [[-9, -5], [9, -5], [-9, 5], [9, 5]];
    for (var gp = 0; gp < poleSpots.length; gp++) {
      var gpx = 135 + poleSpots[gp][0], gpz = -78 + poleSpots[gp][1];
      var gpole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 5.2, 6), poleMat2);
      gpole.position.set(gpx, 2.6, gpz);
      gpole.castShadow = true;
      scene.add(gpole);
      buildings.push({ minX: gpx - 0.5, maxX: gpx + 0.5, minZ: gpz - 0.5, maxZ: gpz + 0.5 });
    }
    for (var pu = 0; pu < gasPumps.length; pu++) {
      var pump = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xd63031 }));
      pump.position.set(gasPumps[pu].x, 0.7, gasPumps[pu].z);
      pump.castShadow = true;
      scene.add(pump);
      var pumpTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 0.8),
        new THREE.MeshLambertMaterial({ color: 0xffffff }));
      pumpTop.position.set(gasPumps[pu].x, 1.5, gasPumps[pu].z);
      scene.add(pumpTop);
      buildings.push({ minX: gasPumps[pu].x - 0.7, maxX: gasPumps[pu].x + 0.7, minZ: gasPumps[pu].z - 0.7, maxZ: gasPumps[pu].z + 0.7 });
    }
    // tall FUEL sign at the lot's north-east corner, with a painted canvas
    var signCanvas = document.createElement('canvas');
    signCanvas.width = 128; signCanvas.height = 64;
    var sg = signCanvas.getContext('2d');
    sg.fillStyle = '#1e3a5f'; sg.fillRect(0, 0, 128, 64);
    sg.fillStyle = '#ffd23f'; sg.font = 'bold 34px Trebuchet MS, sans-serif';
    sg.textAlign = 'center'; sg.textBaseline = 'middle';
    sg.fillText('FUEL', 64, 34);
    var signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    var signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 8, 6), poleMat2);
    signPole.position.set(152, 4, -95);
    scene.add(signPole);
    var signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 5),
      new THREE.MeshLambertMaterial({ map: signTex }));
    signBoard.position.set(152, 8.6, -95);
    signBoard.castShadow = true;
    scene.add(signBoard);
    buildings.push({ minX: 151.5, maxX: 152.5, minZ: -95.5, maxZ: -94.5 });
    // Street vendor stalls: two on the boardwalk, one in the downtown
    // plaza between the towers. Counter + sloped awning + goods, with
    // pedestrians gathering around (pedSpawns so the AI wanders over).
    var stalls = [[177, -40, 0xff7f50], [177, 60, 0x7fd4ff], [-119, 27, 0xffd166]];
    for (var st = 0; st < stalls.length; st++) {
      var sx = stalls[st][0], sz = stalls[st][1], scol = stalls[st][2];
      var counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1.3),
        new THREE.MeshLambertMaterial({ color: 0x8b6a45 }));
      counter.position.set(sx, 0.5, sz);
      counter.castShadow = true;
      scene.add(counter);
      var goods = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 1.0),
        new THREE.MeshLambertMaterial({ color: scol }));
      goods.position.set(sx, 1.25, sz);
      scene.add(goods);
      var awn = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0),
        new THREE.MeshLambertMaterial({ color: scol, side: THREE.DoubleSide }));
      awn.position.set(sx, 2.4, sz);
      awn.rotation.x = -Math.PI / 2 + 0.35;
      awn.castShadow = true;
      scene.add(awn);
      for (var ap = 0; ap < 2; ap++) {
        var apost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5), poleMat2);
        apost.position.set(sx + (ap === 0 ? -1.4 : 1.4), 1.1, sz - 0.7);
        scene.add(apost);
      }
      buildings.push({ minX: sx - 1.2, maxX: sx + 1.2, minZ: sz - 0.7, maxZ: sz + 0.7 });
      pedSpawns.push({ x: sx + 2.5, z: sz + 1.5 });
      pedSpawns.push({ x: sx - 2.5, z: sz - 1.5 });
    }
    // no parked cars inside a tower footprint or under the gas canopy
    parkedSpots = parkedSpots.filter(function (p) {
      for (var tb2 = 0; tb2 < towerBoxes.length; tb2++) {
        var b = towerBoxes[tb2];
        if (p.x > b.minX - 2 && p.x < b.maxX + 2 && p.z > b.minZ - 2 && p.z < b.maxZ + 2) return false;
      }
      if (p.x > 123 && p.x < 147 && p.z > -86 && p.z < -66) return false; // gas canopy + pumps
      return true;
    });

    // --- boardwalk: a plank strip along the sand + extra palms on the
    // eastern edge, so the beachfront reads as its own district ---
    var boardwalk = new THREE.Mesh(new THREE.BoxGeometry(7, 0.35, HALF * 2),
      new THREE.MeshLambertMaterial({ color: 0xb08d5f }));
    boardwalk.position.set(HALF + 8, 0.15, 0);
    boardwalk.receiveShadow = true;
    scene.add(boardwalk);
    for (var bw = 0; bw < 12; bw++) {
      addPalm(scene, HALF + 4 + rng.range(-2, 2), -HALF + 16 + bw * 28 + rng.range(-4, 4), rng);
    }

    // --- streetlights at intersections ---
    var poleMat = new THREE.MeshLambertMaterial({ color: 0x2c313a });
    var lampMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xaa8833 });
    for (var ix = 0; ix < roadLinesArr.length; ix++) {
      for (var iz = 0; iz < roadLinesArr.length; iz++) {
        if ((ix + iz) % 2 !== 0) continue;
        var lx = roadLinesArr[ix] + ROAD / 2 + 1.2, lz = roadLinesArr[iz] + ROAD / 2 + 1.2;
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), poleMat);
        pole.position.set(lx, 3.5, lz); pole.castShadow = true;
        scene.add(pole);
        var arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), poleMat);
        arm.position.set(lx - 1, 6.9, lz);
        scene.add(arm);
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lampMat);
        lamp.position.set(lx - 2, 6.8, lz);
        scene.add(lamp);
      }
    }

    // --- traffic lights at every fourth intersection (the corners without
    // street lamps): pole + head + three lamps, one lit, alternating by block
    var tlPoleG = new THREE.CylinderGeometry(0.1, 0.14, 6.5, 6);
    var tlHeadG = new THREE.BoxGeometry(0.42, 1.15, 0.42);
    var tlLampG = new THREE.SphereGeometry(0.14, 6, 5);
    var tlCols = [0xff3333, 0xffaa00, 0x33cc33], tlLit = [0xcc0000, 0xcc7700, 0x00aa00];
    for (var tx = 0; tx < roadLinesArr.length; tx++) {
      for (var tz = 0; tz < roadLinesArr.length; tz++) {
        if ((tx + tz) % 4 !== 1) continue;
        var px = roadLinesArr[tx] - ROAD / 2 - 1, pz = roadLinesArr[tz] - ROAD / 2 - 1;
        var tp = new THREE.Mesh(tlPoleG, poleMat); tp.position.set(px, 3.25, pz); scene.add(tp);
        var th2 = new THREE.Mesh(tlHeadG, poleMat); th2.position.set(px, 6.7, pz); scene.add(th2);
        var lit = (tx + tz) % 8 < 4 ? 0 : 2;
        for (var tl = 0; tl < 3; tl++) {
          var lm = new THREE.Mesh(tlLampG, new THREE.MeshLambertMaterial({ color: tlCols[tl], emissive: tl === lit ? tlLit[tl] : 0x111111 }));
          lm.position.set(px, 7.05 - tl * 0.33, pz + 0.23); scene.add(lm);
        }
      }
    }

    // --- beach palms + a pier ---
    for (var bp = 0; bp < 10; bp++) {
      addPalm(scene, HALF + 12 + rng.range(-6, 6), -HALF + 20 + bp * 34 + rng.range(-6, 6), rng);
    }    var pier = new THREE.Mesh(new THREE.BoxGeometry(70, 1, 8),
      new THREE.MeshLambertMaterial({ color: 0x8a6f4d }));
    pier.position.set(HALF + 46 + 30, 0.6, 40);
    pier.castShadow = true;
    scene.add(pier);
    for (var pp = 0; pp < 6; pp++) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3, 6),
        new THREE.MeshLambertMaterial({ color: 0x5d4a33 }));
      post.position.set(HALF + 46 + 6 + pp * 12, -0.5, 36.5);
      scene.add(post);
      var post2 = post.clone(); post2.position.z = 43.5; scene.add(post2);
    }

    // --- a few parked cars along roads too ---
    for (var rp = 0; rp < 14; rp++) {
      var rl = rng.pick(roadLinesArr);
      var along = rng.range(-HALF + 20, HALF - 20);
      var horiz = rng.chance(0.5);
      parkedSpots.push({
        x: horiz ? along : rl + ROAD / 2 - 3.2,
        z: horiz ? rl + ROAD / 2 - 3.2 : along,
        angle: horiz ? 0 : Math.PI / 2,
      });
    }

    // sidewalk spawn points for pedestrians (block corners)
    for (var sx = 0; sx < N; sx++) {
      for (var sz = 0; sz < N; sz++) {
        pedSpawns.push({
          x: -HALF + ROAD + BLOCK / 2 + sx * PITCH + rng.range(-16, 16),
          z: -HALF + ROAD + BLOCK / 2 + sz * PITCH + rng.range(-16, 16),
        });
      }
    }

    return {
      buildings: buildings,
      parkedSpots: parkedSpots,
      pedSpawns: pedSpawns,
      roadLines: roadLinesArr,
      half: HALF,
      block: BLOCK,
      road: ROAD,
      pitch: PITCH,
      hemi: hemi, // day/night cycle dims these
      skyMat: sky.material,
      lampMat: lampMat,
      gasPumps: gasPumps, // car-service spots (press H in a car near one)
      // Safehouse sites on the sand east of the boardwalk, clear of every
      // building collision box.
      propertySpots: [{ x: 190, z: -120 }, { x: 190, z: 0 }, { x: 190, z: 120 }],
    };
  }

  // A park bench: wooden seat + back on two metal legs.
  function addBench(scene, x, z) {
    var wood = new THREE.MeshLambertMaterial({ color: 0x8b6a45 });
    var metal = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
    var seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), wood);
    seat.position.set(x, 0.45, z);
    seat.castShadow = true;
    scene.add(seat);
    var back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.06), wood);
    back.position.set(x, 0.75, z - 0.22);
    scene.add(back);
    var leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), metal);
    leg1.position.set(x - 0.7, 0.22, z);
    scene.add(leg1);
    var leg2 = leg1.clone(); leg2.position.x = x + 0.7; scene.add(leg2);
  }

  function addPalm(scene, x, z, rng) {
    var trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
    var leafMat = new THREE.MeshLambertMaterial({ color: 0x2e8b47 });
    var h = rng.range(4.5, 6.5);
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, h, 6), trunkMat);
    trunk.position.set(x, h / 2, z);
    trunk.rotation.z = rng.range(-0.08, 0.08);
    trunk.castShadow = true;
    scene.add(trunk);
    for (var i = 0; i < 5; i++) {
      var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 4), leafMat);
      var a = (i / 5) * Math.PI * 2;
      leaf.position.set(x + Math.cos(a) * 1.1, h + 0.3, z + Math.sin(a) * 1.1);
      leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      scene.add(leaf);
    }
    var nut = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0x6b4a22 }));
    nut.position.set(x, h + 0.2, z);
    scene.add(nut);
  }

  // Point-vs-building collision: is (x,z) inside any building box (with margin)?
  function hitsBuilding(city, x, z, margin) {
    var m = margin || 0;
    for (var i = 0; i < city.buildings.length; i++) {
      var b = city.buildings[i];
      if (x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m) return b;
    }
    return null;
  }

  // Push a circle (x,z,r) out of buildings; returns corrected {x,z} and whether it hit.
  function resolveCollision(city, x, z, r) {
    var hit = false;
    for (var i = 0; i < city.buildings.length; i++) {
      var b = city.buildings[i];
      var cx = U.clamp(x, b.minX, b.maxX);
      var cz = U.clamp(z, b.minZ, b.maxZ);
      var dx = x - cx, dz = z - cz;
      var d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 < 0.0001) {
          // center inside the box: push out along the smallest penetration axis
          var pl = x - b.minX, pr = b.maxX - x, pt = z - b.minZ, pb = b.maxZ - z;
          var min = Math.min(pl, pr, pt, pb);
          if (min === pl) x = b.minX - r;
          else if (min === pr) x = b.maxX + r;
          else if (min === pt) z = b.minZ - r;
          else z = b.maxZ + r;
        } else {
          var d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        }
      }
    }
    // world bounds: beach on the east, city edge elsewhere
    var lim = city.half + 42;
    if (x < -city.half - 6) x = -city.half - 6;
    if (x > lim) x = lim;
    if (z < -city.half - 6) z = -city.half - 6;
    if (z > city.half + 6) z = city.half + 6;
    return { x: x, z: z, hit: hit };
  }

  SC.world = {
    buildCity: buildCity, hitsBuilding: hitsBuilding, resolveCollision: resolveCollision,
    BLOCK: BLOCK, ROAD: ROAD, PITCH: PITCH, HALF: HALF,
  };
})(typeof window !== 'undefined' ? window : globalThis);
