/**
 * Writes stable Cocos Creator 3.8 metas and the editable main scene.
 * Re-run from repo root: node ink-guard/tools/generate-cocos-files.mjs
 *
 * The scene is the source the editor opens. Re-running this script
 * rebuilds that node tree from the current board.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const scriptType = compressUuid(GAME_APP_UUID);

const FONT_TITLE = 'e1a00001-0000-4000-8000-000000000101';
const FONT_BODY = 'e1a00001-0000-4000-8000-000000000102';

const TEX = {
  bgPaper: 'e1a00001-0000-4000-8000-000000000001',
  mountainTop: 'e1a00001-0000-4000-8000-000000000002',
  mountainBottom: 'e1a00001-0000-4000-8000-000000000003',
  bamboo: 'e1a00001-0000-4000-8000-000000000004',
  river: 'e1a00001-0000-4000-8000-000000000005',
  seal: 'e1a00001-0000-4000-8000-000000000006',
  cell: 'e1a00001-0000-4000-8000-000000000007',
  unitDao: 'e1a00001-0000-4000-8000-000000000008',
  unitQiang: 'e1a00001-0000-4000-8000-000000000009',
  unitGong: 'e1a00001-0000-4000-8000-00000000000a',
  unitQi: 'e1a00001-0000-4000-8000-00000000000b',
  splash: 'e1a00001-0000-4000-8000-00000000000c',
  btnOn: 'e1a00001-0000-4000-8000-00000000000d',
  btnOff: 'e1a00001-0000-4000-8000-00000000000e',
  panel: 'e1a00001-0000-4000-8000-00000000000f',
  boardPlate: 'e1a00001-0000-4000-8000-000000000010',
  hpTrack: 'e1a00001-0000-4000-8000-000000000011',
  hpFill: 'e1a00001-0000-4000-8000-000000000012',
  mark: 'e1a00001-0000-4000-8000-000000000013',
  enemy: 'e1a00001-0000-4000-8000-000000000014',
  shot: 'e1a00001-0000-4000-8000-000000000015',
  white: 'e1a00001-0000-4000-8000-000000000016',
};

const metas = {
  'assets': ['directory', 'a1000001-0000-4000-8000-000000000001'],
  'assets/scenes': ['directory', 'a1000001-0000-4000-8000-000000000002'],
  'assets/scripts': ['directory', 'a1000001-0000-4000-8000-000000000003'],
  'assets/scripts/config': ['directory', 'a1000001-0000-4000-8000-000000000004'],
  'assets/scripts/logic': ['directory', 'a1000001-0000-4000-8000-000000000005'],
  'assets/scripts/view': ['directory', 'a1000001-0000-4000-8000-000000000006'],
  'assets/resources': ['directory', 'a1000001-0000-4000-8000-000000000007'],
  'assets/resources/configs': ['directory', 'a1000001-0000-4000-8000-000000000008'],
  'assets/resources/fonts': ['directory', 'a1000001-0000-4000-8000-000000000009'],
  'assets/resources/textures': ['directory', 'a1000001-0000-4000-8000-00000000000a'],
  'assets/concepts': ['directory', 'a1000001-0000-4000-8000-00000000000b'],
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

function writePlainMeta(rel, importer, ver, uuid) {
  const body = {
    ver,
    importer,
    imported: true,
    uuid,
    files: ['.json'],
    subMetas: {},
    userData: {},
  };
  const target = join(root, `${rel}.meta`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
}

function pngSize(file) {
  const buf = readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
    throw new Error(`JPEG size not found in ${file}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function writeImageMeta(rel, uuid, borders = null) {
  const { width, height } = pngSize(join(root, rel));
  const hw = width / 2;
  const hh = height / 2;
  const ext = rel.endsWith('.jpg') ? '.jpg' : '.png';
  const body = {
    ver: '1.0.27',
    importer: 'image',
    imported: true,
    uuid,
    files: ['.json', ext],
    subMetas: {
      '6c48a': {
        importer: 'texture',
        uuid: `${uuid}@6c48a`,
        displayName: 'texture',
        id: '6c48a',
        name: 'texture',
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          minfilter: 'linear',
          magfilter: 'linear',
          mipfilter: 'none',
          anisotropy: 0,
          isUuid: true,
          imageUuidOrDatabaseUri: uuid,
        },
        ver: '1.0.22',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
      f9941: {
        importer: 'sprite-frame',
        uuid: `${uuid}@f9941`,
        displayName: 'spriteFrame',
        id: 'f9941',
        name: 'spriteFrame',
        userData: {
          trimType: 'none',
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: borders?.t ?? 0,
          borderBottom: borders?.b ?? 0,
          borderLeft: borders?.l ?? 0,
          borderRight: borders?.r ?? 0,
          packable: true,
          pixelsToUnit: 100,
          pivotX: 0.5,
          pivotY: 0.5,
          meshType: 0,
          vertices: {
            rawPosition: [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
            indexes: [0, 1, 2, 2, 1, 3],
            uv: [0, height, width, height, 0, 0, width, 0],
            nuv: [0, 0, 1, 0, 0, 1, 1, 1],
            minPos: [-hw, -hh, 0],
            maxPos: [hw, hh, 0],
          },
          isUuid: true,
          imageUuidOrDatabaseUri: `${uuid}@6c48a`,
          atlasUuid: '',
        },
        ver: '1.0.12',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
    },
    userData: {
      type: 'sprite-frame',
      fixAlphaTransparencyArtifacts: false,
      hasAlpha: ext !== '.jpg',
      redirect: `${uuid}@f9941`,
    },
  };
  const target = join(root, `${rel}.meta`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`);
}

const UI = 33554432;
const INK = [29, 43, 56];
const BROWN = [74, 55, 40];
const CREAM = [255, 248, 234];

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

function frameRef(uuid) {
  return { __uuid__: `${uuid}@f9941`, __expectedType__: 'cc.SpriteFrame' };
}

function fontRef(uuid) {
  return { __uuid__: uuid, __expectedType__: 'cc.TTFFont' };
}

function buildScene() {
  const board = JSON.parse(readFileSync(join(root, 'assets/resources/configs/board.json'), 'utf8'));
  const objs = [];
  const push = (obj) => {
    objs.push(obj);
    return objs.length - 1;
  };

  function makeNode(name, parent, x, y, opts = {}) {
    const index = objs.length;
    objs.push({
      __type__: 'cc.Node',
      _name: name,
      _objFlags: 0,
      _parent: parent === null ? null : { __id__: parent },
      _children: [],
      _active: opts.active !== false,
      _components: [],
      _prefab: null,
      _lpos: v3(x, y, opts.z ?? 0),
      _lrot: quat(),
      _lscale: v3(opts.sx ?? 1, opts.sy ?? 1, 1),
      _mobility: 0,
      _layer: UI,
      _euler: v3(0, 0, 0),
      _id: opts.nid ?? `node-${name}-${index}`,
    });
    if (parent !== null) {
      objs[parent]._children.push({ __id__: index });
    }
    return index;
  }

  function comp(nodeIndex, data) {
    data.node = { __id__: nodeIndex };
    const index = push(data);
    objs[nodeIndex]._components.push({ __id__: index });
    return index;
  }

  function ui(width, height, id) {
    return {
      __type__: 'cc.UITransform',
      _name: '',
      _objFlags: 0,
      _enabled: true,
      __prefab: null,
      _contentSize: size(width, height),
      _anchorPoint: vec2(0.5, 0.5),
      _id: id,
    };
  }

  function sprite(frame, type, tint, id) {
    return {
      __type__: 'cc.Sprite',
      _name: '',
      _objFlags: 0,
      _enabled: true,
      __prefab: null,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: tint ?? color(255, 255, 255, 255),
      _spriteFrame: frame ? frameRef(frame) : null,
      _type: type,
      _fillType: 0,
      _sizeMode: 0,
      _fillCenter: vec2(0, 0),
      _fillStart: 0,
      _fillRange: 0,
      _isTrimmedMode: true,
      _useGrayscale: false,
      _atlas: null,
      _id: id,
    };
  }

  function label(text, fontSize, rgb, fontUuid, id, wrap = true) {
    return {
      __type__: 'cc.Label',
      _name: '',
      _objFlags: 0,
      _enabled: true,
      __prefab: null,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: color(rgb[0], rgb[1], rgb[2], 255),
      _string: text,
      _horizontalAlign: 1,
      _verticalAlign: 1,
      _actualFontSize: fontSize,
      _fontSize: fontSize,
      _fontFamily: 'Arial',
      _lineHeight: fontSize + 8,
      _overflow: 2,
      _enableWrapText: wrap,
      _font: fontRef(fontUuid),
      _isSystemFontUsed: false,
      _spacingX: 0,
      _isItalic: false,
      _isBold: false,
      _isUnderline: false,
      _underlineHeight: 2,
      _cacheMode: 0,
      _enableOutline: false,
      _outlineColor: color(0, 0, 0, 255),
      _outlineWidth: 2,
      _enableShadow: false,
      _shadowColor: color(0, 0, 0, 255),
      _shadowOffset: vec2(2, 2),
      _shadowBlur: 2,
      _id: id,
    };
  }

  function widget(flags, box, id) {
    return {
      __type__: 'cc.Widget',
      _name: '',
      _objFlags: 0,
      _enabled: true,
      __prefab: null,
      _alignFlags: flags,
      _target: { __id__: gameRoot },
      _left: box.left ?? 0,
      _right: box.right ?? 0,
      _top: box.top ?? 0,
      _bottom: box.bottom ?? 0,
      _horizontalCenter: box.hc ?? 0,
      _verticalCenter: box.vc ?? 0,
      _isAbsLeft: true,
      _isAbsRight: true,
      _isAbsTop: true,
      _isAbsBottom: true,
      _isAbsHorizontalCenter: true,
      _isAbsVerticalCenter: true,
      _originalWidth: box.w ?? 100,
      _originalHeight: box.h ?? 40,
      _alignMode: 2,
      _lockFlags: 0,
      _id: id,
    };
  }

  function layout(type, spacingX, spacingY, id) {
    return {
      __type__: 'cc.Layout',
      _name: '',
      _objFlags: 0,
      _enabled: true,
      __prefab: null,
      _resize: 0,
      _layoutType: type,
      _cellSize: size(40, 40),
      _startAxis: 0,
      _paddingLeft: 8,
      _paddingRight: 8,
      _paddingTop: 6,
      _paddingBottom: 6,
      _spacingX: spacingX,
      _spacingY: spacingY,
      _verticalDirection: 1,
      _horizontalDirection: 0,
      _constraint: 0,
      _constraintNum: 2,
      _affectedByScale: false,
      _isAlign: false,
      _id: id,
    };
  }

  function button(self, handler, id) {
    return {
      __type__: 'cc.Button',
      _name: '',
      _objFlags: 0,
      _enabled: true,
      __prefab: null,
      clickEvents: [
        {
          __type__: 'cc.ClickEvent',
          target: { __id__: gameRoot },
          component: '',
          _componentId: scriptType,
          handler,
          customEventData: '',
        },
      ],
      _interactable: true,
      _transition: 3,
      _normalColor: color(255, 255, 255, 255),
      _hoverColor: color(230, 230, 230, 255),
      _pressedColor: color(255, 255, 255, 255),
      _disabledColor: color(160, 160, 160, 255),
      _normalSprite: null,
      _hoverSprite: null,
      _pressedSprite: null,
      _disabledSprite: null,
      _duration: 0.08,
      _zoomScale: 0.96,
      _target: { __id__: self },
      _id: id,
    };
  }

  function addLabel(parent, name, text, x, y, w, h, fontUuid, fontSize, rgb, id, wrap = true) {
    const nodeIndex = makeNode(name, parent, x, y);
    comp(nodeIndex, ui(w, h, `ui-${id}`));
    const labelIndex = comp(nodeIndex, label(text, fontSize, rgb, fontUuid, `label-${id}`, wrap));
    return { node: nodeIndex, label: labelIndex };
  }

  function addSprite(parent, name, x, y, w, h, frame, type, tint, id, opts = {}) {
    const nodeIndex = makeNode(name, parent, x, y, opts);
    comp(nodeIndex, ui(w, h, `ui-${id}`));
    const spriteIndex = comp(nodeIndex, sprite(frame, type, tint, `sprite-${id}`));
    return { node: nodeIndex, sprite: spriteIndex };
  }

  function addButton(parent, name, x, y, w, h, frame, handler, text, fontSize) {
    const nodeIndex = makeNode(name, parent, x, y);
    comp(nodeIndex, ui(w, h, `ui-${name}`));
    const spriteIndex = comp(nodeIndex, sprite(frame, 1, null, `sprite-${name}`));
    const buttonIndex = comp(nodeIndex, button(nodeIndex, handler, `button-${name}`));
    const textRef = addLabel(nodeIndex, 'Text', text, 0, 1, w - 16, h - 10, FONT_BODY, fontSize, CREAM, name, false);
    return { node: nodeIndex, sprite: spriteIndex, button: buttonIndex, label: textRef.label };
  }

  const sceneAsset = push({
    __type__: 'cc.SceneAsset',
    _name: 'main',
    _objFlags: 0,
    _native: '',
    scene: { __id__: 1 },
  });
  if (sceneAsset !== 0) {
    throw new Error('SceneAsset must be index 0');
  }
  const scene = push({
    __type__: 'cc.Scene',
    _name: 'main',
    _objFlags: 0,
    _parent: null,
    _children: [],
    _active: true,
    _components: [],
    _prefab: null,
    autoReleaseAssets: false,
    _globals: null,
    _id: SCENE_UUID,
  });

  const canvas = makeNode('Canvas', scene, 360, 640, { nid: 'canvas-node-ink-guard' });
  const cameraNode = makeNode('Camera', canvas, 0, 0, { z: 1000, nid: 'camera-node-ink-guard' });
  const camera = comp(cameraNode, {
    __type__: 'cc.Camera',
    _name: '',
    _objFlags: 0,
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
  });
  const gameRoot = makeNode('GameRoot', canvas, 0, 0, { nid: 'gameroot-node-ink-guard' });
  comp(gameRoot, ui(720, 1280, 'gameroot-ui-ink-guard'));

  const background = addSprite(gameRoot, 'Background', 0, 0, 720, 1280, TEX.bgPaper, 0, null, 'bg');
  comp(background.node, widget(45, { left: 0, right: 0, top: 0, bottom: 0, w: 720, h: 1280 }, 'bg-widget'));

  const decor = makeNode('Decor', gameRoot, 0, 0);
  comp(decor, ui(0, 0, 'decor-ui'));
  addSprite(decor, 'MountainTop', -20, 505, 440, 240, TEX.mountainTop, 0, null, 'mtn-top');
  addSprite(decor, 'MountainBottom', 16, -548, 460, 190, TEX.mountainBottom, 0, null, 'mtn-bot');
  addSprite(decor, 'BambooRight', 268, 470, 170, 230, TEX.bamboo, 0, null, 'bamboo-r');
  addSprite(decor, 'BambooLeft', -268, -530, 150, 210, TEX.bamboo, 0, null, 'bamboo-l', { sx: -1 });
  addSprite(decor, 'InkWashLeft', -230, 360, 160, 190, TEX.splash, 0, color(255, 255, 255, 150), 'splash-l');
  addSprite(decor, 'InkWashRight', 210, -500, 150, 180, TEX.splash, 0, color(255, 255, 255, 130), 'splash-r');

  const boardLayer = makeNode('Board', gameRoot, 0, 0, { nid: 'board-node-ink-guard' });
  comp(boardLayer, ui(0, 0, 'board-ui-ink-guard'));
  addSprite(boardLayer, 'River', 0, 178, 540, 150, TEX.river, 0, null, 'river');
  addSprite(boardLayer, 'BoardPlate', 0, -46, 500, 300, TEX.boardPlate, 1, null, 'plate');

  const step = board.cellSize + board.cellGap;
  const cell = 72;
  for (let i = 0; i < board.gridCols * board.gridRows; i += 1) {
    const col = i % board.gridCols;
    const row = Math.floor(i / board.gridCols);
    const x = board.gridOrigin.x + col * step;
    const y = board.gridOrigin.y - row * step;
    const slot = addSprite(boardLayer, `Cell${i}`, x, y, cell, cell, TEX.cell, 0, null, `cell-${i}`);
    const mark = addSprite(slot.node, 'Mark', 0, 0, cell, cell, TEX.mark, 0, color(47, 107, 79, 230), `mark-${i}`, { active: false });
    if (!mark.node) {
      throw new Error('mark missing');
    }
  }
  for (let i = 0; i < board.benchSlots; i += 1) {
    const x = board.benchOrigin.x + i * board.benchStep;
    const y = board.benchOrigin.y;
    const slot = addSprite(boardLayer, `Bench${i}`, x, y, cell, cell, TEX.cell, 0, color(255, 248, 230, 220), `bench-${i}`);
    addSprite(slot.node, 'Mark', 0, 0, cell, cell, TEX.mark, 0, color(47, 107, 79, 230), `bmark-${i}`, { active: false });
  }
  const gate = board.path[board.path.length - 1];
  const adouSeal = addSprite(boardLayer, 'AdouSeal', gate.x, gate.y, 108, 108, TEX.seal, 0, null, 'seal');

  const rangeNode = makeNode('Range', boardLayer, 0, 0, { active: false, nid: 'range-node' });
  comp(rangeNode, ui(8, 8, 'range-ui'));
  const rangeGraphics = comp(rangeNode, {
    __type__: 'cc.Graphics',
    _name: '',
    _objFlags: 0,
    _enabled: true,
    __prefab: null,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: color(255, 255, 255, 255),
    _lineWidth: 3,
    _strokeColor: color(180, 51, 42, 120),
    _lineJoin: 2,
    _lineCap: 0,
    _fillColor: color(255, 255, 255, 0),
    _miterLimit: 10,
    _id: 'range-graphics',
  });

  const actorLayer = makeNode('Actors', gameRoot, 0, 0, { nid: 'actors-node-ink-guard' });
  comp(actorLayer, ui(0, 0, 'actors-ui-ink-guard'));

  const hudLayer = makeNode('Hud', gameRoot, 0, 0, { nid: 'hud-node-ink-guard' });
  comp(hudLayer, ui(0, 0, 'hud-ui-ink-guard'));

  const title = addLabel(hudLayer, 'Title', '墨卫', -212, 580, 240, 72, FONT_TITLE, 52, INK, 'title', false);
  comp(title.node, widget(9, { top: 24, left: 28, w: 240, h: 72 }, 'title-widget'));
  const speed = addButton(hudLayer, 'Speed', 262, 580, 148, 56, TEX.btnOn, 'onSpeedClick', '常速', 22);
  comp(speed.node, widget(33, { top: 32, right: 24, w: 148, h: 56 }, 'speed-widget'));

  const status = makeNode('StatusColumn', hudLayer, 0, 508);
  comp(status, ui(640, 132, 'status-ui'));
  comp(status, layout(2, 0, 6, 'status-layout'));
  const wave = addLabel(status, 'Wave', '第 1 / 5 波 · 备墨 12s', 0, 40, 620, 32, FONT_BODY, 22, BROWN, 'wave', false);
  const hpText = addLabel(status, 'HpText', '阿斗 24/24', 0, 4, 620, 28, FONT_BODY, 22, BROWN, 'hp', false);
  const hpBar = addSprite(status, 'HpBar', 0, -36, 460, 22, TEX.hpTrack, 1, null, 'hp-track');
  const hpFillNode = addSprite(hpBar.node, 'Fill', -222, 0, 444, 14, TEX.hpFill, 1, null, 'hp-fill');
  objs[hpFillNode.node]._components.forEach((entry) => {
    const component = objs[entry.__id__];
    if (component.__type__ === 'cc.UITransform') {
      component._anchorPoint = vec2(0, 0.5);
    }
  });

  const mantouRow = makeNode('MantouRow', hudLayer, 0, 400);
  comp(mantouRow, ui(640, 72, 'mantou-row-ui'));
  comp(mantouRow, layout(1, 18, 0, 'mantou-layout'));
  const mantou = addLabel(mantouRow, 'Mantou', '馒头 140   +5/秒', -150, 0, 320, 48, FONT_BODY, 24, BROWN, 'mantou', false);
  const recruit = addButton(mantouRow, 'Recruit', 180, 0, 176, 64, TEX.btnOn, 'onRecruitClick', '招募 15', 24);

  const hint = addLabel(hudLayer, 'Hint', '招募字令，拖上阵。相同字令叠在一起升品，不同字令可以换位。', 0, -584, 660, 72, FONT_BODY, 20, BROWN, 'hint', true);
  comp(hint.node, widget(20, { bottom: 20, hc: 0, w: 660, h: 72 }, 'hint-widget'));

  const banner = addSprite(hudLayer, 'Banner', 0, 300, 360, 76, TEX.panel, 1, null, 'banner', { active: false });
  const bannerLabel = addLabel(banner.node, 'BannerText', '第 1 波', 0, 0, 320, 60, FONT_TITLE, 36, [180, 51, 42], 'banner-text', false);

  const tutorial = addSprite(hudLayer, 'Tutorial', 0, -236, 640, 112, TEX.panel, 1, null, 'tutorial');
  const tutorialLabel = addLabel(
    tutorial.node,
    'TutorialText',
    '开局有两枚「刀」。拖到一起就升品。\n金色合成，青色换位，绿色空位。',
    -78,
    4,
    420,
    92,
    FONT_BODY,
    20,
    BROWN,
    'tutorial-text',
    true,
  );
  const tutorialButton = addButton(tutorial.node, 'TutorialOk', 220, 0, 150, 52, TEX.btnOn, 'onTutorialClick', '知道了', 20);

  const overlay = makeNode('Overlay', hudLayer, 0, 0, { active: false, nid: 'overlay-node' });
  comp(overlay, ui(720, 1280, 'overlay-ui'));
  comp(overlay, widget(45, { left: 0, right: 0, top: 0, bottom: 0, w: 720, h: 1280 }, 'overlay-widget'));
  comp(overlay, {
    __type__: 'cc.BlockInputEvents',
    _name: '',
    _objFlags: 0,
    _enabled: true,
    __prefab: null,
    _id: 'overlay-block',
  });
  addSprite(overlay, 'Dim', 0, 0, 720, 1280, TEX.white, 0, color(20, 28, 38, 150), 'dim');
  const card = addSprite(overlay, 'Card', 0, 30, 520, 360, TEX.panel, 1, null, 'card');
  comp(card.node, layout(2, 0, 16, 'card-layout'));
  const overlayTitle = addLabel(card.node, 'ResultTitle', '墨阵已稳', 0, 90, 460, 72, FONT_TITLE, 44, INK, 'result-title', false);
  const overlayBody = addLabel(card.node, 'ResultBody', '守住了全部波次。', 0, 8, 440, 120, FONT_BODY, 22, BROWN, 'result-body', true);
  const restart = addButton(card.node, 'Restart', 0, -110, 220, 64, TEX.btnOn, 'onRestartClick', '再守一阵', 24);

  const loading = addLabel(hudLayer, 'Loading', '研墨中…', 0, 0, 480, 100, FONT_TITLE, 36, BROWN, 'loading', true);
  objs[loading.node]._active = false;

  comp(canvas, ui(720, 1280, 'canvas-ui-ink-guard'));
  comp(canvas, {
    __type__: 'cc.Canvas',
    _name: '',
    _objFlags: 0,
    _enabled: true,
    __prefab: null,
    _cameraComponent: { __id__: camera },
    _alignCanvasWithScreen: true,
    _id: 'canvas-comp-ink-guard',
  });
  comp(canvas, {
    __type__: 'cc.Widget',
    _name: '',
    _objFlags: 0,
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
    _originalWidth: 720,
    _originalHeight: 1280,
    _alignMode: 2,
    _lockFlags: 0,
    _id: 'canvas-widget-ink-guard',
  });

  comp(gameRoot, {
    __type__: scriptType,
    _name: '',
    _objFlags: 0,
    _enabled: true,
    __prefab: null,
    boardLayer: { __id__: boardLayer },
    actorLayer: { __id__: actorLayer },
    hudLayer: { __id__: hudLayer },
    loadingLabel: { __id__: loading.label },
    titleLabel: { __id__: title.label },
    waveLabel: { __id__: wave.label },
    hpLabel: { __id__: hpText.label },
    hpFill: { __id__: hpFillNode.sprite },
    mantouLabel: { __id__: mantou.label },
    hintLabel: { __id__: hint.label },
    recruitButton: { __id__: recruit.button },
    recruitLabel: { __id__: recruit.label },
    recruitSprite: { __id__: recruit.sprite },
    speedLabel: { __id__: speed.label },
    bannerNode: { __id__: banner.node },
    bannerLabel: { __id__: bannerLabel.label },
    overlay: { __id__: overlay },
    overlayTitle: { __id__: overlayTitle.label },
    overlayBody: { __id__: overlayBody.label },
    tutorialNode: { __id__: tutorial.node },
    tutorialLabel: { __id__: tutorialLabel.label },
    adouSeal: { __id__: adouSeal.node },
    rangeNode: { __id__: rangeNode },
    rangeGraphics: { __id__: rangeGraphics },
    titleFont: fontRef(FONT_TITLE),
    bodyFont: fontRef(FONT_BODY),
    btnCinnabar: frameRef(TEX.btnOn),
    btnMuted: frameRef(TEX.btnOff),
    enemyFrame: frameRef(TEX.enemy),
    shotFrame: frameRef(TEX.shot),
    unitFrames: [TEX.unitDao, TEX.unitQiang, TEX.unitGong, TEX.unitQi].map((uuid) => frameRef(uuid)),
    _id: 'gameapp-comp-ink-guard',
  });

  const prefabInfo = push({
    __type__: 'cc.PrefabInfo',
    root: null,
    asset: null,
    fileId: SCENE_UUID,
    instance: null,
    targetOverrides: null,
  });
  const ambient = push({
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
  });
  const shadows = push({
    __type__: 'cc.ShadowsInfo',
    _enabled: false,
    _type: 0,
    _normal: v3(0, 1, 0),
    _distance: 0,
    _planeBias: 1,
    _shadowColor: color(0, 0, 0, 76),
    _maxReceived: 4,
    _size: vec2(1024, 1024),
  });
  const skybox = push({
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
  });
  const fog = push({
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
  });
  const octree = push({
    __type__: 'cc.OctreeInfo',
    _enabled: false,
    _minPos: v3(-1024, -1024, -1024),
    _maxPos: v3(1024, 1024, 1024),
    _depth: 8,
  });
  const skin = push({ __type__: 'cc.SkinInfo' });
  const lightProbe = push({ __type__: 'cc.LightProbeInfo' });
  const post = push({ __type__: 'cc.PostSettingsInfo' });
  const globals = push({
    __type__: 'cc.SceneGlobals',
    ambient: { __id__: ambient },
    shadows: { __id__: shadows },
    _skybox: { __id__: skybox },
    fog: { __id__: fog },
    octree: { __id__: octree },
    skin: { __id__: skin },
    lightProbeInfo: { __id__: lightProbe },
    postSettings: { __id__: post },
    bakedWithStationaryMainLight: false,
    bakedWithHighpLightmap: false,
  });
  objs[scene]._prefab = { __id__: prefabInfo };
  objs[scene]._globals = { __id__: globals };
  return objs;
}

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
          throw new Error(`Bad __id__ ${id} from object ${index} (${entry.__type__ || entry._name})`);
        }
      }
      Object.values(value).forEach(walk);
    };
    walk(entry);
  });
  const names = data.filter((entry) => entry.__type__ === 'cc.Node').map((entry) => entry._name);
  for (let i = 0; i < 15; i += 1) {
    if (!names.includes(`Cell${i}`)) {
      throw new Error(`missing Cell${i}`);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    if (!names.includes(`Bench${i}`)) {
      throw new Error(`missing Bench${i}`);
    }
  }
  const marks = names.filter((name) => name === 'Mark').length;
  if (marks !== 23) {
    throw new Error(`expected 23 marks, got ${marks}`);
  }
  const buttons = data.filter((entry) => entry.__type__ === 'cc.Button');
  if (buttons.length !== 4) {
    throw new Error(`expected 4 buttons, got ${buttons.length}`);
  }
  const layouts = data.filter((entry) => entry.__type__ === 'cc.Layout');
  if (layouts.length < 3) {
    throw new Error(`expected layouts, got ${layouts.length}`);
  }
  const app = data.find((entry) => entry.__type__ === scriptType);
  if (!app) {
    throw new Error('GameApp component missing');
  }
  for (const key of ['boardLayer', 'waveLabel', 'recruitButton', 'overlay', 'tutorialNode', 'rangeGraphics', 'titleFont', 'bodyFont', 'hpFill']) {
    if (!app[key]) {
      throw new Error(`GameApp.${key} is empty`);
    }
  }
  if (!Array.isArray(app.unitFrames) || app.unitFrames.length !== 4) {
    throw new Error('unit frames missing');
  }
}

const imageFiles = {
  'assets/resources/textures/bg-paper.png': [TEX.bgPaper, null],
  'assets/resources/textures/mountain-top.png': [TEX.mountainTop, null],
  'assets/resources/textures/mountain-bottom.png': [TEX.mountainBottom, null],
  'assets/resources/textures/bamboo.png': [TEX.bamboo, null],
  'assets/resources/textures/river.png': [TEX.river, null],
  'assets/resources/textures/seal-adou.png': [TEX.seal, null],
  'assets/resources/textures/cell.png': [TEX.cell, null],
  'assets/resources/textures/unit-dao.png': [TEX.unitDao, null],
  'assets/resources/textures/unit-qiang.png': [TEX.unitQiang, null],
  'assets/resources/textures/unit-gong.png': [TEX.unitGong, null],
  'assets/resources/textures/unit-qi.png': [TEX.unitQi, null],
  'assets/resources/textures/ink-splash.png': [TEX.splash, null],
  'assets/resources/textures/btn-cinnabar.png': [TEX.btnOn, { t: 60, b: 60, l: 60, r: 60 }],
  'assets/resources/textures/btn-muted.png': [TEX.btnOff, { t: 60, b: 60, l: 60, r: 60 }],
  'assets/resources/textures/panel-paper.png': [TEX.panel, { t: 40, b: 40, l: 40, r: 40 }],
  'assets/resources/textures/board-plate.png': [TEX.boardPlate, { t: 36, b: 36, l: 36, r: 36 }],
  'assets/resources/textures/hp-track.png': [TEX.hpTrack, { t: 8, b: 8, l: 8, r: 8 }],
  'assets/resources/textures/hp-fill.png': [TEX.hpFill, { t: 8, b: 8, l: 8, r: 8 }],
  'assets/resources/textures/mark-ring.png': [TEX.mark, null],
  'assets/resources/textures/enemy-ink.png': [TEX.enemy, null],
  'assets/resources/textures/shot-dot.png': [TEX.shot, null],
  'assets/resources/textures/pixel-white.png': [TEX.white, null],
};

for (const [rel, [kind, uuid]] of Object.entries(metas)) {
  writeMeta(rel, kind, uuid);
}
for (const [rel, [uuid, borders]] of Object.entries(imageFiles)) {
  writeImageMeta(rel, uuid, borders);
}
writeImageMeta('assets/concepts/battlefield-caimo.jpg', 'e1a00001-0000-4000-8000-000000000201');
writeImageMeta('assets/concepts/units-caimo.jpg', 'e1a00001-0000-4000-8000-000000000202');
writeImageMeta('assets/concepts/vfx-caimo-mid.jpg', 'e1a00001-0000-4000-8000-000000000203');
writePlainMeta('assets/resources/fonts/MaShanZheng-Regular.ttf', 'ttf-font', '1.0.1', FONT_TITLE);
writePlainMeta('assets/resources/fonts/NotoSansCJKsc-Regular.otf', 'ttf-font', '1.0.1', FONT_BODY);
writePlainMeta('assets/resources/fonts/OFL-MaShanZheng.txt', 'text', '1.0.1', 'e1a00001-0000-4000-8000-000000000301');
writePlainMeta('assets/resources/fonts/OFL-NotoSansCJK.txt', 'text', '1.0.1', 'e1a00001-0000-4000-8000-000000000302');

const scene = buildScene();
validateScene(scene);
if (scene[7] && scene[7].__type__ === scriptType) {
  /* component index is not fixed; the type check above is enough */
}
const scenePath = join(root, 'assets/scenes/main.scene');
mkdirSync(dirname(scenePath), { recursive: true });
writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
console.log(`scene objects ${scene.length}, GameApp ${scriptType}`);
