import { ColorManager } from "./color-manager";
import { shadow } from "./utils";
import { ListenerCollection } from '../../../shared/listener-collection';
import fabric from "fabric/fabric-impl";

/**
 * @typedef {import('./annotation-editor-layer').AnnotationEditorLayer} AnnotationEditorLayer
 */

/**
 * @typedef {Object} AnnotationEditorParameters
 * @prop {AnnotationEditorLayer} parent - the layer containing this editor
 * @prop {string|null} name
 * @prop {string} id - editor id
 * @prop {number} x - x-coordinate
 * @prop {number} y - y-coordinate
 */

/**
 * Base class for editors.
 */
export class AnnotationEditor {
    static _colorManager = new ColorManager();
    static _zIndex = 1;

    /**
     * @type {Promise<AnnotationEditor>}
     */
     // @ts-ignore
     _fabricObjectPromise = null;
     /** @type {((editor: AnnotationEditor) => void)} */
     // @ts-ignore
     _resolveFabricObjectCreation = null;
     /** @type {((reason: any) => void)} */
     // @ts-ignore
     _rejectFabricObjectCreation = null;
 
    /**
     * @type {boolean}
     */
    isAttachedToCanvas = false;
    
    /**
     * @param {AnnotationEditorParameters} parameters
     */
    constructor(parameters) {
        if (this.constructor === AnnotationEditor) {
            throw Error("Cannot initialize AnnotationEditor.");
        }

        /**
         * @type {AnnotationEditorLayer}
         */
        this.parent = parameters.parent;
        /** @type {string} */
        this.id = parameters.id;
        /** @type {number} */
        // @ts-ignore
        this.width = this.height = null;
        /** @type {number} */
        this.pageIndex = (parameters.parent.pageIndex);
        /** @type {string|null} */
        this.name = parameters.name;

        //const [width, height] = this.parent.viewportBaseDimensions;
        /** @type {number} */
        this.x = this.originX = parameters.x;
        /** @type {number} */
        this.y = this.originY = parameters.y;
        /** @type {number} */
        // @ts-ignore
        this.rotation = this.parent.viewport.rotation;
        /**
         * @type {ListenerCollection}
         */
        this._listeners = new ListenerCollection();

        /** @type {(event: FocusEvent) => {}} */
        // @ts-ignore
        this._boundFocusin = this.focusin.bind(this);

        /** @type {(event: FocusEvent) => {}} */
        // @ts-ignore
        this._boundFocusout = this.focusout.bind(this);
        /** @type {boolean} */
        this._hasBeenSelected = false;
        /** @type {boolean} */
        this._isEditing = false;
        /** @type {boolean} */
        this._isInEditMode = false;
        /** @type {number} */
        this._zIndex = AnnotationEditor._zIndex++;
        
        this._fabricObjectPromise = new Promise((resolve, reject) => {
            this._resolveFabricObjectCreation = resolve;
            this._rejectFabricObjectCreation = reject;
        });
    }

    static get _defaultLineColor() {
        return shadow(
            this,
            "_defaultLineColor",
            this._colorManager.getHexCode("CanvasText")
        );
    }

    attachToCanvas() {
         this._resolveFabricObjectCreation(this);
    }

    /**
     *  
     * @param {any} reason 
     */
     attachToCanvasFail(reason) {
        this._rejectFabricObjectCreation(reason);
    }

    commit() {
        throw Error('Method not implemented.');
    }

    /**
     * Get the object to be drew on the canvas.
     * After creating object, it must be attached to
     * the parent canvas by calling method `attachToCanvas()`.
     * 
     * @returns {fabric.Object}
     */
    getFabricObject() {
        throw Error('Method not implemented.');
    }

    /**
     * This editor will be behind the others.
     */
    setInBackground() {
        //this.div.style.zIndex = '0';
    }

    /**
     * This editor will be in the foreground.
     */
    setInForeground() {
        //this.div.style.zIndex = '' + this._zIndex;
    }

