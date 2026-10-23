# Command help

`/bot help` lists registered public slash commands by category. The overview and category pages are public. Counts distinguish registered roots from runnable paths.

`/bot help command:me` browses a root. `command:me reminder` browses a group. `command:me reminder add` shows required delivery, time, and message arguments, delivery choices, and the message length limit. `command:me bookmark search` shows the required query and its length bounds. Detail and error replies are private.

Paths accept a leading slash, mixed case, and repeated whitespace. Autocomplete suggests up to 25 complete canonical paths, including root and group browse topics. Argument names are not command paths.

Previous and Next show all content within the current view. Overview returns to the first browse page. Old, malformed, or out-of-range controls receive a private prompt to run `/bot help` again.

Help describes public syntax. Permissions, server rules, cooldowns, and provider availability still govern execution. Unavailable provider features and policy exclusions appear as status notes. Text aliases describe existing paths without advertising extra slash roots.

## Discovery ownership

`help.js` privately derives one schema snapshot for each interaction. It excludes `register: false`, `devOnly`, and context-menu commands. `/bot` declares only `help`, `ping`, and `stats` as public discovery paths in Utility. Discovery is the same for every caller. Execution adapters and private operation schemas remain intact.

Each response contains one embed. Content continues across pages within Discord's individual and aggregate text limits. Navigation uses revisioned `help_page_` IDs with strict syntax and range checks. Only the selected view is rendered; no sessions or cache are persisted. The existing interaction router handles these controls.

Autocomplete requires the updated `/bot help` schema to be registered before Discord offers suggestions. Unit tests verify generated schemas and replies; they do not verify live registration.
