# Retryable Decision ticket resolution

Status: accepted

Date: 2026-08-02

The Decision ticket resolution workflow records a Resolution and closes the Decision ticket as one adapter operation where the tracker supports it, then updates the Wayfinder map as a separately retryable secondary-index step. The workflow is tracker-native: Local Markdown uses `## Answer` and resolved status, while Todoist uses the raw answer as its native completion comment. The first Resolution wins; retries use canonical exact text matching, never replace an existing Resolution, and never create duplicate map entries because the ticket id/URL is the decision identity.

## Considered options

- **Force a common `## Answer` marker across trackers:** rejected because it leaks Local Markdown storage syntax into remote comments and diverges from upstream Wayfinder behavior.
- **Treat ticket closure and map recording as one transaction:** rejected because Todoist cannot atomically update the Decision ticket and its separate map task in one operation.
- **Resolve the map entry before the ticket:** rejected because the map would advertise a decision before its Decision ticket had a Resolution and closed status.
- **Add a pending map-decision state:** rejected because the map is a low-resolution index of completed decisions; the extra state adds recovery complexity without improving the invariant.

## Consequences

- A resolved Decision ticket can temporarily have a stale map index after a map-write failure; the structured partial result makes that state retryable.
- A closed Decision ticket without a matching Resolution is an incomplete state requiring human inspection.
- Todoist historical comments cannot reliably reconstruct which comment was the Resolution after a fresh read; the resolution workflow owns recognition during retry.
- Synchronization remains outside the workflow; the Todoist adapter operates on the synchronized database snapshot supplied by tracker construction.
