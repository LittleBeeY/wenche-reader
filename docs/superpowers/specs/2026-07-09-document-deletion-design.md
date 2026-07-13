# Document Deletion Design

## Scope

Add deletion for one uploaded document at a time. Category-wide deletion is
out of scope.

## Behavior

- Every document row has a delete control.
- The browser asks for confirmation before sending the request.
- Deletion removes the original upload, AI history, text blocks, and document.
- Deleting the current document opens the next document in the same category,
  then the previous document if no next document exists.
- If no adjacent document exists, the reader is cleared.

## Safety

The server only deletes files whose resolved paths remain inside its configured
upload directory. Database records are removed in a transaction. Missing
documents return 404.

## Verification

API tests verify the file disappears, the document becomes unreadable, and its
list entry is removed. The complete test suite must remain green.

