const crypto = require('crypto');
const { MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes } = require('discord.js');
const embeds = require('../utils/embeds');

const GLOBAL_SCOPE = 'global';
const MAX_STARTING_BALANCE = 1000000;
const MAX_DAILY_CAP = 50000;
const MAX_AMOUNT = 1000000000000;
const MAX_SCOPE_SUPPLY = 9000000000000000;
const SIX_HOURS = 21600000;
const MAX_EARNING_GUILDS = 30;
const DEFAULT_JOB = { id: 'worker', name: 'worker', minimum: 100, maximum: 250, cooldownSeconds: 3600, builtIn: true };
const GLOBAL_CONFIG = Object.freeze({ currency_name: 'coins', currency_emoji: '🪙', starting_balance: 0, daily_cap: 50000 });
const CONFIRMATION_TTL = 10 * 60 * 1000;
const DEFINITIVE_ROLE_ERRORS = new Set([
    RESTJSONErrorCodes.UnknownMember,
    RESTJSONErrorCodes.UnknownRole,
    RESTJSONErrorCodes.MissingAccess,
    RESTJSONErrorCodes.MissingPermissions,
    RESTJSONErrorCodes.InvalidRole
]);

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function accountView(row, rank) {
    if (!row) return null;
    const result = {
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        userId: row.user_id,
        wallet: row.wallet,
        bank: row.bank,
        total: row.wallet + row.bank
    };
    if (rank !== undefined) result.rank = rank;
    return result;
}

class EconomyService {
    constructor(options = {}) {
        this.client = options.client || null;
        this.sqlite = options.sqlite;
        this.now = options.now || Date.now;
        this.randomUUID = options.randomUUID || crypto.randomUUID;
        this.randomInt = options.randomInt || crypto.randomInt;
        this.randomBytes = options.randomBytes || crypto.randomBytes;
        this.setTimeout = options.setTimeout || setTimeout;
        this.confirmations = new Map();
    }

    config(guildId) {
        return this.sqlite.prepare('SELECT * FROM economy_configs WHERE guild_id = ?').get(guildId) || null;
    }

