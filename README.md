# AI Deep Reader

A minimal web MVP for uploading articles, reading them page by page, selecting text, and asking AI for direct or deep explanations.

## Run

```powershell
npm.cmd install
npm.cmd start
```

Open `http://localhost:3000`.

One-click options on Windows:

- Double-click `scripts\open-reader.cmd` to start the server and open the web page.
- Run `npm.cmd run open` to do the same from the terminal.
- Double-click `scripts\config-ai.cmd` to configure an OpenAI-compatible model API.
- Run `npm.cmd run config:ai` to configure the model API from the terminal.

If port `3000` is already occupied:

```powershell
$env:PORT="3127"
npm.cmd start
```

## Supported Uploads

- `.txt`
- `.md` / `.markdown`
- `.html` / `.htm`
- `.pdf`
- `.docx`
- `.epub`

HTML is sanitized before text extraction. Raw uploads are saved under `uploads/`, and normalized documents plus AI history are stored in SQLite under `data/`.

## Reader Features

- Upload one or more files at once.
- Group imports by category, batch archive selected documents, sort them naturally, and search by title, filename, or category.
- Switch between uploaded documents from the left document list.
- Long documents are split into readable pages in the browser.
- Preserve common HTML, Markdown, and DOCX structure including tables, lists, quotes, headings, and inline emphasis.
- Resume the last document and page after refreshing or reopening the app.
- Selecting text opens actions for direct explanation, deep explanation, or a custom question.
- Custom questions without a selection use bounded article context instead of sending an empty prompt.
- Delete one document or select multiple documents for batch deletion.

## AI Provider

The app uses a mock provider by default so the reading flow works without an API key.

For an OpenAI-compatible chat completions endpoint:

```powershell
$env:AI_PROVIDER="openai-compatible"
$env:AI_API_KEY="your_api_key"
$env:AI_API_BASE="https://api.openai.com/v1"
$env:AI_MODEL="gpt-4.1-mini"
npm.cmd start
```

The easier path is to run:

```powershell
npm.cmd run config:ai
```

This writes `.env`, and the app reads `.env` automatically on startup.

## Tests

```powershell
npm.cmd test
```

## Before Real Production Use

- Replace the mock AI provider with a paid model provider and set usage limits.
- Add user accounts if documents should persist per person.
- Add upload size limits and clearer per-file failure messages.
- Add background parsing for very large PDFs/EPUBs.
- Add privacy controls for whether document text can be sent to external AI providers.
- Add durable highlights, notes, and export if the app is used as a long-term knowledge base.
