import { TinyEmitter } from "tiny-emitter";
import { shadow } from "./utils";
import { ListenerCollection } from "../../../shared/listener-collection";
import { EventBus as AppEventBus } from "../../util/emitter";
import { AnnotationEditor } from './annotation-editor';

/**
 * @typedef {import('./annotation-editor-layer').AnnotationEditorLayer} AnnotationEditorLayer
 * @typedef {import('../../../types/annotator').AnnotationType} AnnotationType
 * @typedef {import("../../../types/pdfjs").EventBus} EventBus
 * @typedef {import('../../util/emitter').Emitter} Emitter
 */

/**
 * Class to create some unique ids for the different editors.
 */
class IdManager {
    constructor() {
        this._id = 0;
    }
    /**
     * Get a unique id.
     * @returns {string}
     */
    getId() {
        return `reporthub-annotation-editor-${this._id++}`;
    }
}

/**
 * Class to handle undo/redo.
 * Commands are just saved in a buffer.
 * If we hit some memory issues we could likely use a circular buffer.
 * It has to be used as a singleton.
 */
class CommandManager {
    /**
     * @type {object[]}
     */
    _commands = [];
    /** @type {number} */
    _maxSize;
    /** @type {number} */
    _position = -1;

    constructor(maxSize = 128) {
        this._commands = [];
        this._maxSize = maxSize;
        this._position = -1;
    }

    /**
     * @typedef {Object} addOptions
     * @property {function} cmd
     * @property {function} undo
     * @property {boolean} mustExec
     * @property {number} type
     * @property {boolean} overwriteIfSameType
     * @property {boolean} keepUndo
     */

    /**
     * Add a new couple of commands to be used in case of redo/undo.
     * @param {addOptions} options
     */
    add({
        cmd,
        undo,
        mustExec,
        type = NaN,
        overwriteIfSameType = false,
        keepUndo = false,
    }) {
        if (mustExec) {
            cmd();
        }

        const save = { cmd, undo, type };
        if (this._position === -1) {
            this._position = 0;
            this._commands.push(save);
            return;
        }

        // @ts-ignore
        if (overwriteIfSameType && this._commands[this._position].type === type) {
            // For example when we change a color we don't want to
            // be able to undo all the steps, hence we only want to
            // keep the last undoable action in this sequence of actions.
            if (keepUndo) {
                // @ts-ignore
                save.undo = this._commands[this._position].undo;
            }
            this._commands[this._position] = save;
            return;
        }

        const next = this._position + 1;
        if (next === this._maxSize) {
            this._commands.splice(0, 1);
        } else {
            this._position = next;
            if (next < this._commands.length) {
                this._commands.splice(next);
            }
        }

        this._commands.push(save);
    }

    /**
     * Undo the last command.
     */
    undo() {
        if (this._position === -1) {
            // Nothing to undo.
            return;
        }
        // @ts-ignore
        this._commands[this._position].undo();
        this._position -= 1;
    }

    /**
     * Redo the last command.
     */
    redo() {
        if (this._position < this._commands.length - 1) {
            this._position += 1;
            // @ts-ignore
            this._commands[this._position].cmd();
        }
    }

    /**
     * Check if there is something to undo.
     * @returns {boolean}
     */
    hasSomethingToUndo() {
        return this._position !== -1;
    }

    /**
     * Check if there is something to redo.
     * @returns {boolean}
     */
    hasSomethingToRedo() {
        return this._position < this._commands.length - 1;
    }

    destroy() {
        this._commands = [];
    }
}

/**
 * Class to handle the different keyboards shortcuts we can have on mac or
 * non-mac OSes.
 */
