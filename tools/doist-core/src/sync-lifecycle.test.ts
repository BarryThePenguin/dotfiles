import { describe, expect, it } from "vitest";
import { createTestContainer } from "./test-helpers/container.ts";
import {
	computeSyncFingerprint,
	getSyncFingerprint,
	getToken,
	resolveSyncScope,
	setSyncFingerprint,
	setToken,
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
