import { shadow } from "./utils";

/**
 * 
 * @param {string} color -
 * @returns {number[]}
 */
export function getRGB(color) {
    if (color.startsWith("#")) {
      const colorRGB = parseInt(color.slice(1), 16);
      return [
        (colorRGB & 0xff0000) >> 16,
        (colorRGB & 0x00ff00) >> 8,
        colorRGB & 0x0000ff,
      ];
    }
  
    if (color.startsWith("rgb(")) {
      // getComputedStyle(...).color returns a `rgb(R, G, B)` color.
      return color
        .slice(/* "rgb(".length */ 4, -1) // Strip out "rgb(" and ")".
        .split(",")
        .map(x => parseInt(x));
    }
  
    console.warn(`Not a valid color format: "${color}"`);
    return [0, 0, 0];
  }

/**
 * 
 * @param {any} colors 
 */
export function getColorValues(colors) {
    const span = document.createElement("span");
    span.style.visibility = "hidden";
    document.body.append(span);
    for (const name of colors.keys()) {
      span.style.color = name;
      const computedColor = window.getComputedStyle(span).color;
      colors.set(name, getRGB(computedColor));
    }
    span.remove();
  }
  
  const hexNumbers = [...Array(256).keys()].map(n =>
    n.toString(16).padStart(2, "0")
  );

export class ColorManager {
  
    static _colorsMapping = new Map([
      ["CanvasText", [0, 0, 0]],
      ["Canvas", [255, 255, 255]],
    ]);
    
  /**
   * 
   * @param {number} r 
   * @param {number} g 
   * @param {number} b 
   * @returns {string}
   */
    static makeHexColor(r, g, b) {
      return `#${hexNumbers[r]}${hexNumbers[g]}${hexNumbers[b]}`;
    }
  
    get _colors() {
      const colors = new Map([
        ["CanvasText", null],
        ["Canvas", null],
      ]);
      getColorValues(colors);
      return shadow(this, "_colors", colors);
    }
  
    /**
     * In High Contrast Mode, the color on the screen is not always the
     * real color used in the pdf.
     * For example in some cases white can appear to be black but when saving
     * we want to have white.
     * @param {string} color
     * @returns {Array<number>}
     */
    convert(color) {
      const rgb = getRGB(color);
      if (!window.matchMedia("(forced-colors: active)").matches) {
        return rgb;
      }
  
      for (const [name, RGB] of this._colors) {
        // @ts-ignore
        if (RGB.every((x, i) => x === rgb[i])) {
          // @ts-ignore
          return ColorManager._colorsMapping.get(name);
        }
      }
      return rgb;
    }
  
    /**
     * An input element must have its color value as a hex string
     * and not as color name.
     * So this function converts a name into an hex string.
     * @param {string} name
     * @returns {string}
     */
    getHexCode(name) {
      const rgb = this._colors.get(name);
      if (!rgb) {
        return name;
      }
      // @ts-ignore
      return ColorManager.makeHexColor(...rgb);
    }
  }