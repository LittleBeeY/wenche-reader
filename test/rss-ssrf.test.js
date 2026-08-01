import assert from "node:assert/strict";
import test from "node:test";
import {
  createSafeLookup,
  isPrivateHostname,
  isPrivateIP,
  validateRemoteUrl
} from "../src/lib/rss/ssrfGuard.js";

test("accepts public http and https urls", () => {
  const url = validateRemoteUrl("https://example.com/feed.xml");
  assert.equal(url.hostname, "example.com");
  assert.equal(validateRemoteUrl("http://example.com").protocol, "http:");
});

test("rejects non-http protocols and credentials", () => {
  for (const value of [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "data:text/xml,<rss/>",
    "gopher://example.com",
    "https://user:pass@example.com/feed"
  ]) {
    assert.throws(() => validateRemoteUrl(value));
  }
  assert.throws(() => validateRemoteUrl("not a url at all ::"), /无效/);
});

test("rejects loopback and private hostnames", () => {
  for (const host of [
    "localhost",
    "api.localhost",
    "127.0.0.1",
    "10.0.0.5",
    "172.16.3.4",
    "192.168.1.1",
    "169.254.1.1",
    "0.0.0.0",
    "[::1]",
    "[fe80::1]",
    "[fc00::1]",
    "[::ffff:127.0.0.1]"
  ]) {
    assert.throws(() => validateRemoteUrl(`http://${host}/feed`), /内网|本机/, host);
  }
});

test("allows private hosts only with the explicit test override", () => {
  const url = validateRemoteUrl("http://127.0.0.1:9999/feed", { allowPrivateHosts: true });
  assert.equal(url.port, "9999");
});

test("classifies ipv4 and ipv6 addresses", () => {
  assert.equal(isPrivateIP("127.0.0.1"), true);
  assert.equal(isPrivateIP("10.255.255.1"), true);
  assert.equal(isPrivateIP("172.15.0.1"), false);
  assert.equal(isPrivateIP("172.31.255.1"), true);
  assert.equal(isPrivateIP("192.168.0.1"), true);
  assert.equal(isPrivateIP("100.64.0.1"), true);
  assert.equal(isPrivateIP("192.0.0.1"), true);
  assert.equal(isPrivateIP("192.0.2.1"), true);
  assert.equal(isPrivateIP("192.0.66.2"), false);
  assert.equal(isPrivateIP("224.0.0.1"), true);
  assert.equal(isPrivateIP("8.8.8.8"), false);
  assert.equal(isPrivateIP("1.1.1.1"), false);
  assert.equal(isPrivateIP("::1"), true);
  assert.equal(isPrivateIP("::"), true);
  assert.equal(isPrivateIP("fe80::1234"), true);
  assert.equal(isPrivateIP("fd12::1"), true);
  assert.equal(isPrivateIP("2606:4700:4700::1111"), false);
  assert.equal(isPrivateIP("not-an-ip"), true);
});

test("WHATWG url parsing normalizes tricky ipv4 forms before validation", () => {
  // 十进制 / 十六进制 IPv4 会被 URL 解析器规范化为点分十进制后被拦截
  assert.throws(() => validateRemoteUrl("http://2130706433/"), /内网|本机/);
  assert.throws(() => validateRemoteUrl("http://0x7f000001/"), /内网|本机/);
});

test("isPrivateHostname covers local suffixes", () => {
  assert.equal(isPrivateHostname("printer.local"), true);
  assert.equal(isPrivateHostname("service.internal"), true);
  assert.equal(isPrivateHostname("example.com"), false);
});

test("safe lookup blocks private resolutions at connection time", async () => {
  const lookup = createSafeLookup();
  await new Promise((resolve) => {
    lookup("localhost", {}, (error, address) => {
      assert.ok(error, "localhost must be blocked");
      resolve();
    });
  });
  const permissive = createSafeLookup({ allowPrivateHosts: true });
  await new Promise((resolve, reject) => {
    permissive("localhost", {}, (error, address) => {
      if (error) return reject(error);
      assert.ok(address);
      resolve();
    });
  });
});

test("safe lookup returns an address array when Node requests all results", async () => {
  const lookup = createSafeLookup();
  await new Promise((resolve, reject) => {
    lookup("8.8.8.8", { all: true }, (error, addresses) => {
      if (error) return reject(error);
      assert.ok(Array.isArray(addresses));
      assert.ok(addresses.length > 0);
      assert.ok(addresses.every((entry) => entry.address && entry.family));
      resolve();
    });
  });
});