    /**
     * onfocus callback.
     * @param {FocusEvent} event
     */
    focusin(event) {
        if (!this._hasBeenSelected) {
            this.parent.setSelected(this);
        } else {
            this._hasBeenSelected = false;
        }
    }

    /**
     * onblur callback.
     * @param {FocusEvent} event
     */
    focusout(event) {
        if (!this.isAttachedToCanvas) {
            return;
        }

        // In case of focusout, the relatedTarget is the element which
        // is grabbing the focus.
        // So if the related target is an element under the div for this
        // editor, then the editor isn't unactive.
        const target = event.relatedTarget;
        // @ts-ignore
        if (target?.closest(`#${this.id}`)) {
            return;
        }

        event.preventDefault();
        this.commitOrRemove();

        // if (!this.parent.isMultipleSelection) {
        //     this.commitOrRemove();
        // }
    }

    commitOrRemove() {
        if (this.isEmpty()) {
            this.remove();
        } else {
            this.commit();
        }
    }

    /**
     * We use drag-and-drop in order to move an editor on a page.
     * @param {DragEvent} event
     */
    dragstart(event) {
        // // @ts-ignore
        // const rect = this.parent.div.getBoundingClientRect();
        // this.startX = event.clientX - rect.x;
        // this.startY = event.clientY - rect.y;
        // // @ts-ignore
        // event.dataTransfer.setData("text/plain", this.id);
        // // @ts-ignore
        // event.dataTransfer.effectAllowed = "move";
    }

    /**
     * Convert a screen translation into a page one.
     * @param {number} x
     * @param {number} y
     */
    screenToPageTranslation(x, y) {
        // @ts-ignore
        const { rotation } = this.parent.viewport;
        switch (rotation) {
            case 90:
                return [y, -x];
            case 180:
                return [-x, -y];
            case 270:
                return [-y, x];
            default:
                return [x, y];
        }
    }

    /**
     * Render this editor in a div.
     * @returns {Promise<AnnotationEditor>}
     */
    render() {
        return this._fabricObjectPromise;
    }
    
    /**
     * 
     * @param {number} tx 
     * @param {number} ty 
     * @returns {number[]}
     */
    getRect(tx, ty) {
        const [parentWidth, parentHeight] = this.parent.viewportBaseDimensions;
        const [pageWidth, pageHeight] = this.parent.pageDimensions;
        const shiftX = (pageWidth * tx) / parentWidth;
        const shiftY = (pageHeight * ty) / parentHeight;
        const x = this.x * pageWidth;
        const y = this.y * pageHeight;
        const width = this.width * pageWidth;
        const height = this.height * pageHeight;

        switch (this.rotation) {
            case 0:
                return [
                    x + shiftX,
                    pageHeight - y - shiftY - height,
                    x + shiftX + width,
                    pageHeight - y - shiftY,
                ];
            case 90:
                return [
                    x + shiftY,
                    pageHeight - y + shiftX,
                    x + shiftY + height,
                    pageHeight - y + shiftX + width,
                ];
            case 180:
                return [
                    x - shiftX - width,
                    pageHeight - y + shiftY,
                    x - shiftX,
                    pageHeight - y + shiftY + height,
                ];
            case 270:
                return [
                    x - shiftY - height,
                    pageHeight - y - shiftX - width,
                    x - shiftY,
                    pageHeight - y - shiftX,
                ];
            default:
                throw new Error("Invalid rotation");
        }
    }

    /**
     * 
     * @param {number[]} rect 
     * @param {number} pageHeight 
     * @returns {number[]}
     */
    getRectInCurrentCoords(rect, pageHeight) {
        const [x1, y1, x2, y2] = rect;

        const width = x2 - x1;
        const height = y2 - y1;

        switch (this.rotation) {
            case 0:
                return [x1, pageHeight - y2, width, height];
            case 90:
                return [x1, pageHeight - y1, height, width];
            case 180:
                return [x2, pageHeight - y1, width, height];
            case 270:
                return [x2, pageHeight - y2, height, width];
            default:
                throw new Error("Invalid rotation");
        }
    }

