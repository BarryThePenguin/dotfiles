import { describe, expect, it } from "vitest";
import { createTestContainer } from "./test-helpers/container.ts";
import {
	computeSyncFingerprint,
	getLastFullSyncAt,
	getSyncFingerprint,
	getToken,
	resolveStalenessBudget,
	resolveSyncScope,
	setLastFullSyncAt,
	setSyncFingerprint,
	setToken,
	STALENESS_BUDGET_MS,
} from "./sync-lifecycle.ts";

describe("computeSyncFingerprint", () => {
	it("is deterministic for the same scope", () => {
		expect(computeSyncFingerprint(["p1", "p2"])).toBe(
			computeSyncFingerprint(["p1", "p2"]),
		);
	});

	it("ignores the order of project IDs", () => {
		expect(computeSyncFingerprint(["p2", "p1"])).toBe(
			computeSyncFingerprint(["p1", "p2"]),
		);
	});

	it("changes when the allowlist changes", () => {
		expect(computeSyncFingerprint(["p1"])).not.toBe(
			computeSyncFingerprint(["p1", "p2"]),
		);
	});

	it("changes with the schema/transform version", () => {
		expect(computeSyncFingerprint(["p1"], "1")).not.toBe(
			computeSyncFingerprint(["p1"], "2"),
		);
	});

	it("treats an empty allowlist as a distinct scope", () => {
		expect(computeSyncFingerprint([])).not.toBe(computeSyncFingerprint(["p1"]));
	});
});

describe("resolveSyncScope", () => {
	it("keeps the existing token when the scope matches", () => {
		const { db } = createTestContainer();
		setToken(db, "tok-keep");
		setSyncFingerprint(db, computeSyncFingerprint(["p1"]));

		const res = resolveSyncScope(db, ["p1"], false);

		expect(res.isFullSync).toBe(false);
		expect(getToken(db)).toBe("tok-keep");
		expect(res.fingerprint).toBe(computeSyncFingerprint(["p1"]));
	});

	it("forces a full sync and discards the token on allowlist growth", () => {
		const { db } = createTestContainer();
		setToken(db, "tok-old");
		setSyncFingerprint(db, computeSyncFingerprint(["p1"]));

		const res = resolveSyncScope(db, ["p1", "p2"], false);

		expect(res.isFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
		expect(res.fingerprint).toBe(computeSyncFingerprint(["p1", "p2"]));
	});

	it("forces a full sync and discards the token on allowlist shrink", () => {
		const { db } = createTestContainer();
		setToken(db, "tok-old");
		setSyncFingerprint(db, computeSyncFingerprint(["p1", "p2"]));

		const res = resolveSyncScope(db, ["p1"], false);

		expect(res.isFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
	});

	it("forces a full sync and discards the token on transform-version drift", () => {
		const { db } = createTestContainer();
		setToken(db, "tok-old");
		// Stored fingerprint simulates a token issued under an older transform.
		setSyncFingerprint(db, computeSyncFingerprint(["p1"], "legacy"));

		const res = resolveSyncScope(db, ["p1"], false);

		expect(res.isFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
	});

	it("forces a full sync when explicitly requested", () => {
		const { db } = createTestContainer();
		setToken(db, "tok-keep");
		setSyncFingerprint(db, computeSyncFingerprint(["p1"]));

		const res = resolveSyncScope(db, ["p1"], true);

		expect(res.isFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
	});

	it("treats a missing fingerprint as drift (legacy DB / first run)", () => {
		const { db } = createTestContainer();
		setToken(db, "tok-legacy");

		const res = resolveSyncScope(db, [], false);

		expect(res.isFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
	});
});

describe("fingerprint persistence", () => {
	it("getSyncFingerprint returns null before any sync", () => {
		const { db } = createTestContainer();
		expect(getSyncFingerprint(db)).toBeNull();
	});
});

describe("resolveStalenessBudget", () => {
	const NOW = Date.parse("2026-08-22T12:00:00.000Z");

	it("records and reads the last full sync timestamp", () => {
		const { db } = createTestContainer();
		expect(getLastFullSyncAt(db)).toBeNull();

		setLastFullSyncAt(db, "2026-08-22T00:00:00.000Z");
		expect(getLastFullSyncAt(db)).toBe("2026-08-22T00:00:00.000Z");
	});

	it("does not escalate when the last full sync is within budget", () => {
		const { db } = createTestContainer();
		setLastFullSyncAt(
			db,
			new Date(NOW - STALENESS_BUDGET_MS + 1000).toISOString(),
		);
		setToken(db, "tok-keep");

		const res = resolveStalenessBudget(db, NOW);

		expect(res.needsFullSync).toBe(false);
		expect(getToken(db)).toBe("tok-keep");
	});

	it("does not escalate exactly at the budget boundary", () => {
		const { db } = createTestContainer();
		setLastFullSyncAt(db, new Date(NOW - STALENESS_BUDGET_MS).toISOString());
		setToken(db, "tok-keep");

		const res = resolveStalenessBudget(db, NOW);

		expect(res.needsFullSync).toBe(false);
		expect(getToken(db)).toBe("tok-keep");
	});

	it("escalates when the last full sync is older than the budget", () => {
		const { db } = createTestContainer();
		setLastFullSyncAt(
			db,
			new Date(NOW - STALENESS_BUDGET_MS - 1000).toISOString(),
		);
		setToken(db, "tok-old");

		const res = resolveStalenessBudget(db, NOW);

		expect(res.needsFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
	});

	it("escalates when no full sync has been recorded yet", () => {
		const { db } = createTestContainer();
		setToken(db, "tok-legacy");

		const res = resolveStalenessBudget(db, NOW);

		expect(res.needsFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
	});

	it("honors an injected budget", () => {
		const { db } = createTestContainer();
		// 2h old, but budget is only 1h → stale.
		setLastFullSyncAt(db, new Date(NOW - 2 * 60 * 60 * 1000).toISOString());
		setToken(db, "tok-keep");

		const res = resolveStalenessBudget(db, NOW, 60 * 60 * 1000);

		expect(res.needsFullSync).toBe(true);
		expect(getToken(db)).toBeNull();
	});
});
