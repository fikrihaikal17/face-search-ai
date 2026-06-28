/**
 * FaceSearch AI v2.0 — app.js
 * ═══════════════════════════════════════════════════════
 * Features:
 *  - Upload folder/multi-file sebagai sumber query
 *  - Deteksi wajah di semua foto sumber
 *  - Galeri wajah dengan crop—klik untuk pilih
 *  - Multi-face query (pilih banyak wajah sekaligus)
 *  - Search: bandingkan setiap query vs seluruh DB
 *  - IndexedDB untuk persistensi database foto
 * ═══════════════════════════════════════════════════════
 */

'use strict';

// ─── Constants ───────────────────────────────────────────
const MODELS_URL = './models';
const DB_NAME    = 'FaceSearchDB_v2';
const DB_VER     = 1;
const STORE      = 'faces';

// Distance thresholds (Euclidean on 128-dim descriptor)
const THR_EXACT  = 0.22;
const THR_VHIGH  = 0.38;
const THR_HIGH   = 0.52;
const THR_MED    = 0.65;

// Face crop padding ratio
const CROP_PAD   = 0.30;
const CROP_SIZE  = 128; // px for thumbnail

// ─── State ───────────────────────────────────────────────
const CONFIG = {
  GROQ_API_KEY: '',
  GEMINI_API_KEY: '',
  OPENROUTER_API_KEY: ''
};
let idb         = null;   // IndexedDB
let modelsReady = false;

/** Database panel state */
const dbState = {
  items: [],   // [{id, name, dataUrl, descriptors, faceCount}]
};

/** Query builder state */
const qbState = {
  sources: [],           // [{id, filename, dataUrl, imgEl, faceCount, error}]
  faces:   [],           // [{id, srcId, srcName, descriptor, cropUrl, box, confidence}]
  selected: new Set(),   // Set of face ids
};

let allResults  = [];   // last search results
let currentSort = 'sim';
let detailItem  = null;
let wcStream    = null;
let wcTarget    = null; // 'query' | 'db'
let wcamMirrored = true;

// ─── DOM helpers ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  loOverlay:  $('loading-overlay'),
  loBar:      $('lo-bar'),
  loText:     $('lo-text'),
  loS:        [0,1,2].map(i => $(`lo-s${i}`)),

  hDot:       $('h-dot'),
  hModelTxt:  $('h-model-txt'),

  statDb:     $('stat-db'),
  statFaces:  $('stat-faces'),
  statRes:    $('stat-results'),
  statTop:    $('stat-top'),

  // DB
  dbDrop:     $('db-drop'),
  dbFileIn:   $('db-file-input'),
  dbFolderIn: $('db-folder-input'),
  dbBtnFiles: $('btn-db-files'),
  dbBtnFolder:$('btn-db-folder'),
  dbEmpty:    $('db-empty'),
  dbGrid:     $('db-grid'),
  dbScroll:   $('db-scroll'),
  dbCountBadge:$('db-count-badge'),
  btnDbClear: $('btn-db-clear'),
  btnDbExport:$('btn-db-export'),
  btnDbImport:$('btn-db-import'),
  importIn:   $('import-input'),

  // Source / Query Builder
  srcDrop:    $('src-drop'),
  srcFileIn:  $('src-file-input'),
  srcFolderIn:$('src-folder-input'),
  btnSrcFiles:$('btn-src-files'),
  btnSrcFolder:$('btn-src-folder'),
  btnSrcWebcam:$('btn-src-webcam'),
  srcStrip:   $('src-strip'),
  srcStripLbl:$('src-strip-label'),
  srcThumbs:  $('src-thumbs'),
  btnSrcAdd:  $('btn-src-add'),
  btnSrcClear:$('btn-src-clear'),
  facesDivider:$('faces-divider'),
  faceGallery:$('face-gallery'),
  fgCount:    $('fg-count'),
  fgLoading:  $('fg-loading'),
  faceGrid:   $('face-grid'),
  btnFgAll:   $('btn-fg-all'),
  btnFgNone:  $('btn-fg-none'),
  selBar:     $('sel-bar'),
  selCount:   $('sel-count'),
  selChips:   $('sel-chips'),
  threshold:  $('threshold'),
  tval:       $('tval'),
  btnSearch:  $('btn-search'),
  btnQbWebcam:$('btn-qb-webcam'),
  btnQbClear: $('btn-qb-clear'),

  // Results
  resEmpty:   $('res-empty'),
  resProc:    $('res-proc'),
  procTxt:    $('proc-txt'),
  resList:    $('res-list'),
  cntShown:   $('cnt-shown'),
  cntTotal:   $('cnt-total'),
  btnCopy:    $('btn-copy'),

  // Detail modal
  modalDetail:$('modal-detail'),
  modalName:  $('modal-name'),
  modalSub:   $('modal-sub'),
  modalImg:   $('modal-img'),
  modalScore: $('modal-score'),
  modalDist:  $('modal-dist'),
  modalRank:  $('modal-rank'),
  modalBadge: $('modal-badge'),
  modalDel:   $('modal-del'),
  modalClose: $('modal-close'),
  modalClose2:$('modal-close2'),

  // Webcam modal
  modalWcam:  $('modal-webcam'),
  wcamVideo:  $('wcam-video'),
  wcamCanvas: $('wcam-canvas'),
  wcamCapture:$('wcam-capture'),
  wcamMirror: $('wcam-mirror'),
  wcamStop:   $('wcam-stop'),
  wcamClose:  $('wcam-close'),

  toastCont:  $('toast-container'),
  procImg:    $('proc-img'),

  // Progress overlay
  prgOverlay: $('progress-overlay'),
  prgTitle:   $('progress-title'),
  prgSub:     $('progress-sub'),
  prgBar:     $('progress-bar'),
  prgStatus:  $('progress-status'),

  // Tutorial modal
  btnTutorial: $('btn-tutorial'),
  modalTutorial: $('modal-tutorial'),
  tutorialClose: $('tutorial-close'),
  tutorialClose2: $('tutorial-close2'),

  // Privacy modal
  btnPrivacy: $('btn-privacy'),
  modalPrivacy: $('modal-privacy'),
  privacyClose: $('privacy-close'),
  privacyClose2: $('privacy-close2'),
};

function updateProgressOverlay(visible, title = '', current = 0, total = 0, statusText = '') {
  if (!visible) {
    el.prgOverlay.classList.add('hidden');
    el.prgOverlay.classList.remove('visible');
    return;
  }
  
  if (title) el.prgTitle.textContent = title;
  
  if (total > 0) {
    const pct = Math.round((current / total) * 100);
    el.prgSub.textContent = `${current} dari ${total} file (${pct}%)`;
    el.prgBar.style.width = `${pct}%`;
  } else {
    el.prgSub.textContent = '';
    el.prgBar.style.width = '0%';
  }
  
  if (statusText) el.prgStatus.textContent = statusText;
  
  el.prgOverlay.classList.remove('hidden');
  el.prgOverlay.classList.add('visible');
}

// ═══════════════════════════════════════════════════════
// IndexedDB
// ═══════════════════════════════════════════════════════
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
const idbAll   = () => txOp('readonly',  s => s.getAll());
const idbAdd   = item  => txOp('readwrite', s => s.add(item));
const idbPut   = item  => txOp('readwrite', s => s.put(item));
const idbDel   = id    => txOp('readwrite', s => s.delete(id));
const idbClear = ()    => txOp('readwrite', s => s.clear());
function txOp(mode, fn) {
  return new Promise((res, rej) => {
    const tx  = idb.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// ═══════════════════════════════════════════════════════
// Model Loading
// ═══════════════════════════════════════════════════════
async function loadModels() {
  if (window.faceapi && faceapi.tf) {
    try {
      faceapi.tf.enableProdMode();

      // Try WebGL first (GPU-accelerated), then fall back to cpu (wasm / vanilla js)
      const backends = ['webgl', 'cpu'];
      let backendSet = false;
      for (const backend of backends) {
        try {
          await faceapi.tf.setBackend(backend);
          await faceapi.tf.ready();
          backendSet = true;
          if (backend === 'webgl') {
            // Enable 16-bit floats for better GPU performance
            try { faceapi.tf.ENV.set('WEBGL_FORCE_F16_TEXTURES', true); } catch (_) {}
          }
          console.log(`TensorFlow.js backend ready: ${backend}`);
          break;
        } catch (e) {
          console.warn(`Backend "${backend}" failed, trying next…`, e.message);
        }
      }
      if (!backendSet) {
        console.warn('All TF.js backends failed; face-api will use its own default.');
      }
    } catch (e) {
      console.warn('TF.js backend setup error, continuing with defaults:', e);
    }
  }

  const steps = [
    { label: 'Memuat SSD MobileNet…',       fn: () => faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL),   step: 0 },
    { label: 'Memuat Face Landmark 68…',    fn: () => faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL), step: 1 },
    { label: 'Memuat Face Recognition…',   fn: () => faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL), step: 2 },
  ];
  for (const s of steps) {
    el.loText.textContent = s.label;
    el.loS[s.step].classList.add('active');
    await s.fn();
    el.loS[s.step].classList.remove('active');
    el.loS[s.step].classList.add('done');
    el.loBar.style.width = `${Math.round((s.step + 1) / steps.length * 100)}%`;
    await sleep(150);
  }
}

// ═══════════════════════════════════════════════════════
// Face Detection Utilities
// ═══════════════════════════════════════════════════════
/**
 * Detect all faces with a balanced 3-layer filter:
 *
 * Layer 1 — Confidence threshold (0.48): catches most real faces including
 *            side-profiles and faces partially covered by hijab/veil, while
 *            still removing obvious false positives from flowers/fabric.
 *            (0.38 was too loose → false positives on decoration photos;
 *             0.60 was too strict → missed tilted/hijab/far-away faces)
 *
 * Layer 2 — Minimum absolute face size (36 px per side): removes detector
 *            noise blobs that are too small to be meaningful faces.
 *            Minimum image-area ratio (0.8%): catches faces in group shots
 *            from a distance while ignoring micro-blobs.
 *
 * Layer 3 — Lenient landmark plausibility check: only rejects a detection if
 *            the landmark geometry is completely impossible for a human face
 *            (e.g. eyes below chin, zero eye span). Angled / 3/4-profile /
 *            close-up faces are all allowed through.
 */
