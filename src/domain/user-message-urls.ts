export interface UserTextPart { start: number; text: string; link: boolean }

function publicIPv4([first, second, third]: number[]): boolean {
  return first !== 0 && first !== 10 && first !== 127 && first < 224 &&
    !(first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 ||
      first === 192 && (second === 0 || second === 168) || first === 100 && second >= 64 && second <= 127 ||
      first === 198 && (second === 18 || second === 19 || second === 51 && third === 100) ||
      first === 203 && second === 0 && third === 113);
}

function publicWebUrl(raw: string): boolean {
  if (raw.length > 8192 || new TextEncoder().encode(raw).length > 8192 || raw.includes("\\")) return false;
  const authority = raw.slice(raw.indexOf("://") + 3).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return false;
  try {
    const host = new URL(raw).hostname.replace(/\.$/, "");
    if (host.startsWith("[")) {
      const address = host.slice(1, -1);
      const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(address);
      if (mapped) {
        const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
        return publicIPv4([high >> 8, high & 255, low >> 8, low & 255]);
      }
      return /^[23][\da-f]{3}:/.test(address) && !address.startsWith("2001:db8:");
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return publicIPv4(host.split(".").map(Number));
    return host.includes(".") && host.length <= 253 && host.split(".").every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) &&
      !/(?:^|\.)(?:localhost|local|localdomain|internal|lan|home\.arpa|test|invalid|example|onion)$/.test(host);
  } catch { return false; }
}

export function userMessageUrlParts(source: string): UserTextPart[] {
  const parts: UserTextPart[] = [];
  const scheme = /https?:\/\//gi;
  let consumed = 0, match: RegExpExecArray | null;
  while ((match = scheme.exec(source)) !== null) {
    const start = match.index;
    if (start && /[a-z\d._+/@%#-]/i.test(source[start - 1]!)) continue;
    let end = scheme.lastIndex, parentheses = 0, brackets = 0;
    while (end < source.length) {
      const character = source[end]!, code = source.charCodeAt(end);
      if (code < 32 || (code >= 127 && code <= 159) || /[\s<>"`，。！？；：、…（）【】《》“”‘’]/u.test(character)) break;
      if (character === "(") parentheses++;
      if (character === ")" && parentheses-- === 0) break;
      if (character === "[") brackets++;
      if (character === "]" && brackets-- === 0) break;
      end++;
    }
    scheme.lastIndex = end;
    let linkEnd = end;
    while (linkEnd > start && ".,;:!?'".includes(source[linkEnd - 1]!)) linkEnd--;
    const url = source.slice(start, linkEnd);
    if (!publicWebUrl(url)) continue;
    if (start > consumed) parts.push({ start: consumed, text: source.slice(consumed, start), link: false });
    parts.push({ start, text: url, link: true });
    consumed = start + url.length;
  }
  if (consumed < source.length) parts.push({ start: consumed, text: source.slice(consumed), link: false });
  return parts;
}
