// @ts-nocheck
//import { fabric } from 'fabric';
import debounce from 'lodash.debounce';
import { render } from 'preact';
import { TinyEmitter } from 'tiny-emitter';

import { ListenerCollection } from '../../shared/listener-collection';
import {
  RenderingStates,
  anchor,
  canDescribe,
  describe,
  documentHasText,
} from '../anchoring/pdf';
import { isInPlaceholder, removePlaceholder } from '../anchoring/placeholder';

import Banners from '../components/Banners';
import ContentInfoBanner from '../components/ContentInfoBanner';
import WarningBanner from '../components/WarningBanner';
import { createShadowRoot } from '../util/shadow-root';
import { offsetRelativeTo, scrollElement } from '../util/scroll';

import { PDFMetadata } from './pdf-metadata';
import { AnnotationEditorUIManager } from './annotation-editor/annotation-editor-ui-manager';
import { AnnotationEditorLayer } from './annotation-editor/annotation-editor-layer';
// import fabric from 'fabric/fabric-impl';

/**
 * @typedef {import('../../types/annotator').Anchor} Anchor
 * @typedef {import('../../types/annotator').AnnotationData} AnnotationData
 * @typedef {import('../../types/annotator').Annotator} Annotator
 * @typedef {import('../../types/annotator').ContentInfoConfig} ContentInfoConfig
 * @typedef {import('../../types/annotator').HypothesisWindow} HypothesisWindow
 * @typedef {import('../../types/annotator').Integration} Integration
 * @typedef {import('../../types/annotator').SidebarLayout} SidebarLayout
 * @typedef {import('../../types/api').Selector} Selector
 * @typedef {import('../../types/pdfjs').PDFViewerApplication} PDFViewerApplication
 * @typedef {import('../../types/annotator').AnnotationType} AnnotationType
 */

// The viewport and controls for PDF.js start breaking down below about 670px
// of available space, so only render PDF and sidebar side-by-side if there
// is enough room. Otherwise, allow sidebar to overlap PDF
const MIN_PDF_WIDTH = 680;

/**
 * Return true if `anchor` is in an un-rendered page.
 *
 * @param {Anchor} anchor
 */
function anchorIsInPlaceholder(anchor) {
  const highlight = anchor.highlights?.[0];
  return highlight && isInPlaceholder(highlight);
}

/** @param {number} ms */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Is the current document the PDF.js viewer application?
 */
export function isPDF() {
  // @ts-ignore - TS doesn't know about PDFViewerApplication global.
  return typeof PDFViewerApplication !== 'undefined';
}

/**
 * Integration that works with PDF.js
 * @implements {Integration}
 */
