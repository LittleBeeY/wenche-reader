import { readFile, writeFile } from "node:fs/promises";

export function parseEnv(text) {
  const result = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key) continue;

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * 原地更新 .env 文件中的指定键：保留注释、空行、顺序和无关键，
 * 只替换匹配的键，缺失的键追加到文件末尾。文件不存在时直接新建。
 */
export async function updateEnvFile(filePath, updates) {
  let lines = [];
  let eol = "\n";
  try {
    const text = await readFile(filePath, "utf8");
    const normalized = text.replace(/^\uFEFF/, "");
    if (normalized.includes("\r\n")) eol = "\r\n";
    lines = normalized.split(/\r?\n/);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const keys = new Set(Object.keys(updates));
  const output = [];
  const written = new Set();

  // 去掉文件末尾的空白行，避免追加新键前出现多余空行
  while (lines.length && lines.at(-1).trim() === "") lines.pop();

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && keys.has(match[1])) {
      output.push(formatEnvLine(match[1], updates[match[1]]));
      written.add(match[1]);
    } else {
      output.push(line);
    }
  }

  for (const key of keys) {
    if (!written.has(key)) {
      output.push(formatEnvLine(key, updates[key]));
    }
  }

  while (output.length && output.at(-1).trim() === "") output.pop();
  const content = output.join(eol);
  await writeFile(filePath, content ? `${content}${eol}` : "", "utf8");
}

function formatEnvLine(key, value) {
  return `${key}=${String(value ?? "")}`;
}

export async function loadEnvFile(filePath, options = {}) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }

  const parsed = parseEnv(text);
  for (const [key, value] of Object.entries(parsed)) {
    if (options.override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return parsed;
}
