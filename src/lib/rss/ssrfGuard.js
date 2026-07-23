import dns from "node:dns";
import net from "node:net";

/**
 * 校验用户提供的 Feed / 网页地址，防止服务端请求本机与内网资源。
 * 与自定义 lookup 配合可在连接层阻止 DNS 重绑定。
 */

export function validateRemoteUrl(value, { allowPrivateHosts = false } = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new SsrfError("地址格式无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("仅支持 http 或 https 地址");
  }
  if (url.username || url.password) {
    throw new SsrfError("地址不允许包含用户名或密码");
  }
  if (!url.hostname) {
    throw new SsrfError("地址缺少主机名");
  }
  if (!allowPrivateHosts && isPrivateHostname(url.hostname)) {
    throw new SsrfError("该地址指向本机或内网，已被安全策略拦截");
  }
  return url;
}

export function isPrivateHostname(hostname) {
  const host = String(hostname || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return isPrivateIPv4(host);
  if (ipVersion === 6) return isPrivateIPv6(host);
  return false;
}

export function isPrivateIP(address) {
  const ip = String(address || "").trim().replace(/^\[|\]$/g, "");
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  // 非法地址一律视为不可信
  return true;
}

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 本网络
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // 回环
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IANA 保留
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 基准测试网段
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // 组播与保留段
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  // IPv4-mapped IPv6：::ffff:127.0.0.1（点分形式）
  const mappedDotted = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
  // IPv4-mapped IPv6：::ffff:7f00:1（URL 规范化后的十六进制形式）
  const mappedHex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (normalized === "::" || normalized === "::1") return true;
  const firstSegment = normalized.split(":")[0] || "0";
  const first = parseInt(firstSegment, 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 组播
  if (first === 0x2001 && normalized.startsWith("2001:db8")) return true; // 文档保留
  return false;
}

/**
 * 返回一个可供 http(s).request 使用的 lookup 函数，
 * 在 DNS 解析层过滤私有地址，连接只能落到公网 IP，从而抵御 DNS 重绑定。
 */
export function createSafeLookup({ allowPrivateHosts = false } = {}) {
  return function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, null, null);
      if (allowPrivateHosts) {
        const first = addresses[0];
        return callback(null, first.address, first.family);
      }
      const safe = addresses.filter((entry) => !isPrivateIP(entry.address));
      if (safe.length === 0) {
        return callback(new SsrfError("该地址解析到本机或内网，已被安全策略拦截"), null, null);
      }
      const first = safe[0];
      return callback(null, first.address, first.family);
    });
  };
}

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = "SsrfError";
    this.statusCode = 400;
  }
}
