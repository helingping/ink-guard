(function (exports, Laya) {
    'use strict';

    class BatchManager {
        static registerProvider(renderType, cls) {
            if (BatchManager.registry[renderType])
                throw new Error("Overlapping batch optimization");
            BatchManager.registry[renderType] = cls;
        }
        static createProvider(renderType) {
            return new (BatchManager.registry[renderType] || NullBatchProvider)();
        }
    }
    BatchManager.registry = {};
    class NullBatchProvider {
        batch(list, start, end, allowReorder) {
            for (let i = start; i <= end; i++)
                list.add(list.elements[i]);
        }
        reset() { }
        destroy() { }
    }

    class SequenceFrame2DInstanceBatch {
        constructor() {
            this._recoverList = new Laya.FastSinglelist();
        }
        static __init__() {
            if (BatchManager.registry[Laya.BaseRender2DType.sequenceFrame2D]) {
                return;
            }
            BatchManager.registerProvider(Laya.BaseRender2DType.sequenceFrame2D, SequenceFrame2DInstanceBatch);
        }
        batch(list, start, end, allowReorder) {
            if (start > end) {
                return;
            }
            const elementArray = list.elements;
            let batchStart = -1;
            let headElement = null;
            let instanceCount = 0;
            for (let i = start; i <= end; i++) {
                const element = elementArray[i];
                const renderer = element._sequenceFrame2DRender;
                const count = renderer ? renderer.activeInstanceCount : 0;
                if (count <= 0) {
                    continue;
                }
                if (batchStart < 0) {
                    batchStart = i;
                    headElement = element;
                    instanceCount = count;
                    continue;
                }
                if (!this.check(headElement, element) || instanceCount + count > SequenceFrame2DInstanceBatchTool.MaxInstanceCount) {
                    this._batchInternal(list, batchStart, i - 1);
                    batchStart = i;
                    headElement = element;
                    instanceCount = count;
                }
                else {
                    instanceCount += count;
                }
            }
            if (batchStart >= 0) {
                this._batchInternal(list, batchStart, end);
            }
        }
        reset() {
            this.recover();
        }
        destroy() {
            this.recover();
            this._recoverList.length = 0;
        }
        check(left, right) {
            const leftRenderer = left._sequenceFrame2DRender;
            const rightRenderer = right._sequenceFrame2DRender;
            if (!leftRenderer || !rightRenderer) {
                return false;
            }
            if (!leftRenderer._canBatchWith(rightRenderer)) {
                return false;
            }
            if (left.materialShaderData !== right.materialShaderData ||
                left.subShader !== right.subShader) {
                return false;
            }
            const leftOwner = left.owner;
            const rightOwner = right.owner;
            if (leftOwner.globalRenderData !== rightOwner.globalRenderData) {
                return false;
            }
            if (leftOwner.getClipInfo && rightOwner.getClipInfo && leftOwner.getClipInfo() !== rightOwner.getClipInfo()) {
                return false;
            }
            return true;
        }
        recover() {
            const recoverArray = this._recoverList.elements;
            for (let i = 0, n = this._recoverList.length; i < n; i++) {
                SequenceFrame2DInstanceBatchTool.recover(recoverArray[i]);
            }
            this._recoverList.length = 0;
        }
        _batchInternal(list, start, end) {
            const elementArray = list.elements;
            const activeElements = [];
            let totalInstanceCount = 0;
            for (let i = start; i <= end; i++) {
                const element = elementArray[i];
                const renderer = element._sequenceFrame2DRender;
                const count = renderer ? renderer.activeInstanceCount : 0;
                if (count > 0) {
                    activeElements.push(element);
                    totalInstanceCount += count;
                }
            }
            if (totalInstanceCount <= 0) {
                return;
            }
            if (activeElements.length === 1) {
                list.add(activeElements[0]);
                return;
            }
            const info = SequenceFrame2DInstanceBatchTool.getBatchInfo();
            this._recoverList.add(info);
            const configHash = this._getConfigHash(activeElements, totalInstanceCount);
            const uploadConfig = !info.configValid || info.configHash !== configHash;
            const firstRenderer = activeElements[0]._sequenceFrame2DRender;
            if (this._isContiguousInstanceIDRange(activeElements)) {
                const firstID = firstRenderer.instanceID;
                firstRenderer._uploadRuntimeDataRange(info.runtimeVB, firstID, totalInstanceCount);
                if (uploadConfig) {
                    firstRenderer._uploadConfigDataRange(info.configVB, firstID, totalInstanceCount);
                    info.configHash = configHash;
                    info.configValid = true;
                }
            }
            else {
                const runtimeStride = Laya.SequenceFrame2DShader.RUNTIME_FLOAT_STRIDE;
                const configStride = Laya.SequenceFrame2DShader.CONFIG_FLOAT_STRIDE;
                const runtimeData = SequenceFrame2DInstanceBatchTool._instanceBufferCreate(runtimeStride * SequenceFrame2DInstanceBatchTool.MaxInstanceCount);
                this._copyRuntimeData(activeElements, runtimeData);
                info.runtimeVB.setData(runtimeData.buffer, 0, 0, totalInstanceCount * runtimeStride * 4);
                SequenceFrame2DInstanceBatchTool._instanceBufferRecover(runtimeData);
                if (uploadConfig) {
                    const configData = SequenceFrame2DInstanceBatchTool._instanceBufferCreate(configStride * SequenceFrame2DInstanceBatchTool.MaxInstanceCount);
                    this._copyConfigData(activeElements, configData);
                    info.configVB.setData(configData.buffer, 0, 0, totalInstanceCount * configStride * 4);
                    SequenceFrame2DInstanceBatchTool._instanceBufferRecover(configData);
                    info.configHash = configHash;
                    info.configValid = true;
                }
            }
            const first = activeElements[0];
            const geometry = info.geometry;
            geometry.instanceCount = totalInstanceCount;
            geometry.indexFormat = first.geometry.indexFormat;
            const batchElement = info.element;
            batchElement.materialShaderData = first.materialShaderData;
            batchElement.value2DShaderData = first.value2DShaderData;
            batchElement.globalShaderData = first.globalShaderData;
            batchElement.subShader = first.subShader;
            batchElement.renderStateIsBySprite = first.renderStateIsBySprite;
            batchElement.stencilClipState = first.stencilClipState;
            batchElement.nodeCommonMap = first.nodeCommonMap;
            batchElement.owner = first.owner;
            list.add(batchElement);
        }
        _isContiguousInstanceIDRange(activeElements) {
            let expectedID = -1;
            for (let i = 0, n = activeElements.length; i < n; i++) {
                const renderer = activeElements[i]._sequenceFrame2DRender;
                const id = renderer.instanceID;
                const count = renderer.activeInstanceCount;
                if (id < 0 || count <= 0)
                    return false;
                if (expectedID >= 0 && id !== expectedID)
                    return false;
                expectedID = id + count;
            }
            return true;
        }
        _copyRuntimeData(activeElements, target) {
            const stride = Laya.SequenceFrame2DShader.RUNTIME_FLOAT_STRIDE;
            this._copySharedDataRuns(activeElements, target, stride, (sourceRenderer, targetOffset, startID, count) => {
                sourceRenderer._copyRuntimeDataRange(target, targetOffset, startID, count);
            });
        }
        _copyConfigData(activeElements, target) {
            const stride = Laya.SequenceFrame2DShader.CONFIG_FLOAT_STRIDE;
            this._copySharedDataRuns(activeElements, target, stride, (sourceRenderer, targetOffset, startID, count) => {
                sourceRenderer._copyConfigDataRange(target, targetOffset, startID, count);
            });
        }
        _copySharedDataRuns(activeElements, target, stride, copyRun) {
            const sourceRenderer = activeElements[0]._sequenceFrame2DRender;
            let targetOffset = 0;
            let runStartID = -1;
            let runCount = 0;
            let expectedID = -1;
            const flush = () => {
                if (runCount <= 0)
                    return;
                copyRun(sourceRenderer, targetOffset, runStartID, runCount);
                targetOffset += runCount * stride;
                runCount = 0;
            };
            for (let i = 0, n = activeElements.length; i < n; i++) {
                const renderer = activeElements[i]._sequenceFrame2DRender;
                const id = renderer.instanceID;
                const count = renderer.activeInstanceCount;
                if (id < 0 || count <= 0)
                    continue;
                if (runCount > 0 && id === expectedID) {
                    runCount += count;
                    expectedID = id + count;
                    continue;
                }
                flush();
                runStartID = id;
                runCount = count;
                expectedID = id + count;
            }
            flush();
        }
        _getConfigHash(activeElements, totalInstanceCount) {
            let hash = totalInstanceCount | 0;
            for (let i = 0, n = activeElements.length; i < n; i++) {
                const renderer = activeElements[i]._sequenceFrame2DRender;
                hash = Math.imul(hash ^ renderer.instanceID, 16777619);
                hash = Math.imul(hash ^ renderer.getRenderID(), 16777619);
                hash = Math.imul(hash ^ renderer.configVersion, 16777619);
                hash = Math.imul(hash ^ renderer.activeInstanceCount, 16777619);
            }
            return hash;
        }
    }
    class SequenceFrame2DInstanceBatchTool {
        static getBatchInfo() {
            return SequenceFrame2DInstanceBatchTool._batchInfoPool.pop() || SequenceFrame2DInstanceBatchTool.createBatchInfo();
        }
        static createBatchInfo() {
            const element = Laya.LayaGL.render2DRenderPassFactory.createRenderElement2D();
            const geometry = Laya.LayaGL.renderDeviceFactory.createRenderGeometryElement(Laya.MeshTopology.Triangles, Laya.DrawType.DrawElementInstance);
            const state = Laya.LayaGL.renderDeviceFactory.createBufferState();
            const runtimeVB = Laya.LayaGL.renderDeviceFactory.createVertexBuffer(Laya.BufferUsage.Dynamic);
            const configVB = Laya.LayaGL.renderDeviceFactory.createVertexBuffer(Laya.BufferUsage.Dynamic);
            runtimeVB.vertexDeclaration = Laya.SequenceFrame2DShader.runtimeDeclaration;
            runtimeVB.instanceBuffer = true;
            runtimeVB.setDataLength(SequenceFrame2DInstanceBatchTool.MaxInstanceCount * Laya.SequenceFrame2DShader.RUNTIME_FLOAT_STRIDE * 4);
            configVB.vertexDeclaration = Laya.SequenceFrame2DShader.configDeclaration;
            configVB.instanceBuffer = true;
            configVB.setDataLength(SequenceFrame2DInstanceBatchTool.MaxInstanceCount * Laya.SequenceFrame2DShader.CONFIG_FLOAT_STRIDE * 4);
            geometry.bufferState = state;
            geometry.indexFormat = Laya.IndexFormat.UInt16;
            geometry.setDrawElemenParams(6, 0);
            geometry.instanceCount = 0;
            state.applyState([Laya.SequenceFrame2DShader._vbs, runtimeVB, configVB], Laya.SequenceFrame2DShader._ibs);
            element.geometry = geometry;
            element.renderStateIsBySprite = false;
            element.nodeCommonMap = ["BaseRender2D"];
            return {
                element,
                geometry,
                state,
                runtimeVB,
                configVB,
                configHash: -1,
                configValid: false,
            };
        }
        static recover(info) {
            const element = info.element;
            element.materialShaderData = null;
            element.stencilClipState = null;
            element.value2DShaderData = null;
            element.globalShaderData = null;
            element.subShader = null;
            element.owner = null;
            element.nodeCommonMap = ["BaseRender2D"];
            info.geometry.clearRenderParams();
            info.geometry.setDrawElemenParams(6, 0);
            info.geometry.instanceCount = 0;
            SequenceFrame2DInstanceBatchTool._batchInfoPool.push(info);
        }
        static _instanceBufferCreate(length) {
            let array = SequenceFrame2DInstanceBatchTool._bufferPool[length];
            if (!array) {
                array = SequenceFrame2DInstanceBatchTool._bufferPool[length] = [];
            }
            return array.pop() || new Float32Array(length);
        }
        static _instanceBufferRecover(float32) {
            const length = float32.length;
            let array = SequenceFrame2DInstanceBatchTool._bufferPool[length];
            if (!array) {
                array = SequenceFrame2DInstanceBatchTool._bufferPool[length] = [];
            }
            array.push(float32);
        }
    }
    SequenceFrame2DInstanceBatchTool.MaxInstanceCount = 4096;
    SequenceFrame2DInstanceBatchTool._batchInfoPool = [];
    SequenceFrame2DInstanceBatchTool._bufferPool = [];
    SequenceFrame2DInstanceBatch.__init__();

    class Web2DGraphicWholeBuffer {
        constructor() {
            this._num = 0;
            this._updateRange = new Laya.Vector2(100000000, -100000000);
        }
        _modifyOneView(view) {
            this._updateRange.y = Math.max(view.start + view.length, this._updateRange.y);
            this._updateRange.x = Math.min(view.start, this._updateRange.x);
        }
        addDataView(view) {
            view._next = null;
            view._prev = null;
            if (!this._first) {
                this._first = view;
            }
            if (this._last) {
                this._last._next = view;
                view._prev = this._last;
            }
            view.owner = this;
            this._last = view;
            this._num++;
        }
        removeDataView(view) {
            view.owner = null;
            if (view._prev) {
                view._prev._next = view._next;
            }
            if (view._next) {
                view._next._prev = view._prev;
            }
            if (view == this._first) {
                this._first = view._next;
            }
            if (view == this._last) {
                this._last = view._prev;
            }
            view._next = null;
            view._prev = null;
            this._updateRange.x = Math.min(view.start, this._updateRange.x);
            this._updateRange.y = Math.max(view.start + view.length, this._updateRange.y);
            this._num--;
        }
        destroy() {
            let view = this._first;
            while (view) {
                let next = view._next;
                view.owner = null;
                view._prev = null;
                view._next = null;
                view = next;
            }
            this._first = null;
            this._last = null;
            this._dataView = null;
            this.arrayBuffer = null;
        }
    }
    class Web2DGraphicsVertexBuffer extends Web2DGraphicWholeBuffer {
        resetData(byteLength) {
            this.arrayBuffer = new ArrayBuffer(byteLength);
            let newData = new Float32Array(this.arrayBuffer);
            if (this._dataView) {
                newData.set(this._dataView);
            }
            this._dataView = newData;
            this._needResetData = true;
        }
        _upload() {
            if (this._needResetData) {
                let view = this._first;
                while (view) {
                    view._updateView(this._dataView);
                    view = view._next;
                }
                this.buffer.setData(this.arrayBuffer, 0, 0, this.arrayBuffer.byteLength);
                this._needResetData = false;
            }
            else {
                if (this._updateRange.y <= this._updateRange.x)
                    return;
                this.buffer.setData(this.arrayBuffer, this._updateRange.x * 4, this._updateRange.x * 4, (this._updateRange.y - this._updateRange.x) * 4);
            }
            this._updateRange.setValue(100000000, -100000000);
        }
    }
    class Web2DGraphicsIndexBuffer extends Web2DGraphicWholeBuffer {
        resetData(_byteLength) {
            this.arrayBuffer = null;
            this._dataView = null;
            this._needResetData = true;
        }
        static _getUploadScratch(length) {
            let arrayType = Laya.GraphicsDefines.GRAPHICS_INDEX_ARRAY_TYPE;
            let scratch = Web2DGraphicsIndexBuffer._uploadScratch;
            if (!scratch || scratch.length < length || scratch.constructor !== arrayType) {
                let capacity = scratch && scratch.constructor === arrayType ? Math.max(length, scratch.length * 2) : length;
                Web2DGraphicsIndexBuffer._uploadScratch = scratch = new arrayType(capacity);
            }
            return scratch;
        }
        _updateStartsAndDrawParams(indexByteSize) {
            let view = this._first;
            let start = 0;
            let geometry = view ? view._geometry : null;
            let geometryStart = 0;
            let geometryLength = 0;
            while (view) {
                if (geometry != view._geometry) {
                    if (geometry && geometryLength > 0) {
                        geometry.clearRenderParams();
                        geometry.setDrawElemenParams(geometryLength, geometryStart * indexByteSize);
                    }
                    geometry = view._geometry;
                    geometryStart = start;
                    geometryLength = 0;
                }
                view.start = start;
                geometryLength += view.length;
                start += view.length;
                view = view._next;
            }
            if (geometry && geometryLength > 0) {
                geometry.clearRenderParams();
                geometry.setDrawElemenParams(geometryLength, geometryStart * indexByteSize);
            }
            return start;
        }
        _copyViewsToScratch(rangeStart, rangeEnd, scratch) {
            let view = this._first;
            while (view && view.start + view.length <= rangeStart)
                view = view._next;
            while (view && view.start < rangeEnd) {
                scratch.set(view._getData(), view.start);
                view = view._next;
            }
        }
        _uploadScratchRange(uploadStart, uploadEnd, indexByteSize) {
            if (uploadEnd <= uploadStart)
                return;
            let uploadByteStart = uploadStart * indexByteSize;
            let uploadByteEnd = uploadEnd * indexByteSize;
            let alignedByteStart = Math.floor(uploadByteStart / 4) * 4;
            let alignedByteEnd = Math.ceil(uploadByteEnd / 4) * 4;
            let alignedStart = alignedByteStart / indexByteSize;
            let alignedEnd = alignedByteEnd / indexByteSize;
            let dataLength = alignedByteEnd - alignedByteStart;
            let scratch = Web2DGraphicsIndexBuffer._getUploadScratch(alignedEnd);
            scratch.fill(0, alignedStart, alignedEnd);
            this._copyViewsToScratch(alignedStart, alignedEnd, scratch);
            this.buffer.setData(scratch.buffer, alignedByteStart, alignedByteStart, dataLength);
        }
        _upload() {
            if (!this._num) {
                this._needResetData = false;
                this._updateRange.setValue(100000000, -100000000);
                return;
            }
            if (!this._needResetData && this._updateRange.y <= this._updateRange.x)
                return;
            let indexByteSize = Laya.GraphicsDefines.GRAPHICS_INDEX_BYTE_SIZE;
            let uploadStart = this._needResetData ? 0 : this._updateRange.x;
            let totalLength = this._updateStartsAndDrawParams(indexByteSize);
            uploadStart = Math.max(0, Math.min(uploadStart, totalLength));
            this._uploadScratchRange(uploadStart, totalLength, indexByteSize);
            this._needResetData = false;
            this._updateRange.setValue(100000000, -100000000);
        }
        _modifyOneView(view) {
            if (view._prev) {
                view.start = view._prev.start + view._prev.length;
            }
            else {
                view.start = 0;
            }
            super._modifyOneView(view);
        }
    }
    class Web2DGraphicsIndexBatchBuffer extends Web2DGraphicsIndexBuffer {
        constructor() {
            super(...arguments);
            this._writeLength = 0;
        }
        appendIndexData(data, geometry) {
            let start = this._writeLength;
            let end = start + data.length;
            this._ensureBatchData(end);
            this._batchData.set(data, start);
            this._writeLength = end;
            this._updateRange.x = Math.min(start, this._updateRange.x);
            this._updateRange.y = Math.max(end, this._updateRange.y);
            if (geometry) {
                geometry.clearRenderParams();
                geometry.setDrawElemenParams(data.length, start * Laya.GraphicsDefines.GRAPHICS_INDEX_BYTE_SIZE);
            }
            return start;
        }
        _ensureBatchData(requiredLength) {
            let arrayType = Laya.GraphicsDefines.GRAPHICS_INDEX_ARRAY_TYPE;
            let batchData = this._batchData;
            if (batchData && batchData.length >= requiredLength && batchData.constructor === arrayType)
                return;
            let capacity = batchData && batchData.constructor === arrayType
                ? Math.max(requiredLength, batchData.length * 2)
                : requiredLength;
            let newData = new arrayType(capacity);
            if (batchData && batchData.constructor === arrayType)
                newData.set(batchData);
            this._batchData = newData;
        }
        _upload() {
            if (!this._writeLength) {
                this._needResetData = false;
                this._updateRange.setValue(100000000, -100000000);
                return;
            }
            if (!this._needResetData && this._updateRange.y <= this._updateRange.x)
                return;
            let indexByteSize = Laya.GraphicsDefines.GRAPHICS_INDEX_BYTE_SIZE;
            let uploadStart = this._needResetData ? 0 : this._updateRange.x;
            let uploadEnd = Math.min(this._writeLength, this._updateRange.y);
            uploadStart = Math.max(0, Math.min(uploadStart, uploadEnd));
            if (uploadEnd > uploadStart) {
                let uploadByteStart = uploadStart * indexByteSize;
                let uploadByteEnd = uploadEnd * indexByteSize;
                let alignedByteStart = Math.floor(uploadByteStart / 4) * 4;
                let alignedByteEnd = Math.ceil(uploadByteEnd / 4) * 4;
                let alignedEnd = alignedByteEnd / indexByteSize;
                this._ensureBatchData(alignedEnd);
                if (alignedEnd > this._writeLength) {
                    this._batchData.fill(0, this._writeLength, alignedEnd);
                }
                this.buffer.setData(this._batchData.buffer, alignedByteStart, alignedByteStart, alignedByteEnd - alignedByteStart);
            }
            this._needResetData = false;
            this._updateRange.setValue(100000000, -100000000);
        }
        clearBufferViews() {
            let view = this._first;
            while (view) {
                let next = view._next;
                view.owner = null;
                view._prev = null;
                view._next = null;
                view = next;
            }
            this._first = null;
            this._last = null;
            this._num = 0;
            this._writeLength = 0;
            this._updateRange.setValue(100000000, -100000000);
        }
        _resetData(byteLength) {
            super.resetData(byteLength);
        }
        destroy() {
            this._batchData = null;
            this._writeLength = 0;
            super.destroy();
        }
    }

    const _STEP_ = 1024;
    const TEXTURE_VARIANT_TYPE_MASK = Laya.ShaderDefines2D.DEFINE_BIT_GAMMATEXTURE
        | Laya.ShaderDefines2D.DEFINE_BIT_USE_TEX_ARRAY;
    class BatchBuffer {
        constructor() {
            this.indexCount = 0;
            this.maxIndexCount = 0;
            this.bufferStates = new Map();
            this.indexBuffer = Laya.LayaGL.renderDeviceFactory.createIndexBuffer(Laya.BufferUsage.Dynamic);
            this.indexBuffer.indexType = Laya.GraphicsDefines.GRAPHICS_INDEX_FORMAT;
            this.wholeBuffer = new Web2DGraphicsIndexBatchBuffer();
            this.wholeBuffer.buffer = this.indexBuffer;
        }
        add(element) {
            let geometry = null;
            if (element._index != null) {
                let entry = element._graphicsBatchEntry;
                if (!entry) {
                    let handle = element.owner.renderDataHandler;
                    entry = handle.getGraphicsBatchEntry(element._index);
                }
                if (entry) {
                    let sourceIndexView = entry.sourceIndexView;
                    geometry = entry.batchGeometry;
                    let bufferState = this.bindBuffer(entry.vertexBuffer);
                    this.indexCount += sourceIndexView.length;
                    this.updateBufLength();
                    this.wholeBuffer.appendIndexData(sourceIndexView._getData(), geometry);
                    if (geometry.bufferState !== bufferState)
                        geometry.bufferState = bufferState;
                    WebRender2DPass.setBuffer(this.wholeBuffer);
                }
            }
            return geometry;
        }
        updateBufLength() {
            if (this.maxIndexCount <= this.indexCount) {
                let nLength = Math.ceil(this.indexCount / _STEP_) * _STEP_;
                let byteLength = nLength * Laya.GraphicsDefines.GRAPHICS_INDEX_BYTE_SIZE;
                this.indexBuffer._setIndexDataLength(byteLength);
                this.wholeBuffer._resetData(byteLength);
                this.maxIndexCount = nLength;
            }
        }
        bindBuffer(buffer) {
            let bufferState = this.bufferStates.get(buffer);
            if (!bufferState) {
                bufferState = Laya.LayaGL.renderDeviceFactory.createBufferState();
                bufferState.applyState([buffer], this.indexBuffer);
                this.bufferStates.set(buffer, bufferState);
            }
            return bufferState;
        }
        clear() {
            this.indexCount = 0;
            this.wholeBuffer.clearBufferViews();
        }
        destroy() {
            this.clear();
            this.bufferStates.forEach(bufferState => bufferState.destroy());
            this.bufferStates.clear();
            this.indexBuffer.destroy();
            this.indexBuffer = null;
            this.wholeBuffer.destroy();
            this.wholeBuffer = null;
        }
    }
    class BaseBatchContext {
        constructor() {
            this.textureId = 0;
            this.globalAlpha = 1;
            this.clipInfo = null;
            this.subShader = null;
            this.bufferState = null;
            this.primitiveShaderData = null;
            this.materialShaderData = null;
            this.typeKey = 0;
            this.textureKey = 0;
            this.globalRenderData = null;
            this.fillTexture = false;
        }
        _isTypeKeyCompatible(element) {
            if (this.typeKey === element.typeKey)
                return true;
            if (this.textureId !== 0 && element.textureKey !== 0)
                return false;
            return ((this.typeKey ^ element.typeKey) & ~TEXTURE_VARIANT_TYPE_MASK) === 0;
        }
        _adoptTextureState(element) {
            this.textureId = element.textureKey;
            this.textureKey = element.textureKey;
            this.typeKey = element.typeKey;
            this.primitiveShaderData = element.primitiveShaderData;
        }
    }
    class WebGLBatchContext extends BaseBatchContext {
        setHead(element) {
            this.primitiveShaderData = element.primitiveShaderData;
            this.materialShaderData = element.materialShaderData;
            this.subShader = element.subShader;
            this.bufferState = element.geometry.bufferState;
            this.typeKey = element.typeKey;
            this.textureKey = element.textureKey;
            this.textureId = element.textureKey;
            this.globalAlpha = element.owner.globalAlpha;
            this.clipInfo = element.owner.getClipInfo();
            this.globalRenderData = element.owner.globalRenderData;
            this.fillTexture = !!(element.typeKey & Laya.ShaderDefines2D.DEFINE_BIT_FILLTEXTURE);
            this.texRange = this.primitiveShaderData.getVector(Laya.ShaderDefines2D.UNIFORM_TEXRANGE);
        }
        isCompatible(element) {
            if (!this._isTypeKeyCompatible(element)) {
                return false;
            }
            let elementTexId = element.textureKey;
            if (elementTexId !== 0 && elementTexId !== this.textureId && this.textureId !== 0)
                return false;
            if (this.subShader !== element.subShader ||
                this.bufferState !== element.geometry.bufferState ||
                this.clipInfo !== element.owner.getClipInfo() ||
                element.owner.globalRenderData !== this.globalRenderData) {
                return false;
            }
            if ((this.typeKey & Laya.ShaderDefines2D.TYPEKEY_CUSTOM_MATERIAL) !== 0 && element.materialShaderData !== this.materialShaderData) {
                return false;
            }
            if (this.fillTexture) {
                if (!element.primitiveShaderData.getVector(Laya.ShaderDefines2D.UNIFORM_TEXRANGE).equal(this.texRange))
                    return false;
            }
            if (this.textureId === 0 && elementTexId !== 0) {
                this._adoptTextureState(element);
            }
            return true;
        }
    }
    class WebGPUBatchContext extends BaseBatchContext {
        setHead(element) {
            this.primitiveShaderData = element.primitiveShaderData;
            this.materialShaderData = element.materialShaderData;
            this.subShader = element.subShader;
            this.bufferState = element.geometry.bufferState;
            this.typeKey = element.typeKey;
            this.textureKey = element.textureKey;
            this.textureId = element.textureKey;
            this.globalAlpha = element.owner.globalAlpha;
            this.clipInfo = element.owner.getClipInfo();
            this.globalRenderData = element.owner.globalRenderData;
            this.fillTexture = !!(element.typeKey & Laya.ShaderDefines2D.DEFINE_BIT_FILLTEXTURE);
            this.texRange = this.primitiveShaderData.getVector(Laya.ShaderDefines2D.UNIFORM_TEXRANGE);
        }
        isCompatible(element) {
            if (!this._isTypeKeyCompatible(element)) {
                return false;
            }
            let elementTexId = element.textureKey;
            if (elementTexId !== 0 && elementTexId !== this.textureId && this.textureId !== 0)
                return false;
            if (this.subShader !== element.subShader ||
                this.bufferState !== element.geometry.bufferState ||
                this.clipInfo !== element.owner.getClipInfo() ||
                element.owner.globalRenderData !== this.globalRenderData) {
                return false;
            }
            if ((this.typeKey & Laya.ShaderDefines2D.TYPEKEY_CUSTOM_MATERIAL) !== 0 && element.materialShaderData !== this.materialShaderData) {
                return false;
            }
            if (this.fillTexture) {
                let primitiveShaderData = element.primitiveShaderData;
                if (!primitiveShaderData.getVector(Laya.ShaderDefines2D.UNIFORM_TEXRANGE).equal(this.texRange))
                    return false;
            }
            if (this.textureId === 0 && elementTexId !== 0) {
                this._adoptTextureState(element);
            }
            return true;
        }
    }
    class WebGraphicsBatch {
        constructor() {
            this._buffer = new BatchBuffer();
            this._merged = [];
            let isWebgl = !!Laya.LayaGL.renderEngine.gl;
            if (isWebgl) {
                this._context = new WebGLBatchContext();
            }
            else {
                this._context = new WebGPUBatchContext();
            }
        }
        reset() {
            this._buffer.clear();
            WebGraphicsBatch._pool.recover(this._merged);
        }
        destroy() {
            this._buffer.destroy();
            WebGraphicsBatch._pool.recover(this._merged);
        }
        batch(list, start, end, allowReorder) {
            let elementArray = list.elements;
            let ctx = this._context;
            ctx.setHead(elementArray[start]);
            let cnt = end - start + 1;
            if (cnt > 1000)
                allowReorder = false;
            if (allowReorder) {
                if (elementFlags == null)
                    initCache(1000);
                let headGroup = 0;
                let maxGroup = 1;
                let indiceLen = 1;
                elementIndice[0] = start;
                elementFlags[0] = 0;
                for (let i = 1; i < cnt; i++) {
                    let element = elementArray[start + i];
                    elementFlags[i] = -1;
                    let rect = element.owner.rect;
                    rectLeftCache[i] = rect.x;
                    rectTopCache[i] = rect.y;
                    rectRightCache[i] = rect.x + rect.width;
                    rectBottomCache[i] = rect.y + rect.height;
                }
                for (let i = 1; i < cnt; i++) {
                    let element = elementArray[start + i];
                    let group = elementFlags[i];
                    if (group === -2) {
                        continue;
                    }
                    if (group !== -1) {
                        if (group === headGroup) {
                            elementIndice[indiceLen++] = start + i;
                            continue;
                        }
                    }
                    else {
                        if (ctx.isCompatible(element)) {
                            elementIndice[indiceLen++] = start + i;
                            continue;
                        }
                        elementFlags[i] = group = maxGroup++;
                    }
                    for (let j = i + 1; j < cnt; j++) {
                        let element2 = elementArray[start + j];
                        if (elementFlags[j] !== -1) {
                            if (elementFlags[j] !== headGroup)
                                continue;
                        }
                        else {
                            if (!ctx.isCompatible(element2))
                                continue;
                        }
                        for (let k = j - 1; k >= i; k--) {
                            if (elementFlags[k] !== -2
                                && rectLeftCache[j] < rectRightCache[k] && rectRightCache[j] > rectLeftCache[k]
                                && rectTopCache[j] < rectBottomCache[k] && rectBottomCache[j] > rectTopCache[k]) {
                                element2 = null;
                                break;
                            }
                        }
                        if (element2 != null) {
                            elementIndice[indiceLen++] = start + j;
                            elementFlags[j] = -2;
                        }
                        else if (ctx.textureId !== 0)
                            elementFlags[j] = headGroup;
                    }
                    list.add(this.merge(elementArray, 0, indiceLen - 1, ctx, elementIndice));
                    indiceLen = 1;
                    elementIndice[0] = start + i;
                    headGroup = group;
                    ctx.setHead(element);
                }
                list.add(this.merge(elementArray, 0, indiceLen - 1, ctx, elementIndice));
            }
            else {
                let batchStart = start;
                for (let i = start + 1; i <= end; i++) {
                    let element = elementArray[i];
                    if (!ctx.isCompatible(element)) {
                        list.add(this.merge(elementArray, batchStart, i - 1, ctx));
                        batchStart = i;
                        ctx.setHead(element);
                    }
                }
                list.add(this.merge(elementArray, batchStart, end, ctx));
            }
        }
        merge(elementArray, start, end, batchContext, indice) {
            if (start === end) {
                let element = elementArray[indice !== undefined ? indice[start] : start];
                return element;
            }
            let staticBatchRenderElement = WebGraphicsBatch._pool.take();
            this._merged.push(staticBatchRenderElement);
            let batchedGeometry = staticBatchRenderElement.geometry;
            let currentOffset = 0;
            let currentCount = 0;
            let isFirst = true;
            for (let i = start; i <= end; i++) {
                let element = elementArray[indice !== undefined ? indice[i] : i];
                let geometry = this._buffer.add(element) || element.geometry;
                if (i === start) {
                    batchedGeometry.bufferState = geometry.bufferState;
                    staticBatchRenderElement.materialShaderData = element.materialShaderData;
                    staticBatchRenderElement.value2DShaderData = element.value2DShaderData;
                    staticBatchRenderElement.subShader = element.subShader;
                    staticBatchRenderElement.renderStateIsBySprite = element.renderStateIsBySprite;
                    staticBatchRenderElement.primitiveShaderData = batchContext.primitiveShaderData;
                    staticBatchRenderElement.owner = element.owner;
                    staticBatchRenderElement.stencilClipState = element.stencilClipState;
                    staticBatchRenderElement.typeKey = batchContext.typeKey;
                    staticBatchRenderElement.textureKey = batchContext.textureKey;
                }
                let drawParam = geometry.drawParams.elements;
                let drawLength = geometry.drawParams.length;
                for (let j = 0; j < drawLength; j += 2) {
                    let offset = drawParam[j];
                    let count = drawParam[j + 1];
                    if (isFirst) {
                        currentOffset = offset;
                        currentCount = count;
                        isFirst = false;
                        continue;
                    }
                    if (currentOffset + currentCount * Laya.GraphicsDefines.GRAPHICS_INDEX_BYTE_SIZE === offset) {
                        currentCount += count;
                    }
                    else {
                        batchedGeometry.setDrawElemenParams(currentCount, currentOffset);
                        currentOffset = offset;
                        currentCount = count;
                    }
                }
            }
            if (!isFirst) {
                batchedGeometry.setDrawElemenParams(currentCount, currentOffset);
            }
            return staticBatchRenderElement;
        }
    }
    WebGraphicsBatch._pool = Laya.Pool.createPool2(() => {
        let element = Laya.LayaGL.render2DRenderPassFactory.createPrimitiveRenderElement2D();
        element.geometry = Laya.LayaGL.renderDeviceFactory.createRenderGeometryElement(Laya.MeshTopology.Triangles, Laya.DrawType.DrawElement);
        element.geometry.indexFormat = Laya.GraphicsDefines.GRAPHICS_INDEX_FORMAT;
        element.nodeCommonMap = ["Sprite2D"];
        element.renderStateIsBySprite = false;
        return element;
    }, null, element => {
        element.geometry.clearRenderParams();
        element.geometry.bufferState = null;
        element.materialShaderData = null;
        element.value2DShaderData = null;
        element.primitiveShaderData = null;
        element.subShader = null;
        element.owner = null;
        element.renderStateIsBySprite = false;
        element.globalShaderData = null;
        element.stencilClipState = null;
        element.noBatch = false;
        element.typeKey = 0;
        element.textureKey = 0;
    });
    var elementFlags;
    var elementIndice;
    var rectLeftCache;
    var rectTopCache;
    var rectRightCache;
    var rectBottomCache;
    function initCache(maxElements) {
        elementFlags = new Int16Array(maxElements);
        elementIndice = new Int16Array(maxElements);
        rectLeftCache = new Float32Array(maxElements);
        rectTopCache = new Float32Array(maxElements);
        rectRightCache = new Float32Array(maxElements);
        rectBottomCache = new Float32Array(maxElements);
    }

    class WebStencilClip2D {
        constructor() {
            this._targetStack = [];
            this._activeStack = [];
            this._maskElements = [];
            this._maskElementCount = 0;
            this._contentStates = [];
            this._lastMaskOwner = null;
            this._stencilOffState = {
                enabled: false,
                test: Laya.RenderState.STENCILTEST_OFF,
                write: Laya.RenderState.Default.stencilWrite,
                ref: Laya.RenderState.Default.stencilRef,
                readMask: Laya.RenderState.Default.stencilReadMask,
                writeMask: Laya.RenderState.Default.stencilWriteMask,
                opFail: Laya.RenderState.Default.stencilOp.x,
                opZFail: Laya.RenderState.Default.stencilOp.y,
                opZPass: Laya.RenderState.Default.stencilOp.z
            };
        }
        beginBuild() {
            this.reset();
        }
        reset() {
            this._activeStack.length = 0;
            this._maskElementCount = 0;
            this._lastMaskOwner = null;
        }
        appendElement(element, addElement) {
            const owner = element.owner;
            const clipInfo = owner && !owner.forceShaderClip ? owner.getClipInfo() : null;
            const depth = clipInfo && clipInfo.clipDepth > 0 ? this._buildClipStack(clipInfo) : 0;
            if (depth <= 0) {
                this._emitStackTransition(owner, 0, addElement);
                element.stencilClipState = this._stencilOffState;
                addElement(element);
                return;
            }
            this._emitStackTransition(owner, depth, addElement);
            element.stencilClipState = this._getContentState(depth);
            addElement(element);
        }
        finishBuild(addElement) {
            this._emitStackTransition(this._lastMaskOwner, 0, addElement);
        }
        _emitStackTransition(owner, targetDepth, addElement) {
            owner = owner || this._lastMaskOwner;
            let common = 0;
            const maxCommon = Math.min(this._activeStack.length, targetDepth);
            while (common < maxCommon && this._activeStack[common] === this._targetStack[common])
                common++;
            for (let i = this._activeStack.length - 1; i >= common; i--) {
                const maskElement = this._getMaskElement();
                maskElement.setClip(owner, this._activeStack[i], i + 1, Laya.RenderState.STENCILOP_DECR);
                addElement(maskElement);
            }
            for (let i = common; i < targetDepth; i++) {
                const maskElement = this._getMaskElement();
                maskElement.setClip(owner, this._targetStack[i], i, Laya.RenderState.STENCILOP_INCR);
                addElement(maskElement);
            }
            this._activeStack.length = targetDepth;
            for (let i = 0; i < targetDepth; i++)
                this._activeStack[i] = this._targetStack[i];
            if (owner)
                this._lastMaskOwner = owner;
        }
        _buildClipStack(clipInfo) {
            const stack = this._targetStack;
            stack.length = 0;
            let info = clipInfo;
            while (info && info.clipDepth > 0) {
                stack.push(info);
                info = info.clipParent;
            }
            stack.reverse();
            return stack.length;
        }
        _getMaskElement() {
            const index = this._maskElementCount++;
            return this._maskElements[index] || (this._maskElements[index] = Laya.LayaGL.render2DRenderPassFactory.createStencilMaskElement2D());
        }
        _getContentState(ref) {
            let state = this._contentStates[ref];
            if (state)
                return state;
            state = {
                enabled: true,
                test: Laya.RenderState.STENCILTEST_EQUAL,
                write: false,
                ref,
                readMask: 0xFF,
                writeMask: 0x00,
                opFail: Laya.RenderState.STENCILOP_KEEP,
                opZFail: Laya.RenderState.STENCILOP_KEEP,
                opZPass: Laya.RenderState.STENCILOP_KEEP
            };
            this._contentStates[ref] = state;
            return state;
        }
    }

    BatchManager.registerProvider(Laya.BaseRender2DType.graphics, WebGraphicsBatch);
    class ReusableStructList extends Laya.FastSinglelist {
        constructor() {
            super(...arguments);
            this.previousLength = 0;
            this.generation = -1;
        }
    }
    class SortedStructs {
        constructor() {
            this.lists = new Map();
            this._indice = new Set;
            this._sortedIndice = [];
            this._generation = 0;
        }
        add(struct, zIndex) {
            let list = this.lists.get(zIndex);
            if (!list)
                this.lists.set(zIndex, list = new ReusableStructList());
            if (list.generation !== this._generation) {
                list.previousLength = list.length;
                list.length = 0;
                list.generation = this._generation;
            }
            list.add(struct);
            if (list.length === 1)
                this._indice.add(zIndex);
            return list;
        }
        reset() {
            this._generation++;
            this._sortedIndice.length = 0;
        }
        releaseUnused() {
            this._indice.forEach(i => {
                let list = this.lists.get(i);
                if (list.generation !== this._generation) {
                    list.elements.fill(null, 0, list.length);
                    list.length = 0;
                }
                else if (list.length < list.previousLength) {
                    list.elements.fill(null, list.length, list.previousLength);
                }
                list.previousLength = 0;
                if (list.length === 0)
                    this._indice.delete(i);
            });
        }
        clear() {
            this._indice.forEach(i => {
                let list = this.lists.get(i);
                list.elements.fill(null, 0, Math.max(list.length, list.previousLength));
                list.length = 0;
                list.previousLength = 0;
            });
            this._indice.clear();
            this._sortedIndice.length = 0;
        }
        get indice() {
            let arr = this._sortedIndice;
            if (arr.length === 0) {
                for (let zIndex of this._indice) {
                    arr.push(zIndex);
                }
                arr.sort((a, b) => a - b);
            }
            return arr;
        }
        appendTo(out) {
            this.indice.forEach(zIndex => out.addList(this.lists.get(zIndex)));
        }
    }
    class WebRender2DPass {
        get priority() {
            return this._priority;
        }
        set priority(value) {
            this._priority = value;
            if (this._mask)
                this._mask.setMaskParentPass(this);
        }
        get mask() {
            return this._mask;
        }
        set mask(value) {
            if (this._mask)
                this._mask.setMaskParentPass(null);
            this._mask = value;
            if (value)
                value.setMaskParentPass(this);
        }
        get enableBatch() {
            return this._enableBatch;
        }
        set enableBatch(value) {
            this.repaint = true;
            this._enableBatch = value;
        }
        setClearColor(r, g, b, a) {
            this._clearColor.setValue(r, g, b, a);
        }
        constructor() {
            this._renderElements = new Laya.FastSinglelist();
            this._elementGroups = new Laya.FastSinglelist();
            this._structs = new SortedStructs();
            this._structsPool = Laya.Pool.createPool(SortedStructs, null, obj => obj.clear());
            this._batchProviders = [];
            this._stencilClip2D = new WebStencilClip2D();
            this._priority = 0;
            this.enable = true;
            this.isSupport = false;
            this.postProcess = null;
            this.repaint = true;
            this._clearColor = new Laya.Color;
            this.doClearColor = true;
            this.finalize = null;
            this._enableBatch = true;
            this._rtsize = new Laya.Vector2;
            this.root = null;
            this.offsetMatrix = new Laya.Matrix();
            this._invertMat_0 = new Laya.Vector3(1, 1);
            this._invertMat_1 = new Laya.Vector3(0, 0);
            this.shaderData = null;
            this.destroyed = false;
            this.shaderData = Laya.LayaGL.renderDeviceFactory.createShaderData(null);
        }
        needRender() {
            return this.enable
                && !this.isSupport
                && (this.repaint || !this.renderTexture);
        }
        cullAndSort(context2D, struct) {
            if (!struct.enabled
                || struct.globalAlpha < 0.01
                || this._mask === struct)
                return;
            let renderStruct = (struct.subStruct && struct !== this.root) ? struct.subStruct : struct;
            renderStruct._handleInterData();
            let globalRenderData = struct.globalRenderData;
            if (globalRenderData) {
                if (struct._currentData.globalRenderData
                    && (struct.renderLayer & globalRenderData.renderLayerMask) === 0) {
                    return;
                }
                let cullRect = globalRenderData.cullRect;
                if (struct.inheritedEnableCulling && cullRect && !this._isRectIntersect(struct.rect, cullRect)) {
                    return;
                }
            }
            renderStruct.renderUpdate(context2D);
            let list = this._pStructs.add(renderStruct, struct._effectZ);
            if (struct.stackingRoot) {
                var oldCol = this._pStructs;
                this._pStructs = this._structsPool.take();
            }
            for (let i = 0, n = renderStruct.children.length; i < n; i++) {
                const child = renderStruct.children[i];
                child._effectZ = child.zIndex + struct._effectZ;
                this.cullAndSort(context2D, child);
            }
            if (oldCol) {
                this._pStructs.appendTo(list);
                this._structsPool.recover(this._pStructs);
                this._pStructs = oldCol;
            }
            if (struct.dcOptimize) {
                let last = list.length - 1;
                struct.dcOptimizeEnd = list.elements[last];
            }
        }
        _isRectIntersect(rect, cullRect) {
            let rect_minx = rect.x;
            let rect_maxx = rect.x + rect.width;
            let rect_miny = rect.y;
            let rect_maxy = rect.y + rect.height;
            return !(rect_maxx < cullRect.x || rect_minx > cullRect.y || rect_maxy < cullRect.z || rect_miny > cullRect.w);
        }
        fowardRender(context, renderTime) {
            var _a, _b;
            let success = this._initRenderProcess(context, renderTime);
            if (!success)
                return;
            if (this.repaint) {
                this._structs.reset();
                this._renderElements.length = 0;
                for (let i = 0, n = this._batchProviders.length; i < n; i++) {
                    (_a = this._batchProviders[i]) === null || _a === void 0 ? void 0 : _a.reset();
                }
                if (this.root) {
                    this._pStructs = this._structs;
                    this.cullAndSort(context, this.root);
                }
                this._structs.releaseUnused();
                if (this.root) {
                    this.fillRenderElements();
                    this._enableBatch && Laya.LayaEnv.isPlaying && this.batch();
                }
                WebRender2DPass.uploadBuffer();
                context.drawRenderElementList(this._renderElements);
                if (this._mask) {
                    let renderMask = this._mask.subStruct;
                    if (renderMask) {
                        renderMask._handleInterData();
                        renderMask.renderUpdate(context);
                        context.drawRenderElementOne(renderMask.renderElements[0]);
                    }
                }
                if ((_b = this.postProcess) === null || _b === void 0 ? void 0 : _b.enabled) {
                    this.postProcess.apply();
                }
            }
            else {
                this._structs.indice.forEach(index => {
                    let list = this._structs.lists.get(index);
                    for (let i = 0, cnt = list.length; i < cnt; i++) {
                        let struct = list.elements[i];
                        struct._handleInterData();
                        struct.renderUpdate(context);
                    }
                });
                WebRender2DPass.uploadBuffer();
                context.drawRenderElementList(this._renderElements);
            }
            this.repaint = false;
        }
        fillRenderElements() {
            this._elementGroups.length = 0;
            let groupStart = 0;
            let reorderRoot;
            let renderElements = this._renderElements;
            const stencilBuilder = this._stencilClip2D;
            const addRenderElement = (element) => {
                if (element.noBatch) {
                    if (groupStart !== renderElements.length) {
                        this._elementGroups.add(groupStart);
                        this._elementGroups.add(renderElements.length - 1);
                        this._elementGroups.add(false);
                    }
                    renderElements.add(element);
                    this._elementGroups.add(renderElements.length - 1);
                    this._elementGroups.add(renderElements.length - 1);
                    this._elementGroups.add(false);
                    groupStart = renderElements.length;
                }
                else {
                    renderElements.add(element);
                }
            };
            stencilBuilder.beginBuild();
            this._structs.indice.forEach(index => {
                let list = this._structs.lists.get(index);
                for (let i = 0, cnt = list.length; i < cnt; i++) {
                    let struct = list.elements[i];
                    let structElements = struct.renderElements;
                    let n = structElements ? structElements.length : 0;
                    if (struct.owner._getBit(Laya.NodeFlags.HIDE_BY_EDITOR))
                        n = 0;
                    if (struct.dcOptimize && !reorderRoot && struct.dcOptimizeEnd !== struct) {
                        reorderRoot = struct;
                        if (groupStart !== renderElements.length) {
                            this._elementGroups.add(groupStart);
                            this._elementGroups.add(renderElements.length - 1);
                            this._elementGroups.add(false);
                            groupStart = renderElements.length;
                        }
                    }
                    if (n > 0) {
                        for (let i = 0; i < n; i++) {
                            let element = structElements[i];
                            element._index = i;
                            if (!element.geometry)
                                continue;
                            stencilBuilder.appendElement(element, addRenderElement);
                        }
                    }
                    if ((reorderRoot === null || reorderRoot === void 0 ? void 0 : reorderRoot.dcOptimizeEnd) === struct) {
                        reorderRoot = null;
                        if (groupStart !== renderElements.length) {
                            this._elementGroups.add(groupStart);
                            this._elementGroups.add(renderElements.length - 1);
                            this._elementGroups.add(true);
                            groupStart = renderElements.length;
                        }
                    }
                }
            });
            stencilBuilder.finishBuild(addRenderElement);
            if (groupStart !== renderElements.length) {
                this._elementGroups.add(groupStart);
                this._elementGroups.add(renderElements.length - 1);
                this._elementGroups.add(false);
            }
        }
        batch() {
            let list = this._renderElements;
            let elementArray = list.elements;
            let groups = this._elementGroups;
            let groupsArray = groups.elements;
            list.length = 0;
            for (let gi = 0, gl = groups.length; gi < gl; gi += 3) {
                let groupStart = groupsArray[gi];
                let groupEnd = groupsArray[gi + 1];
                let allowReorder = groupsArray[gi + 2];
                let lastRenderType = elementArray[groupStart].owner.renderType;
                let batchStart = groupStart;
                for (let i = groupStart + 1; i <= groupEnd; i++) {
                    let element = elementArray[i];
                    let struct = element.owner;
                    if (lastRenderType === struct.renderType)
                        continue;
                    if (i - batchStart > 1)
                        this.getBatchProvider(lastRenderType).batch(list, batchStart, i - 1, allowReorder);
                    else
                        list.add(elementArray[batchStart]);
                    batchStart = i;
                    lastRenderType = struct.renderType;
                }
                if (groupEnd - batchStart > 0)
                    this.getBatchProvider(lastRenderType).batch(list, batchStart, groupEnd, allowReorder);
                else
                    list.add(elementArray[batchStart]);
            }
        }
        getBatchProvider(renderType) {
            return this._batchProviders[renderType] || (this._batchProviders[renderType] = BatchManager.createProvider(renderType));
        }
        _initRenderProcess(context, renderTime) {
            if (!this.root || this.root.globalAlpha < 0.01) {
                return false;
            }
            let sizeX, sizeY;
            let rt = this.renderTexture;
            if (rt) {
                if (rt.width == 0 || rt.height == 0)
                    return false;
                context.invertY = rt._invertY;
                context.setOffscreenView(rt.width, rt.height, 0, 0);
                context.setRenderTarget(rt._renderTarget, this.doClearColor, this._clearColor);
                sizeX = rt.width;
                sizeY = rt.height;
                let result = this._updateInvertMatrix();
                if (!result) {
                    return false;
                }
                this.shaderData.addDefine(Laya.ShaderDefines2D.RENDERTEXTURE);
            }
            else {
                sizeX = Laya.RenderState2D.width;
                sizeY = Laya.RenderState2D.height;
                if (sizeX === 0 || sizeY === 0)
                    return false;
                context.invertY = false;
                context.setOffscreenView(sizeX, sizeY, 0, 0);
                context.setRenderTarget(null, this.doClearColor, this._clearColor);
                this._setInvertMatrix(1, 0, 0, 1, 0, 0);
                this.shaderData.removeDefine(Laya.ShaderDefines2D.RENDERTEXTURE);
            }
            context.passData = this.shaderData;
            this.shaderData.setNumber(Laya.ShaderDefines2D.UNIFORM_TIME, renderTime);
            if (sizeX !== this._rtsize.x || sizeY !== this._rtsize.y) {
                this._rtsize.setValue(sizeX, sizeY);
                this.shaderData.setVector2(Laya.ShaderDefines2D.UNIFORM_SIZE, this._rtsize);
            }
            this.shaderData.setNumber(Laya.ShaderDefines2D.UNIFORM_TIME, renderTime);
            return true;
        }
        static setBuffer(buffer) {
            if (buffer._inPass)
                return;
            buffer._inPass = true;
            WebRender2DPass.buffers.add(buffer);
        }
        static uploadBuffer() {
            if (WebRender2DPass.buffers.length > 0) {
                let elements = WebRender2DPass.buffers.elements;
                for (let i = 0, n = WebRender2DPass.buffers.length; i < n; i++) {
                    let buffer = elements[i];
                    buffer._upload();
                    buffer._inPass = false;
                }
                WebRender2DPass.buffers.length = 0;
            }
        }
        _updateInvertMatrix() {
            if (!this.root || this.root.transSlot < 0) {
                this._setInvertMatrix(1, 0, 0, 1, 0, 0);
                return true;
            }
            let rootMatrix = this.root.renderMatrix;
            if (rootMatrix.a == 0
                && rootMatrix.b == 0
                && rootMatrix.c == 0
                && rootMatrix.d == 0) {
                return false;
            }
            let temp = _TEMP_InvertMatrix;
            let mask = this.mask;
            let offset = this.offsetMatrix;
            if (mask) {
                let maskMatrix = mask.renderMatrix;
                maskMatrix.copyTo(temp);
            }
            else {
                rootMatrix.copyTo(temp);
            }
            Laya.Matrix.mul(offset, temp, temp);
            temp.invert();
            this._setInvertMatrix(temp.a, temp.b, temp.c, temp.d, temp.tx, temp.ty);
            return true;
        }
        _setInvertMatrix(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
            if (a === this._invertMat_0.x
                && b === this._invertMat_1.x
                && c === this._invertMat_0.y
                && d === this._invertMat_1.y
                && tx === this._invertMat_0.z
                && ty === this._invertMat_1.z)
                return;
            this._invertMat_0.setValue(a, c, tx);
            this._invertMat_1.setValue(b, d, ty);
            this.shaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_INVERTMAT_0, this._invertMat_0);
            this.shaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_INVERTMAT_1, this._invertMat_1);
        }
        updatePostProcess() { }
        destroy() {
            if (this.destroyed) {
                return;
            }
            this.destroyed = true;
            this._renderElements.length = 0;
            for (let i = 0, n = this._batchProviders.length; i < n; i++) {
                this._batchProviders[i] && this._batchProviders[i].destroy();
            }
            this._batchProviders.length = 0;
            this.root = null;
            this.renderTexture = null;
            this.postProcess = null;
            this.shaderData.destroy();
            this.shaderData = null;
        }
    }
    WebRender2DPass.buffers = new Laya.FastSinglelist();
    class WebRender2DPassManager {
        constructor() {
            this._modify = false;
            this._passes = [];
        }
        removePass(pass) {
            let index = this._passes.indexOf(pass);
            if (index === -1) {
                return;
            }
            this._passes.splice(index, 1);
            this._modify = true;
        }
        apply(context, renderTime) {
            if (this._modify) {
                this._modify = false;
                this._passes.sort((a, b) => b._priority - a._priority);
            }
            for (const pass of this._passes) {
                if (pass.needRender()) {
                    pass.fowardRender(context, renderTime);
                }
            }
        }
        clear() {
            this._passes.length = 0;
        }
        addPass(pass) {
            if (this._passes.indexOf(pass) !== -1) {
                return;
            }
            this._passes.push(pass);
            this._modify = true;
        }
    }
    const _TEMP_InvertMatrix = new Laya.Matrix();

    class Web2DGraphicsBufferDataView {
    }
    class Web2DGraphic2DVertexDataView extends Web2DGraphicsBufferDataView {
        _getData() {
            return this._view;
        }
        _modify() {
            this.owner._modifyOneView(this);
            WebRender2DPass.setBuffer(this.owner);
        }
        _updateView(wholeData) {
            if (!this._view || this._view.buffer !== wholeData.buffer) {
                this._view = new Float32Array(wholeData.buffer, this.start * 4, this.length);
            }
        }
        constructor(owner, start, length, stride = 1) {
            super();
            this.stride = 1;
            this.owner = owner;
            this.start = start;
            this.length = length;
            this.stride = stride;
            this._updateView(owner._dataView);
            owner.addDataView(this);
        }
    }
    class Web2DGraphic2DIndexDataView extends Web2DGraphicsBufferDataView {
        setGeometry(value) {
            this._geometry = value;
        }
        _getData() {
            return this._view;
        }
        constructor(owner, length, create = true) {
            super();
            this.owner = owner;
            this.length = length;
            if (create) {
                this._view = new (Laya.GraphicsDefines.GRAPHICS_INDEX_ARRAY_TYPE)(length);
            }
        }
        _updateView(wholeData) {
            wholeData.set(this._view, this.start);
        }
        _modify() {
            this.owner._modifyOneView(this);
            WebRender2DPass.setBuffer(this.owner);
        }
        destroy() {
            this._view = null;
            this._geometry = null;
            this.owner = null;
            this._next = null;
            this._prev = null;
        }
    }

    const GraphicsQuadPayloadWordCount = 32;
    const GraphicsMeshPayloadWordCount = 26;
    function writeQuadPayloadValues(float32, int32, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip) {
        float32[wordOffset + 0] = x;
        float32[wordOffset + 1] = y;
        float32[wordOffset + 2] = width;
        float32[wordOffset + 3] = height;
        float32[wordOffset + 4] = u0;
        float32[wordOffset + 5] = v0;
        float32[wordOffset + 6] = u1;
        float32[wordOffset + 7] = v1;
        int32[wordOffset + 8] = packedColor;
        float32[wordOffset + 9] = alpha;
        int32[wordOffset + 10] = blendMode;
        int32[wordOffset + 11] = textureLayer || 0;
        if (matrix) {
            float32[wordOffset + 12] = matrix.a;
            float32[wordOffset + 13] = matrix.b;
            float32[wordOffset + 14] = matrix.c;
            float32[wordOffset + 15] = matrix.d;
            float32[wordOffset + 16] = matrix.tx;
            float32[wordOffset + 17] = matrix.ty;
            int32[wordOffset + 18] = 1;
        }
        else {
            float32[wordOffset + 12] = 1;
            float32[wordOffset + 13] = 0;
            float32[wordOffset + 14] = 0;
            float32[wordOffset + 15] = 1;
            float32[wordOffset + 16] = 0;
            float32[wordOffset + 17] = 0;
            int32[wordOffset + 18] = 0;
        }
        writeUVClipPayloadValues(float32, int32, wordOffset, 27, 28, 29, 30, 31, uvClip);
    }
    function writeUVClipPayloadValues(float32, int32, wordOffset, enabledOffset, xOffset, yOffset, widthOffset, heightOffset, uvClip) {
        if (uvClip) {
            int32[wordOffset + enabledOffset] = 1;
            float32[wordOffset + xOffset] = uvClip[0];
            float32[wordOffset + yOffset] = uvClip[1];
            float32[wordOffset + widthOffset] = uvClip[2];
            float32[wordOffset + heightOffset] = uvClip[3];
        }
        else {
            int32[wordOffset + enabledOffset] = 0;
            float32[wordOffset + xOffset] = 0;
            float32[wordOffset + yOffset] = 0;
            float32[wordOffset + widthOffset] = 1;
            float32[wordOffset + heightOffset] = 1;
        }
    }
    function writeFillTexturePayloadValues(float32, int32, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, repeatX, repeatY, offsetX, offsetY, texRangeX, texRangeY, texRangeWidth, texRangeHeight, uvClip) {
        writeQuadPayloadValues(float32, int32, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip);
        float32[wordOffset + 19] = repeatX;
        float32[wordOffset + 20] = repeatY;
        float32[wordOffset + 21] = offsetX;
        float32[wordOffset + 22] = offsetY;
        float32[wordOffset + 23] = texRangeX;
        float32[wordOffset + 24] = texRangeY;
        float32[wordOffset + 25] = texRangeWidth;
        float32[wordOffset + 26] = texRangeHeight;
    }
    function writeOpInfoBuffer(owner, profile, changeMask, version, vertexCount, indexCount, stateKey, typeKey, textureKey, packedColor, localAlpha, bodyWordCount, recordCount) {
        let int32 = owner.int32;
        let float32 = owner.float32;
        int32[0] = profile;
        int32[1] = changeMask;
        int32[2] = version;
        int32[3] = vertexCount;
        int32[4] = indexCount;
        int32[5] = stateKey;
        int32[6] = typeKey;
        int32[7] = textureKey;
        int32[8] = packedColor;
        float32[9] = localAlpha;
        int32[10] = 16;
        int32[11] = bodyWordCount;
        int32[12] = recordCount;
    }
    function writeMeshPayloadValues(float32, int32, wordOffset, x, y, packedColor, alpha, blendMode, textureLayer, matrix, vertexCount, indexCount, hasUV, hasColors, vertexDataOffset, uvDataOffset, indexDataOffset, colorDataOffset, uvClip) {
        float32[wordOffset + 0] = x;
        float32[wordOffset + 1] = y;
        int32[wordOffset + 2] = packedColor;
        float32[wordOffset + 3] = alpha;
        int32[wordOffset + 4] = blendMode;
        int32[wordOffset + 5] = textureLayer || 0;
        if (matrix) {
            float32[wordOffset + 6] = matrix.a;
            float32[wordOffset + 7] = matrix.b;
            float32[wordOffset + 8] = matrix.c;
            float32[wordOffset + 9] = matrix.d;
            float32[wordOffset + 10] = matrix.tx;
            float32[wordOffset + 11] = matrix.ty;
            int32[wordOffset + 12] = 1;
        }
        else {
            float32[wordOffset + 6] = 1;
            float32[wordOffset + 7] = 0;
            float32[wordOffset + 8] = 0;
            float32[wordOffset + 9] = 1;
            float32[wordOffset + 10] = 0;
            float32[wordOffset + 11] = 0;
            int32[wordOffset + 12] = 0;
        }
        int32[wordOffset + 13] = vertexCount;
        int32[wordOffset + 14] = indexCount;
        int32[wordOffset + 15] = hasUV ? 1 : 0;
        int32[wordOffset + 16] = hasColors ? 1 : 0;
        int32[wordOffset + 17] = vertexDataOffset;
        int32[wordOffset + 18] = uvDataOffset;
        int32[wordOffset + 19] = indexDataOffset;
        int32[wordOffset + 20] = colorDataOffset;
        writeUVClipPayloadValues(float32, int32, wordOffset, 21, 22, 23, 24, 25, uvClip);
    }

    class WebGraphicsOp2D {
        constructor(kind, opType, opProfile, commandIndex, commandId, initialBodyWordCount) {
            this.kind = kind;
            this.opType = opType;
            this.opProfile = opProfile;
            this.commandIndex = commandIndex;
            this.commandId = commandId;
            this.dirtyFlags = 23;
            this._version = 0;
            this._retainedRecordCount = 0;
            this._texture = null;
            this._textureInternal = null;
            this._renderStateScratch = { stateKey: 0, typeKey: 0, textureKey: 0, texture: null };
            this._buffer = new ArrayBuffer((16 + initialBodyWordCount) * 4);
            this._float32 = new Float32Array(this._buffer);
            this._int32 = new Int32Array(this._buffer);
        }
        get buffer() {
            return this._buffer;
        }
        get float32() {
            return this._float32;
        }
        get int32() {
            return this._int32;
        }
        get recordCount() {
            return this._int32[12] || 0;
        }
        setCommandIndex(value) {
            this.commandIndex = value;
        }
        set recordCount(value) {
            this._int32[12] = value | 0;
        }
        get texture() {
            return this._texture;
        }
        set texture(value) {
            value = value || null;
            let internalTexture = value ? value._texture : null;
            if (this._texture === value && this._textureInternal === internalTexture)
                return;
            this._texture = value;
            this._textureInternal = internalTexture;
            this.markDirty(4);
        }
        canUpdate(commandId) {
            return this.commandId === commandId;
        }
        resetRecords() {
            this._retainedRecordCount = this.recordCount;
            this.recordCount = 0;
        }
        writeStructureSignature(out, offset) {
            out[offset] = this._int32[3];
            out[offset + 1] = this._int32[4];
            out[offset + 2] = this._int32[11];
            out[offset + 3] = 0;
        }
        matchesStructureSignature(source, offset) {
            return this._int32[3] === source[offset]
                && this._int32[4] === source[offset + 1]
                && this._int32[11] === source[offset + 2]
                && source[offset + 3] === 0;
        }
        clearStructureDirty() {
            this.dirtyFlags &= ~1;
            this._int32[1] &= ~1;
        }
        markDirty(flags) {
            this.dirtyFlags |= flags;
            if (this._int32)
                this._int32[1] |= flags;
        }
        clearDirty() {
            this.dirtyFlags = 0;
            if (this._int32)
                this._int32[1] = 0;
        }
        destroy() {
            this._texture = null;
            this._textureInternal = null;
        }
        _reserveBufferWords(bodyWordCount) {
            let requiredWordCount = 16 + bodyWordCount;
            if (this._int32.length >= requiredWordCount)
                return;
            let nextWordCount = Math.max(requiredWordCount, this._int32.length * 2, 16 + 1);
            let nextBuffer = new ArrayBuffer(nextWordCount * 4);
            new Uint8Array(nextBuffer).set(new Uint8Array(this._buffer));
            this._buffer = nextBuffer;
            this._float32 = new Float32Array(nextBuffer);
            this._int32 = new Int32Array(nextBuffer);
        }
        _writeOpInfoBuffer(changeMask, version, vertexCount, indexCount, stateKey, typeKey, textureKey, packedColor, localAlpha, bodyWordCount) {
            this._reserveBufferWords(bodyWordCount);
            writeOpInfoBuffer(this, this.opProfile, changeMask, version, vertexCount, indexCount, stateKey, typeKey, textureKey, packedColor, localAlpha, bodyWordCount, this.recordCount);
        }
        _writeOpRenderStateBuffer(changeMask, version, vertexCount, indexCount, blendMode, texture, fillTexture, packedColor, localAlpha, bodyWordCount) {
            changeMask |= this.dirtyFlags | this._int32[1];
            if (this._int32[11] > 0 && (changeMask & 4) === 0) {
                let defineBits = this._int32[6] & ~((1 << Laya.ShaderDefines2D.TYPE_KEY_DEFINE_SHIFT) - 1);
                this._writeOpInfoBuffer(changeMask, version, vertexCount, indexCount, blendMode, defineBits | blendMode, this._int32[7], packedColor, localAlpha, bodyWordCount);
                return;
            }
            let renderState = Laya.GraphicsOpRenderStateHelper.getRenderState(texture, blendMode, fillTexture, false, false, this._renderStateScratch);
            this._writeOpInfoBuffer(changeMask, version, vertexCount, indexCount, renderState.stateKey, renderState.typeKey, renderState.textureKey, packedColor, localAlpha, bodyWordCount);
        }
        _refreshOpRenderStateBuffer(fillTexture = this.kind === 3) {
            if (!this._int32 || this._int32[11] <= 0)
                return;
            let renderState = Laya.GraphicsOpRenderStateHelper.getRenderState(this._texture, this._int32[5], fillTexture, false, false, this._renderStateScratch);
            this._int32[5] = renderState.stateKey;
            this._int32[6] = renderState.typeKey;
            this._int32[7] = renderState.textureKey;
        }
        get _bodyWordOffset() {
            return 16;
        }
        _getQuadPayloadChangeMask(recordIndex, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip, repeatX, repeatY, offsetX, offsetY, texRangeX, texRangeY, texRangeWidth, texRangeHeight) {
            let hadRecord = recordIndex < this._retainedRecordCount || recordIndex < this.recordCount;
            if (!hadRecord)
                return 23;
            let f32 = this._float32;
            let i32 = this._int32;
            let fround = Math.fround;
            let changeMask = this.dirtyFlags & 4;
            let nextHasMatrix = matrix ? 1 : 0;
            let nextUVClipEnabled = uvClip ? 1 : 0;
            if (f32[wordOffset + 0] !== fround(x)
                || f32[wordOffset + 1] !== fround(y)
                || f32[wordOffset + 2] !== fround(width)
                || f32[wordOffset + 3] !== fround(height)
                || f32[wordOffset + 4] !== fround(u0)
                || f32[wordOffset + 5] !== fround(v0)
                || f32[wordOffset + 6] !== fround(u1)
                || f32[wordOffset + 7] !== fround(v1)
                || i32[wordOffset + 11] !== (textureLayer || 0)
                || i32[wordOffset + 18] !== nextHasMatrix
                || f32[wordOffset + 12] !== fround(matrix ? matrix.a : 1)
                || f32[wordOffset + 13] !== fround(matrix ? matrix.b : 0)
                || f32[wordOffset + 14] !== fround(matrix ? matrix.c : 0)
                || f32[wordOffset + 15] !== fround(matrix ? matrix.d : 1)
                || f32[wordOffset + 16] !== fround(matrix ? matrix.tx : 0)
                || f32[wordOffset + 17] !== fround(matrix ? matrix.ty : 0)
                || i32[wordOffset + 27] !== nextUVClipEnabled
                || f32[wordOffset + 28] !== fround(uvClip ? uvClip[0] : 0)
                || f32[wordOffset + 29] !== fround(uvClip ? uvClip[1] : 0)
                || f32[wordOffset + 30] !== fround(uvClip ? uvClip[2] : 1)
                || f32[wordOffset + 31] !== fround(uvClip ? uvClip[3] : 1))
                changeMask |= 2;
            if (repeatX != null && (f32[wordOffset + 19] !== fround(repeatX)
                || f32[wordOffset + 20] !== fround(repeatY)
                || f32[wordOffset + 21] !== fround(offsetX)
                || f32[wordOffset + 22] !== fround(offsetY)
                || f32[wordOffset + 23] !== fround(texRangeX)
                || f32[wordOffset + 24] !== fround(texRangeY)
                || f32[wordOffset + 25] !== fround(texRangeWidth)
                || f32[wordOffset + 26] !== fround(texRangeHeight)))
                changeMask |= 2;
            if (i32[wordOffset + 10] !== blendMode)
                changeMask |= 16;
            if (i32[wordOffset + 8] !== packedColor
                || f32[wordOffset + 9] !== fround(alpha))
                changeMask |= 16 | 2;
            return changeMask;
        }
    }
    class WebGraphicsTextureQuadOp2D extends WebGraphicsOp2D {
        constructor(kind, commandIndex, commandId) {
            super(kind, "textureQuad", 1, commandIndex, commandId, GraphicsQuadPayloadWordCount);
        }
        writeRecord(x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip) {
            let wordOffset = this._bodyWordOffset;
            this._reserveBufferWords(GraphicsQuadPayloadWordCount);
            let changeMask = this._getQuadPayloadChangeMask(0, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip);
            this.recordCount = 1;
            if (changeMask === 0)
                return;
            writeQuadPayloadValues(this.float32, this.int32, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip);
            this.markDirty(changeMask);
            this._writeOpRenderStateBuffer(changeMask, ++this._version, 4, 6, blendMode, this.texture, false, packedColor, alpha, GraphicsQuadPayloadWordCount);
        }
    }
    class WebGraphicsSolidQuadOp2D extends WebGraphicsOp2D {
        constructor(kind, commandIndex, commandId) {
            super(kind, "solidQuad", 3, commandIndex, commandId, GraphicsQuadPayloadWordCount);
        }
        writeRecord(x, y, width, height, packedColor, alpha, blendMode, matrix) {
            let changeMask = this._getQuadPayloadChangeMask(0, this._bodyWordOffset, x, y, width, height, 0, 0, 0, 0, packedColor, alpha, blendMode, 0, matrix, null);
            this.recordCount = 1;
            if (changeMask === 0)
                return;
            writeQuadPayloadValues(this.float32, this.int32, this._bodyWordOffset, x, y, width, height, 0, 0, 0, 0, packedColor, alpha, blendMode, 0, matrix, null);
            this.markDirty(changeMask);
            this._writeOpRenderStateBuffer(changeMask, ++this._version, 4, 6, blendMode, null, false, packedColor, alpha, GraphicsQuadPayloadWordCount);
        }
    }
    class WebGraphicsFillTextureOp2D extends WebGraphicsOp2D {
        constructor(kind, commandIndex, commandId) {
            super(kind, "fillTexture", 5, commandIndex, commandId, GraphicsQuadPayloadWordCount);
        }
        writeRecord(x, y, width, height, u0, v0, u1, v1, repeatX, repeatY, offsetX, offsetY, texRangeX, texRangeY, texRangeWidth, texRangeHeight, packedColor, alpha, blendMode, textureLayer, matrix, uvClip) {
            let changeMask = this._getQuadPayloadChangeMask(0, this._bodyWordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip, repeatX, repeatY, offsetX, offsetY, texRangeX, texRangeY, texRangeWidth, texRangeHeight);
            this.recordCount = 1;
            if (changeMask === 0)
                return;
            writeFillTexturePayloadValues(this.float32, this.int32, this._bodyWordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, repeatX, repeatY, offsetX, offsetY, texRangeX, texRangeY, texRangeWidth, texRangeHeight, uvClip);
            this.markDirty(changeMask);
            this._writeOpRenderStateBuffer(changeMask, ++this._version, 4, 6, blendMode, this.texture, true, packedColor, alpha, GraphicsQuadPayloadWordCount);
        }
    }
    class WebGraphicsMeshOp2D extends WebGraphicsOp2D {
        constructor(kind, commandIndex, commandId) {
            super(kind, "mesh", 8, commandIndex, commandId, GraphicsMeshPayloadWordCount);
        }
        writeMesh(x, y, vertices, vertexOffset, vertexCount, uvs, uvOffset, indices, indexOffset, indexCount, colors, colorOffset, packedColor, alpha, blendMode, textureLayer, matrix, uvClip) {
            let vertexWordCount = vertexCount * 2;
            let uvWordCount = uvs ? vertexCount * 2 : 0;
            let indexWordCount = indexCount;
            let colorWordCount = colors ? vertexCount * 4 : 0;
            let vertexDataOffset = GraphicsMeshPayloadWordCount;
            let uvDataOffset = vertexDataOffset + vertexWordCount;
            let indexDataOffset = uvDataOffset + uvWordCount;
            let colorDataOffset = indexDataOffset + indexWordCount;
            let bodyWordCount = colorDataOffset + colorWordCount;
            let bodyOffset = this._bodyWordOffset;
            this._reserveBufferWords(bodyWordCount);
            if (this._meshPayloadMatches(bodyOffset, bodyWordCount, x, y, vertices, vertexOffset, vertexCount, uvs, uvOffset, indices, indexOffset, indexCount, colors, colorOffset, packedColor, alpha, blendMode, textureLayer, matrix, uvClip)) {
                this.recordCount = 1;
                return;
            }
            writeMeshPayloadValues(this.float32, this.int32, bodyOffset, x, y, packedColor, alpha, blendMode, textureLayer, matrix, vertexCount, indexCount, !!uvs, !!colors, vertexDataOffset, uvs ? uvDataOffset : 0, indexDataOffset, colors ? colorDataOffset : 0, uvClip);
            this._copyNumberValues(vertices, vertexOffset, this.float32, bodyOffset + vertexDataOffset, vertexWordCount);
            if (uvs)
                this._copyNumberValues(uvs, uvOffset, this.float32, bodyOffset + uvDataOffset, uvWordCount);
            this._copyNumberValues(indices, indexOffset, this.int32, bodyOffset + indexDataOffset, indexWordCount);
            if (colors)
                this._copyNumberValues(colors, colorOffset, this.float32, bodyOffset + colorDataOffset, colorWordCount);
            this.recordCount = 1;
            let changeMask = 2 | 4 | 16;
            this.markDirty(changeMask);
            this._writeOpRenderStateBuffer(changeMask, ++this._version, vertexCount, indexCount, blendMode, this.texture, false, packedColor, alpha, bodyWordCount);
        }
        _meshPayloadMatches(bodyOffset, bodyWordCount, x, y, vertices, vertexOffset, vertexCount, uvs, uvOffset, indices, indexOffset, indexCount, colors, colorOffset, packedColor, alpha, blendMode, textureLayer, matrix, uvClip) {
            if (this._retainedRecordCount <= 0 && this.recordCount <= 0
                || this.dirtyFlags !== 0
                || this.int32[11] !== bodyWordCount)
                return false;
            let f32 = this.float32;
            let i32 = this.int32;
            let fround = Math.fround;
            let vertexDataOffset = GraphicsMeshPayloadWordCount;
            let uvDataOffset = vertexDataOffset + vertexCount * 2;
            let indexDataOffset = uvDataOffset + (uvs ? vertexCount * 2 : 0);
            let colorDataOffset = indexDataOffset + indexCount;
            if (f32[bodyOffset + 0] !== fround(x)
                || f32[bodyOffset + 1] !== fround(y)
                || i32[bodyOffset + 2] !== packedColor
                || f32[bodyOffset + 3] !== fround(alpha)
                || i32[bodyOffset + 4] !== blendMode
                || i32[bodyOffset + 5] !== (textureLayer || 0)
                || i32[bodyOffset + 12] !== (matrix ? 1 : 0)
                || f32[bodyOffset + 6] !== fround(matrix ? matrix.a : 1)
                || f32[bodyOffset + 7] !== fround(matrix ? matrix.b : 0)
                || f32[bodyOffset + 8] !== fround(matrix ? matrix.c : 0)
                || f32[bodyOffset + 9] !== fround(matrix ? matrix.d : 1)
                || f32[bodyOffset + 10] !== fround(matrix ? matrix.tx : 0)
                || f32[bodyOffset + 11] !== fround(matrix ? matrix.ty : 0)
                || i32[bodyOffset + 13] !== vertexCount
                || i32[bodyOffset + 14] !== indexCount
                || i32[bodyOffset + 15] !== (uvs ? 1 : 0)
                || i32[bodyOffset + 16] !== (colors ? 1 : 0)
                || i32[bodyOffset + 17] !== vertexDataOffset
                || i32[bodyOffset + 18] !== (uvs ? uvDataOffset : 0)
                || i32[bodyOffset + 19] !== indexDataOffset
                || i32[bodyOffset + 20] !== (colors ? colorDataOffset : 0)
                || i32[bodyOffset + 21] !== (uvClip ? 1 : 0)
                || f32[bodyOffset + 22] !== fround(uvClip ? uvClip[0] : 0)
                || f32[bodyOffset + 23] !== fround(uvClip ? uvClip[1] : 0)
                || f32[bodyOffset + 24] !== fround(uvClip ? uvClip[2] : 1)
                || f32[bodyOffset + 25] !== fround(uvClip ? uvClip[3] : 1))
                return false;
            for (let i = 0, count = vertexCount * 2; i < count; i++) {
                if (f32[bodyOffset + vertexDataOffset + i] !== fround(vertices[vertexOffset + i]))
                    return false;
                if (uvs && f32[bodyOffset + uvDataOffset + i] !== fround(uvs[uvOffset + i]))
                    return false;
            }
            for (let i = 0; i < indexCount; i++) {
                if (i32[bodyOffset + indexDataOffset + i] !== (indices[indexOffset + i] | 0))
                    return false;
            }
            if (colors) {
                for (let i = 0, count = vertexCount * 4; i < count; i++) {
                    if (f32[bodyOffset + colorDataOffset + i] !== fround(colors[colorOffset + i]))
                        return false;
                }
            }
            return true;
        }
        _copyNumberValues(source, sourceOffset, target, targetOffset, count) {
            for (let i = 0; i < count; i++)
                target[targetOffset + i] = source[sourceOffset + i];
        }
    }
    class WebGraphicsMultiQuadOp2D extends WebGraphicsOp2D {
        constructor(kind, commandIndex, commandId, opType = "multiQuad", opProfile = 6) {
            super(kind, opType, opProfile, commandIndex, commandId, GraphicsQuadPayloadWordCount);
            this.textures = [];
            this._textureGroupLayoutVersion = 0;
        }
        writeStructureSignature(out, offset) {
            super.writeStructureSignature(out, offset);
            out[offset + 3] = this._textureGroupLayoutVersion;
        }
        matchesStructureSignature(source, offset) {
            return this._int32[3] === source[offset]
                && this._int32[4] === source[offset + 1]
                && this._int32[11] === source[offset + 2]
                && this._textureGroupLayoutVersion === source[offset + 3];
        }
        setTextures(textures, count = textures ? textures.length : 0) {
            let previousCount = this.textures.length;
            let changed = previousCount !== count;
            let groupChanged = previousCount !== count;
            let previousOldTexture = null;
            let previousNewTexture = null;
            for (let i = 0; i < count; i++) {
                let oldTexture = this.textures[i] || null;
                let texture = textures[i] || null;
                if (oldTexture !== texture)
                    changed = true;
                if (i > 0 && (oldTexture !== previousOldTexture) !== (texture !== previousNewTexture))
                    groupChanged = true;
                this.textures[i] = texture;
                previousOldTexture = oldTexture;
                previousNewTexture = texture;
            }
            this.textures.length = count;
            let firstTexture = count > 0 ? this.textures[0] : null;
            let firstTextureChanged = this.texture !== firstTexture || this._textureInternal !== (firstTexture ? firstTexture._texture : null);
            if (firstTextureChanged)
                changed = true;
            this.texture = firstTexture;
            if (firstTextureChanged)
                this._refreshOpRenderStateBuffer(false);
            if (changed)
                this.markDirty(4);
            if (groupChanged) {
                this._textureGroupLayoutVersion++;
                this.markDirty(1);
            }
        }
        addRecord(x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip) {
            let recordIndex = this.recordCount;
            let bodyWordCount = (this.recordCount + 1) * GraphicsQuadPayloadWordCount;
            this._reserveBufferWords(bodyWordCount);
            let wordOffset = this._bodyWordOffset + recordIndex * GraphicsQuadPayloadWordCount;
            let changeMask = this._getQuadPayloadChangeMask(recordIndex, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip);
            if (changeMask !== 0)
                writeQuadPayloadValues(this.float32, this.int32, wordOffset, x, y, width, height, u0, v0, u1, v1, packedColor, alpha, blendMode, textureLayer, matrix, uvClip);
            this.recordCount++;
            if (changeMask !== 0) {
                this.markDirty(changeMask);
                this._version++;
            }
            this._writeOpRenderStateBuffer(this.dirtyFlags, this._version, this.recordCount * 4, this.recordCount * 6, blendMode, this.texture, false, packedColor, alpha, bodyWordCount);
        }
    }
    class WebGraphicsTextOp2D extends WebGraphicsMultiQuadOp2D {
        constructor(kind, commandIndex, commandId) {
            super(kind, commandIndex, commandId, "text", 7);
        }
    }

    class WebGraphicsOp2DFactory {
        createTextureQuadOp(commandIndex, commandId) {
            return new WebGraphicsTextureQuadOp2D(1, commandIndex, commandId);
        }
        createFillTextureOp(commandIndex, commandId) {
            return new WebGraphicsFillTextureOp2D(3, commandIndex, commandId);
        }
        createSolidQuadOp(commandIndex, commandId) {
            return new WebGraphicsSolidQuadOp2D(2, commandIndex, commandId);
        }
        createMeshOp(commandIndex, commandId) {
            return new WebGraphicsMeshOp2D(4, commandIndex, commandId);
        }
        createMultiQuadOp(commandIndex, commandId) {
            return new WebGraphicsMultiQuadOp2D(5, commandIndex, commandId);
        }
        createTextOp(commandIndex, commandId) {
            return new WebGraphicsTextOp2D(6, commandIndex, commandId);
        }
    }

    class WebGraphicsRenderUnit {
        constructor() {
            this.op = null;
            this.opIndex = -1;
            this.recordStart = 0;
            this.recordCount = 0;
            this.element = null;
            this.viStore = null;
            this.vertexViews = [];
            this.vertexBlocks = [];
            this.vertexBuffer = null;
            this.sourceIndexView = null;
            this.sourceGeometry = null;
            this.batchGeometry = null;
            this.primitiveShaderData = null;
            this.fillTextureRange = null;
        }
        get vertexBlockCapacity() {
            return this.vertexBlocks ? this.vertexBlocks.length : 0;
        }
        get indexCapacity() {
            return this.sourceIndexView ? this.sourceIndexView.length : 0;
        }
        canReuse(vertexCount, indexCount) {
            return this.indexCapacity === indexCount
                && this.vertexBlockCapacity >= Math.ceil(vertexCount / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
        }
        reactivate(owner, subShader, materialShaderData) {
            let element = this.element;
            if (!element)
                return;
            if (element.owner !== owner)
                element.owner = owner;
            if (element.value2DShaderData !== owner.spriteShaderData)
                element.value2DShaderData = owner.spriteShaderData;
            let globalShaderData = owner.globalRenderData ? owner.globalRenderData.globalShaderData : null;
            if (element.globalShaderData !== globalShaderData)
                element.globalShaderData = globalShaderData;
            if (element.subShader !== subShader)
                element.subShader = subShader;
            if (element.materialShaderData !== materialShaderData)
                element.materialShaderData = materialShaderData;
        }
        static create(vertexCount, indexCount, owner, subShader, materialShaderData) {
            let unit = new WebGraphicsRenderUnit();
            if (!WebGraphicsOpVIStorePool.allocateInto(unit, vertexCount, indexCount))
                return null;
            let primitiveShaderData = Laya.LayaGL.renderDeviceFactory.createShaderData();
            Laya.BlendModeHandler.initBlendMode(primitiveShaderData);
            let element = Laya.LayaGL.render2DRenderPassFactory.createPrimitiveRenderElement2D();
            element.nodeCommonMap = ["Sprite2D"];
            element.owner = owner;
            element.value2DShaderData = owner.spriteShaderData;
            element.globalShaderData = owner.globalRenderData ? owner.globalRenderData.globalShaderData : null;
            element.primitiveShaderData = primitiveShaderData;
            element.subShader = subShader;
            element.materialShaderData = materialShaderData;
            element.renderStateIsBySprite = false;
            element.typeKey = 0;
            element.textureKey = 0;
            let sourceGeometry = Laya.LayaGL.renderDeviceFactory.createRenderGeometryElement(Laya.MeshTopology.Triangles, Laya.DrawType.DrawElement);
            sourceGeometry.indexFormat = Laya.GraphicsDefines.GRAPHICS_INDEX_FORMAT;
            sourceGeometry.bufferState = unit.viStore.bufferState;
            element.geometry = sourceGeometry;
            unit.sourceIndexView.setGeometry(sourceGeometry);
            let batchGeometry = Laya.LayaGL.renderDeviceFactory.createRenderGeometryElement(Laya.MeshTopology.Triangles, Laya.DrawType.DrawElement);
            batchGeometry.indexFormat = Laya.GraphicsDefines.GRAPHICS_INDEX_FORMAT;
            unit.element = element;
            unit.vertexBuffer = unit.viStore.vertexBuffer;
            unit.sourceGeometry = sourceGeometry;
            unit.batchGeometry = batchGeometry;
            unit.primitiveShaderData = primitiveShaderData;
            element._graphicsBatchEntry = unit;
            return unit;
        }
        destroy() {
            let element = this.element;
            if (element)
                element._graphicsBatchEntry = null;
            if (this.batchGeometry)
                this.batchGeometry.destroy();
            if (this.viStore) {
                this.viStore.releaseVertexBlocks(this.vertexBlocks);
                if (this.sourceIndexView)
                    this.viStore.releaseIndexView(this.sourceIndexView);
                WebGraphicsOpVIStorePool.prefer(this.viStore);
            }
            if (element) {
                element.geometry = null;
                element.primitiveShaderData = null;
                element.destroy();
            }
            if (this.sourceGeometry) {
                this.sourceGeometry.bufferState = null;
                this.sourceGeometry.destroy();
            }
            if (this.primitiveShaderData)
                this.primitiveShaderData.destroy();
            this.op = null;
            this.opIndex = -1;
            this.recordStart = 0;
            this.recordCount = 0;
            this.element = null;
            this.viStore = null;
            this.vertexViews.length = 0;
            this.vertexBlocks.length = 0;
            this.vertexBuffer = null;
            this.sourceIndexView = null;
            this.sourceGeometry = null;
            this.batchGeometry = null;
            this.primitiveShaderData = null;
            this.fillTextureRange = null;
        }
    }
    class WebGraphicsRenderUnitPool {
        static take(vertexCount, indexCount, owner, subShader, materialShaderData) {
            let vertexBlockCount = Math.ceil(vertexCount / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
            let indexBuckets = WebGraphicsRenderUnitPool._buckets.get(vertexBlockCount);
            let units = indexBuckets && indexBuckets.get(indexCount);
            if (!units || units.length === 0)
                return null;
            let unit = units.pop();
            WebGraphicsRenderUnitPool._count--;
            if (units.length === 0) {
                indexBuckets.delete(indexCount);
                if (indexBuckets.size === 0)
                    WebGraphicsRenderUnitPool._buckets.delete(vertexBlockCount);
            }
            unit.reactivate(owner, subShader, materialShaderData);
            return unit;
        }
        static recover(unit) {
            if (!unit)
                return;
            unit.op = null;
            unit.opIndex = -1;
            unit.recordStart = 0;
            unit.recordCount = 0;
            if (WebGraphicsRenderUnitPool._count >= WebGraphicsRenderUnitPool._maxCount) {
                unit.destroy();
                return;
            }
            if (unit.primitiveShaderData) {
                unit.primitiveShaderData.setTexture(Laya.ShaderDefines2D.UNIFORM_SPRITETEXTURE, null);
                unit.primitiveShaderData.setTexture(Laya.ShaderDefines2D.UNIFORM_SPRITETEXTURE_ARRAY, null);
            }
            let vertexBlockCount = unit.vertexBlockCapacity;
            let indexCount = unit.indexCapacity;
            let indexBuckets = WebGraphicsRenderUnitPool._buckets.get(vertexBlockCount);
            if (!indexBuckets) {
                indexBuckets = new Map();
                WebGraphicsRenderUnitPool._buckets.set(vertexBlockCount, indexBuckets);
            }
            let units = indexBuckets.get(indexCount);
            if (!units) {
                units = [];
                indexBuckets.set(indexCount, units);
            }
            units.push(unit);
            WebGraphicsRenderUnitPool._count++;
        }
    }
    WebGraphicsRenderUnitPool._maxCount = 1024;
    WebGraphicsRenderUnitPool._count = 0;
    WebGraphicsRenderUnitPool._buckets = new Map();
    class WebGraphicsOpVIStore {
        get bufferState() {
            return this._bufferState;
        }
        get vertexBuffer() {
            return this._vertexBuffer;
        }
        get vertexReservedBytes() {
            return this._canVertexBlockCount * this._vertexBlockLength * 4;
        }
        get indexReservedBytes() {
            return this._indexBufferMaxLength * Laya.GraphicsDefines.GRAPHICS_INDEX_BYTE_SIZE;
        }
        constructor(blockCount) {
            this._vertexViews = [];
            this._vertexFreeBlocks = [];
            this._indexViewPool = new Map();
            this._indexBufferLength = 0;
            this._indexBufferMaxLength = 0;
            this._canVertexBlockCount = 0;
            this._vertexBlockLength = Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE * Laya.GraphicsDefines.stride;
            this._vertexBuffer = Laya.LayaGL.renderDeviceFactory.createVertexBuffer(Laya.BufferUsage.Dynamic);
            this._wholeVertex = new Web2DGraphicsVertexBuffer();
            this._wholeVertex.buffer = this._vertexBuffer;
            this._indexBuffer = Laya.LayaGL.renderDeviceFactory.createIndexBuffer(Laya.BufferUsage.Dynamic);
            this._indexBuffer.indexType = Laya.GraphicsDefines.GRAPHICS_INDEX_FORMAT;
            this._wholeIndex = new Web2DGraphicsIndexBuffer();
            this._wholeIndex.buffer = this._indexBuffer;
            this._bufferState = Laya.LayaGL.renderDeviceFactory.createBufferState();
            this._vertexBuffer.vertexDeclaration = Laya.GraphicsDefines.vertexDeclarition;
            this._bufferState.applyState([this._vertexBuffer], this._indexBuffer);
            this._resizeVertexBuffer(blockCount);
            this._resizeIndexBuffer(Laya.GRAPHICS_INFO_INDEX_BLOCK_SIZE);
        }
        checkVertexInto(vertexCount, vertexViews, vertexBlocks) {
            let requiredBlocks = Math.ceil(vertexCount / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
            let availableNewBlocks = this._canVertexBlockCount - this._vertexViews.length;
            if (requiredBlocks > this._vertexFreeBlocks.length + availableNewBlocks)
                return false;
            vertexBlocks.length = 0;
            vertexViews.length = 0;
            while (requiredBlocks > 0 && this._vertexFreeBlocks.length > 0) {
                let block = this._vertexFreeBlocks.pop();
                vertexBlocks.push(block);
                vertexViews.push(this._vertexViews[block]);
                requiredBlocks--;
            }
            while (requiredBlocks > 0) {
                let block = this._vertexViews.length;
                let view = new Web2DGraphic2DVertexDataView(this._wholeVertex, block * this._vertexBlockLength, this._vertexBlockLength, Laya.GraphicsDefines.stride);
                this._vertexViews[block] = view;
                vertexBlocks.push(block);
                vertexViews.push(view);
                requiredBlocks--;
            }
            return true;
        }
        checkIndex(indexCount) {
            if (this._indexBufferLength + indexCount > this._indexBufferMaxLength)
                this._extendIndexBuffer(indexCount);
            let pool = this._indexViewPool.get(indexCount);
            let view = pool && pool.pop();
            if (!view)
                view = new Web2DGraphic2DIndexDataView(this._wholeIndex, indexCount);
            this._wholeIndex.addDataView(view);
            this._indexBufferLength += indexCount;
            return view;
        }
        releaseVertexBlocks(blocks) {
            if (!blocks || blocks.length === 0)
                return;
            let freeBlocks = this._vertexFreeBlocks;
            let offset = freeBlocks.length;
            freeBlocks.length = offset + blocks.length;
            for (let i = 0, n = blocks.length; i < n; i++)
                freeBlocks[offset + i] = blocks[i];
        }
        releaseIndexView(indexView) {
            if (!indexView)
                return;
            this._indexBufferLength -= indexView.length;
            this._wholeIndex.removeDataView(indexView);
            indexView.setGeometry(null);
            let pool = this._indexViewPool.get(indexView.length);
            if (!pool) {
                pool = [];
                this._indexViewPool.set(indexView.length, pool);
            }
            pool.push(indexView);
        }
        destroy() {
            this._vertexViews.length = 0;
            this._vertexFreeBlocks.length = 0;
            this._indexViewPool.forEach(pool => {
                for (let i = 0, n = pool.length; i < n; i++)
                    pool[i].destroy();
            });
            this._indexViewPool.clear();
            this._bufferState && this._bufferState.destroy();
            this._vertexBuffer && this._vertexBuffer.destroy();
            this._indexBuffer && this._indexBuffer.destroy();
            this._wholeVertex && this._wholeVertex.destroy();
            this._wholeIndex && this._wholeIndex.destroy();
            this._bufferState = null;
            this._vertexBuffer = null;
            this._indexBuffer = null;
            this._wholeVertex = null;
            this._wholeIndex = null;
        }
        _resizeVertexBuffer(blockCount) {
            let byteLength = blockCount * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE * Laya.GraphicsDefines.stride * 4;
            this._wholeVertex.resetData(byteLength);
            this._vertexBuffer.setDataLength(byteLength);
            this._canVertexBlockCount = blockCount;
        }
        _resizeIndexBuffer(indexCount) {
            let byteLength = indexCount * Laya.GraphicsDefines.GRAPHICS_INDEX_BYTE_SIZE;
            this._wholeIndex.resetData(byteLength);
            this._indexBuffer._setIndexDataLength(byteLength);
            this._indexBufferMaxLength = indexCount;
        }
        _extendIndexBuffer(indexCount) {
            let nextCount = Math.ceil((this._indexBufferLength + indexCount) / Laya.GRAPHICS_INFO_INDEX_BLOCK_SIZE) * Laya.GRAPHICS_INFO_INDEX_BLOCK_SIZE;
            this._resizeIndexBuffer(nextCount);
        }
    }
    class WebGraphicsOpVIStorePool {
        static allocateInto(unit, vertexCount, indexCount) {
            if (!unit || vertexCount <= 0 || indexCount <= 0 || vertexCount > Laya.GraphicsDefines.GRAPHICS_MAX_VERTEX)
                return false;
            let stores = WebGraphicsOpVIStorePool._stores;
            let preferred = WebGraphicsOpVIStorePool._preferredStore;
            if (preferred && WebGraphicsOpVIStorePool._tryAllocateInto(preferred, unit, vertexCount, indexCount))
                return true;
            for (let i = 0, n = stores.length; i < n; i++) {
                let store = stores[i];
                if (store !== preferred && WebGraphicsOpVIStorePool._tryAllocateInto(store, unit, vertexCount, indexCount)) {
                    WebGraphicsOpVIStorePool._preferredStore = store;
                    return true;
                }
            }
            WebGraphicsOpVIStorePool._allocateMissCount++;
            let requiredBlocks = Math.ceil(vertexCount / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
            let store = new WebGraphicsOpVIStore(Math.max(WebGraphicsOpVIStorePool._defaultVertexBlocks, requiredBlocks));
            if (WebGraphicsOpVIStorePool._tryAllocateInto(store, unit, vertexCount, indexCount)) {
                stores.push(store);
                WebGraphicsOpVIStorePool._preferredStore = store;
                WebGraphicsOpVIStorePool._newStoreCount++;
                return true;
            }
            store.destroy();
            return false;
        }
        static prefer(store) {
            if (store)
                WebGraphicsOpVIStorePool._preferredStore = store;
        }
        static getStats(out) {
            let stores = WebGraphicsOpVIStorePool._stores;
            let vertexReservedBytes = 0;
            let indexReservedBytes = 0;
            for (let i = 0, n = stores.length; i < n; i++) {
                vertexReservedBytes += stores[i].vertexReservedBytes;
                indexReservedBytes += stores[i].indexReservedBytes;
            }
            out.storeCount = stores.length;
            out.vertexReservedBytes = vertexReservedBytes;
            out.indexReservedBytes = indexReservedBytes;
            out.allocateMissCount = WebGraphicsOpVIStorePool._allocateMissCount;
            out.newStoreCount = WebGraphicsOpVIStorePool._newStoreCount;
            return out;
        }
        static _tryAllocateInto(store, unit, vertexCount, indexCount) {
            if (!store.checkVertexInto(vertexCount, unit.vertexViews, unit.vertexBlocks))
                return false;
            let indexView = store.checkIndex(indexCount);
            if (!indexView) {
                store.releaseVertexBlocks(unit.vertexBlocks);
                unit.vertexViews.length = 0;
                unit.vertexBlocks.length = 0;
                return false;
            }
            unit.viStore = store;
            unit.sourceIndexView = indexView;
            return true;
        }
    }
    WebGraphicsOpVIStorePool._defaultVertexBlocks = 4096 / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
    WebGraphicsOpVIStorePool._stores = [];
    WebGraphicsOpVIStorePool._preferredStore = null;
    WebGraphicsOpVIStorePool._allocateMissCount = 0;
    WebGraphicsOpVIStorePool._newStoreCount = 0;

    class WebGraphicsOp2DRuntime {
        constructor(_owner, _materialState) {
            this._owner = _owner;
            this._materialState = _materialState;
            this._ops = [];
            this._opRenderRanges = null;
            this._opRenderRangeCapacity = 0;
            this._opRefs = [];
            this._renderElements = [];
            this._renderUnits = [];
            this._spareOpRenderRanges = null;
            this._spareOpRenderRangeCapacity = 0;
            this._spareOpRefs = null;
            this._spareRenderElements = null;
            this._spareRenderUnits = null;
            this._spareOpCursor = 0;
            this._preferredSpareRenderStart = -1;
            this._preferredSpareRenderEnd = -1;
            this._active = false;
            this._needsRematerialize = false;
            this._pointScratch = new Float32Array(2);
            this._matrixScratch = new Laya.Matrix();
            this._singleTextureQuadRenderIndex = -1;
            this._singleTextureQuadOp = null;
            this._singleTextureQuadVertexView = null;
            this._singleTextureQuadX0 = 0;
            this._singleTextureQuadY0 = 0;
            this._singleTextureQuadX1 = 0;
            this._singleTextureQuadY1 = 0;
            this._singleTextureQuadX2 = 0;
            this._singleTextureQuadY2 = 0;
            this._singleTextureQuadX3 = 0;
            this._singleTextureQuadY3 = 0;
            this._graphicsHandleUpdateBuffer = null;
            this._handleUpdateInt32 = null;
            this._handleUpdateFloat32 = null;
            this._renderStateScratch = { stateKey: 0, typeKey: 0, textureKey: 0, texture: null };
        }
        syncGraphicsSubShader() {
            let subShader = this._materialState.subShader;
            for (let element of this._renderElements)
                if (element)
                    element.subShader = subShader;
        }
        syncGraphicsShaderData() {
            let shaderData = this._materialState.shaderData;
            let customMaterial = shaderData != null;
            for (let element of this._renderElements) {
                if (!element)
                    continue;
                element.materialShaderData = shaderData;
                element.typeKey = customMaterial
                    ? element.typeKey | Laya.ShaderDefines2D.TYPEKEY_CUSTOM_MATERIAL
                    : element.typeKey & ~Laya.ShaderDefines2D.TYPEKEY_CUSTOM_MATERIAL;
            }
        }
        setGraphicsHandleUpdateBuffer(buffer) {
            if (this._graphicsHandleUpdateBuffer === buffer)
                return;
            this._graphicsHandleUpdateBuffer = buffer;
            this._handleUpdateInt32 = buffer ? new Int32Array(buffer) : null;
            this._handleUpdateFloat32 = buffer ? new Float32Array(buffer) : null;
        }
        syncGraphicsOps(ops) {
            let nextOps = ops || [];
            if (this._needsRematerialize) {
                this._ops = nextOps;
                this._rebuildRenderOps(true);
                this._needsRematerialize = false;
                this._publishOwnerElements();
                this._markHandleUpdatesHandled();
                return;
            }
            if (this._ops !== nextOps) {
                this._ops = nextOps;
                this._rebuildRenderOps();
                this._publishOwnerElements();
                this._markHandleUpdatesHandled();
                return;
            }
            if (!this._handleUpdateInt32) {
                if (!this._sameOpRefs(nextOps)) {
                    this._rebuildRenderOps();
                    this._publishOwnerElements();
                    return;
                }
                this._syncRenderElementTransforms();
                this._cacheSingleTextureQuadFastPath();
                return;
            }
            if (this._isHandleUpdateVersionHandled())
                return;
            let update = this._handleUpdateInt32;
            if (update[9] === update[8]
                && this._syncDirtyOpsFromHandle())
                return;
            this._rebuildRenderOps();
            this._publishOwnerElements();
            this._markHandleUpdatesHandled();
        }
        syncOp(op, renderIndex = this._ops ? this._ops.indexOf(op) : -1, mat = this._owner ? this._owner.renderMatrix : null, ownerAlpha = this._owner ? this._owner.globalAlpha : 1, clearDirty = true) {
            if (!op || renderIndex < 0)
                return;
            let ref = this._renderUnits[renderIndex];
            switch (op.opProfile) {
                case 1:
                case 2:
                    if (op.dirtyFlags === 0)
                        this._writeTextureQuad(renderIndex, op, mat, ownerAlpha);
                    else
                        this._syncTextureQuadDirtyOp(renderIndex, op, mat, ownerAlpha);
                    break;
                case 5:
                    if (op.dirtyFlags === 0)
                        this._writeFillTexture(renderIndex, op, mat, ownerAlpha);
                    else
                        this._syncFillTextureDirtyOp(renderIndex, op, mat, ownerAlpha);
                    break;
                case 3:
                case 4:
                    if (op.dirtyFlags === 0)
                        this._writeSolidQuad(renderIndex, op, mat, ownerAlpha);
                    else
                        this._syncSolidQuadDirtyOp(renderIndex, op, mat, ownerAlpha);
                    break;
                case 8:
                    if (op.dirtyFlags === 0)
                        this._writeMesh(renderIndex, op, mat, ownerAlpha);
                    else
                        this._syncMeshDirtyOp(renderIndex, op, mat, ownerAlpha);
                    break;
                case 7: {
                    let textStart = ref ? ref.recordStart : 0;
                    let textCount = ref ? ref.recordCount : op.recordCount;
                    if (op.dirtyFlags === 0)
                        this._writeText(renderIndex, op, textStart, textCount, mat, ownerAlpha);
                    else
                        this._syncTextDirtyOp(renderIndex, op, textStart, textCount, mat, ownerAlpha);
                    break;
                }
                case 6:
                    if (op.dirtyFlags === 0)
                        this._writeMultiQuad(renderIndex, op, ref ? ref.recordStart : 0, ref ? ref.recordCount : op.recordCount, mat, ownerAlpha);
                    else
                        this._syncMultiQuadDirtyOp(renderIndex, op, ref ? ref.recordStart : 0, ref ? ref.recordCount : op.recordCount, mat, ownerAlpha);
                    break;
            }
            if (clearDirty)
                op.clearDirty();
        }
        updateTransform(mat, globalAlpha, writeAlpha = true) {
            if (mat)
                this.updateTransformValues(mat.a, mat.b, mat.c, mat.d, mat.tx, mat.ty, globalAlpha, writeAlpha);
            else
                this.updateTransformValues(1, 0, 0, 1, 0, 0, globalAlpha, writeAlpha);
        }
        updateTransformValues(a, b, c, d, tx, ty, globalAlpha, writeAlpha = true) {
            if (this._updateSingleTextureQuadTransformValuesOnly(a, b, c, d, tx, ty, globalAlpha, writeAlpha))
                return;
            let mat = this._matrixScratch;
            mat.a = a;
            mat.b = b;
            mat.c = c;
            mat.d = d;
            mat.tx = tx;
            mat.ty = ty;
            mat._bTransform = a !== 1 || b !== 0 || c !== 0 || d !== 1;
            this._syncRenderElementTransforms(mat, globalAlpha, writeAlpha);
        }
        updateGlobalAlpha(globalAlpha) {
            if (this._updateSingleTextureQuadGlobalAlphaOnly(globalAlpha))
                return;
            this._syncRenderElementAlphaOnly(globalAlpha);
        }
        getGraphicsBatchEntry(renderElementIndex) {
            if (renderElementIndex == null || renderElementIndex < 0)
                return null;
            let unit = this._renderUnits[renderElementIndex];
            return unit && unit.sourceIndexView && unit.viStore ? unit : null;
        }
        syncGraphicsUseSpriteState() {
            let useSpriteState = this._materialState.useSpriteState;
            let ownerBlendMode = this._owner.blendMode;
            let blendMask = Laya.ShaderDefines2D.TYPEKEY_CUSTOM_MATERIAL - 1;
            for (let element of this._renderElements) {
                if (element)
                    element.renderStateIsBySprite = useSpriteState && (element.typeKey & blendMask) === ownerBlendMode;
            }
        }
        _syncDirtyOpsFromHandle() {
            let update = this._handleUpdateInt32;
            if (!update)
                return false;
            let updateVersion = update[0];
            if (update[1] === updateVersion)
                return true;
            let dirtyFlags = update[2];
            let start = update[3];
            let count = update[4];
            if (dirtyFlags === 0 || start < 0 || count <= 0) {
                this._markHandleUpdatesHandled();
                return true;
            }
            let end = Math.min(start + count, this._ops.length);
            let mat = this._owner ? this._owner.renderMatrix : null;
            let ownerAlpha = this._owner ? this._owner.globalAlpha : 1;
            for (let opIndex = start; opIndex < end; opIndex++) {
                let op = this._ops[opIndex];
                if ((op.dirtyFlags & 1) !== 0) {
                    this._rebuildRenderOps();
                    this._publishOwnerElements();
                    this._markHandleUpdatesHandled();
                    return true;
                }
                let rangeOffset = opIndex * 2;
                let rangeCount = this._opRenderRanges ? this._opRenderRanges[rangeOffset + 1] : 0;
                if (rangeCount <= 0) {
                    op.clearDirty();
                    continue;
                }
                if (op.dirtyFlags === 0)
                    continue;
                let rangeStart = this._opRenderRanges[rangeOffset];
                for (let renderIndex = rangeStart, n = rangeStart + rangeCount; renderIndex < n; renderIndex++)
                    this.syncOp(op, renderIndex, mat, ownerAlpha, false);
                op.clearDirty();
            }
            this._markHandleUpdatesHandled();
            this._cacheSingleTextureQuadFastPath();
            return true;
        }
        destroy() {
            this._active = false;
            this._clearRenderOps();
            this._ops = [];
            this._owner = null;
        }
        _rebuildRenderOps(forceStructure = false) {
            let hasPreviousUnits = this._renderUnits.length > 0;
            if (hasPreviousUnits)
                this._snapshotRenderOpsToSpare();
            else {
                this._renderElements.length = 0;
                this._opRefs.length = 0;
                this._renderUnits.length = 0;
            }
            let renderIndex = 0;
            this._spareOpCursor = 0;
            for (let i = 0, n = this._ops.length; i < n; i++) {
                let op = this._ops[i];
                this._opRefs[i] = op;
                this._preferredSpareRenderStart = -1;
                this._preferredSpareRenderEnd = -1;
                let oldOpIndex = hasPreviousUnits ? this._findSpareOpIndex(op) : -1;
                if (!forceStructure && oldOpIndex >= 0 && (op.dirtyFlags & 1) === 0) {
                    let needsSync = op.dirtyFlags !== 0;
                    let oldRangeOffset = oldOpIndex * 2;
                    let oldRenderStart = this._spareOpRenderRanges[oldRangeOffset];
                    let count = this._spareOpRenderRanges[oldRangeOffset + 1];
                    this._setOpRenderRange(i, renderIndex, count);
                    for (let oldRenderIndex = oldRenderStart, end = oldRenderIndex + count; oldRenderIndex < end; oldRenderIndex++) {
                        this._reuseSpareRenderElement(oldRenderIndex, renderIndex, op, i);
                        if (needsSync)
                            this.syncOp(op, renderIndex, undefined, undefined, false);
                        renderIndex++;
                    }
                    if (needsSync || count === 0)
                        op.clearDirty();
                    continue;
                }
                if (oldOpIndex >= 0) {
                    let oldRangeOffset = oldOpIndex * 2;
                    this._preferredSpareRenderStart = this._spareOpRenderRanges[oldRangeOffset];
                    this._preferredSpareRenderEnd = this._preferredSpareRenderStart + this._spareOpRenderRanges[oldRangeOffset + 1];
                }
                if (op.opProfile === 7) {
                    let startRenderIndex = renderIndex;
                    renderIndex = this._appendTextRenderElements(renderIndex, op, i);
                    this._setOpRenderRange(i, startRenderIndex, renderIndex - startRenderIndex);
                    continue;
                }
                if (op.opProfile === 6) {
                    let startRenderIndex = renderIndex;
                    renderIndex = this._appendMultiQuadRenderElements(renderIndex, op, i);
                    this._setOpRenderRange(i, startRenderIndex, renderIndex - startRenderIndex);
                    continue;
                }
                let vertexCount = this._getVertexCount(op);
                let indexCount = this._getIndexCount(op);
                if (vertexCount <= 0 || indexCount <= 0) {
                    this._setOpRenderRange(i, renderIndex, 0);
                    op.clearDirty();
                    continue;
                }
                if (!this._createRenderElement(renderIndex, vertexCount, indexCount, op, i, 0, 1)) {
                    this._setOpRenderRange(i, renderIndex, 0);
                    continue;
                }
                this._setOpRenderRange(i, renderIndex, 1);
                this.syncOp(op, renderIndex);
                renderIndex++;
            }
            this._destroyUnusedSpareRenderUnits();
            this._cacheSingleTextureQuadFastPath();
        }
        _isHandleUpdateVersionHandled() {
            let update = this._handleUpdateInt32;
            return !!update
                && update[1] === update[0]
                && update[9] === update[8];
        }
        _markHandleUpdatesHandled() {
            let update = this._handleUpdateInt32;
            if (!update)
                return;
            update[9] = update[8];
            update[1] = update[0];
        }
        _snapshotRenderOpsToSpare() {
            if (!this._spareRenderUnits) {
                this._spareOpRefs = [];
                this._spareRenderElements = [];
                this._spareRenderUnits = [];
            }
            for (let i = 0, n = this._renderUnits.length; i < n; i++) {
                this._spareRenderUnits[i] = this._renderUnits[i];
                this._spareRenderElements[i] = this._renderElements[i];
            }
            this._spareRenderUnits.length = this._renderUnits.length;
            this._spareRenderElements.length = this._renderElements.length;
            this._ensureSpareOpRenderRangeCapacity(this._opRefs.length);
            for (let i = 0, n = this._opRefs.length; i < n; i++) {
                this._spareOpRefs[i] = this._opRefs[i];
                let rangeOffset = i * 2;
                this._spareOpRenderRanges[rangeOffset] = this._opRenderRanges[rangeOffset];
                this._spareOpRenderRanges[rangeOffset + 1] = this._opRenderRanges[rangeOffset + 1];
            }
            this._spareOpRefs.length = this._opRefs.length;
            this._renderElements.length = 0;
            this._opRefs.length = 0;
            this._renderUnits.length = 0;
        }
        _findSpareOpIndex(op) {
            let n = this._spareOpRefs.length;
            while (this._spareOpCursor < n) {
                let candidateIndex = this._spareOpCursor;
                let candidate = this._spareOpRefs[candidateIndex];
                if (candidate === op) {
                    this._spareOpCursor++;
                    return candidateIndex;
                }
                if (candidate.commandIndex < op.commandIndex) {
                    this._spareOpCursor++;
                    continue;
                }
                if (candidate.commandIndex > op.commandIndex)
                    return -1;
                for (let i = candidateIndex + 1; i < n && this._spareOpRefs[i].commandIndex === op.commandIndex; i++) {
                    if (this._spareOpRefs[i] === op) {
                        this._spareOpCursor = i + 1;
                        return i;
                    }
                }
                return -1;
            }
            return -1;
        }
        _reuseSpareRenderElement(oldRenderIndex, renderIndex, op, opIndex) {
            let unit = this._spareRenderUnits[oldRenderIndex];
            unit.op = op;
            unit.opIndex = opIndex;
            this._renderUnits[renderIndex] = unit;
            this._renderElements[renderIndex] = this._spareRenderElements[oldRenderIndex];
            this._spareRenderUnits[oldRenderIndex] = null;
        }
        _destroyUnusedSpareRenderUnits() {
            if (!this._spareRenderUnits)
                return;
            for (let i = 0, n = this._spareRenderUnits.length; i < n; i++) {
                let unit = this._spareRenderUnits[i];
                if (!unit)
                    continue;
                WebGraphicsRenderUnitPool.recover(unit);
                this._spareRenderUnits[i] = null;
                this._spareRenderElements[i] = null;
            }
            this._spareRenderUnits.length = 0;
            this._spareRenderElements.length = 0;
            this._spareOpRefs.length = 0;
        }
        _takePreferredSpareRenderUnit(vertexCount, indexCount) {
            if (!this._spareRenderUnits || this._preferredSpareRenderStart < 0)
                return null;
            for (let i = this._preferredSpareRenderStart; i < this._preferredSpareRenderEnd; i++) {
                let unit = this._spareRenderUnits[i];
                if (!unit || !unit.canReuse(vertexCount, indexCount))
                    continue;
                this._spareRenderUnits[i] = null;
                unit.reactivate(this._owner, this._materialState.subShader, this._materialState.shaderData);
                return unit;
            }
            return null;
        }
        _appendMultiQuadRenderElements(renderIndex, op, opIndex) {
            return this._appendGroupedQuadRenderElements(renderIndex, op, opIndex);
        }
        _appendTextRenderElements(renderIndex, op, opIndex) {
            return this._appendGroupedQuadRenderElements(renderIndex, op, opIndex);
        }
        _appendGroupedQuadRenderElements(renderIndex, op, opIndex) {
            let maxRecords = this._getMaxQuadRecordsPerRenderElement();
            let groupStart = 0;
            let groupTexture = op.recordCount > 0 ? op.textures[0] || null : null;
            for (let i = 1, n = op.recordCount; i <= n; i++) {
                let texture = i < n ? op.textures[i] || null : null;
                if (i < n && texture === groupTexture)
                    continue;
                let groupCount = i - groupStart;
                for (let offset = 0; offset < groupCount;) {
                    let count = Math.min(maxRecords, groupCount - offset);
                    if (!this._createRenderElement(renderIndex, count * 4, count * 6, op, opIndex, groupStart + offset, count))
                        break;
                    let recordStart = groupStart + offset;
                    if (op.opProfile === 7)
                        this._writeText(renderIndex, op, recordStart, count);
                    else
                        this._writeMultiQuad(renderIndex, op, recordStart, count);
                    renderIndex++;
                    offset += count;
                }
                groupStart = i;
                groupTexture = texture;
            }
            op.clearDirty();
            return renderIndex;
        }
        _getVertexCount(op) {
            switch (op.opProfile) {
                case 1:
                case 2:
                case 5:
                case 3:
                case 4:
                    return op.recordCount > 0 ? 4 : 0;
                case 6:
                    return op.recordCount * 4;
                case 8:
                    return op._int32[16 + 13];
                default:
                    return 0;
            }
        }
        _getIndexCount(op) {
            switch (op.opProfile) {
                case 1:
                case 2:
                case 5:
                case 3:
                case 4:
                    return op.recordCount > 0 ? 6 : 0;
                case 6:
                    return op.recordCount * 6;
                case 8:
                    return op._int32[16 + 14];
                default:
                    return 0;
            }
        }
        _getMaxQuadRecordsPerRenderElement() {
            return Math.max(1, Math.floor(Laya.GraphicsDefines.GRAPHICS_MAX_VERTEX / 4));
        }
        _setOpRenderRange(opIndex, start, count) {
            this._ensureOpRenderRangeCapacity(opIndex + 1);
            let offset = opIndex * 2;
            this._opRenderRanges[offset] = start;
            this._opRenderRanges[offset + 1] = count;
        }
        _ensureOpRenderRangeCapacity(opCount) {
            if (opCount <= this._opRenderRangeCapacity)
                return;
            let capacity = Math.max(8, this._opRenderRangeCapacity || 0);
            while (capacity < opCount)
                capacity <<= 1;
            let ranges = new Int32Array(capacity * 2);
            if (this._opRenderRanges)
                ranges.set(this._opRenderRanges);
            this._opRenderRanges = ranges;
            this._opRenderRangeCapacity = capacity;
        }
        _ensureSpareOpRenderRangeCapacity(opCount) {
            if (opCount <= this._spareOpRenderRangeCapacity)
                return;
            let capacity = Math.max(8, this._spareOpRenderRangeCapacity || 0);
            while (capacity < opCount)
                capacity <<= 1;
            this._spareOpRenderRanges = new Int32Array(capacity * 2);
            this._spareOpRenderRangeCapacity = capacity;
        }
        _createRenderElement(renderIndex, vertexCount, indexCount, op, opIndex, recordStart, recordCount) {
            let unit = this._takePreferredSpareRenderUnit(vertexCount, indexCount);
            if (!unit)
                unit = WebGraphicsRenderUnitPool.take(vertexCount, indexCount, this._owner, this._materialState.subShader, this._materialState.shaderData);
            if (!unit) {
                unit = WebGraphicsRenderUnit.create(vertexCount, indexCount, this._owner, this._materialState.subShader, this._materialState.shaderData);
                if (!unit)
                    return false;
            }
            this._renderElements[renderIndex] = unit.element;
            unit.op = op;
            unit.opIndex = opIndex;
            unit.recordStart = recordStart;
            unit.recordCount = recordCount;
            this._renderUnits[renderIndex] = unit;
            return true;
        }
        activate() {
            this._active = true;
            this._publishOwnerElements();
        }
        deactivate() {
            if (!this._active)
                return;
            this._active = false;
            this._releaseRenderUnitsToPool();
            this._needsRematerialize = this._ops.length > 0;
        }
        _releaseRenderUnitsToPool() {
            for (let i = 0, n = this._renderUnits.length; i < n; i++) {
                let unit = this._renderUnits[i];
                if (unit)
                    WebGraphicsRenderUnitPool.recover(unit);
            }
            this._renderElements.length = 0;
            this._renderUnits.length = 0;
            this._opRefs.length = 0;
        }
        _writeTextureQuad(renderIndex, op, mat, ownerAlpha) {
            if (op.recordCount <= 0)
                return;
            let wordOffset = 16;
            let texture = op._texture;
            let hasCustomMaterial = this._materialState.shaderData != null;
            this._syncTexture(renderIndex, texture, 0, op._int32[wordOffset + 10], hasCustomMaterial);
            this._writeQuadVertexData(renderIndex, op._float32, op._int32, wordOffset, mat, texture != null, ownerAlpha);
            this._writeQuadIndex(renderIndex, 1);
        }
        _syncTextureQuadDirtyOp(renderIndex, op, mat, ownerAlpha) {
            if (op.recordCount <= 0)
                return;
            let dirtyFlags = op.dirtyFlags;
            if ((dirtyFlags & 1) !== 0) {
                this._writeTextureQuad(renderIndex, op, mat, ownerAlpha);
                return;
            }
            let wordOffset = 16;
            let texture = op._texture;
            let hasCustomMaterial = this._materialState.shaderData != null;
            if ((dirtyFlags & (4 | 16)) !== 0)
                this._syncTextureOrState(renderIndex, dirtyFlags, texture, 0, op._int32[wordOffset + 10], hasCustomMaterial);
            if ((dirtyFlags & 2) !== 0)
                this._writeQuadVertexData(renderIndex, op._float32, op._int32, wordOffset, mat, texture != null, ownerAlpha);
        }
        _syncSolidQuadDirtyOp(renderIndex, op, mat, ownerAlpha) {
            if (op.recordCount <= 0)
                return;
            let dirtyFlags = op.dirtyFlags;
            if ((dirtyFlags & 1) !== 0) {
                this._writeSolidQuad(renderIndex, op, mat, ownerAlpha);
                return;
            }
            let wordOffset = 16;
            if ((dirtyFlags & 16) !== 0)
                this._syncTextureState(renderIndex, op._int32[wordOffset + 10], this._materialState.shaderData != null);
            if ((dirtyFlags & (2 | 16)) !== 0)
                this._writeSolidQuadVertexData(renderIndex, op._float32, op._int32, wordOffset, mat, ownerAlpha);
        }
        _writeSolidQuad(renderIndex, op, mat, ownerAlpha) {
            if (op.recordCount <= 0)
                return;
            let wordOffset = 16;
            this._syncTexture(renderIndex, null, 0, op._int32[wordOffset + 10], this._materialState.shaderData != null);
            this._writeSolidQuadVertexData(renderIndex, op._float32, op._int32, wordOffset, mat, ownerAlpha);
            this._writeQuadIndex(renderIndex, 1);
        }
        _writeFillTexture(renderIndex, op, mat, ownerAlpha) {
            if (op.recordCount <= 0)
                return;
            let wordOffset = 16;
            let f32 = op._float32;
            let i32 = op._int32;
            let texture = op._texture;
            this._syncTexture(renderIndex, texture, Laya.ShaderDefines2D.DEFINE_BIT_FILLTEXTURE, i32[wordOffset + 10], this._materialState.shaderData != null);
            this._syncFillTextureRange(renderIndex, f32[wordOffset + 23], f32[wordOffset + 24], f32[wordOffset + 23] + f32[wordOffset + 25], f32[wordOffset + 24] + f32[wordOffset + 26]);
            this._writeQuadVertexData(renderIndex, f32, i32, wordOffset, mat, texture != null, ownerAlpha);
            this._writeQuadIndex(renderIndex, 1);
        }
        _syncFillTextureDirtyOp(renderIndex, op, mat, ownerAlpha) {
            if (op.recordCount <= 0)
                return;
            let dirtyFlags = op.dirtyFlags;
            if ((dirtyFlags & 1) !== 0) {
                this._writeFillTexture(renderIndex, op, mat, ownerAlpha);
                return;
            }
            let wordOffset = 16;
            let f32 = op._float32;
            let i32 = op._int32;
            let texture = op._texture;
            if ((dirtyFlags & (4 | 16)) !== 0)
                this._syncTextureOrState(renderIndex, dirtyFlags, texture, Laya.ShaderDefines2D.DEFINE_BIT_FILLTEXTURE, i32[wordOffset + 10], this._materialState.shaderData != null);
            if ((dirtyFlags & (4 | 2)) !== 0)
                this._syncFillTextureRange(renderIndex, f32[wordOffset + 23], f32[wordOffset + 24], f32[wordOffset + 23] + f32[wordOffset + 25], f32[wordOffset + 24] + f32[wordOffset + 26]);
            if ((dirtyFlags & (2 | 4 | 16)) !== 0)
                this._writeQuadVertexData(renderIndex, f32, i32, wordOffset, mat, texture != null, ownerAlpha);
        }
        _writeMultiQuad(renderIndex, op, start = 0, count = op.recordCount, mat = this._owner ? this._owner.renderMatrix : null, ownerAlpha = this._owner ? this._owner.globalAlpha : 1) {
            if (count <= 0)
                return;
            let bodyOffset = 16;
            let texture = op.textures[start] || null;
            this._syncTexture(renderIndex, texture, 0, op._int32[bodyOffset + start * GraphicsQuadPayloadWordCount + 10], this._materialState.shaderData != null);
            this._writeMultiQuadRange(renderIndex, op, start, count, mat, ownerAlpha, texture != null);
            this._writeQuadIndex(renderIndex, count);
        }
        _syncMultiQuadDirtyOp(renderIndex, op, start = 0, count = op.recordCount, mat = this._owner ? this._owner.renderMatrix : null, ownerAlpha = this._owner ? this._owner.globalAlpha : 1) {
            if (count <= 0)
                return;
            let dirtyFlags = op.dirtyFlags;
            if ((dirtyFlags & 1) !== 0) {
                this._writeMultiQuad(renderIndex, op, start, count, mat, ownerAlpha);
                return;
            }
            let bodyOffset = 16;
            let texture = op.textures[start] || null;
            if ((dirtyFlags & (4 | 16)) !== 0)
                this._syncTextureOrState(renderIndex, dirtyFlags, texture, 0, op._int32[bodyOffset + start * GraphicsQuadPayloadWordCount + 10], this._materialState.shaderData != null);
            if ((dirtyFlags & (2 | 4 | 16)) !== 0)
                this._writeMultiQuadRange(renderIndex, op, start, count, mat, ownerAlpha, texture != null);
        }
        _writeText(renderIndex, op, start, count, mat = this._owner ? this._owner.renderMatrix : null, ownerAlpha = this._owner ? this._owner.globalAlpha : 1) {
            if (count <= 0)
                return;
            let texture = op.textures[start] || null;
            let bodyOffset = 16;
            this._syncTexture(renderIndex, texture, 0, op._int32[bodyOffset + start * GraphicsQuadPayloadWordCount + 10], this._materialState.shaderData != null);
            this._writeMultiQuadRange(renderIndex, op, start, count, mat, ownerAlpha, texture != null);
            this._writeQuadIndex(renderIndex, count);
        }
        _syncTextDirtyOp(renderIndex, op, start, count, mat = this._owner ? this._owner.renderMatrix : null, ownerAlpha = this._owner ? this._owner.globalAlpha : 1) {
            if (count <= 0)
                return;
            let dirtyFlags = op.dirtyFlags;
            if ((dirtyFlags & 1) !== 0) {
                this._writeText(renderIndex, op, start, count, mat, ownerAlpha);
                return;
            }
            let texture = op.textures[start] || null;
            let bodyOffset = 16;
            if ((dirtyFlags & (4 | 16)) !== 0)
                this._syncTextureOrState(renderIndex, dirtyFlags, texture, 0, op._int32[bodyOffset + start * GraphicsQuadPayloadWordCount + 10], this._materialState.shaderData != null);
            if ((dirtyFlags & (2 | 4 | 16)) !== 0)
                this._writeMultiQuadRange(renderIndex, op, start, count, mat, ownerAlpha, texture != null);
        }
        _writeMultiQuadRange(renderIndex, op, start, count, mat, ownerAlpha, uvEnabled) {
            let view = null;
            let blockData = null;
            let vertexIndex = 0;
            let bodyOffset = 16;
            for (let i = start, n = start + count; i < n; i++) {
                if (vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE === 0) {
                    view = this._renderUnits[renderIndex].vertexViews[Math.floor(vertexIndex / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE)];
                    blockData = view._getData();
                    blockData.fill(0);
                }
                this._writeQuadVerticesInto(blockData, vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE, op._float32, op._int32, bodyOffset + i * GraphicsQuadPayloadWordCount, mat, uvEnabled, ownerAlpha);
                vertexIndex += 4;
                if (vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE === 0)
                    view._modify();
            }
            if (vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE !== 0)
                view._modify();
        }
        _writeMesh(renderIndex, op, mat, ownerAlpha) {
            let wordOffset = 16;
            let int32 = op._int32;
            this._syncTexture(renderIndex, op._texture, 0, int32[wordOffset + 4], this._materialState.shaderData != null);
            this._writeMeshData(renderIndex, op, wordOffset, mat, ownerAlpha);
            this._writeMeshIndex(renderIndex, op, wordOffset);
        }
        _syncMeshDirtyOp(renderIndex, op, mat, ownerAlpha) {
            let dirtyFlags = op.dirtyFlags;
            if ((dirtyFlags & 1) !== 0) {
                this._writeMesh(renderIndex, op, mat, ownerAlpha);
                return;
            }
            let wordOffset = 16;
            let int32 = op._int32;
            if ((dirtyFlags & (4 | 16)) !== 0)
                this._syncTextureOrState(renderIndex, dirtyFlags, op._texture, 0, int32[wordOffset + 4], this._materialState.shaderData != null);
            if ((dirtyFlags & (2 | 4 | 16)) !== 0)
                this._writeMeshData(renderIndex, op, wordOffset, mat, ownerAlpha);
            if ((dirtyFlags & 2) !== 0)
                this._writeMeshIndex(renderIndex, op, wordOffset);
        }
        _writeMeshIndex(renderIndex, op, wordOffset) {
            let int32 = op._int32;
            let indexDataOffset = wordOffset + int32[wordOffset + 19];
            let indexCount = int32[wordOffset + 14];
            let unit = this._renderUnits[renderIndex];
            let indexData = unit.sourceIndexView._getData();
            let blocks = unit.vertexBlocks;
            for (let j = 0; j < indexCount; j++) {
                let localVertex = int32[indexDataOffset + j];
                let blockIndex = Math.floor(localVertex / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
                let vertexInBlock = localVertex - blockIndex * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
                indexData[j] = blocks[blockIndex] * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE + vertexInBlock;
            }
            unit.sourceIndexView._modify();
        }
        _writeMeshData(renderIndex, op, wordOffset, ownerMat, ownerAlpha) {
            let float32 = op._float32;
            let int32 = op._int32;
            let vertexCount = int32[wordOffset + 13];
            let hasUV = int32[wordOffset + 15] !== 0;
            let hasColors = int32[wordOffset + 16] !== 0;
            let vertexDataOffset = wordOffset + int32[wordOffset + 17];
            let uvDataOffset = wordOffset + int32[wordOffset + 18];
            let colorDataOffset = wordOffset + int32[wordOffset + 20];
            let color = int32[wordOffset + 2] >>> 0;
            let r = (color & 0xff) / 255.0;
            let g = ((color >>> 8) & 0xff) / 255.0;
            let b = ((color >>> 16) & 0xff) / 255.0;
            let a = (color >>> 24) / 255.0;
            let alpha = float32[wordOffset + 3] * ownerAlpha;
            let x = float32[wordOffset + 0];
            let y = float32[wordOffset + 1];
            let textureLayer = int32[wordOffset + 5];
            let texture = op._texture;
            let modifiedView = null;
            for (let i = 0; i < vertexCount; i++) {
                let globalVertex = i;
                let blockIndex = Math.floor(globalVertex / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
                let localVertex = globalVertex - blockIndex * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
                let view = this._renderUnits[renderIndex].vertexViews[blockIndex];
                if (view !== modifiedView) {
                    modifiedView && modifiedView._modify();
                    modifiedView = view;
                }
                let data = view._getData();
                let vi = localVertex * Laya.GraphicsDefines.stride;
                let vertexOffset = vertexDataOffset + i * 2;
                let point = this._transformMeshPayloadPoint(x + float32[vertexOffset], y + float32[vertexOffset + 1], float32, int32, wordOffset, ownerMat);
                data[vi] = point[0];
                data[vi + 1] = point[1];
                if (hasUV) {
                    let uvOffset = uvDataOffset + i * 2;
                    data[vi + 2] = float32[uvOffset];
                    data[vi + 3] = float32[uvOffset + 1];
                }
                if (hasColors) {
                    let c = colorDataOffset + i * 4;
                    data[vi + 4] = float32[c];
                    data[vi + 5] = float32[c + 1];
                    data[vi + 6] = float32[c + 2];
                    data[vi + 7] = float32[c + 3];
                }
                else {
                    data[vi + 4] = r;
                    data[vi + 5] = g;
                    data[vi + 6] = b;
                    data[vi + 7] = a;
                }
                data[vi + 8] = texture ? Laya.GRAPHICS_INFO_VERTEX_FLAG_ENABLED : Laya.GRAPHICS_INFO_VERTEX_FLAG_DISABLED;
                data[vi + 9] = int32[wordOffset + 21] ? Laya.GRAPHICS_INFO_VERTEX_FLAG_ENABLED : Laya.GRAPHICS_INFO_VERTEX_FLAG_DISABLED;
                data[vi + 10] = alpha;
                data[vi + 11] = textureLayer;
                data[vi + 12] = float32[wordOffset + 22];
                data[vi + 13] = float32[wordOffset + 23];
                data[vi + 14] = float32[wordOffset + 24];
                data[vi + 15] = float32[wordOffset + 25];
            }
            modifiedView && modifiedView._modify();
        }
        _writeSolidQuadVertexData(renderIndex, float32, int32, wordOffset, mat, ownerAlpha) {
            let view = this._renderUnits[renderIndex].vertexViews[0];
            let data = view._getData();
            data.fill(0);
            this._writeQuadVerticesInto(data, 0, float32, int32, wordOffset, mat, false, ownerAlpha);
            view._modify();
        }
        _writeQuadVertexData(renderIndex, float32, int32, wordOffset, mat, uvEnabled, ownerAlpha = this._owner ? this._owner.globalAlpha : 1) {
            let view = this._renderUnits[renderIndex].vertexViews[0];
            let data = view._getData();
            data.fill(0);
            this._writeQuadVerticesInto(data, 0, float32, int32, wordOffset, mat, uvEnabled, ownerAlpha);
            view._modify();
        }
        _writeQuadVerticesInto(data, vertexStart, float32, int32, wordOffset, mat, uvEnabled, ownerAlpha) {
            let color = int32[wordOffset + 8] >>> 0;
            let r = (color & 0xff) / 255.0;
            let g = ((color >>> 8) & 0xff) / 255.0;
            let b = ((color >>> 16) & 0xff) / 255.0;
            let a = (color >>> 24) / 255.0;
            let alpha = float32[wordOffset + 9] * ownerAlpha;
            let x = float32[wordOffset + 0];
            let y = float32[wordOffset + 1];
            let width = float32[wordOffset + 2];
            let height = float32[wordOffset + 3];
            let u0 = float32[wordOffset + 4];
            let v0 = float32[wordOffset + 5];
            let u1 = float32[wordOffset + 6];
            let v1 = float32[wordOffset + 7];
            let textureLayer = int32[wordOffset + 11];
            this._writePayloadVertex(data, vertexStart, x, y, u0, v0, r, g, b, a, alpha, float32, int32, wordOffset, mat, uvEnabled, textureLayer);
            this._writePayloadVertex(data, vertexStart + 1, x + width, y, u1, v0, r, g, b, a, alpha, float32, int32, wordOffset, mat, uvEnabled, textureLayer);
            this._writePayloadVertex(data, vertexStart + 2, x + width, y + height, u1, v1, r, g, b, a, alpha, float32, int32, wordOffset, mat, uvEnabled, textureLayer);
            this._writePayloadVertex(data, vertexStart + 3, x, y + height, u0, v1, r, g, b, a, alpha, float32, int32, wordOffset, mat, uvEnabled, textureLayer);
        }
        _writePayloadVertex(data, vertexIndex, x, y, u, v, r, g, b, a, alpha, float32, int32, wordOffset, ownerMat, uvEnabled, textureLayer) {
            let vi = vertexIndex * Laya.GraphicsDefines.stride;
            let point = this._transformPayloadPoint(x, y, float32, int32, wordOffset, ownerMat);
            data[vi] = point[0];
            data[vi + 1] = point[1];
            data[vi + 2] = u;
            data[vi + 3] = v;
            data[vi + 4] = r;
            data[vi + 5] = g;
            data[vi + 6] = b;
            data[vi + 7] = a;
            data[vi + 8] = uvEnabled ? Laya.GRAPHICS_INFO_VERTEX_FLAG_ENABLED : Laya.GRAPHICS_INFO_VERTEX_FLAG_DISABLED;
            data[vi + 9] = int32[wordOffset + 27] ? Laya.GRAPHICS_INFO_VERTEX_FLAG_ENABLED : Laya.GRAPHICS_INFO_VERTEX_FLAG_DISABLED;
            data[vi + 10] = alpha;
            data[vi + 11] = textureLayer;
            data[vi + 12] = float32[wordOffset + 28];
            data[vi + 13] = float32[wordOffset + 29];
            data[vi + 14] = float32[wordOffset + 30];
            data[vi + 15] = float32[wordOffset + 31];
        }
        _transformPayloadPoint(x, y, float32, int32, wordOffset, ownerMat) {
            let out = this._pointScratch;
            if (int32[wordOffset + 18]) {
                let px = x;
                let py = y;
                x = px * float32[wordOffset + 12] + py * float32[wordOffset + 14] + float32[wordOffset + 16];
                y = px * float32[wordOffset + 13] + py * float32[wordOffset + 15] + float32[wordOffset + 17];
            }
            if (ownerMat) {
                let px = x;
                let py = y;
                x = px * ownerMat.a + py * ownerMat.c + ownerMat.tx;
                y = px * ownerMat.b + py * ownerMat.d + ownerMat.ty;
            }
            out[0] = x;
            out[1] = y;
            return out;
        }
        _transformMeshPayloadPoint(x, y, float32, int32, wordOffset, ownerMat) {
            let out = this._pointScratch;
            if (int32[wordOffset + 12]) {
                let px = x;
                let py = y;
                x = px * float32[wordOffset + 6] + py * float32[wordOffset + 8] + float32[wordOffset + 10];
                y = px * float32[wordOffset + 7] + py * float32[wordOffset + 9] + float32[wordOffset + 11];
            }
            if (ownerMat) {
                let px = x;
                let py = y;
                x = px * ownerMat.a + py * ownerMat.c + ownerMat.tx;
                y = px * ownerMat.b + py * ownerMat.d + ownerMat.ty;
            }
            out[0] = x;
            out[1] = y;
            return out;
        }
        _writeQuadIndex(renderIndex, quadCount) {
            let unit = this._renderUnits[renderIndex];
            let indexData = unit.sourceIndexView._getData();
            let blocks = unit.vertexBlocks;
            for (let i = 0; i < quadCount; i++) {
                let vertexBase = i * 4;
                let blockIndex = Math.floor(vertexBase / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
                let blockBase = blocks[blockIndex] * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE + vertexBase - blockIndex * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
                for (let j = 0; j < 6; j++)
                    indexData[i * 6 + j] = blockBase + Laya.GRAPHICS_INFO_DEFAULT_QUAD_INDICES[j];
            }
            unit.sourceIndexView._modify();
        }
        _updateSingleTextureQuadTransformValuesOnly(a, b, c, d, tx, ty, globalAlpha, writeAlpha = true) {
            let op = this._singleTextureQuadOp;
            if (!op || op.recordCount <= 0 || this._singleTextureQuadRenderIndex < 0)
                return false;
            if (op.dirtyFlags !== 0)
                return false;
            let view = this._singleTextureQuadVertexView;
            if (!view)
                return false;
            let data = view._getData();
            let x0 = this._singleTextureQuadX0;
            let y0 = this._singleTextureQuadY0;
            let x1 = this._singleTextureQuadX1;
            let y1 = this._singleTextureQuadY1;
            let x2 = this._singleTextureQuadX2;
            let y2 = this._singleTextureQuadY2;
            let x3 = this._singleTextureQuadX3;
            let y3 = this._singleTextureQuadY3;
            if (a === 1 && b === 0 && c === 0 && d === 1) {
                data[0] = x0 + tx;
                data[1] = y0 + ty;
                data[16] = x1 + tx;
                data[17] = y1 + ty;
                data[32] = x2 + tx;
                data[33] = y2 + ty;
                data[48] = x3 + tx;
                data[49] = y3 + ty;
            }
            else {
                data[0] = x0 * a + y0 * c + tx;
                data[1] = x0 * b + y0 * d + ty;
                data[16] = x1 * a + y1 * c + tx;
                data[17] = x1 * b + y1 * d + ty;
                data[32] = x2 * a + y2 * c + tx;
                data[33] = x2 * b + y2 * d + ty;
                data[48] = x3 * a + y3 * c + tx;
                data[49] = x3 * b + y3 * d + ty;
            }
            if (writeAlpha) {
                let alpha = op._float32[16 + 9] * globalAlpha;
                data[10] = alpha;
                data[26] = alpha;
                data[42] = alpha;
                data[58] = alpha;
            }
            view._modify();
            return true;
        }
        _updateQuadTransformOnly(renderIndex, float32, int32, wordOffset, globalAlpha, mat, writeAlpha = true) {
            return this._updateQuadTransformValuesOnly(renderIndex, float32, int32, wordOffset, globalAlpha, mat.a, mat.b, mat.c, mat.d, mat.tx, mat.ty, writeAlpha);
        }
        _updateQuadTransformValuesOnly(renderIndex, float32, int32, wordOffset, globalAlpha, a, b, c, d, tx, ty, writeAlpha) {
            let unit = this._renderUnits[renderIndex];
            let view = unit && unit.vertexViews[0];
            if (!view)
                return true;
            let data = view._getData();
            let x = float32[wordOffset + 0];
            let y = float32[wordOffset + 1];
            let width = float32[wordOffset + 2];
            let height = float32[wordOffset + 3];
            let x0 = x;
            let y0 = y;
            let x1 = x + width;
            let y1 = y + height;
            if (int32[wordOffset + 18]) {
                let la = float32[wordOffset + 12];
                let lb = float32[wordOffset + 13];
                let lc = float32[wordOffset + 14];
                let ld = float32[wordOffset + 15];
                let ltx = float32[wordOffset + 16];
                let lty = float32[wordOffset + 17];
                let px0 = x0, py0 = y0, px1 = x1, py1 = y1;
                x0 = px0 * la + py0 * lc + ltx;
                y0 = px0 * lb + py0 * ld + lty;
                x1 = px1 * la + py1 * lc + ltx;
                y1 = px1 * lb + py1 * ld + lty;
                let topRightX = px1 * la + py0 * lc + ltx;
                let topRightY = px1 * lb + py0 * ld + lty;
                let bottomLeftX = px0 * la + py1 * lc + ltx;
                let bottomLeftY = px0 * lb + py1 * ld + lty;
                if (a === 1 && b === 0 && c === 0 && d === 1) {
                    data[0] = x0 + tx;
                    data[1] = y0 + ty;
                    data[16] = topRightX + tx;
                    data[17] = topRightY + ty;
                    data[32] = x1 + tx;
                    data[33] = y1 + ty;
                    data[48] = bottomLeftX + tx;
                    data[49] = bottomLeftY + ty;
                }
                else {
                    data[0] = x0 * a + y0 * c + tx;
                    data[1] = x0 * b + y0 * d + ty;
                    data[16] = topRightX * a + topRightY * c + tx;
                    data[17] = topRightX * b + topRightY * d + ty;
                    data[32] = x1 * a + y1 * c + tx;
                    data[33] = x1 * b + y1 * d + ty;
                    data[48] = bottomLeftX * a + bottomLeftY * c + tx;
                    data[49] = bottomLeftX * b + bottomLeftY * d + ty;
                }
                if (writeAlpha) {
                    let alpha = float32[wordOffset + 9] * globalAlpha;
                    data[10] = alpha;
                    data[26] = alpha;
                    data[42] = alpha;
                    data[58] = alpha;
                }
                view._modify();
                return true;
            }
            if (a === 1 && b === 0 && c === 0 && d === 1) {
                if (tx === 0 && ty === 0) {
                    data[0] = x0;
                    data[1] = y0;
                    data[16] = x1;
                    data[17] = y0;
                    data[32] = x1;
                    data[33] = y1;
                    data[48] = x0;
                    data[49] = y1;
                }
                else {
                    data[0] = x0 + tx;
                    data[1] = y0 + ty;
                    data[16] = x1 + tx;
                    data[17] = y0 + ty;
                    data[32] = x1 + tx;
                    data[33] = y1 + ty;
                    data[48] = x0 + tx;
                    data[49] = y1 + ty;
                }
            }
            else {
                let px = x0, py = y0;
                data[0] = px * a + py * c + tx;
                data[1] = px * b + py * d + ty;
                px = x1;
                py = y0;
                data[16] = px * a + py * c + tx;
                data[17] = px * b + py * d + ty;
                px = x1;
                py = y1;
                data[32] = px * a + py * c + tx;
                data[33] = px * b + py * d + ty;
                px = x0;
                py = y1;
                data[48] = px * a + py * c + tx;
                data[49] = px * b + py * d + ty;
            }
            if (writeAlpha) {
                let alpha = float32[wordOffset + 9] * globalAlpha;
                data[10] = alpha;
                data[26] = alpha;
                data[42] = alpha;
                data[58] = alpha;
            }
            view._modify();
            return true;
        }
        _updateSingleTextureQuadGlobalAlphaOnly(globalAlpha) {
            let op = this._singleTextureQuadOp;
            if (!op || op.recordCount <= 0 || this._singleTextureQuadRenderIndex < 0)
                return false;
            if (op.dirtyFlags !== 0)
                return false;
            let view = this._singleTextureQuadVertexView;
            if (!view)
                return false;
            let data = view._getData();
            let alpha = op._float32[16 + 9] * globalAlpha;
            data[10] = alpha;
            data[26] = alpha;
            data[42] = alpha;
            data[58] = alpha;
            view._modify();
            return true;
        }
        _updateQuadAlphaOnly(renderIndex, alpha) {
            let unit = this._renderUnits[renderIndex];
            let view = unit && unit.vertexViews[0];
            if (!view)
                return true;
            let data = view._getData();
            data[10] = alpha;
            data[26] = alpha;
            data[42] = alpha;
            data[58] = alpha;
            view._modify();
            return true;
        }
        _updateMultiQuadAlphaOnly(renderIndex, op, start, count, ownerAlpha) {
            let views = this._renderUnits[renderIndex].vertexViews;
            if (!views)
                return true;
            let bodyOffset = 16;
            let currentView = null;
            for (let i = start, n = start + count, vertexIndex = 0; i < n; i++) {
                let alpha = op._float32[bodyOffset + i * GraphicsQuadPayloadWordCount + 9] * ownerAlpha;
                for (let j = 0; j < 4; j++, vertexIndex++) {
                    let blockIndex = Math.floor(vertexIndex / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
                    let view = views[blockIndex];
                    if (!view)
                        continue;
                    if (view !== currentView) {
                        if (currentView)
                            currentView._modify();
                        currentView = view;
                    }
                    let data = view._getData();
                    let localVertex = vertexIndex - blockIndex * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
                    data[localVertex * Laya.GraphicsDefines.stride + 10] = alpha;
                }
            }
            if (currentView)
                currentView._modify();
            return true;
        }
        _updateMeshAlphaOnly(renderIndex, op, wordOffset, ownerAlpha) {
            let views = this._renderUnits[renderIndex].vertexViews;
            if (!views)
                return true;
            let vertexCount = op._int32[wordOffset + 13];
            let alpha = op._float32[wordOffset + 3] * ownerAlpha;
            let currentView = null;
            for (let i = 0; i < vertexCount; i++) {
                let blockIndex = Math.floor(i / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
                let view = views[blockIndex];
                if (!view)
                    continue;
                if (view !== currentView) {
                    if (currentView)
                        currentView._modify();
                    currentView = view;
                }
                let data = view._getData();
                let localVertex = i - blockIndex * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
                data[localVertex * Laya.GraphicsDefines.stride + 10] = alpha;
            }
            if (currentView)
                currentView._modify();
            return true;
        }
        _syncOpTransformOnly(op, renderIndex, ref, mat, ownerAlpha, writeAlpha) {
            if (!op || renderIndex < 0)
                return true;
            if (op.dirtyFlags !== 0)
                return false;
            let wordOffset = 16;
            switch (op.opProfile) {
                case 1:
                case 2: {
                    let textureOp = op;
                    if (textureOp.recordCount <= 0)
                        return true;
                    if (mat
                        ? this._updateQuadTransformOnly(renderIndex, textureOp._float32, textureOp._int32, wordOffset, ownerAlpha, mat, writeAlpha)
                        : this._updateQuadTransformValuesOnly(renderIndex, textureOp._float32, textureOp._int32, wordOffset, ownerAlpha, 1, 0, 0, 1, 0, 0, writeAlpha))
                        return true;
                    this._writeQuadVertexData(renderIndex, textureOp._float32, textureOp._int32, wordOffset, mat, textureOp._texture != null, ownerAlpha);
                    return true;
                }
                case 5: {
                    let fillOp = op;
                    if (fillOp.recordCount <= 0)
                        return true;
                    return mat
                        ? this._updateQuadTransformOnly(renderIndex, fillOp._float32, fillOp._int32, wordOffset, ownerAlpha, mat, writeAlpha)
                        : this._updateQuadTransformValuesOnly(renderIndex, fillOp._float32, fillOp._int32, wordOffset, ownerAlpha, 1, 0, 0, 1, 0, 0, writeAlpha);
                }
                case 3:
                case 4: {
                    let solidOp = op;
                    if (solidOp.recordCount <= 0)
                        return true;
                    return mat
                        ? this._updateQuadTransformOnly(renderIndex, solidOp._float32, solidOp._int32, wordOffset, ownerAlpha, mat, writeAlpha)
                        : this._updateQuadTransformValuesOnly(renderIndex, solidOp._float32, solidOp._int32, wordOffset, ownerAlpha, 1, 0, 0, 1, 0, 0, writeAlpha);
                }
                case 8:
                    this._updateMeshTransformOnly(renderIndex, op, wordOffset, mat, ownerAlpha, writeAlpha);
                    return true;
                case 7: {
                    let textOp = op;
                    let start = ref ? ref.recordStart : 0;
                    let count = ref ? ref.recordCount : textOp.recordCount;
                    if (count <= 0)
                        return true;
                    this._updateMultiQuadTransformOnly(renderIndex, textOp, start, count, mat, ownerAlpha, writeAlpha);
                    return true;
                }
                case 6: {
                    let multiOp = op;
                    let start = ref ? ref.recordStart : 0;
                    let count = ref ? ref.recordCount : multiOp.recordCount;
                    if (count <= 0)
                        return true;
                    this._updateMultiQuadTransformOnly(renderIndex, multiOp, start, count, mat, ownerAlpha, writeAlpha);
                    return true;
                }
            }
            return true;
        }
        _updateMultiQuadTransformOnly(renderIndex, op, start, count, ownerMat, ownerAlpha, writeAlpha) {
            let view = null;
            let blockData = null;
            let vertexIndex = 0;
            let bodyOffset = 16;
            for (let i = start, n = start + count; i < n; i++) {
                if (vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE === 0) {
                    view = this._renderUnits[renderIndex].vertexViews[Math.floor(vertexIndex / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE)];
                    blockData = view._getData();
                }
                this._updateQuadTransformInto(blockData, vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE, op._float32, op._int32, bodyOffset + i * GraphicsQuadPayloadWordCount, ownerMat, ownerAlpha, writeAlpha);
                vertexIndex += 4;
                if (vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE === 0)
                    view._modify();
            }
            if (vertexIndex % Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE !== 0)
                view._modify();
        }
        _updateQuadTransformInto(data, vertexStart, float32, int32, wordOffset, ownerMat, ownerAlpha, writeAlpha) {
            let x = float32[wordOffset + 0];
            let y = float32[wordOffset + 1];
            let width = float32[wordOffset + 2];
            let height = float32[wordOffset + 3];
            let point = this._transformPayloadPoint(x, y, float32, int32, wordOffset, ownerMat);
            let offset = vertexStart * Laya.GraphicsDefines.stride;
            data[offset] = point[0];
            data[offset + 1] = point[1];
            point = this._transformPayloadPoint(x + width, y, float32, int32, wordOffset, ownerMat);
            offset += Laya.GraphicsDefines.stride;
            data[offset] = point[0];
            data[offset + 1] = point[1];
            point = this._transformPayloadPoint(x + width, y + height, float32, int32, wordOffset, ownerMat);
            offset += Laya.GraphicsDefines.stride;
            data[offset] = point[0];
            data[offset + 1] = point[1];
            point = this._transformPayloadPoint(x, y + height, float32, int32, wordOffset, ownerMat);
            offset += Laya.GraphicsDefines.stride;
            data[offset] = point[0];
            data[offset + 1] = point[1];
            if (writeAlpha) {
                let alpha = float32[wordOffset + 9] * ownerAlpha;
                offset = vertexStart * Laya.GraphicsDefines.stride + 10;
                data[offset] = alpha;
                data[offset + Laya.GraphicsDefines.stride] = alpha;
                data[offset + Laya.GraphicsDefines.stride * 2] = alpha;
                data[offset + Laya.GraphicsDefines.stride * 3] = alpha;
            }
        }
        _updateMeshTransformOnly(renderIndex, op, wordOffset, ownerMat, ownerAlpha, writeAlpha) {
            let float32 = op._float32;
            let int32 = op._int32;
            let vertexCount = int32[wordOffset + 13];
            let vertexDataOffset = wordOffset + int32[wordOffset + 17];
            let x = float32[wordOffset + 0];
            let y = float32[wordOffset + 1];
            let alpha = writeAlpha ? float32[wordOffset + 3] * ownerAlpha : 0;
            let modifiedView = null;
            for (let i = 0; i < vertexCount; i++) {
                let blockIndex = Math.floor(i / Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE);
                let localVertex = i - blockIndex * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
                let view = this._renderUnits[renderIndex].vertexViews[blockIndex];
                if (view !== modifiedView) {
                    modifiedView && modifiedView._modify();
                    modifiedView = view;
                }
                let data = view._getData();
                let vi = localVertex * Laya.GraphicsDefines.stride;
                let vertexOffset = vertexDataOffset + i * 2;
                let point = this._transformMeshPayloadPoint(x + float32[vertexOffset], y + float32[vertexOffset + 1], float32, int32, wordOffset, ownerMat);
                data[vi] = point[0];
                data[vi + 1] = point[1];
                if (writeAlpha)
                    data[vi + 10] = alpha;
            }
            modifiedView && modifiedView._modify();
        }
        _syncOpAlphaOnly(op, renderIndex, ref, ownerAlpha) {
            if (!op || renderIndex < 0)
                return true;
            if (op.dirtyFlags !== 0)
                return false;
            let wordOffset = 16;
            switch (op.opProfile) {
                case 1:
                case 2:
                case 5:
                case 3:
                case 4:
                    return this._updateQuadAlphaOnly(renderIndex, op._float32[wordOffset + 9] * ownerAlpha);
                case 8:
                    return this._updateMeshAlphaOnly(renderIndex, op, wordOffset, ownerAlpha);
                case 7: {
                    let textOp = op;
                    let start = ref ? ref.recordStart : 0;
                    let count = ref ? ref.recordCount : textOp.recordCount;
                    return this._updateMultiQuadAlphaOnly(renderIndex, textOp, start, count, ownerAlpha);
                }
                case 6: {
                    let multiOp = op;
                    let start = ref ? ref.recordStart : 0;
                    let count = ref ? ref.recordCount : multiOp.recordCount;
                    return this._updateMultiQuadAlphaOnly(renderIndex, multiOp, start, count, ownerAlpha);
                }
            }
            return true;
        }
        _syncTextureOrState(renderIndex, dirtyFlags, value, featureBits, blendMode, useCustomMaterial) {
            if ((dirtyFlags & 4) !== 0)
                this._syncTexture(renderIndex, value, featureBits, blendMode, useCustomMaterial);
            else
                this._syncTextureState(renderIndex, blendMode, useCustomMaterial);
        }
        _syncTexture(renderIndex, value, featureBits, blendMode, useCustomMaterial = false) {
            let element = this._renderElements[renderIndex];
            let unit = this._renderUnits[renderIndex];
            let shaderData = unit && unit.primitiveShaderData;
            if (!element || !shaderData)
                return;
            let texture = value;
            if (!texture)
                texture = Laya.Texture2D.whiteTexture;
            let renderState = Laya.GraphicsOpRenderStateHelper.syncShaderData(shaderData, value, blendMode, (featureBits & Laya.ShaderDefines2D.DEFINE_BIT_FILLTEXTURE) !== 0, useCustomMaterial, false, this._renderStateScratch);
            if ((renderState.typeKey & Laya.ShaderDefines2D.DEFINE_BIT_USE_TEX_ARRAY) !== 0)
                shaderData.setTexture(Laya.ShaderDefines2D.UNIFORM_SPRITETEXTURE_ARRAY, texture);
            else
                shaderData.setTexture(Laya.ShaderDefines2D.UNIFORM_SPRITETEXTURE, texture);
            Laya.BlendModeHandler.setShaderData(blendMode, shaderData);
            element.renderStateIsBySprite = this._materialState.useSpriteState && blendMode === this._owner.blendMode;
            element.textureKey = renderState.textureKey;
            element.typeKey = renderState.typeKey;
        }
        _syncTextureState(renderIndex, blendMode, useCustomMaterial) {
            let element = this._renderElements[renderIndex];
            let unit = this._renderUnits[renderIndex];
            let shaderData = unit && unit.primitiveShaderData;
            if (!element || !shaderData)
                return;
            let defineBits = element.typeKey & ~((1 << Laya.ShaderDefines2D.TYPE_KEY_DEFINE_SHIFT) - 1);
            element.typeKey = defineBits | blendMode | (useCustomMaterial ? Laya.ShaderDefines2D.TYPEKEY_CUSTOM_MATERIAL : 0);
            Laya.BlendModeHandler.setShaderData(blendMode, shaderData);
            element.renderStateIsBySprite = this._materialState.useSpriteState && blendMode === this._owner.blendMode;
        }
        _syncFillTextureRange(renderIndex, u0, v0, u1, v1) {
            let unit = this._renderUnits[renderIndex];
            let shaderData = unit && unit.primitiveShaderData;
            if (!shaderData)
                return;
            let range = unit.fillTextureRange;
            if (!range) {
                range = new Laya.Vector4();
                unit.fillTextureRange = range;
            }
            range.setValue(u0, v0, u1 - u0, v1 - v0);
            shaderData.setVector(Laya.ShaderDefines2D.UNIFORM_TEXRANGE, range);
        }
        _cacheSingleTextureQuadFastPath() {
            this._singleTextureQuadRenderIndex = -1;
            this._singleTextureQuadOp = null;
            this._singleTextureQuadVertexView = null;
            if (this._ops.length !== 1)
                return;
            let op = this._ops[0];
            if ((op.opProfile === 1 || op.opProfile === 2)
                && op.recordCount > 0) {
                this._singleTextureQuadRenderIndex = 0;
                this._singleTextureQuadOp = op;
                let wordOffset = 16;
                let unit = this._renderUnits[0];
                this._singleTextureQuadVertexView = unit && unit.vertexViews[0];
                let x0 = op._float32[wordOffset + 0];
                let y0 = op._float32[wordOffset + 1];
                let x1 = x0 + op._float32[wordOffset + 2];
                let y1 = y0 + op._float32[wordOffset + 3];
                if (op._int32[wordOffset + 18]) {
                    let a = op._float32[wordOffset + 12];
                    let b = op._float32[wordOffset + 13];
                    let c = op._float32[wordOffset + 14];
                    let d = op._float32[wordOffset + 15];
                    let tx = op._float32[wordOffset + 16];
                    let ty = op._float32[wordOffset + 17];
                    this._singleTextureQuadX0 = x0 * a + y0 * c + tx;
                    this._singleTextureQuadY0 = x0 * b + y0 * d + ty;
                    this._singleTextureQuadX1 = x1 * a + y0 * c + tx;
                    this._singleTextureQuadY1 = x1 * b + y0 * d + ty;
                    this._singleTextureQuadX2 = x1 * a + y1 * c + tx;
                    this._singleTextureQuadY2 = x1 * b + y1 * d + ty;
                    this._singleTextureQuadX3 = x0 * a + y1 * c + tx;
                    this._singleTextureQuadY3 = x0 * b + y1 * d + ty;
                }
                else {
                    this._singleTextureQuadX0 = x0;
                    this._singleTextureQuadY0 = y0;
                    this._singleTextureQuadX1 = x1;
                    this._singleTextureQuadY1 = y0;
                    this._singleTextureQuadX2 = x1;
                    this._singleTextureQuadY2 = y1;
                    this._singleTextureQuadX3 = x0;
                    this._singleTextureQuadY3 = y1;
                }
            }
        }
        _publishOwnerElements() {
            if (this._owner)
                this._owner.renderElements = this._renderElements;
        }
        _clearRenderOps() {
            for (let i = 0, n = this._renderUnits.length; i < n; i++) {
                let unit = this._renderUnits[i];
                if (unit)
                    WebGraphicsRenderUnitPool.recover(unit);
            }
            this._destroyUnusedSpareRenderUnits();
            this._renderElements.length = 0;
            this._opRefs.length = 0;
            this._renderUnits.length = 0;
            this._singleTextureQuadRenderIndex = -1;
            this._singleTextureQuadOp = null;
            this._singleTextureQuadVertexView = null;
            this._needsRematerialize = false;
        }
        _sameOpRefs(ops) {
            if (!ops || this._opRefs.length !== ops.length)
                return false;
            for (let i = 0, n = ops.length; i < n; i++) {
                if (this._opRefs[i] !== ops[i])
                    return false;
            }
            return true;
        }
        _syncRenderElementTransforms(mat = null, ownerAlpha = this._owner ? this._owner.globalAlpha : 1, writeAlpha = true) {
            let ownerMat = mat || (this._owner ? this._owner.renderMatrix : null);
            for (let renderIndex = 0, n = this._renderUnits.length; renderIndex < n; renderIndex++) {
                let ref = this._renderUnits[renderIndex];
                if (!this._syncOpTransformOnly(ref ? ref.op : null, renderIndex, ref, ownerMat, ownerAlpha, writeAlpha))
                    this.syncOp(ref ? ref.op : null, renderIndex, ownerMat, ownerAlpha);
            }
        }
        _syncRenderElementAlphaOnly(ownerAlpha = this._owner ? this._owner.globalAlpha : 1) {
            let ownerMat = null;
            for (let renderIndex = 0, n = this._renderUnits.length; renderIndex < n; renderIndex++) {
                let ref = this._renderUnits[renderIndex];
                if (!this._syncOpAlphaOnly(ref ? ref.op : null, renderIndex, ref, ownerAlpha)) {
                    if (!ownerMat)
                        ownerMat = this._owner ? this._owner.renderMatrix : null;
                    this.syncOp(ref ? ref.op : null, renderIndex, ownerMat, ownerAlpha);
                }
            }
        }
    }

    class WebSingleQuadPrimitiveData {
        constructor(payloadBuffer) {
            this._owner = null;
            this._handleControlFloat32 = null;
            this._unit = null;
            this._elements = [];
            this._texture = null;
            this._boundTexture = null;
            this._boundInternalTexture = null;
            this._boundKind = 0;
            this._boundBlendMode = -1;
            this._boundCustomMaterial = false;
            this._hasBoundTextureState = false;
            this._subShader = null;
            this._materialShaderData = null;
            this._useSpriteState = true;
            this._active = false;
            this._geometryVisible = false;
            this._renderStateScratch = { stateKey: 0, typeKey: 0, textureKey: 0, texture: null };
            this._localX0 = 0;
            this._localY0 = 0;
            this._localX1 = 0;
            this._localY1 = 0;
            this._localX2 = 0;
            this._localY2 = 0;
            this._localX3 = 0;
            this._localY3 = 0;
            this._int32 = new Int32Array(payloadBuffer);
            this._float32 = new Float32Array(payloadBuffer);
        }
        setOwner(owner) {
            if (owner)
                this._owner = owner;
        }
        setHandleControlBuffer(buffer) {
            this._handleControlFloat32 = buffer ? new Float32Array(buffer) : null;
        }
        setMaterialState(subShader, shaderData, useSpriteState) {
            this._subShader = subShader || null;
            this._materialShaderData = shaderData || null;
            this._useSpriteState = useSpriteState;
            let unit = this._unit;
            if (!unit)
                return;
            unit.element.subShader = this._subShader;
            unit.element.materialShaderData = this._materialShaderData;
            if (this._active && this._hasBoundTextureState)
                this._syncRenderStateOnly();
        }
        sync(texture) {
            let kind = this._int32[0];
            if (!this._owner || (kind !== 1
                && kind !== 2
                && kind !== 3))
                return false;
            this._texture = texture || null;
            if (!this._texture && kind !== 3) {
                this._active = true;
                this._geometryVisible = false;
                this._hasBoundTextureState = false;
                this._elements.length = 0;
                this._owner.renderElements = this._elements;
                return true;
            }
            if (!this._ensureUnit())
                return false;
            let internalTexture = this._texture ? this._texture._texture : null;
            if (!this._hasBoundTextureState || this._boundTexture !== this._texture
                || this._boundInternalTexture !== internalTexture || this._boundKind !== kind)
                this._syncTextureState();
            else
                this._syncRenderStateOnly();
            if (kind === 2)
                this._syncFillTextureRange();
            this._active = true;
            this._publishGeometry(this._writeVertices(this._owner.renderMatrix, this._owner.globalAlpha));
            return true;
        }
        refreshInputGeometry() {
            if (!this._active || !this._unit)
                return;
            this._publishGeometry(this._writeVertices(this._owner.renderMatrix, this._owner.globalAlpha));
        }
        deactivate() {
            this._active = false;
            this._geometryVisible = false;
            this._texture = null;
            this._releaseUnit();
        }
        updateTransform(matrix, globalAlpha, writeAlpha = true) {
            if (!this._active || !this._unit || !this._geometryVisible)
                return;
            let data = this._unit.vertexViews[0]._getData();
            let x0 = this._localX0, y0 = this._localY0;
            let x1 = this._localX1, y1 = this._localY1;
            let x2 = this._localX2, y2 = this._localY2;
            let x3 = this._localX3, y3 = this._localY3;
            if (matrix) {
                let a = matrix.a, b = matrix.b, c = matrix.c, d = matrix.d, tx = matrix.tx, ty = matrix.ty;
                data[0] = x0 * a + y0 * c + tx;
                data[1] = x0 * b + y0 * d + ty;
                data[16] = x1 * a + y1 * c + tx;
                data[17] = x1 * b + y1 * d + ty;
                data[32] = x2 * a + y2 * c + tx;
                data[33] = x2 * b + y2 * d + ty;
                data[48] = x3 * a + y3 * c + tx;
                data[49] = x3 * b + y3 * d + ty;
            }
            else {
                data[0] = x0;
                data[1] = y0;
                data[16] = x1;
                data[17] = y1;
                data[32] = x2;
                data[33] = y2;
                data[48] = x3;
                data[49] = y3;
            }
            if (writeAlpha) {
                let alpha = this._float32[5] * globalAlpha;
                data[10] = alpha;
                data[26] = alpha;
                data[42] = alpha;
                data[58] = alpha;
            }
            this._unit.vertexViews[0]._modify();
        }
        updateGlobalAlpha(globalAlpha) {
            if (!this._active || !this._unit || !this._geometryVisible)
                return;
            let data = this._unit.vertexViews[0]._getData();
            let alpha = this._float32[5] * globalAlpha;
            for (let i = 0; i < 4; i++)
                data[i * Laya.GraphicsDefines.stride + 10] = alpha;
            this._unit.vertexViews[0]._modify();
        }
        destroy() {
            this._releaseUnit();
            this._texture = null;
            this._boundTexture = null;
            this._boundInternalTexture = null;
            this._hasBoundTextureState = false;
            this._subShader = null;
            this._materialShaderData = null;
            this._owner = null;
            this._active = false;
            this._geometryVisible = false;
        }
        _ensureUnit() {
            if (this._unit)
                return true;
            let unit = WebGraphicsRenderUnitPool.take(4, 6, this._owner, this._subShader, this._materialShaderData);
            if (!unit) {
                unit = WebGraphicsRenderUnit.create(4, 6, this._owner, this._subShader, this._materialShaderData);
                if (!unit)
                    return false;
            }
            let indices = unit.sourceIndexView._getData();
            let vertexBase = unit.vertexBlocks[0] * Laya.GRAPHICS_INFO_VERTEX_BLOCK_SIZE;
            for (let i = 0; i < 6; i++)
                indices[i] = vertexBase + Laya.GRAPHICS_INFO_DEFAULT_QUAD_INDICES[i];
            unit.sourceIndexView._modify();
            this._unit = unit;
            this._elements[0] = unit.element;
            return true;
        }
        _releaseUnit() {
            if (this._unit)
                WebGraphicsRenderUnitPool.recover(this._unit);
            this._unit = null;
            this._elements.length = 0;
            this._boundTexture = null;
            this._boundInternalTexture = null;
            this._boundKind = 0;
            this._boundBlendMode = -1;
            this._boundCustomMaterial = false;
            this._hasBoundTextureState = false;
        }
        _syncTextureState() {
            let unit = this._unit;
            if (!unit)
                return;
            let shaderData = unit.primitiveShaderData;
            let texture = this._texture || Laya.Texture2D.whiteTexture;
            let blendMode = this._int32[3];
            let fillTexture = this._int32[0] === 2;
            let state = Laya.GraphicsOpRenderStateHelper.syncShaderData(shaderData, this._texture, blendMode, fillTexture, this._materialShaderData != null, false, this._renderStateScratch);
            if ((state.typeKey & Laya.ShaderDefines2D.DEFINE_BIT_USE_TEX_ARRAY) !== 0)
                shaderData.setTexture(Laya.ShaderDefines2D.UNIFORM_SPRITETEXTURE_ARRAY, texture);
            else
                shaderData.setTexture(Laya.ShaderDefines2D.UNIFORM_SPRITETEXTURE, texture);
            Laya.BlendModeHandler.setShaderData(blendMode, shaderData);
            unit.element.renderStateIsBySprite = this._useSpriteState && blendMode === this._owner.blendMode;
            unit.element.textureKey = state.textureKey;
            unit.element.typeKey = state.typeKey;
            this._boundTexture = this._texture;
            this._boundInternalTexture = this._texture ? this._texture._texture : null;
            this._boundKind = this._int32[0];
            this._boundBlendMode = blendMode;
            this._boundCustomMaterial = this._materialShaderData != null;
            this._hasBoundTextureState = true;
        }
        _syncRenderStateOnly() {
            let unit = this._unit;
            if (!unit)
                return;
            let blendMode = this._int32[3];
            let customMaterial = this._materialShaderData != null;
            if (blendMode !== this._boundBlendMode || customMaterial !== this._boundCustomMaterial) {
                let defineBits = unit.element.typeKey & ~((1 << Laya.ShaderDefines2D.TYPE_KEY_DEFINE_SHIFT) - 1);
                unit.element.typeKey = defineBits | blendMode | (customMaterial ? Laya.ShaderDefines2D.TYPEKEY_CUSTOM_MATERIAL : 0);
                Laya.BlendModeHandler.setShaderData(blendMode, unit.primitiveShaderData);
                this._boundBlendMode = blendMode;
                this._boundCustomMaterial = customMaterial;
            }
            unit.element.renderStateIsBySprite = this._useSpriteState && blendMode === this._owner.blendMode;
        }
        _syncFillTextureRange() {
            let unit = this._unit;
            if (!unit)
                return;
            let range = unit.fillTextureRange;
            if (!range) {
                range = new Laya.Vector4();
                unit.fillTextureRange = range;
            }
            range.setValue(this._float32[28], this._float32[29], this._float32[30], this._float32[31]);
            unit.primitiveShaderData.setVector(Laya.ShaderDefines2D.UNIFORM_TEXRANGE, range);
        }
        _writeVertices(ownerMatrix, globalAlpha) {
            let f32 = this._float32;
            let i32 = this._int32;
            let x = f32[6];
            let y = f32[7];
            let width = f32[8];
            let height = f32[9];
            let flags = i32[1];
            if ((flags & 1) !== 0) {
                let ownerWidth = this._handleControlFloat32
                    ? this._handleControlFloat32[5]
                    : this._owner.owner.width;
                let ownerHeight = this._handleControlFloat32
                    ? this._handleControlFloat32[6]
                    : this._owner.owner.height;
                x *= ownerWidth;
                y *= ownerHeight;
                width *= ownerWidth;
                height *= ownerHeight;
            }
            let kind = i32[0];
            let u0 = f32[10];
            let v0 = f32[11];
            let u1 = f32[12];
            let v1 = f32[13];
            let u2 = f32[14];
            let v2 = f32[15];
            let u3 = f32[16];
            let v3 = f32[17];
            if (kind === 1) {
                x += width * f32[24];
                y += height * f32[25];
                width *= f32[26];
                height *= f32[27];
            }
            else if (kind === 2) {
                let offsetX = f32[24];
                let offsetY = f32[25];
                let textureWidth = f32[26] || 1;
                let textureHeight = f32[27] || 1;
                let repeatX = (flags & 4) !== 0;
                let repeatY = (flags & 8) !== 0;
                let startX = offsetX < 0 ? x : x + offsetX;
                let startY = offsetY < 0 ? y : y + offsetY;
                let endX = x + width;
                let endY = y + height;
                if (!repeatX)
                    endX = Math.min(endX, x + offsetX + textureWidth);
                if (!repeatY)
                    endY = Math.min(endY, y + offsetY + textureHeight);
                if (endX < x || endY < y || startX > endX || startY > endY)
                    return false;
                u0 = offsetX < 0 ? (-offsetX % textureWidth) / textureWidth : 0;
                v0 = offsetY < 0 ? (-offsetY % textureHeight) / textureHeight : 0;
                u2 = u1 = (endX - x - offsetX) / textureWidth;
                v2 = v3 = (endY - y - offsetY) / textureHeight;
                u3 = u0;
                v1 = v0;
                f32[10] = u0;
                f32[11] = v0;
                f32[12] = u1;
                f32[13] = v1;
                f32[14] = u2;
                f32[15] = v2;
                f32[16] = u3;
                f32[17] = v3;
                x = startX;
                y = startY;
                width = endX - startX;
                height = endY - startY;
            }
            else if (kind === 3 && (width <= 0 || height <= 0)) {
                return false;
            }
            let color = i32[2] >>> 0;
            let r = (color & 0xff) / 255;
            let g = ((color >>> 8) & 0xff) / 255;
            let b = ((color >>> 16) & 0xff) / 255;
            let a = (color >>> 24) / 255;
            let alpha = f32[5] * globalAlpha;
            let hasMatrix = (flags & 2) !== 0;
            let data = this._unit.vertexViews[0]._getData();
            data.fill(0);
            this._writeVertex(data, 0, x, y, u0, v0, r, g, b, a, alpha, hasMatrix, ownerMatrix);
            this._writeVertex(data, 1, x + width, y, u1, v1, r, g, b, a, alpha, hasMatrix, ownerMatrix);
            this._writeVertex(data, 2, x + width, y + height, u2, v2, r, g, b, a, alpha, hasMatrix, ownerMatrix);
            this._writeVertex(data, 3, x, y + height, u3, v3, r, g, b, a, alpha, hasMatrix, ownerMatrix);
            this._unit.vertexViews[0]._modify();
            return true;
        }
        _publishGeometry(visible) {
            this._geometryVisible = visible;
            if (visible) {
                this._elements[0] = this._unit.element;
                this._elements.length = 1;
            }
            else {
                this._elements.length = 0;
            }
            this._owner.renderElements = this._elements;
        }
        _writeVertex(data, vertexIndex, x, y, u, v, r, g, b, a, alpha, hasLocalMatrix, ownerMatrix) {
            let f32 = this._float32;
            if (hasLocalMatrix) {
                let px = x;
                let py = y;
                x = px * f32[18] + py * f32[20] + f32[22];
                y = px * f32[19] + py * f32[21] + f32[23];
            }
            switch (vertexIndex) {
                case 0:
                    this._localX0 = x;
                    this._localY0 = y;
                    break;
                case 1:
                    this._localX1 = x;
                    this._localY1 = y;
                    break;
                case 2:
                    this._localX2 = x;
                    this._localY2 = y;
                    break;
                default:
                    this._localX3 = x;
                    this._localY3 = y;
                    break;
            }
            if (ownerMatrix) {
                let px = x;
                let py = y;
                x = px * ownerMatrix.a + py * ownerMatrix.c + ownerMatrix.tx;
                y = px * ownerMatrix.b + py * ownerMatrix.d + ownerMatrix.ty;
            }
            let offset = vertexIndex * Laya.GraphicsDefines.stride;
            data[offset] = x;
            data[offset + 1] = y;
            data[offset + 2] = u;
            data[offset + 3] = v;
            data[offset + 4] = r;
            data[offset + 5] = g;
            data[offset + 6] = b;
            data[offset + 7] = a;
            data[offset + 8] = this._texture ? Laya.GRAPHICS_INFO_VERTEX_FLAG_ENABLED : Laya.GRAPHICS_INFO_VERTEX_FLAG_DISABLED;
            if (this._int32[0] === 2) {
                data[offset + 9] = Laya.GRAPHICS_INFO_VERTEX_FLAG_ENABLED;
                data[offset + 12] = f32[18];
                data[offset + 13] = f32[19];
                data[offset + 14] = f32[20];
                data[offset + 15] = f32[21];
            }
            data[offset + 10] = alpha;
            data[offset + 11] = this._int32[4];
        }
    }

    const SINGLE_QUAD_DIRTY_MASK = 1 | 2
        | 4 | 8;
    class WebRender2DDataHandle {
        get owner() {
            return this._owner;
        }
        set owner(value) {
            this._owner = value;
        }
        constructor() {
            this._nMatrix_0 = new Laya.Vector3();
            this._nMatrix_1 = new Laya.Vector3();
            this._matUploadFrame = -1;
            this._needUseMatrix = true;
        }
        get needUseMatrix() {
            return this._needUseMatrix;
        }
        set needUseMatrix(value) {
            var _a;
            this._needUseMatrix = value;
            this._matUploadFrame = -1;
            if (!value && ((_a = this._owner) === null || _a === void 0 ? void 0 : _a.spriteShaderData)) {
                this._nMatrix_0.set(1, 0, 0);
                this._nMatrix_1.set(0, 1, 0);
                this._owner.spriteShaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_0, this._nMatrix_0);
                this._owner.spriteShaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_1, this._nMatrix_1);
            }
        }
        destroy() {
        }
        inheriteRenderData(context) {
            let data = this._owner.spriteShaderData;
            if (!data)
                return;
            if (this._needUseMatrix) {
                let matrixVersion = this._owner.getRenderMatrixVersion();
                if (matrixVersion >= 0 && this._matUploadFrame === matrixVersion)
                    return;
                this._matUploadFrame = matrixVersion;
                let mat = this._owner.renderMatrix;
                this._nMatrix_0.setValue(mat.a, mat.c, mat.tx);
                this._nMatrix_1.setValue(mat.b, mat.d, mat.ty);
                this._owner.spriteShaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_0, this._nMatrix_0);
                this._owner.spriteShaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_1, this._nMatrix_1);
            }
        }
    }
    class WebEmptyRender2DDataHandle extends WebRender2DDataHandle {
        inheriteRenderData(_context) {
        }
        destroy() {
        }
    }
    class WebSubStructRenderDataHandle extends WebRender2DDataHandle {
        constructor() {
            super(...arguments);
            this._logicMatrix = null;
            this.mask = null;
        }
        get logicMatrix() {
            return this._logicMatrix;
        }
        set logicMatrix(value) {
            this._logicMatrix = value;
            this._matUploadFrame = -1;
        }
        inheriteRenderData(context) {
            let data = this._owner.spriteShaderData;
            if (!data || !this.needUseMatrix)
                return;
            let matrixVersion = this._owner.getRenderMatrixVersion();
            if (matrixVersion >= 0 && this._matUploadFrame === matrixVersion)
                return;
            this._matUploadFrame = matrixVersion;
            let mat = this._owner.renderMatrix;
            if (this._logicMatrix) {
                let temp = Laya.Matrix.TEMP;
                Laya.Matrix.mul(this._logicMatrix, mat.copyTo(temp), temp);
                this._nMatrix_0.setValue(temp.a, temp.c, temp.tx);
                this._nMatrix_1.setValue(temp.b, temp.d, temp.ty);
            }
            else {
                this._nMatrix_0.setValue(mat.a, mat.c, mat.tx);
                this._nMatrix_1.setValue(mat.b, mat.d, mat.ty);
            }
            data.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_0, this._nMatrix_0);
            data.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_1, this._nMatrix_1);
        }
    }
    class WebGraphicsSingleQuadDataHandle extends WebRender2DDataHandle {
        constructor() {
            super(...arguments);
            this._singleQuadData = null;
            this._singleQuadActive = false;
            this._graphicsHandleUpdateBuffer = null;
            this._graphicsHandleUpdateInt32 = null;
            this._singleQuadPayloadBuffer = null;
            this._handledSingleQuadVersion = -1;
            this._modifiedFrame = -1;
            this._globalAlpha = 1;
            this._globalAlphaValid = false;
            this._graphicsMaterialState = { subShader: null, shaderData: null, useSpriteState: true };
        }
        set owner(value) {
            if (this._owner === value)
                return;
            if (!value) {
                this._singleQuadData.deactivate();
                this._singleQuadActive = false;
                this._handledSingleQuadVersion = -1;
                return;
            }
            super.owner = value;
            this._singleQuadData.setOwner(value);
            this._globalAlphaValid = false;
            this._modifiedFrame = -1;
            this._handledSingleQuadVersion = -1;
        }
        get owner() {
            return super.owner;
        }
        setGraphicsHandleUpdateBuffer(buffer) {
            if (this._graphicsHandleUpdateBuffer === buffer)
                return;
            this._graphicsHandleUpdateBuffer = buffer;
            this._graphicsHandleUpdateInt32 = new Int32Array(buffer);
            this._handledSingleQuadVersion = -1;
        }
        setGraphicsMaterialState(subShader, shaderData, useSpriteState) {
            subShader = subShader || null;
            shaderData = shaderData || null;
            this._graphicsMaterialState.subShader = subShader;
            this._graphicsMaterialState.shaderData = shaderData;
            this._graphicsMaterialState.useSpriteState = useSpriteState;
            this._singleQuadData.setMaterialState(subShader, shaderData, useSpriteState);
        }
        setSingleQuadPayloadBuffer(buffer) {
            if (this._singleQuadPayloadBuffer === buffer)
                return;
            if (this._singleQuadPayloadBuffer)
                throw new Error("SingleQuad payload buffer can only be bound once");
            this._singleQuadPayloadBuffer = buffer;
            this._singleQuadData = new WebSingleQuadPrimitiveData(buffer);
            this._singleQuadData.setHandleControlBuffer(this._graphicsHandleUpdateBuffer);
            this._singleQuadData.setMaterialState(this._graphicsMaterialState.subShader, this._graphicsMaterialState.shaderData, this._graphicsMaterialState.useSpriteState);
        }
        syncSingleQuad(texture) {
            if (!this._singleQuadData.sync(texture))
                return false;
            this._singleQuadActive = true;
            this.needUseMatrix = false;
            this._modifiedFrame = this._owner.getRenderMatrixVersion();
            this._globalAlpha = this._owner.globalAlpha;
            this._globalAlphaValid = true;
            this._handledSingleQuadVersion = this._graphicsHandleUpdateInt32[7];
            this._graphicsHandleUpdateInt32[2] &= ~SINGLE_QUAD_DIRTY_MASK;
            return true;
        }
        deactivateSingleQuad() {
            this._singleQuadData.deactivate();
            this._singleQuadActive = false;
        }
        inheriteRenderData(context) {
            let matrixVersion = this._owner.getRenderMatrixVersion();
            let globalAlpha = this._owner.globalAlpha;
            let singleQuadVersion = this._graphicsHandleUpdateInt32[7];
            if (this._singleQuadActive && this._handledSingleQuadVersion !== singleQuadVersion) {
                let inputFlags = this._graphicsHandleUpdateInt32[2];
                if (inputFlags === 0
                    || (inputFlags & (1 | 2)) !== 0)
                    this._singleQuadData.refreshInputGeometry();
                this._handledSingleQuadVersion = singleQuadVersion;
                this._graphicsHandleUpdateInt32[2] &= ~SINGLE_QUAD_DIRTY_MASK;
                this._modifiedFrame = matrixVersion;
                this._globalAlpha = globalAlpha;
                this._globalAlphaValid = true;
            }
            let alphaChanged = !this._globalAlphaValid || this._globalAlpha != globalAlpha;
            if (this._modifiedFrame !== matrixVersion) {
                if (this._singleQuadActive)
                    this._singleQuadData.updateTransform(this._owner.renderMatrix, globalAlpha, alphaChanged);
                this._globalAlpha = globalAlpha;
                this._globalAlphaValid = true;
                this._modifiedFrame = matrixVersion;
            }
            else if (alphaChanged) {
                this._globalAlpha = globalAlpha;
                this._globalAlphaValid = true;
                if (this._singleQuadActive)
                    this._singleQuadData.updateGlobalAlpha(this._globalAlpha);
            }
        }
        destroy() {
            this._singleQuadData.destroy();
            this._singleQuadData = null;
            this._singleQuadPayloadBuffer = null;
            this._singleQuadActive = false;
            this._graphicsHandleUpdateBuffer = null;
            this._graphicsHandleUpdateInt32 = null;
            this._handledSingleQuadVersion = -1;
            this._graphicsMaterialState.subShader = null;
            this._graphicsMaterialState.shaderData = null;
            super.owner = null;
            super.destroy();
        }
    }
    class WebGraphicsCommandStreamDataHandle extends WebRender2DDataHandle {
        constructor() {
            super(...arguments);
            this.autoGraphicsDirtySync = false;
            this._opRuntime = null;
            this._graphicsOpsActive = false;
            this._graphicsHandleUpdateBuffer = null;
            this._modifiedFrame = -1;
            this._globalAlpha = 1;
            this._globalAlphaValid = false;
            this._graphicsMaterialState = { subShader: null, shaderData: null, useSpriteState: true };
        }
        set owner(value) {
            if (this._owner === value)
                return;
            if (!value) {
                this._setGraphicsOpsActive(false);
                return;
            }
            super.owner = value;
            this._opRuntime = new WebGraphicsOp2DRuntime(value, this._graphicsMaterialState);
            this._opRuntime.setGraphicsHandleUpdateBuffer(this._graphicsHandleUpdateBuffer);
            this._graphicsOpsActive = false;
            this._globalAlphaValid = false;
            this._modifiedFrame = -1;
        }
        get owner() {
            return super.owner;
        }
        _setGraphicsOpsActive(value) {
            if (value)
                this._opRuntime.activate();
            else
                this._opRuntime.deactivate();
            if (this._graphicsOpsActive === value)
                return;
            this._graphicsOpsActive = value;
            this.needUseMatrix = !value;
            this._modifiedFrame = -1;
        }
        setGraphicsHandleUpdateBuffer(buffer) {
            if (this._graphicsHandleUpdateBuffer === buffer)
                return;
            this._graphicsHandleUpdateBuffer = buffer;
        }
        setGraphicsMaterialState(subShader, shaderData, useSpriteState) {
            subShader = subShader || null;
            shaderData = shaderData || null;
            let subShaderChanged = this._graphicsMaterialState.subShader !== subShader;
            let shaderDataChanged = this._graphicsMaterialState.shaderData !== shaderData;
            let useSpriteStateChanged = this._graphicsMaterialState.useSpriteState !== useSpriteState;
            this._graphicsMaterialState.subShader = subShader;
            this._graphicsMaterialState.shaderData = shaderData;
            this._graphicsMaterialState.useSpriteState = useSpriteState;
            if (subShaderChanged)
                this._opRuntime.syncGraphicsSubShader();
            if (shaderDataChanged)
                this._opRuntime.syncGraphicsShaderData();
            if (useSpriteStateChanged)
                this._opRuntime.syncGraphicsUseSpriteState();
        }
        syncGraphicsOps(ops) {
            this._owner.renderMatrix;
            if (ops.length === 0) {
                this._opRuntime.syncGraphicsOps(WebGraphicsCommandStreamDataHandle._emptyGraphicsOps);
                this._setGraphicsOpsActive(false);
                return;
            }
            this._opRuntime.syncGraphicsOps(ops);
            this._globalAlphaValid = false;
            this._setGraphicsOpsActive(true);
        }
        deactivateGraphicsOps() {
            this._setGraphicsOpsActive(false);
        }
        getGraphicsBatchEntry(index) {
            return this._opRuntime.getGraphicsBatchEntry(index);
        }
        inheriteRenderData(context) {
            let matrixVersion = this._owner.getRenderMatrixVersion();
            let globalAlpha = this._owner.globalAlpha;
            let alphaChanged = !this._globalAlphaValid || this._globalAlpha != globalAlpha;
            if (this._modifiedFrame !== matrixVersion) {
                if (this._graphicsOpsActive)
                    this._opRuntime.updateTransform(this._owner.renderMatrix, globalAlpha, alphaChanged);
                this._globalAlpha = globalAlpha;
                this._globalAlphaValid = true;
                this._modifiedFrame = matrixVersion;
            }
            else if (alphaChanged) {
                this._globalAlpha = globalAlpha;
                this._globalAlphaValid = true;
                if (this._graphicsOpsActive)
                    this._opRuntime.updateGlobalAlpha(globalAlpha);
            }
        }
        destroy() {
            this._opRuntime.destroy();
            this._graphicsOpsActive = false;
            this._graphicsMaterialState.subShader = null;
            this._graphicsMaterialState.shaderData = null;
            super.owner = null;
            super.destroy();
        }
    }
    WebGraphicsCommandStreamDataHandle._emptyGraphicsOps = [];
    class Web2DBaseRenderDataHandle extends WebRender2DDataHandle {
        constructor() {
            super(...arguments);
            this._lightReceive = false;
        }
        get lightReceive() {
            return this._lightReceive;
        }
        set lightReceive(value) {
            this._lightReceive = value;
            if (value) {
                this._owner.spriteShaderData.addDefine(Laya.BaseRenderNode2D.SHADERDEFINE_LIGHT2D_ENABLE);
            }
            else {
                this._owner.spriteShaderData.removeDefine(Laya.BaseRenderNode2D.SHADERDEFINE_LIGHT2D_ENABLE);
            }
        }
        get owner() {
            return this._owner;
        }
        set owner(value) {
            if (value == this.owner)
                return;
            if (this._owner) {
                this._owner.spriteShaderData.removeDefine(Laya.BaseRenderNode2D.SHADERDEFINE_BASERENDER2D);
            }
            this._owner = value;
            if (this._owner) {
                this._owner.spriteShaderData.addDefine(Laya.BaseRenderNode2D.SHADERDEFINE_BASERENDER2D);
            }
        }
    }
    const _setRenderColor = new Laya.Color(1, 1, 1, 1);
    class WebMesh2DRenderDataHandle extends Web2DBaseRenderDataHandle {
        constructor() {
            super(...arguments);
            this._baseColor = new Laya.Color(1, 1, 1, 1);
            this._tilingOffset = new Laya.Vector4();
            this._renderAlpha = -1;
        }
        get baseColor() {
            return this._baseColor;
        }
        set baseColor(value) {
            if (value != this._baseColor && this._baseColor.equal(value))
                return;
            value = value ? value : Laya.Color.BLACK;
            value.cloneTo(this._baseColor);
            this._renderAlpha = -1;
            this._owner.spriteShaderData.setColor(Laya.BaseRenderNode2D.BASERENDER2DCOLOR, this._baseColor);
        }
        get baseTexture() {
            return this._baseTexture;
        }
        set baseTexture(value) {
            if (this._baseTexture != null && value == this._baseTexture)
                return;
            if (this._baseTexture)
                this._baseTexture._removeReference();
            this._baseTexture = value;
            value = value ? value : Laya.Texture2D.whiteTexture;
            this._owner.spriteShaderData.setTexture(Laya.BaseRenderNode2D.BASERENDER2DTEXTURE, value);
            if (value) {
                value._addReference();
                if (value.gammaCorrection != 1) {
                    this._owner.spriteShaderData.addDefine(Laya.ShaderDefines2D.GAMMATEXTURE);
                }
                else {
                    this._owner.spriteShaderData.removeDefine(Laya.ShaderDefines2D.GAMMATEXTURE);
                }
            }
        }
        get tilingOffset() {
            return this._tilingOffset;
        }
        set tilingOffset(value) {
            if (!value)
                return;
            this._owner.spriteShaderData.setVector(Laya.BaseRenderNode2D.TILINGOFFSET, value);
            value ? value.cloneTo(this._tilingOffset) : null;
        }
        get normal2DTexture() {
            return this._normal2DTexture;
        }
        set normal2DTexture(value) {
            if (value === this._normal2DTexture)
                return;
            if (this._normal2DTexture)
                this._normal2DTexture._removeReference(1);
            if (value)
                value._addReference();
            this._normal2DTexture = value;
            this._owner.spriteShaderData.setTexture(Laya.BaseRenderNode2D.NORMAL2DTEXTURE, value);
            if (this._normal2DStrength > 0 && this._normal2DTexture)
                this._owner.spriteShaderData.addDefine(Laya.BaseRenderNode2D.SHADERDEFINE_LIGHT2D_NORMAL_PARAM);
            else
                this._owner.spriteShaderData.removeDefine(Laya.BaseRenderNode2D.SHADERDEFINE_LIGHT2D_NORMAL_PARAM);
        }
        get normal2DStrength() {
            return this._normal2DStrength;
        }
        set normal2DStrength(value) {
            value = Math.max(0, Math.min(1, value));
            if (this._normal2DStrength === value)
                return;
            this._normal2DStrength = value;
            this._owner.spriteShaderData.setNumber(Laya.BaseRenderNode2D.NORMAL2DSTRENGTH, value);
            if (value > 0 && this._normal2DTexture)
                this._owner.spriteShaderData.addDefine(Laya.BaseRenderNode2D.SHADERDEFINE_LIGHT2D_NORMAL_PARAM);
            else
                this._owner.spriteShaderData.removeDefine(Laya.BaseRenderNode2D.SHADERDEFINE_LIGHT2D_NORMAL_PARAM);
        }
        inheriteRenderData(context) {
            super.inheriteRenderData(context);
            if (this._renderAlpha != this._owner.globalAlpha) {
                let a = this._owner.globalAlpha * this._baseColor.a;
                _setRenderColor.setValue(this._baseColor.r, this._baseColor.g, this._baseColor.b, a);
                this._owner.spriteShaderData.setColor(Laya.BaseRenderNode2D.BASERENDER2DCOLOR, _setRenderColor);
                this._renderAlpha = this._owner.globalAlpha;
            }
        }
    }

    const _wm6 = new Float32Array(6);
    let _clipUpdateFrame = 1;
    let _clipRectUpdateFrame = 1;
    const _DefaultClipInfo = {
        clipMatrix: new Laya.Matrix(),
        clipMatDir: new Laya.Vector4(Laya.Const.MAX_CLIP_SIZE, 0, 0, Laya.Const.MAX_CLIP_SIZE),
        clipMatPos: new Laya.Vector4(0, 0, 0, 0),
        _updateFrame: 0,
        clipDepth: 0,
        clipParent: null
    };
    class WebGlobalRenderData {
    }
    var ChildrenUpdateType;
    (function (ChildrenUpdateType) {
        ChildrenUpdateType[ChildrenUpdateType["All"] = -1] = "All";
        ChildrenUpdateType[ChildrenUpdateType["None"] = 0] = "None";
        ChildrenUpdateType[ChildrenUpdateType["Clip"] = 1] = "Clip";
        ChildrenUpdateType[ChildrenUpdateType["Blend"] = 2] = "Blend";
        ChildrenUpdateType[ChildrenUpdateType["Alpha"] = 4] = "Alpha";
        ChildrenUpdateType[ChildrenUpdateType["Pass"] = 8] = "Pass";
        ChildrenUpdateType[ChildrenUpdateType["Global"] = 16] = "Global";
        ChildrenUpdateType[ChildrenUpdateType["Culling"] = 32] = "Culling";
        ChildrenUpdateType[ChildrenUpdateType["DcOptimize"] = 64] = "DcOptimize";
    })(ChildrenUpdateType || (ChildrenUpdateType = {}));
    const _DefaultParentData = {
        clipInfo: _DefaultClipInfo,
        blendMode: Laya.BlendMode.invalid,
        globalRenderData: null,
        pass: null,
        enableCulling: false,
        dcOptimize: false,
    };
    class WebRenderStruct2D {
        get enableCulling() {
            return this._enableCulling;
        }
        set enableCulling(value) {
            this._enableCulling = value;
            this.updateChildren(ChildrenUpdateType.Culling);
        }
        get inheritedEnableCulling() {
            return this._enableCulling || this._parentData.enableCulling;
        }
        get dcOptimize() {
            return this._dcOptimize;
        }
        set dcOptimize(value) {
            this._dcOptimize = value;
            this.updateChildren(ChildrenUpdateType.DcOptimize);
        }
        get inheritedDcOptimize() {
            return this._dcOptimize || this._parentData.dcOptimize;
        }
        getRenderMatrixVersion() {
            return Laya.Transform2DStore.instance.getMatrixFrame(this.transSlot);
        }
        get renderMatrix() {
            if (this.transSlot >= 0) {
                const store = Laya.Transform2DStore.instance;
                if (store.dirtyM) {
                    store.computeWorldMatrix(this.transSlot, _wm6);
                    this._rmFrame = -1;
                }
                else {
                    const matFrame = store.getMatrixFrame(this.transSlot);
                    if (this._rmFrame === matFrame)
                        return this._renderMatrix;
                    this._rmFrame = matFrame;
                    store.readWorldMatrix(this.transSlot, _wm6);
                }
                const m = this._renderMatrix;
                m.a = _wm6[0];
                m.b = _wm6[1];
                m.c = _wm6[2];
                m.d = _wm6[3];
                m.tx = _wm6[4];
                m.ty = _wm6[5];
                m._checkTransform();
            }
            return this._renderMatrix;
        }
        set renderMatrix(value) {
            if (this.transSlot < 0) {
                value.copyTo(this._renderMatrix);
                this._rmFrame = -1;
            }
        }
        get globalAlpha() {
            const slot = this.transSlot;
            if (slot < 0)
                return 1;
            const store = Laya.Transform2DStore.instance;
            let base = this._alphaBaseSlot;
            if (this._blendMode === Laya.BlendMode.mask && this.owner && this.owner._maskParent) {
                base = store.getParent(slot);
            }
            if (base < 0)
                return store.dirtyA ? store.computeWorldAlpha(slot) : store.getWorldAlpha(slot);
            return store.getRelativeWorldAlpha(slot, base, store.dirtyA);
        }
        get alpha() {
            return this.transSlot < 0 ? 1 : Laya.Transform2DStore.instance.readAlpha(this.transSlot);
        }
        set alpha(value) {
            if (this.transSlot >= 0)
                Laya.Transform2DStore.instance.writeAlpha(this.transSlot, value);
        }
        get blendMode() {
            return this._blendMode || this._currentData.blendMode || Laya.BlendMode.normal;
        }
        set blendMode(value) {
            this._updateBlendMode(value);
            this._setBlendMode();
            this.updateChildren(ChildrenUpdateType.Blend);
        }
        get renderDataHandler() {
            return this._renderDataHandler;
        }
        set renderDataHandler(value) {
            if (this._renderDataHandler) {
                this._renderDataHandler.owner = null;
            }
            this._renderDataHandler = value;
            if (value)
                this._renderDataHandler.owner = this;
        }
        get globalRenderData() {
            return this._globalRenderData || this._currentData.globalRenderData;
        }
        set globalRenderData(value) {
            this._globalRenderData = value;
            this._updateGlobalShaderData();
            this.updateChildren(ChildrenUpdateType.Global);
        }
        _updateGlobalShaderData() {
            let renderData = this.globalRenderData;
            if (renderData) {
                this._globalShaderData = renderData.globalShaderData;
            }
            else {
                this._globalShaderData = null;
            }
            if (this._subStruct) {
                this._subStruct._updateGlobalShaderData();
            }
        }
        _updatePriority() {
            if (this._pass) {
                if (this._maskParentPass) {
                    this._pass.priority = this._maskParentPass.priority + 1;
                }
                else if (this._parentData.pass) {
                    this._pass.priority = this._parentData.pass.priority + 1;
                }
                else {
                    this._pass.priority = 0;
                }
            }
        }
        setMaskParentPass(pass) {
            this._maskParentPass = pass;
            this._updatePriority();
            if (this._pass) {
                this.updateChildren(ChildrenUpdateType.Pass);
            }
        }
        get pass() {
            return this._pass || this._currentData.pass;
        }
        set pass(value) {
            if (value !== this._pass) {
                this._pass = value;
                this._updatePriority();
                this.updateChildren(ChildrenUpdateType.Pass);
            }
        }
        get subStruct() {
            return this._subStruct;
        }
        set subStruct(value) {
            if (value != this._subStruct) {
                let updateFlag = 0;
                const prevContentBase = this._alphaBaseSlot;
                let restoreBase = -1;
                if (value) {
                    let parentData = this._parentData;
                    value._blendMode = this._blendMode;
                    value._currentData = parentData;
                    value._maskParentPass = this._maskParentPass;
                    if (!this._globalRenderData && parentData.globalRenderData) {
                        updateFlag |= ChildrenUpdateType.Global;
                    }
                    if (!this._clipInfo && parentData.clipInfo) {
                        updateFlag |= ChildrenUpdateType.Clip;
                    }
                    if (this._blendMode !== Laya.BlendMode.invalid || parentData.blendMode !== Laya.BlendMode.invalid) {
                        updateFlag |= ChildrenUpdateType.Blend;
                    }
                    this._blendMode = Laya.BlendMode.invalid;
                    this._currentData = _DefaultParentData;
                }
                else if (this._subStruct) {
                    let parentData = this._parentData;
                    restoreBase = this._subStruct._alphaBaseSlot;
                    this._subStruct._currentData = this._subStruct._parentData;
                    this._blendMode = this._subStruct._blendMode;
                    if (!this._clipInfo && parentData.clipInfo) {
                        updateFlag |= ChildrenUpdateType.Clip;
                    }
                    if (!this._globalRenderData && parentData.globalRenderData) {
                        updateFlag |= ChildrenUpdateType.Global;
                    }
                    if (this._blendMode !== Laya.BlendMode.invalid || parentData.blendMode !== Laya.BlendMode.invalid) {
                        updateFlag |= ChildrenUpdateType.Blend;
                    }
                    this._subStruct._blendMode = Laya.BlendMode.invalid;
                    this._subStruct._maskParentPass = null;
                    this._currentData = parentData;
                }
                this._subStruct = value;
                if (value) {
                    value._alphaBaseSlot = prevContentBase;
                    this._alphaBaseSlot = this.transSlot;
                    for (let i = 0, n = this.children.length; i < n; i++) {
                        this.children[i]._setAlphaBase(this.transSlot);
                    }
                }
                else {
                    this._setAlphaBase(restoreBase);
                }
                this._updateGlobalShaderData();
                this.updateChildren(updateFlag);
                this._setBlendMode();
            }
        }
        constructor() {
            this.forceShaderClip = false;
            this.manualRender = false;
            this._parentData = Object.assign({}, _DefaultParentData);
            this._currentData = this._parentData;
            this.zIndex = 0;
            this._effectZ = 0;
            this.stackingRoot = false;
            this.rect = new Laya.Rectangle();
            this._enableCulling = false;
            this.renderLayer = 1;
            this.children = [];
            this.renderType = -1;
            this.renderUpdateMask = 0;
            this.transSlot = -1;
            this._renderMatrix = new Laya.Matrix();
            this._rmFrame = -1;
            this._alphaBaseSlot = -1;
            this._lastUploadedAlpha = -1;
            this._blendMode = Laya.BlendMode.invalid;
            this._needUploadClipOffset = -1;
            this._clipOffset = new Laya.Vector2();
            this.enabled = true;
            this.isRenderStruct = false;
            this.renderElements = null;
            this.spriteShaderData = null;
            this._globalShaderData = null;
            this._globalRenderData = null;
            this._clipRect = null;
            this._clipInfo = null;
            this._clipMatFrame = -1;
            this._clipParentUpdateFrame = -2;
            this._clipRectUpdateFrame = 0;
            this._clipRectAppliedFrame = -1;
            this._uniformClip = false;
            this._rnUpdateFun = null;
        }
        get _parentClipInfo() {
            return this._currentData.clipInfo;
        }
        setRenderUpdateCallback(func) {
            this._rnUpdateFun = func;
        }
        _handleInterData() {
            let rect = this._clipRect;
            if (rect) {
                let info = this._clipInfo;
                let matrixVersion = this.getRenderMatrixVersion();
                let clipInfo = this._currentData.clipInfo;
                let parentClipUpdateFrame = clipInfo && clipInfo !== _DefaultClipInfo ? clipInfo._updateFrame : -1;
                if (this.transSlot >= 0) {
                    if (this._clipMatFrame !== matrixVersion
                        || this._clipParentUpdateFrame !== parentClipUpdateFrame
                        || this._clipRectAppliedFrame !== this._clipRectUpdateFrame) {
                        this._clipMatFrame = matrixVersion;
                        this._clipParentUpdateFrame = parentClipUpdateFrame;
                        this._clipRectAppliedFrame = this._clipRectUpdateFrame;
                        let mat = this.renderMatrix;
                        let cm = info.clipMatrix;
                        let { x, y, width, height } = rect;
                        width = Math.max(width, 0.0001);
                        height = Math.max(height, 0.0001);
                        let tx = mat.tx, ty = mat.ty;
                        let maskA = width * mat.a, maskB = width * mat.b;
                        let maskC = height * mat.c, maskD = height * mat.d;
                        let parentOffsetX = 0, parentOffsetY = 0;
                        if (parentClipUpdateFrame !== -1) {
                            let parentClipPos = clipInfo.clipMatPos;
                            parentOffsetX = parentClipPos.z - parentClipPos.x;
                            parentOffsetY = parentClipPos.w - parentClipPos.y;
                        }
                        const rawClipX = x * mat.a + y * mat.c + tx;
                        const rawClipY = x * mat.b + y * mat.d + ty;
                        const contentTx = tx + parentOffsetX;
                        const contentTy = ty + parentOffsetY;
                        const maskTx = contentTx;
                        const maskTy = contentTy;
                        cm.a = maskA;
                        cm.b = maskB;
                        cm.c = maskC;
                        cm.d = maskD;
                        cm.tx = maskTx;
                        cm.ty = maskTy;
                        info.clipMatDir.setValue(maskA, maskB, maskC, maskD);
                        info.clipMatPos.setValue(rawClipX, rawClipY, contentTx, contentTy);
                        info.clipDepth = (parentClipUpdateFrame !== -1 ? clipInfo.clipDepth : 0) + 1;
                        info.clipParent = parentClipUpdateFrame !== -1 ? clipInfo : null;
                        info._updateFrame = ++_clipUpdateFrame;
                    }
                }
            }
            if (this._renderDataHandler) {
                let data = this.spriteShaderData;
                let info = this.getClipInfo();
                if (info !== _DefaultClipInfo) {
                    if (this._needUploadClipOffset < info._updateFrame) {
                        this._clipOffset.setValue(info.clipMatPos.z - info.clipMatPos.x, info.clipMatPos.w - info.clipMatPos.y);
                        data.setVector2(Laya.ShaderDefines2D.UNIFORM_CLIPOFFSET, this._clipOffset);
                        this._needUploadClipOffset = info._updateFrame;
                    }
                    if (!this._uniformClip) {
                        this._uniformClip = true;
                        data.addDefine(Laya.ShaderDefines2D.UNIFORMCLIP);
                    }
                }
                else if (this._uniformClip) {
                    data.removeDefine(Laya.ShaderDefines2D.UNIFORMCLIP);
                    this._uniformClip = false;
                }
                let ga = this.globalAlpha;
                if (this._lastUploadedAlpha !== ga) {
                    data.setNumber(Laya.ShaderDefines2D.UNIFORM_VERTALPHA, ga);
                    this._lastUploadedAlpha = ga;
                }
            }
        }
        _setBlendMode() {
            if (!this.spriteShaderData)
                return;
            Laya.BlendModeHandler.setShaderData(this.blendMode, this.spriteShaderData);
            if (this._subStruct) {
                this._subStruct._setBlendMode();
            }
        }
        setClipRect(rect) {
            this._clipRect = rect;
            this._clipRectUpdateFrame = ++_clipRectUpdateFrame;
            this._invalidateClipCache();
            rect ? this._initClipInfo() : this._clipInfo = null;
            this.updateChildren(ChildrenUpdateType.Clip);
        }
        _invalidateClipCache() {
            this._clipMatFrame = -1;
            this._clipParentUpdateFrame = -2;
            this._clipRectAppliedFrame = -1;
            this._needUploadClipOffset = -1;
        }
        _initClipInfo() {
            if (!this._clipInfo) {
                this._clipInfo = {
                    clipMatDir: new Laya.Vector4,
                    clipMatPos: new Laya.Vector4,
                    clipMatrix: new Laya.Matrix,
                    _updateFrame: -1,
                    clipDepth: 1,
                    clipParent: null
                };
            }
            else {
                this._clipInfo._updateFrame = -1;
                this._clipInfo.clipDepth = 1;
                this._clipInfo.clipParent = null;
            }
        }
        _childAlphaBase() {
            return this._subStruct ? this.transSlot : this._alphaBaseSlot;
        }
        _setAlphaBase(outerBase) {
            if (this._subStruct) {
                this._subStruct._alphaBaseSlot = outerBase;
                return;
            }
            if (this._alphaBaseSlot === outerBase)
                return;
            this._alphaBaseSlot = outerBase;
            for (let i = 0, n = this.children.length; i < n; i++) {
                this.children[i]._setAlphaBase(outerBase);
            }
        }
        _updateBlendMode(blendMode) {
            if (this._subStruct && this._subStruct.enabled) {
                this._subStruct._blendMode = blendMode;
            }
            else {
                this._blendMode = blendMode;
            }
        }
        getClipInfo() {
            return this._clipInfo || this._currentData.clipInfo || _DefaultClipInfo;
        }
        hasClip() {
            return this.getClipInfo() !== _DefaultClipInfo;
        }
        updateChildren(type) {
            if (type == ChildrenUpdateType.None)
                return;
            let info, blendMode;
            let priority = 0, pass = null, enableCulling = false, dcOptimize = false;
            let globalRenderData = null;
            let updateBlend = false, updateClip = false, updatePass = false, updateGlobal = false, updateCulling = false, updateDcOptimize = false;
            if (type & ChildrenUpdateType.Clip) {
                info = this.getClipInfo();
                this._needUploadClipOffset = -1;
                if (this._subStruct) {
                    this._subStruct._needUploadClipOffset = -1;
                }
                updateClip = true;
            }
            if (type & ChildrenUpdateType.Blend) {
                blendMode = this.blendMode;
                updateBlend = true;
            }
            if (type & ChildrenUpdateType.Pass) {
                pass = this.pass;
                priority = pass ? pass.priority + 1 : 0;
                updatePass = true;
            }
            if (type & ChildrenUpdateType.Global) {
                updateGlobal = true;
                this._globalShaderData;
                globalRenderData = this.globalRenderData;
            }
            if (type & ChildrenUpdateType.Culling) {
                updateCulling = true;
                enableCulling = this.inheritedEnableCulling;
            }
            if (type & ChildrenUpdateType.DcOptimize) {
                updateDcOptimize = true;
                dcOptimize = this.inheritedDcOptimize;
            }
            for (const child of this.children) {
                let updateChild = false;
                let childParentData = child._parentData;
                if (updateClip) {
                    childParentData.clipInfo = info;
                    if (!child._clipInfo) {
                        updateChild = true;
                    }
                }
                if (updateBlend) {
                    if (child._blendMode === Laya.BlendMode.invalid) {
                        childParentData.blendMode = blendMode;
                        child._setBlendMode();
                        updateChild = true;
                    }
                }
                if (updatePass) {
                    childParentData.pass = pass;
                    if (child._pass && child._pass !== pass) {
                        child._pass.priority = priority;
                    }
                    updateChild = true;
                }
                if (updateGlobal) {
                    childParentData.globalRenderData = globalRenderData;
                    child._updateGlobalShaderData();
                    if (!child._globalRenderData) {
                        updateChild = true;
                    }
                }
                if (updateCulling) {
                    childParentData.enableCulling = enableCulling;
                    if (child._pass) {
                        child._pass.repaint = true;
                    }
                    updateChild = true;
                }
                if (updateDcOptimize) {
                    childParentData.dcOptimize = dcOptimize;
                    if (child._pass) {
                        child._pass.repaint = true;
                    }
                    updateChild = true;
                }
                if (updateChild) {
                    child.updateChildren(type);
                }
            }
        }
        setRepaint() {
            if (this.pass) {
                this.pass.repaint = true;
            }
        }
        addChild(child, index) {
            child.parent = this;
            this.children.splice(index, 0, child);
            let childParentData = child._parentData;
            childParentData.clipInfo = this.getClipInfo();
            childParentData.blendMode = this.blendMode;
            child._setBlendMode();
            child._setAlphaBase(this._childAlphaBase());
            let parentPass = this.pass;
            childParentData.pass = parentPass;
            child._updatePriority();
            childParentData.globalRenderData = this.globalRenderData;
            child._updateGlobalShaderData();
            childParentData.enableCulling = this.inheritedEnableCulling;
            childParentData.dcOptimize = this.inheritedDcOptimize;
            child.updateChildren(ChildrenUpdateType.All);
            return;
        }
        updateChildIndex(child, oldIndex, index) {
            if (oldIndex === index)
                return;
            this.children.splice(oldIndex, 1);
            if (index >= this.children.length) {
                this.children.push(child);
            }
            else {
                this.children.splice(index, 0, child);
            }
        }
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index !== -1) {
                child.parent = null;
                this.children.splice(index, 1);
                let childParentData = child._parentData;
                childParentData.pass = null;
                child._updatePriority();
                childParentData.clipInfo = null;
                childParentData.blendMode = Laya.BlendMode.invalid;
                child._setAlphaBase(-1);
                childParentData.globalRenderData = null;
                child._updateGlobalShaderData();
                childParentData.enableCulling = false;
                childParentData.dcOptimize = false;
                child.updateChildren(ChildrenUpdateType.All);
            }
        }
        renderUpdate(context) {
            if (this.renderDataHandler) {
                this.renderDataHandler.inheriteRenderData(context);
            }
            if (this._rnUpdateFun) {
                this._rnUpdateFun(context);
            }
        }
        destroy() {
            this._clipInfo = null;
            this._currentData = null;
            this._parentData = null;
            this._clipRect = null;
            this.renderElements = null;
            this.spriteShaderData = null;
            this.parent = null;
            this.children.length = 0;
            this.children = null;
            this._pass = null;
            this.owner = null;
        }
    }

    class WebTransform2DMemoryFactory {
        createChunkBuffers(_chunkIndex, capacity, dirtyWords) {
            const parent = new Int32Array(capacity);
            return {
                localTrs: new Float32Array(capacity * 9),
                localAlpha: new Float32Array(capacity),
                localFlags: new Uint8Array(capacity),
                world: new Float32Array(capacity * 8),
                parent,
                childCount: new Uint16Array(capacity),
                childrenInline: new Int32Array(capacity * 8),
                selfDirtyM: new Uint32Array(dirtyWords),
                treeDirtyM: new Uint32Array(dirtyWords),
                selfDirtyA: new Uint32Array(dirtyWords),
                treeDirtyA: new Uint32Array(dirtyWords),
                selfDirtyC: new Uint32Array(dirtyWords),
                treeDirtyC: new Uint32Array(dirtyWords),
                slotGen: new Uint16Array(capacity),
                matrixFrame: new Uint32Array(capacity),
                alphaFrame: new Uint32Array(capacity),
                cullingFrame: new Uint32Array(capacity),
            };
        }
        createControlBuffer(length) {
            return new Int32Array(length);
        }
        createChangedBuffers(capacity) {
            return { slots: new Int32Array(capacity), masks: new Int32Array(capacity) };
        }
    }

    class WebDefineDatas {
        constructor() {
            this._changeFlags = new Set();
            this._mask = [];
            this._length = 0;
        }
        _intersectionDefineDatas(define) {
            var unionMask = define._mask;
            var mask = this._mask;
            for (var i = this._length - 1; i >= 0; i--) {
                var value = mask[i] & unionMask[i];
                if (value === 0 && i === this._length - 1)
                    this._length--;
                else
                    mask[i] = value;
            }
        }
        add(define) {
            let changed = false;
            var index = define._index;
            var size = index + 1;
            var mask = this._mask;
            var maskStart = this._length;
            if (maskStart < size) {
                (mask.length < size) && (mask.length = size);
                for (; maskStart < index; maskStart++)
                    mask[maskStart] = 0;
                mask[index] = define._value;
                this._length = size;
                changed = true;
            }
            else {
                let last = mask[index];
                mask[index] |= define._value;
                changed = last != mask[index];
            }
            if (changed) {
                this._notifyChangeFlag();
            }
            return changed;
        }
        remove(define) {
            var index = define._index;
            var mask = this._mask;
            var endIndex = this._length - 1;
            if (index > endIndex)
                return false;
            let lastValue = mask[index];
            var newValue = mask[index] & ~define._value;
            if (index == endIndex && newValue === 0)
                this._length--;
            else
                mask[index] = newValue;
            let changed = lastValue != newValue;
            if (changed) {
                this._notifyChangeFlag();
            }
            return changed;
        }
        addDefineDatas(define) {
            var addMask = define._mask;
            var size = define._length;
            var mask = this._mask;
            var maskStart = this._length;
            if (maskStart < size) {
                mask.length = size;
                for (var i = 0; i < maskStart; i++)
                    mask[i] |= addMask[i];
                for (; i < size; i++)
                    mask[i] = addMask[i];
                this._length = size;
            }
            else {
                for (var i = 0; i < size; i++) {
                    mask[i] |= addMask[i];
                }
            }
            this._notifyChangeFlag();
        }
        removeDefineDatas(define) {
            var removeMask = define._mask;
            var mask = this._mask;
            var endIndex = this._length - 1;
            var i = Math.min(define._length, endIndex);
            for (; i >= 0; i--) {
                var newValue = mask[i] & ~removeMask[i];
                if (i == endIndex && newValue === 0) {
                    endIndex--;
                    this._length--;
                }
                else {
                    mask[i] = newValue;
                }
            }
            this._notifyChangeFlag();
        }
        has(define) {
            var index = define._index;
            if (index >= this._length)
                return false;
            return (this._mask[index] & define._value) !== 0;
        }
        _notifyChangeFlag() {
            if (this._changeFlags.size > 0) {
                this._changeFlags.forEach(value => {
                    value.setValue(Laya.Stat.loopCount, Laya.LayaGL.renderEngine._framePassCount);
                });
            }
        }
        addChangeFlagInfo(flag) {
            if (!this._changeFlags.has(flag)) {
                flag.setValue(Laya.Stat.loopCount, Laya.LayaGL.renderEngine._framePassCount);
                this._changeFlags.add(flag);
            }
        }
        removeChangeFlagInfo(flag) {
            if (this._changeFlags.has(flag)) {
                flag.setValue(Laya.Stat.loopCount, Laya.LayaGL.renderEngine._framePassCount);
                this._changeFlags.delete(flag);
            }
        }
        clear() {
            this._length = 0;
            this._notifyChangeFlag();
        }
        cloneTo(destObject) {
            var destMask = destObject._mask;
            var mask = this._mask;
            var count = this._length;
            destMask.length = count;
            for (var i = 0; i < count; i++)
                destMask[i] = mask[i];
            destObject._length = count;
            destObject._notifyChangeFlag();
        }
        clone() {
            var dest = new WebDefineDatas();
            this.cloneTo(dest);
            return dest;
        }
        destroy() {
            delete this._mask;
        }
        isEual(other) {
            var count = this._length;
            if (count != other._length)
                return false;
            let mask = this._mask;
            let otherMask = other._mask;
            for (var i = 0; i < count; i++)
                if (mask[i] != otherMask[i])
                    return false;
            return true;
        }
    }

    exports.WebGLExtension = void 0;
    (function (WebGLExtension) {
        WebGLExtension[WebGLExtension["OES_vertex_array_object"] = 0] = "OES_vertex_array_object";
        WebGLExtension[WebGLExtension["ANGLE_instanced_arrays"] = 1] = "ANGLE_instanced_arrays";
        WebGLExtension[WebGLExtension["OES_texture_half_float"] = 2] = "OES_texture_half_float";
        WebGLExtension[WebGLExtension["OES_texture_half_float_linear"] = 3] = "OES_texture_half_float_linear";
        WebGLExtension[WebGLExtension["OES_texture_float"] = 4] = "OES_texture_float";
        WebGLExtension[WebGLExtension["OES_element_index_uint"] = 5] = "OES_element_index_uint";
        WebGLExtension[WebGLExtension["OES_texture_float_linear"] = 6] = "OES_texture_float_linear";
        WebGLExtension[WebGLExtension["EXT_color_buffer_half_float"] = 7] = "EXT_color_buffer_half_float";
        WebGLExtension[WebGLExtension["EXT_shader_texture_lod"] = 8] = "EXT_shader_texture_lod";
        WebGLExtension[WebGLExtension["WEBGL_depth_texture"] = 9] = "WEBGL_depth_texture";
        WebGLExtension[WebGLExtension["EXT_sRGB"] = 10] = "EXT_sRGB";
        WebGLExtension[WebGLExtension["EXT_color_buffer_float"] = 11] = "EXT_color_buffer_float";
        WebGLExtension[WebGLExtension["EXT_texture_filter_anisotropic"] = 12] = "EXT_texture_filter_anisotropic";
        WebGLExtension[WebGLExtension["WEBGL_compressed_texture_s3tc"] = 13] = "WEBGL_compressed_texture_s3tc";
        WebGLExtension[WebGLExtension["WEBGL_compressed_texture_s3tc_srgb"] = 14] = "WEBGL_compressed_texture_s3tc_srgb";
        WebGLExtension[WebGLExtension["WEBGL_compressed_texture_pvrtc"] = 15] = "WEBGL_compressed_texture_pvrtc";
        WebGLExtension[WebGLExtension["WEBGL_compressed_texture_etc1"] = 16] = "WEBGL_compressed_texture_etc1";
        WebGLExtension[WebGLExtension["WEBGL_compressed_texture_etc"] = 17] = "WEBGL_compressed_texture_etc";
        WebGLExtension[WebGLExtension["WEBGL_compressed_texture_astc"] = 18] = "WEBGL_compressed_texture_astc";
        WebGLExtension[WebGLExtension["OES_standard_derivatives"] = 19] = "OES_standard_derivatives";
    })(exports.WebGLExtension || (exports.WebGLExtension = {}));

    class GLObject {
        constructor(engine) {
            this._destroyed = false;
            this._engine = engine;
            this._gl = this._engine.gl;
            this._id = this._engine._IDCounter++;
        }
        get destroyed() {
            return this._destroyed;
        }
        destroy() {
            if (this._destroyed)
                return;
            this._destroyed = true;
        }
    }

    class WebGLInternalRT extends GLObject {
        get gpuMemory() {
            return this._gpuMemory;
        }
        set gpuMemory(value) {
            this._changeTexMemory(value);
            this._gpuMemory = value;
        }
        _changeTexMemory(value) {
            Laya.LayaGL.statAgent.recordMemoryData(Laya.StatElement.M_GPUMemory, -this._gpuMemory + value);
            Laya.LayaGL.statAgent.recordMemoryData(Laya.StatElement.M_RenderTexture, -this._gpuMemory + value);
            Laya.LayaGL.statAgent.recordMemoryData(Laya.StatElement.M_AllTexture, -this._gpuMemory + value);
        }
        constructor(engine, colorFormat, depthStencilFormat, isCube, generateMipmap, samples, colorFormats) {
            super(engine);
            this._owner = null;
            this._color0Target = null;
            this._disposed = false;
            this._arrayLayerIndex = -1;
            this._gpuMemory = 0;
            this.colorFormat = colorFormat;
            if (colorFormats)
                this.colorFormats = Object.freeze(colorFormats.slice());
            this.depthStencilFormat = depthStencilFormat;
            this._isCube = isCube;
            this._generateMipmap = generateMipmap;
            this._samples = samples;
            this._textures = [];
            this._depthTexture = null;
            this._framebuffer = this._gl.createFramebuffer();
            if (samples > 1) {
                this._msaaFramebuffer = this._gl.createFramebuffer();
            }
            Laya.LayaGL.statAgent.recordCountData(Laya.StatElement.C_RenderTexture, 1);
        }
        _getSource() {
            return this._textures[0].resource;
        }
        dispose() {
            var _a, _b;
            if (this._disposed)
                return;
            this._disposed = true;
            this._destroyed = true;
            (_a = this._color0Target) === null || _a === void 0 ? void 0 : _a.dispose();
            this._color0Target = null;
            if (this._textures) {
                if (!this._owner) {
                    for (let i = this._textures.length - 1; i > -1; i--)
                        (_b = this._textures[i]) === null || _b === void 0 ? void 0 : _b.dispose();
                }
            }
            this._textures = null;
            !this._owner && this._depthTexture && this._depthTexture.dispose();
            this._depthTexture = null;
            this._framebuffer && this._gl.deleteFramebuffer(this._framebuffer);
            this._framebuffer = null;
            !this._owner && this._depthbuffer && this._gl.deleteRenderbuffer(this._depthbuffer);
            this._depthbuffer = null;
            this._msaaFramebuffer && this._gl.deleteFramebuffer(this._msaaFramebuffer);
            this._msaaFramebuffer = null;
            this._msaaRenderbuffer && this._gl.deleteRenderbuffer(this._msaaRenderbuffer);
            this._msaaRenderbuffer = null;
            this._owner = null;
            this._changeTexMemory(0);
            this._gpuMemory = 0;
            Laya.LayaGL.statAgent.recordCountData(Laya.StatElement.C_RenderTexture, -1);
        }
    }

    class WebGLInternalTex extends GLObject {
        get mipmap() {
            return this._mipmap;
        }
        get mipmapCount() {
            return this._mipmapCount;
        }
        _getSource() {
            return this.resource;
        }
        get gpuMemory() {
            return this._gpuMemory;
        }
        set gpuMemory(value) {
            this._changeTexMemory(value);
            this._gpuMemory = value;
        }
        constructor(engine, target, width, height, depth, dimension, mipmap, useSRGBLoader, gammaCorrection) {
            super(engine);
            this._texture3DStorageAllocated = false;
            this._gpuMemory = 0;
            this._baseMipmapLevel = 0;
            this._maxMipmapLevel = 0;
            this.resource = this._gl.createTexture();
            this.width = width;
            this.height = height;
            this.depth = depth;
            const isPot = (value) => {
                return (value & (value - 1)) === 0;
            };
            this.isPotSize = isPot(width) && isPot(height);
            if (dimension == Laya.TextureDimension.Tex3D) {
                this.isPotSize = this.isPotSize && isPot(this.depth);
            }
            switch (dimension) {
                case Laya.TextureDimension.Tex2D:
                    this._statistics_M_Texture = Laya.StatElement.M_Texture2D;
                    this._statistics_RC_Texture = Laya.StatElement.C_Texture2D;
                    break;
                case Laya.TextureDimension.Tex3D:
                    this._statistics_M_Texture = Laya.StatElement.M_Texture3D;
                    this._statistics_RC_Texture = Laya.StatElement.C_Texture3D;
                    break;
                case Laya.TextureDimension.Cube:
                    this._statistics_M_Texture = Laya.StatElement.M_TextureCube;
                    this._statistics_RC_Texture = Laya.StatElement.C_TextureCube;
                    break;
                case Laya.TextureDimension.Texture2DArray:
                    this._statistics_M_Texture = Laya.StatElement.M_Texture2DArray;
                    this._statistics_RC_Texture = Laya.StatElement.C_Texture2DArray;
                    break;
            }
            this._mipmap = mipmap && (this.isPotSize || engine.getCapable(Laya.RenderCapable.Texture_NPOTFull));
            const maxSize = Math.max(width, height, dimension === Laya.TextureDimension.Tex3D ? depth : 1);
            this._mipmapCount = this._mipmap ? Math.floor(Math.log2(maxSize)) + 1 : 1;
            this._maxMipmapLevel = this._mipmapCount - 1;
            this._baseMipmapLevel = 0;
            this.useSRGBLoad = useSRGBLoader;
            this.gammaCorrection = gammaCorrection;
            this.target = target;
            this.filterMode = Laya.FilterMode.Bilinear;
            this.wrapU = Laya.WrapMode.Repeat;
            this.wrapV = Laya.WrapMode.Repeat;
            this.wrapW = Laya.WrapMode.Repeat;
            this.anisoLevel = 4;
            this.compareMode = Laya.TextureCompareMode.None;
            Laya.LayaGL.statAgent.recordCountData(this._statistics_RC_Texture, 1);
            Laya.LayaGL.statAgent.recordCountData(Laya.StatElement.C_AllTexture, 1);
        }
        get filterMode() {
            return this._filterMode;
        }
        set filterMode(value) {
            if (this._filterMode != value && this.resource) {
                let gl = this._gl;
                let mipmap = this.mipmap;
                let min = this.getFilteMinrParam(value, mipmap);
                this._setTexParameteri(gl.TEXTURE_MIN_FILTER, min);
                let mag = this.getFilterMagParam(value);
                this._setTexParameteri(gl.TEXTURE_MAG_FILTER, mag);
                this._filterMode = value;
            }
        }
        get wrapU() {
            return this._warpU;
        }
        set wrapU(value) {
            if (this._warpU != value && this.resource) {
                let gl = this._gl;
                let warpParam = this.getWrapParam(value);
                this._setWrapMode(gl.TEXTURE_WRAP_S, warpParam);
                this._warpU = value;
            }
        }
        get wrapV() {
            return this._warpV;
        }
        set wrapV(value) {
            if (this._warpV != value && this.resource) {
                let gl = this._gl;
                let warpParam = this.getWrapParam(value);
                this._setWrapMode(gl.TEXTURE_WRAP_T, warpParam);
                this._warpV = value;
            }
        }
        get wrapW() {
            return this._warpW;
        }
        set wrapW(value) {
            if (this._warpW != value && this.resource) {
                if (this._engine.getCapable(Laya.RenderCapable.Texture3D)) {
                    let gl = this._gl;
                    let warpParam = this.getWrapParam(value);
                    this._setWrapMode(gl.TEXTURE_WRAP_R, warpParam);
                }
                this._warpW = value;
            }
        }
        get anisoLevel() {
            return this._anisoLevel;
        }
        set anisoLevel(value) {
            let anisoExt = this._engine._supportCapatable.getExtension(exports.WebGLExtension.EXT_texture_filter_anisotropic);
            if (anisoExt) {
                this._gl;
                let maxAnisoLevel = this._engine.getParams(Laya.RenderParams.Max_AnisoLevel_Count);
                let level = Math.max(1, Math.min(maxAnisoLevel, value));
                this._setTexParametexf(anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, level);
                this._anisoLevel = level;
            }
            else {
                this._anisoLevel = 1;
            }
        }
        set baseMipmapLevel(value) {
            if (this._engine.isWebGL2) {
                this._setTexParameteri(this._gl.TEXTURE_BASE_LEVEL, value);
            }
            this._baseMipmapLevel = value;
        }
        get baseMipmapLevel() {
            return this._baseMipmapLevel;
        }
        set maxMipmapLevel(value) {
            if (this._engine.isWebGL2) {
                this._setTexParameteri(this._gl.TEXTURE_MAX_LEVEL, value);
            }
            this._maxMipmapLevel = value;
        }
        get maxMipmapLevel() {
            return this._maxMipmapLevel;
        }
        get compareMode() {
            return this._compareMode;
        }
        set compareMode(value) {
            this._compareMode = value;
        }
        _setTexParameteri(pname, param) {
            let gl = this._gl;
            let target = this.target;
            this._engine._bindTexture(target, this.resource);
            gl.texParameteri(target, pname, param);
            this._engine._bindTexture(target, null);
        }
        _setTexParametexf(pname, param) {
            let gl = this._gl;
            let target = this.target;
            this._engine._bindTexture(target, this.resource);
            gl.texParameterf(target, pname, param);
            this._engine._bindTexture(target, null);
        }
        getFilteMinrParam(filterMode, mipmap) {
            let gl = this._gl;
            switch (filterMode) {
                case Laya.FilterMode.Point:
                    return mipmap ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST;
                case Laya.FilterMode.Bilinear:
                    return mipmap ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR;
                case Laya.FilterMode.Trilinear:
                    return mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
                default:
                    return mipmap ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR;
            }
        }
        getFilterMagParam(filterMode) {
            let gl = this._gl;
            switch (filterMode) {
                case Laya.FilterMode.Point:
                    return gl.NEAREST;
                case Laya.FilterMode.Bilinear:
                    return gl.LINEAR;
                case Laya.FilterMode.Trilinear:
                    return gl.LINEAR;
                default:
                    return gl.LINEAR;
            }
        }
        getWrapParam(wrapMode) {
            let gl = this._gl;
            switch (wrapMode) {
                case Laya.WrapMode.Repeat:
                    return gl.REPEAT;
                case Laya.WrapMode.Clamp:
                    return gl.CLAMP_TO_EDGE;
                case Laya.WrapMode.Mirrored:
                    return gl.MIRRORED_REPEAT;
                default:
                    return gl.REPEAT;
            }
        }
        _setWrapMode(pname, param) {
            let gl = this._gl;
            if (!this.isPotSize && !this._engine.getCapable(Laya.RenderCapable.Texture_NPOTFull)) {
                param = gl.CLAMP_TO_EDGE;
            }
            this._setTexParameteri(pname, param);
        }
        _changeTexMemory(memory) {
            Laya.LayaGL.statAgent.recordMemoryData(Laya.StatElement.M_GPUMemory, -this._gpuMemory + memory);
            Laya.LayaGL.statAgent.recordMemoryData(Laya.StatElement.M_AllTexture, -this._gpuMemory + memory);
            Laya.LayaGL.statAgent.recordMemoryData(this._statistics_M_Texture, -this._gpuMemory + memory);
        }
        dispose() {
            let gl = this._gl;
            gl.deleteTexture(this.resource);
            this._changeTexMemory(0);
            this._gpuMemory = 0;
            Laya.LayaGL.statAgent.recordCountData(this._statistics_RC_Texture, -1);
            Laya.LayaGL.statAgent.recordCountData(Laya.StatElement.C_AllTexture, -1);
        }
    }

    class GLTextureContext extends GLObject {
        constructor(engine) {
            super(engine);
            this._glParam = {
                internalFormat: 0,
                format: 0,
                type: 0,
            };
            this.needBitmap = false;
            this._sRGB = this._engine._supportCapatable.getExtension(exports.WebGLExtension.EXT_sRGB);
            this._oesTextureHalfFloat = this._engine._supportCapatable.getExtension(exports.WebGLExtension.OES_texture_half_float);
            this._compressdTextureS3tc_srgb = this._engine._supportCapatable.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_s3tc_srgb);
            this._compressedTextureEtc1 = this._engine._supportCapatable.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_etc1);
            this._compressedTextureS3tc = this._engine._supportCapatable.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_s3tc);
            this._compressedTextureETC = this._engine._supportCapatable.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_etc);
            this._compressedTextureASTC = this._engine._supportCapatable.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_astc);
            this._webgl_depth_texture = this._engine._supportCapatable.getExtension(exports.WebGLExtension.WEBGL_depth_texture);
        }
        createRenderTargetArrayInternal(width, height, depth, colorFormat, depthStencilFormat, generateMipmap, sRGB, multiSamples) {
            throw "Texture2DArray render target is not supported on WebGL1.";
        }
        createTexture3DInternal(dimension, width, height, depth, format, generateMipmap, sRGB, premultipliedAlpha) {
            return null;
        }
        setTexture3DImageData(texture, source, depth, premultiplyAlpha, invertY) {
            return null;
        }
        setTexture3DPixelsData(texture, source, depth, premultiplyAlpha, invertY) {
            return null;
        }
        setTexture3DSubPixelsData(texture, source, mipmapLevel, generateMipmap, xOffset, yOffset, zOffset, width, height, depth, premultiplyAlpha, invertY) {
            return null;
        }
        glTextureParam(format, useSRGB) {
            let gl = this._gl;
            this._glParam.internalFormat = null;
            this._glParam.format = null;
            this._glParam.type = null;
            switch (format) {
                case Laya.TextureFormat.Alpha8:
                    this._glParam.internalFormat = gl.ALPHA;
                    this._glParam.format = gl.ALPHA;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.R8G8B8:
                    this._glParam.internalFormat = useSRGB ? this._sRGB.SRGB_EXT : gl.RGB;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.R8G8B8A8:
                    this._glParam.internalFormat = useSRGB ? this._sRGB.SRGB_ALPHA_EXT : gl.RGBA;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.R5G6B5:
                    this._glParam.internalFormat = gl.RGB;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_SHORT_5_6_5;
                    break;
                case Laya.TextureFormat.R32G32B32A32:
                    this._glParam.internalFormat = gl.RGBA;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.TextureFormat.R32G32B32:
                    this._glParam.internalFormat = gl.RGB;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.TextureFormat.R16G16B16A16:
                    this._glParam.internalFormat = gl.RGBA;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = this._oesTextureHalfFloat.HALF_FLOAT_OES;
                    break;
                case Laya.TextureFormat.R16G16B16:
                    this._glParam.internalFormat = gl.RGB;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = this._oesTextureHalfFloat.HALF_FLOAT_OES;
                    break;
                case Laya.TextureFormat.DXT1:
                    this._glParam.internalFormat = useSRGB ? this._compressdTextureS3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT : this._compressedTextureS3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.DXT3:
                    this._glParam.internalFormat = useSRGB ? this._compressdTextureS3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT : this._compressedTextureS3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.DXT5:
                    this._glParam.internalFormat = useSRGB ? this._compressdTextureS3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT : this._compressedTextureS3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ETC1RGB:
                    this._glParam.internalFormat = this._compressedTextureEtc1.COMPRESSED_RGB_ETC1_WEBGL;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ETC2RGBA:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_RGBA8_ETC2_EAC;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ETC2RGB:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_RGB8_ETC2;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ETC2SRGB:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_SRGB8_ETC2;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ETC2SRGB_Alpha8:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ETC2RGB_Alpha1:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ETC2SRGB_Alpha1:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC4x4:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_4x4_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC6x6:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_6x6_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC8x8:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_8x8_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC10x10:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_10x10_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC12x12:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_12x12_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC4x4SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC6x6SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC8x8SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC10x10SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.ASTC12x12SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                default:
                    throw "Unknown Texture Format.";
            }
            return this._glParam;
        }
        glRenderTextureParam(format, useSRGB) {
            let gl = this._gl;
            this._glParam.internalFormat = null;
            this._glParam.format = null;
            this._glParam.type = null;
            switch (format) {
                case Laya.RenderTargetFormat.R8G8B8:
                    this._glParam.internalFormat = useSRGB ? this._sRGB.SRGB_EXT : gl.RGB;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.RenderTargetFormat.R8G8B8A8:
                    this._glParam.internalFormat = useSRGB ? this._sRGB.SRGB_EXT : gl.RGBA;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.RenderTargetFormat.R16G16B16:
                    this._glParam.internalFormat = gl.RGB;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = this._oesTextureHalfFloat.HALF_FLOAT_OES;
                    break;
                case Laya.RenderTargetFormat.R16G16B16A16:
                    this._glParam.internalFormat = gl.RGBA;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = this._oesTextureHalfFloat.HALF_FLOAT_OES;
                    break;
                case Laya.RenderTargetFormat.R32G32B32:
                    this._glParam.internalFormat = gl.RGB;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.RenderTargetFormat.R32G32B32A32:
                    this._glParam.internalFormat = gl.RGBA;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.RenderTargetFormat.DEPTH_16:
                    this._glParam.internalFormat = gl.DEPTH_COMPONENT;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_SHORT;
                    break;
                case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                    this._glParam.internalFormat = gl.DEPTH_STENCIL;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = this._webgl_depth_texture.UNSIGNED_INT_24_8_WEBGL;
                    break;
                case Laya.RenderTargetFormat.DEPTH_32:
                    this._glParam.internalFormat = gl.DEPTH_COMPONENT;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_INT;
                    break;
                case Laya.RenderTargetFormat.STENCIL_8:
                default:
                    throw "render texture format wrong.";
            }
            return this._glParam;
        }
        glRenderBufferParam(format, useSRGB) {
            let gl = this._gl;
            switch (format) {
                case Laya.RenderTargetFormat.DEPTH_16:
                    return { internalFormat: gl.DEPTH_COMPONENT16, attachment: gl.DEPTH_ATTACHMENT };
                case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                    return { internalFormat: gl.DEPTH_STENCIL, attachment: gl.DEPTH_STENCIL_ATTACHMENT };
                case Laya.RenderTargetFormat.DEPTH_32:
                    return { internalFormat: gl.DEPTH_STENCIL, attachment: gl.DEPTH_STENCIL_ATTACHMENT };
                case Laya.RenderTargetFormat.STENCIL_8:
                    return { internalFormat: gl.STENCIL_INDEX8, attachment: gl.STENCIL_ATTACHMENT };
                default:
                    return null;
            }
        }
        glRenderTargetAttachment(format) {
            let gl = this._gl;
            switch (format) {
                case Laya.RenderTargetFormat.DEPTH_16:
                    return gl.DEPTH_ATTACHMENT;
                case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                    return gl.DEPTH_STENCIL_ATTACHMENT;
                case Laya.RenderTargetFormat.DEPTH_32:
                    return gl.DEPTH_ATTACHMENT;
                case Laya.RenderTargetFormat.STENCIL_8:
                    return gl.STENCIL_ATTACHMENT;
                case Laya.RenderTargetFormat.R8G8B8:
                case Laya.RenderTargetFormat.R8G8B8A8:
                case Laya.RenderTargetFormat.R16G16B16:
                case Laya.RenderTargetFormat.R16G16B16A16:
                case Laya.RenderTargetFormat.R32G32B32:
                case Laya.RenderTargetFormat.R32G32B32A32:
                    return gl.COLOR_ATTACHMENT0;
                default:
                    throw "render format.";
            }
        }
        getTarget(dimension) {
            let gl = this._gl;
            switch (dimension) {
                case Laya.TextureDimension.Tex2D:
                    return gl.TEXTURE_2D;
                case Laya.TextureDimension.Cube:
                    return gl.TEXTURE_CUBE_MAP;
                default:
                    throw "texture dimension wrong in WebGL1.";
            }
        }
        getFormatPixelsParams(format) {
            let formatParams = {
                channels: 0,
                bytesPerPixel: 0,
                dataTypedCons: Uint8Array,
                typedSize: 1
            };
            switch (format) {
                case Laya.TextureFormat.Alpha8:
                    formatParams.channels = 1;
                    formatParams.bytesPerPixel = 1;
                    formatParams.dataTypedCons = Uint8Array;
                    formatParams.typedSize = 1;
                    return formatParams;
                case Laya.TextureFormat.R8G8B8A8:
                    formatParams.channels = 4;
                    formatParams.bytesPerPixel = 4;
                    formatParams.dataTypedCons = Uint8Array;
                    formatParams.typedSize = 1;
                    return formatParams;
                case Laya.TextureFormat.R8G8B8:
                    formatParams.channels = 3;
                    formatParams.bytesPerPixel = 3;
                    formatParams.dataTypedCons = Uint8Array;
                    formatParams.typedSize = 1;
                    return formatParams;
                case Laya.TextureFormat.R5G6B5:
                    formatParams.channels = 3;
                    formatParams.bytesPerPixel = 2;
                    formatParams.dataTypedCons = Uint16Array;
                    formatParams.typedSize = 2;
                    return formatParams;
                case Laya.TextureFormat.R16G16B16:
                    formatParams.channels = 3;
                    formatParams.bytesPerPixel = 6;
                    formatParams.dataTypedCons = Uint16Array;
                    formatParams.typedSize = 2;
                    return formatParams;
                case Laya.TextureFormat.R16G16B16A16:
                    formatParams.channels = 4;
                    formatParams.bytesPerPixel = 8;
                    formatParams.dataTypedCons = Uint16Array;
                    formatParams.typedSize = 2;
                    return formatParams;
                case Laya.TextureFormat.R32G32B32:
                    formatParams.channels = 3;
                    formatParams.bytesPerPixel = 12;
                    formatParams.dataTypedCons = Float32Array;
                    formatParams.typedSize = 4;
                    return formatParams;
                case Laya.TextureFormat.R32G32B32A32:
                    formatParams.channels = 4;
                    formatParams.bytesPerPixel = 16;
                    formatParams.dataTypedCons = Float32Array;
                    formatParams.typedSize = 4;
                    return formatParams;
                default:
                    return formatParams;
            }
        }
        getGLtexMemory(tex, depth = 1) {
            let gl = this._gl;
            let channels = 0;
            let singlebyte = 0;
            let bytelength = 0;
            let srgb = this._sRGB ? this._sRGB.SRGB_EXT : gl.RGB;
            let srgb_alpha = this._sRGB ? this._sRGB.SRGB_ALPHA_EXT : gl.RGBA;
            switch (tex.internalFormat) {
                case gl.ALPHA:
                    channels = 1;
                    break;
                case srgb:
                case gl.RGB:
                    channels = 3;
                    break;
                case srgb_alpha:
                case gl.RGBA:
                    channels = 4;
                    break;
                default:
                    channels = 0;
                    break;
            }
            switch (tex.type) {
                case gl.UNSIGNED_BYTE:
                    singlebyte = 1;
                    break;
                case gl.UNSIGNED_SHORT_5_6_5:
                    singlebyte = 2 / 3;
                    break;
                case gl.FLOAT:
                    singlebyte = 4;
                    break;
                case this._oesTextureHalfFloat.HALF_FLOAT_OES:
                    singlebyte = 2;
                    break;
                default:
                    singlebyte = 0;
                    break;
            }
            bytelength = channels * singlebyte * tex.width * tex.height;
            if (tex.mipmap) {
                bytelength *= 1.333;
            }
            if (tex.target == gl.TEXTURE_CUBE_MAP)
                bytelength *= 6;
            else if (tex.target == gl.TEXTURE_2D)
                bytelength *= 1;
            return bytelength;
        }
        getGLRTTexMemory(width, height, colorFormat, depthStencilFormat, generateMipmap, multiSamples, cube) {
            let getpixelbyte = (rtFormat) => {
                let pixelByte = 0;
                switch (rtFormat) {
                    case Laya.RenderTargetFormat.R8G8B8:
                        pixelByte = 3;
                        break;
                    case Laya.RenderTargetFormat.R8G8B8A8:
                        pixelByte = 4;
                        break;
                    case Laya.RenderTargetFormat.R16G16B16A16:
                        pixelByte = 8;
                        break;
                    case Laya.RenderTargetFormat.R32G32B32:
                        pixelByte = 12;
                        break;
                    case Laya.RenderTargetFormat.R32G32B32A32:
                        pixelByte = 16;
                        break;
                    case Laya.RenderTargetFormat.R16G16B16:
                        pixelByte = 6;
                        break;
                    case Laya.RenderTargetFormat.DEPTH_16:
                        pixelByte = 2;
                        break;
                    case Laya.RenderTargetFormat.STENCIL_8:
                        pixelByte = 1;
                        break;
                    case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                        pixelByte = 4;
                        break;
                    case Laya.RenderTargetFormat.DEPTH_32:
                        pixelByte = 4;
                        break;
                }
                return pixelByte;
            };
            let colorPixelbyte = getpixelbyte(colorFormat);
            let depthPixelbyte = getpixelbyte(depthStencilFormat);
            if (multiSamples > 1)
                colorPixelbyte *= 2;
            if (cube)
                colorPixelbyte *= 6;
            if (generateMipmap)
                colorPixelbyte *= 1.333;
            let colorMemory = colorPixelbyte * width * height;
            let depthMemory = depthPixelbyte * width * height;
            return colorMemory + depthMemory;
        }
        supportSRGB(format, mipmap) {
            switch (format) {
                case Laya.TextureFormat.R8G8B8:
                case Laya.TextureFormat.R8G8B8A8:
                    return this._engine.getCapable(Laya.RenderCapable.Texture_SRGB) && !mipmap;
                case Laya.TextureFormat.DXT1:
                case Laya.TextureFormat.DXT3:
                case Laya.TextureFormat.DXT5:
                    return this._engine.getCapable(Laya.RenderCapable.COMPRESS_TEXTURE_S3TC_SRGB) && !mipmap;
                default:
                    return false;
            }
        }
        supportGenerateMipmap(format) {
            switch (format) {
                case Laya.RenderTargetFormat.DEPTH_16:
                case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                case Laya.RenderTargetFormat.DEPTH_32:
                case Laya.RenderTargetFormat.STENCIL_8:
                    return false;
                default:
                    return true;
            }
        }
        isSRGBFormat(format) {
            switch (format) {
                case Laya.TextureFormat.ETC2SRGB:
                case Laya.TextureFormat.ETC2SRGB_Alpha8:
                case Laya.TextureFormat.ETC2SRGB_Alpha1:
                case Laya.TextureFormat.ASTC4x4SRGB:
                case Laya.TextureFormat.ASTC6x6SRGB:
                case Laya.TextureFormat.ASTC8x8SRGB:
                case Laya.TextureFormat.ASTC10x10SRGB:
                case Laya.TextureFormat.ASTC12x12SRGB:
                    return true;
                default:
                    return false;
            }
        }
        createTextureInternal(dimension, width, height, format, generateMipmap, sRGB, premultipliedAlpha) {
            let useSRGBExt = this.isSRGBFormat(format) || (sRGB && this.supportSRGB(format, generateMipmap));
            if (premultipliedAlpha) {
                useSRGBExt = false;
            }
            let gammaCorrection = 1.0;
            if (!useSRGBExt && sRGB) {
                gammaCorrection = 2.2;
            }
            let target = this.getTarget(dimension);
            let internalTex = new WebGLInternalTex(this._engine, target, width, height, 1, dimension, generateMipmap, useSRGBExt, gammaCorrection);
            let glParam = this.glTextureParam(format, useSRGBExt);
            internalTex.internalFormat = glParam.internalFormat;
            internalTex.format = glParam.format;
            internalTex.type = glParam.type;
            return internalTex;
        }
        setTextureImageData(texture, source, premultiplyAlpha, invertY) {
            if (texture.width != source.width || texture.height != source.height) {
                console.warn("setTextureImageData: size not match");
            }
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            texture.width;
            texture.height;
            let gl = texture._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texImage2D(target, 0, internalFormat, format, type, source);
            texture.gpuMemory = this.getGLtexMemory(texture);
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        setTextureSubImageData(texture, source, x, y, premultiplyAlpha, invertY) {
            let target = texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            source.width;
            source.height;
            let gl = texture._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texSubImage2D(target, 0, x, y, format, type, source);
            texture.gpuMemory = this.getGLtexMemory(texture);
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        initVideoTextureData(texture) {
            let target = texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let gl = texture._gl;
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texImage2D(target, 0, texture.internalFormat, width, height, 0, format, type, null);
            texture.gpuMemory = this.getGLtexMemory(texture);
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
        }
        setTexturePixelsData(texture, source, premultiplyAlpha, invertY) {
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            let gl = texture._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texImage2D(target, 0, internalFormat, width, height, 0, format, type, source);
            texture.gpuMemory = this.getGLtexMemory(texture);
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setTextureSubPixelsData(texture, source, mipmapLevel, generateMipmap, xOffset, yOffset, width, height, premultiplyAlpha, invertY) {
            generateMipmap = generateMipmap && mipmapLevel == 0;
            let target = texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            let gl = texture._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texSubImage2D(target, mipmapLevel, xOffset, yOffset, width, height, format, type, source);
            if (texture.mipmap && generateMipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setTextureDDSData(texture, ddsInfo) {
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let source = ddsInfo.source;
            let dataOffset = ddsInfo.dataOffset;
            let bpp = ddsInfo.bpp;
            let blockBytes = ddsInfo.blockBytes;
            let mipmapCount = Math.min(ddsInfo.mipmapCount, texture.mipmapCount);
            let compressed = ddsInfo.compressed;
            texture.maxMipmapLevel = mipmapCount - 1;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            let gl = texture._gl;
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            let formatParams = this.getFormatPixelsParams(ddsInfo.format);
            let channelsByte = formatParams.bytesPerPixel / formatParams.channels;
            let dataTypeConstur = formatParams.dataTypedCons;
            let mipmapWidth = width;
            let mipmapHeight = height;
            let memory = 0;
            for (let index = 0; index < mipmapCount; index++) {
                if (compressed) {
                    let dataLength = Math.ceil(mipmapWidth / 4) * Math.ceil(mipmapHeight / 4) * blockBytes;
                    let sourceData = new Uint8Array(source, dataOffset, dataLength);
                    gl.compressedTexImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, sourceData);
                    memory += sourceData.byteLength;
                    dataOffset += bpp ? (mipmapWidth * mipmapHeight * (bpp / 8)) : dataLength;
                }
                else {
                    let dataLength = mipmapWidth * mipmapHeight * formatParams.channels;
                    let sourceData = new dataTypeConstur(source, dataOffset, dataLength);
                    memory += sourceData.byteLength;
                    gl.texImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, format, type, sourceData);
                    dataOffset += dataLength * channelsByte;
                }
                mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
            }
            texture.gpuMemory = memory;
            this._engine._bindTexture(texture.target, null);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setTextureKTXData(texture, ktxInfo) {
            let source = ktxInfo.source;
            let compressed = ktxInfo.compress;
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let mipmapCount = Math.min(ktxInfo.mipmapCount, texture.mipmapCount);
            let width = texture.width;
            let height = texture.height;
            texture.maxMipmapLevel = mipmapCount - 1;
            let gl = texture._gl;
            !compressed && gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            this._engine._bindTexture(texture.target, texture.resource);
            let mipmapWidth = width;
            let mipmapHeight = height;
            let dataOffset = ktxInfo.headerOffset + ktxInfo.bytesOfKeyValueData;
            let memory = 0;
            for (let index = 0; index < mipmapCount; index++) {
                let imageSize = new Int32Array(source, dataOffset, 1)[0];
                dataOffset += 4;
                if (compressed) {
                    let sourceData = new Uint8Array(source, dataOffset, imageSize);
                    gl.compressedTexImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, sourceData);
                    memory += sourceData.byteLength;
                }
                else {
                    let pixelParams = this.getFormatPixelsParams(ktxInfo.format);
                    let typedSize = imageSize / pixelParams.typedSize;
                    let sourceData = new pixelParams.dataTypedCons(source, dataOffset, typedSize);
                    gl.texImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, format, type, sourceData);
                    memory += sourceData.byteLength;
                }
                dataOffset += imageSize;
                dataOffset += 3 - ((imageSize + 3) % 4);
                mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
            }
            for (let index = ktxInfo.mipmapCount; index < texture.mipmapCount; index++) {
                if (compressed) ;
                else {
                    gl.texImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, format, type, null);
                }
                mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
            }
            texture.gpuMemory = memory;
            this._engine._bindTexture(texture.target, null);
        }
        setTextureHDRData(texture, hdrInfo) {
            let hdrPixelData = hdrInfo.readScanLine();
            this.setTexturePixelsData(texture, hdrPixelData, false, false);
        }
        setCubeImageData(texture, sources, premultiplyAlpha, invertY) {
            let gl = texture._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            ];
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            texture.width;
            texture.height;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            this._engine._bindTexture(texture.target, texture.resource);
            for (let index = 0; index < cubeFace.length; index++) {
                let target = cubeFace[index];
                gl.texImage2D(target, 0, internalFormat, format, type, sources[index]);
            }
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            texture.gpuMemory = this.getGLtexMemory(texture);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        setCubePixelsData(texture, source, premultiplyAlpha, invertY) {
            let gl = texture._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            ];
            texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let fourSize = width % 4 == 0;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            if (source) {
                for (let index = 0; index < cubeFace.length; index++) {
                    let t = cubeFace[index];
                    gl.texImage2D(t, 0, internalFormat, width, height, 0, format, type, source[index]);
                }
                if (texture.mipmap) {
                    gl.generateMipmap(texture.target);
                }
            }
            else {
                for (let index = 0; index < cubeFace.length; index++) {
                    let t = cubeFace[index];
                    gl.texImage2D(t, 0, internalFormat, width, height, 0, format, type, null);
                }
                if (texture.mipmap) {
                    gl.generateMipmap(texture.target);
                }
            }
            this._engine._bindTexture(texture.target, null);
            texture.gpuMemory = this.getGLtexMemory(texture);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setCubeSubPixelData(texture, source, mipmapLevel, generateMipmap, xOffset, yOffset, width, height, premultiplyAlpha, invertY) {
            generateMipmap = generateMipmap && mipmapLevel == 0;
            let gl = texture._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            ];
            texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let fourSize = width % 4 == 0;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            for (let index = 0; index < cubeFace.length; index++) {
                let target = cubeFace[index];
                gl.texSubImage2D(target, mipmapLevel, xOffset, yOffset, width, height, format, type, source[index]);
            }
            if (texture.mipmap && generateMipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setCubeDDSData(texture, ddsInfo) {
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let source = ddsInfo.source;
            let dataOffset = ddsInfo.dataOffset;
            let bpp = ddsInfo.bpp;
            let blockBytes = ddsInfo.blockBytes;
            let mipmapCount = ddsInfo.mipmapCount;
            texture.maxMipmapLevel = mipmapCount - 1;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            fourSize = true;
            let gl = texture._gl;
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
            ];
            let formatParams = this.getFormatPixelsParams(ddsInfo.format);
            let channelsByte = formatParams.bytesPerPixel / formatParams.channels;
            let dataTypeConstur = formatParams.dataTypedCons;
            let memory = 0;
            if (!ddsInfo.compressed) {
                for (let face = 0; face < 6; face++) {
                    let target = cubeFace[face];
                    let mipmapWidth = width;
                    let mipmapHeight = height;
                    for (let index = 0; index < mipmapCount; index++) {
                        let dataLength = mipmapWidth * mipmapHeight * formatParams.channels;
                        let sourceData = new dataTypeConstur(source, dataOffset, dataLength);
                        gl.texImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, format, type, sourceData);
                        memory += sourceData.byteLength;
                        dataOffset += dataLength * channelsByte;
                        mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                        mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
                    }
                }
            }
            else {
                for (let face = 0; face < 6; face++) {
                    let target = cubeFace[face];
                    let mipmapWidth = width;
                    let mipmapHeight = height;
                    for (let index = 0; index < mipmapCount; index++) {
                        let dataLength = Math.ceil(mipmapWidth / 4) * Math.ceil(mipmapHeight / 4) * blockBytes;
                        let sourceData = new Uint8Array(source, dataOffset, dataLength);
                        (texture.mipmap || index == 0) && gl.compressedTexImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, sourceData);
                        memory += sourceData.byteLength;
                        dataOffset += bpp ? (mipmapWidth * mipmapHeight * (bpp / 8)) : dataLength;
                        mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                        mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
                    }
                }
            }
            texture.gpuMemory = memory;
            this._engine._bindTexture(texture.target, null);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setCubeKTXData(texture, ktxInfo) {
            let source = ktxInfo.source;
            let compressed = ktxInfo.compress;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let mipmapCount = Math.min(ktxInfo.mipmapCount, texture.mipmapCount);
            let width = texture.width;
            let height = texture.height;
            texture.maxMipmapLevel = mipmapCount - 1;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            let gl = texture._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
            ];
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            let mipmapWidth = width;
            let mipmapHeight = height;
            let dataOffset = ktxInfo.headerOffset + ktxInfo.bytesOfKeyValueData;
            let memory = 0;
            for (let index = 0; index < mipmapCount; index++) {
                let imageSize = new Int32Array(source, dataOffset, 1)[0];
                dataOffset += 4;
                for (let face = 0; face < 6; face++) {
                    let target = cubeFace[face];
                    if (compressed) {
                        let sourceData = new Uint8Array(source, dataOffset, imageSize);
                        gl.compressedTexImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, sourceData);
                        memory += sourceData.byteLength;
                    }
                    else {
                        let pixelParams = this.getFormatPixelsParams(ktxInfo.format);
                        let typedSize = imageSize / pixelParams.typedSize;
                        let sourceData = new pixelParams.dataTypedCons(source, dataOffset, typedSize);
                        gl.texImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, format, type, sourceData);
                        memory += sourceData.byteLength;
                    }
                    dataOffset += imageSize;
                    dataOffset += 3 - ((imageSize + 3) % 4);
                }
                mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
            }
            for (let index = ktxInfo.mipmapCount; index < texture.mipmapCount; index++) {
                for (let face = 0; face < 6; face++) {
                    let target = cubeFace[face];
                    if (compressed) ;
                    else {
                        gl.texImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, format, type, null);
                    }
                }
                mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
            }
            this._engine._bindTexture(texture.target, null);
            texture.gpuMemory = memory;
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setTextureCompareMode(texture, compareMode) {
            return Laya.TextureCompareMode.None;
        }
        bindRenderTarget(renderTarget, faceIndex = 0) {
            this.currentActiveRT && this.unbindRenderTarget(this.currentActiveRT);
            let gl = this._gl;
            let framebuffer = renderTarget._framebuffer;
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            if (renderTarget._isCube) {
                let texture = renderTarget._textures[0];
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex, texture.resource, 0);
            }
            this.currentActiveRT = renderTarget;
        }
        bindoutScreenTarget() {
            if (this.currentActiveRT != WebGLEngine._lastFrameBuffer) {
                this.unbindRenderTarget(this.currentActiveRT);
            }
        }
        unbindRenderTarget(renderTarget) {
            let gl = renderTarget._gl;
            if (renderTarget && renderTarget._generateMipmap) {
                renderTarget._textures.forEach(tex => {
                    if (!tex)
                        return;
                    let target = tex.target;
                    this._engine._bindTexture(target, tex.resource);
                    gl.generateMipmap(target);
                    this._engine._bindTexture(target, null);
                });
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            this.currentActiveRT = WebGLEngine._lastFrameBuffer;
        }
        createRenderTextureCubeInternal(dimension, size, format, generateMipmap, sRGB) {
            let useSRGBExt = false;
            generateMipmap = generateMipmap && this.supportGenerateMipmap(format);
            let gammaCorrection = 1.0;
            let target = this.getTarget(dimension);
            let internalTex = new WebGLInternalTex(this._engine, target, size, size, 1, dimension, generateMipmap, useSRGBExt, gammaCorrection);
            let glParam = this.glRenderTextureParam(format, useSRGBExt);
            internalTex.internalFormat = glParam.internalFormat;
            internalTex.format = glParam.format;
            internalTex.type = glParam.type;
            let internalFormat = internalTex.internalFormat;
            let glFormat = internalTex.format;
            let type = internalTex.type;
            let gl = internalTex._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            ];
            this._engine._bindTexture(internalTex.target, internalTex.resource);
            for (let index = 0; index < cubeFace.length; index++) {
                let target = cubeFace[index];
                gl.texImage2D(target, 0, internalFormat, size, size, 0, glFormat, type, null);
            }
            this._engine._bindTexture(internalTex.target, null);
            if (format == Laya.RenderTargetFormat.DEPTH_16 || format == Laya.RenderTargetFormat.DEPTH_32 || format == Laya.RenderTargetFormat.DEPTHSTENCIL_24_8) {
                internalTex.filterMode = Laya.FilterMode.Point;
            }
            return internalTex;
        }
        createMultiRenderTargetInternal(width, height, colorFormats, depthStencilFormat, color0SRGB = false) {
            throw new Error("WebGL createMultiRenderTargetInternal is not implemented.");
        }
        createRenderTargetInternal(width, height, colorFormat, depthStencilFormat, generateMipmap, sRGB, multiSamples, storage) {
            multiSamples = 1;
            let texture = this.createRenderTextureInternal(Laya.TextureDimension.Tex2D, width, height, colorFormat, generateMipmap, sRGB);
            let renderTarget = new WebGLInternalRT(this._engine, colorFormat, depthStencilFormat, false, texture.mipmap, multiSamples);
            renderTarget.gpuMemory = this.getGLRTTexMemory(width, height, colorFormat, depthStencilFormat, generateMipmap, multiSamples, false);
            renderTarget.colorFormat = colorFormat;
            renderTarget.depthStencilFormat = depthStencilFormat;
            renderTarget._textures.push(texture);
            let framebuffer = renderTarget._framebuffer;
            let gl = renderTarget._gl;
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            let colorAttachment = this.glRenderTargetAttachment(colorFormat);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, colorAttachment, gl.TEXTURE_2D, texture.resource, 0);
            let depthBufferParam = this.glRenderBufferParam(depthStencilFormat, false);
            if (depthBufferParam) {
                let depthbuffer = this.createRenderbuffer(width, height, depthBufferParam.internalFormat, renderTarget._samples);
                renderTarget._depthbuffer = depthbuffer;
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depthBufferParam.attachment, gl.RENDERBUFFER, depthbuffer);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            return renderTarget;
        }
        createRenderTargetCubeInternal(size, colorFormat, depthStencilFormat, generateMipmap, sRGB, multiSamples) {
            multiSamples = 1;
            let texture = this.createRenderTextureCubeInternal(Laya.TextureDimension.Cube, size, colorFormat, generateMipmap, sRGB);
            let renderTarget = this._assembleLayeredRT(texture, size, size, colorFormat, depthStencilFormat, true);
            renderTarget.gpuMemory = this.getGLRTTexMemory(size, size, colorFormat, depthStencilFormat, generateMipmap, multiSamples, true);
            return renderTarget;
        }
        _assembleLayeredRT(colorTex, width, height, colorFormat, depthStencilFormat, isCube) {
            let gl = this._gl;
            depthStencilFormat = depthStencilFormat == null ? Laya.RenderTargetFormat.None : depthStencilFormat;
            let renderTarget = new WebGLInternalRT(this._engine, colorFormat, depthStencilFormat, isCube, colorTex.mipmap, 1);
            renderTarget.colorFormat = colorFormat;
            renderTarget.depthStencilFormat = depthStencilFormat;
            renderTarget._textures.push(colorTex);
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget._framebuffer);
            let depthBufferParam = this.glRenderBufferParam(depthStencilFormat, false);
            if (depthBufferParam) {
                let depthbuffer = this.createRenderbuffer(width, height, depthBufferParam.internalFormat, renderTarget._samples);
                renderTarget._depthbuffer = depthbuffer;
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depthBufferParam.attachment, gl.RENDERBUFFER, depthbuffer);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            return renderTarget;
        }
        createRenderbuffer(width, height, internalFormat, samples) {
            let gl = this._gl;
            let renderbuffer = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
            gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
            gl.bindRenderbuffer(gl.RENDERBUFFER, null);
            return renderbuffer;
        }
        createRenderTextureInternal(dimension, width, height, format, generateMipmap, sRGB) {
            let useSRGBExt = false;
            generateMipmap = generateMipmap && this.supportGenerateMipmap(format);
            let gammaCorrection = 1.0;
            let target = this.getTarget(dimension);
            let internalTex = new WebGLInternalTex(this._engine, target, width, height, 1, dimension, generateMipmap, useSRGBExt, gammaCorrection);
            let glParam = this.glRenderTextureParam(format, useSRGBExt);
            internalTex.internalFormat = glParam.internalFormat;
            internalTex.format = glParam.format;
            internalTex.type = glParam.type;
            let internalFormat = internalTex.internalFormat;
            let glFormat = internalTex.format;
            let type = internalTex.type;
            let gl = internalTex._gl;
            this._engine._bindTexture(internalTex.target, internalTex.resource);
            gl.texImage2D(target, 0, internalFormat, width, height, 0, glFormat, type, null);
            this._engine._bindTexture(internalTex.target, null);
            if (format == Laya.RenderTargetFormat.DEPTH_16 || format == Laya.RenderTargetFormat.DEPTH_32 || format == Laya.RenderTargetFormat.DEPTHSTENCIL_24_8) {
                internalTex.filterMode = Laya.FilterMode.Point;
            }
            return internalTex;
        }
        createRenderTargetDepthTexture(renderTarget, dimension, width, height) {
            if (renderTarget._owner)
                throw new Error("Cannot replace the borrowed depth/stencil attachment of an MRT color-0 target.");
            if (renderTarget.colorFormats)
                return this._createMRTDepthTexture(renderTarget, dimension, width, height);
            let gl = renderTarget._gl;
            if (renderTarget.depthStencilFormat == Laya.RenderTargetFormat.None) {
                return null;
            }
            let depthbuffer = renderTarget._depthbuffer;
            depthbuffer && gl.deleteRenderbuffer(depthbuffer);
            renderTarget._depthbuffer = null;
            let format = renderTarget.depthStencilFormat;
            let mipmap = renderTarget._generateMipmap;
            let sRGB = renderTarget.isSRGB;
            if (renderTarget._depthTexture) {
                gl.deleteTexture(renderTarget._depthTexture);
            }
            let texture = this.createRenderTextureInternal(dimension, width, height, format, mipmap, sRGB);
            renderTarget._depthTexture = texture;
            let attachment = this.glRenderTargetAttachment(renderTarget.depthStencilFormat);
            let framebuffer = renderTarget._framebuffer;
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture.resource, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            return texture;
        }
        _createMRTDepthTexture(renderTarget, dimension, width, height) {
            var _a;
            const format = renderTarget.depthStencilFormat;
            if (format === Laya.RenderTargetFormat.None)
                return null;
            if (format !== Laya.RenderTargetFormat.DEPTH_16 && format !== Laya.RenderTargetFormat.DEPTH_32 && format !== Laya.RenderTargetFormat.DEPTHSTENCIL_24_8)
                throw new Error("MRT sampleable depth requires a supported depth texture format.");
            const color = (_a = renderTarget._textures) === null || _a === void 0 ? void 0 : _a[0];
            const color0 = renderTarget._color0Target;
            if (renderTarget.destroyed || !renderTarget._framebuffer || !(color0 === null || color0 === void 0 ? void 0 : color0._framebuffer))
                throw new Error("Cannot create depth storage for a missing or destroyed MRT.");
            if (dimension !== Laya.TextureDimension.Tex2D || width !== (color === null || color === void 0 ? void 0 : color.width) || height !== (color === null || color === void 0 ? void 0 : color.height))
                throw new RangeError("MRT depth texture must match the color attachment dimensions.");
            const params = Object.assign({}, this.glRenderTextureParam(format, false));
            const attachment = this.glRenderTargetAttachment(format);
            const gl = renderTarget._gl;
            const previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
            const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
            const textureUnit = this._engine._activedTextureID - gl.TEXTURE0;
            const previousCachedTexture = this._engine._activeTextures[textureUnit];
            const oldTexture = renderTarget._depthTexture;
            const oldBuffer = renderTarget._depthbuffer;
            const targets = [renderTarget, color0];
            const texture = new WebGLInternalTex(this._engine, gl.TEXTURE_2D, width, height, 1, dimension, false, false, 1);
            let error = null;
            let attachmentChanged = false;
            if (!texture.resource)
                error = "Unable to allocate the MRT depth texture.";
            else {
                texture.internalFormat = params.internalFormat;
                texture.format = params.format;
                texture.type = params.type;
                this._engine._bindTexture(gl.TEXTURE_2D, texture.resource);
                gl.texStorage2D(gl.TEXTURE_2D, 1, texture.internalFormat, width, height);
                texture.filterMode = Laya.FilterMode.Point;
                for (const target of targets) {
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target._framebuffer);
                    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture.resource, 0);
                    attachmentChanged = true;
                    const status = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
                    if (status !== gl.FRAMEBUFFER_COMPLETE) {
                        error = `WebGL2 MRT depth framebuffer is incomplete (0x${status.toString(16)}).`;
                        break;
                    }
                }
            }
            if (error && attachmentChanged) {
                for (const target of targets) {
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target._framebuffer);
                    if (oldTexture)
                        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, oldTexture.resource, 0);
                    else
                        gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, attachment, gl.RENDERBUFFER, oldBuffer);
                }
            }
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
            gl.bindTexture(gl.TEXTURE_2D, previousTexture);
            this._engine._activeTextures[textureUnit] = previousCachedTexture;
            if (error) {
                texture.dispose();
                throw new Error(error);
            }
            for (const target of targets) {
                target._depthTexture = texture;
                target._depthbuffer = null;
            }
            oldTexture === null || oldTexture === void 0 ? void 0 : oldTexture.dispose();
            if (oldBuffer)
                gl.deleteRenderbuffer(oldBuffer);
            return texture;
        }
        readRenderTargetPixelData(renderTarget, xOffset, yOffset, width, height, out) {
            let gl = renderTarget._gl;
            this.bindRenderTarget(renderTarget);
            let frameState = gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE;
            if (!frameState) {
                this.unbindRenderTarget(renderTarget);
                return null;
            }
            switch (renderTarget.colorFormat) {
                case Laya.RenderTargetFormat.R8G8B8:
                    gl.readPixels(xOffset, yOffset, width, height, gl.RGB, gl.UNSIGNED_BYTE, out);
                    break;
                case Laya.RenderTargetFormat.R8G8B8A8:
                    gl.readPixels(xOffset, yOffset, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
                    break;
                case Laya.RenderTargetFormat.R16G16B16:
                    gl.readPixels(xOffset, yOffset, width, height, gl.RGB, gl.FLOAT, out);
                    break;
                case Laya.RenderTargetFormat.R16G16B16A16:
                    gl.readPixels(xOffset, yOffset, width, height, gl.RGBA, gl.FLOAT, out);
                    break;
                case Laya.RenderTargetFormat.R32G32B32:
                    gl.readPixels(xOffset, yOffset, width, height, gl.RGB, gl.FLOAT, out);
                    break;
                case Laya.RenderTargetFormat.R32G32B32A32:
                    gl.readPixels(xOffset, yOffset, width, height, gl.RGBA, gl.FLOAT, out);
                    break;
            }
            this.unbindRenderTarget(renderTarget);
            return out;
        }
        readRenderTargetPixelDataAsync(renderTarget, xOffset, yOffset, width, height, out, attachmentIndex = 0) {
            if (attachmentIndex !== 0)
                return Promise.reject(new Error("WebGL readRenderTargetPixelDataAsync currently only supports color attachment 0."));
            return Promise.resolve(this.readRenderTargetPixelData(renderTarget, xOffset, yOffset, width, height, out));
        }
        updateVideoTexture(texture, video, premultiplyAlpha, invertY) {
            let gl = texture._gl;
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            texture.width;
            texture.height;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texImage2D(target, 0, internalFormat, format, type, video);
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
    }

    class GL2TextureContext extends GLTextureContext {
        constructor(engine) {
            super(engine);
        }
        getTarget(dimension) {
            let target = -1;
            switch (dimension) {
                case Laya.TextureDimension.Cube:
                    target = this._gl.TEXTURE_CUBE_MAP;
                    break;
                case Laya.TextureDimension.Tex2D:
                    target = this._gl.TEXTURE_2D;
                    break;
                case Laya.TextureDimension.Texture2DArray:
                    target = this._gl.TEXTURE_2D_ARRAY;
                    break;
                case Laya.TextureDimension.Tex3D:
                    target = this._gl.TEXTURE_3D;
                    break;
                default:
                    throw "Unknow Texture Target";
            }
            return target;
        }
        glTextureParam(format, useSRGB) {
            let gl = this._gl;
            this._glParam.internalFormat = null;
            this._glParam.format = null;
            this._glParam.type = null;
            switch (format) {
                case Laya.TextureFormat.Alpha8:
                    this._glParam.internalFormat = gl.R8;
                    this._glParam.format = gl.RED;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.R8G8B8:
                    this._glParam.internalFormat = useSRGB ? gl.SRGB8 : gl.RGB8;
                    this._glParam.format = gl.RGB;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.R8G8B8A8:
                    this._glParam.internalFormat = useSRGB ? gl.SRGB8_ALPHA8 : gl.RGBA8;
                    this._glParam.format = gl.RGBA;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.TextureFormat.R5G6B5:
                    this._glParam.internalFormat = gl.RGB565;
                    this._glParam.format = gl.RGB;
                    this._glParam.type = gl.UNSIGNED_SHORT_5_6_5;
                    break;
                case Laya.TextureFormat.R32G32B32A32:
                    this._glParam.internalFormat = gl.RGBA32F;
                    this._glParam.format = gl.RGBA;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.TextureFormat.R32G32B32:
                    this._glParam.internalFormat = gl.RGB32F;
                    this._glParam.format = gl.RGB;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.TextureFormat.R16G16B16:
                    this._glParam.internalFormat = gl.RGB16F;
                    this._glParam.format = gl.RGB;
                    this._glParam.type = gl.HALF_FLOAT;
                    break;
                case Laya.TextureFormat.R16G16B16A16:
                    this._glParam.internalFormat = gl.RGBA16F;
                    this._glParam.format = gl.RGBA;
                    this._glParam.type = gl.HALF_FLOAT;
                    break;
                case Laya.TextureFormat.DXT1:
                    this._glParam.internalFormat = useSRGB ? this._compressdTextureS3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT : this._compressedTextureS3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT;
                    break;
                case Laya.TextureFormat.DXT3:
                    this._glParam.internalFormat = useSRGB ? this._compressdTextureS3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT : this._compressedTextureS3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT;
                    break;
                case Laya.TextureFormat.DXT5:
                    this._glParam.internalFormat = useSRGB ? this._compressdTextureS3tc_srgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT : this._compressedTextureS3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT;
                    break;
                case Laya.TextureFormat.ETC1RGB:
                    this._glParam.internalFormat = this._compressedTextureEtc1.COMPRESSED_RGB_ETC1_WEBGL;
                    break;
                case Laya.TextureFormat.ETC2RGBA:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_RGBA8_ETC2_EAC;
                    break;
                case Laya.TextureFormat.ETC2RGB:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_RGB8_ETC2;
                    break;
                case Laya.TextureFormat.ETC2SRGB:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_SRGB8_ETC2;
                    break;
                case Laya.TextureFormat.ETC2SRGB_Alpha8:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC;
                    break;
                case Laya.TextureFormat.ETC2RGB_Alpha1:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2;
                    break;
                case Laya.TextureFormat.ETC2SRGB_Alpha1:
                    this._glParam.internalFormat = this._compressedTextureETC.COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2;
                    break;
                case Laya.TextureFormat.ASTC4x4:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_4x4_KHR;
                    break;
                case Laya.TextureFormat.ASTC6x6:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_6x6_KHR;
                    break;
                case Laya.TextureFormat.ASTC8x8:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_8x8_KHR;
                    break;
                case Laya.TextureFormat.ASTC10x10:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_10x10_KHR;
                    break;
                case Laya.TextureFormat.ASTC12x12:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_RGBA_ASTC_12x12_KHR;
                    break;
                case Laya.TextureFormat.ASTC4x4SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR;
                    break;
                case Laya.TextureFormat.ASTC6x6SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR;
                    break;
                case Laya.TextureFormat.ASTC8x8SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR;
                    break;
                case Laya.TextureFormat.ASTC10x10SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR;
                    break;
                case Laya.TextureFormat.ASTC12x12SRGB:
                    this._glParam.internalFormat = this._compressedTextureASTC.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR;
                    break;
                default:
                    throw "Unknown Texture Format.";
            }
            return this._glParam;
        }
        glRenderBufferParam(format, useSRGB) {
            let gl = this._gl;
            switch (format) {
                case Laya.RenderTargetFormat.DEPTH_16:
                    return { internalFormat: gl.DEPTH_COMPONENT16, attachment: gl.DEPTH_ATTACHMENT };
                case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                    return { internalFormat: gl.DEPTH24_STENCIL8, attachment: gl.DEPTH_STENCIL_ATTACHMENT };
                case Laya.RenderTargetFormat.DEPTH_32:
                    return { internalFormat: gl.DEPTH_COMPONENT32F, attachment: gl.DEPTH_ATTACHMENT };
                case Laya.RenderTargetFormat.STENCIL_8:
                    return { internalFormat: gl.STENCIL_INDEX8, attachment: gl.STENCIL_ATTACHMENT };
                case Laya.RenderTargetFormat.R8G8B8:
                    return { internalFormat: useSRGB ? gl.SRGB8 : gl.RGB8, attachment: gl.COLOR_ATTACHMENT0 };
                case Laya.RenderTargetFormat.R8G8B8A8:
                    return { internalFormat: useSRGB ? gl.SRGB8_ALPHA8 : gl.RGBA8, attachment: gl.COLOR_ATTACHMENT0 };
                case Laya.RenderTargetFormat.R16G16B16:
                    return { internalFormat: gl.RGB16F, attachment: gl.COLOR_ATTACHMENT0 };
                case Laya.RenderTargetFormat.R16G16B16A16:
                    return { internalFormat: gl.RGBA16F, attachment: gl.COLOR_ATTACHMENT0 };
                case Laya.RenderTargetFormat.R32G32B32:
                    return { internalFormat: gl.RGB32F, attachment: gl.COLOR_ATTACHMENT0 };
                case Laya.RenderTargetFormat.R32G32B32A32:
                    return { internalFormat: gl.RGBA32F, attachment: gl.COLOR_ATTACHMENT0 };
                default:
                    return null;
            }
        }
        glRenderTextureParam(format, useSRGB) {
            let gl = this._gl;
            this._glParam.internalFormat = null;
            this._glParam.format = null;
            this._glParam.type = null;
            switch (format) {
                case Laya.RenderTargetFormat.R8G8B8:
                    this._glParam.internalFormat = useSRGB ? gl.SRGB8 : gl.RGB8;
                    this._glParam.format = gl.RGB;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.RenderTargetFormat.R8G8B8A8:
                    this._glParam.internalFormat = useSRGB ? gl.SRGB8_ALPHA8 : gl.RGBA8;
                    this._glParam.format = gl.RGBA;
                    this._glParam.type = gl.UNSIGNED_BYTE;
                    break;
                case Laya.RenderTargetFormat.R16G16B16:
                    this._glParam.internalFormat = gl.RGB16F;
                    this._glParam.format = gl.RGB;
                    this._glParam.type = gl.HALF_FLOAT;
                    break;
                case Laya.RenderTargetFormat.R16G16B16A16:
                    this._glParam.internalFormat = gl.RGBA16F;
                    this._glParam.format = gl.RGBA;
                    this._glParam.type = gl.HALF_FLOAT;
                    break;
                case Laya.RenderTargetFormat.R32G32B32:
                    this._glParam.internalFormat = gl.RGB32F;
                    this._glParam.format = gl.RGB;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.RenderTargetFormat.R32G32B32A32:
                    this._glParam.internalFormat = gl.RGBA32F;
                    this._glParam.format = gl.RGBA;
                    this._glParam.type = gl.FLOAT;
                    break;
                case Laya.RenderTargetFormat.DEPTH_16:
                    this._glParam.internalFormat = gl.DEPTH_COMPONENT16;
                    this._glParam.format = gl.DEPTH_COMPONENT;
                    this._glParam.type = gl.UNSIGNED_INT;
                    break;
                case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                    this._glParam.internalFormat = gl.DEPTH24_STENCIL8;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_INT_24_8;
                    break;
                case Laya.RenderTargetFormat.DEPTH_32:
                    this._glParam.internalFormat = gl.DEPTH_COMPONENT32F;
                    this._glParam.format = this._glParam.internalFormat;
                    this._glParam.type = gl.UNSIGNED_INT;
                    break;
                case Laya.RenderTargetFormat.STENCIL_8:
                    break;
                default:
                    throw "depth texture format wrong.";
            }
            return this._glParam;
        }
        getGLtexMemory(tex, depth = 1) {
            let gl = this._gl;
            let channels = 0;
            let singlebyte = 0;
            let bytelength = 0;
            switch (tex.internalFormat) {
                case gl.R8:
                case gl.ALPHA:
                    channels = 1;
                    break;
                case gl.SRGB8:
                case gl.RGB8:
                case gl.RGB565:
                case gl.RGB32F:
                case gl.RGB16F:
                    channels = 3;
                    break;
                case gl.SRGB8_ALPHA8:
                case gl.RGBA8:
                case gl.RGBA32F:
                case gl.RGBA16F:
                    channels = 4;
                    break;
                default:
                    channels = 0;
                    break;
            }
            switch (tex.type) {
                case gl.UNSIGNED_BYTE:
                    singlebyte = 1;
                    break;
                case gl.UNSIGNED_SHORT_5_6_5:
                    singlebyte = 2 / 3;
                    break;
                case gl.FLOAT:
                    singlebyte = 4;
                    break;
                case gl.HALF_FLOAT:
                    singlebyte = 2;
                    break;
                default:
                    singlebyte = 0;
                    break;
            }
            bytelength = channels * singlebyte * tex.width * tex.height;
            if (tex.mipmap) {
                bytelength *= 1.333;
            }
            if (tex.target == gl.TEXTURE_CUBE_MAP)
                bytelength *= 6;
            else if (tex.target == gl.TEXTURE_2D)
                bytelength *= 1;
            else if (tex.target == gl.TEXTURE_2D_ARRAY)
                bytelength *= depth;
            return bytelength;
        }
        _ensureTexture3DStorage(texture, depth = texture.depth) {
            if (texture._texture3DStorageAllocated)
                return;
            let gl = this._gl;
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texStorage3D(texture.target, texture.mipmapCount, texture.internalFormat, texture.width, texture.height, depth);
            texture.gpuMemory = this.getGLtexMemory(texture, depth);
            texture._texture3DStorageAllocated = true;
        }
        supportSRGB(format, mipmap) {
            switch (format) {
                case Laya.TextureFormat.R8G8B8:
                    return this._engine.getCapable(Laya.RenderCapable.Texture_SRGB) && !mipmap;
                case Laya.TextureFormat.R8G8B8A8:
                    return this._engine.getCapable(Laya.RenderCapable.Texture_SRGB);
                case Laya.TextureFormat.DXT1:
                case Laya.TextureFormat.DXT3:
                case Laya.TextureFormat.DXT5:
                    return this._engine.getCapable(Laya.RenderCapable.COMPRESS_TEXTURE_S3TC_SRGB) && !mipmap;
                default:
                    return false;
            }
        }
        setTextureImageData(texture, source, premultiplyAlpha, invertY) {
            if (texture.width != source.width || texture.height != source.height) {
                console.warn("setTextureImageData: size not match");
            }
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let mipmapCount = texture.mipmapCount;
            let gl = this._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texStorage2D(target, mipmapCount, internalFormat, width, height);
            gl.texSubImage2D(target, 0, 0, 0, width, height, format, type, source);
            texture.gpuMemory = this.getGLtexMemory(texture);
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        setTextureSubImageData(texture, source, x, y, premultiplyAlpha, invertY) {
            let target = texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            texture.width;
            texture.height;
            texture.mipmapCount;
            let gl = this._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texSubImage2D(target, 0, x, y, source.width, source.height, format, type, source);
            texture.gpuMemory = this.getGLtexMemory(texture);
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        setTexturePixelsData(texture, source, premultiplyAlpha, invertY) {
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let mipmapCount = texture.mipmapCount;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            let gl = this._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texStorage2D(target, mipmapCount, internalFormat, width, height);
            texture.gpuMemory = this.getGLtexMemory(texture);
            if (source) {
                gl.texSubImage2D(target, 0, 0, 0, width, height, format, type, source);
                if (texture.mipmap) {
                    gl.generateMipmap(texture.target);
                }
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        createTexture3DInternal(dimension, width, height, depth, format, generateMipmap, sRGB, premultipliedAlpha) {
            let useSRGBExt = this.isSRGBFormat(format) || (sRGB && this.supportSRGB(format, generateMipmap));
            if (premultipliedAlpha) {
                useSRGBExt = false;
            }
            let gammaCorrection = 1.0;
            if (!useSRGBExt && sRGB) {
                gammaCorrection = 2.2;
            }
            let target = this.getTarget(dimension);
            let internalTex = new WebGLInternalTex(this._engine, target, width, height, depth, dimension, generateMipmap, useSRGBExt, gammaCorrection);
            let glParam = this.glTextureParam(format, useSRGBExt);
            internalTex.internalFormat = glParam.internalFormat;
            internalTex.format = glParam.format;
            internalTex.type = glParam.type;
            return internalTex;
        }
        setTexture3DImageData(texture, sources, depth, premultiplyAlpha, invertY) {
            let target = texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            texture.mipmapCount;
            let gl = this._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            this._engine._bindTexture(texture.target, texture.resource);
            this._ensureTexture3DStorage(texture, depth);
            for (let index = 0; index < depth; index++) {
                gl.texSubImage3D(target, 0, 0, 0, index, width, height, 1, format, type, sources[index]);
            }
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        setTexture3DPixelsData(texture, source, depth, premultiplyAlpha, invertY) {
            let target = texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            texture.mipmapCount;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            let gl = this._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            this._ensureTexture3DStorage(texture, depth);
            if (source) {
                gl.texSubImage3D(target, 0, 0, 0, 0, width, height, depth, format, type, source);
                if (texture.mipmap) {
                    gl.generateMipmap(texture.target);
                }
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setTexture3DSubPixelsData(texture, source, mipmapLevel, generateMipmap, xOffset, yOffset, zOffset, width, height, depth, premultiplyAlpha, invertY) {
            generateMipmap = generateMipmap && mipmapLevel == 0;
            let target = texture.target;
            texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            let gl = this._gl;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            this._ensureTexture3DStorage(texture);
            gl.texSubImage3D(target, mipmapLevel, xOffset, yOffset, zOffset, width, height, depth, format, type, source);
            if (texture.mipmap && generateMipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setTextureHDRData(texture, hdrInfo) {
            let sourceData = hdrInfo.readScanLine();
            this.setTexturePixelsData(texture, sourceData, false, false);
        }
        setTextureKTXData(texture, ktxInfo) {
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let mipmapCount = Math.min(ktxInfo.mipmapCount, texture.mipmapCount);
            let width = texture.width;
            let height = texture.height;
            texture.maxMipmapLevel = mipmapCount - 1;
            let source = ktxInfo.source;
            let compressed = ktxInfo.compress;
            let gl = this._gl;
            !compressed && gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            this._engine._bindTexture(texture.target, texture.resource);
            if (!compressed) {
                gl.texStorage2D(target, mipmapCount, internalFormat, width, height);
            }
            let mipmapWidth = width;
            let mipmapHeight = height;
            let dataOffset = ktxInfo.headerOffset + ktxInfo.bytesOfKeyValueData;
            let memory = 0;
            for (let index = 0; index < mipmapCount; index++) {
                let imageSize = new Int32Array(source, dataOffset, 1)[0];
                dataOffset += 4;
                if (compressed) {
                    let sourceData = new Uint8Array(source, dataOffset, imageSize);
                    gl.compressedTexImage2D(target, index, internalFormat, mipmapWidth, mipmapHeight, 0, sourceData);
                    memory += sourceData.byteLength;
                }
                else {
                    let pixelParams = this.getFormatPixelsParams(ktxInfo.format);
                    let typedSize = imageSize / pixelParams.typedSize;
                    let sourceData = new pixelParams.dataTypedCons(source, dataOffset, typedSize);
                    gl.texSubImage2D(target, index, 0, 0, mipmapWidth, mipmapHeight, format, type, sourceData);
                    memory += sourceData.byteLength;
                }
                dataOffset += imageSize;
                dataOffset += 3 - ((imageSize + 3) % 4);
                mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
            }
            this._engine._bindTexture(texture.target, null);
            texture.gpuMemory = memory;
        }
        setCubeImageData(texture, sources, premultiplyAlpha, invertY) {
            let gl = this._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            ];
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let mipmapCount = texture.mipmapCount;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texStorage2D(target, mipmapCount, internalFormat, width, height);
            texture.gpuMemory = this.getGLtexMemory(texture);
            for (let index = 0; index < cubeFace.length; index++) {
                let t = cubeFace[index];
                gl.texSubImage2D(t, 0, 0, 0, format, type, sources[index]);
            }
            if (texture.mipmap) {
                gl.generateMipmap(texture.target);
            }
            this._engine._bindTexture(texture.target, null);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        setCubePixelsData(texture, source, premultiplyAlpha, invertY) {
            let gl = this._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            ];
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let width = texture.width;
            let height = texture.height;
            let mipmapCount = texture.mipmapCount;
            let fourSize = width % 4 == 0;
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            gl.texStorage2D(target, mipmapCount, internalFormat, width, height);
            if (source) {
                for (let index = 0; index < cubeFace.length; index++) {
                    let t = cubeFace[index];
                    gl.texSubImage2D(t, 0, 0, 0, width, height, format, type, source[index]);
                }
                if (texture.mipmap) {
                    gl.generateMipmap(texture.target);
                }
            }
            this._engine._bindTexture(texture.target, null);
            texture.gpuMemory = this.getGLtexMemory(texture);
            premultiplyAlpha && gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            invertY && gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setCubeKTXData(texture, ktxInfo) {
            let gl = this._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
            ];
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let mipmapCount = Math.min(ktxInfo.mipmapCount, texture.mipmapCount);
            let width = texture.width;
            let height = texture.height;
            texture.maxMipmapLevel = mipmapCount - 1;
            let source = ktxInfo.source;
            let compressed = ktxInfo.compress;
            let mipmapWidth = width;
            let mipmapHeight = height;
            let dataOffset = ktxInfo.headerOffset + ktxInfo.bytesOfKeyValueData;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            if (!compressed) {
                gl.texStorage2D(target, mipmapCount, internalFormat, width, height);
            }
            let memory = 0;
            for (let index = 0; index < mipmapCount; index++) {
                let imageSize = new Int32Array(source, dataOffset, 1)[0];
                dataOffset += 4;
                for (let face = 0; face < 6; face++) {
                    let t = cubeFace[face];
                    if (compressed) {
                        let sourceData = new Uint8Array(source, dataOffset, imageSize);
                        gl.compressedTexImage2D(t, index, internalFormat, mipmapWidth, mipmapHeight, 0, sourceData);
                        memory += sourceData.byteLength;
                    }
                    else {
                        let pixelParams = this.getFormatPixelsParams(ktxInfo.format);
                        let typedSize = imageSize / pixelParams.typedSize;
                        let sourceData = new pixelParams.dataTypedCons(source, dataOffset, typedSize);
                        gl.texSubImage2D(t, index, 0, 0, mipmapWidth, mipmapHeight, format, type, sourceData);
                        memory += sourceData.byteLength;
                    }
                    dataOffset += imageSize;
                    dataOffset += 3 - ((imageSize + 3) % 4);
                }
                mipmapWidth = Math.max(1, Math.floor(mipmapWidth * 0.5));
                mipmapHeight = Math.max(1, Math.floor(mipmapHeight * 0.5));
            }
            texture.gpuMemory = memory;
            this._engine._bindTexture(texture.target, null);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        getCubeKTXRGBMData(texture, ktxInfo) {
            let gl = this._gl;
            const cubeFace = [
                gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
            ];
            let target = texture.target;
            let internalFormat = texture.internalFormat;
            let format = texture.format;
            let type = texture.type;
            let mipmapCount = texture.mipmapCount;
            let width = texture.width;
            let height = texture.height;
            texture.maxMipmapLevel = mipmapCount - 1;
            let source = ktxInfo.source;
            let compressed = ktxInfo.compress;
            let mipmapWidth = width;
            let mipmapHeight = height;
            let dataOffset = ktxInfo.headerOffset + ktxInfo.bytesOfKeyValueData;
            let fourSize = width % 4 == 0 && height % 4 == 0;
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this._engine._bindTexture(texture.target, texture.resource);
            if (!compressed) {
                gl.texStorage2D(target, ktxInfo.mipmapCount, internalFormat, width, height);
            }
            let memory = 0;
            for (let index = 0; index < ktxInfo.mipmapCount; index++) {
                let imageSize = new Int32Array(source, dataOffset, 1)[0];
                dataOffset += 4;
                for (let face = 0; face < 6; face++) {
                    let t = cubeFace[face];
                    let pixelParams = this.getFormatPixelsParams(ktxInfo.format);
                    let typedSize = imageSize / pixelParams.typedSize;
                    let sourceData = new pixelParams.dataTypedCons(source, dataOffset, typedSize);
                    gl.texSubImage2D(t, index, 0, 0, mipmapWidth, mipmapHeight, format, type, sourceData);
                    memory += sourceData.byteLength;
                }
                dataOffset += imageSize;
                dataOffset += 3 - ((imageSize + 3) % 4);
            }
            mipmapWidth = Math.max(1, mipmapWidth * 0.5);
            mipmapHeight = Math.max(1, mipmapHeight * 0.5);
            texture.gpuMemory = memory;
            this._engine._bindTexture(texture.target, null);
            fourSize || gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        }
        setTextureCompareMode(texture, compareMode) {
            let gl = this._gl;
            switch (compareMode) {
                case Laya.TextureCompareMode.LEQUAL:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.GEQUAL:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.GEQUAL);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.LESS:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.LESS);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.GREATER:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.GREATER);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.EQUAL:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.EQUAL);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.NOTEQUAL:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.NOTEQUAL);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.ALWAYS:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.ALWAYS);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.NEVER:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.NEVER);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
                    break;
                case Laya.TextureCompareMode.None:
                default:
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
                    texture._setTexParameteri(gl.TEXTURE_COMPARE_MODE, gl.NONE);
                    break;
            }
            return compareMode;
        }
        createRenderbuffer(width, height, internalFormat, samples) {
            let gl = this._gl;
            let renderbuffer = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
            if (samples > 1) {
                gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internalFormat, width, height);
            }
            else {
                gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
            }
            gl.bindRenderbuffer(gl.RENDERBUFFER, null);
            return renderbuffer;
        }
        createRenderTextureInternal(dimension, width, height, format, generateMipmap, sRGB) {
            generateMipmap = generateMipmap && this.supportGenerateMipmap(format);
            let useSRGBExt = this.isSRGBFormat(format) || (sRGB && this.supportSRGB(format, generateMipmap));
            let gammaCorrection = 1.0;
            let target = this.getTarget(dimension);
            let internalTex = new WebGLInternalTex(this._engine, target, width, height, 1, dimension, generateMipmap, useSRGBExt, gammaCorrection);
            let glParam = this.glRenderTextureParam(format, useSRGBExt);
            internalTex.internalFormat = glParam.internalFormat;
            internalTex.format = glParam.format;
            internalTex.type = glParam.type;
            let internalFormat = internalTex.internalFormat;
            internalTex.format;
            internalTex.type;
            let gl = this._gl;
            this._engine._bindTexture(internalTex.target, internalTex.resource);
            gl.texStorage2D(target, internalTex.mipmapCount, internalFormat, width, height);
            this._engine._bindTexture(internalTex.target, null);
            if (format == Laya.RenderTargetFormat.DEPTH_16 || format == Laya.RenderTargetFormat.DEPTH_32 || format == Laya.RenderTargetFormat.DEPTHSTENCIL_24_8) {
                internalTex.filterMode = Laya.FilterMode.Point;
            }
            return internalTex;
        }
        createMultiRenderTargetInternal(width, height, colorFormats, depthStencilFormat, color0SRGB = false) {
            const gl = this._gl;
            if (!this._engine.getCapable(Laya.RenderCapable.MRT))
                throw new Error("WebGL2 MRT is not supported by this engine.");
            const maxSize = this._engine.getParams(Laya.RenderParams.MAX_Texture_Size);
            if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > maxSize || height > maxSize)
                throw new RangeError(`MRT dimensions must be positive integers no greater than ${maxSize}.`);
            const maxCount = this._engine.getParams(Laya.RenderParams.Max_Color_Attachment_Count);
            if (!Array.isArray(colorFormats) || colorFormats.length < 1 || colorFormats.length > maxCount)
                throw new RangeError(`MRT requires between 1 and ${maxCount} color attachments.`);
            const formats = Array.from(colorFormats, format => format !== null && format !== void 0 ? format : null);
            if (formats[0] == null)
                throw new Error("MRT color attachment 0 cannot be empty.");
            const colorParams = formats.map((format, index) => {
                if (format === null)
                    return null;
                const useSRGB = index === 0 && (this.isSRGBFormat(format) || (color0SRGB && this.supportSRGB(format, false)));
                const params = this.glRenderTextureParam(format, useSRGB);
                if (params.format !== gl.RGB && params.format !== gl.RGBA)
                    throw new Error(`Invalid WebGL2 MRT color format: ${format}.`);
                return Object.assign(Object.assign({}, params), { useSRGB });
            });
            switch (depthStencilFormat) {
                case Laya.RenderTargetFormat.None:
                case Laya.RenderTargetFormat.DEPTH_16:
                case Laya.RenderTargetFormat.DEPTH_32:
                case Laya.RenderTargetFormat.DEPTHSTENCIL_24_8:
                case Laya.RenderTargetFormat.STENCIL_8:
                    break;
                default:
                    throw new Error(`Unsupported WebGL2 MRT depth/stencil format: ${depthStencilFormat}.`);
            }
            const depthParams = this.glRenderBufferParam(depthStencilFormat, false);
            if (depthParams) {
                const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
                if (width > maxRenderbufferSize || height > maxRenderbufferSize)
                    throw new RangeError(`MRT depth/stencil dimensions exceed ${maxRenderbufferSize}.`);
            }
            let memory = this.getGLRTTexMemory(width, height, Laya.RenderTargetFormat.None, depthStencilFormat, false, 1, false);
            for (const format of formats)
                if (format !== null)
                    memory += this.getGLRTTexMemory(width, height, format, Laya.RenderTargetFormat.None, false, 1, false);
            const previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
            const previousRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
            const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
            const textureUnit = this._engine._activedTextureID - gl.TEXTURE0;
            const previousCachedTexture = this._engine._activeTextures[textureUnit];
            const renderTarget = new WebGLInternalRT(this._engine, formats[0], depthStencilFormat, false, false, 1, formats);
            renderTarget.isSRGB = colorParams[0].useSRGB;
            let error = null;
            if (!renderTarget._framebuffer)
                error = "Unable to allocate the MRT framebuffer.";
            else {
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, renderTarget._framebuffer);
                const drawBuffers = [];
                for (let i = 0; i < formats.length; i++) {
                    const params = colorParams[i];
                    if (!params) {
                        renderTarget._textures.push(null);
                        drawBuffers.push(gl.NONE);
                        continue;
                    }
                    const texture = new WebGLInternalTex(this._engine, gl.TEXTURE_2D, width, height, 1, Laya.TextureDimension.Tex2D, false, params.useSRGB, 1);
                    renderTarget._textures.push(texture);
                    if (!texture.resource) {
                        error = `Unable to allocate MRT color attachment ${i}.`;
                        break;
                    }
                    texture.internalFormat = params.internalFormat;
                    texture.format = params.format;
                    texture.type = params.type;
                    this._engine._bindTexture(gl.TEXTURE_2D, texture.resource);
                    gl.texStorage2D(gl.TEXTURE_2D, 1, texture.internalFormat, width, height);
                    const attachment = gl.COLOR_ATTACHMENT0 + i;
                    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture.resource, 0);
                    drawBuffers.push(attachment);
                }
                if (!error && depthParams) {
                    renderTarget._depthbuffer = gl.createRenderbuffer();
                    if (!renderTarget._depthbuffer)
                        error = "Unable to allocate MRT depth/stencil storage.";
                    else {
                        gl.bindRenderbuffer(gl.RENDERBUFFER, renderTarget._depthbuffer);
                        gl.renderbufferStorage(gl.RENDERBUFFER, depthParams.internalFormat, width, height);
                        gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, depthParams.attachment, gl.RENDERBUFFER, renderTarget._depthbuffer);
                    }
                }
                if (!error) {
                    gl.drawBuffers(drawBuffers);
                    const status = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
                    if (status !== gl.FRAMEBUFFER_COMPLETE)
                        error = `WebGL2 MRT framebuffer is incomplete (0x${status.toString(16)}).`;
                    else
                        error = this._createMRTColor0Target(renderTarget);
                }
            }
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
            gl.bindRenderbuffer(gl.RENDERBUFFER, previousRenderbuffer);
            gl.bindTexture(gl.TEXTURE_2D, previousTexture);
            this._engine._activeTextures[textureUnit] = previousCachedTexture;
            if (error) {
                renderTarget.dispose();
                throw new Error(error);
            }
            renderTarget.gpuMemory = memory;
            return renderTarget;
        }
        _createMRTColor0Target(owner) {
            const gl = this._gl;
            const target = new WebGLInternalRT(this._engine, owner.colorFormat, owner.depthStencilFormat, false, false, 1);
            owner._color0Target = target;
            target._owner = owner;
            target._textures.push(owner._textures[0]);
            target._depthTexture = owner._depthTexture;
            target._depthbuffer = owner._depthbuffer;
            target.isSRGB = owner.isSRGB;
            if (!target._framebuffer)
                return "Unable to allocate the MRT color-0 framebuffer.";
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target._framebuffer);
            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target._textures[0].resource, 0);
            if (owner.depthStencilFormat !== Laya.RenderTargetFormat.None) {
                const attachment = this.glRenderTargetAttachment(owner.depthStencilFormat);
                if (owner._depthTexture)
                    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, owner._depthTexture.resource, 0);
                else
                    gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, attachment, gl.RENDERBUFFER, owner._depthbuffer);
            }
            gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
            const status = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
            return status === gl.FRAMEBUFFER_COMPLETE ? null
                : `WebGL2 MRT color-0 framebuffer is incomplete (0x${status.toString(16)}).`;
        }
        createRenderTargetInternal(width, height, colorFormat, depthStencilFormat, generateMipmap, sRGB, multiSamples, storage) {
            let texture = this.createRenderTextureInternal(Laya.TextureDimension.Tex2D, width, height, colorFormat, generateMipmap, sRGB);
            let renderTarget = new WebGLInternalRT(this._engine, colorFormat, depthStencilFormat, false, texture.mipmap, multiSamples);
            renderTarget.gpuMemory = this.getGLRTTexMemory(width, height, colorFormat, depthStencilFormat, generateMipmap, multiSamples, false);
            renderTarget._textures.push(texture);
            let gl = renderTarget._gl;
            if (renderTarget._samples > 1) {
                let msaaFramebuffer = renderTarget._msaaFramebuffer;
                let renderbufferParam = this.glRenderBufferParam(colorFormat, sRGB);
                let msaaRenderbuffer = renderTarget._msaaRenderbuffer = this.createRenderbuffer(width, height, renderbufferParam.internalFormat, renderTarget._samples);
                gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFramebuffer);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, renderbufferParam.attachment, gl.RENDERBUFFER, msaaRenderbuffer);
                let depthBufferParam = this.glRenderBufferParam(depthStencilFormat, false);
                if (depthBufferParam) {
                    let depthbuffer = this.createRenderbuffer(width, height, depthBufferParam.internalFormat, renderTarget._samples);
                    renderTarget._depthbuffer = depthbuffer;
                    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depthBufferParam.attachment, gl.RENDERBUFFER, depthbuffer);
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
                let framebuffer = renderTarget._framebuffer;
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                let colorAttachment = this.glRenderTargetAttachment(colorFormat);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, colorAttachment, gl.TEXTURE_2D, texture.resource, 0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            }
            else {
                let framebuffer = renderTarget._framebuffer;
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                let colorAttachment = this.glRenderTargetAttachment(colorFormat);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, colorAttachment, gl.TEXTURE_2D, texture.resource, 0);
                let depthBufferParam = this.glRenderBufferParam(depthStencilFormat, false);
                if (depthBufferParam) {
                    let depthbuffer = this.createRenderbuffer(width, height, depthBufferParam.internalFormat, renderTarget._samples);
                    renderTarget._depthbuffer = depthbuffer;
                    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depthBufferParam.attachment, gl.RENDERBUFFER, depthbuffer);
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            }
            return renderTarget;
        }
        createRenderTargetCubeInternal(size, colorFormat, depthStencilFormat, generateMipmap, sRGB, multiSamples) {
            let texture = this.createRenderTextureCubeInternal(Laya.TextureDimension.Cube, size, colorFormat, generateMipmap, sRGB);
            let renderTarget = new WebGLInternalRT(this._engine, colorFormat, depthStencilFormat, true, texture.mipmap, multiSamples);
            renderTarget.gpuMemory = this.getGLRTTexMemory(size, size, colorFormat, depthStencilFormat, generateMipmap, multiSamples, true);
            renderTarget.colorFormat = colorFormat;
            renderTarget.depthStencilFormat = depthStencilFormat;
            renderTarget._textures.push(texture);
            renderTarget.isSRGB = sRGB;
            let gl = renderTarget._gl;
            if (renderTarget._samples > 1) {
                let msaaFramebuffer = renderTarget._msaaFramebuffer;
                let renderbufferParam = this.glRenderBufferParam(colorFormat, false);
                let msaaRenderbuffer = renderTarget._msaaRenderbuffer = this.createRenderbuffer(size, size, renderbufferParam.internalFormat, renderTarget._samples);
                gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFramebuffer);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, renderbufferParam.attachment, gl.RENDERBUFFER, msaaRenderbuffer);
                let depthBufferParam = this.glRenderBufferParam(depthStencilFormat, false);
                if (depthBufferParam) {
                    let depthbuffer = this.createRenderbuffer(size, size, depthBufferParam.internalFormat, renderTarget._samples);
                    renderTarget._depthbuffer = depthbuffer;
                    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depthBufferParam.attachment, gl.RENDERBUFFER, depthbuffer);
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            }
            else {
                let framebuffer = renderTarget._framebuffer;
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                let depthBufferParam = this.glRenderBufferParam(depthStencilFormat, false);
                if (depthBufferParam) {
                    let depthbuffer = this.createRenderbuffer(size, size, depthBufferParam.internalFormat, renderTarget._samples);
                    renderTarget._depthbuffer = depthbuffer;
                    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depthBufferParam.attachment, gl.RENDERBUFFER, depthbuffer);
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            }
            return renderTarget;
        }
        createRenderTextureCubeInternal(dimension, size, format, generateMipmap, sRGB) {
            generateMipmap = generateMipmap && this.supportGenerateMipmap(format);
            let useSRGBExt = this.isSRGBFormat(format) || (sRGB && this.supportSRGB(format, generateMipmap));
            let gammaCorrection = 1.0;
            let target = this.getTarget(dimension);
            let internalTex = new WebGLInternalTex(this._engine, target, size, size, 1, dimension, generateMipmap, useSRGBExt, gammaCorrection);
            let glParam = this.glRenderTextureParam(format, useSRGBExt);
            internalTex.internalFormat = glParam.internalFormat;
            internalTex.format = glParam.format;
            internalTex.type = glParam.type;
            let internalFormat = internalTex.internalFormat;
            internalTex.format;
            internalTex.type;
            let gl = this._gl;
            this._engine._bindTexture(internalTex.target, internalTex.resource);
            gl.texStorage2D(target, internalTex.mipmapCount, internalFormat, size, size);
            this._engine._bindTexture(internalTex.target, null);
            return internalTex;
        }
        createRenderTextureArrayInternal(width, height, depth, format, generateMipmap, sRGB) {
            let useSRGBExt = false;
            generateMipmap = generateMipmap && this.supportGenerateMipmap(format);
            let target = this._gl.TEXTURE_2D_ARRAY;
            let internalTex = new WebGLInternalTex(this._engine, target, width, height, depth, Laya.TextureDimension.Texture2DArray, generateMipmap, useSRGBExt, 1.0);
            let glParam = this.glRenderTextureParam(format, useSRGBExt);
            internalTex.internalFormat = glParam.internalFormat;
            internalTex.format = glParam.format;
            internalTex.type = glParam.type;
            return internalTex;
        }
        createRenderTargetArrayInternal(width, height, depth, colorFormat, depthStencilFormat, generateMipmap, sRGB, multiSamples) {
            if (multiSamples > 1) {
                throw "createRenderTargetArrayInternal: MSAA for Texture2DArray RT is not implemented yet.";
            }
            let texture = this.createRenderTextureArrayInternal(width, height, depth, colorFormat, generateMipmap, sRGB);
            this._ensureTexture3DStorage(texture, depth);
            this._engine._bindTexture(texture.target, null);
            let renderTarget = this._assembleLayeredRT(texture, width, height, colorFormat, depthStencilFormat, false);
            renderTarget.isSRGB = sRGB;
            texture.gpuMemory = this.getGLtexMemory(texture, depth);
            renderTarget.gpuMemory = this.getGLRTTexMemory(width, height, Laya.RenderTargetFormat.None, depthStencilFormat, false, 1, false);
            return renderTarget;
        }
        bindRenderTarget(renderTarget, slice = 0) {
            if (!renderTarget || renderTarget.destroyed || !renderTarget._framebuffer)
                throw new Error("Cannot bind a missing or destroyed WebGL render target.");
            if (renderTarget.colorFormats && slice !== 0)
                throw new RangeError("WebGL2 MRT only supports 2D attachments at mip level 0.");
            this.currentActiveRT && this.unbindRenderTarget(this.currentActiveRT);
            let gl = this._gl;
            let head = renderTarget._textures[0];
            let needReattach = renderTarget._isCube || head.target === gl.TEXTURE_2D_ARRAY;
            if (needReattach) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget._framebuffer);
                let bufs = [];
                for (let i = 0; i < renderTarget._textures.length; i++) {
                    let tex = renderTarget._textures[i];
                    if (!tex) {
                        bufs.push(gl.NONE);
                        continue;
                    }
                    let attach = gl.COLOR_ATTACHMENT0 + i;
                    if (renderTarget._isCube)
                        gl.framebufferTexture2D(gl.FRAMEBUFFER, attach, gl.TEXTURE_CUBE_MAP_POSITIVE_X + slice, tex.resource, 0);
                    else
                        gl.framebufferTextureLayer(gl.FRAMEBUFFER, attach, tex.resource, 0, slice);
                    bufs.push(attach);
                }
                if (bufs.length > 1)
                    gl.drawBuffers(bufs);
                if (head.target === gl.TEXTURE_2D_ARRAY)
                    renderTarget._arrayLayerIndex = slice;
            }
            if (renderTarget._samples > 1) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget._msaaFramebuffer);
            }
            else {
                gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget._framebuffer);
            }
            this.currentActiveRT = renderTarget;
        }
        async readRenderTargetPixelDataAsync(renderTarget, xOffset, yOffset, width, height, out, attachmentIndex = 0) {
            if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0)
                throw new RangeError("Color attachment index must be a non-negative integer.");
            if (!renderTarget || renderTarget.destroyed)
                throw new Error("Cannot read a missing or destroyed WebGL render target.");
            if (!renderTarget.colorFormats)
                return super.readRenderTargetPixelDataAsync(renderTarget, xOffset, yOffset, width, height, out, attachmentIndex);
            const gl = this._gl;
            if (renderTarget._gl !== gl || !renderTarget._framebuffer)
                throw new Error("MRT does not belong to this WebGL context or has no framebuffer.");
            if (attachmentIndex >= renderTarget.colorFormats.length)
                throw new RangeError(`MRT color attachment index out of range: ${attachmentIndex}.`);
            const texture = renderTarget._textures[attachmentIndex];
            if (!texture)
                throw new Error(`MRT color attachment ${attachmentIndex} is empty.`);
            if (!texture.resource || renderTarget._samples !== 1)
                throw new Error("MRT readback requires a valid single-sampled color attachment.");
            if (!Number.isInteger(xOffset) || !Number.isInteger(yOffset) || !Number.isInteger(width) || !Number.isInteger(height)
                || xOffset < 0 || yOffset < 0 || width <= 0 || height <= 0 || xOffset + width > texture.width || yOffset + height > texture.height)
                throw new RangeError("MRT readback rectangle must be positive-sized and within the attachment.");
            const textureType = texture.type;
            let type;
            let byteLength;
            if (textureType === gl.UNSIGNED_BYTE) {
                if (!(out instanceof Uint8Array) && !(out instanceof Uint8ClampedArray))
                    throw new TypeError("RGBA8 MRT readback requires Uint8Array or Uint8ClampedArray.");
                type = gl.UNSIGNED_BYTE;
                byteLength = width * height * 4;
            }
            else if (textureType === gl.HALF_FLOAT || textureType === gl.FLOAT) {
                if (!(out instanceof Float32Array))
                    throw new TypeError("Floating-point MRT readback requires Float32Array.");
                type = gl.FLOAT;
                byteLength = width * height * 16;
            }
            else {
                throw new Error(`Unsupported MRT readback texture type: ${textureType}.`);
            }
            if (out.byteLength < byteLength)
                throw new RangeError(`MRT readback output requires at least ${byteLength} bytes.`);
            const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderTarget._framebuffer);
            if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
                throw new Error("Cannot read an incomplete MRT framebuffer.");
            }
            const previousReadBuffer = gl.getParameter(gl.READ_BUFFER);
            const previousPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
            const packParams = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS];
            const packValues = packParams.map(param => gl.getParameter(param));
            gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachmentIndex);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
            gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
            gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
            gl.readPixels(xOffset, yOffset, width, height, gl.RGBA, type, out);
            gl.readBuffer(previousReadBuffer);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPackBuffer);
            for (let i = 0; i < packParams.length; i++)
                gl.pixelStorei(packParams[i], packValues[i]);
            return out;
        }
        unbindRenderTarget(renderTarget) {
            let gl = this._gl;
            if (renderTarget && renderTarget._samples > 1) {
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderTarget._msaaFramebuffer);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, renderTarget._framebuffer);
                let texture = renderTarget._textures[0];
                let biltMask = gl.COLOR_BUFFER_BIT;
                if (renderTarget._depthTexture) {
                    biltMask |= gl.DEPTH_BUFFER_BIT;
                }
                gl.blitFramebuffer(0, 0, texture.width, texture.height, 0, 0, texture.width, texture.height, biltMask, gl.NEAREST);
            }
            if (renderTarget && renderTarget._generateMipmap) {
                renderTarget._textures.forEach(tex => {
                    if (!tex)
                        return;
                    let target = tex.target;
                    this._engine._bindTexture(target, tex.resource);
                    gl.generateMipmap(target);
                    this._engine._bindTexture(target, null);
                });
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, WebGLEngine._lastFrameBuffer_WebGLOBJ);
            this.currentActiveRT = WebGLEngine._lastFrameBuffer;
        }
    }

    class GLBuffer extends GLObject {
        constructor(engine, targetType, bufferUsageType) {
            super(engine);
            this._byteLength = 0;
            this._glTargetType = targetType;
            this._glBufferUsageType = bufferUsageType;
            this._getGLTarget(this._glTargetType);
            this._getGLUsage(this._glBufferUsageType);
            this._glBuffer = this._gl.createBuffer();
            switch (targetType) {
                case Laya.BufferTargetType.ARRAY_BUFFER:
                    this._statistics_M_Buffer = Laya.StatElement.M_VertexBuffer;
                    this._statistics_RC_Buffer = Laya.StatElement.C_VertexBuffer;
                    break;
                case Laya.BufferTargetType.ELEMENT_ARRAY_BUFFER:
                    this._statistics_M_Buffer = Laya.StatElement.M_IndexBuffer;
                    this._statistics_RC_Buffer = Laya.StatElement.C_IndexBuffer;
                    break;
                case Laya.BufferTargetType.UNIFORM_BUFFER:
                    this._statistics_M_Buffer = Laya.StatElement.M_UBOBuffer;
                    this._statistics_RC_Buffer = Laya.StatElement.C_UBOBuffer;
                    break;
            }
            Laya.LayaGL.statAgent.recordCountData(Laya.StatElement.C_GPUBuffer, 1);
            Laya.LayaGL.statAgent.recordCountData(this._statistics_RC_Buffer, 1);
        }
        _getGLUsage(usage) {
            switch (usage) {
                case Laya.BufferUsage.Static:
                    this._glUsage = this._gl.STATIC_DRAW;
                    break;
                case Laya.BufferUsage.Dynamic:
                    this._glUsage = this._gl.DYNAMIC_DRAW;
                    break;
                case Laya.BufferUsage.Stream:
                    this._glUsage = this._gl.STREAM_DRAW;
                    break;
                default:
                    console.error("usage is not standard");
                    break;
            }
        }
        _getGLTarget(target) {
            switch (target) {
                case Laya.BufferTargetType.ARRAY_BUFFER:
                    this._glTarget = this._gl.ARRAY_BUFFER;
                    break;
                case Laya.BufferTargetType.UNIFORM_BUFFER:
                    this._glTarget = this._gl.UNIFORM_BUFFER;
                    break;
                case Laya.BufferTargetType.ELEMENT_ARRAY_BUFFER:
                    this._glTarget = this._gl.ELEMENT_ARRAY_BUFFER;
                    break;
            }
        }
        _memorychange(bytelength) {
            Laya.LayaGL.statAgent.recordMemoryData(Laya.StatElement.M_GPUBuffer, -this._byteLength + bytelength);
            Laya.LayaGL.statAgent.recordMemoryData(Laya.StatElement.M_GPUMemory, -this._byteLength + bytelength);
            Laya.LayaGL.statAgent.recordMemoryData(this._statistics_M_Buffer, -this._byteLength + bytelength);
        }
        bindBuffer() {
            if (this._engine._getbindBuffer(this._glTargetType) != this) {
                this._gl.bindBuffer(this._glTarget, this._glBuffer);
                this._engine._setbindBuffer(this._glTargetType, this);
                return true;
            }
            return false;
        }
        unbindBuffer() {
            if (this._engine._getbindBuffer(this._glTargetType) == this) {
                this._gl.bindBuffer(this._glTarget, null);
                this._engine._setbindBuffer(this._glTargetType, null);
            }
        }
        orphanStorage() {
            this.bindBuffer();
            this.setDataLength(this._byteLength);
        }
        setDataLength(srcData) {
            let gl = this._gl;
            this.bindBuffer();
            this._memorychange(srcData);
            this._byteLength = srcData;
            gl.bufferData(this._glTarget, this._byteLength, this._glUsage);
            this.unbindBuffer();
        }
        setData(srcData, offset) {
            let gl = this._gl;
            this.bindBuffer();
            gl.bufferSubData(this._glTarget, offset, srcData);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_BufferUploadCount, 1);
            this.unbindBuffer();
        }
        setDataEx(srcData, offset, length) {
            let gl = this._gl;
            this.bindBuffer();
            gl.bufferSubData(this._glTarget, offset, srcData, 0, length);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_BufferUploadCount, 1);
            this.unbindBuffer();
        }
        bindBufferBase(glPointer) {
            const gl = this._gl;
            let bindInfo = this._engine._uboBindingMap[glPointer];
            if (bindInfo && bindInfo.buffer != this._glBuffer) {
                if (this._engine._getbindBuffer(this._glTargetType) != this) {
                    this._engine._setbindBuffer(this._glTargetType, this);
                }
                gl.bindBufferBase(this._glTarget, glPointer, this._glBuffer);
                bindInfo.buffer = this._glBuffer;
                bindInfo.offset = 0;
                bindInfo.size = this._byteLength;
            }
        }
        bindBufferRange(glPointer, offset, byteCount) {
            const gl = this._gl;
            let bindInfo = this._engine._uboBindingMap[glPointer];
            if (bindInfo) {
                if (bindInfo.buffer != this._glBuffer || bindInfo.offset != offset || bindInfo.size != byteCount) {
                    if (this._engine._getbindBuffer(this._glTargetType) != this) {
                        this._engine._setbindBuffer(this._glTargetType, this);
                    }
                    gl.bindBufferRange(this._glTarget, glPointer, this._glBuffer, offset, byteCount);
                    bindInfo.buffer = this._glBuffer;
                    bindInfo.offset = offset;
                    bindInfo.size = byteCount;
                }
            }
        }
        resizeBuffer(dataLength) {
            this.bindBuffer();
            const gl = this._gl;
            this._memorychange(dataLength);
            this._byteLength = dataLength;
            gl.bufferData(this._glTarget, this._byteLength, this._glUsage);
        }
        destroy() {
            super.destroy();
            const gl = this._gl;
            gl.deleteBuffer(this._glBuffer);
            this._memorychange(0);
            Laya.LayaGL.statAgent.recordCountData(Laya.StatElement.C_GPUBuffer, -1);
            Laya.LayaGL.statAgent.recordCountData(this._statistics_RC_Buffer, -1);
            this._byteLength = 0;
            this._engine = null;
            this._glBuffer = null;
            this._glTarget = null;
            this._glUsage = null;
            this._gl = null;
        }
    }

    exports.WebGLMode = void 0;
    (function (WebGLMode) {
        WebGLMode[WebGLMode["Auto"] = 0] = "Auto";
        WebGLMode[WebGLMode["WebGL2"] = 1] = "WebGL2";
        WebGLMode[WebGLMode["WebGL1"] = 2] = "WebGL1";
    })(exports.WebGLMode || (exports.WebGLMode = {}));

    class GLParams {
        constructor(engine) {
            this._engine = engine;
            this._gl = this._engine.gl;
            this._initParams();
        }
        _initParams() {
            const gl = this._gl;
            this._glParamsData = new Map();
            this._glParamsData.set(Laya.RenderParams.Max_Active_Texture_Count, gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS));
            const maxVertexUniform = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
            const maxFragUniform = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
            this._glParamsData.set(Laya.RenderParams.Max_Uniform_Count, Math.min(maxVertexUniform, maxFragUniform));
            this._glParamsData.set(Laya.RenderParams.MAX_Texture_Size, gl.getParameter(gl.MAX_TEXTURE_SIZE));
            this._glParamsData.set(Laya.RenderParams.MAX_Texture_Image_Uint, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
            if (this._engine.getCapable(Laya.RenderCapable.Texture_anisotropic)) {
                const anisoExt = this._engine._supportCapatable.getExtension(exports.WebGLExtension.EXT_texture_filter_anisotropic);
                this._glParamsData.set(Laya.RenderParams.Max_AnisoLevel_Count, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
            }
            if (this._engine.isWebGL2)
                this._glParamsData.set(Laya.RenderParams.SHADER_CAPAILITY_LEVEL, 35);
            else
                this._glParamsData.set(Laya.RenderParams.SHADER_CAPAILITY_LEVEL, 30);
            this._glParamsData.set(Laya.RenderParams.FLOAT, gl.FLOAT);
            this._glParamsData.set(Laya.RenderParams.UNSIGNED_BYTE, gl.UNSIGNED_BYTE);
            this._glParamsData.set(Laya.RenderParams.UNSIGNED_SHORT, gl.UNSIGNED_SHORT);
            this._glParamsData.set(Laya.RenderParams.BYTE, gl.BYTE);
            let maxColorAttachments = 1;
            if (this._engine.isWebGL2) {
                const gl2 = gl;
                maxColorAttachments = Math.min(gl2.getParameter(gl2.MAX_COLOR_ATTACHMENTS), gl2.getParameter(gl2.MAX_DRAW_BUFFERS));
            }
            this._glParamsData.set(Laya.RenderParams.Max_Color_Attachment_Count, maxColorAttachments);
            this._glParamsData.set(Laya.RenderParams.Max_Color_Attachment_Bytes_Per_Sample, 0);
        }
        getParams(params) {
            return this._glParamsData.get(params);
        }
    }

    class GLRenderDrawContext extends GLObject {
        constructor(engine) {
            super(engine);
            if (!this._engine.isWebGL2) {
                this._angleInstancedArrays = this._engine._supportCapatable.getExtension(exports.WebGLExtension.ANGLE_instanced_arrays);
            }
        }
        getMeshTopology(mode) {
            switch (mode) {
                case Laya.MeshTopology.Points:
                    return this._gl.POINTS;
                case Laya.MeshTopology.Lines:
                    return this._gl.LINES;
                case Laya.MeshTopology.LineLoop:
                    return this._gl.LINE_LOOP;
                case Laya.MeshTopology.LineStrip:
                    return this._gl.LINE_STRIP;
                case Laya.MeshTopology.Triangles:
                    return this._gl.TRIANGLES;
                case Laya.MeshTopology.TriangleStrip:
                    return this._gl.TRIANGLE_STRIP;
                case Laya.MeshTopology.TriangleFan:
                    return this._gl.TRIANGLE_FAN;
            }
        }
        getIndexType(type) {
            switch (type) {
                case Laya.IndexFormat.UInt8:
                    return this._gl.UNSIGNED_BYTE;
                case Laya.IndexFormat.UInt16:
                    return this._gl.UNSIGNED_SHORT;
                case Laya.IndexFormat.UInt32:
                    return this._gl.UNSIGNED_INT;
            }
        }
        drawElementsInstanced(mode, count, type, offset, instanceCount) {
            if (this._engine.isWebGL2)
                this._gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
            else
                this._angleInstancedArrays.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_Triangle, count / 3 * instanceCount);
        }
        drawArraysInstanced(mode, first, count, instanceCount) {
            if (this._engine.isWebGL2)
                this._gl.drawArraysInstanced(mode, first, count, instanceCount);
            else
                this._angleInstancedArrays.drawArraysInstancedANGLE(mode, first, count, instanceCount);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_Triangle, (count - 2) * instanceCount);
        }
        drawArrays(mode, first, count) {
            this._gl.drawArrays(mode, first, count);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_Triangle, (count - 2));
        }
        drawElements(mode, count, type, offset) {
            this._gl.drawElements(mode, count, type, offset);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_Triangle, count / 3);
        }
        drawGeometryElement(geometryElement) {
            geometryElement.bufferState.bind();
            let element = geometryElement.drawParams.elements;
            let length = geometryElement.drawParams.length;
            switch (geometryElement.drawType) {
                case Laya.DrawType.DrawArray:
                    for (let i = 0; i < length; i += 2) {
                        this.drawArrays(geometryElement._glmode, element[i], element[i + 1]);
                    }
                    break;
                case Laya.DrawType.DrawElement:
                    for (let i = 0; i < length; i += 2) {
                        this.drawElements(geometryElement._glmode, element[i + 1], geometryElement._glindexFormat, element[i]);
                    }
                    break;
                case Laya.DrawType.DrawArrayInstance:
                    for (let i = 0; i < length; i += 2) {
                        this.drawArraysInstanced(geometryElement._glmode, element[i], element[i + 1], geometryElement.instanceCount);
                    }
                    Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_Instancing_DrawCall, length / 2);
                    break;
                case Laya.DrawType.DrawElementInstance:
                    for (let i = 0; i < length; i += 2) {
                        this.drawElementsInstanced(geometryElement._glmode, element[i + 1], geometryElement._glindexFormat, element[i], geometryElement.instanceCount);
                    }
                    Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_Instancing_DrawCall, length / 2);
                    break;
            }
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_DrawCall, length / 2);
        }
    }

    class GLRenderState {
        constructor(engine) {
            this._engine = engine;
            this._gl = this._engine.gl;
        }
        _initState() {
            this.setDepthFunc(Laya.CompareFunction.Less);
            this.setBlendEquationSeparate(Laya.BlendEquationSeparate.ADD, Laya.BlendEquationSeparate.ADD);
            this._blendEquation = Laya.BlendEquationSeparate.ADD;
            this._sFactor = Laya.BlendFactor.One;
            this._dFactor = Laya.BlendFactor.Zero;
            this._sFactorAlpha = Laya.BlendFactor.One;
            this._dFactorAlpha = Laya.BlendFactor.One;
        }
        _getBlendFactor(factor) {
            const gl = this._gl;
            switch (factor) {
                case Laya.BlendFactor.Zero:
                    return gl.ZERO;
                case Laya.BlendFactor.One:
                    return gl.ONE;
                case Laya.BlendFactor.SourceColor:
                    return gl.SRC_COLOR;
                case Laya.BlendFactor.OneMinusSourceColor:
                    return gl.ONE_MINUS_SRC_COLOR;
                case Laya.BlendFactor.DestinationColor:
                    return gl.DST_COLOR;
                case Laya.BlendFactor.OneMinusDestinationColor:
                    return gl.ONE_MINUS_DST_COLOR;
                case Laya.BlendFactor.SourceAlpha:
                    return gl.SRC_ALPHA;
                case Laya.BlendFactor.OneMinusSourceAlpha:
                    return gl.ONE_MINUS_SRC_ALPHA;
                case Laya.BlendFactor.DestinationAlpha:
                    return gl.DST_ALPHA;
                case Laya.BlendFactor.OneMinusDestinationAlpha:
                    return gl.ONE_MINUS_DST_ALPHA;
                case Laya.BlendFactor.SourceAlphaSaturate:
                    return gl.SRC_ALPHA_SATURATE;
                case Laya.BlendFactor.BlendColor:
                    return gl.CONSTANT_COLOR;
                case Laya.BlendFactor.OneMinusBlendColor:
                    return gl.ONE_MINUS_CONSTANT_COLOR;
            }
        }
        _getBlendOperation(factor) {
            const gl = this._gl;
            switch (factor) {
                case Laya.BlendEquationSeparate.ADD:
                    return gl.FUNC_ADD;
                case Laya.BlendEquationSeparate.SUBTRACT:
                    return gl.FUNC_SUBTRACT;
                case Laya.BlendEquationSeparate.REVERSE_SUBTRACT:
                    return gl.FUNC_REVERSE_SUBTRACT;
                default:
                    throw "Unknow type";
            }
        }
        _getGLCompareFunction(compareFunction) {
            const gl = this._gl;
            switch (compareFunction) {
                case Laya.CompareFunction.Never:
                    return gl.NEVER;
                case Laya.CompareFunction.Less:
                    return gl.LESS;
                case Laya.CompareFunction.Equal:
                    return gl.EQUAL;
                case Laya.CompareFunction.LessEqual:
                    return gl.LEQUAL;
                case Laya.CompareFunction.Greater:
                    return gl.GREATER;
                case Laya.CompareFunction.NotEqual:
                    return gl.NOTEQUAL;
                case Laya.CompareFunction.GreaterEqual:
                    return gl.GEQUAL;
                case Laya.CompareFunction.Always:
                    return gl.ALWAYS;
                default:
                    return gl.LEQUAL;
            }
        }
        _getGLStencilOperation(compareFunction) {
            const gl = this._gl;
            switch (compareFunction) {
                case Laya.StencilOperation.Keep:
                    return gl.KEEP;
                case Laya.StencilOperation.Zero:
                    return gl.ZERO;
                case Laya.StencilOperation.Replace:
                    return gl.REPLACE;
                case Laya.StencilOperation.IncrementSaturate:
                    return gl.INCR;
                case Laya.StencilOperation.DecrementSaturate:
                    return gl.DECR;
                case Laya.StencilOperation.Invert:
                    return gl.INVERT;
                case Laya.StencilOperation.IncrementWrap:
                    return gl.INCR_WRAP;
                case Laya.StencilOperation.DecrementWrap:
                    return gl.DECR_WRAP;
            }
        }
        _getGLFrontfaceFactor(cullmode) {
            if (cullmode == Laya.CullMode.Front)
                return this._gl.CCW;
            else
                return this._gl.CW;
        }
        setDepthTest(value) {
            value !== this._depthTest && (this._depthTest = value, value ? this._gl.enable(this._gl.DEPTH_TEST) : this._gl.disable(this._gl.DEPTH_TEST));
        }
        setDepthMask(value) {
            value !== this._depthMask && (this._depthMask = value, this._gl.depthMask(value));
        }
        setDepthFunc(value) {
            value !== this._depthFunc && (this._depthFunc = value, this._gl.depthFunc(this._getGLCompareFunction(value)));
        }
        setStencilTest(value) {
            value !== this._stencilTest && (this._stencilTest = value, value ? this._gl.enable(this._gl.STENCIL_TEST) : this._gl.disable(this._gl.STENCIL_TEST));
        }
        setStencilWrite(value) {
            this._stencilWrite = value;
        }
        setStencilWriteMask(mask) {
            mask = this._stencilWrite ? mask : 0x00;
            if (mask !== this._stencilWriteMask) {
                this._stencilWriteMask = mask;
                this._gl.stencilMask(mask);
            }
        }
        setStencilFunc(fun, ref, mask) {
            if (fun != this._stencilFunc || ref != this._stencilRef || mask != this._stencilReadMask) {
                this._stencilFunc = fun;
                this._stencilRef = ref;
                this._stencilReadMask = mask;
                this._gl.stencilFunc(this._getGLCompareFunction(fun), ref, mask);
            }
        }
        setStencilOp(fail, zfail, zpass) {
            if (this._stencilOp_fail != fail || this._stencilOp_zfail != zfail || this._stencilOp_zpass != zpass) {
                this._stencilOp_fail = fail;
                this._stencilOp_zfail = zfail;
                this._stencilOp_zpass = zpass;
                this._gl.stencilOp(this._getGLStencilOperation(fail), this._getGLStencilOperation(zfail), this._getGLStencilOperation(zpass));
            }
        }
        setDepthBias(value) {
            if (value !== this._depthBias) {
                this._depthBias = value;
                value ? this._gl.enable(this._gl.POLYGON_OFFSET_FILL) : this._gl.disable(this._gl.POLYGON_OFFSET_FILL);
            }
        }
        setDepthBiasFactor(constantFactor, slopeFactor, clamp = 0.0) {
            if (constantFactor !== this._depthBiasConstant || slopeFactor !== this._depthBiasSlope || clamp !== this._depthBiasClamp) {
                this._depthBiasConstant = constantFactor;
                this._depthBiasSlope = slopeFactor;
                this._depthBiasClamp = clamp;
                this._gl.polygonOffset(constantFactor, slopeFactor);
            }
        }
        setBlend(value) {
            value !== this._blend && (this._blend = value, value ? this._gl.enable(this._gl.BLEND) : this._gl.disable(this._gl.BLEND));
        }
        setBlendEquation(blendEquation) {
            if (blendEquation !== this._blendEquation) {
                this._blendEquation = blendEquation;
                this._blendEquationRGB = this._blendEquationAlpha = null;
                this._gl.blendEquation(this._getBlendOperation(blendEquation));
            }
        }
        setBlendEquationSeparate(blendEquationRGB, blendEquationAlpha) {
            if (blendEquationRGB !== this._blendEquationRGB || blendEquationAlpha !== this._blendEquationAlpha) {
                this._blendEquationRGB = blendEquationRGB;
                this._blendEquationAlpha = blendEquationAlpha;
                this._blendEquation = null;
                this._gl.blendEquationSeparate(this._getBlendOperation(blendEquationRGB), this._getBlendOperation(blendEquationAlpha));
            }
        }
        setBlendFunc(sFactor, dFactor, force = false) {
            if (force || sFactor !== this._sFactor || dFactor !== this._dFactor) {
                this._sFactor = sFactor;
                this._dFactor = dFactor;
                this._sFactorRGB = null;
                this._dFactorRGB = null;
                this._sFactorAlpha = null;
                this._dFactorAlpha = null;
                this._gl.blendFunc(this._getBlendFactor(sFactor), this._getBlendFactor(dFactor));
            }
        }
        setBlendFuncSeperate(srcRGB, dstRGB, srcAlpha, dstAlpha) {
            if (srcRGB !== this._sFactorRGB || dstRGB !== this._dFactorRGB || srcAlpha !== this._sFactorAlpha || dstAlpha !== this._dFactorAlpha) {
                this._sFactorRGB = srcRGB;
                this._dFactorRGB = dstRGB;
                this._sFactorAlpha = srcAlpha;
                this._dFactorAlpha = dstAlpha;
                this._sFactor = null;
                this._dFactor = null;
                this._gl.blendFuncSeparate(this._getBlendFactor(srcRGB), this._getBlendFactor(dstRGB), this._getBlendFactor(srcAlpha), this._getBlendFactor(dstAlpha));
            }
        }
        setCullFace(value) {
            value !== this._cullFace && (this._cullFace = value, value ? this._gl.enable(this._gl.CULL_FACE) : this._gl.disable(this._gl.CULL_FACE));
        }
        setFrontFace(value) {
            value !== this._frontFace && (this._frontFace = value, this._gl.frontFace(this._getGLFrontfaceFactor(value)));
        }
        clearRenderStateCache() {
            this.renderStateCache = null;
            this.isTargetCache = null;
            this.invertFrontCache = null;
        }
        setRenderState(renderState, isTarget, invertFront) {
            if (this.isTargetCache == isTarget && this.invertFrontCache == invertFront && this.renderStateCache === renderState.hash) {
                return;
            }
            let depthWrite = renderState.depthWrite;
            this.setDepthMask(depthWrite);
            let depthTest = renderState.depthTest;
            if (depthTest == Laya.RenderState.DEPTHTEST_OFF)
                this.setDepthTest(false);
            else {
                this.setDepthTest(true);
                this.setDepthFunc(depthTest);
            }
            let stencilWrite = renderState.stencilWrite;
            this.setStencilWrite(stencilWrite);
            let stencilWriteMask = renderState.stencilWriteMask;
            this.setStencilWriteMask(stencilWriteMask);
            let stencilOp = renderState.stencilOp;
            this.setStencilOp(stencilOp.x, stencilOp.y, stencilOp.z);
            let stencilTest = renderState.stencilTest;
            if (stencilTest == Laya.RenderState.STENCILTEST_OFF) {
                this.setStencilTest(false);
            }
            else {
                this.setStencilTest(true);
                let stencilRef = renderState.stencilRef;
                let stencilReadMask = renderState.stencilReadMask;
                this.setStencilFunc(stencilTest, stencilRef, stencilReadMask);
            }
            let depthBias = renderState.depthBias;
            this.setDepthBias(depthBias);
            if (depthBias) {
                let depthBiasConstant = renderState.depthBiasConstant;
                let depthBiasSlopeScale = renderState.depthBiasSlopeScale;
                let depthBiasClamp = renderState.depthBiasClamp;
                this.setDepthBiasFactor(depthBiasConstant, depthBiasSlopeScale, depthBiasClamp);
            }
            let blend = renderState.blend;
            switch (blend) {
                case Laya.RenderState.BLEND_DISABLE:
                    this.setBlend(false);
                    break;
                case Laya.RenderState.BLEND_ENABLE_ALL:
                    let blendEquation = renderState.blendEquation;
                    let srcBlend = renderState.srcBlend;
                    let dstBlend = renderState.dstBlend;
                    this.setBlend(true);
                    this.setBlendEquation(blendEquation);
                    this.setBlendFunc(srcBlend, dstBlend);
                    break;
                case Laya.RenderState.BLEND_ENABLE_SEPERATE:
                    let blendEquationRGB = renderState.blendEquationRGB;
                    let blendEquationAlpha = renderState.blendEquationAlpha;
                    let srcRGB = renderState.srcBlendRGB;
                    let dstRGB = renderState.dstBlendRGB;
                    let srcAlpha = renderState.srcBlendAlpha;
                    let dstAlpha = renderState.dstBlendAlpha;
                    this.setBlend(true);
                    this.setBlendEquationSeparate(blendEquationRGB, blendEquationAlpha);
                    this.setBlendFuncSeperate(srcRGB, dstRGB, srcAlpha, dstAlpha);
                    break;
            }
            let cull = renderState.cull;
            let forntFace;
            switch (cull) {
                case Laya.RenderState.CULL_NONE:
                    this.setCullFace(false);
                    if (isTarget != invertFront)
                        forntFace = Laya.CullMode.Front;
                    else
                        forntFace = Laya.CullMode.Back;
                    this.setFrontFace(forntFace);
                    break;
                case Laya.RenderState.CULL_FRONT:
                    this.setCullFace(true);
                    if (isTarget == invertFront)
                        forntFace = Laya.CullMode.Front;
                    else
                        forntFace = Laya.CullMode.Back;
                    this.setFrontFace(forntFace);
                    break;
                case Laya.RenderState.CULL_BACK:
                default:
                    this.setCullFace(true);
                    if (isTarget != invertFront)
                        forntFace = Laya.CullMode.Front;
                    else
                        forntFace = Laya.CullMode.Back;
                    this.setFrontFace(forntFace);
                    break;
            }
            this.renderStateCache = renderState.hash;
            this.isTargetCache = isTarget;
            this.invertFrontCache = invertFront;
        }
    }

    class GLShaderInstance extends GLObject {
        constructor(engine, vs, ps, attributeMap) {
            super(engine);
            this._defaultTextureWarnings = new WeakMap();
            this._vs = vs;
            this._ps = ps;
            this._attributeMap = attributeMap;
            this._uniformMap = [];
            this._create();
        }
        _create() {
            WebGLEngine._lastShaderError = null;
            performance.now();
            const gl = this._gl;
            if (WebGLEngine.instance.lost) {
                return;
            }
            let prog = this._program = gl.createProgram();
            let compileErr;
            this._vshader = this._createShader(gl, this._vs, gl.VERTEX_SHADER);
            if (!gl.getShaderParameter(this._vshader, gl.COMPILE_STATUS))
                compileErr = gl.getShaderInfoLog(this._vshader);
            this._pshader = this._createShader(gl, this._ps, gl.FRAGMENT_SHADER);
            if (!gl.getShaderParameter(this._pshader, gl.COMPILE_STATUS)) {
                if (compileErr)
                    compileErr += "\n";
                compileErr += gl.getShaderInfoLog(this._pshader);
            }
            gl.attachShader(prog, this._vshader);
            gl.attachShader(prog, this._pshader);
            if (compileErr) {
                WebGLEngine._lastShaderError = compileErr;
                return;
            }
            for (var k in this._attributeMap)
                gl.bindAttribLocation(prog, this._attributeMap[k][0], k);
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                WebGLEngine._lastShaderError = gl.getProgramInfoLog(prog);
                return;
            }
            const nUniformNum = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
            this.useProgram();
            this._curActTexIndex = 0;
            let one, i;
            for (i = 0; i < nUniformNum; i++) {
                var uniformData = gl.getActiveUniform(prog, i);
                var uniName = uniformData.name;
                let location = gl.getUniformLocation(prog, uniName);
                if (!location && location != 0)
                    continue;
                one = new Laya.ShaderVariable();
                one.location = location;
                if (uniName.indexOf('[0]') > 0) {
                    one.name = uniName = uniName.substr(0, uniName.length - 3);
                    one.isArray = true;
                }
                else {
                    one.name = uniName;
                    one.isArray = false;
                }
                one.type = uniformData.type;
                this._addShaderUnifiormFun(one);
                this._uniformMap.push(one);
                one.dataOffset = this._engine.propertyNameToID(uniName);
            }
            if (this._engine.isWebGL2) {
                const gl2 = gl;
                this._uniformObjectMap = {};
                var nUniformBlock = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORM_BLOCKS);
                for (i = 0; i < nUniformBlock; i++) {
                    var uniformBlockName = gl2.getActiveUniformBlockName(this._program, i);
                    one = new Laya.ShaderVariable();
                    one.name = uniformBlockName;
                    one.isArray = false;
                    one.type = gl.UNIFORM_BUFFER;
                    one.dataOffset = this._engine.propertyNameToID(uniformBlockName);
                    let location = one.location = gl2.getUniformBlockIndex(prog, uniformBlockName);
                    let bindingPoint = i;
                    gl2.uniformBlockBinding(this._program, location, bindingPoint);
                    this._uniformObjectMap[one.name] = one;
                    this._uniformMap.push(one);
                    this._addShaderUnifiormFun(one);
                }
            }
            this._complete = true;
        }
        _createShader(gl, str, type) {
            let shader = gl.createShader(type);
            gl.shaderSource(shader, str);
            gl.compileShader(shader);
            return shader;
        }
        _addShaderUnifiormFun(one) {
            var gl = this._gl;
            one.caller = this;
            var isArray = one.isArray;
            switch (one.type) {
                case gl.BOOL:
                    one.fun = this._uniform1i;
                    one.uploadedValue = new Array(1);
                    break;
                case gl.INT:
                    one.fun = isArray ? this._uniform1iv : this._uniform1i;
                    one.uploadedValue = new Array(1);
                    break;
                case gl.FLOAT:
                    one.fun = isArray ? this._uniform1fv : this._uniform1f;
                    one.uploadedValue = new Array(1);
                    break;
                case gl.FLOAT_VEC2:
                    one.fun = isArray ? this._uniform_vec2v : this._uniform_vec2;
                    one.uploadedValue = new Array(2);
                    break;
                case gl.FLOAT_VEC3:
                    one.fun = isArray ? this._uniform_vec3v : this._uniform_vec3;
                    one.uploadedValue = new Array(3);
                    break;
                case gl.FLOAT_VEC4:
                    one.fun = isArray ? this._uniform_vec4v : this._uniform_vec4;
                    one.uploadedValue = new Array(4);
                    break;
                case gl.FLOAT_MAT2:
                    one.fun = this._uniformMatrix2fv;
                    break;
                case gl.FLOAT_MAT3:
                    one.fun = isArray ? this._uniformMatrix3fv : this._uniformMatrix3f;
                    break;
                case gl.FLOAT_MAT4:
                    one.fun = isArray ? this._uniformMatrix4fv : this._uniformMatrix4f;
                    break;
                case gl.SAMPLER_2D:
                case gl.SAMPLER_2D_SHADOW:
                    gl.uniform1i(one.location, this._curActTexIndex);
                    one.textureID = this._engine._glTextureIDParams[this._curActTexIndex++];
                    one.fun = this._uniform_sampler2D;
                    break;
                case gl.SAMPLER_2D_ARRAY:
                    gl.uniform1i(one.location, this._curActTexIndex);
                    one.textureID = this._engine._glTextureIDParams[this._curActTexIndex++];
                    one.fun = this._uniform_sampler2DArray;
                    break;
                case 0x8b5f:
                    gl.uniform1i(one.location, this._curActTexIndex);
                    one.textureID = this._engine._glTextureIDParams[this._curActTexIndex++];
                    one.fun = this._uniform_sampler3D;
                    break;
                case gl.SAMPLER_CUBE:
                    gl.uniform1i(one.location, this._curActTexIndex);
                    one.textureID = this._engine._glTextureIDParams[this._curActTexIndex++];
                    one.fun = this._uniform_samplerCube;
                    break;
                case gl.UNIFORM_BUFFER:
                    one.fun = this._uniform_UniformBuffer;
                    break;
                default:
                    WebGLEngine._lastShaderError = `unknown uniform type (${one.type})`;
            }
        }
        getUniformMap() {
            return this._uniformMap;
        }
        bind() {
            return this.useProgram();
        }
        useProgram() {
            if (this._engine._glUseProgram === this)
                return false;
            this._gl.useProgram(this._program);
            this._engine._glUseProgram = this;
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_ShaderChange, 1);
            return true;
        }
        _uniform1f(one, value) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== value) {
                this._gl.uniform1f(one.location, uploadedValue[0] = value);
                return 1;
            }
            return 0;
        }
        _uniform1fv(one, value) {
            if (value.length < 4) {
                var uploadedValue = one.uploadedValue;
                if (uploadedValue[0] !== value[0] || uploadedValue[1] !== value[1] || uploadedValue[2] !== value[2] || uploadedValue[3] !== value[3]) {
                    this._gl.uniform1fv(one.location, value);
                    uploadedValue[0] = value[0];
                    uploadedValue[1] = value[1];
                    uploadedValue[2] = value[2];
                    uploadedValue[3] = value[3];
                    return 1;
                }
                return 0;
            }
            else {
                this._gl.uniform1fv(one.location, value);
                return 1;
            }
        }
        _uniform_vec2(one, v) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== v.x || uploadedValue[1] !== v.y) {
                this._gl.uniform2f(one.location, uploadedValue[0] = v.x, uploadedValue[1] = v.y);
                return 1;
            }
            return 0;
        }
        _uniform_vec2v(one, value) {
            if (value.length < 2) {
                var uploadedValue = one.uploadedValue;
                if (uploadedValue[0] !== value[0] || uploadedValue[1] !== value[1] || uploadedValue[2] !== value[2] || uploadedValue[3] !== value[3]) {
                    this._gl.uniform2fv(one.location, value);
                    uploadedValue[0] = value[0];
                    uploadedValue[1] = value[1];
                    uploadedValue[2] = value[2];
                    uploadedValue[3] = value[3];
                    return 1;
                }
                return 0;
            }
            else {
                this._gl.uniform2fv(one.location, value);
                return 1;
            }
        }
        _uniform_vec3(one, v) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== v.x || uploadedValue[1] !== v.y || uploadedValue[2] !== v.z) {
                this._gl.uniform3f(one.location, uploadedValue[0] = v.x, uploadedValue[1] = v.y, uploadedValue[2] = v.z);
                return 1;
            }
            return 0;
        }
        _uniform_vec3v(one, v) {
            this._gl.uniform3fv(one.location, v);
            return 1;
        }
        _uniform_vec4(one, v) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== v.x || uploadedValue[1] !== v.y || uploadedValue[2] !== v.z || uploadedValue[3] !== v.w) {
                this._gl.uniform4f(one.location, uploadedValue[0] = v.x, uploadedValue[1] = v.y, uploadedValue[2] = v.z, uploadedValue[3] = v.w);
                return 1;
            }
            return 0;
        }
        _uniform_vec4v(one, v) {
            this._gl.uniform4fv(one.location, v);
            return 1;
        }
        _uniformMatrix2fv(one, value) {
            this._gl.uniformMatrix2fv(one.location, false, value);
            return 1;
        }
        _uniformMatrix3f(one, value) {
            this._gl.uniformMatrix3fv(one.location, false, value.elements);
            return 1;
        }
        _uniformMatrix3fv(one, value) {
            this._gl.uniformMatrix3fv(one.location, false, value);
            return 1;
        }
        _uniformMatrix4f(one, m) {
            var value = m.elements;
            this._gl.uniformMatrix4fv(one.location, false, value);
            return 1;
        }
        _uniformMatrix4fv(one, m) {
            this._gl.uniformMatrix4fv(one.location, false, m);
            return 1;
        }
        _uniform1i(one, value) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== value) {
                this._gl.uniform1i(one.location, uploadedValue[0] = value);
                return 1;
            }
            return 0;
        }
        _uniform1iv(one, value) {
            this._gl.uniform1iv(one.location, value);
            return 1;
        }
        _uniform_ivec2(one, value) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== value[0] || uploadedValue[1] !== value[1]) {
                this._gl.uniform2i(one.location, uploadedValue[0] = value[0], uploadedValue[1] = value[1]);
                return 1;
            }
            return 0;
        }
        _uniform_ivec2v(one, value) {
            this._gl.uniform2iv(one.location, value);
            return 1;
        }
        _uniform_vec3i(one, value) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== value[0] || uploadedValue[1] !== value[1] || uploadedValue[2] !== value[2]) {
                this._gl.uniform3i(one.location, uploadedValue[0] = value[0], uploadedValue[1] = value[1], uploadedValue[2] = value[2]);
                return 1;
            }
            return 0;
        }
        _uniform_vec3vi(one, value) {
            this._gl.uniform3iv(one.location, value);
            return 1;
        }
        _uniform_vec4i(one, value) {
            var uploadedValue = one.uploadedValue;
            if (uploadedValue[0] !== value[0] || uploadedValue[1] !== value[1] || uploadedValue[2] !== value[2] || uploadedValue[3] !== value[3]) {
                this._gl.uniform4i(one.location, uploadedValue[0] = value[0], uploadedValue[1] = value[1], uploadedValue[2] = value[2], uploadedValue[3] = value[3]);
                return 1;
            }
            return 0;
        }
        _uniform_vec4vi(one, value) {
            this._gl.uniform4iv(one.location, value);
            return 1;
        }
        _uniform_sampler2D(one, texture) {
            var gl = this._gl;
            var value = this._getTextureSource(one, texture, Laya.Texture2D.errorTexture, "2D", gl.TEXTURE_2D);
            this._bindTexture(one.textureID, gl.TEXTURE_2D, value);
            return 0;
        }
        _uniform_sampler2DArray(one, texture) {
            var gl = this._gl;
            var value = this._getTextureSource(one, texture, Laya.Texture2DArray.defaultTexture, "2D array", gl.TEXTURE_2D_ARRAY);
            this._bindTexture(one.textureID, gl.TEXTURE_2D_ARRAY, value);
            return 0;
        }
        _uniform_sampler3D(one, texture) {
            var gl = this._gl;
            var value = this._getTextureSource(one, texture, Laya.Texture3D.defaultTexture, "3D", gl.TEXTURE_3D);
            this._bindTexture(one.textureID, gl.TEXTURE_3D, value);
            return 0;
        }
        _uniform_samplerCube(one, texture) {
            var gl = this._gl;
            var value = this._getTextureSource(one, texture, Laya.TextureCube.errorTexture, "cube", gl.TEXTURE_CUBE_MAP);
            this._bindTexture(one.textureID, gl.TEXTURE_CUBE_MAP, value);
            return 0;
        }
        _getTextureSource(one, texture, defaultTexture, textureType, expectedTarget) {
            var _a, _b, _c;
            const source = texture && texture._getSource();
            const asset = texture;
            const actualTarget = (_a = asset === null || asset === void 0 ? void 0 : asset._texture) === null || _a === void 0 ? void 0 : _a.target;
            if (source && (actualTarget == null || actualTarget === expectedTarget))
                return source;
            if (texture) {
                const warningKey = `${one.onID}:${expectedTarget}:${source ? actualTarget : "missing"}`;
                let warnings = this._defaultTextureWarnings.get(texture);
                if (!warnings) {
                    warnings = new Set();
                    this._defaultTextureWarnings.set(texture, warnings);
                }
                if (!warnings.has(warningKey)) {
                    const actualType = (_b = Laya.TextureDimension[asset.dimension]) !== null && _b !== void 0 ? _b : actualTarget;
                    const resource = asset.url || asset.name || (asset.id != null ? `#${asset.id}` : "internal texture");
                    const reason = source
                        ? `expects ${textureType}, but texture "${resource}" has target ${actualType}`
                        : `texture "${resource}" has no valid GPU resource`;
                    console.warn(`Texture uniform "${one.name}": ${reason}.`);
                    warnings.add(warningKey);
                }
            }
            return ((_c = defaultTexture === null || defaultTexture === void 0 ? void 0 : defaultTexture._texture) === null || _c === void 0 ? void 0 : _c.target) === expectedTarget
                ? defaultTexture._getSource() : null;
        }
        _uniform_UniformBuffer(one, value) {
            value.bind(one.location);
            return 1;
        }
        _bindTexture(textureID, target, texture) {
            const gl = this._gl;
            if (this._engine._activedTextureID !== textureID) {
                gl.activeTexture(textureID);
                this._engine._activedTextureID = textureID;
            }
            const texID = this._engine._activedTextureID - this._gl.TEXTURE0;
            if (this._engine._activeTextures[texID] !== texture) {
                gl.bindTexture(target, texture);
                this._engine._activeTextures[texID] = texture;
            }
        }
        destroy() {
            super.destroy();
            this._defaultTextureWarnings = new WeakMap();
            const gl = this._gl;
            gl.deleteShader(this._vshader);
            gl.deleteShader(this._pshader);
            gl.deleteProgram(this._program);
            this._vshader = null;
            this._pshader = null;
            this._program = null;
            this._attributeMap = null;
            this._uniformMap = null;
            this._uniformObjectMap = null;
            this._gl = null;
            this._engine = null;
        }
    }

    class GLVertexState extends GLObject {
        constructor(engine) {
            super(engine);
            this._vertexDeclaration = [];
            if (!engine.isWebGL2)
                this._vaoExt = engine._supportCapatable.getExtension(exports.WebGLExtension.OES_vertex_array_object);
            this._vao = this.createVertexArray();
            this._angleInstancedArrays = this._engine._supportCapatable.getExtension(exports.WebGLExtension.ANGLE_instanced_arrays);
        }
        createVertexArray() {
            if (this._engine.isWebGL2)
                return this._gl.createVertexArray();
            else
                return this._vaoExt.createVertexArrayOES();
        }
        deleteVertexArray() {
            if (this._engine.isWebGL2)
                this._gl.deleteVertexArray(this._vao);
            else
                this._vaoExt.deleteVertexArrayOES(this._vao);
        }
        bindVertexArray() {
            if (this._engine._GLBindVertexArray == this)
                return;
            if (this._engine.isWebGL2)
                this._gl.bindVertexArray(this._vao);
            else
                this._vaoExt.bindVertexArrayOES(this._vao);
            this._engine._GLBindVertexArray = this;
        }
        unbindVertexArray() {
            if (this._engine.isWebGL2)
                this._gl.bindVertexArray(null);
            else
                this._vaoExt.bindVertexArrayOES(null);
            this._engine._GLBindVertexArray = null;
        }
        isVertexArray() {
            if (this._engine.isWebGL2)
                this._gl.isVertexArray(this._vao);
            else
                this._vaoExt.isVertexArrayOES(this._vao);
        }
        applyVertexBuffer(vertexBuffer) {
            this.clearVAO();
            this._vertexBuffers = vertexBuffer;
            if (this._engine._GLBindVertexArray == this) {
                this._vertexDeclaration.length = vertexBuffer.length;
                var i = 0;
                vertexBuffer.forEach(element => {
                    var verDec = element._shaderValues;
                    this._vertexDeclaration[i++] = element._shaderValues;
                    element.bind();
                    for (var k in verDec) {
                        var loc = parseInt(k);
                        var attribute = verDec[k];
                        this._gl.enableVertexAttribArray(loc);
                        this._gl.vertexAttribPointer(loc, attribute.elementCount, attribute.elementType, !!attribute.normalized, attribute.vertexStride, attribute.elementOffset);
                        if (element.instanceBuffer)
                            this.vertexAttribDivisor(loc, 1);
                    }
                });
            }
            else {
                throw "BufferState: must call bind() function first.";
            }
        }
        clearVAO() {
            for (let i = 0, n = this._vertexDeclaration.length; i < n; i++) {
                var verDec = this._vertexDeclaration[i];
                for (var k in verDec) {
                    var loc = parseInt(k);
                    this._gl.disableVertexAttribArray(loc);
                }
            }
        }
        applyIndexBuffer(indexBuffer) {
            if (indexBuffer == null) {
                return;
            }
            if (this._engine._GLBindVertexArray == this) {
                if (this._bindedIndexBuffer !== indexBuffer) {
                    indexBuffer._glBuffer.bindBuffer();
                    this._bindedIndexBuffer = indexBuffer;
                }
            }
            else {
                throw "BufferState: must call bind() function first.";
            }
        }
        vertexAttribDivisor(index, divisor) {
            if (this._engine.isWebGL2)
                this._gl.vertexAttribDivisor(index, divisor);
            else
                this._angleInstancedArrays.vertexAttribDivisorANGLE(index, divisor);
        }
        destroy() {
            super.destroy();
            this._gl;
            this.deleteVertexArray();
            this._gl = null;
            this._engine = null;
        }
    }

    class VertexArrayObject {
        constructor() {
        }
    }
    (function () {
        var glErrorShadow = {};
        function error(msg) {
            if (window.console && window.console.error) {
                window.console.error(msg);
            }
        }
        function log(msg) {
            if (window.console && window.console.log) {
                window.console.log(msg);
            }
        }
        function synthesizeGLError(err, opt_msg) {
            glErrorShadow[err] = true;
            if (opt_msg !== undefined) {
                error(opt_msg);
            }
        }
        function wrapGLError(gl) {
            var f = gl.getError;
            gl.getError = function () {
                var err;
                do {
                    err = f.apply(gl);
                    if (err != gl.NO_ERROR) {
                        glErrorShadow[err] = true;
                    }
                } while (err != gl.NO_ERROR);
                for (var err1 in glErrorShadow) {
                    if (glErrorShadow[err1]) {
                        delete glErrorShadow[err1];
                        return parseInt(err1);
                    }
                }
                return gl.NO_ERROR;
            };
        }
        var WebGLVertexArrayObjectOES = function WebGLVertexArrayObjectOES(ext) {
            var gl = ext.gl;
            this.ext = ext;
            this.isAlive = true;
            this.hasBeenBound = false;
            this.elementArrayBuffer = null;
            this.attribs = new Array(ext.maxVertexAttribs);
            for (var n = 0; n < this.attribs.length; n++) {
                var attrib = new WebGLVertexArrayObjectOES.VertexAttrib(gl);
                this.attribs[n] = attrib;
            }
            this.maxAttrib = 0;
        };
        WebGLVertexArrayObjectOES.VertexAttrib = function VertexAttrib(gl) {
            this.enabled = false;
            this.buffer = null;
            this.size = 4;
            this.type = gl.FLOAT;
            this.normalized = false;
            this.stride = 16;
            this.offset = 0;
            this.cached = "";
            this.recache();
        };
        WebGLVertexArrayObjectOES.VertexAttrib.prototype.recache = function recache() {
            this.cached = [this.size, this.type, this.normalized, this.stride, this.offset].join(":");
        };
        var OESVertexArrayObject = function OESVertexArrayObject(gl) {
            var self = this;
            this.gl = gl;
            wrapGLError(gl);
            var original = this.original = {
                getParameter: gl.getParameter,
                enableVertexAttribArray: gl.enableVertexAttribArray,
                disableVertexAttribArray: gl.disableVertexAttribArray,
                bindBuffer: gl.bindBuffer,
                getVertexAttrib: gl.getVertexAttrib,
                vertexAttribPointer: gl.vertexAttribPointer
            };
            gl.getParameter = function getParameter(pname) {
                if (pname == self.VERTEX_ARRAY_BINDING_OES) {
                    if (self.currentVertexArrayObject == self.defaultVertexArrayObject) {
                        return null;
                    }
                    else {
                        return self.currentVertexArrayObject;
                    }
                }
                return original.getParameter.apply(this, arguments);
            };
            gl.enableVertexAttribArray = function enableVertexAttribArray(index) {
                var vao = self.currentVertexArrayObject;
                vao.maxAttrib = Math.max(vao.maxAttrib, index);
                var attrib = vao.attribs[index];
                attrib.enabled = true;
                return original.enableVertexAttribArray.apply(this, arguments);
            };
            gl.disableVertexAttribArray = function disableVertexAttribArray(index) {
                var vao = self.currentVertexArrayObject;
                vao.maxAttrib = Math.max(vao.maxAttrib, index);
                var attrib = vao.attribs[index];
                attrib.enabled = false;
                return original.disableVertexAttribArray.apply(this, arguments);
            };
            gl.bindBuffer = function bindBuffer(target, buffer) {
                switch (target) {
                    case gl.ARRAY_BUFFER:
                        self.currentArrayBuffer = buffer;
                        break;
                    case gl.ELEMENT_ARRAY_BUFFER:
                        self.currentVertexArrayObject.elementArrayBuffer = buffer;
                        break;
                }
                return original.bindBuffer.apply(this, arguments);
            };
            gl.getVertexAttrib = function getVertexAttrib(index, pname) {
                var vao = self.currentVertexArrayObject;
                var attrib = vao.attribs[index];
                switch (pname) {
                    case gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
                        return attrib.buffer;
                    case gl.VERTEX_ATTRIB_ARRAY_ENABLED:
                        return attrib.enabled;
                    case gl.VERTEX_ATTRIB_ARRAY_SIZE:
                        return attrib.size;
                    case gl.VERTEX_ATTRIB_ARRAY_STRIDE:
                        return attrib.stride;
                    case gl.VERTEX_ATTRIB_ARRAY_TYPE:
                        return attrib.type;
                    case gl.VERTEX_ATTRIB_ARRAY_NORMALIZED:
                        return attrib.normalized;
                    default:
                        return original.getVertexAttrib.apply(this, arguments);
                }
            };
            gl.vertexAttribPointer = function vertexAttribPointer(indx, size, type, normalized, stride, offset) {
                var vao = self.currentVertexArrayObject;
                vao.maxAttrib = Math.max(vao.maxAttrib, indx);
                var attrib = vao.attribs[indx];
                attrib.buffer = self.currentArrayBuffer;
                attrib.size = size;
                attrib.type = type;
                attrib.normalized = normalized;
                attrib.stride = stride;
                attrib.offset = offset;
                attrib.recache();
                return original.vertexAttribPointer.apply(this, arguments);
            };
            if (gl.instrumentExtension) {
                gl.instrumentExtension(this, "OES_vertex_array_object");
            }
            gl.canvas.addEventListener('webglcontextrestored', function () {
                log("OESVertexArrayObject emulation library context restored");
                self.reset_();
            }, true);
            this.reset_();
        };
        OESVertexArrayObject.prototype.VERTEX_ARRAY_BINDING_OES = 0x85B5;
        OESVertexArrayObject.prototype.reset_ = function reset_() {
            var contextWasLost = this.vertexArrayObjects !== undefined;
            if (contextWasLost) {
                for (var ii = 0; ii < this.vertexArrayObjects.length; ++ii) {
                    this.vertexArrayObjects.isAlive = false;
                }
            }
            var gl = this.gl;
            this.maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
            this.defaultVertexArrayObject = new WebGLVertexArrayObjectOES(this);
            this.currentVertexArrayObject = null;
            this.currentArrayBuffer = null;
            this.vertexArrayObjects = [this.defaultVertexArrayObject];
            this.bindVertexArrayOES(null);
        };
        OESVertexArrayObject.prototype.createVertexArrayOES = function createVertexArrayOES() {
            var arrayObject = new WebGLVertexArrayObjectOES(this);
            this.vertexArrayObjects.push(arrayObject);
            return arrayObject;
        };
        OESVertexArrayObject.prototype.deleteVertexArrayOES = function deleteVertexArrayOES(arrayObject) {
            arrayObject.isAlive = false;
            this.vertexArrayObjects.splice(this.vertexArrayObjects.indexOf(arrayObject), 1);
            if (this.currentVertexArrayObject == arrayObject) {
                this.bindVertexArrayOES(null);
            }
        };
        OESVertexArrayObject.prototype.isVertexArrayOES = function isVertexArrayOES(arrayObject) {
            if (arrayObject && arrayObject instanceof WebGLVertexArrayObjectOES) {
                if (arrayObject.hasBeenBound && arrayObject.ext == this) {
                    return true;
                }
            }
            return false;
        };
        OESVertexArrayObject.prototype.bindVertexArrayOES = function bindVertexArrayOES(arrayObject) {
            var gl = this.gl;
            if (arrayObject && !arrayObject.isAlive) {
                synthesizeGLError(gl.INVALID_OPERATION, "bindVertexArrayOES: attempt to bind deleted arrayObject");
                return;
            }
            var original = this.original;
            var oldVAO = this.currentVertexArrayObject;
            this.currentVertexArrayObject = arrayObject || this.defaultVertexArrayObject;
            this.currentVertexArrayObject.hasBeenBound = true;
            var newVAO = this.currentVertexArrayObject;
            if (oldVAO == newVAO) {
                return;
            }
            if (!oldVAO || newVAO.elementArrayBuffer != oldVAO.elementArrayBuffer) {
                original.bindBuffer.call(gl, gl.ELEMENT_ARRAY_BUFFER, newVAO.elementArrayBuffer);
            }
            var currentBinding = this.currentArrayBuffer;
            var maxAttrib = Math.max(oldVAO ? oldVAO.maxAttrib : 0, newVAO.maxAttrib);
            for (var n = 0; n <= maxAttrib; n++) {
                var attrib = newVAO.attribs[n];
                var oldAttrib = oldVAO ? oldVAO.attribs[n] : null;
                if (!oldVAO || attrib.enabled != oldAttrib.enabled) {
                    if (attrib.enabled) {
                        original.enableVertexAttribArray.call(gl, n);
                    }
                    else {
                        original.disableVertexAttribArray.call(gl, n);
                    }
                }
                if (attrib.enabled) {
                    var bufferChanged = false;
                    if (!oldVAO || attrib.buffer != oldAttrib.buffer) {
                        if (currentBinding != attrib.buffer) {
                            original.bindBuffer.call(gl, gl.ARRAY_BUFFER, attrib.buffer);
                            currentBinding = attrib.buffer;
                        }
                        bufferChanged = true;
                    }
                    if (bufferChanged || attrib.cached != oldAttrib.cached) {
                        original.vertexAttribPointer.call(gl, n, attrib.size, attrib.type, attrib.normalized, attrib.stride, attrib.offset);
                    }
                }
            }
            if (this.currentArrayBuffer != currentBinding) {
                original.bindBuffer.call(gl, gl.ARRAY_BUFFER, this.currentArrayBuffer);
            }
        };
        window._setupVertexArrayObject = function (gl) {
            var original_getSupportedExtensions = gl.getSupportedExtensions;
            gl.getSupportedExtensions = function getSupportedExtensions() {
                var list = original_getSupportedExtensions.call(this) || [];
                if (list.indexOf("OES_vertex_array_object") < 0) {
                    list.push("OES_vertex_array_object");
                }
                return list;
            };
            var original_getExtension = gl.getExtension;
            gl.getExtension = function getExtension(name) {
                var ext = original_getExtension.call(this, name);
                if (ext) {
                    return ext;
                }
                if (name !== "OES_vertex_array_object") {
                    return null;
                }
                if (!this.__OESVertexArrayObject) {
                    console.log("Setup OES_vertex_array_object polyfill");
                    this.__OESVertexArrayObject = new OESVertexArrayObject(this);
                }
                return this.__OESVertexArrayObject;
            };
        };
    }());

    const extentionVendorPrefixes = ["", "WEBKIT_", "MOZ_"];
    class GlCapable {
        constructor(glEngine) {
            this._gl = glEngine.gl;
            this.initExtension(glEngine.isWebGL2);
            this.initCapable(glEngine.isWebGL2);
        }
        initCapable(isWebgl2) {
            this._capabilityMap = new Map();
            let value = isWebgl2 || !!(this.getExtension(exports.WebGLExtension.OES_element_index_uint));
            this._capabilityMap.set(Laya.RenderCapable.Element_Index_Uint32, value);
            this._capabilityMap.set(Laya.RenderCapable.Element_Index_Uint8, true);
            value = isWebgl2 || !!(this.getExtension(exports.WebGLExtension.OES_texture_float));
            this._capabilityMap.set(Laya.RenderCapable.TextureFormat_R32G32B32A32, value);
            value = isWebgl2 || !!(this.getExtension(exports.WebGLExtension.OES_texture_half_float));
            this._capabilityMap.set(Laya.RenderCapable.TextureFormat_R16G16B16A16, value);
            value = !!(this.getExtension(exports.WebGLExtension.EXT_texture_filter_anisotropic));
            this._capabilityMap.set(Laya.RenderCapable.Texture_anisotropic, value);
            if (isWebgl2) {
                value = !!this.getExtension(exports.WebGLExtension.EXT_color_buffer_float) || !!this.getExtension(exports.WebGLExtension.EXT_color_buffer_half_float);
            }
            else {
                value = ((!!this.getExtension(exports.WebGLExtension.OES_texture_half_float)) || (!!this.getExtension(exports.WebGLExtension.EXT_color_buffer_half_float))) && (!!this.getExtension(exports.WebGLExtension.OES_texture_half_float_linear));
            }
            this._capabilityMap.set(Laya.RenderCapable.RenderTextureFormat_R16G16B16A16, value);
            if (isWebgl2) {
                value = !!this.getExtension(exports.WebGLExtension.EXT_color_buffer_float) && !!this.getExtension(exports.WebGLExtension.OES_texture_float_linear);
            }
            else {
                value = (!!this.getExtension(exports.WebGLExtension.OES_texture_float)) && (!!this.getExtension(exports.WebGLExtension.OES_texture_float_linear));
            }
            this._capabilityMap.set(Laya.RenderCapable.RenderTextureFormat_R32G32B32A32, value);
            value = isWebgl2 || (!!this.getExtension(exports.WebGLExtension.WEBGL_depth_texture));
            this._capabilityMap.set(Laya.RenderCapable.RenderTextureFormat_Depth, value);
            value = isWebgl2;
            this._capabilityMap.set(Laya.RenderCapable.RenderTextureFormat_ShadowMap, value);
            value = isWebgl2 || (!!this.getExtension(exports.WebGLExtension.OES_vertex_array_object));
            this._capabilityMap.set(Laya.RenderCapable.Vertex_VAO, value);
            value = (isWebgl2 || (!!this.getExtension(exports.WebGLExtension.ANGLE_instanced_arrays)));
            this._capabilityMap.set(Laya.RenderCapable.DrawElement_Instance, value);
            value = (isWebgl2) || (!!this.getExtension(exports.WebGLExtension.EXT_shader_texture_lod));
            this._capabilityMap.set(Laya.RenderCapable.Shader_TextureLod, value);
            value = (!!this.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_s3tc));
            this._capabilityMap.set(Laya.RenderCapable.COMPRESS_TEXTURE_S3TC, value);
            value = (!!this.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_s3tc_srgb));
            this._capabilityMap.set(Laya.RenderCapable.COMPRESS_TEXTURE_S3TC_SRGB, value);
            value = (!!this.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_pvrtc));
            this._capabilityMap.set(Laya.RenderCapable.COMPRESS_TEXTURE_PVRTC, value);
            value = (!!this.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_etc1));
            this._capabilityMap.set(Laya.RenderCapable.COMPRESS_TEXTURE_ETC1, value);
            value = (!!this.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_etc));
            this._capabilityMap.set(Laya.RenderCapable.COMPRESS_TEXTURE_ETC, value);
            value = (!!this.getExtension(exports.WebGLExtension.WEBGL_compressed_texture_astc));
            this._capabilityMap.set(Laya.RenderCapable.COMPRESS_TEXTURE_ASTC, value);
            value = (isWebgl2) || (!!this.getExtension(exports.WebGLExtension.EXT_sRGB));
            this._capabilityMap.set(Laya.RenderCapable.Texture_SRGB, value);
            value = (!!this.getExtension(exports.WebGLExtension.OES_texture_float_linear));
            this._capabilityMap.set(Laya.RenderCapable.Texture_FloatLinearFiltering, value);
            value = isWebgl2 || (!!this.getExtension(exports.WebGLExtension.OES_texture_half_float_linear));
            this._capabilityMap.set(Laya.RenderCapable.Texture_HalfFloatLinearFiltering, value);
            value = isWebgl2;
            this._capabilityMap.set(Laya.RenderCapable.MSAA, value);
            this._capabilityMap.set(Laya.RenderCapable.UnifromBufferObject, value);
            this._capabilityMap.set(Laya.RenderCapable.Texture3D, value);
            this._capabilityMap.set(Laya.RenderCapable.Texture_NPOTFull, isWebgl2);
            this._capabilityMap.set(Laya.RenderCapable.ComputeShader, false);
            this._capabilityMap.set(Laya.RenderCapable.StorageBuffer, false);
            this._capabilityMap.set(Laya.RenderCapable.MRT, isWebgl2);
        }
        initExtension(isWebgl2) {
            this._extensionMap = new Map();
            const getGlExtension = (name) => {
                for (const k in extentionVendorPrefixes) {
                    let ext = this._gl.getExtension(extentionVendorPrefixes[k] + name);
                    if (ext)
                        return ext;
                }
                return null;
            };
            const setExtensionMap = (extension, value, map) => {
                value && map.set(extension, value);
            };
            const _extTextureFilterAnisotropic = getGlExtension("EXT_texture_filter_anisotropic");
            setExtensionMap(exports.WebGLExtension.EXT_texture_filter_anisotropic, _extTextureFilterAnisotropic, this._extensionMap);
            const _compressedTextureS3tc = getGlExtension("WEBGL_compressed_texture_s3tc");
            setExtensionMap(exports.WebGLExtension.WEBGL_compressed_texture_s3tc, _compressedTextureS3tc, this._extensionMap);
            const _compressdTextureS3tc_srgb = getGlExtension("WEBGL_compressed_texture_s3tc_srgb");
            setExtensionMap(exports.WebGLExtension.WEBGL_compressed_texture_s3tc_srgb, _compressdTextureS3tc_srgb, this._extensionMap);
            const _compressedTexturePvrtc = getGlExtension("WEBGL_compressed_texture_pvrtc");
            setExtensionMap(exports.WebGLExtension.WEBGL_compressed_texture_pvrtc, _compressedTexturePvrtc, this._extensionMap);
            const _compressedTextureEtc1 = getGlExtension("WEBGL_compressed_texture_etc1");
            setExtensionMap(exports.WebGLExtension.WEBGL_compressed_texture_etc1, _compressedTextureEtc1, this._extensionMap);
            const _compressedTextureETC = getGlExtension("WEBGL_compressed_texture_etc");
            setExtensionMap(exports.WebGLExtension.WEBGL_compressed_texture_etc, _compressedTextureETC, this._extensionMap);
            const _compressedTextureASTC = getGlExtension("WEBGL_compressed_texture_astc");
            setExtensionMap(exports.WebGLExtension.WEBGL_compressed_texture_astc, _compressedTextureASTC, this._extensionMap);
            const _oesTextureFloatLinear = getGlExtension("OES_texture_float_linear");
            setExtensionMap(exports.WebGLExtension.OES_texture_float_linear, _oesTextureFloatLinear, this._extensionMap);
            const _extColorBufferHalfFloat = getGlExtension("EXT_color_buffer_half_float");
            setExtensionMap(exports.WebGLExtension.EXT_color_buffer_half_float, _extColorBufferHalfFloat, this._extensionMap);
            if (isWebgl2) {
                const _extColorBufferFloat = getGlExtension("EXT_color_buffer_float");
                setExtensionMap(exports.WebGLExtension.EXT_color_buffer_float, _extColorBufferFloat, this._extensionMap);
            }
            else {
                if (window._setupVertexArrayObject)
                    window._setupVertexArrayObject(this._gl);
                const _vaoExt = getGlExtension("OES_vertex_array_object");
                setExtensionMap(exports.WebGLExtension.OES_vertex_array_object, _vaoExt, this._extensionMap);
                const _angleInstancedArrays = getGlExtension("ANGLE_instanced_arrays");
                setExtensionMap(exports.WebGLExtension.ANGLE_instanced_arrays, _angleInstancedArrays, this._extensionMap);
                const _oesTextureHalfFloat = getGlExtension("OES_texture_half_float");
                setExtensionMap(exports.WebGLExtension.OES_texture_half_float, _oesTextureHalfFloat, this._extensionMap);
                const _oesTextureHalfFloatLinear = getGlExtension("OES_texture_half_float_linear");
                setExtensionMap(exports.WebGLExtension.OES_texture_half_float_linear, _oesTextureHalfFloatLinear, this._extensionMap);
                const _oesTextureFloat = getGlExtension("OES_texture_float");
                setExtensionMap(exports.WebGLExtension.OES_texture_float, _oesTextureFloat, this._extensionMap);
                const _oes_element_index_uint = getGlExtension("OES_element_index_uint");
                setExtensionMap(exports.WebGLExtension.OES_element_index_uint, _oes_element_index_uint, this._extensionMap);
                const _extShaderTextureLod = getGlExtension("EXT_shader_texture_lod");
                setExtensionMap(exports.WebGLExtension.EXT_shader_texture_lod, _extShaderTextureLod, this._extensionMap);
                const _webgl_depth_texture = getGlExtension("WEBGL_depth_texture");
                setExtensionMap(exports.WebGLExtension.WEBGL_depth_texture, _webgl_depth_texture, this._extensionMap);
                const _sRGB = getGlExtension("EXT_sRGB");
                setExtensionMap(exports.WebGLExtension.EXT_sRGB, _sRGB, this._extensionMap);
                const OES_standard_derivatives = getGlExtension("OES_standard_derivatives");
                setExtensionMap(exports.WebGLExtension.OES_standard_derivatives, OES_standard_derivatives, this._extensionMap);
            }
        }
        getCapable(type) {
            return this._capabilityMap.get(type);
        }
        getExtension(type) {
            return this._extensionMap.get(type) || null;
        }
        turnOffSRGB() {
            this._extensionMap.set(exports.WebGLExtension.EXT_sRGB, null);
            this._capabilityMap.set(Laya.RenderCapable.Texture_SRGB, false);
        }
        turnOffCapableAndExtension(type, extension) {
            if (type) {
                this._capabilityMap.set(type, false);
            }
            if (extension) {
                this._extensionMap.set(extension, null);
            }
        }
    }

    class WebGLSubUniformBuffer extends Laya.UniformBufferBlock {
        constructor(cluster, index, size, alignedSize, descriptor) {
            super(cluster, index, size, alignedSize);
            this.descriptor = descriptor;
            this._rebuildViews();
            this.needUpload = true;
            this.markDirty();
        }
        _rebuildViews() {
            this.descriptor.uniforms.forEach(u => {
                let size = u.viewByteLength / u.dataView.BYTES_PER_ELEMENT;
                u.view = new u.dataView(this.cluster.data, u.offset + this.offset, size);
            });
        }
        bind(location) {
            this.cluster.buffer.bindBufferRange(location, this.offset, this.size);
        }
        onRelocated(info) {
            super.onRelocated(info);
            this._rebuildViews();
            if (info !== 'expand') {
                this.needUpload = true;
                this.markDirty();
            }
        }
        upload() {
            this.needUpload && this.markDirty();
        }
    }

    class WebGLBufferCluster extends Laya.UniformBufferCluster {
        _createBufferBlock(index, size, alignedSize, descriptor, owner) {
            return new WebGLSubUniformBuffer(this, index, size, alignedSize, descriptor);
        }
    }

    class WebGLUniformBufferManager extends Laya.UniformBufferManager {
        constructor(engine, offsetAlignment) {
            super(true);
            this._pendingApply = new Laya.FastSinglelist();
            this._uploadRound = 0;
            this.engine = engine;
            this.byteAlign = offsetAlignment;
            engine.on("endFrame", this, this.endFrame);
            engine.on("startFrame", this, this.startFrame);
        }
        upload() {
            const p = this._pendingApply;
            const arr = p.elements;
            const n = p.length;
            for (let i = 0; i < n; i++)
                arr[i].uploadCache();
            arr.fill(null, 0, n);
            p.length = 0;
            this._uploadRound++;
            super.upload();
        }
        destroy() {
            this._pendingApply.clear();
            return super.destroy();
        }
        _createBufferCluster(size, blockNum) {
            return new WebGLBufferCluster(size, blockNum, this);
        }
        createGPUBuffer(size, name, data) {
            let buffer = this.engine.createBuffer(Laya.BufferTargetType.UNIFORM_BUFFER, Laya.BufferUsage.Dynamic);
            buffer.bindBuffer();
            buffer.setDataLength(size);
            if (data) {
                buffer.setData(data, 0);
            }
            return buffer;
        }
        writeBuffer(buffer, data, offset, size) {
            buffer.bindBuffer();
            let gl = this.engine.gl;
            gl.bufferSubData(buffer._glTarget, offset, new Float32Array(data, offset, size / 4));
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_UBOBufferUploadCount, 1);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_UBOBufferUploadMemory, size / 1048576);
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_BufferUploadCount, 1);
        }
    }

    class WebGLEngine extends Laya.EventDispatcher {
        get lost() {
            return this._lost;
        }
        constructor(config, webglMode = exports.WebGLMode.Auto) {
            super();
            this._framePassCount = 0;
            this._lost = false;
            this._propertyNameMap = {};
            this._propertyNameCounter = 0;
            this._IDCounter = 0;
            this._isShaderDebugMode = true;
            this._lastClearColor = new Laya.Color;
            this._lastClearDepth = -1;
            this._attachmentClearColor = new Float32Array(4);
            this._remapZ = true;
            this._screenInvertY = false;
            this._lodTextureSample = true;
            this._breakTextureSample = true;
            this._config = config;
            this._isWebGL2 = false;
            this._lastViewport = new Laya.Vector4(0, 0, 0, 0);
            this._lastClearColor = new Laya.Color(0, 0, 0, 0);
            this._lastScissor = new Laya.Vector4(0, 0, 0, 0);
            this._webglMode = webglMode;
            WebGLEngine.instance = this;
        }
        startFrame() {
            this._framePassCount = 0;
            this.event("startFrame", null);
        }
        endFrame() {
            this.event("endFrame", null);
        }
        getInnerWidth() {
            return this._globalWidth;
        }
        getInnerHeight() {
            return this._globalHeight;
        }
        resizeOffScreen(width, height) {
            this._globalWidth = width;
            this._globalHeight = height;
        }
        addTexGammaDefine(key, value) {
            WebGLEngine._texGammaDefine[key] = value;
        }
        get gl() {
            return this._context;
        }
        get isWebGL2() {
            return this._isWebGL2;
        }
        get webglConfig() {
            return this._config;
        }
        initRenderEngine(canvas) {
            let names;
            let gl;
            switch (this._webglMode) {
                case exports.WebGLMode.Auto:
                    names = ["webgl2", "experimental-webgl2", "webgl", "experimental-webgl"];
                    break;
                case exports.WebGLMode.WebGL1:
                    names = ["webgl", "experimental-webgl"];
                    break;
                case exports.WebGLMode.WebGL2:
                    names = ["webgl2", "experimental-webgl2"];
                    break;
            }
            for (let i = 0; i < names.length; i++) {
                try {
                    gl = canvas.getContext(names[i], this._config);
                }
                catch (e) {
                }
                if (gl) {
                    if (names[i] === 'webgl2' || names[i] === 'experimental-webgl2') {
                        this._isWebGL2 = true;
                    }
                    break;
                }
            }
            this._context = gl;
            this.scissorTest(true);
            this._initBindBufferMap();
            this._supportCapatable = new GlCapable(this);
            this._GLParams = new GLParams(this);
            this._GLRenderState = new GLRenderState(this);
            this._glTextureIDParams = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3, gl.TEXTURE4, gl.TEXTURE5, gl.TEXTURE6, gl.TEXTURE7, gl.TEXTURE8, gl.TEXTURE9, gl.TEXTURE10, gl.TEXTURE11, gl.TEXTURE12, gl.TEXTURE13, gl.TEXTURE14, gl.TEXTURE15, gl.TEXTURE16, gl.TEXTURE17, gl.TEXTURE18, gl.TEXTURE19, gl.TEXTURE20, gl.TEXTURE21, gl.TEXTURE22, gl.TEXTURE23, gl.TEXTURE24, gl.TEXTURE25, gl.TEXTURE26, gl.TEXTURE27, gl.TEXTURE28, gl.TEXTURE29, gl.TEXTURE30, gl.TEXTURE31];
            this._activedTextureID = gl.TEXTURE0;
            this._activeTextures = [];
            this._GLTextureContext = this.isWebGL2 ? new GL2TextureContext(this) : new GLTextureContext(this);
            this._GLRenderDrawContext = new GLRenderDrawContext(this);
            canvas.addEventListener("webglcontextlost", this.webglContextLost.bind(this));
            Laya.Config._uniformBlock = Laya.Config.enableUniformBufferObject && this.getCapable(Laya.RenderCapable.UnifromBufferObject);
            Laya.Config.matUseUBO = Laya.Config.matUseUBO && this.getCapable(Laya.RenderCapable.UnifromBufferObject) && Laya.Config.enableUniformBufferObject;
            this._initBufferBlock();
        }
        _initBufferBlock() {
            const useUBO = (Laya.Config._uniformBlock || Laya.Config.matUseUBO);
            if (useUBO) {
                const gl = this._context;
                let offsetAlignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);
                this.bufferMgr = new WebGLUniformBufferManager(this, offsetAlignment);
                let maxBlockCount = gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS);
                this._uboBindingMap = new Array(maxBlockCount);
                for (let i = 0; i < maxBlockCount; i++) {
                    this._uboBindingMap[i] = { buffer: null, offset: 0, size: 0 };
                }
            }
        }
        webglContextLost(e) {
            console.log("lost webgl context");
            Laya.Laya.stage.event("GraphicContextLost", e);
            this._lost = true;
        }
        _initBindBufferMap() {
            this._GLBufferBindMap = {};
            this._GLBufferBindMap[Laya.BufferTargetType.ARRAY_BUFFER] = null;
            this._GLBufferBindMap[Laya.BufferTargetType.ELEMENT_ARRAY_BUFFER] = null;
            this._GLBufferBindMap[Laya.BufferTargetType.UNIFORM_BUFFER] = null;
        }
        _getbindBuffer(target) {
            return this._GLBufferBindMap[target];
        }
        _setbindBuffer(target, buffer) {
            this._GLBufferBindMap[target] = buffer;
        }
        _bindTexture(target, texture) {
            const texID = this._activedTextureID - this._context.TEXTURE0;
            if (this._activeTextures[texID] !== texture) {
                this._context.bindTexture(target, texture);
                this._activeTextures[texID] = texture;
            }
        }
        getCapable(capatableType) {
            return this._supportCapatable.getCapable(capatableType);
        }
        viewport(x, y, width, height) {
            const gl = this._context;
            const lv = this._lastViewport;
            if (Laya.LayaEnv.isConch) {
                gl.viewport(x, y, width, height);
            }
            else if (x !== lv.x || y !== lv.y || width !== lv.z || height !== lv.w) {
                gl.viewport(x, y, width, height);
                lv.setValue(x, y, width, height);
            }
        }
        scissor(x, y, width, height) {
            const gl = this._context;
            const lv = this._lastScissor;
            if (Laya.LayaEnv.isConch) {
                gl.scissor(x, y, width, height);
            }
            else if (x !== lv.x || y !== lv.y || width !== lv.z || height !== lv.w) {
                gl.scissor(x, y, width, height);
                lv.setValue(x, y, width, height);
            }
        }
        scissorTest(value) {
            if (this._scissorState == value)
                return;
            this._scissorState = value;
            if (value)
                this._context.enable(this._context.SCISSOR_TEST);
            else
                this._context.disable(this._context.SCISSOR_TEST);
        }
        clearRenderTexture(clearFlag, clearcolor = null, clearDepth = 1, clearStencilValue = 0, clearColorValues) {
            var _a;
            var flag;
            if (clearFlag & Laya.RenderClearFlag.Color) {
                if (clearColorValues) {
                    if (!this._isWebGL2)
                        throw new Error("Per-attachment clear colors require WebGL2.");
                    const gl = this._context;
                    const values = this._attachmentClearColor;
                    const colorFormats = (_a = this._GLTextureContext.currentActiveRT) === null || _a === void 0 ? void 0 : _a.colorFormats;
                    for (let i = 0; i < clearColorValues.length; i++) {
                        const color = clearColorValues[i];
                        if (!color || (colorFormats && colorFormats[i] == null))
                            continue;
                        values[0] = color.r;
                        values[1] = color.g;
                        values[2] = color.b;
                        values[3] = color.a;
                        gl.clearBufferfv(gl.COLOR, i, values);
                    }
                }
                else {
                    if (clearcolor && !this._lastClearColor.equal(clearcolor)) {
                        this._context.clearColor(clearcolor.r, clearcolor.g, clearcolor.b, clearcolor.a);
                        clearcolor.cloneTo(this._lastClearColor);
                    }
                    flag |= this.gl.COLOR_BUFFER_BIT;
                }
            }
            if (clearFlag & Laya.RenderClearFlag.Depth) {
                if (this._lastClearDepth != clearDepth) {
                    this._context.clearDepth(clearDepth);
                    this._lastClearDepth = clearDepth;
                }
                this._GLRenderState.setDepthMask(true);
                flag |= this._context.DEPTH_BUFFER_BIT;
            }
            if (clearFlag & Laya.RenderClearFlag.Stencil) {
                this._context.clearStencil(clearStencilValue);
                this._GLRenderState.setStencilWrite(true);
                this._GLRenderState.setStencilWriteMask(0xFF);
                flag |= this._context.STENCIL_BUFFER_BIT;
            }
            if (flag)
                this._context.clear(flag);
        }
        copySubFrameBuffertoTex(texture, level, xoffset, yoffset, x, y, width, height) {
            this._bindTexture(texture.target, texture.resource);
            this._context.copyTexSubImage2D(texture.target, level, xoffset, yoffset, x, y, width, height);
        }
        colorMask(r, g, b, a) {
            this._context.colorMask(r, g, b, a);
        }
        getParams(params) {
            return this._GLParams.getParams(params);
        }
        createBuffer(targetType, bufferUsageType) {
            return new GLBuffer(this, targetType, bufferUsageType);
        }
        createShaderInstance(vs, ps, attributeMap) {
            return new GLShaderInstance(this, vs, ps, attributeMap);
        }
        createVertexState() {
            return new GLVertexState(this);
        }
        getTextureContext() {
            return this._GLTextureContext;
        }
        getDrawContext() {
            return this._GLRenderDrawContext;
        }
        propertyNameToID(name) {
            if (this._propertyNameMap[name] != null) {
                return this._propertyNameMap[name];
            }
            else {
                var id = this._propertyNameCounter++;
                this._propertyNameMap[name] = id;
                this._propertyNameMap[id] = name;
                return id;
            }
        }
        propertyIDToName(id) {
            return this._propertyNameMap[id];
        }
        getNamesByDefineData(defineData, out) {
            var maskMap = WebGLEngine._maskMap;
            var mask = defineData._mask;
            out.length = 0;
            for (var i = 0, n = defineData._length; i < n; i++) {
                var subMaskMap = maskMap[i];
                var subMask = mask[i];
                for (var j = 0; j < 32; j++) {
                    var d = 1 << j;
                    if (subMask > 0 && d > subMask)
                        break;
                    if (subMask & d)
                        out.push(subMaskMap[d]);
                }
            }
        }
        getDefineByName(name) {
            var define = WebGLEngine._defineMap[name];
            if (!define) {
                var maskMap = WebGLEngine._maskMap;
                var counter = WebGLEngine._defineCounter;
                var index = Math.floor(counter / 32);
                var value = 1 << counter % 32;
                define = new Laya.ShaderDefine(index, value);
                WebGLEngine._defineMap[name] = define;
                if (index == maskMap.length) {
                    maskMap.length++;
                    maskMap[index] = {};
                }
                maskMap[index][value] = name;
                WebGLEngine._defineCounter++;
            }
            return define;
        }
        uploadUniforms(shader, commandEncoder, shaderData, uploadUnTexture) {
            var data = shaderData._data;
            var shaderUniform = commandEncoder.getArrayData();
            var shaderCall = 0;
            for (var i = 0, n = shaderUniform.length; i < n; i++) {
                var one = shaderUniform[i];
                if (uploadUnTexture || one.textureID !== -1) {
                    var value = data[one.dataOffset];
                    if (value != null || one.textureID !== -1)
                        shaderCall += one.fun.call(one.caller, one, value);
                }
            }
            return shaderCall;
        }
        uploadOneUniforms(shader, shaderVariable, data) {
            shader.bind();
            if (shaderVariable && data != null)
                shaderVariable.fun.call(shaderVariable.caller, shaderVariable, data);
        }
        unbindVertexState() {
            if (this.isWebGL2)
                this._context.bindVertexArray(null);
            else
                this._supportCapatable.getExtension(exports.WebGLExtension.OES_vertex_array_object).bindVertexArrayOES(null);
            this._GLBindVertexArray = null;
        }
        hashRenderState(renderState) {
            let rasterMask = 0;
            {
                let bitOffset = 0;
                rasterMask |= (renderState.cull & 0x3) << bitOffset;
                bitOffset += 2;
                rasterMask |= (renderState.blend & 0x3) << bitOffset;
                bitOffset += 2;
                switch (renderState.blend) {
                    case Laya.BlendType.BLEND_DISABLE:
                        bitOffset += (4 + 4 + 3) * 2;
                        break;
                    case Laya.BlendType.BLEND_ENABLE_ALL:
                        rasterMask |= (renderState.srcBlend & 0xF) << bitOffset;
                        bitOffset += 4;
                        rasterMask |= (renderState.dstBlend & 0xF) << bitOffset;
                        bitOffset += 4;
                        rasterMask |= (renderState.blendEquation & 0x7) << bitOffset;
                        bitOffset += 3;
                        bitOffset += 4 + 4 + 3;
                        break;
                    case Laya.BlendType.BLEND_ENABLE_SEPERATE:
                        rasterMask |= (renderState.srcBlendRGB & 0xF) << bitOffset;
                        bitOffset += 4;
                        rasterMask |= (renderState.dstBlendRGB & 0xF) << bitOffset;
                        bitOffset += 4;
                        rasterMask |= (renderState.blendEquationRGB & 0x7) << bitOffset;
                        bitOffset += 3;
                        rasterMask |= (renderState.srcBlendAlpha & 0xF) << bitOffset;
                        bitOffset += 4;
                        rasterMask |= (renderState.dstBlendAlpha & 0xF) << bitOffset;
                        bitOffset += 4;
                        rasterMask |= (renderState.blendEquationAlpha & 0x7) << bitOffset;
                        bitOffset += 3;
                        break;
                }
            }
            let depthStencilMask = 0;
            {
                let bitOffset = 0;
                depthStencilMask |= (renderState.depthTest & 0xF) << bitOffset;
                bitOffset += 4;
                depthStencilMask |= (renderState.depthWrite ? 1 : 0) << bitOffset;
                bitOffset += 1;
                depthStencilMask |= (renderState.depthBias ? 1 : 0) << bitOffset;
                bitOffset += 1;
                depthStencilMask |= (renderState.stencilTest & 0xF) << bitOffset;
                bitOffset += 4;
                depthStencilMask |= (renderState.stencilOp.x & 0x7) << bitOffset;
                bitOffset += 3;
                depthStencilMask |= (renderState.stencilOp.y & 0x7) << bitOffset;
                bitOffset += 3;
                depthStencilMask |= (renderState.stencilOp.z & 0x7) << bitOffset;
                bitOffset += 3;
                depthStencilMask |= (renderState.stencilWrite ? 1 : 0) << bitOffset;
                bitOffset += 1;
            }
            let stencilMask = 0;
            {
                let bitOffset = 0;
                stencilMask |= (renderState.stencilReadMask & 0xFF) << bitOffset;
                bitOffset += 8;
                stencilMask |= (renderState.stencilWriteMask & 0xFF) << bitOffset;
                bitOffset += 8;
                stencilMask |= (renderState.stencilRef & 0xFF) << bitOffset;
                bitOffset += 8;
            }
            renderStateHashF32[0] = renderState.depthBiasConstant;
            renderStateHashF32[1] = renderState.depthBiasSlopeScale;
            renderStateHashF32[2] = renderState.depthBiasClamp;
            return `${rasterMask}_${depthStencilMask}_${stencilMask}_${renderStateHashU32.join()}`;
        }
    }
    WebGLEngine._texGammaDefine = {};
    WebGLEngine._lastFrameBuffer = null;
    WebGLEngine._lastFrameBuffer_WebGLOBJ = null;
    WebGLEngine._defineMap = {};
    WebGLEngine._defineCounter = 0;
    WebGLEngine._maskMap = [];
    const renderStateHashF32 = new Float32Array(3);
    const renderStateHashU32 = new Uint32Array(renderStateHashF32.buffer);

    class WebGLUniformBufferDescriptor {
        get byteLength() {
            return this._byteLength;
        }
        constructor(name) {
            this._currentLength = 0;
            this._byteLength = 0;
            this._maxAlignment = 4;
            this.name = name;
            this.uniforms = new Map();
        }
        alignmentPadding(alignment) {
            let pointer = this._currentLength;
            let endPadding = pointer % alignment;
            if (endPadding != 0) {
                endPadding = alignment - endPadding;
                this._currentLength += endPadding;
                this._byteLength += endPadding * 4;
            }
            this._maxAlignment = Math.max(this._maxAlignment, alignment);
        }
        addUniformItem(index, size, alignStride, arraySize, tsc) {
            if (arraySize > 0) {
                alignStride = alignStride > 4 ? alignStride : 4;
                this.alignmentPadding(4);
                let arrayStride = arraySize * alignStride;
                let view;
                let uniform = {
                    index: index,
                    view: view,
                    size: size,
                    alignStride: alignStride,
                    offset: this._currentLength * 4,
                    dataView: tsc,
                    viewByteLength: tsc.BYTES_PER_ELEMENT * arrayStride,
                    arrayLength: arraySize,
                };
                this.uniforms.set(index, uniform);
                this._currentLength += arrayStride;
                this._byteLength += uniform.viewByteLength;
            }
            else {
                this.alignmentPadding(size <= 2 ? size : 4);
                let view;
                let uniform = {
                    index: index,
                    view: view,
                    size: size,
                    alignStride: alignStride,
                    offset: this._currentLength * 4,
                    dataView: tsc,
                    viewByteLength: tsc.BYTES_PER_ELEMENT * alignStride,
                    arrayLength: 0,
                };
                this.uniforms.set(index, uniform);
                this._currentLength += size;
                this._byteLength += size * tsc.BYTES_PER_ELEMENT;
            }
        }
        addUniform(index, type, arraySize = 0) {
            let alignStride = 0;
            switch (type) {
                case Laya.ShaderDataType.Int:
                case Laya.ShaderDataType.Bool:
                    alignStride = 1;
                    this.addUniformItem(index, 1, alignStride, arraySize, Int32Array);
                    break;
                case Laya.ShaderDataType.Float:
                    alignStride = 1;
                    this.addUniformItem(index, 1, alignStride, arraySize, Float32Array);
                    break;
                case Laya.ShaderDataType.Vector2:
                    alignStride = 2;
                    this.addUniformItem(index, 2, alignStride, arraySize, Float32Array);
                    break;
                case Laya.ShaderDataType.Vector3:
                    alignStride = 3;
                    this.addUniformItem(index, 3, alignStride, arraySize, Float32Array);
                    break;
                case Laya.ShaderDataType.Vector4u:
                    alignStride = 4;
                    this.addUniformItem(index, 4, alignStride, arraySize, Uint32Array);
                    break;
                case Laya.ShaderDataType.Vector4:
                case Laya.ShaderDataType.Color:
                    alignStride = 4;
                    this.addUniformItem(index, 4, alignStride, arraySize, Float32Array);
                    break;
                case Laya.ShaderDataType.Matrix3x3:
                    alignStride = 12;
                    this.addUniformItem(index, 12, alignStride, arraySize, Float32Array);
                    break;
                case Laya.ShaderDataType.Matrix4x4:
                    alignStride = 16;
                    this.addUniformItem(index, 16, alignStride, arraySize, Float32Array);
                    break;
                case Laya.ShaderDataType.Buffer:
                    console.log("ShaderDataType.Buffer not support");
                    break;
                case Laya.ShaderDataType.Texture2D:
                case Laya.ShaderDataType.Texture3D:
                case Laya.ShaderDataType.TextureCube:
                case Laya.ShaderDataType.Texture2DArray:
                case Laya.ShaderDataType.None:
            }
        }
        finish(alignment = 0) {
            alignment = alignment > this._maxAlignment ? alignment : this._maxAlignment;
            this._maxAlignment = alignment;
            this.alignmentPadding(alignment);
        }
        clone() {
            let descriptor = new WebGLUniformBufferDescriptor(this.name);
            this.cloneTo(descriptor);
            return descriptor;
        }
        cloneTo(destObject) {
            this.uniforms.forEach(uniform => {
                destObject.addUniformItem(uniform.index, uniform.size, uniform.alignStride, uniform.arrayLength, uniform.dataView);
            });
            destObject.finish(this._maxAlignment);
        }
        destroy() {
            this.uniforms.clear();
        }
    }

    class WebGLUniformBuffer extends Laya.UniformBufferWriter {
        constructor(name) {
            super();
            this.destroyed = false;
            this.name = name;
            this.descriptor = new WebGLUniformBufferDescriptor(name);
        }
        create() {
            let descriptor = this.descriptor;
            descriptor.finish();
            const buffer = new Uint8Array(descriptor.byteLength).buffer;
            this._data = new Float32Array(buffer);
            for (const [key, uniform] of descriptor.uniforms) {
                uniform.view = new uniform.dataView(buffer, uniform.offset, uniform.viewByteLength / uniform.dataView.BYTES_PER_ELEMENT);
            }
            this._buffer = Laya.LayaGL.renderEngine.createBuffer(Laya.BufferTargetType.UNIFORM_BUFFER, Laya.BufferUsage.Dynamic);
            this._buffer.bindBuffer();
            this._buffer.setDataLength(descriptor.byteLength);
            this.needUpload = true;
        }
        addUniform(index, type, arraySize = 0) {
            this.descriptor.addUniform(index, type, arraySize);
        }
        upload() {
            if (this.needUpload) {
                this._buffer.setData(this._data, 0);
                this.needUpload = false;
            }
        }
        bind(location) {
            this._buffer.bindBufferBase(location);
        }
        clone() {
            let buffer = new WebGLUniformBuffer(this.name);
            this.cloneTo(buffer);
            return buffer;
        }
        cloneTo(dest) {
            this.descriptor.cloneTo(dest.descriptor);
            dest.create();
            dest._data.set(this._data);
        }
        destroy() {
            this._data = null;
            this._buffer.destroy();
            this.descriptor.destroy();
            this.descriptor = null;
            this.destroyed = true;
        }
    }

    class WebGLShaderData extends Laya.ShaderData {
        get renderStateChanged() {
            return this._renderStateChanged;
        }
        updateRenderState() {
            var _a, _b, _c;
            this._renderStateChanged = false;
            const datas = this.getData();
            const renderState = this.renderState;
            let depthWrite = datas[Laya.Shader3D.DEPTH_WRITE];
            depthWrite = depthWrite !== null && depthWrite !== void 0 ? depthWrite : Laya.RenderState.Default.depthWrite;
            renderState.depthWrite = depthWrite;
            let depthTest = datas[Laya.Shader3D.DEPTH_TEST];
            depthTest = depthTest !== null && depthTest !== void 0 ? depthTest : Laya.RenderState.Default.depthTest;
            renderState.depthTest = depthTest;
            let stencilWrite = datas[Laya.Shader3D.STENCIL_WRITE];
            stencilWrite = stencilWrite !== null && stencilWrite !== void 0 ? stencilWrite : Laya.RenderState.Default.stencilWrite;
            renderState.stencilWrite = stencilWrite;
            let stencilWriteMask = ((_a = datas[Laya.Shader3D.STENCIL_WRITE_MASK]) !== null && _a !== void 0 ? _a : Laya.RenderState.Default.stencilWriteMask);
            renderState.stencilWriteMask = stencilWriteMask;
            let stencilOp = datas[Laya.Shader3D.STENCIL_Op];
            stencilOp = stencilOp !== null && stencilOp !== void 0 ? stencilOp : Laya.RenderState.Default.stencilOp;
            renderState.stencilOp.set(stencilOp.x, stencilOp.y, stencilOp.z);
            let stencilTest = datas[Laya.Shader3D.STENCIL_TEST];
            stencilTest = stencilTest !== null && stencilTest !== void 0 ? stencilTest : Laya.RenderState.Default.stencilTest;
            renderState.stencilTest = stencilTest;
            let stencilReadMask = (_b = datas[Laya.Shader3D.STENCIL_READ_MASK]) !== null && _b !== void 0 ? _b : Laya.RenderState.Default.stencilReadMask;
            renderState.stencilReadMask = stencilReadMask;
            var stencilRef = datas[Laya.Shader3D.STENCIL_Ref];
            stencilRef = stencilRef !== null && stencilRef !== void 0 ? stencilRef : Laya.RenderState.Default.stencilRef;
            renderState.stencilRef = stencilRef;
            let depthBias = (_c = datas[Laya.Shader3D.DEPTH_BIAS]) !== null && _c !== void 0 ? _c : Laya.RenderState.Default.depthBias;
            renderState.depthBias = depthBias;
            let depthBiasConstant = datas[Laya.Shader3D.DEPTH_BIAS_CONSTANT];
            depthBiasConstant = depthBiasConstant !== null && depthBiasConstant !== void 0 ? depthBiasConstant : Laya.RenderState.Default.depthBiasConstant;
            renderState.depthBiasConstant = depthBiasConstant;
            let depthBiasSlopeScale = datas[Laya.Shader3D.DEPTH_BIAS_SLOPESCALE];
            depthBiasSlopeScale = depthBiasSlopeScale !== null && depthBiasSlopeScale !== void 0 ? depthBiasSlopeScale : Laya.RenderState.Default.depthBiasSlopeScale;
            renderState.depthBiasSlopeScale = depthBiasSlopeScale;
            let depthBiasClamp = datas[Laya.Shader3D.DEPTH_BIAS_CLAMP];
            depthBiasClamp = depthBiasClamp !== null && depthBiasClamp !== void 0 ? depthBiasClamp : Laya.RenderState.Default.depthBiasClamp;
            renderState.depthBiasClamp = depthBiasClamp;
            let blend = datas[Laya.Shader3D.BLEND];
            blend = blend !== null && blend !== void 0 ? blend : Laya.RenderState.Default.blend;
            renderState.blend = blend;
            let blendEquation = datas[Laya.Shader3D.BLEND_EQUATION];
            blendEquation = blendEquation !== null && blendEquation !== void 0 ? blendEquation : Laya.RenderState.Default.blendEquation;
            renderState.blendEquation = blendEquation;
            let srcBlend = datas[Laya.Shader3D.BLEND_SRC];
            srcBlend = srcBlend !== null && srcBlend !== void 0 ? srcBlend : Laya.RenderState.Default.srcBlend;
            renderState.srcBlend = srcBlend;
            let dstBlend = datas[Laya.Shader3D.BLEND_DST];
            dstBlend = dstBlend !== null && dstBlend !== void 0 ? dstBlend : Laya.RenderState.Default.dstBlend;
            renderState.dstBlend = dstBlend;
            let blendEquationRGB = datas[Laya.Shader3D.BLEND_EQUATION_RGB];
            blendEquationRGB = blendEquationRGB !== null && blendEquationRGB !== void 0 ? blendEquationRGB : Laya.RenderState.Default.blendEquationRGB;
            renderState.blendEquationRGB = blendEquationRGB;
            let blendEquationAlpha = datas[Laya.Shader3D.BLEND_EQUATION_ALPHA];
            blendEquationAlpha = blendEquationAlpha !== null && blendEquationAlpha !== void 0 ? blendEquationAlpha : Laya.RenderState.Default.blendEquationAlpha;
            renderState.blendEquationAlpha = blendEquationAlpha;
            let srcRGB = datas[Laya.Shader3D.BLEND_SRC_RGB];
            srcRGB = srcRGB !== null && srcRGB !== void 0 ? srcRGB : Laya.RenderState.Default.srcBlendRGB;
            renderState.srcBlendRGB = srcRGB;
            let dstRGB = datas[Laya.Shader3D.BLEND_DST_RGB];
            dstRGB = dstRGB !== null && dstRGB !== void 0 ? dstRGB : Laya.RenderState.Default.dstBlendRGB;
            renderState.dstBlendRGB = dstRGB;
            let srcAlpha = datas[Laya.Shader3D.BLEND_SRC_ALPHA];
            srcAlpha = srcAlpha !== null && srcAlpha !== void 0 ? srcAlpha : Laya.RenderState.Default.srcBlendAlpha;
            renderState.srcBlendAlpha = srcAlpha;
            let dstAlpha = datas[Laya.Shader3D.BLEND_DST_ALPHA];
            dstAlpha = dstAlpha !== null && dstAlpha !== void 0 ? dstAlpha : Laya.RenderState.Default.dstBlendAlpha;
            renderState.dstBlendAlpha = dstAlpha;
            let cull = datas[Laya.Shader3D.CULL];
            cull = cull !== null && cull !== void 0 ? cull : Laya.RenderState.Default.cull;
            renderState.cull = cull;
            const engine = WebGLEngine.instance;
            const hash = engine.hashRenderState(renderState);
            renderState.hash = hash;
            this._renderStateChanged = false;
        }
        _checkRenderState(index) {
            if (Laya.isRenderStateProperty(index)) {
                this._renderStateChanged = true;
            }
        }
        constructor(ownerResource = null) {
            super(ownerResource);
            this._data = null;
            this._defineDatas = new WebDefineDatas();
            this._id = WebGLShaderData.pointerCount++;
            this._singleUniformBuffer = null;
            this._needCacheData = false;
            this._updateCacheArray = null;
            this._bufferMgr = null;
            this._pendingRound = -1;
            this._renderStateChanged = true;
            this.renderState = new Laya.RenderState();
            this._initData();
        }
        _initData() {
            this._data = {};
            this._updateCacheArray = {};
            this._gammaColorMap = new Map();
            this._uniformBuffers = new Map();
            this._singleUniformBuffer = null;
            this._subUniformBuffers = new Map();
            this._uniformBuffersPropertyMap = new Map();
        }
        createUniformBuffer(name, uniformMap, needUpdata = false) {
            if (this._uniformBuffers.has(name)) {
                if (needUpdata) {
                    this._updateUBOBuffer(name);
                }
                return this._uniformBuffers.get(name);
            }
            this._needCacheData = true;
            let uboBuffer = new WebGLUniformBuffer(name);
            uniformMap.forEach(uniform => {
                uboBuffer.addUniform(uniform.id, uniform.uniformtype, uniform.arrayLength);
            });
            uboBuffer.create();
            this._uniformBuffers.set(name, uboBuffer);
            this._singleUniformBuffer = this._uniformBuffers.size === 1 ? uboBuffer : null;
            let id = Laya.Shader3D.propertyNameToID(name);
            this._data[id] = uboBuffer;
            uniformMap.forEach(uniform => {
                let uniformId = uniform.id;
                let data = this._data[uniformId];
                if (data != null) {
                    uboBuffer.setUniformData(uniformId, uniform.uniformtype, data);
                }
                this._uniformBuffersPropertyMap.set(uniformId, uboBuffer);
            });
            this._uboLayoutVersion++;
            uboBuffer.needUpload && uboBuffer.upload();
            return uboBuffer;
        }
        _markPendingApply() {
            const mgr = this._bufferMgr;
            if (!mgr || this._pendingRound === mgr._uploadRound)
                return;
            this._pendingRound = mgr._uploadRound;
            mgr._pendingApply.add(this);
        }
        _updateUBOBuffer(name) {
            if (!Laya.Config._uniformBlock) {
                return;
            }
            let buffer = this._uniformBuffers.get(name) || this._subUniformBuffers.get(name);
            if (!buffer) {
                return;
            }
            for (var i in this._updateCacheArray) {
                let index = parseInt(i);
                let ubo = this._uniformBuffersPropertyMap.get(index);
                if (ubo) {
                    this._updateCacheArray[i].call(ubo, index, this._data[index]);
                }
            }
            this._updateCacheArray = {};
            buffer.needUpload && buffer.upload();
        }
        createSubUniformBuffer(name, cacheName, uniformMap) {
            let subBuffer = this._subUniformBuffers.get(cacheName);
            if (subBuffer) {
                return subBuffer;
            }
            let engine = WebGLEngine.instance;
            let mgr = engine.bufferMgr;
            let descriptor = new WebGLUniformBufferDescriptor(name);
            uniformMap.forEach(uniform => {
                descriptor.addUniform(uniform.id, uniform.uniformtype, uniform.arrayLength);
            });
            descriptor.finish(mgr.byteAlign / 4);
            let uniformBuffer = mgr.getBlock(descriptor.byteLength, descriptor, this);
            this._bufferMgr = mgr;
            this._needCacheData = true;
            this._subUniformBuffers.set(cacheName, uniformBuffer);
            let id = Laya.Shader3D.propertyNameToID(name);
            this._data[id] = uniformBuffer;
            uniformMap.forEach(uniform => {
                let uniformId = uniform.id;
                let data = this._data[uniformId];
                if (data != null) {
                    uniformBuffer.setUniformData(uniformId, uniform.uniformtype, data);
                }
                this._uniformBuffersPropertyMap.set(uniformId, uniformBuffer);
            });
            this._uboLayoutVersion++;
            return uniformBuffer;
        }
        _getUniformBlockByProperty(index) {
            const buf = this._uniformBuffersPropertyMap.get(index);
            return buf instanceof WebGLSubUniformBuffer ? buf : null;
        }
        getData() {
            return this._data;
        }
        addDefine(define) {
            this._defineDatas.add(define);
        }
        addDefines(define) {
            this._defineDatas.addDefineDatas(define);
        }
        removeDefine(define) {
            this._defineDatas.remove(define);
        }
        removeDefines(defines) {
            this._defineDatas.removeDefineDatas(defines);
        }
        hasDefine(define) {
            return this._defineDatas.has(define);
        }
        clearDefine() {
            this._defineDatas.clear();
        }
        clearData() {
            this._bufferMgr = null;
            this._updateCacheArray = {};
            for (const key in this._data) {
                if (this._data[key] instanceof Laya.Resource) {
                    this._data[key]._removeReference();
                }
            }
            this._uniformBuffersPropertyMap.clear();
            this._uboLayoutVersion++;
            this._uniformBuffers.forEach(buffer => {
                buffer.destroy();
            });
            this._uniformBuffers.clear();
            this._singleUniformBuffer = null;
            this._subUniformBuffers.forEach(buffer => {
                buffer.destroy();
            });
            this._subUniformBuffers.clear();
            this._data = {};
            this._gammaColorMap.clear();
            this.clearDefine();
            this._needCacheData = false;
            this.renderState.setNull();
        }
        getBool(index) {
            return this._data[index];
        }
        setBool(index, value) {
            this._data[index] = value;
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setBool;
                this._markPendingApply();
            }
            this._checkRenderState(index);
        }
        getInt(index) {
            return this._data[index];
        }
        setInt(index, value) {
            this._data[index] = value;
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setInt;
                this._markPendingApply();
            }
            this._checkRenderState(index);
        }
        getNumber(index) {
            return this._data[index];
        }
        setNumber(index, value) {
            this._data[index] = value;
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setFloat;
                this._markPendingApply();
            }
            this._checkRenderState(index);
        }
        getVector2(index) {
            return this._data[index];
        }
        setVector2(index, value) {
            if (this._data[index]) {
                value.cloneTo(this._data[index]);
            }
            else
                this._data[index] = value.clone();
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setVector2;
                this._markPendingApply();
            }
        }
        getVector3(index) {
            return this._data[index];
        }
        setVector3(index, value) {
            if (this._data[index]) {
                value.cloneTo(this._data[index]);
            }
            else
                this._data[index] = value.clone();
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setVector3;
                this._markPendingApply();
            }
        }
        getVector(index) {
            return this._data[index];
        }
        setVector(index, value) {
            if (this._data[index]) {
                value.cloneTo(this._data[index]);
            }
            else
                this._data[index] = value.clone();
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setVector4;
                this._markPendingApply();
            }
        }
        getColor(index) {
            return this._gammaColorMap.get(index);
        }
        setColor(index, value) {
            if (!value)
                return;
            if (this._data[index]) {
                let gammaColor = this._gammaColorMap.get(index);
                value.cloneTo(gammaColor);
                let linearColor = this._data[index];
                linearColor.x = Laya.Color.gammaToLinearSpace(value.r);
                linearColor.y = Laya.Color.gammaToLinearSpace(value.g);
                linearColor.z = Laya.Color.gammaToLinearSpace(value.b);
                linearColor.w = value.a;
            }
            else {
                let linearColor = new Laya.Vector4();
                linearColor.x = Laya.Color.gammaToLinearSpace(value.r);
                linearColor.y = Laya.Color.gammaToLinearSpace(value.g);
                linearColor.z = Laya.Color.gammaToLinearSpace(value.b);
                linearColor.w = value.a;
                this._data[index] = linearColor;
                this._gammaColorMap.set(index, value.clone());
            }
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setVector4;
                this._markPendingApply();
            }
        }
        getLinearColor(index) {
            return this._data[index];
        }
        getMatrix4x4(index) {
            return this._data[index];
        }
        setMatrix4x4(index, value) {
            if (this._data[index]) {
                value.cloneTo(this._data[index]);
            }
            else {
                this._data[index] = value.clone();
            }
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setMatrix4x4;
                this._markPendingApply();
            }
        }
        getMatrix3x3(index) {
            return this._data[index];
        }
        setMatrix3x3(index, value) {
            if (this._data[index]) {
                value.cloneTo(this._data[index]);
            }
            else {
                this._data[index] = value.clone();
            }
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setMatrix3x3;
                this._markPendingApply();
            }
        }
        getBuffer(index) {
            return this._data[index];
        }
        setBuffer(index, value) {
            this._data[index] = value;
            if (this._needCacheData) {
                this._updateCacheArray[index] = Laya.UniformBufferWriter.prototype.setArrayBuffer;
                this._markPendingApply();
            }
        }
        setTexture(index, value) {
            var lastValue = this._data[index];
            if (value) {
                let shaderDefine = WebGLEngine._texGammaDefine[index];
                if (shaderDefine && value && value.gammaCorrection > 1) {
                    this.addDefine(shaderDefine);
                }
                else {
                    shaderDefine && this.removeDefine(shaderDefine);
                }
            }
            this._data[index] = value;
            lastValue && lastValue._removeReference();
            value && value._addReference();
        }
        _setInternalTexture(index, value) {
            this._data[index];
            if (value) {
                let shaderDefine = WebGLEngine._texGammaDefine[index];
                if (shaderDefine && value && value.gammaCorrection > 1) {
                    this.addDefine(shaderDefine);
                }
                else {
                    shaderDefine && this.removeDefine(shaderDefine);
                }
            }
            this._data[index] = value;
        }
        uploadCache() {
            let uploaded = false;
            for (let i in this._updateCacheArray) {
                uploaded = true;
                let index = parseInt(i);
                let ubo = this._uniformBuffersPropertyMap.get(index);
                if (ubo) {
                    this._updateCacheArray[i].call(ubo, index, this._data[index]);
                }
            }
            if (uploaded) {
                this._updateCacheArray = {};
            }
            const single = this._singleUniformBuffer;
            if (single) {
                single.needUpload && single.upload();
            }
            else if (this._uniformBuffers.size > 1) {
                this._uniformBuffers.forEach(buffer => {
                    buffer.needUpload && buffer.upload();
                });
            }
        }
        update(name) {
            if (Laya.Config._uniformBlock) {
                let unifomrMap = Laya.LayaGL.renderDeviceFactory.createGlobalUniformMap(name);
                let uniformBuffer = this.createSubUniformBuffer(name, name, unifomrMap._idata);
                if (uniformBuffer) {
                    uniformBuffer.upload();
                }
            }
        }
        getTexture(index) {
            return this._data[index];
        }
        getSourceIndex(value) {
            for (var i in this._data) {
                if (this._data[i] == value)
                    return Number(i);
            }
            return -1;
        }
        cloneTo(destObject) {
            destObject.clearData();
            var destData = destObject._data;
            for (var k in this._data) {
                var value = this._data[k];
                if (value != null) {
                    if (typeof value == "number") {
                        destData[k] = value;
                    }
                    else if (typeof value == "boolean") {
                        destData[k] = value;
                    }
                    else if (value instanceof Laya.Vector2) {
                        let v2 = destData[k] || (destData[k] = new Laya.Vector2());
                        value.cloneTo(v2);
                    }
                    else if (value instanceof Laya.Vector3) {
                        let v3 = destData[k] || (destData[k] = new Laya.Vector3());
                        value.cloneTo(v3);
                    }
                    else if (value instanceof Laya.Vector4) {
                        let color = this.getColor(parseInt(k));
                        if (color) {
                            let clonecolor = color.clone();
                            destObject.setColor(parseInt(k), clonecolor);
                        }
                        else {
                            let v4 = destData[k] || (destData[k] = new Laya.Vector4());
                            value.cloneTo(v4);
                        }
                    }
                    else if (value instanceof Laya.Matrix3x3) {
                        let mat = destData[k] || (destData[k] = new Laya.Matrix3x3());
                        value.cloneTo(mat);
                    }
                    else if (value instanceof Laya.Matrix4x4) {
                        let mat = destData[k] || (destData[k] = new Laya.Matrix4x4());
                        value.cloneTo(mat);
                    }
                    else if (value instanceof Laya.Resource) {
                        destData[k] = value;
                        value._addReference();
                    }
                }
            }
            this._defineDatas.cloneTo(destObject._defineDatas);
            this._gammaColorMap.forEach((color, index) => {
                destObject._gammaColorMap.set(index, color.clone());
            });
        }
        getDefineData() {
            return this._defineDatas;
        }
        clone() {
            var dest = new WebGLShaderData();
            this.cloneTo(dest);
            return dest;
        }
        destroy() {
            if (this.destroyed) {
                return;
            }
            this.clearData();
            this._defineDatas.destroy();
            this._defineDatas = null;
            this.destroyed = true;
        }
    }
    WebGLShaderData.pointerCount = 0;

    class WebShaderPass {
        get renderState() {
            return this._renderState;
        }
        set renderState(value) {
            this._renderState = value;
        }
        get validDefine() {
            return this._validDefine;
        }
        set validDefine(value) {
            this._validDefine = value;
        }
        constructor(pass) {
            this._cacheShaderHierarchy = 1;
            this._cacheSharders = {};
            this._renderState = new Laya.RenderState();
            this._renderState.setNull();
        }
        _resizeCacheShaderMap(cacheMap, hierarchy, resizeLength) {
            var end = this._cacheShaderHierarchy - 1;
            if (hierarchy == end) {
                for (var k in cacheMap) {
                    var shader = cacheMap[k];
                    for (var i = 0, n = resizeLength - end; i < n; i++) {
                        if (i === n - 1)
                            cacheMap[0] = shader;
                        else
                            cacheMap = cacheMap[i == 0 ? k : 0] = {};
                    }
                }
            }
            else {
                ++hierarchy;
                for (var k in cacheMap)
                    this._resizeCacheShaderMap(cacheMap[k], hierarchy, resizeLength);
            }
        }
        setCacheShader(compileDefine, shader) {
            var cacheShaders = this._cacheSharders;
            var mask = compileDefine._mask;
            var endIndex = compileDefine._length - 1;
            var maxEndIndex = this._cacheShaderHierarchy - 1;
            for (var i = 0; i < maxEndIndex; i++) {
                var subMask = endIndex < i ? 0 : mask[i];
                var subCacheShaders = cacheShaders[subMask];
                (subCacheShaders) || (cacheShaders[subMask] = subCacheShaders = {});
                cacheShaders = subCacheShaders;
            }
            var cacheKey = endIndex < maxEndIndex ? 0 : mask[maxEndIndex];
            cacheShaders[cacheKey] = shader;
        }
        getCacheShader(compileDefine) {
            compileDefine._intersectionDefineDatas(this._validDefine);
            var cacheShaders = this._cacheSharders;
            var maskLength = compileDefine._length;
            if (maskLength > this._cacheShaderHierarchy) {
                this._resizeCacheShaderMap(cacheShaders, 0, maskLength);
                this._cacheShaderHierarchy = maskLength;
            }
            var mask = compileDefine._mask;
            var endIndex = compileDefine._length - 1;
            var maxEndIndex = this._cacheShaderHierarchy - 1;
            for (var i = 0; i < maxEndIndex; i++) {
                var subMask = endIndex < i ? 0 : mask[i];
                var subCacheShaders = cacheShaders[subMask];
                (subCacheShaders) || (cacheShaders[subMask] = subCacheShaders = {});
                cacheShaders = subCacheShaders;
            }
            var cacheKey = endIndex < maxEndIndex ? 0 : mask[maxEndIndex];
            var shader = cacheShaders[cacheKey];
            return shader;
        }
        destroy() {
        }
    }

    class WebSubShader {
        setUniformMap(_uniformMap) {
        }
        destroy() {
            throw new Laya.NotImplementedError();
        }
        addShaderPass(pass) { }
    }

    class WebUnitRenderModuleDataFactory {
        createSubShader() {
            return new WebSubShader();
        }
        createShaderPass(pass) {
            return new WebShaderPass(pass);
        }
        createRenderState() {
            return new Laya.RenderState();
        }
        createDefineDatas() {
            return new WebDefineDatas();
        }
    }
    Laya.Laya.addBeforeInitCallback(() => {
        if (!Laya.LayaGL.unitRenderModuleDataFactory)
            Laya.LayaGL.unitRenderModuleDataFactory = new WebUnitRenderModuleDataFactory();
    });

    class WebGLSetRendertarget2DCMD extends Laya.SetRendertarget2DCMD {
        constructor() {
            super();
            this.type = Laya.RenderCMDType.ChangeRenderTarget;
            this._clearColorValue = new Laya.Color();
        }
        apply(context) {
            if (this.rt)
                context.invertY = this.invertY;
            else
                context.invertY = false;
            let targetHeight = this.rt ? this.size.y : Laya.RenderState2D.height;
            let vpY = context.invertY ? this.viewportY : targetHeight - this.viewportY - this.size.y;
            context.setOffscreenView(this.size.x, this.size.y, this.viewportX, vpY);
            context.setRenderTarget(this.rt, this.clearColor, this.clearColorValue);
            context.passData.setVector2(Laya.ShaderDefines2D.UNIFORM_SIZE, this.size);
        }
    }
    class WebGLDraw2DElementCMD extends Laya.Draw2DElementCMD {
        constructor() {
            super();
            this.type = Laya.RenderCMDType.DrawElement;
        }
        setRenderelements(value) {
            this._elements = value;
        }
        apply(context) {
            if (this._elements.length == 1) {
                context.drawRenderElementOne(this._elements[0]);
            }
            else {
                this._elements.forEach(element => {
                    context.drawRenderElementOne(element);
                });
            }
        }
    }
    class WebGLBlit2DQuadCMD extends Laya.Blit2DQuadCMD {
        static _init_() {
            WebGLBlit2DQuadCMD.SCREENTEXTURE_ID = Laya.Shader3D.propertyNameToID("u_MainTex");
            WebGLBlit2DQuadCMD.SCREENTEXTUREOFFSETSCALE_ID = Laya.Shader3D.propertyNameToID("u_OffsetScale");
            WebGLBlit2DQuadCMD.MAINTEXTURE_TEXELSIZE_ID = Laya.Shader3D.propertyNameToID("u_MainTex_TexelSize");
            WebGLBlit2DQuadCMD.GammaCorrect = Laya.Shader3D.getDefineByName("GAMMACORRECT");
        }
        constructor() {
            super();
            if (!WebGLBlit2DQuadCMD.SCREENTEXTURE_ID) {
                WebGLBlit2DQuadCMD._init_();
            }
            this.type = Laya.RenderCMDType.Blit;
            this._offsetScale = new Laya.Vector4();
            this._sourceTexelSize = new Laya.Vector4();
        }
        set source(value) {
            this._source = value;
            if (this._source) {
                this._sourceTexelSize.setValue(1.0 / this._source.width, 1.0 / this._source.height, this._source.width, this._source.height);
            }
        }
        apply(context) {
            let dest = this._dest || context._destRT;
            if (!dest || dest._textures[0].gammaCorrection != 1) {
                this.element.materialShaderData.addDefine(WebGLBlit2DQuadCMD.GammaCorrect);
            }
            else {
                this.element.materialShaderData.removeDefine(WebGLBlit2DQuadCMD.GammaCorrect);
            }
            if (!dest) {
                context.invertY = false;
            }
            this.element.materialShaderData._setInternalTexture(WebGLBlit2DQuadCMD.SCREENTEXTURE_ID, this._source);
            this.element.materialShaderData.setVector(WebGLBlit2DQuadCMD.SCREENTEXTUREOFFSETSCALE_ID, this._offsetScale);
            this.element.materialShaderData.setVector(WebGLBlit2DQuadCMD.MAINTEXTURE_TEXELSIZE_ID, this._sourceTexelSize);
            context.setRenderTarget(this._dest, false, Laya.Color.BLACK);
            context.drawRenderElementOne(this.element);
        }
    }

    class Pass2DCacheInfo {
        constructor() {
            this.shaderInss = [];
            this.cacheFlagX = -1;
            this.cacheFlagY = -1;
            this.cachedDirtyVersion = -1;
            this.passDefineFlag = new Laya.Vector2(-1, -1);
        }
    }
    class WebGLRenderElement2D {
        constructor() {
            this.renderStateIsBySprite = true;
            this.stencilClipState = null;
            this.noBatch = false;
            this.type = 0;
            this._defineChangeFlag = new Laya.Vector2(-1, -1);
            this._dirtyVersion = 0;
            this._passCache = new Map();
        }
        get subShader() { return this._subShader; }
        set subShader(value) {
            if (this._subShader !== value) {
                this._subShader = value;
                this._dirtyVersion++;
            }
        }
        get materialShaderData() { return this._materialShaderData; }
        set materialShaderData(value) {
            if (this._materialShaderData !== value) {
                this._unregisterDefineFlag(this._materialShaderData);
                this._materialShaderData = value;
                this._registerDefineFlag(value);
                this._dirtyVersion++;
            }
        }
        get value2DShaderData() { return this._value2DShaderData; }
        set value2DShaderData(value) {
            if (this._value2DShaderData !== value) {
                this._unregisterDefineFlag(this._value2DShaderData);
                this._value2DShaderData = value;
                this._registerDefineFlag(value);
                this._dirtyVersion++;
            }
        }
        get globalShaderData() { return this._globalShaderData; }
        set globalShaderData(value) {
            if (this._globalShaderData !== value) {
                this._unregisterDefineFlag(this._globalShaderData);
                this._globalShaderData = value;
                this._registerDefineFlag(value);
                this._dirtyVersion++;
            }
        }
        _registerDefineFlag(data) {
            var _a;
            (_a = data === null || data === void 0 ? void 0 : data._defineDatas) === null || _a === void 0 ? void 0 : _a.addChangeFlagInfo(this._defineChangeFlag);
        }
        _unregisterDefineFlag(data) {
            var _a;
            (_a = data === null || data === void 0 ? void 0 : data._defineDatas) === null || _a === void 0 ? void 0 : _a.removeChangeFlagInfo(this._defineChangeFlag);
        }
        _getOrCreateCacheEntry(context) {
            let pd = context.passData || null;
            let arr = this._passCache.get(pd);
            if (!arr) {
                arr = [null, null, null, null];
                this._passCache.set(pd, arr);
            }
            let gamma = !context._destRT || context._destRT._textures[0].gammaCorrection != 1;
            let idx = (context.invertY ? 2 : 0) | (gamma ? 1 : 0);
            let entry = arr[idx];
            if (!entry) {
                entry = new Pass2DCacheInfo();
                if (pd === null || pd === void 0 ? void 0 : pd._defineDatas) {
                    pd._defineDatas.addChangeFlagInfo(entry.passDefineFlag);
                    entry.trackedPassData = pd;
                }
                arr[idx] = entry;
            }
            return entry;
        }
        _compileShader(context) {
            var passes = this._subShader._passes;
            let entry = this._curCacheEntry;
            let renderCount = 0;
            for (var j = 0, m = passes.length; j < m; j++) {
                var pass = passes[j];
                if (pass.pipelineMode !== context.pipelineMode)
                    continue;
                var comDef = WebGLRenderElement2D._compileDefine;
                if (this._globalShaderData) {
                    this._globalShaderData._defineDatas.cloneTo(comDef);
                }
                else {
                    context._globalConfigShaderData.cloneTo(comDef);
                }
                if (context.passData) {
                    comDef.addDefineDatas(context.passData._defineDatas);
                }
                let returnGamma = !(context._destRT) || ((context._destRT)._textures[0].gammaCorrection != 1);
                if (returnGamma) {
                    comDef.add(Laya.ShaderDefines2D.GAMMASPACE);
                }
                else {
                    comDef.remove(Laya.ShaderDefines2D.GAMMASPACE);
                }
                if (context.invertY) {
                    comDef.add(Laya.ShaderDefines2D.INVERTY);
                }
                else {
                    comDef.remove(Laya.ShaderDefines2D.INVERTY);
                }
                if (this._value2DShaderData) {
                    comDef.addDefineDatas(this._value2DShaderData.getDefineData());
                    pass.nodeCommonMap = this.nodeCommonMap;
                }
                if (this._materialShaderData)
                    comDef.addDefineDatas(this._materialShaderData._defineDatas);
                var shaderIns = pass.withCompile(comDef, true);
                entry.shaderInss[renderCount++] = shaderIns;
            }
            entry.shaderInss.length = renderCount;
        }
        _prepare(context) {
            this.globalShaderData = this.owner && this.owner._globalShaderData;
            let entry = this._getOrCreateCacheEntry(context);
            this._curCacheEntry = entry;
            let cfx = entry.cacheFlagX, cfy = entry.cacheFlagY;
            let dcf = this._defineChangeFlag;
            let pdf = entry.passDefineFlag;
            if (entry.cachedDirtyVersion !== this._dirtyVersion
                || dcf.x > cfx || (dcf.x === cfx && dcf.y > cfy)
                || pdf.x > cfx || (pdf.x === cfx && pdf.y > cfy)) {
                entry.cachedDirtyVersion = this._dirtyVersion;
                entry.cacheFlagX = Laya.Stat.loopCount;
                entry.cacheFlagY = WebGLEngine.instance._framePassCount;
                this._compileShader(context);
            }
        }
        _render(context) {
            context._prevTypeKey = -1;
            context._prevTextureKey = -1;
            context._prevClip = null;
            context._prevShaderIns = null;
            let inss = this._curCacheEntry.shaderInss;
            let count = inss.length;
            if (count === 1) {
                this.renderByShaderInstance(inss[0], context);
            }
            else {
                for (let j = 0; j < count; j++) {
                    this.renderByShaderInstance(inss[j], context);
                }
            }
        }
        _uploadGlobalAndPass(shader, context) {
            this._globalShaderData && shader.uploadUniforms(shader._cameraUniformParamsMap, this._globalShaderData, true);
            context.passData && shader.uploadUniforms(shader._sceneUniformParamsMap, context.passData, true);
        }
        renderByShaderInstance(shader, context) {
            if (!shader.complete || !this.geometry)
                return;
            shader.bind();
            this._uploadGlobalAndPass(shader, context);
            this._value2DShaderData && shader.uploadUniforms(shader._sprite2DUniformParamsMap, this._value2DShaderData, true);
            this._materialShaderData && shader.uploadUniforms(shader._materialUniformParamsMap, this._materialShaderData, true);
            if (this.renderStateIsBySprite || !this._materialShaderData) {
                if (this.stencilClipState)
                    context.applyStencil2DToShaderData(this._value2DShaderData, this.stencilClipState);
                shader.uploadRenderStateBlendDepth(this._value2DShaderData);
                shader.uploadRenderStateFrontFace(this._value2DShaderData, false, context.invertY);
            }
            else {
                if (this.stencilClipState)
                    context.applyStencil2DToShaderData(this._materialShaderData, this.stencilClipState);
                shader.uploadRenderStateBlendDepth(this._materialShaderData);
                shader.uploadRenderStateFrontFace(this._materialShaderData, false, context.invertY);
            }
            WebGLEngine.instance.getDrawContext().drawGeometryElement(this.geometry);
        }
        destroy() {
            this._unregisterDefineFlag(this._globalShaderData);
            this._unregisterDefineFlag(this._materialShaderData);
            this._unregisterDefineFlag(this._value2DShaderData);
            if (this._passCache) {
                this._passCache.forEach(arr => {
                    var _a, _b;
                    for (let i = 0; i < 4; i++) {
                        let entry = arr[i];
                        if (entry) {
                            (_b = (_a = entry.trackedPassData) === null || _a === void 0 ? void 0 : _a._defineDatas) === null || _b === void 0 ? void 0 : _b.removeChangeFlagInfo(entry.passDefineFlag);
                        }
                    }
                });
            }
            this._globalShaderData = null;
            this._materialShaderData = null;
            this._value2DShaderData = null;
            this._passCache = null;
            this._curCacheEntry = null;
        }
    }
    WebGLRenderElement2D._compileDefine = new WebDefineDatas();

    class WebGLPrimitiveRenderElement2D extends WebGLRenderElement2D {
        constructor() {
            super(...arguments);
            this.typeKey = 0;
            this.textureKey = 0;
        }
        get primitiveShaderData() { return this._primitiveShaderData; }
        set primitiveShaderData(value) {
            if (this._primitiveShaderData !== value) {
                this._unregisterDefineFlag(this._primitiveShaderData);
                this._primitiveShaderData = value;
                this._registerDefineFlag(value);
                this._dirtyVersion++;
            }
        }
        _compileShader(context) {
            var passes = this.subShader._passes;
            let entry = this._curCacheEntry;
            let renderCount = 0;
            for (var j = 0, m = passes.length; j < m; j++) {
                var pass = passes[j];
                if (pass.pipelineMode !== context.pipelineMode)
                    continue;
                var comDef = WebGLRenderElement2D._compileDefine;
                if (this.globalShaderData) {
                    this.globalShaderData._defineDatas.cloneTo(comDef);
                }
                else {
                    context._globalConfigShaderData.cloneTo(comDef);
                }
                if (context.passData) {
                    comDef.addDefineDatas(context.passData._defineDatas);
                }
                let returnGamma = !(context._destRT) || ((context._destRT)._textures[0].gammaCorrection != 1);
                if (returnGamma) {
                    comDef.add(Laya.ShaderDefines2D.GAMMASPACE);
                }
                else {
                    comDef.remove(Laya.ShaderDefines2D.GAMMASPACE);
                }
                if (context.invertY) {
                    comDef.add(Laya.ShaderDefines2D.INVERTY);
                }
                else {
                    comDef.remove(Laya.ShaderDefines2D.INVERTY);
                }
                if (this.value2DShaderData) {
                    comDef.addDefineDatas(this.value2DShaderData.getDefineData());
                    pass.nodeCommonMap = this.nodeCommonMap;
                }
                if (this.materialShaderData)
                    comDef.addDefineDatas(this.materialShaderData._defineDatas);
                if (this._primitiveShaderData) {
                    pass.additionShaderData = WebGLPrimitiveRenderElement2D._additionShaderData;
                    comDef.addDefineDatas(this._primitiveShaderData.getDefineData());
                }
                var shaderIns = pass.withCompile(comDef, true);
                entry.shaderInss[renderCount++] = shaderIns;
            }
            entry.shaderInss.length = renderCount;
        }
        _render(context) {
            let inss = this._curCacheEntry.shaderInss;
            let count = inss.length;
            if (count === 1) {
                let shaderIns = inss[0];
                let clipInfo = this.owner.getClipInfo();
                if (this.owner.renderType === context._prevRenderType
                    && this.typeKey === context._prevTypeKey
                    && clipInfo === context._prevClip
                    && shaderIns === context._prevShaderIns) {
                    if (this.needUploadPrimitiveUniform()) {
                        this.uploadFastPathUniform(shaderIns);
                    }
                    else if (this.textureKey !== context._prevTextureKey) {
                        this.uploadPrimitiveUniform(shaderIns, false);
                    }
                    WebGLEngine.instance.getDrawContext().drawGeometryElement(this.geometry);
                }
                else {
                    this.renderByShaderInstance(shaderIns, context);
                }
                context._prevTypeKey = this.typeKey;
                context._prevTextureKey = this.textureKey;
                context._prevClip = clipInfo;
                context._prevShaderIns = shaderIns;
            }
            else {
                for (let j = 0; j < count; j++) {
                    this.renderByShaderInstance(inss[j], context);
                }
            }
        }
        uploadPrimitiveUniform(shader, uploadUnTexture) {
            let encoder = shader._additionUniformParamsMaps.get("Sprite2DGraphics");
            encoder && this._primitiveShaderData && shader.uploadUniforms(encoder, this._primitiveShaderData, uploadUnTexture);
        }
        needUploadPrimitiveUniform() {
            return (this.typeKey & WebGLPrimitiveRenderElement2D._primitiveUniformDefineMask) !== 0;
        }
        needUploadSpriteUniform() {
            return (this.typeKey & WebGLPrimitiveRenderElement2D._spriteUniformDefineMask) !== 0;
        }
        uploadFastPathUniform(shader) {
            if (this.needUploadSpriteUniform()) {
                this.value2DShaderData && shader.uploadUniforms(shader._sprite2DUniformParamsMap, this.value2DShaderData, true);
            }
            this.uploadPrimitiveUniform(shader, true);
        }
        renderByShaderInstance(shader, context) {
            if (!shader.complete || !this.geometry)
                return;
            shader.bind();
            this._uploadGlobalAndPass(shader, context);
            this.value2DShaderData && shader.uploadUniforms(shader._sprite2DUniformParamsMap, this.value2DShaderData, true);
            this.materialShaderData && shader.uploadUniforms(shader._materialUniformParamsMap, this.materialShaderData, true);
            let encoder = shader._additionUniformParamsMaps.get("Sprite2DGraphics");
            encoder && this._primitiveShaderData && shader.uploadUniforms(encoder, this._primitiveShaderData, true);
            let shaderData = this.value2DShaderData;
            if (!this.renderStateIsBySprite) {
                if (this.materialShaderData) {
                    shaderData = this.materialShaderData;
                }
                else if (this._primitiveShaderData) {
                    shaderData = this._primitiveShaderData;
                }
            }
            if (this.stencilClipState)
                context.applyStencil2DToShaderData(shaderData, this.stencilClipState);
            shader.uploadRenderStateBlendDepth(shaderData);
            shader.uploadRenderStateFrontFace(shaderData, false, context.invertY);
            WebGLEngine.instance.getDrawContext().drawGeometryElement(this.geometry);
        }
        destroy() {
            this._unregisterDefineFlag(this._primitiveShaderData);
            this._primitiveShaderData = null;
            super.destroy();
        }
    }
    WebGLPrimitiveRenderElement2D._spriteUniformDefineMask = Laya.ShaderDefines2D.DEFINE_BIT_VERTEX_SIZE;
    WebGLPrimitiveRenderElement2D._primitiveUniformDefineMask = Laya.ShaderDefines2D.DEFINE_BIT_VERTEX_SIZE |
        Laya.ShaderDefines2D.DEFINE_BIT_FILLTEXTURE;
    WebGLPrimitiveRenderElement2D._additionShaderData = ["Sprite2DGraphics"];

    class WebGLSetRenderData extends Laya.SetRenderDataCMD {
        get dataType() {
            return this._dataType;
        }
        set dataType(value) {
            this._dataType = value;
        }
        get propertyID() {
            return this._propertyID;
        }
        set propertyID(value) {
            this._propertyID = value;
        }
        get dest() {
            return this._dest;
        }
        set dest(value) {
            this._dest = value;
        }
        get value() {
            return this._value;
        }
        set value(value) {
            switch (this.dataType) {
                case Laya.ShaderDataType.Int:
                case Laya.ShaderDataType.Float:
                case Laya.ShaderDataType.Bool:
                    this.data_number = value;
                    this._value = this.data_number;
                    break;
                case Laya.ShaderDataType.Matrix4x4:
                    !this.data_mat && (this.data_mat = new Laya.Matrix4x4());
                    value.cloneTo(this.data_mat);
                    this._value = this.data_mat;
                    break;
                case Laya.ShaderDataType.Color:
                    !this.data_Color && (this.data_Color = new Laya.Color());
                    value.cloneTo(this.data_Color);
                    this._value = this.data_Color;
                    break;
                case Laya.ShaderDataType.Texture2D:
                    this._value = this.data_texture = value;
                    break;
                case Laya.ShaderDataType.Vector4:
                    !this.data_v4 && (this.data_v4 = new Laya.Vector4());
                    value.cloneTo(this.data_v4);
                    this._value = this.data_v4;
                    break;
                case Laya.ShaderDataType.Vector2:
                    !this.data_v2 && (this.data_v2 = new Laya.Vector2());
                    value.cloneTo(this.data_v2);
                    this._value = this.data_v2;
                    break;
                case Laya.ShaderDataType.Vector3:
                    !this.data_v3 && (this.data_v3 = new Laya.Vector3());
                    value.cloneTo(this.data_v3);
                    this._value = this.data_v3;
                    break;
                case Laya.ShaderDataType.Buffer:
                    this._value = this.data_Buffer = value;
                    break;
            }
        }
        constructor() {
            super();
            this.type = Laya.RenderCMDType.ChangeData;
        }
        apply(context) {
            switch (this.dataType) {
                case Laya.ShaderDataType.Int:
                    this.dest.setInt(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Float:
                    this.dest.setNumber(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Bool:
                    this.dest.setBool(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Matrix4x4:
                    this.dest.setMatrix4x4(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Color:
                    this.dest.setColor(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Texture2D:
                    this.dest.setTexture(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Vector4:
                    this.dest.setVector(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Vector2:
                    this.dest.setVector2(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Vector3:
                    this.dest.setVector3(this.propertyID, this.value);
                    break;
                case Laya.ShaderDataType.Buffer:
                    this.dest.setBuffer(this.propertyID, this.value);
                    break;
            }
        }
    }
    class WebGLSetShaderDefine extends Laya.SetShaderDefineCMD {
        get define() {
            return this._define;
        }
        set define(value) {
            this._define = value;
        }
        get dest() {
            return this._dest;
        }
        set dest(value) {
            this._dest = value;
        }
        get add() {
            return this._add;
        }
        set add(value) {
            this._add = value;
        }
        constructor() {
            super();
            this.type = Laya.RenderCMDType.ChangeShaderDefine;
        }
        apply(context) {
            if (this.add) {
                this._dest.addDefine(this.define);
            }
            else {
                this._dest.removeDefine(this.define);
            }
        }
    }

    class WebglRenderContext2D {
        constructor() {
            this._clearColor = new Laya.Color(0, 0, 0, 0);
            this.invertY = false;
            this.pipelineMode = "Forward";
            this._prevTypeKey = -1;
            this._prevTextureKey = -1;
            this._prevClip = null;
            this._prevShaderIns = null;
            this._prevRenderType = -1;
            this._stencilOpCache = new Map();
            this._offscreenX = 0;
            this._offscreenY = 0;
            this._globalConfigShaderData = Laya.Shader3D._configDefineValues;
        }
        drawRenderElementList(list) {
            let time = performance.now();
            this.prepareRenderElementList(list);
            Laya.LayaGL.statAgent.recordTimeData(Laya.StatElement.T_2DContextPre, performance.now() - time);
            time = performance.now();
            this.drawRenderElementListRange(list, 0, list.length);
            Laya.LayaGL.statAgent.recordTimeData(Laya.StatElement.T_2DContextRender, performance.now() - time);
            return 0;
        }
        prepareRenderElementList(list) {
            for (var i = 0, n = list.length; i < n; i++) {
                let element = list.elements[i];
                element._prepare(this);
            }
        }
        drawRenderElementListRange(list, start, end) {
            this.resetFastState();
            for (var i = start; i < end; i++) {
                const element = list.elements[i];
                element._render(this);
                this._prevRenderType = element.owner ? element.owner.renderType : -1;
            }
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_2DDrawCall, end - start);
            Laya.LayaGL.renderEngine._framePassCount++;
            return 0;
        }
        setOffscreenView(width, height, x = 0, y = 0) {
            this._offscreenWidth = width;
            this._offscreenHeight = height;
            this._offscreenX = x;
            this._offscreenY = y;
        }
        getOffscreenView(out) {
            out.setValue(this._offscreenX, this._offscreenY, this._offscreenWidth, this._offscreenHeight);
        }
        resetFastState() {
            this._prevTypeKey = -1;
            this._prevTextureKey = -1;
            this._prevClip = null;
            this._prevShaderIns = null;
            this._prevRenderType = -1;
        }
        applyStencil2DToShaderData(shaderData, stencilState) {
            if (!shaderData)
                return;
            if (!stencilState || !stencilState.enabled) {
                shaderData.setInt(Laya.Shader3D.STENCIL_TEST, Laya.RenderState.STENCILTEST_OFF);
                shaderData.setBool(Laya.Shader3D.STENCIL_WRITE, Laya.RenderState.Default.stencilWrite);
                shaderData.setInt(Laya.Shader3D.STENCIL_WRITE_MASK, Laya.RenderState.Default.stencilWriteMask);
                shaderData.setInt(Laya.Shader3D.STENCIL_READ_MASK, Laya.RenderState.Default.stencilReadMask);
                shaderData.setInt(Laya.Shader3D.STENCIL_Ref, Laya.RenderState.Default.stencilRef);
                shaderData.setVector3(Laya.Shader3D.STENCIL_Op, Laya.RenderState.Default.stencilOp);
                return;
            }
            shaderData.setInt(Laya.Shader3D.STENCIL_TEST, stencilState.test);
            shaderData.setBool(Laya.Shader3D.STENCIL_WRITE, stencilState.write);
            shaderData.setInt(Laya.Shader3D.STENCIL_WRITE_MASK, stencilState.writeMask);
            shaderData.setInt(Laya.Shader3D.STENCIL_READ_MASK, stencilState.readMask);
            shaderData.setInt(Laya.Shader3D.STENCIL_Ref, stencilState.ref);
            shaderData.setVector3(Laya.Shader3D.STENCIL_Op, this._getStencilOpVector(stencilState));
        }
        _getStencilOpVector(state) {
            const key = (state.opFail & 0xFF) | ((state.opZFail & 0xFF) << 8) | ((state.opZPass & 0xFF) << 16);
            let value = this._stencilOpCache.get(key);
            if (!value) {
                value = new Laya.Vector3(state.opFail, state.opZFail, state.opZPass);
                this._stencilOpCache.set(key, value);
            }
            return value;
        }
        setRenderTarget(value, clear, clearColor) {
            this._destRT = value;
            clearColor.cloneTo(this._clearColor);
            WebGLEngine.instance._GLRenderState.clearRenderStateCache();
            if (this._destRT) {
                const layer = this._destRT._arrayLayerIndex;
                WebGLEngine.instance.getTextureContext().bindRenderTarget(this._destRT, layer >= 0 ? layer : 0);
                WebGLEngine.instance.viewport(this._offscreenX, this._offscreenY, this._destRT._textures[0].width, this._destRT._textures[0].height);
            }
            else {
                WebGLEngine.instance.getTextureContext().bindoutScreenTarget();
                WebGLEngine.instance.viewport(this._offscreenX, this._offscreenY, this._offscreenWidth, this._offscreenHeight);
            }
            WebGLEngine.instance.scissorTest(false);
            WebGLEngine.instance.clearRenderTexture(clear ? Laya.RenderClearFlag.Color | Laya.RenderClearFlag.Stencil : Laya.RenderClearFlag.Nothing, this._clearColor);
        }
        getRenderTarget() {
            return this._destRT;
        }
        getStencilBits() {
            const gl = WebGLEngine.instance.gl;
            const bits = gl.getParameter(gl.STENCIL_BITS);
            return bits == null ? 8 : bits;
        }
        drawRenderElementOne(node) {
            node._prepare(this);
            node._render(this);
            this._prevRenderType = node.owner ? node.owner.renderType : -1;
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_2DDrawCall, 1);
            Laya.LayaGL.renderEngine._framePassCount++;
        }
        runOneCMD(cmd) {
            cmd.apply(this);
        }
        runCMDList(cmds) {
            cmds.forEach(element => {
                element.apply(this);
            });
        }
    }

    class WebGLStencilMaskElement2D extends WebGLRenderElement2D {
        constructor() {
            super(...arguments);
            this._nMatrix0 = new Laya.Vector3();
            this._nMatrix1 = new Laya.Vector3();
            this._stencilRef = -1;
            this._stencilReadMask = -1;
            this._stencilWriteMask = -1;
            this._stencilTest = -1;
            this._stencilOpZPass = -1;
            this._clipInfo = null;
            this._clipUpdateFrame = -1;
        }
        static create() {
            const element = new WebGLStencilMaskElement2D();
            element.geometry = Laya.ShaderDefines2D._stencilGeo;
            element.subShader = Laya.Shader2D.stencilShader.getSubShaderAt(0);
            element.nodeCommonMap = ["BaseRender2D"];
            element.renderStateIsBySprite = true;
            element.noBatch = true;
            element.value2DShaderData = Laya.LayaGL.renderDeviceFactory.createShaderData(null);
            element.value2DShaderData.addDefine(Laya.BaseRenderNode2D.SHADERDEFINE_BASERENDER2D);
            element.value2DShaderData.setColor(Laya.BaseRenderNode2D.BASERENDER2DCOLOR, Laya.Color.WHITE);
            element.value2DShaderData.setInt(Laya.Shader3D.CULL, Laya.RenderState.CULL_NONE);
            element.value2DShaderData.setInt(Laya.Shader3D.DEPTH_TEST, Laya.RenderState.DEPTHTEST_OFF);
            element.value2DShaderData.setBool(Laya.Shader3D.DEPTH_WRITE, false);
            element.value2DShaderData.setInt(Laya.Shader3D.STENCIL_TEST, Laya.RenderState.STENCILTEST_EQUAL);
            element.value2DShaderData.setBool(Laya.Shader3D.STENCIL_WRITE, true);
            element.value2DShaderData.setInt(Laya.Shader3D.STENCIL_READ_MASK, 0xFF);
            element.value2DShaderData.setInt(Laya.Shader3D.STENCIL_WRITE_MASK, 0xFF);
            element.value2DShaderData.setVector3(Laya.Shader3D.STENCIL_Op, new Laya.Vector3(Laya.RenderState.STENCILOP_KEEP, Laya.RenderState.STENCILOP_KEEP, Laya.RenderState.STENCILOP_INCR));
            return element;
        }
        setClip(owner, clipInfo, ref, opZPass) {
            this.owner = owner;
            this._clipInfo = clipInfo;
            this._clipUpdateFrame = -1;
            this._updateClipUniforms();
            if (this._stencilRef !== ref) {
                this._stencilRef = ref;
                this.value2DShaderData.setInt(Laya.Shader3D.STENCIL_Ref, ref);
            }
            if (this._stencilTest !== Laya.RenderState.STENCILTEST_EQUAL) {
                this._stencilTest = Laya.RenderState.STENCILTEST_EQUAL;
                this.value2DShaderData.setInt(Laya.Shader3D.STENCIL_TEST, Laya.RenderState.STENCILTEST_EQUAL);
            }
            if (this._stencilReadMask !== 0xFF) {
                this._stencilReadMask = 0xFF;
                this.value2DShaderData.setInt(Laya.Shader3D.STENCIL_READ_MASK, 0xFF);
            }
            if (this._stencilWriteMask !== 0xFF) {
                this._stencilWriteMask = 0xFF;
                this.value2DShaderData.setInt(Laya.Shader3D.STENCIL_WRITE_MASK, 0xFF);
            }
            if (this._stencilOpZPass !== opZPass) {
                this._stencilOpZPass = opZPass;
                this.value2DShaderData.setVector3(Laya.Shader3D.STENCIL_Op, new Laya.Vector3(Laya.RenderState.STENCILOP_KEEP, Laya.RenderState.STENCILOP_KEEP, opZPass));
            }
        }
        _updateClipUniforms() {
            const clipInfo = this._clipInfo;
            if (!clipInfo || this._clipUpdateFrame === clipInfo._updateFrame)
                return;
            const dir = clipInfo.clipMatDir;
            const mat = clipInfo.clipMatrix;
            this._clipUpdateFrame = clipInfo._updateFrame;
            this._nMatrix0.setValue(dir.x, dir.z, mat.tx);
            this._nMatrix1.setValue(dir.y, dir.w, mat.ty);
            this.value2DShaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_0, this._nMatrix0);
            this.value2DShaderData.setVector3(Laya.ShaderDefines2D.UNIFORM_NMATRIX_1, this._nMatrix1);
        }
        _prepare(context) {
            this._updateClipUniforms();
            super._prepare(context);
        }
        _render(context) {
            this._updateClipUniforms();
            const engine = WebGLEngine.instance;
            engine.colorMask(false, false, false, false);
            super._render(context);
            engine.colorMask(true, true, true, true);
        }
    }

    class WebGLRender2DProcess {
        constructor() {
        }
        createTransform2DMemoryFactory() {
            return new WebTransform2DMemoryFactory();
        }
        createPrimitiveRenderElement2D() {
            return new WebGLPrimitiveRenderElement2D();
        }
        createRender2DPassManager() {
            return new WebRender2DPassManager();
        }
        create2DGlobalRenderDataHandle() {
            return new WebGlobalRenderData();
        }
        createSubStructRenderDataHandle() {
            return new WebSubStructRenderDataHandle();
        }
        createGraphicsSingleQuadDataHandle() {
            return new WebGraphicsSingleQuadDataHandle();
        }
        createGraphicsCommandStreamDataHandle() {
            return new WebGraphicsCommandStreamDataHandle();
        }
        createGraphicsOp2DFactory() {
            return new WebGraphicsOp2DFactory();
        }
        create2DBaseRenderDataHandle() {
            return new Web2DBaseRenderDataHandle();
        }
        createMesh2DRenderDataHandle() {
            return new WebMesh2DRenderDataHandle();
        }
        createSetRenderDataCMD() {
            return new WebGLSetRenderData();
        }
        createSetShaderDefineCMD() {
            return new WebGLSetShaderDefine();
        }
        createBlit2DQuadCMDData() {
            return new WebGLBlit2DQuadCMD();
        }
        createDraw2DElementCMDData() {
            return new WebGLDraw2DElementCMD();
        }
        createSetRendertarget2DCMD() {
            return new WebGLSetRendertarget2DCMD();
        }
        createRenderElement2D() {
            return new WebGLRenderElement2D();
        }
        createStencilMaskElement2D() {
            return WebGLStencilMaskElement2D.create();
        }
        createRenderContext2D() {
            return new WebglRenderContext2D();
        }
        createRender2DPass() {
            return new WebRender2DPass();
        }
        createRenderStruct2D() {
            return new WebRenderStruct2D();
        }
        createEmptyRenderDataHandle() {
            return new WebEmptyRender2DDataHandle();
        }
    }
    Laya.Laya.addBeforeInitCallback(() => {
        if (!Laya.LayaGL.render2DRenderPassFactory)
            Laya.LayaGL.render2DRenderPassFactory = new WebGLRender2DProcess();
    });

    class WebGLBufferState {
        constructor() {
            this._glVertexState = WebGLEngine.instance.createVertexState();
        }
        applyVertexBuffers() {
            this._glVertexState.applyVertexBuffer(this._vertexBuffers);
        }
        applyIndexBuffers() {
            this._glVertexState.applyIndexBuffer(this._bindedIndexBuffer);
        }
        applyState(vertexBuffers, indexBuffer) {
            this._vertexBuffers = vertexBuffers.slice();
            this._bindedIndexBuffer = indexBuffer;
            indexBuffer && indexBuffer._glBuffer.unbindBuffer();
            this.bind();
            this.applyVertexBuffers();
            this.applyIndexBuffers();
            this.unBind();
            indexBuffer && indexBuffer._glBuffer.unbindBuffer();
        }
        bind() {
            this._glVertexState.bindVertexArray();
            WebGLBufferState._curBindedBufferState = this;
        }
        unBind() {
            if (WebGLBufferState._curBindedBufferState == this) {
                this._glVertexState.unbindVertexArray();
                WebGLBufferState._curBindedBufferState = null;
            }
            else {
                throw new Error("BufferState: must call bind() function first.");
            }
        }
        isBind() {
            return (WebGLBufferState._curBindedBufferState == this);
        }
        destroy() {
            if (WebGLBufferState._curBindedBufferState == this) {
                this._glVertexState.unbindVertexArray();
                WebGLBufferState._curBindedBufferState = null;
            }
            this._glVertexState.destroy();
            this._vertexBuffers = null;
            this._bindedIndexBuffer = null;
        }
    }

    class WebGLCommandUniformMap extends Laya.CommandUniformMap {
        constructor(stateName) {
            super(stateName);
            this._idata = new Map();
            this._stateName = stateName;
            this._stateID = Laya.Shader3D.propertyNameToID(stateName);
        }
        hasPtrID(propertyID) {
            return this._stateID == propertyID || this._idata.has(propertyID);
        }
        addShaderUniform(propertyID, propertyKey, uniformtype, options) {
            this._idata.set(propertyID, { id: propertyID, uniformtype: uniformtype, propertyName: propertyKey, arrayLength: 0 });
        }
        addShaderUniformArray(propertyID, propertyName, uniformtype, arrayLength, block = "") {
            this._idata.set(propertyID, { id: propertyID, uniformtype: uniformtype, propertyName: propertyName, arrayLength: arrayLength });
        }
        setDefaultTextureData(key, defaultTex) {
        }
    }

    class WebGLConfig {
    }

    class WebGLIndexBuffer {
        constructor(targetType, bufferUsageType) {
            this._glBuffer = this._glBuffer = WebGLEngine.instance.createBuffer(targetType, bufferUsageType);
        }
        _setIndexDataLength(data) {
            var curBufSta = WebGLBufferState._curBindedBufferState;
            if (curBufSta) {
                curBufSta.unBind();
                this._glBuffer.bindBuffer();
                this._glBuffer.setDataLength(data);
                curBufSta.bind();
            }
            else {
                this._glBuffer.bindBuffer();
                this._glBuffer.setDataLength(data);
            }
        }
        setData(buffer, bufferOffset, dataStartIndex, dataCount) {
            let curBufSta = WebGLBufferState._curBindedBufferState;
            if (curBufSta) {
                curBufSta.unBind();
            }
            this._glBuffer.bindBuffer();
            var needSubData = dataStartIndex !== 0 || dataCount !== Number.MAX_SAFE_INTEGER;
            if (needSubData) {
                var subData = new Uint8Array(buffer, dataStartIndex, dataCount);
                this._glBuffer.setData(subData, bufferOffset);
            }
            else {
                this._glBuffer.setData(buffer, bufferOffset);
            }
            if (curBufSta)
                curBufSta.bind();
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_GeometryBufferUploadCount, 1);
        }
        _setIndexData(data, bufferOffset) {
            var curBufSta = WebGLBufferState._curBindedBufferState;
            if (curBufSta) {
                curBufSta.unBind();
                this._glBuffer.bindBuffer();
                this._glBuffer.setData(data, bufferOffset);
                curBufSta.bind();
            }
            else {
                this._glBuffer.bindBuffer();
                this._glBuffer.setData(data, bufferOffset);
            }
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_GeometryBufferUploadCount, 1);
        }
        destroy() {
            this._glBuffer.destroy();
        }
    }

    class WebGLRenderGeometryElement {
        get indexFormat() {
            return this._indexFormat;
        }
        set indexFormat(value) {
            this._indexFormat = value;
            this._glindexFormat = WebGLEngine.instance.getDrawContext().getIndexType(this._indexFormat);
        }
        get mode() {
            return this._mode;
        }
        set mode(value) {
            this._mode = value;
            this._glmode = WebGLEngine.instance.getDrawContext().getMeshTopology(this._mode);
        }
        constructor(mode, drawType) {
            this._id = ++WebGLRenderGeometryElement._idCounter;
            this.mode = mode;
            this.drawParams = new Laya.FastSinglelist();
            this.drawType = drawType;
        }
        getDrawDataParams(out) {
            out && this.drawParams.cloneTo(out);
        }
        setDrawArrayParams(first, count) {
            this.drawParams.add(first);
            this.drawParams.add(count);
        }
        setDrawElemenParams(count, offset) {
            this.drawParams.add(offset);
            this.drawParams.add(count);
        }
        destroy() {
            delete this.drawParams;
        }
        clearRenderParams() {
            this.drawParams.length = 0;
        }
        cloneTo(obj) {
            obj.mode = this.mode;
            obj.drawType = this.drawType;
            obj.indexFormat = this.indexFormat;
            obj.instanceCount = this.instanceCount;
            obj.drawParams.elements = this.drawParams.elements.slice();
            obj.drawParams.length = this.drawParams.length;
        }
    }
    WebGLRenderGeometryElement._idCounter = 0;

    class WebGLShaderInstance {
        constructor() {
            this._cacheShaerVariable = {};
            this._uploadMark = -1;
            this._uploadRenderType = -1;
            this.renderState = new Laya.RenderState();
            this._additionUniformParamsMaps = new Map();
            this._additionShaderData = new Map();
        }
        _serializeShader() {
            return null;
        }
        _deserialize(buffer) {
            return false;
        }
        get complete() {
            return this._renderShaderInstance._complete;
        }
        _create(shaderProcessInfo, shaderPass) {
            let useMaterial = Laya.Config.matUseUBO;
            Laya.Config.matUseUBO = (!shaderProcessInfo.is2D) && Laya.Config.matUseUBO;
            let shaderObj = Laya.GLSLCodeGenerator.GLShaderLanguageProcess3D(shaderProcessInfo.defineString, shaderProcessInfo.attributeMap, shaderProcessInfo.uniformMap, shaderProcessInfo.vs, shaderProcessInfo.ps);
            this._renderShaderInstance = WebGLEngine.instance.createShaderInstance(shaderObj.vs, shaderObj.fs, shaderProcessInfo.attributeMap);
            Laya.Config.matUseUBO = useMaterial;
            if (WebGLEngine._lastShaderError) {
                console.warn(`[ShaderCompile]Error compiling shader '${shaderPass._owner._owner.name}' (pipelineMode=${shaderPass.pipelineMode})\n`, WebGLEngine._lastShaderError);
            }
            if (this._renderShaderInstance._complete) {
                this._shaderPass = shaderPass.moduleData;
                shaderProcessInfo.is2D ? this._create2D() : this._create3D();
            }
        }
        _create3D() {
            this._sceneUniformParamsMap = new Laya.CommandEncoder();
            this._cameraUniformParamsMap = new Laya.CommandEncoder();
            this._spriteUniformParamsMap = new Laya.CommandEncoder();
            this._materialUniformParamsMap = new Laya.CommandEncoder();
            let context = Laya.WebGLRenderContext3D._instance;
            let preDrawUniforms = context.preDrawUniformMaps;
            let preDrawParams = [];
            for (let key of preDrawUniforms) {
                let params = Laya.LayaGL.renderDeviceFactory.createGlobalUniformMap(key);
                preDrawParams.push(params);
            }
            const cameraParams = Laya.LayaGL.renderDeviceFactory.createGlobalUniformMap("BaseCamera");
            let i, n;
            let data = this._renderShaderInstance.getUniformMap();
            for (i = 0, n = data.length; i < n; i++) {
                let one = data[i];
                if (preDrawParams.find((params) => {
                    return params.hasPtrID(one.dataOffset);
                })) {
                    this._sceneUniformParamsMap.addShaderUniform(one);
                }
                else if (cameraParams.hasPtrID(one.dataOffset)) {
                    this._cameraUniformParamsMap.addShaderUniform(one);
                }
                else if (this.hasSpritePtrID(one.dataOffset)) {
                    this._spriteUniformParamsMap.addShaderUniform(one);
                }
                else if (this._hasAdditionShaderData(one.dataOffset)) {
                    let str = this._hasAdditionShaderData(one.dataOffset);
                    if (!this._additionUniformParamsMaps.get(str)) {
                        let commandEncoder = new Laya.CommandEncoder();
                        this._additionUniformParamsMaps.set(str, commandEncoder);
                    }
                    this._additionUniformParamsMaps.get(str).addShaderUniform(one);
                }
                else {
                    this._materialUniformParamsMap.addShaderUniform(one);
                }
            }
        }
        _create2D() {
            this._sprite2DUniformParamsMap = new Laya.CommandEncoder();
            this._materialUniformParamsMap = new Laya.CommandEncoder();
            this._sceneUniformParamsMap = new Laya.CommandEncoder();
            this._cameraUniformParamsMap = new Laya.CommandEncoder();
            const passParms = Laya.LayaGL.renderDeviceFactory.createGlobalUniformMap("Sprite2DPass");
            const globalParams = Laya.LayaGL.renderDeviceFactory.createGlobalUniformMap("Sprite2DGlobal");
            let i, n;
            let data = this._renderShaderInstance.getUniformMap();
            for (i = 0, n = data.length; i < n; i++) {
                let one = data[i];
                if (this.hasSpritePtrID(one.dataOffset)) {
                    this._sprite2DUniformParamsMap.addShaderUniform(one);
                }
                else if (passParms.hasPtrID(one.dataOffset)) {
                    this._sceneUniformParamsMap.addShaderUniform(one);
                }
                else if (globalParams.hasPtrID(one.dataOffset)) {
                    this._cameraUniformParamsMap.addShaderUniform(one);
                }
                else if (this._hasAdditionShaderData(one.dataOffset)) {
                    let str = this._hasAdditionShaderData(one.dataOffset);
                    if (!this._additionUniformParamsMaps.get(str)) {
                        let commandEncoder = new Laya.CommandEncoder();
                        this._additionUniformParamsMaps.set(str, commandEncoder);
                    }
                    this._additionUniformParamsMaps.get(str).addShaderUniform(one);
                }
                else {
                    this._materialUniformParamsMap.addShaderUniform(one);
                }
            }
        }
        hasSpritePtrID(dataOffset) {
            let commap = this._shaderPass.nodeCommonMap;
            if (!commap) {
                return false;
            }
            else {
                for (let i = 0, n = commap.length; i < n; i++) {
                    if (Laya.LayaGL.renderDeviceFactory.createGlobalUniformMap(commap[i]).hasPtrID(dataOffset))
                        return true;
                }
                return false;
            }
        }
        _hasAdditionShaderData(dataOffset) {
            let additionShaderData = this._shaderPass.additionShaderData;
            if (!additionShaderData) {
                return null;
            }
            else {
                for (let i = 0, n = additionShaderData.length; i < n; i++) {
                    if (Laya.LayaGL.renderDeviceFactory.createGlobalUniformMap(additionShaderData[i]).hasPtrID(dataOffset))
                        return additionShaderData[i];
                }
            }
            return null;
        }
        _disposeResource() {
            this._renderShaderInstance.destroy();
            this._sceneUniformParamsMap = null;
            this._cameraUniformParamsMap = null;
            this._spriteUniformParamsMap = null;
            this._materialUniformParamsMap = null;
            this._sprite2DUniformParamsMap = null;
            this._uploadMaterial = null;
            this._uploadRender = null;
            this._uploadCameraShaderValue = null;
            this._uploadScene = null;
            this._additionShaderData = null;
            this.matRenderStateCache = null;
        }
        bind() {
            return this._renderShaderInstance.bind();
        }
        uploadUniforms(shaderUniform, shaderDatas, uploadUnTexture) {
            WebGLEngine.instance.uploadUniforms(this._renderShaderInstance, shaderUniform, shaderDatas, uploadUnTexture);
        }
        updateRenderState(renderState) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
            if (!this._renderShaderInstance._complete)
                return;
            if (this._shaderPass.statefirst) {
                if (this.matRenderStateCache === renderState.hash) {
                    return;
                }
                const passState = this._shaderPass.renderState;
                this.renderState.cull = (_a = passState.cull) !== null && _a !== void 0 ? _a : renderState.cull;
                this.renderState.blend = (_b = passState.blend) !== null && _b !== void 0 ? _b : renderState.blend;
                this.renderState.srcBlend = (_c = passState.srcBlend) !== null && _c !== void 0 ? _c : renderState.srcBlend;
                this.renderState.dstBlend = (_d = passState.dstBlend) !== null && _d !== void 0 ? _d : renderState.dstBlend;
                this.renderState.depthTest = (_e = passState.depthTest) !== null && _e !== void 0 ? _e : renderState.depthTest;
                this.renderState.depthWrite = (_f = passState.depthWrite) !== null && _f !== void 0 ? _f : renderState.depthWrite;
                this.renderState.stencilTest = (_g = passState.stencilTest) !== null && _g !== void 0 ? _g : renderState.stencilTest;
                this.renderState.stencilWrite = (_h = passState.stencilWrite) !== null && _h !== void 0 ? _h : renderState.stencilWrite;
                const stencilOpX = (_j = passState.stencilOp.x) !== null && _j !== void 0 ? _j : renderState.stencilOp.x;
                const stencilOpY = (_k = passState.stencilOp.y) !== null && _k !== void 0 ? _k : renderState.stencilOp.y;
                const stencilOpZ = (_l = passState.stencilOp.z) !== null && _l !== void 0 ? _l : renderState.stencilOp.z;
                this.renderState.stencilOp.set(stencilOpX, stencilOpY, stencilOpZ);
                this.renderState.stencilRef = (_m = passState.stencilRef) !== null && _m !== void 0 ? _m : renderState.stencilRef;
                this.renderState.stencilReadMask = (_o = passState.stencilReadMask) !== null && _o !== void 0 ? _o : renderState.stencilReadMask;
                this.renderState.stencilWriteMask = (_p = passState.stencilWriteMask) !== null && _p !== void 0 ? _p : renderState.stencilWriteMask;
                this.renderState.blendEquation = (_q = passState.blendEquation) !== null && _q !== void 0 ? _q : renderState.blendEquation;
                this.renderState.blendEquationRGB = (_r = passState.blendEquationRGB) !== null && _r !== void 0 ? _r : renderState.blendEquationRGB;
                this.renderState.blendEquationAlpha = (_s = passState.blendEquationAlpha) !== null && _s !== void 0 ? _s : renderState.blendEquationAlpha;
                this.renderState.srcBlendRGB = (_t = passState.srcBlendRGB) !== null && _t !== void 0 ? _t : renderState.srcBlendRGB;
                this.renderState.dstBlendRGB = (_u = passState.dstBlendRGB) !== null && _u !== void 0 ? _u : renderState.dstBlendRGB;
                this.renderState.srcBlendAlpha = (_v = passState.srcBlendAlpha) !== null && _v !== void 0 ? _v : renderState.srcBlendAlpha;
                this.renderState.dstBlendAlpha = (_w = passState.dstBlendAlpha) !== null && _w !== void 0 ? _w : renderState.dstBlendAlpha;
                this.renderState.depthBias = (_x = passState.depthBias) !== null && _x !== void 0 ? _x : renderState.depthBias;
                this.renderState.depthBiasConstant = (_y = passState.depthBiasConstant) !== null && _y !== void 0 ? _y : renderState.depthBiasConstant;
                this.renderState.depthBiasSlopeScale = (_z = passState.depthBiasSlopeScale) !== null && _z !== void 0 ? _z : renderState.depthBiasSlopeScale;
                this.renderState.depthBiasClamp = (_0 = passState.depthBiasClamp) !== null && _0 !== void 0 ? _0 : renderState.depthBiasClamp;
                this.renderState.hash = WebGLEngine.instance.hashRenderState(this.renderState);
                this.matRenderStateCache = renderState.hash;
            }
        }
        uploadRenderState(renderState, isTarget, invertFront) {
            const engine = WebGLEngine.instance._GLRenderState;
            if (this._shaderPass.statefirst) {
                engine.setRenderState(this.renderState, isTarget, invertFront);
            }
            else {
                engine.setRenderState(renderState, isTarget, invertFront);
            }
        }
        uploadRenderStateBlendDepth(shaderDatas) {
            if ((this._shaderPass).statefirst)
                this.uploadRenderStateBlendDepthByShader(shaderDatas);
            else
                this.uploadRenderStateBlendDepthByMaterial(shaderDatas);
        }
        uploadRenderStateBlendDepthByShader(shaderDatas) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19;
            const engineRenderState = WebGLEngine.instance._GLRenderState;
            var datas = shaderDatas._data;
            var renderState = (this._shaderPass).renderState;
            var depthWrite = (_b = ((_a = renderState.depthWrite) !== null && _a !== void 0 ? _a : datas[Laya.Shader3D.DEPTH_WRITE])) !== null && _b !== void 0 ? _b : Laya.RenderState.Default.depthWrite;
            engineRenderState.setDepthMask(depthWrite);
            var depthTest = (_d = ((_c = renderState.depthTest) !== null && _c !== void 0 ? _c : datas[Laya.Shader3D.DEPTH_TEST])) !== null && _d !== void 0 ? _d : Laya.RenderState.Default.depthTest;
            if (depthTest == Laya.RenderState.DEPTHTEST_OFF)
                engineRenderState.setDepthTest(false);
            else {
                engineRenderState.setDepthTest(true);
                engineRenderState.setDepthFunc(depthTest);
            }
            var stencilWrite = (_f = ((_e = renderState.stencilWrite) !== null && _e !== void 0 ? _e : datas[Laya.Shader3D.STENCIL_WRITE])) !== null && _f !== void 0 ? _f : Laya.RenderState.Default.stencilWrite;
            engineRenderState.setStencilWrite(stencilWrite);
            let stencilWriteMask = stencilWrite ? ((_h = ((_g = renderState.stencilWriteMask) !== null && _g !== void 0 ? _g : datas[Laya.Shader3D.STENCIL_WRITE_MASK])) !== null && _h !== void 0 ? _h : Laya.RenderState.Default.stencilWriteMask) : 0x00;
            engineRenderState.setStencilWriteMask(stencilWriteMask);
            if (stencilWrite) {
                var stencilOp = (_k = ((_j = renderState.stencilOp) !== null && _j !== void 0 ? _j : datas[Laya.Shader3D.STENCIL_Op])) !== null && _k !== void 0 ? _k : Laya.RenderState.Default.stencilOp;
                engineRenderState.setStencilOp(stencilOp.x, stencilOp.y, stencilOp.z);
            }
            var stencilTest = (_m = ((_l = renderState.stencilTest) !== null && _l !== void 0 ? _l : datas[Laya.Shader3D.STENCIL_TEST])) !== null && _m !== void 0 ? _m : Laya.RenderState.Default.stencilTest;
            if (stencilTest == Laya.RenderState.STENCILTEST_OFF) {
                engineRenderState.setStencilTest(false);
            }
            else {
                engineRenderState.setStencilTest(true);
                var stencilRef = (_p = ((_o = renderState.stencilRef) !== null && _o !== void 0 ? _o : datas[Laya.Shader3D.STENCIL_Ref])) !== null && _p !== void 0 ? _p : Laya.RenderState.Default.stencilRef;
                let stencilReadMask = (_r = ((_q = renderState.stencilReadMask) !== null && _q !== void 0 ? _q : datas[Laya.Shader3D.STENCIL_READ_MASK])) !== null && _r !== void 0 ? _r : Laya.RenderState.Default.stencilReadMask;
                engineRenderState.setStencilFunc(stencilTest, stencilRef, stencilReadMask);
            }
            let depthBias = (_t = (_s = renderState.depthBias) !== null && _s !== void 0 ? _s : datas[Laya.Shader3D.DEPTH_BIAS]) !== null && _t !== void 0 ? _t : Laya.RenderState.Default.depthBias;
            engineRenderState.setDepthBias(depthBias);
            if (depthBias) {
                let depthBiasConstant = (_v = ((_u = renderState.depthBiasConstant) !== null && _u !== void 0 ? _u : datas[Laya.Shader3D.DEPTH_BIAS_CONSTANT])) !== null && _v !== void 0 ? _v : Laya.RenderState.Default.depthBiasConstant;
                let depthBiasSlopeScale = (_x = ((_w = renderState.depthBiasSlopeScale) !== null && _w !== void 0 ? _w : datas[Laya.Shader3D.DEPTH_BIAS_SLOPESCALE])) !== null && _x !== void 0 ? _x : Laya.RenderState.Default.depthBiasSlopeScale;
                let depthBiasClamp = (_z = ((_y = renderState.depthBiasClamp) !== null && _y !== void 0 ? _y : datas[Laya.Shader3D.DEPTH_BIAS_CLAMP])) !== null && _z !== void 0 ? _z : Laya.RenderState.Default.depthBiasClamp;
                engineRenderState.setDepthBiasFactor(depthBiasConstant, depthBiasSlopeScale, depthBiasClamp);
            }
            var blend = (_1 = ((_0 = renderState.blend) !== null && _0 !== void 0 ? _0 : datas[Laya.Shader3D.BLEND])) !== null && _1 !== void 0 ? _1 : Laya.RenderState.Default.blend;
            switch (blend) {
                case Laya.RenderState.BLEND_DISABLE:
                    engineRenderState.setBlend(false);
                    break;
                case Laya.RenderState.BLEND_ENABLE_ALL:
                    var blendEquation = (_3 = ((_2 = renderState.blendEquation) !== null && _2 !== void 0 ? _2 : datas[Laya.Shader3D.BLEND_EQUATION])) !== null && _3 !== void 0 ? _3 : Laya.RenderState.Default.blendEquation;
                    var srcBlend = (_5 = ((_4 = renderState.srcBlend) !== null && _4 !== void 0 ? _4 : datas[Laya.Shader3D.BLEND_SRC])) !== null && _5 !== void 0 ? _5 : Laya.RenderState.Default.srcBlend;
                    var dstBlend = (_7 = ((_6 = renderState.dstBlend) !== null && _6 !== void 0 ? _6 : datas[Laya.Shader3D.BLEND_DST])) !== null && _7 !== void 0 ? _7 : Laya.RenderState.Default.dstBlend;
                    engineRenderState.setBlend(true);
                    engineRenderState.setBlendEquation(blendEquation);
                    engineRenderState.setBlendFunc(srcBlend, dstBlend);
                    break;
                case Laya.RenderState.BLEND_ENABLE_SEPERATE:
                    var blendEquationRGB = (_9 = ((_8 = renderState.blendEquationRGB) !== null && _8 !== void 0 ? _8 : datas[Laya.Shader3D.BLEND_EQUATION_RGB])) !== null && _9 !== void 0 ? _9 : Laya.RenderState.Default.blendEquationRGB;
                    var blendEquationAlpha = (_11 = ((_10 = renderState.blendEquationAlpha) !== null && _10 !== void 0 ? _10 : datas[Laya.Shader3D.BLEND_EQUATION_ALPHA])) !== null && _11 !== void 0 ? _11 : Laya.RenderState.Default.blendEquationAlpha;
                    var srcRGB = (_13 = ((_12 = renderState.srcBlendRGB) !== null && _12 !== void 0 ? _12 : datas[Laya.Shader3D.BLEND_SRC_RGB])) !== null && _13 !== void 0 ? _13 : Laya.RenderState.Default.srcBlendRGB;
                    var dstRGB = (_15 = ((_14 = renderState.dstBlendRGB) !== null && _14 !== void 0 ? _14 : datas[Laya.Shader3D.BLEND_DST_RGB])) !== null && _15 !== void 0 ? _15 : Laya.RenderState.Default.dstBlendRGB;
                    var srcAlpha = (_17 = ((_16 = renderState.srcBlendAlpha) !== null && _16 !== void 0 ? _16 : datas[Laya.Shader3D.BLEND_SRC_ALPHA])) !== null && _17 !== void 0 ? _17 : Laya.RenderState.Default.srcBlendAlpha;
                    var dstAlpha = (_19 = ((_18 = renderState.dstBlendAlpha) !== null && _18 !== void 0 ? _18 : datas[Laya.Shader3D.BLEND_DST_ALPHA])) !== null && _19 !== void 0 ? _19 : Laya.RenderState.Default.dstBlendAlpha;
                    engineRenderState.setBlend(true);
                    engineRenderState.setBlendEquationSeparate(blendEquationRGB, blendEquationAlpha);
                    engineRenderState.setBlendFuncSeperate(srcRGB, dstRGB, srcAlpha, dstAlpha);
                    break;
            }
        }
        uploadRenderStateBlendDepthByMaterial(shaderDatas) {
            var _a, _b, _c;
            const engineRenderState = WebGLEngine.instance._GLRenderState;
            var datas = shaderDatas.getData();
            var depthWrite = datas[Laya.Shader3D.DEPTH_WRITE];
            depthWrite = depthWrite !== null && depthWrite !== void 0 ? depthWrite : Laya.RenderState.Default.depthWrite;
            engineRenderState.setDepthMask(depthWrite);
            var depthTest = datas[Laya.Shader3D.DEPTH_TEST];
            depthTest = depthTest !== null && depthTest !== void 0 ? depthTest : Laya.RenderState.Default.depthTest;
            if (depthTest === Laya.RenderState.DEPTHTEST_OFF) {
                engineRenderState.setDepthTest(false);
            }
            else {
                engineRenderState.setDepthTest(true);
                engineRenderState.setDepthFunc(depthTest);
            }
            var stencilWrite = datas[Laya.Shader3D.STENCIL_WRITE];
            stencilWrite = stencilWrite !== null && stencilWrite !== void 0 ? stencilWrite : Laya.RenderState.Default.stencilWrite;
            engineRenderState.setStencilWrite(stencilWrite);
            let stencilWriteMask = stencilWrite ? ((_a = datas[Laya.Shader3D.STENCIL_WRITE_MASK]) !== null && _a !== void 0 ? _a : Laya.RenderState.Default.stencilWriteMask) : 0x00;
            engineRenderState.setStencilWriteMask(stencilWriteMask);
            if (stencilWrite) {
                var stencilOp = datas[Laya.Shader3D.STENCIL_Op];
                stencilOp = stencilOp !== null && stencilOp !== void 0 ? stencilOp : Laya.RenderState.Default.stencilOp;
                engineRenderState.setStencilOp(stencilOp.x, stencilOp.y, stencilOp.z);
            }
            var stencilTest = datas[Laya.Shader3D.STENCIL_TEST];
            stencilTest = stencilTest !== null && stencilTest !== void 0 ? stencilTest : Laya.RenderState.Default.stencilTest;
            if (stencilTest == Laya.RenderState.STENCILTEST_OFF) {
                engineRenderState.setStencilTest(false);
            }
            else {
                let stencilReadMask = (_b = datas[Laya.Shader3D.STENCIL_READ_MASK]) !== null && _b !== void 0 ? _b : Laya.RenderState.Default.stencilReadMask;
                var stencilRef = datas[Laya.Shader3D.STENCIL_Ref];
                stencilRef = stencilRef !== null && stencilRef !== void 0 ? stencilRef : Laya.RenderState.Default.stencilRef;
                engineRenderState.setStencilTest(true);
                engineRenderState.setStencilFunc(stencilTest, stencilRef, stencilReadMask);
            }
            let depthBias = (_c = datas[Laya.Shader3D.DEPTH_BIAS]) !== null && _c !== void 0 ? _c : Laya.RenderState.Default.depthBias;
            engineRenderState.setDepthBias(depthBias);
            if (depthBias) {
                let depthBiasConstant = datas[Laya.Shader3D.DEPTH_BIAS_CONSTANT];
                depthBiasConstant = depthBiasConstant !== null && depthBiasConstant !== void 0 ? depthBiasConstant : Laya.RenderState.Default.depthBiasConstant;
                let depthBiasSlopeScale = datas[Laya.Shader3D.DEPTH_BIAS_SLOPESCALE];
                depthBiasSlopeScale = depthBiasSlopeScale !== null && depthBiasSlopeScale !== void 0 ? depthBiasSlopeScale : Laya.RenderState.Default.depthBiasSlopeScale;
                let depthBiasClamp = datas[Laya.Shader3D.DEPTH_BIAS_CLAMP];
                depthBiasClamp = depthBiasClamp !== null && depthBiasClamp !== void 0 ? depthBiasClamp : Laya.RenderState.Default.depthBiasClamp;
                engineRenderState.setDepthBiasFactor(depthBiasConstant, depthBiasSlopeScale, depthBiasClamp);
            }
            var blend = datas[Laya.Shader3D.BLEND];
            blend = blend !== null && blend !== void 0 ? blend : Laya.RenderState.Default.blend;
            switch (blend) {
                case Laya.RenderState.BLEND_ENABLE_ALL:
                    var blendEquation = datas[Laya.Shader3D.BLEND_EQUATION];
                    blendEquation = blendEquation !== null && blendEquation !== void 0 ? blendEquation : Laya.RenderState.Default.blendEquation;
                    var srcBlend = datas[Laya.Shader3D.BLEND_SRC];
                    srcBlend = srcBlend !== null && srcBlend !== void 0 ? srcBlend : Laya.RenderState.Default.srcBlend;
                    var dstBlend = datas[Laya.Shader3D.BLEND_DST];
                    dstBlend = dstBlend !== null && dstBlend !== void 0 ? dstBlend : Laya.RenderState.Default.dstBlend;
                    engineRenderState.setBlend(true);
                    engineRenderState.setBlendEquation(blendEquation);
                    engineRenderState.setBlendFunc(srcBlend, dstBlend);
                    break;
                case Laya.RenderState.BLEND_ENABLE_SEPERATE:
                    var blendEquationRGB = datas[Laya.Shader3D.BLEND_EQUATION_RGB];
                    blendEquationRGB = blendEquationRGB !== null && blendEquationRGB !== void 0 ? blendEquationRGB : Laya.RenderState.Default.blendEquationRGB;
                    var blendEquationAlpha = datas[Laya.Shader3D.BLEND_EQUATION_ALPHA];
                    blendEquationAlpha = blendEquationAlpha !== null && blendEquationAlpha !== void 0 ? blendEquationAlpha : Laya.RenderState.Default.blendEquationAlpha;
                    var srcRGB = datas[Laya.Shader3D.BLEND_SRC_RGB];
                    srcRGB = srcRGB !== null && srcRGB !== void 0 ? srcRGB : Laya.RenderState.Default.srcBlendRGB;
                    var dstRGB = datas[Laya.Shader3D.BLEND_DST_RGB];
                    dstRGB = dstRGB !== null && dstRGB !== void 0 ? dstRGB : Laya.RenderState.Default.dstBlendRGB;
                    var srcAlpha = datas[Laya.Shader3D.BLEND_SRC_ALPHA];
                    srcAlpha = srcAlpha !== null && srcAlpha !== void 0 ? srcAlpha : Laya.RenderState.Default.srcBlendAlpha;
                    var dstAlpha = datas[Laya.Shader3D.BLEND_DST_ALPHA];
                    dstAlpha = dstAlpha !== null && dstAlpha !== void 0 ? dstAlpha : Laya.RenderState.Default.dstBlendAlpha;
                    engineRenderState.setBlend(true);
                    engineRenderState.setBlendEquationSeparate(blendEquationRGB, blendEquationAlpha);
                    engineRenderState.setBlendFuncSeperate(srcRGB, dstRGB, srcAlpha, dstAlpha);
                    break;
                case Laya.RenderState.BLEND_DISABLE:
                default:
                    engineRenderState.setBlend(false);
                    break;
            }
        }
        uploadRenderStateFrontFace(shaderDatas, isTarget, invertFront) {
            var _a;
            const engineRenderState = WebGLEngine.instance._GLRenderState;
            var renderState = (this._shaderPass).renderState;
            var datas = shaderDatas.getData();
            var cull = datas[Laya.Shader3D.CULL];
            if ((this._shaderPass).statefirst) {
                cull = (_a = renderState.cull) !== null && _a !== void 0 ? _a : cull;
            }
            cull = cull !== null && cull !== void 0 ? cull : Laya.RenderState.Default.cull;
            var forntFace;
            switch (cull) {
                case Laya.RenderState.CULL_NONE:
                    engineRenderState.setCullFace(false);
                    if (isTarget != invertFront)
                        forntFace = Laya.CullMode.Front;
                    else
                        forntFace = Laya.CullMode.Back;
                    engineRenderState.setFrontFace(forntFace);
                    break;
                case Laya.RenderState.CULL_FRONT:
                    engineRenderState.setCullFace(true);
                    if (isTarget == invertFront)
                        forntFace = Laya.CullMode.Front;
                    else
                        forntFace = Laya.CullMode.Back;
                    engineRenderState.setFrontFace(forntFace);
                    break;
                case Laya.RenderState.CULL_BACK:
                default:
                    engineRenderState.setCullFace(true);
                    if (isTarget != invertFront)
                        forntFace = Laya.CullMode.Front;
                    else
                        forntFace = Laya.CullMode.Back;
                    engineRenderState.setFrontFace(forntFace);
                    break;
            }
        }
    }

    class WebGLVertexBuffer {
        get vertexDeclaration() {
            return this._vertexDeclaration;
        }
        set vertexDeclaration(value) {
            this._vertexDeclaration = value;
            this._shaderValues = this._vertexDeclaration._shaderValues;
        }
        constructor(targetType, bufferUsageType) {
            this._glBuffer = WebGLEngine.instance.createBuffer(targetType, bufferUsageType);
        }
        getStorageBuffer() {
            return null;
        }
        setDataLength(byteLength) {
            this._glBuffer.setDataLength(byteLength);
        }
        setData(buffer, bufferOffset, dataStartIndex, dataCount) {
            this.bind();
            var needSubData = dataStartIndex !== 0 || dataCount !== Number.MAX_SAFE_INTEGER;
            if (needSubData) {
                var subData = new Uint8Array(buffer, dataStartIndex, dataCount);
                this._glBuffer.setData(subData, bufferOffset);
            }
            else {
                this._glBuffer.setData(buffer, bufferOffset);
            }
            Laya.LayaGL.statAgent.recordCTData(Laya.StatElement.CT_GeometryBufferUploadCount, 1);
        }
        bind() {
            return this._glBuffer.bindBuffer();
        }
        unbind() {
            return this._glBuffer.unbindBuffer();
        }
        orphanStorage() {
            this.bind();
            this._glBuffer.setDataLength(this._glBuffer._byteLength);
        }
        destroy() {
            this._glBuffer.destroy();
            this._vertexDeclaration = null;
        }
    }

    class WebGLGlobalPipeLineCacheInfo {
        constructor() {
            this.globalDefineChangeFlag = new Laya.Vector2();
            this.globalDefineData = Laya.LayaGL.unitRenderModuleDataFactory.createDefineDatas();
        }
    }
    class OneDrawPassCacheInfo {
        constructor() {
            this.matCacheFlag = new Laya.Vector2(-1, -1);
            this.nodeCacheFlag = new Laya.Vector2(-1, -1);
            this.passDefineCacheFlag = new Laya.Vector2(-1, -1);
            this.shaderInss = [];
        }
    }
    function compareCahceFlag(changeFlag, cacheFlag) {
        let needUpdate = false;
        if (changeFlag.x > cacheFlag.x)
            needUpdate = true;
        else if (changeFlag.x === cacheFlag.x) {
            needUpdate = changeFlag.y > cacheFlag.y;
        }
        return needUpdate;
    }
    function coverCahceFlag(coverFlag, oldFlag) {
        let needUpdate = false;
        if (coverFlag.x > oldFlag.x)
            needUpdate = true;
        else if (coverFlag.x === oldFlag.x) {
            needUpdate = coverFlag.y > oldFlag.y;
        }
        if (needUpdate) {
            coverFlag.cloneTo(oldFlag);
        }
        return;
    }
    class WebGLRenderDeviceFactory {
        constructor() {
            this.globalBlockMap = {};
        }
        createShaderData(ownerResource) {
            return new WebGLShaderData(ownerResource);
        }
        createShaderInstance(shaderProcessInfo, shaderPass) {
            let shaderIns = new WebGLShaderInstance();
            shaderIns._create(shaderProcessInfo, shaderPass);
            if (Laya.Shader3D.debugMode) {
                let defineString = shaderProcessInfo.defineString;
                let is2D = shaderProcessInfo.is2D;
                Laya.ShaderVariantCollection.active.add(shaderPass, defineString, is2D);
            }
            return shaderIns;
        }
        createIndexBuffer(bufferUsageType) {
            return new WebGLIndexBuffer(Laya.BufferTargetType.ELEMENT_ARRAY_BUFFER, bufferUsageType);
        }
        createVertexBuffer(bufferUsageType) {
            return new WebGLVertexBuffer(Laya.BufferTargetType.ARRAY_BUFFER, bufferUsageType);
        }
        createBufferState() {
            return new WebGLBufferState();
        }
        createRenderGeometryElement(mode, drawType) {
            return new WebGLRenderGeometryElement(mode, drawType);
        }
        createGlobalUniformMap(blockName) {
            let comMap = this.globalBlockMap[blockName];
            if (!comMap)
                comMap = this.globalBlockMap[blockName] = new WebGLCommandUniformMap(blockName);
            return comMap;
        }
        createEngine(config, canvas) {
            let engine;
            let glConfig = { stencil: Laya.Config.isStencil, alpha: Laya.Config.isAlpha, antialias: Laya.Config.isAntialias, premultipliedAlpha: Laya.Config.premultipliedAlpha, preserveDrawingBuffer: Laya.Config.preserveDrawingBuffer, depth: Laya.Config.isDepth, failIfMajorPerformanceCaveat: Laya.Config.isfailIfMajorPerformanceCaveat, powerPreference: Laya.Config.powerPreference };
            const webglMode = Laya.Config.useWebGL2 ? exports.WebGLMode.Auto : exports.WebGLMode.WebGL1;
            engine = new WebGLEngine(glConfig, webglMode);
            engine.initRenderEngine(canvas.source);
            var gl = engine._context;
            if (Laya.Config.printWebglOrder)
                this._replaceWebglcall(gl);
            if (gl) {
                new Laya.LayaGL();
            }
            Laya.LayaGL.renderEngine = engine;
            Laya.LayaGL.textureContext = engine.getTextureContext();
            return Promise.resolve();
        }
        _replaceWebglcall(gl) {
            var tempgl = {};
            for (const key in gl) {
                if (typeof gl[key] == "function" && key != "getError" && key != "__SPECTOR_Origin_getError" && key != "__proto__") {
                    tempgl[key] = gl[key];
                    gl[key] = function () {
                        let arr = [];
                        for (let i = 0; i < arguments.length; i++) {
                            arr.push(arguments[i]);
                        }
                        let result = tempgl[key].apply(gl, arr);
                        let err = gl.getError();
                        if (err) {
                            debugger;
                        }
                        return result;
                    };
                }
            }
        }
    }
    Laya.Laya.addBeforeInitCallback(() => {
        if (!Laya.LayaGL.renderDeviceFactory)
            Laya.LayaGL.renderDeviceFactory = new WebGLRenderDeviceFactory();
    });

    exports.BatchManager = BatchManager;
    exports.GL2TextureContext = GL2TextureContext;
    exports.GLBuffer = GLBuffer;
    exports.GLObject = GLObject;
    exports.GLParams = GLParams;
    exports.GLRenderDrawContext = GLRenderDrawContext;
    exports.GLRenderState = GLRenderState;
    exports.GLShaderInstance = GLShaderInstance;
    exports.GLTextureContext = GLTextureContext;
    exports.GLVertexState = GLVertexState;
    exports.GlCapable = GlCapable;
    exports.GraphicsMeshPayloadWordCount = GraphicsMeshPayloadWordCount;
    exports.GraphicsQuadPayloadWordCount = GraphicsQuadPayloadWordCount;
    exports.OneDrawPassCacheInfo = OneDrawPassCacheInfo;
    exports.Pass2DCacheInfo = Pass2DCacheInfo;
    exports.SequenceFrame2DInstanceBatch = SequenceFrame2DInstanceBatch;
    exports.SequenceFrame2DInstanceBatchTool = SequenceFrame2DInstanceBatchTool;
    exports.VertexArrayObject = VertexArrayObject;
    exports.Web2DBaseRenderDataHandle = Web2DBaseRenderDataHandle;
    exports.Web2DGraphic2DIndexDataView = Web2DGraphic2DIndexDataView;
    exports.Web2DGraphic2DVertexDataView = Web2DGraphic2DVertexDataView;
    exports.Web2DGraphicWholeBuffer = Web2DGraphicWholeBuffer;
    exports.Web2DGraphicsBufferDataView = Web2DGraphicsBufferDataView;
    exports.Web2DGraphicsIndexBatchBuffer = Web2DGraphicsIndexBatchBuffer;
    exports.Web2DGraphicsIndexBuffer = Web2DGraphicsIndexBuffer;
    exports.Web2DGraphicsVertexBuffer = Web2DGraphicsVertexBuffer;
    exports.WebDefineDatas = WebDefineDatas;
    exports.WebEmptyRender2DDataHandle = WebEmptyRender2DDataHandle;
    exports.WebGLBlit2DQuadCMD = WebGLBlit2DQuadCMD;
    exports.WebGLBufferCluster = WebGLBufferCluster;
    exports.WebGLBufferState = WebGLBufferState;
    exports.WebGLCommandUniformMap = WebGLCommandUniformMap;
    exports.WebGLConfig = WebGLConfig;
    exports.WebGLDraw2DElementCMD = WebGLDraw2DElementCMD;
    exports.WebGLEngine = WebGLEngine;
    exports.WebGLGlobalPipeLineCacheInfo = WebGLGlobalPipeLineCacheInfo;
    exports.WebGLIndexBuffer = WebGLIndexBuffer;
    exports.WebGLInternalRT = WebGLInternalRT;
    exports.WebGLInternalTex = WebGLInternalTex;
    exports.WebGLPrimitiveRenderElement2D = WebGLPrimitiveRenderElement2D;
    exports.WebGLRender2DProcess = WebGLRender2DProcess;
    exports.WebGLRenderDeviceFactory = WebGLRenderDeviceFactory;
    exports.WebGLRenderElement2D = WebGLRenderElement2D;
    exports.WebGLRenderGeometryElement = WebGLRenderGeometryElement;
    exports.WebGLSetRenderData = WebGLSetRenderData;
    exports.WebGLSetRendertarget2DCMD = WebGLSetRendertarget2DCMD;
    exports.WebGLSetShaderDefine = WebGLSetShaderDefine;
    exports.WebGLShaderData = WebGLShaderData;
    exports.WebGLShaderInstance = WebGLShaderInstance;
    exports.WebGLStencilMaskElement2D = WebGLStencilMaskElement2D;
    exports.WebGLSubUniformBuffer = WebGLSubUniformBuffer;
    exports.WebGLUniformBuffer = WebGLUniformBuffer;
    exports.WebGLUniformBufferDescriptor = WebGLUniformBufferDescriptor;
    exports.WebGLUniformBufferManager = WebGLUniformBufferManager;
    exports.WebGLVertexBuffer = WebGLVertexBuffer;
    exports.WebGlobalRenderData = WebGlobalRenderData;
    exports.WebGraphicsBatch = WebGraphicsBatch;
    exports.WebGraphicsCommandStreamDataHandle = WebGraphicsCommandStreamDataHandle;
    exports.WebGraphicsFillTextureOp2D = WebGraphicsFillTextureOp2D;
    exports.WebGraphicsMeshOp2D = WebGraphicsMeshOp2D;
    exports.WebGraphicsMultiQuadOp2D = WebGraphicsMultiQuadOp2D;
    exports.WebGraphicsOp2D = WebGraphicsOp2D;
    exports.WebGraphicsOp2DFactory = WebGraphicsOp2DFactory;
    exports.WebGraphicsOp2DRuntime = WebGraphicsOp2DRuntime;
    exports.WebGraphicsOpVIStore = WebGraphicsOpVIStore;
    exports.WebGraphicsOpVIStorePool = WebGraphicsOpVIStorePool;
    exports.WebGraphicsRenderUnit = WebGraphicsRenderUnit;
    exports.WebGraphicsRenderUnitPool = WebGraphicsRenderUnitPool;
    exports.WebGraphicsSingleQuadDataHandle = WebGraphicsSingleQuadDataHandle;
    exports.WebGraphicsSolidQuadOp2D = WebGraphicsSolidQuadOp2D;
    exports.WebGraphicsTextOp2D = WebGraphicsTextOp2D;
    exports.WebGraphicsTextureQuadOp2D = WebGraphicsTextureQuadOp2D;
    exports.WebMesh2DRenderDataHandle = WebMesh2DRenderDataHandle;
    exports.WebRender2DDataHandle = WebRender2DDataHandle;
    exports.WebRender2DPass = WebRender2DPass;
    exports.WebRender2DPassManager = WebRender2DPassManager;
    exports.WebRenderStruct2D = WebRenderStruct2D;
    exports.WebShaderPass = WebShaderPass;
    exports.WebSingleQuadPrimitiveData = WebSingleQuadPrimitiveData;
    exports.WebStencilClip2D = WebStencilClip2D;
    exports.WebSubShader = WebSubShader;
    exports.WebSubStructRenderDataHandle = WebSubStructRenderDataHandle;
    exports.WebTransform2DMemoryFactory = WebTransform2DMemoryFactory;
    exports.WebUnitRenderModuleDataFactory = WebUnitRenderModuleDataFactory;
    exports.WebglRenderContext2D = WebglRenderContext2D;
    exports.compareCahceFlag = compareCahceFlag;
    exports.coverCahceFlag = coverCahceFlag;
    exports.writeFillTexturePayloadValues = writeFillTexturePayloadValues;
    exports.writeMeshPayloadValues = writeMeshPayloadValues;
    exports.writeOpInfoBuffer = writeOpInfoBuffer;
    exports.writeQuadPayloadValues = writeQuadPayloadValues;

})(window.Laya = window.Laya || {}, Laya);
//# sourceMappingURL=laya.webgl_2D.js.map
