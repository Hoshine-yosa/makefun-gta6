(function (global) {
  'use strict';
  var SC = global.SC, U = SC.util;
  var BLOCK = 40, ROAD = 14, PITCH = BLOCK + ROAD, N = 6;
  var HALF = (N * BLOCK + (N + 1) * ROAD) / 2;
  function roadLines() {
    var lines = [];
    for (var k = 0; k <= N; k++) lines.push(-HALF + ROAD / 2 + k * PITCH);
    return lines;
  }
  function lm(c) { return new THREE.MeshLambertMaterial({ color: c }); }
  function lme(c, e) { return new THREE.MeshLambertMaterial({ color: c, emissive: e }); }
  function B(s, w, h, d, m, x, y, z, f) {
    var q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    q.position.set(x, y, z);
    if (f & 1) q.castShadow = true;
    if (f & 2) q.receiveShadow = true;
    s.add(q); return q;
  }
  function P(s, w, d, m, x, y, z, f) {
    var q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    q.rotation.x = -Math.PI / 2; q.position.set(x, y, z);
    if (f & 1) q.castShadow = true;
    if (f & 2) q.receiveShadow = true;
    s.add(q); return q;
  }
  function C(s, rt, rb, h, sg, m, x, y, z, f) {
    var q = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, sg), m);
    q.position.set(x, y, z);
    if (f & 1) q.castShadow = true;
    if (f & 2) q.receiveShadow = true;
    s.add(q); return q;
  }
  function S(s, r, w, h, m, x, y, z, f) {
    var q = new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
    q.position.set(x, y, z);
    if (f & 1) q.castShadow = true;
    if (f & 2) q.receiveShadow = true;
    s.add(q); return q;
  }
  function facadeTexture(baseColor, litColor, rng) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = baseColor; g.fillRect(0, 0, 128, 256);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (var s = 0; s < 128; s += 16) g.fillRect(s, 0, 2, 256);
    for (var r = 0; r < 10; r++) for (var col = 0; col < 5; col++) {
      g.fillStyle = rng.chance(0.45) ? litColor : 'rgba(20,30,45,0.55)';
      g.fillRect(8 + col * 24, 10 + r * 24, 15, 16);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.strokeRect(8 + col * 24, 10 + r * 24, 15, 16);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function buildCity(scene, rng) {
    var buildings = [], parkedSpots = [], pedSpawns = [], roadLinesArr = roadLines();
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
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7ec8ee, side: THREE.BackSide, fog: false }));
    scene.add(sky);
    var sunDisc = new THREE.Mesh(new THREE.CircleGeometry(30, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, fog: false }));
    scene.add(sunDisc);
    var clouds = [];
    var cloudCols = [0xffffff, 0xf2f6fa, 0xe8eef4];
    for (var cl = 0; cl < 6; cl++) {
      var cm = new THREE.Mesh(new THREE.BoxGeometry(46 + (cl % 3) * 14, 7, 22),
        new THREE.MeshLambertMaterial({ color: cloudCols[cl % 3], transparent: true, opacity: 0.85 }));
      cm.position.set(-260 + cl * 105, 130 + (cl % 3) * 22, -220 + (cl % 2) * 320);
      scene.add(cm);
      clouds.push({ mesh: cm, baseX: cm.position.x, seed: cl * 1.7 });
    }
    P(scene, HALF * 2 + 320, HALF * 2 + 320, lm(0x9aa78a), 60, -0.05, 0, 2);
    P(scene, 46, HALF * 2 + 40, lm(0xe8d49a), HALF + 23, 0.0, 0, 2);
    var oceanMat = lm(0x1e7fa8);
    P(scene, 300, HALF * 2 + 200, oceanMat, HALF + 46 + 150, -0.35, 0, 0);
    var roadMat = lm(0x3a3f46), sideMat = lm(0xb9b3a4), dashMat = lm(0xf5e9c8);
    for (var i = 0; i < roadLinesArr.length; i++) {
      var c0 = roadLinesArr[i];
      P(scene, ROAD, HALF * 2, roadMat, c0, 0.02, 0, 2);
      P(scene, HALF * 2, ROAD, roadMat, 0, 0.02, c0, 2);
      for (var d = -HALF + 8; d < HALF - 4; d += 12) {
        B(scene, 0.7, 0.06, 4, dashMat, c0, 0.05, d, 0);
        B(scene, 4, 0.06, 0.7, dashMat, d, 0.05, c0, 0);
      }
    }
    for (var bx = 0; bx < N; bx++) for (var bz = 0; bz < N; bz++) {
      P(scene, BLOCK + 4, BLOCK + 4, sideMat,
        -HALF + ROAD + BLOCK / 2 + bx * PITCH, 0.03, -HALF + ROAD + BLOCK / 2 + bz * PITCH, 2);
    }
    var palette = ['#f2e3c6', '#f6c9a8', '#a8d8d0', '#f2f0e4', '#e8a798', '#c9d6e8', '#f7e8b0', '#d8c2e8'];
    var boardwalkPalette = ['#ff9f9f', '#ffd166', '#7fd4ff', '#ff7fb0', '#a8e6a1', '#ffb86b', '#c9a7ff', '#fff3b0'];
    var litPalette = ['#ffd76a', '#9fd8ff', '#fff2b0'];
    var roofPalette = [0x6b5d4f, 0x7a6a58, 0x5d6b7a, 0x8a5a4a, 0x4a5d3a];
    var roofRng = U.makeRng(777);
    var acG = new THREE.BoxGeometry(1.6, 0.8, 1.6), acM = lm(0x8a8f96);
    var tkG = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 8), tkM = lm(0x7a6a58);
    var parkBlocks = 0;
    for (var bx2 = 0; bx2 < N; bx2++) for (var bz2 = 0; bz2 < N; bz2++) {
      var bcx2 = -HALF + ROAD + BLOCK / 2 + bx2 * PITCH;
      var bcz2 = -HALF + ROAD + BLOCK / 2 + bz2 * PITCH;
      var roll = rng.next();
      if (bx2 === 4 && bz2 === 5) {
        var scx = bcx2, scz = bcz2;
        C(scene, 17, 18, 11, 20, lm(0xe8e2d4), scx, 5.5, scz, 3);
        C(scene, 13.5, 13.5, 0.6, 20, lm(0x3f9e4d), scx, 11, scz, 0);
        var rim = new THREE.Mesh(new THREE.TorusGeometry(17.2, 0.7, 8, 24), lme(0xffd23f, 0x664400));
        rim.rotation.x = Math.PI / 2; rim.position.set(scx, 11.2, scz); scene.add(rim);
        for (var fl = 0; fl < 4; fl++) {
          var fa = fl * Math.PI / 2 + Math.PI / 4;
          var fx = scx + Math.cos(fa) * 20, fz = scz + Math.sin(fa) * 20;
          C(scene, 0.2, 0.25, 15, 6, lm(0x2c313a), fx, 7.5, fz, 0);
          var flamp = B(scene, 2.4, 1, 0.4, lme(0xfff2b0, 0xaa8833), fx, 15.2, fz, 0);
          flamp.rotation.y = -fa;
        }
        buildings.push({ minX: scx - 18.4, maxX: scx + 18.4, minZ: scz - 18.4, maxZ: scz + 18.4 });
        pedSpawns.push({ x: scx + 20, z: scz });
        continue;
      }
      if (bx2 === 1 && bz2 === 4) {
        var tw = 26, th = 68, td = 26;
        var ttex = facadeTexture('#2e6f8e', '#ffd76a', rng);
        var tower = B(scene, tw, th, td,
          new THREE.MeshPhongMaterial({ map: ttex, shininess: 90, specular: 0x99bbcc }), bcx2, th / 2, bcz2, 3);
        B(scene, tw + 1, 2, td + 1, lme(0xffd23f, 0x664400), bcx2, th - 6, bcz2, 0);
        C(scene, 0.4, 1.2, 12, 6, lm(0x2c313a), bcx2, th + 6, bcz2, 0);
        S(scene, 0.9, 10, 8, lme(0xff4444, 0xcc0000), bcx2, th + 12.5, bcz2, 0);
        B(scene, tw + 0.6, 0.5, td + 0.6, lm(0x2c313a), bcx2, th + 0.25, bcz2, 0);
        buildings.push({ minX: bcx2 - tw / 2 - 0.4, maxX: bcx2 + tw / 2 + 0.4, minZ: bcz2 - td / 2 - 0.4, maxZ: bcz2 + td / 2 + 0.4 });
        pedSpawns.push({ x: bcx2 + 18, z: bcz2 });
        continue;
      }
      if (roll < 0.14 && parkBlocks < 5) {
        parkBlocks++;
        P(scene, BLOCK - 2, BLOCK - 2, lm(0x5da24a), bcx2, 0.06, bcz2, 2);
        var nPalms = rng.int(3, 5);
        for (var p = 0; p < nPalms; p++) addPalm(scene, bcx2 + rng.range(-14, 14), bcz2 + rng.range(-14, 14), rng);
        B(scene, 2.4, 1.2, 2.4, lm(0x9a938a), bcx2 - 10, 0.6, bcz2 + 10, 1);
        var figure = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), lme(0xffd23f, 0x664400));
        figure.position.set(bcx2 - 10, 2.4, bcz2 + 10); figure.castShadow = true; scene.add(figure);
        addBench(scene, bcx2 + 10, bcz2 - 10);
        buildings.push({ minX: bcx2 - 11.2, maxX: bcx2 - 8.8, minZ: bcz2 + 8.8, maxZ: bcz2 + 11.2 });
        pedSpawns.push({ x: bcx2, z: bcz2 });
        continue;
      }
      if (roll < 0.24) {
        P(scene, BLOCK - 2, BLOCK - 2, lm(0x55585e), bcx2, 0.06, bcz2, 2);
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
      var nB = rng.chance(0.5) ? 1 : 2;
      for (var b = 0; b < nB; b++) {
        var w = nB === 1 ? rng.range(24, 32) : rng.range(13, 18);
        var d2 = nB === 1 ? rng.range(24, 32) : rng.range(13, 18);
        var h = rng.range(10, 42);
        var ox = nB === 1 ? 0 : (b === 0 ? -9 : 9);
        var oz = nB === 1 ? 0 : (b === 0 ? -9 : 9);
        var cx = bcx2 + ox, cz = bcz2 + oz;
        var color = rng.pick(bx2 === 5 ? boardwalkPalette : palette);
        var tex = facadeTexture(color, rng.pick(litPalette), rng);
        var mesh = B(scene, w, h, d2, new THREE.MeshLambertMaterial({ map: tex }), cx, h / 2, cz, 3);
        B(scene, w + 0.6, 0.5, d2 + 0.6, lm(rng.pick(roofPalette)), cx, h + 0.25, cz, 0);
        var ac = new THREE.Mesh(acG, acM);
        ac.position.set(cx + roofRng.range(-w / 4, w / 4), h + 0.9, cz + roofRng.range(-d2 / 4, d2 / 4));
        scene.add(ac);
        if (h > 22) {
          var tk = new THREE.Mesh(tkG, tkM);
          tk.position.set(cx - w / 4, h + 1.6, cz - d2 / 4);
          scene.add(tk);
        }
        B(scene, w + 0.3, 1.4, d2 + 0.3, lm(0x3a3f46), cx, 0.7, cz, 0);
        if (bx2 === 5) {
          B(scene, w + 0.4, 0.9, d2 + 0.4, lm(boardwalkPalette[(bx2 + bz2 + b) % 8]), cx, 3.4, cz, 0);
        }
        buildings.push({ minX: cx - w / 2 - 0.4, maxX: cx + w / 2 + 0.4, minZ: cz - d2 / 2 - 0.4, maxZ: cz + d2 / 2 + 0.4 });
      }
      if (rng.chance(0.6)) {
        parkedSpots.push({ x: bcx2 + 18, z: bcz2 + rng.range(-10, 10), angle: Math.PI / 2 });
      }
    }
    var dtRng = U.makeRng(20261118);
    var towerBoxes = [];
    var downtownBlocks = [[-135, 27], [-135, 81]];
    for (var db = 0; db < downtownBlocks.length; db++) {
      var dcx = downtownBlocks[db][0], dcz = downtownBlocks[db][1];
      var towerSpots = [[12, -12], [12, 12]];
      for (var ts = 0; ts < towerSpots.length; ts++) {
        var tx = dcx + towerSpots[ts][0], tz = dcz + towerSpots[ts][1];
        var blocked = false;
        var probe = [[0, 0], [-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5], [7.5, 7.5]];
        for (var pr = 0; pr < probe.length; pr++) {
          if (hitsBuilding({ buildings: buildings }, tx + probe[pr][0], tz + probe[pr][1], 0)) { blocked = true; break; }
        }
        if (blocked) continue;
        var th2 = dtRng.range(45, 70);
        var glass = dtRng.pick(['#3a7ca8', '#2e6f8e', '#4a8ab0', '#5b7fa6']);
        var gtex = facadeTexture(glass, '#ffe9a0', dtRng);
        B(scene, 15, th2, 15,
          new THREE.MeshPhongMaterial({ map: gtex, shininess: 90, specular: 0x99bbcc }), tx, th2 / 2, tz, 3);
        B(scene, 15.6, 0.6, 15.6, lm(0x2c313a), tx, th2 + 0.3, tz, 0);
        if (ts === 0) {
          C(scene, 0.3, 0.8, 8, 6, lm(0x2c313a), tx, th2 + 4.6, tz, 0);
          S(scene, 0.6, 8, 6, lme(0xff4444, 0xcc0000), tx, th2 + 8.8, tz, 0);
        }
        var tb = { minX: tx - 7.5, maxX: tx + 7.5, minZ: tz - 7.5, maxZ: tz + 7.5 };
        buildings.push(tb);
        towerBoxes.push(tb);
        pedSpawns.push({ x: tx - 11, z: tz + 11 });
      }
      addPalm(scene, dcx - 8, dcz, dtRng);
      addPalm(scene, dcx - 8, dcz + 6, dtRng);
    }
    var gasPumps = [{ x: 130, z: -68 }, { x: 140, z: -68 }];
    B(scene, 22, 0.8, 14, lm(0xd63031), 135, 5.4, -78, 1);
    B(scene, 22.4, 0.5, 14.4, lm(0xffffff), 135, 5.0, -78, 0);
    var poleMat2 = lm(0x2c313a);
    var poleSpots = [[-9, -5], [9, -5], [-9, 5], [9, 5]];
    for (var gp = 0; gp < poleSpots.length; gp++) {
      var gpx = 135 + poleSpots[gp][0], gpz = -78 + poleSpots[gp][1];
      C(scene, 0.25, 0.3, 5.2, 6, poleMat2, gpx, 2.6, gpz, 1);
      buildings.push({ minX: gpx - 0.5, maxX: gpx + 0.5, minZ: gpz - 0.5, maxZ: gpz + 0.5 });
    }
    for (var pu = 0; pu < gasPumps.length; pu++) {
      B(scene, 0.9, 1.4, 0.7, lm(0xd63031), gasPumps[pu].x, 0.7, gasPumps[pu].z, 1);
      B(scene, 1.0, 0.25, 0.8, lm(0xffffff), gasPumps[pu].x, 1.5, gasPumps[pu].z, 0);
      buildings.push({ minX: gasPumps[pu].x - 0.7, maxX: gasPumps[pu].x + 0.7, minZ: gasPumps[pu].z - 0.7, maxZ: gasPumps[pu].z + 0.7 });
    }
    var signCanvas = document.createElement('canvas');
    signCanvas.width = 128; signCanvas.height = 64;
    var sg = signCanvas.getContext('2d');
    sg.fillStyle = '#1e3a5f'; sg.fillRect(0, 0, 128, 64);
    sg.fillStyle = '#ffd23f'; sg.font = 'bold 34px Trebuchet MS, sans-serif';
    sg.textAlign = 'center'; sg.textBaseline = 'middle';
    sg.fillText('FUEL', 64, 34);
    var signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    C(scene, 0.25, 0.3, 8, 6, poleMat2, 152, 4, -95, 0);
    B(scene, 0.4, 3.2, 5, new THREE.MeshLambertMaterial({ map: signTex }), 152, 8.6, -95, 1);
    buildings.push({ minX: 151.5, maxX: 152.5, minZ: -95.5, maxZ: -94.5 });
    var stalls = [[177, -40, 0xff7f50], [177, 60, 0x7fd4ff], [-119, 27, 0xffd166]];
    for (var st = 0; st < stalls.length; st++) {
      var sx = stalls[st][0], sz = stalls[st][1], scol = stalls[st][2];
      B(scene, 2.4, 1, 1.3, lm(0x8b6a45), sx, 0.5, sz, 1);
      B(scene, 2.0, 0.5, 1.0, lm(scol), sx, 1.25, sz, 0);
      var awn = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0),
        new THREE.MeshLambertMaterial({ color: scol, side: THREE.DoubleSide }));
      awn.position.set(sx, 2.4, sz);
      awn.rotation.x = -Math.PI / 2 + 0.35;
      awn.castShadow = true;
      scene.add(awn);
      for (var ap = 0; ap < 2; ap++) {
        C(scene, 0.06, 0.06, 2.2, 5, poleMat2, sx + (ap === 0 ? -1.4 : 1.4), 1.1, sz - 0.7, 0);
      }
      buildings.push({ minX: sx - 1.2, maxX: sx + 1.2, minZ: sz - 0.7, maxZ: sz + 0.7 });
      pedSpawns.push({ x: sx + 2.5, z: sz + 1.5 });
      pedSpawns.push({ x: sx - 2.5, z: sz - 1.5 });
    }
    parkedSpots = parkedSpots.filter(function (p) {
      for (var tb2 = 0; tb2 < towerBoxes.length; tb2++) {
        var b = towerBoxes[tb2];
        if (p.x > b.minX - 2 && p.x < b.maxX + 2 && p.z > b.minZ - 2 && p.z < b.maxZ + 2) return false;
      }
      if (p.x > 123 && p.x < 147 && p.z > -86 && p.z < -66) return false;
      return true;
    });
    B(scene, 7, 0.35, HALF * 2, lm(0xb08d5f), HALF + 8, 0.15, 0, 2);
    for (var bw = 0; bw < 12; bw++) {
      addPalm(scene, HALF + 4 + rng.range(-2, 2), -HALF + 16 + bw * 28 + rng.range(-4, 4), rng);
    }
    var poleMat = lm(0x2c313a);
    var lampMat = lme(0xfff2b0, 0xaa8833);
    for (var ix = 0; ix < roadLinesArr.length; ix++) for (var iz = 0; iz < roadLinesArr.length; iz++) {
      if ((ix + iz) % 2 !== 0) continue;
      var lx = roadLinesArr[ix] + ROAD / 2 + 1.2, lz = roadLinesArr[iz] + ROAD / 2 + 1.2;
      C(scene, 0.12, 0.16, 7, 6, poleMat, lx, 3.5, lz, 1);
      B(scene, 2.2, 0.12, 0.12, poleMat, lx - 1, 6.9, lz, 0);
      S(scene, 0.35, 8, 6, lampMat, lx - 2, 6.8, lz, 0);
    }
    var tlPoleG = new THREE.CylinderGeometry(0.1, 0.14, 6.5, 6);
    var tlHeadG = new THREE.BoxGeometry(0.42, 1.15, 0.42);
    var tlLampG = new THREE.SphereGeometry(0.14, 6, 5);
    var tlCols = [0xff3333, 0xffaa00, 0x33cc33], tlLit = [0xcc0000, 0xcc7700, 0x00aa00];
    for (var tx2 = 0; tx2 < roadLinesArr.length; tx2++) for (var tz2 = 0; tz2 < roadLinesArr.length; tz2++) {
      if ((tx2 + tz2) % 4 !== 1) continue;
      var px = roadLinesArr[tx2] - ROAD / 2 - 1, pz = roadLinesArr[tz2] - ROAD / 2 - 1;
      var tp = new THREE.Mesh(tlPoleG, poleMat); tp.position.set(px, 3.25, pz); scene.add(tp);
      var th3 = new THREE.Mesh(tlHeadG, poleMat); th3.position.set(px, 6.7, pz); scene.add(th3);
      var lit = (tx2 + tz2) % 8 < 4 ? 0 : 2;
      for (var tl = 0; tl < 3; tl++) {
        var lm2 = new THREE.Mesh(tlLampG, new THREE.MeshLambertMaterial({ color: tlCols[tl], emissive: tl === lit ? tlLit[tl] : 0x111111 }));
        lm2.position.set(px, 7.05 - tl * 0.33, pz + 0.23); scene.add(lm2);
      }
    }
    for (var bx3 = 0; bx3 < roadLinesArr.length; bx3++) for (var bz3 = 0; bz3 < roadLinesArr.length; bz3++) {
      if ((bx3 + bz3) % 4 !== 2) continue;
      var binx = roadLinesArr[bx3] - ROAD / 2 - 2, binz = roadLinesArr[bz3] - ROAD / 2 - 2;
      C(scene, 0.45, 0.4, 1.0, 8, lm(0x3f6b4f), binx, 0.5, binz, 0);
      C(scene, 0.48, 0.48, 0.12, 8, lm(0x2c4636), binx, 1.05, binz, 0);
      buildings.push({ minX: binx - 0.6, maxX: binx + 0.6, minZ: binz - 0.6, maxZ: binz + 0.6 });
    }
    for (var bp = 0; bp < 10; bp++) {
      addPalm(scene, HALF + 12 + rng.range(-6, 6), -HALF + 20 + bp * 34 + rng.range(-6, 6), rng);
    }
    var umbCols = [0xff7f50, 0x7fd4ff, 0xffd166, 0xff7fb0, 0xa8e6a1, 0xffb86b];
    for (var ub = 0; ub < 6; ub++) {
      var ux = HALF + 16, uz = -120 + ub * 48;
      C(scene, 0.06, 0.06, 2.4, 5, lm(0x8a6f4d), ux, 1.2, uz, 0);
      var umb = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.0, 8), lm(umbCols[ub]));
      umb.position.set(ux, 2.9, uz); scene.add(umb);
    }
    B(scene, 70, 1, 8, lm(0x8a6f4d), HALF + 46 + 30, 0.6, 40, 1);
    for (var pp = 0; pp < 6; pp++) {
      var post = C(scene, 0.4, 0.4, 3, 6, lm(0x5d4a33), HALF + 46 + 6 + pp * 12, -0.5, 36.5, 0);
      var post2 = post.clone(); post2.position.z = 43.5; scene.add(post2);
    }
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
    for (var sx2 = 0; sx2 < N; sx2++) for (var sz2 = 0; sz2 < N; sz2++) {
      pedSpawns.push({
        x: -HALF + ROAD + BLOCK / 2 + sx2 * PITCH + rng.range(-16, 16),
        z: -HALF + ROAD + BLOCK / 2 + sz2 * PITCH + rng.range(-16, 16),
      });
    }
    return {
      buildings: buildings, parkedSpots: parkedSpots, pedSpawns: pedSpawns,
      roadLines: roadLinesArr, half: HALF, block: BLOCK, road: ROAD, pitch: PITCH,
      hemi: hemi, skyMat: sky.material, lampMat: lampMat, gasPumps: gasPumps,
      oceanMat: oceanMat, sunDisc: sunDisc, clouds: clouds,
      propertySpots: [{ x: 190, z: -120 }, { x: 190, z: 0 }, { x: 190, z: 120 }],
    };
  }
  function addBench(scene, x, z) {
    var wood = lm(0x8b6a45), metal = lm(0x4a4a4a);
    B(scene, 1.8, 0.08, 0.5, wood, x, 0.45, z, 1);
    B(scene, 1.8, 0.4, 0.06, wood, x, 0.75, z - 0.22, 0);
    B(scene, 0.08, 0.45, 0.08, metal, x - 0.7, 0.22, z, 0);
    B(scene, 0.08, 0.45, 0.08, metal, x + 0.7, 0.22, z, 0);
  }
  function addPalm(scene, x, z, rng) {
    var trunkMat = lm(0x7a5a38), leafMat = lm(0x2e8b47);
    var h = rng.range(4.5, 6.5);
    var trunk = C(scene, 0.18, 0.3, h, 6, trunkMat, x, h / 2, z, 1);
    trunk.rotation.z = rng.range(-0.08, 0.08);
    for (var i = 0; i < 5; i++) {
      var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 4), leafMat);
      var a = (i / 5) * Math.PI * 2;
      leaf.position.set(x + Math.cos(a) * 1.1, h + 0.3, z + Math.sin(a) * 1.1);
      leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      scene.add(leaf);
    }
    S(scene, 0.35, 6, 5, lm(0x6b4a22), x, h + 0.2, z, 0);
  }
  function hitsBuilding(city, x, z, margin) {
    var m = margin || 0;
    for (var i = 0; i < city.buildings.length; i++) {
      var b = city.buildings[i];
      if (x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m) return b;
    }
    return null;
  }
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
