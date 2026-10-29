// Reads the Lua files WoW writes for SavedVariables: a list of global
// assignments (`Name = <value>`), where values are tables, strings, numbers,
// booleans or nil. It is not a Lua interpreter: no expressions, calls or
// variables, which saved files never contain.
//
// Tables come back as JS arrays when every key is 1..n (holes become null),
// otherwise as plain objects keyed by string (numeric keys as their decimal
// text). Saved journeys can be tens of MB, so this is a single pass over the
// text with no regex per token.

export type LuaValue = string | number | boolean | null | LuaValue[] | LuaObject;
export interface LuaObject {
  [key: string]: LuaValue;
}

export class LuaParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
  }
}

const SPACE = 32, TAB = 9, CR = 13, LF = 10;
const DASH = 45, QUOTE = 34, APOS = 39, LBRACKET = 91, RBRACKET = 93;
const LBRACE = 123, RBRACE = 125, COMMA = 44, SEMI = 59, EQUALS = 61, BACKSLASH = 92;

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}
function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57);
}

class Reader {
  pos = 0;
  constructor(readonly src: string) {}

  line(): number {
    let n = 1;
    for (let i = 0; i < this.pos && i < this.src.length; i++) if (this.src.charCodeAt(i) === LF) n++;
    return n;
  }

  fail(message: string): never {
    throw new LuaParseError(message, this.line());
  }

  // Skips whitespace and comments.
  skip(): void {
    const s = this.src;
    for (;;) {
      const c = s.charCodeAt(this.pos);
      if (c === SPACE || c === TAB || c === CR || c === LF) {
        this.pos++;
      } else if (c === DASH && s.charCodeAt(this.pos + 1) === DASH) {
        this.pos += 2;
        const level = this.longBracket();
        if (level >= 0) {
          this.longString(level);
        } else {
          const end = s.indexOf("\n", this.pos);
          this.pos = end < 0 ? s.length : end + 1;
        }
      } else if (c === 0xfeff) {
        this.pos++; // byte order mark
      } else {
        return;
      }
    }
  }

  // At "[[" or "[==[" returns the level and moves past it, else -1.
  longBracket(): number {
    const s = this.src;
    if (s.charCodeAt(this.pos) !== LBRACKET) return -1;
    let i = this.pos + 1;
    let level = 0;
    while (s.charCodeAt(i) === EQUALS) {
      level++;
      i++;
    }
    if (s.charCodeAt(i) !== LBRACKET) return -1;
    this.pos = i + 1;
    return level;
  }

  longString(level: number): string {
    const close = "]" + "=".repeat(level) + "]";
    const end = this.src.indexOf(close, this.pos);
    if (end < 0) this.fail("unfinished long string");
    let text = this.src.slice(this.pos, end);
    if (text.startsWith("\r\n")) text = text.slice(2);
    else if (text.startsWith("\n")) text = text.slice(1);
    this.pos = end + close.length;
    return text;
  }

  ident(): string {
    const s = this.src;
    const start = this.pos;
    while (isIdentPart(s.charCodeAt(this.pos))) this.pos++;
    return s.slice(start, this.pos);
  }

  quoted(): string {
    const s = this.src;
    const q = s.charCodeAt(this.pos++);
    let out = "";
    let start = this.pos;
    for (;;) {
      const c = s.charCodeAt(this.pos);
      if (Number.isNaN(c)) this.fail("unfinished string");
      if (c === q) {
        out += s.slice(start, this.pos);
        this.pos++;
        return out;
      }
      if (c === LF) this.fail("line break in string");
      if (c !== BACKSLASH) {
        this.pos++;
        continue;
      }
      out += s.slice(start, this.pos);
      this.pos++;
      const e = s[this.pos];
      this.pos++;
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "a": out += "\x07"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "v": out += "\v"; break;
        case "\\": out += "\\"; break;
        case '"': out += '"'; break;
        case "'": out += "'"; break;
        case "\n": out += "\n"; break;
        case "\r":
          out += "\n";
          if (s[this.pos] === "\n") this.pos++;
          break;
        case "x": {
          const hex = s.slice(this.pos, this.pos + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.fail("bad \\x escape");
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 2;
          break;
        }
        case "z":
          while (/\s/.test(s[this.pos] ?? "")) this.pos++;
          break;
        default: {
          if (e !== undefined && e >= "0" && e <= "9") {
            let digits = e;
            while (digits.length < 3 && s[this.pos] >= "0" && s[this.pos] <= "9") digits += s[this.pos++];
            out += String.fromCharCode(Number(digits));
          } else {
            this.fail(`bad escape \\${e ?? ""}`);
          }
        }
      }
      start = this.pos;
    }
  }

