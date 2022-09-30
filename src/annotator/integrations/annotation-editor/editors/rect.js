// @ts-ignore
import { AnnotationEditor } from '../annotation-editor';
import fabric from 'fabric/fabric-impl';
import debounce from 'lodash.debounce';


/**
 * @typedef {import('../annotation-editor-ui-manager').AnnotationEditorUIManager} AnnotationEditorUIManager
 * @typedef {import('../annotation-editor').AnnotationEditor} AnnotationEditor
 * @typedef {import('fabric/fabric-impl')} fabric
 * @typedef {import('../../../../types/pdfjs')}
 * @typedef {import('../annotation-editor').AnnotationEditorParameters} AnnotationEditorParameters
 */

/**
 * @typedef {Object} RectangleAnnotationEditorParametersExt
 * @property {string|null} color
 * @property {number|null} thickness
 * 
 */

/**
 * @typedef {AnnotationEditorParameters & RectangleAnnotationEditorParametersExt} RectangleAnnotationEditorParameters
 * @typedef {'thickness'|'color'} RectangleParameterType
 */

// @ts-ignore
export class RectangleEditor extends AnnotationEditor {
    /** @type {number} */
    _baseHeight = 0;
    /** @type {number} */
    _baseWidth = 0;

    _boundCanvasPointermove = this.canvasPointermove.bind(this);

    _boundCanvasPointerleave = this.canvasPointerleave.bind(this);

    _boundCanvasPointerup = this.canvasPointerup.bind(this);

    _boundCanvasPointerdown = this.canvasPointerdown.bind(this);

    _disableEditing = false;

    _isPointerdown = false;

    /** @type {fabric.Rect} */
    // @ts-ignore
    _rectObj = null;

    _originalX = 0;
    _originalY = 0;

    /** @type {fabric.Object} */
    // @ts-ignore
    _fabricObject = null;

    /** @type {Array<{left: number, top: number, originX: string, originY: string, width: number, height: number}>} */
    _rects = [];

    _isInitialized = false;
    /**
     *  
     * @param {RectangleAnnotationEditorParameters} parameters 
     */
    constructor(parameters) {
        super({ ...parameters, name: 'rectangleEditor' });
        /** @type {string|null} */
        this.color = parameters.color || null;
        /** @type {number|null} */
        this.thickness = parameters.thickness || null;
        
    }

    static _defaultThickness = 1;
    static _defaultColor = '#000000';
    /** @type {Map<string, any>} */
    static _l10nPromise;
    /**
     * 
     * @param {RectangleParameterType} type 
     * @param {string|number} value 
     */
    static updateDefaultParams(type, value) {
        switch (type) {
            case 'color':
                RectangleEditor._defaultColor = value;
                break;

            case 'thickness':
                RectangleEditor._defaultThickness = value;
                break;
        }
    }

    static get defaultPropertiesToUpdate() {
        return [
            ['thickness', RectangleEditor._defaultThickness],
            ['color', RectangleEditor._defaultColor || AnnotationEditor._defaultLineColor]
        ];
    }

    /**
     * Get some properties to update in the UI.
     * @returns {Array<any>}
     */
    get propertiesToUpdate() {
        return [
            ['thickness', this.thickness || RectangleEditor._defaultThickness],
            ['color', this.color || RectangleEditor._defaultColor || AnnotationEditor._defaultLineColor]
        ];
    }

    getFabricObject() {
        return this._fabricObject;
    }

    isEmpty() {
        return !this.isAttachedToCanvas || this._rects.length === 0;
    }

    /**
     * onpointermove callback for the canvas we're drawing on
     * @param {fabric.IEvent<MouseEvent>} event 
     */
    canvasPointermove(event) {
        if (!this._isPointerdown) {
            return;
        }

        event.e.stopPropagation();
        this._draw(this._getPointer(event.e));
    }

    /**
     * Handles mouse leaves on canvas
     * @param {fabric.IEvent<MouseEvent>} event 
     */
    canvasPointerleave(event) {
        this._endDrawing(event);
    }

    /**
     * Handles mouse is up on canvas
     * @param {fabric.IEvent<MouseEvent>} event 
     */
    canvasPointerup(event) {
        if (event.button !== 1) {
            return;
        }

        if (this.isInEditMode() && this._isPointerdown) {
            event.e.stopPropagation();
            this._isPointerdown = false;
            this._endDrawing(event);
        }
    }

    /**
     * onpointerdown callback for the canvas we're drawing on.
     * @param {fabric.IEvent<MouseEvent>} event 
     */
    canvasPointerdown(event) {
        if (event.button !== 1 || !this.isInEditMode() || this._disableEditing) {
            return;
        }

        event.e.stopPropagation();
        this._isPointerdown = true;

        this.parent.canvas?.on('mouse:move', this._boundCanvasPointermove);
        this.parent.canvas?.on('mouse:out', this._boundCanvasPointerleave);
        
        let pointer = this._getPointer(event.e);
        
        this._originalX = pointer.x;
        this._originalY = pointer.y;

        this.attachToCanvas();
        
        // Mouse could move fast after down
        pointer = this._getPointer(event.e);

        this._startDrawing(pointer);
    }

    /** @inheritdoc */
    enableEditMode() {
        if (this._disableEditing) {
            return;
        }

        super.enableEditMode();
        // fabric.Canvas callbacks: http://fabricjs.com/docs/fabric.Canvas.html
        this.parent.canvas?.on('mouse:down', debounce(this._boundCanvasPointerdown, {maxWait: 50}));
        this.parent.canvas?.on('mouse:up', debounce(this._boundCanvasPointerup, {maxWait: 50}));
    }