    enable(guildId, actorId) {
        if (this.config(guildId)?.enabled) throw new Error('Economy is already enabled in this server.');
        const now = this.now();
        this.sqlite.prepare(`INSERT INTO economy_configs (guild_id, enabled, updated_by, updated_at)
            VALUES (?, 1, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET enabled = 1,
            updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(guildId, actorId, now);
        return this.config(guildId);
    }

    configure(guildId, actorId, values) {
        const allowed = {
            currencyName: 'currency_name', currencyEmoji: 'currency_emoji',
            startingBalance: 'starting_balance', dailyCap: 'daily_cap'
        };
        const entries = Object.entries(values).filter(([key]) => allowed[key]);
        if (!entries.length) return this.config(guildId);
        const current = this.config(guildId);
        if (!current) throw new Error('Economy has not been set up in this server.');
        if (values.startingBalance !== undefined
            && (!Number.isInteger(values.startingBalance) || values.startingBalance < 0 || values.startingBalance > MAX_STARTING_BALANCE)) {
            throw new Error(`Starting balance must be between 0 and ${MAX_STARTING_BALANCE}.`);
        }
        if (values.dailyCap !== undefined
            && (!Number.isInteger(values.dailyCap) || values.dailyCap < 1 || values.dailyCap > MAX_DAILY_CAP)) {
            throw new Error(`Daily cap must be between 1 and ${MAX_DAILY_CAP}.`);
        }
        if (values.currencyName !== undefined && !/^.{1,32}$/u.test(values.currencyName.trim())) {
            throw new Error('Currency name must be 1-32 characters.');
        }
        if (values.currencyEmoji !== undefined && !/^.{1,32}$/u.test(values.currencyEmoji.trim())) {
            throw new Error('Currency emoji must be 1-32 characters.');
        }
        this.sqlite.prepare(`UPDATE economy_configs SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(', ')},
            updated_by = ?, updated_at = ? WHERE guild_id = ?`).run(
            ...entries.map(([key, value]) => typeof value === 'string' ? value.trim() : value), actorId, this.now(), guildId
        );
        return this.config(guildId);
    }

    applyPreset(guildId, actorId, preset) {
        if (preset !== 'standard') throw new Error('The only available preset is standard.');
        this.requireEnabled(guildId);
        this.sqlite.prepare(`UPDATE economy_configs SET currency_name = 'coins', currency_emoji = '🪙',
            starting_balance = 0, daily_cap = 50000, preset = 'standard', updated_by = ?, updated_at = ?
            WHERE guild_id = ?`).run(actorId, this.now(), guildId);
        return this.config(guildId);
    }

    mode(userId) {
        return this.sqlite.prepare('SELECT scope_type FROM economy_modes WHERE user_id = ?').get(userId)?.scope_type || 'guild';
    }

    setMode(userId, scopeType) {
        if (!['guild', 'global'].includes(scopeType)) throw new Error('Economy mode must be guild or global.');
        this.sqlite.prepare(`INSERT INTO economy_modes (user_id, scope_type, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET scope_type = excluded.scope_type, updated_at = excluded.updated_at`)
            .run(userId, scopeType, this.now());
        return scopeType;
    }

    scope(guildId, userId, requestedScope) {
        const scopeType = requestedScope || this.mode(userId);
        if (!['guild', 'global'].includes(scopeType)) throw new Error('Economy mode must be guild or global.');
        return { scopeType, scopeId: scopeType === 'global' ? GLOBAL_SCOPE : guildId };
    }

    requireEnabled(guildId) {
        const config = this.config(guildId);
        if (!config?.enabled) throw new Error('Economy is not enabled in this server.');
        return config;
    }

    scopeConfig(guildId, scope) {
        return scope.scopeType === 'global' ? GLOBAL_CONFIG : this.requireEnabled(guildId);
    }

    updateTotals({ scopeType, scopeId }, mintedDelta = 0n, destroyedDelta = 0n) {
        const now = this.now();
        this.sqlite.prepare(`INSERT INTO economy_scope_totals
            (scope_type, scope_id, minted_text, destroyed_text, updated_at) VALUES (?, ?, '0', '0', ?)
            ON CONFLICT (scope_type, scope_id) DO NOTHING`).run(scopeType, scopeId, now);
        const current = this.sqlite.prepare(`SELECT * FROM economy_scope_totals
            WHERE scope_type = ? AND scope_id = ?`).get(scopeType, scopeId);
        const minted = BigInt(current.minted_text) + BigInt(mintedDelta);
        const destroyed = BigInt(current.destroyed_text) + BigInt(destroyedDelta);
        this.sqlite.prepare(`UPDATE economy_scope_totals SET minted_text = ?, destroyed_text = ?, updated_at = ?
            WHERE scope_type = ? AND scope_id = ?`).run(String(minted), String(destroyed), now, scopeType, scopeId);
        return { minted, destroyed };
    }

    validateAmount(amount) {
        if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
            throw new Error(`Amount must be a whole number between 1 and ${MAX_AMOUNT}.`);
        }
        return amount;
    }

    validateReason(reason) {
        const value = String(reason || '').trim();
        if (!value || value.length > 256) throw new Error('Reason must be 1-256 characters.');
        return value;
    }

    account({ scopeType, scopeId }, userId) {
        const row = this.sqlite.prepare(`SELECT * FROM economy_accounts
            WHERE scope_type = ? AND scope_id = ? AND user_id = ?`).get(scopeType, scopeId, userId);
        if (!row) throw new Error('Economy account not found.');
        return row;
    }

    supply({ scopeType, scopeId }) {
        const value = this.sqlite.prepare(`SELECT COALESCE(SUM(wallet + bank), 0) AS value FROM economy_accounts
            WHERE scope_type = ? AND scope_id = ?`).get(scopeType, scopeId).value;
        if (!Number.isSafeInteger(value)) throw new Error('Economy circulation exceeds the safe integer limit.');
        return value;
    }

    record(row, values) {
        this.sqlite.prepare(`INSERT INTO economy_ledger
            (transaction_id, scope_type, scope_id, user_id, wallet_delta, bank_delta, supply_delta,
             wallet_balance, bank_balance, kind, actor_id, counterparty_id, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(values.transactionId, row.scope_type, row.scope_id, row.user_id,
                values.walletDelta, values.bankDelta, values.supplyDelta || 0, row.wallet, row.bank, values.kind,
                values.actorId, values.counterpartyId || null, values.reason || null, this.now());
    }

    apply(row, values) {
        const wallet = row.wallet + values.walletDelta;
        const bank = row.bank + values.bankDelta;
        if (!Number.isSafeInteger(wallet) || wallet < 0 || wallet > MAX_AMOUNT) throw new Error('Insufficient wallet balance or account limit exceeded.');
        if (!Number.isSafeInteger(bank) || bank < 0 || bank > MAX_AMOUNT) throw new Error('Insufficient bank balance or account limit exceeded.');
        this.sqlite.prepare(`UPDATE economy_accounts SET wallet = ?, bank = ?, updated_at = ?
            WHERE scope_type = ? AND scope_id = ? AND user_id = ?`)
            .run(wallet, bank, this.now(), row.scope_type, row.scope_id, row.user_id);
        const updated = { ...row, wallet, bank };
        this.record(updated, values);
        return accountView(updated);
    }

    open({ guildId, userId, scope: requestedScope }) {
        return this.sqlite.transaction(() => {
            const scope = this.scope(guildId, userId, requestedScope);
            const { scopeType, scopeId } = scope;
            const config = this.scopeConfig(guildId, scope);
            const existing = this.sqlite.prepare(`SELECT 1 FROM economy_accounts
                WHERE scope_type = ? AND scope_id = ? AND user_id = ?`).get(scopeType, scopeId, userId);
            if (existing) throw new Error('You already have an economy account.');
            const startingBalance = scopeType === 'guild' ? config.starting_balance : 0;
            if (this.supply(scope) + startingBalance > MAX_SCOPE_SUPPLY) {
                throw new Error('This economy has reached its circulation limit.');
            }
            const now = this.now();
            this.sqlite.prepare(`INSERT INTO economy_accounts
                (scope_type, scope_id, user_id, wallet, bank, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)`).run(scopeType, scopeId, userId, startingBalance, now, now);
            this.updateTotals(scope, BigInt(startingBalance));
            if (startingBalance > 0) {
                this.sqlite.prepare(`INSERT INTO economy_ledger
                    (transaction_id, scope_type, scope_id, user_id, wallet_delta, bank_delta, supply_delta,
                     wallet_balance, bank_balance, kind, actor_id, created_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, 'open', ?, ?)`)
                    .run(this.randomUUID(), scopeType, scopeId, userId, startingBalance, startingBalance, startingBalance, userId, now);
            }
            return accountView(this.sqlite.prepare(`SELECT * FROM economy_accounts
                WHERE scope_type = ? AND scope_id = ? AND user_id = ?`).get(scopeType, scopeId, userId));
        }).immediate();
    }

    balance({ guildId, userId, scope: requestedScope }) {
        const scope = this.scope(guildId, userId, requestedScope);
        const { scopeType, scopeId } = scope;
        this.scopeConfig(guildId, scope);
        const row = this.sqlite.prepare(`SELECT * FROM economy_accounts
            WHERE scope_type = ? AND scope_id = ? AND user_id = ?`).get(scopeType, scopeId, userId);
        if (!row) return null;
        const rank = this.sqlite.prepare(`SELECT COUNT(*) + 1 AS rank FROM economy_accounts
            WHERE scope_type = ? AND scope_id = ? AND (wallet + bank) > ?`).get(scopeType, scopeId, row.wallet + row.bank).rank;
        return accountView(row, rank);
    }

    circulation({ guildId, userId, scope: requestedScope }) {
        const scope = this.scope(guildId, userId, requestedScope);
        const { scopeType, scopeId } = scope;
        this.scopeConfig(guildId, scope);
        const aggregate = this.sqlite.prepare(`SELECT COALESCE(SUM(wallet + bank), 0) AS circulation,
            COUNT(*) AS accounts FROM economy_accounts WHERE scope_type = ? AND scope_id = ?`).get(scopeType, scopeId);
        if (!Number.isSafeInteger(aggregate.circulation)) throw new Error('Economy circulation exceeds the safe integer limit.');
        const totals = this.sqlite.prepare(`SELECT minted_text, destroyed_text FROM economy_scope_totals
            WHERE scope_type = ? AND scope_id = ?`).get(scopeType, scopeId) || { minted_text: '0', destroyed_text: '0' };
        return {
            scopeType, scopeId, circulation: aggregate.circulation,
            minted: BigInt(totals.minted_text), destroyed: BigInt(totals.destroyed_text), accounts: aggregate.accounts
        };
    }

    deposit({ guildId, userId, amount, all = false }) {
        return this.sqlite.transaction(() => {
            const scope = this.scope(guildId, userId);
            const { scopeType } = scope;
            if (scopeType !== 'guild') throw new Error('Deposit is only available in guild mode.');
            this.requireEnabled(guildId);
            const row = this.account(scope, userId);
            const moved = all ? row.wallet : this.validateAmount(amount);
            if (moved < 1 || moved > row.wallet) throw new Error('Insufficient wallet balance.');
            return this.apply(row, {
                transactionId: this.randomUUID(), walletDelta: -moved, bankDelta: moved,
                kind: 'deposit', actorId: userId
            });
        }).immediate();
    }

    withdraw({ guildId, userId, amount, all = false }) {
        return this.sqlite.transaction(() => {
            const scope = this.scope(guildId, userId);
            const { scopeType } = scope;
            if (scopeType !== 'guild') throw new Error('Withdraw is only available in guild mode.');
            this.requireEnabled(guildId);
            const row = this.account(scope, userId);
            const moved = all ? row.bank : this.validateAmount(amount);
            if (moved < 1 || moved > row.bank) throw new Error('Insufficient bank balance.');
            return this.apply(row, {
                transactionId: this.randomUUID(), walletDelta: moved, bankDelta: -moved,
                kind: 'withdraw', actorId: userId
            });
        }).immediate();
    }

    transfer({ guildId, userId, targetId, amount }) {
        return this.sqlite.transaction(() => {
            if (userId === targetId) throw new Error('You cannot transfer money to yourself.');
            this.validateAmount(amount);
            const scope = this.scope(guildId, userId);
            this.scopeConfig(guildId, scope);
            const sender = this.account(scope, userId);
            const target = this.account(scope, targetId);
            const transactionId = this.randomUUID();
            const senderView = this.apply(sender, {
                transactionId, walletDelta: -amount, bankDelta: 0, kind: 'transfer',
                actorId: userId, counterpartyId: targetId
            });
            const targetView = this.apply(target, {
                transactionId, walletDelta: amount, bankDelta: 0, kind: 'transfer',
                actorId: userId, counterpartyId: userId
            });
            return { transactionId, sender: senderView, target: targetView };
        }).immediate();
    }

    grant({ guildId, actorId, targetId, amount, reason }) {
        return this.sqlite.transaction(() => {
            this.requireEnabled(guildId);
            this.validateAmount(amount);
            const auditReason = this.validateReason(reason);
            const scope = { scopeType: 'guild', scopeId: guildId };
            if (this.supply(scope) + amount > MAX_SCOPE_SUPPLY) throw new Error('This economy has reached its circulation limit.');
            const row = this.account(scope, targetId);
            const result = this.apply(row, {
                transactionId: this.randomUUID(), walletDelta: amount, bankDelta: 0,
                supplyDelta: amount, kind: 'grant', actorId, counterpartyId: targetId, reason: auditReason
            });
            this.updateTotals(scope, BigInt(amount));
            return result;
        }).immediate();
    }

    burn({ guildId, actorId, targetId, amount, reason, kind }) {
        return this.sqlite.transaction(() => {
            this.requireEnabled(guildId);
            this.validateAmount(amount);
            const auditReason = this.validateReason(reason);
            const scope = { scopeType: 'guild', scopeId: guildId };
            const row = this.account(scope, targetId);
            if (row.wallet + row.bank < amount) throw new Error('That account does not have enough currency.');
            const walletDelta = -Math.min(row.wallet, amount);
            const bankDelta = -(amount + walletDelta);
            const result = this.apply(row, {
                transactionId: this.randomUUID(), walletDelta, bankDelta,
                supplyDelta: -amount, kind, actorId, counterpartyId: targetId, reason: auditReason
            });
            this.updateTotals(scope, 0n, BigInt(amount));
            return result;
        }).immediate();
    }

    remove(values) {
        return this.burn({ ...values, kind: 'remove' });
    }

    history({ guildId, userId, scope: requestedScope, limit = 50 }) {
        const { scopeType, scopeId } = this.scope(guildId, userId, requestedScope);
        return this.sqlite.prepare(`SELECT * FROM economy_ledger WHERE scope_type = ? AND scope_id = ? AND user_id = ?
            ORDER BY id ASC LIMIT ?`).all(scopeType, scopeId, userId, Math.min(100, Math.max(1, limit))).map(row => ({
            id: row.id, transactionId: row.transaction_id, scopeType: row.scope_type, scopeId: row.scope_id,
            userId: row.user_id, walletDelta: row.wallet_delta, bankDelta: row.bank_delta,
            walletBalance: row.wallet_balance, bankBalance: row.bank_balance, kind: row.kind,
            actorId: row.actor_id, counterpartyId: row.counterparty_id, reason: row.reason, createdAt: row.created_at
        }));
    }

    addJob({ guildId, actorId, name, minimum, maximum, cooldownSeconds }) {
        this.requireEnabled(guildId);
        const key = String(name || '').trim().toLowerCase();
        if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u.test(key) || key === DEFAULT_JOB.name) {
            throw new Error('Job name must be 1-32 letters, numbers, spaces, underscores, or hyphens and cannot be worker.');
        }
        if (!Number.isInteger(minimum) || minimum < 1 || !Number.isInteger(maximum)
            || maximum <= minimum || maximum > MAX_DAILY_CAP) throw new Error('Minimum payout must be positive and less than maximum payout.');
        if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 60 || cooldownSeconds > 604800) {
            throw new Error('Cooldown must be between 60 and 604800 seconds.');
        }
        if (this.sqlite.prepare('SELECT COUNT(*) AS count FROM economy_jobs WHERE guild_id = ?').get(guildId).count >= 24) {
            throw new Error('This server already has the maximum 25 jobs.');
        }
        const now = this.now();
        return this.sqlite.prepare(`INSERT INTO economy_jobs
            (guild_id, name, minimum, maximum, cooldown_seconds, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
            .get(guildId, key, minimum, maximum, cooldownSeconds, actorId, now, now);
    }

    listJobs(guildId) {
        this.requireEnabled(guildId);
        return [DEFAULT_JOB, ...this.sqlite.prepare(`SELECT id, name, minimum, maximum,
            cooldown_seconds AS cooldownSeconds FROM economy_jobs WHERE guild_id = ? ORDER BY id`).all(guildId)];
    }

    job(guildId, value) {
        if (!value || String(value).toLowerCase() === DEFAULT_JOB.name) return DEFAULT_JOB;
        const row = this.sqlite.prepare(`SELECT id, name, minimum, maximum, cooldown_seconds AS cooldownSeconds
            FROM economy_jobs WHERE guild_id = ? AND (name = ? OR id = ?)`).get(guildId, String(value).toLowerCase(), Number(value));
        if (!row) throw new Error('That job does not exist.');
        return row;
    }

    removeJob(guildId, value) {
        this.requireEnabled(guildId);
        const job = this.job(guildId, value);
        if (job.builtIn) throw new Error('The built-in worker job cannot be removed.');
        return Boolean(this.sqlite.prepare('DELETE FROM economy_jobs WHERE guild_id = ? AND id = ?').run(guildId, job.id).changes);
    }

    checkAges(guildCreatedAt, memberJoinedAt) {
        if (!Number.isFinite(guildCreatedAt) || this.now() - guildCreatedAt < SIX_HOURS) {
            throw new Error('This server must be at least 6 hours old to use economy commands.');
        }
        if (!Number.isFinite(memberJoinedAt) || this.now() - memberJoinedAt < SIX_HOURS) {
            throw new Error('You must be in this server for at least 6 hours to use economy commands.');
        }
    }

    utcDay() {
        return new Date(this.now()).toISOString().slice(0, 10);
    }

    nextUtcDay() {
        const date = new Date(this.now());
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    }

    earn({ guildId, userId, action, subjectId, cooldownSubjectId = subjectId, baseAmount, cooldownMs, guildCreatedAt, memberJoinedAt }) {
        return this.sqlite.transaction(() => {
            this.checkAges(guildCreatedAt, memberJoinedAt);
            const scope = this.scope(guildId, userId);
            const { scopeType, scopeId } = scope;
            const config = this.scopeConfig(guildId, scope);
            const account = this.account(scope, userId);
            const cooldownScopeType = action === 'daily' ? 'global' : scopeType;
            const cooldownScopeId = action === 'daily' ? GLOBAL_SCOPE : scopeId;
            const cooldown = this.sqlite.prepare(`SELECT available_at FROM economy_action_cooldowns
                WHERE user_id = ? AND action = ? AND scope_type = ? AND scope_id = ? AND subject_id = ?`)
                .get(userId, action, cooldownScopeType, cooldownScopeId, String(cooldownSubjectId));
            if (cooldown?.available_at > this.now()) throw new Error(`${action === 'daily' ? 'Your daily reward' : 'This job'} is on cooldown.`);
            const day = this.utcDay();
            this.sqlite.prepare(`INSERT INTO economy_earning_guilds (user_id, utc_day, guild_id, created_at)
                VALUES (?, ?, ?, ?) ON CONFLICT (user_id, utc_day, guild_id) DO NOTHING`).run(userId, day, guildId, this.now());
            const guildCount = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM economy_earning_guilds
                WHERE user_id = ? AND utc_day = ?`).get(userId, day).count;
            if (guildCount > MAX_EARNING_GUILDS) throw new Error(`You can earn in at most ${MAX_EARNING_GUILDS} servers per day.`);
            const earned = this.sqlite.prepare(`SELECT amount FROM economy_earned_totals
                WHERE user_id = ? AND utc_day = ?`).get(userId, day)?.amount || 0;
            const remaining = config.daily_cap - earned;
            if (remaining < 1) throw new Error(`You have hit the daily earning cap of ${config.daily_cap}.`);
            const amount = Math.min(Math.floor(baseAmount * 3 / 2), remaining);
            if (this.supply(scope) + amount > MAX_SCOPE_SUPPLY) throw new Error('This economy has reached its circulation limit.');
            const result = this.apply(account, {
                transactionId: this.randomUUID(), walletDelta: amount, bankDelta: 0,
                supplyDelta: amount, kind: action, actorId: userId, reason: String(subjectId)
            });
            this.updateTotals(scope, BigInt(amount));
            this.sqlite.prepare(`INSERT INTO economy_earned_totals (user_id, utc_day, amount, updated_at)
                VALUES (?, ?, ?, ?) ON CONFLICT (user_id, utc_day) DO UPDATE SET
                amount = amount + excluded.amount, updated_at = excluded.updated_at`).run(userId, day, amount, this.now());
            this.sqlite.prepare(`INSERT INTO economy_action_cooldowns
                (user_id, action, scope_type, scope_id, subject_id, available_at) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, action, scope_type, scope_id, subject_id) DO UPDATE SET available_at = excluded.available_at`)
                .run(userId, action, cooldownScopeType, cooldownScopeId, String(cooldownSubjectId), this.now() + cooldownMs);
            return { ...result, amount, baseAmount };
        }).immediate();
    }

    daily(values) {
        return this.earn({ ...values, action: 'daily', subjectId: 'daily', baseAmount: 500,
            cooldownMs: this.nextUtcDay() - this.now() });
    }

    work(values) {
        const scope = this.scope(values.guildId, values.userId);
        if (scope.scopeType === 'global' && values.job && String(values.job).toLowerCase() !== DEFAULT_JOB.id) {
            throw new Error('The global economy only uses the worker job.');
        }
        const job = scope.scopeType === 'global' ? DEFAULT_JOB : this.job(values.guildId, values.job);
        const baseAmount = this.randomInt(job.minimum, job.maximum + 1);
        return { ...this.earn({ ...values, action: 'work', subjectId: job.id, baseAmount,
            cooldownMs: job.cooldownSeconds * 1000 }), job: job.name };
    }

    addShopItem({ guildId, actorId, roleId, roleName, price }) {
        this.requireEnabled(guildId);
        this.validateAmount(price);
        const name = String(roleName || '').trim();
        if (!roleId || !name || name.length > 100) throw new Error('A valid role is required.');
        if (this.sqlite.prepare('SELECT COUNT(*) AS count FROM economy_shop_items WHERE guild_id = ?').get(guildId).count >= 100) {
            throw new Error('This server already has the maximum 100 shop items.');
        }
        const now = this.now();
        return this.sqlite.prepare(`INSERT INTO economy_shop_items
            (guild_id, role_id, role_name, price, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(guildId, roleId, name, price, actorId, now, now);
    }

    listShopItems(guildId) {
        this.requireEnabled(guildId);
        return this.sqlite.prepare(`SELECT id, guild_id AS guildId, role_id AS roleId, role_name AS roleName,
            price FROM economy_shop_items WHERE guild_id = ? ORDER BY id`).all(guildId);
    }

    shopItem(guildId, itemId) {
        this.requireEnabled(guildId);
        const item = this.sqlite.prepare('SELECT * FROM economy_shop_items WHERE guild_id = ? AND id = ?').get(guildId, itemId);
        if (!item) throw new Error('Shop item not found.');
        return item;
    }

    removeShopItem(guildId, itemId) {
        this.requireEnabled(guildId);
        return Boolean(this.sqlite.prepare('DELETE FROM economy_shop_items WHERE guild_id = ? AND id = ?').run(guildId, itemId).changes);
    }

    checkShopRole(guild, role) {
        if (!guild.members.me?.permissions?.has(PermissionFlagsBits.ManageRoles)) throw new Error('ByteBot needs Manage Roles to deliver shop roles.');
        if (!role || role.id === guild.roles.everyone?.id || role.managed || !role.editable
            || role.permissions?.has(PermissionFlagsBits.Administrator)) {
            throw new Error('That role cannot be managed safely by ByteBot.');
        }
    }

    reservePurchase({ guildId, userId, item }) {
        return this.sqlite.transaction(() => {
            const scope = this.scope(guildId, userId);
            const { scopeType, scopeId } = scope;
            if (scopeType !== 'guild') throw new Error('The role shop is only available in guild mode.');
            this.requireEnabled(guildId);
            if (this.pendingPurchase(guildId, userId, item.id)) {
                throw new Error('This role purchase is pending reconciliation.');
            }
            const account = this.account(scope, userId);
            const transactionId = this.randomUUID();
            this.apply(account, {
                transactionId, walletDelta: -item.price, bankDelta: 0,
                kind: 'shop_purchase', actorId: userId, reason: String(item.id)
            });
            const id = this.randomUUID();
            const now = this.now();
            this.sqlite.prepare(`INSERT INTO economy_shop_purchases
                (id, transaction_id, guild_id, item_id, user_id, scope_type, scope_id,
                 role_id, price, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
                .run(id, transactionId, guildId, item.id, userId, scopeType, scopeId, item.role_id, item.price, now, now);
            return this.purchase(id);
        }).immediate();
    }

    purchase(id) {
        const row = this.sqlite.prepare('SELECT * FROM economy_shop_purchases WHERE id = ?').get(id);
        if (!row) return null;
        return {
            id: row.id, transactionId: row.transaction_id, guildId: row.guild_id, itemId: row.item_id,
            userId: row.user_id, scopeType: row.scope_type, scopeId: row.scope_id,
            roleId: row.role_id, price: row.price, status: row.status, error: row.error
        };
    }

    pendingPurchase(guildId, userId, itemId) {
        const row = this.sqlite.prepare(`SELECT id FROM economy_shop_purchases
            WHERE guild_id = ? AND user_id = ? AND item_id = ? AND status = 'pending'
            ORDER BY created_at, id LIMIT 1`).get(guildId, userId, itemId);
        return row ? this.purchase(row.id) : null;
    }

    markPurchase(id, status, error = null) {
        const terminalColumn = status === 'delivered' ? 'delivered_at' : 'reversed_at';
        this.sqlite.prepare(`UPDATE economy_shop_purchases SET status = ?, error = ?, updated_at = ?, ${terminalColumn} = ?
            WHERE id = ? AND status = 'pending'`).run(status, error, this.now(), this.now(), id);
        return this.purchase(id);
    }

    reversePurchase(id, error) {
        return this.sqlite.transaction(() => {
            const purchase = this.sqlite.prepare(`SELECT * FROM economy_shop_purchases
                WHERE id = ? AND status = 'pending'`).get(id);
            if (!purchase) return this.purchase(id);
            const account = this.account({ scopeType: purchase.scope_type, scopeId: purchase.scope_id }, purchase.user_id);
            const reversalTransactionId = this.randomUUID();
            this.apply(account, {
                transactionId: reversalTransactionId, walletDelta: purchase.price, bankDelta: 0,
                kind: 'shop_reversal', actorId: purchase.user_id, reason: String(purchase.item_id)
            });
            this.sqlite.prepare(`UPDATE economy_shop_purchases SET status = 'reversed', reversal_transaction_id = ?,
                error = ?, updated_at = ?, reversed_at = ? WHERE id = ? AND status = 'pending'`)
                .run(reversalTransactionId, String(error || '').slice(0, 500), this.now(), this.now(), id);
            return this.purchase(id);
        }).immediate();
    }

    async reconcilePurchase(purchase, guild, suppliedMember) {
        if (!purchase || purchase.status !== 'pending') return purchase;
        const role = guild.roles.cache.get(purchase.roleId);
        if (!role) return this.reversePurchase(purchase.id, 'Shop role no longer exists.');
        this.checkShopRole(guild, role);
        let member = suppliedMember;
        try { member = await guild.members.fetch(purchase.userId); } catch {
            if (!member) throw new Error('Purchase is pending because member state could not be confirmed.');
        }
        if (member.roles.cache.has(role.id)) return this.markPurchase(purchase.id, 'delivered');
        try {
            await member.roles.add(role, 'Economy shop purchase');
            return this.markPurchase(purchase.id, 'delivered');
        } catch (error) {
            let confirmed;
            try { confirmed = await guild.members.fetch(purchase.userId); } catch {
                throw new Error('Purchase is pending because Discord delivery could not be confirmed.');
            }
            if (confirmed.roles.cache.has(role.id)) return this.markPurchase(purchase.id, 'delivered');
            if (DEFINITIVE_ROLE_ERRORS.has(Number(error.code))) return this.reversePurchase(purchase.id, error.message);
            throw new Error('Purchase is pending because Discord delivery could not be confirmed.');
        }
    }

    async reconcile() {
        if (!this.client) return { reconciled: 0, pending: 0 };
        let reconciled = 0;
        const purchases = this.sqlite.prepare(`SELECT id FROM economy_shop_purchases
            WHERE status = 'pending' ORDER BY created_at, id`).all();
        for (const { id } of purchases) {
            const purchase = this.purchase(id);
            const guild = this.client.guilds.cache.get(purchase.guildId);
            if (!guild) continue;
            try {
                const result = await this.reconcilePurchase(purchase, guild);
                if (result.status !== 'pending') reconciled++;
            } catch { /* leave uncertain deliveries pending for the next reconciliation */ }
        }
        const pending = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM economy_shop_purchases
            WHERE status = 'pending'`).get().count;
        return { reconciled, pending };
    }

    async reconcileGuildPurchases(guild) {
        const purchases = this.sqlite.prepare(`SELECT id FROM economy_shop_purchases
            WHERE guild_id = ? AND status = 'pending' ORDER BY created_at, id`).all(guild.id);
        for (const { id } of purchases) {
            try { await this.reconcilePurchase(this.purchase(id), guild); } catch {
                // Uncertain Discord state remains pending for the next reconciliation.
            }
        }
    }

    async buyShopItem({ guild, userId, itemId, member }) {
        const item = this.shopItem(guild.id, itemId);
        const role = guild.roles.cache.get(item.role_id);
        this.checkShopRole(guild, role);
        const pending = this.pendingPurchase(guild.id, userId, item.id);
        if (pending) {
            const reconciled = await this.reconcilePurchase(pending, guild, member);
            if (reconciled.status === 'delivered') return reconciled;
        }
        if (member.roles.cache.has(role.id)) throw new Error('You already have that role.');
        const purchase = this.reservePurchase({ guildId: guild.id, userId, item });
        const result = await this.reconcilePurchase(purchase, guild, member);
        if (result.status === 'reversed') throw new Error('Role delivery failed and the purchase was reversed.');
        return result;
    }

    actionPlan({ action, guildId, actorId, targetId, amount, reason }) {
        if (!['destroy', 'reset', 'disable'].includes(action)) throw new Error('Unknown destructive economy action.');
        const auditReason = this.validateReason(reason);
        const config = this.config(guildId);
        if (!config) throw new Error('Economy has not been set up in this server.');
        if (!config.enabled) throw new Error('Economy is not enabled in this server.');
        const plan = { action, guildId, actorId, reason: auditReason, enabled: Boolean(config.enabled) };
        if (action === 'disable') return plan;
        const account = this.account({ scopeType: 'guild', scopeId: guildId }, targetId);
        const pending = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM economy_shop_purchases
            WHERE guild_id = ? AND user_id = ? AND status = 'pending'`).get(guildId, targetId).count;
        if (pending) throw new Error('Pending shop purchases must be reconciled before this account can be changed.');
        Object.assign(plan, { targetId, wallet: account.wallet, bank: account.bank, total: account.wallet + account.bank });
        if (action === 'destroy') {
            this.validateAmount(amount);
            if (amount > plan.total) throw new Error('That account does not have enough currency.');
            plan.amount = amount;
        }
        return plan;
    }

    confirmationKey(values) {
        return `${values.guildId}:${values.actorId}:${values.action}`;
    }

    issueConfirmation(values) {
        const plan = this.actionPlan(values);
        const code = this.randomBytes(5).toString('hex');
        for (const [key, confirmation] of this.confirmations) {
            if (confirmation.expiresAt <= this.now()) this.confirmations.delete(key);
        }
        const key = this.confirmationKey(values);
        this.confirmations.set(key, { code, expiresAt: this.now() + CONFIRMATION_TTL, fingerprint: digest(plan) });
        const timer = this.setTimeout(() => {
            if (this.confirmations.get(key)?.code === code) this.confirmations.delete(key);
        }, CONFIRMATION_TTL);
        timer.unref?.();
        return { ...plan, confirmationCode: code };
    }

    consumeConfirmation(values, code) {
        const key = this.confirmationKey(values);
        const confirmation = this.confirmations.get(key);
        if (!confirmation || confirmation.expiresAt <= this.now() || confirmation.code !== String(code || '')) {
            throw new Error('Preview this exact action again to get a valid confirmation code.');
        }
        this.confirmations.delete(key);
        const plan = this.actionPlan(values);
        if (confirmation.fingerprint !== digest(plan)) throw new Error('The economy action plan changed. Preview it again.');
        return plan;
    }

    destroy(values) {
        this.consumeConfirmation({ ...values, action: 'destroy' }, values.confirmationCode);
        return this.burn({ ...values, kind: 'destroy' });
    }

    reset(values) {
        const plan = this.consumeConfirmation({ ...values, action: 'reset' }, values.confirmationCode);
        return this.sqlite.transaction(() => {
            const scope = { scopeType: 'guild', scopeId: values.guildId };
            const account = this.account(scope, values.targetId);
            const removed = account.wallet + account.bank;
            if (removed !== plan.total) throw new Error('The economy action plan changed. Preview it again.');
            if (removed > 0) {
                this.apply(account, {
                    transactionId: this.randomUUID(), walletDelta: -account.wallet, bankDelta: -account.bank,
                    supplyDelta: -removed, kind: 'reset', actorId: values.actorId, counterpartyId: values.targetId,
                    reason: this.validateReason(values.reason)
                });
                this.updateTotals(scope, 0n, BigInt(removed));
            }
            this.sqlite.prepare(`DELETE FROM economy_action_cooldowns
                WHERE user_id = ? AND scope_type = 'guild' AND scope_id = ?`).run(values.targetId, values.guildId);
            this.sqlite.prepare(`DELETE FROM economy_accounts
                WHERE scope_type = 'guild' AND scope_id = ? AND user_id = ?`).run(values.guildId, values.targetId);
            return { targetId: values.targetId, removed };
        }).immediate();
    }

    reconcileTotals({ scopeType, scopeId }) {
        return this.sqlite.transaction(() => {
            let minted = 0n;
            let destroyed = 0n;
            for (const { supply_delta: delta } of this.sqlite.prepare(`SELECT supply_delta FROM economy_ledger
                WHERE scope_type = ? AND scope_id = ? ORDER BY id`).iterate(scopeType, scopeId)) {
                if (delta > 0) minted += BigInt(delta);
                if (delta < 0) destroyed += BigInt(-delta);
            }
            this.sqlite.prepare(`INSERT INTO economy_scope_totals
                (scope_type, scope_id, minted_text, destroyed_text, updated_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (scope_type, scope_id) DO UPDATE SET minted_text = excluded.minted_text,
                destroyed_text = excluded.destroyed_text, updated_at = excluded.updated_at`)
                .run(scopeType, scopeId, String(minted), String(destroyed), this.now());
            return { minted, destroyed };
        }).immediate();
    }

    disable(values) {
        this.consumeConfirmation({ ...values, action: 'disable' }, values.confirmationCode);
        this.sqlite.prepare(`UPDATE economy_configs SET enabled = 0, updated_by = ?, updated_at = ?
            WHERE guild_id = ?`).run(values.actorId, this.now(), values.guildId);
        return this.config(values.guildId);
    }

    canManage(interaction) {
        return Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild));
    }

    requireManage(interaction) {
        if (!this.canManage(interaction)) throw new Error('You need Manage Server to use this economy action.');
    }

    async respond(interaction, content, ephemeral = false) {
        const kind = content.startsWith('❌') ? 'error' : content.startsWith('✅') ? 'success'
            : content.startsWith('⚠️') ? 'warn' : 'info';
        const description = content.replace(/^[❌✅⚠️]\s*/u, '');
        const chunks = description.match(/[\s\S]{1,4000}(?:\n|$)/g) || [description];
        const payload = {
            embeds: chunks.map((chunk, index) => embeds[kind](index ? 'Economy (continued)' : 'Economy', chunk.trim())),
            allowedMentions: { parse: [], repliedUser: false }
        };
        if (ephemeral) payload.flags = [MessageFlags.Ephemeral];
        if (interaction.deferred) return interaction.editReply(payload);
        if (interaction.replied) return interaction.followUp(payload);
        return interaction.reply(payload);
    }

    amountOptions(interaction) {
        const amount = interaction.options.getInteger('amount');
        const all = interaction.options.getBoolean('all') || false;
        if ((amount === null) === !all) throw new Error('Provide either an amount or all, but not both.');
        return { amount, all };
    }

    target(interaction) {
        const user = interaction.options.getUser('member');
        const member = interaction.options.getMember?.('member');
        if (!user || user.bot || !member) throw new Error('Choose a non-bot server member.');
        return user;
    }

    formatBalance(result, currency) {
        return `**${result.userId}**\nWallet: **${result.wallet} ${currency}**\nBank: **${result.bank} ${currency}**\nTotal: **${result.total} ${currency}**\nRank: **#${result.rank}**\nScope: **${result.scopeType}**`;
    }

    async handleCommand(interaction) {
        try {
            const group = interaction.options.getSubcommandGroup(false);
            const subcommand = interaction.options.getSubcommand();
            const guildId = interaction.guildId;
            const userId = interaction.user.id;
            if (group === 'job') {
                if (subcommand === 'list') {
                    const jobs = this.listJobs(guildId);
                    return this.respond(interaction, jobs.map(job => `**${job.name}** — ${job.minimum}-${job.maximum}, ${job.cooldownSeconds}s`).join('\n') || 'No jobs configured.');
                }
                this.requireManage(interaction);
                if (subcommand === 'add') {
                    const job = this.addJob({
                        guildId, actorId: userId, name: interaction.options.getString('name'),
                        minimum: interaction.options.getInteger('minimum'), maximum: interaction.options.getInteger('maximum'),
                        cooldownSeconds: interaction.options.getInteger('cooldown_seconds')
                    });
                    return this.respond(interaction, `✅ Added job **${job.name}**.`, true);
                }
                const removed = this.job(guildId, interaction.options.getString('job'));
                this.removeJob(guildId, removed.id);
                return this.respond(interaction, `✅ Removed job **${removed.name}**.`, true);
            }
            if (group === 'shop') {
                if (subcommand === 'list') {
                    await this.reconcileGuildPurchases(interaction.guild);
                    const items = this.listShopItems(guildId);
                    return this.respond(interaction, items.length
                        ? items.map(item => `**#${item.id}** <@&${item.roleId}> — ${item.price}`).join('\n')
                        : 'No shop items are available.');
                }
                if (subcommand === 'buy') {
                    const result = await this.buyShopItem({
                        guild: interaction.guild, userId, member: interaction.member,
                        itemId: Number(interaction.options.getString('item'))
                    });
                    return this.respond(interaction, `✅ Bought <@&${result.roleId}> for **${result.price}**.`);
                }
                this.requireManage(interaction);
                if (subcommand === 'add') {
                    const role = interaction.options.getRole('role');
                    this.checkShopRole(interaction.guild, role);
                    const item = this.addShopItem({
                        guildId, actorId: userId, roleId: role.id, roleName: role.name,
                        price: interaction.options.getInteger('price')
                    });
                    return this.respond(interaction, `✅ Added **${item.role_name}** as shop item #${item.id}.`, true);
                }
                const item = this.shopItem(guildId, Number(interaction.options.getString('item')));
                this.removeShopItem(guildId, item.id);
                return this.respond(interaction, `✅ Removed **${item.role_name}** from the shop.`, true);
            }

            if (subcommand === 'open') {
                const result = this.open({ guildId, userId });
                return this.respond(interaction, `✅ Opened your **${result.scopeType}** economy account with **${result.wallet}**.`);
            }
            if (subcommand === 'balance') {
                const target = interaction.options.getUser('member') || interaction.user;
                if (target.bot) throw new Error('Bots do not have economy accounts.');
                const scope = interaction.options.getString('scope') || this.mode(userId);
                if (target.id !== userId && !interaction.options.getMember?.('member')) {
                    throw new Error('Choose a non-bot server member.');
                }
                if (scope === 'global' && target.id !== userId) {
                    throw new Error('You can only view your own global balance.');
                }
                const result = this.balance({ guildId, userId: target.id, scope });
                if (!result) throw new Error('That member does not have an economy account in this scope.');
                const config = result.scopeType === 'global' ? GLOBAL_CONFIG : this.config(guildId);
                return this.respond(interaction, this.formatBalance(result, `${config.currency_emoji} ${config.currency_name}`));
            }
            if (subcommand === 'mode') {
                const scope = interaction.options.getString('scope');
                const selected = scope ? this.setMode(userId, scope) : this.mode(userId);
                return this.respond(interaction, `Your economy mode is **${selected}**.`, true);
            }
            if (subcommand === 'deposit' || subcommand === 'withdraw') {
                const result = this[subcommand]({ guildId, userId, ...this.amountOptions(interaction) });
                return this.respond(interaction, `✅ Wallet: **${result.wallet}** • Bank: **${result.bank}**.`);
            }
            if (subcommand === 'daily' || subcommand === 'work') {
                const values = {
                    guildId, userId, guildCreatedAt: interaction.guild.createdTimestamp,
                    memberJoinedAt: interaction.member.joinedTimestamp
                };
                const result = subcommand === 'daily'
                    ? this.daily(values)
                    : this.work({ ...values, job: interaction.options.getString('job') });
                return this.respond(interaction, `✅ Earned **${result.amount}**${result.job ? ` as **${result.job}**` : ''}. Wallet: **${result.wallet}**.`);
            }
            if (subcommand === 'transfer') {
                const target = this.target(interaction);
                const amount = interaction.options.getInteger('amount');
                this.transfer({ guildId, userId, targetId: target.id, amount });
                return this.respond(interaction, `✅ Transferred **${amount}** to **${target.username || target.id}**.`);
            }
            if (subcommand === 'config') {
                const values = {
                    currencyName: interaction.options.getString('currency_name'),
                    currencyEmoji: interaction.options.getString('currency_emoji'),
                    startingBalance: interaction.options.getInteger('starting_balance'),
                    dailyCap: interaction.options.getInteger('daily_cap')
                };
                const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
                if (Object.keys(changes).length) this.requireManage(interaction);
                const config = Object.keys(changes).length ? this.configure(guildId, userId, changes) : this.config(guildId);
                if (!config) throw new Error('Economy has not been set up in this server.');
                return this.respond(interaction, `Status: **${config.enabled ? 'enabled' : 'disabled'}**\nCurrency: **${config.currency_emoji} ${config.currency_name}**\nPreset: **${config.preset}**\nDaily cap: **${config.daily_cap}**\nStarting balance: **${config.starting_balance}**\nInflation: **not modeled**`, Boolean(Object.keys(changes).length));
            }
            if (subcommand === 'circulation') {
                const result = this.circulation({ guildId, userId, scope: interaction.options.getString('scope') || undefined });
                return this.respond(interaction, `Scope: **${result.scopeType}**\nCirculation: **${result.circulation}**\nMinted: **${result.minted}**\nDestroyed: **${result.destroyed}**\nAccounts: **${result.accounts}**`);
            }

            this.requireManage(interaction);
            if (subcommand === 'enable') {
                this.enable(guildId, userId);
                return this.respond(interaction, '✅ Economy is enabled for this server.', true);
            }
            if (subcommand === 'preset') {
                const config = this.applyPreset(guildId, userId, interaction.options.getString('name'));
                return this.respond(interaction, `✅ Applied the **${config.preset}** preset.`, true);
            }
            if (subcommand === 'grant' || subcommand === 'remove') {
                const target = this.target(interaction);
                const result = this[subcommand]({
                    guildId, actorId: userId, targetId: target.id,
                    amount: interaction.options.getInteger('amount'), reason: interaction.options.getString('reason')
                });
                return this.respond(interaction, `✅ ${subcommand === 'grant' ? 'Granted' : 'Removed'} currency. Balance: **${result.total}**.`, true);
            }
            if (['reset', 'destroy', 'disable'].includes(subcommand)) {
                const target = subcommand === 'disable' ? null : this.target(interaction);
                const values = {
                    action: subcommand, guildId, actorId: userId, targetId: target?.id,
                    amount: subcommand === 'destroy' ? interaction.options.getInteger('amount') : undefined,
                    reason: interaction.options.getString('reason')
                };
                const code = interaction.options.getString('confirmation');
                if (!code) {
                    const preview = this.issueConfirmation(values);
                    return this.respond(interaction, `⚠️ Preview: **${subcommand}**${target ? ` ${target.username || target.id}` : ''}${preview.amount ? ` by ${preview.amount}` : ''}. Re-run with confirmation \`${preview.confirmationCode}\` within 10 minutes.`, true);
                }
                const result = this[subcommand]({ ...values, confirmationCode: code });
                return this.respond(interaction, `✅ Economy ${subcommand} completed${result.removed !== undefined ? `; removed **${result.removed}**` : ''}.`, true);
            }
            throw new Error('Unknown economy action.');
        } catch (error) {
            return this.respond(interaction, `❌ ${error.message}`, true);
        }
    }

    autocomplete(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand(false);
        const focused = interaction.options.getFocused().toLowerCase();
        let choices = [];
        try {
            if (subcommand === 'work' && this.mode(interaction.user.id) === 'global') {
                choices = [{ name: `${DEFAULT_JOB.name} (${DEFAULT_JOB.minimum}-${DEFAULT_JOB.maximum})`, value: DEFAULT_JOB.id }];
            } else {
                choices = (group === 'job' || subcommand === 'work')
                    ? this.listJobs(interaction.guildId).map(job => ({ name: `${job.name} (${job.minimum}-${job.maximum})`, value: String(job.id) }))
                    : this.listShopItems(interaction.guildId).map(item => ({ name: `${item.roleName} — ${item.price}`, value: String(item.id) }));
            }
        } catch { /* disabled/unconfigured economy has no choices */ }
        return interaction.respond(choices.filter(choice => choice.name.toLowerCase().includes(focused)).slice(0, 25));
    }
}

module.exports = { CONFIRMATION_TTL, EconomyService };