class KeyboardManager {
    /**
     * Create a new keyboard manager class.
     * @param {Array<[]>} callbacks - an array containing an array of shortcuts
     * and a callback to call.
     * A shortcut is a string like `ctrl+c` or `mac+ctrl+c` for mac OS.
     */
    constructor(callbacks) {
        /** @type {string[]} */
        this.buffer = [];
        this.callbacks = new Map();
        this.allKeys = new Set();

        const isMac = KeyboardManager.platform.isMac;
        // @ts-ignore
        for (const [keys, callback] of callbacks) {
            // @ts-ignore
            for (const key of keys) {
                const isMacKey = key.startsWith("mac+");
                if (isMac && isMacKey) {
                    this.callbacks.set(key.slice(4), callback);
                    this.allKeys.add(key.split("+").at(-1));
                } else if (!isMac && !isMacKey) {
                    this.callbacks.set(key, callback);
                    this.allKeys.add(key.split("+").at(-1));
                }
            }
        }
    }

    static get platform() {
        const platform = typeof navigator !== "undefined" ? navigator.platform : "";

        return shadow(this, "platform", {
            isWin: platform.includes("Win"),
            isMac: platform.includes("Mac"),
        });
    }

    /**
     * Serialize an event into a string in order to match a
     * potential key for a callback.
     * @param {KeyboardEvent} event
     * @returns {string}
     */
    _serialize(event) {
        if (event.altKey) {
            this.buffer.push("alt");
        }
        if (event.ctrlKey) {
            this.buffer.push("ctrl");
        }
        if (event.metaKey) {
            this.buffer.push("meta");
        }
        if (event.shiftKey) {
            this.buffer.push("shift");
        }
        this.buffer.push(event.key);
        const str = this.buffer.join("+");
        this.buffer.length = 0;

        return str;
    }

    /**
     * Execute a callback, if any, for a given keyboard event.
     * The self is used as `this` in the callback.
     * @param {object} self
     * @param {KeyboardEvent} event
     * @returns
     */
    exec(self, event) {
        if (!this.allKeys.has(event.key)) {
            return;
        }
        const callback = this.callbacks.get(this._serialize(event));
        if (!callback) {
            return;
        }
        callback.bind(self)();
        event.preventDefault();
    }
}

/**
 * Basic clipboard to copy/paste some editors.
 * It has to be used as a singleton.
 */
class ClipboardManager {
    /** @type {object[]} */
    // @ts-ignore
    _elements = null;

    /**
     * Copy an element.
     * @param {AnnotationEditor|Array<AnnotationEditor>} element
     */
    copy(element) {
        if (!element) {
            return;
        }
        if (Array.isArray(element)) {
            // @ts-ignore
            this._elements = element.map(el => el.serialize());
        } else {
            // @ts-ignore
            this._elements = [element.serialize()];
        }
        this._elements = this._elements.filter(el => !!el);
        if (this._elements.length === 0) {
            // @ts-ignore
            this._elements = null;
        }
    }

    /**
     * Create a new element.
     */
    paste() {
        return this._elements;
    }

    /**
     * Check if the clipboard is empty.
     * @returns {boolean}
     */
    isEmpty() {
        return this._elements === null;
    }

    destroy() {
        // @ts-ignore
        this._elements = null;
    }
}

/**
 * A pdf has several pages and each of them when it will rendered
 * will have an AnnotationEditorLayer which will contain the some
 * new Annotations associated to an editor in order to modify them.
 *
 * This class is used to manage all the different layers, editors and
 * some action like copy/paste, undo/redo, ...
 */
class AnnotationEditorUIManager extends TinyEmitter {
    /** @type {AnnotationEditor|null} */
    _activeEditor = null;
    /** @type {Map<string, AnnotationEditor>} */
    _allEditors = new Map();
    /** @type {Map<number, AnnotationEditorLayer>} */
    _allLayers = new Map();

    _clipboardManager = new ClipboardManager();

    _commandManager = new CommandManager();

    _currentPageIndex = 0;

    /** @type {any[]} */
    _editorTypes = [];


    _idManager = new IdManager();

    _isEnabled = false;

    /** @type {AnnotationType} */
    _mode = 'disabled';

    /** @type {Set<AnnotationEditor>} */
    _selectedEditors = new Set();

    _boundKeydown = this.keydown.bind(this);

    _boundOnEditingAction = this.onEditingAction.bind(this);

    _boundOnPageChanging = this.onPageChanging.bind(this);

