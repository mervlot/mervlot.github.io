var Vue = (function (exports) {
  'use strict';

  /**
   * Make a map and return a function for checking if a key
   * is in that map.
   * IMPORTANT: all calls of this function must be prefixed with
   * \/\*#\_\_PURE\_\_\*\/
   * So that rollup can tree-shake them if necessary.
   */
  function makeMap(str, expectsLowerCase) {
      const map = Object.create(null);
      const list = str.split(',');
      for (let i = 0; i < list.length; i++) {
          map[list[i]] = true;
      }
      return expectsLowerCase ? val => !!map[val.toLowerCase()] : val => !!map[val];
  }

  /**
   * dev only flag -> name mapping
   */
  const PatchFlagNames = {
      [1 /* PatchFlags.TEXT */]: `TEXT`,
      [2 /* PatchFlags.CLASS */]: `CLASS`,
      [4 /* PatchFlags.STYLE */]: `STYLE`,
      [8 /* PatchFlags.PROPS */]: `PROPS`,
      [16 /* PatchFlags.FULL_PROPS */]: `FULL_PROPS`,
      [32 /* PatchFlags.HYDRATE_EVENTS */]: `HYDRATE_EVENTS`,
      [64 /* PatchFlags.STABLE_FRAGMENT */]: `STABLE_FRAGMENT`,
      [128 /* PatchFlags.KEYED_FRAGMENT */]: `KEYED_FRAGMENT`,
      [256 /* PatchFlags.UNKEYED_FRAGMENT */]: `UNKEYED_FRAGMENT`,
      [512 /* PatchFlags.NEED_PATCH */]: `NEED_PATCH`,
      [1024 /* PatchFlags.DYNAMIC_SLOTS */]: `DYNAMIC_SLOTS`,
      [2048 /* PatchFlags.DEV_ROOT_FRAGMENT */]: `DEV_ROOT_FRAGMENT`,
      [-1 /* PatchFlags.HOISTED */]: `HOISTED`,
      [-2 /* PatchFlags.BAIL */]: `BAIL`
  };

  /**
   * Dev only
   */
  const slotFlagsText = {
      [1 /* SlotFlags.STABLE */]: 'STABLE',
      [2 /* SlotFlags.DYNAMIC */]: 'DYNAMIC',
      [3 /* SlotFlags.FORWARDED */]: 'FORWARDED'
  };

  const GLOBALS_WHITE_LISTED = 'Infinity,undefined,NaN,isFinite,isNaN,parseFloat,parseInt,decodeURI,' +
      'decodeURIComponent,encodeURI,encodeURIComponent,Math,Number,Date,Array,' +
      'Object,Boolean,String,RegExp,Map,Set,JSON,Intl,BigInt';
  const isGloballyWhitelisted = /*#__PURE__*/ makeMap(GLOBALS_WHITE_LISTED);

  const range = 2;
  function generateCodeFrame(source, start = 0, end = source.length) {
      // Split the content into individual lines but capture the newline sequence
      // that separated each line. This is important because the actual sequence is
      // needed to properly take into account the full line length for offset
      // comparison
      let lines = source.split(/(\r?\n)/);
      // Separate the lines and newline sequences into separate arrays for easier referencing
      const newlineSequences = lines.filter((_, idx) => idx % 2 === 1);
      lines = lines.filter((_, idx) => idx % 2 === 0);
      let count = 0;
      const res = [];
      for (let i = 0; i < lines.length; i++) {
          count +=
              lines[i].length +
                  ((newlineSequences[i] && newlineSequences[i].length) || 0);
          if (count >= start) {
              for (let j = i - range; j <= i + range || end > count; j++) {
                  if (j < 0 || j >= lines.length)
                      continue;
                  const line = j + 1;
                  res.push(`${line}${' '.repeat(Math.max(3 - String(line).length, 0))}|  ${lines[j]}`);
                  const lineLength = lines[j].length;
                  const newLineSeqLength = (newlineSequences[j] && newlineSequences[j].length) || 0;
                  if (j === i) {
                      // push underline
                      const pad = start - (count - (lineLength + newLineSeqLength));
                      const length = Math.max(1, end > count ? lineLength - pad : end - start);
                      res.push(`   |  ` + ' '.repeat(pad) + '^'.repeat(length));
                  }
                  else if (j > i) {
                      if (end > count) {
                          const length = Math.max(Math.min(end - count, lineLength), 1);
                          res.push(`   |  ` + '^'.repeat(length));
                      }
                      count += lineLength + newLineSeqLength;
                  }
              }
              break;
          }
      }
      return res.join('\n');
  }

  function normalizeStyle(value) {
      if (isArray(value)) {
          const res = {};
          for (let i = 0; i < value.length; i++) {
              const item = value[i];
              const normalized = isString(item)
                  ? parseStringStyle(item)
                  : normalizeStyle(item);
              if (normalized) {
                  for (const key in normalized) {
                      res[key] = normalized[key];
                  }
              }
          }
          return res;
      }
      else if (isString(value)) {
          return value;
      }
      else if (isObject(value)) {
          return value;
      }
  }
  const listDelimiterRE = /;(?![^(]*\))/g;
  const propertyDelimiterRE = /:([^]+)/;
  const styleCommentRE = /\/\*.*?\*\//gs;
  function parseStringStyle(cssText) {
      const ret = {};
      cssText
          .replace(styleCommentRE, '')
          .split(listDelimiterRE)
          .forEach(item => {
          if (item) {
              const tmp = item.split(propertyDelimiterRE);
              tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim());
          }
      });
      return ret;
  }
  function normalizeClass(value) {
      let res = '';
      if (isString(value)) {
          res = value;
      }
      else if (isArray(value)) {
          for (let i = 0; i < value.length; i++) {
              const normalized = normalizeClass(value[i]);
              if (normalized) {
                  res += normalized + ' ';
              }
          }
      }
      else if (isObject(value)) {
          for (const name in value) {
              if (value[name]) {
                  res += name + ' ';
              }
          }
      }
      return res.trim();
  }
  function normalizeProps(props) {
      if (!props)
          return null;
      let { class: klass, style } = props;
      if (klass && !isString(klass)) {
          props.class = normalizeClass(klass);
      }
      if (style) {
          props.style = normalizeStyle(style);
      }
      return props;
  }

  // These tag configs are shared between compiler-dom and runtime-dom, so they
  // https://developer.mozilla.org/en-US/docs/Web/HTML/Element
  const HTML_TAGS = 'html,body,base,head,link,meta,style,title,address,article,aside,footer,' +
      'header,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,' +
      'figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,' +
      'data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,' +
      'time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,' +
      'canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,' +
      'th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,' +
      'option,output,progress,select,textarea,details,dialog,menu,' +
      'summary,template,blockquote,iframe,tfoot';
  // https://developer.mozilla.org/en-US/docs/Web/SVG/Element
  const SVG_TAGS = 'svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,' +
      'defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,' +
      'feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,' +
      'feDistanceLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,' +
      'feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,' +
      'fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,' +
      'foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,' +
      'mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,' +
      'polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,' +
      'text,textPath,title,tspan,unknown,use,view';
  const VOID_TAGS = 'area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr';
  /**
   * Compiler only.
   * Do NOT use in runtime code paths unless behind `true` flag.
   */
  const isHTMLTag = /*#__PURE__*/ makeMap(HTML_TAGS);
  /**
   * Compiler only.
   * Do NOT use in runtime code paths unless behind `true` flag.
   */
  const isSVGTag = /*#__PURE__*/ makeMap(SVG_TAGS);
  /**
   * Compiler only.
   * Do NOT use in runtime code paths unless behind `true` flag.
   */
  const isVoidTag = /*#__PURE__*/ makeMap(VOID_TAGS);

  /**
   * On the client we only need to offer special cases for boolean attributes that
   * have different names from their corresponding dom properties:
   * - itemscope -> N/A
   * - allowfullscreen -> allowFullscreen
   * - formnovalidate -> formNoValidate
   * - ismap -> isMap
   * - nomodule -> noModule
   * - novalidate -> noValidate
   * - readonly -> readOnly
   */
  const specialBooleanAttrs = `itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly`;
  const isSpecialBooleanAttr = /*#__PURE__*/ makeMap(specialBooleanAttrs);
  /**
   * Boolean attributes should be included if the value is truthy or ''.
   * e.g. `<select multiple>` compiles to `{ multiple: '' }`
   */
  function includeBooleanAttr(value) {
      return !!value || value === '';
  }

  function looseCompareArrays(a, b) {
      if (a.length !== b.length)
          return false;
      let equal = true;
      for (let i = 0; equal && i < a.length; i++) {
          equal = looseEqual(a[i], b[i]);
      }
      return equal;
  }
  function looseEqual(a, b) {
      if (a === b)
          return true;
      let aValidType = isDate(a);
      let bValidType = isDate(b);
      if (aValidType || bValidType) {
          return aValidType && bValidType ? a.getTime() === b.getTime() : false;
      }
      aValidType = isSymbol(a);
      bValidType = isSymbol(b);
      if (aValidType || bValidType) {
          return a === b;
      }
      aValidType = isArray(a);
      bValidType = isArray(b);
      if (aValidType || bValidType) {
          return aValidType && bValidType ? looseCompareArrays(a, b) : false;
      }
      aValidType = isObject(a);
      bValidType = isObject(b);
      if (aValidType || bValidType) {
          /* istanbul ignore if: this if will probably never be called */
          if (!aValidType || !bValidType) {
              return false;
          }
          const aKeysCount = Object.keys(a).length;
          const bKeysCount = Object.keys(b).length;
          if (aKeysCount !== bKeysCount) {
              return false;
          }
          for (const key in a) {
              const aHasKey = a.hasOwnProperty(key);
              const bHasKey = b.hasOwnProperty(key);
              if ((aHasKey && !bHasKey) ||
                  (!aHasKey && bHasKey) ||
                  !looseEqual(a[key], b[key])) {
                  return false;
              }
          }
      }
      return String(a) === String(b);
  }
  function looseIndexOf(arr, val) {
      return arr.findIndex(item => looseEqual(item, val));
  }

  /**
   * For converting {{ interpolation }} values to displayed strings.
   * @private
   */
  const toDisplayString = (val) => {
      return isString(val)
          ? val
          : val == null
              ? ''
              : isArray(val) ||
                  (isObject(val) &&
                      (val.toString === objectToString || !isFunction(val.toString)))
                  ? JSON.stringify(val, replacer, 2)
                  : String(val);
  };
  const replacer = (_key, val) => {
      // can't use isRef here since @vue/shared has no deps
      if (val && val.__v_isRef) {
          return replacer(_key, val.value);
      }
      else if (isMap(val)) {
          return {
              [`Map(${val.size})`]: [...val.entries()].reduce((entries, [key, val]) => {
                  entries[`${key} =>`] = val;
                  return entries;
              }, {})
          };
      }
      else if (isSet(val)) {
          return {
              [`Set(${val.size})`]: [...val.values()]
          };
      }
      else if (isObject(val) && !isArray(val) && !isPlainObject(val)) {
          return String(val);
      }
      return val;
  };

  const EMPTY_OBJ = Object.freeze({})
      ;
  const EMPTY_ARR = Object.freeze([]) ;
  const NOOP = () => { };
  /**
   * Always return false.
   */
  const NO = () => false;
  const onRE = /^on[^a-z]/;
  const isOn = (key) => onRE.test(key);
  const isModelListener = (key) => key.startsWith('onUpdate:');
  const extend = Object.assign;
  const remove = (arr, el) => {
      const i = arr.indexOf(el);
      if (i > -1) {
          arr.splice(i, 1);
      }
  };
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  const hasOwn = (val, key) => hasOwnProperty.call(val, key);
  const isArray = Array.isArray;
  const isMap = (val) => toTypeString(val) === '[object Map]';
  const isSet = (val) => toTypeString(val) === '[object Set]';
  const isDate = (val) => toTypeString(val) === '[object Date]';
  const isFunction = (val) => typeof val === 'function';
  const isString = (val) => typeof val === 'string';
  const isSymbol = (val) => typeof val === 'symbol';
  const isObject = (val) => val !== null && typeof val === 'object';
  const isPromise = (val) => {
      return isObject(val) && isFunction(val.then) && isFunction(val.catch);
  };
  const objectToString = Object.prototype.toString;
  const toTypeString = (value) => objectToString.call(value);
  const toRawType = (value) => {
      // extract "RawType" from strings like "[object RawType]"
      return toTypeString(value).slice(8, -1);
  };
  const isPlainObject = (val) => toTypeString(val) === '[object Object]';
  const isIntegerKey = (key) => isString(key) &&
      key !== 'NaN' &&
      key[0] !== '-' &&
      '' + parseInt(key, 10) === key;
  const isReservedProp = /*#__PURE__*/ makeMap(
  // the leading comma is intentional so empty string "" is also included
  ',key,ref,ref_for,ref_key,' +
      'onVnodeBeforeMount,onVnodeMounted,' +
      'onVnodeBeforeUpdate,onVnodeUpdated,' +
      'onVnodeBeforeUnmount,onVnodeUnmounted');
  const isBuiltInDirective = /*#__PURE__*/ makeMap('bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo');
  const cacheStringFunction = (fn) => {
      const cache = Object.create(null);
      return ((str) => {
          const hit = cache[str];
          return hit || (cache[str] = fn(str));
      });
  };
  const camelizeRE = /-(\w)/g;
  /**
   * @private
   */
  const camelize = cacheStringFunction((str) => {
      return str.replace(camelizeRE, (_, c) => (c ? c.toUpperCase() : ''));
  });
  const hyphenateRE = /\B([A-Z])/g;
  /**
   * @private
   */
  const hyphenate = cacheStringFunction((str) => str.replace(hyphenateRE, '-$1').toLowerCase());
  /**
   * @private
   */
  const capitalize = cacheStringFunction((str) => str.charAt(0).toUpperCase() + str.slice(1));
  /**
   * @private
   */
  const toHandlerKey = cacheStringFunction((str) => str ? `on${capitalize(str)}` : ``);
  // compare whether a value has changed, accounting for NaN.
  const hasChanged = (value, oldValue) => !Object.is(value, oldValue);
  const invokeArrayFns = (fns, arg) => {
      for (let i = 0; i < fns.length; i++) {
          fns[i](arg);
      }
  };
  const def = (obj, key, value) => {
      Object.defineProperty(obj, key, {
          configurable: true,
          enumerable: false,
          value
      });
  };
  const toNumber = (val) => {
      const n = parseFloat(val);
      return isNaN(n) ? val : n;
  };
  let _globalThis;
  const getGlobalThis = () => {
      return (_globalThis ||
          (_globalThis =
              typeof globalThis !== 'undefined'
                  ? globalThis
                  : typeof self !== 'undefined'
                      ? self
                      : typeof window !== 'undefined'
                          ? window
                          : typeof global !== 'undefined'
                              ? global
                              : {}));
  };

  function warn(msg, ...args) {
      console.warn(`[Vue warn] ${msg}`, ...args);
  }

  let activeEffectScope;
  class EffectScope {
      constructor(detached = false) {
          this.detached = detached;
          /**
           * @internal
           */
          this.active = true;
          /**
           * @internal
           */
          this.effects = [];
          /**
           * @internal
           */
          this.cleanups = [];
          this.parent = activeEffectScope;
          if (!detached && activeEffectScope) {
              this.index =
                  (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(this) - 1;
          }
      }
      run(fn) {
          if (this.active) {
              const currentEffectScope = activeEffectScope;
              try {
                  activeEffectScope = this;
                  return fn();
              }
              finally {
                  activeEffectScope = currentEffectScope;
              }
          }
          else {
              warn(`cannot run an inactive effect scope.`);
          }
      }
      /**
       * This should only be called on non-detached scopes
       * @internal
       */
      on() {
          activeEffectScope = this;
      }
      /**
       * This should only be called on non-detached scopes
       * @internal
       */
      off() {
          activeEffectScope = this.parent;
      }
      stop(fromParent) {
          if (this.active) {
              let i, l;
              for (i = 0, l = this.effects.length; i < l; i++) {
                  this.effects[i].stop();
              }
              for (i = 0, l = this.cleanups.length; i < l; i++) {
                  this.cleanups[i]();
              }
              if (this.scopes) {
                  for (i = 0, l = this.scopes.length; i < l; i++) {
                      this.scopes[i].stop(true);
                  }
              }
              // nested scope, dereference from parent to avoid memory leaks
              if (!this.detached && this.parent && !fromParent) {
                  // optimized O(1) removal
                  const last = this.parent.scopes.pop();
                  if (last && last !== this) {
                      this.parent.scopes[this.index] = last;
                      last.index = this.index;
                  }
              }
              this.parent = undefined;
              this.active = false;
          }
      }
  }
  function effectScope(detached) {
      return new EffectScope(detached);
  }
  function recordEffectScope(effect, scope = activeEffectScope) {
      if (scope && scope.active) {
          scope.effects.push(effect);
      }
  }
  function getCurrentScope() {
      return activeEffectScope;
  }
  function onScopeDispose(fn) {
      if (activeEffectScope) {
          activeEffectScope.cleanups.push(fn);
      }
      else {
          warn(`onScopeDispose() is called when there is no active effect scope` +
              ` to be associated with.`);
      }
  }

  const createDep = (effects) => {
      const dep = new Set(effects);
      dep.w = 0;
      dep.n = 0;
      return dep;
  };
  const wasTracked = (dep) => (dep.w & trackOpBit) > 0;
  const newTracked = (dep) => (dep.n & trackOpBit) > 0;
  const initDepMarkers = ({ deps }) => {
      if (deps.length) {
          for (let i = 0; i < deps.length; i++) {
              deps[i].w |= trackOpBit; // set was tracked
          }
      }
  };
  const finalizeDepMarkers = (effect) => {
      const { deps } = effect;
      if (deps.length) {
          let ptr = 0;
          for (let i = 0; i < deps.length; i++) {
              const dep = deps[i];
         