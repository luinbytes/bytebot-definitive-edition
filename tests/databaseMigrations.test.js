const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { readMigrationFiles } = require('drizzle-orm/migrator');

describe('database migrations', () => {
    let tempDir;
    let database;

    beforeEach(() => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-migrations-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
    });

    afterEach(() => {
        database?.sqlite.close();
        database = null;
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('a fresh database preserves migration constraints', async () => {
        database = require('../src/database');

        await database.runMigrations();

        const achievementIndexes = database.sqlite
            .prepare("PRAGMA index_list('activity_achievements')")
            .all();
        const settingsPrimaryKey = database.sqlite
            .prepare("PRAGMA table_info('bytepod_user_settings')")
            .all()
            .filter(column => column.pk > 0)
            .sort((left, right) => left.pk - right.pk)
            .map(column => column.name);

        expect(achievementIndexes.some(index => index.unique === 1)).toBe(true);
        expect(settingsPrimaryKey).toEqual(['user_id', 'guild_id']);
        expect(database.sqlite.prepare("PRAGMA table_info('economy_accounts')").all()
            .filter(column => column.pk > 0).map(column => column.name))
            .toEqual(['scope_type', 'scope_id', 'user_id']);
        expect(database.sqlite.prepare("PRAGMA index_list('economy_shop_purchases')").all())
            .toContainEqual(expect.objectContaining({ name: 'economy_shop_purchases_one_pending_item', unique: 1, partial: 1 }));
        expect(() => database.sqlite.prepare(`INSERT INTO economy_accounts
            (scope_type, scope_id, user_id, wallet, bank, created_at, updated_at)
            VALUES ('guild', 'guild1', 'user1', -1, 0, 1, 1)`).run()).toThrow();
    });

    test('an existing database gains economy scope constraints without data loss', async () => {
        const seed = new Database(process.env.DATABASE_URL);
        seed.exec(`
            CREATE TABLE legacy_sentinel (value TEXT NOT NULL);
            INSERT INTO legacy_sentinel (value) VALUES ('keep me');
            CREATE TABLE __drizzle_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at NUMERIC
            );
        `);
        const appliedMigration = seed.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
        readMigrationFiles({ migrationsFolder: './drizzle' })
            .filter(migration => migration.folderMillis < 1787605200000)
            .forEach(migration => appliedMigration.run(migration.hash, migration.folderMillis));
        seed.close();

        database = require('../src/database');
        await database.runMigrations();

        expect(database.sqlite.prepare('SELECT value FROM legacy_sentinel').get().value).toBe('keep me');
        expect(database.sqlite.prepare("PRAGMA table_info('economy_accounts')").all()
            .filter(column => column.pk > 0).map(column => column.name))
            .toEqual(['scope_type', 'scope_id', 'user_id']);
        expect(database.sqlite.prepare("PRAGMA index_list('economy_ledger')").all().map(index => index.name))
            .toEqual(expect.arrayContaining(['economy_ledger_transaction_idx', 'economy_ledger_account_idx']));
        expect(database.sqlite.prepare("PRAGMA index_list('economy_shop_purchases')").all())
            .toContainEqual(expect.objectContaining({ name: 'economy_shop_purchases_one_pending_item', unique: 1, partial: 1 }));
        const insert = database.sqlite.prepare(`INSERT INTO economy_jobs
            (guild_id, name, minimum, maximum, cooldown_seconds, created_by, created_at, updated_at)
            VALUES ('guild1', 'worker2', 1, 2, 60, 'admin1', 1, 1)`);
        insert.run();
        expect(() => insert.run()).toThrow();
    });

    test('an existing database gains indexed guild-scoped UwU Lock state without data loss', async () => {
        const seed = new Database(process.env.DATABASE_URL);
        seed.exec(`
            CREATE TABLE legacy_sentinel (value TEXT NOT NULL);
            CREATE TABLE moderation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                executor_id TEXT NOT NULL,
                action TEXT NOT NULL,
                reason TEXT,
                timestamp INTEGER
            );
            CREATE TABLE __drizzle_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at NUMERIC
            );
        `);
        seed.prepare('INSERT INTO legacy_sentinel (value) VALUES (?)').run('keep me');
        const appliedMigration = seed.prepare(
            'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
        );
        const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
        migrations.filter(migration => migration.folderMillis < 1787445064215).forEach(migration => {
            appliedMigration.run(migration.hash, migration.folderMillis);
        });
        seed.close();

        database = require('../src/database');
        await database.runMigrations();

        const indexes = database.sqlite.prepare("PRAGMA index_list('uwu_lock_members')").all();
        database.sqlite.prepare(
            "INSERT INTO uwu_lock_members (guild_id, user_id, state) VALUES ('guild1', 'user1', 'target')"
        ).run();

        expect(database.sqlite.prepare('SELECT value FROM legacy_sentinel').get().value).toBe('keep me');
        expect(indexes.some(index => index.unique === 1)).toBe(true);
        expect(indexes.some(index => index.name === 'uwu_lock_members_guild_state_idx')).toBe(true);
        expect(() => database.sqlite.prepare(
            "INSERT INTO uwu_lock_members (guild_id, user_id, state) VALUES ('guild1', 'user1', 'protected')"
        ).run()).toThrow();
        expect(() => database.sqlite.prepare(
            "INSERT INTO uwu_lock_members (guild_id, user_id, state) VALUES ('guild2', 'user1', 'target')"
        ).run()).not.toThrow();
    });

    test('access-control state is guild-scoped and rejects duplicate rules', async () => {
        database = require('../src/database');
        await database.runMigrations();

        database.sqlite.prepare(`
            INSERT INTO command_access_rules
                (guild_id, command_path, effect, scope_type, scope_id)
            VALUES ('guild1', 'mod user ban', 'deny', 'role', 'role1')
        `).run();
        database.sqlite.prepare(`
            INSERT INTO fake_permissions (guild_id, role_id, permission)
            VALUES ('guild1', 'role1', 'BanMembers')
        `).run();
        database.sqlite.prepare(`
            INSERT INTO protected_targets (guild_id, target_type, target_id)
            VALUES ('guild1', 'member', 'user1')
        `).run();
        database.sqlite.prepare(`
            INSERT INTO denied_role_permissions (guild_id, permission)
            VALUES ('guild1', 'Administrator')
        `).run();

        expect(() => database.sqlite.prepare(`
            INSERT INTO command_access_rules
                (guild_id, command_path, effect, scope_type, scope_id)
            VALUES ('guild1', 'mod user ban', 'deny', 'role', 'role1')
        `).run()).toThrow();
        expect(() => database.sqlite.prepare(`
            INSERT INTO fake_permissions (guild_id, role_id, permission)
            VALUES ('guild1', 'role1', 'BanMembers')
        `).run()).toThrow();
        expect(() => database.sqlite.prepare(`
            INSERT INTO protected_targets (guild_id, target_type, target_id)
            VALUES ('guild1', 'member', 'user1')
        `).run()).toThrow();
        expect(() => database.sqlite.prepare(`
            INSERT INTO denied_role_permissions (guild_id, permission)
            VALUES ('guild1', 'Administrator')
        `).run()).toThrow();
    });

    test('compatibility-created moderation state keeps composite uniqueness', async () => {
        const seed = new Database(process.env.DATABASE_URL);
        seed.exec(`
            CREATE TABLE legacy_sentinel (value TEXT NOT NULL);
            CREATE TABLE __drizzle_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at NUMERIC
            );
        `);
        const appliedMigration = seed.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
        readMigrationFiles({ migrationsFolder: './drizzle' }).forEach(migration => {
            appliedMigration.run(migration.hash, migration.folderMillis);
        });
        seed.close();

        database = require('../src/database');
        await database.runMigrations();
        const insert = database.sqlite.prepare(`
            INSERT INTO forced_nicknames (guild_id, user_id, nickname, updated_at)
            VALUES ('guild1', 'user1', ?, 1)
        `);

        insert.run('first');
        expect(() => insert.run('duplicate')).toThrow();

        const automationInsert = database.sqlite.prepare(`
            INSERT INTO automation_rules
                (guild_id, kind, key, config, enabled, run_count, created_by, created_at, updated_at)
            VALUES ('guild1', 'timer', 'channel1', '{}', 1, 0, 'admin1', 1, 1)
        `);
        automationInsert.run();
        expect(() => automationInsert.run()).toThrow();
        const automationIndexes = database.sqlite.prepare("PRAGMA index_list('automation_rules')").all().map(index => index.name);
        expect(automationIndexes).toEqual(expect.arrayContaining(['automation_due_idx', 'automation_guild_kind_idx']));
    });

    test('antinuke state is guild-scoped and audit entries are idempotent', async () => {
        database = require('../src/database');
        await database.runMigrations();

        const moduleInsert = database.sqlite.prepare(`
            INSERT INTO antinuke_modules (guild_id, module) VALUES (?, 'ban')
        `);
        moduleInsert.run('guild1');
        expect(() => moduleInsert.run('guild1')).toThrow();
        expect(() => moduleInsert.run('guild2')).not.toThrow();

        const actionInsert = database.sqlite.prepare(`
            INSERT INTO antinuke_actions (guild_id, actor_id, module, audit_entry_id, occurred_at)
            VALUES (?, 'actor1', 'ban', 'audit1', 1)
        `);
        actionInsert.run('guild1');
        expect(() => actionInsert.run('guild1')).toThrow();
        expect(() => actionInsert.run('guild2')).not.toThrow();
    });

    test('antiraid and automod rules are guild scoped and duplicate safe', async () => {
        database = require('../src/database');
        await database.runMigrations();

        const moduleInsert = database.sqlite.prepare(`
            INSERT INTO antiraid_modules (guild_id, module) VALUES (?, 'massjoin')
        `);
        moduleInsert.run('guild1');
        expect(() => moduleInsert.run('guild1')).toThrow();
        expect(() => moduleInsert.run('guild2')).not.toThrow();

        const ruleInsert = database.sqlite.prepare(`
            INSERT INTO automod_rules (guild_id, kind, name, value, created_at)
            VALUES (?, 'keyword', 'blocked', 'blocked', 1)
        `);
        ruleInsert.run('guild1');
        expect(() => ruleInsert.run('guild1')).toThrow();
        expect(() => ruleInsert.run('guild2')).not.toThrow();
    });

    test('compatibility repair preserves the AntiNuke consumed default', async () => {
        const seed = new Database(process.env.DATABASE_URL);
        seed.exec(`
            CREATE TABLE antinuke_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                actor_id TEXT NOT NULL,
                module TEXT NOT NULL,
                audit_entry_id TEXT NOT NULL,
                occurred_at INTEGER NOT NULL
            );
            CREATE TABLE __drizzle_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at NUMERIC
            );
            INSERT INTO antinuke_actions
                (guild_id, actor_id, module, audit_entry_id, occurred_at)
            VALUES ('guild1', 'actor1', 'ban', 'audit1', 1);
        `);
        const appliedMigration = seed.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
        readMigrationFiles({ migrationsFolder: './drizzle' }).forEach(migration => {
            appliedMigration.run(migration.hash, migration.folderMillis);
        });
        seed.close();

        database = require('../src/database');
        await database.runMigrations();

        const consumed = database.sqlite.prepare("PRAGMA table_info('antinuke_actions')").all()
            .find(column => column.name === 'consumed');
        expect(consumed).toEqual(expect.objectContaining({ notnull: 1, dflt_value: '0' }));
        expect(database.sqlite.prepare("SELECT consumed FROM antinuke_actions WHERE audit_entry_id = 'audit1'").get().consumed).toBe(0);
        database.sqlite.prepare(`
            INSERT INTO antinuke_actions (guild_id, actor_id, module, audit_entry_id, occurred_at)
            VALUES ('guild1', 'actor1', 'ban', 'audit2', 2)
        `).run();
        expect(database.sqlite.prepare("SELECT consumed FROM antinuke_actions WHERE audit_entry_id = 'audit2'").get().consumed).toBe(0);
    });

    test('moderation cases and configuration preserve guild-local numbering', async () => {
        database = require('../src/database');
        await database.runMigrations();

        const insertCase = database.sqlite.prepare(`
            INSERT INTO moderation_cases
                (guild_id, case_number, target_id, executor_id, action, status, created_at, updated_at)
            VALUES (?, 1, 'user1', 'mod1', 'WARN', 'completed', 1, 1)
        `);
        insertCase.run('guild1');

        expect(() => insertCase.run('guild1')).toThrow();
        expect(() => insertCase.run('guild2')).not.toThrow();
    });
});
