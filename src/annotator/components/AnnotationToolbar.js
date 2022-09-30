import { IconButton } from '@hypothesis/frontend-shared';
import classnames from 'classnames';

/**
 * @typedef {import("@hypothesis/frontend-shared/lib/components/buttons").IconButtonProps} IconButtonProps
 *
 * @typedef {Omit<IconButtonProps, "className">} ToolbarButtonProps
 * @typedef {import('../../types/annotator').AnnotationType} AnnotationType
 */

/**
 * @typedef AnnotationProps
 * @property {(mode: AnnotationType) => void} onSwitchAnnotationEditorMode
 */

/**
 * Style an IconButton for use on the SecondaryToolbar
 *
 * @param {ToolbarButtonProps} props
 */
function ToolbarButton({ ...buttonProps }) {
  const { icon, title, ...restProps } = buttonProps;
  return (
    <IconButton
      className={classnames(
        'w-[30px] h-[30px]', // These buttons have precise dimensions
        'rounded-px', // size of border radius in absolute units
        'flex items-center justify-center',
        'border bg-white text-grey-6 hover:text-grey-9',
        'shadow transition-colors'
      )}
      icon={icon}
      title={title}
      {...restProps}
    />
  );
}

/**
 * 
 * @param {AnnotationProps} props 
 * @returns 
 */
export default function AnnotationToolbar({ onSwitchAnnotationEditorMode }) {
  /** @type {AnnotationType} */
  let currentMode = 'disabled';
  /**
   * 
   * @param {Event} event 
   */
  function onModeChange(event) {
    /** @type {AnnotationType} */
    // @ts-ignore
    const mode = event.target.dataset.editorMode;
    if (currentMode === mode) {
      return;
    }
    currentMode = mode;
    onSwitchAnnotationEditorMode(mode);
  }
  return (
    <div>
      <button data-editor-mode="disabled" onClick={onModeChange}>Hand tool</button>
      <button data-editor-mode="rectangle" onClick={onModeChange}>Rectangle</button>
    </div>
  );
}