    /** @type {{isEditing: boolean, isEmpty: boolean, hasEmptyClipboard: boolean, hasSomethingToUndo: boolean, hasSomethingToRedo: boolean, hasSelectedEditor: boolean}} */
    _previousStates = {
        isEditing: false,
        isEmpty: true,
        hasEmptyClipboard: true,
        hasSomethingToUndo: false,
        hasSomethingToRedo: false,
        hasSelectedEditor: false,
    };
    /** @type {HTMLElement} */
    // @ts-ignore
    _container = null;

    /** @type {EventBus} */
    _eventBus;

    /** @type {Emitter} */
    _emitter = (new AppEventBus()).createEmitter();

    static _keyboardManager = new KeyboardManager([
        // @ts-ignore
        [["ctrl+a", "mac+meta+a"], AnnotationEditorUIManager.prototype.selectAll],
        // @ts-ignore
        [["ctrl+c", "mac+meta+c"], AnnotationEditorUIManager.prototype.copy],
        // @ts-ignore
        [["ctrl+v", "mac+meta+v"], AnnotationEditorUIManager.prototype.paste],
        // @ts-ignore
        [["ctrl+x", "mac+meta+x"], AnnotationEditorUIManager.prototype.cut],
        // @ts-ignore
        [["ctrl+z", "mac+meta+z"], AnnotationEditorUIManager.prototype.undo],
        // @ts-ignore
        [
            ["ctrl+y", "ctrl+shift+Z", "mac+meta+shift+Z"],
            AnnotationEditorUIManager.prototype.redo,
        ],
        // @ts-ignore
        [
            [
                "Backspace",
                "alt+Backspace",
                "ctrl+Backspace",
                "shift+Backspace",
                "mac+Backspace",
                "mac+alt+Backspace",
                "mac+ctrl+Backspace",
                "Delete",
                "ctrl+Delete",
                "shift+Delete",
            ],
            AnnotationEditorUIManager.prototype.delete,
        ],
        // @ts-ignore
        [["Escape"], AnnotationEditorUIManager.prototype.unselectAll],
    ]);

    /**
     * 
     * @param {HTMLElement} container 
     * @param {EventBus} pdfEventBus
     * 
     */
    constructor(container, pdfEventBus) {
        super();
        //this._emitter = appEventBus.createEmitter();
        this._eventBus = pdfEventBus;
        this._container = container;
        this.listeners = new ListenerCollection();

        this._eventBus.on("editingaction", this._boundOnEditingAction);
        this._eventBus.on("pagechanging", this._boundOnPageChanging);
        //this.on("textlayerrendered", this._boundOnTextLayerRendered);
    }

    destroy() {
        this._removeKeyboardManager();
        this._eventBus.off("editingaction", this._boundOnEditingAction);
        this._eventBus.off("pagechanging", this._boundOnPageChanging);
        //this.off("textlayerrendered", this._boundOnTextLayerRendered);
        for (const layer of this._allLayers.values()) {
            layer.destroy();
        }
        this._allLayers.clear();
        this._allEditors.clear();
        this._activeEditor = null;
        this._selectedEditors.clear();
        this._clipboardManager.destroy();
        this._commandManager.destroy();
    }

    /**
     * 
     * @param {{pageNumber: number}} param0 
     */
    onPageChanging({ pageNumber }) {
        this._currentPageIndex = pageNumber - 1;
    }

    focusMainContainer() {
        this._container.focus();
    }

    _addKeyboardManager() {
        // The keyboard events are caught at the container level in order to be able
        // to execute some callbacks even if the current page doesn't have focus.
        this._container.addEventListener("keydown", this._boundKeydown);
        //this.listeners.add(this._container, 'keydown', this._boundKeydown);
    }

    _removeKeyboardManager() {
        this._container.removeEventListener("keydown", this._boundKeydown);
    }

    /**
     * Keydown callback.
     * @param {KeyboardEvent} event
     */
    keydown(event) {
        if (!this.getActive()?.shouldGetKeyboardEvents()) {
            AnnotationEditorUIManager._keyboardManager.exec(this, event);
        }
    }

