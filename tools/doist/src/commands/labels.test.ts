import { describe, it, expect, beforeEach } from "vitest";
import { openDb, SyncDb, upsertLabel } from "../db.ts";
import { listLabels } from "./labels.ts";

const NOW = new Date().toISOString();

const LABEL_URGENT = { id: "l1", name: "urgent", color: "red", synced_at: NOW };
const LABEL_WORK = { id: "l2", name: "work", color: null, synced_at: NOW };
const LABEL_HOME = { id: "l3", name: "home", color: null, synced_at: NOW };

describe("listLabels", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
		upsertLabel(db, LABEL_URGENT);
		upsertLabel(db, LABEL_WORK);
		upsertLabel(db, LABEL_HOME);
	});

	it("returns all labels", () => {
		const results = listLabels(db);
		expect(results).toHaveLength(3);
	});

	it("returns labels ordered by name", () => {
		const results = listLabels(db);
		expect(results.map((l) => l.name)).toEqual(["home", "urgent", "work"]);
	});

	it("returns empty array when no labels exist", () => {
		const emptyDb = openDb(":memory:");
		expect(listLabels(emptyDb)).toHaveLength(0);
	});
});
