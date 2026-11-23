/*
 * Holographic 3D astronaut (vanilla three.js, no React wrapper, so only the `three` package is needed).
 *
 * Display only: the scene receives a colour level + heartbeat period from the dashboard and never
 * touches telemetry values. The telemetry callouts stay in the SVG overlay of AstronautHologram.jsx.
 *
 * Coordinate system: an orthographic camera maps 1 unit = 1 SVG unit of the 400x300 hologram viewBox
 * (y flipped), so the 3D body lines up exactly with the callout leader lines drawn in the SVG.
 *
 * Model: if `modelUrl` is given (e.g. /models/astronaut.glb) the GLB is loaded and given the hologram
 * material; otherwise (or if loading fails) a detailed astronaut is built from primitives in code.
 */
import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Box3,
    Color,
    CapsuleGeometry,
    CylinderGeometry,
    FrontSide,
    Group,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    OrthographicCamera,
    Points,
    PointsMaterial,
    Quaternion,
    Scene,
    ShaderMaterial,
    SphereGeometry,
    TorusGeometry,
    Vector3,
    WebGLRenderer,
    WireframeGeometry
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const VIEW_W = 400;
const VIEW_H = 300;
const CX = 200;

const COLORS = {
    ok: { base: 0x22d3ee, hot: 0xef4444 },
    medium: { base: 0xfbbf24, hot: 0xf97316 },
    high: { base: 0xf87171, hot: 0xfbbf24 }
};

export const webglAvailable = () => {
    try {
        const c = document.createElement('canvas');
        return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
        return false;
    }
};

const VERT = `
varying vec3 vN;
varying vec3 vW;
void main() {
    vN = normalize(normalMatrix * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
}`;