    /**
     * Execute an action for a given name.
     * For example, the user can click on the "Undo" entry in the context menu
     * and it'll trigger the undo action.
     * @param {{name: string}} details
     */
    onEditingAction(details) {
        if (
            ["undo", "redo", "cut", "copy", "paste", "delete", "selectAll"].includes(
                details.name
            )
        ) {
            // @ts-ignore
            this[details.name]();
        }
    }

    /**
     * Update the different possible states of this manager, e.g. is the clipboard
     * empty or is there something to undo, ...
     * @param {Object} details
     */
    _dispatchUpdateStates(details) {
        const hasChanged = Object.entries(details).some(
            // @ts-ignore
            ([key, value]) => this._previousStates[key] !== value
        );

        if (hasChanged) {
            this._emitter.publish("annotationeditorstateschanged", {
                source: this,
                details: Object.assign(this._previousStates, details),
            });
        }
    }

    /**
     * @param {Object} details
     */
    _dispatchUpdateUI(details) {
        this._emitter.publish("annotationeditorparamschanged", {
            source: this,
            details,
        });
    }

    /**
     * Set the editing state.
     * It can be useful to temporarily disable it when the user is editing a
     * FreeText annotation.
     * @param {boolean} isEditing
     */
    setEditingState(isEditing) {
        if (isEditing) {
            this._addKeyboardManager();
            this._dispatchUpdateStates({
                isEditing: this._mode !== 'disabled',
                isEmpty: this._isEmpty(),
                hasSomethingToUndo: this._commandManager.hasSomethingToUndo(),
                hasSomethingToRedo: this._commandManager.hasSomethingToRedo(),
                hasSelectedEditor: false,
                hasEmptyClipboard: this._clipboardManager.isEmpty(),
            });
        } else {
            this._removeKeyboardManager();
            this._dispatchUpdateStates({
                isEditing: false,
            });
        }
    }

    /**
     * 
     * @param {any[]} types 
     */
    registerEditorTypes(types) {
        this._editorTypes = types;
        for (const editorType of this._editorTypes) {
            this._dispatchUpdateUI(editorType.defaultPropertiesToUpdate);
        }
    }

    /**
     * Get an id.
     * @returns {string}
     */
    getId() {
        return this._idManager.getId();
    }

    /**
     * Add a new layer for a page which will contains the editors.
     * @param {AnnotationEditorLayer} layer
     */
    addLayer(layer) {
        // @ts-ignore
        this._allLayers.set(layer.pageIndex, layer);
        if (this._isEnabled) {
            // @ts-ignore
            layer.enable();
        } else {
            // @ts-ignore
            layer.disable();
        }
    }

    /**
     * Remove a layer.
     * @param {AnnotationEditorLayer} layer
     */
    removeLayer(layer) {
        // @ts-ignore
        this._allLayers.delete(layer.pageIndex);
    }

    /**
     * Change the editor mode (None, FreeText, Ink, ...)
     * @param {AnnotationType} mode
     */
    updateMode(mode) {
        this._mode = mode;
        if (mode === 'disabled') {
            this.setEditingState(false);
            this._disableAll();
        } else {
            this.setEditingState(true);
            this._enableAll();
            for (const layer of this._allLayers.values()) {
                layer.updateMode(mode);
            }
        }
    }

    /**
     * Update the toolbar if it's required to reflect the tool currently used.
     * @param {AnnotationType} mode
     * @returns {undefined}
     */
    updateToolbar(mode) {
        if (mode === this._mode) {
            return;
        }
        this._emitter.publish("switchannotationeditormode", {
            source: this,
            mode,
        });
    }

    /**
     * Update a parameter in the current editor or globally.
     * @param {number} type
     * @param {*} value
     */
    updateParams(type, value) {
        for (const editor of this._selectedEditors) {
            editor.updateParams(type, value);
        }

        for (const editorType of this._editorTypes) {
            editorType.updateDefaultParams(type, value);
        }
    }

    /**
     * Enable all the layers.
     */
    _enableAll() {
        if (!this._isEnabled) {
            this._isEnabled = true;
            for (const layer of this._allLayers.values()) {
                layer.enable();
            }
        }
    }

