# Expense Tracker — Bot specification

**Archetype:** finance

A private, personal Telegram bot for fast expense tracking without spreadsheets. Users log expenses in seconds with amount + category, optional note. The bot tracks monthly totals, supports per-category and overall monthly budgets, sends immediate Telegram warnings when budgets approach or are exceeded, offers quick category buttons, lets users add/edit/delete entries and categories, and provides on-demand summaries plus an end-of-month recap. Currency is set once and totals are accurate to the cent.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Individual users who want a lightweight, private way to track personal spending via Telegram with minimal friction.

## Success criteria

- Users can log expenses in under 5 seconds with quick buttons or commands
- Budget warnings are delivered within 5 seconds of crossing thresholds
- Monthly summaries and recaps are generated accurately with per-category breakdowns
- All user data remains private and persistent across sessions

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **/add** (command, actor: user, command: /add) — Quickly add an expense with amount and category in one message
- **/recent** (command, actor: user, command: /recent) — View and edit/delete recent expenses
- **/summary** (command, actor: user, command: /summary) — Get current month's expense summary vs budgets
- **/setbudget** (command, actor: user, command: /setbudget) — Set overall or per-category monthly budgets
- **Quick Categories** (button, actor: user, callback: quick_categories) — Access quick buttons for most-used categories
  - inputs: amount, category
  - outputs: expense entry
- **Add Category** (button, actor: user, callback: add_category) — Create a new expense category
  - inputs: category name
  - outputs: updated category list

## Flows

### Onboarding
_Trigger:_ /start

1. Ask for currency selection
2. Present initial category set
3. Allow category customization

_Data touched:_ User account, Categories

### Quick Logging
_Trigger:_ quick_categories button or /add command

1. Show category buttons or parse command input
2. Collect amount and optional note
3. Create expense entry

_Data touched:_ Expense entry, Category usage_count

### Edit/Delete
_Trigger:_ /recent

1. List recent entries
2. Select entry to edit/delete
3. Apply changes or remove entry

_Data touched:_ Expense entry

### Budget Management
_Trigger:_ /setbudget

1. Parse budget type (overall or category)
2. Collect budget amount
3. Update budget settings

_Data touched:_ Budget

### Monthly Recap
_Trigger:_ First day of month

1. Generate previous month's summary
2. Compare with previous month's data
3. Send recap message

_Data touched:_ Monthly summary

### Budget Warning
_Trigger:_ Expense addition that crosses budget threshold

1. Calculate current budget usage
2. Send warning message if threshold crossed
3. Offer summary or budget adjustment options

_Data touched:_ Budget, Expense entry

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User account** _(retention: persistent)_ — Telegram user's settings and preferences
  - fields: Telegram ID, currency, budget settings
- **Expense entry** _(retention: persistent)_ — Individual expense record
  - fields: id, user_id, timestamp, amount in cents, category_id, optional note
- **Category** _(retention: persistent)_ — Expense category with usage tracking
  - fields: id, user_id, name, created_at, usage_count
- **Budget** _(retention: persistent)_ — User's budget settings
  - fields: user_id, overall monthly budget, per-category budgets
- **Notification rule** _(retention: persistent)_ — Budget threshold settings
  - fields: warning threshold (80%), over-budget threshold (100%)

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Set currency
- Edit categories
- Set budgets
- View/export data
- Adjust notification thresholds

## Notifications

- Budget warning at 80% usage
- Budget exceeded alert at 100%
- End-of-month recap
- Quick edit/delete confirmation
- Undo option for 30 seconds after adding

## Permissions & privacy

- All data is private to the user's Telegram account
- No data sharing or public export by default
- Manual export available via /export command

## Edge cases

- User tries to add negative amounts
- User attempts to edit/delete non-existent entries
- Budgets set to zero or negative values
- Multiple budget warnings in a single session
- Time zone changes affecting month boundaries

## Required tests

- Verify 5-second expense logging with quick buttons
- Test budget warning delivery within 5 seconds of threshold
- Validate monthly summary accuracy with multiple categories
- Confirm data persistence across sessions
- Test 30-second undo functionality

## Assumptions

- Default currency is based on Telegram locale
- Initial categories are common ones (Food, Transport, etc.)
- Quick buttons show top 6 most-used categories
- Budget warnings at 80% and 100% thresholds
- Month boundaries use user's local time zone
