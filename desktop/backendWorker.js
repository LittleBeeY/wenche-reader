import { randomUUID } from "node:crypto";

installDomPolyfills();

const parentPort = process.parentPort;
let store = null;
let runtime = null;
let bootstrapped = false;

parentPort.on("message", async (event) => {
  const message = event.data;
  if (!message || typeof message.type !== "string") return;
  if (message.type === "bootstrap") {
    if (bootstrapped) return;
    bootstrapped = true;
    const { startRuntime } = await import("../src/runtime.js");
    await startBackend(message, startRuntime);
  } else if (message.type === "settings-write-result") {
    store?.resolveWrite(
      message.requestId,
      message.ok === true,
      message.config,
      message.errorCode
    );
  } else if (message.type === "settings-apply") {
    store?.setSnapshot(message.config);
    parentPort.postMessage({ type: "settings-applied" });
  } else if (message.type === "relocate-prepare") {
    await relocatePrepare(message);
  } else if (message.type === "shutdown-request") {
    await shutdownBackend();
  }
});

async function relocatePrepare({ oldUploads, newUploads }) {
  try {
    const result = runtime.storage.relocateUploads(oldUploads, newUploads);
    parentPort.postMessage({
      type: "relocate-prepared",
      rewritten: result.rewritten
    });
  } catch (error) {
    parentPort.postMessage({
      type: "relocate-failed",
      errorCode: "relocate-rewrite-failed"
    });
  }
}

/**
 * Electron utility process 入口：唯一持有 SQLite 的后端进程。
 * bootstrap 之前不启动任何服务；路径全部由 main 构造。
 */
class IpcAiSettingsStore {
  constructor({ send }) {
    this.send = send;
    this.snapshot = { provider: "mock", apiKey: "", baseUrl: "", model: "" };
    this.pending = new Map();
  }

  setSnapshot(config) {
    this.snapshot = { ...this.snapshot, ...(config || {}) };
  }

  async read() {
    return { ...this.snapshot };
  }

  async write(config) {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("settings-write-timeout"));
      }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({ type: "settings-write", requestId, config });
    });
  }

  resolveWrite(requestId, ok, config, errorCode) {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    if (ok && config) {
      this.snapshot = { ...this.snapshot, ...config };
      entry.resolve({ ...config });
    } else {
      entry.reject(new Error(errorCode || "settings-write-failed"));
    }
  }
}

async function startBackend(bootstrap, startRuntime) {
  try {
    store = new IpcAiSettingsStore({
      send: (message) => parentPort.postMessage(message)
    });
    store.setSnapshot(bootstrap.initialAiConfig);
    runtime = await startRuntime({
      host: "127.0.0.1",
      port: 0,
      dataDir: bootstrap.dataDir,
      uploadDir: bootstrap.uploadDir,
      rssImageCacheDir: bootstrap.rssImageCacheDir,
      staticRoot: bootstrap.staticRoot,
      desktopSessionToken: bootstrap.desktopSessionToken,
      settingsStore: store
    });
    parentPort.postMessage({
      type: "backend-ready",
      host: "127.0.0.1",
      port: runtime.port
    });
  } catch (error) {
    parentPort.postMessage({
      type: "backend-start-error",
      code: stableStartError(error)
    });
    process.exit(1);
  }
}

async function shutdownBackend() {
  let exitCode = 0;
  try {
    if (runtime) await runtime.close();
  } catch {
    exitCode = 1;
  }
  parentPort.postMessage({ type: "shutdown-complete" });
  process.exit(exitCode);
}

function stableStartError(error) {
  if (error?.code === "EADDRINUSE") return "port-in-use";
  if (String(error?.message || "").includes("SQLITE")) return "sqlite-open-failed";
  return "runtime-start-failed";
}

/**
 * Electron utility process 无法加载为 Node ABI 编译的 @napi-rs/canvas，
 * pdfjs-dist 因而拿不到其 DOMMatrix 垫片。这里提供一个最小 2D 实现，
 * 让 PDF 文本提取可以正常加载和运行（不承担 canvas 渲染职责）。
 */