    /**
     * Disable all the layers.
     */
    _disableAll() {
        this.unselectAll();
        if (this._isEnabled) {
            this._isEnabled = false;
            for (const layer of this._allLayers.values()) {
                layer.disable();
            }
        }
    }

    /**
     * Get all the editors belonging to a give page.
     * @param {number} pageIndex
     * @returns {Array<AnnotationEditor>}
     */
    getEditors(pageIndex) {
        const editors = [];
        for (const editor of this._allEditors.values()) {
            if (editor.pageIndex === pageIndex) {
                editors.push(editor);
            }
        }
        return editors;
    }

    /**
     * Get an editor with the given id.
     * @param {string} id
     * @returns {AnnotationEditor|undefined}
     */
    getEditor(id) {
        return this._allEditors.get(id);
    }

    /**
     * Add a new editor.
     * @param {AnnotationEditor} editor
     */
    addEditor(editor) {
        this._allEditors.set(editor.id, editor);
    }

    /**
     * Remove an editor.
     * @param {AnnotationEditor} editor
     */
    removeEditor(editor) {
        this._allEditors.delete(editor.id);
        this.unselect(editor);
    }

    /**
     * Add an editor to the layer it belongs to or add it to the global map.
     * @param {AnnotationEditor} editor
     */
    _addEditorToLayer(editor) {
        const layer = this._allLayers.get(editor.pageIndex);
        if (layer) {
            layer.addOrRebuild(editor);
        } else {
            this.addEditor(editor);
        }
    }

    /**
     * Set the given editor as the active one.
     * @param {AnnotationEditor|null} editor
     */
    setActiveEditor(editor) {
        if (this._activeEditor === editor) {
            return;
        }

        this._activeEditor = editor;
        if (editor) {
            this._dispatchUpdateUI(editor.propertiesToUpdate);
        }
    }

    /**
     * Add or remove an editor the current selection.
     * @param {AnnotationEditor} editor
     */
    toggleSelected(editor) {
        if (this._selectedEditors.has(editor)) {
            this._selectedEditors.delete(editor);
            editor.unselect();
            this._dispatchUpdateStates({
                hasSelectedEditor: this.hasSelection,
            });
            return;
        }
        this._selectedEditors.add(editor);
        editor.select();
        this._dispatchUpdateUI(editor.propertiesToUpdate);
        this._dispatchUpdateStates({
            hasSelectedEditor: true,
        });
    }

    /**
     * Set the last selected editor.
     * @param {AnnotationEditor} editor
     */
    setSelected(editor) {
        for (const ed of this._selectedEditors) {
            if (ed !== editor) {
                ed.unselect();
            }
        }
        this._selectedEditors.clear();

        this._selectedEditors.add(editor);
        editor.select();
        this._dispatchUpdateUI(editor.propertiesToUpdate);
        this._dispatchUpdateStates({
            hasSelectedEditor: true,
        });
    }

    /**
     * Check if the editor is selected.
     * @param {AnnotationEditor} editor
     */
    isSelected(editor) {
        return this._selectedEditors.has(editor);
    }

    /**
     * Unselect an editor.
     * @param {AnnotationEditor} editor
     */
    unselect(editor) {
        editor.unselect();
        this._selectedEditors.delete(editor);
        this._dispatchUpdateStates({
            hasSelectedEditor: this.hasSelection,
        });
    }

    get hasSelection() {
        return this._selectedEditors.size !== 0;
    }

    /**
     * Undo the last command.
     */
    undo() {
        this._commandManager.undo();
        this._dispatchUpdateStates({
            hasSomethingToUndo: this._commandManager.hasSomethingToUndo(),
            hasSomethingToRedo: true,
            isEmpty: this._isEmpty(),
        });
    }

    /**
     * Redo the last undoed command.
     */
    redo() {
        this._commandManager.redo();
        this._dispatchUpdateStates({
            hasSomethingToUndo: true,
            hasSomethingToRedo: this._commandManager.hasSomethingToRedo(),
            isEmpty: this._isEmpty(),
        });
    }