export class PDFIntegration extends TinyEmitter {
  /**
   * @param {Annotator} annotator
   * @param {object} options
   *   @param {number} [options.reanchoringMaxWait] - Max time to wait for
   *     re-anchoring to complete when scrolling to an un-rendered page.
   */
  constructor(annotator, options = {}) {
    super();

    this.annotator = annotator;

    const window_ = /** @type {HypothesisWindow} */ (window);

    // Assume this class is only used if we're in the PDF.js viewer.
    const pdfViewerApp = /** @type {PDFViewerApplication} */ (
      window_.PDFViewerApplication
    );

    this.pdfViewer = pdfViewerApp.pdfViewer;
    this.pdfViewer.viewer.classList.add('has-transparent-text-layer');

    // Get the element that contains all of the PDF.js UI. This is typically
    // `document.body`.
    this.pdfContainer = pdfViewerApp.appConfig?.appContainer ?? document.body;

    this.pdfMetadata = new PDFMetadata(pdfViewerApp);

    this.observer = new MutationObserver(debounce(() => this._update(), 100));
    this.observer.observe(this.pdfViewer.viewer, {
      attributes: true,
      attributeFilter: ['data-loaded'],
      childList: true,
      subtree: true,
    });

    this.pdfViewer.eventBus.on('pagerendered', this._onPDFPageRendered.bind(this));

    /**
     * Amount of time to wait for re-anchoring to complete when scrolling to
     * an anchor in a not-yet-rendered page.
     */
    this._reanchoringMaxWait = options.reanchoringMaxWait ?? 3000;

    /**
     * Banners shown at the top of the PDF viewer.
     *
     * @type {HTMLElement|null}
     */
    this._banner = null;

    /** State indicating which banners to show above the PDF viewer. */
    this._bannerState = {
      /** @type {ContentInfoConfig|null} */
      contentInfo: null,
      /** Warning that the current PDF does not have selectable text. */
      noTextWarning: false,
    };
    this._updateBannerState(this._bannerState);
    this._checkForSelectableText();

    // Hide annotation layer when the user is making a selection. The annotation
    // layer appears above the invisible text layer and can interfere with text
    // selection. See https://github.com/hypothesis/client/issues/1464.
    this._updateAnnotationLayerVisibility = () => {
      const selection = /** @type {Selection} */ (window_.getSelection());

      // Add CSS class to indicate whether there is a selection. Annotation
      // layers are then hidden by a CSS rule in `pdfjs-overrides.scss`.
      this.pdfViewer.viewer.classList.toggle(
        'is-selecting',
        !selection.isCollapsed
      );
    };

    this._listeners = new ListenerCollection();
    this._listeners.add(
      document,
      'selectionchange',
      this._updateAnnotationLayerVisibility
    );
    
    /**
     * @type { Array<fabric.Canvas> }
     */
    this._farbricCanvases = [];
    
    /**
     * @type { Array<{ div: HTMLElement | null, observer: ResizeObserver }> }
     */
    this._resizeObservers = [];
    
    /**
     * @type {AnnotationType}
     */
    this._currentAnnotationType = 'disabled';

    // A flag that indicates whether `destroy` has been called. Used to handle
    // `destroy` being called during async code elsewhere in the class.
    this._destroyed = false;

    this.annotationEditorUIManager = new AnnotationEditorUIManager(this.pdfViewer.container, this.pdfViewer.eventBus);
  }

  destroy() {
    // Clears canvas element and removes all canvas event listeners
    this._farbricCanvases.forEach(canvas => {
      canvas.dispose();
    });
    this._farbricCanvases = [];
    
    this._resizeObservers.forEach(obj => {
      obj.observer.disconnect();
      obj.div?.remove();
    });

    this._resizeObservers = [];

    this._listeners.removeAll();
    this.pdfViewer.viewer.classList.remove('has-transparent-text-layer');
    this.observer.disconnect();
    this._banner?.remove();
    this._destroyed = true;
    //console.trace('destroy()');
  }

  /**
   * Return the URL of the currently loaded PDF document.
   */
  uri() {
    return this.pdfMetadata.getUri();
  }

  /**
   * Return the metadata (eg. title) for the currently loaded PDF document.
   */
  getMetadata() {
    return this.pdfMetadata.getMetadata();
  }

  /**
   * Display a banner at the top of the PDF viewer showing information about the
   * current document.
   *
   * @param {ContentInfoConfig} contentInfo
   */
  showContentInfo(contentInfo) {
    this._updateBannerState({ contentInfo });
  }

  /**
   * Resolve serialized `selectors` from an annotation to a range.
   *
   * @param {HTMLElement} root
   * @param {Selector[]} selectors
   * @return {Promise<Range>}
   */
  anchor(root, selectors) {
    // nb. The `root` argument is not really used by `anchor`. It existed for
    // consistency between HTML and PDF anchoring and could be removed.
    return anchor(root, selectors);
  }

  /**
   * Return true if the text in a range lies within the text layer of a PDF.
   *
   * @param {Range} range
   */
  canAnnotate(range) {
    return canDescribe(range);
  }

  /**
   * Generate selectors for the text in `range`.
   *
   * @param {HTMLElement} root
   * @param {Range} range
   * @return {Promise<Selector[]>}
   */
  describe(root, range) {
    // nb. The `root` argument is not really used by `anchor`. It existed for
    // consistency between HTML and PDF anchoring and could be removed.
    return describe(root, range);
  }

  /**
   * @type {AnnotationType}
   */
  get annotationMode() {
    return this._currentAnnotationType;
  }

