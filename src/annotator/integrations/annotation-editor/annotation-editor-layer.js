
import { ListenerCollection } from "../../../shared/listener-collection";
import { AnnotationEditor } from './annotation-editor';
import { RectangleEditor } from './editors/rect';


/**
 * @typedef {import('./annotation-editor-ui-manager').AnnotationEditorUIManager} AnnotationEditorUIManager
 * @typedef {import('../../../types/annotator').AnnotationType} AnnotationType
 * @typedef {import('fabric/fabric-impl')} fabric
 * @typedef {import('../../../types/pdfjs')}
 */

/**
 * @typedef {Object} PageViewport
 * @property {number} width
 * @property {number} height
 * @property {number} rotation
 * @property {number[]} viewBox
 */

/**
 * @typedef {Object} AnnotationEditorLayerOptions
 * @property {Object} mode
 * @property {HTMLDivElement} pageDiv
 * @property {AnnotationEditorUIManager} uiManager
 * @property {boolean} enabled
 * @property {number} pageIndex
 */

/**
 * Manage all the different editors on a page.
 */
export class AnnotationEditorLayer {
    /** @type {boolean} */
    _allowClick = false;
    /** @type {(event: fabric.IEvent<MouseEvent>) => void} */
    _boundPointerup = this.pointerup.bind(this);
    /** @type {(event: fabric.IEvent<MouseEvent>) => void} */
    _boundPointerdown = this.pointerdown.bind(this);
    /** @type {(event: fabric.IEvent<MouseEvent>) => void} */
    _boundPointermove = this.pointermove.bind(this);
    /** @type {Map<string, AnnotationEditor>} */
    _editors = new Map();
    /** @type {boolean} */
    _isCleaningUp = false;
    /** @type {boolean} */
    isAttachedToDOM = false;
    /** @type {AnnotationEditorUIManager} */
    _uiManager;
    /** @type {fabric.Canvas|null} */
    canvas = null;
    _waitingEditors = new Set();

    static _initialized = false;


    /**
     * 
     * @param {AnnotationEditorLayerOptions} options 
     */
    constructor(options) {
        if (!AnnotationEditorLayer._initialized) {
            AnnotationEditorLayer._initialized = true;
            // FreeTextEditor.initialize(options.l10n);
            // InkEditor.initialize(options.l10n);
            // RectangleEditor.initialize(options.l10n);
            // HighlightEditor.initialize(options.l10n);

            options.uiManager.registerEditorTypes([RectangleEditor]);
        }
        this._uiManager = options.uiManager;
        /** @type {number} */
        this.pageIndex = options.pageIndex;
        /** @type {HTMLElement} */
        this.pageDiv = options.pageDiv;
        /** @type {HTMLDivElement|null} */
        this.div = document.createElement('div');
        this._uiManager.addLayer(this);
        /** @type {ListenerCollection} */
        this._listeners = new ListenerCollection();
    }

    //#region PROPS

    get viewportBaseDimensions() {
        // @ts-ignore
        const { width, height, rotation } = this.viewport;
        return rotation % 180 === 0 ? [width, height] : [height, width];
    }

    /**
   * Get page dimensions.
   * @returns {number[]} dimensions.
   */
    get pageDimensions() {
        // @ts-ignore
        const [pageLLx, pageLLy, pageURx, pageURy] = this.viewport.viewBox;
        const width = pageURx - pageLLx;
        const height = pageURy - pageLLy;

        return [width, height];
    }

    /**
   * Get the scale factor from the viewport.
   * @returns {number}
   */
    get scaleFactor() {
        // @ts-ignore
        return this.viewport.scale;
    }

    //#endregion PROPS

    //#region PRIVATES
    _cleanup() {
        this._isCleaningUp = true;
        for (const editor of this._editors.values()) {
            if (editor.isEmpty()) {
                editor.remove();
            }
        }
        this._isCleaningUp = false;
    }

    /**
     * Create and add a new editor.
     * @param {MouseEvent} event
     * @returns {AnnotationEditor}
     */
    _createAndAddNewEditor(event) {
        const id = this.getNextId();
        // @ts-ignore
        const pointer = this.canvas.getPointer(event);
        const editor = this._createNewEditor({
            parent: this,
            id,
            x: pointer.x,
            y: pointer.y,
            name: null
        });

        if (editor) {
            this.add(editor);
        }

        return editor;
    }
    /**
     * Create a new editor
     * @param {import('./annotation-editor').AnnotationEditorParameters} params
     * @returns {AnnotationEditor}
     */
    _createNewEditor(params) {
        switch (this._uiManager.getMode()) {
            case 'rectangle':
                // @ts-ignore
                return new RectangleEditor({...params});
            case 'pen':
                // @ts-ignore
                return null;
        }

        // @ts-ignore
        return null;
    }

