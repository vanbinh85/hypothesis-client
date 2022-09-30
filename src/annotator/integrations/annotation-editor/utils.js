/**
 * 
 * @param {Object} obj 
 * @param {PropertyKey} prop 
 * @param {any} value 
 * @returns any
 */
export function shadow(obj, prop, value) {
    Object.defineProperty(obj, prop, {
      value,
      enumerable: true,
      configurable: true,
      writable: false,
    });
    return value;
  }
  