async function detectAllFaces(imgEl) {
  const MIN_CONFIDENCE = 0.30;    // Lowered: catches side/partial/distant faces in group photos
  const MIN_FACE_PX    = 20;      // Smaller minimum for group photos where faces are distant
  const MIN_IMG_RATIO  = 0.001;   // Face area ≥ 0.1% of image — allows 10+ faces in group shots

  const W = imgEl.naturalWidth  || imgEl.width;
  const H = imgEl.naturalHeight || imgEl.height;
  const imgArea = (W * H) || 1;

  const raw = await faceapi
    .detectAllFaces(imgEl, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  return raw.filter(det => {
    const box = det.detection.box;

    // ── Layer 2: Minimum size filter ──────────────────────────────
    if (box.width < MIN_FACE_PX || box.height < MIN_FACE_PX) return false;
    if ((box.width * box.height) / imgArea < MIN_IMG_RATIO) return false;

    // ── Layer 3: Lenient plausibility check ───────────────────────
    // Only discard when landmark positions are geometrically impossible
    // (protects against detector hallucinations on solid-colour patches)
    if (det.detection.score > 0.45) return true; // High confidence -> trust the detection
    try {
      const pts = det.landmarks.positions;
      if (!pts || pts.length < 68) return true; // incomplete → trust confidence score

      const leftEyeX  = pts[36].x;
      const rightEyeX = pts[45].x;
      const eyeSpan   = Math.abs(rightEyeX - leftEyeX);

      // Both eyes must have some horizontal separation
      if (eyeSpan < 3) return false;

      const eyeMidY    = (pts[36].y + pts[45].y) / 2;
      const chinY      = pts[8].y;
      const noseTipY   = pts[33].y;
      const faceHeight = Math.abs(chinY - eyeMidY);

      // Face height must be at least a third of the eye span (very lenient)
      if (faceHeight < eyeSpan * 0.3) return false;

      // Nose tip must not be ABOVE the eyes (completely inverted / pure noise)
      // Allow a generous 15px margin to handle angled faces
      if (noseTipY < eyeMidY - 15) return false;

      return true;
    } catch (_) {
      return true; // Validation threw → let confidence score decide
    }
  });
}


/**
 * Crop a detected face from an img element with padding,
 * return a base64 data URL thumbnail.
 */
function cropFace(imgEl, box) {
  const W = imgEl.naturalWidth;
  const H = imgEl.naturalHeight;
  const pw = box.width  * CROP_PAD;
  const ph = box.height * CROP_PAD;
  const sx = Math.max(0, box.x - pw);
  const sy = Math.max(0, box.y - ph);
  const sw = Math.min(W - sx, box.width  + pw * 2);
  const sh = Math.min(H - sy, box.height + ph * 2);

  const canvas = document.createElement('canvas');
  canvas.width  = CROP_SIZE;
  canvas.height = CROP_SIZE;
  const ctx = canvas.getContext('2d');
  // Fill black first
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, CROP_SIZE, CROP_SIZE);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * Draw bounding boxes and labels on an img → canvas overlay.
 */
function drawBoxes(canvas, imgEl, detections, selectedIdx = -1) {
  const W = imgEl.naturalWidth;
  const H = imgEl.naturalHeight;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0);

  detections.forEach((det, i) => {
    const box = det.detection.box;
    const isSelected = (i === selectedIdx);
    const color = isSelected ? '#22d3ee' : '#8b5cf6';
    const alpha = isSelected ? 1 : 0.75;

    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur  = isSelected ? 18 : 10;
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSelected ? 3 : 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;

    // Corner marks
    const c = Math.min(14, box.width * 0.18);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = alpha;
    [[box.x,box.y,c,0,0,c],[box.x+box.width,box.y,-c,0,0,c],[box.x,box.y+box.height,c,0,0,-c],[box.x+box.width,box.y+box.height,-c,0,0,-c]]
      .forEach(([ox,oy,dx1,dy1,dx2,dy2]) => {
        ctx.beginPath(); ctx.moveTo(ox+dx1,oy+dy1); ctx.lineTo(ox,oy); ctx.lineTo(ox+dx2,oy+dy2); ctx.stroke();
      });
    ctx.globalAlpha = 1;

    // Label pill
    const label = `#${i+1}  ${(det.detection.score * 100).toFixed(0)}%`;
    const lx = box.x, ly = box.y - 26;
    const tw = ctx.measureText(label).width + 14;
    ctx.fillStyle = isSelected ? 'rgba(34,211,238,.85)' : 'rgba(139,92,246,.82)';
    ctx.roundRect ? ctx.roundRect(lx, ly, tw, 22, 5) : ctx.fillRect(lx, ly, tw, 22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 11px Inter, sans-serif`;
    ctx.fillText(label, lx + 7, ly + 15);
  });
}

// Distance → similarity %
const dist2sim = d => Math.max(0, Math.min(100, (1 - d / 2) * 100));
// Similarity % → distance
const sim2dist = p => (1 - p / 100) * 2;

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i]-b[i]; s += d*d; }
  return Math.sqrt(s);
}

function matchLabel(dist) {
  if (dist <= THR_EXACT)  return { text:'Identik',           cls:'badge-exact'     };
  if (dist <= THR_VHIGH)  return { text:'Sangat Mirip',      cls:'badge-very-high' };
  if (dist <= THR_HIGH)   return { text:'Mirip',             cls:'badge-high'      };
  if (dist <= THR_MED)    return { text:'Kemiripan Rendah',  cls:'badge-medium'    };
  return                          { text:'Berbeda',          cls:'badge-low'       };
}
function scoreColor(p) {
  if (p >= 90) return 'var(--success)';
  if (p >= 75) return 'var(--info)';
  if (p >= 60) return 'var(--p-light)';
  if (p >= 45) return 'var(--warning)';
  return 'var(--danger)';
}
function barGrad(p) {
  if (p >= 90) return 'linear-gradient(90deg,#34d399,#22d3ee)';
  if (p >= 75) return 'linear-gradient(90deg,#60a5fa,#818cf8)';
  if (p >= 60) return 'linear-gradient(90deg,#8b5cf6,#a78bfa)';
  if (p >= 45) return 'linear-gradient(90deg,#fbbf24,#f97316)';
  return 'linear-gradient(90deg,#f87171,#f43f5e)';
}

// ═══════════════════════════════════════════════════════
// DATABASE PANEL
// ═══════════════════════════════════════════════════════
async function refreshDB() {
  dbState.items = await idbAll();
  const n = dbState.items.length;
  el.statDb.textContent       = n;
  el.dbCountBadge.textContent = n ? `${n} foto` : '';

  if (n === 0) {
    el.dbEmpty.style.display = '';
    el.dbGrid.style.display  = 'none';
    return;
  }
  el.dbEmpty.style.display = 'none';
  el.dbGrid.style.display  = 'grid';
  el.dbGrid.innerHTML = '';

  dbState.items.forEach(item => {
    const card = document.createElement('div');
    card.className   = 'db-card';
    card.dataset.id  = item.id;
    card.title       = item.name;
    card.innerHTML   = `
      <img src="${item.dataUrl}" alt="${esc(item.name)}" loading="lazy" />
      <div class="db-card-overlay">
        <span class="db-card-name">${esc(shortname(item.name))}</span>
        <button class="db-card-del" data-id="${item.id}" aria-label="Hapus">✕</button>
      </div>
      ${item.faceCount > 0 ? `<span class="db-card-badge">${item.faceCount} Wajah</span>` : ''}
    `;
    card.addEventListener('click', () => openDetail(item));
    el.dbGrid.appendChild(card);
  });

  el.dbGrid.querySelectorAll('.db-card-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await idbDel(Number(btn.dataset.id));
      await refreshDB();
      toast('Foto dihapus dari database.', 'info');
    });
  });
}

async function addFilesToDB(files) {
  if (!modelsReady) { toast('Model AI belum siap!', 'warning'); return; }
  if (!files.length) return;

  const imgFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!imgFiles.length) { toast('Tidak ada file gambar dipilih.', 'warning'); return; }

  updateProgressOverlay(true, 'Menambahkan ke Database Foto', 0, imgFiles.length, 'Memulai...');
  let ok = 0, skip = 0, completed = 0;

  const hasAI = !!(CONFIG.GROQ_API_KEY || CONFIG.GEMINI_API_KEY || CONFIG.OPENROUTER_API_KEY);

  // Process up to 3 files in parallel
  await parallelProcess(imgFiles, 3, async (f) => {
    try {
      const rawDataUrl = await file2url(f);
      const rawImgEl   = await loadImg(rawDataUrl);
      // Use higher resolution for face detection (more detail for group photos)
      const detectUrl  = resizeImageMax(rawImgEl, 1600);
      const detectEl   = (detectUrl === rawDataUrl) ? rawImgEl : await loadImg(detectUrl);
      // Store a smaller version for display/storage efficiency
      const dataUrl    = resizeImageMax(rawImgEl, 1024);
      const imgEl      = detectEl; // use high-res for detection

      const dets       = await detectAllFaces(imgEl);
      if (dets.length === 0) {
        skip++;
      } else {
        const descriptors = dets.map(d => Array.from(d.descriptor));
        const faces = dets.map(d => {
          const box = d.detection.box;
          return {
            box: {
              x: box.x / imgEl.width,
              y: box.y / imgEl.height,
              width: box.width / imgEl.width,
              height: box.height / imgEl.height
            },
            descriptor: Array.from(d.descriptor)
          };
        });

        let groqMeta = null;
        if (hasAI) {
          try {
            groqMeta = await analyzeImageWithAI(dataUrl);
          } catch (e) {
            console.error('AI Vision database indexing error:', e);
          }
        }

        await idbAdd({ name: f.name, dataUrl, descriptors, faces, faceCount: dets.length, ts: Date.now(), groqMeta });
        ok++;
      }
    } catch (e) {
      console.error(e);
      skip++;
    } finally {
      completed++;
      updateProgressOverlay(true, 'Menambahkan ke Database Foto', completed, imgFiles.length, `Selesai memproses: ${f.name}`);
    }
  });

  updateProgressOverlay(false);
  await refreshDB();
  if (ok)   toast(`${ok} foto berhasil diindeks ke database!`, 'success');
  if (skip) toast(`${skip} foto dilewati (tidak ada wajah/error).`, 'warning');
}

// ═══════════════════════════════════════════════════════
// SOURCE IMAGES (Query Builder)
// ═══════════════════════════════════════════════════════
let srcIdCounter = 0;

async function addSourceFiles(files) {
  if (!modelsReady) { toast('Model AI belum siap!', 'warning'); return; }
  const imgFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!imgFiles.length) { toast('Tidak ada file gambar.', 'warning'); return; }

  updateProgressOverlay(true, 'Memuat Foto Sumber', 0, imgFiles.length, 'Membaca file...');
  let completed = 0;

  const hasAI = !!(CONFIG.GROQ_API_KEY || CONFIG.GEMINI_API_KEY || CONFIG.OPENROUTER_API_KEY);

  await parallelProcess(imgFiles, 3, async (f) => {
    try {
      const rawDataUrl = await file2url(f);
      const rawImgEl   = await loadImg(rawDataUrl);
      // Use higher resolution for face detection (more faces in group photos)
      const detectUrl  = resizeImageMax(rawImgEl, 1600);
      const detectEl   = (detectUrl === rawDataUrl) ? rawImgEl : await loadImg(detectUrl);
      // Store smaller version for display
      const dataUrl    = resizeImageMax(rawImgEl, 1024);

      let groqMeta = null;
      if (hasAI) {
        try {
          groqMeta = await analyzeImageWithAI(dataUrl);
        } catch (e) {
          console.error('AI Vision query indexing error:', e);
        }
      }

      const src = { id: ++srcIdCounter, filename: f.name, dataUrl, imgEl: detectEl, faceCount: 0, error: null, groqMeta };
      qbState.sources.push(src);
    } catch(err) {
      const src = { id: ++srcIdCounter, filename: f.name, dataUrl: '', imgEl: null, faceCount: 0, error: err.message };
      qbState.sources.push(src);
    } finally {
      completed++;
      updateProgressOverlay(true, 'Memuat Foto Sumber', completed, imgFiles.length, `Membaca: ${f.name}`);
    }
  });

  updateProgressOverlay(false);
  renderSourceStrip();
  await detectFacesFromSources();
}

function renderSourceStrip() {
  if (!qbState.sources.length) {
    el.srcStrip.classList.remove('visible');
    return;
  }
  el.srcStrip.classList.add('visible');
  el.srcStripLbl.textContent = `${qbState.sources.length} foto sumber`;
  el.srcThumbs.innerHTML = '';
  qbState.sources.forEach(src => {
    const thumb = document.createElement('div');
    thumb.className  = 'src-thumb';
    thumb.dataset.id = src.id;
    if (src.error || !src.dataUrl) {
      thumb.innerHTML = `<div class="src-thumb-err">Error</div>`;
    } else {
      thumb.innerHTML = `
        <img src="${src.dataUrl}" alt="${esc(src.filename)}" />
        ${src.faceCount > 0 ? `<span class="src-thumb-badge">${src.faceCount} Wajah</span>` : ''}
      `;
    }
    thumb.title = src.filename;
    el.srcThumbs.appendChild(thumb);
  });
}

async function detectFacesFromSources() {
  // Show loading
  el.facesDivider.style.display = '';
  el.faceGallery.classList.add('visible');
  el.fgLoading.style.display   = '';
  el.faceGrid.innerHTML        = '';
  qbState.faces = [];
  qbState.selected.clear();
  updateSelectionBar();

  let faceIdCounter = 0;
  const sourcesToProcess = qbState.sources.filter(s => s.imgEl);
  const totalSources = sourcesToProcess.length;
  let completed = 0;

  updateProgressOverlay(true, 'Mendeteksi Wajah Foto Sumber', 0, totalSources, 'Menganalisis wajah...');

  await parallelProcess(sourcesToProcess, 3, async (src) => {
    try {
      const dets = await detectAllFaces(src.imgEl);
      src.faceCount = dets.length;
      dets.forEach((det) => {
        const cropUrl = cropFace(src.imgEl, det.detection.box);
        qbState.faces.push({
          id:         ++faceIdCounter,
          srcId:      src.id,
          srcName:    src.filename,
          descriptor: det.descriptor,
          cropUrl,
          box:        det.detection.box,
          confidence: det.detection.score,
        });
      });
    } catch (e) {
      console.error(e);
    } finally {
      completed++;
      updateProgressOverlay(true, 'Mendeteksi Wajah Foto Sumber', completed, totalSources, `Menganalisis: ${src.filename}`);
    }
  });

  updateProgressOverlay(false);
  renderSourceStrip(); // refresh thumbnail face count badges
  renderFaceGallery();
  el.fgLoading.style.display = 'none';
  el.fgCount.textContent = qbState.faces.length;
  el.statFaces.textContent = qbState.faces.length;

  if (qbState.faces.length === 0) {
    toast('Tidak ada wajah terdeteksi di foto sumber.', 'error');
    el.facesDivider.style.display = 'none';
    el.faceGallery.classList.remove('visible');
  } else {
    toast(`${qbState.faces.length} wajah terdeteksi dari ${qbState.sources.length} foto!`, 'success');
    // Auto-select first face
    qbState.selected.add(qbState.faces[0].id);
    renderFaceGallery();
    updateSelectionBar();
    updateSearchBtn();
  }
}

function renderFaceGallery() {
  el.faceGrid.innerHTML = '';
  qbState.faces.forEach((face, i) => {
    const isSelected = qbState.selected.has(face.id);
    const card = document.createElement('div');
    card.className    = `face-card${isSelected ? ' selected' : ''}`;
    card.dataset.fid  = face.id;
    card.title        = `Wajah ${i+1} — ${face.srcName} (${(face.confidence*100).toFixed(0)}% conf)`;
    card.innerHTML    = `
      <img src="${face.cropUrl}" alt="Wajah ${i+1}" />
      <div class="face-card-num">${i+1}</div>
      <div class="face-card-check">✓</div>
      <div class="face-card-src">${esc(shortname(face.srcName, 14))}</div>
    `;
    card.addEventListener('click', () => toggleFaceSelect(face.id));
    el.faceGrid.appendChild(card);
  });
}

function toggleFaceSelect(faceId) {
  if (qbState.selected.has(faceId)) {
    qbState.selected.delete(faceId);
  } else {
    qbState.selected.add(faceId);
  }
  // Update card visual
  el.faceGrid.querySelectorAll('.face-card').forEach(card => {
    const fid = Number(card.dataset.fid);
    card.classList.toggle('selected', qbState.selected.has(fid));
  });
  updateSelectionBar();
  updateSearchBtn();
}

function updateSelectionBar() {
  const n = qbState.selected.size;
  if (n === 0) {
    el.selBar.classList.remove('visible');
    return;
  }
  el.selBar.classList.add('visible');
  el.selCount.textContent = n;

  // Chips
  el.selChips.innerHTML = '';
  Array.from(qbState.selected).slice(0, 5).forEach(fid => {
    const face = qbState.faces.find(f => f.id === fid);
    if (!face) return;
    const chip = document.createElement('div');
    chip.className = 'sel-chip';
    chip.innerHTML = `<img src="${face.cropUrl}" alt="face" />${esc(shortname(face.srcName, 10))}`;
    el.selChips.appendChild(chip);
  });
  if (n > 5) {
    const more = document.createElement('div');
    more.className = 'sel-chip';
    more.textContent = `+${n-5}`;
    el.selChips.appendChild(more);
  }
}

function updateSearchBtn() {
  const canSearch = qbState.selected.size > 0;
  el.btnSearch.disabled = !canSearch;
}

function clearQueryBuilder() {
  qbState.sources  = [];
  qbState.faces    = [];
  qbState.selected.clear();
  el.srcStrip.classList.remove('visible');
  el.facesDivider.style.display = 'none';
  el.faceGallery.classList.remove('visible');
  el.selBar.classList.remove('visible');
  el.faceGrid.innerHTML   = '';
  el.srcThumbs.innerHTML  = '';
  el.fgCount.textContent  = '0';
  el.statFaces.textContent = '0';
  el.btnSearch.disabled = true;
  clearResults();
}

// ═══════════════════════════════════════════════════════
// SEARCH ENGINE
// ═══════════════════════════════════════════════════════
async function runSearch() {
  if (!modelsReady)                 { toast('Model AI belum siap!', 'warning'); return; }
  if (!qbState.selected.size)       { toast('Pilih minimal 1 wajah query!', 'warning'); return; }
  if (!dbState.items.length)        { toast('Database kosong!', 'warning'); return; }

  const threshold  = parseFloat(el.threshold.value);
  const maxDist    = sim2dist(threshold);

  const chkGroq = document.getElementById('chk-groq-ai');
  const useGroq = chkGroq && chkGroq.checked && (CONFIG.GROQ_API_KEY || CONFIG.GEMINI_API_KEY || CONFIG.OPENROUTER_API_KEY);

  // Get selected face descriptors
  const queryFaces = qbState.faces.filter(f => qbState.selected.has(f.id));

  // Show processing
  showProcessing(true, `Membandingkan ${dbState.items.length} foto vs ${queryFaces.length} wajah kueri…`);
  el.btnSearch.disabled = true;
  await sleep(40);

  let results = [];

  for (const item of dbState.items) {
    if (!item.descriptors || !item.descriptors.length) continue;

    // For each query face, find best match in this item
    let bestDist     = Infinity;
    let bestQueryIdx = 0;
    let bestFaceIdx  = -1;

    for (let qi = 0; qi < queryFaces.length; qi++) {
      const qFace = queryFaces[qi];
      const qDesc = qFace.descriptor;
      
      item.descriptors.forEach((dbDesc, dbIdx) => {
        let dist = euclidean(qDesc, new Float32Array(dbDesc));

        // ── Groq AI semantic mismatch check ──
        if (useGroq && item.groqMeta) {
          const parentSrc = qbState.sources.find(s => s.id === qFace.srcId);
          if (parentSrc && parentSrc.groqMeta) {
            const qMeta = parentSrc.groqMeta;
            const dbMeta = item.groqMeta;
            
            // Gender mismatch: if genders disagree, apply distance penalty to exclude the match
            if (qMeta.gender && dbMeta.gender &&
                qMeta.gender !== 'keduanya' && dbMeta.gender !== 'keduanya' &&
                qMeta.gender !== 'tidak_ada' && dbMeta.gender !== 'tidak_ada' &&
                qMeta.gender !== dbMeta.gender) {
              dist = Math.max(dist, 0.92); // low similarity penalty (~54%)
            }
          }
        }

        if (dist < bestDist) {
          bestDist     = dist;
          bestQueryIdx = qi;
          bestFaceIdx  = dbIdx;
        }
      });
    }

    if (bestDist <= maxDist) {
      results.push({
        id:          item.id,
        name:        item.name,
        dataUrl:     item.dataUrl,
        distance:    bestDist,
        similarity:  dist2sim(bestDist),
        queryFace:   queryFaces[bestQueryIdx],
        faceCount:   item.faceCount,
        faces:       item.faces,
        matchFaceIdx: bestFaceIdx,
        groqMeta:    item.groqMeta // carry over for detail view if needed
      });
    }
  }

  sortResultsArr(results);

  // ── Groq AI Assistant Verification ──

  if (useGroq && results.length > 0) {
    const topCount = Math.min(3, results.length);
    updateProgressOverlay(true, 'Verifikasi Asisten AI (Cloud)', 0, topCount, 'Menghubungi AI Cloud...');
    
    let completed = 0;
    const promises = [];
    
    for (let i = 0; i < topCount; i++) {
      const resItem = results[i];
      promises.push((async () => {
        try {
          // Crop the exact matching face from DB photo for precise AI comparison
          let dbFaceCropUrl = resItem.dataUrl;
          if (resItem.faces && resItem.matchFaceIdx >= 0 && resItem.faces[resItem.matchFaceIdx]) {
            const face = resItem.faces[resItem.matchFaceIdx];
            const faceBox = face.box;
            const tempImg = await loadImg(resItem.dataUrl);
            const W = tempImg.naturalWidth || tempImg.width;
            const H = tempImg.naturalHeight || tempImg.height;
            const absBox = {
              x:      faceBox.x      * W,
              y:      faceBox.y      * H,
              width:  faceBox.width  * W,
              height: faceBox.height * H
            };
            dbFaceCropUrl = cropFace(tempImg, absBox);
          }
          const aiResult = await verifyFaceWithAI(resItem.queryFace.cropUrl, dbFaceCropUrl);
          resItem.aiVerified = {
            same: !!aiResult.same,
            confidence: Number(aiResult.confidence || 0),
            reason: String(aiResult.reason || ''),
            biometricAnalysis: aiResult.biometricAnalysis || null,
            differencesFound: aiResult.differencesFound || null
          };
        } catch (err) {
          console.error(`AI verification failed for item ${resItem.name}:`, err);
          resItem.aiVerified = {
            error: true,
            reason: err.message
          };
        } finally {
          completed++;
          updateProgressOverlay(true, 'Verifikasi Asisten AI (Cloud)', completed, topCount, `Selesai mengevaluasi: ${resItem.name}`);
        }
      })());
    }
    
    await Promise.all(promises);
    updateProgressOverlay(false);

    // Filter out mismatched results — also exclude low-confidence "same" verdicts
    results = results.filter(item => {
      if (!item.aiVerified) return true;
      if (item.aiVerified.error) return true;  // keep if AI failed (fallback to descriptor)
      if (item.aiVerified.same === false) return false; // AI says different person
      if (item.aiVerified.same === true && item.aiVerified.confidence < 50) return false; // AI very unsure
      return true;
    });
  }

  allResults = results;

  const n   = results.length;
  const top = n ? results[0].similarity.toFixed(1) + '%' : '—';
  el.statRes.textContent = n;
  el.statTop.textContent = top;

  renderResults(results);
  showProcessing(false);
  el.btnSearch.disabled = (qbState.selected.size === 0);

  if (n === 0) {
    toast(`Tidak ditemukan wajah yang melebihi threshold ${threshold}%.`, 'info');
  } else {
    if (useGroq) {
      toast(`Analisis AI Groq selesai! ${n} hasil terindeks.`, 'success');
    } else {
      toast(`${n} hasil ditemukan! Top match: ${top}`, 'success');
    }
  }

  // Switch to results tab on mobile automatically
  const resultsTabBtn = document.querySelector('.tab-btn[data-tab="panel-results"]');
  if (resultsTabBtn && window.innerWidth <= 960) {
    resultsTabBtn.click();
  }
}

function sortResultsArr(arr) {
  if (currentSort === 'sim') {
    arr.sort((a, b) => b.similarity - a.similarity);
  } else {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
}

// ═══════════════════════════════════════════════════════
// RENDER RESULTS
// ═══════════════════════════════════════════════════════
function renderResults(results) {
  el.cntTotal.textContent = allResults.length;
  el.cntShown.textContent = results.length;

  if (results.length === 0) {
    el.resList.style.display = 'none';
    el.resEmpty.style.display = '';
    return;
  }
  el.resEmpty.style.display = 'none';
  el.resList.style.display  = '';
  el.resList.innerHTML = '';

  results.forEach((item, idx) => {
    const rank  = idx + 1;
    const pct   = item.similarity;
    const match = matchLabel(item.distance);
    const color = scoreColor(pct);
    const bar   = barGrad(pct);
    const medal = rank === 1 ? '#1' : rank === 2 ? '#2' : rank === 3 ? '#3' : `#${rank}`;
    const topCls= rank <= 3 ? ` top-${rank}` : '';

    let aiBadgeHtml = '';
    if (item.aiVerified) {
      if (item.aiVerified.error) {
        aiBadgeHtml = `<span class="res-badge badge-ai-error" title="Gagal verifikasi AI: ${esc(item.aiVerified.reason)}">AI Gagal</span>`;
      } else if (item.aiVerified.same) {
        const conf = item.aiVerified.confidence;
        if (conf >= 85) {
          aiBadgeHtml = `<span class="res-badge badge-ai-match" title="AI yakin cocok (${conf}%) — ${esc(item.aiVerified.reason)}">AI Yakin (${conf}%)</span>`;
        } else {
          aiBadgeHtml = `<span class="res-badge badge-ai-unsure" title="AI ragu (${conf}%) — ${esc(item.aiVerified.reason)}">AI Ragu (${conf}%)</span>`;
        }
      } else {
        aiBadgeHtml = `<span class="res-badge badge-ai-mismatch" title="AI: Beda orang (${item.aiVerified.confidence}%) — ${esc(item.aiVerified.reason)}">AI Bedakan</span>`;
      }
    }

    const card = document.createElement('div');
    card.className = `res-card${topCls}`;
    card.dataset.id = item.id;
    card.style.animationDelay = `${idx * 35}ms`;
    card.innerHTML = `
      <div class="res-rank">${medal}</div>
      <div class="res-thumb-wrap" style="position:relative;flex-shrink:0;">
        <img class="res-thumb" src="${item.dataUrl}" alt="${esc(item.name)}" loading="lazy" />
        <canvas class="res-thumb-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></canvas>
      </div>
      <div class="res-info">
        <div class="res-name" title="${esc(item.name)}">${esc(shortname(item.name, 26))}</div>
        <span class="res-badge ${match.cls}">${match.text}</span>
        ${aiBadgeHtml}
        <div class="res-bar-wrap">
          <div class="res-bar" style="width:${pct}%;background:${bar};"></div>
        </div>
      </div>
      <div class="res-score" style="color:${color};">
        ${pct.toFixed(1)}<small style="font-size:.52rem">%</small>
        <small>match</small>
      </div>
      ${item.queryFace ? `
        <div class="res-query-ico" title="Cocok dengan wajah dari: ${esc(item.queryFace.srcName)}">
          <img class="qico-thumb" src="${item.queryFace.cropUrl}" alt="q" />
        </div>` : ''}
    `;
    card.addEventListener('click', () => openDetail(item, rank));
    el.resList.appendChild(card);

    // Draw face ellipse on thumbnail after image loads
    const thumbImg = card.querySelector('.res-thumb');
    const thumbCanvas = card.querySelector('.res-thumb-canvas');
    if (thumbImg && thumbCanvas && item.faces && item.matchFaceIdx >= 0) {
      const drawEllipse = () => {
        const face = item.faces[item.matchFaceIdx];
        if (!face || !face.box) return;
        const natW = thumbImg.naturalWidth;
        const natH = thumbImg.naturalHeight;
        if (!natW || !natH) return;
        const renderW = thumbImg.offsetWidth  || 58;
        const renderH = thumbImg.offsetHeight || 58;
        thumbCanvas.width  = renderW;
        thumbCanvas.height = renderH;

        // Calculate object-fit:cover offset (image is scaled and centered)
        const scale = Math.max(renderW / natW, renderH / natH);
        const scaledW = natW * scale;
        const scaledH = natH * scale;
        const offX = (renderW - scaledW) / 2;  // negative = left crop
        const offY = (renderH - scaledH) / 2;  // negative = top crop

        const b = face.box;
        // Convert normalized box to pixel coords in natural image, then map to rendered position
        const faceCx = (b.x + b.width  / 2) * natW * scale + offX;
        const faceCy = (b.y + b.height / 2) * natH * scale + offY;
        const radiusX = (b.width  * natW * scale) / 2;
        const radiusY = (b.height * natH * scale) / 2;

        const ctx = thumbCanvas.getContext('2d');
        ctx.clearRect(0, 0, renderW, renderH);
        // Glow shadow
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur  = 12;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.ellipse(faceCx, faceCy, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Inner subtle fill
        ctx.shadowBlur  = 0;
        ctx.fillStyle   = 'rgba(34,211,238,0.10)';
        ctx.beginPath();
        ctx.ellipse(faceCx, faceCy, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      if (thumbImg.complete && thumbImg.naturalWidth) {
        drawEllipse();
      } else {
        thumbImg.addEventListener('load', drawEllipse);
      }
    }
  });
}

function clearResults() {
  allResults = [];
  el.resList.innerHTML     = '';
  el.resList.style.display = 'none';
  el.resEmpty.style.display = '';
  el.statRes.textContent   = '—';
  el.statTop.textContent   = '—';
  el.cntTotal.textContent  = '0';
  el.cntShown.textContent  = '0';
}

function showProcessing(show, txt = 'Menganalisis…') {
  el.resProc.classList.toggle('visible', show);
  el.procTxt.textContent = txt;
  if (show) {
    el.resList.style.display  = 'none';
    el.resEmpty.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════
// DETAIL MODAL
// ═══════════════════════════════════════════════════════
async function openDetail(item, rank = null) {
  detailItem = item;
  el.modalName.textContent  = item.name;
  el.modalImg.src           = item.dataUrl;

  const statsContainer = document.querySelector('.modal-stats');
  const isSearchResult = (rank !== null);

  // Fallback: On-the-fly face detection for compatibility with old database items
  if (!item.faces || !item.faces.length) {
    try {
      const tempImg = await loadImg(item.dataUrl);
      const dets = await detectAllFaces(tempImg);
      item.faces = dets.map(d => {
        const box = d.detection.box;
        return {
          box: {
            x: box.x / tempImg.naturalWidth,
            y: box.y / tempImg.naturalHeight,
            width: box.width / tempImg.naturalWidth,
            height: box.height / tempImg.naturalHeight
          },
          descriptor: Array.from(d.descriptor)
        };
      });
      // Save updated item with faces array back to IndexedDB so it's cached
      try {
        await idbPut(JSON.parse(JSON.stringify(item)));
      } catch (dbErr) {
        console.warn('Could not write back updated faces to IDB:', dbErr);
      }
    } catch (err) {
      console.error('Failed on-the-fly face detection in openDetail:', err);
    }
  }

  // Always determine/re-verify matchFaceIdx on the fly for search results to prevent index mismatches
  if (isSearchResult) {
    if (item.queryFace && item.faces && item.faces.length) {
      let bestDist = Infinity;
      let bestIdx = -1;
      const qDesc = item.queryFace.descriptor;
      item.faces.forEach((f, fIdx) => {
        const dist = euclidean(qDesc, new Float32Array(f.descriptor));
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = fIdx;
        }
      });
      item.matchFaceIdx = bestIdx;
    }
  }

  if (isSearchResult) {
    if (statsContainer) statsContainer.style.display = 'grid';
    const match = matchLabel(item.distance);
    el.modalSub.textContent   = `Ranking #${rank} dari ${allResults.length} hasil`;
    el.modalScore.textContent = item.similarity.toFixed(2) + '%';
    el.modalScore.style.color = scoreColor(item.similarity);
    el.modalDist.textContent  = item.distance.toFixed(4);
    el.modalRank.textContent  = `#${rank}`;
    el.modalBadge.innerHTML   = `<span class="res-badge ${match.cls}" style="font-size:.82rem;padding:5px 14px;">${match.text}</span>`;
    
    // Render AI verification block
    renderDetailAI(item, rank);

    // Render face highlights
    renderModalFaceOverlays(item, item.matchFaceIdx);
  } else {
    // Database item view: hide search stats and AI blocks
    if (statsContainer) statsContainer.style.display = 'none';
    el.modalSub.textContent = `Foto terdaftar di Database`;
    el.modalBadge.innerHTML = `<span class="res-badge badge-exact" style="font-size:.82rem;padding:5px 14px;background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.3);">${item.faceCount || 0} Wajah Terdeteksi</span>`;
    
    const aiContainer = document.getElementById('modal-ai-result');
    if (aiContainer) aiContainer.style.display = 'none';

    // Render all detected faces
    renderModalFaceOverlays(item, null);
  }

  el.modalDetail.classList.add('open');
}
function closeDetail() {
  el.modalDetail.classList.remove('open');
  detailItem = null;
  const container = document.getElementById('modal-face-container');
  if (container) container.innerHTML = '';
}

function renderModalFaceOverlays(item, matchIdx = null) {
  const container = document.getElementById('modal-face-container');
  if (!container) return;
  container.innerHTML = ''; // clear previous overlays

  if (!item.faces || !item.faces.length) return;

  item.faces.forEach((face, idx) => {
    const box = face.box;
    if (!box) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-face-overlay';
    overlay.style.position = 'absolute';
    overlay.style.left = `${box.x * 100}%`;
    overlay.style.top = `${box.y * 100}%`;
    overlay.style.width = `${box.width * 100}%`;
    overlay.style.height = `${box.height * 100}%`;
    overlay.style.borderRadius = '50%';
    overlay.style.pointerEvents = 'auto'; // allow hover

    const isMatch = (matchIdx !== null && idx === matchIdx);

    if (isMatch) {
      overlay.style.border = '2.5px solid #22d3ee';
      overlay.style.boxShadow = '0 0 12px rgba(34, 211, 238, 0.75)';
      overlay.style.zIndex = '10';
      
      const badge = document.createElement('div');
      badge.textContent = 'Cocok';
      badge.style.position = 'absolute';
      badge.style.bottom = 'calc(100% + 6px)';
      badge.style.left = '50%';
      badge.style.transform = 'translateX(-50%)';
      badge.style.background = '#22d3ee';
      badge.style.color = '#0b0b0d';
      badge.style.fontSize = '9px';
      badge.style.fontWeight = 'bold';
      badge.style.padding = '3px 8px';
      badge.style.borderRadius = '4px';
      badge.style.whiteSpace = 'nowrap';
      badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      overlay.appendChild(badge);
    } else {
      overlay.style.border = '1.5px dashed rgba(255,255,255,0.35)';
      overlay.style.transition = 'border 0.2s ease, background 0.2s ease';
      
      overlay.addEventListener('mouseenter', () => {
        overlay.style.border = '1.5px solid #a855f7';
        overlay.style.background = 'rgba(168,85,247,0.1)';
      });
      overlay.addEventListener('mouseleave', () => {
        overlay.style.border = '1.5px dashed rgba(255,255,255,0.35)';
        overlay.style.background = 'transparent';
      });
    }

    container.appendChild(overlay);
  });
}

async function analyzeImageWithGroq(imgDataUrl, modelName = "qwen/qwen3.6-27b") {
  const apiKey = CONFIG.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const payload = {
      model: modelName,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analisis gambar ini. Jika terdapat wajah manusia, identifikasi karakteristik visual utamanya. Wajib output dalam format JSON mentah tanpa markdown: {\"hasFace\": true/false, \"faceCount\": 0, \"gender\": \"pria\"|\"wanita\"|\"keduanya\"|\"tidak_ada\", \"details\": \"deskripsi singkat pakaian, kacamata, hijab, warna rambut (maksimal 15 kata)\"}"
            },
            {
              type: "image_url",
              image_url: {
                url: imgDataUrl
              }
            }
          ]
        }
      ],
      response_format: {
        type: "json_object"
      },
      temperature: 0.1
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (err) {
    console.warn(`Groq Vision upload analysis failed for ${modelName}:`, err.message);
    throw err;
  }
}

async function analyzeImageWithGemini(imgDataUrl, modelName = "gemini-2.5-flash") {
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const cleanBase64 = imgDataUrl.split(',')[1];
    const payload = {
      contents: [
        {
          parts: [
            {
              text: "Analisis gambar ini. Jika terdapat wajah manusia, identifikasi karakteristik visual utamanya. Wajib output dalam format JSON mentah tanpa markdown: {\"hasFace\": true/false, \"faceCount\": 0, \"gender\": \"pria\"|\"wanita\"|\"keduanya\"|\"tidak_ada\", \"details\": \"deskripsi singkat pakaian, kacamata, hijab, warna rambut (maksimal 15 kata)\"}"
            },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates[0].content.parts[0].text;
    return JSON.parse(content);
  } catch (err) {
    console.warn(`Gemini Vision upload analysis failed for ${modelName}:`, err.message);
    throw err;
  }
}

async function analyzeImageWithAI(imgDataUrl) {
  // 1. Try OpenRouter Models first (highest priority, most tokens/models)
  if (CONFIG.OPENROUTER_API_KEY) {
    const openRouterModels = [
      'meta-llama/llama-3.2-11b-vision-instruct',
      'meta-llama/llama-3.2-90b-vision-instruct',
      'google/gemini-2.5-flash',
      'qwen/qwen-2-vl-7b-instruct'
    ];
    for (const model of openRouterModels) {
      try {
        console.log(`Trying OpenRouter upload analysis with model: ${model}`);
        const res = await analyzeImageWithOpenRouter(imgDataUrl, model);
        if (res) return res;
      } catch (err) {
        console.warn(`OpenRouter model ${model} failed, trying next fallback...`);
      }
    }
  }

  // 2. Try Groq Models (Layer 1 fallback)
  if (CONFIG.GROQ_API_KEY) {
    const groqModels = ['llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview', 'qwen/qwen3.6-27b', 'meta-llama/llama-4-scout-17b-16e-instruct'];
    for (const model of groqModels) {
      try {
        console.log(`Trying Groq upload analysis with model: ${model}`);
        const res = await analyzeImageWithGroq(imgDataUrl, model);
        if (res) return res;
      } catch (err) {
        console.warn(`Groq model ${model} failed, trying next fallback...`);
      }
    }
  }

  // 3. Try Gemini Models (Layer 2 fallback)
  if (CONFIG.GEMINI_API_KEY) {
    const geminiModels = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    for (const model of geminiModels) {
      try {
        console.log(`Trying Gemini upload analysis with model: ${model}`);
        const res = await analyzeImageWithGemini(imgDataUrl, model);
        if (res) return res;
      } catch (err) {
        console.warn(`Gemini model ${model} failed, trying next fallback...`);
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════
// CLOUD VISION VERIFICATION (OpenRouter / Groq / Gemini)
// ═══════════════════════════════════════════════════════
async function verifyWithOpenRouter(queryFaceUrl, dbPhotoUrl, modelName = "meta-llama/llama-3.2-11b-vision-instruct") {
  const apiKey = CONFIG.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OpenRouter API Key tidak ditemukan.');

  const verifyPrompt = `Kamu adalah pakar forensik biometrik wajah digital tingkat dunia. Tugasmu adalah melakukan analisis komparatif wajah antara Gambar 1 dan Gambar 2 secara sangat detail dan objektif untuk menentukan apakah mereka orang yang SAMA PERSIS.

Langkah Analisis Biometrik:
1. Analisis Mata: Periksa bentuk mata, kelopak mata (monolid/double eyelid), jarak antar mata, dan kemiringan sudut mata luar.
2. Analisis Hidung: Periksa bentuk ujung hidung (bulat/runcing/datar), lebar cuping hidung, dan kelurusan jembatan hidung.
3. Analisis Bibir & Rahang: Periksa ketebalan bibir atas/bawah, lekukan busur Cupid, garis rahang, bentuk dagu (lebar, runcing, atau belah).
4. Analisis Proporsi & Struktur Tulang: Periksa lebar dahi, posisi tulang pipi, dan rasio panjang wajah dibandingkan lebar wajah.

PERINGATAN KETAT:
- Riasan pengantin (wedding makeup), pencahayaan, ekspresi senyum/datar, sudut foto, penutup kepala (spt kopiah/blangkon/hijab), atau keberadaan jerawat/tahi lalat/kacamata TIDAK BOLEH memengaruhi keputusan Anda. Fokus HANYA pada struktur tulang dan biometrik dasar.
- Jika ada perbedaan struktural biometrik sekecil apa pun yang menunjukkan mereka orang berbeda, Anda WAJIB menetapkan same=false.

Wajib keluarkan output dalam format JSON valid berikut (tanpa pembungkus markdown):
{
  "biometricAnalysis": {
    "eyes": "analisis komparatif mata Gambar 1 vs Gambar 2",
    "nose": "analisis komparatif hidung Gambar 1 vs Gambar 2",
    "mouthAndJaw": "analisis komparatif bibir, dagu, rahang Gambar 1 vs Gambar 2",
    "faceShapeAndBone": "analisis bentuk wajah & struktur tulang Gambar 1 vs Gambar 2"
  },
  "differencesFound": [
    "tulis perbedaan spesifik yang ditemukan, atau kosongkan [] jika tidak ada"
  ],
  "same": true/false,
  "confidence": 0-100,
  "reason": "Penjelasan singkat keputusan akhir dalam bahasa Indonesia (maksimal 20 kata)"
}`;

  const payload = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: verifyPrompt
          },
          {
            type: "image_url",
            image_url: {
              url: queryFaceUrl
            }
          },
          {
            type: "image_url",
            image_url: {
              url: dbPhotoUrl
            }
          }
        ]
      }
    ],
    temperature: 0.05
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/fikrihaikal17/face-search-ai',
      'X-Title': 'Face Search AI'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content.trim();
  const cleanJson = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleanJson);
}

async function analyzeImageWithOpenRouter(imgDataUrl, modelName = "meta-llama/llama-3.2-11b-vision-instruct") {
  const apiKey = CONFIG.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  try {
    const payload = {
      model: modelName,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analisis gambar ini. Jika terdapat wajah manusia, identifikasi karakteristik visual utamanya. Wajib output dalam format JSON mentah tanpa markdown: {\"hasFace\": true/false, \"faceCount\": 0, \"gender\": \"pria\"|\"wanita\"|\"keduanya\"|\"tidak_ada\", \"details\": \"deskripsi singkat pakaian, kacamata, hijab, warna rambut (maksimal 15 kata)\"}"
            },
            {
              type: "image_url",
              image_url: {
                url: imgDataUrl
              }
            }
          ]
        }
      ],
      temperature: 0.1
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/fikrihaikal17/face-search-ai',
        'X-Title': 'Face Search AI'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content.trim();
    const cleanJson = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.warn(`OpenRouter Vision upload analysis failed for ${modelName}:`, err.message);
    throw err;
  }
}

async function verifyWithGroq(queryFaceUrl, dbPhotoUrl, modelName = "qwen/qwen3.6-27b") {
  const apiKey = CONFIG.GROQ_API_KEY;
  if (!apiKey) throw new Error('Groq API Key tidak ditemukan.');

  const verifyPrompt = `Kamu adalah pakar forensik biometrik wajah digital tingkat dunia. Tugasmu adalah melakukan analisis komparatif wajah antara Gambar 1 dan Gambar 2 secara sangat detail dan objektif untuk menentukan apakah mereka orang yang SAMA PERSIS.

Langkah Analisis Biometrik:
1. Analisis Mata: Periksa bentuk mata, kelopak mata (monolid/double eyelid), jarak antar mata, dan kemiringan sudut mata luar.
2. Analisis Hidung: Periksa bentuk ujung hidung (bulat/runcing/datar), lebar cuping hidung, dan kelurusan jembatan hidung.
3. Analisis Bibir & Rahang: Periksa ketebalan bibir atas/bawah, lekukan busur Cupid, garis rahang, bentuk dagu (lebar, runcing, atau belah).
4. Analisis Proporsi & Struktur Tulang: Periksa lebar dahi, posisi tulang pipi, dan rasio panjang wajah dibandingkan lebar wajah.

PERINGATAN KETAT:
- Riasan pengantin (wedding makeup), pencahayaan, ekspresi senyum/datar, sudut foto, penutup kepala (spt kopiah/blangkon/hijab), atau keberadaan jerawat/tahi lalat/kacamata TIDAK BOLEH memengaruhi keputusan Anda. Fokus HANYA pada struktur tulang dan biometrik dasar.
- Jika ada perbedaan struktural biometrik sekecil apa pun yang menunjukkan mereka orang berbeda, Anda WAJIB menetapkan same=false.

Wajib keluarkan output dalam format JSON valid berikut (tanpa pembungkus markdown):
{
  "biometricAnalysis": {
    "eyes": "analisis komparatif mata Gambar 1 vs Gambar 2",
    "nose": "analisis komparatif hidung Gambar 1 vs Gambar 2",
    "mouthAndJaw": "analisis komparatif bibir, dagu, rahang Gambar 1 vs Gambar 2",
    "faceShapeAndBone": "analisis bentuk wajah & struktur tulang Gambar 1 vs Gambar 2"
  },
  "differencesFound": [
    "tulis perbedaan spesifik yang ditemukan, atau kosongkan [] jika tidak ada"
  ],
  "same": true/false,
  "confidence": 0-100,
  "reason": "Penjelasan singkat keputusan akhir dalam bahasa Indonesia (maksimal 20 kata)"
}`;

  const payload = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: verifyPrompt
          },
          {
            type: "image_url",
            image_url: {
              url: queryFaceUrl
            }
          },
          {
            type: "image_url",
            image_url: {
              url: dbPhotoUrl
            }
          }
        ]
      }
    ],
    response_format: {
      type: "json_object"
    },
    temperature: 0.05
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function verifyWithGemini(queryFaceUrl, dbPhotoUrl, modelName = "gemini-2.5-flash") {
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API Key tidak ditemukan.');

  const cleanBase64 = (dataUrl) => dataUrl.split(',')[1];

  const verifyPrompt = `Kamu adalah pakar forensik biometrik wajah digital tingkat dunia. Tugasmu adalah melakukan analisis komparatif wajah antara Gambar 1 dan Gambar 2 secara sangat detail dan objektif untuk menentukan apakah mereka orang yang SAMA PERSIS.

Langkah Analisis Biometrik:
1. Analisis Mata: Periksa bentuk mata, kelopak mata (monolid/double eyelid), jarak antar mata, dan kemiringan sudut mata luar.
2. Analisis Hidung: Periksa bentuk ujung hidung (bulat/runcing/datar), lebar cuping hidung, dan kelurusan jembatan hidung.
3. Analisis Bibir & Rahang: Periksa ketebalan bibir atas/bawah, lekukan busur Cupid, garis rahang, bentuk dagu (lebar, runcing, atau belah).
4. Analisis Proporsi & Struktur Tulang: Periksa lebar dahi, posisi tulang pipi, dan rasio panjang wajah dibandingkan lebar wajah.

PERINGATAN KETAT:
- Riasan pengantin (wedding makeup), pencahayaan, ekspresi senyum/datar, sudut foto, penutup kepala (spt kopiah/blangkon/hijab), atau keberadaan jerawat/tahi lalat/kacamata TIDAK BOLEH memengaruhi keputusan Anda. Fokus HANYA pada struktur tulang dan biometrik dasar.
- Jika ada perbedaan struktural biometrik sekecil apa pun yang menunjukkan mereka orang berbeda, Anda WAJIB menetapkan same=false.

Wajib keluarkan output dalam format JSON valid berikut (tanpa pembungkus markdown):
{
  "biometricAnalysis": {
    "eyes": "analisis komparatif mata Gambar 1 vs Gambar 2",
    "nose": "analisis komparatif hidung Gambar 1 vs Gambar 2",
    "mouthAndJaw": "analisis komparatif bibir, dagu, rahang Gambar 1 vs Gambar 2",
    "faceShapeAndBone": "analisis bentuk wajah & struktur tulang Gambar 1 vs Gambar 2"
  },
  "differencesFound": [
    "tulis perbedaan spesifik yang ditemukan, atau kosongkan [] jika tidak ada"
  ],
  "same": true/false,
  "confidence": 0-100,
  "reason": "Penjelasan singkat keputusan akhir dalam bahasa Indonesia (maksimal 20 kata)"
}`;

  const payload = {
    contents: [
      {
        parts: [
          {
            text: verifyPrompt
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64(queryFaceUrl)
            }
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64(dbPhotoUrl)
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.05
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates[0].content.parts[0].text;
  return JSON.parse(content);
}

async function verifyFaceWithAI(queryFaceUrl, dbPhotoUrl) {
  // 1. Try OpenRouter Models first (highest priority, most tokens/models)
  if (CONFIG.OPENROUTER_API_KEY) {
    const openRouterModels = [
      'meta-llama/llama-3.2-11b-vision-instruct',
      'meta-llama/llama-3.2-90b-vision-instruct',
      'google/gemini-2.5-flash',
      'qwen/qwen-2-vl-7b-instruct'
    ];
    for (const model of openRouterModels) {
      try {
        console.log(`Trying OpenRouter verification with model: ${model}`);
        return await verifyWithOpenRouter(queryFaceUrl, dbPhotoUrl, model);
      } catch (err) {
        console.warn(`OpenRouter Vision model ${model} failed: ${err.message}`);
      }
    }
  }

  // 2. Try Groq Models (Layer 1 fallback)
  if (CONFIG.GROQ_API_KEY) {
    const groqModels = ['llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview', 'qwen/qwen3.6-27b', 'meta-llama/llama-4-scout-17b-16e-instruct'];
    for (const model of groqModels) {
      try {
        console.log(`Trying Groq verification with model: ${model}`);
        return await verifyWithGroq(queryFaceUrl, dbPhotoUrl, model);
      } catch (err) {
        console.warn(`Groq Vision model ${model} failed: ${err.message}`);
      }
    }
  }

  // 3. Try Gemini Models (Layer 2 fallback)
  if (CONFIG.GEMINI_API_KEY) {
    const geminiModels = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    for (const model of geminiModels) {
      try {
        console.log(`Trying Gemini verification with model: ${model}`);
        return await verifyWithGemini(queryFaceUrl, dbPhotoUrl, model);
      } catch (err) {
        console.warn(`Gemini Vision model ${model} failed: ${err.message}`);
      }
    }
  }

  throw new Error('Semua model AI (OpenRouter / Groq / Gemini) mengalami gangguan atau tidak dapat diakses saat ini.');
}

function renderDetailAI(item, rank) {
  const container = document.getElementById('modal-ai-result');
  if (!container) return;

  if (!item.queryFace) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  if (item.aiVerified) {
    if (item.aiVerified.error) {
      container.innerHTML = `
        <div class="detail-ai-box error">
          <div class="ai-box-title">Gagal Verifikasi AI</div>
          <div class="ai-box-desc">${esc(item.aiVerified.reason)}</div>
        </div>
      `;
    } else if (item.aiVerified.same) {
      let bioHtml = '';
      if (item.aiVerified.biometricAnalysis) {
        const bio = item.aiVerified.biometricAnalysis;
        bioHtml = `
          <div class="ai-bio-details" style="margin-top: 12px; font-size: 0.75rem; color: var(--fg-muted); text-align: left; background: rgba(168,85,247,0.04); padding: 10px; border-radius: 8px; border: 1px solid rgba(168,85,247,0.15); width: 100%;">
            <div style="font-weight: 600; color: #a855f7; margin-bottom: 6px;">Analisis Komparatif Biometrik:</div>
            <div style="margin-bottom: 4px;"><strong>👁️ Mata:</strong> ${esc(bio.eyes)}</div>
            <div style="margin-bottom: 4px;"><strong>👃 Hidung:</strong> ${esc(bio.nose)}</div>
            <div style="margin-bottom: 4px;"><strong>👄 Bibir & Rahang:</strong> ${esc(bio.mouthAndJaw)}</div>
            <div><strong>💀 Struktur Wajah:</strong> ${esc(bio.faceShapeAndBone)}</div>
          </div>
        `;
      }
      container.innerHTML = `
        <div class="detail-ai-box match" style="flex-wrap: wrap;">
          <div class="ai-box-title" style="width: 100%;">AI Verified: Cocok (${item.aiVerified.confidence}%)</div>
          <div class="ai-box-desc" style="width: 100%;">${esc(item.aiVerified.reason)}</div>
          ${bioHtml}
        </div>
      `;
    } else {
      let bioHtml = '';
      if (item.aiVerified.biometricAnalysis) {
        const bio = item.aiVerified.biometricAnalysis;
        const diffs = item.aiVerified.differencesFound || [];
        const diffsHtml = diffs.length > 0 
          ? `<div style="margin-top: 6px; color: #ef4444;"><strong>⚠️ Perbedaan Terdeteksi:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">${diffs.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>`
          : '';
        bioHtml = `
          <div class="ai-bio-details" style="margin-top: 12px; font-size: 0.75rem; color: var(--fg-muted); text-align: left; background: rgba(239,68,68,0.04); padding: 10px; border-radius: 8px; border: 1px solid rgba(239,68,68,0.15); width: 100%;">
            <div style="font-weight: 600; color: #ef4444; margin-bottom: 6px;">Analisis Komparatif Biometrik:</div>
            <div style="margin-bottom: 4px;"><strong>👁️ Mata:</strong> ${esc(bio.eyes)}</div>
            <div style="margin-bottom: 4px;"><strong>👃 Hidung:</strong> ${esc(bio.nose)}</div>
            <div style="margin-bottom: 4px;"><strong>👄 Bibir & Rahang:</strong> ${esc(bio.mouthAndJaw)}</div>
            <div style="margin-bottom: 4px;"><strong>💀 Struktur Wajah:</strong> ${esc(bio.faceShapeAndBone)}</div>
            ${diffsHtml}
          </div>
        `;
      }
      container.innerHTML = `
        <div class="detail-ai-box mismatch" style="flex-wrap: wrap;">
          <div class="ai-box-title" style="width: 100%;">AI Verified: Tidak Cocok (${item.aiVerified.confidence}%)</div>
          <div class="ai-box-desc" style="width: 100%;">${esc(item.aiVerified.reason)}</div>
          ${bioHtml}
        </div>
      `;
    }
  } else {
    // Show manual verification button
    container.innerHTML = `
      <div class="detail-ai-box unverified">
        <span style="font-weight: 500;">Verifikasi foto ini dengan Asisten AI (Cloud)</span>
        <button class="btn btn-ghost" id="btn-detail-verify-ai" style="padding: 6px 14px; font-size: .72rem; border-color: rgba(168,85,247,0.3); color: #c084fc; border-radius: 8px;">Mulai AI</button>
      </div>
    `;

    const btn = document.getElementById('btn-detail-verify-ai');
    if (btn) {
      btn.addEventListener('click', async () => {
        container.innerHTML = `
          <div class="detail-ai-box unverified" style="justify-content: center; padding: 16px;">
            <div style="width: 14px; height: 14px; border: 2px solid var(--bd); border-top-color: #a855f7; border-radius: 50%; animation: spin .8s linear infinite; margin-right: 10px;"></div>
            <span>Menganalisis wajah dengan AI Vision…</span>
          </div>
        `;
        try {
          // Crop the exact matching face from DB photo for precise AI comparison
          let dbFaceCropUrl = item.dataUrl;
          if (item.faces && item.matchFaceIdx >= 0 && item.faces[item.matchFaceIdx]) {
            const face = item.faces[item.matchFaceIdx];
            const faceBox = face.box;
            const tempImg = await loadImg(item.dataUrl);
            const W = tempImg.naturalWidth || tempImg.width;
            const H = tempImg.naturalHeight || tempImg.height;
            const absBox = {
              x:      faceBox.x      * W,
              y:      faceBox.y      * H,
              width:  faceBox.width  * W,
              height: faceBox.height * H
            };
            dbFaceCropUrl = cropFace(tempImg, absBox);
          }

          const result = await verifyFaceWithAI(item.queryFace.cropUrl, dbFaceCropUrl);
          item.aiVerified = {
            same: !!result.same,
            confidence: Number(result.confidence || 0),
            reason: String(result.reason || ''),
            biometricAnalysis: result.biometricAnalysis || null,
            differencesFound: result.differencesFound || null
          };
          toast('Verifikasi AI selesai!', 'success');
        } catch (err) {
          console.error(err);
          item.aiVerified = {
            error: true,
            reason: err.message
          };
          toast('Gagal verifikasi AI: ' + err.message, 'error');
        }
        renderDetailAI(item, rank);
        renderResults(allResults);
      });
    }
  }
}


// ═══════════════════════════════════════════════════════
// WEBCAM
// ═══════════════════════════════════════════════════════
let webcamDetectLoopActive = false;
let wcamFaceDetectedStartTs = null;

async function startWebcamDetectLoop() {
  webcamDetectLoopActive = true;
  wcamFaceDetectedStartTs = null;
  detectWebcamFaceFrame();
}

async function detectWebcamFaceFrame() {
  if (!webcamDetectLoopActive || !wcStream) return;
  try {
    const video = el.wcamVideo;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const det = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }));
      
      // Update guide overlay class
      const container = document.querySelector('.webcam-container');
      if (container) {
        container.classList.toggle('face-detected', !!det);
      }

      // Draw bounding box on canvas overlay
      const canvas = document.getElementById('wcam-canvas-overlay');
      if (canvas) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        drawWebcamFaceBox(canvas, det);
      }

      // Auto Capture countdown logic
      const cdEl = document.getElementById('wcam-countdown');
      const autoChk = document.getElementById('wcam-auto-capture');
      const useAuto = autoChk && autoChk.checked;

      if (det && useAuto) {
        if (!wcamFaceDetectedStartTs) {
          wcamFaceDetectedStartTs = Date.now();
        }
        const elapsed = Date.now() - wcamFaceDetectedStartTs;
        if (elapsed >= 3000) {
          wcamFaceDetectedStartTs = null;
          if (cdEl) cdEl.style.display = 'none';
          await captureWebcam();
          return;
        } else {
          const remaining = Math.ceil((3000 - elapsed) / 1000);
          if (cdEl) {
            cdEl.textContent = remaining;
            cdEl.style.display = 'flex';
          }
        }
      } else {
        wcamFaceDetectedStartTs = null;
        if (cdEl) cdEl.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error in webcam face detection:', err);
  }
  if (webcamDetectLoopActive && wcStream) {
    setTimeout(() => {
      requestAnimationFrame(detectWebcamFaceFrame);
    }, 150);
  }
}

function stopWebcamDetectLoop() {
  webcamDetectLoopActive = false;
  wcamFaceDetectedStartTs = null;
  const cdEl = document.getElementById('wcam-countdown');
  if (cdEl) cdEl.style.display = 'none';
  const container = document.querySelector('.webcam-container');
  if (container) container.classList.remove('face-detected');
  const canvas = document.getElementById('wcam-canvas-overlay');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawWebcamFaceBox(canvas, det) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!det) return;

  const box = det.box || (det.detection && det.detection.box);
  if (!box) return;
  const color = '#22d3ee'; // Elegant Cyan overlay
  
  // Semi-transparent target fill
  ctx.fillStyle = 'rgba(34, 211, 238, 0.06)';
  ctx.fillRect(box.x, box.y, box.width, box.height);

  // Set borders
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.shadowBlur = 0;

  // Bracket Corners
  const len = Math.min(18, box.width * 0.18);
  ctx.lineWidth = 3;
  
  // Top-Left
  ctx.beginPath(); ctx.moveTo(box.x + len, box.y); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x, box.y + len); ctx.stroke();
  // Top-Right
  ctx.beginPath(); ctx.moveTo(box.x + box.width - len, box.y); ctx.lineTo(box.x + box.width, box.y); ctx.lineTo(box.x + box.width, box.y + len); ctx.stroke();
  // Bottom-Left
  ctx.beginPath(); ctx.moveTo(box.x + len, box.y + box.height); ctx.lineTo(box.x, box.y + box.height); ctx.lineTo(box.x, box.y + box.height - len); ctx.stroke();
  // Bottom-Right
  ctx.beginPath(); ctx.moveTo(box.x + box.width - len, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height); ctx.lineTo(box.x + box.width, box.y + box.height - len); ctx.stroke();

  // Draw visual "Face Verified" pill label
  const score = det.score || (det.detection && det.detection.score) || 0;
  const label = `VERIFIKASI WAJAH (${(score * 100).toFixed(0)}%)`;
  ctx.font = 'bold 10px Inter, sans-serif';
  const textWidth = ctx.measureText(label).width;
  const lx = box.x + (box.width - textWidth) / 2;
  const ly = box.y - 12;

  // Pill BG
  ctx.fillStyle = 'rgba(11, 11, 13, 0.88)';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(lx - 8, ly - 13, textWidth + 16, 18, 4);
    ctx.fill();
  } else {
    ctx.fillRect(lx - 8, ly - 13, textWidth + 16, 18);
  }

  // Text
  ctx.fillStyle = '#22d3ee';
  ctx.fillText(label, lx, ly);
}

