export async function consumeEventStream(response, onEvent = () => {}) {
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    const text = await response.text();
    try {
      const payload = JSON.parse(text);
      if (payload.error) message = payload.error;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("AI stream is unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = null;

  const dispatch = (block) => {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const payload = JSON.parse(data);
    onEvent(event, payload);
    if (event === "error") throw new Error(payload.error || "AI stream failed");
    if (event === "done") completed = payload;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) dispatch(block);
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
  if (!completed) throw new Error("AI stream ended before completion");
  return completed;
}