    _attachToDOM() {
        if (!this.isAttachedToDOM && this.canvas) {
            // @ts-ignore
            this.pageDiv.append(this.div);
            this.isAttachedToDOM = true;
        }
    }

    //#endregion PRIVATES

    //#region PUBLICS

    renderAll() {
        this.canvas?.renderAll();
    }
    /**
     * Render the main editor
     * @param {{viewport: PageViewport}} parameters 
     */
    render(parameters) {
        if (!this.canvas) {
            // @ts-ignore
            this.div.classList.add('editorAnnotationLayer');
            const canvas = document.createElement('canvas');
            // @ts-ignore
            this.div.appendChild(canvas);
            // @ts-ignore
            this.canvas = new fabric.Canvas(canvas, {
                selection: true
            });
        }

        /**
         * @type {PageViewport}
         */
        this.viewport = parameters.viewport;
        this.setDimensions();
        for (const editor of this._uiManager.getEditors(this.pageIndex)) {
            this.add(editor);
        }
        this.updateMode();
    }

    /**
     * Add editor to the layer
     * @param {AnnotationEditor} editor 
     */
    add(editor) {
        this._uiManager.addEditor(editor);
        this.attach(editor);

        if (!editor.isAttachedToCanvas) {
            editor.render().then(obj => {
                if (!obj.isAttachedToCanvas) {
                    obj.isAttachedToCanvas = true;
                    const fbObj = obj.getFabricObject();
                    if (!fbObj) {
                        throw Error('`getFabricObject()` returns null value.');
                    } else {
                        this.canvas?.add(fbObj);
                    }
                }
            });
        }

        editor.onceAdded();
    }

    /**
   * Add or rebuild depending if it has been removed or not.
   * @param {AnnotationEditor} editor
   */
    addOrRebuild(editor) {
        if (editor.needsToBeRebuilt()) {
            editor.rebuild();
        } else {
            this.add(editor);
        }
    }

    /**
     * Add a new editor and make this addition undoable.
     * @param {AnnotationEditor} editor
     */
    addANewEditor(editor) {
        const cmd = () => {
            this.addOrRebuild(editor);
        };
        const undo = () => {
            editor.remove();
        };

        this.addCommands({ cmd, undo, mustExec: true });
    }

    /**
     * Add a new editor and make this addition undoable.
     * @param {AnnotationEditor} editor
     */
    addUndoableEditor(editor) {
        const cmd = () => {
            this.addOrRebuild(editor);
        };
        const undo = () => {
            editor.remove();
        };

        this.addCommands({ cmd, undo, mustExec: false });
    }

    /**
   * Add some commands into the CommandManager (undo/redo stuff).
   * @param {{cmd: ()=> void, undo: ()=>void, mustExec: boolean|null|undefined}} params
   */
    addCommands(params) {
        this._uiManager.addCommands(params);
    }

    /**
   * Set the editing state.
   * @param {boolean} isEditing
   */
    setEditingState(isEditing) {
        this._uiManager.setEditingState(isEditing);
    }

    /**
   * Remove an editor.
   * @param {AnnotationEditor} editor
   */
    remove(editor) {
        // Since we can undo a removal we need to keep the
        // parent property as it is, so don't null it!

        this._uiManager.removeEditor(editor);
        this.detach(editor);
        const fabricObject = editor.getFabricObject();
        if (fabricObject) {
            this.canvas?.remove(fabricObject);
        }
        setTimeout(() => {
            if (document.activeElement === document.body) {
                this._uiManager.focusMainContainer();
            }
        }, 0);

        // if (!this._isCleaningUp) {
        //   this.addInkEditorIfNeeded(/* isCommitting = */ false);
        // }
    }

    enableClick() {
        // @ts-ignore
        this._listeners.add(this.canvas?.getElement().parentElement, 'pointerdown', this._boundPointerdown);
        // @ts-ignore
        this._listeners.add(this.canvas?.getElement().parentElement, 'pointerup', this._boundPointerup);
        //this.canvas?.on('mouse:down', this._boundPointerdown);
        //this.canvas?.on('mouse:up', this._boundPointerup);
    }

    disableClick() {
        this._listeners.removeAll();
    }

