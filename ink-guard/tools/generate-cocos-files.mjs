/**
 * Writes stable Cocos Creator 3.8 metas and the main scene.
 * Re-run from repo root: node ink-guard/tools/generate-cocos-files.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');

const Base64KeyChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function compressUuid(uuid) {
  const hex = uuid.replace(/-/g, '');
  let i = 5;
  let out = hex.slice(0, i);
  while (i < hex.length) {
    const a = parseInt(hex[i], 16);
    const b = parseInt(hex[i + 1], 16);
    const c = parseInt(hex[i + 2], 16);
    out += Base64KeyChars[(a << 2) | (b >> 2)];
    out += Base64KeyChars[((b & 3) << 4) | c];
    i += 3;
  }
  return out;
}

const GAME_APP_UUID = '6f3c1a84-9b2e-4d77-8c15-2a9e4b7d10c6';
const SCENE_UUID = 'a4e1c0b2-7d55-4f38-9a61-0c8e2b6d4f17';

const metas = {
  'assets': ['directory', 'a1000001-0000-4000-8000-000000000001'],
  'assets/scenes': ['directory', 'a1000001-0000-4000-8000-000000000002'],
  'assets/scripts': ['directory', 'a1000001-0000-4000-8000-000000000003'],
  'assets/scripts/config': ['directory', 'a1000001-0000-4000-8000-000000000004'],
  'assets/scripts/logic': ['directory', 'a1000001-0000-4000-8000-000000000005'],
  'assets/scripts/view': ['directory', 'a1000001-0000-4000-8000-000000000006'],
  'assets/resources': ['directory', 'a1000001-0000-4000-8000-000000000007'],
  'assets/resources/configs': ['directory', 'a1000001-0000-4000-8000-000000000008'],
  'assets/scripts/GameApp.ts': ['typescript', GAME_APP_UUID],
  'assets/scripts/config/ConfigTypes.ts': ['typescript', '8a1d6e20-4c53-4b8e-9f17-2d6b0a8c3e51'],
  'assets/scripts/config/validateConfig.ts': ['typescript', '1b7e9c42-5d64-4a90-8e28-6c3f1d0a9b74'],
  'assets/scripts/config/ConfigService.ts': ['typescript', '9c2f4a18-7e35-4d6b-a091-5b8d3c2e7f60'],
  'assets/scripts/logic/rng.ts': ['typescript', '2d5c8f90-1a47-4e6b-9c38-7b0e5a2d6f14'],
  'assets/scripts/logic/geometry.ts': ['typescript', '4e8b2d71-6a19-4c53-b7e0-1f9a6d4c8b32'],
  'assets/scripts/logic/GameSim.ts': ['typescript', '7a6e1c35-8d42-4f90-b561-0e9c3a7b5d28'],
  'assets/scripts/view/InkWidgets.ts': ['typescript', '5c9a3e62-0b78-4d14-a293-6f1e8c4b0d57'],
  'assets/resources/configs/units.json': ['json', 'b31f6a90-2c48-4e17-9d05-8a6b1e4c7f23'],
  'assets/resources/configs/economy.json': ['json', 'c42a7b01-3d59-4f28-ae16-9b7c2f5d8034'],
  'assets/resources/configs/adou.json': ['json', 'd53b8c12-4e6a-4039-bf27-ac8d306e9145'],
  'assets/resources/configs/waves.json': ['json', 'e64c9d23-5f7b-414a-8038-bd9e417fa256'],
  'assets/resources/configs/board.json': ['json', 'f75dae34-608c-425b-9149-ceaf5280b367'],
  'assets/scenes/main.scene': ['scene', SCENE_UUID],
};

const versions = {
  directory: '1.2.0',
  typescript: '4.0.24',
  json: '2.0.1',
  scene: '1.1.50',
};

function writeMeta(rel, kind, uuid) {
  const body = {
    ver: versions[kind],
    importer: kind,
    imported: true,
    uuid,
    files: kind === 'directory' || kind === 'typescript' ? [] : ['.json'],
    subMetas: {},
    userData: {},
  };
  const target = join(root, `${rel}.meta`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
}

function v3(x, y, z = 0) {
  return { __type__: 'cc.Vec3', x, y, z };
}

function quat() {
  return { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };
}

function size(width, height) {
  return { __type__: 'cc.Size', width, height };
}

function vec2(x, y) {
  return { __type__: 'cc.Vec2', x, y };
}

function color(r, g, b, a = 255) {
  return { __type__: 'cc.Color', r, g, b, a };
}

function node(name, parent, children, components, x, y, layer, id, z = 0) {
  return {
    __type__: 'cc.Node',
    _name: name,
    _objFlags: 0,
    _parent: parent === null ? null : { __id__: parent },
    _children: children.map((child) => ({ __id__: child })),
    _active: true,
    _components: components.map((component) => ({ __id__: component })),
    _prefab: null,
    _lpos: v3(x, y, z),
    _lrot: quat(),
    _lscale: v3(1, 1, 1),
    _mobility: 0,
    _layer: layer,
    _euler: v3(0, 0, 0),
    _id: id,
  };
}

function ui(nodeId, width, height, id) {
  return {
    __type__: 'cc.UITransform',
    _name: '',
    _objFlags: 0,
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: null,
    _contentSize: size(width, height),
    _anchorPoint: vec2(0.5, 0.5),
    _id: id,
  };
}

const UI = 33554432;
const scriptType = compressUuid(GAME_APP_UUID);

const scene = [
  {
    __type__: 'cc.SceneAsset',
    _name: 'main',
    _objFlags: 0,
    _native: '',
    scene: { __id__: 1 },
  },
  {
    __type__: 'cc.Scene',
    _name: 'main',
    _objFlags: 0,
    _parent: null,
    _children: [{ __id__: 2 }],
    _active: true,
    _components: [],
    _prefab: { __id__: 17 },
    autoReleaseAssets: false,
    _globals: { __id__: 18 },
    _id: SCENE_UUID,
  },
  node('Canvas', 1, [3, 5], [14, 15, 16], 360, 640, UI, 'canvas-node-ink-guard'),
  node('Camera', 2, [], [4], 0, 0, UI, 'camera-node-ink-guard', 1000),
  {
    __type__: 'cc.Camera',
    _name: '',
    _objFlags: 0,
    node: { __id__: 3 },
    _enabled: true,
    __prefab: null,
    _projection: 0,
    _priority: 1073741824,
    _fov: 45,
    _fovAxis: 0,
    _orthoHeight: 640,
    _near: 1,
    _far: 2000,
    _color: color(243, 230, 200, 255),
    _depth: 1,
    _stencil: 0,
    _clearFlags: 7,
    _rect: { __type__: 'cc.Rect', x: 0, y: 0, width: 1, height: 1 },
    _aperture: 19,
    _shutter: 7,
    _iso: 0,
    _screenScale: 1,
    _visibility: 1107296256,
    _targetTexture: null,
    _postProcess: null,
    _usePostProcess: false,
    _cameraType: 0,
    _trackingType: 0,
    _id: 'camera-comp-ink-guard',
  },
  node('GameRoot', 2, [8, 10, 12], [6, 7], 0, 0, UI, 'gameroot-node-ink-guard'),
  ui(5, 720, 1280, 'gameroot-ui-ink-guard'),
  {
    __type__: scriptType,
    _name: '',
    _objFlags: 0,
    node: { __id__: 5 },
    _enabled: true,
    __prefab: null,
    _id: 'gameapp-comp-ink-guard',
  },
  node('Board', 5, [], [9], 0, 0, UI, 'board-node-ink-guard'),
  ui(8, 0, 0, 'board-ui-ink-guard'),
  node('Hud', 5, [], [11], 0, 0, UI, 'hud-node-ink-guard'),
  ui(10, 0, 0, 'hud-ui-ink-guard'),
  node('Actors', 5, [], [13], 0, 0, UI, 'actors-node-ink-guard'),
  ui(12, 0, 0, 'actors-ui-ink-guard'),
  ui(2, 720, 1280, 'canvas-ui-ink-guard'),
  {
    __type__: 'cc.Canvas',
    _name: '',
    _objFlags: 0,
    node: { __id__: 2 },
    _enabled: true,
    __prefab: null,
    _cameraComponent: { __id__: 4 },
    _alignCanvasWithScreen: true,
    _id: 'canvas-comp-ink-guard',
  },
  {
    __type__: 'cc.Widget',
    _name: '',
    _objFlags: 0,
    node: { __id__: 2 },
    _enabled: true,
    __prefab: null,
    _alignFlags: 45,
    _target: null,
    _left: 0,
    _right: 0,
    _top: 0,
    _bottom: 0,
    _horizontalCenter: 0,
    _verticalCenter: 0,
    _isAbsLeft: true,
    _isAbsRight: true,
    _isAbsTop: true,
    _isAbsBottom: true,
    _isAbsHorizontalCenter: true,
    _isAbsVerticalCenter: true,
    _originalWidth: 0,
    _originalHeight: 0,
    _alignMode: 2,
    _lockFlags: 0,
    _id: 'canvas-widget-ink-guard',
  },
  {
    __type__: 'cc.PrefabInfo',
    root: null,
    asset: null,
    fileId: SCENE_UUID,
    instance: null,
    targetOverrides: null,
  },
  {
    __type__: 'cc.SceneGlobals',
    ambient: { __id__: 19 },
    shadows: { __id__: 20 },
    _skybox: { __id__: 21 },
    fog: { __id__: 22 },
    octree: { __id__: 23 },
    skin: { __id__: 24 },
    lightProbeInfo: { __id__: 25 },
    postSettings: { __id__: 26 },
    bakedWithStationaryMainLight: false,
    bakedWithHighpLightmap: false,
  },
  {
    __type__: 'cc.AmbientInfo',
    _skyColorHDR: { __type__: 'cc.Vec4', x: 0.2, y: 0.5, z: 0.8, w: 0.52 },
    _skyColor: { __type__: 'cc.Vec4', x: 0.2, y: 0.5, z: 0.8, w: 0.52 },
    _skyIllumHDR: 20000,
    _skyIllum: 20000,
    _groundAlbedoHDR: { __type__: 'cc.Vec4', x: 0.2, y: 0.2, z: 0.2, w: 1 },
    _groundAlbedo: { __type__: 'cc.Vec4', x: 0.2, y: 0.2, z: 0.2, w: 1 },
    _skyColorLDR: { __type__: 'cc.Vec4', x: 0.2, y: 0.5, z: 0.8, w: 0.52 },
    _skyIllumLDR: 0.8,
    _groundAlbedoLDR: { __type__: 'cc.Vec4', x: 0.2, y: 0.2, z: 0.2, w: 1 },
  },
  {
    __type__: 'cc.ShadowsInfo',
    _enabled: false,
    _type: 0,
    _normal: v3(0, 1, 0),
    _distance: 0,
    _planeBias: 1,
    _shadowColor: color(0, 0, 0, 76),
    _maxReceived: 4,
    _size: vec2(1024, 1024),
  },
  {
    __type__: 'cc.SkyboxInfo',
    _envLightingType: 0,
    _envmapHDR: null,
    _envmapLDR: null,
    _diffuseMapHDR: null,
    _diffuseMapLDR: null,
    _enabled: false,
    _useHDR: true,
    _editableMaterial: null,
    _reflectionHDR: null,
    _reflectionLDR: null,
    _rotationAngle: 0,
  },
  {
    __type__: 'cc.FogInfo',
    _type: 0,
    _fogColor: color(200, 200, 200, 255),
    _enabled: false,
    _fogDensity: 0.3,
    _fogStart: 0.5,
    _fogEnd: 300,
    _fogAtten: 5,
    _fogTop: 1.5,
    _fogRange: 1.2,
    _accurate: false,
  },
  {
    __type__: 'cc.OctreeInfo',
    _enabled: false,
    _minPos: v3(-1024, -1024, -1024),
    _maxPos: v3(1024, 1024, 1024),
    _depth: 8,
  },
  { __type__: 'cc.SkinInfo' },
  { __type__: 'cc.LightProbeInfo' },
  { __type__: 'cc.PostSettingsInfo' },
];

function validateScene(data) {
  data.forEach((entry, index) => {
    const walk = (value) => {
      if (!value || typeof value !== 'object') {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(value, '__id__')) {
        const id = value.__id__;
        if (!Number.isInteger(id) || id < 0 || id >= data.length) {
          throw new Error(`Bad __id__ ${id} from object ${index}`);
        }
      }
      Object.values(value).forEach(walk);
    };
    walk(entry);
  });
}

validateScene(scene);
if (scene[7].__type__ !== scriptType) {
  throw new Error(`script type mismatch ${scene[7].__type__}`);
}

for (const [rel, [kind, uuid]] of Object.entries(metas)) {
  writeMeta(rel, kind, uuid);
}

const scenePath = join(root, 'assets/scenes/main.scene');
mkdirSync(dirname(scenePath), { recursive: true });
writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
console.log(`scene objects ${scene.length}, GameApp ${scriptType}`);
