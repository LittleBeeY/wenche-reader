# Document Categories and Ordering Design

## Goal

Keep batches of imported article pages organized and make previous/next
navigation follow a predictable reading order across files.

## Behavior

- The upload area accepts a category name for the selected batch.
- Blank category names become `未分类`.
- The document list is grouped by category.
- Users can sort each category by natural file name, document title, or import
  order.
- Natural file-name sorting treats `2.html` as before `10.html`.
- At the last page of a document, Next opens the first page of the next
  document in the same category and current sort order.
- At the first page, Previous opens the last page of the previous document.
- Navigation never crosses into another category.
- Existing documents are migrated to `未分类`.

## Data Model

Add a non-null `category` column to `documents`. New databases create it
directly; existing databases receive it through a guarded migration.

The batch upload endpoint accepts `category` and passes it to every document
created by that request. Single-document uploads accept the same field.

## Frontend Structure

Add a focused `documentOrder.js` module for sorting, grouping, and adjacent
document lookup. The UI uses this module for both list rendering and page
navigation so the visible order and Next/Previous behavior cannot diverge.

## Testing

- API tests verify batch category persistence and the default category.
- Unit tests verify natural file-name sorting, title/import sorting, grouping,
  and category-bounded adjacency.
- Existing pagination and full application tests remain green.