    /**
     * 
     * @param {AnnotationEditor} editor 
     */
    attach(editor) {
        this._editors.set(editor.id, editor);
        console.log(this._editors);
    }

    /**
     * 
     * @param {AnnotationEditor} editor 
     */
    detach(editor) {
        this._editors.delete(editor.id);
    }

    /**
     * The mode has changed: it must be updated.
     * @param {AnnotationType} mode 
     */
    updateMode(mode = this._uiManager.getMode()) {
        this._cleanup();
        switch (mode) {
            case 'disabled':
                break;
            default:
                this._attachToDOM();
                this.enableClick();
                break;
        }
        this._uiManager.unselectAll();
    }

    /**
     * Set the dimensions of the main editor layer div
     */
    setDimensions() {
        // @ts-ignore
        const { width, height, rotation } = this.viewport;
        const flipOrientation = rotation % 180 !== 0,
            widthStr = Math.floor(width) + "px",
            heightStr = Math.floor(height) + "px";

        // @ts-ignore
        this.div.style.width = flipOrientation ? heightStr : widthStr;
        // @ts-ignore
        this.div.style.height = flipOrientation ? widthStr : heightStr;
        // @ts-ignore
        this.div.dataset.mainRotation = rotation;
        // @ts-ignore
        this.canvas.setDimensions({ width, height });
    }

    /**
     * Pointerup callback.
     * @param {MouseEvent} event
     */
    pointerup(event) {
        if (!this._allowClick) {
            this._allowClick = true;
            return;
        }
    }

    /**
     * Pointerdown callback.
     * @param {MouseEvent} event
     */
    pointerdown(event) {
        this._createAndAddNewEditor(event);
        this._allowClick = true;
    }

    /**
     * Pointermove callback.
     * @param {fabric.IEvent<MouseEvent>} event
     */
    pointermove(event) {
        console.log('pointermove');
    }


    /**
     * Set the last selected editor
     * @param {AnnotationEditor} editor 
     */
    setSelected(editor) {
        this._uiManager.setSelected(editor);
    }

    /**
     * Add or remove an editor the current selection
     * @param {AnnotationEditor} editor 
     */
    toggleSelected(editor) {
        this._uiManager.toggleSelected(editor);
    }

    /**
     * Check if the editor is selected
     * @param {AnnotationEditor} editor 
     */
    isSelected(editor) {
        this._uiManager.isSelected(editor);
    }

    /**
     * Unselect an editor  
     * @param {AnnotationEditor} editor 
     */
    unselect(editor) {
        this._uiManager.unselect(editor);
    }

    /**
   * Get an id for an editor.
   * @returns {string}
   */
    getNextId() {
        return this._uiManager.getId();
    }

    /**
   * Set the current editor.
   * @param {AnnotationEditor} editor
   */
    setActiveEditor(editor) {
        const currentActive = this._uiManager.getActive();
        if (currentActive === editor) {
            return;
        }

        this._uiManager.setActiveEditor(editor);
    }

    /**
   * Enable pointer events on the main div in order to enable
   * editor creation.
   */
    enable() {
        // @ts-ignore
        this.div.style.pointerEvents = "auto";
        for (const editor of this._editors.values()) {
            editor.enableEditing();
        }
    }

    /**
     * Disable editor creation.
     */
    disable() {
        // @ts-ignore
        this.div.style.pointerEvents = "none";
        for (const editor of this._editors.values()) {
            editor.disableEditing();
        }
    }

    /**
   * Destroy the main editor.
   */
    destroy() {
        if (this._uiManager.getActive()?.parent === this) {
            this._uiManager.setActiveEditor(null);
        }

        this.canvas?.dispose();
        this.canvas = null;
        this.div = null;
        this._editors.clear();
        this._waitingEditors.clear();
        this._uiManager.removeLayer(this);
    }

    /**
   * Create a new editor
   * @param {Object} data
   * @returns {AnnotationEditor|undefined}
   */
    deserialize(data) {
        // switch (data.annotationType) {
        //     case AnnotationEditorType.FREETEXT:
        //         return FreeTextEditor.deserialize(data, this);
        //     case AnnotationEditorType.INK:
        //         return InkEditor.deserialize(data, this);
        //     case AnnotationEditorType.RECTANGLE:
        //         return RectangleEditor.deserialize(data, this);
        //     case AnnotationEditorType.HIGHLIGHT:
        //         return HighlightEditor.deserialize(data, this);
        // }
        return undefined;
    }

    //#endregion PUBLICS
}