  /**
   * @param {AnnotationType} mode
   */
  set annotationMode(mode) {
    if (this._currentAnnotationType === mode) {
      return;
    }

    this._currentAnnotationType = mode;
    if (mode !== 'disabled') {
      this._createCanvas(this.pdfViewer.currentPageNumber - 1);
    }
  }

  async _getCurrentPageView() {
    return this._getPageView(this.pdfViewer.currentPageNumber - 1)
  }

  /**
   * Fired once a page is rendered.
   * @param {import('../../types/pdfjs').PDFPageView} source 
   * @param {number} pageNumber
   */
  _onPDFPageRendered({ source, pageNumber }) {
    const pageIndex = pageNumber - 1;
    this._getPageView(pageIndex).then(pdfPageView => { 
      if (pdfPageView.annotationEditorLayer) {
        return;
      }

      const annotationEditorLayer = new AnnotationEditorLayer({
        enabled: true,
        pageDiv: pdfPageView.div,
        pageIndex: pageIndex,
        uiManager: this.annotationEditorUIManager
      });
      annotationEditorLayer.render({ viewport: pdfPageView.viewport });
      pdfPageView.annotationEditorLayer = annotationEditorLayer;
    });
  }
  /**
   * Returns the view into which a PDF page is drawn.
   *
   * If called while the PDF document is still loading, this will delay until
   * the document loading has progressed far enough for a `PDFPageView` and its
   * associated `PDFPage` to be ready.
   *
   * @param {number} pageIndex
   * @return {Promise<import('../../types/pdfjs').PDFPageView>}
   */
  async _getPageView(pageIndex) {
    
    let pageView = this.pdfViewer.getPageView(pageIndex);

    if (!pageView || !pageView.pdfPage) {
      // If the document is still loading, wait for the `pagesloaded` event.
      //
      // Note that loading happens in several stages. Initially the page view
      // objects do not exist (`pageView` will be nullish), then after the
      // "pagesinit" event, the page view exists but it does not have a `pdfPage`
      // property set, then finally after the "pagesloaded" event, it will have
      // a "pdfPage" property.
      pageView = await new Promise(resolve => {
        const onPagesLoaded = () => {
          if (this.pdfViewer.eventBus) {
            this.pdfViewer.eventBus.off('pagesloaded', onPagesLoaded);
          } else {
            document.removeEventListener('pagesloaded', onPagesLoaded);
          }

          resolve(this.pdfViewer.getPageView(pageIndex));
        };

        if (this.pdfViewer.eventBus) {
          this.pdfViewer.eventBus.on('pagesloaded', onPagesLoaded);
        } else {
          // Old PDF.js versions (< 1.6.210) use DOM events.
          document.addEventListener('pagesloaded', onPagesLoaded);
        }
      });
    }

    return /** @type {import('../../types/pdfjs').PDFPageView} */ (pageView);
  }

  /**
   * Check whether the PDF has selectable text and show a warning if not.
   */
  async _checkForSelectableText() {
    // Wait for PDF to load.
    try {
      await this.uri();
    } catch (e) {
      return;
    }

    // Handle `PDF` instance being destroyed while URI is fetched. This is only
    // expected to happen in synchronous tests.
    if (this._destroyed) {
      return;
    }

    try {
      const hasText = await documentHasText();
      this._updateBannerState({ noTextWarning: !hasText });
    } catch (err) {
      /* istanbul ignore next */
      console.warn('Unable to check for text in PDF:', err);
    }
  }

  /**
   * Creates fabric.Canvas() on the top of pdf.js page's canvas if not presents.
   * @param {number} pageIndex 
   * 
   * @return {Promise<fabric.Canvas | null>}
   */
  async _createCanvas(pageIndex) {
    if (pageIndex >= 0 && pageIndex < this._farbricCanvases.length && this._farbricCanvases[pageIndex]) {
      return this._farbricCanvases[pageIndex];
    }

    const canvasLayerDiv = document.createElement('div');
    canvasLayerDiv.classList.add('editorAnnotationLayer');
    //this.canvasLayerDiv = canvasLayerDiv;

    const canvas = document.createElement('canvas');
    canvas.classList.add('editor-annotation-canvas');
    canvasLayerDiv.appendChild(canvas);
    
    const pdfPageView = await this._getPageView(pageIndex);

    if (!pdfPageView) return null;

    pdfPageView.div.appendChild(canvasLayerDiv);

    const fabricCanvas = new fabric.Canvas(canvas);
    this._farbricCanvases[pageIndex] = fabricCanvas;
    
    this._createResizeObserver(pageIndex);

    const [x, y, w, h] = await this._getInitialBBox(pageIndex);
    this._setDims(pageIndex, w, h);
    return fabricCanvas;
  }