async function openWebcam(target) {
  wcTarget = target;
  wcamMirrored = true; // Start mirrored by default
  el.wcamVideo.classList.remove('unmirrored');
  const canvasOverlay = document.getElementById('wcam-canvas-overlay');
  if (canvasOverlay) canvasOverlay.classList.remove('unmirrored');
  el.wcamMirror.classList.add('active');
  try {
    wcStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      },
      audio: false
    });
    el.wcamVideo.srcObject = wcStream;
    el.modalWcam.classList.add('open');
    startWebcamDetectLoop();
  } catch(err) {
    toast('Tidak bisa akses kamera: ' + err.message, 'error');
  }
}

async function captureWebcam() {
  const v = el.wcamVideo;
  el.wcamCanvas.width  = v.videoWidth;
  el.wcamCanvas.height = v.videoHeight;
  
  const ctx = el.wcamCanvas.getContext('2d');
  ctx.clearRect(0, 0, el.wcamCanvas.width, el.wcamCanvas.height);
  if (wcamMirrored) {
    ctx.save();
    ctx.translate(el.wcamCanvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(v, 0, 0);
  }
  
  const dataUrl = el.wcamCanvas.toDataURL('image/jpeg', 0.95);
  stopWebcam();
  el.modalWcam.classList.remove('open');

  if (wcTarget === 'db') {
    // Add to database
    const imgEl = await loadImg(dataUrl);
    const dets  = await detectAllFaces(imgEl);
    if (!dets.length) { toast('Tidak ada wajah di foto webcam.', 'error'); return; }
    const faces = dets.map(d => {
      const box = d.detection.box;
      return {
        box: {
          x: box.x / imgEl.width,
          y: box.y / imgEl.height,
          width: box.width / imgEl.width,
          height: box.height / imgEl.height
        },
        descriptor: Array.from(d.descriptor)
      };
    });
    await idbAdd({ name: `webcam-${Date.now()}.jpg`, dataUrl, descriptors: dets.map(d => Array.from(d.descriptor)), faces, faceCount: dets.length, ts: Date.now() });
    await refreshDB();
    toast('Foto webcam ditambahkan ke database!', 'success');
  } else {
    // Add as source query
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await addSourceFiles([file]);
  }
}

function stopWebcam() {
  stopWebcamDetectLoop();
  if (wcStream) { wcStream.getTracks().forEach(t => t.stop()); wcStream = null; }
  el.wcamVideo.srcObject = null;
}

// ═══════════════════════════════════════════════════════
// EXPORT / IMPORT DB
// ═══════════════════════════════════════════════════════
async function exportDB() {
  const items = await idbAll();
  if (!items.length) { toast('Database kosong!', 'warning'); return; }
  const blob = new Blob([JSON.stringify(items, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href:url, download:`facesearch-db-${Date.now()}.json` });
  a.click(); URL.revokeObjectURL(url);
  toast(`${items.length} foto di-export!`, 'success');
}
async function importDB(file) {
  try {
    const arr = JSON.parse(await file.text());
    if (!Array.isArray(arr)) throw new Error('Format tidak valid');
    for (const { id, ...rest } of arr) await idbAdd(rest);
    await refreshDB();
    toast(`${arr.length} foto di-import!`, 'success');
  } catch(e) { toast('Import gagal: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
const TOAST_LABELS = { success: 'Berhasil', error: 'Gagal', warning: 'Perhatian', info: 'Informasi' };
const TOAST_ICONS = {
  success: `<svg class="toast-svg success" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
  error:   `<svg class="toast-svg error" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
  warning: `<svg class="toast-svg warning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  info:    `<svg class="toast-svg info" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
};

function toast(msg, type = 'info', dur = 4000) {
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.style.setProperty('--toast-dur', `${dur}ms`);
  div.innerHTML = `
    <span class="toast-ico">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <span class="toast-body">
      <div class="toast-title">${TOAST_LABELS[type] || 'Info'}</div>
      <div class="toast-msg">${esc(msg)}</div>
    </span>
    <button class="toast-close" aria-label="Tutup">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  // Apply progress bar duration
  const after = div.querySelector ? null : null;
  div.style.setProperty('--dur', `${dur}ms`);
  div.style.setProperty('animation-duration', `.38s`);

  const closeBtn = div.querySelector('.toast-close');
  const dismiss = () => { div.classList.add('out'); setTimeout(() => div.remove(), 320); };
  closeBtn.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
  div.addEventListener('click', dismiss);

  el.toastCont.appendChild(div);

  // Animate ::after progress bar
  const style = document.createElement('style');
  const uid = `toast-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  div.dataset.uid = uid;
  style.textContent = `[data-uid="${uid}"]::after { animation: toast-progress ${dur}ms linear forwards; }`;
  document.head.appendChild(style);

  setTimeout(() => { dismiss(); setTimeout(() => style.remove(), 400); }, dur);
}

/**
 * Custom async confirm dialog — replaces browser confirm().
 * @param {string} message - Pesan yang ditampilkan
 * @param {string} [title='Konfirmasi'] - Judul dialog
 * @param {string} [okLabel='Hapus'] - Label tombol OK
 * @param {'danger'|'warning'} [variant='danger'] - Varian warna ikon dan tombol OK
 * @returns {Promise<boolean>}
 */
function showConfirm(message, title = 'Konfirmasi', okLabel = 'Hapus', variant = 'danger') {
  return new Promise(resolve => {
    const modal   = document.getElementById('modal-confirm');
    const titleEl = document.getElementById('confirm-title');
    const msgEl   = document.getElementById('confirm-message');
    const iconWrap= document.getElementById('confirm-icon-wrap');
    const iconEl  = document.getElementById('confirm-icon');
    const okBtn   = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    // Set variant icon
    if (variant === 'danger') {
      iconWrap.className = 'confirm-icon-wrap danger';
      iconEl.innerHTML = `<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>`;
    } else {
      iconWrap.className = 'confirm-icon-wrap';
      iconEl.innerHTML = `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>`;
    }
    titleEl.textContent  = title;
    msgEl.textContent    = message;
    okBtn.textContent    = okLabel;
    modal.classList.add('open');

    const cleanup = (result) => {
      modal.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      resolve(result);
    };
    const onOk      = () => cleanup(true);
    const onCancel  = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === modal) cleanup(false); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
  });
}

// ═══════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc   = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const shortname = (name, max = 20) => {
  const n = String(name).replace(/\.[^/.]+$/,'');
  return n.length > max ? n.slice(0, max) + '…' : n;
};

async function parallelProcess(items, limit, workerFn) {
  const running = new Set();
  for (const item of items) {
    if (running.size >= limit) {
      await Promise.race(running);
    }
    const p = (async () => {
      try {
        await workerFn(item);
      } catch (err) {
        console.error(err);
      }
    })();
    running.add(p);
    p.finally(() => running.delete(p));
  }
  await Promise.all(running);
}

function resizeImageMax(imgEl, maxDim = 1024) {
  const W = imgEl.naturalWidth || imgEl.width;
  const H = imgEl.naturalHeight || imgEl.height;
  if (Math.max(W, H) <= maxDim) return imgEl.src;
  
  const canvas = document.createElement('canvas');
  let w = W, h = H;
  if (w > h) {
    if (w > maxDim) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    }
  } else {
    if (h > maxDim) {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.90);
}
function file2url(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = rej;
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}
function setupDrop(zone, cb) {
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', async e => {
    e.preventDefault(); zone.classList.remove('drag');
    if (!e.dataTransfer.items) {
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
      if (files.length) cb(files);
      return;
    }
    
    // Parse files/folders recursively
    const queue = [];
    for (const item of e.dataTransfer.items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) queue.push(entry);
      }
    }
    
    const files = [];
    while (queue.length > 0) {
      const entry = queue.shift();
      if (entry.isFile) {
        const file = await new Promise(res => entry.file(res, () => res(null)));
        if (file && file.type.startsWith('image/')) {
          files.push(file);
        }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readEntries = () => new Promise(res => reader.readEntries(res, () => res([])));
        let entries = await readEntries();
        while (entries.length > 0) {
          queue.push(...entries);
          entries = await readEntries();
        }
      }
    }
    
    if (files.length) cb(files);
  });
}