function installDomPolyfills() {
  if (typeof globalThis.DOMMatrix !== "undefined") return;

  class DOMMatrixShim {
    constructor(init) {
      this.setIdentity();
      if (Array.isArray(init)) {
        if (init.length === 6) {
          const [a, b, c, d, e, f] = init.map(Number);
          this.m11 = a; this.m12 = b; this.m21 = c; this.m22 = d;
          this.m41 = e; this.m42 = f;
          this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
        } else if (init.length === 16) {
          [
            this.m11, this.m12, this.m13, this.m14,
            this.m21, this.m22, this.m23, this.m24,
            this.m31, this.m32, this.m33, this.m34,
            this.m41, this.m42, this.m43, this.m44
          ] = init.map(Number);
          this.a = this.m11; this.b = this.m12;
          this.c = this.m21; this.d = this.m22;
          this.e = this.m41; this.f = this.m42;
        }
      }
      this.updateFlags();
    }

    setIdentity() {
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      this.updateFlags();
    }

    updateFlags() {
      this.is2D =
        this.m13 === 0 && this.m14 === 0 &&
        this.m23 === 0 && this.m24 === 0 &&
        this.m31 === 0 && this.m32 === 0 &&
        this.m33 === 1 && this.m34 === 0 &&
        this.m43 === 0 && this.m44 === 1;
      this.isIdentity =
        this.m11 === 1 && this.m12 === 0 && this.m13 === 0 && this.m14 === 0 &&
        this.m21 === 0 && this.m22 === 1 && this.m23 === 0 && this.m24 === 0 &&
        this.m31 === 0 && this.m32 === 0 && this.m33 === 1 && this.m34 === 0 &&
        this.m41 === 0 && this.m42 === 0 && this.m43 === 0 && this.m44 === 1;
    }

    copyFrom(other) {
      for (const key of [
        "m11", "m12", "m13", "m14", "m21", "m22", "m23", "m24",
        "m31", "m32", "m33", "m34", "m41", "m42", "m43", "m44"
      ]) {
        this[key] = other[key];
      }
      this.a = this.m11; this.b = this.m12;
      this.c = this.m21; this.d = this.m22;
      this.e = this.m41; this.f = this.m42;
      this.updateFlags();
    }

    multiply(other) {
      const result = new DOMMatrixShim();
      result.m11 = this.m11 * other.m11 + this.m12 * other.m21 + this.m13 * other.m31 + this.m14 * other.m41;
      result.m12 = this.m11 * other.m12 + this.m12 * other.m22 + this.m13 * other.m32 + this.m14 * other.m42;
      result.m13 = this.m11 * other.m13 + this.m12 * other.m23 + this.m13 * other.m33 + this.m14 * other.m43;
      result.m14 = this.m11 * other.m14 + this.m12 * other.m24 + this.m13 * other.m34 + this.m14 * other.m44;
      result.m21 = this.m21 * other.m11 + this.m22 * other.m21 + this.m23 * other.m31 + this.m24 * other.m41;
      result.m22 = this.m21 * other.m12 + this.m22 * other.m22 + this.m23 * other.m32 + this.m24 * other.m42;
      result.m23 = this.m21 * other.m13 + this.m22 * other.m23 + this.m23 * other.m33 + this.m24 * other.m43;
      result.m24 = this.m21 * other.m14 + this.m22 * other.m24 + this.m23 * other.m34 + this.m24 * other.m44;
      result.m31 = this.m31 * other.m11 + this.m32 * other.m21 + this.m33 * other.m31 + this.m34 * other.m41;
      result.m32 = this.m31 * other.m12 + this.m32 * other.m22 + this.m33 * other.m32 + this.m34 * other.m42;
      result.m33 = this.m31 * other.m13 + this.m32 * other.m23 + this.m33 * other.m33 + this.m34 * other.m43;
      result.m34 = this.m31 * other.m14 + this.m32 * other.m24 + this.m33 * other.m34 + this.m34 * other.m44;
      result.m41 = this.m41 * other.m11 + this.m42 * other.m21 + this.m43 * other.m31 + this.m44 * other.m41;
      result.m42 = this.m41 * other.m12 + this.m42 * other.m22 + this.m43 * other.m32 + this.m44 * other.m42;
      result.m43 = this.m41 * other.m13 + this.m42 * other.m23 + this.m43 * other.m33 + this.m44 * other.m43;
      result.m44 = this.m41 * other.m14 + this.m42 * other.m24 + this.m43 * other.m34 + this.m44 * other.m44;
      result.updateFlags();
      return result;
    }

    multiplySelf(other) {
      this.copyFrom(this.multiply(other));
      return this;
    }

    preMultiplySelf(other) {
      this.copyFrom(other.multiply(this));
      return this;
    }

    translate(x = 0, y = 0) {
      return this.multiply(new DOMMatrixShim([1, 0, 0, 1, x, y]));
    }

    scale(x = 1, y = x) {
      return this.multiply(new DOMMatrixShim([x, 0, 0, y, 0, 0]));
    }

    rotate(degrees = 0) {
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      return this.multiply(new DOMMatrixShim([cos, sin, -sin, cos, 0, 0]));
    }

    invertSelf() {
      const determinant = this.a * this.d - this.b * this.c;
      if (Math.abs(determinant) < 1e-12) {
        this.setIdentity();
        return this;
      }
      const { a, b, c, d, e, f } = this;
      this.a = d / determinant;
      this.b = -b / determinant;
      this.c = -c / determinant;
      this.d = a / determinant;
      this.e = (c * f - d * e) / determinant;
      this.f = (b * e - a * f) / determinant;
      this.m11 = this.a; this.m12 = this.b;
      this.m21 = this.c; this.m22 = this.d;
      this.m41 = this.e; this.m42 = this.f;
      this.updateFlags();
      return this;
    }
  }

  globalThis.DOMMatrix = DOMMatrixShim;
}
