/**
 * Writes Cocos Creator 3.8 image metas for generated pose and fx frames.
 * Run from the repo root: node ink-guard/tools/write-sprite-metas.mjs
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

function uuidFor(rel) {
  const hex = createHash('sha1').update(`ink-guard:${rel}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-a${hex.slice(15, 18)}-${hex.slice(18, 30)}`;
}

function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function imageMeta(rel) {
  const uuid = uuidFor(rel);
  const { width, height } = pngSize(join(root, rel));
  const hw = width / 2;
  const hh = height / 2;
  return {
    ver: '1.0.27',
    importer: 'image',
    imported: true,
    uuid,
    files: ['.json', '.png'],
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
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
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
      hasAlpha: true,
      redirect: `${uuid}@f9941`,
    },
  };
}

function directoryMeta(rel) {
  return {
    ver: '1.2.0',
    importer: 'directory',
    imported: true,
    uuid: uuidFor(rel),
    files: [],
    subMetas: {},
    userData: {},
  };
}

const dirs = ['assets/resources/pose', 'assets/resources/fx'];
for (const dir of dirs) {
  writeFileSync(join(root, `${dir}.meta`), `${JSON.stringify(directoryMeta(dir), null, 2)}\n`);
  for (const name of readdirSync(join(root, dir))) {
    if (!name.endsWith('.png')) {
      continue;
    }
    const rel = `${dir}/${name}`;
    writeFileSync(join(root, `${rel}.meta`), `${JSON.stringify(imageMeta(rel), null, 2)}\n`);
  }
}
console.log('sprite metas written');
