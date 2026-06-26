import { createRequire } from "node:module";

// ---------- Redis-like interface (mirrors toolkit session adapter) ----------

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

// ---------- In-memory fallback ----------

class InMemoryStore implements RedisLike {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
  async del(key: string) { this.store.delete(key); }
  async keys(pattern: string) {
    const prefix = pattern.replace("*", "");
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ---------- Auto-select backend ----------

let backend: RedisLike;

function resolveBackend(): RedisLike {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return new InMemoryStore();
  try {
    const require = createRequire(import.meta.url);
    const ioredis: any = require("ioredis");
    const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
    const client = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    return {
      async get(key: string) { return client.get(key); },
      async set(key: string, value: string) { return client.set(key, value); },
      async del(key: string) { return client.del(key); },
      async keys(pattern: string) { return client.keys(pattern); },
    };
  } catch {
    return new InMemoryStore();
  }
}

function getBackend(): RedisLike {
  if (!backend) backend = resolveBackend();
  return backend;
}

/** Reset backend — test-only. */
export function _resetStore(): void {
  backend = new InMemoryStore();
}

// ---------- Data types ----------

export interface UserAccount {
  id: number;
  currency: string;
  timezone: string;
}

export interface Category {
  id: string;
  user_id: number;
  name: string;
  created_at: string;
  usage_count: number;
}

export interface Expense {
  id: string;
  user_id: number;
  timestamp: string;
  amount_cents: number;
  category_id: string;
  note?: string;
}

export interface Budget {
  user_id: number;
  overall_cents: number | null;
  per_category: Record<string, number>;
}

export interface NotificationRule {
  user_id: number;
  warning_percent: number;
  overbudget_percent: number;
}

// ---------- Store helpers ----------

function uid(userId: number): string {
  return `user:${userId}`;
}

function cid(userId: number): string {
  return `categories:${userId}`;
}

function eid(userId: number): string {
  return `expenses:${userId}`;
}

function bid(userId: number): string {
  return `budget:${userId}`;
}

function nid(userId: number): string {
  return `notify:${userId}`;
}

// ---------- User ----------

const DEFAULT_CATEGORIES_LIST = ["Food", "Transport", "Housing", "Entertainment", "Shopping", "Utilities", "Health", "Other"];

export async function getUser(userId: number): Promise<UserAccount | null> {
  const raw = await getBackend().get(uid(userId));
  return raw ? JSON.parse(raw) : null;
}

export async function saveUser(user: UserAccount): Promise<void> {
  await getBackend().set(uid(user.id), JSON.stringify(user));
}

export async function ensureUser(userId: number): Promise<UserAccount> {
  let user = await getUser(userId);
  if (!user) {
    user = { id: userId, currency: "USD", timezone: "UTC" };
    await saveUser(user);
    const existing = await getCategories(userId);
    if (existing.length === 0) {
      for (const name of DEFAULT_CATEGORIES_LIST) {
        await addCategory(userId, {
          id: generateId(),
          user_id: userId,
          name,
          created_at: new Date().toISOString(),
          usage_count: 0,
        });
      }
    }
  }
  return user;
}

// ---------- Categories ----------

export async function getCategories(userId: number): Promise<Category[]> {
  const raw = await getBackend().get(cid(userId));
  return raw ? JSON.parse(raw) : [];
}

export async function saveCategories(userId: number, cats: Category[]): Promise<void> {
  await getBackend().set(cid(userId), JSON.stringify(cats));
}

export async function getCategoryById(userId: number, catId: string): Promise<Category | null> {
  const cats = await getCategories(userId);
  return cats.find((c) => c.id === catId) ?? null;
}

export async function addCategory(userId: number, cat: Category): Promise<void> {
  const cats = await getCategories(userId);
  cats.push(cat);
  await saveCategories(userId, cats);
}

export async function removeCategory(userId: number, catId: string): Promise<void> {
  const cats = await getCategories(userId);
  await saveCategories(userId, cats.filter((c) => c.id !== catId));
}

export async function incrementCategoryUsage(userId: number, catId: string): Promise<void> {
  const cats = await getCategories(userId);
  const cat = cats.find((c) => c.id === catId);
  if (cat) cat.usage_count++;
  await saveCategories(userId, cats);
}

// ---------- Expenses ----------

export async function getExpenses(userId: number): Promise<Expense[]> {
  const raw = await getBackend().get(eid(userId));
  return raw ? JSON.parse(raw) : [];
}

export async function saveExpenses(userId: number, expenses: Expense[]): Promise<void> {
  await getBackend().set(eid(userId), JSON.stringify(expenses));
}

export async function addExpense(userId: number, expense: Expense): Promise<void> {
  const expenses = await getExpenses(userId);
  expenses.push(expense);
  await saveExpenses(userId, expenses);
}

export async function getExpenseById(userId: number, expenseId: string): Promise<Expense | null> {
  const expenses = await getExpenses(userId);
  return expenses.find((e) => e.id === expenseId) ?? null;
}

export async function removeExpense(userId: number, expenseId: string): Promise<void> {
  const expenses = await getExpenses(userId);
  await saveExpenses(userId, expenses.filter((e) => e.id !== expenseId));
}

export async function updateExpense(userId: number, updated: Expense): Promise<void> {
  const expenses = await getExpenses(userId);
  const idx = expenses.findIndex((e) => e.id === updated.id);
  if (idx >= 0) expenses[idx] = updated;
  await saveExpenses(userId, expenses);
}

// ---------- Budget ----------

export async function getBudget(userId: number): Promise<Budget> {
  const raw = await getBackend().get(bid(userId));
  if (raw) return JSON.parse(raw);
  return { user_id: userId, overall_cents: null, per_category: {} };
}

export async function saveBudget(budget: Budget): Promise<void> {
  await getBackend().set(bid(budget.user_id), JSON.stringify(budget));
}

// ---------- Notification rules ----------

export async function getNotificationRules(userId: number): Promise<NotificationRule> {
  const raw = await getBackend().get(nid(userId));
  if (raw) return JSON.parse(raw);
  return { user_id: userId, warning_percent: 80, overbudget_percent: 100 };
}

export async function saveNotificationRules(rules: NotificationRule): Promise<void> {
  await getBackend().set(nid(rules.user_id), JSON.stringify(rules));
}

// ---------- ID helper ----------

let _idCounter = 0;
export function generateId(): string {
  return `id${++_idCounter}`;
}

/** Reset counter — test-only. */
export function _resetIdCounter(): void {
  _idCounter = 0;
}