    /**
     * Add a command to execute (cmd) and another one to undo it.
     * @param {Object} params
     */
    addCommands(params) {
        // @ts-ignore
        this._commandManager.add(params);
        this._dispatchUpdateStates({
            hasSomethingToUndo: true,
            hasSomethingToRedo: false,
            isEmpty: this._isEmpty(),
        });
    }

    _isEmpty() {
        if (this._allEditors.size === 0) {
            return true;
        }

        if (this._allEditors.size === 1) {
            for (const editor of this._allEditors.values()) {
                return editor.isEmpty();
            }
        }

        return false;
    }

    /**
     * Delete the current editor or all.
     */
    delete() {
        if (this._activeEditor) {
            // An editor is being edited so just commit it.
            this._activeEditor.commitOrRemove();
        }

        if (!this.hasSelection) {
            return;
        }

        const editors = [...this._selectedEditors];
        const cmd = () => {
            for (const editor of editors) {
                editor.remove();
            }
        };
        const undo = () => {
            for (const editor of editors) {
                this._addEditorToLayer(editor);
            }
        };

        this.addCommands({ cmd, undo, mustExec: true });
    }

    /**
     * Copy the selected editor.
     */
    copy() {
        if (this._activeEditor) {
            // An editor is being edited so just commit it.
            this._activeEditor.commitOrRemove();
        }
        if (this.hasSelection) {
            const editors = [];
            for (const editor of this._selectedEditors) {
                if (!editor.isEmpty()) {
                    editors.push(editor);
                }
            }
            if (editors.length === 0) {
                return;
            }

            this._clipboardManager.copy(editors);
            this._dispatchUpdateStates({ hasEmptyClipboard: false });
        }
    }

    /**
     * Cut the selected editor.
     */
    cut() {
        this.copy();
        this.delete();
    }

    /**
     * Paste a previously copied editor.
     * @returns {undefined}
     */
    paste() {
        if (this._clipboardManager.isEmpty()) {
            return;
        }

        this.unselectAll();

        const layer = this._allLayers.get(this._currentPageIndex);
        const newEditors = this._clipboardManager
            .paste()
            .map(data => layer?.deserialize(data));

        const cmd = () => {
            for (const editor of newEditors) {
                // @ts-ignore
                this._addEditorToLayer(editor);
            }
            // @ts-ignore
            this._selectEditors(newEditors);
        };
        const undo = () => {
            for (const editor of newEditors) {
                // @ts-ignore
                editor.remove();
            }
        };
        this.addCommands({ cmd, undo, mustExec: true });
    }

    /**
     * Select the editors.
     * @param {Array<AnnotationEditor>} editors
     */
    _selectEditors(editors) {
        this._selectedEditors.clear();
        for (const editor of editors) {
            if (editor.isEmpty()) {
                continue;
            }
            this._selectedEditors.add(editor);
            editor.select();
        }
        this._dispatchUpdateStates({ hasSelectedEditor: true });
    }

    /**
     * Select all the editors.
     */
    selectAll() {
        for (const editor of this._selectedEditors) {
            editor.commit();
        }
        // @ts-ignore
        this._selectEditors(this._allEditors.values());
    }

    /**
     * Unselect all the selected editors.
     */
    unselectAll() {
        if (this._activeEditor) {
            // An editor is being edited so just commit it.
            this._activeEditor.commitOrRemove();
            return;
        }

        // @ts-ignore
        if (this._selectEditors.size === 0) {
            return;
        }
        for (const editor of this._selectedEditors) {
            editor.unselect();
        }
        this._selectedEditors.clear();
        this._dispatchUpdateStates({
            hasSelectedEditor: false,
        });
    }

    /**
     * Is the current editor the one passed as argument?
     * @param {AnnotationEditor} editor
     * @returns
     */
    isActive(editor) {
        return this._activeEditor === editor;
    }

    /**
     * Get the current active editor.
     * @returns {AnnotationEditor|null}
     */
    getActive() {
        return this._activeEditor;
    }

    /**
     * Get the current editor mode.
     * @returns {AnnotationType}
     */
    getMode() {
        return this._mode;
    }
}

export {
    KeyboardManager,
    AnnotationEditorUIManager,
    CommandManager
}