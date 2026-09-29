(() => {
  'use strict';

  const featured = [
    {key:'starry',name:'星月夜',en:'The Starry Night',year:'1889',museum:'纽约现代艺术博物馆',image:'images/starry.jpg',source:'https://commons.wikimedia.org/wiki/File:VanGogh-starry_night.jpg'},
    {key:'sunflowers',name:'向日葵',en:'Sunflowers',year:'1888',museum:'英国国家美术馆，伦敦',image:'images/sunflowers.jpg',source:'https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Vierzehn_Sonnenblumen_in_einer_Vase.jpeg'},
    {key:'bedroom',name:'阿尔勒的卧室',en:'The Bedroom',year:'1889',museum:'芝加哥艺术博物馆',image:'images/bedroom.jpg',source:'https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_The_Bedroom_-_1926.417_-_Art_Institute_of_Chicago.jpg'},
    {key:'cafe',name:'夜间露天咖啡座',en:'Terrace of a Café at Night',year:'1888',museum:'克勒勒-米勒博物馆',image:'images/cafe.jpg',source:'https://commons.wikimedia.org/wiki/File:Vincent_Willem_van_Gogh_-_Cafe_Terrace_at_Night_(Yorck).jpg'},
    {key:'crows',name:'麦田群鸦',en:'Wheatfield with Crows',year:'1890',museum:'梵高博物馆，阿姆斯特丹',image:'images/crows.jpg',source:'https://commons.wikimedia.org/wiki/File:Korenveld_met_kraaien_-_s0149V1962_-_Van_Gogh_Museum.jpg'},
    {key:'irises',name:'鸢尾花',en:'Irises',year:'1889',museum:'J. Paul Getty 博物馆',image:'images/irises.jpg',source:'https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_Irises_(1889).jpg'}
  ];
  ['F612','F454','F482','F467','F779','F608'].forEach((code,i) => {
    featured[i].f = code;
    featured[i].catalogSource = `https://vangoghworldwide.org/artwork/${code}`;
  });
  const featuredCodes = new Set(featured.map(item => item.f));
  let artworks = featured.slice();
  const $ = id => document.getElementById(id);
  const canvas = $('painting-canvas');
  const finishedImage = $('finished-image');
  const board = $('artboard');
  const wrap = $('canvas-wrap');
  const list = $('art-list');
  const sidebar = $('sidebar');
  const backdrop = $('sidebar-backdrop');
  const galleryToggle = $('gallery-toggle');
  const playButton = $('play-button');
  const replayButton = $('replay-button');
  const restartArtButton = $('restart-art');
  const musicButton = $('music-button');
  const searchInput = $('catalog-search');
  const loadMoreButton = $('load-more');
  const audio = $('ambient-audio');
  const isLocalFile = location.protocol === 'file:';
  const duration = 16;
  const isTouchDevice = matchMedia('(pointer:coarse)').matches;
  const pixelRatio = Math.min(devicePixelRatio || 1, isTouchDevice ? 1.25 : 1.75);
  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0, progress = 0, playing = false, ready = false, token = 0, lastFrame = 0, dirty = true, currentImageRatio = 1;
  let entered = false, visibleCount = 36;
  let musicStarted = false, musicEnabled = true, musicError = false;
  let pointerX = 0, pointerY = 0, targetX = 0, targetY = 0, lastTouch = 0, orientationOrigin = null;

  const vertexShader = `
    attribute vec3 aTarget;
    attribute vec3 aOrigin;
    attribute vec3 aColor;
    attribute float aDelay;
    uniform float uProgress;
    uniform float uPixelRatio;
    uniform float uFade;
    uniform vec2 uPointer;
    uniform vec2 uCover;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float travel = clamp((uProgress - aDelay * 0.25) / 0.45, 0.0, 1.0);
      float ease = travel * travel * (3.0 - 2.0 * travel);
      vec3 point = mix(aOrigin, aTarget, ease);
      point.x += (1.0 - ease) * sin(uProgress * 6.0 + aDelay * 40.0) * 0.05;
      point.y += (1.0 - ease) * cos(uProgress * 4.0 + aDelay * 25.0) * 0.04;
      point.xy += uPointer * point.z * 0.10;
      float perspective = 1.0 / (1.0 + point.z * 0.22);
      gl_Position = vec4(point.xy * perspective * uCover, 0.0, 1.0);
      gl_PointSize = mix(4.0, 4.4, ease) * uPixelRatio * perspective;
      vColor = min(vec3(1.0), aColor * 1.22);
      vAlpha = (0.75 + 0.25 * ease) * (1.0 - uFade);
    }
  `;
  const fragmentShader = `
    precision mediump float;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
      float opacity = (1.0 - smoothstep(0.35, 1.0, radius)) * vAlpha;
      gl_FragColor = vec4(vColor, opacity);
    }
  `;

  function makeRenderer() {
    let gl;
    try { gl = canvas.getContext('webgl', {alpha:true, antialias:false}) || canvas.getContext('experimental-webgl'); }
    catch { return null; }
    if (!gl) return null;
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    try {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, size, offset] of [['aTarget',3,0],['aOrigin',3,12],['aColor',3,24],['aDelay',1,36]]) {
        const location = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      return {gl, buffer, count:0,
        uProgress:gl.getUniformLocation(program,'uProgress'),
        uPixelRatio:gl.getUniformLocation(program,'uPixelRatio'),
        uFade:gl.getUniformLocation(program,'uFade'),
        uPointer:gl.getUniformLocation(program,'uPointer'),
        uCover:gl.getUniformLocation(program,'uCover')};
    } catch { return null; }
  }
  const renderer = prefersReducedMotion ? null : makeRenderer();
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); showStatic(); });

  function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function smooth(value) { const t=clamp(value,0,1); return t*t*(3-2*t); }

  function buildParticles(thumb, artworkIndex) {
    const sample = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(thumb.naturalWidth, thumb.naturalHeight));
    sample.width = Math.max(1, Math.round(thumb.naturalWidth * scale));
    sample.height = Math.max(1, Math.round(thumb.naturalHeight * scale));
    const context = sample.getContext('2d', {willReadFrequently:true});
    context.drawImage(thumb, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const maximum = isTouchDevice ? 12000 : 50000;
    const columns = Math.max(1, Math.round(Math.sqrt(maximum * sample.width / sample.height)));
    const rows = Math.max(1, Math.round(maximum / columns));
    const count = columns * rows;
    const points = new Float32Array(count * 10);
    const next = random(7219 + artworkIndex * 307);
    let offset = 0;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = (column + 0.5) / columns;
        const y = (row + 0.5) / rows;
        const sx = Math.min(sample.width - 1, Math.floor(x * sample.width));
        const sy = Math.min(sample.height - 1, Math.floor(y * sample.height));
        const pixel = (sy * sample.width + sx) * 4;
        const luminance = (pixels[pixel] + pixels[pixel+1] + pixels[pixel+2]) / 765;
        const angle = next() * Math.PI * 2 + x * Math.PI * 3;
        const radius = 0.18 + Math.sqrt(next()) * 1.5;
        points[offset++] = x * 2 - 1;
        points[offset++] = 1 - y * 2;
        points[offset++] = (luminance - 0.5) * 0.22 + (next() - 0.5) * 0.08;
        points[offset++] = Math.cos(angle) * radius * 1.3;
        points[offset++] = Math.sin(angle) * radius * 0.95;
        points[offset++] = (next() - 0.5) * 1.8;
        points[offset++] = pixels[pixel] / 255;
        points[offset++] = pixels[pixel+1] / 255;
        points[offset++] = pixels[pixel+2] / 255;
        points[offset++] = next();
      }
    }
    renderer.gl.bindBuffer(renderer.gl.ARRAY_BUFFER, renderer.buffer);
    renderer.gl.bufferData(renderer.gl.ARRAY_BUFFER, points, renderer.gl.STATIC_DRAW);
    renderer.count = count;
  }

  function resize() {
    if (!renderer || !ready) return;
    canvas.width = Math.max(1, Math.round(board.clientWidth * pixelRatio));
    canvas.height = Math.max(1, Math.round(board.clientHeight * pixelRatio));
    renderer.gl.viewport(0, 0, canvas.width, canvas.height);
    dirty = true;
  }

  function render() {
    board.style.transform = `perspective(1400px) rotateY(${(pointerX * 1.5).toFixed(3)}deg) rotateX(${(-pointerY * 1.5).toFixed(3)}deg)`;
    const reveal = smooth((progress - 0.72) / 0.28);
    finishedImage.style.opacity = String(reveal);
    if (!renderer || !ready) return;
    const {gl} = renderer;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (reveal > 0.999) return;
    gl.uniform1f(renderer.uProgress, progress);
    gl.uniform1f(renderer.uPixelRatio, pixelRatio);
    gl.uniform1f(renderer.uFade, reveal);
    gl.uniform2f(renderer.uPointer, pointerX, pointerY);
    const boardRatio = board.clientWidth / board.clientHeight || 1;
    gl.uniform2f(renderer.uCover, Math.max(1, currentImageRatio / boardRatio), Math.max(1, boardRatio / currentImageRatio));
    gl.drawArrays(gl.POINTS, 0, renderer.count);
  }

  function updateUi() {
    playButton.textContent = playing ? '暂停' : progress >= 1 ? '再播放' : '播放';
    playButton.setAttribute('aria-label', playing ? '暂停动画' : progress >= 1 ? '重新播放动画' : '播放动画');
  }
  function updateMusicUi() {
    const label = musicError ? '音乐不可用' : !musicStarted ? '开启音乐' : musicEnabled ? '音乐开启' : '已静音';
    musicButton.textContent = `♫ ${label}`;
    musicButton.setAttribute('aria-label', label);
    musicButton.setAttribute('aria-pressed', String(musicStarted && musicEnabled));
  }
  function startMusic() {
    if (musicStarted || !musicEnabled || musicError) return;
    audio.volume = .32;
    const attempt = audio.play();
    if (attempt?.then) attempt.then(() => { musicStarted=true; updateMusicUi(); }).catch(updateMusicUi);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  function loadCatalog() {
    $('catalog-count').textContent = '正在加载完整目录…';
    loadScript('catalog.js').then(() => {
      artworks = featured.concat((window.VG_CATALOG || []).filter(item => !featuredCodes.has(item.f)));
      renderList();
    }).catch(() => {
      $('catalog-count').textContent = '完整目录暂时无法加载，请刷新页面重试';
    });
  }

  function showStatic() {
    ready = true;
    playing = false;
    progress = 1;
    canvas.style.display = 'none';
    finishedImage.style.opacity = '1';
    playButton.disabled = true;
    replayButton.disabled = true;
    restartArtButton.disabled = true;
    $('load-message').hidden = true;
    updateUi();
  }
  function closeGallery() {
    sidebar.hidden = true;
    backdrop.hidden = true;
    sidebar.setAttribute('aria-hidden', 'true');
    galleryToggle.setAttribute('aria-expanded', 'false');
    galleryToggle.focus();
  }

  function select(nextIndex, fromClick=false) {
    if (fromClick) startMusic();
    index = nextIndex;
    const item = artworks[index];
    const currentToken = ++token;
    progress = 0;
    playing = entered;
    ready = false;
    lastFrame = 0;
    finishedImage.style.opacity = '0';
    finishedImage.removeAttribute('src');
    canvas.style.display = 'block';
    playButton.disabled = false;
    replayButton.disabled = false;
    restartArtButton.disabled = false;
    wrap.style.removeProperty('--bg-image');
    $('detail-name').textContent = item.name;
    $('detail-en').textContent = item.name === item.en ? '' : item.en;
    $('detail-year').textContent = item.year;
    $('detail-museum').textContent = item.museum;
    $('detail-code').textContent = item.f || '未编号';
    $('detail-source').parentElement.hidden = !item.source;
    if (item.source) $('detail-source').href = item.source;
    else $('detail-source').removeAttribute('href');
    $('detail-source').textContent = item.source?.includes('commons.wikimedia.org') ? 'Wikimedia Commons' : 'RKD 图像资料';
    $('detail-catalog-source').href = item.catalogSource;
    $('load-message').hidden = false;
    $('load-message').textContent = '正在准备粒子画布…';
    list.querySelectorAll('.art-item').forEach(button => button.setAttribute('aria-current', String(Number(button.dataset.index)===index)));
    if (fromClick) closeGallery();
    updateUi();
    if (!item.image) {
      playing = false;
      playButton.disabled = true;
      replayButton.disabled = true;
      restartArtButton.disabled = true;
      $('load-message').textContent = `${item.name} 已收录于绘画目录，但目前没有可用的原作图像，无法播放粒子动画。`;
      updateUi();
      return;
    }
    const original = new Image();
    original.onload = () => {
      if (currentToken !== token) return;
      currentImageRatio = original.naturalWidth / original.naturalHeight;
      board.style.setProperty('--ratio', String(original.naturalWidth / original.naturalHeight));
      wrap.style.setProperty('--bg-image', `url("${original.src}")`);
      finishedImage.src = original.src;
      finishedImage.alt = item.name;
      if (!renderer) { showStatic(); return; }
      const activateParticles = image => {
        if (currentToken !== token) return;
        try { buildParticles(image, index); }
        catch { showStatic(); return; }
        ready = true;
        $('load-message').hidden = true;
        resize();
        render();
      };
      if (!isLocalFile) { activateParticles(original); return; }
      const sample = item.key ? window.PARTICLE_THUMBS?.[item.key] : window.CATALOG_THUMBS?.[item.thumbKey];
      if (sample) {
        const thumb = new Image();
        thumb.onload = () => activateParticles(thumb);
        thumb.onerror = () => { if (currentToken === token) showStatic(); };
        thumb.src = sample;
      } else showStatic();
    };
    original.onerror = () => {
      if (currentToken !== token) return;
      playing = false;
      playButton.disabled = true;
      replayButton.disabled = true;
      restartArtButton.disabled = true;
      $('load-message').hidden = false;
      $('load-message').textContent = '图片未能加载。请确认 images 文件夹与此网页位于同一目录，再刷新页面。';
      updateUi();
    };
    original.src = item.image;
  }

  function renderList() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const matches = artworks.map((item,i) => ({item,i})).filter(({item}) =>
      !query || [item.name,item.en,item.year,item.f,item.museum].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    const visible = matches.slice(0, visibleCount);
    const fragment = document.createDocumentFragment();
    for (const {item,i} of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'art-item';
      button.dataset.index = String(i);
      button.setAttribute('aria-label', `选择${item.name}`);
      button.setAttribute('aria-current', String(i === index));
      if (item.image) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = item.image;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
          const placeholder = document.createElement('span');
          placeholder.className = 'thumb-placeholder';
          placeholder.textContent = '无图';
          img.replaceWith(placeholder);
        }, {once:true});
        button.append(img);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'thumb-placeholder';
        placeholder.textContent = '无图';
        button.append(placeholder);
      }
      const label = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = item.name;
      const meta = document.createElement('small');
      meta.textContent = `${item.en} · ${item.year} · ${item.f || '未编号'}${item.image ? '' : ' · 暂无图像'}`;
      label.append(title, meta);
      button.append(label);
      button.addEventListener('click', () => select(i,true));
      fragment.append(button);
    }
    list.replaceChildren(fragment);
    $('catalog-count').textContent = query ? `找到 ${matches.length} 幅作品` : `共 ${artworks.length} 幅已确认绘画 · 当前显示 ${visible.length} 幅`;
    loadMoreButton.hidden = matches.length <= visibleCount;
  }
  searchInput.addEventListener('input', () => { visibleCount = 36; renderList(); });
  loadMoreButton.addEventListener('click', () => { visibleCount += 36; renderList(); });
  renderList();
  galleryToggle.addEventListener('click', () => {
    sidebar.hidden = false;
    backdrop.hidden = false;
    sidebar.setAttribute('aria-hidden', 'false');
    galleryToggle.setAttribute('aria-expanded', 'true');
    $('close-gallery').focus();
  });
  $('close-gallery').addEventListener('click', closeGallery);
  backdrop.addEventListener('click', closeGallery);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !sidebar.hidden) closeGallery(); });
  playButton.addEventListener('click', () => {
    startMusic();
    if (!ready || !renderer) return;
    if (progress >= 1) progress = 0;
    playing = !playing;
    lastFrame = 0;
    updateUi();
    dirty = true;
    closeGallery();
  });
  function replayCurrent(closeMenu = false) {
    startMusic();
    if (!ready || !renderer) return;
    progress = 0;
    playing = true;
    lastFrame = 0;
    updateUi();
    dirty = true;
    if (closeMenu) closeGallery();
  }
  replayButton.addEventListener('click', () => replayCurrent(true));
  restartArtButton.addEventListener('click', () => replayCurrent());
  $('previous-art').addEventListener('click', () => { startMusic(); select((index - 1 + artworks.length) % artworks.length); });
  $('next-art').addEventListener('click', () => { startMusic(); select((index + 1) % artworks.length); });
  audio.addEventListener('error', () => { musicError=true; updateMusicUi(); });
  musicButton.addEventListener('click', () => {
    if (musicError) return;
    if (!musicStarted) { musicEnabled=true; startMusic(); }
    else { musicEnabled=!musicEnabled; audio.muted=!musicEnabled; updateMusicUi(); }
  });
  galleryToggle.tabIndex = -1;
  musicButton.tabIndex = -1;
  for (const button of document.querySelectorAll('.art-nav button')) button.tabIndex = -1;
  $('enter-button').addEventListener('click', event => {
    entered = true;
    startMusic();
    loadCatalog();
    if (isLocalFile) {
      Promise.all([loadScript('particle-thumbs.js'), loadScript('catalog-thumbs.js')])
        .then(() => select(index))
        .catch(() => showStatic());
    }
    $('welcome').hidden = true;
    galleryToggle.tabIndex = 0;
    musicButton.tabIndex = 0;
    for (const button of document.querySelectorAll('.art-nav button')) button.tabIndex = 0;
    if (renderer && !playButton.disabled) {
      progress = 0;
      playing = true;
      lastFrame = 0;
      dirty = true;
      updateUi();
    }
    if (event.detail === 0) galleryToggle.focus({preventScroll:true});
  });

  window.addEventListener('pointermove', event => {
    targetX = clamp((event.clientX / innerWidth - .5) * 2, -1, 1);
    targetY = clamp((event.clientY / innerHeight - .5) * 2, -1, 1);
    if (event.pointerType === 'touch') lastTouch = Date.now();
  }, {passive:true});
  window.addEventListener('deviceorientation', event => {
    if (event.gamma == null || event.beta == null || Date.now() - lastTouch < 1500) return;
    if (!orientationOrigin) orientationOrigin = {gamma:event.gamma, beta:event.beta};
    targetX = clamp((event.gamma - orientationOrigin.gamma) / 35, -1, 1);
    targetY = clamp((event.beta - orientationOrigin.beta) / 35, -1, 1);
  }, {passive:true});
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(board);
  else window.addEventListener('resize', resize);

  function tick(timestamp) {
    if (ready && playing && renderer) {
      if (lastFrame) progress = Math.min(1, progress + (timestamp - lastFrame) / (duration * 1000));
      if (progress >= 1) playing = false;
      updateUi();
      dirty = true;
    }
    lastFrame = timestamp;
    const dx = targetX - pointerX, dy = targetY - pointerY;
    if (Math.abs(dx) + Math.abs(dy) > .002) {
      pointerX += dx * .08;
      pointerY += dy * .08;
      dirty = true;
    }
    if (ready && dirty) { render(); dirty=false; }
    requestAnimationFrame(tick);
  }
  updateMusicUi();
  select(0);
  requestAnimationFrame(tick);
})();