// fresnel rim + faint horizontal scan lines + a bright band that sweeps up the body
const FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uPulse;
uniform float uOpacity;
uniform float uScanY;
varying vec3 vN;
varying vec3 vW;
void main() {
    float rim = pow(1.0 - abs(normalize(vN).z), 2.0);
    float lines = smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(vW.y * 1.7 - uTime * 1.4)) * 0.1;
    float d = (vW.y - uScanY) / 7.0;
    float scan = exp(-d * d);
    float a = (uOpacity + rim * 0.5 + lines + scan * 0.55) * uPulse;
    vec3 c = uColor * (0.5 + rim * 1.1 + scan * 1.4);
    gl_FragColor = vec4(c, clamp(a, 0.0, 0.92));
}`;

const makeSurface = (opacity, side = FrontSide) => new ShaderMaterial({
    uniforms: {
        uColor: { value: new Color(COLORS.ok.base) },
        uTime: { value: 0 },
        uPulse: { value: 1 },
        uOpacity: { value: opacity },
        uScanY: { value: 0 }
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    blending: AdditiveBlending,
    side
});

const UP = new Vector3(0, 1, 0);

/** Point in figure space: x from centre line, y in SVG units (down), z toward the viewer. */
const P = (x, ySvg, z = 0) => new Vector3(x, VIEW_H - ySvg, z);

export function createHoloScene(container, options = {}) {
    const { modelUrl = '', onReady, onError } = options;

    const disposables = [];
    const track = (o) => { disposables.push(o); return o; };

    let renderer;
    try {
        renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch (err) {
        onError?.(err);
        return { update() {}, dispose() {} };
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    const scene = new Scene();
    const camera = new OrthographicCamera(0, VIEW_W, VIEW_H, 0, 1, 1000);
    camera.position.z = 500;

    const figure = new Group();
    figure.position.set(CX, 0, 0);
    scene.add(figure);

    // materials: body (soft), visor (denser), accent (chest display / indicator lights)
    const bodyMat = track(makeSurface(0.16));
    const visorMat = track(makeSurface(0.42));
    const accentMat = track(makeSurface(0.55));
    const wireMat = track(new LineBasicMaterial({ transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false }));
    const surfaceMats = [bodyMat, visorMat];

    const addMesh = (geometry, material, position, scale, rotation) => {
        track(geometry);
        const mesh = new Mesh(geometry, material);
        if (position) mesh.position.copy(position);
        if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
        if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
        figure.add(mesh);
        if (material === bodyMat || material === visorMat) {
            const wf = new WireframeGeometry(geometry);
            track(wf);
            const lines = new LineSegments(wf, wireMat);
            lines.position.copy(mesh.position);
            lines.scale.copy(mesh.scale);
            lines.rotation.copy(mesh.rotation);
            figure.add(lines);
        }
        return mesh;
    };

    // limb capsule between two figure-space points
    const limb = (a, b, r, material = bodyMat) => {
        const dir = new Vector3().subVectors(b, a);
        const len = Math.max(0.1, dir.length() - 2 * r);
        const mesh = addMesh(new CapsuleGeometry(r, len, 4, 14), material, new Vector3().addVectors(a, b).multiplyScalar(0.5));
        mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
        const wire = figure.children[figure.children.length - 1];
        wire.quaternion.copy(mesh.quaternion);
        return mesh;
    };

    const ring = (p, r, h = 7) => addMesh(new CylinderGeometry(r, r, h, 18, 1, true), bodyMat, p, null, null);

    const buildProcedural = () => {
        // life-support backpack
        addMesh(new RoundedBoxGeometry(92, 76, 34, 3, 10), bodyMat, P(0, 120, -30));
        [104, 132].forEach((y) => {
            addMesh(new RoundedBoxGeometry(14, 4, 8, 2, 2), accentMat, P(-46, y, -22));
            addMesh(new RoundedBoxGeometry(14, 4, 8, 2, 2), accentMat, P(46, y, -22));
        });

        // torso (hard upper torso tapering to the waist) + shoulders + waist ring
        addMesh(new CylinderGeometry(38, 27, 74, 28, 1), bodyMat, P(0, 114, 0), [1, 1, 0.58]);
        [-42, 42].forEach((x) => addMesh(new SphereGeometry(12, 18, 12), bodyMat, P(x, 93, 0), [1, 1, 0.95]));
        addMesh(new CylinderGeometry(29, 29, 8, 24, 1, true), bodyMat, P(0, 151, 0), [1, 1, 0.62]);

        // chest control + ECG display and indicator lights
        addMesh(new RoundedBoxGeometry(36, 28, 5, 2, 3), accentMat, P(0, 110, 22));
        [-9, 0, 9].forEach((x) => addMesh(new SphereGeometry(2.4, 10, 8), accentMat, P(x, 130, 22)));

        // neck ring + helmet + visor + side lights
        addMesh(new CylinderGeometry(23, 23, 11, 22, 1, true), bodyMat, P(0, 74, 0));
        addMesh(new SphereGeometry(1, 24, 18), bodyMat, P(0, 40, 0), [35, 36, 34]);
        addMesh(new SphereGeometry(1, 22, 16), visorMat, P(0, 43, 15), [27, 24, 22]);
        [-39, 39].forEach((x) => addMesh(new RoundedBoxGeometry(7, 16, 8, 2, 2), accentMat, P(x, 38, 0)));

        // arms: upper arm, forearm, elbow + wrist rings, gloves
        [-1, 1].forEach((s) => {
            limb(P(s * 42, 98), P(s * 54, 132), 11);
            limb(P(s * 54, 132), P(s * 53, 166), 9.5);
            ring(P(s * 54, 132, 0), 12.5);
            ring(P(s * 53, 167, 0), 11);
            addMesh(new SphereGeometry(1, 16, 12), bodyMat, P(s * 53, 187, 0), [10.5, 17, 10]);
            addMesh(new SphereGeometry(1, 12, 10), bodyMat, P(s * 43, 182, 4), [4.5, 9, 4.5]);
        });

        // legs: thigh, shin, knee + ankle rings, boots
        [-1, 1].forEach((s) => {
            limb(P(s * 15, 150), P(s * 17, 204), 14);
            limb(P(s * 17, 204), P(s * 15, 244), 11.5);
            ring(P(s * 17, 204, 0), 15.5);
            ring(P(s * 15, 238, 0), 13.5);
            addMesh(new RoundedBoxGeometry(30, 22, 36, 3, 8), bodyMat, P(s * 16, 253, 6));
        });
    };

    const normaliseModel = (root) => {
        const box = new Box3().setFromObject(root);
        const size = box.getSize(new Vector3());
        if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Empty model');
        const k = 262 / size.y; // figure spans y 4..266 of the 300-unit viewBox, like the SVG astronaut
        root.scale.multiplyScalar(k);
        const fitted = new Box3().setFromObject(root);
        const centre = fitted.getCenter(new Vector3());
        root.position.x -= centre.x;
        root.position.z -= centre.z;
        root.position.y += (VIEW_H - 266) - fitted.min.y;
    };

    const useGlb = (root) => {
        normaliseModel(root);
        root.traverse((node) => {
            if (!node.isMesh) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach((m) => {
                Object.values(m || {}).forEach((v) => { if (v && v.isTexture) v.dispose(); });
                m?.dispose?.();
            });
            node.material = bodyMat;
            track(node.geometry);
            const wf = track(new WireframeGeometry(node.geometry));
            const lines = new LineSegments(wf, wireMat);
            node.add(lines);
        });
        figure.add(root);
    };

    // particles floating up around the hologram
    const PARTICLES = 90;
    const pPos = new Float32Array(PARTICLES * 3);
    const pSpeed = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i += 1) {
        pPos[i * 3] = 60 + Math.random() * 280;
        pPos[i * 3 + 1] = Math.random() * VIEW_H;
        pPos[i * 3 + 2] = -60 + Math.random() * 120;
        pSpeed[i] = 2 + Math.random() * 5;
    }
    const pGeo = track(new BufferGeometry());
    pGeo.setAttribute('position', new BufferAttribute(pPos, 3));
    const pMat = track(new PointsMaterial({
        size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.5,
        blending: AdditiveBlending, depthWrite: false
    }));
    const particles = new Points(pGeo, pMat);
    scene.add(particles);

    // ---- state ----
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const target = { base: new Color(COLORS.ok.base), hot: new Color(COLORS.ok.hot), beat: 0.9 };
    const baseNow = new Color(COLORS.ok.base);
    const hotNow = new Color(COLORS.ok.hot);
    const lineNow = new Color(COLORS.ok.base);
    let beat = 0.9;
    let raf = 0;
    let running = false;
    let visible = true;
    let disposed = false;
    let last = performance.now();
    let clock = 0;

    const resize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) renderer.setSize(w, h, false);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); renderOnce(); }) : null;
    ro?.observe(container);

    const applyColours = () => {
        surfaceMats.forEach((m) => m.uniforms.uColor.value.copy(baseNow));
        accentMat.uniforms.uColor.value.copy(hotNow);
        wireMat.color.copy(lineNow);
        pMat.color.copy(baseNow);
    };

    const frame = (now) => {
        raf = 0;
        if (disposed || !running) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        clock += dt;

        // smooth colour transition when the engine level changes
        const k = 1 - Math.exp(-dt * 4);
        baseNow.lerp(target.base, k);
        hotNow.lerp(target.hot, k);
        lineNow.copy(baseNow);
        beat += (target.beat - beat) * k;
        applyColours();

        const pulse = 0.92 + 0.08 * Math.sin((clock * Math.PI * 2) / Math.max(0.3, beat));
        const scanY = VIEW_H - (10 + (0.5 + 0.5 * Math.sin(clock * 0.6)) * 256);
        [bodyMat, visorMat, accentMat].forEach((m) => {
            m.uniforms.uTime.value = clock;
            m.uniforms.uPulse.value = pulse;
            m.uniforms.uScanY.value = scanY;
        });

        // very slow sway: keeps the callout leader lines pointing at the front of the body
        figure.rotation.y = reduceMotion ? 0.12 : Math.sin(clock * 0.28) * 0.5;

        if (!reduceMotion) {
            for (let i = 0; i < PARTICLES; i += 1) {
                pPos[i * 3 + 1] += pSpeed[i] * dt;
                if (pPos[i * 3 + 1] > VIEW_H) pPos[i * 3 + 1] = 0;
            }
            pGeo.attributes.position.needsUpdate = true;
        }

        renderer.render(scene, camera);
        if (!reduceMotion) raf = requestAnimationFrame(frame);
    };

    const start = () => {
        if (running || disposed) return;
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
    };
    const stop = () => {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    };
    const syncRunning = () => ((visible && !document.hidden) ? start() : stop());

    // with reduced motion we render on demand (colour change / resize) instead of looping
    const renderOnce = () => {
        if (!reduceMotion || disposed) return;
        running = true;
        last = performance.now();
        frame(last);
        running = false;
    };

    const io = typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            visible = entries[entries.length - 1].isIntersecting;
            syncRunning();
        })
        : null;
    io?.observe(container);
    document.addEventListener('visibilitychange', syncRunning);

    const onContextLost = (e) => {
        e.preventDefault();
        stop();
        onError?.(new Error('WebGL context lost'));
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const finish = () => {
        if (disposed) return;
        applyColours();
        if (reduceMotion) renderOnce();
        else syncRunning();
        onReady?.();
    };

    const buildFallbackAndFinish = () => {
        try {
            buildProcedural();
            finish();
        } catch (err) {
            onError?.(err);
        }
    };

    if (modelUrl) {
        new GLTFLoader().load(
            modelUrl,
            (gltf) => {
                if (disposed) return;
                try {
                    useGlb(gltf.scene);
                    finish();
                } catch (err) {
                    console.warn('Astronaut GLB could not be used, using built-in model:', err);
                    figure.clear();
                    buildFallbackAndFinish();
                }
            },
            undefined,
            (err) => {
                if (disposed) return;
                console.warn('Astronaut GLB failed to load, using built-in model:', err);
                buildFallbackAndFinish();
            }
        );
    } else {
        buildFallbackAndFinish();
    }

    return {
        /** level: 'high' | 'medium' | null (Engine Assessment); beatSeconds: pulse period from the live heart rate */
        update({ level = null, beatSeconds = 0.9 } = {}) {
            const c = COLORS[level] || COLORS.ok;
            target.base.set(c.base);
            target.hot.set(c.hot);
            target.beat = beatSeconds;
            if (reduceMotion) {
                baseNow.copy(target.base);
                hotNow.copy(target.hot);
                beat = beatSeconds;
                renderOnce();
            }
        },
        dispose() {
            disposed = true;
            stop();
            document.removeEventListener('visibilitychange', syncRunning);
            io?.disconnect();
            ro?.disconnect();
            canvas.removeEventListener('webglcontextlost', onContextLost);
            disposables.forEach((d) => d.dispose?.());
            renderer.dispose();
            renderer.forceContextLoss?.();
            canvas.remove();
        }
    };
}