    /** @inheritdoc */
    disableEditMode() {
        if (!this.isInEditMode()) {
            return;
        }

        super.disableEditMode();
        // fabric.Canvas callbacks: http://fabricjs.com/docs/fabric.Canvas.html
        // @ts-ignore
        this.parent.canvas?.off('mouse:down',  debounce(this._boundCanvasPointerdown, {maxWait: 50}));
        // @ts-ignore
        this.parent.canvas?.off('mouse:up', debounce(this.canvasPointerup, {maxWait: 50}));
    }

    /**
     * Update some parameters which have been changed through the UI.
     * @param {any} type 
     * @param {any} value 
     */
    updateParams(type, value) {
        switch (type) {
            case 'color':

                break;

            case 'thickness':
                break;
        }
    }

    render() {
        this._createFabricObject({ x: 0, y: 0 });

        if (!this.width) {
            this.enableEditMode();
        }

        return super.render();
    }

    rebuild() {
        super.rebuild();
        if (this._fabricObject) {
            return;
        }

        if (!this.isAttachedToCanvas) {
            this.attachToCanvas();
        }

        this._redraw();
    }

    remove() {
        if (!this.isEmpty()) {
            this.commit();
        }

        super.remove();
    }

    /**
     * Commit the curves we have in this editor.
     */
    commit() {
        if (this._disableEditing) {
            return;
        }

        this._isEditing = false;
        this.disableEditMode();
        this._disableEditing = true;
        this._redraw();
    }

    //#region Privates
    /**
     * 
     * @param {{x: number, y: number}} param0
     */
    _createFabricObject({ x, y }) {
        if (this._fabricObject) {
            return;
        }

        let baseX, baseY;
        /** @type {fabric.Rect|null} */
        let shapeObj = null;
        if (this.width) {
            baseX = this.x;
            baseY = this.y;
            this._isInitialized = true;

            shapeObj = new fabric.Rect({
                left: this.x,
                top: this.y,
                width: this.width,
                height: this.height,
                transparentCorners: false,
                fill: ''
            });
        } else {
            shapeObj = new fabric.Rect({
                left: this._originalX,
                top: this._originalY,
                originX: 'left',
                originY: 'top',
                width: Math.abs(x-this._originalX),
                height: Math.abs(y - this._originalY),
                transparentCorners: false,
                fill: ''
            });
        }

        this._fabricObject = shapeObj;
    }
    /**
     * Get x,y of the current pointer
     * @param {MouseEvent} event 
     * 
     * @returns {{x: number, y: number}}
     */
    _getPointer(event) {
        // @ts-ignore
        return this.parent.canvas.getPointer(event);
    }
    /**
     * Draw on the canvas
     * @param {{x: number, y: number}} x 
     */
    _draw({ x, y }) {
        this._fabricObject.set({
            originX: this.originX > x ? 'right' : 'left',
            originY: this.originY > y ? 'bottom' : 'top',
            width: Math.abs(this.originX - x),
            height: Math.abs(this.originY - y)
        }).setCoords();
        this.parent.renderAll();
    }

    _redraw() {
        this._setStroke();

        if (this.isEmpty()) {
            return;    
        }

        const rect = this._rects[this._rects.length - 1];
        this._fabricObject.set(rect).setCoords();
        this.parent.renderAll();
    }

    /**
     * Set line styles.
     */
    _setStroke() {
        this._fabricObject.set({
            // @ts-ignore
            stroke: this.color,
            // @ts-ignore
            strokeWidth: this.thickness
        });
    }

    /**
     * End the drawing
     * @param {fabric.IEvent<MouseEvent>} event 
     */
    _endDrawing(event) {
        this._stopDrawing(this._getPointer(event.e));
        // @ts-ignore
        this.parent.canvas?.off('mouse:move', this._boundCanvasPointermove);
        // @ts-ignore
        this.parent.canvas?.off('mouse:out', this._boundCanvasPointerleave);
    }

    /**
     * Start to draw on the canvas
     * @param {{x: number, y: number}} x 
     */
    _startDrawing({ x, y }) {
        if (!this._isInitialized) {
            this._isInitialized = true;
            this.color ||= RectangleEditor._defaultColor || AnnotationEditor._defaultLineColor;
            this.thickness ||= RectangleEditor._defaultThickness;
        }

        this._isEditing = true;
        this._setStroke();
        this._fabricObject.set({
            left: x,
            top: y
        });
    }

    /**
     * Stop to draw on the canvas
     * @param {{x: number, y: number}} x 
     */
    _stopDrawing({ x, y }) {
        const rect = {
            originX: this.originX > x ? 'right' : 'left',
            originY: this.originY > y ? 'bottom' : 'top',
            width: Math.abs(this.originX - x),
            height: Math.abs(this.originY - y),
            left: this.originX,
            top: this.originY
        };

        const cmd = () => {
            this._rects.push(rect);
            this.rebuild();
        };

        const undo = () => { 
            this._rects.pop();
            if (this._rects.length === 0) {
                this.remove();
            } else {
                if (!this._fabricObject) {
                    this._createFabricObject({ x, y });
                }

                this._redraw();
            }
        };

        this.parent.addCommands({ cmd, undo, mustExec: true });

        this.commitOrRemove();
    }
    //#endregion Privates
}