# AI Answer Markdown Rendering Design

## Goal

Render common Markdown returned by the AI in the answer panel instead of
displaying Markdown punctuation as plain text.

## Scope

Supported formatting:

- Headings
- Bold and italic text
- Block quotes
- Ordered and unordered lists
- Links
- Inline code and fenced code blocks

GitHub-specific tables, task lists, and strikethrough are out of scope.
Document content, answer metadata, and all other UI text remain plain text.

## Design

Add a small browser-side `renderMarkdown` module. It uses `marked` to convert
the AI response to HTML and `DOMPurify` to sanitize that HTML before inserting
it into an `.answer-body` element.

The existing answer history flow remains unchanged:

1. The API returns and stores the original Markdown string.
2. The browser loads the answer record.
3. `renderMarkdown` converts and sanitizes only the answer body.
4. The answer element inserts the sanitized result.

Links open in a new tab with `rel="noopener noreferrer"`. Unsafe tags,
attributes, and URL protocols are removed by the sanitizer.

## Styling

Add narrowly scoped styles under `.answer-body` for headings, paragraphs,
lists, block quotes, links, and code. Headings remain compact so the AI panel
does not become visually oversized. Long code and links wrap or scroll within
the panel instead of widening the layout.

## Testing

Unit tests verify that the renderer:

- Converts headings, bold text, lists, and code blocks.
- Removes scripts, event handlers, and unsafe links.
- Adds safe external-link attributes.

Existing tests must continue to pass. A syntax check covers the updated
frontend modules.

## Acceptance Criteria

- An AI answer containing `### Heading` displays a heading without the `###`.
- Common Markdown structures render with readable formatting.
- Dangerous HTML cannot execute or survive in the rendered result.
- Plain AI answers remain readable.
- The answer panel layout and existing history limit are unchanged.