  number(): number {
    const s = this.src;
    const start = this.pos;
    if (s[this.pos] === "-" || s[this.pos] === "+") this.pos++;
    if (s[this.pos] === "0" && (s[this.pos + 1] === "x" || s[this.pos + 1] === "X")) {
      this.pos += 2;
      while (/[0-9a-fA-F]/.test(s[this.pos] ?? "")) this.pos++;
      const v = parseInt(s.slice(start, this.pos).replace("0x", "").replace("0X", ""), 16);
      return s[start] === "-" ? -Math.abs(v) : v;
    }
    while (this.pos < s.length) {
      const c = s[this.pos];
      if ((c >= "0" && c <= "9") || c === "." || c === "e" || c === "E") {
        this.pos++;
      } else if ((c === "-" || c === "+") && (s[this.pos - 1] === "e" || s[this.pos - 1] === "E")) {
        this.pos++;
      } else {
        break;
      }
    }
    const text = s.slice(start, this.pos);
    // WoW writes infinities and NaN the way the C runtime prints them.
    if (s.startsWith("#INF", this.pos) || s.startsWith("#IND", this.pos) || s.startsWith("#QNAN", this.pos)) {
      while (/[#A-Z0-9]/.test(s[this.pos] ?? "")) this.pos++;
      return text.startsWith("-") ? -Infinity : Infinity;
    }
    const v = Number(text);
    if (text === "" || Number.isNaN(v)) this.fail(`bad number "${text}"`);
    return v;
  }

  value(): LuaValue {
    this.skip();
    const s = this.src;
    const c = s.charCodeAt(this.pos);
    if (c === LBRACE) return this.table();
    if (c === QUOTE || c === APOS) return this.quoted();
    if (c === LBRACKET) {
      const level = this.longBracket();
      if (level >= 0) return this.longString(level);
    }
    if ((c >= 48 && c <= 57) || c === DASH || c === 43 || c === 46) return this.number();
    if (isIdentStart(c)) {
      const word = this.ident();
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "nil") return null;
      if (word === "inf") return Infinity;
      if (word === "nan") return NaN;
      if (word === "math") {
        if (s.startsWith(".huge", this.pos)) {
          this.pos += 5;
          return Infinity;
        }
      }
      this.fail(`unexpected "${word}"`);
    }
    this.fail(`unexpected "${s[this.pos] ?? "end of file"}"`);
  }

  table(): LuaValue[] | LuaObject {
    const s = this.src;
    this.pos++; // {
    const positional: LuaValue[] = [];
    let keyed: Map<string | number, LuaValue> | null = null;
    for (;;) {
      this.skip();
      const c = s.charCodeAt(this.pos);
      if (c === RBRACE) {
        this.pos++;
        break;
      }
      let key: string | number | undefined;
      if (c === LBRACKET && this.longBracketAhead() < 0) {
        this.pos++;
        const k = this.value();
        this.skip();
        if (s.charCodeAt(this.pos) !== RBRACKET) this.fail('expected "]"');
        this.pos++;
        this.skip();
        if (s.charCodeAt(this.pos) !== EQUALS) this.fail('expected "="');
        this.pos++;
        if (typeof k === "string" || typeof k === "number") key = k;
        else if (typeof k === "boolean") key = String(k);
        else this.fail("unsupported table key");
      } else if (isIdentStart(c)) {
        const save = this.pos;
        const word = this.ident();
        this.skip();
        if (s.charCodeAt(this.pos) === EQUALS && s.charCodeAt(this.pos + 1) !== EQUALS) {
          this.pos++;
          key = word;
        } else {
          this.pos = save;
        }
      }
      const v = this.value();
      if (key === undefined) {
        positional.push(v);
      } else {
        keyed ??= new Map();
        keyed.set(key, v);
      }
      this.skip();
      const sep = s.charCodeAt(this.pos);
      if (sep === COMMA || sep === SEMI) {
        this.pos++;
      } else if (sep !== RBRACE) {
        this.fail('expected "," or "}"');
      }
    }
    return build(positional, keyed);
  }

  longBracketAhead(): number {
    const save = this.pos;
    const level = this.longBracket();
    this.pos = save;
    return level;
  }
}

function build(positional: LuaValue[], keyed: Map<string | number, LuaValue> | null): LuaValue[] | LuaObject {
  if (!keyed) return trimNils(positional);
  // Integer keys that continue the positional run make it an array.
  let allInts = true;
  let max = positional.length;
  for (const k of keyed.keys()) {
    if (typeof k === "number" && Number.isInteger(k) && k >= 1) {
      if (k > max) max = k;
    } else {
      allInts = false;
      break;
    }
  }
  if (allInts && max <= Math.max(16, (positional.length + keyed.size) * 2)) {
    const arr: LuaValue[] = new Array(max).fill(null);
    positional.forEach((v, i) => (arr[i] = v));
    for (const [k, v] of keyed) arr[(k as number) - 1] = v;
    return trimNils(arr);
  }
  const obj: LuaObject = {};
  positional.forEach((v, i) => {
    if (v !== null) obj[String(i + 1)] = v;
  });
  for (const [k, v] of keyed) {
    if (v !== null) obj[String(k)] = v;
  }
  return obj;
}

function trimNils(arr: LuaValue[]): LuaValue[] {
  let n = arr.length;
  while (n > 0 && arr[n - 1] === null) n--;
  if (n !== arr.length) arr.length = n;
  return arr;
}

// Reads every global a saved file assigns: { RoadToSixtyCharDB: {...}, ... }.
export function parseSavedVariables(src: string): Record<string, LuaValue> {
  const r = new Reader(src);
  const out: Record<string, LuaValue> = {};
  for (;;) {
    r.skip();
    if (r.pos >= src.length) return out;
    if (!isIdentStart(src.charCodeAt(r.pos))) r.fail("expected a variable name");
    const name = r.ident();
    r.skip();
    if (src.charCodeAt(r.pos) !== EQUALS) r.fail('expected "="');
    r.pos++;
    out[name] = r.value();
    r.skip();
    if (src.charCodeAt(r.pos) === SEMI) r.pos++;
  }
}

// Helpers for walking parsed values without trusting their shape.

export function isObj(v: unknown): v is LuaObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A table's 1..n entries, whether it came back as an array or an object.
export function list(v: unknown): LuaValue[] {
  if (Array.isArray(v)) return v;
  if (!isObj(v)) return [];
  const out: LuaValue[] = [];
  for (let i = 1; String(i) in v; i++) out.push(v[String(i)]);
  return out;
}

// A table's key/value pairs, arrays keyed by their 1-based index.
export function entries(v: unknown): [string, LuaValue][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i + 1), x] as [string, LuaValue]).filter(([, x]) => x !== null);
  if (isObj(v)) return Object.entries(v);
  return [];
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function field(v: unknown, key: string): LuaValue | undefined {
  if (isObj(v)) return v[key];
  if (Array.isArray(v) && /^\d+$/.test(key)) return v[Number(key) - 1];
  return undefined;
}
