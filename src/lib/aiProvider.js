const MODE_LABELS = {
  direct: "直接解析",
  deep: "深入解析",
  custom: "自定义问题"
};

const MODE_INSTRUCTIONS = {
  direct: [
    "任务目标：给出简明解释，帮助读者快速读懂当前文字。",
    "回答结构固定为：简明解释、原文依据。",
    "要求：用 2-4 句话说明字面含义和上下文含义；不要扩展到原文未支持的背景；不要列出延伸问题。"
  ].join("\n"),
  deep: [
    "任务目标：做深入解析，帮助读者理解这段文字在整篇文章中的作用。",
    "回答结构固定为：核心含义、原文依据、上下文关系、概念背景、论证作用、可追问问题。",
    "要求：说明它承接了什么、推进了什么、背后可能涉及哪些概念或争议；所有判断都必须回到原文或明确标注为推断。"
  ].join("\n"),
  custom: [
    "任务目标：回答用户的自定义问题。",
    "回答结构根据问题组织，但必须包含原文依据。",
    "要求：优先回答问题本身；如果问题超出原文，说明哪些部分是原文支持，哪些部分是推断。"
  ].join("\n")
};

export function buildExplainMessages({ mode, selectedText, context, question, documentTitle }) {
  const normalizedMode = MODE_LABELS[mode] ? mode : "direct";
  const modeLabel = MODE_LABELS[normalizedMode];
  const userQuestion = question?.trim()
    ? `用户问题：${question.trim()}`
    : "用户没有额外问题。";

  return [
    {
      role: "system",
      content:
        "你是一个严谨的深度阅读助手。回答必须基于用户提供的原文和上下文，尽量引用原文依据；如果原文不足以支持结论，要明确说明。使用常用 Markdown 排版，但不要用 Markdown 代码围栏包裹整个回答。"
    },
    {
      role: "user",
      content: [
        `文章标题：${documentTitle || "未命名文章"}`,
        `回答模式：${modeLabel}`,
        MODE_INSTRUCTIONS[normalizedMode],
        `选中文字：${selectedText || "未提供选区，需基于全文上下文回答。"}`,
        `上下文：${context || "无上下文"}`,
        userQuestion,
        "请用中文回答。"
      ].join("\n\n")
    }
  ];
}

export function createAiProvider(config = {}) {
  const provider = config.provider || process.env.AI_PROVIDER || "mock";

  if (provider === "openai-compatible") {
    return createOpenAiCompatibleProvider(config);
  }

  return {
    name: "mock",
    getStatus() {
      return {
        provider: "mock",
        configured: true,
        model: "mock"
      };
    },
    async explain(input) {
      return {
        provider: "mock",
        answer: buildMockAnswer(input)
      };
    }
  };
}

function buildMockAnswer(input) {
  const selected = input.selectedText || input.question || "这段内容";
  const evidence = input.context || selected;

  if (input.mode === "deep") {
    return [
      `核心含义：${selected} 是当前阅读片段中的关键内容，需要结合上下文理解。`,
      `原文依据：${evidence}`,
      "上下文关系：它和前后段落共同限定了这段话的讨论范围。",
      "概念背景：真实模型会在这里补充必要的术语来源、理论背景或相关知识，但不会脱离原文乱扩展。",
      "论证作用：真实模型会判断它是在提出概念、解释原因、承接转折，还是支撑结论。",
      "可追问问题：这个概念在全文中如何变化？作者是否给出了足够证据？"
    ].join("\n\n");
  }

  if (input.mode === "custom") {
    return [
      `回答：你问的是 ${input.question || selected}。`,
      `原文依据：${evidence}`,
      "说明：接入真实模型后，这里会围绕你的问题直接作答，并标明原文支持与推断边界。"
    ].join("\n\n");
  }

  return [
    `简明解释：${selected} 指的是当前选区的核心意思。`,
    `原文依据：${evidence}`
  ].join("\n\n");
}

function createOpenAiCompatibleProvider(config) {
  const apiKey = config.apiKey || process.env.AI_API_KEY;
  const baseUrl = normalizeBaseUrl(config.baseUrl || process.env.AI_API_BASE || "https://api.openai.com/v1");
  const model = config.model || process.env.AI_MODEL || "gpt-4.1-mini";

  return {
    name: "openai-compatible",
    getStatus() {
      return {
        provider: "openai-compatible",
        configured: Boolean(apiKey),
        baseUrl,
        model
      };
    },
    async explain(input) {
      if (!apiKey) {
        throw new Error("AI_API_KEY is required for openai-compatible provider");
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: input.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: buildExplainMessages(input),
          temperature: 0.2,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        throw new Error(`AI provider failed: ${response.status} ${await response.text()}`);
      }

      const payload = await response.json();
      return {
        provider: "openai-compatible",
        answer: payload.choices?.[0]?.message?.content?.trim() || "模型没有返回内容。"
      };
    }
  };
}

export function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "https://api.openai.com/v1";
  if (trimmed.startsWith("//")) return `https:${trimmed}`.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`.replace(/\/$/, "");
  return trimmed.replace(/\/$/, "");
}
