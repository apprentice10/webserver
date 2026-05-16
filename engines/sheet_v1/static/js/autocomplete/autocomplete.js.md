---
# engines/sheet_v1/static/js/autocomplete/autocomplete.js

**Description:** Column autocomplete dropdown — shows prefix-matched unique values from the same column while the user types in a cell. Fetches from `GET /column_values/{col_slug}`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 14–19 | State vars | `_dropdown`, `_suggestions`, `_selectedIdx`, `_currentInput`, `_debounce` |
| 22–56 | `_ensureDrop / _reposition / _render / _accept / hide / isVisible` | Dropdown DOM lifecycle; `_render` rebuilds the list and re-attaches mousedown handlers after each update |
| 59–80 | `onKeydown(e, input)` | Called first by `CellKeyboard.onCellKeydown`; intercepts ArrowDown, ArrowUp, Alt (accept), Escape; returns `true` to consume the event |
| 83–100 | `_fetch(input)` | Fetches column values via `ApiClient.getColumnValues`; auto-highlights first suggestion (`_selectedIdx = 0`) |
| 102–106 | `onInput(input)` | Debounced (220ms) entry point — called by event delegation in `init()` |
| 109–124 | `init()` | Registers delegated `input` event on stable `#grid-body` tbody; registers outside-click to hide |

## Decisions

- **Event delegation on `#grid-body`**: the tbody element is stable across virtual scroll renders (only its innerHTML changes); delegating here avoids re-attaching per-element listeners on every render.
- **`CellKeyboard.onCellKeydown` delegates first**: a single guard at the top of `onCellKeydown` lets AutoComplete intercept arrow keys before grid navigation fires — clean separation without duplicating key handling.
- **Auto-highlight first suggestion** (`_selectedIdx = 0`): Alt key immediately accepts the top suggestion, consistent with the U3 spec "Alt key accepts/completes the highlighted suggestion".
- **Exact-match filtering**: if the only suggestion equals the current input (case-insensitive), the dropdown is suppressed — a completed value should not re-show its own suggestion.
- **220ms debounce**: avoids a network call on every keystroke; short enough not to feel laggy.