    /**
   * Executed once this editor has been rendered.
   */
    onceAdded() { }

    /**
     * Check if the editor contains something.
     * @returns {boolean}
     */
    isEmpty() {
        return false;
    }

    /**
     * Enable edit mode.
     */
    enableEditMode() {
        this._isInEditMode = true;
    }

    /**
     * Disable edit mode.
     */
    disableEditMode() {
        this._isInEditMode = false;
    }

    /**
     * Check if the editor is edited.
     * @returns {boolean}
     */
    isInEditMode() {
        return this._isInEditMode;
    }

    /**
     * If it returns true, then this editor handle the keyboard
     * events itself.
     * @returns {boolean}
     */
    shouldGetKeyboardEvents() {
        return false;
    }

    /**
     * Check if this editor needs to be rebuilt or not.
     * @returns {boolean}
     */
    needsToBeRebuilt() {
        return !this.isAttachedToCanvas;
    }

    /**
     * Rebuild the editor in case it has been removed on undo.
     *
     * To implement in subclasses.
     */
    rebuild() {
        
    }

    /**
     * Serialize the editor.
     * The result of the serialization will be used to construct a
     * new annotation to add to the pdf document.
     *
     * To implement in subclasses.
     */
    serialize() {
        throw Error("An editor must be serializable");
    }

    /**
     * Deserialize the editor.
     * The result of the deserialization is a new editor.
     *
     * @param {Object} data
     * @param {AnnotationEditorLayer} parent
     * @returns {AnnotationEditor}
     */
    static deserialize(data, parent) {
        // @ts-ignore
        const editor = new this.prototype.constructor({
            parent,
            id: parent.getNextId(),
        });
        // @ts-ignore
        editor.rotation = data.rotation;

        const [pageWidth, pageHeight] = parent.pageDimensions;
        const [x, y, width, height] = editor.getRectInCurrentCoords(
            // @ts-ignore
            data.rect,
            pageHeight
        );
        editor.x = x / pageWidth;
        editor.y = y / pageHeight;
        editor.width = width / pageWidth;
        editor.height = height / pageHeight;

        return editor;
    }

    /**
     * Remove this editor.
     * It's used on ctrl+backspace action.
     */
    remove() {
        //this.div.removeEventListener("focusin", this._boundFocusin);
        //this.div.removeEventListener("focusout", this._boundFocusout);
        this._listeners.removeAll();

        if (!this.isEmpty()) {
            // The editor is removed but it can be back at some point thanks to
            // undo/redo so we must commit it before.
            this.commit();
        }
        this.parent.remove(this);
    }

    /**
     * Select this editor.
     */
    select() {
        //this.div?.classList.add("selectedEditor");
    }

    /**
     * Unselect this editor.
     */
    unselect() {
        //this.div?.classList.remove("selectedEditor");
    }

    /**
     * Update some parameters which have been changed through the UI.
     * @param {any} type
     * @param {any} value
     */
    updateParams(type, value) { }

    /**
     * When the user disables the editing mode some editors can change some of
     * their properties.
     */
    disableEditing() { }

    /**
     * When the user enables the editing mode some editors can change some of
     * their properties.
     */
    enableEditing() { }

    /**
     * Get the id to use in aria-owns when a link is done in the text layer.
     * @returns {string}
     */
    getIdForTextLayer() {
        return this.id;
    }

    /**
     * Get some properties to update in the UI.
     * @returns {Object}
     */
    get propertiesToUpdate() {
        return {};
    }

    /**
     * If true then the editor is currently edited.
     * @type {boolean}
     */
    get isEditing() {
        return this._isEditing;
    }

    /**
     * When set to true, it means that this editor is currently edited.
     * @param {boolean} value
     */
    set isEditing(value) {
        this._isEditing = value;
        if (value) {
            this.parent.setSelected(this);
            this.parent.setActiveEditor(this);
        } else {
            // @ts-ignore
            this.parent.setActiveEditor(null);
        }
    }
}