  /**
   * Gets page number from element.
   * @param {HTMLElement} element 
   * @return {number} The zero-based number of page
   */
  _getPageNumberFromElement(element) {
    while (!('pageNumber' in element.dataset)) {
      element = element.parentElement;
    }
    if (!('pageNumber' in element.dataset)) {
      throw 'Could not determine the attribute [ data-page-number ]';
    }
    
    return (1 * element.dataset.pageNumber) - 1;
  }
  /**
   * Create the resize observer
   * 
   * @param {number} pageIndex
   */
  _createResizeObserver(pageIndex) {
    // @ts-ignore
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      
      if (rect.width && rect.height) {
        this._setDimensions(entries[0].target, rect.width, rect.height);
      }
    });
    const canvas = this._farbricCanvases[pageIndex];
    // @ts-ignore
    observer.observe(canvas.getElement().parentElement.parentElement);
    //const pageIndex = this._getPageNumberFromElement(canvas.getElement());
    this._resizeObservers[pageIndex] = {
      div: canvas.getElement().parentElement.parentElement,
      observer: observer
    };
  }

  /**
   * Gets innitial bbox
   * @param {number} pageIndex 
   * @returns number[x, y, width, height]
   */
  async _getInitialBBox(pageIndex) {
    const pdfPageView = await this._getPageView(pageIndex);

    const { width, height, rotation } = pdfPageView?.viewport;
    switch (rotation) {
      case 90:
        return [0, width, width, height];
      case 180:
        return [width, height, width, height];
      case 270:
        return [height, 0, width, height];
      default:
        return [0, 0, width, height];
    }
  }

  /**
   * When the dimensions of the div change the inner canvas must
   * renew its dimensions, hence it must redraw its own contents.
   * @param {HTMLElement} wrapper
   * @param {number} width - the new width of the div
   * @param {number} height - the new height of the div
   * @returns
   */
  _setDimensions(wrapper, width, height) {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    let realWidth = 0;
    let realHeight = 0;
    if (('realWidth' in wrapper.dataset)) {
      realWidth = 1 * wrapper.dataset.realWidth;
    }
    if (('realHeight') in wrapper.dataset) {
      realHeight = 1 * wrapper.dataset.realHeight;
    }

    if (realWidth === roundedWidth && realHeight === roundedHeight) {
      return;
    }

    wrapper.dataset.realWidth = roundedWidth;
    wrapper.dataset.realHeight = roundedHeight;

    //this.canvas.style.visibility = "hidden";

    // @ts-ignore
    const pageIndex = this._getPageNumberFromElement(wrapper);

    //this._setDims(pageIndex, width, height);

    this._setCanvasDims(pageIndex, width, height);

    //this.canvas.style.visibility = "visible";
  }

  /**
   * Sets dimensions (width, height) of page canvas
   * @param {number} pageIndex 
   * @param {number} width 
   * @param {number} height 
   */
  _setCanvasDims(pageIndex, width, height) {
    this._farbricCanvases[pageIndex].setDimensions({ width, height });
  }

  /**
   * Set the dimensions of editorAnnotationLayer.
   * @param {number} pageIndex
   * @param {number} width
   * @param {number} height
   */
  async _setDims(pageIndex, width, height) {
    const [parentWidth, parentHeight] = await this._viewportBaseDimensions(pageIndex);
    const { div } = this._resizeObservers[pageIndex];
    
    div.style.width = `${(100 * width) / parentWidth}%`;
    div.style.height = `${(100 * height) / parentHeight}%`;
  }

  /**
   * 
   * @param {number} pageIndex 
   * @returns number[w,h]
   */
  async _viewportBaseDimensions(pageIndex) {
    const pdfPageView = await this._getPageView(pageIndex);
    if (!pdfPageView) {
      return [0, 0];
    }
    const { width, height, rotation } = pdfPageView.viewport;
    return rotation % 180 === 0 ? [width, height] : [height, width];
  }

  /**
   * Update banners shown above the PDF viewer.
   *
   * @param {Partial<typeof PDFIntegration.prototype._bannerState>} state
   */
  _updateBannerState(state) {
    this._bannerState = { ...this._bannerState, ...state };

    // Get a reference to the top-level DOM element associated with the PDF.js
    // viewer.
    const outerContainer = /** @type {HTMLElement} */ (
      document.querySelector('#outerContainer')
    );

    const showBanner =
      this._bannerState.contentInfo || this._bannerState.noTextWarning;

    if (!showBanner) {
      this._banner?.remove();
      this._banner = null;

      // Undo inline styles applied when the banner is shown. The banner will
      // then gets its normal 100% height set by PDF.js's CSS.
      outerContainer.style.height = '';

      return;
    }

    if (!this._banner) {
      this._banner = document.createElement('hypothesis-banner');
      document.body.prepend(this._banner);
      createShadowRoot(this._banner);
    }

    render(
      <Banners>
        {this._bannerState.contentInfo && (
          <ContentInfoBanner info={this._bannerState.contentInfo} />
        )}
        {this._bannerState.noTextWarning && <WarningBanner />}
      </Banners>,
      /** @type {ShadowRoot} */ (this._banner.shadowRoot)
    );

    const bannerHeight = this._banner.getBoundingClientRect().height;

    // The `#outerContainer` element normally has height set to 100% of the body.
    //
    // Reduce this by the height of the banner so that it doesn't extend beyond
    // the bottom of the viewport.
    //
    // We don't currently handle the height of the banner changing here.
    outerContainer.style.height = `calc(100% - ${bannerHeight}px)`;
  }

  // This method (re-)anchors annotations when pages are rendered and destroyed.
  _update() {
    // A list of annotations that need to be refreshed.
    const refreshAnnotations = /** @type {AnnotationData[]} */ ([]);
    //console.trace('go here');
    const pageCount = this.pdfViewer.pagesCount;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = this.pdfViewer.getPageView(pageIndex);
      if (!page?.textLayer?.renderingDone) {
        continue;
      }

      // Detect what needs to be done by checking the rendering state.
      switch (page.renderingState) {
        case RenderingStates.INITIAL:
          // This page has been reset to its initial state so its text layer
          // is no longer valid. Null it out so that we don't process it again.
          page.textLayer = null;
          break;
        case RenderingStates.FINISHED:
          // This page is still rendered. If it has a placeholder node that
          // means the PDF anchoring module anchored annotations before it was
          // rendered. Remove this, which will cause the annotations to anchor
          // again, below.
          removePlaceholder(page.div);
          //this._createCanvas(pageIndex);
          break;
      }
    }

    // Find all the anchors that have been invalidated by page state changes.
    for (let anchor of this.annotator.anchors) {
      // Skip any we already know about.
      if (anchor.highlights) {
        if (refreshAnnotations.includes(anchor.annotation)) {
          continue;
        }

        // If the highlights are no longer in the document it means that either
        // the page was destroyed by PDF.js or the placeholder was removed above.
        // The annotations for these anchors need to be refreshed.
        for (let index = 0; index < anchor.highlights.length; index++) {
          const hl = anchor.highlights[index];
          if (!document.body.contains(hl)) {
            anchor.highlights.splice(index, 1);
            delete anchor.range;
            refreshAnnotations.push(anchor.annotation);
            break;
          }
        }
      }
    }

    refreshAnnotations.map(annotation => this.annotator.anchor(annotation));
  }

  /**
   * Return the scrollable element which contains the document content.
   *
   * @return {HTMLElement}
   */
  contentContainer() {
    return /** @type {HTMLElement} */ (
      document.querySelector('#viewerContainer')
    );
  }

  /**
   * Attempt to make the PDF viewer and the sidebar fit side-by-side without
   * overlap if there is enough room in the viewport to do so reasonably.
   * Resize the PDF viewer container element to leave the right amount of room
   * for the sidebar, and prompt PDF.js to re-render the PDF pages to scale
   * within that resized container.
   *
   * @param {SidebarLayout} sidebarLayout
   * @return {boolean} - True if side-by-side mode was activated
   */
  fitSideBySide(sidebarLayout) {
    const maximumWidthToFit = window.innerWidth - sidebarLayout.width;
    const active = sidebarLayout.expanded && maximumWidthToFit >= MIN_PDF_WIDTH;

    // If the sidebar is closed, we reserve enough space for the toolbar controls
    // so that they don't overlap a) the chevron-menu on the right side of
    // PDF.js's top toolbar and b) the document's scrollbar.
    //
    // If the sidebar is open, we reserve space for the whole sidebar if there is
    // room, otherwise we reserve the same space as in the closed state to
    // prevent the PDF content shifting when opening and closing the sidebar.
    const reservedSpace = active
      ? sidebarLayout.width
      : sidebarLayout.toolbarWidth;
    this.pdfContainer.style.width = `calc(100% - ${reservedSpace}px)`;

    // The following logic is pulled from PDF.js `webViewerResize`
    const currentScaleValue = this.pdfViewer.currentScaleValue;
    if (
      currentScaleValue === 'auto' ||
      currentScaleValue === 'page-fit' ||
      currentScaleValue === 'page-width'
    ) {
      // NB: There is logic within the setter for `currentScaleValue`
      // Setting this scale value will prompt PDF.js to recalculate viewport
      this.pdfViewer.currentScaleValue = currentScaleValue;
    }
    // This will cause PDF pages to re-render if their scaling has changed
    this.pdfViewer.update();

    return active;
  }

  /**
   * Scroll to the location of an anchor in the PDF.
   *
   * If the anchor refers to a location that is an un-rendered page far from
   * the viewport, then scrolling happens in three phases. First the document
   * scrolls to the approximate location indicated by the placeholder anchor,
   * then `scrollToAnchor` waits until the page's text layer is rendered and
   * the annotation is re-anchored in the fully rendered page. Then it scrolls
   * again to the final location.
   *
   * @param {Anchor} anchor
   */
  async scrollToAnchor(anchor) {
    const annotation = anchor.annotation;
    const inPlaceholder = anchorIsInPlaceholder(anchor);
    const offset = this._anchorOffset(anchor);
    if (offset === null) {
      return;
    }

    // nb. We only compute the scroll offset once at the start of scrolling.
    // This is important as the highlight may be removed from the document during
    // the scroll due to a page transitioning from rendered <-> un-rendered.
    await scrollElement(this.contentContainer(), offset);

    if (inPlaceholder) {
      const anchor = await this._waitForAnnotationToBeAnchored(
        annotation,
        this._reanchoringMaxWait
      );
      if (!anchor) {
        return;
      }
      const offset = this._anchorOffset(anchor);
      if (offset === null) {
        return;
      }
      await scrollElement(this.contentContainer(), offset);
    }
  }

  /**
   * Wait for an annotation to be anchored in a rendered page.
   *
   * @param {AnnotationData} annotation
   * @param {number} maxWait
   * @return {Promise<Anchor|null>}
   */
  async _waitForAnnotationToBeAnchored(annotation, maxWait) {
    const start = Date.now();
    let anchor;
    do {
      // nb. Re-anchoring might result in a different anchor object for the
      // same annotation.
      anchor = this.annotator.anchors.find(a => a.annotation === annotation);
      if (!anchor || anchorIsInPlaceholder(anchor)) {
        anchor = null;

        // If no anchor was found, wait a bit longer and check again to see if
        // re-anchoring completed.
        await delay(20);
      }
    } while (!anchor && Date.now() - start < maxWait);
    return anchor ?? null;
  }

  /**
   * Return the offset that the PDF content container would need to be scrolled
   * to, in order to make an anchor visible.
   *
   * @param {Anchor} anchor
   * @return {number|null} - Target offset or `null` if this anchor was not resolved
   */
  _anchorOffset(anchor) {
    if (!anchor.highlights) {
      // This anchor was not resolved to a location in the document.
      return null;
    }
    const highlight = anchor.highlights[0];
    return offsetRelativeTo(highlight, this.contentContainer());
  }
}
