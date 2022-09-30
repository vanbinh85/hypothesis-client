import { createRef, render } from 'preact';
import AnnotationToolbar from './components/AnnotationToolbar';


/**
 * @typedef {import('../types/annotator').AnnotationType} AnnotationType
 */

/**
 * @typedef AnnotationEditorToolbarOptions
 * @prop {(mode: AnnotationType) => void} annotationEditorModeChanged
 */

/**
 * Controller for the annotation editor toolbar bellow the pdf.js viewer's toolbar
 *
 * This toolbar provides controls for adding highlight, rectangle, free drawing, etc. to the pdf page.
 */
export class AnnotationEditorToolbarController {
    /**
     * @param {HTMLElement} container - Element into which the toolbar is rendered
     * @param {AnnotationEditorToolbarOptions} options
     */
    constructor(container, options) {
        this._container = container;
        /** @type {(mode: AnnotationType) => void} */
        this._annotationEditorModeChanged = (mode) => options.annotationEditorModeChanged(mode);
        this.render();
    }

    render() {
        render(
            <AnnotationToolbar
                onSwitchAnnotationEditorMode={this._annotationEditorModeChanged} />,
            this._container
        );
    }
}