// ═══════════════════════════════════════════════════════
// EVENT BINDINGS
// ═══════════════════════════════════════════════════════
function bind() {
  // ── Database uploads ──
  el.dbDrop.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    el.dbFolderIn.click();
  });
  setupDrop(el.dbDrop, files => addFilesToDB(files));
  el.dbFileIn.addEventListener('change',   e => { addFilesToDB(e.target.files); e.target.value=''; });
  el.dbFolderIn.addEventListener('change', e => { addFilesToDB(e.target.files); e.target.value=''; });
  el.dbBtnFiles.addEventListener('click',  e => { e.stopPropagation(); el.dbFileIn.click(); });
  el.dbBtnFolder.addEventListener('click', e => { e.stopPropagation(); el.dbFolderIn.click(); });

  el.btnDbClear.addEventListener('click', async () => {
    const ok = await showConfirm('Semua foto dalam database akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.', 'Hapus Semua Foto?', 'Hapus Semua', 'danger');
    if (!ok) return;
    await idbClear(); await refreshDB(); clearResults();
    toast('Database berhasil dikosongkan.', 'info');
  });
  el.btnDbExport.addEventListener('click', exportDB);
  el.btnDbImport.addEventListener('click', () => el.importIn.click());
  el.importIn.addEventListener('change', e => { if (e.target.files[0]) importDB(e.target.files[0]); e.target.value=''; });

  // ── Source uploads ──
  el.srcDrop.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    el.srcFolderIn.click();
  });
  el.btnSrcFiles.addEventListener('click',  e => { e.stopPropagation(); el.srcFileIn.click(); });
  el.btnSrcFolder.addEventListener('click', e => { e.stopPropagation(); el.srcFolderIn.click(); });
  el.btnSrcWebcam.addEventListener('click', e => { e.stopPropagation(); openWebcam('query'); });
  el.srcFileIn.addEventListener('change',   e => { addSourceFiles(e.target.files); e.target.value=''; });
  el.srcFolderIn.addEventListener('change', e => { addSourceFiles(e.target.files); e.target.value=''; });
  setupDrop(el.srcDrop, files => addSourceFiles(files));

  el.btnSrcAdd.addEventListener('click',   () => el.srcFileIn.click());
  el.btnSrcClear.addEventListener('click', clearQueryBuilder);
  el.btnQbClear.addEventListener('click',  clearQueryBuilder);

  // ── Face gallery ──
  el.btnFgAll.addEventListener('click', () => {
    qbState.faces.forEach(f => qbState.selected.add(f.id));
    renderFaceGallery(); updateSelectionBar(); updateSearchBtn();
  });
  el.btnFgNone.addEventListener('click', () => {
    qbState.selected.clear();
    renderFaceGallery(); updateSelectionBar(); updateSearchBtn();
  });

  // ── Threshold ──
  el.threshold.addEventListener('input', () => {
    const v = el.threshold.value;
    el.tval.textContent = v + '%';
    el.threshold.style.background =
      `linear-gradient(to right,var(--p) ${v}%,rgba(255,255,255,.1) ${v}%)`;
  });
  el.threshold.dispatchEvent(new Event('input'));

  // ── Search ──
  el.btnSearch.addEventListener('click', runSearch);

  // ── Sort ──
  document.querySelectorAll('.sort-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSort = btn.dataset.sort;
      if (allResults.length) { sortResultsArr(allResults); renderResults(allResults); }
    });
  });

  // ── Copy results ──
  el.btnCopy.addEventListener('click', () => {
    if (!allResults.length) { toast('Belum ada hasil!', 'warning'); return; }
    const text = allResults.map((r, i) =>
      `#${i+1}  ${r.name}  —  ${r.similarity.toFixed(2)}%  (dist: ${r.distance.toFixed(4)})`
    ).join('\n');
    navigator.clipboard.writeText(text)
      .then(() => toast('Hasil disalin ke clipboard!', 'success'))
      .catch(() => toast('Gagal salin.', 'error'));
  });

  // ── Detail modal ──
  [el.modalClose, el.modalClose2].forEach(b => b.addEventListener('click', closeDetail));
  el.modalDetail.addEventListener('click', e => { if (e.target === el.modalDetail) closeDetail(); });
  el.modalDel.addEventListener('click', async () => {
    if (!detailItem) return;
    const name = detailItem.name;
    const ok = await showConfirm(`Foto "${shortname(name, 40)}" akan dihapus permanen dari database.`, 'Hapus Foto Ini?', 'Hapus', 'danger');
    if (!ok) return;
    await idbDel(detailItem.id);
    allResults = allResults.filter(r => r.id !== detailItem.id);
    renderResults(allResults);
    await refreshDB();
    closeDetail();
    toast('Foto berhasil dihapus dari database.', 'info');
  });

  // ── Webcam modal ──
  el.btnQbWebcam.addEventListener('click', () => openWebcam('query'));
  el.wcamCapture.addEventListener('click', captureWebcam);
  el.wcamMirror.addEventListener('click', () => {
    wcamMirrored = !wcamMirrored;
    el.wcamVideo.classList.toggle('unmirrored', !wcamMirrored);
    const canvasOverlay = document.getElementById('wcam-canvas-overlay');
    if (canvasOverlay) canvasOverlay.classList.toggle('unmirrored', !wcamMirrored);
    el.wcamMirror.classList.toggle('active', wcamMirrored);
  });
  el.wcamStop.addEventListener('click',    () => { stopWebcam(); el.modalWcam.classList.remove('open'); });
  el.wcamClose.addEventListener('click',   () => { stopWebcam(); el.modalWcam.classList.remove('open'); });
  el.modalWcam.addEventListener('click',  e => { if (e.target === el.modalWcam) { stopWebcam(); el.modalWcam.classList.remove('open'); } });

  // ── Tutorial modal ──
  if (el.btnTutorial) {
    el.btnTutorial.addEventListener('click', () => el.modalTutorial.classList.add('open'));
  }
  const closeTutorial = () => el.modalTutorial.classList.remove('open');
  [el.tutorialClose, el.tutorialClose2].forEach(b => {
    if (b) b.addEventListener('click', closeTutorial);
  });
  if (el.modalTutorial) {
    el.modalTutorial.addEventListener('click', e => { if (e.target === el.modalTutorial) closeTutorial(); });
  }

  // ── Privacy modal ──
  if (el.btnPrivacy) {
    el.btnPrivacy.addEventListener('click', () => el.modalPrivacy.classList.add('open'));
  }
  const closePrivacy = () => el.modalPrivacy.classList.remove('open');
  [el.privacyClose, el.privacyClose2].forEach(b => {
    if (b) b.addEventListener('click', closePrivacy);
  });
  if (el.modalPrivacy) {
    el.modalPrivacy.addEventListener('click', e => { if (e.target === el.modalPrivacy) closePrivacy(); });
  }

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDetail();
      stopWebcam();
      el.modalWcam.classList.remove('open');
      if (el.modalTutorial) el.modalTutorial.classList.remove('open');
      if (el.modalPrivacy)  el.modalPrivacy.classList.remove('open');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { if (!el.btnSearch.disabled) runSearch(); }
  });

  setupMobileTabs();
}

function setupMobileTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = {
    'panel-db': $('panel-db'),
    'panel-query': $('panel-query'),
    'panel-results': $('panel-results')
  };
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      Object.keys(panels).forEach(pKey => {
        if (pKey === target) {
          panels[pKey].classList.add('active-panel');
        } else {
          panels[pKey].classList.remove('active-panel');
        }
      });
    });
  });
}

// Load local configuration (try config.json first, fall back to .env)
async function loadEnv() {
  // 1. Try config.json
  let configLoaded = false;
  try {
    const res = await fetch('config.json');
    if (res.ok) {
      const data = await res.json();
      if (data) {
        if (data.GROQ_API_KEY)  CONFIG.GROQ_API_KEY  = data.GROQ_API_KEY;
        if (data.GEMINI_API_KEY) CONFIG.GEMINI_API_KEY = data.GEMINI_API_KEY;
        if (data.OPENROUTER_API_KEY) CONFIG.OPENROUTER_API_KEY = data.OPENROUTER_API_KEY;
        configLoaded = !!(CONFIG.GROQ_API_KEY || CONFIG.GEMINI_API_KEY || CONFIG.OPENROUTER_API_KEY);
        if (configLoaded) {
          const keys = [];
          if (CONFIG.GROQ_API_KEY)   keys.push('Groq');
          if (CONFIG.GEMINI_API_KEY) keys.push('Gemini');
          if (CONFIG.OPENROUTER_API_KEY) keys.push('OpenRouter');
          console.log(`API Keys loaded from config.json: ${keys.join(', ')}`);
          return;
        }
      }
    }
  } catch (_) {}

  // 2. Fall back to .env
  try {
    const res = await fetch('.env');
    if (!res.ok) return;
    const text = await res.text();
    text.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        CONFIG[key] = val;
      }
    });
    console.log('Local environment configurations loaded from .env.');
  } catch (err) {
    console.warn('Could not load config.json or .env. Running with defaults.');
  }
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
  // Load local environment config first
  await loadEnv();

  try {
    idb = await openIDB();
  } catch(e) {
    toast('Tidak bisa membuka database lokal: ' + e.message, 'error', 8000);
  }

  // Load AI models
  try {
    await loadModels();
    modelsReady = true;
    el.hDot.classList.add('ready');
    el.hModelTxt.textContent = 'Model AI Siap';
  } catch(e) {
    el.hModelTxt.textContent = 'Gagal load model!';
    toast('Gagal memuat model AI. Pastikan Laragon aktif dan folder /models ada.', 'error', 10000);
    console.error(e);
  }

  // Hide loader
  await sleep(300);
  el.loOverlay.classList.add('hidden');

  // Setup events
  bind();

  // Load DB
  await refreshDB();

  // Welcome toast
  setTimeout(() => toast('FaceSearchAI siap! Upload folder foto ke database, lalu pilih wajah yang ingin dicari.', 'info', 6000), 600);
}

window.addEventListener('DOMContentLoaded', init);
